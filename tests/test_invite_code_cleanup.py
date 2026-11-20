"""Daily short-code expiry, safe reuse, bounded progress and capacity alerts."""

import configparser
import datetime as dt
import logging
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from game_platform import invite_code_cleanup as cleanup
from game_platform.models import Invite
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api

NOW = dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc)


def fixture():
    store = query_store("invite_cleanup")
    api = Api(store=store)
    api.platform._clock = lambda: NOW
    owner = api.new_user("Owner")
    game = api.new_game(owner=owner)
    match = api.new_match(owner=owner, game_id=game)
    return api, store, owner, game, match


def set_allocation(store, match_id, *, created_at=NOW, token=None):
    match = store.get_match(match_id)
    token = token or match.invite_code
    if match.invite_code != token:
        store.delete_invite(match.invite_code)
        store.put_match(replace(match, invite_code=token))
    store.put_invite(Invite(token=token, match_id=match_id,
                           created_by_user_id=match.owner_user_id,
                           created_at=created_at,
                           expires_at=created_at+dt.timedelta(days=7)))
    return token


def test_week_old_code_is_reclaimed_and_a_fresh_lobby_is_preserved():
    api, store, owner, game, old = fixture()
    fresh = api.new_match(owner=owner, game_id=game)
    old_code = set_allocation(store, old, created_at=NOW-dt.timedelta(days=7, seconds=1))
    fresh_code = store.get_match(fresh).invite_code
    try:
        with patch.object(store, "list_all_matches", side_effect=AssertionError("match scan")), \
             patch.object(store, "_list_all", side_effect=AssertionError("whole invite list")):
            result = cleanup.sweep(store, now=NOW, page_size=1)
        assert result["released"] == 1 and not result["more_work_may_remain"]
        assert store.get_invite(old_code) is None
        assert store.get_match(old).invite_code is None
        assert store.get_invite(fresh_code) is not None
        assert result["used"] == 1
    finally:
        store.close()


def test_inactive_orphan_and_detached_reservations_are_released():
    api, store, owner, game, match_id = fixture()
    code = store.get_match(match_id).invite_code
    store.put_match(replace(store.get_match(match_id), status="over"))
    store.put_invite(Invite(token="zzzz", match_id="deleted-match",
                           created_by_user_id=owner, created_at=NOW))
    other = api.new_match(owner=owner, game_id=game)
    store.put_invite(Invite(token="yyyy", match_id=other,
                           created_by_user_id=owner, created_at=NOW))
    try:
        result = cleanup.sweep(store, now=NOW)
        assert result["released"] == 3
        assert store.get_match(match_id).invite_code is None
        assert store.get_invite(code) is None
        assert store.get_invite("zzzz") is None and store.get_invite("yyyy") is None
        assert store.get_match(other).invite_code is not None
    finally:
        store.close()


def test_candidate_is_read_fresh_after_the_code_has_been_reassigned():
    api, store, owner, game, old = fixture()
    old_code = set_allocation(store, old, created_at=NOW-dt.timedelta(days=8))
    doc = next(doc for doc in store._run_query("invites", (), limit=100,
                                              after=None, transaction=None)
               if store._decode("invites", doc.to_dict(), doc.reference).token == old_code)
    new = api.new_match(owner=owner, game_id=game)
    store.put_match(replace(store.get_match(old), invite_code=None))
    set_allocation(store, new, token=old_code)
    try:
        # A stale page still carries the previous allocation. Reclamation must
        # check the fresh invite and its new match inside the transaction.
        stale = store._decode("invites", doc.to_dict(), doc.reference)
        assert stale.created_at < NOW-dt.timedelta(days=7)
        assert cleanup._release_candidate(store, stale.token, NOW) is False
        assert store.get_invite(old_code).match_id == new
        assert store.get_match(new).invite_code == old_code
    finally:
        store.close()


