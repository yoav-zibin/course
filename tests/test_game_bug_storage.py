"""Reproductions remain exact, private and durable after a match rolls back."""

import copy
import os
import uuid

import pytest

from game_platform.json_file_store import JsonFileStore
from game_platform.store import InMemoryStore
from game_platform.tests.fake_firestore import query_store


def bug(bug_id="failure-1", **changes):
    return {
        "id": bug_id,
        "game_id": "example-game",
        "game_version": 3,
        "function": "computerMove",
        "kind": "timeout",
        "message": "function exceeded its time limit",
        "created_at": "2026-11-18T09:00:00+00:00",
        "examined": False,
        "evidence": {
            "args": [{"board": [1, None, 2]}, "player-1"],
            "seed": 2**255 + 7,
            "limit_seconds": 0.1,
            "elapsed_seconds": 0.102,
        },
        **changes,
    }


REVIEW = {
    "outcome": "fixed",
    "notes": "Replaced repeated scans; the recorded call and game rules pass.",
    "fix_game_version": 4,
    "fix_commit": "123abc",
    "examined_at": "2026-11-19T09:00:00+00:00",
}


@pytest.fixture(params=["memory", "json", "query", "emulator"])
def storage(request, tmp_path):
    if request.param == "memory":
        store = InMemoryStore()
    elif request.param == "json":
        store = JsonFileStore(tmp_path / "data.json")
    elif request.param == "query":
        store = query_store("bugs")
    else:
        endpoint = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
        if not endpoint:
            pytest.skip("requires Firestore emulator")
        assert endpoint.startswith(("127.0.0.1:", "localhost:"))
        from google.cloud import firestore
        from game_platform.query_store import QueryStore
        store = QueryStore.initialize(
            firestore.Client(project="demo-game-platform"),
            namespace="bugs_" + uuid.uuid4().hex,
        )
    yield store
    if hasattr(store, "close"):
        store.close()


def test_reproduction_and_review_round_trip_without_mutable_aliases(storage):
    row = bug()
    expected = copy.deepcopy(row)
    storage.put_game_server_bug(row)
    row["evidence"]["args"][0]["board"].append("changed later")
    assert storage.get_game_server_bug(expected["id"]) == expected
    restored = storage.get_game_server_bug(expected["id"])
    restored["evidence"]["args"].clear()
    assert storage.get_game_server_bug(expected["id"]) == expected

    examined = storage.examine_game_server_bug(expected["id"], REVIEW)
    assert examined == {**expected, "examined": True,
                        "examined_at": REVIEW["examined_at"], "review": REVIEW}
    assert storage.examine_game_server_bug(expected["id"], REVIEW) == examined
    with pytest.raises(ValueError, match="already examined"):
        storage.examine_game_server_bug(expected["id"], {**REVIEW, "notes": "different"})
    assert storage.get_game_server_bug(expected["id"]) == examined
    assert storage.get_game_server_bug("missing") is None
    assert storage.examine_game_server_bug("missing", REVIEW) is None


def test_pending_pages_are_bounded_and_exclude_evidence_and_examined_rows(storage):
    for index in range(7):
        storage.put_game_server_bug(bug(f"failure-{index}"))
    storage.examine_game_server_bug("failure-2", REVIEW)
    storage.examine_game_server_bug("failure-5", REVIEW)
    rows, cursor = [], None
    while True:
        page, cursor = storage.list_game_server_bugs(examined=False, limit=2, after=cursor)
        assert len(page) <= 2
        assert all("evidence" not in row for row in page)
        assert all(not key.startswith("__bug_payload_") for row in page for key in row)
        rows.extend(page)
        if cursor is None:
            break
    assert len(rows) == 5
    assert {row["id"] for row in rows} == {
        "failure-0", "failure-1", "failure-3", "failure-4", "failure-6"
    }
    completed, cursor = storage.list_game_server_bugs(examined=True, limit=100)
    assert {row["id"] for row in completed} == {"failure-2", "failure-5"}
    assert cursor is None
    all_rows, _ = storage.list_game_server_bugs(examined=None, limit=100)
    assert len(all_rows) == 7
    for limit in (0, 101):
        with pytest.raises(ValueError, match="limit"):
            storage.list_game_server_bugs(examined=None, limit=limit)


def test_examination_timestamp_is_added_once_for_retried_http_review(storage):
    storage.put_game_server_bug(bug())
    review = {key: value for key, value in REVIEW.items() if key != "examined_at"}
    result = storage.examine_game_server_bug("failure-1", review)
    assert result["examined_at"]
    assert result["examined_at"].endswith("+00:00")
    assert result["review"] == review
    assert storage.examine_game_server_bug("failure-1", review) == result


