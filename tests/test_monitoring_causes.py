"""Alerts that say what is probably wrong: event loop lag, the busiest clients and paths,
likely causes, database timing and browser error reports."""

import asyncio
import json
import logging
import threading
import time
from typing import Any

import pytest
from fastapi.testclient import TestClient

from game_platform import observability
from game_platform.api import create_app
from game_platform.config import MonitoringConfig
from game_platform.observability import Monitor, TimedStore, normalize_path, scrub_text
from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Cpu:
    """Stands in for /proc: the process's CPU seconds and the machine's busy / total ticks."""

    def __init__(self) -> None:
        self.process, self.busy, self.total = 0.0, 0, 1000

    def __call__(self) -> tuple[float, int, int]:
        return self.process, self.busy, self.total


def events(caplog: pytest.LogCaptureFixture, name: str | None = None) -> list[dict[str, Any]]:
    found = []
    for record in caplog.records:
        event = getattr(record, "_event", None)
        if event and (name is None or event == name):
            found.append(
                {
                    "event": event,
                    "alert": getattr(record, "_alert", None),
                    "level": record.levelname,
                    "message": record.getMessage(),
                    **(getattr(record, "_fields", None) or {}),
                }
            )
    return found


@pytest.fixture(autouse=True)
def _capture_everything(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)


def finish(monitor: Monitor, n: int, *, status: int = 200, ms: float = 100, client: str = "10.0.0.1",
           method: str = "GET", path: str = "/x", route: str | None = None) -> None:
    request_id = f"r{n}-{path}-{client}"
    monitor.request_started({"request_id": request_id, "method": method, "path": path, "client": client})
    monitor.request_finished(request_id, status, ms, route=route)


# Event loop lag


class RunningLoop:
    """A real asyncio loop in its own thread, standing in for the server's."""

    def __init__(self) -> None:
        self.loop = asyncio.new_event_loop()
        ready = threading.Event()

        def run() -> None:
            asyncio.set_event_loop(self.loop)
            self.loop.call_soon(ready.set)
            self.loop.run_forever()

        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        assert ready.wait(5)

    def block(self, seconds: float) -> None:
        """Runs a blocking call on the loop (like a database read in an async function) and
        returns once it has started."""
        started = threading.Event()
        self.loop.call_soon_threadsafe(blocking_database_read, started, seconds)
        assert started.wait(5)

    def close(self) -> None:
        self.loop.call_soon_threadsafe(self.loop.stop)
        self.thread.join(5)
        self.loop.close()


def blocking_database_read(started: threading.Event, seconds: float) -> None:
    started.set()
    time.sleep(seconds)


@pytest.fixture
def running_loop() -> Any:
    loop = RunningLoop()
    yield loop
    loop.close()


def test_an_idle_event_loop_answers_at_once(running_loop: RunningLoop) -> None:
    monitor = Monitor(MonitoringConfig(), memory=lambda: None)
    monitor.bind_loop(running_loop.loop, running_loop.thread.ident)
    lag, stack = monitor.measure_loop_lag()  # type: ignore[misc]
    assert lag < 200
    assert stack is None


def test_a_blocked_event_loop_is_an_alert_that_names_the_blocking_line(
    running_loop: RunningLoop, caplog: pytest.LogCaptureFixture
) -> None:
    monitor = Monitor(MonitoringConfig(event_loop_blocked_ms=200, metrics_interval_seconds=0), memory=lambda: None)
    monitor.bind_loop(running_loop.loop, running_loop.thread.ident)
    running_loop.block(0.8)
    monitor.tick()
    (alert,) = events(caplog, "event_loop_blocked")
    assert (alert["alert"], alert["level"]) == ("minor", "WARNING")
    assert alert["event_loop_lag_ms"] >= 500
    assert alert["blocking_frame"].endswith("blocking_database_read")
    assert any("blocking_database_read" in frame for frame in alert["event_loop_stack"])
    assert "blocking_database_read" in alert["message"]
    assert "blocking call on the event loop" in alert["likely_cause"]


