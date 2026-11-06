"""FirestoreStore against the Firestore emulator. Skipped unless FIRESTORE_EMULATOR_HOST
is set; see "Firestore" in the README for running the emulator."""

import json
import os
import time
import uuid
from collections.abc import Iterator

import pytest

from game_platform import example_data
from game_platform.json_file_store import read_snapshot

pytestmark = pytest.mark.skipif(
    not os.environ.get("FIRESTORE_EMULATOR_HOST"),
    reason="needs the Firestore emulator (FIRESTORE_EMULATOR_HOST)",
)

if os.environ.get("FIRESTORE_EMULATOR_HOST"):
    from google.cloud import firestore

    from game_platform.firestore_store import (
        _FIRESTORE_FORMAT_VERSION,
        FirestoreStore,
        export_snapshot,
        import_snapshot,
        is_empty,
    )
    from game_platform.tests.helpers import Api


@pytest.fixture
def client() -> "firestore.Client":
    return firestore.Client(project="demo-game-platform")


@pytest.fixture
def prefix() -> str:
    """A fresh namespace per test, so tests never see each other's data."""
    return f"test{uuid.uuid4().hex[:12]}_"


@pytest.fixture
def open_store(client: "firestore.Client", prefix: str) -> Iterator:
    stores = []

    def open_() -> "FirestoreStore":
        store = FirestoreStore(client, collection_prefix=prefix)
        stores.append(store)
        return store

    yield open_
    for store in stores:
        store.close()


def _all_data(api: "Api") -> dict:
    return api.ok("GET", "/debug/all-data")


def _await_popular_ids(store, expected, timeout: float = 10.0) -> None:
    """Wait until the native ranked listing reflects the in-memory scores.

    The listing is a Firestore query over the persisted popularity records,
    which the background writer flushes on its interval, so it may lag the
    scores (including a seed written at store construction) by up to that
    interval.
    """
    deadline = time.monotonic() + timeout
    while True:
        rows = store.list_popular_game_ids(8)
        if rows == expected:
            return
        if time.monotonic() >= deadline:
            assert rows == expected, f"popular games {rows} != {expected}"
        time.sleep(0.1)


def test_popularity_uses_native_firestore_ranking_and_survives_restart(open_store):
    from game_platform.tests.test_popularity import _await_popular, exercise_popularity

    store = open_store()
    first, second = exercise_popularity(Api(store=store))
    rows = list(store._collection("game_popularity").order_by("score", direction="DESCENDING").stream())
    assert [(row.to_dict()["game_id"], row.to_dict()["score"]) for row in rows] == [(first, 4), (second, 3)]
    store.close()
    restored = Api(store=open_store())
    assert restored.ok("GET", f"/games/{first}/popularity")["score"] == 4
    _await_popular(restored, [first, second])


def test_native_popularity_documents_load_without_a_snapshot_json_field(client, prefix, open_store):
    client.collection(prefix + "game_popularity").document("existing").set({
        "game_id": "existing", "matches_started": 2, "score": 5,
    })
    store = open_store()
    assert store.game_popularity_score("existing") == 5
    assert store.list_popular_game_ids(8) == [("existing", 5)]


def test_existing_firestore_history_seeds_popularity_once(client, prefix, open_store):
    from dataclasses import replace
    from game_platform.tests.helpers import Api

    source = Api()
    owner = source.new_user("historical player")
    game = source.new_game(owner=owner, allowed_player_counts=[2])
    source.new_match(owner=owner, game_id=game, num_computer_opponents=1, start=True)
    source.new_match(owner=owner, game_id=game, num_computer_opponents=1)
    snapshot = replace(source.platform._store.snapshot(), game_popularity=())
    import_snapshot(client, snapshot, collection_prefix=prefix)
    store = open_store()
    assert store.game_popularity_score(game) == 2
    _await_popular_ids(store, [(game, 2)])
    store.close()
    restarted = open_store()
    assert restarted.game_popularity_score(game) == 2
    _await_popular_ids(restarted, [(game, 2)])


