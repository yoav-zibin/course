"""Play declarative rules engines through their JSON-only presentation reducers."""
import copy
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
    reserve_target = next(target for target in initial['scene']['targets'] if target['id'] == 'reserve_place')
    assert reserve_target['hit_area']['width'] >= 86
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


@pytest.mark.parametrize(('kind','winner','draw','expected'), [
    ('mau_mau',1,False,'Winner: Bob'),
    ('dos',-1,False,'Draw'),
    ('kisolo',-1,False,'Draw'),
    ('gobblet',0,False,'Winner: Alice'),
    ('gobblet',None,True,'Draw'),
    ('six_mens_morris',1,False,'Winner: Bob'),
    ('six_mens_morris',-1,False,'Draw'),
    ('chutes_ladders',0,False,'Winner: Alice'),
    ('thirty_one',-1,False,'Draw'),
    ('thirty_one',1,False,'Winner: Bob'),
    ('ataxx',0,False,'Winner: Alice'),
    ('connect6',-1,False,'Draw'),
])
def test_game_results_announce_the_winner_or_draw(kind, winner, draw, expected):
    body = load(kind)
    view = dict(body.unit_tests['cases'][0]['view_of_mover'])
    view.update(winner=winner, draw=draw, over=True, phase='over')
    m = {'type':'state_changed', 'view':view, 'status':'over',
         'players':[{'name':'Alice'},{'name':'Bob'}], 'my_player_index':0,
         'acting_for_player_index':None, 'move_count':2}
    labels = DeclarativeLogic(body.declarative_ui).reduce(m)['scene']['labels']
    assert expected in [label['text'] for label in labels]


