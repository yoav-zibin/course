"""Structured logs and alert signals, so a problem can be investigated (by a person or an
agent) from the logs alone. See docs/monitoring.md.

Every notable situation is logged with [log_event]: a stable `event` name, a severity,
the `request_id` of the request it happened in, and the fields needed to reproduce it
(the request's method, path, query and JSON body; a game function's name and inputs).
Passwords, tokens and codes are never logged.

An event that needs a human has `alert="minor"` (an email) or `alert="major"` (a page).
Google Cloud Monitoring turns those log lines into notifications; this module decides
when to write them: slow and stuck requests, errors, a flood of sign-ups, too many
requests at once, and too much memory.

Alerts also say what is probably wrong, not only that something is: the busy, overloaded,
latency and error-rate alerts carry the busiest clients and paths of the last minute, where
the threads are, the CPU use, and a `likely_cause` chosen by simple rules (see
[Monitor.likely_cause]). The monitor thread also measures how long the server's asyncio loop
takes to run a tiny task (`event_loop_lag_ms`): a blocking call on the loop makes every
request slow while the CPU is idle, and the `event_loop_blocked` alert names the line.
"""

from __future__ import annotations

import asyncio
import collections
import contextvars
import functools
import hashlib
import inspect
import json
import logging
import logging.handlers
import os
import re
import sys
import threading
import time
import traceback
import urllib.parse
import uuid
from collections.abc import Awaitable, Callable, MutableMapping
from pathlib import Path
from typing import Any, Final, Literal

from game_platform.config import MonitoringConfig

logger = logging.getLogger("game_platform.events")

Alert = Literal["minor", "major"]

# Illegal moves are normally a player's mistake; this many in one metrics window is not.
ILLEGAL_MOVE_SPIKE: Final = 100
# Too few database calls in a minute say nothing about their 95th percentile.
STORE_SLOW_MIN_CALLS: Final = 5

# The request being handled, so every log line in it can be tied together.
REQUEST_ID: Final[contextvars.ContextVar[str | None]] = contextvars.ContextVar(
    "request_id", default=None
)
CLIENT: Final[contextvars.ContextVar[str | None]] = contextvars.ContextVar(
    "client", default=None
)

_SEVERITY: Final = {
    logging.DEBUG: "DEBUG",
    logging.INFO: "INFO",
    logging.WARNING: "WARNING",
    logging.ERROR: "ERROR",
    logging.CRITICAL: "CRITICAL",
}

# Logging

_RESERVED = ("_event", "_alert", "_fields")


def log_event(
    event: str,
    message: str | None = None,
    *,
    level: int = logging.INFO,
    alert: Alert | None = None,
    exc_info: Any = None,
    log: logging.Logger | None = None,
    **fields: Any,
) -> None:
    """Writes one structured log line. [event] is a short snake_case name that stays the
    same forever (alert policies and queries match on it); [fields] are the details."""
    (log or logger).log(
        level,
        message or event,
        exc_info=exc_info,
        extra={"_event": event, "_alert": alert, "_fields": fields},
    )


class JsonFormatter(logging.Formatter):
    """One JSON object per line, in the shape Google Cloud Logging reads: `severity`,
    `message` and `timestamp` are special; everything else becomes a field."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "severity": _SEVERITY.get(record.levelno, record.levelname),
            "message": record.getMessage(),
            "timestamp": time.strftime(
                "%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)
            )
            + f".{int(record.msecs):03d}Z",
            "logger": record.name,
        }
        event = getattr(record, "_event", None)
        if event:
            entry["event"] = event
        alert = getattr(record, "_alert", None)
        if alert:
            entry["alert"] = alert
        request_id = REQUEST_ID.get()
        if request_id:
            entry["request_id"] = request_id
        for key, value in (getattr(record, "_fields", None) or {}).items():
            entry.setdefault(key, value)
        if record.exc_info and record.exc_info[0] is not None:
            entry["exception"] = {
                "type": record.exc_info[0].__name__,
                "message": str(record.exc_info[1]),
            }
            entry["stack_trace"] = "".join(traceback.format_exception(*record.exc_info))
        return json.dumps(entry, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    """Readable lines for a terminal, with an event's fields at the end."""

    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)s %(name)s: %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        line = super().format(record)
        event = getattr(record, "_event", None)
        if not event:
            return line
        extras: dict[str, Any] = {"event": event}
        if getattr(record, "_alert", None):
            extras["alert"] = record._alert  # type: ignore[attr-defined]
        if REQUEST_ID.get():
            extras["request_id"] = REQUEST_ID.get()
        extras.update(getattr(record, "_fields", None) or {})
        return f"{line} {json.dumps(extras, default=str, ensure_ascii=False)}"


def setup_logging(level: str, log_format: Literal["text", "json"], log_file: str = "") -> None:
    """Sends every log line to stderr in [log_format], and as JSON to [log_file] if given
    (which is where the Ops Agent reads it). A file that can't be opened is reported, not
    fatal: the server still runs."""
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter() if log_format == "json" else TextFormatter())
    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
        if isinstance(existing, logging.handlers.RotatingFileHandler):
            existing.close()
    root.addHandler(handler)
    root.setLevel(level)
    if log_file:
        try:
            Path(log_file).parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.handlers.RotatingFileHandler(
                log_file, maxBytes=50_000_000, backupCount=5, encoding="utf-8"
            )
            file_handler.setFormatter(JsonFormatter())
            root.addHandler(file_handler)
        except OSError as error:
            logging.getLogger(__name__).error("cannot write the log file %s: %s", log_file, error)
    # uvicorn would print its own access lines (without request ids or arguments).
    logging.getLogger("uvicorn.access").disabled = True


# What may be logged

# "token" alone, "id_token" and "access_token" are secrets; "tokens" (the game currency),
# "token_pot" and "pass_and_play" are not, and hiding them would hide what to reproduce.
_SECRET_KEY: Final = re.compile(
    r"password|passwd|passcode|secret|(^|[_-])token$|api[_-]?key|authorization|credential"
    r"|private[_-]?key|cookie|verification|vapid|smtp",
    re.I,
)
_MAX_STRING: Final = 400


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "replace")).hexdigest()[:12]


