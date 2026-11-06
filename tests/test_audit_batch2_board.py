"""Published-code regressions for authoritative golf physics and army elimination."""
import datetime as dt
import math
from pathlib import Path

import pytest

from game_platform.game_logic import GameLogic

DIRECTORY = Path(__file__).parents[1] / 'games' / 'audit-batch2'
NOW = dt.datetime(2026, 11, 4, tzinfo=dt.timezone.utc)


def runner(name, n):
    logic = GameLogic((DIRECTORY / (name + '.server.js')).read_text())
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'max_loss': 10} for i in range(n)],
           'pot': n * 10, 'move_count': 0}
    return logic, ctx


def call(logic, ctx, function, *args, seed=903):
    return logic.call(function, *args, ctx=ctx, seed=seed, now=NOW)


def sparse_chess(logic, ctx, pieces):
    state = call(logic, ctx, 'newMatch')['state']
    state['board'] = {str(r*14+c): {'t': t, 'o': o} for r, c, t, o in pieces}
    return state


def test_four_player_chess_uses_same_attack_rules_for_check_and_highlight():
    logic, ctx = runner('4-player-chess', 4)
    pieces = [(7,7,75,0),(3,0,75,1),(0,7,75,2),(7,13,75,3),(6,8,80,1)]
    state = sparse_chess(logic, ctx, pieces)
    view = call(logic, ctx, 'viewFor', state, 'p0')
    assert not view['inCheck']
    assert '7,7' not in view['checkKings']
    # A west pawn in front-left really does attack the king.
    state['board'].pop(str(6*14+8))
    state['board'][str(6*14+6)] = {'t': 80, 'o': 1}
    view = call(logic, ctx, 'viewFor', state, 'p0')
    assert view['inCheck']
    assert '7,7' in view['checkKings']


def test_existing_stalemated_army_is_removed_when_it_passes():
    logic, ctx = runner('4-player-chess', 4)
    state = sparse_chess(logic, ctx, [(13,3,75,0),(11,5,75,1),(12,5,81,1),(0,7,75,2),(7,13,75,3)])
    view = call(logic, ctx, 'viewFor', state, 'p0')
    assert not view['inCheck'] and not view['legalMoves']
    move = call(logic, ctx, 'computerMove', state, 'p0')
    result = call(logic, ctx, 'applyMove', state, 'p0', move)
    assert result['state']['eliminated'][0]
    assert all(p['o'] != 0 for p in result['state']['board'].values())
    assert result['turn'] == ['p1']


@pytest.mark.parametrize('queen', [(12,5), (12,4)])
def test_next_stalemated_or_checkmated_army_is_eliminated_automatically(queen):
    logic, ctx = runner('4-player-chess', 4)
    state = sparse_chess(logic, ctx, [(13,3,75,0),(11,5,75,1),(*queen,81,1),(0,7,75,2),(7,13,75,3)])
    assert not call(logic, ctx, 'viewFor', state, 'p0')['legalMoves']
    result = call(logic, ctx, 'applyMove', state, 'p3', {'kind':'move','fr':7,'fc':13,'tr':7,'tc':12})
    assert result['state']['eliminated'][0]
    assert result['turn'] == ['p1']


def test_automatic_elimination_settles_team_winner_and_payout():
    logic, ctx = runner('4-player-chess', 4)
    state = sparse_chess(logic, ctx, [(13,3,75,0),(11,5,75,1),(12,5,81,1),(7,13,75,3)])
    state['eliminated'][2] = True
    result = call(logic, ctx, 'applyMove', state, 'p3', {'kind':'move','fr':7,'fc':13,'tr':7,'tc':12})
    assert result['turn'] is None
    assert result['state']['winnerTeam'] == 1
    assert result['payouts'] == {'p1':20, 'p3':20}


def inside(point, polygon):
    x, y = point
    odd = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            odd = not odd
    return odd


def test_opening_golf_shot_stays_on_course_and_provides_authoritative_frames():
    logic, ctx = runner('mini-golf-duels', 2)
    state = call(logic, ctx, 'newMatch')['state']
    result = call(logic, ctx, 'applyMove', state, 'p0', {'vx':0,'vy':3})
    view = call(logic, ctx, 'viewFor', result['state'], 'p0')
    assert inside(view['pos'][0], view['course']['fair'])
    assert not math.isclose(view['pos'][0][1], 381.89447281695703)
    shot = view['lastShot']
    assert shot['seat'] == 0 and shot['hole'] == 0
    assert shot['frames'][0] == state['pos'][0]
    assert shot['frames'][-1] == view['pos'][0]
    assert all(math.isfinite(x) for frame in shot['frames'] for x in frame)


def test_golf_portal_transports_the_ball_in_authoritative_trace():
    logic, ctx = runner('mini-golf-duels', 2)
    state = call(logic, ctx, 'newMatch')['state']
    for hole in range(1,5):
        state['hole'] = hole
        course = call(logic, ctx, 'viewFor', state, 'p0')['course']
        if course['port']:
            break
    else:
        pytest.fail('reviewed procedural courses should include a teleporter')
    entry, exit = course['port']['a'], course['port']['b']
    state['pos'][0] = [entry['x'], entry['y']]
    result = call(logic, ctx, 'applyMove', state, 'p0', {'vx':0.6,'vy':0})
    frames = result['state']['lastShot']['frames']
    assert any(math.hypot(p[0]-exit['x'],p[1]-exit['y']) < 30 for p in frames[1:])


@pytest.mark.parametrize('name,n', [('mini-golf-duels',2),('4-player-chess',4)])
@pytest.mark.parametrize('seed', [903,1511])
def test_complete_games_and_terminal_views(name, n, seed):
    logic, ctx = runner(name, n)
    current = call(logic, ctx, 'newMatch', seed=seed)
    for step in range(200):
        if current['turn'] is None:
            break
        pid = current['turn'][0]
        method = 'computerMove' if step%2 else 'randomMove'
        move = call(logic, ctx, method, current['state'], pid, seed=seed+step)
        current = call(logic, ctx, 'applyMove', current['state'], pid, move, seed=seed+step+111)
        ctx['move_count'] += 1
        for viewer in [pid,None]:
            call(logic, ctx, 'viewFor', current['state'], viewer, seed=seed)
    assert current['turn'] is None
    assert sum(current['payouts'].values()) == ctx['pot']
    if name == 'mini-golf-duels':
        assert all(len(history) == 5 for history in current['state']['hist'])
        assert all(isinstance(score,int) for history in current['state']['hist'] for score in history)
