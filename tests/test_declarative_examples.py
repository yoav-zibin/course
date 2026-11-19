"""Play declarative rules engines through their JSON-only presentation reducers."""
import json
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import verify_examples
from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.tools.declarative_demo import KINDS
from game_platform.tools.publish_declarative_games import scene_event

EXAMPLES = Path(__file__).resolve().parents[1] / 'games' / 'declarative'


def load(kind):
    return GameImport.model_validate(json.loads((EXAMPLES / (kind + '.json')).read_text()))


def message(logic, result, ctx, viewer):
    view=logic.call('viewFor',result['state'],viewer,ctx=ctx,seed=17)
    seat=next((i for i,p in enumerate(ctx['players']) if p['id']==viewer),None)
    return {'type':'state_changed','state':view,'view':view,'players':[
        {'player_index':i,'player_id':p['id'],'kind':p['kind'],'name':p['display_name']}
        for i,p in enumerate(ctx['players'])],
        'acting_for_player_index':seat if result['turn'] and viewer in result['turn'] else None,
        'my_player_index':seat,'turn_of_player_indices':None if result['turn'] is None else [ctx['players'].index(next(p for p in ctx['players']if p['id']==pid))for pid in result['turn']],
        'status':'over' if result['turn'] is None else 'ongoing','move_count':ctx['move_count'],'strings':{},'locale':'en','direction':'ltr'}


@pytest.mark.parametrize('kind', KINDS)
def test_games_play_to_completion_via_quickjs_ui_events(kind):
    body=load(kind)
    logic=GameLogic(body.server_code,game_schemas=body.game_schemas())
    ui=DeclarativeLogic(body.declarative_ui)
    count=min(body.allowed_player_counts)
    ctx={'players':[{'id':chr(97+i),'kind':'human','display_name':f'Player {i+1}','picture_url':'','max_loss':5,'active':True}
                    for i in range(count)],
         'pot':10,'move_count':0}
    result=logic.call('newMatch',ctx=ctx,seed=7)
    for step in range(1000):
        ctx['move_count']=step
        viewer=result['turn'][0]
        m=message(logic,result,ctx,viewer)
        frame=ui.reduce(m)
        assert 'make_move' not in frame
        public=message(logic,result,ctx,None)
        spectator=ui.reduce(public)
        assert not spectator['scene']['targets']
        assert not spectator['scene']['controls']
        if kind=='memory':
            assert all(value==-1 or i in m['view']['matched'] or i in m['view']['selected']
                       for i,value in enumerate(m['view']['board']))
        move=logic.call('computerMove',result['state'],viewer,ctx=ctx,seed=step+11)
        emitted=scene_event(ui,m,frame,move)
        assert emitted.get('make_move')==move, (kind,move,emitted)
        result=logic.call('applyMove',result['state'],viewer,emitted['make_move'],ctx=ctx,seed=step+11)
        if result['turn'] is None:
            assert sum(result['payouts'].values())==10
            final=ui.reduce(message(logic,result,{**ctx,'move_count':step+1},viewer))
            assert not final['scene']['targets']
            assert not final['scene']['controls']
            break
    else:
        pytest.fail(f'{kind} did not finish')


@pytest.mark.parametrize('kind', KINDS)
def test_documented_examples_match_real_rules_and_reject_malformed_moves(kind):
    body=load(kind)
    results=verify_examples(body.server_code,body.unit_tests)
    assert all(case['passed']for case in results), results
    logic=GameLogic(body.server_code,game_schemas=body.game_schemas())
    case=body.unit_tests['cases'][0]
    for bad in [None,False,[],{}, {'cell':-4}, {'cell':0,'extra':True}]:
        with pytest.raises(InvalidMoveError):
            logic.call('applyMove',case['state'],case['player_id'],bad,ctx=case['ctx'],seed=11)