def redact(value: Any, *, keep_long_strings: bool = False, _depth: int = 0) -> Any:
    """A copy of [value] that is safe to log: secrets are hidden, and long strings (a
    game's code) become a length and a hash, unless [keep_long_strings]."""
    if _depth > 12:
        return "<too deep>"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            name = str(key)
            if _SECRET_KEY.search(name) or (
                name == "code" and isinstance(item, str) and len(item) <= 12
            ):
                out[name] = "<redacted>"
            else:
                out[name] = redact(item, keep_long_strings=keep_long_strings, _depth=_depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        items = [
            redact(item, keep_long_strings=keep_long_strings, _depth=_depth + 1)
            for item in list(value)[:200]
        ]
        if len(value) > 200:
            items.append(f"<{len(value) - 200} more items>")
        return items
    if isinstance(value, str) and not keep_long_strings and len(value) > _MAX_STRING:
        return f"<{len(value)} chars, sha256 {_digest(value)}>"
    return value


def capture(value: Any, limit_bytes: int, *, keep_long_strings: bool = False) -> Any:
    """[value] redacted for logging, and replaced by a summary (size, hash and the
    start) when its JSON is larger than [limit_bytes]."""
    safe = redact(value, keep_long_strings=keep_long_strings)
    try:
        text = json.dumps(safe, default=str, ensure_ascii=False, sort_keys=True)
    except (TypeError, ValueError):
        text = repr(safe)
    if len(text.encode("utf-8", "replace")) <= limit_bytes:
        return safe
    return {
        "_truncated": True,
        "bytes": len(text.encode("utf-8", "replace")),
        "sha256": _digest(text),
        "head": text[: min(500, limit_bytes)],
    }


_SECRET_TEXT: Final = re.compile(
    r"(?i)(password|passwd|passcode|secret|token|authorization|api[_-]?key)\s*[=:]\s*[^\s,;&\"']+"
    r"|bearer\s+[^\s,;&\"']+"
)
_OPAQUE_RUN: Final = re.compile(r"[A-Za-z0-9_\-]{32,}")


def scrub_text(text: str, limit: int) -> str:
    """Free text from a browser, made safe to log: control characters removed, anything
    that looks like a secret (`password=...`, `Bearer ...`, a long random-looking run) hidden, and
    cut to [limit] characters."""
    text = "".join(ch for ch in text if ch.isprintable() or ch in " ")
    text = _SECRET_TEXT.sub("<redacted>", text)
    return _OPAQUE_RUN.sub("<redacted>", text)[:limit]


def redact_query(query: str) -> dict[str, str]:
    return {
        key: "<redacted>" if _SECRET_KEY.search(key) else value[:200]
        for key, value in urllib.parse.parse_qsl(query, keep_blank_values=True)
    }


def _stack_of(frame: Any, frames: int) -> list[tuple[str, int, str]]:
    """(file, line, function) of [frame]'s innermost [frames] calls, innermost first."""
    return [
        (item.filename, item.lineno, item.name)
        for item in reversed(traceback.extract_stack(frame)[-frames:])
    ]


def _format_stack(stack: list[tuple[str, int, str]]) -> list[str]:
    return [f"{Path(filename).name}:{lineno} {name}" for filename, lineno, name in stack]


_THIS_FILE: Final = Path(__file__).resolve()
_PACKAGE_DIR: Final = _THIS_FILE.parent


def _blocking_frame(stack: list[tuple[str, int, str]]) -> str | None:
    """The innermost call of [stack] that is the platform's own code (api.py:1840
    _choose_locale), since the innermost call overall is often deep in a library; else the
    innermost one."""
    ours = [
        item
        for item in stack
        if Path(item[0]).resolve().is_relative_to(_PACKAGE_DIR)
        and Path(item[0]).resolve() != _THIS_FILE
        and not {"site-packages", "dist-packages"} & set(Path(item[0]).parts)
    ]
    chosen = (ours or stack or [None])[0]
    return _format_stack([chosen])[0] if chosen else None


def thread_stacks(
    max_threads: int = 25, frames: int = 8, only: int | None = None
) -> dict[str, list[str]]:
    """Where every thread is right now (innermost call first), to see what a stuck
    request is waiting for. [only] is a thread id: just that thread."""
    names = {thread.ident: thread.name for thread in threading.enumerate()}
    stacks: dict[str, list[str]] = {}
    for ident, frame in list(sys._current_frames().items()):
        if only is not None and ident != only:
            continue
        if len(stacks) >= max_threads:
            break
        stacks[f"{names.get(ident, 'thread')}-{ident}"] = _format_stack(_stack_of(frame, frames))
    return stacks


def group_thread_stacks(
    stacks: dict[str, list[str]], examples: int = 3, top: int = 8
) -> list[dict[str, Any]]:
    """Threads that are in the same place (same innermost call) counted together, the
    most common first: "12 threads wait in socket.py:708 recv_into" is the cause, not 12
    stack traces. The [examples] biggest groups also show one whole stack."""
    groups: dict[str, list[list[str]]] = {}
    for stack in stacks.values():
        groups.setdefault(stack[0] if stack else "<no frames>", []).append(stack)
    ranked = sorted(groups.items(), key=lambda item: -len(item[1]))[:top]
    return [
        {"frame": frame, "threads": len(members)}
        | ({"example_stack": members[0]} if index < examples else {})
        for index, (frame, members) in enumerate(ranked)
    ]


# A path segment that is an id (a number, a uuid or hex id, a long token), not a name.
_ID_SEGMENT: Final = re.compile(
    r"^(?:\d+|[0-9a-fA-F]{8,}(?:-[0-9a-fA-F]+)*|(?=[^/]*\d)[A-Za-z0-9_-]{20,})$"
)
_TEMPLATE_PARAM: Final = re.compile(r"\{[^}]*\}")


def normalize_path(path: str, route: str | None = None) -> str:
    """[path] with every id replaced by `{id}`, so /matches/3f9c.../join and
    /matches/a81e.../join count as one endpoint. [route] is the route's template
    (/matches/{match_id}/join), when known, and is the exact answer."""
    if route:
        return _TEMPLATE_PARAM.sub("{id}", route)
    return "/".join("{id}" if _ID_SEGMENT.match(part) else part for part in path.split("/"))


def read_memory() -> tuple[int, int] | None:
    """(this process's resident memory, the machine's total memory) in bytes, or None
    where /proc isn't available (not Linux)."""
    try:
        status = Path("/proc/self/status").read_text()
        meminfo = Path("/proc/meminfo").read_text()
        rss = int(re.search(r"VmRSS:\s+(\d+) kB", status).group(1)) * 1024  # type: ignore[union-attr]
        total = int(re.search(r"MemTotal:\s+(\d+) kB", meminfo).group(1)) * 1024  # type: ignore[union-attr]
        return rss, total
    except (OSError, AttributeError, ValueError):
        return None


def read_cpu() -> tuple[float, int | None, int | None]:
    """(CPU seconds this process has used, the machine's busy and total CPU ticks). The
    machine's are None where /proc isn't available (not Linux)."""
    process = time.process_time()
    try:
        fields = [int(value) for value in Path("/proc/stat").read_text().splitlines()[0].split()[1:9]]
        total = sum(fields)
        return process, total - fields[3] - fields[4], total  # not idle, not waiting for I/O
    except (OSError, ValueError, IndexError):
        return process, None, None


# The monitor: counts what happens and raises alerts


class Monitor:
    """Counts requests, sign-ups and errors, and writes alert events when a threshold is
    passed. [tick] runs the periodic checks; [start] runs it in a background thread."""

    def __init__(
        self,
        config: MonitoringConfig | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        memory: Callable[[], tuple[int, int] | None] = read_memory,
        cpu: Callable[[], tuple[float, int | None, int | None]] = read_cpu,
    ) -> None:
        self.config = config or MonitoringConfig()
        self._clock = clock
        self._memory = memory
        self._cpu = cpu
        self._lock = threading.Lock()
        self._in_flight: dict[str, dict[str, Any]] = {}
        self._signups: collections.deque[tuple[float, str]] = collections.deque()
        self._last_alert: dict[str, float] = {}
        # The last minute, for the context of an alert: finished requests as
        # (finished_at, client, "METHOD /path/{id}", duration_ms, status)...
        self._recent: collections.deque[tuple[float, str, str, float, int]] = collections.deque(
            maxlen=20_000
        )
        # ...store calls as (at, operation, duration_ms, on the event loop's thread)...
        self._store_recent: collections.deque[tuple[float, str, float, bool]] = collections.deque(
            maxlen=20_000
        )
        # ...CPU readings as (at, process seconds, machine busy ticks, machine ticks)...
        self._cpu_samples: collections.deque[tuple[float, float, int | None, int | None]] = (
            collections.deque(maxlen=120)
        )
        self._cpu_samples.append((clock(), *cpu()))
        # ...memory readings as (at, rss), for growth...
        self._rss_samples: collections.deque[tuple[float, int]] = collections.deque(maxlen=1000)
        # ...event loop lag measurements as (at, ms), and the stack found by the last block.
        self._lag_samples: collections.deque[tuple[float, float]] = collections.deque(maxlen=200)
        self._last_block: tuple[float, float, list[str]] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._loop_thread: int | None = None
        # Browser error reports: per client, and all of them in the last minute.
        self._client_error_times: dict[str, collections.deque[float]] = {}
        self._client_errors: collections.deque[tuple[float, str, str, str, str]] = collections.deque(
            maxlen=2000
        )
        self._window_started = clock()
        self._reset_window()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _reset_window(self) -> None:
        self._durations: list[float] = []
        self._statuses: collections.Counter[str] = collections.Counter()
        self._counts: collections.Counter[str] = collections.Counter()
        self._max_in_flight = len(self._in_flight)
        self._store_calls: list[tuple[str, float, bool]] = []
        self._lag_max: float | None = None
        self._window_started = self._clock()

    def may_alert(self, name: str) -> bool:
        """True at most once per alert_cooldown_seconds for [name]. Use it so a problem
        that repeats on every request raises one alert, not hundreds."""
        with self._lock:
            return self._may_alert(name)

    # Alerts are rate-limited, so one problem is one email or page, not hundreds.
    def _may_alert(self, name: str) -> bool:
        now = self._clock()
        last = self._last_alert.get(name)
        if last is not None and now - last < self.config.alert_cooldown_seconds:
            return False
        self._last_alert[name] = now
        return True

    # Requests

    def request_started(self, info: dict[str, Any]) -> str:
        request_id = info["request_id"]
        busy = overloaded = False
        with self._lock:
            self._in_flight[request_id] = {**info, "started": self._clock(), "reported": False}
            count = len(self._in_flight)
            self._max_in_flight = max(self._max_in_flight, count)
            if count >= self.config.overloaded_in_flight:
                overloaded = self._may_alert("server_overloaded")
            elif count >= self.config.busy_in_flight:
                busy = self._may_alert("server_busy")
        if overloaded:
            log_event(
                "server_overloaded",
                f"{count} requests are being handled at once",
                level=logging.CRITICAL,
                alert="major",
                in_flight=count,
                limit=self.config.overloaded_in_flight,
                oldest=self._oldest_in_flight(),
                **self.diagnose("server_overloaded"),
            )
        elif busy:
            log_event(
                "server_busy",
                f"{count} requests are being handled at once",
                level=logging.WARNING,
                alert="minor",
                in_flight=count,
                limit=self.config.busy_in_flight,
                **self.diagnose("server_busy"),
            )
        return request_id

    def _oldest_in_flight(self) -> list[dict[str, Any]]:
        with self._lock:
            now = self._clock()
            oldest = sorted(self._in_flight.values(), key=lambda item: item["started"])[:5]
            return [
                {
                    "method": item["method"],
                    "path": item["path"],
                    "running_ms": int((now - item["started"]) * 1000),
                }
                for item in oldest
            ]

    def request_finished(
        self, request_id: str, status: int, duration_ms: float, route: str | None = None
    ) -> None:
        """[route] is the matched route's template (/matches/{match_id}), when known."""
        with self._lock:
            info = self._in_flight.pop(request_id, None)
            if info is not None:
                self._recent.append(
                    (
                        self._clock(),
                        str(info.get("client") or "unknown"),
                        f"{info['method']} {normalize_path(info['path'], route)}",
                        duration_ms,
                        status,
                    )
                )
            self._durations.append(duration_ms)
            if len(self._durations) > 50_000:
                del self._durations[: len(self._durations) // 2]
            self._statuses[f"{status // 100}xx"] += 1
            if duration_ms >= self.config.slow_request_ms:
                self._counts["slow"] += 1

    def snapshot(self) -> dict[str, Any]:
        """What the monitor sees right now (for the admin page and the alert drill)."""
        now = self._clock()
        with self._lock:
            signups = sum(1 for at, _ in self._signups if now - at <= 60)
            in_flight = len(self._in_flight)
        reading = self._memory()
        cpu = self.cpu_usage()
        return {
            "event_loop_lag_ms": self._recent_lag(),
            "process_cpu_percent": cpu["process_cpu_percent"],
            "machine_cpu_percent": cpu["machine_cpu_percent"],
            "in_flight": in_flight,
            "oldest_in_flight": self._oldest_in_flight(),
            "signups_last_minute": signups,
            "memory_percent": round(100.0 * reading[0] / reading[1], 1) if reading and reading[1] else None,
            "thresholds": self.config.model_dump(),
        }

    def count(self, name: str) -> None:
        """Counts an event for the next "metrics" line (illegal_move, game_error...)."""
        with self._lock:
            self._counts[name] += 1

    # Event loop lag

    def bind_loop(self, loop: asyncio.AbstractEventLoop, thread_id: int | None = None) -> None:
        """Tells the monitor which asyncio loop serves requests, and the id of the thread
        that runs it (default: the calling thread). The request middleware calls this, so
        it is always the running server's loop."""
        if self._loop is not loop:
            self._loop = loop
            self._loop_thread = thread_id if thread_id is not None else threading.get_ident()

    def measure_loop_lag(self) -> tuple[float, list[tuple[str, int, str]] | None] | None:
        """How long (ms) a tiny task scheduled on the server's event loop waited before it
        ran: near 0 normally, long when something blocks the loop (a database read or
        a slow computation in an `async def`). When the wait passes
        event_loop_blocked_ms, also the loop thread's stack at that moment, which is
        the blocking line. None when there is no loop running yet."""
        loop, thread = self._loop, self._loop_thread
        if loop is None or loop.is_closed() or not loop.is_running():
            return None
        ran = threading.Event()
        started = time.perf_counter()
        try:
            loop.call_soon_threadsafe(ran.set)
        except RuntimeError:  # the loop closed just now
            return None
        stack = None
        if not ran.wait(self.config.event_loop_blocked_ms / 1000):
            frame = sys._current_frames().get(thread) if thread is not None else None
            stack = _stack_of(frame, 12) if frame is not None else None
            # Not forever: a loop that never answers must not hang the monitor too.
            ran.wait(max(10.0, 3 * self.config.event_loop_blocked_critical_ms / 1000))
        return (time.perf_counter() - started) * 1000, stack

    def _check_event_loop(self) -> None:
        measured = self.measure_loop_lag()
        if measured is None:
            return
        lag, stack = measured
        now = self._clock()
        config = self.config
        with self._lock:
            self._lag_samples.append((now, lag))
            self._lag_max = max(lag, self._lag_max or 0.0)
            critical = lag >= config.event_loop_blocked_critical_ms and self._may_alert(
                "event_loop_blocked_critical"
            )
            minor = (
                not critical
                and lag >= config.event_loop_blocked_ms
                and self._may_alert("event_loop_blocked")
            )
            if lag >= config.event_loop_blocked_ms:
                self._last_block = (now, lag, _format_stack(stack or []))
        if not (critical or minor):
            return
        frame = _blocking_frame(stack or [])
        log_event(
            "event_loop_blocked",
            f"the event loop was blocked for {lag:.0f} ms" + (f" in {frame}" if frame else ""),
            level=logging.CRITICAL if critical else logging.WARNING,
            alert="major" if critical else "minor",
            event_loop_lag_ms=round(lag),
            threshold_ms=config.event_loop_blocked_critical_ms if critical else config.event_loop_blocked_ms,
            blocking_frame=frame,
            event_loop_stack=_format_stack(stack or []),
            oldest=self._oldest_in_flight(),
            likely_cause=(
                f"a blocking call on the event loop at {frame}: every request waits behind it "
                "(run it in a thread with run_in_threadpool, or make it async)"
                if frame
                else "the event loop is blocked; the stack could not be read"
            ),
        )

    def _recent_lag(self) -> int | None:
        """The worst event loop lag in the last minute, in ms."""
        now = self._clock()
        with self._lock:
            lags = [ms for at, ms in self._lag_samples if now - at <= 60]
        return round(max(lags)) if lags else None

    # Store calls

    def note_store_call(self, operation: str, duration_ms: float) -> None:
        """A database call took [duration_ms] (see TimedStore). A call made on the event
        loop's own thread is counted separately: it blocks every request."""
        on_loop = self._loop_thread is not None and threading.get_ident() == self._loop_thread
        with self._lock:
            self._store_calls.append((operation, duration_ms, on_loop))
            if len(self._store_calls) > 50_000:
                del self._store_calls[: len(self._store_calls) // 2]
            self._store_recent.append((self._clock(), operation, duration_ms, on_loop))

    @staticmethod
    def _store_summary(calls: list[tuple[str, float, bool]]) -> dict[str, Any]:
        """Count and time of database [calls] as metrics fields."""
        durations = sorted(ms for _, ms, _ in calls)
        by_operation: dict[str, list[float]] = {}
        for operation, ms, _ in calls:
            by_operation.setdefault(operation, []).append(ms)
        slowest = sorted(by_operation.items(), key=lambda item: -sum(item[1]))[:5]
        on_loop = [ms for _, ms, loop in calls if loop]
        return {
            "store_calls": len(calls),
            "store_total_ms": round(sum(durations)),
            "store_p95_ms": round(durations[min(len(durations) - 1, int(len(durations) * 0.95))]) if durations else 0,
            "store_max_ms": round(durations[-1]) if durations else 0,
            "store_slowest": [
                {"operation": name, "calls": len(values), "total_ms": round(sum(values)), "max_ms": round(max(values))}
                for name, values in slowest
            ],
            "store_calls_on_event_loop": len(on_loop),
            "store_ms_on_event_loop": round(sum(on_loop)),
        }

    # What is probably wrong

    def cpu_usage(self) -> dict[str, Any]:
        """CPU use over the last minute: this process (100 = one whole core) and the
        machine (percent of all its cores; None where /proc isn't available)."""
        now = self._clock()
        reading = self._cpu()
        with self._lock:
            base = next((sample for sample in self._cpu_samples if now - sample[0] <= 60), None)
        usage: dict[str, Any] = {
            "process_cpu_percent": None,
            "machine_cpu_percent": None,
            "cpu_count": os.cpu_count(),
        }
        if base is None or now - base[0] < 0.5:
            return usage
        usage["process_cpu_percent"] = round(100.0 * (reading[0] - base[1]) / (now - base[0]), 1)
        if None not in (reading[1], reading[2], base[2], base[3]) and reading[2] > base[3]:  # type: ignore[operator]
            usage["machine_cpu_percent"] = round(
                100.0 * (reading[1] - base[2]) / (reading[2] - base[3]), 1  # type: ignore[operator]
            )
        return usage

    def context(self, top: int = 5, window_seconds: float = 60) -> dict[str, Any]:
        """What the server was doing in the last minute (or [window_seconds]), for an
        alert: the [top] clients
        and endpoints by requests and by total time (requests still running count for the
        time so far), where the threads are, and the CPU use."""
        now = self._clock()
        with self._lock:
            rows = [
                (client, path, ms, status)
                for at, client, path, ms, status in self._recent
                if now - at <= window_seconds
            ]
            rows += [
                (
                    str(item.get("client") or "unknown"),
                    f"{item['method']} {normalize_path(item['path'])}",
                    (now - item["started"]) * 1000,
                    0,
                )
                for item in self._in_flight.values()
            ]
            store = [(op, ms, on_loop) for at, op, ms, on_loop in self._store_recent if now - at <= window_seconds]

        def ranked(index: int, name: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
            groups: dict[str, list[float]] = {}
            for row in rows:
                group = groups.setdefault(row[index], [0, 0.0, 0])
                group[0] += 1
                group[1] += row[2]
                group[2] += row[3] >= 500
            entries = [
                {name: key, "requests": int(v[0]), "total_ms": round(v[1]), "errors_5xx": int(v[2])}
                for key, v in groups.items()
            ]
            return (
                sorted(entries, key=lambda e: -e["requests"])[:top],
                sorted(entries, key=lambda e: -e["total_ms"])[:top],
            )

        clients_by_requests, clients_by_time = ranked(0, "client")
        paths_by_requests, paths_by_time = ranked(1, "path")
        block = self._last_block
        return {
            "window_seconds": round(window_seconds),
            "requests_last_minute": len(rows),
            "errors_5xx_last_minute": sum(1 for row in rows if row[3] >= 500),
            "top_clients_by_requests": clients_by_requests,
            "top_clients_by_time": clients_by_time,
            "top_paths_by_requests": paths_by_requests,
            "top_paths_by_time": paths_by_time,
            "thread_groups": group_thread_stacks(thread_stacks()),
            **self.cpu_usage(),
            "event_loop_lag_ms": self._recent_lag(),
            **(
                {"event_loop_blocked_stack": block[2]}
                if block is not None and now - block[0] <= 60
                else {}
            ),
            **self._store_summary(store),
        }

    def likely_cause(self, kind: str, context: dict[str, Any]) -> str:
        """The most probable reason for the alert [kind], from simple rules over
        [context] (see [context]). The rules are in order of how directly they point
        at a fix; up to three that apply are joined."""
        config = self.config
        reasons: list[str] = []
        total = context["requests_last_minute"]
        lag = context.get("event_loop_lag_ms")
        if lag is not None and lag >= config.event_loop_blocked_ms:
            stack = context.get("event_loop_blocked_stack") or []
            reasons.append(
                f"the event loop was blocked for up to {lag} ms (see event_loop_blocked_stack"
                + (f": {stack[0]}" if stack else "")
                + "): a blocking call in an async function delays every request"
            )
        if context["store_ms_on_event_loop"] >= 100:
            reasons.append(
                f"{context['store_calls_on_event_loop']} database calls took {context['store_ms_on_event_loop']} ms "
                "on the event loop's own thread: run them with run_in_threadpool"
            )
        if context["store_p95_ms"] >= config.store_slow_p95_ms and context["store_calls"] >= STORE_SLOW_MIN_CALLS:
            slowest = (context["store_slowest"] or [{}])[0].get("operation", "?")
            reasons.append(f"database calls are slow (95% within {context['store_p95_ms']} ms; most time in {slowest})")
        top_client = (context["top_clients_by_requests"] or [None])[0]
        if top_client and total >= 10 and top_client["requests"] > total / 2:
            reasons.append(
                f"one client generates most of the load: {top_client['client']} sent "
                f"{top_client['requests']} of {total} requests"
            )
        errors = context["errors_5xx_last_minute"]
        if kind.startswith("error_rate") and errors:
            worst = max(context["top_paths_by_requests"], key=lambda e: e["errors_5xx"], default=None)
            if worst and worst["errors_5xx"] >= 3 and worst["errors_5xx"] > errors / 2:
                reasons.append(
                    f"most 5xx answers ({worst['errors_5xx']} of {errors}) are on {worst['path']}: "
                    "look at its http_5xx lines"
                )
        reading = self._memory()
        if reading and reading[1] and 100.0 * reading[0] / reading[1] >= config.memory_warn_percent:
            growth = self._rss_growth_mb()
            reasons.append(
                f"memory is high ({reading[0] // 1_000_000} MB, {100.0 * reading[0] / reading[1]:.0f}% of the machine)"
                + (f" and grew {growth} MB in 10 minutes" if growth else "")
                + ": look for a leak"
            )
        process, machine = context.get("process_cpu_percent"), context.get("machine_cpu_percent")
        slow_kind = kind.startswith(("latency", "server_"))
        idle = process is not None and process < 50 and (machine is None or machine < 50)
        if process is not None and process >= 90 and slow_kind:
            top_time = (context["top_paths_by_time"] or [{}])[0].get("path")
            reasons.append(
                f"the server process uses {process:.0f}% of a CPU core, so it is compute-bound"
                + (f"; most time is in {top_time}" if top_time else "")
            )
        elif idle and slow_kind and not reasons:
            reasons.append(
                "requests are waiting on I/O or a blocked event loop, not on the CPU "
                f"(process CPU {process:.0f}%): see event_loop_lag_ms and thread_groups"
            )
        by_time = context["top_paths_by_time"]
        if len(by_time) > 1 and total >= 10 and not reasons:
            if by_time[0]["total_ms"] * 2 > sum(e["total_ms"] for e in by_time):
                reasons.append(f"most request time is spent in {by_time[0]['path']}")
        return "; ".join(reasons[:3]) or (
            "no single cause found: see top_paths_by_time, top_clients_by_requests and thread_groups"
        )

    def _rss_growth_mb(self) -> int:
        now = self._clock()
        with self._lock:
            samples = [(at, rss) for at, rss in self._rss_samples if now - at <= 600]
        return round((samples[-1][1] - samples[0][1]) / 1e6) if len(samples) > 1 else 0

    def diagnose(self, kind: str, window_seconds: float = 60) -> dict[str, Any]:
        """The context for the alert [kind] plus its `likely_cause`, as log fields."""
        context = self.context(window_seconds=window_seconds)
        return {**context, "likely_cause": self.likely_cause(kind, context)}

    # Browser error reports

    def take_client_error_slot(self, client: str) -> bool:
        """Whether [client] may send another browser error report this minute; False
        (and the report is dropped) after client_errors_per_client_per_minute."""
        now = self._clock()
        with self._lock:
            times = self._client_error_times.setdefault(client, collections.deque())
            while times and now - times[0] > 60:
                times.popleft()
            if len(times) >= self.config.client_errors_per_client_per_minute:
                self._counts["client_errors_rejected"] += 1
                return False
            times.append(now)
            if len(self._client_error_times) > 5000:
                for key in [k for k, v in self._client_error_times.items() if not v or now - v[-1] > 60]:
                    del self._client_error_times[key]
        return True

    def log_client_error(self, client: str, report: dict[str, str]) -> None:
        """Logs a `client_error` event for a report that [take_client_error_slot] let in.
        Many of them in a minute, from anyone, is a minor alert."""
        now = self._clock()
        config = self.config
        with self._lock:
            self._counts["client_errors"] += 1
            self._client_errors.append(
                (now, client, report.get("kind", ""), report.get("page", ""), report.get("message", "")[:120])
            )
            recent = [e for e in self._client_errors if now - e[0] <= 60]
            spike = len(recent) >= config.client_error_spike_per_minute and self._may_alert("client_error_spike")
        log_event(
            "client_error",
            report.get("message") or "a browser reported an error",
            level=logging.WARNING,
            client=client,
            kind=report.get("kind"),
            error_message=report.get("message"),
            page=report.get("page"),
            user_agent=report.get("user_agent"),
        )
        if spike:
            log_event(
                "client_error_spike",
                f"{len(recent)} browser errors reported in the last minute",
                level=logging.WARNING,
                alert="minor",
                reports_last_minute=len(recent),
                threshold=config.client_error_spike_per_minute,
                clients=len({e[1] for e in recent}),
                top_kinds=collections.Counter(e[2] for e in recent).most_common(5),
                top_pages=collections.Counter(e[3] for e in recent).most_common(5),
                top_messages=collections.Counter(e[4] for e in recent).most_common(5),
            )

    # Sign-ups

    def note_signup(self, user_id: str) -> None:
        """A new account was created: a flood of them is probably bots."""
        now = self._clock()
        with self._lock:
            self._counts["signups"] += 1
            self._signups.append((now, CLIENT.get() or "unknown"))
            while self._signups and now - self._signups[0][0] > 60:
                self._signups.popleft()
            recent = len(self._signups)
            clients = collections.Counter(client for _, client in self._signups)
            flood = recent >= self.config.signup_flood_per_minute and self._may_alert("signup_flood")
            surge = (
                not flood
                and recent >= self.config.signup_surge_per_minute
                and self._may_alert("signup_surge")
            )
        details = {
            "signups_last_minute": recent,
            "top_clients": clients.most_common(5),
            "latest_user_id": user_id,
        }
        if flood:
            log_event(
                "signup_flood",
                f"{recent} accounts were created in the last minute",
                level=logging.CRITICAL,
                alert="major",
                threshold=self.config.signup_flood_per_minute,
                **details,
            )
        elif surge:
            log_event(
                "signup_surge",
                f"{recent} accounts were created in the last minute",
                level=logging.WARNING,
                alert="minor",
                threshold=self.config.signup_surge_per_minute,
                **details,
            )

    # Periodic checks

    def tick(self) -> None:
        """Reports stuck requests and high memory, then (once per interval) a metrics
        line with the totals since the last one."""
        self._check_event_loop()
        with self._lock:
            self._cpu_samples.append((self._clock(), *self._cpu()))
        self._check_stuck_requests()
        self._check_memory()
        if self._clock() - self._window_started >= self.config.metrics_interval_seconds:
            self._emit_metrics()

    def _check_stuck_requests(self) -> None:
        now = self._clock()
        stuck: list[dict[str, Any]] = []
        with self._lock:
            for item in self._in_flight.values():
                if not item["reported"] and now - item["started"] >= self.config.stuck_request_seconds:
                    item["reported"] = True
                    stuck.append(dict(item))
        if not stuck:
            return
        stacks = thread_stacks()
        for item in stuck:
            log_event(
                "request_stuck",
                f"{item['method']} {item['path']} has been running for "
                f"{int(now - item['started'])}s",
                level=logging.ERROR,
                alert="minor",
                request_id_stuck=item["request_id"],
                running_seconds=round(now - item["started"], 1),
                method=item["method"],
                path=item["path"],
                query=item.get("query"),
                user_id=item.get("user_id"),
                client=item.get("client"),
                body=item["body"]() if callable(item.get("body")) else item.get("body"),
                thread_stacks=stacks,
            )

    def _check_memory(self) -> None:
        reading = self._memory()
        if reading is None:
            return
        rss, total = reading
        percent = 100.0 * rss / total if total else 0.0
        with self._lock:
            self._rss_samples.append((self._clock(), rss))
            critical = percent >= self.config.memory_critical_percent and self._may_alert("memory_critical")
            warn = (
                not critical
                and percent >= self.config.memory_warn_percent
                and self._may_alert("memory_high")
            )
        details = {"rss_mb": round(rss / 1e6), "total_mb": round(total / 1e6), "percent": round(percent, 1)}
        if critical:
            log_event(
                "memory_critical",
                f"the server uses {percent:.0f}% of the machine's memory",
                level=logging.CRITICAL,
                alert="major",
                threshold_percent=self.config.memory_critical_percent,
                rss_growth_mb_10min=self._rss_growth_mb(),
                **details,
            )
        elif warn:
            log_event(
                "memory_high",
                f"the server uses {percent:.0f}% of the machine's memory",
                level=logging.WARNING,
                alert="minor",
                threshold_percent=self.config.memory_warn_percent,
                rss_growth_mb_10min=self._rss_growth_mb(),
                **details,
            )

    def _emit_metrics(self) -> None:
        with self._lock:
            durations = sorted(self._durations)
            statuses = dict(self._statuses)
            counts = dict(self._counts)
            max_in_flight = self._max_in_flight
            store_calls = list(self._store_calls)
            lag_max = self._lag_max
            seconds = max(self._clock() - self._window_started, 0.001)
            self._reset_window()
            self._max_in_flight = len(self._in_flight)
        total = len(durations)

        def percentile(fraction: float) -> int:
            return int(durations[min(total - 1, int(total * fraction))]) if total else 0

        errors = statuses.get("5xx", 0)
        illegal = counts.get("illegal_moves", 0)
        reading = self._memory()
        store = self._store_summary(store_calls)
        cpu = self.cpu_usage()
        log_event(
            "metrics",
            f"{total} requests in {seconds:.0f}s",
            window_seconds=round(seconds),
            requests=total,
            status=statuses,
            errors_5xx=errors,
            latency_p50_ms=percentile(0.5),
            latency_p95_ms=percentile(0.95),
            latency_max_ms=int(durations[-1]) if total else 0,
            slow_requests=counts.pop("slow", 0),
            max_in_flight=max_in_flight,
            rss_mb=round(reading[0] / 1e6) if reading else None,
            event_loop_lag_ms=round(lag_max) if lag_max is not None else None,
            process_cpu_percent=cpu["process_cpu_percent"],
            machine_cpu_percent=cpu["machine_cpu_percent"],
            **store,
            **counts,
        )
        if (
            store["store_calls"] >= STORE_SLOW_MIN_CALLS
            and store["store_p95_ms"] >= self.config.store_slow_p95_ms
            and self._may_alert("store_slow")
        ):
            context = {**self.context(window_seconds=seconds + 5), **store}
            log_event(
                "store_slow",
                f"95% of {store['store_calls']} database calls finish within {store['store_p95_ms']} ms, but that is slow",
                level=logging.WARNING,
                alert="minor",
                threshold_ms=self.config.store_slow_p95_ms,
                likely_cause=self.likely_cause("store_slow", context),
                **store,
            )
        if illegal >= ILLEGAL_MOVE_SPIKE and self._may_alert("illegal_move_spike"):
            log_event("illegal_move_spike", f"{illegal} illegal moves in {seconds:.0f}s",
                      level=logging.WARNING, alert="minor", illegal_moves=illegal,
                      threshold=ILLEGAL_MOVE_SPIKE)
        # Many requests failing or crawling is an outage even if no single one was
        # alarming.
        if total >= 20:
            rate = errors / total
            p95 = percentile(0.95)
            if rate >= 0.25 and self._may_alert("error_rate_critical"):
                log_event("error_rate_critical", f"{rate:.0%} of requests failed with 5xx",
                          level=logging.CRITICAL, alert="major", requests=total, errors_5xx=errors,
                          **self.diagnose("error_rate_critical", seconds + 5))
            elif rate >= 0.05 and self._may_alert("error_rate_high"):
                log_event("error_rate_high", f"{rate:.0%} of requests failed with 5xx",
                          level=logging.ERROR, alert="minor", requests=total, errors_5xx=errors,
                          **self.diagnose("error_rate_high", seconds + 5))
            if p95 >= self.config.very_slow_request_ms and self._may_alert("latency_critical"):
                log_event("latency_critical", f"95% of requests finish within {p95} ms, but that is too slow",
                          level=logging.CRITICAL, alert="major", requests=total, latency_p95_ms=p95,
                          **self.diagnose("latency_critical", seconds + 5))
            elif p95 >= self.config.slow_request_ms and self._may_alert("latency_high"):
                log_event("latency_high", f"95% of requests finish within {p95} ms, but that is slow",
                          level=logging.WARNING, alert="minor", requests=total, latency_p95_ms=p95,
                          **self.diagnose("latency_high", seconds + 5))

    # Background thread

    def start(self) -> None:
        """Runs [tick] every few seconds, unless metrics_interval_seconds is 0."""
        if self._thread is not None or self.config.metrics_interval_seconds <= 0:
            return
        self._stop.clear()
        period = max(1.0, min(2.0, self.config.metrics_interval_seconds))

        def loop() -> None:
            while not self._stop.wait(period):
                try:
                    self.tick()
                except Exception:  # monitoring must never take the server down
                    logger.exception("monitor tick failed")

        self._thread = threading.Thread(target=loop, name="monitor", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None


class TimedStore:
    """Wraps the platform's store and reports how long each call takes to the monitor
    (the `store_*` fields of the metrics line, and the `store_slow` alert). Everything
    else (attributes, `scalable`, `close`) is the wrapped store's own."""

    def __init__(self, store: Any, monitor: Monitor) -> None:
        object.__setattr__(self, "_inner", store)
        object.__setattr__(self, "_monitor", monitor)

    def __getattr__(self, name: str) -> Any:
        attribute = getattr(self._inner, name)
        if name.startswith("__") or name == "close" or not (
            inspect.ismethod(attribute) or inspect.isfunction(attribute)
        ):
            return attribute
        monitor = self._monitor

        @functools.wraps(attribute)
        def timed(*args: Any, **kwargs: Any) -> Any:
            started = time.perf_counter()
            try:
                return attribute(*args, **kwargs)
            finally:
                monitor.note_store_call(name, (time.perf_counter() - started) * 1000)

        return timed

    def __setattr__(self, name: str, value: Any) -> None:
        setattr(self._inner, name, value)


_current = Monitor()


def current() -> Monitor:
    """The monitor of the running app (a default one before an app is created)."""
    return _current


def set_current(monitor: Monitor) -> None:
    global _current
    _current = monitor


# The web server: one entry per noteworthy request, with its arguments

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]


def _client_of(scope: Scope, headers: dict[str, str]) -> str:
    forwarded = headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    client = scope.get("client")
    return client[0] if client else "unknown"


class RequestLogMiddleware:
    """Gives every request an id (returned as X-Request-Id), measures it, and logs the
    ones worth investigating together with everything needed to repeat them: slow ones,
    5xx answers and unexpected exceptions. Pure ASGI, so the body can be read for the
    log without disturbing the app."""

    def __init__(self, app: Callable[..., Awaitable[None]], monitor: Callable[[], Monitor] = current) -> None:
        self.app = app
        self._monitor = monitor

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        monitor = self._monitor()
        config = monitor.config
        monitor.bind_loop(asyncio.get_running_loop())
        headers = {
            key.decode("latin-1").lower(): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        request_id = headers.get("x-request-id", "")[:64] or uuid.uuid4().hex[:16]
        client = _client_of(scope, headers)
        method, path = scope["method"], scope["path"]
        query = scope.get("query_string", b"").decode("latin-1")
        body = bytearray()
        body_size = 0
        status = 0
        crashed = False

        async def receive_and_keep() -> MutableMapping[str, Any]:
            nonlocal body_size
            message = await receive()
            if message["type"] == "http.request":
                chunk = message.get("body", b"")
                body_size += len(chunk)
                if len(body) < config.max_logged_body_bytes + 1:
                    body.extend(chunk[: config.max_logged_body_bytes + 1 - len(body)])
            return message

        async def send_with_id(message: MutableMapping[str, Any]) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                message.setdefault("headers", [])
                message["headers"] = [*message["headers"], (b"x-request-id", request_id.encode())]
            await send(message)

        def describe() -> dict[str, Any]:
            """The request, as arguments that reproduce it."""
            info: dict[str, Any] = {
                "method": method,
                "path": path,
                "query": redact_query(query),
                "client": client,
                "user_id": headers.get("x-user-id"),
                "user_agent": headers.get("user-agent", "")[:200],
                "accept_language": headers.get("accept-language"),
                "body_bytes": body_size,
            }
            if body:
                info["body"] = self._body_for_log(bytes(body), headers, config, body_size)
            return info

        scope.setdefault("state", {})["request_id"] = request_id
        id_token = REQUEST_ID.set(request_id)
        client_token = CLIENT.set(client)
        started = time.perf_counter()
        monitor.request_started(
            {"request_id": request_id, "method": method, "path": path, "client": client,
             "query": redact_query(query), "user_id": headers.get("x-user-id"),
             "body": lambda: describe().get("body")}
        )
        try:
            await self.app(scope, receive_and_keep, send_with_id)
        except Exception as error:
            duration_ms = (time.perf_counter() - started) * 1000
            log_event(
                "unexpected_exception",
                f"{type(error).__name__} in {method} {path}: {error}",
                level=logging.ERROR,
                alert="minor",
                exc_info=sys.exc_info(),
                duration_ms=round(duration_ms),
                **describe(),
            )
            monitor.count("unexpected_exceptions")
            crashed = True
            status = status or 500
            raise
        finally:
            duration_ms = (time.perf_counter() - started) * 1000
            route = getattr(scope.get("route"), "path", None)
            monitor.request_finished(request_id, status or 500, duration_ms, route=route)
            self._log_if_noteworthy(monitor, status, duration_ms, describe, crashed=crashed)
            REQUEST_ID.reset(id_token)
            CLIENT.reset(client_token)

    @staticmethod
    def _body_for_log(
        raw: bytes, headers: dict[str, str], config: MonitoringConfig, total_size: int
    ) -> Any:
        if total_size > config.max_logged_body_bytes:
            return {"_truncated": True, "bytes": total_size, "head": raw[:200].decode("utf-8", "replace")}
        if "json" in headers.get("content-type", ""):
            try:
                return capture(json.loads(raw), config.max_logged_body_bytes)
            except ValueError:
                pass
        return {"_unparsed_bytes": total_size}

    @staticmethod
    def _log_if_noteworthy(
        monitor: Monitor,
        status: int,
        duration_ms: float,
        describe: Callable[[], dict[str, Any]],
        *,
        crashed: bool = False,
    ) -> None:
        config = monitor.config
        if crashed:
            return  # already logged, with its stack trace
        if status >= 500:
            monitor.count("errors_5xx_logged")
            log_event(
                "http_5xx",
                f"{status} after {duration_ms:.0f} ms",
                level=logging.ERROR,
                alert="minor",
                status=status,
                duration_ms=round(duration_ms),
                **describe(),
            )
        elif duration_ms >= config.very_slow_request_ms:
            log_event(
                "request_very_slow",
                f"{duration_ms:.0f} ms (limit {config.very_slow_request_ms} ms)",
                level=logging.ERROR,
                alert="minor",
                status=status,
                duration_ms=round(duration_ms),
                **describe(),
            )
        elif duration_ms >= config.slow_request_ms:
            log_event(
                "request_slow",
                f"{duration_ms:.0f} ms (limit {config.slow_request_ms} ms)",
                level=logging.WARNING,
                status=status,
                duration_ms=round(duration_ms),
                **describe(),
            )
