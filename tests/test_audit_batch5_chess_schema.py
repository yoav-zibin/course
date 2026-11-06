"""Reviewed Chess schemas applied to real QuickJS state/move/view paths."""
from copy import deepcopy
import json

import pytest
from jsonschema import Draft202012Validator

from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.game_schemas import compile_game_schemas
from game_platform.tests.test_audit_batch5_chess import NOW, SOURCE, move, sparse

SCHEMAS = json.loads(SOURCE.with_name('chess.schema.json').read_text())


def started():
    logic = GameLogic(SOURCE.read_text(), game_schemas=SCHEMAS)
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'max_loss': 10}
                       for i in range(2)], 'pot': 20, 'move_count': 0}
    return logic, ctx, logic.call('newMatch', ctx=ctx, now=NOW, seed=123)


def views(logic, ctx, result):
    for viewer in ('p0', 'p1', None):
        logic.call('viewFor', result['state'], viewer, ctx=ctx, now=NOW)


@pytest.mark.parametrize('method', ['randomMove', 'computerMove'])
def test_strict_schema_complete_matches_and_every_view(method):
    logic, ctx, result = started()
    for step in range(250):
        views(logic, ctx, result)
        if result['turn'] is None:
            break
        pid = result['turn'][0]
        chosen = logic.call(method, result['state'], pid, ctx=ctx, now=NOW, seed=step+41)
        result = logic.call('applyMove', result['state'], pid, chosen, ctx=ctx, now=NOW)
        ctx['move_count'] += 1
    assert result['turn'] is None
    assert sum(result['payouts'].values()) == 20


def test_strict_schema_repetition_and_terminal_views():
    logic, ctx, result = started()
    for uci in ['e2e4']+['g8f6', 'g1f3', 'f6g8', 'f3g1']*2:
        result = logic.call('applyMove', result['state'], result['turn'][0], move(uci), ctx=ctx, now=NOW)
        ctx['move_count'] += 1
        views(logic, ctx, result)
    assert result['state']['reason'] == 'Threefold repetition'


@pytest.mark.parametrize('pieces,uci,expected', [
    ([('a1', 6), ('h8', -6), ('c2', 3), ('e4', 3), ('g2', 3), ('f5', -2)], 'e4f5', -1),
    ([('e1', 6), ('a8', -6), ('e5', 1), ('d5', -1)], 'e5d6', None),
    ([('a1', 6), ('h8', -6), ('c2', 3), ('g2', 3), ('d4', 3)], 'a1b1', None),
    ([('a1', 6), ('h8', -6), ('c2', 3), ('g2', 3), ('e4', 2)], 'a1b1', None),
    ([('a1', 6), ('h8', -6), ('a7', 1)], 'a7a8', None),
])
def test_strict_schema_special_legal_positions(pieces, uci, expected):
    logic, ctx, initial = started()
    state = sparse(initial['state'], pieces)
    chosen = move(uci)
    if uci == 'e5d6':
        state['ep'] = 19
    if uci == 'a7a8':
        chosen['promo'] = 'N'
        expected = -1
    result = logic.call('applyMove', state, 'p0', chosen, ctx=ctx, now=NOW)
    assert result['state']['winner'] == expected
    views(logic, ctx, result)


@pytest.mark.parametrize('white_extra,black_extra,expected', [
    ([('a2', 4)], [], -1),
    ([], [('c8', -3)], -1),
    ([], [('b8', -2)], -1),
    ([('a2', 1)], [('b8', -2)], 1),
    ([], [('b8', -2), ('g8', -2)], 1),
    ([('c1', 3)], [('b8', -3)], -1),
    ([('c1', 3)], [('c8', -3)], 1),
    ([], [('a8', -4)], 1),
])
def test_strict_schema_all_resignation_fixtures(white_extra, black_extra, expected):
    logic, ctx, initial = started()
    state = sparse(initial['state'], [('e1', 6), ('e8', -6)]+white_extra+black_extra)
    result = logic.call('applyMove', state, 'p0', {'resign': True}, ctx=ctx, now=NOW)
    assert result['state']['winner'] == expected
    views(logic, ctx, result)


