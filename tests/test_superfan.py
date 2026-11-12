"""Production monitor regression checks without touching production or sending mail."""

import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "superfan", Path(__file__).parents[1] / "ops" / "monitoring" / "superfan.py"
)
superfan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(superfan)
NOW = 1_800_000_000


def healthy():
    return {
        "time": NOW, "window_start": NOW - 3600,
        "unit": {"ActiveState": "active", "SubState": "running", "MainPID": "123",
                 "NRestarts": "0", "ExecMainStartTimestampMonotonic": "1000"},
        "disks": {"/": {"capacity": 50 * superfan.GIB, "free": 30 * superfan.GIB,
                          "used_percent": 40, "inodes_free_percent": 99}},
        "memory_total": 16 * superfan.GIB, "memory_available": 10 * superfan.GIB,
        "load_per_cpu": .2, "fd_percent": 1, "oom": 0, "collection_issues": [],
        "cpu": [{"time": NOW - 600, "busy": 20, "iowait": 1, "steal": 0},
                {"time": NOW, "busy": 25, "iowait": 1, "steal": 0}],
        "probes": {"public_health": [{"ok": True, "seconds": .05}]},
        "logs": {"latest": NOW, "earliest": NOW - 3600, "metrics": [{"time": NOW}],
                 "routes": {}, "alerts": {}},
    }


def test_healthy_is_quiet_and_uses_available_memory():
    assert superfan.evaluate(healthy(), []) == {}


def test_filesystems_without_inode_accounting_do_not_raise_false_alerts():
    from types import SimpleNamespace

    snap = healthy()
    snap["disks"]["/boot/efi"] = superfan.disk_reading(SimpleNamespace(
        f_blocks=100, f_bfree=80, f_bavail=80, f_frsize=4096, f_files=0, f_favail=0))
    assert snap["disks"]["/boot/efi"]["inodes_free_percent"] is None
    assert superfan.evaluate(snap, []) == {}


def test_sustained_cpu_pressure_not_isolated_peak():
    snap = healthy()
    snap["cpu"][0]["busy"] = 99
    assert "cpu:busy" not in superfan.evaluate(snap, [])
    snap["cpu"][1]["busy"] = 75
    assert superfan.evaluate(snap, [])["cpu:busy"]["severity"] == "warning"
    snap["cpu"][1]["busy"] = 95
    assert superfan.evaluate(snap, [])["cpu:busy"]["severity"] == "critical"


def test_memory_disk_inodes_oom_and_failed_health():
    snap = healthy()
    snap["memory_available"] = superfan.GIB
    snap["disks"]["/"]["used_percent"] = 94
    snap["disks"]["/"]["inodes_free_percent"] = 2
    snap["oom"] = 1
    snap["probes"]["public_health"] = [{"ok": False, "seconds": 10}] * 3
    findings = superfan.evaluate(snap, [])
    for key in ["memory", "disk:/", "inodes:/", "oom", "public_health"]:
        assert findings[key]["severity"] == "critical"


def test_disk_forecast_requires_sustained_growth_and_ignores_cleanup():
    snap = healthy()
    older, previous = copy.deepcopy(snap), copy.deepcopy(snap)
    older["time"], previous["time"] = NOW - 7200, NOW - 3600
    older["disks"]["/"]["free"] = 34 * superfan.GIB
    previous["disks"]["/"]["free"] = 32 * superfan.GIB
    assert "disk_growth:/" not in superfan.evaluate(snap, [previous])
    assert superfan.evaluate(snap, [older, previous])["disk_growth:/"]["severity"] == "warning"
    previous["disks"]["/"]["free"] = 28 * superfan.GIB
    assert "disk_growth:/" not in superfan.evaluate(snap, [older, previous])


def test_live_latency_errors_and_long_test_requests():
    snap = healthy()
    snap["logs"]["routes"] = {
        "GET /v2/games": {"requests": 100, "p95_ms": 550, "errors": 0},
        "POST /game-test/submissions": {"requests": 100, "p95_ms": 9000, "errors": 3},
        "POST /matches/<match_id>/moves": {"requests": 100, "p95_ms": 1200, "errors": 6},
    }
    findings = superfan.evaluate(snap, [])
    assert findings["latency:GET /v2/games"]["severity"] == "warning"
    assert findings["latency:POST /matches/<match_id>/moves"]["severity"] == "critical"
    assert "latency:POST /game-test/submissions" not in findings
    assert "errors:POST /game-test/submissions" in findings


