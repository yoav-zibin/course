"""Regression evidence for the ten handoff editions, without publishing games."""
import json
from pathlib import Path
import pytest
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_logic import GameLogic
from game_platform.agent_import import GameImport,prepare
from game_platform.tools.publish_declarative_games import offered_events
ROOT=Path(__file__).resolve().parents[1]/'games/declarative/card-table'
KINDS=('six-card-golf','war','crazy-eights','hearts','michigan','quoridor','concentration','casino-war','old-maid','blackjack')
def package(kind):return json.loads((ROOT/(kind+'.json')).read_text())
def inputs(kind,index=0):
    p=package(kind);c=p['unit_tests']['cases'][index];seat=next(i for i,x in enumerate(c['ctx']['players']) if x['id']==c['player_id'])
    m={'type':'state_changed','view':c['view_of_mover'],'status':'ongoing','acting_for_player_index':seat,'my_player_index':seat,'move_count':c['ctx'].get('move_count',0),'players':[{'name':x.get('display_name','Player'),'kind':x['kind']} for x in c['ctx']['players']]}
    return p,DeclarativeLogic(p['declarative_ui']),m,c
def tap(ui,m,id,local=None):return ui.reduce({'type':'ui_event','event':{'type':'tap','id':id},'state_changed':m},local)
@pytest.mark.parametrize('kind',KINDS)
def test_complete_packages_validate_and_sources_stay_synchronized(kind):
    p=package(kind);prepare(GameImport.model_validate(p))
    assert p['declarative_ui']['ui_code']==(ROOT/(kind+'.ui.js')).read_text()
    for index in range(len(p['unit_tests']['cases'])):
        _,ui,m,_=inputs(kind,index);scene=ui.reduce(m)['scene']
        assert len({x['id'] for x in scene['pieces']})==len(scene['pieces'])
        for label in scene['labels']:
            assert 0<=label['x']<p['declarative_ui']['viewport']['width']
            assert 0<=label['y']<p['declarative_ui']['viewport']['height'],(kind,label)
@pytest.mark.parametrize('kind',KINDS)
def test_ordinary_legal_action_requires_one_tap_and_server_accepts_it(kind):
    p,ui,m,c=inputs(kind);first=ui.reduce(m);answers=[]
    for e in offered_events(first['scene']):
        answer=ui.reduce({'type':'ui_event','event':e,'state_changed':m},first.get('local_state'))
        if 'make_move' in answer:answers.append(answer['make_move'])
        elif kind=='six-card-golf':
            for other in offered_events(answer['scene']):
                if other!=e:
                    second=ui.reduce({'type':'ui_event','event':other,'state_changed':m},answer.get('local_state'))
                    if 'make_move' in second:answers.append(second['make_move']);break
        elif kind=='crazy-eights':
            for suit in range(4):
                second=tap(ui,m,'suit-'+str(suit),answer.get('local_state'))
                if 'make_move' in second:answers.append(second['make_move']);break
    assert answers,kind
    logic=GameLogic(p['server_code'],game_schemas={k:p['unit_tests'][k+'_schema'] for k in ('state','view','move')})
    result=logic.call('applyMove',c['state'],c['player_id'],answers[0],ctx=c['ctx'],seed=c['ctx']['seed'])
    assert result['state']!=c['state']
def test_golf_two_distinct_reveals_and_hidden_card_discard_are_direct():
    p,ui,m,c=inputs('six-card-golf');s=ui.reduce(m);ids=[x['id'] for x in s['scene']['pieces'] if x['actions']]
    first=tap(ui,m,ids[0]);assert 'make_move' not in first
    assert 'make_move' not in tap(ui,m,ids[0],first['local_state'])
    assert tap(ui,m,ids[1],first['local_state'])['make_move']['idxs']==[0,1]
    view=json.loads(json.dumps(m['view']));view['phase']='play';view['drew']={'uid':100,'r':4,'s':0,'from':'stock','hidden':False};m['view']=view
    seat=m['acting_for_player_index'];hand=view['hands'][seat];hand[0]['up']=False;hand[1].update(up=True,r=5,s=0)
    assert tap(ui,m,'card-'+str(hand[0]['uid']))['make_move']=={'kind':'discardFlip','idx':0}
    assert tap(ui,m,'card-'+str(hand[1]['uid']))['make_move']=={'kind':'replace','idx':1}
def test_crazy_eight_keeps_separate_suit_decision_and_clears_stale_choice():
    _,ui,m,_=inputs('crazy-eights');m['view'].update(hand=[7,12],playable=[7],top=3)
    first=tap(ui,m,'hand-7');assert 'make_move' not in first
    assert tap(ui,m,'suit-3',first['local_state'])['make_move']=={'card':7,'chosenSuit':3}
    m['move_count']+=1
    assert 'make_move' not in tap(ui,m,'suit-3',first['local_state'])
def test_casino_dealer_reveal_does_not_change_player_animation():
    _,ui,m,_=inputs('casino-war');m['view'].update(phase='dealer',round=1,playerCard={'rank':5,'suit':1},dealerCard=None)
    first=ui.reduce(m)['scene'];m['view'].update(phase='result',dealerCard={'rank':8,'suit':0});m['move_count']+=1
    second=ui.reduce(m)['scene']
    assert next(p for p in first['pieces'] if p['id']=='player-card')==next(p for p in second['pieces'] if p['id']=='player-card')
def test_concentration_only_selected_card_changes_face():
    _,ui,m,_=inputs('concentration');first=ui.reduce(m)['scene'];cell=next(p for p in first['pieces'] if p['actions'])['id'];idx=int(cell.split('_')[1]);m['view']['board'][idx]=3;m['move_count']+=1
    after=ui.reduce(m)['scene'];changed=[p['id'] for p,old in zip(after['pieces'],first['pieces']) if p['face']!=old['face'] or p['animation']!=old['animation']]
    assert changed==[cell]
def test_blackjack_preserves_existing_cards_and_hides_unaffordable_choices():
    _,ui,m,_=inputs('blackjack');v=m['view'];v.update(phase='play',chips=[0,100],curH=0,hands=[[{'cards':[{'r':8,'s':'S'},{'r':8,'s':'H'}],'bet':10}],[]])
    first=ui.reduce(m)['scene'];assert {c['id'] for c in first['controls']}=={'hit','stand'}
    v['hands'][0][0]['cards'].append({'r':2,'s':'D'});m['move_count']+=1
    after=ui.reduce(m)['scene'];assert [p['animation'] for p in first['pieces'] if p['id'].startswith('player-')]==[p['animation'] for p in after['pieces'] if p['id'].startswith('player-')][:2]