def test_everything_survives_a_restart(open_store) -> None:
    store = open_store()
    api = Api(store=store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice, allows_leave_mid_match=True)
    api.ok("PATCH", f"/games/{game_id}", as_user=alice, json={"description": "v2"})
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)
    for turn in range(5):
        assert api.move(match_id, as_user=[alice, bob][turn % 2], next_turn=(turn + 1) % 2,
                        state={"board": [[turn, turn], [0, 0]]}).status_code == 201
    api.ok("POST", f"/matches/{match_id}/invites", as_user=alice)
    api.ok("PUT", f"/users/me/saved-games/{game_id}", as_user=bob)
    other = api.new_game(owner=alice)
    api.ok("DELETE", f"/games/{other}", as_user=alice)
    before = _all_data(api)
    store.close()

    restarted = Api(store=open_store())
    assert _all_data(restarted) == before


def test_the_example_data_round_trips_exactly(client, prefix, open_store) -> None:
    snapshot = read_snapshot(example_data.DEFAULT_OUTPUT)
    import_snapshot(client, snapshot, collection_prefix=prefix)
    assert open_store()._inner.snapshot() == snapshot


def test_moves_are_one_document_each_and_deleting_a_match_removes_them(
    client, prefix, open_store
) -> None:
    store = open_store()
    api = Api(store=store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match_id = api.new_match(
        owner=alice, game_id=api.new_game(owner=alice), joiners=[bob], start=True
    )
    api.move(match_id, as_user=alice, next_turn=1, state={"pot": 1})
    api.move(match_id, as_user=bob, next_turn=0, state={"pot": 2})
    store.flush()
    moves = client.collection(f"{prefix}matches").document(match_id).collection("moves")
    assert [doc.id for doc in moves.stream()] == ["000000", "000001"]

    api.ok("DELETE", f"/matches/{match_id}", as_user=alice)
    store.flush()
    assert list(moves.stream()) == []
    assert not client.collection(f"{prefix}matches").document(match_id).get().exists


def test_records_too_big_for_one_document_are_split(client, prefix, open_store) -> None:
    import base64
    import random

    store = open_store()
    api = Api(store=store)
    alice = api.new_user("alice")
    # Repeated characters now compress into one document; use deterministic
    # high-entropy data to exercise chunking after compression as well.
    huge_code = "<div>" + base64.b64encode(random.Random(1).randbytes(1_200_000)).decode() + "</div>"
    game = api.ok(
        "POST",
        "/games",
        as_user=alice,
        json={"name": "Huge", "allowed_player_counts": [2], "code": huge_code},
    )
    store.close()
    document = client.collection(f"{prefix}game_versions").document(f"{game['id']}@1").get()
    assert document.to_dict()["chunks"] > 1

    restarted = Api(store=open_store())
    assert restarted.ok("GET", f"/games/{game['id']}")["code"] == huge_code


def test_only_changed_records_are_rewritten(client, prefix, open_store) -> None:
    store = open_store()
    api = Api(store=store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    store.flush()
    users = client.collection(f"{prefix}users")
    bob_saved_at = users.document(bob).get().update_time
    api.ok("PATCH", f"/users/{alice}", as_user=alice, json={"display_name": "Alice"})
    store.flush()
    assert users.document(bob).get().update_time == bob_saved_at
    assert json.loads(users.document(alice).get().to_dict()["json"])["display_name"] == "Alice"


def test_newer_data_is_refused(client, prefix) -> None:
    client.collection(f"{prefix}meta").document("format").set({"version": _FIRESTORE_FORMAT_VERSION + 1})
    with pytest.raises(ValueError, match="update the server"):
        FirestoreStore(client, collection_prefix=prefix)


def test_import_refuses_a_database_that_has_data(client, prefix) -> None:
    snapshot = read_snapshot(example_data.DEFAULT_OUTPUT)
    assert is_empty(client, collection_prefix=prefix)
    import_snapshot(client, snapshot, collection_prefix=prefix)
    assert not is_empty(client, collection_prefix=prefix)
    with pytest.raises(ValueError, match="already has data"):
        import_snapshot(client, snapshot, collection_prefix=prefix)


def test_export_gives_back_what_was_imported(client, prefix) -> None:
    snapshot = read_snapshot(example_data.DEFAULT_OUTPUT)
    import_snapshot(client, snapshot, collection_prefix=prefix)
    assert export_snapshot(client, collection_prefix=prefix) == snapshot
