"""Actual QuickJS regressions for the audited three-minute chess release."""
from copy import deepcopy
import datetime as dt
from pathlib import Path

import pytest

from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.game_logic import InvalidMoveError

SOURCE = Path(__file__).parents[1] / 'games' / 'audit-batch2' / '3-minute-chess.server.js'
NOW = dt.datetime(2026, 11, 3, 21, tzinfo=dt.timezone.utc)


def started():
    logic = GameLogic(SOURCE.read_text(encoding='utf-8'))
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'max_loss': 10,
                        'display_name': f'P{i}'} for i in range(2)],
           'pot': 20, 'move_count': 0}
    return logic, ctx, logic.call('newMatch', ctx=ctx, seed=123, now=NOW)


@pytest.mark.parametrize('field', ['fr', 'fc', 'tr', 'tc'])
@pytest.mark.parametrize('value', [.5, None, {}, [], '0', True, -1, 8])
def test_bad_coordinates_are_invalid_moves_not_game_errors(field, value):
    logic, ctx, initial = started()
    move = {'fr': 6, 'fc': 4, 'tr': 4, 'tc': 4}
    move[field] = value
    with pytest.raises(InvalidMoveError):
        logic.call('applyMove', initial['state'], 'p0', move, ctx=ctx, now=NOW)


@pytest.mark.parametrize('seconds', [181, 3601, 86400])
def test_long_wait_does_not_restore_expired_clock(seconds):
    logic, ctx, initial = started()
    result = logic.call('applyMove', initial['state'], 'p0',
                        {'fr': 6, 'fc': 4, 'tr': 4, 'tc': 4}, ctx=ctx,
                        now=NOW + dt.timedelta(seconds=seconds))
    assert result['turn'] is None
    assert result['state']['winner'] == 1
    assert result['state']['wMs'] == 0
    assert result['state']['board'] == initial['state']['board']
    assert result['payouts'] == {'p0': 0, 'p1': 20}


def test_irrelevant_ep_does_not_split_repetition_counts_in_real_game():
    logic, ctx, current = started()
    moves = [{'fr': 6, 'fc': 4, 'tr': 4, 'tc': 4}] + [
        {'fr': 0, 'fc': 6, 'tr': 2, 'tc': 5},
        {'fr': 7, 'fc': 6, 'tr': 5, 'tc': 5},
        {'fr': 2, 'fc': 5, 'tr': 0, 'tc': 6},
        {'fr': 5, 'fc': 5, 'tr': 7, 'tc': 6},
    ] * 2
    positions = []
    for step, move in enumerate(moves):
        current = logic.call('applyMove', current['state'], current['turn'][0], move,
                             ctx=ctx, now=NOW, seed=123+step)
        ctx['move_count'] += 1
        if step in (0, 4, 8):
            positions.append(current['state']['board'])
    assert positions[0] == positions[1] == positions[2]
    assert current['turn'] is None
    assert current['state']['reason'] == 'Threefold repetition'
    assert current['state']['winner'] == -1
    assert current['payouts'] == {'p0': 10, 'p1': 10}


def sparse(initial, pieces):
    state = deepcopy(initial)
    state['board'] = [[None] * 8 for _ in range(8)]
    for r, c, piece in pieces:
        state['board'][r][c] = piece
    state['castling'] = dict.fromkeys(('K', 'Q', 'k', 'q'), False)
    state['ep'] = None
    return state


@pytest.mark.parametrize('pinned,expected_same', [(False, False), (True, True)])
def test_ep_key_keeps_only_legal_captures_including_pin(pinned, expected_same):
    _, ctx, initial = started()
    state = sparse(initial['state'], [(7, 4, 'wK'), (0, 0, 'bK'),
                                      (3, 4, 'wP'), (3, 3, 'bP')])
    if pinned:
        state['board'][0][4] = 'bR'
    # Inspect the production key through a temporary view projection, retaining
    # production move and king-safety logic instead of duplicating it in Python.
    logic = GameLogic(SOURCE.read_text(encoding='utf-8') + '''
    game.viewFor=function(s,p,c){return {key:this.posKey(s.board,s.side,s.castling,s.ep)};};
    ''')
    no_ep = logic.call('viewFor', state, 'p0', ctx=ctx)['key']
    state['ep'] = [2, 3]
    with_ep = logic.call('viewFor', state, 'p0', ctx=ctx)['key']
    assert (with_ep == no_ep) is expected_same


@pytest.mark.parametrize('move', [{'timeout': True}, {'resign': True},
                                 {'fr': 7, 'fc': 0, 'tr': 6, 'tc': 0}])
