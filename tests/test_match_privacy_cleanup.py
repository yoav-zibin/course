"""Retired match flags are scrubbed without changing play or unrelated data."""

import copy
import datetime as dt
import json
import os
import uuid

import pytest
from google.cloud import firestore
from google.cloud.firestore_v1._helpers import decode_dict
from google.cloud.firestore_v1.types import Document
from google.protobuf.json_format import ParseDict

from game_platform import match_privacy_cleanup as maintenance
from game_platform import platform_game_cleanup as durable
from game_platform.tests.fake_firestore import query_store


def legacy(store, identity, private):
    ref = store.collection("matches").document(identity)
    row = {"private": private, "revision": 9, "move_count": 1,
           "participants": ["alice", "bob"], "visible_to": ["alice"],
           "unknown_metadata": b"retained",
           "timestamp": dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc),
           "json": json.dumps({"id": identity, "private": private,
                               "hidden_for_user_ids": ["bob"],
                               "state": {"private": "game field", "cards": [1, 2]},
                               "unknown": {"private": True}})}
    ref.set(row)
    ref.collection("moves").document("000000000000").set(
        {"json": json.dumps({"new_state": {"private": "player state"}})})
    return ref, row


def finish(store, directory, **kwargs):
    for _ in range(20):
        result = maintenance.cleanup(store, directory, page_size=1,
                                     max_documents=1, **kwargs)
        if result["complete"]:
            return result
    raise AssertionError("Cleanup did not finish")


def test_removes_true_and_false_flags_with_bounded_resume_and_typed_backup(tmp_path):
    store = query_store("public_cleanup")
    try:
        originals = [legacy(store, "old-private", True), legacy(store, "old-public", False)]
        tombstone = store.collection("matches").document("tombstone")
        tombstone.set({"tombstone": True, "private": True})
        for path in ["public_cleanup_games/g", "public_cleanup_invites/i", "other_matches/m"]:
            store.client.docs[path] = {"private": "unrelated"}
        before = copy.deepcopy(store.client.docs)
        directory = tmp_path / "apply"
        first = maintenance.cleanup(store, directory, apply=True,
                                    page_size=1, max_documents=1)
        assert not first["complete"] and first["processed_this_pass"] == 1
        result = finish(store, directory, apply=True)
        assert result["counts"]["matches"] == {"scanned": 3, "legacy": 3, "updated": 3}
        for ref, row in originals:
            after = ref.get().to_dict()
            expected = copy.deepcopy(row);expected.pop("private")
            payload = json.loads(expected.pop("json"));payload.pop("private")
            assert {k: v for k, v in after.items() if k != "json"} == expected
            assert json.loads(after["json"]) == payload
        parents = {ref.path for ref, _ in originals} | {tombstone.path}
        assert {p: v for p, v in store.client.docs.items() if p not in parents} == {
            p: v for p, v in before.items() if p not in parents}
        backups = [json.loads(path.read_text()) for path in (directory / "preimages").glob("*.json")]
        assert len(backups) == 3
        for backup in backups:
            document = Document()
            ParseDict({"fields": backup["fields"]}, document._pb)
            assert decode_dict(document.fields, store.client) == before[backup["path"]]
            assert backup["after_sha256"] == durable.digest(store.client.docs[backup["path"]])
        writes = store.client.writes
        verified = finish(store, tmp_path / "fresh-verification", apply=True)
        assert verified["counts"]["matches"] == {"scanned": 3, "legacy": 0, "updated": 0}
        assert store.client.writes == writes
    finally:
        store.close()


def test_dry_run_preserves_all_data_and_checkpoint_is_bound_to_policy(tmp_path):
    store = query_store("public_audit")
    try:
        legacy(store, "legacy", True)
        before = copy.deepcopy(store.client.docs)
        writes = store.client.writes
        result = finish(store, tmp_path / "audit")
        assert result["counts"]["matches"] == {"scanned": 1, "legacy": 1, "updated": 0}
        assert store.client.docs == before and store.client.writes == writes
        assert not (tmp_path / "audit/preimages").exists()
        with pytest.raises(ValueError, match="different source or mode"):
            maintenance.cleanup(store, tmp_path / "audit", apply=True)
        with pytest.raises(ValueError, match="different source or mode"):
            durable.cleanup(store, tmp_path / "audit")
    finally:
        store.close()


def test_transaction_reread_retains_move_after_listing(tmp_path, monkeypatch):
    store = query_store("public_concurrent")
    try:
        ref, row = legacy(store, "legacy", True)
        query = store._run_query
        edited = False
        def list_then_edit(*args, **kwargs):
            nonlocal edited
            docs = query(*args, **kwargs)
            if docs and not edited:
                edited = True
                payload = json.loads(row["json"])
                payload["state"]["cards"] = [3, 4]
                ref.set({**row, "revision": 10, "json": json.dumps(payload)})
            return docs
        monkeypatch.setattr(store, "_run_query", list_then_edit)
        finish(store, tmp_path / "apply", apply=True)
        after = ref.get().to_dict()
        assert after["revision"] == 10
        assert json.loads(after["json"])["state"]["cards"] == [3, 4]
        assert "private" not in after
    finally:
        store.close()


@pytest.mark.parametrize("payload", ["sensitive invalid JSON", "[]"])
def test_malformed_payload_aborts_without_erasing_flag(tmp_path, payload):
    store = query_store("public_invalid")
    try:
        ref = store.collection("matches").document("malformed")
        row = {"private": True, "json": payload};ref.set(row)
        with pytest.raises(ValueError):
            maintenance.cleanup(store, tmp_path / "apply", apply=True)
        assert ref.get().to_dict() == row
        assert not (tmp_path / "apply/preimages").exists()
    finally:
        store.close()


@pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"),
                    reason="requires Firestore emulator")
def test_real_firestore_scrub_preserves_typed_header_and_move_children(tmp_path):
    from game_platform.query_store import QueryStore

    assert os.environ["FIRESTORE_EMULATOR_HOST"].startswith(("127.0.0.1:", "localhost:"))
    client = firestore.Client(project="demo-game-platform")
    store = QueryStore.initialize(client, namespace="privacy_" + uuid.uuid4().hex)
    try:
        ref, before = legacy(store, "legacy", True)
        child = ref.collection("moves").document("000000000000")
        move = child.get().to_dict()
        result = finish(store, tmp_path / "apply", apply=True)
        assert result["counts"]["matches"]["updated"] == 1
        after = ref.get().to_dict()
        assert "private" not in after and "private" not in json.loads(after["json"])
        for field in ("timestamp", "unknown_metadata", "revision", "visible_to", "move_count"):
            assert after[field] == before[field]
        assert child.get().to_dict() == move
        backup, = (tmp_path / "apply/preimages").glob("*.json")
        assert json.loads(backup.read_text())["after_sha256"] == durable.digest(after)
        verification = finish(store, tmp_path / "verification")
        assert verification["counts"]["matches"]["legacy"] == 0
    finally:
        store.close()
        client.close()
