"""Published-seed and client/server regressions for Guandan's combo rules."""
from copy import deepcopy
from pathlib import Path
import re

import pytest

from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.game_testing import test_server_code as run_gate
from game_platform.models import GameRules

GAMES = Path(__file__).parent.parent / 'games' / 'audit-batch2'
SERVER = (GAMES / 'guandan.server.js').read_text()
CLIENT = re.search(r'<script>([\s\S]*?)</script>', (GAMES / 'guandan.html').read_text()).group(1)
CTX = {'players': [
    {'id': f'p{i}', 'kind': 'human', 'display_name': f'P{i}', 'max_loss': 10}
    for i in range(4)
], 'pot': 40, 'move_count': 0}


def cards(ranks, suit=0):
    return [{'r': rank, 's': suit} for rank in ranks]


def engine(client=False, expression='detect(s.cards, s.tr)'):
    if client:
        stubs = "const document={getElementById(){return {}}};const window={addEventListener(){}};const parent={postMessage(){}};"
        return GameLogic(stubs + CLIENT + '\nconst game={randomMove(s,p,ctx){return ' + expression + ';}};')
    return GameLogic(SERVER + '\ngame.randomMove=function(s,p,ctx){return ' + expression + ';};')


def detect(selection, trump=2, client=False):
    return engine(client).call('randomMove', {'cards': selection, 'tr': trump}, 'p0', ctx=CTX)


def test_seed_two_wild_hearts_are_pair_and_cannot_bomb_full_house():
    logic = GameLogic(SERVER)
    current = logic.call('newMatch', ctx=CTX, seed=2)
    move = {'cards': cards([2, 2], 1)}
    assert current['state']['hands'][0].count((2 << 3) | 1) == 2
    result = logic.call('applyMove', current['state'], 'p0', move, ctx=CTX, seed=2)
    assert result['state']['trick']['combo'] == {'type': 'pair', 'main': 2, 'pw': 800, 'len': 2}
    state = deepcopy(current['state'])
    state['trick']['combo'] = {'type': 'fullhouse', 'main': 3, 'pw': 3, 'len': 5}
    with pytest.raises(InvalidMoveError, match='does not beat'):
        logic.call('applyMove', state, 'p0', move, ctx=CTX, seed=2)


def test_seed_two_natural_level_23456_is_accepted():
    logic = GameLogic(SERVER)
    current = logic.call('newMatch', ctx=CTX, seed=2)
    selection = [{'r': 2, 's': 2}, {'r': 3, 's': 0}, {'r': 4, 's': 0}, {'r': 5, 's': 0}, {'r': 6, 's': 2}]
    result = logic.call('applyMove', current['state'], 'p0', {'cards': selection}, ctx=CTX, seed=2)
    assert result['state']['trick']['combo']['type'] == 'straight'
    assert result['state']['trick']['combo']['main'] == 6
    assert len(result['state']['hands'][0]) == 22


@pytest.mark.parametrize('selection,trump,kind,main', [
    (cards([2, 2], 1), 2, 'pair', 2),
    (cards([3, 4, 5, 6, 7]), 5, 'sflush', 7),
    (cards([14, 2, 3, 4, 5]), 9, 'sflush', 5),
    (cards([10, 11, 12, 13, 14]), 9, 'sflush', 14),
    ([{'r': r, 's': i % 2} for i, r in enumerate([14, 2, 3, 4, 5])], 9, 'straight', 5),
    ([{'r': r, 's': i % 2} for i, r in enumerate([2, 3, 4, 5, 6])], 5, 'straight', 6),
    (cards([14, 14, 2, 2, 3, 3]), 2, 'tube', 3),
    (cards([2, 2, 3, 3, 4, 4]), 3, 'tube', 4),
    (cards([12, 12, 13, 13, 14, 14]), 13, 'tube', 14),
    (cards([14, 14, 14, 2, 2, 2]), 2, 'plate', 2),
    (cards([4, 4, 4, 5, 5, 5]), 5, 'plate', 5),
    (cards([13, 13, 13, 14, 14, 14]), 13, 'plate', 14),
    (cards([3, 4, 5, 6]) + cards([2], 1), 2, 'sflush', 6),
    (cards([8, 8, 8, 8]), 2, 'bomb', 8),
    (cards([8, 8, 8, 9, 9]), 2, 'fullhouse', 8),
    ([{'r': 15, 's': 4}] * 2 + [{'r': 16, 's': 4}] * 2, 2, 'jokerbomb', 99),
])
def test_client_and_server_accept_same_normal_and_edge_combos(selection, trump, kind, main):
    server = detect(selection, trump)
    assert server['type'] == kind
    assert server['main'] == main
    assert detect(selection, trump, client=True) == server


