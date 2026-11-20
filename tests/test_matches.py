import httpx

from game_platform.tests.helpers import Api, TEST_GAME_SECRET, error


def test_create_a_human_match(api: Api) -> None:
    alice = api.new_user("alice")
    game_id = api.new_game(owner=alice)
    response = api.request(
        "POST",
        "/matches",
        as_user=alice,
        json={"game_id": game_id},
    )
    assert response.status_code == 201
    match = response.json()
    assert match == {
        "id": match["id"],
        "game_id": game_id,
        "game_version": 1,
        "owner_user_id": alice,
        "match_kind": "multiplayer",
        "cloud_revision": 0,
        "single_player_state": None,
        "status": "waiting_for_players",
        "invite_code": match["invite_code"],
        "end_reason": None,
        "players": [
            {"player_index": 0, "kind": "human", "user_id": alice, "id": alice, "active": True},
        ],
        "turn_of_player_indices": None,
        "state": None,
        "move_count": 0,
        "last_move_player_index": None,
        "bet_per_player": 0,
        "max_loss": 0,
        "pending_leave_player_id": None,
        "pending_leave_payout": None,
        "pending_leave_ends_match": None,
        "token_pot": 0,
        "token_payouts": None,
        "rematch_match_id": None,
        "created_at": "2026-01-01T00:03:00Z",
        "updated_at": "2026-01-01T00:03:00Z",
        "turn_seconds": None,
        "turn_deadline": None,
        "timeouts": [],
        "server_time": "2026-01-01T00:04:00Z",
    }


def test_rematch_reuses_game_version_and_accepting_players_join_open_lobby(
    api: Api,
) -> None:
    alice, bob, carol, dave = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
        api.new_user("dave"),
    )
    game_id = api.new_game(owner=alice, allowed_player_counts=[2, 3, 4])
    match_id = api.new_match(
        owner=alice, game_id=game_id, joiners=[bob, carol], start=True
    )
    api.ok(
        "PATCH",
        f"/games/{game_id}",
        as_user=alice,
        json={"description": "Published version 2",
              "game_addition_request_id_and_secret": TEST_GAME_SECRET},
    )
    api.move(match_id, as_user=alice, next_turn=None, state={"winner": 0})

    rematch = api.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)
    rematch_id = rematch["id"]
    assert rematch["game_id"] == game_id
    assert rematch["game_version"] == 1
    assert rematch["status"] == "waiting_for_players"
    assert [player["user_id"] for player in rematch["players"]] == [alice]
    assert api.ok("GET", f"/matches/{match_id}")["rematch_match_id"] == rematch_id
    assert api.ok("GET", f"/matches/{rematch_id}")["id"] == rematch_id

    # Original players accept into the same lobby. Players who don't accept leave
    # seats open for other users to join.
    bob_rematch = api.ok("POST", f"/matches/{match_id}/rematch", as_user=bob)
    assert bob_rematch["id"] == rematch_id
    assert [player["user_id"] for player in bob_rematch["players"]] == [alice, bob]
    assert carol not in [player["user_id"] for player in bob_rematch["players"]]
    api.ok("POST", f"/matches/{rematch_id}/join", as_user=dave)

    # Repeated requests by an already accepted player are idempotent.
    assert (
        api.ok("POST", f"/matches/{match_id}/rematch", as_user=alice)["id"]
        == rematch_id
    )


def test_rematch_requires_a_finished_match_and_an_original_player(api: Api) -> None:
    alice, bob, stranger = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("stranger"),
    )
    game_id = api.new_game(owner=alice)
    waiting_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob])
    assert error(
        api.request("POST", f"/matches/{waiting_id}/rematch", as_user=alice)
    ) == (409, "a rematch can only be requested after the match ends")

    api.ok("POST", f"/matches/{waiting_id}/start", as_user=alice)
    api.move(waiting_id, as_user=alice, next_turn=None, state={"winner": 0})
    assert error(
        api.request("POST", f"/matches/{waiting_id}/rematch", as_user=stranger)
    ) == (403, "you are not a player in this match")


def test_legacy_computer_match_cannot_become_a_shared_rematch(api: Api) -> None:
    alice = api.new_user("alice")
    game_id = api.new_game(owner=alice, allowed_player_counts=[2, 3])
    match_id = api.new_match(
        owner=alice, game_id=game_id, num_computer_opponents=2, start=True
    )
    api.move(match_id, as_user=alice, next_turn=None, state={"winner": 0})
    assert api.request("POST", f"/matches/{match_id}/rematch", as_user=alice).status_code == 409
    assert api.ok("GET", f"/matches/{match_id}", as_user=alice)["match_kind"] == "computer"


def test_create_match_checks_the_game(api: Api) -> None:
    alice = api.new_user("alice")
    game_id = api.new_game(owner=alice, allowed_player_counts=[2, 3])
    unknown_game = api.request(
        "POST", "/matches", as_user=alice, json={"game_id": "nope"}
    )
    too_many_computers = api.request(
        "POST",
        "/matches",
        as_user=alice,
        json={"game_id": game_id, "num_computer_opponents": 3},
    )
    assert error(unknown_game) == (404, "game not found")
    assert too_many_computers.status_code == 422


