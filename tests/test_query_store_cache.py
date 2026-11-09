"""QueryStore's read cache over the fake Firestore client: documents, query
results and move batches are served from memory, own writes are written
through at commit, and transactional reads always bypass the cache."""

import datetime as dt

from game_platform.models import Move
from game_platform.query_store import MOVE_ADAPTER
from game_platform.read_cache import ReadCache
from game_platform.tests.fake_firestore import FakeClient, query_store

NS = "testcache"


def make_store():
    client = FakeClient()
    store = query_store(NS, client)
    clock = [1000.0]
    jobs = []
    store._cache = ReadCache(
        max_bytes=64 * 1024 * 1024, clock=lambda: clock[0], submit=jobs.append
    )
    return store, client, clock, jobs


def drain(jobs):
    while jobs:
        jobs.pop(0)()


def test_raw_get_is_served_from_cache():
    store, client, clock, jobs = make_store()
    ref = store.ref("users", "alice")
    client.docs[ref.path] = {"name": "Alice"}
    reads = client.reads
    assert store.raw_get(ref) == {"name": "Alice"}
    assert store.raw_get(ref) == {"name": "Alice"}
    assert client.reads == reads + 1


def test_external_write_is_at_most_a_refresh_window_stale():
    store, client, clock, jobs = make_store()
    ref = store.ref("users", "alice")
    client.docs[ref.path] = {"name": "Alice"}
    assert store.raw_get(ref) == {"name": "Alice"}
    client.docs[ref.path] = {"name": "Alicia"}  # another VM's write
    assert store.raw_get(ref) == {"name": "Alice"}  # fresh window: cached
    clock[0] += 2.0
    reads = client.reads
    assert store.raw_get(ref) == {"name": "Alice"}  # stale served, no sync read
    assert client.reads == reads
    assert len(jobs) == 1
    drain(jobs)  # background refresh
    assert client.reads == reads + 1
    assert store.raw_get(ref) == {"name": "Alicia"}


def test_own_write_is_visible_immediately():
    store, client, clock, jobs = make_store()
    ref = store.ref("users", "alice")
    client.docs[ref.path] = {"name": "Alice"}
    assert store.raw_get(ref) == {"name": "Alice"}
    store.raw_put(ref, {"name": "Alicia"})  # commits through the fake client
    assert client.docs[ref.path] == {"name": "Alicia"}
    reads = client.reads
    assert store.raw_get(ref) == {"name": "Alicia"}  # write-through, no read
    assert client.reads == reads


def test_transactional_reads_bypass_the_cache():
    store, client, clock, jobs = make_store()
    ref = store.ref("users", "alice")
    client.docs[ref.path] = {"name": "Alice"}
    assert store.raw_get(ref) == {"name": "Alice"}  # cache now holds Alice
    client.docs[ref.path] = {"name": "Alicia"}
    with store.atomic():
        assert store.raw_get(ref) == {"name": "Alicia"}  # read through the tx


def test_query_results_cached_and_invalidated_by_own_kind_writes():
    store, client, clock, jobs = make_store()
    collection = client.collection(f"{NS}_games")
    collection.document("g1").set({"json": "{}", "published": True})
    collection.document("g2").set({"json": "{}", "published": True})
    queries = client.queries
    assert [doc.id for doc in store._query("games", (), limit=10)] == ["g1", "g2"]
    assert [doc.id for doc in store._query("games", (), limit=10)] == ["g1", "g2"]
    assert client.queries == queries + 1
    # A write to another kind leaves the games query cached...
    store.raw_put(store.ref("users", "alice"), {"name": "Alice"})
    assert [doc.id for doc in store._query("games", (), limit=10)] == ["g1", "g2"]
    assert client.queries == queries + 1
    # ...while a write to a games document drops it.
    g3 = store.ref("games", "g3")  # document ids are the store's key hashes
    store.raw_put(g3, {"json": "{}", "published": True})
    assert [doc.id for doc in store._query("games", (), limit=10)] == sorted(
        ["g1", "g2", g3.id]
    )
    assert client.queries == queries + 2


def test_move_batches_are_served_from_cache():
    store, client, clock, jobs = make_store()
    match_ref = store.ref("matches", "m1")
    moves = [
        Move(
            move_number=i,
            player_index=0,
            made_by_user_id="alice",
            created_at=dt.datetime(2026, 11, 9, tzinfo=dt.timezone.utc),
            new_state={"n": i},
            next_turn_player_indices=frozenset({1}),
        )
        for i in range(2)
    ]
    for i, move in enumerate(moves):
        client.docs[f"{match_ref.path}/moves/{i:012}"] = {
            "json": MOVE_ADAPTER.dump_json(move).decode()
        }
    reads = client.reads
    assert store._read_moves(match_ref, 0, 2) == moves
    assert client.reads == reads + 2  # one batched get_all of two documents
    assert store._read_moves(match_ref, 0, 2) == moves
    assert client.reads == reads + 2  # second read fully cached
