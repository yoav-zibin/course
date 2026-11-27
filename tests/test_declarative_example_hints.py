"""Example affordances describe actual legal next actions, not piece styling."""
import json
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.tools.declarative_demo import KINDS

EXAMPLES=Path(__file__).resolve().parents[1]/'games'/'declarative'


def inputs(kind):
    body=GameImport.model_validate(json.loads((EXAMPLES/(kind+'.json')).read_text()))
    case=body.unit_tests['cases'][0]
    view=case['view_of_mover']
    message={'type':'state_changed','state':view,'view':view,'status':'ongoing',
             'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    return DeclarativeLogic(body.declarative_ui),message


@pytest.mark.parametrize('kind', KINDS)
def test_examples_declare_only_real_piece_actions(kind):
    logic,message=inputs(kind)
    scene=logic.reduce(message)['scene']
    for piece in scene['pieces']:
        assert 'actions' in piece
        # No example rule asks the player to rotate or resize a placed piece.
        assert not {'rotate','scale'}.intersection(piece['actions'])
        if kind=='memory':
            cell=int(piece['id'].split('_')[1])
            assert piece['actions']==(['tap']if {'cell':cell}in message['view']['legal']else [])
        elif kind=='mancala':
            pit=int(piece['id'].split('_')[1])
            assert piece['actions']==(['tap']if {'pit':pit}in message['view']['legal']else [])
        elif kind=='ataxx':
            assert piece['actions']==[]
        elif kind in ('chinese_checkers','abalone'):
            cell=int(piece['position']['cell'])
            can_move=any(cell in (move['from'] if isinstance(move['from'],list) else [move['from']])
                         for move in message['view']['legal'])
            assert piece['actions']==(['tap'] if can_move else [])
        elif kind=='domineering'and piece['id']=='domino':
            assert piece['actions']==['move']
            assert set(piece['move_targets'])=={target['id']for target in scene['targets']}
        elif kind=='chess' and piece['type'] in ('white_piece', 'black_piece'):
            cell = int(piece['position']['cell'])
            targets = {f"chess-drop-{move['tr'] * 8 + move['tc']}"
                       for move in message['view']['legalMoves']
                       if cell == move['fr'] * 8 + move['fc']}
            assert piece['actions'] == (['move'] if targets else [])
            assert set(piece.get('move_targets', [])) == targets
        elif kind in ('crazy_eights','mau_mau','hearts','spades','guess_who') and piece['id'].startswith('intent_'):
            assert piece['actions']==['tap']
        else:
            assert piece['actions']==[]
    if kind=='ataxx':
        assert {target['id'] for target in scene['targets']} == {
            f"select_{move['from']}" for move in message['view']['legal']}


@pytest.mark.parametrize('kind', KINDS)
@pytest.mark.parametrize('mode', ['spectator','replay','over'])
def test_examples_remove_action_hints_outside_live_turn(kind,mode):
    logic,message=inputs(kind)
    if mode=='spectator':message.update(acting_for_player_index=None,my_player_index=None)
    if mode=='replay':message['replay']={'index':0,'total':2}
    if mode=='over':message['status']='over'
    scene=logic.reduce(message)['scene']
    assert not scene['targets']
    assert not scene['controls']
    assert all(piece['actions']==[]for piece in scene['pieces'])


@pytest.mark.parametrize('kind', ['memory','mancala'])
def test_examples_do_not_treat_rotation_or_scaling_as_a_move(kind):
    logic,message=inputs(kind)
    piece=next(piece for piece in logic.reduce(message)['scene']['pieces']if piece['actions'])
    for event in [{'type':'rotate','id':piece['id'],'delta':90},
                  {'type':'scale','id':piece['id'],'factor':1.1}]:
        response=logic.reduce({'type':'ui_event','event':event,'state_changed':message})
        assert 'make_move'not in response


def selected_ids(frame):
    return {piece['id']for piece in frame['scene']['pieces']if piece.get('selected')}


def select_marble(logic,message,frame,cell):
    ident=f'piece_{cell}'
    piece=next(piece for piece in frame['scene']['pieces']if piece['id']==ident)
    assert piece['actions']==['tap']
    answer=logic.reduce({'type':'ui_event','event':{'type':'tap','id':ident},
                         'state_changed':message},frame.get('local_state'))
    assert 'make_move'not in answer
    return answer


def assert_hex_target_moves(logic,message,frame,cells):
    expected=[move for move in message['view']['legal']
              if set(move.get('from',[])if isinstance(move.get('from',[]),list)
                     else [move['from']])==set(cells)]
    emitted=[]
    for target in frame['scene']['targets']:
        answer=logic.reduce({'type':'ui_event','event':{'type':'tap','id':target['id']},
                             'state_changed':message},frame['local_state'])
        assert 'make_move'in answer
        emitted.append(answer['make_move'])
    encode=lambda moves:sorted(json.dumps(move,sort_keys=True)for move in moves)
    assert encode(emitted)==encode(expected)


def test_chinese_checkers_selecting_another_marble_clears_the_previous_selection():
    logic,message=inputs('chinese_checkers')
    frame=logic.reduce(message)
    cells=sorted({move['from']for move in message['view']['legal']})
    assert len(cells)>=2
    first=select_marble(logic,message,frame,cells[0])
    assert selected_ids(first)=={f'piece_{cells[0]}'}
    second=select_marble(logic,message,first,cells[1])
    assert selected_ids(second)=={f'piece_{cells[1]}'}
    assert_hex_target_moves(logic,message,second,[cells[1]])


def test_abalone_group_can_be_deselected_and_selected_again_before_a_move():
    logic,message=inputs('abalone')
    original=json.dumps(message,sort_keys=True)
    frame=logic.reduce(message)
    cells=next(move['from']for move in message['view']['legal']if len(move['from'])==2)
    for cell in cells:
        frame=select_marble(logic,message,frame,cell)
    assert selected_ids(frame)=={f'piece_{cell}'for cell in cells}
    assert_hex_target_moves(logic,message,frame,cells)
    frame=select_marble(logic,message,frame,cells[-1])
    assert selected_ids(frame)=={f'piece_{cells[0]}'}
    assert_hex_target_moves(logic,message,frame,cells[:1])
    frame=select_marble(logic,message,frame,cells[0])
    assert not selected_ids(frame)
    assert not frame['scene']['targets']
    for cell in cells:
        frame=select_marble(logic,message,frame,cell)
    assert selected_ids(frame)=={f'piece_{cell}'for cell in cells}
    assert_hex_target_moves(logic,message,frame,cells)
    assert json.dumps(message,sort_keys=True)==original
