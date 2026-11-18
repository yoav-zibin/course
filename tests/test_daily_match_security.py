"""Match privacy fails closed, including legacy lifecycle callbacks."""

from dataclasses import replace
import datetime as dt
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from game_platform.game_logic import InvalidMoveError
from game_platform.agent_import import GameImport
from game_platform.game_logic import GameLogic
from game_platform.tests.test_server_matches import COUNTER_GAME, _create_game, _start
from game_platform.tests.helpers import UnrestrictedGameLogic


@pytest.mark.parametrize("storage", ["globalThis.previous", "remembered"])
def test_game_context_cannot_carry_private_state_between_calls(storage):
    logic = UnrestrictedGameLogic("""
        let remembered = null;
        const game = {
          viewFor(state, playerId, ctx) {
            const previous = STORAGE;
            STORAGE = state.secret;
            return previous || null;
          }
        };
    """.replace("STORAGE", storage))
    ctx = {"players": [], "pot": 0, "move_count": 0}
    assert logic.call("viewFor", {"secret": "alice-private-match-state"}, None, ctx=ctx) is None
    assert logic.call("viewFor", {"secret": "bob-private-match-state"}, None, ctx=ctx) is None


def test_rejected_move_cannot_leave_private_state_for_a_later_view():
    logic = UnrestrictedGameLogic("""
        let retained = null;
        const game = {
          applyMove(state, playerId, move, ctx) {
            retained = state.secret;
            throw new InvalidMove('rejected');
          },
          viewFor(state, playerId, ctx) {return retained;}
        };
    """)
    ctx = {"players": [{"id": "alice", "kind": "human"}], "pot": 0, "move_count": 0}
    with pytest.raises(InvalidMoveError):
        logic.call("applyMove", {"secret": "hidden-card-choice"}, "alice", {}, ctx=ctx)
    assert logic.call("viewFor", {}, None, ctx=ctx) is None


@pytest.mark.parametrize("revealed", [False, True])
def test_bundled_memory_views_do_not_depend_on_unrevealed_card_values(revealed):
    path = Path(__file__).resolve().parents[1] / "games/declarative/memory.json"
    body = GameImport.model_validate_json(path.read_text())
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = {"players": [{"id": who, "kind": "human"} for who in ("alice", "bob")], "pot": 0, "move_count": 0}
    state = logic.call("newMatch", ctx=ctx, seed=42)["state"]
    if revealed:
        state = logic.call("applyMove", state, "alice", {"cell": 0}, ctx=ctx, seed=43)["state"]
        ctx = {**ctx, "move_count": 1}
    alternative = json.loads(json.dumps(state))
    start = 1 if revealed else 0
    alternative["board"][start:] = reversed(alternative["board"][start:])
    assert alternative["board"] != state["board"]
    for caller in ("alice", "bob", "outsider", None):
        view = logic.call("viewFor", state, caller, ctx=ctx, seed=44)
        assert view == logic.call("viewFor", alternative, caller, ctx=ctx, seed=44)
        assert all(value == -1 or (revealed and index == 0) for index, value in enumerate(view["board"]))


def test_invalid_move_from_view_for_never_exposes_its_diagnostic(api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, joiner=bob)
    api.ok("POST", f"/matches/{match_id}/moves", as_user=alice, json={"move": {"add": 1}})
    logic = api.platform._logic_for(api.platform._store.get_game(game_id))
    api.platform._view_cache.clear()
    diagnostic = "private-hidden-hand-diagnostic"
    with patch.object(logic, "call", side_effect=InvalidMoveError(diagnostic)):
        for caller in (alice, bob, None):
            current = api.request("GET", f"/matches/{match_id}", as_user=caller)
            assert current.status_code == 200
            assert current.json()["state"] is None
            assert diagnostic not in current.text
            history = api.request("GET", f"/matches/{match_id}/history", as_user=caller)
            assert history.status_code == 200
            assert history.json()["initial_state"] is None
            assert all(move["new_state"] is None for move in history.json()["moves"])
            assert diagnostic not in history.text
            if getattr(api.platform._store, "scalable", False):
                paged = api.request("GET", f"/v2/matches/{match_id}/history", as_user=caller)
                assert paged.status_code == 200
                assert paged.json()["initial_state"] is None
                assert all(move["new_state"] is None for move in paged.json()["items"])
                assert diagnostic not in paged.text


