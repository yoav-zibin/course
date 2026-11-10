"""A paid match's pot is never lost: every way a match can end or be deleted
without paying it out gives each human their stake back."""

import datetime as dt

import pytest

from game_platform.tests.helpers import Api

STAKE = 5
ADMIN = "admin"


def balance(api: Api, user_id: str) -> int:
    user = api.platform._store.get_user(user_id)
    assert user is not None
    return user.token_balance


def paid_match(api: Api, *, turn_seconds: int | None = None) -> tuple[str, str, str]:
    """A started match between two players staking STAKE each. Both start with
    the 10-token daily grant, so each holds 10 - STAKE once it starts."""
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice, allowed_player_counts=(2,))
    match = api.ok(
        "POST",
        "/matches",
        as_user=alice,
        json={
            "game_id": game_id,
            "bet_per_player": STAKE,
            **({"turn_seconds": turn_seconds} if turn_seconds else {}),
        },
    )
    api.ok("POST", f"/matches/{match['id']}/join", as_user=bob)
    api.ok("POST", f"/matches/{match['id']}/start", as_user=alice)
    assert (balance(api, alice), balance(api, bob)) == (10 - STAKE, 10 - STAKE)
    return match["id"], alice, bob


def admin_delete(api: Api, path: str) -> None:
    response = api.client.delete(path, auth=("admin", ADMIN))
    assert response.status_code == 204, response.text


@pytest.mark.parametrize("who", ["alice", "bob"])
def test_a_player_deleting_an_ongoing_paid_match_refunds_both_stakes(who: str) -> None:
    # Regression: deleting used to drop the pot, the other player's stake too.
    api = Api()
    match_id, alice, bob = paid_match(api)
    api.ok("DELETE", f"/matches/{match_id}", as_user=alice if who == "alice" else bob)
    assert (balance(api, alice), balance(api, bob)) == (10, 10)


def test_an_admin_deleting_an_ongoing_paid_match_refunds_both_stakes() -> None:
    api = Api(master_password=ADMIN)
    match_id, alice, bob = paid_match(api)
    admin_delete(api, f"/admin/matches/{match_id}")
    assert (balance(api, alice), balance(api, bob)) == (10, 10)


def test_deleting_the_owners_account_refunds_the_other_players_stake() -> None:
    # The owner's matches are deleted with the account; the opponent keeps theirs.
    api = Api(master_password=ADMIN)
    match_id, alice, bob = paid_match(api)
    admin_delete(api, f"/admin/users/{alice}")
    assert api.platform._store.get_match(match_id) is None
    assert balance(api, bob) == 10


def test_deleting_a_settled_match_pays_nothing_twice() -> None:
    api = Api(master_password=ADMIN)
    match_id, alice, bob = paid_match(api)
    # The server game's move settles the pot itself: the match ends
    # with payouts for the two seats, no agreement step.
    api.ok(
        "POST",
        f"/matches/{match_id}/moves",
        as_user=alice,
        json={
            "move": {"turn_indices": None, "payouts": {alice: 10, bob: 0}},
            "expected_move_count": 0,
        },
    )
    assert (balance(api, alice), balance(api, bob)) == (15, 5)
    # The over match keeps recording its pot size, but holds no tokens any more.
    api.ok("DELETE", f"/matches/{match_id}", as_user=bob)  # only hides it for Bob
    admin_delete(api, f"/admin/matches/{match_id}")
    assert (balance(api, alice), balance(api, bob)) == (15, 5)


def test_leaving_a_paid_match_refunds_both_stakes() -> None:
    api = Api()
    match_id, alice, bob = paid_match(api)
    api.ok("POST", f"/matches/{match_id}/leave", as_user=bob)
    match = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert (match["status"], match["end_reason"]) == ("over", "player_left")
    assert (balance(api, alice), balance(api, bob)) == (10, 10)


def test_a_paid_speed_match_that_times_out_refunds_both_stakes() -> None:
    api = Api()
    match_id, alice, bob = paid_match(api, turn_seconds=60)
    api.platform._clock._now += dt.timedelta(minutes=5)  # type: ignore[attr-defined]
    match = api.ok("GET", f"/matches/{match_id}", as_user=bob)
    assert (match["status"], match["end_reason"]) == ("over", "timed_out")
    assert (balance(api, alice), balance(api, bob)) == (10, 10)
    api.ok("GET", f"/matches/{match_id}", as_user=bob)  # reading again pays nothing more
    assert (balance(api, alice), balance(api, bob)) == (10, 10)
