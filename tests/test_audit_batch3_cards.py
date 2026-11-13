"""QuickJS regressions and complete matches for batch 3 card games."""
from copy import deepcopy
from pathlib import Path
import pytest
from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.game_logic import InvalidMoveError
from game_platform.tests.helpers import run_unrestricted_server_code as run_gate
from game_platform.models import GameRules

ROOT = Path(__file__).parent.parent / 'games' / 'audit-batch3'

def context(n=2):
    return {'players': [{'id': f'p{i}', 'kind': 'human', 'display_name': f'P{i}',
                         'max_loss': 10, 'active': True} for i in range(n)],
            'pot': 10*n, 'move_count': 0}

def logic(name):
    return GameLogic(
        (ROOT / (name + '.server.js')).read_text(encoding="utf-8"),
        time_limit_seconds=.1,
    )


def test_ers_remaining_face_chances_stay_with_the_payer():
    game = logic('ers'); ctx = context()
    cur = game.call('newMatch', ctx=ctx, seed=1)
    for step in range(800):
        state = cur['state']; actor = cur['turn'][0]; seat = int(actor[1:])
        move = game.call('randomMove', state, actor, ctx=ctx, seed=step+1)
        nxt = game.call('applyMove', state, actor, move, ctx=ctx, seed=step+1)
        after = nxt['state']
        if (state['challenge'] and state['challenge']['left'] > 1 and move['type']=='flip'
                and not after['slap'] and after['challenge']
                and after['challenge']['left'] == state['challenge']['left']-1
                and after['hands'][seat]):
            assert nxt['turn'] == [actor]
            return
        cur = nxt; ctx['move_count'] += 1
        if cur['turn'] is None: break
    pytest.fail('seeded challenge regression did not reach payer')


def test_ers_false_slap_last_card_advances_to_nonempty_stack():
    game = logic('ers'); ctx = context()
    state = game.call('newMatch', ctx=ctx, seed=1)['state']
    # Valid conserved 54-card state: current player has one card left,
    # public pile is not slappable and the opponent has 52 cards.
    deck = state['hands'][0] + state['hands'][1]
    state.update(hands=[[deck[0]], deck[2:]], pile=[deck[1]], turn=0, slap=None, challenge=None)
    result = game.call('applyMove', state, 'p0', {'type':'slap'}, ctx=ctx)
    assert result['state']['hands'][0] == []
    assert result['turn'] == ['p1']
    game.call('applyMove', result['state'], 'p1', {'type':'flip'}, ctx=ctx)


@pytest.mark.parametrize('name,n', [('ers',n) for n in range(2,8)] + [('brazilian-truco',2),('brazilian-truco',4)])
@pytest.mark.parametrize('seed', [1,31,73])
def test_complete_matches_views_and_typed_malformed_moves(name,n,seed):
    game = logic(name); ctx = context(n)
    cur = game.call('newMatch', ctx=ctx, seed=seed)
    for step in range(2000):
        if cur['turn'] is None: break
        actor = cur['turn'][step % len(cur['turn'])]; state = cur['state']
        if step % 25 == 0:
            view = game.call('viewFor', state, None, ctx=ctx, seed=seed)
            assert view == game.call('viewFor', state, None, ctx=ctx, seed=seed)
            if name=='ers':
                assert 'hands' not in view
            else:
                assert view['hand']==[] and all(h==[] for h in view['hands'])
            for bad in [None,{},[],{'type':None},{'type':['flip']},
                        {'type':'play','card':None},{'type':'play','card':{}},
                        {'type':'play','card':['3C']},{'type':'play','card':'fake'}]:
                with pytest.raises(InvalidMoveError):
                    game.call('applyMove', state, actor, bad, ctx=ctx, seed=seed)
        method = 'computerMove' if step%2 else 'randomMove'
        move = game.call(method, state, actor, ctx=ctx, seed=seed+step)
        assert move == game.call(method, state, actor, ctx=ctx, seed=seed+step)
        cur = game.call('applyMove', state, actor, move, ctx=ctx, seed=seed+step)
        ctx['move_count'] += 1
    assert cur['turn'] is None
    assert sum(cur['payouts'].values()) == ctx['pot']


@pytest.mark.parametrize('name,counts,leave,join', [('ers',(2,3,4,5,6,7),True,True),('brazilian-truco',(2,4),True,True)])
def test_publish_gate(name,counts,leave,join):
    report = run_gate((ROOT/(name+'.server.js')).read_text(encoding="utf-8"),
                      rules=GameRules(allowed_player_counts=counts, allows_leave_mid_match=leave,
                                      allows_join_mid_match=join),
                      budget_seconds=5, max_walks=15, run_seed=20261105)
    assert report.passed, report.failures


def test_ers_seven_player_seed29_false_slap_does_not_deadlock():
    game = logic('ers'); ctx = context(7)
    cur = game.call('newMatch', ctx=ctx, seed=29)
    for step in range(1500):
        if cur['turn'] is None: break
        actor = cur['turn'][0]
        move = game.call('randomMove', cur['state'], actor, ctx=ctx, seed=29+step)
        cur = game.call('applyMove', cur['state'], actor, move, ctx=ctx, seed=29+step)
        if cur['turn'] is not None and not cur['state']['slap']:
            assert cur['state']['hands'][int(cur['turn'][0][1:])]
        ctx['move_count'] += 1
    assert cur['turn'] is None
