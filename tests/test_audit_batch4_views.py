"""Actual QuickJS fixtures behind the Hearts/Cheat client regressions."""
from pathlib import Path

import pytest
from game_platform.game_logic import GameLogic

GAMES = Path(__file__).parent.parent / 'games' / 'audit-batch4'


def start(name, n, seed):
    logic = GameLogic((GAMES / f'{name}.server.js').read_text())
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'display_name': f'P{i}', 'max_loss': 10} for i in range(n)],
           'pot': n * 10, 'move_count': 0}
    return logic, ctx, logic.call('newMatch', ctx=ctx, seed=seed)


def test_hearts_reachable_tie_seed14_has_two_low_scorers_and_shared_payouts():
    logic, ctx, current = start('hearts', 4, 14)
    for step in range(52):
        actor = current['turn'][0]
        move = logic.call('randomMove', current['state'], actor, ctx=ctx, seed=14 + step)
        current = logic.call('applyMove', current['state'], actor, move, ctx=ctx, seed=14 + step)
        ctx['move_count'] += 1
    assert current['turn'] is None
    assert current['state']['taken'] == [0, 3, 23, 0]
    assert current['payouts'] == {'p0': 20, 'p1': 0, 'p2': 0, 'p3': 20}
    for viewer in ['p0', 'p3', None]:
        view = logic.call('viewFor', current['state'], viewer, ctx=ctx)
        assert view['taken'] == [0, 3, 23, 0]
        assert view['phase'] == 'over'


@pytest.mark.parametrize('move', [{'kind': 'bs'}, {'kind': 'pass'}])
def test_cheat_challenge_fixture_exposes_no_spectator_hand_and_eligible_actions_are_legal(move):
    logic, ctx, current = start('cheat-bs', 3, 14)
    current = logic.call('applyMove', current['state'], 'p0',
                         {'kind': 'play', 'cards': [current['state']['hands'][0][0]]}, ctx=ctx, seed=14)
    ctx['move_count'] += 1
    assert current['turn'] == ['p1', 'p2']
    spectator = logic.call('viewFor', current['state'], None, ctx=ctx)
    assert spectator['myHand'] == []
    assert spectator['phase'] == 'challenge'
    assert spectator['pending']['player'] == 0
    assert 'cards' not in spectator['pending']
    accepted = logic.call('applyMove', current['state'], 'p1', move, ctx=ctx, seed=15)
    assert isinstance(accepted['state'], dict)
