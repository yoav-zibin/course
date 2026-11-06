import httpx

from game_platform.tests.helpers import Api, error


def test_leaving_a_waiting_match_frees_the_seat(api: Api) -> None:
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(
        owner=alice, game_id=game_id, num_computer_opponents=0, joiners=[bob, carol]
    )
    match = api.ok("POST", f"/matches/{match_id}/leave", as_user=bob)
    assert api.summary(match) == {
        "status": "waiting_for_players",
        "players": ["alice", "carol"],
        "turn": None,
        "state": None,
    }
    assert api.ok("GET", "/matches", as_user=bob) == []


def test_the_owner_cannot_leave_a_waiting_match(api: Api) -> None:
    alice = api.new_user("alice")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id)
    assert error(api.request("POST", f"/matches/{match_id}/leave", as_user=alice)) == (
        409,
        "the owner cannot leave a match that has not started; delete it instead",
    )


def test_leaving_ends_the_match_when_the_game_disallows_leaving(api: Api) -> None:
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game_id = api.new_game(owner=alice, allows_leave_mid_match=False)
    match_id = api.new_match(
        owner=alice, game_id=game_id, joiners=[bob, carol], start=True
    )
    match = api.ok("POST", f"/matches/{match_id}/leave", as_user=bob)
    assert (match["status"], match["end_reason"], match["turn_of_player_indices"]) == (
        "over",
        "player_left",
        None,
    )


def test_legacy_leave_ends_the_match_without_creating_a_bot(api: Api) -> None:
    alice, bob, carol = [api.new_user(name) for name in ("alice", "bob", "carol")]
    game = api.new_game(owner=alice, allows_leave_mid_match=True)
    mid = api.new_match(owner=alice, game_id=game, joiners=[bob, carol], start=True)
    api.move(mid, as_user=alice, next_turn=1)
    result = api.ok("POST", f"/matches/{mid}/leave", as_user=bob)
    assert result["status"] == "over"
    assert result["turn_of_player_indices"] is None
    assert all(p["kind"] == "human" for p in result["players"])
    assert api.move(mid, as_user=carol, next_turn=2).status_code == 409


def test_the_match_ends_when_the_last_human_leaves(api: Api) -> None:
    alice = api.new_user("alice")
    game_id = api.new_game(owner=alice, allows_leave_mid_match=True)
    match_id = api.new_match(
        owner=alice, game_id=game_id, num_computer_opponents=1, start=True
    )
    match = api.ok("POST", f"/matches/{match_id}/leave", as_user=alice)
    assert api.summary(match) == {
        "status": "over",
        "players": ["alice", "computer"],
        "turn": None,
        "state": {"pot": 0},
    }


def test_cannot_leave_a_match_you_are_not_in_or_that_is_over(api: Api) -> None:
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)

    def leave(as_user: str) -> httpx.Response:
        return api.request("POST", f"/matches/{match_id}/leave", as_user=as_user)

    assert error(leave(carol)) == (403, "you are not a player in this match")
    api.move(match_id, as_user=alice, next_turn=None)
    assert error(leave(bob)) == (409, "the match is over")


def test_joining_mid_match_requires_the_game_to_allow_it(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice, allows_join_mid_match=False)
    match_id = api.new_match(
        owner=alice, game_id=game_id, joiners=[api.new_user("carol")], start=True
    )
    assert error(api.request("POST", f"/matches/{match_id}/join", as_user=bob)) == (
        409,
        "this game does not allow joining a match in progress",
    )


def test_joining_cannot_take_over_a_single_player_computer(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice, allows_join_mid_match=True)
    mid = api.new_match(owner=alice, game_id=game, num_computer_opponents=1, start=True)
    assert api.request("POST", f"/matches/{mid}/join", as_user=bob).status_code == 409
    assert api.match_summary(mid)["players"] == ["alice", "computer"]


def test_joining_mid_match_adds_seats_up_to_the_games_maximum(api: Api) -> None:
    alice, bob, carol, dave = (
        api.new_user(name) for name in ["alice", "bob", "carol", "dave"]
    )
    game_id = api.new_game(
        owner=alice, allowed_player_counts=[2, 3], allows_join_mid_match=True
    )
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)

    api.ok("POST", f"/matches/{match_id}/join", as_user=carol)
    assert api.match_summary(match_id)["players"] == ["alice", "bob", "carol"]
    assert error(api.request("POST", f"/matches/{match_id}/join", as_user=dave)) == (
        409,
        "the match is full",
    )


def test_cannot_join_a_match_that_is_over(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice, allows_join_mid_match=True)
    match_id = api.new_match(
        owner=alice, game_id=game_id, num_computer_opponents=1, start=True
    )
    api.move(match_id, as_user=alice, next_turn=None)
    assert error(api.request("POST", f"/matches/{match_id}/join", as_user=bob)) == (
        409,
        "the match is over",
    )
