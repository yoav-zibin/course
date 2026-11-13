"""Phase 3 of the v2 Game API: matches of a game with server code are run
by the server.

The toy game is a race to 10: players add 1-3 to a shared counter, and each
player has a secret in the state that only they may see (viewFor). Starting
a match runs newMatch, moving runs applyMove, the state a player receives
is their own view, computers move on the server, and the winner of a paid
match is paid the pot by the game's own payouts.
"""

import hashlib
from dataclasses import replace

from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore
from game_platform.tests.helpers import Api, FakeClock

COUNTER_GAME = r"""
const game = {
  newMatch(ctx) {
    const secrets = {};
    for (const p of ctx.players) secrets[p.id] = "secret-of-" + p.id;
    return {state: {count: 0, secrets: secrets}, turn: [ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    if (!move || typeof move.add !== "number" || move.add < 1 || move.add > 3) {
      throw new InvalidMove("add must be between 1 and 3");
    }
    const count = state.count + move.add;
    const ids = ctx.players.map(p => p.id);
    const next = ids[(ids.indexOf(playerId) + 1) % ids.length];
    const over = count >= 10;
    const result = {
      state: {count: count, secrets: state.secrets},
      turn: over ? null : [next],
    };
    if (over) result.payouts = {[playerId]: ctx.pot};
    return result;
  },
  computerMove(state, playerId, ctx) { return {add: 1}; },
  randomMove(state, playerId, ctx) { return {add: 1}; },
  viewFor(state, playerId, ctx) {
    return {count: state.count, your_secret: state.secrets[playerId]};
  },
};
"""

COMPUTER_STARTS_GAME = COUNTER_GAME.replace(
    "turn: [ctx.players[0].id]};",
    "turn: [ctx.players[ctx.players.length - 1].id]};",
)

BUGGY_GAME = COUNTER_GAME.replace(
    "const count = state.count + move.add;",
    "const count = state.missing.deep + move.add;",
)


def _create_game(api: Api, owner: str, server_code: str = COUNTER_GAME) -> str:
    return api.create_game({
        "name": "Counter race",
        "allowed_player_counts": [2],
        "allows_leave_mid_match": True,
        "code": "<div>counter</div>",
        "server_code": server_code,
    }, owner)["id"]


def _start(api: Api, owner: str, game_id: str, joiner: str | None = None,
           **match_changes) -> str:
    match = api.ok(
        "POST", "/matches", as_user=owner,
        json={"game_id": game_id, **match_changes},
    )
    match_id = match["id"]
    if joiner is not None:
        api.ok("POST", f"/matches/{match_id}/join", as_user=joiner)
    started = api.ok("POST", f"/matches/{match_id}/start", as_user=owner, json={})
    assert started["status"] == "ongoing"
    return match_id


def _move(api: Api, match_id: str, *, as_user: str, add: int):
    return api.request(
        "POST", f"/matches/{match_id}/moves", as_user=as_user,
        json={"move": {"add": add}},
    )


def test_start_runs_new_match_and_views_are_per_player(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, joiner=bob)

    alice_view = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert alice_view["state"] == {"count": 0, "your_secret": f"secret-of-{alice}"}
    assert alice_view["turn_of_player_indices"] == [0]

    bob_view = api.ok("GET", f"/matches/{match_id}", as_user=bob)
    assert bob_view["state"] == {"count": 0, "your_secret": f"secret-of-{bob}"}

    # A spectator receives the game's spectator view (viewFor with no
    # player): the public count, but nobody's secret — never the state.
    carol = api.new_user("carol")
    spectator_view = api.ok("GET", f"/matches/{match_id}", as_user=carol)
    assert spectator_view["state"]["count"] == 0
    assert not spectator_view["state"].get("your_secret")


def test_spectator_sees_the_public_view_live_and_in_history(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, joiner=bob)
    carol = api.new_user("carol")

    response = _move(api, match_id, as_user=alice, add=2)
    assert response.status_code == 201

    live = api.ok("GET", f"/matches/{match_id}", as_user=carol)
    assert live["state"]["count"] == 2
    assert not live["state"].get("your_secret")

    history = api.ok("GET", f"/matches/{match_id}/history", as_user=carol)
    views = [history["initial_state"]] + [m["new_state"] for m in history["moves"]]
    assert [v["count"] for v in views] == [0, 2]
    assert all(not v.get("your_secret") for v in views)

    moves = api.ok("GET", f"/matches/{match_id}/moves", as_user=carol)
    assert moves[0]["new_state"]["count"] == 2
    assert not moves[0]["new_state"].get("your_secret")

    # A seated player's history still shows their own secret throughout.
    alice_history = api.ok("GET", f"/matches/{match_id}/history", as_user=alice)
    assert alice_history["initial_state"]["your_secret"] == f"secret-of-{alice}"
    assert alice_history["moves"][0]["new_state"]["your_secret"] == f"secret-of-{alice}"


