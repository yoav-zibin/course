"""Named verification checks: extend CHECKS without changing the build worker."""
from game_platform import game_text
from game_platform.builder_validation import verify_examples
from game_platform.game_testing import test_server_code


# One contract, given verbatim to every generation, repair, diagnosis and
# review prompt, so agents do not steer each other with conflicting rules
# for seats, settlement or execution limits.
PLATFORM_CONTRACT = '''Platform contract (applies to generation and review):
allowed_player_counts counts total seats, not humans. One human versus one computer requires two seats; [1] is a genuine solo game, never two opponents mapped to one ID. Match roster size is enforced by the platform.
Illegal moves throw InvalidMove; an example with expected_error:"InvalidMove" must reject and leave state, turn and views unchanged.
winner/result in game state records victory. payouts is NOT a score or a win probability: it maps active human roster IDs to nonnegative integer tokens. On ending, its sum must equal ctx.pot. At pot 0 use {} or zero-valued human entries, never award 1 for winning and never pay computers. Production disallows paid matches with computers; defensive settlement must still conserve any supplied pot. Do not call a defensive token-settlement branch an added betting UI or a game-rule violation merely because gameplay is described as free. An impossible production roster/pot combination must be identified as such.
ctx.players uses stable platform IDs; map game labels to those IDs. A player leaving remains active during playerLeft; it is marked inactive afterwards, so a payout to the departing player from playerLeft is legal.
Leaving and settlement: playerLeft from an ID that holds no seat, or that is already inactive, changes nothing and pays nothing. If the match has already ended, playerLeft returns the recorded final state and the same final payouts: settlement is computed once, when the match ends, and is never recomputed on later leaves. If a leave ends the match under the approved rules (including a forfeit), record the result in state exactly as the rules say; a forfeit winner may be a computer seat, and recording a winner never makes that seat payable. When a leave leaves fewer than two active humans the match must end (return a null turn). Terminal payouts go only to players who are human and active at that moment and sum to ctx.pot; at pot 0 pay {}.
Computer and random moves: build candidates only from moves applyMove would accept right now. Check every legality precondition before scoring, including per-seat resource counts (a placement move requires that seat's remaining count > 0) and any path-preservation constraint; never score or return an illegal candidate. computerMove branches on the requested difficulty and runs the approved algorithm and node/depth budget for that difficulty; never substitute a weaker heuristic for a harder difficulty. randomMove picks uniformly with ctx.random from the directly computed legal moves; it runs no search, evaluation or minimax and must finish in a few milliseconds.
Game calls have a 100 ms execution limit. Bound computer search by deterministic node/depth limits, use efficient pathfinding (one shared path search, not a fresh full search per candidate), and use ctx.random for randomness; never use wall-clock search deadlines. Do not weaken an approved strategy requirement silently: report if it cannot be satisfied within the limit.
'''

# Reviewers judge against the same contract the code was generated with.
# Without this, a review can demand mutually impossible behaviour (e.g.
# pot conservation with no legal payee AND never paying the departing
# player, who is still active during playerLeft) and no code can pass.
REVIEW_DISCIPLINE = '''Judge only against the approved rules and the platform contract below; do not invent stricter requirements. Combinations the platform forbids in production (for example a positive pot in a match with no human players, or paid matches against computers) are impossible inputs, not code defects: do not fail code for them. During playerLeft the departing player is still active, so paying them is not paying an inactive player.'''

DRAFTING_CONTRACT = '''Drafting contract (applies to rules and examples):
- One ruling per situation: state each legality, ending and settlement rule exactly once. Before returning, re-read the artifact; if two statements could give different outcomes for the same situation, rewrite them into one rule.
- Exceptions carry their condition in the same sentence ('only when ...', 'unless ...'). Never call the same action both legal and illegal in different places, and never let a summary sentence soften or broaden the operative rule it summarizes.
- Define moves operationally: the exact cells or fields involved, the check applied, and the result. For any rule with a blocked or edge case, give one concrete worked example with coordinates.
- Every example outcome must follow from exactly one stated rule; never invent an outcome that no stated rule produces.
'''

ILLUSTRATION_ACCURACY = '''Illustration accuracy (applies to every drawing):
- Transcribe, do not invent: draw exactly the pieces, walls, counters and labels in the supplied state or view — the same counts, the same positions, the same values. Add no extra pieces, walls, numbers or decorations that look like game elements, and omit nothing that is in the data.
- Place by coordinates: when the state gives rows/columns or any grid, compute each element's position from its coordinates on a uniform grid (x from the column, y from the row) instead of estimating freehand. Keep the row/column order and orientation the data states.
- Recount before returning: count the drawn elements and compare with the state (pieces per side, walls placed, walls remaining, counters and scores) and fix any mismatch.
- Match spans and sizes to the data: an element that covers N cells or units in the state (for example a wall covering exactly 2 cells) is drawn covering exactly N units — never longer or shorter — and every element uses the same cell size.
- A before/after pair differs only by the described move; every other element stays in exactly the same place.
- Technical: the root <svg> element must declare xmlns="http://www.w3.org/2000/svg" and a viewBox matching the drawing, so the file renders as a standalone image.
'''


def examples(code, server, spec, rules):
    results = verify_examples(server, spec['tests'])
    return {'passed': all(item['passed'] for item in results), 'details': results}


def localization(code, server, spec, rules):
    errors = game_text.lint(code)
    if 'applyLocale(' not in code:
        errors.append('Missing applyLocale(message) integration')
    return {'passed': not errors, 'details': errors}


def random_walks(code, server, spec, rules):
    report = test_server_code(server, rules=rules, contract=spec['tests'], budget_seconds=3, max_walks=1000)
    return {'passed': report.passed, 'details': str(report.failures)}


CHECKS = (('approved_examples', examples), ('localization', localization), ('random_walks', random_walks))
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
