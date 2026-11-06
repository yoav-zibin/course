"""Production QuickJS regressions for the separate, untimed Chess game."""
from copy import deepcopy
import datetime as dt
from pathlib import Path

import pytest

from game_platform.game_logic import InvalidMoveError
from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic

SOURCE = Path(__file__).parents[1] / 'games' / 'audit-batch5' / 'chess.server.js'
NOW = dt.datetime(2026, 11, 6, tzinfo=dt.timezone.utc)


def started(extra=''):
    logic = GameLogic(SOURCE.read_text(encoding='utf-8') + extra)
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'max_loss': 10}
                       for i in range(2)], 'pot': 20, 'move_count': 0}
    return logic, ctx, logic.call('newMatch', ctx=ctx, now=NOW, seed=123)


def move(uci):
    return dict(fr=8-int(uci[1]), fc='abcdefgh'.index(uci[0]),
                tr=8-int(uci[3]), tc='abcdefgh'.index(uci[2]))


def sparse(initial, pieces):
    s = deepcopy(initial)
    s['bd'] = [0] * 64
    for square, piece in pieces:
        s['bd'][(8-int(square[1]))*8+'abcdefgh'.index(square[0])] = piece
    s['castling'] = dict.fromkeys(('K', 'Q', 'k', 'q'), False)
    s['ep'] = None
    s['rep'] = {}
    return s


def test_reachable_threefold_does_not_split_on_uncapturable_ep():
    logic, ctx, current = started()
    positions = []
    for ply, uci in enumerate(['e2e4']+['g8f6', 'g1f3', 'f6g8', 'f3g1']*2, 1):
        current = logic.call('applyMove', current['state'], current['turn'][0],
                             move(uci), ctx=ctx, now=NOW)
        ctx['move_count'] += 1
        if ply in (1, 5, 9):
            positions.append(current['state'])
    assert all(s['bd'] == positions[0]['bd'] for s in positions)
    assert [s['ep'] for s in positions] == [44, None, None]
    assert current['turn'] is None
    assert current['state']['reason'] == 'Threefold repetition'
    assert current['payouts'] == {'p0': 10, 'p1': 10}


@pytest.mark.parametrize('pinned', [False, True])
def test_ep_position_key_preserves_legal_capture_but_ignores_pin(pinned):
    # A temporary projection inspects the actual production hash function;
    # legalAt and king safety are production code, not a Python reimplementation.
    logic, ctx, initial = started('''
game.viewFor = function(s) { return {key: posKey(s.bd,s.turn,s.castling,s.ep)}; };
''')
    s = sparse(initial['state'], [('e1', 6), ('a8', -6), ('e5', 1), ('d5', -1)])
    if pinned:
        s['bd'][4] = -4  # Re8 pins Pe5 against Ke1.
    before = logic.call('viewFor', s, 'p0', ctx=ctx)['key']
    s['ep'] = 19  # d6
    after = logic.call('viewFor', s, 'p0', ctx=ctx)['key']
    assert (before == after) is pinned
    if pinned:
        with pytest.raises(InvalidMoveError):
            logic.call('applyMove', s, 'p0', move('e5d6'), ctx=ctx, now=NOW)
    else:
        result = logic.call('applyMove', s, 'p0', move('e5d6'), ctx=ctx, now=NOW)
        assert result['state']['bd'][27] == 0
        assert result['state']['bd'][19] == 1


def test_legal_capture_enters_three_same_colour_bishop_dead_position():
    # Active predecessor 7k/8/8/5n2/4B3/8/2B3B1/K7 w - - 0 1.
    logic, ctx, initial = started()
    s = sparse(initial['state'], [('a1', 6), ('h8', -6), ('c2', 3),
                                  ('e4', 3), ('g2', 3), ('f5', -2)])
    result = logic.call('applyMove', s, 'p0', move('e4f5'), ctx=ctx, now=NOW)
    assert result['state']['bd'][29] == 3
    assert result['state']['winner'] == -1
    assert result['state']['reason'] == 'Insufficient material'
    assert result['turn'] is None
    assert result['payouts'] == {'p0': 10, 'p1': 10}


@pytest.mark.parametrize('pieces,expected', [
    ([('c2', 3), ('g2', 3), ('e4', 3)], -1),
    ([('c2', 3), ('g2', 3), ('d4', 3)], None),
    ([('c2', 3), ('g2', 3), ('e4', 2)], None),
])
def test_dead_position_keeps_opposite_colour_bishop_and_knight_controls(pieces, expected):
    logic, ctx, initial = started()
    s = sparse(initial['state'], [('a1', 6), ('h8', -6)] + pieces)
    result = logic.call('applyMove', s, 'p0', move('a1b1'), ctx=ctx, now=NOW)
    assert result['state']['winner'] == expected


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
def test_resignation_mating_possibility_is_side_specific(white_extra, black_extra, expected):
    logic, ctx, initial = started()
    s = sparse(initial['state'], [('e1', 6), ('e8', -6)] + white_extra + black_extra)
    result = logic.call('applyMove', s, 'p0', {'resign': True}, ctx=ctx, now=NOW)
    assert result['state']['winner'] == expected
    assert result['turn'] is None
    assert result['payouts'] == ({'p0': 10, 'p1': 10} if expected < 0 else {'p0': 0, 'p1': 20})


@pytest.mark.parametrize('method', ['randomMove', 'computerMove'])
def test_complete_seeded_match_payouts_and_final_views(method):
    logic, ctx, current = started()
    for step in range(250):
        if current['turn'] is None:
            break
        pid = current['turn'][0]
        chosen = logic.call(method, current['state'], pid, ctx=ctx, now=NOW, seed=step+41)
        current = logic.call('applyMove', current['state'], pid, chosen, ctx=ctx, now=NOW)
        ctx['move_count'] += 1
    assert current['turn'] is None
    assert sum(current['payouts'].values()) == 20
    for viewer in ('p0', 'p1', None):
        view = logic.call('viewFor', current['state'], viewer, ctx=ctx, now=NOW)
        assert view['winner'] == current['state']['winner']


def test_checkmate_still_takes_precedence():
    logic, ctx, current = started()
    for uci in ['f2f3', 'e7e5', 'g2g4', 'd8h4']:
        current = logic.call('applyMove', current['state'], current['turn'][0], move(uci), ctx=ctx, now=NOW)
    assert current['state']['winner'] == 1
    assert current['state']['reason'] == 'Checkmate'
    assert current['payouts'] == {'p0': 0, 'p1': 20}
