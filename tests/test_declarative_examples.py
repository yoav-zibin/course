"""Play declarative rules engines through their JSON-only presentation reducers."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import verify_examples
from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.tools.declarative_demo import KINDS
from game_platform.tools.publish_declarative_games import scene_event

EXAMPLES = Path(__file__).resolve().parents[1] / 'games' / 'declarative'
ARCHIVED_HTML_KINDS = ('mau_mau','dos','kisolo','thirty_one','gobblet','chutes_ladders',
                       'six_mens_morris')


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


@pytest.mark.parametrize('kind', ARCHIVED_HTML_KINDS)
def test_archived_html_ui_can_emit_every_documented_legal_move(kind):
    body=load(kind)
    logic=GameLogic(body.server_code,game_schemas=body.game_schemas())
    ui=DeclarativeLogic(body.declarative_ui)
    for case in body.unit_tests['cases']:
        if case.get('expected_error'):
            continue
        current={'state':case['state'],'turn':[case['player_id']]}
        message_data=message(logic,current,case['ctx'],case['player_id'])
        frame=ui.reduce(message_data)
        emitted=scene_event(ui,message_data,frame,case['move'])
        assert emitted.get('make_move')==case['move'], (kind,case['name'],case['move'])


def test_morris_capture_choices_are_selected_on_the_board():
    body = load('six_mens_morris')
    ui = DeclarativeLogic(body.declarative_ui)
    view = dict(body.unit_tests['cases'][0]['view_of_mover'])
    view['board'] = [0, -1, 0, 1, -1, 1] + [-1] * 10
    view['moves'] = [
        {'type':'place', 'from':-1, 'to':1, 'take':3},
        {'type':'place', 'from':-1, 'to':1, 'take':5},
    ]
    m = {'type':'state_changed', 'view':view, 'status':'ongoing',
         'acting_for_player_index':0, 'my_player_index':0, 'move_count':3}

    def tap(frame, ident):
        return ui.reduce({'type':'ui_event', 'event':{'type':'tap', 'id':ident},
                          'state_changed':m}, frame['local_state'])

    initial = ui.reduce(m)
    reserve = next(piece for piece in initial['scene']['pieces'] if piece['id'] == 'reserve')
    assert reserve['text'] == '6'
    assert any(target['id'] == 'reserve_place' for target in initial['scene']['targets'])
    selected = tap(initial, 'reserve_place')
    destination = next(target for target in selected['scene']['targets'] if target['id'] == 'destination_1')
    choosing = tap(selected, destination['id'])
    assert 'make_move' not in choosing
    captures = [target for target in choosing['scene']['targets'] if target['id'].startswith('intent_')]
    assert {target['position']['x'] for target in captures} == {310, 540}
    for move in view['moves']:
        assert scene_event(ui, m, initial, move)['make_move'] == move

    reset = ui.reduce({**m, 'move_count':4}, choosing['local_state'])
    assert reset['local_state']['selectedFrom'] is None
    assert reset['local_state']['selectedTo'] is None
    for waiting in ({'acting_for_player_index':None}, {'replay':{'index':0,'total':2}},
                    {'status':'over'}):
        scene = ui.reduce({**m, **waiting}, choosing['local_state'])['scene']
        assert not scene['targets'] and not scene['controls']
        assert all(not piece['actions'] for piece in scene['pieces'])


def test_chutes_ladders_links_and_shared_square_tokens_remain_visible():
    body = load('chutes_ladders')
    ui = DeclarativeLogic(body.declarative_ui)
    view = dict(body.unit_tests['cases'][0]['view_of_mover'])
    view.update(positions=[1, 1, 1, 1], pieces={'0':'👑','1':'🎩','2':'🚢','3':'🐶'})
    message = {'type':'state_changed', 'view':view, 'status':'ongoing',
               'acting_for_player_index':0, 'my_player_index':0, 'move_count':0}
    scene = ui.reduce(message)['scene']
    labels = {item['id']:item for item in scene['labels']}
    paths = {item['id']:item for item in scene['paths']}
    tokens = [item for item in scene['pieces'] if item['id'].startswith('token_')]
    assert labels['square_1']['text'] == '1' and labels['square_100']['text'] == '100'
    assert 'ladder_1_-1' in paths and 'rung_1_1' in paths and 'chute_16' in paths
    assert paths['chute_16']['points'][0] == {'x':282,'y':588}
    assert len({(piece['position']['x'],piece['position']['y']) for piece in tokens}) == 4
    assert all(not piece['id'].startswith('square_') for piece in scene['pieces'])


@pytest.mark.parametrize(('card','declaration'), [('R#', {'num':1}), ('WD', {'color':'R'})])
def test_dos_wild_card_added_to_center_has_a_valid_declaration(card, declaration):
    body = load('dos')
    case = body.unit_tests['cases'][0]
    state = case['state']
    state['phase'] = 'add_center'
    index = state['hands'][0].index(card)
    ctx = case['ctx']
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    view = rules.call('viewFor',state,case['player_id'],ctx=ctx,seed=17)
    ui = DeclarativeLogic(body.declarative_ui)
    m = {'type':'state_changed','view':view,'status':'ongoing',
         'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    move = {'type':'add_center','card':{'i':index,**declaration}}
    emitted = scene_event(ui,m,ui.reduce(m),move)['make_move']
    result = rules.call('applyMove',state,case['player_id'],emitted,ctx=ctx,seed=17)
    assert result['state']['center'][-1]['id'] == card


@pytest.mark.parametrize(('hand','center','move'), [
    (['R#','B#','WD'], [{'id':'Y5','num':5,'color':'Y'}],
     {'type':'match','placements':[{'pile':0,'cards':[{'i':0,'num':2},{'i':1,'num':3}]}],'bonus':[]}),
    (['R#','WD','B#'], [{'id':'R#','num':None,'color':'R'}],
     {'type':'match','placements':[{'pile':0,'cards':[{'i':0,'num':8}],'centerNum':8}],
      'bonus':[{'i':1,'color':'Y'}]}),
    (['WD','R5'], [{'id':'WD','num':2,'color':None}],
     {'type':'match','placements':[{'pile':0,'cards':[{'i':0,'color':'G'}],'centerColor':'B'}],'bonus':[]}),
])
def test_dos_ui_can_choose_noncanonical_wild_declarations(hand, center, move):
    body = load('dos')
    case = body.unit_tests['cases'][0]
    state = case['state']
    state['phase'], state['turn'], state['hands'][0], state['center'] = 'play', 0, hand, center
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    view = rules.call('viewFor',state,case['player_id'],ctx=case['ctx'],seed=17)
    ui = DeclarativeLogic(body.declarative_ui)
    message = {'type':'state_changed','view':view,'status':'ongoing',
               'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    emitted = scene_event(ui,message,ui.reduce(message),move)['make_move']
    rules.call('applyMove',state,case['player_id'],emitted,ctx=case['ctx'],seed=17)


def test_dos_add_center_can_declare_any_wild_number():
    body = load('dos')
    case = body.unit_tests['cases'][0]
    state = case['state']
    state['phase'] = 'add_center'
    index = state['hands'][0].index('R#')
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    view = rules.call('viewFor',state,case['player_id'],ctx=case['ctx'],seed=17)
    ui = DeclarativeLogic(body.declarative_ui)
    message = {'type':'state_changed','view':view,'status':'ongoing',
               'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    frame = ui.reduce(message)
    for event_id in [f'dos_hand_{index}'] + ['dos_cycle_num_0'] * 9 + ['intent_0']:
        frame = ui.reduce({'type':'ui_event','event':{'type':'tap','id':event_id},
                           'state_changed':message},frame['local_state'])
    assert frame['make_move'] == {'type':'add_center','card':{'i':index,'num':10}}
    result = rules.call('applyMove',state,case['player_id'],frame['make_move'],ctx=case['ctx'],seed=17)
    assert result['state']['center'][-1]['num'] == 10


def test_dos_centers_cards_and_offers_direct_card_targets():
    body = load('dos')
    ui = DeclarativeLogic(body.declarative_ui)
    view = body.unit_tests['cases'][0]['view_of_mover']
    message = {'type':'state_changed','view':view,'status':'ongoing',
               'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    scene = ui.reduce(message)['scene']
    center = [piece for piece in scene['pieces'] if piece['id'].startswith('center_')]
    assert [piece['position']['x'] for piece in center] == [280,360]
    assert len([target for target in scene['targets'] if target['id'].startswith('dos_hand_')]) == len(view['hand'])
    assert not [control for control in scene['controls'] if control['id'].startswith('dos_pick_')]


def test_thirty_one_direct_pile_and_card_actions_and_revealed_hands():
    body = load('thirty_one')
    ui = DeclarativeLogic(body.declarative_ui)
    view = dict(body.unit_tests['cases'][0]['view_of_mover'])
    m = {'type':'state_changed', 'view':view, 'status':'ongoing',
         'players':[{'name':'A'}, {'name':'B'}], 'acting_for_player_index':0,
         'my_player_index':0, 'move_count':0}
    initial = ui.reduce(m)
    assert {control['label'] for control in initial['scene']['controls']} == {'Knock'}
    for source in ('stock', 'discard'):
        assert scene_event(ui, m, initial, {'action':'draw', 'source':source})['make_move'] == {
            'action':'draw', 'source':source}

    discard = {**m, 'view':{**view, 'phase':'discard', 'hand':['AH','2C','KD','5S']}}
    frame = ui.reduce(discard)
    assert not frame['scene']['controls']
    for card in discard['view']['hand']:
        assert scene_event(ui, discard, frame, {'action':'discard','card':card})['make_move'] == {
            'action':'discard','card':card}
    assert {p['type'] for p in frame['scene']['pieces'] if p['id'].startswith('hand_')} == {
        'red_card','black_card'}

    final_turn = {**m, 'view':{**view, 'phase':'final_draw'}}
    frame = ui.reduce(final_turn)
    assert [control['label'] for control in frame['scene']['controls']] == ['Stand']
    assert scene_event(ui, final_turn, frame, {'action':'stand'})['make_move'] == {'action':'stand'}

    final = {**m, 'status':'over', 'acting_for_player_index':None, 'my_player_index':None,
             'view':{**view, 'phase':'over', 'hand':[], 'hands':[['AH','KH','QH'],['7D','7H','7C']],
                     'scores':[31,30.5], 'winner':0}}
    frame = ui.reduce(final)
    assert len([p for p in frame['scene']['pieces'] if p['id'].startswith('hand_')]) == 6
    assert any(label['text'] == 'Winner: A' for label in frame['scene']['labels'])
    assert {label['text'] for label in frame['scene']['labels']} >= {'A · 31', 'B · 30.5'}
    assert not frame['scene']['targets'] and not frame['scene']['controls']
    final_as_b = {**final, 'my_player_index':1, 'view':{**final['view'], 'scores':[30.5,31]}}
    labels = ui.reduce(final_as_b)['scene']['labels']
    assert {label['text'] for label in labels} >= {'A · 31', 'B · 30.5'}


def test_gobblet_reserves_and_covered_own_pieces_are_reachable():
    body = load('gobblet')
    ui = DeclarativeLogic(body.declarative_ui)
    view = body.unit_tests['cases'][1]['view_of_mover']
    m = {'type':'state_changed', 'view':view, 'status':'ongoing',
         'players':[{'name':'A'}, {'name':'B'}], 'acting_for_player_index':0,
         'my_player_index':0, 'move_count':2}
    initial = ui.reduce(m)
    assert not initial['scene']['controls']
    assert {t['id'] for t in initial['scene']['targets'] if t['id'].startswith('reserve_')} == {
        'reserve_1','reserve_2','reserve_3','reserve_4'}
    selected = ui.reduce({'type':'ui_event', 'event':{'type':'tap', 'id':'reserve_4'},
                          'state_changed':m}, initial['local_state'])
    assert not any(t['id'] == 'source_0' for t in selected['scene']['targets'])
    for move in ({'place':{'size':4,'cell':0}}, {'place':{'size':4,'cell':5}},
                 {'move':{'from':0,'to':5}}):
        assert scene_event(ui, m, initial, move)['make_move'] == move
    for waiting in ({'acting_for_player_index':None}, {'replay':{'index':0,'total':2}},
                    {'status':'over'}):
        frame = ui.reduce({**m, **waiting})
        assert not frame['scene']['targets'] and not frame['scene']['controls']


def test_kisolo_pit_targets_preserve_visible_seed_counts():
    body = load('kisolo')
    ui = DeclarativeLogic(body.declarative_ui)
    view = body.unit_tests['cases'][0]['view_of_mover']
    m = {'type':'state_changed', 'view':view, 'status':'ongoing',
         'acting_for_player_index':0, 'my_player_index':0, 'move_count':0}
    frame = ui.reduce(m)
    assert len([p for p in frame['scene']['pieces'] if p['id'].startswith('pit_')]) == 28
    assert len(frame['scene']['targets']) == len(view['legal_pits'])
    assert all(target.get('color') == '#00000000' and not target.get('label')
               for target in frame['scene']['targets'])
    for pit in view['legal_pits']:
        assert scene_event(ui, m, frame, {'pit':pit})['make_move'] == {'pit':pit}
    assert not ui.reduce({**m, 'acting_for_player_index':None})['scene']['targets']


def test_mau_mau_cards_jack_suits_and_restricted_turns():
    body = load('mau_mau')
    ui = DeclarativeLogic(body.declarative_ui)
    view = body.unit_tests['cases'][0]['view_of_mover']
    m = {'type':'state_changed', 'view':view, 'status':'ongoing',
         'acting_for_player_index':0, 'my_player_index':0, 'move_count':0}
    frame = ui.reduce(m)
    for move in ({'type':'play','card':'9H'}, {'type':'draw'},
                 *({'type':'play','card':'JC','suit':s} for s in 'SHDC')):
        assert scene_event(ui, m, frame, move)['make_move'] == move

    penalty_view = body.unit_tests['cases'][1]['view_of_mover']
    penalty = {**m, 'view':penalty_view}
    frame = ui.reduce(penalty)
    assert {t['aria_label'] for t in frame['scene']['targets']} == {
        'Play 7♥', 'Draw a card (37 left)'}
    assert scene_event(ui, penalty, frame, {'type':'play','card':'7H'})['make_move'] == {
        'type':'play','card':'7H'}

    drawn = {**m, 'view':{**view, 'drew':'9H', 'stock_count':0}}
    frame = ui.reduce(drawn)
    assert {t['aria_label'] for t in frame['scene']['targets']} == {'Play 9♥'}
    assert [c['label'] for c in frame['scene']['controls']] == ['Pass']
    empty_stock = {**m, 'view':{**view, 'stock_count':0}}
    frame = ui.reduce(empty_stock)
    assert scene_event(ui, empty_stock, frame, {'type':'draw'})['make_move'] == {'type':'draw'}

    large_hand = [f'{rank}S' for rank in ('2','3','4','5','6','7','8','9','10','Q','K','A')] + ['2H','3H','JC']
    long = {**m, 'view':{**view, 'hand':large_hand, 'legal_plays':['JC']}}
    frame = ui.reduce(long)
    assert [c['label'] for c in frame['scene']['controls']] == ['Next cards']
    assert scene_event(ui, long, frame, {'type':'play','card':'JC','suit':'D'})['make_move'] == {
        'type':'play','card':'JC','suit':'D'}
    assert not ui.reduce({**m, 'acting_for_player_index':None})['scene']['targets']


def test_morris_package_and_single_game_generator_are_consistent(tmp_path):
    prepare(load('six_mens_morris'))
    root = EXAMPLES.parents[1]
    (tmp_path / 'tools').mkdir()
    destination = tmp_path / 'games' / 'declarative'
    (destination / 'locales').mkdir(parents=True)
    shutil.copy(root / 'tools' / 'build_archive_html_declarative_conversions.mjs', tmp_path / 'tools')
    for name in (Path('archive_conversions_ui.js'), Path('six_mens_morris.json'), Path('thirty_one.json'),
                 Path('locales') / 'html_conversions.json', Path('locales') / 'archive_server_strings.json'):
        shutil.copy(EXAMPLES / name, destination / name)
    untouched = (destination / 'thirty_one.json').read_bytes()
    command = ['node', str(Path('tools') / 'build_archive_html_declarative_conversions.mjs'), 'six_mens_morris']
    subprocess.run(command, cwd=tmp_path, check=True, capture_output=True, timeout=30)
    generated = (destination / 'six_mens_morris.json').read_bytes()
    subprocess.run(command, cwd=tmp_path, check=True, capture_output=True, timeout=30)
    assert (destination / 'six_mens_morris.json').read_bytes() == generated
    assert (destination / 'thirty_one.json').read_bytes() == untouched


def test_demo_validation_subprocess_imports_the_local_checkout():
    import os
    import subprocess
    import sys

    from game_platform.tools.declarative_demo import _validation_import_path

    with _validation_import_path():
        result=subprocess.run([sys.executable,'-c','import game_platform.agent_import'],
                              capture_output=True,text=True,timeout=30,env=os.environ.copy())
    assert result.returncode==0, result.stderr