def test_missing_game_record_never_exposes_the_full_state(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, joiner=bob)

    # The game version record disappears while the match lives on. The
    # store itself refuses this delete (the version is pinned by the
    # match), so tombstone it directly to simulate the record being gone
    # anyway. The API already 404s such a match; view_state is the last
    # line of defense for any caller holding the match record, and it
    # must show nothing — never fall back to the full state, which
    # carries every player's secret.
    api.platform._store._game_versions[game_id][0] = None
    match = api.platform._store.get_match(match_id)
    assert api.platform.view_state(match, alice) is None
    initial_view, _ = api.platform.view_history(match, alice)
    assert initial_view is None


def test_moves_run_apply_move_and_are_recorded(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, joiner=bob)

    response = _move(api, match_id, as_user=alice, add=2)
    assert response.status_code == 201
    after = response.json()
    assert after["state"]["count"] == 2
    assert after["turn_of_player_indices"] == [1]

    moves = api.ok("GET", f"/matches/{match_id}/moves", as_user=alice)
    assert len(moves) == 1
    assert moves[0]["move"] == {"add": 2}
    assert moves[0]["player_id"] == alice
    assert moves[0]["made_by_user_id"] == alice
    # The history shows the requesting player their own view of the state
    # after the move — never the full state (which holds bob's secret).
    assert moves[0]["new_state"] == {"count": 2, "your_secret": f"secret-of-{alice}"}
    # A caller without a seat gets the spectator view of the historical
    # state: the public count, nobody's secret.
    anonymous_moves = api.ok("GET", f"/matches/{match_id}/moves")
    assert anonymous_moves[0]["new_state"] == {"count": 2}


def test_wrong_turn_is_forbidden_and_illegal_move_is_a_400(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, joiner=bob)

    # Bob cannot move on Alice's turn (nobody acts on behalf of a seat).
    assert _move(api, match_id, as_user=bob, add=1).status_code == 403
    # Alice cannot make a move the game rejects.
    response = _move(api, match_id, as_user=alice, add=99)
    assert response.status_code == 400
    assert "add must be between 1 and 3" in response.text
    # Neither attempt changed the match.
    match = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert match["move_count"] == 0


def test_a_game_bug_is_a_500_and_is_recorded(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice, server_code=BUGGY_GAME)
    match_id = _start(api, alice, game_id, joiner=bob)

    assert _move(api, match_id, as_user=alice, add=1).status_code == 500
    # The match is unchanged, and the failure is recorded on the game version.
    match = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert match["move_count"] == 0
    errors = api.client.app.state.platform.all_data().game_version_errors
    assert [
        (e.game_id, e.function) for e in errors
    ] == [(game_id, "applyMove")]


def test_computer_moves_on_the_server(api: Api):
    alice = api.new_user("alice")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, num_computer_opponents=1)

    response = _move(api, match_id, as_user=alice, add=3)
    assert response.status_code == 201
    after = response.json()
    # The computer answered immediately (the delay is 0 in tests): its +1
    # brought the count to 4 and the turn came back to Alice.
    assert after["state"]["count"] == 4
    assert after["turn_of_player_indices"] == [0]
    moves = api.ok("GET", f"/matches/{match_id}/moves")
    assert [m["player_id"] for m in moves] == [alice, "computer-1"]
    assert moves[1]["move"] is None  # Computer choices are private too.


def test_resume_computer_moves_picks_up_matches_stuck_on_a_computer():
    """Computer moves are arranged on timers as play advances; a server
    restart loses the timers, so a match left on the computer's turn
    would wait forever (seen live 2026-10-28 after a crash: the match
    sat on the computer's turn for good). A fresh platform over the
    same store is a restart — still stuck — and resume_computer_moves,
    called once from main() at startup, must set it moving again."""
    store = InMemoryStore()
    # A long delay stands in for "the timer never fired": the process
    # died before the computer's reply came due.
    api = Api(store=store, computer_move_delay_seconds=3600)
    alice = api.new_user("alice")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, num_computer_opponents=1)

    response = _move(api, match_id, as_user=alice, add=3)
    assert response.status_code == 201
    stuck = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert stuck["state"]["count"] == 3
    assert stuck["turn_of_player_indices"] == [1]

    restarted = GamePlatform(
        store=store, clock=FakeClock(), computer_move_delay_seconds=0
    )
    still_stuck = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert still_stuck["state"]["count"] == 3

    restarted.resume_computer_moves()
    after = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert after["state"]["count"] == 4
    assert after["turn_of_player_indices"] == [0]
    assert after["move_count"] == 2


