"""A stale-while-revalidate read cache in front of Firestore.

Query mode reads through to Firestore on every request. This cache keeps the
most recently read documents and query results in memory instead:

- a read is served from the cache whenever the entry is present;
- once an entry is older than [REFRESH_SECONDS], the next read still serves
  the cached value immediately and schedules one background refresh (at most
  one refresh per key per refresh window), so a value is never more than
  about a second stale -- which is what bounds the disagreement between
  processes when the platform runs on more than one VM;
- this process's own committed writes are written through at commit time, so
  a local read after a local write is never stale;
- the cache is LRU-evicted and capped at half the machine's RAM.

Transactional reads never touch this cache: a unit of work must read through
its Firestore transaction so conflict detection keeps working. The cache only
serves the store's non-transactional reads.
"""

import copy
import os
import queue
import threading
import time
from collections import OrderedDict

REFRESH_SECONDS = 1.0
_WORKERS = 4


def default_max_bytes() -> int:
    """Half the machine's physical RAM."""
    try:
        total = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (AttributeError, OSError, ValueError):
        return 512 * 1024 * 1024
    return max(total // 2, 1024 * 1024)


def estimate_size(value) -> int:
    """Approximate in-memory size of a Firestore document payload."""
    if value is None or isinstance(value, (bool, int, float)):
        return 16
    if isinstance(value, (str, bytes)):
        return 64 + len(value)
    if isinstance(value, dict):
        return 64 + sum(
            64 + len(str(k)) + estimate_size(v) for k, v in value.items()
        )
    if isinstance(value, (list, tuple)):
        return 64 + sum(estimate_size(v) for v in value)
    return 64


class _Entry:
    __slots__ = ("value", "size", "fresh_until", "refresh_after")

    def __init__(self, value, size, fresh_until, refresh_after):
        self.value = value
        self.size = size
        self.fresh_until = fresh_until
        self.refresh_after = refresh_after


class ReadCache:
    """Thread-safe LRU cache with background stale-while-revalidate refresh.

    Keys are opaque hashables; values are Firestore-shaped data (dicts, or
    None for a missing document). [submit] schedules background work; tests
    inject a synchronous submit, production uses a small daemon thread pool.
    """

    def __init__(
        self,
        *,
        max_bytes=None,
        refresh_seconds=REFRESH_SECONDS,
        clock=time.monotonic,
        submit=None,
    ):
        self._max_bytes = (
            default_max_bytes() if max_bytes is None else max_bytes
        )
        self._refresh_seconds = refresh_seconds
        self._clock = clock
        self._entries: OrderedDict = OrderedDict()
        self._total_bytes = 0
        self._lock = threading.Lock()
        self._inflight: set = set()
        self._jobs: queue.Queue | None = None
        self._workers_started = False
        self._closed = False
        self._submit = submit if submit is not None else self._enqueue

    # -- reads -------------------------------------------------------------

    def get_or_fetch(self, key, fetch):
        """The cached value for [key]; [fetch] loads it on a miss and on
        background refreshes. A stale hit is served immediately and schedules
        at most one refresh per refresh window."""
        job = None
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None:
                self._entries.move_to_end(key)
                if self._due_locked(key, entry):
                    job = lambda: self._refresh(key, fetch, entry)
                value = entry.value
            else:
                value = _MISSING
        if job is not None:
            self._submit(job)
        if value is not _MISSING:
            return copy.deepcopy(value)
        fresh = fetch()
        self.put(key, fresh)
        return fresh

    def get_or_fetch_many(self, keys, fetch_many):
        """{key: value} for every key in [keys]. [fetch_many] takes the keys
        that must be loaded synchronously (cache misses) and returns a value
        for each of them; stale hits are served and refreshed in one batch."""
        keys = list(keys)
        job = None
        with self._lock:
            values = {}
            missing = []
            stale = []
            for key in keys:
                entry = self._entries.get(key)
                if entry is None:
                    missing.append(key)
                    continue
                self._entries.move_to_end(key)
                values[key] = entry.value
                if self._due_locked(key, entry, mark=False):
                    stale.append(key)
            if stale:
                now = self._clock()
                due = []
                seen = {}
                for key in stale:
                    if key not in self._inflight:
                        self._inflight.add(key)
                        self._entries[key].refresh_after = (
                            now + self._refresh_seconds
                        )
                        due.append(key)
                        seen[key] = self._entries[key]
                if due:
                    job = lambda: self._refresh_many(due, fetch_many, seen)
        if job is not None:
            self._submit(job)
        if missing:
            fetched = fetch_many(missing)
            for key in missing:
                self.put(key, fetched[key])
                values[key] = fetched[key]
        return {key: copy.deepcopy(values[key]) for key in keys}

    # -- writes ------------------------------------------------------------

    def put(self, key, value):
        """Store [value] under [key] (write-through and refresh completion),
        evicting least-recently-used entries until the cache fits its budget.
        A single value larger than the whole budget is not cached."""
        size = estimate_size(value)
        with self._lock:
            old = self._entries.pop(key, None)
            if old is not None:
                self._total_bytes -= old.size
            if size > self._max_bytes:
                return
            while self._entries and self._total_bytes + size > self._max_bytes:
                _, evicted = self._entries.popitem(last=False)
                self._total_bytes -= evicted.size
            now = self._clock()
            self._entries[key] = _Entry(
                copy.deepcopy(value),
                size,
                now + self._refresh_seconds,
                now + self._refresh_seconds,
            )
            self._total_bytes += size

    def drop_where(self, predicate):
        """Evict every entry whose key satisfies [predicate]."""
        with self._lock:
            for key in [k for k in self._entries if predicate(k)]:
                self._total_bytes -= self._entries.pop(key).size

    def clear(self):
        """Evict everything; the next read of each key refetches."""
        with self._lock:
            self._entries.clear()
            self._total_bytes = 0

    # -- internals ---------------------------------------------------------

    def _due_locked(self, key, entry, *, mark=True):
        """Whether [entry] should be refreshed now; marks it in flight.
        refresh_after throttles attempts to one per window even when a
        refresh fails and the entry stays stale."""
        now = self._clock()
        if (
            now < entry.fresh_until
            or now < entry.refresh_after
            or key in self._inflight
        ):
            return False
        if mark:
            self._inflight.add(key)
            entry.refresh_after = now + self._refresh_seconds
        return True

    def _refresh(self, key, fetch, entry):
        try:
            value = fetch()
            with self._lock:
                # A write-through (or a newer refresh) may have replaced the
                # entry while the fetch was in flight; never regress it with
                # the older fetched value.
                current = self._entries.get(key)
                stale = current is entry or current is None
            if stale:
                self.put(key, value)
        except Exception:
            pass  # Keep serving the stale value; the next window retries.
        finally:
            with self._lock:
                self._inflight.discard(key)

    def _refresh_many(self, keys, fetch_many, seen):
        try:
            fetched = fetch_many(list(keys))
            for key in keys:
                with self._lock:
                    current = self._entries.get(key)
                    stale = current is seen[key] or current is None
                if stale:
                    self.put(key, fetched[key])
        except Exception:
            pass
        finally:
            with self._lock:
                self._inflight.difference_update(keys)

    def _enqueue(self, job):
        # The refresh pool starts lazily: most store instances (tests, short
        # lived tools) never schedule a refresh and never spawn threads.
        with self._lock:
            if self._closed:
                return
            if not self._workers_started:
                self._workers_started = True
                self._jobs = queue.Queue()
                for index in range(_WORKERS):
                    threading.Thread(
                        target=self._work_loop,
                        name=f"read-cache-refresh-{index}",
                        daemon=True,
                    ).start()
            jobs = self._jobs
        jobs.put(job)

    def _work_loop(self):
        while True:
            job = self._jobs.get()
            if job is None:
                return
            job()

    def close(self):
        with self._lock:
            self._closed = True
            jobs = self._jobs if self._workers_started else None
        if jobs is not None:
            for _ in range(_WORKERS):
                jobs.put(None)


class _Missing:
    pass


_MISSING = _Missing()
