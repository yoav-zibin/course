"""Named verification checks: extend CHECKS without changing the build worker."""
from game_platform import game_text
from game_platform.builder_validation import probe_leaving, verify_examples
from game_platform.game_testing import test_server_code


# One contract, given verbatim to every generation, repair, diagnosis and
# review prompt, so agents do not steer each other with conflicting rules
# for seats, settlement or execution limits.
PLATFORM_CONTRACT = '''Platform contract (applies to generation and review):
allowed_player_counts counts total seats, not humans. One human versus one computer requires two seats; [1] is a genuine solo game, never two opponents mapped to one ID. Match roster size is enforced by the platform.
Illegal moves throw InvalidMove; an example with expected_error:"InvalidMove" must reject and leave state, turn and views unchanged.
A test example where a player leaves uses move {"type":"leave"} (or no move) and is executed through playerLeft, not applyMove, with the same state, turn, payout and view comparisons as a move example; write its expected state, turn and payouts as the playerLeft result the rules require.
winner/result in game state records victory. payouts is NOT a score or a win probability: it maps active human roster IDs to nonnegative integer tokens. On ending, its sum must equal ctx.pot. At pot 0 use {} or zero-valued human entries, never award 1 for winning and never pay computers. Production disallows paid matches with computers; defensive settlement must still conserve any supplied pot. Do not call a defensive token-settlement branch an added betting UI or a game-rule violation merely because gameplay is described as free. An impossible production roster/pot combination must be identified as such.
ctx.players uses stable platform IDs; map game labels to those IDs. A player leaving remains active during playerLeft; it is marked inactive afterwards, so a payout to the departing player from playerLeft is legal.
Leaving and settlement: playerLeft from an ID that holds no seat, or that is already inactive, changes nothing and pays nothing. If the match has already ended, playerLeft returns the recorded final state and the same final payouts: settlement is computed once, when the match ends, and is never recomputed on later leaves. If a leave ends the match under the approved rules (including a forfeit), record the result in state exactly as the rules say; a forfeit winner may be a computer seat, and recording a winner never makes that seat payable. When a leave leaves fewer than two active humans the match must end (return a null turn). Terminal payouts go only to players who are human and active at that moment and sum to ctx.pot; at pot 0 pay {}.
Computer and random moves: build candidates only from moves applyMove would accept right now. Check every legality precondition before scoring, including per-seat resource counts (a placement move requires that seat's remaining count > 0) and any path-preservation constraint; never score or return an illegal candidate. computerMove branches on the requested difficulty and runs the approved algorithm and node/depth budget for that difficulty; never substitute a weaker heuristic for a harder difficulty. randomMove picks uniformly with ctx.random from the directly computed legal moves; it runs no search, evaluation or minimax and must finish in a few milliseconds.
Game calls have a 100 ms execution limit. Bound computer search by deterministic node/depth limits, use efficient pathfinding (one shared path search, not a fresh full search per candidate), and use ctx.random for randomness; never use wall-clock search deadlines. Do not weaken an approved strategy requirement silently: report if it cannot be satisfied within the limit.
Settlement algorithm (implement exactly, with ONE settlement function used by applyMove, playerLeft and every later call): eligible(ctx) is the players who are kind human and active at call time (the departing player is still active during playerLeft). settle(winnerId) returns {} when ctx.pot is 0; otherwise, if winnerId is eligible it returns {winnerId: ctx.pot}; otherwise it splits ctx.pot equally among eligible players (integer shares, remainder one each to the first eligible players in ctx.players order); if nobody is eligible it returns {} (reachable only when the pot is 0 in any real match). When a terminal applyMove or a match-ending playerLeft first ends the match, compute payouts with this one function, STORE a copy in the state (state.finalPayouts), and return it. Prefer entries only for players receiving a positive amount; zero entries are allowed but unnecessary. A forfeit win by a computer seat therefore pays the pot to the eligible humans (in a one-human match, the departing human) — never to the computer, and never {} while a pot and an eligible human exist.
randomMove recipe: enumerate the complete legal move list once — step moves computed directly, plus every placement whose preconditions pass an allocation-light legality test (precompute the blocked-edge set once, test paths with an iterative search over a flat visited array, never deep-copy the state per candidate) — then return moves[Math.floor(ctx.random() * moves.length)]. No weighting between move types, no probability splits, no retry sampling.
Difficulty channel: the platform ctx has no difficulty field. Read difficulty from state.difficulty when the game state carries it (the client sets it through the game's own setup move), branch explicitly on that value with the approved algorithm and budget per difficulty, and when it is absent use the difficulty the approved rules name as the default.
playerLeft recipe (implement in exactly this order): 1) If the match has already ended (a result is recorded, e.g. state.finalPayouts is set), return the recorded state, with the recorded payouts re-reported for this call: omit entries for players who are not active in this ctx (the platform rejects payouts naming inactive players, even zero entries), and add any omitted positive amount to the first still-active human in ctx.players order so the total still equals the pot. The settlement stored in state never changes. 2) Otherwise, if playerId holds no seat in ctx.players, or that seat's active flag is false, return {state, turn} unchanged with no payouts — before any ending or settlement logic. 3) Otherwise, if this leave ends the match (fewer than two active humans would remain, or the approved rules end the match on a leave), record the result in state exactly as the rules say, set state.finalPayouts with the one settlement function, and return {state, turn: null, payouts: state.finalPayouts}. 4) Otherwise the match continues: return the state with the leaver excluded from every future turn — the returned turn never contains the leaver — and payouts only as the approved rules provide for a continuing leave. These behaviours are verified by deterministic probes (non-seat and duplicate leaves, forfeits, post-end leaves), not by opinion.
Performance rules that decide pass/fail: never call ctx.estimateWinChance from computerMove, randomMove or applyMove (one estimate plays about a hundred simulated games and takes about a second — always past the 100 ms limit). A candidate legality test must not clone the state, re-run applyMove, or rebuild the board per candidate: build the blocked-edge/wall set once per call, test each candidate against that set, and run the path search on a flat array with an integer queue. Enumerating every placement with one path search each is only a few milliseconds when done this way; the timeouts seen in practice come from per-candidate copying, not from the search itself.
'''