@pytest.mark.parametrize('promo', ['Q', 'R', 'B', 'N'])
def test_strict_schema_all_promotions(promo):
    logic, ctx, initial = started()
    state = sparse(initial['state'], [('a1', 6), ('h8', -6), ('a7', 1)])
    chosen = move('a7a8') | {'promo': promo}
    result = logic.call('applyMove', state, 'p0', chosen, ctx=ctx, now=NOW)
    assert result['state']['bd'][0] == {'Q': 5, 'R': 4, 'B': 3, 'N': 2}[promo]
    views(logic, ctx, result)


@pytest.mark.parametrize('seat,uci', [(0, 'e1g1'), (0, 'e1c1'), (1, 'e8g8'), (1, 'e8c8')])
def test_strict_schema_castling_both_sides(seat, uci):
    logic, ctx, initial = started()
    state = sparse(initial['state'], [('e1', 6), ('a1', 4), ('h1', 4),
                                      ('e8', -6), ('a8', -4), ('h8', -4)])
    state['castling'] = dict.fromkeys(('K', 'Q', 'k', 'q'), True)
    state['turn'] = 'w' if seat == 0 else 'b'
    result = logic.call('applyMove', state, f'p{seat}', move(uci), ctx=ctx, now=NOW)
    views(logic, ctx, result)


def test_strict_schema_rejects_castling_through_check_and_pinned_ep():
    logic, ctx, initial = started()
    state = sparse(initial['state'], [('e1', 6), ('h1', 4), ('a8', -6), ('f8', -4)])
    state['castling']['K'] = True
    with pytest.raises(InvalidMoveError):
        logic.call('applyMove', state, 'p0', move('e1g1'), ctx=ctx, now=NOW)
    state = sparse(initial['state'], [('e1', 6), ('a8', -6), ('e8', -4),
                                      ('e5', 1), ('d5', -1)])
    state['ep'] = 19
    with pytest.raises(InvalidMoveError):
        logic.call('applyMove', state, 'p0', move('e5d6'), ctx=ctx, now=NOW)


def test_strict_schema_mate_and_stalemate_terminal_views():
    logic, ctx, result = started()
    for uci in ['f2f3', 'e7e5', 'g2g4', 'd8h4']:
        result = logic.call('applyMove', result['state'], result['turn'][0], move(uci), ctx=ctx, now=NOW)
    assert result['state']['reason'] == 'Checkmate'
    views(logic, ctx, result)
    logic, ctx, initial = started()
    state = sparse(initial['state'], [('c6', 6), ('c7', 5), ('a8', -6)])
    result = logic.call('applyMove', state, 'p0', move('c7b6'), ctx=ctx, now=NOW)
    assert result['state']['reason'] == 'Stalemate'
    views(logic, ctx, result)


@pytest.mark.parametrize('bad', [None, {}, {'fr': 1, 'fc': 2, 'tr': 8, 'tc': 3},
                                 {'fr': True, 'fc': 2, 'tr': 3, 'tc': 3},
                                 {'fr': 6, 'fc': 0, 'tr': 5, 'tc': 0, 'promo': 'K'},
                                 {'resign': False}, {'resign': True, 'fr': 1}])
def test_schema_rejects_invalid_move_structure(bad):
    logic, ctx, initial = started()
    with pytest.raises(InvalidMoveError):
        logic.call('applyMove', initial['state'], 'p0', bad, ctx=ctx, now=NOW)


def test_reviewed_schemas_reject_malformed_state_and_view():
    validators = compile_game_schemas(SCHEMAS)
    logic, ctx, initial = started()
    for patch in [{'bd': [0]*63}, {'turn': 'x'}, {'ep': 64}, {'rep': {'bad': 1}},
                  {'castling': {'K': 1}}, {'winner': 2}]:
        state = deepcopy(initial['state'])
        state.update(patch)
        assert not validators['state'].is_valid(state)
    view = logic.call('viewFor', initial['state'], None, ctx=ctx, now=NOW)
    assert validators['view'].is_valid(view)
    view['rep'] = {}
    assert not validators['view'].is_valid(view)
    for schema in SCHEMAS.values():
        Draft202012Validator.check_schema(schema)
