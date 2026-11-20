"""Public human-only match behavior against persisted query-store records."""

import json

import pytest

from game_platform.query_store import QueryStore
from game_platform.scaling_service import ScalablePlatform
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api, FakeClock
from game_platform.tests.test_server_matches import _create_game


def _api_for(store, previous=None):
    api = Api(store=store)
    api.platform = ScalablePlatform(store=store, clock=FakeClock(),
                                    computer_move_delay_seconds=0)
    api.client.app.state.platform = api.platform
    if previous is not None:
        api.passwords_by_user_id = previous.passwords_by_user_id
    return api


def test_query_reload_ignores_old_audience_flags_and_preserves_player_projection():
    store = query_store()
    api = _api_for(store)
    alice, bob = api.new_user("Alice"), api.new_user("Bob")
    game_id = _create_game(api, alice)
    match_id = api.new_match(owner=alice, game_id=game_id)

    # Older deployments persisted the options in both the JSON and query header.
    ref = store.ref("matches", match_id)
    row = ref.get().to_dict()
    record = json.loads(row["json"])
    record.update(private=True, matchmaking_player_count=2)
    row.update(json=json.dumps(record), private=True,
               matchmaking_player_count=2, joinable=False)
    ref.set(row)
    cold = QueryStore(store.client, namespace=store.namespace)
    restarted = _api_for(cold, api)
    try:
        for caller in (None, alice, bob):
            visible = restarted.ok("GET", f"/matches/{match_id}", as_user=caller)
            assert visible["id"] == match_id and "private" not in visible
        joined = restarted.ok("POST", f"/matches/{match_id}/join", as_user=bob)
        assert joined["status"] == "waiting_for_players"
        assert all(player["kind"] == "human" for player in joined["players"])
        restarted.ok("POST", f"/matches/{match_id}/start", as_user=alice)
        restarted.ok("POST", f"/matches/{match_id}/moves", as_user=alice,
                     json={"move": {"add": 1}})
        for path in (f"/matches/{match_id}", f"/matches/{match_id}/history",
                     f"/v2/matches/{match_id}/history"):
            response = restarted.request("GET", path)
            assert response.status_code == 200
            assert "secret-of-" not in response.text
        batch = restarted.ok("GET", "/batch", params={"requests": json.dumps([
            f"/matches/{match_id}", f"/matches/{match_id}/history", f"/v2/matches/{match_id}/history"])})
        assert [row["status"] for row in batch] == [200, 200, 200]
        assert "secret-of-" not in json.dumps(batch)
        own = restarted.ok("GET", f"/matches/{match_id}", as_user=bob)
        assert own["state"]["your_secret"] == f"secret-of-{bob}"
        persisted = ref.get().to_dict()
        assert "private" not in persisted
        assert "private" not in json.loads(persisted["json"])
        assert not {"matchmaking_player_count", "joinable"} & persisted.keys()
        assert "matchmaking_player_count" not in json.loads(persisted["json"])
        outsider = restarted.new_user("Outsider")
        assert restarted.request("POST", f"/matches/{match_id}/moves", as_user=outsider,
                                 json={"move": {"add": 1}}).status_code == 403
        for caller, amount in ((bob, 3), (alice, 3), (bob, 3)):
            ended = restarted.ok("POST", f"/matches/{match_id}/moves", as_user=caller,
                                 json={"move": {"add": amount}})
        assert ended["status"] == "over"
        for path in (f"/matches/{match_id}", f"/matches/{match_id}/history",
                     f"/v2/matches/{match_id}/history"):
            response = restarted.request("GET", path)
            assert response.status_code == 200
            assert "secret-of-" not in response.text
        rematch = restarted.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)
        assert "private" not in rematch
        assert restarted.ok("GET", f"/matches/{rematch['id']}")["id"] == rematch["id"]
    finally:
        api.platform.close_workers()
        restarted.platform.close_workers()


def test_query_creation_and_rematches_are_human_only_but_old_computer_matches_continue():
    store = query_store()
    api = _api_for(store)
    alice, bob = api.new_user("Alice"), api.new_user("Bob")
    game_id = _create_game(api, alice)
    try:
        blocked = api.request("POST", "/matches", as_user=alice,
                              json={"game_id": game_id, "num_computer_opponents": 1})
        assert blocked.status_code == 422
        assert "human players only" in blocked.text
        assert store.list_matches_involving(alice) == []
        created = api.ok("POST", "/matches", as_user=alice, json={"game_id": game_id})
        assert [(p["kind"], p["user_id"]) for p in created["players"]] == [("human", alice)]

        legacy_id = api.new_match(owner=alice, game_id=game_id,
                                  num_computer_opponents=1, start=True)
        api.ok("POST", f"/matches/{legacy_id}/moves", as_user=alice,
               json={"move": {"add": 1}})
        api.platform.run_due_jobs()
        cold = QueryStore(store.client, namespace=store.namespace)
        legacy = cold.get_match(legacy_id)
        assert legacy.num_computer_opponents == 1
        assert len(legacy.moves) == 2
        assert [move.player_index for move in legacy.moves] == [0, 1]
        for amount in (3, 2, 1):
            api.ok("POST", f"/matches/{legacy_id}/moves", as_user=alice,
                   json={"move": {"add": amount}})
            api.platform.run_due_jobs()
        assert store.get_match(legacy_id).status == "over"
        rematch = api.ok("POST", f"/matches/{legacy_id}/rematch", as_user=alice)
        assert rematch["status"] == "waiting_for_players"
        assert [(p["kind"], p["user_id"]) for p in rematch["players"]] == [("human", alice)]
        api.ok("POST", f"/matches/{rematch['id']}/join", as_user=bob)
    finally:
        api.platform.close_workers()


@pytest.mark.parametrize("query", [False, True])
@pytest.mark.parametrize("retirement", ["unpublish", "delete"])
def test_public_matches_keep_their_pinned_renderer_after_game_retirement(query, retirement):
    from game_platform.tests.helpers import TEST_GAME_SECRET

    api = _api_for(query_store()) if query else Api()
    try:
        alice, bob = api.new_user("Alice"), api.new_user("Bob")
        game_id = _create_game(api, alice)
        match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)
        api.ok("PATCH", f"/games/{game_id}", as_user=alice, json={
            "name": "Updated counter game",
            "game_addition_request_id_and_secret": TEST_GAME_SECRET,
        })
        api.ok("POST", f"/games/{game_id}/unpublish", as_user=alice)
        if retirement == "delete":
            api.ok("DELETE", f"/games/{game_id}", as_user=alice)
        assert api.request("GET", f"/games/{game_id}").status_code == 404
        assert api.request("GET", f"/games/{game_id}/versions/2").status_code == 404
        assert api.request("GET", f"/games/{game_id}/versions/1").status_code == 404
        public = api.ok("GET", f"/matches/{match_id}")
        assert public["id"] == match_id and public["game_version"] == 1
        assert "secret-of-" not in json.dumps(public)
        for suffix in ("/history", "/moves"):
            response = api.request("GET", f"/matches/{match_id}{suffix}")
            assert response.status_code == 200 and "secret-of-" not in response.text
        renderer = api.ok("GET", f"/matches/{match_id}/game")
        assert (renderer["id"], renderer["version"], renderer["name"]) == (game_id, 1, "Counter race")
        assert renderer["declarative_ui"] and renderer["server_code"]
        assert not {"seed", "pending_leave", "import_package"} & renderer.keys()
        assert TEST_GAME_SECRET not in json.dumps(renderer)
        assert api.request("GET", "/matches/missing/game").status_code == 404
    finally:
        if query:
            api.platform.close_workers()
