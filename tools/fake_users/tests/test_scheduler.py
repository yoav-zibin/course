import math
import random
import statistics

from fake_users.scheduler import MEMORY_PER_USER_BYTES, hard_cap, memory_cap, next_arrival_seconds, users_allowed

GB = 1024**3


def test_users_per_hour_sets_the_average_gap():
    rng = random.Random(1)
    gaps = [next_arrival_seconds(120, rng) for _ in range(20_000)]
    assert 28.5 < statistics.mean(gaps) < 31.5  # 3600 / 120 = 30 s on average
    assert next_arrival_seconds(0, rng) == math.inf


def test_the_memory_cap():
    assert memory_cap(16 * GB) == int(16 * GB * 0.6 // MEMORY_PER_USER_BYTES) == 49
    assert memory_cap(512 * 1024**2) == 1  # always at least one
    assert hard_cap(16 * GB, None) == 49
    assert hard_cap(16 * GB, 10) == 10
    assert hard_cap(4 * GB, 100) == memory_cap(4 * GB)  # the config can only lower it


def test_users_allowed_is_the_smaller_limit():
    assert users_allowed(5, 49) == 5
    assert users_allowed(80, 49) == 49
    assert users_allowed(0, 49) == 0
