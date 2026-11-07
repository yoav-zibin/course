"""November 6: authoritative leave results and human-only multiplayer."""

import pytest

from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.game_logic import GameLogicError
from game_platform.tests.test_server_leaving import (
    LEAVE_GAME, _balance, _create_game, _paid_match, _move,
)

END_GAME = LEAVE_GAME.replace(
    "return {state: state, turn: [others[0]], payout: Math.floor(ctx.pot / 2)};",
    "return {state: {count: state.count, ended: true}, turn: null, "
    "payouts: {[playerId]: 3, [others[0]]: ctx.pot - 3}};",
).replace("return {count: state.count};", "return {count: state.count, ended: state.ended === true};")


def test_leave_uses_game_distribution_and_pays_exactly_once(api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = _create_game(api, alice, END_GAME)
    match_id = _paid_match(api, alice, game, bob)
    preview = api.ok("POST", f"/matches/{match_id}/maybeLeave", as_user=bob)
    assert preview["pending_leave_payout"] == 3
    assert preview["pending_leave_ends_match"] is True
    assert _balance(api, bob) == _balance(api, alice) == 0
    result = api.ok("POST", f"/matches/{match_id}/playerLeft", as_user=bob)
    assert result["status"] == "over"
    assert result["state"]["ended"] is True
    assert result["token_pot"] == 0
    assert result["token_payouts"] == {"0": 17, "1": 3}
    assert [p["kind"] for p in result["players"]] == ["human", "human"]
    assert result["players"][1]["active"] is False
    assert result["move_count"] == 1
    assert api.request("POST", f"/matches/{match_id}/playerLeft", as_user=bob).status_code in (403, 409)
    assert (_balance(api, alice), _balance(api, bob)) == (17, 3)


@pytest.mark.parametrize("payouts", ["{}", "{[playerId]: ctx.pot + 1}",
    "{[playerId]: -1}", "{[playerId]: true}", "{outsider: ctx.pot}", "null"])
def test_invalid_leave_result_does_not_change_match_or_balances(api, payouts):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    code = END_GAME.replace("{[playerId]: 3, [others[0]]: ctx.pot - 3}", payouts)
    match_id = _paid_match(api, alice, _create_game(api, alice, code), bob)
    before = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert api.request("POST", f"/matches/{match_id}/maybeLeave", as_user=bob).status_code == 500
    after = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    for key in ("status", "state", "players", "token_pot", "move_count", "pending_leave_payout"):
        assert after[key] == before[key]
    assert _balance(api, alice) == _balance(api, bob) == 0


def test_continuing_leave_keeps_indices_and_cannot_be_played_by_leaver(api):
    users = [api.new_user(str(i)) for i in range(3)]
    code = LEAVE_GAME.replace("const ids = ctx.players.map(p => p.id);",
                             "const ids = ctx.players.filter(p => p.active !== false).map(p => p.id);")
    code = code.replace("return {state: state, turn: [others[0]], payout: Math.floor(ctx.pot / 2)};",
                        "return {state, turn: [others[0]], payouts: {[playerId]: 2}};")
    game = api.create_game({"name": "Elimination",
        "allowed_player_counts": [3], "allows_leave_mid_match": True,
        "code": "<div></div>", "server_code": code}, users[0])
    match = api.ok("POST", "/matches", as_user=users[0], json={"game_id": game["id"], "max_loss": 10})
    mid = match["id"]
    for user in users[1:]:
        api.ok("POST", f"/matches/{mid}/join", as_user=user)
    api.ok("POST", f"/matches/{mid}/start", as_user=users[0], json={})
    left = api.ok("POST", f"/matches/{mid}/leave", as_user=users[2])
    assert left["status"] == "ongoing"
    assert left["token_pot"] == 28
    assert [p["player_index"] for p in left["players"]] == [0, 1, 2]
    assert left["players"][2]["active"] is False
    assert api.ok("GET", f"/matches/{mid}", as_user=users[2])["state"] is None
    assert all(p["kind"] == "human" for p in left["players"])
    assert _move(api, mid, as_user=users[2], add=1).status_code == 403
    for i in range(10):
        final = _move(api, mid, as_user=users[i % 2], add=1)
        assert final.status_code == 201
    assert final.json()["token_pot"] == 0
    assert sum(final.json()["token_payouts"].values()) == 30
    assert sum(_balance(api, u) for u in users) == 30


def test_bots_cannot_be_added_to_multiplayer_or_joined_via_invite(api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice, allowed_player_counts=[2, 3, 4], allows_join_mid_match=True)
    multi = api.new_match(owner=alice, game_id=game, joiners=[bob])
    assert api.request("PATCH", f"/matches/{multi}", as_user=alice,
                       json={"num_computer_opponents": 1}).status_code == 409
    solo = api.new_match(owner=alice, game_id=game, num_computer_opponents=1)
    assert api.request("POST", f"/matches/{solo}/join", as_user=bob).status_code == 409
    invitation = api.ok("POST", f"/matches/{solo}/invites", as_user=alice, json={})
    assert api.request("POST", f"/invites/{invitation['token']}/accept", as_user=bob).status_code == 409
    assert solo not in [m["id"] for m in api.ok("GET", "/matches/open")]
    api.ok("PATCH", f"/matches/{solo}", as_user=alice, json={"num_computer_opponents": 0})
    joined = api.ok("POST", f"/matches/{solo}/join", as_user=bob)
    assert all(p["kind"] == "human" for p in joined["players"])


def test_emulator_rejects_mixed_multiplayer_but_accepts_solo_bots(api):
    user = api.new_user("builder")
    body = {"server_code": LEAVE_GAME, "players": [{"kind": "human"}, {"kind": "human"}, {"kind": "computer"}]}
    assert api.request("POST", "/emulator/reset", as_user=user, json=body).status_code == 422
    body["players"].pop(0)
    assert api.request("POST", "/emulator/reset", as_user=user, json=body).status_code == 200


def test_legacy_mixed_match_ends_and_refunds_once(api):
    from dataclasses import replace
    from game_platform.models import Seat

    alice, bob = api.new_user("alice"), api.new_user("bob")
    mid = _paid_match(api, alice, _create_game(api, alice, END_GAME), bob)
    store = api.client.app.state.platform._store
    old = store.get_match(mid)
    store.put_match(replace(old, seats=(*old.seats, Seat(
        player_index=2, kind="computer", user_id=None,
    )), turn_of_player_indices=frozenset({2})))
    for _ in range(2):
        result = api.ok("GET", f"/matches/{mid}", as_user=alice)
        assert result["status"] == "over"
        assert result["end_reason"] == "solo_computers_only"
        assert result["token_pot"] == 0
        assert result["move_count"] == 0
    assert (_balance(api, alice), _balance(api, bob)) == (10, 10)


@pytest.mark.parametrize("function", ["applyMove", "playerLeft"])
def test_shared_contract_rejects_missing_turn_and_overspending(function):
    ctx = {"players": [{"id": "a", "kind": "human"}], "pot": 10}
    for result in ({"state": {}}, {"state": {}, "turn": ["a"], "payouts": {"a": 11}},
                   {"state": {}, "turn": None}, {"state": {}, "turn": ["a", "a"]}):
        with pytest.raises(GameLogicError):
            GameLogic._validate_result(function, result, ctx)
