"""Backgammon turn-wide dice rules, exercised through the production QuickJS runner."""
import datetime as dt
from pathlib import Path
import pytest
from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.game_logic import InvalidMoveError

ROOT = Path(__file__).parents[1] / 'games/audit-batch3'
NOW = dt.datetime(2026, 11, 5, tzinfo=dt.timezone.utc)

@pytest.fixture(params=['backgammon', 'backgammon-copy'])
def game(request):
    logic = GameLogic((ROOT / (request.param + '.server.js')).read_text())
    ctx = {'players':[{'id':f'p{i}','kind':'human','max_loss':10} for i in range(2)], 'pot':20, 'move_count':0}
    def call(fn, *args, seed=903):
        return logic.call(fn, *args, ctx=ctx, seed=seed, now=NOW)
    return call, ctx

def board(call, own, enemy, dice, bar=0):
    s = call('newMatch')['state']
    s.update(owner=[-1]*24,cnt=[0]*24,bar=[bar,0],off=[15-sum(own.values())-bar,15-sum(enemy.values())],cur=0,dice=dice,moves=dice,needRoll=False)
    for p, pieces in enumerate([own,enemy]):
        for i,n in pieces.items():s['owner'][i]=p;s['cnt'][i]=n
    return s

def test_only_higher_die_when_both_cannot_be_used(game):
    call,_=game
    s=board(call,{}, {21:2,19:13},[1,2],bar=1)
    assert call('viewFor',s,'p0')['legalMoves']==[{'from':'bar','to':22,'die':2,'idx':1}]
    with pytest.raises(InvalidMoveError):call('applyMove',s,'p0',{'action':'move','from':'bar','to':23})
    for fn in ['randomMove','computerMove']:
        m=call(fn,s,'p0');assert m=={'action':'move','from':'bar','to':22}
        assert call('applyMove',s,'p0',m)['state']['cur']==1

def test_two_dice_must_be_used_before_bearing_off(game):
    call,_=game
    # Taking checker 2 off with die 2 strands die 1 behind the block at point 3.
    s=board(call,{1:1,3:1},{2:2,20:13},[1,2])
    legal=call('viewFor',s,'p0')['legalMoves']
    assert {'from':1,'to':'off','die':2,'idx':1} not in legal
    assert {'from':1,'to':0,'die':1,'idx':0} in legal
    with pytest.raises(InvalidMoveError):call('applyMove',s,'p0',{'action':'move','from':1,'to':'off'})
    r=call('applyMove',s,'p0',{'action':'move','from':1,'to':0})
    assert r['state']['cur']==0
    assert call('viewFor',r['state'],'p0')['legalMoves']

def test_doubles_and_ambiguous_bear_off_use_maximum_number(game):
    call,_=game
    s=board(call,{0:1,1:1},{20:15},[1,2])
    r=call('applyMove',s,'p0',{'action':'move','from':0,'to':'off'})
    assert r['state']['moves']==[2]
    r=call('applyMove',r['state'],'p0',{'action':'move','from':1,'to':'off'})
    assert r['state']['winner']==0 and r['payouts']=={'p0':20,'p1':0}
    s=board(call,{5:1},{20:15},[1,1,1,1])
    for a,b in [(5,4),(4,3),(3,2),(2,1)]:
        s=call('applyMove',s,'p0',{'action':'move','from':a,'to':b})['state']
    assert s['cur']==1 and s['needRoll']

@pytest.mark.parametrize('bad',[None,[],{},True,'1',1.5,-1,24])
@pytest.mark.parametrize('coordinate',['from','to'])
def test_malformed_coordinates_are_rejected(game,bad,coordinate):
    call,_=game;s=board(call,{1:1},{20:15},[1])
    move={'action':'move','from':1,'to':0};move[coordinate]=bad
    with pytest.raises(InvalidMoveError):call('applyMove',s,'p0',move)

@pytest.mark.parametrize('seed',[7,31,903])
def test_complete_matches_views_generators_and_determinism(game,seed):
    call,ctx=game;r=call('newMatch',seed=seed)
    for n in range(320):
        s=r['state']
        if r['turn'] is None:
            assert sum(r['payouts'].values())==20
            return
        pid=r['turn'][0];ctx['move_count']=n
        view=call('viewFor',s,pid,seed=seed+n)
        assert view==call('viewFor',s,None,seed=seed+n)
        fn='computerMove' if n%2 else 'randomMove'
        move=call(fn,s,pid,seed=seed+n)
        assert move==call(fn,s,pid,seed=seed+n)
        if move['action']=='move':assert any(m['from']==move['from'] and m['to']==move['to'] for m in view['legalMoves'])
        r=call('applyMove',s,pid,move,seed=seed+n)
        for p in range(2):assert r['state']['off'][p]+r['state']['bar'][p]+sum(c for o,c in zip(r['state']['owner'],r['state']['cnt']) if o==p)==15
    pytest.fail('match did not terminate')

def test_natural_bearing_off_finish_without_move_cap(game):
    call,ctx=game
    s=board(call,{0:5,1:5,2:5},{21:5,22:5,23:5},[])
    s['needRoll']=True
    for n in range(120):
        ctx['move_count']=n;pid=f"p{s['cur']}"
        m=call('computerMove',s,pid,seed=n+18)
        r=call('applyMove',s,pid,m,seed=n+18);s=r['state']
        if r['turn'] is None:
            assert s['off'][s['winner']]==15
            assert n<120
            return
    pytest.fail('bearing-off race did not finish')

def test_higher_die_rule_is_symmetric_for_black(game):
    call,_=game
    s=board(call,{}, {21:2,19:13},[1,2],bar=1)
    s.update(owner=[1-o if o>=0 else -1 for o in reversed(s['owner'])],cnt=list(reversed(s['cnt'])),bar=[0,1],off=[0,14],cur=1)
    assert call('viewFor',s,'p1')['legalMoves']==[{'from':'bar','to':1,'die':2,'idx':1}]
    with pytest.raises(InvalidMoveError):call('applyMove',s,'p1',{'action':'move','from':'bar','to':0})
    assert call('applyMove',s,'p1',{'action':'move','from':'bar','to':1})['state']['cur']==0