def test_a_long_block_is_a_major_alert(running_loop: RunningLoop, caplog: pytest.LogCaptureFixture) -> None:
    monitor = Monitor(
        MonitoringConfig(event_loop_blocked_ms=100, event_loop_blocked_critical_ms=400, metrics_interval_seconds=0),
        memory=lambda: None,
    )
    monitor.bind_loop(running_loop.loop, running_loop.thread.ident)
    running_loop.block(0.9)
    monitor.tick()
    (alert,) = events(caplog, "event_loop_blocked")
    assert (alert["alert"], alert["level"]) == ("major", "CRITICAL")
    assert alert["threshold_ms"] == 400


def test_the_metrics_line_has_the_worst_event_loop_lag_of_the_minute(
    running_loop: RunningLoop, caplog: pytest.LogCaptureFixture
) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(event_loop_blocked_ms=100, metrics_interval_seconds=60),
                      clock=clock, memory=lambda: None)
    monitor.bind_loop(running_loop.loop, running_loop.thread.ident)
    running_loop.block(0.4)
    clock.now += 61
    monitor.tick()
    (metrics,) = events(caplog, "metrics")
    assert metrics["event_loop_lag_ms"] >= 300
    assert monitor.snapshot()["event_loop_lag_ms"] >= 300


def test_without_a_loop_there_is_no_lag_and_no_alert(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(metrics_interval_seconds=60), clock=clock, memory=lambda: None)
    clock.now += 61
    monitor.tick()
    (metrics,) = events(caplog, "metrics")
    assert metrics["event_loop_lag_ms"] is None
    assert events(caplog, "event_loop_blocked") == []


def test_the_real_app_blocking_its_loop_is_caught_end_to_end(caplog: pytest.LogCaptureFixture) -> None:
    """An `async def` route that sleeps blocks the app's own loop, as _choose_locale did."""
    monitor = Monitor(MonitoringConfig(event_loop_blocked_ms=150, metrics_interval_seconds=0), memory=lambda: None)
    app = create_app(GamePlatform(), monitor=monitor)

    async def slow_database_read() -> dict[str, bool]:
        time.sleep(0.8)
        return {"ok": True}

    app.add_api_route("/__block", slow_database_read, methods=["GET"])
    with TestClient(app) as client:
        client.get("/health")  # binds the loop
        worker = threading.Thread(target=lambda: client.get("/__block"))
        worker.start()
        time.sleep(0.3)  # the route is now sleeping on the loop
        monitor.tick()
        worker.join()
    (alert,) = events(caplog, "event_loop_blocked")
    assert alert["blocking_frame"].endswith("slow_database_read")


# Context for the alerts


def test_paths_are_grouped_with_ids_replaced() -> None:
    assert normalize_path("/matches/3f9c2a1b-7d4e-4a60-8c11-0a1b2c3d4e5f/moves") == "/matches/{id}/moves"
    assert normalize_path("/users/12345/matches") == "/users/{id}/matches"
    assert normalize_path("/games/tic-tac-toe") == "/games/tic-tac-toe"
    assert normalize_path("/x/Zm9vYmFyYmF6cXV4cXV1eDEyMw") == "/x/{id}"
    assert normalize_path("/matches/abc/moves", "/matches/{match_id}/moves") == "/matches/{id}/moves"


