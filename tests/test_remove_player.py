"""The owner of a match that hasn't started can remove a player, who then can't
join it again: the way out when someone sits in the waiting room and blocks the
start."""

import dataclasses

from game_platform.tests.helpers import Api

STAKE = 5


def balance(api: Api, user_id: str) -> int:
    user = api.platform._store.get_user(user_id)
    assert user is not None
    return user.token_balance


def waiting_match(api: Api, *, bet: int = 0) -> tuple[str, str, str]:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice, allowed_player_counts=(2,))
    match = api.ok(
        "POST", "/matches", as_user=alice, json={"game_id": game_id, "bet_per_player": bet}
    )
    api.ok("POST", f"/matches/{match['id']}/join", as_user=bob)
    return match["id"], alice, bob


def remove(api: Api, match_id: str, user_id: str, *, as_user: str):  # type: ignore[no-untyped-def]
    return api.request("DELETE", f"/matches/{match_id}/players/{user_id}", as_user=as_user)


def test_the_owner_removes_a_player_who_then_cannot_rejoin() -> None:
    api = Api()
    match_id, alice, bob = waiting_match(api)
    response = remove(api, match_id, bob, as_user=alice)
    assert response.status_code == 200, response.text
    assert [p["user_id"] for p in response.json()["players"]] == [alice]
    rejoin = api.request("POST", f"/matches/{match_id}/join", as_user=bob)
    assert (rejoin.status_code, rejoin.json()["detail"]) == (
        403,
        "you were removed from this match",
    )
    # Someone else takes the seat and the match starts.
    carol = api.new_user("carol")
    api.ok("POST", f"/matches/{match_id}/join", as_user=carol)
    assert api.ok("POST", f"/matches/{match_id}/start", as_user=alice)["status"] == "ongoing"


def test_removing_a_player_who_spent_their_tokens_unblocks_a_paid_match() -> None:
    # The gap left by checking balances on join: Bob could afford the stake when
    # he joined, then spent it, and now Start fails for everyone.
    api = Api()
    match_id, alice, bob = waiting_match(api, bet=STAKE)
    store = api.platform._store
    user = store.get_user(bob)
    assert user is not None
    store.put_user(
        dataclasses.replace(
            user, token_balance=0, last_token_grant_day=api.platform.now().date().isoformat()
        )
    )
    blocked = api.request("POST", f"/matches/{match_id}/start", as_user=alice)
    assert blocked.status_code == 409
    assert remove(api, match_id, bob, as_user=alice).status_code == 200
    carol = api.new_user("carol")
    api.ok("POST", f"/matches/{match_id}/join", as_user=carol)
    started = api.ok("POST", f"/matches/{match_id}/start", as_user=alice)
    assert (started["status"], started["token_pot"]) == ("ongoing", 2 * STAKE)
    assert balance(api, bob) == 0  # nothing was taken from (or given to) Bob


def test_removing_a_player_from_a_v2_waiting_room_refunds_their_stake() -> None:
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    server_code = (
        "function newMatch(ctx){return {state:{n:0},turn:[ctx.players[0].id]};}"
        "function applyMove(state,playerId,move,ctx){return {state:{n:state.n+1},turn:null,"
        "payouts:Object.fromEntries(ctx.players.map(p=>[p.id,ctx.pot/ctx.players.length]))};}"
        "function viewFor(state,playerId,ctx){return state;}"
    )
    game = api.request(
        "POST",
        "/games",
        as_user=alice,
        json={
            "name": "V2",
            "allowed_player_counts": [2],
            "allows_leave_mid_match": False,
            "allows_join_mid_match": False,
            "code": "<div></div>",
            "server_code": server_code,
        },
    )
    assert game.is_success, game.text
    match = api.ok(
        "POST", "/matches", as_user=alice, json={"game_id": game.json()["id"], "bet_per_player": STAKE}
    )
    api.ok("POST", f"/matches/{match['id']}/join", as_user=bob)
    assert balance(api, bob) == 10 - STAKE  # v2 takes the stake on joining
    after = remove(api, match["id"], bob, as_user=alice)
    assert after.status_code == 200, after.text
    assert after.json()["token_pot"] == STAKE  # only Alice's stake is left
    assert balance(api, bob) == 10


def test_only_the_owner_can_remove_and_only_before_the_start() -> None:
    api = Api()
    match_id, alice, bob = waiting_match(api)
    outsider = api.new_user("outsider")
    for user_id, as_user, status, detail in (
        (alice, bob, 403, "only the match's owner can do this"),
        (bob, outsider, 403, "only the match's owner can do this"),
        (alice, alice, 409, "the owner cannot remove themselves; delete the match instead"),
        (outsider, alice, 404, "that user is not a player in this match"),
    ):
        response = remove(api, match_id, user_id, as_user=as_user)
        assert (response.status_code, response.json()["detail"]) == (status, detail)
    api.ok("POST", f"/matches/{match_id}/start", as_user=alice)
    response = remove(api, match_id, bob, as_user=alice)
    assert (response.status_code, response.json()["detail"]) == (
        409,
        "players can only be removed before the match starts",
    )


def test_quick_matches_have_no_removal() -> None:
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice, allowed_player_counts=(3,))
    match = api.ok("POST", "/matchmaking/quick-match", as_user=alice, json={"game_id": game_id})
    api.ok("POST", "/matchmaking/quick-match", as_user=bob, json={"game_id": game_id})
    response = remove(api, match["id"], bob, as_user=alice)
    assert (response.status_code, response.json()["detail"]) == (
        409,
        "players can't be removed from a quick match",
    )