def test_stale_stats_cpu_missing_and_restarts_are_visible():
    snap, previous = healthy(), healthy()
    previous["time"] = NOW - 7200
    previous["unit"]["ExecMainStartTimestampMonotonic"] = "900"
    snap["logs"]["metrics"] = []
    snap["cpu"] = []
    findings = superfan.evaluate(snap, [previous])
    assert {"restart", "missed_run", "telemetry", "cpu_history"} <= findings.keys()


def test_notification_cooldown_escalation_and_recovery():
    warning = {"disk": {"severity": "warning", "detail": "disk pressure"}}
    notified = {"disk": {"severity": "warning", "time": NOW - 3600}}
    assert superfan.notification_due(warning, notified, NOW) == ({}, [])
    assert superfan.notification_due(warning, notified, NOW + 21600)[0] == warning
    critical = {"disk": {"severity": "critical", "detail": "disk pressure"}}
    assert superfan.notification_due(critical, notified, NOW)[0] == critical
    assert superfan.notification_due({}, notified, NOW) == ({}, ["disk"])


def test_rotation_includes_previous_file_and_drops_sensitive_fields(tmp_path):
    when = dt.datetime.now(dt.timezone.utc).isoformat()
    now = superfan.timestamp(when)
    entry = {"timestamp": when, "message": "API_CALL " + json.dumps({
        "method": "GET", "route": "/matches/<match_id>", "path": "/matches/PRIVATE_ID",
        "handler": "match", "status": 200, "duration_ms": 550,
        "request_body": {"secret": "DO_NOT_PERSIST"}})}
    (tmp_path / "server.log.1").write_text(json.dumps(entry) + "\n")
    (tmp_path / "server.log").write_text(json.dumps({"timestamp": when, "event": "metrics",
        "rss_mb": 400, "message": "stats"}) + "\n{partial")
    result = superfan.log_stats(tmp_path / "server.log", now - 3600, now)
    assert result["routes"]["GET /matches/<match_id>"]["requests"] == 1
    assert result["routes"]["GET /matches/<match_id>"]["p95_ms"] == 550
    assert result["metrics"][0]["rss_mb"] == 400
    assert "PRIVATE_ID" not in json.dumps(result)
    assert "DO_NOT_PERSIST" not in json.dumps(result)


def test_probe_retries_and_validates_storage(monkeypatch):
    class Response:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def read(self, size):
            return b'{"status":"ok","storage":"failed"}'

    monkeypatch.setattr(superfan.urllib.request, "urlopen", lambda *args, **kw: Response())
    monkeypatch.setattr(superfan.time, "sleep", lambda _: None)
    monkeypatch.setattr(superfan.time, "monotonic", lambda: 1)
    assert superfan.probe("https://example.com/health", True) == [
        {"ok": False, "seconds": 0.0}] * 3


def test_cpu_history_handles_utc_midnight(monkeypatch):
    now = superfan.timestamp("2026-11-13T00:30:00+00:00")
    paths = []

    def sadf(*args):
        paths.append(args[2])
        day = "12" if args[2].endswith("sa12") else "13"
        return json.dumps({"sysstat": {"hosts": [{"statistics": [{
            "timestamp": {"date": "2026-11-" + day, "time": "23:50:00" if day == "12" else "00:10:00"},
            "cpu-load": [{"cpu": "all", "idle": 80, "iowait": 1, "steal": 0}],
        }]}]}})

    monkeypatch.setattr(superfan, "command", sadf)
    rows, issues = superfan.cpu_history(now - 3600, now)
    assert len(paths) == len(rows) == 2
    assert not issues


def test_failed_notification_is_not_acknowledged(tmp_path, monkeypatch):
    from types import SimpleNamespace

    snap = healthy()
    snap["memory_available"] = superfan.GIB
    monkeypatch.setattr(superfan, "collect", lambda *args: snap)
    monkeypatch.setattr(superfan, "send_email", lambda *args: (_ for _ in ()).throw(OSError()))
    with pytest.raises(OSError):
        superfan.run(SimpleNamespace(send_test=False, dry_run=False), {"base_url": "https://example.com"}, tmp_path)
    assert not (tmp_path / "state.json").exists()
