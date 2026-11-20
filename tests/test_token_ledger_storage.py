"""Permanent token rows and their transactional, retryable materialization."""
import datetime as dt
import os
import time
import uuid
from dataclasses import replace
from unittest.mock import patch

import pytest

from game_platform.json_file_store import JsonFileStore
from game_platform.models import TokenMovement, User
from game_platform.query_store import QueryStore
from game_platform.scaling_service import ScalablePlatform
from game_platform.store import InMemoryStore
from game_platform.tests.fake_firestore import query_store

NOW = dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc)


def movement(identity="movement", **changes):
    return replace(TokenMovement(id=identity, user_id="user", amount=-3,
        balance_before=10, reason="started_match", match_id="match", created_at=NOW), **changes)


@pytest.fixture(params=["memory", "json", "fake-query", "emulator"])
def ledger_store(request, tmp_path):
    if request.param == "memory":
        store = InMemoryStore()
    elif request.param == "json":
        store = JsonFileStore(tmp_path / "ledger.json", min_write_interval_seconds=0)
    elif request.param == "fake-query":
        store = query_store("ledger_" + uuid.uuid4().hex)
    else:
        host = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
        if not host:
            pytest.skip("requires Firestore emulator")
        assert host.startswith(("127.0.0.1:", "localhost:"))
        from google.cloud import firestore
        store = QueryStore.initialize(firestore.Client(project="demo-game-platform"),
                                      namespace="ledger_" + uuid.uuid4().hex)
    yield store
    if hasattr(store, "close"):
        store.close()


def flush(store):
    if getattr(store, "scalable", False):
        return store.flush_token_movements()
    return 0


def test_append_is_immutable_idempotent_and_retained_without_related_accounts(ledger_store):
    store = ledger_store
    user = User(id="user", display_name="User", password="synthetic",
                token_balance=10, created_at=NOW, updated_at=NOW)
    store.put_user(user)
    event = movement()
    store.append_token_movement(event)
    store.append_token_movement(event)
    with pytest.raises(ValueError):
        store.append_token_movement(replace(event, amount=-4))
    if getattr(store, "scalable", False):
        assert store.list_token_movements() == []
    flush(store)
    assert store.list_token_movements() == [event]
    store.append_token_movement(event)
    flush(store)
    assert store.list_token_movements() == [event]
    store.delete_user(user.id)
    store.delete_match("match")
    assert store.list_token_movements() == [event]
    if getattr(store, "scalable", False):
        row = store.ref("token_ledger", event.id)
        before = store.raw_get(row)
        with pytest.raises(ValueError):
            store.raw_put(row, {**before, "amount": -5})
        with pytest.raises(ValueError):
            store.raw_put(row, None)
        assert store.raw_get(row) == before
    else:
        inner = getattr(store, "_inner", store)
        assert InMemoryStore.of_snapshot(inner.snapshot()).list_token_movements() == [event]


def test_json_restart_preserves_ledger_after_user_removal(tmp_path):
    path = tmp_path / "ledger.json"
    store = JsonFileStore(path, min_write_interval_seconds=0)
    event = movement()
    store.append_token_movement(event)
    store.close()
    reopened = JsonFileStore(path)
    try:
        assert reopened.list_token_movements() == [event]
    finally:
        reopened.close()


def test_pending_worker_query_and_ledger_page_fields_remain_indexed():
    from game_platform.scaling_indexes import index_config
    fields = {(row["collectionGroup"], row["fieldPath"]): row["indexes"]
              for row in index_config("ledger")["fieldOverrides"]}
    assert fields[("ledger_token_ledger_pending", "due_at")]
    assert fields[("ledger_token_ledger", "schema_version")]
    assert fields[("ledger_token_ledger", "*")] == []


def test_aborted_balance_transaction_does_not_queue_or_publish_a_movement(ledger_store):
    store = ledger_store
    if not getattr(store, "scalable", False):
        pytest.skip("query transactions only")
    user = User(id="user", display_name="User", password="synthetic",
                token_balance=10, created_at=NOW, updated_at=NOW)
    store.put_user(user)
    with pytest.raises(RuntimeError, match="abort"):
        with store.atomic():
            store.put_user(replace(user, token_balance=7))
            store.append_token_movement(movement())
            raise RuntimeError("abort")
    assert store.get_user(user.id).token_balance == 10
    assert store.raw_get(store.ref("token_ledger_pending", "movement")) is None
    assert store.list_token_movements() == []


def test_failed_materialization_retries_after_restart_and_account_match_fences(ledger_store):
    store = ledger_store
    if not getattr(store, "scalable", False):
        pytest.skip("query background materialization only")
    event = movement()
    store.append_token_movement(event)
    # Purge fences must not suppress committed accounting work.
    store.raw_put(store.ref("account_deletion_fences", "user"), {"deleted": True})
    store.raw_put(store.ref("match_deletion_fences", "match"), {"deleted": True})
    original = store.raw_put
    with patch.object(store, "raw_put", side_effect=lambda ref, data:
            (_ for _ in ()).throw(OSError("temporary ledger failure"))
            if store._kind_for_path(ref.path) == "token_ledger" else original(ref, data)):
        assert store.flush_token_movements() == 0
    pending_ref = store.ref("token_ledger_pending", event.id)
    pending = store.raw_get(pending_ref)
    assert pending["attempts"] == 1
    assert store.list_token_movements() == []
    store.raw_put(pending_ref, {**pending, "due_at": NOW-dt.timedelta(days=1)})
    cold = QueryStore(store.client, namespace=store.namespace)
    try:
        assert cold.flush_token_movements() == 1
        assert cold.flush_token_movements() == 0
        assert cold.list_token_movements() == [event]
        assert cold.raw_get(pending_ref) is None
    finally:
        cold.close()


def test_real_background_worker_drains_ledger_when_push_is_disabled(ledger_store):
    store = ledger_store
    if not isinstance(store, QueryStore) or store.client.project != "demo-game-platform":
        pytest.skip("real emulator worker only")
    platform = ScalablePlatform(store=store)
    platform._delivery = None
    platform.resume_computer_moves()
    try:
        event = movement()
        store.append_token_movement(event)
        until = time.monotonic() + 5
        while not store.list_token_movements() and time.monotonic() < until:
            time.sleep(.05)
        assert store.list_token_movements() == [event]
    finally:
        platform.close_workers()


def test_stale_namespace_cleanup_never_deletes_ledger_or_pending_rows(ledger_store):
    store = ledger_store
    if not getattr(store, "scalable", False):
        pytest.skip("query cleanup only")
    from game_platform.scaling_maintenance import cleanup
    for kind in ("token_ledger", "token_ledger_pending"):
        row = store.ref(kind, "old-target")
        store.raw_put(row, {"tombstone": True})
        marker = store.ref("cleanup", kind + ":old-target")
        store.raw_put(marker, {"kind": kind, "identity": "old-target", "path": row.path})
        assert cleanup(store)["documents_deleted"] == 0
        assert store.raw_get(row) == {"tombstone": True}
        assert store.raw_get(marker) is None