# Reviewers judge against the same contract the code was generated with.
# Without this, a review can demand mutually impossible behaviour (e.g.
# pot conservation with no legal payee AND never paying the departing
# player, who is still active during playerLeft) and no code can pass.
REVIEW_DISCIPLINE = '''Judge only against the approved rules and the platform contract below; do not invent stricter requirements. Combinations the platform forbids in production (for example a positive pot in a match with no human players, or paid matches against computers) are impossible inputs, not code defects: do not fail code for them. During playerLeft the departing player is still active, so paying them is not paying an inactive player. The platform ctx has no difficulty field: reading difficulty from state.difficulty is the approved channel — do not fail code for it, and do not demand ctx fields that do not exist. Allocation-light legality checks inside randomMove are the approved way to stay within the time limit; uniformity is judged on the enumerated legal list, not on re-validating through applyMove. The deterministic checks (approved examples, settlement probes, random walks) run before reviews and have already verified their scenarios when you see this code: judge only what they cannot — fidelity to the game's own approved rules — and do not fail code for a leaving or settlement scenario the probes already verify, even if the code implements it differently than you would.'''

DRAFTING_CONTRACT = '''Drafting contract (applies to rules and examples):
- One ruling per situation: state each legality, ending and settlement rule exactly once. Before returning, re-read the artifact; if two statements could give different outcomes for the same situation, rewrite them into one rule.
- Exceptions carry their condition in the same sentence ('only when ...', 'unless ...'). Never call the same action both legal and illegal in different places, and never let a summary sentence soften or broaden the operative rule it summarizes.
- Define moves operationally: the exact cells or fields involved, the check applied, and the result. For any rule with a blocked or edge case, give one concrete worked example with coordinates.
- Every example outcome must follow from exactly one stated rule; never invent an outcome that no stated rule produces.
- Shared effects get their own sentence: anything several move types do (passing the turn, incrementing the move count) is stated once, in a sentence naming every move type it applies to — never buried inside one move type's description, where the other move types silently lose it.
- Every move type answers the same four questions: who may send it, when it is legal, every state field it changes, and whether it passes the turn.
- Every state field has a complete story: before returning, go through the starting state field by field (move count, walls remaining, turn, winner, final payouts, difficulty) and make sure the rules say what can change each one.
'''

