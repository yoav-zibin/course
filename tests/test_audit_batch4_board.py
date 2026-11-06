"""Published board assets: quiet draw accounting and complete QuickJS matches."""
import datetime as dt
from pathlib import Path
import pytest
from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.game_logic import InvalidMoveError

ROOT=Path(__file__).parents[1]/'games/audit-batch4'
NOW=dt.datetime(2026,11,6,tzinfo=dt.timezone.utc)

def runner(name):
    logic=GameLogic((ROOT/(name+'.server.js')).read_text())
    ctx={'players':[{'id':f'p{i}','kind':'human','max_loss':10} for i in range(2)],'pot':20,'move_count':0}
    def call(fn,*args,seed=2026):return logic.call(fn,*args,ctx=ctx,seed=seed,now=NOW)
    return call,ctx

def position(call,pieces,noCap=79):
    s=call('newMatch')['state'];s['board']=[[None]*8 for _ in range(8)];s['noCap']=noCap
    for r,c,p,k in pieces:s['board'][r][c]={'c':p,'k':k}
    return s

def move(a,b):return {'from':dict(zip(['r','c'],a)),'to':dict(zip(['r','c'],b))}

def test_reachable_seed86_does_not_prematurely_draw_at_action145():
    call,ctx=runner('checkers');r=call('newMatch',seed=86)
    for n in range(145):
        assert r['turn'] is not None
        ctx['move_count']=n;s=r['state'];pid=r['turn'][0]
        m=call('randomMove',s,pid,seed=860000+n)
        r=call('applyMove',s,pid,m,seed=860000+n)
    assert not r['state']['draw'] and r['state']['noCap']==64
    assert r['turn'] is not None

@pytest.mark.parametrize('to,pieces',[((4,1),[(5,0,0,False),(0,7,1,True)]),((0,1),[(1,0,0,False),(7,6,1,True)])])
def test_man_advance_including_promotion_resets_quiet_count(to,pieces):
    call,_=runner('checkers');s=position(call,pieces)
    r=call('applyMove',s,'p0',move(pieces[0][:2],to))
    assert r['state']['noCap']==0 and not r['state']['draw']

def test_capture_resets_count_and_keeps_chain():
    call,_=runner('checkers')
    s=position(call,[(5,0,0,True),(4,1,1,False),(2,3,1,False),(0,7,1,True)])
    r=call('applyMove',s,'p0',move((5,0),(3,2)))
    assert r['state']['noCap']==0 and r['state']['chain']=={'r':3,'c':2}
    assert r['turn']==['p0']

def test_immobilization_win_precedes_quiet_draw_threshold():
    call,_=runner('checkers')
    s=position(call,[(7,0,0,True),(5,2,0,False),(6,3,0,True),(6,1,1,False)])
    r=call('applyMove',s,'p0',move((6,3),(7,2)))
    assert r['state']['winner']==0 and not r['state']['draw']
    assert r['turn'] is None and r['payouts']=={'p0':20,'p1':0}

def test_eighty_genuinely_quiet_king_moves_still_draw():
    call,_=runner('checkers');s=position(call,[(7,0,0,True),(0,7,1,True)])
    r=call('applyMove',s,'p0',move((7,0),(6,1)))
    assert r['state']['noCap']==80 and r['state']['draw']
    assert r['turn'] is None and r['payouts']=={'p0':10,'p1':10}

@pytest.mark.parametrize('name',['checkers','mancala'])
@pytest.mark.parametrize('seed',[7,31,86,2026])
def test_complete_games_material_views_and_determinism(name,seed):
    call,ctx=runner(name);r=call('newMatch',seed=seed)
    for n in range(1000):
        if r['turn'] is None:
            assert sum(r['payouts'].values())==20
            return
        ctx['move_count']=n;s=r['state'];pid=r['turn'][0]
        assert call('viewFor',s,'p0')==call('viewFor',s,'p1')==call('viewFor',s,None)
        fn='randomMove' if seed%2==0 else 'computerMove'
        m=call(fn,s,pid,seed=seed*10000+n)
        assert m==call(fn,s,pid,seed=seed*10000+n)
        nr=call('applyMove',s,pid,m,seed=seed*10000+n)
        assert nr==call('applyMove',s,pid,m,seed=seed*10000+n)
        ns=nr['state']
        if name=='mancala':assert sum(ns['pits'])+sum(ns['stores'])==48
        else:
            before=sum(p is not None for row in s['board'] for p in row)
            after=sum(p is not None for row in ns['board'] for p in row)
            assert before-after in (0,1)
            assert all((rr+cc)%2==1 for rr,row in enumerate(ns['board']) for cc,p in enumerate(row) if p)
        r=nr
    pytest.fail('match failed to terminate')

def test_mancala_extra_turn_capture_and_terminal_sweep():
    call,_=runner('mancala');s=call('newMatch')['state']
    assert call('applyMove',s,'p0',{'pit':2})['turn']==['p0']
    s.update(pits=[1,0,0,0,0,1,0,5,0,0,0,1],stores=[20,20])
    assert call('applyMove',s,'p0',{'pit':0})['state']['captured']==6
    s.update(pits=[0,0,0,0,0,1,1,2,3,0,0,0],stores=[20,21])
    r=call('applyMove',s,'p0',{'pit':5})
    assert r['turn'] is None and r['state']['stores']==[21,27]
    assert not any(r['state']['pits'])
