"""A rematch keeps the original match's audience (private stays private) and holds
a seat for every original player, so a stranger can't take the last seat and lock
the opponent out."""

from game_platform.tests.helpers import Api


def finished_match(
    api: Api, *, private: bool, counts: tuple[int, ...] = (2,)
) -> tuple[str, str, str, str]:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice, allowed_player_counts=counts)
    match = api.ok(
        "POST", "/matches", as_user=alice, json={"game_id": game_id, "private": private}
    )
    token = api.ok("POST", f"/matches/{match['id']}/invites", as_user=alice)["token"]
    api.ok("POST", f"/invites/{token}/accept", as_user=bob)
    api.ok("POST", f"/matches/{match['id']}/start", as_user=alice)
    assert api.move(match["id"], as_user=alice, next_turn=None).status_code == 201
    return match["id"], game_id, alice, bob


def open_ids(api: Api) -> set[str]:
    return {match["id"] for match in api.ok("GET", "/matches/open")}


def test_the_rematch_of_a_private_match_is_private_and_the_opponent_gets_back_in() -> None:
    # Regression: the rematch was public, a stranger took the seat, and the
    # opponent's rematch then failed with "the match is full".
    api = Api()
    match_id, _, alice, bob = finished_match(api, private=True)
    rematch = api.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)
    assert rematch["private"] is True
    assert rematch["id"] not in open_ids(api)
    stranger = api.new_user("stranger")
    response = api.request("POST", f"/matches/{rematch['id']}/join", as_user=stranger)
    assert response.status_code == 403
    rejoined = api.ok("POST", f"/matches/{match_id}/rematch", as_user=bob)
    assert rejoined["id"] == rematch["id"]
    assert [p["user_id"] for p in rejoined["players"]] == [alice, bob]
    assert api.ok("POST", f"/matches/{rematch['id']}/start", as_user=alice)["status"] == "ongoing"


def test_a_public_rematch_holds_the_seat_for_the_original_opponent() -> None:
    api = Api()
    match_id, _, alice, bob = finished_match(api, private=False)
    rematch = api.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)
    assert rematch["private"] is False
    assert rematch["id"] not in open_ids(api)  # its only free seat is Bob's
    stranger = api.new_user("stranger")
    response = api.request("POST", f"/matches/{rematch['id']}/join", as_user=stranger)
    assert (response.status_code, response.json()["detail"]) == (
        409,
        "the remaining seats are held for the original players",
    )
    # Bob can also come back through a plain join.
    api.ok("POST", f"/matches/{rematch['id']}/join", as_user=bob)


def test_seats_beyond_the_held_ones_stay_open_to_anyone() -> None:
    api = Api()
    match_id, _, alice, bob = finished_match(api, private=False, counts=(2, 3))
    rematch = api.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)
    assert rematch["id"] in open_ids(api)  # 3 seats: Alice, one held for Bob, one free
    first, second = api.new_user("first"), api.new_user("second")
    api.ok("POST", f"/matches/{rematch['id']}/join", as_user=first)
    response = api.request("POST", f"/matches/{rematch['id']}/join", as_user=second)
    assert response.status_code == 409  # the last seat is Bob's
    joined = api.ok("POST", f"/matches/{match_id}/rematch", as_user=bob)
    assert [p["user_id"] for p in joined["players"]] == [alice, first, bob]


def test_a_rematch_does_not_carry_the_stake_over() -> None:
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice, allowed_player_counts=(2,))
    match = api.ok(
        "POST", "/matches", as_user=alice, json={"game_id": game_id, "bet_per_player": 5}
    )
    api.ok("POST", f"/matches/{match['id']}/join", as_user=bob)
    api.ok("POST", f"/matches/{match['id']}/start", as_user=alice)
    api.move(match["id"], as_user=alice, next_turn=None)  # refunds (bug 4)
    rematch = api.ok("POST", f"/matches/{match['id']}/rematch", as_user=alice)
    assert (rematch["bet_per_player"], rematch["token_pot"]) == (0, 0)
