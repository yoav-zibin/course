"""The explicit attribution scrub preserves content and can recover interruptions."""

import copy
import datetime as dt
import json

import pytest
from google.cloud.firestore_v1._helpers import decode_dict
from google.cloud.firestore_v1.types import Document
from google.protobuf.json_format import ParseDict

from game_platform import platform_game_cleanup as maintenance
from game_platform.tests.fake_firestore import query_store


def legacy(store, kind, identity):
    ref = store.collection(kind).document(identity)
    row = {"owner_user_id": "former-account", "revision": 7,
           "published": False, "deleted": True, "body_chunks": 1,
           "unknown_metadata": b"retained", "timestamp": dt.datetime(2026, 11, 19, tzinfo=dt.timezone.utc),
           "json": json.dumps({"id": identity, "version": 3, "owner_user_id": "former-account",
                               "name": "Original name", "builder_workflow": {"source": "unchanged"},
                               "unknown": {"owner_user_id": "part of game data"}})}
    ref.set(row)
    ref.collection("body").document("000000").set({"text": "exact code and server_code"})
    return ref, row


def finish(store, directory, **kwargs):
    for _ in range(20):
        result = maintenance.cleanup(store, directory, page_size=1, max_documents=1, **kwargs)
        if result["complete"]:
            return result
    raise AssertionError("Cleanup did not finish")


def test_bounded_resume_backup_and_idempotence_preserve_every_unrelated_value(tmp_path):
    store = query_store("ownership_cleanup")
    try:
        originals = [legacy(store, kind, "legacy") for kind in maintenance.KINDS]
        # A tombstone can carry an old header without serialized game data.
        tombstone = store.collection("games").document("tombstone")
        tombstone.set({"tombstone": True, "owner_user_id": "old"})
        for path in ["ownership_cleanup_matches/m", "ownership_cleanup_invites/i", "other_games/g"]:
            store.client.docs[path] = {"owner_user_id": "legitimate or recovery data"}
        before = copy.deepcopy(store.client.docs)
        directory = tmp_path / "apply"
        first = maintenance.cleanup(store, directory, apply=True, page_size=1, max_documents=1)
        assert not first["complete"] and first["processed_this_pass"] == 1
        result = finish(store, directory, apply=True)
        assert result["complete"] and sum(x["updated"] for x in result["counts"].values()) == 5
        for ref, row in originals:
            updated = ref.get().to_dict()
            expected = copy.deepcopy(row);expected.pop("owner_user_id")
            payload = json.loads(expected["json"]);payload.pop("owner_user_id")
            assert {k: v for k, v in updated.items() if k != "json"} == {k: v for k, v in expected.items() if k != "json"}
            assert json.loads(updated["json"]) == payload
        parents = {ref.path for ref, _ in originals} | {tombstone.path}
        assert {p: v for p, v in store.client.docs.items() if p not in parents} == {p: v for p, v in before.items() if p not in parents}
        backups = [json.loads(path.read_text()) for path in (directory / "preimages").glob("*.json")]
        assert len(backups) == 5
        for backup in backups:
            document = Document()
            ParseDict({"fields": backup["fields"]}, document._pb)
            assert decode_dict(document.fields, store.client) == before[backup["path"]]
            assert backup["after_sha256"] == maintenance.digest(store.client.docs[backup["path"]])
        assert directory.stat().st_mode & 0o077 == 0
        assert all(p.stat().st_mode & 0o077 == 0 for p in directory.rglob("*"))
        writes = store.client.writes
        repeated = finish(store, tmp_path / "repeat", apply=True)
        assert sum(x["legacy"] for x in repeated["counts"].values()) == 0
        assert store.client.writes == writes
        assert not (tmp_path / "repeat/preimages").exists()
    finally:
        store.close()


def test_dry_run_never_changes_database_or_downloads_preimages(tmp_path):
    store = query_store("ownership_audit")
    try:
        legacy(store, "games", "legacy")
        before = copy.deepcopy(store.client.docs);writes = store.client.writes
        result = finish(store, tmp_path / "audit")
        assert result["counts"]["games"] == {"scanned": 1, "legacy": 1, "updated": 0}
        assert store.client.docs == before and store.client.writes == writes
        assert not (tmp_path / "audit/preimages").exists()
        with pytest.raises(ValueError, match="different source or mode"):
            maintenance.cleanup(store, tmp_path / "audit", apply=True)
    finally:
        store.close()


