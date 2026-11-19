"""HTML retirement preserves migration source and removes pinned match data."""

import datetime as dt
import json
import os
import uuid
from dataclasses import replace
from unittest.mock import patch

import pytest

from game_platform.legacy_games import retire_html_matches
from game_platform.models import Game, GameRules, Invite, Match, Move, Seat, User
from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore


def populated_store(store):
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    for name in ("alice", "bob"):
        store.put_user(User(id=name, display_name=name, password=name,
                            token_balance=4, created_at=now, updated_at=now))
    html = Game(id="migrating-game", version=1,  name="Old game",
                description="", rules=GameRules(allowed_player_counts=(2,),
                allows_leave_mid_match=True, allows_join_mid_match=False),
                code="<html>legacy migration source</html>", server_code="retired rules",
                game_schemas={"state": True, "move": True, "view": True},
                import_package={"unit_tests": {"cases": []}}, created_at=now, updated_at=now)
    store.add_game_version(html)
    # Same ID already migrated: decisions must use a match's pinned version.
    store.add_game_version(replace(html, version=2, code="",
                           import_package={"declarative_ui": {}}))
    seats = tuple(Seat(player_index=i, kind="human", user_id=name)
                  for i, name in enumerate(("alice", "bob")))
    move = Move(move_number=1, player_index=0, made_by_user_id="alice", created_at=now,
                new_state={"legacy": "secret"}, next_turn_player_indices=frozenset({1}))
    old = Match(id="old-match", game_id=html.id, owner_user_id="alice", game_version=1,
                status="ongoing", seats=seats, state={"legacy": "secret"},
                turn_of_player_indices=frozenset({1}), end_reason=None, moves=(move,) * 205,
                hidden_for_user_ids=frozenset(), token_pot=12, bet_per_player=6,
                created_at=now, updated_at=now)
    store.put_match(old)
    current = replace(old, id="current-match", game_version=2, moves=(), token_pot=0)
    store.put_match(current)
    store.put_invite(Invite(token="old-invite", match_id=old.id, created_by_user_id="alice", created_at=now))
    store.put_invite(Invite(token="current-invite", match_id=current.id, created_by_user_id="alice", created_at=now))
    return html, old, current


def test_memory_retirement_refunds_once_and_preserves_games():
    store = InMemoryStore()
    html, old, current = populated_store(store)
    platform = GamePlatform(store=store)
    with patch.object(platform, "_logic_for", side_effect=AssertionError("retired rules executed")):
        assert retire_html_matches(platform) == {"complete": True, "matches_deleted": 1}
        assert retire_html_matches(platform)["matches_deleted"] == 0
    assert store.get_match(old.id) is None
    assert store.get_match(current.id) is not None
    assert store.get_invite("old-invite") is None
    assert store.get_invite("current-invite") is not None
    assert store.get_game_version(html.id, 1) == html
    assert [store.get_user(name).token_balance for name in ("alice", "bob")] == [10, 10]


@pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="requires Firestore emulator")
def test_query_retirement_resumes_and_physically_removes_children_and_related_data():
    from google.cloud import firestore
    from game_platform.query_store import QueryStore
    from game_platform.scaling_service import ScalablePlatform
    from game_platform.observability import Monitor, TimedStore

    assert os.environ["FIRESTORE_EMULATOR_HOST"].startswith(("127.0.0.1:", "localhost:"))
    store = QueryStore.initialize(firestore.Client(project="demo-game-platform"),
                                  namespace="retire_" + uuid.uuid4().hex)
    html, old, current = populated_store(store)
    orphan_id = "unrelated-declarative-deletion-orphan"
    store.put_invite(Invite(token="unrelated-orphan", match_id=orphan_id,
                           created_by_user_id="alice", created_at=html.created_at))
    for kind in ("jobs", "failed_jobs", "matchmaking", "requests"):
        # More than one page exercises the bounded, resumable ancillary cleanup.
        for index in range(101):
            store.raw_put(store.ref(kind, f"old-{index}"), {"match_id": old.id})
        store.raw_put(store.ref(kind, "current"), {"match_id": current.id})
        store.raw_put(store.ref(kind, "unrelated-orphan"), {"match_id": orphan_id})
    store.raw_put(store.ref("outbox", "unrelated-orphan"),
                  {"json": json.dumps({"url": "/static/portal.html#match=" + orphan_id})})
    store.raw_put(store.ref("outbox", "old"),
                  {"json": json.dumps({"url": f"/static/portal.html#match={old.id}"})})
    store.raw_put(store.ref("outbox", "current"),
                  {"json": json.dumps({"url": f"/static/portal.html#match={current.id}"})})
    counts_before = store.counts()
    # Production wraps the QueryStore in TimedStore, including its private
    # metadata readers and the thread-local transaction state.
    platform = ScalablePlatform(store=TimedStore(store, Monitor()))
    while True:
        job = retire_html_matches(platform, max_steps=1)
        if job["stage"] == "moves":
            break
    assert [store.get_user(name).token_balance for name in ("alice", "bob")] == [10, 10]
    assert store.get_match(old.id) is None
    # Association-only metadata stays discoverable until child cleanup finishes;
    # a later account purge must still find the already-hidden move history.
    assert store.ref("matches", old.id).get().to_dict() == {
        "tombstone": True, "id": old.id, "owner_user_id": "alice",
        "participants": ["alice", "bob"],
        "historical_participants": ["alice", "bob"],
        "deletion_metadata_version": 1,
    }
    # Restart with fresh caches after refund, before deleting all 205 child moves.
    restarted = QueryStore(store.client, namespace=store.namespace)
    platform = ScalablePlatform(store=TimedStore(restarted, Monitor()))
    with patch.object(platform, "_logic_for", side_effect=AssertionError("retired rules executed")):
        assert retire_html_matches(platform)["complete"]
        assert retire_html_matches(platform)["matches_deleted"] == 1
    assert not restarted.ref("matches", old.id).get().exists
    assert not list(restarted.ref("matches", old.id).collection("moves").limit(1).stream())
    assert not list(restarted.collection("cleanup").limit(1).stream())
    for kind in ("invites", "jobs", "failed_jobs", "matchmaking", "requests", "outbox"):
        rows = list(restarted.collection(kind).stream())
        assert len(rows) == 2, kind  # Current match and unrelated preexisting orphan.
    from game_platform.legacy_games import RUN_ID
    assert not list(restarted.ref("migration", RUN_ID).collection("matches").stream())
    assert restarted.get_game_version(html.id, 1) == html
    assert restarted.get_match(current.id) is not None
    assert [restarted.get_user(name).token_balance for name in ("alice", "bob")] == [10, 10]
    counts_after = restarted.counts()
    assert counts_after["matches_total"] == counts_before["matches_total"] - 1
    assert counts_after["moves_total"] == counts_before["moves_total"] - len(old.moves)
    assert counts_after["invites_total"] == counts_before["invites_total"] - 1
    assert [item.id for item in restarted.page("matches").items] == [current.id]
    assert store.get_match(old.id) is None  # The deleting instance's cache was invalidated.


@pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="requires Firestore emulator")
def test_query_portal_pages_filter_html_without_losing_cursor_or_reading_source():
    from fastapi.testclient import TestClient
    from google.cloud import firestore
    from game_platform.api import create_app
    from game_platform.query_store import QueryStore
    from game_platform.scaling_service import ScalablePlatform

    assert os.environ["FIRESTORE_EMULATOR_HOST"].startswith(("127.0.0.1:", "localhost:"))
    store = QueryStore.initialize(firestore.Client(project="demo-game-platform"),
                                  namespace="retire_" + uuid.uuid4().hex)
    html, old, current = populated_store(store)
    store.add_game_version(replace(html, id="still-html", version=1))
    platform = ScalablePlatform(store=store)
    client = TestClient(create_app(platform))
    store.clear_cache()
    with patch.object(store, "_read_doc", wraps=store._read_doc) as reads:
        result = []
        cursor = None
        pages = 0
        while True:
            response = client.get("/v2/games", params={"limit": 1, **({"cursor": cursor} if cursor else {})})
            assert response.status_code == 200
            page = response.json()
            pages += 1
            result.extend(page["items"])
            cursor = page["next_cursor"]
            if cursor is None:
                break
        assert pages == 2
        assert [game["id"] for game in result] == [html.id]
        assert all("/body/" not in call.args[0].path for call in reads.call_args_list)
    headers = {"X-User-Id": "alice", "X-User-Password": "alice"}
    user = store.get_user("alice")
    store.put_user(replace(user, saved_game_ids=(html.id, "still-html")))
    for endpoint in ("/v2/builder/games", "/v2/users/me/saved-games"):
        response = client.get(endpoint, headers=headers)
        assert response.status_code == 200
        assert [game["id"] for game in response.json()["items"]] == [html.id]
    with patch.object(platform, "view_state", return_value={}):
        response = client.get("/v2/matches", headers=headers)
        assert response.status_code == 200
        assert [match["id"] for match in response.json()["items"]] == [current.id]
    # Legacy listing uses metadata as well; it can still retrieve stored HTML.
    response = client.get("/legacy/games")
    assert response.status_code == 200
    assert [game["id"] for game in response.json()["items"]] == ["still-html"]
    # A stale matchmaking reservation must not return a retired pinned version
    # after the current game has migrated to declarative presentation.
    store.put_match(replace(old, status="waiting_for_players", token_pot=0))
    store.raw_put(store.ref("matchmaking", json.dumps(["alice", html.id, 2])),
                  {"match_id": old.id})
    replacement = platform.quick_match(caller_id="alice", game_id=html.id)
    assert replacement.id != old.id
    assert replacement.game_version == 2