def test_computer_moves_first_when_it_has_the_first_turn(api: Api):
    alice = api.new_user("alice")
    game_id = _create_game(api, alice, server_code=COMPUTER_STARTS_GAME)
    match_id = _start(api, alice, game_id, num_computer_opponents=1)
    match = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert match["state"]["count"] == 1
    assert match["turn_of_player_indices"] == [0]
    assert match["move_count"] == 1


def test_paid_match_pays_the_pot_to_the_winner(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, joiner=bob, max_loss=10)

    # Race to 10: 3 + 3 + 1 + 1 + 2 — Alice makes the last move and wins.
    for user, add in [(alice, 3), (bob, 3), (alice, 1), (bob, 1), (alice, 2)]:
        assert _move(api, match_id, as_user=user, add=add).status_code == 201
    match = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert match["status"] == "over"
    assert match["token_payouts"] == {"0": 20}
    # Alice staked 10 (of her daily grant) and won the 20 pot; Bob lost his 10.
    assert api.ok("GET", f"/users/{alice}", as_user=alice)["token_balance"] == 20
    assert api.ok("GET", f"/users/{bob}", as_user=bob)["token_balance"] == 0


def test_v2_start_ignores_the_clients_initial_state(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match = api.ok("POST", "/matches", as_user=alice, json={"game_id": game_id})
    api.ok("POST", f"/matches/{match['id']}/join", as_user=bob)
    started = api.ok(
        "POST", f"/matches/{match['id']}/start", as_user=alice,
        json={"initial_state": {"count": 999},
              "first_turn_player_indices": [1]},
    )
    assert started["state"]["count"] == 0
    assert started["turn_of_player_indices"] == [0]


def _legacy_seed(match_id: str) -> int:
    """The pre-fix seed: the first 4 bytes of the match id's sha256 — the
    value anyone could compute (and that responses used to carry)."""
    return int.from_bytes(hashlib.sha256(match_id.encode()).digest()[:4], "big")


def test_match_seed_is_a_secret_and_never_in_responses(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)

    created = api.ok("POST", "/matches", as_user=alice, json={"game_id": game_id})
    assert "seed" not in created
    match_id = created["id"]
    api.ok("POST", f"/matches/{match_id}/join", as_user=bob)
    started = api.ok("POST", f"/matches/{match_id}/start", as_user=alice, json={})
    assert "seed" not in started
    fetched = api.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert "seed" not in fetched
    assert "seed" not in api.match_summary(match_id)

    stored = api.platform._store.get_match(match_id)
    assert stored.seed_version == 3
    assert stored.seed not in (0, _legacy_seed(match_id))

    # Every match gets its own secret.
    other = api.ok("POST", "/matches", as_user=alice, json={"game_id": game_id})
    other_stored = api.platform._store.get_match(other["id"])
    assert other_stored.seed != stored.seed


def test_call_seed_depends_on_the_secret_and_the_move_number(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match_id = _start(api, alice, game_id, joiner=bob)
    platform = api.platform
    stored = platform._store.get_match(match_id)

    first = platform._call_seed(stored)
    # Stable for the same match state, and not the value the old public
    # scheme (seed from the match id, advanced by the move number) predicts.
    assert first == platform._call_seed(stored)
    assert first != (_legacy_seed(match_id) + len(stored.moves)) % 2**32
    # A different secret or a later move number gives a different seed.
    assert platform._call_seed(replace(stored, seed=stored.seed + 1)) != first
    assert _move(api, match_id, as_user=alice, add=1).status_code == 201
    moved = platform._store.get_match(match_id)
    assert platform._call_seed(moved) != first


def test_legacy_match_is_rekeyed_when_it_starts(api: Api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = _create_game(api, alice)
    match = api.ok("POST", "/matches", as_user=alice, json={"game_id": game_id})
    match_id = match["id"]
    api.ok("POST", f"/matches/{match_id}/join", as_user=bob)

    store = api.platform._store
    legacy = _legacy_seed(match_id)
    store.put_match(replace(store.get_match(match_id), seed=legacy, seed_version=1))

    api.ok("POST", f"/matches/{match_id}/start", as_user=alice, json={})
    stored = store.get_match(match_id)
    assert stored.seed_version == 3
    assert stored.seed != legacy
