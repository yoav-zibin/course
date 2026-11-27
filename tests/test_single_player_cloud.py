"""Private offline saves converge without exposing or overwriting another branch."""

from dataclasses import replace

import pytest
import json

from game_platform.models import Seat
from game_platform.tests.helpers import Api


def snapshot(owner, game, *, kind="pass_and_play", identity="local-cloud-save", turns=0):
    players = [
        {"id": "local-player-0", "player_index": 0, "kind": "human", "user_id": owner, "name": "Owner", "active": True},
        {"id": "local-player-1", "player_index": 1, "kind": "computer" if kind == "computer" else "human", "user_id": None, "name": "Player 2", "active": True},
    ]
    return {
        "id": identity, "game_id": game, "game_version": 1,
        "owner_user_id": owner, "match_kind": kind, "players": players,
        "logicState": {"n": turns}, "state": {"n": turns}, "practiceSeed": 123,
        "moves": [{"move_number": n, "player_index": (n - 1) % 2,
                   "new_state": {"n": n}, "next_turn_player_indices": [n % 2]}
                  for n in range(1, turns + 1)],
        "initialState": {"n": 0}, "initialTurn": [0],
        "turn_of_player_indices": [turns % 2], "status": "ongoing", "move_count": turns,
        "created_at": "2026-11-20T00:00:00Z", "awaitingHandoff": False,
    }


def sync(api, owner, value, revision=0):
    return api.request("POST", "/matches/single-player-sync", as_user=owner,
                       json={"match": value, "expected_revision": revision})


@pytest.mark.parametrize("kind", ["computer", "pass_and_play"])
def test_private_offline_turns_save_and_restore_only_for_owner(api: Api, kind):
    owner, other = api.new_user("Owner"), api.new_user("Other")
    game = api.new_game(owner=owner)
    value = snapshot(owner, game, kind=kind, turns=12)
    response = sync(api, owner, value)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["match_kind"] == kind
    assert saved["cloud_revision"] == 1
    assert saved["move_count"] == 12
    assert saved["single_player_state"]["logicState"] == {"n": 12}
    assert saved["invite_code"] is None
    assert saved["single_player_state"]["players"] == value["players"]
    restored = api.ok("GET", f"/matches/{value['id']}", as_user=owner)
    assert restored["single_player_state"] == saved["single_player_state"]
    assert api.ok("GET", f"/matches/{value['id']}/history", as_user=owner)["moves"][-1]["new_state"] == {"n": 12}
    for caller in (None, other):
        for suffix in ("", "/history", "/moves", "/game"):
            assert api.request("GET", f"/matches/{value['id']}{suffix}", as_user=caller).status_code == 404
    for suffix in ("/join", "/invites"):
        assert api.request("POST", f"/matches/{value['id']}{suffix}", as_user=other, json={} if suffix == "/invites" else None).status_code == 403
    assert api.ok("GET", "/matches", as_user=other) == []
    assert api.platform._store.get_user(owner).notifications == ()
    assert api.platform._store.get_user(other).notifications == ()


@pytest.mark.parametrize("kind", ["computer", "pass_and_play"])
def test_private_session_upload_records_only_owner_recent_game_and_retry_does_not_reorder(api: Api, kind):
    owner, other = api.new_user("Owner"), api.new_user("Other")
    previous, game, later = [api.new_game(owner=owner) for _ in range(3)]
    for user in (owner, other):
        api.ok("POST", f"/users/me/recent-games/{previous}", as_user=user)
    store = api.platform._store
    other_before = store.get_user(other)
    # The whole session happened offline before its first acknowledged upload.
    value = snapshot(owner, game, kind=kind, turns=12)
    first = sync(api, owner, value)
    assert first.status_code == 200
    assert store.get_user(owner).recent_game_ids == (game, previous)
    assert store.get_user(other) == other_before
    api.ok("POST", f"/users/me/recent-games/{later}", as_user=owner)
    before_retry = store.get_user(owner)
    assert sync(api, owner, value).json()["cloud_revision"] == first.json()["cloud_revision"]
    assert store.get_user(owner) == before_retry
    assert store.get_user(owner).recent_game_ids == (later, game, previous)
    assert store.get_user(owner).notifications == ()
    assert api.ok("GET", f"/games/{game}/popularity")["score"] == 0