def test_cannot_join_twice_or_join_a_full_match(api: Api) -> None:
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game_id = api.new_game(owner=alice, allowed_player_counts=[2])
    match_id = api.new_match(owner=alice, game_id=game_id)
    api.ok("POST", f"/matches/{match_id}/join", as_user=bob)

    again = api.request("POST", f"/matches/{match_id}/join", as_user=bob)
    full = api.request("POST", f"/matches/{match_id}/join", as_user=carol)
    assert error(again) == (409, "you are already a player in this match")
    assert error(full) == (409, "the match is full")



def test_start_a_match(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob])
    match = api.ok("POST", f"/matches/{match_id}/start", as_user=alice)
    # The game's newMatch decides the initial state and the first turn:
    # the echo game starts at seat 0 with an empty pot.
    assert api.summary(match) == {
        "status": "ongoing",
        "players": ["alice", "bob"],
        "turn": [0],
        "state": {"pot": 0},
    }


def test_start_is_rejected_when_it_does_not_make_sense(api: Api) -> None:
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game_id = api.new_game(owner=alice, allowed_player_counts=[2, 4])

    def start(match_id: str, *, as_user: str = alice) -> httpx.Response:
        return api.request("POST", f"/matches/{match_id}/start", as_user=as_user)

    alone = api.new_match(owner=alice, game_id=game_id)
    assert error(start(alone)) == (
        409,
        "multiplayer matches need at least two human players",
    )

    three = api.new_match(owner=alice, game_id=game_id, joiners=[bob, carol])
    assert error(start(three)) == (
        409,
        "the match has 3 players but the game allows [2, 4]",
    )

    two = api.new_match(owner=alice, game_id=game_id, joiners=[bob])
    assert error(start(two, as_user=bob)) == (403, "only the match's owner can do this")
    assert start(two).status_code == 200
    assert error(start(two)) == (409, "the match has already started")


def test_only_owner_can_view_a_computer_match(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(
        owner=alice, game_id=game_id, num_computer_opponents=1, start=True
    )
    api.move(match_id, as_user=alice, next_turn=1, state={"pot": 5})
    # The computer took its turn at once and handed it back to alice.

    assert api.request("GET", f"/matches/{match_id}", as_user=bob).status_code == 404
    assert api.request("GET", f"/matches/{match_id}").status_code == 404
    assert api.summary(api.ok("GET", f"/matches/{match_id}", as_user=alice)) == {
        "status": "ongoing",
        "players": ["alice", "computer"],
        "turn": [0],
        "state": {"pot": 5},
    }
    assert api.request("GET", f"/matches/{match_id}/moves").status_code == 404
    # Alice, seated, sees her views of both states.
    assert [
        move["new_state"]
        for move in api.ok("GET", f"/matches/{match_id}/moves", as_user=alice)
    ] == [{"pot": 5}, {"pot": 5}]
    assert error(api.request("GET", "/matches/nope")) == (404, "match not found")


def test_list_my_matches_with_filters(api: Api) -> None:
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    poker = api.new_game(owner=alice)
    chess = api.new_game(owner=alice)
    matches = {
        "alice's waiting poker": api.new_match(owner=alice, game_id=poker),
        "alice's ongoing chess with bob": api.new_match(
            owner=alice, game_id=chess, joiners=[bob], start=True
        ),
        "bob's poker joined by alice": api.new_match(
            owner=bob, game_id=poker, joiners=[alice]
        ),
        "carol's poker": api.new_match(
            owner=carol, game_id=poker, num_computer_opponents=1
        ),
    }
    names_by_id = {match_id: name for name, match_id in matches.items()}

    def listed(*, as_user: str, **params: str) -> list[str]:
        response = api.ok("GET", "/matches", as_user=as_user, params=params)
        return [names_by_id[match["id"]] for match in response]

    assert listed(as_user=alice) == [
        "alice's waiting poker",
        "alice's ongoing chess with bob",
        "bob's poker joined by alice",
    ]
    assert listed(as_user=alice, status="ongoing") == ["alice's ongoing chess with bob"]
    assert listed(as_user=alice, game_id=poker) == [
        "alice's waiting poker",
        "bob's poker joined by alice",
    ]
    assert listed(as_user=bob) == [
        "alice's ongoing chess with bob",
        "bob's poker joined by alice",
    ]
    assert listed(as_user=carol) == ["carol's poker"]
    assert error(api.request("GET", "/matches")) == (
        401,
        "missing or invalid X-User-Id / X-User-Password headers",
    )


def test_a_player_deletes_a_match_for_everyone(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)

    response = api.request("DELETE", f"/matches/{match_id}", as_user=alice)
    assert (response.status_code, response.content) == (204, b"")
    assert error(api.request("GET", f"/matches/{match_id}")) == (404, "match not found")
    assert api.ok("GET", "/matches", as_user=bob) == []


def test_only_players_delete_and_players_only_hide_an_ended_match(api: Api) -> None:
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game_id = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)

    def delete(as_user: str) -> httpx.Response:
        return api.request("DELETE", f"/matches/{match_id}", as_user=as_user)

    assert error(delete(carol)) == (
        403,
        "only a player in the match can delete it",
    )

    api.move(match_id, as_user=alice, next_turn=None)
    assert error(delete(carol)) == (403, "you are not a player in this match")
    assert delete(bob).status_code == 204

    def listed(as_user: str) -> int:
        return len(api.ok("GET", "/matches", as_user=as_user))

    assert {"alice": listed(alice), "bob": listed(bob)} == {"alice": 1, "bob": 0}
    assert api.ok("GET", f"/matches/{match_id}")["status"] == "over"


