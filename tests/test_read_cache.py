"""The stale-while-revalidate read cache in front of Firestore."""

from game_platform.read_cache import ReadCache, default_max_bytes, estimate_size
from game_platform.scaling_service import LOGIC_CACHE_LIMIT


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def make_cache(**kwargs):
    clock = Clock()
    jobs = []
    cache = ReadCache(clock=clock, submit=jobs.append, **kwargs)
    return cache, clock, jobs


def drain(jobs):
    while jobs:
        jobs.pop(0)()


def test_logic_cache_limit_is_2000():
    assert LOGIC_CACHE_LIMIT == 2000


def test_default_budget_is_positive():
    assert default_max_bytes() > 0


def test_miss_fetches_once_then_serves_from_cache():
    cache, clock, jobs = make_cache()
    calls = []
    fetch = lambda: calls.append(1) or {"v": len(calls)}
    assert cache.get_or_fetch("k", fetch) == {"v": 1}
    assert cache.get_or_fetch("k", fetch) == {"v": 1}
    assert len(calls) == 1
    assert jobs == []


def test_stale_hit_serves_old_value_and_refreshes_in_background():
    cache, clock, jobs = make_cache()
    source = [{"v": 1}]
    fetch = lambda: {"v": source[0]["v"]}
    assert cache.get_or_fetch("k", fetch) == {"v": 1}
    source[0]["v"] = 2
    clock.now += 0.5  # still fresh: no refresh scheduled
    assert cache.get_or_fetch("k", fetch) == {"v": 1}
    assert jobs == []
    clock.now += 1.0  # stale: served immediately, one refresh scheduled
    assert cache.get_or_fetch("k", fetch) == {"v": 1}
    assert len(jobs) == 1
    assert cache.get_or_fetch("k", fetch) == {"v": 1}  # no second refresh
    assert len(jobs) == 1
    drain(jobs)
    assert cache.get_or_fetch("k", fetch) == {"v": 2}


def test_failed_refresh_keeps_serving_the_stale_value():
    cache, clock, jobs = make_cache()
    assert cache.get_or_fetch("k", lambda: {"v": 1}) == {"v": 1}
    clock.now += 2.0

    def boom():
        raise RuntimeError("firestore unavailable")

    assert cache.get_or_fetch("k", boom) == {"v": 1}
    drain(jobs)  # the failed refresh must not raise or evict
    assert cache.get_or_fetch("k", lambda: {"v": 3}) == {"v": 1}
    assert jobs == []  # retries are throttled to one per refresh window
    clock.now += 1.5
    assert cache.get_or_fetch("k", lambda: {"v": 3}) == {"v": 1}
    drain(jobs)
    assert cache.get_or_fetch("k", lambda: {"v": 3}) == {"v": 3}


def test_refresh_does_not_regress_a_write_through():
    cache, clock, jobs = make_cache()
    assert cache.get_or_fetch("k", lambda: {"v": 1}) == {"v": 1}
    clock.now += 2.0

    def fetch():
        cache.put("k", {"v": 3})  # a local write commits mid-refresh
        return {"v": 2}  # the refresh's older read must not overwrite it

    assert cache.get_or_fetch("k", fetch) == {"v": 1}
    drain(jobs)
    assert cache.get_or_fetch("k", lambda: {"v": 9}) == {"v": 3}


def test_put_writes_through():
    cache, clock, jobs = make_cache()
    assert cache.get_or_fetch("k", lambda: {"v": 1}) == {"v": 1}
    cache.put("k", {"v": 2})
    assert cache.get_or_fetch("k", lambda: {"v": 3}) == {"v": 2}


def test_lru_eviction_by_bytes():
    cache, clock, jobs = make_cache(max_bytes=estimate_size({"s": "x" * 100}) * 2)
    calls = {"a": 0, "b": 0, "c": 0}

    def fetch(name):
        return lambda: calls.__setitem__(name, calls[name] + 1) or {"s": name * 100}

    cache.get_or_fetch("a", fetch("a"))
    cache.get_or_fetch("b", fetch("b"))
    cache.get_or_fetch("a", fetch("a"))  # a is now most recently used
    cache.get_or_fetch("c", fetch("c"))  # evicts b, the least recently used
    cache.get_or_fetch("a", fetch("a"))
    cache.get_or_fetch("c", fetch("c"))
    cache.get_or_fetch("b", fetch("b"))  # b was evicted: fetched again
    assert calls == {"a": 1, "b": 2, "c": 1}


def test_oversized_value_is_never_cached():
    cache, clock, jobs = make_cache(max_bytes=10)
    calls = []
    fetch = lambda: calls.append(1) or {"s": "x" * 1000}
    cache.get_or_fetch("big", fetch)
    cache.get_or_fetch("big", fetch)
    assert len(calls) == 2


def test_clear_drops_everything():
    cache, clock, jobs = make_cache()
    cache.put("a", {"v": 1})
    cache.clear()
    calls = []
    assert cache.get_or_fetch("a", lambda: calls.append(1) or {"v": 2}) == {"v": 2}
    assert calls == [1]


def test_drop_where_removes_only_matching_keys():
    cache, clock, jobs = make_cache()
    cache.put(("query", "games", (), 10, None), [("g1", {"v": 1})])
    cache.put(("query", "users", (), 10, None), [("u1", {"v": 1})])
    cache.put(("doc", "games/g1"), {"v": 1})
    cache.drop_where(lambda k: k[0] == "query" and k[1] == "games")
    calls = []
    fetch = lambda: calls.append(1) or [("g2", {"v": 2})]
    assert cache.get_or_fetch(("query", "games", (), 10, None), fetch) == [
        ("g2", {"v": 2})
    ]
    assert calls == [1]
    assert cache.get_or_fetch(("query", "users", (), 10, None), fetch) == [
        ("u1", {"v": 1})
    ]
    assert cache.get_or_fetch(("doc", "games/g1"), lambda: {"v": 9}) == {"v": 1}


def test_many_fetches_missing_in_one_batch_and_refreshes_stale():
    cache, clock, jobs = make_cache()
    cache.put("a", {"v": 1})
    clock.now += 2.0  # a is stale now
    cache.put("b", {"v": 1})  # b is fresh
    batches = []

    def fetch_many(keys):
        batches.append(list(keys))
        return {key: {"v": 2} for key in keys}

    result = cache.get_or_fetch_many(["a", "b", "c"], fetch_many)
    assert result == {"a": {"v": 1}, "b": {"v": 1}, "c": {"v": 2}}
    assert batches == [["c"]]  # only the miss was fetched synchronously
    assert len(jobs) == 1  # one batched background refresh for the stale key
    drain(jobs)
    assert batches == [["c"], ["a"]]
    assert cache.get_or_fetch("a", lambda: {"v": 9}) == {"v": 2}


def test_served_values_are_copies():
    cache, clock, jobs = make_cache()
    value = cache.get_or_fetch("k", lambda: {"nested": {"v": 1}})
    value["nested"]["v"] = 99  # mutating the served copy must not corrupt
    assert cache.get_or_fetch("k", lambda: {"nested": {"v": 2}}) == {
        "nested": {"v": 1}
    }
