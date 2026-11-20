import json
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import verify_examples
from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.tools.publish_declarative_games import scene_event

PACKAGE = Path(__file__).resolve().parents[1] / 'games' / 'declarative' / 'whist.json'


def load():
    return GameImport.model_validate(json.loads(PACKAGE.read_text(encoding='utf-8')))


def context(pot=0):
    return {'players':[{'id':f'p{i}', 'kind':'human', 'display_name':f'Player {i+1}',
                        'picture_url':'', 'max_loss':0, 'active':True} for i in range(4)],
            'pot':pot,'move_count':0}


def test_whist_deal_private_views_and_direct_actions():
    body = load()
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    state = logic.call('newMatch', ctx=ctx, seed=7)['state']
    assert [len(hand) for hand in state['hands']] == [13] * 4
    assert len({card for hand in state['hands'] for card in hand}) == 52
    assert state['hands'][3][-1].endswith(state['trump'])
    view = logic.call('viewFor',state,'p0',ctx=ctx,seed=1)
    public = logic.call('viewFor',state,None,ctx=ctx,seed=1)
    assert public['hand'] == [] and public['legal'] == []
    assert 'hands' not in view and 'hands' not in public
    message = {'type':'state_changed','view':view,'status':'ongoing',
               'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    frame = ui.reduce(message)
    for card in view['legal']:
        assert scene_event(ui,message,frame,{'card':card})['make_move'] == {'card':card}
    assert not ui.reduce({**message,'acting_for_player_index':None})['scene']['targets']


def test_whist_centers_each_hand_row():
    body = load()
    ui = DeclarativeLogic(body.declarative_ui)
    view = dict(body.unit_tests['cases'][0]['view_of_mover'])
    view['hand'] = view['hand'][:9]
    view['legal'] = view['hand']
    message = {'type':'state_changed','view':view,'status':'ongoing',
               'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    pieces = [piece for piece in ui.reduce(message)['scene']['pieces']
              if piece['id'].startswith('hand_')]
    for y in (395, 500):
        x = [piece['position']['x'] for piece in pieces if piece['position']['y'] == y]
        assert (min(x) + max(x)) / 2 == 320


def test_whist_follows_suit_and_trump_wins_with_team_payouts():
    body = load()
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = context(9)
    state = logic.call('newMatch',ctx=ctx,seed=1)['state']
    state.update(hands=[[],[],[],['4H','14S']],trump='S',
                 trick=[{'seat':0,'card':'14H'},{'seat':1,'card':'3S'},
                        {'seat':2,'card':'2S'}],turn=3)
    with pytest.raises(InvalidMoveError):
        logic.call('applyMove',state,'p3',{'card':'14S'},ctx=ctx,seed=2)
    state['hands'][3] = ['4H']
    state['tricks'] = [6,6]
    result = logic.call('applyMove',state,'p3',{'card':'4H'},ctx=ctx,seed=2)
    assert result['turn'] is None and result['state']['winner'] == 1
    assert result['state']['tricks'] == [6,7]
    assert result['payouts'] == {'p0':0,'p1':5,'p2':0,'p3':4}
    ctx['players'][3]['active'] = False
    result = logic.call('applyMove',state,'p3',{'card':'4H'},ctx=ctx,seed=2)
    assert result['payouts'] == {'p0':0,'p1':9,'p2':0}


def test_whist_package_examples_and_random_games():
    body = load()
    prepare(body)
    assert all(case['passed'] for case in verify_examples(body.server_code,body.unit_tests))
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = context()
    for seed in range(3):
        result = logic.call('newMatch',ctx=ctx,seed=seed)
        for step in range(52):
            ctx['move_count'] = step
            player = result['turn'][0]
            move = logic.call('randomMove',result['state'],player,ctx=ctx,seed=seed*100+step)
            result = logic.call('applyMove',result['state'],player,move,ctx=ctx,seed=seed*100+step)
        assert result['turn'] is None
        assert sum(result['state']['tricks']) == 13
