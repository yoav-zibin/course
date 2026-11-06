"""Actual QuickJS views, full matches, and bad-input checks for the audited games."""
from copy import deepcopy
from pathlib import Path

import pytest

from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.game_logic import InvalidMoveError
from game_platform.tests.helpers import run_unrestricted_server_code as check_server_code
from game_platform.models import GameRules

GAMES = Path(__file__).parent.parent / 'games' / 'audit-batch3'


def started(name, seed=0):
    logic = GameLogic((GAMES / f'{name}.server.js').read_text())
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'display_name': f'P{i}', 'max_loss': 10} for i in range(2)],
           'pot': 20, 'move_count': 0}
    return logic, ctx, logic.call('newMatch', ctx=ctx, seed=seed)


def play_move(logic, ctx, current, move, seed=0):
    result = logic.call('applyMove', current['state'], current['turn'][0], move, ctx=ctx, seed=seed)
    ctx['move_count'] += 1
    return result


def golf_playing(seed=0):
    logic, ctx, current = started('six-card-golf', seed)
    for _ in range(2):
        current = play_move(logic, ctx, current, {'kind': 'flip', 'idxs': [0, 1]})
    return logic, ctx, current


@pytest.mark.parametrize('name', ['reversi', 'six-card-golf'])
@pytest.mark.parametrize('method', ['randomMove', 'computerMove'])
@pytest.mark.parametrize('seed', [0, 20261105])
def test_complete_quickjs_matches_and_all_terminal_views(name, method, seed):
    logic, ctx, current = started(name, seed)
    for step in range(200):
        for viewer in ['p0', 'p1', None]:
            view = logic.call('viewFor', current['state'], viewer, ctx=ctx, seed=seed + step)
            assert isinstance(view, dict)
            if current['turn'] is None:
                # These are game-defined view fields, not transition envelopes.
                assert view['turn'] == []
        if current['turn'] is None:
            break
        actor = current['turn'][0]
        move = logic.call(method, current['state'], actor, ctx=ctx, seed=seed + step)
        assert move == logic.call(method, current['state'], actor, ctx=ctx, seed=seed + step)
        current = play_move(logic, ctx, current, move, seed + step)
    assert current['turn'] is None
    assert sum(current['payouts'].values()) == ctx['pot']


@pytest.mark.parametrize('name', ['reversi', 'six-card-golf'])
@pytest.mark.parametrize('move', [None, False, True, 1, 'move', [], {}, {'cell': None}, {'cell': -1},
                                  {'kind': 'flip', 'idxs': [0, 0]}, {'kind': 'flip', 'idxs': [True, 2]}])
def test_malformed_initial_moves_are_rejected_without_server_crash(name, move):
    logic, ctx, current = started(name)
    before = deepcopy(current['state'])
    with pytest.raises(InvalidMoveError):
        logic.call('applyMove', current['state'], current['turn'][0], move, ctx=ctx)
    assert current['state'] == before


def test_golf_public_cards_have_faces_but_unrevealed_hands_and_stock_draw_stay_private():
    logic, ctx, current = golf_playing()
    spectator = logic.call('viewFor', current['state'], None, ctx=ctx)
    assert spectator['discard'] == current['state']['discard']
    assert all(not card.get('up') for card in spectator['discard'])  # public cards need no hand-only flag
    current = play_move(logic, ctx, current, {'kind': 'draw', 'from': 'stock'})
    own = logic.call('viewFor', current['state'], 'p0', ctx=ctx)
    assert own['drew'] == current['state']['drew']
    for viewer in ['p0', 'p1', None]:
        view = logic.call('viewFor', current['state'], viewer, ctx=ctx)
        assert 'stock' not in view
        for seat, hand in enumerate(current['state']['hands']):
            for index, card in enumerate(hand):
                if not card['up']:
                    assert view['hands'][seat][index] == {'r': 0, 's': 0, 'up': False}
        if viewer != 'p0':
            assert view['drew'] == {'r': 0, 's': 0, 'from': 'stock', 'hidden': True}


def test_golf_hidden_rank_swaps_do_not_change_views_or_ai_decisions():
    logic, ctx, current = golf_playing()
    changed = deepcopy(current['state'])
    a, b = changed['hands'][0][2:4]
    a['r'], b['r'] = b['r'], a['r']
    a['s'], b['s'] = b['s'], a['s']
    for viewer in ['p0', 'p1', None]:
        assert logic.call('viewFor', current['state'], viewer, ctx=ctx) == logic.call('viewFor', changed, viewer, ctx=ctx)
    assert logic.call('computerMove', current['state'], 'p0', ctx=ctx, seed=7) == logic.call('computerMove', changed, 'p0', ctx=ctx, seed=7)


def test_golf_reachable_tie_has_equal_scores_and_shared_payouts():
    logic, ctx, current = started('six-card-golf', seed=7)
    for step in range(200):
        if current['turn'] is None:
            break
        move = logic.call('randomMove', current['state'], current['turn'][0], ctx=ctx, seed=7 + step)
        current = play_move(logic, ctx, current, move, seed=7 + step)
    assert current['state']['scores'] == [32, 32]
    assert current['payouts'] == {'p0': 10, 'p1': 10}


@pytest.mark.parametrize('name', ['reversi', 'six-card-golf'])
def test_five_second_publication_gate(name):
    rules = GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False, allows_join_mid_match=False)
    report = check_server_code((GAMES / f'{name}.server.js').read_text(), rules=rules,
                               budget_seconds=5, max_moves_per_walk=1000, run_seed=20261105)
    assert report.passed and not report.too_slow, report
