"""Rematches are public and reserve a seat for every original human player."""

from dataclasses import asdict

from pydantic import TypeAdapter

from game_platform.models import Match

from game_platform.tests.helpers import Api


def finished_match(
    api: Api, *, counts: tuple[int, ...] = (2,)
) -> tuple[str, str, str, str]:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice, allowed_player_counts=counts)
    match = api.ok(
        "POST", "/matches", as_user=alice, json={"game_id": game_id}
    )
    token = api.ok("POST", f"/matches/{match['id']}/invites", as_user=alice)["token"]
    api.ok("POST", f"/invites/{token}/accept", as_user=bob)
    api.ok("POST", f"/matches/{match['id']}/start", as_user=alice)
    assert api.move(match["id"], as_user=alice, next_turn=None).status_code == 201
    return match["id"], game_id, alice, bob


def test_a_public_rematch_holds_the_seat_for_the_original_opponent() -> None:
    api = Api()
    match_id, _, alice, bob = finished_match(api)
    rematch = api.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)
    assert "private" not in rematch
    assert api.ok("GET", f"/matches/{rematch['id']}")["id"] == rematch["id"]
    stranger = api.new_user("stranger")
    response = api.request("POST", f"/matches/{rematch['id']}/join", as_user=stranger)
    assert (response.status_code, response.json()["detail"]) == (
        409,
        "the remaining seats are held for the original players",
    )
    # Bob can also come back through a plain join.
    api.ok("POST", f"/matches/{rematch['id']}/join", as_user=bob)


def test_invite_seats_a_reserved_opponent_and_only_shows_strangers_the_rematch() -> None:
    api = Api()
    match_id, _, alice, bob = finished_match(api)
    rematch = api.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)
    token = rematch["invite_code"]
    stranger = api.new_user("stranger")
    spectator = api.ok("POST", f"/invites/{token}/accept", as_user=stranger)
    assert [player["user_id"] for player in spectator["players"]] == [alice]
    joined = api.ok("POST", f"/invites/{token}/accept", as_user=bob)
    assert [player["user_id"] for player in joined["players"]] == [alice, bob]


def test_legacy_audience_option_does_not_change_rematch_access_or_reserved_rejoin():
    api = Api()
    match_id, _, alice, bob = finished_match(api)
    store = api.platform._store
    old_record = {**asdict(store.get_match(match_id)), "private": True}
    store.put_match(TypeAdapter(Match).validate_python(old_record))
    rematch = api.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)
    assert "private" not in rematch
    assert not hasattr(store.get_match(rematch["id"]), "private")
    stranger = api.new_user("stranger")
    for caller in (None, stranger):
        assert api.ok("GET", f"/matches/{rematch['id']}", as_user=caller)["id"] == rematch["id"]
    assert api.request("POST", f"/matches/{rematch['id']}/join", as_user=stranger).status_code == 409
    joined = api.ok("POST", f"/matches/{match_id}/rematch", as_user=bob)
    assert "private" not in joined
    assert [p["user_id"] for p in joined["players"]] == [alice, bob]


def test_seats_beyond_the_held_ones_stay_open_to_anyone() -> None:
    api = Api()
    match_id, _, alice, bob = finished_match(api, counts=(2, 3))
    rematch = api.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)
    # Three seats: Alice, one held for Bob, one free.
    first, second = api.new_user("first"), api.new_user("second")
    api.ok("POST", f"/matches/{rematch['id']}/join", as_user=first)
    response = api.request("POST", f"/matches/{rematch['id']}/join", as_user=second)
    assert response.status_code == 409  # the last seat is Bob's
    joined = api.ok("POST", f"/matches/{match_id}/rematch", as_user=bob)
    assert [p["user_id"] for p in joined["players"]] == [alice, first, bob]


def test_a_rematch_does_not_carry_the_stake_over() -> None:
    api = Api()
    alice, bob = api.new_user("alice", tokens=10), api.new_user("bob", tokens=10)
    game_id = api.new_game(owner=alice, allowed_player_counts=(2,))
    match = api.ok(
        "POST", "/matches", as_user=alice, json={"game_id": game_id, "bet_per_player": 5}
    )
    api.ok("POST", f"/matches/{match['id']}/join", as_user=bob)
    api.ok("POST", f"/matches/{match['id']}/start", as_user=alice)
    api.move(match["id"], as_user=alice, next_turn=None)  # refunds (bug 4)
    rematch = api.ok("POST", f"/matches/{match['id']}/rematch", as_user=alice)
    assert (rematch["bet_per_player"], rematch["token_pot"]) == (0, 0)