def test_a_busy_server_says_who_and_what_keeps_it_busy(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(busy_in_flight=4, overloaded_in_flight=100), clock=clock, memory=lambda: None)
    for n in range(8):
        finish(monitor, n, ms=2000, client="9.9.9.9", method="POST", path=f"/matches/{n}12345678/moves")
    for n in range(2):
        finish(monitor, 90 + n, ms=10, client="1.1.1.1", path="/games")
    for n in range(4):
        monitor.request_started({"request_id": f"open{n}", "method": "GET", "path": "/matches",
                                 "client": "9.9.9.9" if n else "2.2.2.2"})
    (alert,) = events(caplog, "server_busy")
    assert alert["alert"] == "minor"
    assert alert["top_clients_by_requests"][0] == {"client": "9.9.9.9", "requests": 11, "total_ms": 16000, "errors_5xx": 0}
    assert len(alert["top_clients_by_requests"]) <= 5 and len(alert["top_clients_by_time"]) <= 5
    assert alert["top_paths_by_time"][0]["path"] == "POST /matches/{id}/moves"
    assert alert["top_paths_by_requests"][0]["path"] in ("POST /matches/{id}/moves", "GET /matches")
    assert alert["requests_last_minute"] == 14  # ten finished, four still running
    assert sum(group["threads"] for group in alert["thread_groups"]) >= 1
    assert "frame" in alert["thread_groups"][0]
    assert "process_cpu_percent" in alert and "machine_cpu_percent" in alert
    assert "likely_cause" in alert
    assert "one client generates most of the load" in alert["likely_cause"]
    assert "9.9.9.9" in alert["likely_cause"]


def test_overloaded_has_the_same_context(caplog: pytest.LogCaptureFixture) -> None:
    monitor = Monitor(MonitoringConfig(busy_in_flight=1, overloaded_in_flight=2), memory=lambda: None)
    for n in range(2):
        monitor.request_started({"request_id": f"o{n}", "method": "GET", "path": "/x", "client": "c"})
    (alert,) = events(caplog, "server_overloaded")
    assert alert["alert"] == "major" and "likely_cause" in alert and alert["top_paths_by_requests"]


def test_only_the_last_minute_counts(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(), clock=clock, memory=lambda: None)
    finish(monitor, 1, client="old")
    clock.now += 61
    finish(monitor, 2, client="new")
    context = monitor.context()
    assert [entry["client"] for entry in context["top_clients_by_requests"]] == ["new"]


def test_threads_in_the_same_place_are_counted_together() -> None:
    stacks = {"a": ["db.py:1 read", "x.py:2 f"], "b": ["db.py:1 read", "y.py:3 g"], "c": ["q.py:9 wait"]}
    groups = observability.group_thread_stacks(stacks)
    assert groups[0]["frame"] == "db.py:1 read" and groups[0]["threads"] == 2
    assert groups[0]["example_stack"] == ["db.py:1 read", "x.py:2 f"]
    assert groups[1] == {"frame": "q.py:9 wait", "threads": 1, "example_stack": ["q.py:9 wait"]}


def test_cpu_of_the_process_and_of_the_machine() -> None:
    clock, cpu = Clock(), Cpu()
    monitor = Monitor(MonitoringConfig(), clock=clock, memory=lambda: None, cpu=cpu)
    clock.now += 20
    cpu.process, cpu.busy, cpu.total = 5.0, 200, 2000  # 25% of a core; 20% of the machine
    usage = monitor.cpu_usage()
    assert usage["process_cpu_percent"] == 25.0
    assert usage["machine_cpu_percent"] == 20.0
    assert usage["cpu_count"] >= 1


# Likely cause


def slow_minute(caplog: pytest.LogCaptureFixture, *, cpu_process: float, requests: Any = None,
                memory: Any = None, status: int = 200) -> dict[str, Any]:
    clock, cpu = Clock(), Cpu()
    monitor = Monitor(MonitoringConfig(metrics_interval_seconds=60), clock=clock, cpu=cpu,
                      memory=memory or (lambda: (100_000_000, 1_000_000_000)))
    for n in range(30):
        client, path = ("10.0.0.%d" % (n % 6), "/matches") if requests is None else requests(n)
        finish(monitor, n, ms=6000, client=client, path=path, status=status)
    clock.now += 60
    cpu.process, cpu.busy, cpu.total = cpu_process * 60 / 100, int(cpu_process * 10), 1000 + 1000
    monitor.tick()
    (alert,) = [e for e in events(caplog) if e["event"].startswith("latency")]
    return alert