ILLUSTRATION_ACCURACY = '''Illustration accuracy (applies to every drawing):
- Transcribe, do not invent: draw exactly the pieces, walls, counters and labels in the supplied state or view — the same counts, the same positions, the same values. Add no extra pieces, walls, numbers or decorations that look like game elements, and omit nothing that is in the data.
- Place by coordinates: when the state gives rows/columns or any grid, compute each element's position from its coordinates on a uniform grid (x from the column, y from the row) instead of estimating freehand. Keep the row/column order and orientation the data states.
- Recount before returning: count the drawn elements and compare with the state (pieces per side, walls placed, walls remaining, counters and scores) and fix any mismatch.
- Match spans and sizes to the data: an element that covers N cells or units in the state (for example a wall covering exactly 2 cells) is drawn covering exactly N units — never longer or shorter — and every element uses the same cell size.
- A before/after pair differs only by the described move; every other element stays in exactly the same place.
- Technical: the root <svg> element must declare xmlns="http://www.w3.org/2000/svg" and a viewBox matching the drawing, so the file renders as a standalone image.
'''

COVER_FIDELITY = '''Cover fidelity (applies to the catalog cover only):
- The cover depicts the game's real board, not an invented one: use the board's exact shape and dimensions from the approved rules, drawn flat (top-down or straight-on) on a uniform grid so every row and column can be counted in the finished drawing. A perspective or angled view that merges, hides or adds rows or columns is not allowed.
- Pieces and walls form a plausible position from the game (for example its starting position): every piece sits inside exactly one cell, and every wall lies in a groove spanning exactly 2 cells — never scattered, floating or stretched.
- Drama comes from color, lighting, background and framing only, never from bending the board's geometry. Recount the rows and columns before returning and fix any mismatch with the approved rules.
'''


def examples(code, server, spec, rules):
    results = verify_examples(server, spec['tests'])
    return {'passed': all(item['passed'] for item in results), 'details': results}


def settlement_probes(code, server, spec, rules):
    try:
        failures = probe_leaving(server, spec['tests'],
                                 allowed_player_counts=rules.allowed_player_counts,
                                 allows_leave_mid_match=rules.allows_leave_mid_match)
    except Exception as exc:  # a probe crash is a failed check, never a crashed build
        failures = [f'settlement probes could not run: {exc}']
    return {'passed': not failures, 'details': failures}


def localization(code, server, spec, rules):
    errors = game_text.lint(code)
    if 'applyLocale(' not in code:
        errors.append('Missing applyLocale(message) integration')
    return {'passed': not errors, 'details': errors}


def random_walks(code, server, spec, rules):
    test_schemas = spec['tests']
    game_schemas = {
        'state': test_schemas['state_schema'],
        'move': test_schemas['move_schema'],
        'view': test_schemas['view_schema'],
    }
    report = test_server_code(
        server,
        game_schemas=game_schemas,
        rules=rules,
        contract=test_schemas,
        budget_seconds=3,
        max_walks=1000,
    )
    return {'passed': report.passed, 'details': str(report.failures)}


CHECKS = (('approved_examples', examples), ('settlement_probes', settlement_probes), ('localization', localization), ('random_walks', random_walks))
REVIEW_BRIEFS = (
    ('rules', 'Check setup, legal moves, turn order and terminal conditions against the approved rules.'),
    ('privacy', 'Check hidden information and spectator views; detect information leaks in viewFor.'),
    ('computers', 'Check computerMove legality, strategy and seeded deterministic randomness.'),
    ('settlement', 'Check joining, leaving, payouts and conservation of the pot.'),
)


def run_checks(code, server, spec, rules, progress=lambda name: None, *, skip=()):
    results = {}
    for name, check in CHECKS:
        if name in skip: continue
        progress(name)
        results[name] = check(code, server, spec, rules)
    return results