@pytest.mark.parametrize('selection', [
    cards([12, 13, 14, 2, 3]),  # no wrap-around QKA23
    cards([3, 4, 5, 6]),
    cards([3, 4, 5, 6, 7, 8]),
    cards([3, 4, 5, 6]) + [{'r': 15, 's': 4}],
    cards([3, 3, 4, 4, 6, 6]),
    cards([13, 13, 13, 2, 2, 2]),  # no K-to-2 wrapping
])
def test_client_and_server_reject_non_sequences_and_jokers(selection):
    assert detect(selection, 2) is None
    assert detect(selection, 2, client=True) is None


@pytest.mark.parametrize('selection,trump,combo', [
    (cards([2, 3, 4, 5, 6]), 2, {'type': 'sflush', 'main': 5, 'pw': 901, 'len': 5, 'big': 5.5, 'isBomb': True}),
    ([{'r': r, 's': i % 2} for i, r in enumerate([2, 3, 4, 5, 6])], 2, {'type': 'straight', 'main': 5, 'pw': 5, 'len': 5}),
    (cards([2, 2, 3, 3, 4, 4]), 3, {'type': 'tube', 'main': 3, 'pw': 3, 'len': 6}),
    (cards([2, 2, 2, 3, 3, 3]), 2, {'type': 'plate', 'main': 2, 'pw': 2, 'len': 6}),
])
def test_suggest_uses_new_patterns_consistently_and_without_client_crash(selection, trump, combo):
    state = {'hand': selection, 'tr': trump, 'combo': combo}
    server = engine(expression='suggestIdx(s.hand, s.tr, s.combo)').call('randomMove', state, 'p0', ctx=CTX)
    client = engine(True, 'suggestIdx(s.hand, s.tr, s.combo)').call('randomMove', state, 'p0', ctx=CTX)
    assert server is not None
    assert client == server
    chosen = [selection[i] for i in server['idx']]
    assert detect(chosen, trump) == server['d']
    assert server['d']['pw'] > combo['pw']


@pytest.mark.parametrize('seed', [2, 31, 73])
def test_full_match_generators_remain_legal(seed):
    logic = GameLogic(SERVER)
    ctx = deepcopy(CTX)
    current = logic.call('newMatch', ctx=ctx, seed=seed)
    for step in range(1500):
        if current['turn'] is None:
            break
        actor = current['turn'][0]
        move = logic.call('computerMove' if step % 2 else 'randomMove', current['state'], actor, ctx=ctx, seed=seed + step)
        current = logic.call('applyMove', current['state'], actor, move, ctx=ctx, seed=seed + step)
        ctx['move_count'] += 1
    assert current['turn'] is None
    assert sum(current['payouts'].values()) == ctx['pot']


def test_platform_publish_gate():
    report = run_gate(SERVER, rules=GameRules(allowed_player_counts=(4,),
                      allows_leave_mid_match=False, allows_join_mid_match=False),
                      run_seed=20261104, budget_seconds=5, max_walks=25)
    assert report.passed, report.failures