def test_slow_requests_while_the_cpu_is_idle_point_at_io_or_a_blocked_loop(caplog: pytest.LogCaptureFixture) -> None:
    alert = slow_minute(caplog, cpu_process=5)
    assert alert["event"] == "latency_critical" and alert["alert"] == "major"
    assert alert["likely_cause"].startswith("requests are waiting on I/O or a blocked event loop")
    assert "event_loop_lag_ms" in alert["likely_cause"] and "thread_groups" in alert["likely_cause"]
    assert alert["process_cpu_percent"] == 5.0 and alert["machine_cpu_percent"] == 5.0


def test_slow_requests_while_the_cpu_is_busy_point_at_the_cpu(caplog: pytest.LogCaptureFixture) -> None:
    alert = slow_minute(caplog, cpu_process=99)
    assert "compute-bound" in alert["likely_cause"]
    assert "GET /matches" in alert["likely_cause"]


def test_one_client_sending_most_requests_is_named(caplog: pytest.LogCaptureFixture) -> None:
    alert = slow_minute(caplog, cpu_process=5, requests=lambda n: ("6.6.6.6" if n % 4 else "1.1.1.1", "/x"))
    assert "one client generates most of the load: 6.6.6.6" in alert["likely_cause"]


def test_many_5xx_on_one_path_name_that_path(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(metrics_interval_seconds=60), clock=clock, memory=lambda: None)
    for n in range(20):
        finish(monitor, n, status=200, client=f"c{n}", path="/games")
    for n in range(12):
        finish(monitor, 100 + n, status=500, client=f"c{n}", method="POST",
               path=f"/matches/3f9c2a1b-7d4e-4a60-8c11-0a1b2c3d4e{n:02d}/moves")
    clock.now += 61
    monitor.tick()
    (alert,) = events(caplog, "error_rate_critical")
    assert "POST /matches/{id}/moves" in alert["likely_cause"]
    assert alert["top_paths_by_requests"][0]["errors_5xx"] == 12 or alert["top_paths_by_requests"][1]["errors_5xx"] == 12


