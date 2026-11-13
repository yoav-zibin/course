"""Blokus search must exhaust legal placements before an irreversible pass."""
import json
import re
from pathlib import Path

import pytest

from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.tests.helpers import run_unrestricted_server_code as check_server_code
from game_platform.models import GameRules

SOURCE = Path(__file__).parent.parent / 'games' / 'audit-batch2' / 'blokus.server.js'
CODE = SOURCE.read_text()
SHAPES = json.loads(re.search(r"var SHAPES=(.*?);", CODE).group(1))
REPRO_MOVES = [(0, 11, 1, 0, 0), (1, 12, 7, 0, 17), (2, 10, 1, 15, 19), (1, 14, 1, 2, 17), (2, 8, 2, 13, 17), (3, 20, 2, 17, 0), (2, 20, 2, 13, 14), (1, 20, 3, 4, 16), (2, 16, 1, 12, 12), (1, 9, 2, 7, 16), (0, 15, 1, 1, 4), (1, 17, 3, 9, 17), (2, 18, 0, 10, 9), (3, 19, 3, 15, 3), (0, 19, 5, 4, 5), (1, 18, 0, 9, 13), (2, 12, 0, 8, 8), (3, 10, 0, 14, 6), (2, 17, 1, 15, 9), (1, 15, 2, 7, 11), (0, 20, 0, 4, 9), (3, 18, 0, 13, 1), (0, 17, 1, 1, 8), (1, 11, 0, 3, 14), (0, 13, 1, 4, 0), (3, 17, 0, 11, 3), (0, 18, 0, 6, 3), (1, 13, 1, 2, 10), (0, 10, 1, 8, 6), (3, 11, 6, 10, 0), (0, 9, 6, 8, 1), (1, 8, 0, 1, 14), (2, 14, 1, 16, 11), (3, 9, 3, 8, 3), (2, 13, 2, 16, 7), (3, 1, 1, 15, 0), (2, 9, 6, 16, 15), (3, 14, 3, 6, 0), (0, 7, 0, 0, 6), (1, 4, 0, 0, 10), (0, 5, 0, 4, 12), (1, 0, 0, 8, 15), (2, 7, 2, 18, 4), (1, 1, 0, 12, 15), (0, 8, 2, 2, 0), (1, 5, 0, 13, 13), (2, 2, 0, 9, 11), (3, 0, 0, 11, 5), (0, 4, 0, 13, 7), (3, 3, 0, 5, 3), (2, 1, 0, 17, 3), (1, 3, 2, 15, 11), (0, 1, 0, 7, 8), (1, 2, 1, 17, 10), (2, 0, 0, 15, 8)]


def started(n):
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'max_loss': 10} for i in range(n)],
           'pot': 10 * n, 'move_count': 0}
    logic = GameLogic(CODE)
    return logic, ctx, logic.call('newMatch', ctx=ctx, seed=1)


def orientations(shape):
    seen = set()
    for flip in [1, -1]:
        cells = [(r, c * flip) for r, c in shape]
        for _ in range(4):
            mr, mc = min(r for r, c in cells), min(c for r, c in cells)
            normalized = tuple(sorted((r - mr, c - mc) for r, c in cells))
            if normalized not in seen:
                seen.add(normalized)
                yield normalized
            cells = [(c, -r) for r, c in cells]


def has_legal_placement(state, seat):
    """Independent exhaustive board-coordinate oracle, unrelated to AI sampling."""
    board = state['board']
    for color, owner in enumerate(state['colorOwners']):
        if owner != seat:
            continue
        first = not any(color in row for row in board)
        corner = [(0, 0), (0, 19), (19, 19), (19, 0)][color]
        for piece, shape in enumerate(SHAPES):
            if not state['available'][color][piece]:
                continue
            for orientation in orientations(shape):
                for row in range(20):
                    for col in range(20):
                        cells = [(row + r, col + c) for r, c in orientation]
                        if any(r >= 20 or c >= 20 or board[r][c] != -1 for r, c in cells):
                            continue
                        if first and corner not in cells:
                            continue
                        if any(0 <= r + dr < 20 and 0 <= c + dc < 20 and board[r + dr][c + dc] == color
                               for r, c in cells for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]):
                            continue
                        if first or any(0 <= r + dr < 20 and 0 <= c + dc < 20 and board[r + dr][c + dc] == color
                                        for r, c in cells for dr, dc in [(-1, -1), (-1, 1), (1, -1), (1, 1)]):
                            return True
    return False


@pytest.mark.parametrize('method', ['computerMove', 'randomMove'])
def test_sampling_miss_repro_still_returns_accepted_placement(method):
    logic, ctx, current = started(2)
    for values in REPRO_MOVES:
        move = dict(zip(['color', 'piece', 'ori', 'row', 'col'], values))
        current = logic.call('applyMove', current['state'], current['turn'][0], move, ctx=ctx, seed=1)
        ctx['move_count'] += 1
    actor = current['turn'][0]
    # This concrete witness was accepted while the old AI returned permanent pass.
    logic.call('applyMove', current['state'], actor,
               {'color': 3, 'piece': 2, 'ori': 0, 'row': 6, 'col': 5}, ctx=ctx, seed=0)
    for seed in [0, 1, 9]:
        move = logic.call(method, current['state'], actor, ctx=ctx, seed=seed)
        assert not move.get('pass'), (method, seed)
        logic.call('applyMove', current['state'], actor, move, ctx=ctx, seed=seed)


@pytest.mark.parametrize('n,method', [(2, 'randomMove'), (2, 'computerMove'), (4, 'randomMove'), (4, 'computerMove')])
def test_full_matches_only_pass_after_no_legal_placement_remains(n, method):
    logic, ctx, current = started(n)
    for step in range(200):
        if current['turn'] is None:
            break
        actor = current['turn'][0]
        move = logic.call(method, current['state'], actor, ctx=ctx, seed=20261106 + step)
        if move.get('pass'):
            assert not has_legal_placement(current['state'], int(actor[1:]))
        current = logic.call('applyMove', current['state'], actor, move, ctx=ctx, seed=step)
        ctx['move_count'] += 1
    assert current['turn'] is None
    assert sum(current['payouts'].values()) == ctx['pot']
    for seat in range(n):
        assert not has_legal_placement(current['state'], seat)


def test_default_publication_gate_remains_within_budget():
    report = check_server_code(CODE, rules=GameRules(allowed_player_counts=(2, 4), allows_leave_mid_match=False, allows_join_mid_match=False),
                               budget_seconds=5, max_moves_per_walk=1000, run_seed=20261106)
    assert report.passed, report
    assert not report.too_slow, report