def test_lost_ack_retry_is_idempotent_and_other_device_branch_is_preserved(api: Api):
    owner = api.new_user("Owner")
    game = api.new_game(owner=owner)
    old = snapshot(owner, game)
    assert sync(api, owner, old).json()["cloud_revision"] == 1
    assert sync(api, owner, old).json()["cloud_revision"] == 1
    newer = snapshot(owner, game, turns=4)
    assert sync(api, owner, newer).status_code == 409
    assert sync(api, owner, newer, 1).json()["cloud_revision"] == 2
    conflicting = snapshot(owner, game, turns=2)
    assert sync(api, owner, conflicting, 1).status_code == 409
    assert sync(api, owner, conflicting, 2).status_code == 409
    assert api.ok("GET", f"/matches/{old['id']}", as_user=owner)["move_count"] == 4


@pytest.mark.parametrize("mutate", [
    lambda v, other: v.update(match_kind="multiplayer"),
    lambda v, other: v["players"][1].update(user_id=other),
    lambda v, other: v["players"][1].update(kind="computer"),
    lambda v, other: v.update(token_pot=10),
    lambda v, other: v.update(turn_seconds=60),
    lambda v, other: v.update(move_count=99),
    lambda v, other: v.update(turn_of_player_indices=[9]),
    lambda v, other: v.update(practiceSeed=-1),
    lambda v, other: v.update(owner_user_id=other),
])
def test_invalid_save_rejected_without_creating_match(api: Api, mutate):
    owner, other = api.new_user("Owner"), api.new_user("Other")
    value = snapshot(owner, api.new_game(owner=owner))
    mutate(value, other)
    assert sync(api, owner, value).status_code == 400
    assert api.platform._store.get_match(value["id"]) is None


def test_snapshot_cannot_convert_multiplayer_or_claim_another_owner_id(api: Api):
    owner, other = api.new_user("Owner"), api.new_user("Other")
    game = api.new_game(owner=owner)
    multiplayer = api.new_match(owner=owner, game_id=game)
    assert sync(api, owner, snapshot(owner, game, identity=multiplayer)).status_code == 409
    original = snapshot(owner, game)
    assert sync(api, owner, original).status_code == 200
    foreign = snapshot(other, game)
    assert sync(api, other, foreign).status_code == 404


def test_multiplayer_creation_intent_idempotent_across_lost_ack(api: Api):
    owner = api.new_user("Owner", tokens=20)
    game = api.new_game(owner=owner)
    body = {"game_id": game, "client_match_id": "cloud-lobby-123", "bet_per_player": 5}
    first = api.ok("POST", "/matches", as_user=owner, json=body)
    retry = api.ok("POST", "/matches", as_user=owner, json=body)
    assert first["id"] == retry["id"] == body["client_match_id"]
    assert first["invite_code"] == retry["invite_code"]
    assert api.platform._store.get_user(owner).token_balance == 15
    assert len(api.platform._store.list_all_matches()) == 1


def test_game_supporting_solo_and_two_players_needs_two_accounts_for_multiplayer(api: Api):
    owner, other = api.new_user("Owner"), api.new_user("Other")
    game = api.new_game(owner=owner, allowed_player_counts=(1, 2))
    identity = api.new_match(owner=owner, game_id=game)
    assert api.request("POST", f"/matches/{identity}/start", as_user=owner).status_code == 409
    assert api.ok("POST", f"/matches/{identity}/join", as_user=other)["status"] == "ongoing"


def test_legacy_computer_match_private_and_owner_gets_portable_state(api: Api):
    owner, other = api.new_user("Owner"), api.new_user("Other")
    game = api.new_game(owner=owner)
    identity = api.new_match(owner=owner, game_id=game)
    match = api.platform._store.get_match(identity)
    match = replace(match, match_kind=None, status="ongoing", state={"n": 0},
                    turn_of_player_indices=frozenset({0}),
                    seats=(match.seats[0], Seat(player_index=1, kind="computer", user_id=None)))
    api.platform._store.put_match(match)
    saved = api.ok("GET", f"/matches/{identity}", as_user=owner)
    assert saved["match_kind"] == "computer"
    assert saved["single_player_state"]["logicState"] == match.state
    assert saved["single_player_state"]["players"][0]["id"] == owner
    assert "seed" not in saved["single_player_state"]
    assert api.request("GET", f"/matches/{identity}", as_user=other).status_code == 404
    assert api.request("GET", f"/invites/{match.invite_code}").status_code == 404


