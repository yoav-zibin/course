"""The hourly entrypoint drains durable batches without spawning app workers."""

import configparser
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from game_platform import account_deletion_worker as worker


def install_passes(monkeypatch, results, calls):
    def run(platform, **kwargs):
        calls.append(kwargs)
        return next(results)
    monkeypatch.setitem(sys.modules, "game_platform.account_deletion",
                        SimpleNamespace(run_due_account_deletions=run))


def test_sweep_continues_large_accounts_with_remaining_step_budget(monkeypatch):
    calls = []
    install_passes(monkeypatch, iter([
        {"claimed": 1, "completed": 0, "processed": 1000, "more_work_may_remain": True},
        {"claimed": 0, "completed": 1, "processed": 250, "more_work_may_remain": False},
    ]), calls)
    result = worker.sweep(object(), limit=25, max_steps=1250, max_seconds=60, clock=lambda: 0)
    assert result == {"claimed": 1, "completed": 1, "processed": 1250,
                      "passes": 2, "more_work_may_remain": False}
    assert [call["max_steps"] for call in calls] == [1000, 250]


def test_sweep_stops_at_runtime_deadline_and_retains_remaining_work(monkeypatch):
    calls = []
    install_passes(monkeypatch, iter([
        {"claimed": 1, "completed": 0, "processed": 3, "more_work_may_remain": True},
    ]), calls)
    times = iter([0, 0, 61])
    result = worker.sweep(object(), limit=25, max_steps=2000, max_seconds=60,
                          clock=lambda: next(times))
    assert len(calls) == 1 and result["more_work_may_remain"]


def test_sweep_does_not_spin_when_another_worker_holds_the_lease(monkeypatch):
    calls = []
    install_passes(monkeypatch, iter([
        {"claimed": 0, "completed": 0, "processed": 0, "more_work_may_remain": True},
    ]), calls)
    result = worker.sweep(object(), limit=25, max_steps=2000, max_seconds=60, clock=lambda: 0)
    assert result["passes"] == 1 and result["more_work_may_remain"]


def test_check_config_closes_resources_and_never_starts_platform(monkeypatch, capsys):
    closed = []
    store = SimpleNamespace(health=lambda: None, close=lambda: closed.append("store"))
    client = SimpleNamespace(close=lambda: closed.append("client"))
    monkeypatch.setattr(worker, "load_config", lambda _: SimpleNamespace(
        firestore=SimpleNamespace(namespace="test-only")))
    monkeypatch.setattr(worker, "open_store", lambda _: (client, store))
    assert worker.main(["--config", "unused.json", "--check-config"]) == 0
    assert closed == ["store", "client"]
    assert '"storage": "ok"' in capsys.readouterr().out


def test_maintenance_platform_does_not_scan_catalog_or_start_gameplay_workers(monkeypatch):
    from game_platform import service
    from game_platform.scaling_service import ScalablePlatform
    from game_platform.tests.fake_firestore import query_store

    def no_catalog(_):
        raise AssertionError("Maintenance enumerated the game catalog")
    monkeypatch.setattr(service, "_iter_all_game_versions", no_catalog)
    store = query_store("deletion_worker_startup")
    try:
        platform = ScalablePlatform(store=store, check_game_schemas=False)
        assert platform._worker is None
        platform.close_workers()
    finally:
        store.close()


@pytest.mark.parametrize("firestore", [
    SimpleNamespace(enabled=False),
    SimpleNamespace(enabled=True, database="(default)", allow_default_database_query=False),
])
def test_worker_refuses_snapshot_or_unacknowledged_default_database(firestore):
    with pytest.raises(ValueError):
        worker.open_store(SimpleNamespace(firestore=firestore))


def test_worker_error_does_not_print_private_configuration(monkeypatch, caplog, capsys):
    def broken(_):
        raise ValueError("private-account-password-do-not-log")
    monkeypatch.setattr(worker, "load_config", broken)
    assert worker.main(["--config", "unused.json"]) == 1
    assert "private-account-password-do-not-log" not in caplog.text
    assert "ValueError" in caplog.text
    assert not capsys.readouterr().out


def test_timer_survives_reboot_and_finishes_before_next_hour():
    folder = Path(__file__).resolve().parents[1] / "deploy"
    # systemd permits repeated Environment= directives.
    timer, service = configparser.ConfigParser(), configparser.ConfigParser(strict=False)
    timer.read(folder / "game-platform-account-deletions.timer")
    service.read(folder / "game-platform-account-deletions.service")
    assert timer["Timer"]["OnCalendar"] == "hourly"
    assert timer["Timer"].getboolean("Persistent")
    assert timer["Timer"]["Unit"] == "game-platform-account-deletions.service"
    assert service["Service"]["Type"] == "oneshot"
    assert "game_platform.account_deletion_worker" in service["Service"]["ExecStart"]
    assert "--config /opt/game-platform/config.json" in service["Service"]["ExecStart"]
    assert service["Service"]["TimeoutStartSec"] == "35min"
