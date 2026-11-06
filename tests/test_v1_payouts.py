"""v1 paid matches (games without server code): the final move only proposes how
the pot is split, because the server can't check a client's claimed result.
Tokens move once every human agrees; a dispute or the deadline refunds every
stake."""

import datetime as dt
from typing import Any

from game_platform.tests.helpers import Api

STAKE = 5


def balance(api: Api, user_id: str) -> int:
    return api.ok("GET", f"/users/{user_id}")["token_balance"]


def paid_match(api: Api, players: int = 2) -> tuple[str, list[str]]:
    """A started v1 match staking STAKE tokens per player. Every player starts
    with the 10-token daily grant, so each holds 10 - STAKE afterwards."""
    users = [api.new_user(f"player{i}") for i in range(players)]
    game_id = api.new_game(owner=users[0])
    match = api.ok(
        "POST",
        "/matches",
        as_user=users[0],
        json={"game_id": game_id, "bet_per_player": STAKE},
    )
    for joiner in users[1:]:
        api.ok("POST", f"/matches/{match['id']}/join", as_user=joiner)
    api.ok("POST", f"/matches/{match['id']}/start", as_user=users[0])
    return match["id"], users


def end(api: Api, match_id: str, *, as_user: str, payouts: dict[str, int]) -> Any:
    return api.ok(
        "POST",
        f"/matches/{match_id}/moves",
        as_user=as_user,
        json={
            "new_state": {"winner": 0},
            "next_turn_player_indices": None,
            "payout_player_indices": payouts,
        },
    )


def answer(api: Api, match_id: str, *, as_user: str, agree: bool) -> Any:
    return api.request(
        "POST", f"/matches/{match_id}/payouts", as_user=as_user, json={"agree": agree}
    )


def test_the_final_move_alone_moves_no_tokens() -> None:
    # Regression: the mover used to end the match on any move and take the pot.
    api = Api()
    match_id, (alice, bob) = paid_match(api)
    match = end(api, match_id, as_user=alice, payouts={"0": 10, "1": 0})
    assert match["status"] == "over"
    assert match["token_payouts"] is None
    assert match["proposed_payouts"] == {"0": 10, "1": 0}
    assert match["payout_agreed_player_indices"] == [0]
    assert match["payout_outcome"] is None
    assert match["payout_deadline"] is not None
    assert (balance(api, alice), balance(api, bob)) == (5, 5)


def test_the_pot_pays_out_once_every_other_player_agrees() -> None:
    api = Api()
    match_id, (alice, bob, carol) = paid_match(api, players=3)
    end(api, match_id, as_user=alice, payouts={"0": 15, "1": 0, "2": 0})
    first = answer(api, match_id, as_user=bob, agree=True).json()
    assert first["payout_outcome"] is None
    assert first["payout_agreed_player_indices"] == [0, 1]
    assert balance(api, alice) == 5  # Carol hasn't agreed yet
    done = answer(api, match_id, as_user=carol, agree=True).json()
    assert done["payout_outcome"] == "agreed"
    assert done["token_payouts"] == {"0": 15, "1": 0, "2": 0}
    assert (balance(api, alice), balance(api, bob), balance(api, carol)) == (20, 5, 5)


def test_a_dispute_refunds_every_stake() -> None:
    api = Api()
    match_id, (alice, bob) = paid_match(api)
    end(api, match_id, as_user=alice, payouts={"0": 10, "1": 0})
    match = answer(api, match_id, as_user=bob, agree=False).json()
    assert match["payout_outcome"] == "disputed"
    assert match["token_payouts"] == {"0": STAKE, "1": STAKE}
    assert (balance(api, alice), balance(api, bob)) == (10, 10)


def test_no_agreement_by_the_deadline_refunds_every_stake() -> None:
    api = Api()
    match_id, (alice, bob) = paid_match(api)
    end(api, match_id, as_user=alice, payouts={"0": 10, "1": 0})
    api.platform._clock._now += dt.timedelta(hours=2)  # type: ignore[attr-defined]
    match = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert match["payout_outcome"] == "expired"
    assert match["token_payouts"] == {"0": STAKE, "1": STAKE}
    assert (balance(api, alice), balance(api, bob)) == (10, 10)
    # Too late to agree now, and reading again never refunds twice.
    response = answer(api, match_id, as_user=bob, agree=True)
    assert response.status_code == 409
    assert response.json()["detail"] == "this match has no payouts waiting for agreement"
    api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert (balance(api, alice), balance(api, bob)) == (10, 10)


def test_answers_are_once_per_player_and_only_from_players() -> None:
    api = Api()
    match_id, (alice, bob) = paid_match(api)
    outsider = api.new_user("outsider")
    end(api, match_id, as_user=alice, payouts={"0": 10, "1": 0})
    # The proposer already agreed by proposing, so can't also dispute.
    response = answer(api, match_id, as_user=alice, agree=False)
    assert (response.status_code, response.json()["detail"]) == (
        409,
        "you already agreed to these payouts",
    )
    response = answer(api, match_id, as_user=outsider, agree=True)
    assert (response.status_code, response.json()["detail"]) == (
        403,
        "you are not a player in this match",
    )
    assert answer(api, match_id, as_user=None, agree=True).status_code == 401  # type: ignore[arg-type]
    # Once settled, the pot can't be answered again (or paid twice).
    answer(api, match_id, as_user=bob, agree=True)
    assert answer(api, match_id, as_user=bob, agree=False).status_code == 409
    assert (balance(api, alice), balance(api, bob)) == (15, 5)


def test_free_matches_and_ongoing_matches_have_nothing_to_agree_to() -> None:
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match_id = api.new_match(
        owner=alice, game_id=api.new_game(owner=alice), joiners=[bob], start=True
    )
    assert answer(api, match_id, as_user=bob, agree=True).status_code == 409
    finished = api.move(match_id, as_user=alice, next_turn=None).json()
    assert finished["proposed_payouts"] is None
    assert finished["payout_outcome"] is None
    assert answer(api, match_id, as_user=bob, agree=True).status_code == 409


def test_the_old_checks_on_the_proposal_still_apply() -> None:
    api = Api()
    match_id, (alice, _) = paid_match(api)
    for payouts, detail in (
        ({"0": 10}, "payouts must include every human seat"),
        ({"0": 9, "1": 0}, "payouts must total the token pot"),
    ):
        response = api.request(
            "POST",
            f"/matches/{match_id}/moves",
            as_user=alice,
            json={
                "new_state": {},
                "next_turn_player_indices": None,
                "payout_player_indices": payouts,
            },
        )
        assert (response.status_code, response.json()["detail"]) == (400, detail)
