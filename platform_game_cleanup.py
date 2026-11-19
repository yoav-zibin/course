"""Explicit, resumable removal of obsolete user attribution from game records.

This is storage maintenance, not a game-content update. It changes only the
former owner field in game headers and their top-level JSON. Code chunks,
versions, revisions, publication flags and unrelated collections stay intact.
Every write has a private, fsynced Firestore-typed preimage for recovery.
"""

import argparse
import fcntl
import hashlib
import json
import os
import tempfile
from contextlib import ExitStack
from pathlib import Path

from google.cloud.firestore_v1._helpers import encode_dict
from google.cloud.firestore_v1.types import Document
from google.protobuf.json_format import MessageToDict

# The last two collections are retired Builder artifacts, if still present.
# Their former models used the same structured ownership field; conversation
# text, recovery namespaces and unrelated user associations are out of scope.
KINDS = ("games", "game_versions", "game_drafts", "game_test_sessions")
LEGACY_FIELDS = frozenset({"owner_user_id"})
POLICY = "platform-game-attribution-v1"


def without_attribution(row):
    """Preserve unknown legacy data; do not deserialize through today's model."""
    if row is None:
        return None
    result = {key: value for key, value in row.items() if key not in LEGACY_FIELDS}
    raw = row.get("json")
    if raw is not None:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("Expected a game JSON object")
        if LEGACY_FIELDS.intersection(payload):
            result["json"] = json.dumps(
                {key: value for key, value in payload.items() if key not in LEGACY_FIELDS},
                ensure_ascii=False, separators=(",", ":"))
    return result


def typed_fields(row):
    """Retain Firestore timestamps/bytes/types in the recovery preimage."""
    return MessageToDict(Document(fields=encode_dict(row))._pb).get("fields", {})


def digest(row):
    return hashlib.sha256(json.dumps(typed_fields(row), sort_keys=True,
                                    separators=(",", ":")).encode()).hexdigest()


def _private_file(path, flags):
    fd = os.open(path, flags | os.O_NOFOLLOW, 0o600)
    if os.fstat(fd).st_mode & 0o077:
        os.close(fd)
        raise ValueError("Maintenance state must be private")
    return os.fdopen(fd, "a+" if flags & os.O_APPEND else "r+")


def _save(path, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        try:
            os.chmod(temporary, 0o600)
            json.dump(value, handle, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
            temporary.replace(path)
            _sync_directory(path.parent)
        finally:
            temporary.unlink(missing_ok=True)


def _sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _backup(path, ref, before, after):
    # A transaction conflict can leave an unused preimage. Recovery must check
    # after_sha256 against the current document before restoring any preimage.
    entry = {"path": ref.path, "fields": typed_fields(before),
             "before_sha256": digest(before), "after_sha256": digest(after)}
    _private_directory(path)
    identity = hashlib.sha256(json.dumps(entry, sort_keys=True).encode()).hexdigest()
    # Individually atomic files avoid an interrupted append corrupting the
    # recovery journal. An abandoned temporary file is never a recovery entry.
    _save(path / (identity + ".json"), entry)


def _private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError("Maintenance directory must be private")
    _sync_directory(path)
    _sync_directory(path.parent)


def cleanup(store, directory, *, apply=False, page_size=50, max_documents=10000):
    if not 1 <= page_size <= 100 or not 1 <= max_documents <= 100000:
        raise ValueError("Invalid maintenance bounds")
    directory = Path(directory)
    _private_directory(directory)
    identity = {"project": store.client.project,
                "database": getattr(store.client, "_database", "fake"),
                "namespace": store.namespace, "policy": POLICY, "apply": apply}
    with _private_file(directory / "lock", os.O_CREAT | os.O_RDWR) as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = directory / "progress.json"
        progress = (json.loads(path.read_text()) if path.exists() else {
            "source": identity, "stage": 0, "complete": False,
            "counts": {kind: {"scanned": 0, "legacy": 0, "updated": 0} for kind in KINDS}})
        if progress["source"] != identity:
            raise ValueError("Maintenance checkpoint has a different source or mode")
        # Bind source/mode before even the first backup or database mutation.
        # A crash after the first commit must not leave unbound preimages.
        if not path.exists():
            _save(path, progress)
        processed = 0
        while not progress["complete"] and processed < max_documents:
            kind = KINDS[progress["stage"]]
            docs = store._run_query(kind, (), limit=min(page_size, max_documents-processed),
                                    after=progress.get("last_doc"), transaction=None)
            if not docs:
                progress["stage"] += 1
                progress.pop("last_doc", None)
                progress["complete"] = progress["stage"] == len(KINDS)
                _save(path, progress)
                continue
            for doc in docs:
                # Read again inside a transaction; never overwrite a concurrent
                # content edit with the earlier listing's document snapshot.
                with store.atomic():
                    before = store.raw_get(doc.reference)
                    after = without_attribution(before)
                    changed = before != after
                    if apply and changed:
                        _backup(directory / "preimages", doc.reference, before, after)
                        store.raw_put(doc.reference, after)
                counts = progress["counts"][kind]
                counts["scanned"] += 1
                counts["legacy"] += int(changed)
                counts["updated"] += int(apply and changed)
                progress["last_doc"] = doc.id
                processed += 1
                _save(path, progress)
        return {"complete": progress["complete"], "processed_this_pass": processed,
                "apply": apply, "counts": progress["counts"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--expected-project", required=True)
    parser.add_argument("--expected-database", required=True)
    parser.add_argument("--expected-namespace", required=True)
    parser.add_argument("--apply", action="store_true", help="Write after private preimage backup")
    parser.add_argument("--page-size", type=int, default=50)
    parser.add_argument("--max-documents", type=int, default=10000)
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        from game_platform.config import load_config
        from game_platform.account_deletion_worker import open_store

        config = load_config(args.config)
        actual = config.firestore
        if (actual.project_id, actual.database, actual.namespace) != (
                args.expected_project, args.expected_database, args.expected_namespace):
            raise ValueError("Configured maintenance source does not match expectations")
        with ExitStack() as resources:
            client, store = open_store(config)
            resources.callback(client.close)
            resources.callback(store.close)
            result = cleanup(store, args.state_dir, apply=args.apply,
                             page_size=args.page_size, max_documents=args.max_documents)
        print(json.dumps(result, sort_keys=True))
        return 0 if result["complete"] else 2
    except Exception as error:
        # Configuration, JSON parse errors and Firestore exceptions can embed
        # credentials or document contents; emit the exception class only.
        print(json.dumps({"error": type(error).__name__, "complete": False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
