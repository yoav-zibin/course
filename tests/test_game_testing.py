"""Phase 5 of the v2 Game API: random-walk testing of server code.

The tester plays whole matches with a game's own move generators and
reports failures the author can reproduce from a
seed. Publishing is gated on it: a submission whose server code fails is
refused and inserts nothing, and a game update that breaks the code is refused. The
seeds of failing walks are stored on the game and replayed first next
time, as regression seeds.
"""

import game_platform.game_testing as game_testing
from game_platform.tests.helpers import run_unrestricted_server_code as _test_server_code
from game_platform.models import GameRules
from game_platform.tests.helpers import Api, TEST_GAME_SCHEMAS

RULES = GameRules(
    allowed_player_counts=(2, 3),
    allows_leave_mid_match=True,
    allows_join_mid_match=True,
)


def run_game_tests(server_code, **kwargs):
    return _test_server_code(
        server_code, game_schemas=TEST_GAME_SCHEMAS, **kwargs
    )


GOOD_GAME = """
const SPLIT = (ctx) => {
  const humans = ctx.players.filter(p => p.kind === "human");
  const share = Math.floor(ctx.pot / humans.length);
  const payouts = {};
  humans.forEach((p, i) => {
    payouts[p.id] = share + (i < ctx.pot - share * humans.length ? 1 : 0);
  });
  return payouts;
};
const game = {
  newMatch(ctx) { return {state: {count: 0}, turn: [ctx.players[0].id]}; },
  applyMove(state, playerId, move, ctx) {
    if (typeof move !== "object" || move === null || move.add !== 1)
      throw new InvalidMove("send {add: 1}");
    const count = state.count + 1;
    const over = count >= 10;
    const ids = ctx.players.map(p => p.id);
    const result = {
      state: {count: count},
      turn: over ? null : [ids[(ids.indexOf(playerId) + 1) % ids.length]],
    };
    if (over) result.payouts = SPLIT(ctx);
    return result;
  },
  computerMove(state, playerId, ctx) { return {add: 1}; },
  randomMove(state, playerId, ctx) { return {add: 1}; },
  viewFor(state, playerId, ctx) { return {count: state.count}; },
  playerJoined(state, playerId, ctx) { return {state: state, turn: [playerId]}; },
  playerLeft(state, playerId, ctx) {
    const rest = ctx.players.filter(p => p.id !== playerId);
    return {state: state, turn: rest.length ? [rest[0].id] : null, payout: 0};
  },
};
"""

CRASH_GAME = GOOD_GAME.replace(
    "const count = state.count + 1;",
    'throw new Error("kaboom");',
)

ILLEGAL_GENERATOR_GAME = GOOD_GAME.replace(
    "computerMove(state, playerId, ctx) { return {add: 1}; },",
    "computerMove(state, playerId, ctx) { return {add: 5}; },",
).replace(
    "randomMove(state, playerId, ctx) { return {add: 1}; },",
    "randomMove(state, playerId, ctx) { return {add: 5}; },",
)

BAD_PAYOUT_GAME = GOOD_GAME.replace(
    "const over = count >= 10;", "const over = count >= 1;"
).replace(
    "if (over) result.payouts = SPLIT(ctx);",
    "if (over) result.payouts = {[playerId]: ctx.pot + 1};",
)

NONDETERMINISTIC_GAME = GOOD_GAME.replace(
    "const count = state.count + 1;",
    "gameCalls += 1;\n    const count = state.count + gameCalls;",
).replace(
    "const game = {",
    "let gameCalls = 0;\nconst game = {",
    1,
)

# The tester itself.


def test_a_correct_game_passes():
    # Keep this a coverage check rather than a machine-specific throughput test.
    # The budget is generous on purpose: the >100-walk assertion is about
    # coverage, and a tight wall-clock budget flakes on loaded machines.
    report = run_game_tests(
        GOOD_GAME, rules=RULES, run_seed=7, budget_seconds=10.0
    )
    assert report.passed
    assert report.failures == ()
    assert report.failed_seeds == ()
    assert report.walks_completed > 100
    assert report.moves_made > 0
    assert not report.too_slow