def test_owner_can_start_a_migrated_waiting_computer_match_privately(api: Api):
    from game_platform.tests.helpers import legacy_computer_match

    owner, stranger = api.new_user("Owner"), api.new_user("Stranger")
    identity = api.new_match(owner=owner, game_id=api.new_game(owner=owner))
    store = api.platform._store
    legacy = legacy_computer_match(api.platform, store.get_match(identity), 1)
    if legacy.invite_code is not None:
        store.delete_invite(legacy.invite_code)
    store.put_match(replace(legacy, match_kind="computer", cloud_revision=1, invite_code=None))
    waiting = api.ok("GET", f"/matches/{identity}", as_user=owner)
    assert waiting["status"] == "waiting_for_players"
    assert waiting["match_kind"] == "computer" and waiting["cloud_revision"] == 1
    assert waiting["single_player_state"] is None

    started = api.ok("POST", f"/matches/{identity}/start", as_user=owner)
    assert started["status"] == "ongoing" and started["cloud_revision"] >= 2
    assert started["match_kind"] == "computer" and started["invite_code"] is None
    assert started["single_player_state"]["id"] == identity
    assert started["single_player_state"]["owner_user_id"] == owner
    assert started["single_player_state"]["logicState"] == store.get_match(identity).state
    assert api.request("GET", f"/matches/{identity}", as_user=stranger).status_code == 404
    assert api.request("POST", f"/matches/{identity}/join", as_user=stranger).status_code == 403
    for caller in (owner, stranger):
        assert api.request("POST", f"/matches/{identity}/invites", as_user=caller, json={}).status_code == 403


def test_bundled_game_save_uses_trusted_retained_package(api: Api):
    owner = api.new_user("Owner")
    value = snapshot(owner, "bundled-tictactoe")
    result = sync(api, owner, value)
    assert result.status_code == 200, result.text
    assert result.json()["game_id"] == "bundled-tictactoe"
    retained = api.ok("GET", f"/matches/{value['id']}/game", as_user=owner)
    assert retained["id"] == "bundled-tictactoe"
    assert retained["server_code"]


@pytest.mark.parametrize("finished", [False, True])
def test_owner_can_delete_private_match(api: Api, finished):
    owner = api.new_user("Owner")
    value = snapshot(owner, api.new_game(owner=owner))
    if finished:
        value.update(status="over", turn_of_player_indices=None)
    assert sync(api, owner, value).status_code == 200
    assert api.request("DELETE", f"/matches/{value['id']}", as_user=owner).status_code == 204
    assert api.platform._store.get_match(value["id"]) is None
    assert api.request("GET", f"/matches/{value['id']}", as_user=owner).status_code == 404


@pytest.mark.parametrize("finished", [False, True])
def test_query_save_many_offline_turns_survives_cold_load_and_deletion(finished):
    from game_platform.query_store import QueryStore
    from game_platform.scaling_service import ScalablePlatform
    from game_platform.tests.fake_firestore import query_store
    from game_platform.tests.helpers import FakeClock

    store = query_store("single_player_cloud")
    api = Api(store=store)
    api.platform = ScalablePlatform(store=store, clock=FakeClock(), computer_move_delay_seconds=0)
    api.client.app.state.platform = api.platform
    owner, other = api.new_user("Owner"), api.new_user("Other")
    value = snapshot(owner, api.new_game(owner=owner), turns=600)
    # Rich full-board views exceed Firestore's single-document plaintext limit
    # after a long offline session, while their repeated structure compresses.
    for move in value["moves"]:
        move["new_state"]["board"] = [index % 16 for index in range(1200)]
    assert len(json.dumps(value).encode()) > 600_000
    if finished:
        value.update(status="over", turn_of_player_indices=None)
        value["moves"][-1]["next_turn_player_indices"] = None
    try:
        response = sync(api, owner, value)
        assert response.status_code == 200, response.text
        cold = QueryStore(store.client, namespace=store.namespace)
        match = cold.get_match(value["id"])
        assert match.single_player_state["logicState"] == {"n": 600}
        assert len(match.moves) == 600
        assert match.moves[-1].move_number == 600
        assert store.raw_get(store.ref("matches", value["id"]))["visible_to"] == [owner]
        stored = json.loads(store.raw_get(store.ref("matches", value["id"]))["json"])
        assert stored["single_player_state"] is None
        assert stored["single_player_state_compressed"]
        history = api.ok("GET", f"/v2/matches/{value['id']}/history", as_user=owner,
                         params={"start": 598, "limit": 2})
        assert history["initial_state"] == {"n": 0}
        assert [m["new_state"] for m in history["items"]] == [m["new_state"] for m in value["moves"][-2:]]
        assert api.ok("GET", "/v2/matches", as_user=other)["items"] == []
        assert api.ok("GET", "/v2/matches", as_user=owner)["items"][0]["single_player_state"]["move_count"] == 600
        assert api.request("DELETE", f"/matches/{value['id']}", as_user=owner).status_code == 204
        assert sync(api, owner, value).status_code == 409
        cold.clear_cache()
        assert cold.get_match(value["id"]) is None
    finally:
        api.platform.close_workers()


