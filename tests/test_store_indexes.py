from dataclasses import replace

from game_platform.models import LinkedAccount
from game_platform.store import InMemoryStore
from game_platform.tests.helpers import Api


def test_linked_account_index_tracks_updates_deletes_and_snapshots() -> None:
    store = InMemoryStore()
    api = Api(store=store)
    user_id = api.new_user("alice")
    user = store.get_user(user_id)
    assert user is not None
    account = LinkedAccount(
        kind="google",
        identifier="google-subject",
        linked_at=user.created_at,
    )
    store.put_user(replace(user, linked_accounts=(account,)))
    assert store.get_user_by_linked_account("google", "google-subject") == replace(
        user, linked_accounts=(account,)
    )

    store.put_user(user)
    assert store.get_user_by_linked_account("google", "google-subject") is None

    store.put_user(replace(user, linked_accounts=(account,)))
    restored = InMemoryStore.of_snapshot(store.snapshot())
    assert restored.get_user_by_linked_account("google", "google-subject") is not None
    restored.delete_user(user_id)
    assert restored.get_user_by_linked_account("google", "google-subject") is None


def test_match_indexes_track_participants_status_and_snapshots() -> None:
    store = InMemoryStore()
    api = Api(store=store)
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game_id = api.new_game(owner=alice)
    first_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob])
    second_id = api.new_match(owner=carol, game_id=game_id, joiners=[bob])

    assert [match.id for match in store.list_matches_involving(bob)] == [
        first_id,
        second_id,
    ]
    assert [match.id for match in store.list_matches_by_status("waiting_for_players")] == [
        first_id,
        second_id,
    ]

    first = store.get_match(first_id)
    second = store.get_match(second_id)
    assert first is not None and second is not None
    store.put_match(
        replace(first, seats=tuple(seat for seat in first.seats if seat.user_id != bob))
    )
    store.put_match(replace(second, status="over"))
    assert [match.id for match in store.list_matches_involving(bob)] == [second_id]
    assert [match.id for match in store.list_matches_by_status("over")] == [second_id]

    restored = InMemoryStore.of_snapshot(store.snapshot())
    assert [match.id for match in restored.list_matches_involving(bob)] == [second_id]
    assert [match.id for match in restored.list_matches_by_status("waiting_for_players")] == [
        first_id,
    ]
    restored.delete_match(second_id)
    assert restored.list_matches_involving(bob) == []
    assert restored.list_matches_by_status("over") == []
