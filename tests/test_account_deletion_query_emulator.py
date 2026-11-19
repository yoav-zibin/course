"""Real Firestore transaction tests; only an explicitly local emulator."""
import concurrent.futures
import datetime as dt
import os
import uuid
from dataclasses import replace

import pytest
from google.cloud import firestore

from game_platform.account_deletion import _claim, cancel, run_due_account_deletions
from game_platform.models import Move
from game_platform.query_store import QueryStore
from game_platform.service import AccountDeletionInProgressError, ConflictError, GamePlatform
from game_platform.tests.helpers import Api

pytestmark = pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"), reason="requires Firestore emulator")
NOW = dt.datetime(2026, 11, 19, tzinfo=dt.timezone.utc)


@pytest.fixture
def store():
    assert os.environ["FIRESTORE_EMULATOR_HOST"].startswith(("127.0.0.1:", "localhost:"))
    value = QueryStore.initialize(firestore.Client(project="demo-game-platform"), namespace="deletion_"+uuid.uuid4().hex)
    yield value
    value.close()


def test_atomic_undo_and_claim_cannot_both_win_across_process_stores(store):
    api = Api(store=store)
    api.platform._clock = lambda: NOW
    user = api.new_user("Cancellation race")
    api.ok("POST", "/users/me/deletion-request", as_user=user, json={"confirmed": True})
    due = NOW + dt.timedelta(hours=24)
    cold = QueryStore(store.client, namespace=store.namespace)
    undo_platform = GamePlatform(store=cold, clock=lambda: due-dt.timedelta(microseconds=1))
    def undo():
        try:
            cancel(undo_platform, user)
            return True
        except (ConflictError, AccountDeletionInProgressError):
            return False
    def claim():
        try:
            return _claim(api.platform, store.ref("account_deletions", user), due)
        except ConflictError:
            return False
    try:
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            first, second = pool.submit(undo), pool.submit(claim)
            undone, claimed = first.result(), second.result()
        assert not (undone and claimed)
        with store.atomic():
            persisted = store.get_user(user)
            if undone:
                assert persisted.deletion_started_at is None and persisted.deletion_scheduled_at is None
            if claimed:
                assert persisted.deletion_started_at is not None
    finally:
        cold.close()


def test_resumed_purge_physically_removes_large_move_subcollection(store):
    api = Api(store=store)
    api.platform._clock = lambda: NOW
    target, other = api.new_user("Erase"), api.new_user("Keep")
    game = api.new_game(owner=other)
    match = api.new_match(owner=other, game_id=game, joiners=[target])
    template = store.get_match(match)
    moves = tuple(Move(move_number=i+1, player_index=0, made_by_user_id=target,
        created_at=NOW, new_state={}, next_turn_player_indices=None) for i in range(215))
    store.put_match(replace(template, moves=moves))
    api.ok("POST", "/users/me/deletion-request", as_user=target, json={"confirmed": True})
    due = NOW+dt.timedelta(hours=24)
    cold = QueryStore(store.client, namespace=store.namespace)
    restarted = GamePlatform(store=cold, clock=lambda: due)
    try:
        for _ in range(100):
            result = run_due_account_deletions(restarted, now=due, max_steps=5)
            if not result["more_work_may_remain"]:
                break
        else:
            raise AssertionError("purge did not finish")
        assert not cold.ref("matches", match).get().exists
        assert not list(cold.ref("matches", match).collection("moves").limit(1).stream())
        assert cold.get_user(target) is None and cold.get_user(other) is not None
        assert cold.get_game(game) is not None
    finally:
        cold.close()
