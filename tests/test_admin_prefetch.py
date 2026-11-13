from unittest.mock import patch
from types import SimpleNamespace

from game_platform.tests.fake_firestore import FakeClient, query_store
from game_platform.service import GamePlatform


def test_admin_version_prefetch_batches_metadata_and_bodies_without_individual_reads():
    client = FakeClient()
    store = query_store(client=client)
    versions = [(f"g{i}", 1) for i in range(50)]
    for game_id, version in versions:
        ref = store.ref("game_versions", f"{game_id}@{version}")
        client.docs[ref.path] = {"body_chunks": 2, "json": "metadata"}
        client.docs[store.ref("games", game_id).path] = {"published": True}
        for chunk in range(2):
            client.docs[ref.collection("body").document(f"{chunk:06}").path] = {"text": str(chunk)}
    with patch.object(client, "get_all", wraps=client.get_all) as batches:
        store.prefetch_game_versions(versions + versions)
        assert batches.call_count == 2  # 100 metadata documents, then 100 code chunks.
        with patch.object(store, "_read_doc", side_effect=AssertionError("individual database read")):
            for game_id, version in versions:
                ref = store.ref("game_versions", f"{game_id}@{version}")
                assert store.raw_get(ref)["body_chunks"] == 2
                assert store.raw_get(store.ref("games", game_id))["published"] is True
                for chunk in range(2):
                    assert store.raw_get(ref.collection("body").document(f"{chunk:06}"))["text"] == str(chunk)
        store.prefetch_game_versions(versions)
        assert batches.call_count == 2  # A warm page adds no synchronous database calls.


def test_missing_versions_are_cached_and_do_not_create_body_reads():
    client = FakeClient()
    store = query_store(client=client)
    with patch.object(client, "get_all", wraps=client.get_all) as batches:
        store.prefetch_game_versions([("missing", 1)])
        assert batches.call_count == 1
        assert store.get_game_version("missing", 1) is None
        assert batches.call_count == 1


def test_prefetch_leaves_transaction_snapshot_reads_to_the_transaction():
    store = query_store()
    store._local.uow = {"tx": object()}
    with patch.object(store.client, "get_all", side_effect=AssertionError("outside transaction")):
        store.prefetch_game_versions([("g", 1)])


def test_empty_match_state_needs_no_game_version_read():
    platform = object.__new__(GamePlatform)
    platform._store = SimpleNamespace(get_game_version=lambda *args: (_ for _ in ()).throw(
        AssertionError('an unstarted match read game code')))
    assert platform.view_state(SimpleNamespace(state=None), None) is None