@pytest.mark.parametrize("seed_version", [1, 2])
@pytest.mark.parametrize("action", ["join", "leave", "preview"])
def test_legacy_random_stream_is_rekeyed_before_lifecycle_callbacks(api, seed_version, action):
    alice, bob, carol = [api.new_user(name) for name in ("alice", "bob", "carol")]
    game_id = api.create_game({
        "name": "Lifecycle random stream",
        "code": "<div></div>",
        "server_code": COUNTER_GAME.replace("const game = {", """const game = {
          playerJoined(state, id, ctx) {
            return {state: {...state, lifecycle_random: ctx.random()}, turn: [ctx.players[0].id]};
          },
          playerLeft(state, id, ctx) {
            return {state: {...state, lifecycle_random: ctx.random()}, turn: null, payouts: {}};
          },"""),
        "allowed_player_counts": [2, 3],
        "allows_join_mid_match": True,
        "allows_leave_mid_match": True,
    }, alice)["id"]
    match_id = _start(api, alice, game_id, joiner=bob)
    store = api.platform._store
    legacy = replace(store.get_match(match_id), seed=42, seed_version=seed_version)
    store.put_match(legacy)
    fresh_secret = (1 << 255) + 987654321
    function = "playerJoined" if action == "join" else "playerLeft"
    seen = []
    original = api.platform._call_logic

    def call(game, match, name, *args, **kwargs):
        if name == function:
            seen.append((match.seed, match.seed_version))
        return original(game, match, name, *args, **kwargs)

    path = {"join": "join", "leave": "leave", "preview": "maybeLeave"}[action]
    with patch.object(api.platform, "_new_seed", return_value=fresh_secret), patch.object(
        api.platform, "_call_logic", side_effect=call
    ):
        result = api.ok("POST", f"/matches/{match_id}/{path}", as_user=carol if action == "join" else alice)
    assert seen == [(fresh_secret, 3)]
    stored = store.get_match(match_id)
    assert (stored.seed, stored.seed_version) == (fresh_secret, 3)
    assert not {"seed", "seed_version", "pending_leave"} & result.keys()
    if action == "preview":
        expected = stored.pending_leave["state"]
        api.ok("POST", f"/matches/{match_id}/playerLeft", as_user=alice)
        assert store.get_match(match_id).state == expected
        assert store.get_match(match_id).seed == fresh_secret


def test_partial_payout_cannot_be_replaced_by_a_player_refund(api):
    alice, bob = api.new_user("alice", tokens=10), api.new_user("bob", tokens=10)
    game_id = api.new_game(owner=alice, allowed_player_counts=(2,))
    match_id = _start(api, alice, game_id, joiner=bob, max_loss=5)
    store = api.platform._store
    payload = {"move": {"turn_indices": [1], "payouts": {alice: 4}}, "expected_move_count": 0}
    result = api.ok("POST", f"/matches/{match_id}/moves", as_user=alice, json=payload)
    assert result["token_pot"] == 6
    assert [store.get_user(uid).token_balance for uid in (alice, bob)] == [9, 5]
    assert api.request("POST", f"/matches/{match_id}/moves", as_user=alice, json=payload).status_code == 409
    for caller in (alice, bob, bob):
        assert api.request("DELETE", f"/matches/{match_id}", as_user=caller).status_code == 409
    assert [store.get_user(uid).token_balance for uid in (alice, bob)] == [9, 5]
    assert store.get_match(match_id).token_pot == 6
    result = api.ok("POST", f"/matches/{match_id}/moves", as_user=bob,
                    json={"move": {"turn_indices": None, "payouts": {bob: 6}}, "expected_move_count": 1})
    assert result["token_pot"] == 0
    for _ in range(2):
        api.ok("DELETE", f"/matches/{match_id}", as_user=bob)
    assert [store.get_user(uid).token_balance for uid in (alice, bob)] == [9, 11]
    assert sum(store.get_user(uid).token_balance for uid in (alice, bob)) == 20


@pytest.mark.parametrize("reason", ["revoked", "expired", "consumed"])
def test_unusable_bearer_invites_no_longer_disclose_private_matches(api, reason):
    alice, bob, outsider = [api.new_user(name) for name in ("alice", "bob", "outsider")]
    game_id = _create_game(api, alice)
    match_id = api.ok("POST", "/matches", as_user=alice,
                      json={"game_id": game_id, "private": True})["id"]
    invite = api.ok("POST", f"/matches/{match_id}/invites", as_user=alice,
                    json={"max_uses": 1} if reason == "consumed" else {})
    token = invite["token"]
    api.ok("POST", f"/invites/{token}/accept", as_user=bob)
    api.ok("POST", f"/matches/{match_id}/start", as_user=alice)
    if reason == "revoked":
        api.ok("POST", f"/invites/{token}/revoke", as_user=alice)
    elif reason == "expired":
        stored = api.platform._store.get_invite(token)
        api.platform._store.put_invite(replace(stored, expires_at=dt.datetime(2000, 1, 1, tzinfo=dt.timezone.utc)))
    for caller in (None, outsider):
        response = api.request("GET", f"/invites/{token}", as_user=caller)
        assert response.status_code == 404
        assert match_id not in response.text
        assert "secret-of-" not in response.text
    # A seated player retains their own authenticated view independently of the link.
    assert api.ok("GET", f"/matches/{match_id}", as_user=bob)["state"]["your_secret"] == f"secret-of-{bob}"
