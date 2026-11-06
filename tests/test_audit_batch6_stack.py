"""Stack Duel repairs through production QuickJS and its reviewed schemas."""
from copy import deepcopy
import datetime as dt
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from game_platform.game_logic import GameLogic, GameLogicError, InvalidMoveError
from game_platform.game_schemas import compile_game_schemas

ROOT = Path(__file__).parents[1] / 'games' / 'audit-batch6'
SOURCE = (ROOT / 'stack-duel.server.js').read_text()
SCHEMAS = json.loads((ROOT / 'stack-duel.schema.json').read_text())
NOW = dt.datetime(2026, 11, 6, 5, tzinfo=dt.timezone.utc)


def start(n=2, seed=29):
    logic = GameLogic(SOURCE, game_schemas=SCHEMAS)
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'max_loss': 10}
                       for i in range(n)], 'pot': n * 10, 'move_count': 0}
    return logic, ctx, logic.call('newMatch', ctx=ctx, seed=seed, now=NOW)


def advance(logic, ctx, result, move, seed=29):
    result = logic.call('applyMove', result['state'], result['turn'][0], move,
                        ctx=ctx, seed=seed + ctx['move_count'], now=NOW)
    ctx['move_count'] += 1
    return result


def test_six_move_center_block_does_not_end_a_playable_game():
    logic, ctx, result = start()
    for rot, col in [(0, 5), (3, 3), (0, 4), (1, 4), (1, 0), (2, 2)]:
        result = advance(logic, ctx, result, {'rot': rot, 'col': col})
    s = result['state']
    assert sum(v != -1 for row in s['board'] for v in row) == 24
    assert s['current'] == 'S' and s['scores'] == [0, 0]
    assert s['over'] is False and s['winners'] is None
    assert result['turn'] == ['p0'] and 'payouts' not in result
    for rot, col in [(0, 0), (0, 5), (1, 0), (1, 5), (1, 6)]:
        continued = logic.call('applyMove', s, 'p0', {'rot': rot, 'col': col},
                               ctx=ctx, seed=35, now=NOW)
        assert continued['state']['last_move']['piece'] == 'S'


def test_no_placement_for_next_piece_still_ends_and_pays_tie():
    logic, ctx, result = start()
    s = deepcopy(result['state'])
    s['board'] = [[0] * 7 + [-1] for _ in range(10)]
    for c in (1, 3, 5):
        s['board'][0][c] = -1
    for r in range(1, 4):
        s['board'][r][1] = -1
    s['current'], s['next'] = 'I', 'O'
    # The vertical I lands at row0 and blocks the last reachable entry.
    result = logic.call('applyMove', s, 'p0', {'rot': 1, 'col': 1},
                        ctx=ctx, seed=29, now=NOW)
    assert result['state']['over'] is True
    assert result['state']['current'] == 'O'
    assert result['state']['winners'] == [0, 1]
    assert result['turn'] is None
    assert result['payouts'] == {'p0': 10, 'p1': 10}
    for viewer in ('p0', 'p1', None):
        assert logic.call('viewFor', result['state'], viewer, ctx=ctx)['winners'] == [0, 1]


def test_cleared_rows_still_credit_the_placing_player():
    logic, ctx, result = start()
    s = deepcopy(result['state'])
    s['current'] = 'I'
    s['board'][9] = [-1] * 4 + [1] * 4
    result = logic.call('applyMove', s, 'p0', {'rot': 0, 'col': 0},
                        ctx=ctx, seed=29, now=NOW)
    assert result['state']['board'] == [[-1] * 8 for _ in range(10)]
    assert result['state']['scores'] == [1, 0]
    assert result['state']['lines'] == 1
    assert result['state']['last_move'] == {'seat': 0, 'piece': 'I', 'cleared': 1}


@pytest.mark.parametrize('n', [2, 3, 4])
@pytest.mark.parametrize('method', ['randomMove', 'computerMove'])
def test_complete_matches_conserve_cells_scores_and_pot(n, method):
    logic, ctx, result = start(n)
    for step in range(1000):
        for viewer in [p['id'] for p in ctx['players']] + [None]:
            logic.call('viewFor', result['state'], viewer, ctx=ctx, now=NOW)
        if result['turn'] is None:
            break
        old = result['state']
        move = logic.call(method, old, result['turn'][0], ctx=ctx,
                          seed=29 + step, now=NOW)
        result = advance(logic, ctx, result, move)
        s = result['state']
        old_count = sum(v != -1 for row in old['board'] for v in row)
        new_count = sum(v != -1 for row in s['board'] for v in row)
        assert new_count == old_count + 4 - 8 * (s['lines'] - old['lines'])
        assert sum(s['scores']) == s['lines']
    assert result['turn'] is None
    assert sum(result['payouts'].values()) == ctx['pot']
    assert result['state']['over'] is True


def test_voluntary_leave_keeps_nullable_winners_in_a_valid_terminal_view():
    logic, ctx, result = start()
    result = logic.call('playerLeft', result['state'], 'p0', ctx=ctx,
                        seed=29, now=NOW, time_limit_seconds=2.0)
    assert result['turn'] is None
    assert result['state']['winners'] is None
    assert sum(result['payouts'].values()) == ctx['pot']
    for viewer in ('p0', 'p1', None):
        view = logic.call('viewFor', result['state'], viewer, ctx=ctx)
        assert view['winners'] is None


@pytest.mark.parametrize('move', [None, {}, [], {'rot': 4, 'col': 0},
                                 {'rot': 0, 'col': 8}, {'rot': .5, 'col': 0},
                                 {'rot': 0, 'col': True}, {'rot': 0, 'col': '0'}])
def test_malformed_moves_are_rejected_without_mutation(move):
    logic, ctx, result = start()
    original = deepcopy(result['state'])
    with pytest.raises(InvalidMoveError):
        logic.call('applyMove', result['state'], 'p0', move, ctx=ctx, now=NOW)
    assert result['state'] == original


def test_reviewed_schemas_reject_corrupt_shapes():
    compile_game_schemas(SCHEMAS)
    logic, ctx, result = start()
    bad = deepcopy(result['state'])
    bad['board'][0].pop()
    with pytest.raises(GameLogicError):
        logic.call('viewFor', bad, None, ctx=ctx)
    view = logic.call('viewFor', result['state'], None, ctx=ctx)
    assert not list(Draft202012Validator(SCHEMAS['view']).iter_errors(view))
    view['winners'] = [7]
    assert list(Draft202012Validator(SCHEMAS['view']).iter_errors(view))
