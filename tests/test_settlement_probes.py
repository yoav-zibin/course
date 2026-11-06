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
    if (state.finalPayouts) {
      const active = eligibleIds(ctx);
      const out = {};
      let folded = 0;
      for (const id of Object.keys(state.finalPayouts)) {
        if (active.includes(id)) out[id] = state.finalPayouts[id];
        else folded += state.finalPayouts[id];
      }
      if (folded > 0 && active.length) out[active[0]] = (out[active[0]] || 0) + folded;
      return {state, turn: null, payouts: out};
    }
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

# B1: a leave after the end mutates the recorded state.
B1_MUTATES_AFTER_END = REFERENCE.replace(
    "      if (folded > 0 && active.length) out[active[0]] = (out[active[0]] || 0) + folded;\n"
    "      return {state, turn: null, payouts: out};",
    "      if (folded > 0 && active.length) out[active[0]] = (out[active[0]] || 0) + folded;\n"
    "      return {state: {...state, moves: state.moves + 1}, turn: null, payouts: out};")

# Z: settle() records a zero entry for every eligible human, not only the
# payee — legal when recorded (everyone is active then), but the recorded
# object names the departed player afterwards, so a verbatim post-end
# return would name an inactive player. Must still pass, via re-reporting.
Z_ZERO_ENTRIES = REFERENCE.replace(
    "  if (winnerId && elig.includes(winnerId)) return {[winnerId]: pot};",
    "  if (winnerId && elig.includes(winnerId)) { const o = {}; for (const id of elig) o[id] = id === winnerId ? pot : 0; return o; }")

# S: a forfeit is recorded as a draw, splitting the pot — including the
# departed player's share. The probes cannot judge game-rules fidelity
# (that is the settlement review's job); the platform invariants (state
# frozen, conservation, still-active amounts never decrease) must hold.
S_SPLIT_RECORDING = REFERENCE.replace(
    "      s.winner = others.length === 1 ? others[0].id : null;",
    "      s.winner = null;")

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


def _leave_case(move, name='Forfeit example'):
    players = [{'id': 'h1', 'kind': 'human', 'display_name': 'h1', 'picture_url': '', 'max_loss': 25},
               {'id': 'h2', 'kind': 'human', 'display_name': 'h2', 'picture_url': '', 'max_loss': 25}]
    before = {'moves': 0, 'turnSeat': 0, 'left': [], 'winner': None, 'finalPayouts': None}
    after = {'moves': 0, 'turnSeat': 0, 'left': ['h1'], 'winner': 'h2', 'finalPayouts': {'h2': 10}}
    return {'name': name, 'kind': 'terminal', 'description': 'h1 leaves and forfeits',
            'ctx': {'players': players, 'pot': 10, 'move_count': 0, 'seed': 7},
            'player_id': 'h1', 'other_player_id': 'h2', 'state': before, 'move': move,
            'expected_state': after, 'expected_turn': None, 'expected_payouts': {'h2': 10},
            'view_of_mover': before, 'view_of_other': before,
            'expected_view_of_mover': after, 'expected_view_of_other': after}


def test_leave_examples_run_through_player_left():
    from game_platform.builder_validation import verify_examples
    contract = {**CONTRACT, 'cases': [_leave_case({'type': 'leave'}),
                                       _leave_case(None, 'Forfeit example (no move)')]}
    results = verify_examples(REFERENCE, contract)
    assert [r['passed'] for r in results] == [True, True]
    # A server whose playerLeft never ends the match fails the same example.
    broken = verify_examples(B5_NEVER_ENDS, contract)
    assert [r['passed'] for r in broken] == [False, False]


def test_contract_defines_the_leave_example_encoding():
    assert 'executed through playerLeft, not applyMove' in PLATFORM_CONTRACT


def test_game_without_player_left_is_skipped():
    code = "const game = { newMatch(ctx) { return {state: {}, turn: [ctx.players[0].id]}; } };"
    assert probe(code) == []


def test_state_mutation_after_the_end_is_caught():
    failures = probe(B1_MUTATES_AFTER_END)
    assert any('after the match ended' in failure for failure in failures), failures


def test_zero_entry_recordings_pass_via_rereporting():
    assert probe(Z_ZERO_ENTRIES) == []


