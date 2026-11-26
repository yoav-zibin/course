"""Presentation checks for Jiayi's ten polished catalog games."""
import json
from pathlib import Path
import pytest
from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import ContractLogic
from game_platform.tools.publish_declarative_games import offered_events, ui_message
ROOT=Path(__file__).resolve().parents[1]
KINDS=('nim_single_heap','conquian','big_two','catch_the_ten','court_piece','sergeant_major','pedro','mille_bornes','snap','slapjack')

@pytest.mark.parametrize('kind',KINDS)
def test_polished_scene_bounds_and_inactive_guards(kind):
    package=json.loads((ROOT/'games/declarative'/f'{kind}.json').read_text())
    package['game_addition_request_id_and_secret']='test-only-polished-fixture'
    body=GameImport.model_validate(package)
    players=[{'id':f'authoring-seat-{i}','kind':'human','display_name':f'Player {i+1}',
              'picture_url':'','max_loss':0} for i in range(min(body.allowed_player_counts))]
    ctx={'players':players,'pot':0,'move_count':0}
    logic=ContractLogic(body.server_code,body.unit_tests,game_schemas=body.game_schemas())
    result=logic.call('newMatch',ctx=ctx,seed=903)
    seat=next(i for i,p in enumerate(players) if p['id']==result['turn'][0])
    message=ui_message(logic,result,ctx,seat,903)
    ui=DeclarativeLogic(body.declarative_ui)
    frame=ui.reduce(message,None)
    assert any(p['id']=='polish_background' for p in frame['scene']['pieces'])
    for piece in frame['scene']['pieces']:
        size=body.declarative_ui['piece_types'][piece['type']]
        x,y=piece['position']['x'],piece['position']['y']
        assert 0 <= x-size['width']/2 <= x+size['width']/2 <= 480
        assert 0 <= y-size['height']/2 <= y+size['height']/2 <= 700
    for extra in ({'acting_for_player_index':None,'turn_of_player_indices':[]},
                  {'replay':{'index':0,'total':1}}, {'status':'over'}):
        inactive=ui.reduce({**message,**extra},frame['local_state'])
        assert not inactive['scene']['controls']
        assert not any(p.get('actions') for p in inactive['scene']['pieces'])


def test_sergeant_major_opening_only_offers_trump_selection():
    package = json.loads((ROOT / 'games/declarative/sergeant_major.json').read_text())
    contract = package['unit_tests']
    example = contract['cases'][0]
    ctx = {key: value for key, value in example['ctx'].items() if key != 'seed'}
    seed = example['ctx']['seed']
    logic = ContractLogic(package['server_code'], contract)
    ui = DeclarativeLogic(package['declarative_ui'])
    result = logic.call('newMatch', ctx=ctx, seed=seed)
    mover = result['turn'][0]
    seat = next(i for i, player in enumerate(ctx['players']) if player['id'] == mover)
    message = ui_message(logic, result, ctx, seat, seed)
    frame = ui.reduce(message, None)

    assert len(message['view']['hand']) == 16
    assert message['view']['legal'] == []
    moves = [ui.reduce({'type': 'ui_event', 'event': event, 'state_changed': message},
                       frame['local_state']).get('make_move')
             for event in offered_events(frame['scene'])]
    assert [move for move in moves if move is not None] == [{'trump': suit} for suit in range(4)]
