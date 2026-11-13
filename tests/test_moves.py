from typing import Any

import httpx

from game_platform.tests.helpers import Api, error, validation_errors


def test_players_take_turns(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)

    response = api.move(match_id, as_user=alice, next_turn=1, state={"pot": 10})
    assert response.status_code == 201
    assert api.summary(response.json()) == {
        "status": "ongoing",
        "players": ["alice", "bob"],
        "turn": [1],
        "state": {"pot": 10},
    }

    out_of_turn = api.move(match_id, as_user=alice, next_turn=1)
    assert error(out_of_turn) == (403, "it is not your turn")

    api.move(match_id, as_user=bob, next_turn=0, state={"pot": 20})
    assert api.match_summary(match_id)["turn"] == [0]


def test_any_player_in_the_turn_set_may_move(api: Api) -> None:
    alice, bob, carol = (api.new_user(name) for name in ["alice", "bob", "carol"])
    game_id = api.new_game(owner=alice, allowed_player_counts=[3])
    match_id = api.new_match(
        owner=alice, game_id=game_id, joiners=[bob, carol], start=True
    )

    # Alice gives the turn to both bob and carol.
    api.move(match_id, as_user=alice, next_turn=[1, 2])
    assert api.match_summary(match_id)["turn"] == [1, 2]

    # Carol moves first; the move is recorded for her seat.
    assert api.move(match_id, as_user=carol, next_turn=[0], state={"n": 1}).status_code == 201
    moves = api.ok("GET", f"/matches/{match_id}/moves")
    assert [
        (move["player_index"], move["next_turn_player_indices"]) for move in moves
    ] == [
        (0, [1, 2]),
        (2, [0]),
    ]

    # Bob can no longer move: the turn is alice's alone now.
    assert error(api.move(match_id, as_user=bob, next_turn=[0])) == (
        403,
        "it is not your turn",
    )

    # Either of them may move again; bob does, ending the match.
    assert api.move(match_id, as_user=alice, next_turn=[1, 2]).status_code == 201
    assert api.move(match_id, as_user=bob, next_turn=None).status_code == 201
    assert api.match_summary(match_id)["status"] == "over"


def test_only_players_can_move_and_only_in_an_ongoing_match(api: Api) -> None:
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob])

    assert error(api.move(match_id, as_user=alice, next_turn=1)) == (
        409,
        "the match is not ongoing",
    )
    api.ok("POST", f"/matches/{match_id}/start", as_user=alice)
    assert error(api.move(match_id, as_user=carol, next_turn=1)) == (
        403,
        "you are not a player in this match",
    )
    assert error(api.move("nope", as_user=alice, next_turn=1)) == (
        404,
        "match not found",
    )


def test_a_move_without_a_next_turn_ends_the_match(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)

    match = api.move(
        match_id, as_user=alice, next_turn=None, state={"winner": 0}
    ).json()
    assert (match["status"], match["end_reason"], match["turn_of_player_indices"]) == (
        "over",
        "finished",
        None,
    )
    assert error(api.move(match_id, as_user=bob, next_turn=0)) == (
        409,
        "the match is not ongoing",
    )


def test_full_move_history_is_recorded(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)
    api.move(match_id, as_user=alice, next_turn=1, state={"pot": 10})
    api.move(match_id, as_user=bob, next_turn=None, state={"winner": 1})

    # Fetched by alice: the echo game's viewFor returns the state itself,
    # so her views are the states the server computed.
    moves = api.ok("GET", f"/matches/{match_id}/moves", as_user=alice)
    assert moves == [
        {
            "move_number": 1,
            "player_index": 0,
            "made_by_user_id": alice,
            "created_at": moves[0]["created_at"],
            "new_state": {"pot": 10},
            "next_turn_player_indices": [1],
            "move": {"state": {"pot": 10}, "turn_indices": [1]},
            "player_id": alice,
        },
        {
            "move_number": 2,
            "player_index": 1,
            "made_by_user_id": bob,
            "created_at": moves[1]["created_at"],
            "new_state": {"winner": 1},
            "next_turn_player_indices": None,
            "move": None,  # Bob's raw payload is private to Bob.
            "player_id": bob,
        },
    ]
    assert moves[0]["created_at"] < moves[1]["created_at"]
    assert api.ok("GET", f"/matches/{match_id}")["move_count"] == 2


def test_expected_move_count_rejects_a_stale_move(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)
    api.move(match_id, as_user=alice, next_turn=1)

    def guarded_move(expected: int) -> httpx.Response:
        return api.request(
            "POST",
            f"/matches/{match_id}/moves",
            as_user=bob,
            json={
                "move": {"state": {"pot": 20}, "turn_indices": [0]},
                "expected_move_count": expected,
            },
        )

    # Bob's client is a move behind: its guarded move is rejected, and the
    # same move with the current count goes through.
    assert error(guarded_move(0)) == (409, "expected 0 moves but the match has 1")
    assert guarded_move(1).status_code == 201


def test_move_body_is_validated(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)
    response = api.request(
        "POST", f"/matches/{match_id}/moves", as_user=alice, json={"new_state": {}}
    )
    assert response.status_code == 422

    # The old single-index field is gone.
    old_style = api.request(
        "POST",
        f"/matches/{match_id}/moves",
        as_user=alice,
        json={"new_state": {}, "next_turn_player_index": 1},
    )
    assert old_style.status_code == 422