def test_backup_failure_aborts_write_and_does_not_advance_cursor(tmp_path, monkeypatch):
    store = query_store("ownership_backup_failure")
    try:
        ref, row = legacy(store, "games", "legacy")
        def fail(*args):
            raise OSError("No durable backup")
        monkeypatch.setattr(maintenance, "_backup", fail)
        with pytest.raises(OSError):
            maintenance.cleanup(store, tmp_path / "apply", apply=True)
        assert ref.get().to_dict() == row
        progress = json.loads((tmp_path / "apply/progress.json").read_text())
        assert progress["stage"] == 0 and "last_doc" not in progress
        assert progress["source"]["namespace"] == store.namespace
    finally:
        store.close()


def test_fresh_transaction_preserves_edit_after_listing(tmp_path, monkeypatch):
    store = query_store("ownership_concurrent_edit")
    try:
        ref, row = legacy(store, "games", "legacy")
        query = store._run_query
        changed = False
        def list_then_edit(*args, **kwargs):
            nonlocal changed
            docs = query(*args, **kwargs)
            if docs and not changed:
                changed = True
                payload = json.loads(row["json"]);payload["name"] = "Concurrent edit"
                ref.set({**row, "revision": 8, "json": json.dumps(payload)})
            return docs
        monkeypatch.setattr(store, "_run_query", list_then_edit)
        finish(store, tmp_path / "apply", apply=True)
        updated = ref.get().to_dict()
        assert updated["revision"] == 8
        assert json.loads(updated["json"])["name"] == "Concurrent edit"
        assert "owner_user_id" not in updated
    finally:
        store.close()


def test_failed_commit_keeps_recoverable_preimage_and_resumes_safely(tmp_path, monkeypatch):
    store = query_store("ownership_interrupted_commit")
    try:
        ref, row = legacy(store, "games", "legacy")
        transaction = store.client.transaction
        def failing_transaction():
            tx = transaction()
            def fail():
                raise RuntimeError("Simulated conflict before commit")
            tx._commit = fail
            return tx
        monkeypatch.setattr(store.client, "transaction", failing_transaction)
        directory = tmp_path / "apply"
        with pytest.raises(RuntimeError):
            maintenance.cleanup(store, directory, apply=True)
        assert ref.get().to_dict() == row
        backups = list((directory / "preimages").glob("*.json"))
        assert len(backups) == 1
        assert json.loads(backups[0].read_text())["before_sha256"] == maintenance.digest(row)
        progress = json.loads((directory / "progress.json").read_text())
        assert progress["stage"] == 0 and "last_doc" not in progress
        assert progress["source"]["namespace"] == store.namespace
        monkeypatch.setattr(store.client, "transaction", transaction)
        assert finish(store, directory, apply=True)["complete"]
        assert len(list((directory / "preimages").glob("*.json"))) == 1
        assert "owner_user_id" not in ref.get().to_dict()
    finally:
        store.close()


def test_invalid_payload_fails_closed_and_private_output_never_echoes_records(tmp_path, monkeypatch, capsys):
    store = query_store("ownership_malformed")
    try:
        ref = store.collection("games").document("malformed")
        row = {"json": "private invalid data", "owner_user_id": "private-id"};ref.set(row)
        with pytest.raises(json.JSONDecodeError):
            maintenance.cleanup(store, tmp_path / "apply", apply=True)
        assert ref.get().to_dict() == row
        from game_platform import config
        monkeypatch.setattr(config, "load_config", lambda _: (_ for _ in ()).throw(ValueError("private configuration")))
        assert maintenance.main(["--config", "unused", "--state-dir", str(tmp_path / "cli"),
                                 "--expected-project", "fake", "--expected-database", "fake",
                                 "--expected-namespace", store.namespace]) == 1
        output = capsys.readouterr().out
        assert "private" not in output and "ValueError" in output
    finally:
        store.close()


def test_state_is_private_and_cannot_be_reused_for_another_namespace(tmp_path):
    store = query_store("ownership_scope")
    try:
        directory = tmp_path / "unsafe";directory.mkdir();directory.chmod(0o755)
        with pytest.raises(ValueError, match="private"):
            maintenance.cleanup(store, directory)
        finish(store, tmp_path / "safe")
        store.namespace = "other"
        with pytest.raises(ValueError, match="different source or mode"):
            maintenance.cleanup(store, tmp_path / "safe")
    finally:
        store.close()