def test_bare_king_cannot_win_on_opponent_timeout_or_resignation(move):
    logic, ctx, initial = started()
    state = sparse(initial['state'], [(7, 4, 'wK'), (7, 0, 'wR'), (0, 4, 'bK')])
    state['wMs'] = 1
    current = logic.call('applyMove', state, 'p0', move, ctx=ctx,
                         now=NOW + dt.timedelta(seconds=1))
    assert current['turn'] is None
    assert current['state']['winner'] == -1
    assert current['payouts'] == {'p0': 10, 'p1': 10}


@pytest.mark.parametrize('white_extra,black_extra,expected_winner', [
    ([], [(0, 2, 'bB')], -1),
    ([], [(0, 1, 'bN')], -1),
    ([(6, 0, 'wP')], [(0, 1, 'bN')], 1),
    ([], [(0, 1, 'bN'), (0, 6, 'bN')], 1),
    ([(7, 2, 'wB')], [(0, 1, 'bB')], -1),  # Same square colour.
    ([(7, 2, 'wB')], [(0, 2, 'bB')], 1),   # Opposite-colour bishop can help block.
])
def test_timeout_material_is_side_specific_not_whole_board_insufficiency(
        white_extra, black_extra, expected_winner):
    logic, ctx, initial = started()
    state = sparse(initial['state'], [(7, 4, 'wK'), (0, 4, 'bK')]
                   + white_extra + black_extra)
    state['wMs'] = 1
    result = logic.call('applyMove', state, 'p0', {'timeout': True}, ctx=ctx,
                        now=NOW + dt.timedelta(seconds=1))
    assert result['state']['winner'] == expected_winner
    assert sum(result['payouts'].values()) == ctx['pot']


@pytest.mark.parametrize('method', ['randomMove', 'computerMove'])
def test_seeded_full_match_and_final_views(method):
    logic, ctx, current = started()
    for step in range(500):
        if current['turn'] is None:
            break
        pid = current['turn'][0]
        move = logic.call(method, current['state'], pid, ctx=ctx, seed=31+step, now=NOW)
        current = logic.call('applyMove', current['state'], pid, move,
                             ctx=ctx, seed=131+step, now=NOW)
        ctx['move_count'] += 1
    assert current['turn'] is None
    assert sum(current['payouts'].values()) == ctx['pot']
    for viewer in ('p0', 'p1', None):
        view = logic.call('viewFor', current['state'], viewer, ctx=ctx, now=NOW)
        assert view['winner'] == current['state']['winner']


def test_short_circuit_reply_search_still_detects_checkmate():
    logic, ctx, current = started()
    for move in [
        {'fr': 6, 'fc': 5, 'tr': 5, 'tc': 5},
        {'fr': 1, 'fc': 4, 'tr': 3, 'tc': 4},
        {'fr': 6, 'fc': 6, 'tr': 4, 'tc': 6},
        {'fr': 0, 'fc': 3, 'tr': 4, 'tc': 7},
    ]:
        current = logic.call('applyMove', current['state'], current['turn'][0],
                             move, ctx=ctx, now=NOW)
    assert current['turn'] is None
    assert current['state']['winner'] == 1
    assert current['state']['reason'] == 'Checkmate'


def test_short_circuit_reply_search_still_detects_stalemate():
    logic, ctx, initial = started()
    state = sparse(initial['state'], [(2, 2, 'wK'), (1, 2, 'wQ'), (0, 0, 'bK')])
    current = logic.call('applyMove', state, 'p0',
                         {'fr': 1, 'fc': 2, 'tr': 2, 'tc': 1}, ctx=ctx, now=NOW)
    assert current['turn'] is None
    assert current['state']['winner'] == -1
    assert current['state']['reason'] == 'Stalemate'


def test_irreversible_pawn_move_discards_unreachable_repetition_keys():
    logic, ctx, initial = started()
    current = logic.call('applyMove', initial['state'], 'p0',
                         {'fr': 6, 'fc': 4, 'tr': 4, 'tc': 4}, ctx=ctx, now=NOW)
    assert len(current['state']['rep']) == 1
    assert set(initial['state']['rep']).isdisjoint(current['state']['rep'])
    quiet = logic.call('applyMove', current['state'], 'p1',
                       {'fr': 0, 'fc': 6, 'tr': 2, 'tc': 5}, ctx=ctx, now=NOW)
    assert set(current['state']['rep']).issubset(quiet['state']['rep'])


def test_capture_discards_unreachable_repetition_keys():
    logic, ctx, initial = started()
    state = sparse(initial['state'], [(7, 4, 'wK'), (7, 0, 'wR'),
                                      (0, 4, 'bK'), (6, 0, 'bN')])
    current = logic.call('applyMove', state, 'p0',
                         {'fr': 7, 'fc': 0, 'tr': 6, 'tc': 0}, ctx=ctx, now=NOW)
    assert len(current['state']['rep']) == 1
    assert set(initial['state']['rep']).isdisjoint(current['state']['rep'])