def test_departed_player_can_hide_finished_match_without_changing_it_for_others(
    api: Api,
) -> None:
    alice = api.new_user("alice", tokens=10)
    bob = api.new_user("bob", tokens=10)
    outsider = api.new_user("outsider")
    game_id = api.new_game(owner=alice, allows_leave_mid_match=True)
    match = api.ok(
        "POST", "/matches", as_user=alice,
        json={"game_id": game_id, "max_loss": 10},
    )
    match_id = match["id"]
    api.ok("POST", f"/matches/{match_id}/join", as_user=bob)
    api.ok("POST", f"/matches/{match_id}/start", as_user=alice)
    assert api.move(match_id, as_user=alice, next_turn=1).status_code == 201
    api.ok("POST", f"/matches/{match_id}/maybeLeave", as_user=bob)
    ended = api.ok("POST", f"/matches/{match_id}/playerLeft", as_user=bob)
    assert ended["status"] == "over"
    assert ended["players"][1]["active"] is False
    assert ended["token_pot"] == 0

    def listed(user_id: str) -> list[str]:
        return [item["id"] for item in api.ok("GET", "/matches", as_user=user_id)]

    def balances() -> dict[str, int]:
        return {
            user_id: api.ok("GET", f"/users/{user_id}", as_user=user_id)["token_balance"]
            for user_id in (alice, bob)
        }

    history = api.ok("GET", f"/matches/{match_id}/history", as_user=bob)
    assert len(history["moves"]) == 2
    settled_balances = balances()
    assert settled_balances == {alice: 10, bob: 10}
    assert listed(alice) == listed(bob) == [match_id]
    assert error(api.request("DELETE", f"/matches/{match_id}", as_user=outsider)) == (
        403, "you are not a player in this match",
    )

    assert api.request("DELETE", f"/matches/{match_id}", as_user=bob).status_code == 204
    assert listed(bob) == []
    assert listed(alice) == [match_id]
    remaining = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert remaining["status"] == "over"
    assert remaining["players"] == ended["players"]
    assert remaining["token_payouts"] == ended["token_payouts"]
    assert api.ok("GET", f"/matches/{match_id}/history", as_user=bob) == history
    assert balances() == settled_balances


# A minimal v2 race game whose playerLeft hands the turn to another
# player, so a leaver's seat is taken over and the match plays on.
_LEAVE_AND_PLAY_ON_GAME = r"""
const game = {
  newMatch(ctx) {
    return {state: {count: 0}, turn: [ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    const ids = ctx.players.map(p => p.id);
    const next = ids[(ids.indexOf(playerId) + 1) % ids.length];
    return {state: {count: state.count + 1}, turn: [next]};
  },
  computerMove(state, playerId, ctx) { return {}; },
  randomMove(state, playerId, ctx) { return {}; },
  viewFor(state, playerId, ctx) { return {count: state.count}; },
  playerLeft(state, playerId, ctx) {
    const others = ctx.players.map(p => p.id).filter(id => id !== playerId);
    return {state: state, turn: [others[0]], payouts: {}};
  },
};
"""


def test_the_creator_who_left_cannot_delete_the_match(api: Api) -> None:
    alice, bob, carol = (
        api.new_user("alice"),
        api.new_user("bob"),
        api.new_user("carol"),
    )
    game = api.create_game(
        {
            "name": "Counter race",
            "allowed_player_counts": [3],
            "allows_leave_mid_match": True,
            "code": "<div>counter</div>",
            "server_code": _LEAVE_AND_PLAY_ON_GAME,
        },
        alice,
    )
    match_id = api.new_match(
        owner=alice, game_id=game["id"], joiners=[bob, carol], start=True
    )

    api.ok("POST", f"/matches/{match_id}/maybeLeave", as_user=alice)
    left = api.ok("POST", f"/matches/{match_id}/playerLeft", as_user=alice)
    assert left["status"] == "ongoing"

    assert error(api.request("DELETE", f"/matches/{match_id}", as_user=alice)) == (
        403,
        "only a player in the match can delete it",
    )
    assert api.ok("GET", f"/matches/{match_id}")["status"] == "ongoing"
    assert api.request("DELETE", f"/matches/{match_id}", as_user=bob).status_code == 204
    assert error(api.request("GET", f"/matches/{match_id}")) == (404, "match not found")
