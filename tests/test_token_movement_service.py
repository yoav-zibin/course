"""Wallet changes retain their source balance, reason and historical IDs."""

import datetime as dt

from game_platform.tests.helpers import Api
from game_platform.tests.test_match_pot_refunds import paid_match


def movements(api):
    return api.platform._store.list_token_movements()


def assert_wallet_chain(api, user_id, opening_balance):
    balance = opening_balance
    for row in movements(api):
        if row.user_id == user_id:
            assert row.balance_before == balance
            balance += row.amount
    assert api.platform._store.get_user(user_id).token_balance == balance


def test_stakes_and_result_reconcile_each_wallet_without_duplicate_settlement():
    api = Api(master_password="admin")
    match_id, alice, bob = paid_match(api)
    assert [(row.user_id, row.amount, row.balance_before, row.reason, row.match_id)
            for row in movements(api)] == [
        (alice, -5, 10, "started_match", match_id),
        (bob, -5, 10, "started_match", match_id),
    ]
    api.ok("POST", f"/matches/{match_id}/moves", as_user=alice, json={
        "move": {"turn_indices": None, "payouts": {alice: 10, bob: 0}},
        "expected_move_count": 0,
    })
    assert [(row.user_id, row.amount, row.balance_before, row.reason)
            for row in movements(api)[2:]] == [(alice, 10, 5, "match_ended")]
    assert_wallet_chain(api, alice, 10)
    assert_wallet_chain(api, bob, 10)
    recorded = movements(api)
    assert api.client.delete(f"/admin/matches/{match_id}", auth=("admin", "admin")).status_code == 204
    assert movements(api) == recorded
    assert all(row.match_id == match_id for row in recorded)


def test_waiting_departure_and_deleted_user_keep_the_complete_history():
    api = Api(master_password="admin")
    alice, bob = api.new_user("Alice", tokens=10), api.new_user("Bob", tokens=10)
    game = api.new_game(owner=alice)
    match = api.ok("POST", "/matches", as_user=alice,
                   json={"game_id": game, "bet_per_player": 5})["id"]
    api.ok("POST", f"/matches/{match}/join", as_user=bob)
    api.ok("POST", f"/matches/{match}/leave", as_user=bob)
    api.ok("DELETE", f"/matches/{match}", as_user=alice)
    assert [(row.user_id, row.amount, row.balance_before, row.reason)
            for row in movements(api)[2:]] == [
        (bob, 5, 5, "left_match"), (alice, 5, 5, "left_match"),
    ]
    assert_wallet_chain(api, alice, 10)
    assert_wallet_chain(api, bob, 10)
    history = movements(api)
    assert api.client.delete(f"/admin/users/{alice}", auth=("admin", "admin")).status_code == 204
    assert api.platform._store.get_user(alice) is None
    assert api.platform._store.get_match(match) is None
    assert movements(api)[:len(history)] == history
    last = movements(api)[-1]
    assert (last.user_id, last.amount, last.balance_before, last.reason, last.match_id) == (
        alice, -10, 10, "account_deleted", None,
    )


def test_mid_match_payout_is_distinct_from_final_settlement():
    api = Api()
    match, alice, bob = paid_match(api)
    api.ok("POST", f"/matches/{match}/moves", as_user=alice, json={
        "move": {"turn_indices": [1], "payouts": {alice: 2}},
        "expected_move_count": 0,
    })
    credit = movements(api)[-1]
    assert (credit.user_id, credit.amount, credit.balance_before, credit.reason) == (
        alice, 2, 5, "match_payout",
    )
    api.ok("POST", f"/matches/{match}/moves", as_user=bob, json={
        "move": {"turn_indices": None, "payouts": {bob: 8}},
        "expected_move_count": 1,
    })
    assert movements(api)[-1].reason == "match_ended"
    assert_wallet_chain(api, alice, 10)
    assert_wallet_chain(api, bob, 10)
    assert sum(row.amount for row in movements(api)) == 0


def test_leave_preview_has_no_movements_and_confirmation_settles_once():
    api = Api()
    match, alice, bob = paid_match(api)
    stakes = movements(api)
    api.ok("POST", f"/matches/{match}/maybeLeave", as_user=bob)
    assert movements(api) == stakes
    api.ok("POST", f"/matches/{match}/playerLeft", as_user=bob)
    credits = movements(api)[2:]
    assert len(credits) == 2
    assert {row.user_id for row in credits} == {alice, bob}
    assert all((row.amount, row.balance_before, row.reason, row.match_id) == (
        5, 5, "left_match", match,
    ) for row in credits)
    recorded = movements(api)
    assert api.request("POST", f"/matches/{match}/playerLeft", as_user=bob).status_code in (403, 409)
    assert movements(api) == recorded
    assert_wallet_chain(api, alice, 10)
    assert_wallet_chain(api, bob, 10)


def test_timeout_records_the_actual_recipient_and_does_not_pay_twice():
    api = Api()
    match, alice, bob = paid_match(api, turn_seconds=60)
    deadline = api.platform._store.get_match(match).turn_deadline
    api.platform._clock = lambda: deadline + dt.timedelta(seconds=1)
    api.ok("GET", f"/matches/{match}", as_user=bob)
    credit, = movements(api)[2:]
    assert (credit.user_id, credit.amount, credit.balance_before, credit.reason, credit.match_id) == (
        bob, 10, 5, "match_ended", match,
    )
    recorded = movements(api)
    api.ok("GET", f"/matches/{match}", as_user=bob)
    assert movements(api) == recorded
    assert_wallet_chain(api, alice, 10)
    assert_wallet_chain(api, bob, 10)


def test_account_merge_records_both_sides_without_rewriting_historical_user_ids():
    api = Api()
    alice, bob = api.new_user("Alice", tokens=10), api.new_user("Bob", tokens=20)
    api.ok("POST", f"/users/{alice}/merge", as_user=alice,
           json={"into_user_id": bob, "into_password": api.passwords_by_user_id[bob]})
    assert [(row.user_id, row.amount, row.balance_before, row.reason, row.match_id)
            for row in movements(api)] == [
        (bob, 10, 20, "account_merged", None),
        (alice, -10, 10, "account_merged", None),
    ]
    assert api.platform._store.get_user(alice).token_balance == 0
    assert api.platform._store.get_user(bob).token_balance == 30


def test_rejected_stake_and_invalid_payout_produce_no_ledger_rows():
    api = Api()
    alice, bob = api.new_user("Alice", tokens=10), api.new_user("Bob")
    game = api.new_game(owner=alice)
    match = api.ok("POST", "/matches", as_user=alice,
                   json={"game_id": game, "bet_per_player": 5})["id"]
    before = movements(api)
    assert api.request("POST", f"/matches/{match}/join", as_user=bob).status_code == 409
    assert movements(api) == before

    api = Api()
    match, alice, bob = paid_match(api)
    before = movements(api)
    response = api.request("POST", f"/matches/{match}/moves", as_user=alice, json={
        "move": {"turn_indices": None, "payouts": {alice: 100, bob: 0}},
        "expected_move_count": 0,
    })
    assert response.status_code >= 400
    assert movements(api) == before
    assert_wallet_chain(api, alice, 10)
    assert_wallet_chain(api, bob, 10)
