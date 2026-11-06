"""Blackjack published-code regressions using the production QuickJS runner."""
from copy import deepcopy
from pathlib import Path
import pytest
from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.tests.helpers import run_unrestricted_server_code as publication_gate
from game_platform.models import GameRules

SOURCE = Path(__file__).parent.parent/'games/audit-batch4/blackjack-table.server.js'

def context(n):
    return {'players':[{'id':f'p{i}','kind':'human','display_name':f'P{i}','max_loss':10}
                       for i in range(n)], 'pot':10*n, 'move_count':0}

def logic():
    return GameLogic(SOURCE.read_text(), time_limit_seconds=.1)


def test_solo_plays_ten_rounds_with_chips_remaining():
    game=logic(); ctx=context(1); cur=game.call('newMatch',ctx=ctx,seed=123)
    rounds=[]
    for step in range(160):
        state=cur['state']
        if cur['turn'] is None: break
        if state['phase']=='setup': move={'kind':'start','names':[],'six':False}
        elif state['phase']=='betting': move={'kind':'bet','amount':10}
        elif state['phase']=='play': move={'kind':'stand'}
        else:
            rounds.append(state['round']); move={'kind':'next'}
        cur=game.call('applyMove',state,'p0',move,ctx=ctx,seed=123+step)
    assert rounds == list(range(1,11))
    assert cur['turn'] is None and cur['state']['round']==10
    assert cur['state']['chips'][0]>0
    assert cur['payouts']=={'p0':10}
    assert game.call('viewFor',cur['state'],None,ctx=ctx)['phase']=='gameOver'


def test_solo_insolvency_ends_before_ten_rounds():
    game=logic(); ctx=context(1); cur=game.call('newMatch',ctx=ctx,seed=123)
    for move in [{'kind':'start','six':False},{'kind':'bet','amount':1000},{'kind':'stand'}]:
        cur=game.call('applyMove',cur['state'],'p0',move,ctx=ctx,seed=123)
    assert cur['state']['phase']=='roundOver' and cur['state']['chips']==[0]
    cur=game.call('applyMove',cur['state'],'p0',{'kind':'next'},ctx=ctx,seed=123)
    assert cur['turn'] is None and cur['state']['round']==1
    assert cur['payouts']=={'p0':10}


def test_seed_five_forty_moves_reaches_two_chip_bet_then_continues():
    game=logic(); ctx=context(2); cur=game.call('newMatch',ctx=ctx,seed=5)
    for step in range(40):
        state=cur['state']; actor='p0' if 'p0' in cur['turn'] else cur['turn'][0]
        if state['phase']=='setup': move={'kind':'start','names':[],'six':False}
        elif state['phase']=='betting':
            chips=state['chips'][state['curP']]
            amount=25 if state['round']==1 else 100 if chips>=100 else 25 if chips>=25 else 10
            move={'kind':'bet','amount':amount}
        elif state['phase']=='play':
            hand=state['hands'][state['curP']][state['curH']]
            move={'kind':'double' if len(hand['cards'])==2 and state['chips'][state['curP']]>=hand['bet'] else 'stand'}
        else: move={'kind':'next'}
        cur=game.call('applyMove',state,actor,move,ctx=ctx,seed=5+step)
        ctx['move_count']+=1
    assert cur['state']['phase']=='betting' and cur['state']['chips']==[2,750]
    assert cur['state']['round']==9 and cur['turn']==['p0']
    cur=game.call('applyMove',cur['state'],'p0',{'kind':'bet','amount':2},ctx=ctx,seed=45)
    assert cur['state']['pendingBets']['0']==2 and cur['state']['chips'][0]==0
    assert cur['turn']==['p1']


@pytest.mark.parametrize('n',[2,3])
def test_multiplayer_one_solvent_player_still_ends(n):
    game=logic(); ctx=context(n); state=game.call('newMatch',ctx=ctx)['state']
    state.update(phase='roundOver',chips=[500]+[0]*(n-1))
    result=game.call('applyMove',state,'p0',{'kind':'next'},ctx=ctx)
    assert result['turn'] is None and result['payouts']['p0']==ctx['pot']
    assert sum(result['payouts'].values())==ctx['pot']


@pytest.mark.parametrize('n',[1,2,3])
def test_actual_deal_hole_card_is_hidden_from_every_player_and_spectator(n):
    game=logic();ctx=context(n);cur=game.call('newMatch',ctx=ctx,seed=123)
    cur=game.call('applyMove',cur['state'],'p0',{'kind':'start','six':False},ctx=ctx,seed=123)
    for i in range(n):cur=game.call('applyMove',cur['state'],f'p{i}',{'kind':'bet','amount':10},ctx=ctx,seed=123)
    assert cur['state']['phase']=='play'
    for viewer in [f'p{i}' for i in range(n)]+[None]:
        view=game.call('viewFor',cur['state'],viewer,ctx=ctx)
        assert view['holeHidden'] and view['dealer']==cur['state']['dealer'][:1]
        changed=deepcopy(cur['state']);changed['dealer'][1]['r']=1+changed['dealer'][1]['r']%13
        changed['deck'].reverse()
        assert game.call('viewFor',changed,viewer,ctx=ctx)==view


@pytest.mark.parametrize('n',[1,2,3])
def test_five_second_publication_gate_for_every_supported_count(n):
    result=publication_gate(SOURCE.read_text(),rules=GameRules(allowed_player_counts=(n,),
        allows_leave_mid_match=False,allows_join_mid_match=False),budget_seconds=5,
        max_walks=50,run_seed=20261106)
    assert result.passed,result.failures
