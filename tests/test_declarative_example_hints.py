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
        elif kind=='domineering'and piece['id']=='domino':
            assert piece['actions']==['move']
            assert set(piece['move_targets'])=={target['id']for target in scene['targets']}
        else:
            assert piece['actions']==[]


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