def test_account_merge_transfers_private_save_without_changing_player_ids(api: Api):
    owner, target = api.new_user("Owner"), api.new_user("Target")
    value = snapshot(owner, api.new_game(owner=owner), turns=3)
    assert sync(api, owner, value).status_code == 200
    api.ok("POST", f"/users/{owner}/merge", as_user=owner,
           json={"into_user_id": target, "into_password": api.passwords_by_user_id[target]})
    restored = api.ok("GET", f"/matches/{value['id']}", as_user=target)
    portable = restored["single_player_state"]
    assert portable["owner_user_id"] == target
    assert portable["players"][0]["user_id"] == target
    assert portable["players"][0]["id"] == "local-player-0"


def test_compressed_save_decoding_is_bounded_and_rejects_malformed_data():
    import base64
    import gzip
    from game_platform.single_player import MAX_SAVE_BYTES, decode_save

    bomb = base64.b64encode(gzip.compress(b"x" * (MAX_SAVE_BYTES + 1), mtime=0)).decode()
    with pytest.raises(ValueError):
        decode_save(bomb)
    with pytest.raises(ValueError):
        decode_save("not valid base64!")


def test_maintenance_validates_private_history_views_without_exposing_rules_state():
    from game_platform.query_store import QueryStore
    from game_platform.scaling_maintenance import validate_matches
    from game_platform.tests.fake_firestore import query_store

    store = query_store("private_history_validation")
    api = Api(store=store)
    owner = api.new_user("Owner")
    value = snapshot(owner, api.new_game(owner=owner), turns=2)
    value["logicState"] = {"n": 2, "secret_hands": [["ace"], ["king"]]}
    assert value["moves"][-1]["new_state"] != value["logicState"]
    assert sync(api, owner, value).status_code == 200
    cold = QueryStore(store.client, namespace=store.namespace)
    assert validate_matches(cold)["moves"] == 2

    saved = cold.get_match(value["id"])
    damaged = {**saved.single_player_state, "state": {"n": 999}}
    store.put_match(replace(saved, single_player_state=damaged))
    with pytest.raises(ValueError, match="final state mismatch"):
        validate_matches(QueryStore(store.client, namespace=store.namespace))


def test_maintenance_still_rejects_authoritative_multiplayer_state_mismatch():
    from game_platform.scaling_maintenance import validate_matches
    from game_platform.tests.fake_firestore import query_store

    store = query_store("multiplayer_history_validation")
    api = Api(store=store)
    owner, other = api.new_user("Owner"), api.new_user("Other")
    identity = api.new_match(owner=owner, game_id=api.new_game(owner=owner), joiners=[other], start=True)
    api.platform.make_move(caller_id=owner, match_id=identity, expected_move_count=0,
                           move={"state": {"n": 1}, "turn_indices": [1]})
    assert validate_matches(store)["moves"] == 1
    match = store.get_match(identity)
    assert match.single_player_state is None
    store.put_match(replace(match, state={"n": 999}))
    with pytest.raises(ValueError, match="final state mismatch"):
        validate_matches(store)
