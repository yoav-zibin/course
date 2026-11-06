"""Rummy mandatory-discard reachability and complete-match regressions."""
from copy import deepcopy
from pathlib import Path
from itertools import combinations
import pytest
from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.game_logic import InvalidMoveError
from game_platform.tests.helpers import run_unrestricted_server_code as run_gate
from game_platform.models import GameRules
ROOT=Path(__file__).parent.parent/'games'/'audit-batch4'
SOURCE=(ROOT/'rummy-500.server.js').read_text()
def engine(): return GameLogic(SOURCE,time_limit_seconds=.1)
def context(n=2): return {'players':[{'id':f'p{i}','display_name':f'P{i}','kind':'human','active':True,'max_loss':10} for i in range(n)],'pot':10*n,'move_count':0}
def card(r,s='S',deck=0): return {'id':f'{deck}-{s}{r}','r':r,'s':s}
def inventory(s):
    cards=sum(s['hands'],[])+s['deck']+s['discard']
    for m in s['melds']: cards+=m['cards']+[e['card'] for e in m['exts']]
    return [c['id'] for c in cards]

def test_seed2_impossible_deep_pickup_is_rejected_without_changing_cards():
    logic=engine();ctx=context();cur=logic.call('newMatch',ctx=ctx,seed=2)
    for step in range(2):
        m=logic.call('randomMove',cur['state'],cur['turn'][0],ctx=ctx,seed=2+step)
        cur=logic.call('applyMove',cur['state'],cur['turn'][0],m,ctx=ctx,seed=2+step);ctx['move_count']+=1
    before=deepcopy(cur['state'])
    assert len(before['discard'])==2 and before['discard'][0]['id']=='0-S13'
    with pytest.raises(InvalidMoveError,match='deepest discard'):
        logic.call('applyMove',before,cur['turn'][0],{'type':'draw_discard','index':0},ctx=ctx,seed=4)
    assert before==cur['state']
    # A legal stock draw still works after rejection.
    result=logic.call('applyMove',before,cur['turn'][0],{'type':'draw_stock'},ctx=ctx)
    assert sorted(inventory(result['state']))==sorted(inventory(before))

@pytest.mark.parametrize('hand,discard,melds',[
    ([card(2),card(3)],[card(1),card(9,'H')],[]),
    ([card(7,'H'),card(7,'D')],[card(7),card(8,'C')],[]),
    ([card(9,'H')],[card(4),card(8,'C')],[{'id':'m1','owner':1,'cards':[card(1),card(2),card(3)],'exts':[]}]),
    # Multiple jokers remain usable under the game's own set/run rules.
    ([card(6),{'id':'j1','r':0,'s':'J'},{'id':'j2','r':0,'s':'J'},{'id':'j3','r':0,'s':'J'},{'id':'j4','r':0,'s':'J'}],[card(1),card(9,'C')],[]),
])
def test_valid_required_melds_or_layoffs_remain_accepted_and_resolvable(hand,discard,melds):
    logic=engine();ctx=context();cur=logic.call('newMatch',ctx=ctx,seed=2);s=cur['state'];s.update(actor=0,hands=[hand,[card(13,'D')]],discard=discard,melds=melds,phase='draw')
    result=logic.call('applyMove',s,'p0',{'type':'draw_discard','index':0},ctx=ctx)
    assert result['state']['pending']['cardId']==discard[0]['id']
    move=logic.call('computerMove',result['state'],'p0',ctx=ctx)
    assert move['type'] in ('meld','layoff')
    after=logic.call('applyMove',result['state'],'p0',move,ctx=ctx)
    assert after['state']['pending'] is None


def test_required_search_matches_exhaustive_validator_for_seeded_small_hands():
    # Differential check against every legal subset, including the required card.
    probe=GameLogic(SOURCE+'''\ngame.randomMove=function(s,p,c){
      let exact=false;for(let mask=0;mask<(1<<s.cards.length);mask++){
        const cards=s.cards.filter((x,i)=>mask&(1<<i));
        if(cards.some(x=>x.id===s.required)&&isValidMeld(cards))exact=true;
      }return {exact,found:requiredMeld(s.cards,s.required)!==null};};''')
    logic=engine();ctx=context()
    for seed in range(1,21):
        s=logic.call('newMatch',ctx=ctx,seed=seed)['state'];hand=s['hands'][0][:9]
        for c in hand:
            result=probe.call('randomMove',{'cards':hand,'required':c['id']},'p0',ctx=ctx)
            assert result['exact']==result['found']

@pytest.mark.parametrize('n',range(2,8))
@pytest.mark.parametrize('seed',[1,29,73])
def test_complete_match_conservation_and_generators(n,seed):
    logic=engine();ctx=context(n);cur=logic.call('newMatch',ctx=ctx,seed=seed)
    for step in range(4000):
        if cur['turn'] is None:break
        before=inventory(cur['state']);assert len(before)==(108 if n>5 else 54);assert len(set(before))==len(before)
        actor=cur['turn'][0];method='computerMove' if step%2 else 'randomMove'
        move=logic.call(method,cur['state'],actor,ctx=ctx,seed=seed+step)
        after=logic.call('applyMove',cur['state'],actor,move,ctx=ctx,seed=seed+step)
        if after['state']['roundNum']==cur['state']['roundNum']:assert sorted(inventory(after['state']))==sorted(before)
        cur=after;ctx['move_count']+=1
    assert cur['turn'] is None
    assert sum(cur['payouts'].values())==ctx['pot']

def test_publication_gate():
    report=run_gate(SOURCE,rules=GameRules(allowed_player_counts=(2,3,4,5,6,7),allows_join_mid_match=False,allows_leave_mid_match=True),budget_seconds=5,run_seed=20261106,max_walks=30)
    assert report.passed,report.failures