def test_bounded_sweep_resumes_from_durable_cursor_after_restart():
    api, store, owner, game, original = fixture()
    for _ in range(4):
        api.new_match(owner=owner, game_id=game)
    first = cleanup.sweep(store, now=NOW, page_size=2, max_records=2)
    assert first["scanned"] == 2 and first["more_work_may_remain"]
    resumed = query_store(store.namespace, store.client)
    try:
        second = cleanup.sweep(resumed, now=NOW, page_size=2)
        assert second["scanned"] == 3 and not second["more_work_may_remain"]
        marker = resumed.raw_get(resumed.ref("meta", cleanup.CHECKPOINT))
        assert marker["after"] is None and marker["last_completed_at"] == NOW
    finally:
        resumed.close()
        store.close()


@pytest.mark.parametrize("used,should_alert", [
    (cleanup.CODE_CAPACITY//2, False), (cleanup.CODE_CAPACITY//2+1, True),
])
def test_capacity_alert_fires_only_above_half_and_uses_existing_alert_channel(used, should_alert, caplog):
    store = SimpleNamespace(counts=lambda: {"invites_codes_total": used,
                                          "invites_total": cleanup.CODE_CAPACITY})
    with caplog.at_level(logging.INFO):
        report = cleanup.capacity_report(store)
    assert report["used"] == used
    alerts = [r for r in caplog.records if getattr(r, "_event", "") == "invite_code_capacity_high"]
    assert bool(alerts) is should_alert
    if should_alert:
        assert alerts[0]._alert == "minor"
        assert alerts[0]._fields["capacity"] == 456_976


def test_short_code_counter_tracks_reuse_and_excludes_legacy_tokens():
    api, store, owner, game, match = fixture()
    code = store.get_match(match).invite_code
    try:
        assert store.counts()["invites_codes_total"] == 1
        store.put_invite(Invite(token="legacy-long-token", match_id=match,
                               created_by_user_id=owner, created_at=NOW))
        assert store.counts()["invites_codes_total"] == 1
        store.delete_invite(code)
        assert store.counts()["invites_codes_total"] == 0
        store.put_invite(Invite(token=code, match_id=match,
                               created_by_user_id=owner, created_at=NOW))
        assert store.counts()["invites_codes_total"] == 1
    finally:
        store.close()


def test_check_config_closes_resources_without_cleanup_or_logs(monkeypatch):
    closed = []
    store = SimpleNamespace(health=lambda: None, close=lambda: closed.append("store"))
    client = SimpleNamespace(close=lambda: closed.append("client"))
    monkeypatch.setattr(cleanup, "load_config", lambda _: object())
    monkeypatch.setattr(cleanup, "open_store", lambda _: (client, store))
    monkeypatch.setattr(cleanup, "setup_logging", lambda *_: pytest.fail("check-only opened logs"))
    monkeypatch.setattr(cleanup, "sweep", lambda *_a, **_kw: pytest.fail("check-only reclaimed codes"))
    assert cleanup.main(["--config", "unused.json", "--check-config"]) == 0
    assert closed == ["store", "client"]


def test_worker_failure_alert_omits_private_exception_values(monkeypatch, caplog):
    def broken(_):
        raise ValueError("private-credential-do-not-log")
    monkeypatch.setattr(cleanup, "load_config", broken)
    assert cleanup.main(["--config", "unused.json"]) == 1
    assert "private-credential-do-not-log" not in caplog.text
    alert = next(r for r in caplog.records if r._event == "invite_code_cleanup_failed")
    assert alert._alert == "major" and alert._fields["error_type"] == "ValueError"


def test_daily_timer_is_persistent_and_has_time_to_save_progress():
    folder = Path(__file__).resolve().parents[1] / "deploy"
    timer, service = configparser.ConfigParser(), configparser.ConfigParser(strict=False)
    timer.read(folder / "game-platform-invite-codes.timer")
    service.read(folder / "game-platform-invite-codes.service")
    assert timer["Timer"]["OnCalendar"] == "daily"
    assert timer["Timer"].getboolean("Persistent")
    assert service["Service"]["Type"] == "oneshot"
    assert "game_platform.invite_code_cleanup" in service["Service"]["ExecStart"]
    assert service["Service"]["ReadWritePaths"] == "/var/log/game-platform"
    assert service["Service"]["TimeoutStartSec"] == "35min"