def test_high_memory_is_blamed_with_its_growth(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    rss = [500_000_000]
    monitor = Monitor(MonitoringConfig(metrics_interval_seconds=60, memory_warn_percent=70, memory_critical_percent=99),
                      clock=clock, memory=lambda: (rss[0], 1_000_000_000))
    monitor.tick()
    rss[0] = 800_000_000
    clock.now += 61
    for n in range(30):
        finish(monitor, n, ms=2000)
    monitor.tick()
    latency = events(caplog, "latency_high")[0]
    assert "memory is high (800 MB, 80%" in latency["likely_cause"]
    assert "grew 300 MB" in latency["likely_cause"]
    memory_alert = events(caplog, "memory_high")[-1]
    assert memory_alert["rss_growth_mb_10min"] == 300


def test_without_a_clear_cause_it_says_so() -> None:
    monitor = Monitor(MonitoringConfig(), memory=lambda: None)
    assert monitor.likely_cause("latency_high", monitor.context()).startswith("no single cause found")


# Database timing


def test_store_calls_are_timed_and_summarized_in_the_metrics_line(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(metrics_interval_seconds=60), clock=clock, memory=lambda: None)
    store = TimedStore(InMemoryStore(), monitor)
    for _ in range(3):
        store.list_users()
    store.list_games(owner_user_id=None)
    clock.now += 61
    monitor.tick()
    (metrics,) = events(caplog, "metrics")
    assert metrics["store_calls"] == 4
    assert metrics["store_total_ms"] >= 0 and metrics["store_p95_ms"] >= 0
    assert {item["operation"]: item["calls"] for item in metrics["store_slowest"]} == {"list_users": 3, "list_games": 1}
    assert metrics["store_calls_on_event_loop"] == 0
    clock.now += 61
    monitor.tick()
    assert events(caplog, "metrics")[1]["store_calls"] == 0


def test_the_timed_store_behaves_like_the_store_it_wraps() -> None:
    inner = InMemoryStore()
    store = TimedStore(inner, Monitor(MonitoringConfig(), memory=lambda: None))
    assert store.list_users() == inner.list_users()
    store.scalable = True  # attributes set through the wrapper reach the store
    assert inner.scalable is True and getattr(store, "scalable", False) is True
    assert getattr(store, "no_such_thing", "default") == "default"


def test_slow_database_calls_are_a_minor_alert(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(metrics_interval_seconds=60, store_slow_p95_ms=300), clock=clock, memory=lambda: None)
    for _ in range(10):
        monitor.note_store_call("get_user", 800.0)
    clock.now += 61
    monitor.tick()
    (alert,) = events(caplog, "store_slow")
    assert (alert["alert"], alert["store_p95_ms"], alert["threshold_ms"]) == ("minor", 800, 300)
    assert alert["store_slowest"][0]["operation"] == "get_user"
    assert "database calls are slow" in alert["likely_cause"]


def test_a_few_or_fast_database_calls_are_not_an_alert(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(metrics_interval_seconds=60, store_slow_p95_ms=300), clock=clock, memory=lambda: None)
    monitor.note_store_call("get_user", 5000.0)  # one call says nothing about the 95th percentile
    for _ in range(20):
        monitor.note_store_call("get_game", 3.0)
    clock.now += 61
    monitor.tick()
    assert events(caplog, "store_slow") == []


def test_a_database_call_on_the_event_loop_is_counted_and_blamed(running_loop: RunningLoop,
                                                                  caplog: pytest.LogCaptureFixture) -> None:
    monitor = Monitor(MonitoringConfig(), memory=lambda: None)
    monitor.bind_loop(running_loop.loop, running_loop.thread.ident)
    done = threading.Event()
    running_loop.loop.call_soon_threadsafe(lambda: (monitor.note_store_call("get_user", 250.0), done.set()))
    assert done.wait(5)
    monitor.note_store_call("get_user", 10.0)  # from this (another) thread
    context = monitor.context()
    assert (context["store_calls_on_event_loop"], context["store_ms_on_event_loop"]) == (1, 250)
    assert "database calls took 250 ms on the event loop" in monitor.likely_cause("latency_high", context)


def test_main_wraps_the_store_in_the_timer() -> None:
    from game_platform import main

    assert main.observability.TimedStore is TimedStore


# Browser error reports


def client_app(config: MonitoringConfig | None = None) -> tuple[TestClient, Monitor]:
    monitor = Monitor(config or MonitoringConfig(), memory=lambda: None)
    return TestClient(create_app(GamePlatform(), monitor=monitor)), monitor


REPORT = {"kind": "script_error", "message": "x is not a function (portal.js:10)",
          "page": "/static/portal.html", "user_agent": "Mozilla/5.0 test"}


def test_a_browser_error_is_logged_as_a_client_error(caplog: pytest.LogCaptureFixture) -> None:
    client, _ = client_app()
    response = client.post("/client-errors", json=REPORT)
    assert response.status_code == 202 and response.json() == {"ok": True}
    (event,) = events(caplog, "client_error")
    assert event["alert"] is None
    assert (event["kind"], event["error_message"], event["page"]) == (
        "script_error", "x is not a function (portal.js:10)", "/static/portal.html")
    assert event["user_agent"] == "Mozilla/5.0 test"


def test_secrets_in_a_browser_report_never_reach_the_log(caplog: pytest.LogCaptureFixture) -> None:
    client, _ = client_app()
    secret_token = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
    client.post("/client-errors", json={
        "kind": "script_error",
        "message": f"failed: password=hunter2 Bearer {secret_token} then token: abc123 id {secret_token}",
        "page": "/static/portal.html?code=654321&id_token=eyJabc#access_token=zzz",
        "user_agent": "UA",
        "password": "hunter2-extra-field",
    })
    log = json.dumps([event for event in events(caplog, "client_error")])
    for secret in ("hunter2", secret_token, "abc123", "654321", "eyJabc", "zzz"):
        assert secret not in log
    assert events(caplog, "client_error")[0]["page"] == "/static/portal.html"


def test_a_client_may_send_only_a_few_reports_a_minute(caplog: pytest.LogCaptureFixture) -> None:
    client, monitor = client_app(MonitoringConfig(client_errors_per_client_per_minute=3))
    codes = [client.post("/client-errors", json=REPORT).status_code for _ in range(5)]
    assert codes == [202, 202, 202, 429, 429]
    assert len(events(caplog, "client_error")) == 3
    other = client.post("/client-errors", json=REPORT, headers={"X-Forwarded-For": "5.5.5.5"})
    assert other.status_code == 202  # another client has its own allowance


def test_the_allowance_comes_back_after_a_minute() -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(client_errors_per_client_per_minute=1), clock=clock, memory=lambda: None)
    assert monitor.take_client_error_slot("c") and not monitor.take_client_error_slot("c")
    clock.now += 61
    assert monitor.take_client_error_slot("c")


