"""Deterministic leaving/settlement probes (builder_checks.settlement_probes).

The reference server below implements the platform contract exactly; each
broken variant reproduces one failure class seen in real guided builds and
must be caught by the probes with the matching scenario label.
"""
from types import SimpleNamespace

from game_platform.builder_checks import CHECKS, PLATFORM_CONTRACT, REVIEW_DISCIPLINE, settlement_probes
from game_platform.builder_validation import probe_leaving

CONTRACT = {'state_schema': {'type': 'object'}, 'view_schema': {'type': 'object'},
            'move_schema': {'type': 'object'}, 'cases': []}

REFERENCE = r'''
function nextSeat(state, ctx, from) {
  for (let step = 1; step <= ctx.players.length; step++) {
    const idx = (from + step) % ctx.players.length;
    if (!state.left.includes(ctx.players[idx].id)) return idx;
  }
  return from;
}
function eligibleIds(ctx) {
  return ctx.players.filter(p => p.kind === 'human' && p.active !== false).map(p => p.id);
}
function settle(ctx, winnerId) {
  const pot = ctx.pot || 0;
  if (!pot) return {};
  const elig = eligibleIds(ctx);
  if (winnerId && elig.includes(winnerId)) return {[winnerId]: pot};
  if (!elig.length) return {};
  const share = Math.floor(pot / elig.length);
  let rem = pot - share * elig.length;
  const out = {};
  for (const id of elig) out[id] = share + (rem-- > 0 ? 1 : 0);
  return out;
}
const game = {
  newMatch(ctx) {
    return {state: {moves: 0, turnSeat: 0, left: [], winner: null, finalPayouts: null},
            turn: [ctx.players[0].id]};
  },
  viewFor(state, playerId, ctx) { return state; },
  randomMove(state, playerId, ctx) { return {type: 'pass'}; },
  computerMove(state, playerId, ctx) { return {type: 'pass'}; },
  applyMove(state, playerId, move, ctx) {
    const s = {...state, moves: state.moves + 1, left: [...state.left]};
    s.turnSeat = nextSeat(s, ctx, state.turnSeat);
    return {state: s, turn: [ctx.players[s.turnSeat].id]};
  },
  playerLeft(state, playerId, ctx) {
    if (state.finalPayouts) return {state, turn: null, payouts: state.finalPayouts};
    const seat = ctx.players.find(p => p.id === playerId);
    if (!seat || seat.active === false) return {state, turn: [ctx.players[state.turnSeat].id]};
    const remaining = eligibleIds(ctx).filter(id => id !== playerId);
    const s = {...state, left: [...state.left, playerId]};
    if (remaining.length < 2) {
      const others = ctx.players.filter(p => p.id !== playerId);
      s.winner = others.length === 1 ? others[0].id : null;
      s.finalPayouts = settle(ctx, s.winner);
      return {state: s, turn: null, payouts: s.finalPayouts};
    }
    if (ctx.players[s.turnSeat].id === playerId) s.turnSeat = nextSeat(s, ctx, s.turnSeat);
    return {state: s, turn: [ctx.players[s.turnSeat].id]};
  },
};
'''

# B1: re-settles on every leave, paying whoever just left — a leave after
# the end therefore returns different payouts than the recorded ones.
B1_RESETTLES = REFERENCE.replace(
    "    if (state.finalPayouts) return {state, turn: null, payouts: state.finalPayouts};\n"
    "    const seat = ctx.players.find(p => p.id === playerId);\n"
    "    if (!seat || seat.active === false) return {state, turn: [ctx.players[state.turnSeat].id]};",
    "    const seat = ctx.players.find(p => p.id === playerId);")
# B1 also pays the leaver as 'winner' of their own forfeit.
B1_RESETTLES = B1_RESETTLES.replace(
    "      s.winner = others.length === 1 ? others[0].id : null;",
    "      s.winner = playerId;")

# B2: a forfeit won by the computer pays nobody.
B2_PAYS_NOBODY = REFERENCE.replace(
    "      s.finalPayouts = settle(ctx, s.winner);",
    "      s.finalPayouts = ctx.players.find(p => p.id === s.winner && p.kind === 'computer') ? {} : settle(ctx, s.winner);")

# B3: no seat/active guard at all — even a spectator's 'leave' mutates state.
B3_NO_GUARD = REFERENCE.replace(
    "    if (!seat || seat.active === false) return {state, turn: [ctx.players[state.turnSeat].id]};",
    "    if (!seat) ctx = {...ctx, players: [...ctx.players, {id: playerId, kind: 'human', active: true}]};")

# B4: a continuing leave leaves the departing player in the turn.
B4_TURN_KEEPS_LEAVER = REFERENCE.replace(
    "    if (ctx.players[s.turnSeat].id === playerId) s.turnSeat = nextSeat(s, ctx, s.turnSeat);\n"
    "    return {state: s, turn: [ctx.players[s.turnSeat].id]};",
    "    return {state: s, turn: [playerId]};")

# B5: a leave never ends the match, even when one human remains.
B5_NEVER_ENDS = REFERENCE.replace("if (remaining.length < 2) {", "if (remaining.length < 0) {")


def probe(code, counts=(1, 2, 3), allows_leave=True):
    return probe_leaving(code, CONTRACT, allowed_player_counts=counts,
                         allows_leave_mid_match=allows_leave)


def test_reference_server_passes_all_probes():
    assert probe(REFERENCE) == []


def test_game_without_player_left_is_skipped():
    code = "const game = { newMatch(ctx) { return {state: {}, turn: [ctx.players[0].id]}; } };"
    assert probe(code) == []


def test_resettling_after_the_end_is_caught():
    failures = probe(B1_RESETTLES)
    assert any('after the match ended' in failure for failure in failures), failures


def test_forfeit_to_computer_paying_nobody_is_caught():
    failures = probe(B2_PAYS_NOBODY)
    assert any('human-vs-computer forfeit' in failure for failure in failures), failures


def test_unguarded_spectator_leave_is_caught():
    failures = probe(B3_NO_GUARD)
    assert any('non-seat leave' in failure for failure in failures), failures


def test_turn_still_containing_leaver_is_caught():
    failures = probe(B4_TURN_KEEPS_LEAVER)
    assert any('continuing leave' in failure for failure in failures), failures


def test_leave_that_never_ends_the_match_is_caught():
    failures = probe(B5_NEVER_ENDS)
    assert any('must end' in failure for failure in failures), failures


def test_check_is_registered_and_wraps_probes():
    assert 'settlement_probes' in [name for name, _ in CHECKS]
    rules = SimpleNamespace(allowed_player_counts=(1, 2, 3), allows_leave_mid_match=True)
    assert settlement_probes('', REFERENCE, {'tests': CONTRACT}, rules)['passed'] is True
    assert settlement_probes('', B2_PAYS_NOBODY, {'tests': CONTRACT}, rules)['passed'] is False


def test_contract_states_the_recipe_and_performance_rules():
    for phrase in ('playerLeft recipe (implement in exactly this order)',
                   'return the recorded state and state.finalPayouts unchanged',
                   'the returned turn never contains the leaver',
                   'never call ctx.estimateWinChance from computerMove',
                   'must not clone the state'):
        assert phrase in PLATFORM_CONTRACT, phrase
    assert 'do not fail code for a leaving or settlement scenario the probes already verify' in REVIEW_DISCIPLINE