def test_a_crashing_apply_move_fails_with_a_usable_report():
    report = run_game_tests(CRASH_GAME, rules=RULES, run_seed=7)
    assert not report.passed
    (failure,) = report.failures
    assert failure.function == "applyMove"
    assert "kaboom" in failure.message
    # The exact arguments of the failing call, so the bug reproduces.
    assert failure.state == {"count": 0}
    assert failure.move == {"add": 1}
    assert failure.player_id is not None
    assert failure.seed in report.failed_seeds
    # Reproduction detail: the ctx, the exact arguments, what the call
    # cost against its limits.
    assert failure.ctx is not None
    assert failure.ctx["players"] and failure.ctx["pot"] >= 0
    assert failure.arguments is not None
    assert failure.arguments[0] == {"count": 0}
    assert failure.duration_ms >= 0
    assert failure.memory_used_bytes > 0
    assert failure.time_limit_seconds == 0.1
    assert failure.memory_limit_bytes == 64 * 1024 * 1024


def test_a_failure_report_names_the_call_cost_and_replays():
    from game_platform.game_testing import format_failure, format_report
    report = run_game_tests(CRASH_GAME, rules=RULES, run_seed=7)
    assert not report.passed
    (failure,) = report.failures
    text = format_failure(failure)
    assert f"seed {failure.seed}" in text
    assert "ctx:" in text and "arguments:" in text
    assert "took" in text and "memory" in text
    assert "last moves" in text or "move" in text
    assert "walks" in format_report(report)


def test_a_generated_move_the_game_itself_rejects_fails():
    report = run_game_tests(ILLEGAL_GENERATOR_GAME, rules=RULES, run_seed=7)
    assert not report.passed
    assert report.failures
    assert all(f.function == "applyMove" for f in report.failures)
    assert all("rejected" in f.message for f in report.failures)


def test_payouts_that_do_not_sum_to_the_pot_fail():
    report = run_game_tests(BAD_PAYOUT_GAME, rules=RULES, run_seed=7)
    assert not report.passed
    assert report.failures
    assert all(f.function == "applyMove" for f in report.failures)
    assert all(
        "payouts" in f.message or "paid tokens" in f.message
        for f in report.failures
    )


def test_a_non_deterministic_game_fails():
    report = run_game_tests(
        NONDETERMINISTIC_GAME,
        rules=GameRules(
            allowed_player_counts=(2,),
            allows_leave_mid_match=False,
            allows_join_mid_match=False,
        ),
        run_seed=7,
    )
    assert not report.passed
    (failure,) = report.failures
    assert failure.function == "applyMove"
    assert "non-deterministic" in failure.message


def test_non_determinism_after_the_first_move_is_detected():
    code = GOOD_GAME.replace(
        "const count = state.count + 1;",
        "const count = state.count + 1 + (state.count >= 2 ? calls++ : 0);",
    ).replace("const game = {", "let calls = 0;\nconst game = {", 1)
    rules = GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                      allows_join_mid_match=False)
    report = run_game_tests(code, rules=rules, run_seed=7)
    assert not report.passed
    assert any(f.function == "applyMove" and "non-deterministic" in f.message
               for f in report.failures)


def test_non_deterministic_views_are_detected():
    code = GOOD_GAME.replace(
        "viewFor(state, playerId, ctx) { return {count: state.count}; },",
        "viewFor(state, playerId, ctx) { return {count: calls++}; },",
    ).replace("const game = {", "let calls = 0;\nconst game = {", 1)
    report = run_game_tests(code, rules=RULES, run_seed=7)
    assert not report.passed
    assert any(f.function == "viewFor" and "non-deterministic" in f.message
               for f in report.failures)


def test_no_walk_completed_within_the_budget_is_reported_too_slow(monkeypatch):
    clock_values = iter((0.0, 0.3))
    monkeypatch.setattr(game_testing.time, "monotonic", lambda: next(clock_values))
    report = run_game_tests(
        GOOD_GAME, rules=RULES, run_seed=7, budget_seconds=0.3
    )
    assert not report.passed
    assert report.too_slow
    assert report.walks_completed == 0


def test_failed_seeds_are_replayed_first():
    report = run_game_tests(
        CRASH_GAME, rules=RULES, run_seed=7, regression_seeds=(424242,)
    )
    assert not report.passed
    assert report.failed_seeds[0] == 424242
    assert report.failures[0].seed == 424242


# The HTTP endpoint and the publish gate.


def test_updating_a_game_to_broken_server_code_is_refused(api: Api):
    owner = api.new_user("owner")
    game = api.create_game(
        {"name": "Direct", "allowed_player_counts": [2],
         "code": "<div></div>", "server_code": GOOD_GAME},
        owner,
    )
    response = api.request(
        "PATCH", f"/games/{game['id']}", as_user=owner,
        json={"server_code": CRASH_GAME},
    )
    assert response.status_code == 400
    assert "failed its tests" in response.json()["detail"]
    # The published version is unchanged.
    assert api.ok("GET", f"/games/{game['id']}")["version"] == 1
