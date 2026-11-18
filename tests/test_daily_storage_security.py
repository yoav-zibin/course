"""Secrets stay private in persisted snapshots and oversized request logs."""

import json
import os
import stat

from game_platform.config import MonitoringConfig
from game_platform.json_file_store import JsonFileStore, read_snapshot, write_snapshot
from game_platform.observability import RequestLogMiddleware
from game_platform.service import GamePlatform


def test_oversized_bodies_never_log_an_unredacted_prefix():
    raw = json.dumps({"password": "private-password", "payload": "x" * 300}).encode()
    logged = RequestLogMiddleware._body_for_log(
        raw[:101], {"content-type": "application/json"},
        MonitoringConfig(max_logged_body_bytes=100), len(raw),
    )
    assert logged == {"_truncated": True, "bytes": len(raw)}


def test_snapshots_and_backups_are_owner_only_with_permissive_umask(tmp_path):
    previous = os.umask(0)
    store = None
    try:
        path = tmp_path / "accounts.json"
        # Replacing an existing world-readable snapshot must also fix its mode.
        platform = GamePlatform()
        user = platform.create_user(display_name="Private account")
        write_snapshot(path, platform._store.snapshot())
        path.chmod(0o666)
        store = JsonFileStore(path, backup_interval_seconds=1)
        store.put_user(user)
        store.flush()
        store.close()
        store = None
        backup_directory = tmp_path / "accounts.json.backups"
        backups = list(backup_directory.glob("*.json"))
        assert len(backups) == 1
        assert stat.S_IMODE(backup_directory.stat().st_mode) == 0o700
        for stored in (path, *backups):
            assert stat.S_IMODE(stored.stat().st_mode) == 0o600
            assert read_snapshot(stored).users[0].password == user.password
    finally:
        if store is not None:
            store.close()
        os.umask(previous)


def test_snapshot_write_does_not_follow_a_predictable_temporary_symlink(tmp_path):
    path = tmp_path / "accounts.json"
    victim = tmp_path / "unrelated.txt"
    victim.write_text("keep me")
    path.with_name("accounts.json.tmp").symlink_to(victim)
    write_snapshot(path, GamePlatform()._store.snapshot())
    assert victim.read_text() == "keep me"
    assert not read_snapshot(path).users