def test_split_recording_satisfies_platform_invariants():
    assert probe(S_SPLIT_RECORDING) == []


def test_forfeit_to_computer_paying_nobody_is_caught():
    failures = probe(B2_PAYS_NOBODY)
    assert any('human-vs-computer forfeit' in failure for failure in failures), failures


def test_spectator_leave_is_rejected_before_game_logic():
    failures = probe(B3_NO_GUARD)
    assert not any('non-seat leave' in failure for failure in failures), failures


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
                   'the recorded payouts re-reported for this call',
                   'even zero entries',
                   'the returned turn never contains the leaver',
                   'never call ctx.estimateWinChance from computerMove',
                   'must not clone the state'):
        assert phrase in PLATFORM_CONTRACT, phrase
    assert 'do not fail code for a leaving or settlement scenario the probes already verify' in REVIEW_DISCIPLINE


# --- Move-agreement probes -------------------------------------------------
# The same reference game, judged on one approved opening position: its
# generators return {type:'pass'}, which its applyMove accepts, so a
# correct game agrees with itself. Each broken variant reproduces one
# failure class from real guided builds.

from game_platform.builder_validation import probe_move_agreement

AGREEMENT_CONTRACT = {**CONTRACT, 'cases': [{
    'name': 'opening', 'kind': 'initial',
    'ctx': {'players': [{'id': 'human-1', 'kind': 'human', 'display_name': 'A', 'picture_url': '', 'max_loss': 0},
                        {'id': 'human-2', 'kind': 'human', 'display_name': 'B', 'picture_url': '', 'max_loss': 0}],
            'pot': 0, 'move_count': 0, 'seed': 7},
    'state': {'moves': 0, 'turnSeat': 0, 'left': [], 'winner': None, 'finalPayouts': None},
    'player_id': 'human-1',
}]}

DIVERGENT_RANDOM = REFERENCE.replace(
    "randomMove(state, playerId, ctx) { return {type: 'pass'}; }",
    "randomMove(state, playerId, ctx) { return {type: 'cheat'}; }",
).replace(
    "const s = {...state, moves: state.moves + 1, left: [...state.left]};",
    "if (move.type === 'cheat') throw new Error('InvalidMove: cheat');\n"
    "    const s = {...state, moves: state.moves + 1, left: [...state.left]};",
)

THROWING_COMPUTER = REFERENCE.replace(
    "computerMove(state, playerId, ctx) { return {type: 'pass'}; }",
    "computerMove(state, playerId, ctx) { throw new Error('no moves'); }",
)


def test_move_agreement_reference_game_agrees():
    assert probe_move_agreement(REFERENCE, AGREEMENT_CONTRACT) == []


def test_move_agreement_catches_divergent_random_move():
    failures = probe_move_agreement(DIVERGENT_RANDOM, AGREEMENT_CONTRACT)
    assert any('randomMove returned a move applyMove rejects' in failure for failure in failures)


def test_move_agreement_catches_throwing_computer_move():
    failures = probe_move_agreement(THROWING_COMPUTER, AGREEMENT_CONTRACT)
    assert any('computerMove raised instead of returning a legal move' in failure for failure in failures)


def test_move_agreement_is_a_registered_check():
    assert 'move_agreement' in dict(CHECKS)


# A setup move that is legal only before the first move, but the generator
# keeps offering it once the game is under way — invisible from the
# approved (opening) states, exactly what the played-out position is for.
SETUP_MOVE_DIVERGENCE = REFERENCE.replace(
    "randomMove(state, playerId, ctx) { return {type: 'pass'}; }",
    "randomMove(state, playerId, ctx) { return state.moves >= 2 ? {type: 'setup'} : {type: 'pass'}; }",
).replace(
    "const s = {...state, moves: state.moves + 1, left: [...state.left]};",
    "if (move.type === 'setup' && state.moves > 0) throw new Error('InvalidMove: locked after first move');\n"
    "    const s = {...state, moves: state.moves + 1, left: [...state.left]};",
)


def test_move_agreement_catches_setup_move_offered_mid_game():
    failures = probe_move_agreement(SETUP_MOVE_DIVERGENCE, AGREEMENT_CONTRACT)
    assert any('applyMove rejects' in failure for failure in failures), failures
