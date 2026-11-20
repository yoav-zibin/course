import json
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import verify_examples
from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.tools.publish_declarative_games import play_trace, scene_event

PACKAGE = Path(__file__).resolve().parents[1] / 'games' / 'declarative' / 'scopa.json'


def load():
    return GameImport.model_validate(json.loads(PACKAGE.read_text(encoding='utf-8')))


def context(pot=0):
    return {'players':[{'id':f'p{i}','kind':'human','display_name':f'Player {i+1}',
                        'picture_url':'','max_loss':0,'active':True} for i in range(2)],
            'pot':pot,'move_count':0}


def test_equal_card_takes_priority_and_sum_choices_are_reachable():
    body = load()
    rules = GameLogic(body.server_code,game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    state = rules.call('newMatch',ctx=ctx,seed=1)['state']
    state.update(hands=[['5S'],[]],table=['5D','5H','2D','3D'],turn=0)
    view = rules.call('viewFor',state,'p0',ctx=ctx,seed=1)
    assert {tuple(move['capture']) for move in view['legal']} == {('5D',),('5H',)}
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove',state,'p0',{'card':'5S','capture':['2D','3D']},ctx=ctx,seed=1)
    state['table'] = ['2D','3D','1S','4S']
    view = rules.call('viewFor',state,'p0',ctx=ctx,seed=1)
    assert {tuple(move['capture']) for move in view['legal']} == {('2D','3D'),('1S','4S')}
    m = {'type':'state_changed','view':view,'status':'ongoing',
         'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    for move in view['legal']:
        assert scene_event(ui,m,ui.reduce(m),move)['make_move'] == move


def test_final_capture_is_not_a_sweep_and_scores_the_deal():
    body = load()
    rules = GameLogic(body.server_code,game_schemas=body.game_schemas())
    ctx = context(9)
    state = rules.call('newMatch',ctx=ctx,seed=2)['state']
    cards = [f'{rank}{suit}' for suit in 'SHDC' for rank in range(1,11)]
    state.update(deck=[],hands=[['10C'],[]],table=['10D'],
                 captured=[[card for card in cards if card not in ('10C','10D')],[]],
                 turn=0,last_capture=0,sweeps=[0,0])
    result = rules.call('applyMove',state,'p0',{'card':'10C','capture':['10D']},ctx=ctx,seed=2)
    assert result['turn'] is None
    assert result['state']['sweeps'] == [0,0]
    assert result['state']['scores'] == [4,0]
    assert result['payouts'] == {'p0':9,'p1':0}


def test_package_private_views_examples_and_random_deals():
    body = load()
    prepare(body)
    assert all(case['passed'] for case in verify_examples(body.server_code,body.unit_tests))
    rules = GameLogic(body.server_code,game_schemas=body.game_schemas())
    ctx = context()
    for seed in range(3):
        result = rules.call('newMatch',ctx=ctx,seed=seed)
        public = rules.call('viewFor',result['state'],None,ctx=ctx,seed=seed)
        assert public['hand'] == [] and public['legal'] == []
        assert 'hands' not in public and 'deck' not in public
        for step in range(36):
            ctx['move_count'] = step
            player = result['turn'][0]
            move = rules.call('randomMove',result['state'],player,ctx=ctx,seed=100*seed+step)
            result = rules.call('applyMove',result['state'],player,move,ctx=ctx,seed=100*seed+step)
            state = result['state']
            cards = state['deck'] + state['table'] + sum(state['hands'],[]) + sum(state['captured'],[])
            assert len(cards) == len(set(cards)) == 40
        assert result['turn'] is None


def test_complete_deal_through_offered_ui_actions():
    trace, observations = play_trace(load(), seed=42, mode='pass_and_play')
    assert len(trace['moves']) == len(observations) == 36
    assert trace['states'][-1]['over'] is True


def test_large_table_does_not_overlap_hand_or_hint():
    body = load()
    ui = DeclarativeLogic(body.declarative_ui)
    view = dict(body.unit_tests['cases'][0]['view_of_mover'])
    view.update(table=[f'{rank}{suit}' for suit in 'SHC' for rank in range(1, 8)],
                hand=['10D'], legal=[{'card':'10D','capture':['3S','7C']}])
    message = {'type':'state_changed','view':view,'status':'ongoing',
               'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    frame = ui.reduce(message)
    pieces = frame['scene']['pieces']
    table_bottom = max(p['position']['y'] for p in pieces if p['id'].startswith('table_')) + 48
    hand_top = next(p['position']['y'] for p in pieces if p['id'] == 'card_0') - 48
    hint = next(label for label in frame['scene']['labels'] if label['id'] == 'hint')
    assert table_bottom < hint['y'] < hand_top
    assert scene_event(ui, message, frame, view['legal'][0])['make_move'] == view['legal'][0]

    spectator = {**message, 'my_player_index':None, 'acting_for_player_index':None,
                 'view':{**view, 'hand':[], 'legal':[]}}
    assert not any(label['id'] == 'hint' for label in ui.reduce(spectator)['scene']['labels'])
    terminal = {**spectator, 'status':'over', 'view':{**spectator['view'], 'over':True}}
    result = next(label for label in ui.reduce(terminal)['scene']['labels'] if label['id'] == 'result')
    assert result['y'] < min(p['position']['y'] for p in pieces if p['id'].startswith('table_')) - 48