def test_a_big_or_malformed_report_is_refused() -> None:
    client, _ = client_app()
    assert client.post("/client-errors", json={**REPORT, "message": "x" * 5000}).status_code == 413
    assert client.post("/client-errors", content=b"not json",
                       headers={"Content-Type": "application/json"}).status_code == 422
    assert client.post("/client-errors", json={**REPORT, "kind": "Bad Kind!"}).status_code == 422
    assert client.post("/client-errors", json={"message": "no kind"}).status_code == 422


def test_many_browser_errors_in_a_minute_are_a_minor_alert(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(client_error_spike_per_minute=5, client_errors_per_client_per_minute=100),
                      clock=clock, memory=lambda: None)
    for n in range(4):
        monitor.log_client_error(f"c{n}", {"kind": "script_error", "message": "boom", "page": "/p"})
    assert events(caplog, "client_error_spike") == []
    monitor.log_client_error("c4", {"kind": "storage_full", "message": "full", "page": "/p"})
    (alert,) = events(caplog, "client_error_spike")
    assert (alert["alert"], alert["reports_last_minute"], alert["clients"]) == ("minor", 5, 5)
    assert tuple(alert["top_kinds"][0]) == ("script_error", 4)
    assert all(event["alert"] is None for event in events(caplog, "client_error"))


def test_client_errors_are_counted_in_the_metrics_line(caplog: pytest.LogCaptureFixture) -> None:
    clock = Clock()
    monitor = Monitor(MonitoringConfig(metrics_interval_seconds=60), clock=clock, memory=lambda: None)
    monitor.log_client_error("c", {"kind": "script_error", "message": "m", "page": "/p"})
    clock.now += 61
    monitor.tick()
    assert events(caplog, "metrics")[0]["client_errors"] == 1


def test_scrub_text_keeps_ordinary_messages() -> None:
    assert scrub_text("Device storage is full or unavailable.", 200) == "Device storage is full or unavailable."
    assert scrub_text("tokens left: 5", 200) == "tokens left: 5"
    assert scrub_text("a" * 300, 100) == "<redacted>"
    assert scrub_text("line\x00break\x07", 50) == "linebreak"


def test_the_matched_route_names_the_endpoint_of_a_real_request() -> None:
    client, monitor = client_app()
    client.get("/users/alice-the-player")
    client.get("/users/bob-the-builder")
    paths = {entry["path"] for entry in monitor.context()["top_paths_by_requests"]}
    assert paths == {"GET /users/{id}"}
