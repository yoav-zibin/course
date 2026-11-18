"""Published game failures feed the private queue, including rolled-back moves."""

import json
from dataclasses import replace

import pytest

from game_platform.game_logic import InvalidMoveError
from game_platform.service import PlatformError
from game_platform.store import InMemoryStore
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api


AUTH = ("reviewer", "test-master-password")


def test_bug_review_fails_closed_without_a_master_password():
    client = Api().client
    assert client.get("/game-server-bugs").status_code == 503
    assert client.get("/game-server-bugs/missing").status_code == 503
    assert client.post("/game-server-bugs/missing/examine",
        json={"outcome": "escalated", "notes": "Review"}).status_code == 503
    assert not any(path.startswith("/game-server-bugs")
                   for path in client.get("/openapi.json").json()["paths"])


@pytest.fixture(params=["memory", "query"])
def api(request):
    store = InMemoryStore() if request.param == "memory" else query_store("bugs_api")
    instance = Api(store=store, master_password=AUTH[1])
    yield instance
    if hasattr(store, "close"):
        store.close()


def game_match(api):
    alice, bob = api.new_user("Alice"), api.new_user("Bob")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)
    api.platform._logic_cache.clear()
    store = api.platform._store
    return store.get_game(game_id), store.get_match(match_id), alice


def broken_game(game, function="applyMove"):
    return replace(game,
        description="A race whose rules must stay unchanged.",
        server_code='const game = {' + function + '() {throw new Error("hidden failure");}};',
        import_package={**game.import_package, "rules_text": "Reach the finish first."})


def pending(api, **params):
    response = api.client.get("/game-server-bugs", params=params, auth=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def test_failed_call_survives_rollback_and_retains_exact_private_reproduction(api):
    game, match, alice = game_match(api)
    game = broken_game(game)
    store = api.platform._store
    call_args = (match.state, alice, {"secret_choice": [3, 1]})
    with pytest.raises(PlatformError):
        with api.platform._lock:
            api.platform._call_logic(game, match, "applyMove", *call_args)
    persisted = store.get_match(match.id)
    assert replace(persisted, moves=()) == replace(match, moves=())
    assert list(persisted.moves) == list(match.moves)
    page = pending(api)
    assert len(page["items"]) == 1
    header = page["items"][0]
    assert "evidence" not in header
    assert header["game_id"] == game.id and header["match_id"] == match.id
    response = api.client.get(f"/game-server-bugs/{header['id']}", auth=AUTH)
    assert response.status_code == 200
    evidence = response.json()["evidence"]
    assert evidence["arguments"] == list(call_args)
    assert json.loads(evidence["input_json"]) == {"args": list(call_args), "ctx": evidence["ctx"]}
    assert evidence["seed"] == str(api.platform._logic_seed(match, "applyMove"))
    assert evidence["frozen_time_millis"] > 0
    assert evidence["server_code"] == game.server_code
    assert evidence["game_description"] == game.description
    assert evidence["textual_rules"] == "Reach the finish first."
    assert evidence["time_limit_seconds"] == 0.1
    assert evidence["memory_limit_bytes"] == 64 * 1024 * 1024
    for url in ("/game-server-bugs", f"/game-server-bugs/{header['id']}"):
        assert api.client.get(url).status_code == 401
        assert api.client.get(url, auth=("reviewer", "wrong")).status_code == 401
    url = f"/game-server-bugs/{header['id']}/examine"
    assert api.client.post(url, json={"outcome": "escalated", "notes": "Owner decision needed"}).status_code == 401


def test_view_failure_is_recorded_even_when_projection_returns_none(api):
    game, match, alice = game_match(api)
    api.platform._store.put_game_version(broken_game(game, "viewFor"))
    api.platform._logic_cache.clear()
    api.platform._view_cache.clear()
    assert api.platform.view_state(match, alice) is None
    assert pending(api)["items"][0]["function"] == "viewFor"


def test_ordinary_illegal_move_does_not_enter_bug_queue(api):
    game, match, alice = game_match(api)
    illegal = replace(game, server_code='const game = {applyMove() {throw new InvalidMove("illegal");}};')
    with pytest.raises(InvalidMoveError):
        api.platform._call_logic(illegal, match, "applyMove", match.state, alice, {})
    assert pending(api)["items"] == []


def test_invalid_computer_move_records_generated_call_evidence(api):
    alice = api.new_user("Alice")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, num_computer_opponents=1, start=True)
    store = api.platform._store
    game = store.get_game(game_id)
    match = store.get_match(match_id)
    game = replace(game, server_code='''const game = {
      computerMove() {return {illegal_generated_move: true};},
      applyMove() {throw new InvalidMove("bot made an illegal move");}
    };''')
    store.put_game_version(game)
    store.put_match(replace(match, turn_of_player_indices=frozenset({1})))
    api.platform._logic_cache.clear()
    api.platform._run_computer_moves(match_id)
    row = pending(api)["items"][0]
    assert row["kind"] == "invalid_computer_move"
    evidence = store.get_game_server_bug(row["id"])["evidence"]
    assert evidence["arguments"][2] == {"illegal_generated_move": True}
    assert evidence["frozen_time_millis"] > 0


