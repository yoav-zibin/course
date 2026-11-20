"""Classic Nim rules, optimal strategy, and pile-selection interactions."""
import itertools
import json
from pathlib import Path
import pytest
from game_platform.agent_import import GameImport
from game_platform.game_contract import ContractLogic
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.tools.publish_declarative_games import play_trace, ui_message

ROOT=Path(__file__).resolve().parents[1]

def fixture():
    data=json.loads((ROOT/'games/declarative/nim_single_heap.json').read_text())
    data['game_addition_request_id_and_secret']='test-only-classic-nim-fixture'
    body=GameImport.model_validate(data)
    ctx={'players':[{'id':'u1','kind':'human','display_name':'Alice','picture_url':'','max_loss':0},
                    {'id':'u2','kind':'human','display_name':'Bob','picture_url':'','max_loss':0}],
         'pot':20,'move_count':0}
    return body,ContractLogic(body.server_code,body.unit_tests,game_schemas=body.game_schemas()),ctx

def test_initial_turn_cannot_take_all_piles():
    _,logic,ctx=fixture();initial=logic.call('newMatch',ctx=ctx,seed=1)
    assert initial['state']=={'piles':[3,5,7],'seat':0,'winner':None}
    for pile,n in enumerate([3,5,7]):
        for take in range(1,n+1):
            result=logic.call('applyMove',initial['state'],'u1',{'pile':pile,'take':take},ctx=ctx,seed=1)
            assert result['turn']==['u2'] and result['state']['winner'] is None
            assert sum(result['state']['piles'])==15-take
            assert all(result['state']['piles'][i]==initial['state']['piles'][i] for i in range(3) if i!=pile)

@pytest.mark.parametrize('move',[{'pile':-1,'take':1},{'pile':3,'take':1},{'pile':0,'take':4},
                                {'pile':0,'take':0},{'pile':0,'take':1.5},
                                {'pile':0,'take':1,'other_pile':1},{'take':15},None])
def test_rejects_illegal_or_multiple_pile_moves(move):
    _,logic,ctx=fixture()
    with pytest.raises(Exception):
        logic.call('applyMove',{'piles':[3,5,7],'seat':0,'winner':None},'u1',move,ctx=ctx,seed=1)

def test_optimal_computer_move_for_all_reachable_pile_sizes():
    _,logic,ctx=fixture()
    for piles in itertools.product(range(4),range(6),range(8)):
        if not any(piles):continue
        state={'piles':list(piles),'seat':0,'winner':None}
        move=logic.call('computerMove',state,'u1',ctx=ctx,seed=1)
        assert 0<=move['pile']<3 and 1<=move['take']<=piles[move['pile']]
        if piles[0]^piles[1]^piles[2]:
            after=list(piles);after[move['pile']]-=move['take']
            assert after[0]^after[1]^after[2]==0

def test_last_stone_and_terminal_guard():
    _,logic,ctx=fixture();state={'piles':[0,0,1],'seat':0,'winner':None}
    result=logic.call('applyMove',state,'u1',{'pile':2,'take':1},ctx=ctx,seed=1)
    assert result['turn'] is None and result['state']['winner']==0
    assert result['payouts']=={'u1':20}
    with pytest.raises(Exception):logic.call('applyMove',result['state'],'u1',{'pile':0,'take':1},ctx=ctx,seed=1)

def test_selects_one_pile_then_sends_quantity_and_finishes_game():
    body,logic,ctx=fixture();initial=logic.call('newMatch',ctx=ctx,seed=1)
    message=ui_message(logic,initial,ctx,0,1);ui=DeclarativeLogic(body.declarative_ui)
    frame=ui.reduce(message,None)
    selected=ui.reduce({'type':'ui_event','event':{'type':'tap','id':'pile_1'},'state_changed':message},frame['local_state'])
    assert selected.get('make_move') is None
    answer=ui.reduce({'type':'ui_event','event':{'type':'tap','id':'take_5'},'state_changed':message},selected['local_state'])
    assert answer['make_move']=={'pile':1,'take':5}
    blocked=ui.reduce({'type':'ui_event','event':{'type':'tap','id':'take_7'},'state_changed':message},selected['local_state'])
    assert blocked.get('make_move') is None
    trace,_=play_trace(body,seed=903,mode='pass_and_play',num_players=2)
    assert trace['states'][-1]['winner'] is not None
    assert trace['states'][-1]['piles']==[0,0,0]


def test_wrong_player_cannot_move():
    _,logic,ctx=fixture()
    with pytest.raises(Exception):
        logic.call('applyMove',{'piles':[3,5,7],'seat':0,'winner':None},'u2',{'pile':0,'take':1},ctx=ctx,seed=1)


def test_heap_artwork_matches_hitbox_and_labels_stay_inside_rows():
    body,logic,ctx=fixture()
    spec=body.declarative_ui
    assert spec['viewport']['height']==550
    for kind in ('heap','heap_selected'):
        piece_type=spec['piece_types'][kind]
        asset=spec['assets'][piece_type['asset']]
        assert asset['width']==piece_type['width']==432
        assert asset['height']==piece_type['height']==72
    message=ui_message(logic,logic.call('newMatch',ctx=ctx,seed=1),ctx,0,1)
    ui=DeclarativeLogic(spec);frame=ui.reduce(message,None)
    assert len([p for p in frame['scene']['pieces'] if p['id'].startswith('player_')])==0
    labels={label['id']:label for label in frame['scene']['labels']}
    for i in range(3):
        row=next(p for p in frame['scene']['targets'] if p['id']==f'pile_{i}')
        x,y=row['position']['x'],row['position']['y']
        for label_id in (f'pile_label_{i}',f'pile_count_{i}'):
            label=labels[label_id]
            assert x-216+12<=label['x']<x-116
            assert y-36<=label['y']<=label['y']+label['font_size']<=y+36
    selected=ui.reduce({'type':'ui_event','event':{'type':'tap','id':'pile_2'},'state_changed':message},frame['local_state'])
    buttons=[p for p in selected['scene']['targets'] if p['id'].startswith('take_')]
    assert len(buttons)==7
    for p in buttons:
        assert 24<=p['position']['x']-48<p['position']['x']+48<=456
        assert p['position']['y']+24<=550