def test_large_unicode_evidence_and_256_bit_seed_fit_firestore_documents(storage):
    row = bug()
    row["evidence"]["source"] = "🙂 quoted: \"\n" * 110_000
    row["evidence"]["args"][0]["board"] = list(range(10_000))
    storage.put_game_server_bug(row)
    assert storage.get_game_server_bug(row["id"]) == row
    if hasattr(storage, "client") and hasattr(storage.client, "docs"):
        import json
        assert all(len(json.dumps(data).encode()) < 1_000_000
                   for data in storage.client.docs.values())
        assert all("seed" not in data for data in storage.client.docs.values())


def test_query_bug_survives_failed_match_transaction_and_new_store_instance():
    store = query_store("bugs")
    row = bug()
    try:
        with pytest.raises(RuntimeError, match="game failed"):
            with store.atomic():
                store.raw_put(store.ref("matches", "uncommitted"), {"state": "bad"})
                store.put_game_server_bug(row)
                raise RuntimeError("game failed")
        restarted = query_store("bugs", store.client)
        try:
            assert restarted.get_game_server_bug(row["id"]) == row
            assert restarted.raw_get(restarted.ref("matches", "uncommitted")) is None
        finally:
            restarted.close()
    finally:
        store.close()


def test_review_uses_current_transactional_state_when_peer_has_examined_bug():
    store = query_store("bugs")
    peer = query_store("bugs", store.client)
    try:
        store.put_game_server_bug(bug())
        store.raw_get(store.ref("game_server_bugs", "failure-1"))
        peer.examine_game_server_bug("failure-1", REVIEW)
        with pytest.raises(ValueError, match="already examined"):
            store.examine_game_server_bug("failure-1", {**REVIEW, "outcome": "escalated"})
    finally:
        store.close()
        peer.close()


def test_json_bug_and_terminal_review_survive_restart(tmp_path):
    path = tmp_path / "data.json"
    store = JsonFileStore(path)
    store.put_game_server_bug(bug())
    expected = store.examine_game_server_bug("failure-1", REVIEW)
    store.close()
    restarted = JsonFileStore(path)
    try:
        assert restarted.get_game_server_bug("failure-1") == expected
        assert restarted.list_game_server_bugs(examined=False, limit=100) == ([], None)
    finally:
        restarted.close()


def test_memory_snapshot_copies_game_bug_evidence():
    store = InMemoryStore()
    expected = bug()
    store.put_game_server_bug(expected)
    snapshot = store.snapshot()
    restored = InMemoryStore.of_snapshot(snapshot)
    snapshot.game_server_bugs[0]["evidence"]["args"].clear()
    assert store.get_game_server_bug(expected["id"]) == expected
    assert restored.get_game_server_bug(expected["id"]) == expected


def test_incomplete_evidence_is_never_returned_as_a_valid_reproduction():
    store = query_store("bugs")
    try:
        store.put_game_server_bug(bug())
        chunk_path = next(path for path in store.client.docs if "/evidence/" in path)
        store.client.docs[chunk_path]["text"] = "corrupted"
        with pytest.raises(ValueError, match="checksum mismatch"):
            store.get_game_server_bug("failure-1")
        with pytest.raises(ValueError, match="checksum mismatch"):
            store.examine_game_server_bug("failure-1", REVIEW)
        assert store._read_doc(store.ref("game_server_bugs", "failure-1"))["examined"] is False
        del store.client.docs[chunk_path]
        with pytest.raises(ValueError, match="incomplete"):
            store.get_game_server_bug("failure-1")
    finally:
        store.close()


def test_only_bug_queue_filter_is_indexed_and_evidence_chunks_are_unindexed():
    from game_platform.scaling_indexes import index_config

    overrides = index_config("bugs")["fieldOverrides"]
    queue_fields = [entry for entry in overrides
                    if entry["collectionGroup"] == "bugs_game_server_bugs"]
    assert {entry["fieldPath"] for entry in queue_fields} == {"*", "examined"}
    assert next(entry for entry in queue_fields if entry["fieldPath"] == "*")["indexes"] == []
    assert {"collectionGroup": "evidence", "fieldPath": "*", "indexes": []} in overrides


def test_real_query_bug_survives_rollback(storage):
    if not getattr(storage, "scalable", False):
        pytest.skip("requires query storage")
    with pytest.raises(RuntimeError):
        with storage.atomic():
            storage.put_game_server_bug(bug())
            storage.raw_put(storage.ref("matches", "uncommitted"), {"bad": True})
            raise RuntimeError("failed match")
    assert storage.get_game_server_bug("failure-1") == bug()
    assert storage.raw_get(storage.ref("matches", "uncommitted")) is None
