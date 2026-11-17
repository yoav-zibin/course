"""Matches spend and redistribute existing tokens without minting rewards."""

import datetime as dt
from dataclasses import replace

import pytest

from game_platform.tests.helpers import Api, error


@pytest.mark.parametrize("against_computer", [False, True])
def test_playing_a_free_match_does_not_reward_guests(api: Api, against_computer: bool):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice, allowed_player_counts=(2,))
    match = api.new_match(
        owner=alice, game_id=game,
        joiners=[] if against_computer else [bob],
        num_computer_opponents=1 if against_computer else 0,
        start=True,
    )
    result = api.ok("POST", f"/matches/{match}/moves", as_user=alice,
                    json={"move": {"turn_indices": None}, "expected_move_count": 0})
    assert result["status"] == "over"
    for uid in (alice, bob):
        user = api.platform._store.get_user(uid)
        assert user.token_balance == 0
        assert user.last_token_grant_day is None


def test_a_guest_cannot_fund_a_paid_match_with_a_daily_grant(api: Api):
    guest = api.new_user("guest")
    game = api.new_game(owner=guest)
    for _ in range(2):
        response = api.request("POST", "/matches", as_user=guest,
                               json={"game_id": game, "bet_per_player": 1})
        assert error(response) == (409, "a player has insufficient tokens")
        assert api.platform._store.get_user(guest).token_balance == 0
        api.platform._clock._now += dt.timedelta(days=1)


@pytest.mark.parametrize("legacy_grant_day", [None, "2025-12-31", "2026-01-01"])
def test_paid_matches_only_redistribute_existing_wallets(api: Api, legacy_grant_day):
    alice = api.new_user("alice", tokens=5)
    bob = api.new_user("bob", tokens=5)
    store = api.platform._store
    for uid in (alice, bob):
        store.put_user(replace(store.get_user(uid), last_token_grant_day=legacy_grant_day))
    game = api.new_game(owner=alice)
    for _ in range(2):
        match = api.ok("POST", "/matches", as_user=alice,
                       json={"game_id": game, "bet_per_player": 5})
        api.ok("POST", f"/matches/{match['id']}/join", as_user=bob)
        assert [store.get_user(uid).token_balance for uid in (alice, bob)] == [0, 0]
        api.ok("POST", f"/matches/{match['id']}/start", as_user=alice)
        api.ok("POST", f"/matches/{match['id']}/moves", as_user=alice,
               json={"move": {"turn_indices": None}, "expected_move_count": 0})
        assert [store.get_user(uid).token_balance for uid in (alice, bob)] == [5, 5]
        assert all(store.get_user(uid).last_token_grant_day == legacy_grant_day
                   for uid in (alice, bob))
        api.platform._clock._now += dt.timedelta(days=1)


def test_an_empty_verified_wallet_gets_no_match_allowance(api: Api):
    user, _ = api.platform.login_with_linked_account(
        kind="google", identifier="verified-player", display_name="Verified player")
    api.passwords_by_user_id[user.id] = user.password
    store = api.platform._store
    store.put_user(replace(user, token_balance=0))
    game = api.new_game(owner=user.id)
    api.platform._clock._now += dt.timedelta(days=1)
    response = api.request("POST", "/matches", as_user=user.id,
                           json={"game_id": game, "bet_per_player": 1})
    assert error(response) == (409, "a player has insufficient tokens")
    assert store.get_user(user.id).token_balance == 0
