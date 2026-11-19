"""Legacy match/outbox associations are filled without rewriting content."""

import json
import pytest

from game_platform.account_deletion_backfill import backfill_account_deletion_metadata
from game_platform.query_store import QueryStore
from game_platform.tests.fake_firestore import FakeClient, query_store


def finish(store):
    for _ in range(100):
        result = backfill_account_deletion_metadata(store, max_steps=2)
        if result["complete"]:
            return
    raise AssertionError("metadata backfill did not finish")


def test_backfill_resumes_large_legacy_history_without_changing_gameplay_or_users():
    client = FakeClient()
    store = query_store("deletion_backfill", client)
    try:
        ref = store.ref("matches", "legacy-match")
        original = {"json": json.dumps({"id": "legacy-match", "owner_user_id": "owner",
                      "seats": [{"user_id": "current-player"}],
                      "hidden_for_user_ids": ["hidden-player"],
                      "timeouts": [{"user_id": "timed-out-player"}]}),
                    "revision": 9, "participants": ["owner", "current-player"],
                    "move_count": 205}
        ref.set(original)
        for i in range(205):
            ref.collection("moves").document(f"{i:012}").set({
                "json": json.dumps({"made_by_user_id": f"former-player-{i}"})})
        before_moves = {p: value.copy() for p, value in client.docs.items() if "/moves/" in p}
        assert backfill_account_deletion_metadata(store, max_steps=1) == {"complete": False, "processed": 1}
        assert "former-player-99" in ref.get().to_dict()["historical_participants"]
        # A different process resumes from the durable move-chunk checkpoint.
        reopened = QueryStore(client, namespace=store.namespace)
        try:
            finish(reopened)
        finally:
            reopened.close()
        after = ref.get().to_dict()
        assert after["json"] == original["json"] and after["revision"] == 9 and after["move_count"] == 205
        assert set(after["historical_participants"]) == {
            "owner", "current-player", "hidden-player", "timed-out-player",
            *(f"former-player-{i}" for i in range(205)),
        }
        assert before_moves == {p: value for p, value in client.docs.items() if "/moves/" in p}
        assert not any("_users/" in p or "_counters/" in p for p in client.read_paths)
        writes = client.writes
        assert backfill_account_deletion_metadata(store) == {"complete": True, "processed": 0}
        assert client.writes == writes
    finally:
        store.close()


@pytest.mark.parametrize("url", ["/portal?match=old-match",
    "/static/portal.html#match=old-match", "/portal#rematch=old-match", "/portal#replay=old-match"])
def test_legacy_outbox_is_queryable_by_user_and_match_without_changing_message(url):
    store = query_store("deletion_outbox_backfill")
    try:
        ref = store.ref("outbox", "queued-message")
        payload = json.dumps({"subscription": {"user_id": "recipient", "endpoint": "private-endpoint"},
                              "url": url, "body": "Original notification"})
        ref.set({"json": payload, "attempts": 2})
        finish(store)
        row = ref.get().to_dict()
        assert row["user_id"] == "recipient" and row["match_id"] == "old-match"
        assert row["json"] == payload and row["attempts"] == 2
    finally:
        store.close()


def test_tombstoned_match_children_remain_discoverable_for_physical_purge():
    store = query_store("deletion_tombstone_backfill")
    try:
        ref = store.ref("matches", "already-hidden")
        ref.set({"tombstone": True})
        ref.collection("moves").document("000000000000").set({"json": json.dumps({"made_by_user_id": "past-player"})})
        finish(store)
        assert ref.get().to_dict()["historical_participants"] == ["past-player"]
        assert ref.get().to_dict()["tombstone"] is True
    finally:
        store.close()
