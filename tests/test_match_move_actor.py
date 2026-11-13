"""Public move actors come from accepted history, without private move data."""

from dataclasses import replace
from unittest.mock import patch

import pytest

from game_platform.move_history import MoveHistory, last_move_player_index
from game_platform.query_store import QueryStore
from game_platform.scaling_service import ScalablePlatform
from game_platform.schemas import MatchOut, MatchSummaryOut
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api
from game_platform.tests.test_server_matches import COUNTER_GAME, _create_game, _move, _start


@pytest.fixture(params=[False, True], ids=["memory", "query"])
def actor_api(request):
    api = Api(store=query_store("move-actors") if request.param else None)
    if request.param:
        api.platform = ScalablePlatform(store=api.platform._store, computer_move_delay_seconds=0)
        api.client.app.state.platform = api.platform
    return api


def test_move_actor_is_null_before_a_move_and_independent_of_the_next_turn(actor_api):
    api = actor_api
    alice, bob = api.new_user("alice"), api.new_user("bob")
    same_turn = COUNTER_GAME.replace("turn: over ? null : [next]", "turn: over ? null : [playerId]")
    game = _create_game(api, alice, same_turn)
    created = api.ok("POST", "/matches", as_user=alice, json={"game_id": game})
    assert created["last_move_player_index"] is None
    api.ok("POST", f"/matches/{created['id']}/join", as_user=bob)
    started = api.ok("POST", f"/matches/{created['id']}/start", as_user=alice)
    assert started["last_move_player_index"] is None
    moved = api.ok("POST", f"/matches/{created['id']}/moves", as_user=alice,
                   json={"move": {"add": 1, "private_choice": "hidden"}})
    assert moved["last_move_player_index"] == 0
    assert moved["turn_of_player_indices"] == [0]
    for viewer in (alice, bob, None):
        view = api.ok("GET", f"/matches/{created['id']}", as_user=viewer)
        assert view["last_move_player_index"] == 0
        assert "private_choice" not in view and "secrets" not in view["state"]
        assert view["game_version"] == 1
    assert _move(api, created["id"], as_user=alice, add=100).status_code == 400
    assert api.ok("GET", f"/matches/{created['id']}", as_user=alice)["last_move_player_index"] == 0


def test_move_actor_includes_opponent_and_terminal_moves(actor_api):
    api = actor_api
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match = _start(api, alice, _create_game(api, alice), joiner=bob)
    for user, add, actor in [(alice, 3, 0), (bob, 3, 1), (alice, 3, 0), (bob, 1, 1)]:
        response = _move(api, match, as_user=user, add=add)
        assert response.status_code == 201, response.text
        assert response.json()["last_move_player_index"] == actor
    result = api.ok("GET", f"/matches/{match}", as_user=alice)
    assert result["status"] == "over" and result["turn_of_player_indices"] is None
    assert result["last_move_player_index"] == 1


def test_computer_actor_uses_its_seat_instead_of_the_requesting_human(api):
    alice = api.new_user("alice")
    match = _start(api, alice, _create_game(api, alice), num_computer_opponents=1)
    result = _move(api, match, as_user=alice, add=1).json()
    assert result["move_count"] == 2
    assert result["last_move_player_index"] == 1
    assert result["turn_of_player_indices"] == [0]
    assert api.platform._store.get_match(match).moves[-1].player_id == "computer-1"


def test_query_store_caches_actor_and_preserves_it_on_metadata_only_updates():
    api = Api(store=query_store("persisted-move-actor"))
    api.platform = ScalablePlatform(store=api.platform._store, computer_move_delay_seconds=0)
    api.client.app.state.platform = api.platform
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match_id = _start(api, alice, _create_game(api, alice), joiner=bob)
    assert _move(api, match_id, as_user=alice, add=1).status_code == 201
    store = api.platform._store
    assert store.raw_get(store.ref("matches", match_id))["last_move_player_index"] == 0
    restarted = QueryStore(store.client, namespace=store.namespace)
    try:
        with patch.object(restarted, "_read_moves", side_effect=AssertionError("history was read")):
            match = restarted.get_match(match_id)
            assert MatchOut.of(match).last_move_player_index == 0
            restarted.put_match(replace(match, private=True))
            assert MatchOut.of(restarted.get_match(match_id)).last_move_player_index == 0
        # An appended move updates the same authoritative metadata.
        assert _move(api, match_id, as_user=bob, add=1).status_code == 201
        assert store.raw_get(store.ref("matches", match_id))["last_move_player_index"] == 1
    finally:
        restarted.close()


def test_legacy_actor_fallback_reads_only_the_last_move_and_lists_do_not_read_history(api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match_id = _start(api, alice, _create_game(api, alice), joiner=bob)
    assert _move(api, match_id, as_user=alice, add=1).status_code == 201
    match = api.platform._store.get_match(match_id)
    last = replace(match.moves[-1], player_index=1)
    reads = []
    history = MoveHistory(1_000_000, lambda start, stop: reads.append((start, stop)) or [last])
    legacy = replace(match, moves=history)
    summary = MatchSummaryOut.of(legacy)
    assert summary.move_count == 1_000_000 and reads == []
    assert "last_move_player_index" not in summary.model_dump()
    assert MatchOut.of(legacy).last_move_player_index == 1
    assert MatchOut.of(legacy).last_move_player_index == 1
    assert reads == [(999_999, 1_000_000)]
    # Cached persisted metadata and a freshly appended move need no history reads.
    cached = MoveHistory(1_000_000, lambda *_: pytest.fail("history was read"), last_move_player_index=1)
    assert last_move_player_index(cached) == 1
    assert last_move_player_index(cached.append(match.moves[-1])) == 0
    assert last_move_player_index(()) is None