def test_dos_cards_include_distinct_non_color_marks_and_names():
    import base64
    body = load('dos')
    assets = body.declarative_ui['assets']
    designs = [base64.b64decode(assets['dos_'+color]['uri'].split(',',1)[1]).decode()
               for color in 'RBGY']
    assert all(mark in design for mark, design in zip(
        ['<circle cx="13"', '<rect x="9"', 'M13 8L18 13', 'M13 8L18 17'], designs))
    view = dict(body.unit_tests['cases'][0]['view_of_mover'])
    view.update(hand=['R5','B5','G5','Y5'], phase='play', legal_placements=[])
    m = {'type':'state_changed','view':view,'status':'ongoing',
         'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    scene = DeclarativeLogic(body.declarative_ui).reduce(m)['scene']
    labels = [target.get('aria_label','') for target in scene['targets']]
    assert all('Play '+color+' 5' in labels for color in ['Red','Blue','Green','Yellow'])
    assert {piece['aria_label'] for piece in scene['pieces'] if piece['id'].startswith('hand_')} == {
        'Red 5','Blue 5','Green 5','Yellow 5'}


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


def test_chutes_reports_the_last_spin_and_movement():
    body = load('chutes_ladders')
    view = dict(body.unit_tests['cases'][0]['view_of_mover'])
    view.update(phase='play',lastSpin=4,lastFrom=7,lastTo=38,lastEvent='ladder')
    message = {'type':'state_changed','view':view,'status':'ongoing',
               'acting_for_player_index':0,'my_player_index':0,'move_count':3}
    labels = DeclarativeLogic(body.declarative_ui).reduce(message)['scene']['labels']
    assert next(item['text'] for item in labels if item['id']=='last-spin') == 'Last spin: 4 · 7 → 38'


@pytest.mark.parametrize(('card','declaration'), [('R#', {'num':1}), ('WD', {'color':'R'})])
def test_dos_wild_card_added_to_center_has_a_valid_declaration(card, declaration):
    body = load('dos')
    case = body.unit_tests['cases'][0]
    # Reserve explicit cards for this branch instead of relying on a random deal.
    cards = (case['state']['deck'] + case['state']['discard'] +
             sum(case['state']['hands'], []) + [entry['id'] for entry in case['state']['center']])
    for reserved in (card, 'B5', 'G7', 'Y4', 'B4'):
        cards.remove(reserved)
    state = {**case['state'], 'deck':cards, 'discard':[],
             'hands':[[card, 'B5'], ['G7']], 'turn':0, 'phase':'add_center', 'drawn_card':card,
             'center':[{'id':'Y4', 'num':4, 'color':'Y'}, {'id':'B4', 'num':4, 'color':'B'}]}
    index = 0
    ctx = case['ctx']
    player = ctx['players'][0]['id']
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    view = rules.call('viewFor',state,player,ctx=ctx,seed=17)
    assert view['hand'] == [card, 'B5']
    assert rules.call('viewFor',state,None,ctx=ctx,seed=17)['hand'] == []
    ui = DeclarativeLogic(body.declarative_ui)
    m = {'type':'state_changed','view':view,'status':'ongoing',
         'acting_for_player_index':0,'my_player_index':0,'move_count':0}
    move = {'type':'add_center','card':{'i':index,**declaration}}
    emitted = scene_event(ui,m,ui.reduce(m),move)['make_move']
    result = rules.call('applyMove',state,player,emitted,ctx=ctx,seed=17)
    assert result['state']['center'][-1] == {
        'id':card, 'num':declaration.get('num', 2), 'color':declaration.get('color', 'R')}
    assert result['state']['hands'] == [['B5'], ['G7']]


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
    assert not initial['scene']['controls']
    assert any(piece['id'] == 'knock_button' and piece['text'] == 'Knock'
               for piece in initial['scene']['pieces'])
    assert scene_event(ui, m, initial, {'action':'knock'})['make_move'] == {'action':'knock'}
    for source in ('stock', 'discard'):
        assert scene_event(ui, m, initial, {'action':'draw', 'source':source})['make_move'] == {
            'action':'draw', 'source':source}

    discard = {**m, 'view':{**view, 'phase':'discard', 'hand':['AH','2C','KD','5S']}}
    frame = ui.reduce(discard)
    assert not frame['scene']['controls']
    for card in discard['view']['hand']:
        assert scene_event(ui, discard, frame, {'action':'discard','card':card})['make_move'] == {
            'action':'discard','card':card}
    assert {p['type'] for p in frame['scene']['pieces'] if p['id'] in
            {f'card_{card}' for card in discard['view']['hand']}} == {
        'red_card','black_card'}

    final_turn = {**m, 'view':{**view, 'phase':'final_draw'}}
    frame = ui.reduce(final_turn)
    assert any(piece['id'] == 'knock_button' and piece['text'] == 'Stand'
               for piece in frame['scene']['pieces'])
    assert scene_event(ui, final_turn, frame, {'action':'stand'})['make_move'] == {'action':'stand'}

    final = {**m, 'status':'over', 'acting_for_player_index':None, 'my_player_index':None,
             'view':{**view, 'phase':'over', 'hand':[], 'hands':[['AH','KH','QH'],['7D','7H','7C']],
                     'scores':[31,30.5], 'winner':0}}
    frame = ui.reduce(final)
    assert len([p for p in frame['scene']['pieces'] if p['id'].startswith('card_')]) == 6
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
    assert all('text' not in piece for piece in initial['scene']['pieces']
               if piece['id'].startswith(('reserve_art_', 'stack_')))
    assert all(body.declarative_ui['piece_types'][f'goblet_{size}_{owner}']['shape'] == 'image'
               for size in range(1, 5) for owner in range(2))
    assert {t['id'] for t in initial['scene']['targets'] if t['id'].startswith('reserve_')} == {
        'reserve_1','reserve_2','reserve_3','reserve_4'}
    selected = ui.reduce({'type':'ui_event', 'event':{'type':'tap', 'id':'reserve_4'},
                          'state_changed':m}, initial['local_state'])
    assert not any(t['id'] == 'source_0' for t in selected['scene']['targets'])
    assert all(t['color'] == '#fff0d833' for t in selected['scene']['targets']
               if t['id'].startswith('intent_'))
    source = ui.reduce({'type':'ui_event', 'event':{'type':'tap', 'id':'source_0'},
                        'state_changed':m}, initial['local_state'])
    selected_piece = next(piece for piece in source['scene']['pieces'] if piece['id'] == 'stack_0_0')
    assert selected_piece['scale'] == 1.1
    assert selected_piece['aria_label'] == 'A · size 2'
    for move in ({'place':{'size':4,'cell':0}}, {'place':{'size':4,'cell':5}},
                 {'move':{'from':0,'to':5}}):
        assert scene_event(ui, m, initial, move)['make_move'] == move
    for waiting in ({'acting_for_player_index':None}, {'replay':{'index':0,'total':2}},
                    {'status':'over'}):
        frame = ui.reduce({**m, **waiting})
        assert not frame['scene']['targets'] and not frame['scene']['controls']


def test_kisolo_package_fits_the_authoring_limit():
    prepare(load('kisolo'))


def test_kisolo_pit_targets_preserve_visible_seed_counts():
    body = load('kisolo')
    ui = DeclarativeLogic(body.declarative_ui)
    view = body.unit_tests['cases'][0]['view_of_mover']
    m = {'type':'state_changed', 'view':view, 'status':'ongoing',
         'acting_for_player_index':0, 'my_player_index':0, 'move_count':0}
    frame = ui.reduce(m)
    assert len([p for p in frame['scene']['pieces'] if p['id'].startswith('pit_')]) == 28
    assert all('text' not in p for p in frame['scene']['pieces'] if p['id'].startswith('pit_'))
    for r, row in enumerate(view['rows']):
        for c, count in enumerate(row):
            assert next(p for p in frame['scene']['pieces'] if p['id'] == f'pit_{r*7+c}')['type'] == f'pit_{count}'
    assert len(frame['scene']['targets']) == len(view['legal_pits'])
    assert all(target.get('color') == '#00000000' and not target.get('label')
               for target in frame['scene']['targets'])
    for pit in view['legal_pits']:
        assert scene_event(ui, m, frame, {'pit':pit})['make_move'] == {'pit':pit}
    assert not ui.reduce({**m, 'acting_for_player_index':None})['scene']['targets']

    crowded = [row[:] for row in view['rows']]
    crowded[0][0] = 8
    crowded_frame = ui.reduce({**m, 'view':{**view, 'rows':crowded}})
    assert next(p for p in crowded_frame['scene']['pieces'] if p['id'] == 'pit_0')['text'] == '8'


@pytest.mark.parametrize('kind', ['gobblet', 'six_mens_morris', 'ataxx'])
def test_board_piece_identity_follows_an_unambiguous_move(kind):
    body = load(kind)
    ui = DeclarativeLogic(body.declarative_ui)
    view = copy.deepcopy(body.unit_tests['cases'][0]['view_of_mover'])
    if kind == 'gobblet':
        view['board'] = [[[2,0]]] + [[] for _ in range(15)]
        next_board = [[] for _ in range(16)]
        next_board[5] = [[2,0]]
    elif kind == 'six_mens_morris':
        view['board'] = [0] + [-1] * 15
        next_board = [-1] * 16
        next_board[5] = 0
    else:
        view['board'] = [0] + [-1] * 48
        next_board = [-1] * 49
        next_board[16] = 0
    message = {'type':'state_changed','view':view,'status':'ongoing',
               'acting_for_player_index':None,'my_player_index':0,'move_count':1}
    before = ui.reduce(message)
    after = ui.reduce({**message,'move_count':2,'view':{**view,'board':next_board}},
                      before['local_state'])
    piece_type = {'gobblet':'goblet_2_0','six_mens_morris':'stone_0','ataxx':'p0'}[kind]
    first = next(p for p in before['scene']['pieces'] if p['type'] == piece_type)
    second = next(p for p in after['scene']['pieces'] if p['type'] == piece_type)
    assert first['id'] == second['id']
    assert first['position'] != second['position']
    backwards = ui.reduce(message, after['local_state'])
    assert next(p for p in backwards['scene']['pieces'] if p['type'] == piece_type)['id'] == first['id']
    other_viewer = ui.reduce({**message,'my_player_index':1,'move_count':2,
                              'view':{**view,'board':next_board}}, before['local_state'])
    assert next(p for p in other_viewer['scene']['pieces'] if p['type'] == piece_type)['id'] != first['id']


@pytest.mark.parametrize('kind', ['gobblet', 'six_mens_morris', 'ataxx'])
def test_ambiguous_board_changes_do_not_invent_piece_paths(kind):
    body = load(kind)
    ui = DeclarativeLogic(body.declarative_ui)
    view = copy.deepcopy(body.unit_tests['cases'][0]['view_of_mover'])
    if kind == 'gobblet':
        board = [[[2,0]], [[2,0]]] + [[] for _ in range(14)]
        next_board = [[] for _ in range(16)]
        next_board[5] = next_board[6] = [[2,0]]
        piece_type = 'goblet_2_0'
    else:
        size = 16 if kind == 'six_mens_morris' else 49
        board = [0, 0] + [-1] * (size - 2)
        next_board = [-1] * size
        next_board[5] = next_board[6] = 0
        piece_type = 'stone_0' if kind == 'six_mens_morris' else 'p0'
    message = {'type':'state_changed','view':{**view,'board':board},'status':'ongoing',
               'acting_for_player_index':None,'my_player_index':0,'move_count':1}
    before = ui.reduce(message)
    after = ui.reduce({**message,'move_count':2,'view':{**view,'board':next_board}},
                      before['local_state'])
    before_ids = {p['id'] for p in before['scene']['pieces']
                  if p['type'] == piece_type and (kind != 'gobblet' or p['id'].startswith('stack_'))}
    after_ids = {p['id'] for p in after['scene']['pieces']
                 if p['type'] == piece_type and (kind != 'gobblet' or p['id'].startswith('stack_'))}
    assert len(before_ids) == len(after_ids) == 2
    assert before_ids.isdisjoint(after_ids)


def test_mau_mau_cards_jack_suits_and_restricted_turns():
    body = load('mau_mau')
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = body.unit_tests['cases'][0]['ctx']
    player = ctx['players'][0]['id']

    def position(hand, top='AH', **updates):
        deck = [rank + suit for suit in 'SHDC'
                for rank in ('2','3','4','5','6','7','8','9','10','J','Q','K','A')
                if rank + suit not in hand and rank + suit != top]
        return {'hands':[hand, deck[:7]], 'stock':deck[7:], 'discard':[top],
                'top_suit':top[-1], 'to_move':0, 'pending_draw':0, 'drew':None,
                'winner':None, 'phase':'play', 'reshuffles':0, **updates}

    state = position(['9H','JC','2S','3D','4C','5S','6D'])
    view = rules.call('viewFor',state,player,ctx=ctx,seed=17)
    assert rules.call('viewFor',state,None,ctx=ctx,seed=17)['hand'] == []
    m = {'type':'state_changed', 'view':view, 'status':'ongoing',
         'acting_for_player_index':0, 'my_player_index':0, 'move_count':0}
    frame = ui.reduce(m)
    for move in ({'type':'play','card':'9H'}, {'type':'draw'},
                 *({'type':'play','card':'JC','suit':s} for s in 'SHDC')):
        emitted = scene_event(ui, m, frame, move)['make_move']
        assert emitted == move
        rules.call('applyMove',state,player,emitted,ctx=ctx,seed=17)

    penalty_state = position(['7H','JC','2S','3D','4C','5S','6D'], '7D', pending_draw=2)
    penalty_view = rules.call('viewFor',penalty_state,player,ctx=ctx,seed=17)
    penalty = {**m, 'view':penalty_view}
    frame = ui.reduce(penalty)
    assert {t['aria_label'] for t in frame['scene']['targets']} == {
        'Play 7♥', 'Draw a card (37 left)'}
    assert scene_event(ui, penalty, frame, {'type':'play','card':'7H'})['make_move'] == {
        'type':'play','card':'7H'}
    rules.call('applyMove',penalty_state,player,{'type':'play','card':'7H'},ctx=ctx,seed=17)

    before_draw = position(['JC','2S','3D','4C','5S','6D'])
    before_draw['discard'] = [card for card in before_draw['stock'] if card != '9H'] + ['AH']
    before_draw['stock'] = ['9H']
    drawn_state = rules.call('applyMove',before_draw,player,{'type':'draw'},ctx=ctx,seed=17)['state']
    drawn = {**m, 'view':rules.call('viewFor',drawn_state,player,ctx=ctx,seed=17)}
    frame = ui.reduce(drawn)
    assert {t['aria_label'] for t in frame['scene']['targets']} == {'Play 9♥'}
    assert [c['label'] for c in frame['scene']['controls']] == ['Pass']
    empty_state = copy.deepcopy(state)
    empty_state['discard'] = empty_state['stock'] + empty_state['discard']
    empty_state['stock'] = []
    empty_stock = {**m, 'view':rules.call('viewFor',empty_state,player,ctx=ctx,seed=17)}
    frame = ui.reduce(empty_stock)
    assert scene_event(ui, empty_stock, frame, {'type':'draw'})['make_move'] == {'type':'draw'}
    rules.call('applyMove',empty_state,player,{'type':'draw'},ctx=ctx,seed=17)

    large_hand = [f'{rank}S' for rank in ('2','3','4','5','6','7','8','9','10','Q','K','A')] + ['2H','3H','JC']
    long_state = position(large_hand)
    long = {**m, 'view':rules.call('viewFor',long_state,player,ctx=ctx,seed=17)}
    frame = ui.reduce(long)
    assert [c['label'] for c in frame['scene']['controls']] == ['Next cards']
    assert scene_event(ui, long, frame, {'type':'play','card':'JC','suit':'D'})['make_move'] == {
        'type':'play','card':'JC','suit':'D'}
    rules.call('applyMove',long_state,player,{'type':'play','card':'JC','suit':'D'},ctx=ctx,seed=17)
    assert not ui.reduce({**m, 'acting_for_player_index':None})['scene']['targets']


def test_morris_package_and_single_game_generator_are_consistent(tmp_path):
    prepare(load('six_mens_morris'))
    root = EXAMPLES.parents[1]
    (tmp_path / 'tools').mkdir()
    destination = tmp_path / 'games' / 'declarative'
    (destination / 'locales').mkdir(parents=True)
    shutil.copy(EXAMPLES.parent / 'alternative-names.json', destination.parent)
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