def test_optional_handler_discovery_records_broken_initialization(api):
    game, match, _ = game_match(api)
    game = replace(game, server_code='throw new Error("cannot initialize");')
    with pytest.raises(PlatformError):
        api.platform._has_logic_function(game, match, "playerLeft")
    row = pending(api)["items"][0]
    assert row["function"] == "playerLeft"
    assert row["kind"] == "initialization"


def test_review_is_durable_idempotent_and_omitted_from_later_pending_pages(api):
    game, match, alice = game_match(api)
    for _ in range(3):
        with pytest.raises(PlatformError):
            api.platform._call_logic(broken_game(game), match, "applyMove", match.state, alice, {})
    first = pending(api, limit=1)
    assert len(first["items"]) == 1 and first["next_cursor"]
    next_page = pending(api, limit=1, cursor=first["next_cursor"])
    assert next_page["items"][0]["id"] != first["items"][0]["id"]
    assert api.client.get("/game-server-bugs", auth=AUTH,
        params={"examined": True, "cursor": first["next_cursor"]}).status_code == 400
    bug_id = first["items"][0]["id"]
    url = f"/game-server-bugs/{bug_id}/examine"
    review = {"outcome": "escalated", "notes": "A rules-compliant fix needs an owner decision."}
    assert api.client.post(url, auth=AUTH, json={**review, "notes": " "}).status_code == 422
    reviewed = api.client.post(url, auth=AUTH, json=review)
    assert reviewed.status_code == 200, reviewed.text
    assert reviewed.json()["examined"] and reviewed.json()["examined_at"]
    assert api.client.post(url, auth=AUTH, json=review).status_code == 200
    assert api.client.post(url, auth=AUTH, json={**review, "notes": "other"}).status_code == 409
    assert bug_id not in {row["id"] for row in pending(api)["items"]}
    assert pending(api, examined=True)["items"][0]["id"] == bug_id
    assert api.client.get(f"/game-server-bugs/{bug_id}", auth=AUTH).json()["evidence"]


def test_fixed_review_requires_a_published_existing_version(api):
    game, match, alice = game_match(api)
    with pytest.raises(PlatformError):
        api.platform._call_logic(broken_game(game), match, "applyMove", match.state, alice, {})
    bug_id = pending(api)["items"][0]["id"]
    url = f"/game-server-bugs/{bug_id}/examine"
    review = {"outcome": "fixed", "notes": "Verified the captured call against publication."}
    assert api.client.post(url, auth=AUTH, json=review).status_code == 422
    assert api.client.post(url, auth=AUTH, json={**review, "fix_game_version": 999}).status_code == 422
    assert api.client.post(url, auth=AUTH, json={**review, "fix_game_version": game.version}).status_code == 422
    assert not api.platform._store.get_game_server_bug(bug_id)["examined"]
    fixed = replace(game, version=game.version + 1)
    api.platform._store.add_game_version(fixed)
    result = api.client.post(url, auth=AUTH, json={**review, "fix_game_version": fixed.version})
    assert result.status_code == 200, result.text
    api.platform._store.set_game_published(game.id, False)
    assert api.client.post(url, auth=AUTH, json={**review, "fix_game_version": fixed.version}).status_code == 200
