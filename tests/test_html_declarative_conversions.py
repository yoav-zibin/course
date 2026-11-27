"""Portable conversions retain every legal choice, translated copy and rule boundary."""
import copy
import base64
import json
from pathlib import Path
import re
import shutil
import subprocess

import pytest

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.game_testing import test_server_code as run_random_walks
from game_platform.models import GameRules
from game_platform.tests.test_declarative_example_hints import inputs
from game_platform.tools.publish_declarative_games import offered_events

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'games/declarative'
KINDS = ('battleship', 'checkers', 'chess', 'four_player_chess', 'quoridor',
         'crazy_eights', 'go_fish', 'hearts', 'spades', 'guess_who')


def package(kind):
    return json.loads((DIRECTORY / (kind + '.json')).read_text())


@pytest.mark.parametrize('kind', ['chess', 'checkers'])
def test_chess_and_checkers_preserve_the_piece_id_across_a_move(kind):
    body = GameImport.model_validate(package(kind))
    example = body.unit_tests['cases'][0]
    ui = DeclarativeLogic(body.declarative_ui)
    def message(view, move_count):
        return {'type':'state_changed','state':view,'view':view,'status':'ongoing',
                'my_player_index':0,'acting_for_player_index':None,'move_count':move_count,
                'strings':body.declarative_ui['strings']}
    first = ui.reduce(message(example['view_of_mover'], 0))
    move = example['move']
    if kind == 'chess':
        source, destination = move['fr'] * 8 + move['fc'], move['tr'] * 8 + move['tc']
    else:
        source = move['from']['r'] * 8 + move['from']['c']
        destination = move['to']['r'] * 8 + move['to']['c']
    before_piece = next(piece for piece in first['scene']['pieces']
                        if piece['position'].get('cell') == str(source))
    next_frame = ui.reduce(message(example['expected_view_of_mover'], 1), first['local_state'])
    after_piece = next(piece for piece in next_frame['scene']['pieces']
                       if piece['position'].get('cell') == str(destination))
    assert after_piece['id'] == before_piece['id']
    if kind == 'chess':
        assert first['last_move_animations'] == []
        assert after_piece['asset'] == before_piece['asset']
        assert after_piece['asset'] in body.declarative_ui['assets']
        assert body.declarative_ui['piece_types'][after_piece['type']]['width'] == 58
        assert next_frame['last_move_animations'][0]['path'] == [
            {'board': 'main', 'position': {'cell': str(source)}},
            {'board': 'main', 'position': {'cell': str(destination)}},
        ]


def test_chess_castling_animates_both_pieces_to_their_final_squares():
    body = GameImport.model_validate(package('chess'))
    ui = DeclarativeLogic(body.declarative_ui)
    view = copy.deepcopy(body.unit_tests['cases'][0]['view_of_mover'])
    view['bd'] = [0] * 64
    view['bd'][62] = 6
    view['bd'][61] = 4
    view['lastMove'] = {'fr': 7, 'fc': 4, 'tr': 7, 'tc': 6}
    frame = ui.reduce({'type': 'state_changed', 'view': view, 'state': view, 'move_count': 1,
                       'status': 'ongoing', 'my_player_index': 1, 'acting_for_player_index': None})
    assert [[stop['position']['cell'] for stop in entry['path']]
            for entry in frame['last_move_animations']] == [['60', '62'], ['63', '61']]


def test_hex_placement_pulse_is_stable_across_same_move_renders():
    body = GameImport.model_validate(package('hex'))
    example = body.unit_tests['cases'][0]
    ui = DeclarativeLogic(body.declarative_ui)
    def message(view, move_count):
        return {'type':'state_changed','state':view,'view':view,'status':'ongoing',
                'my_player_index':0,'acting_for_player_index':None,'move_count':move_count,
                'strings':body.declarative_ui['strings']}
    first = ui.reduce(message(example['view_of_mover'], 0))
    after_message = message(example['expected_view_of_mover'], 1)
    placed = ui.reduce(after_message, first['local_state'])
    piece = next(piece for piece in placed['scene']['pieces']
                 if piece['position'].get('cell') == str(example['move']['cell']))
    assert piece['animation']['kind'] == 'pulse'
    piece_id = piece['id']
    refreshed = ui.reduce({'type':'ui_event','event':{'type':'tap','id':'cell'},
                           'state_changed':after_message}, placed['local_state'])
    refreshed_piece = next(piece for piece in refreshed['scene']['pieces']
                           if piece['id'] == piece_id)
    assert refreshed_piece['animation']['key'] == piece['animation']['key']


@pytest.mark.parametrize('kind', ['checkers', 'four_player_chess'])
def test_source_selection_keeps_every_legal_move_reachable_without_overlapping_targets(kind):
    ui, message = inputs(kind)
    first = ui.reduce(message)
    reached = set()
    for selection in first['scene']['targets']:
        selected = ui.reduce({'type': 'ui_event', 'event': {'type': 'tap', 'id': selection['id']},
                              'state_changed': message}, first['local_state'])
        spots = [(target['board'], json.dumps(target['position'], sort_keys=True))
                 for target in selected['scene']['targets']]
        assert len(spots) == len(set(spots)), (kind, spots)
        for event in offered_events(selected['scene']):
            answer = ui.reduce({'type': 'ui_event', 'event': event, 'state_changed': message},
                               selected['local_state'])
            if 'make_move' in answer:
                reached.add(json.dumps(answer['make_move'], sort_keys=True))
        # A prior player's selection is never restored for a new revision.
        next_message = {**message, 'move_count': message['move_count'] + 1}
        assert ui.reduce(next_message, selected['local_state'])['local_state']['selectedFrom'] is None
    view = message['view']
    legal = [{'from': move['from'], 'to': move['to']} for move in view['moves']] if kind == 'checkers' else [
        {'kind': 'move', 'fr': move['fr'], 'fc': move['fc'], 'tr': move['tr'], 'tc': move['tc']}
        for move in view['legalMoves']]
    assert set(map(lambda move: json.dumps(move, sort_keys=True), legal)) <= reached


@pytest.mark.parametrize('promotion', [False, True])
def test_chess_drops_offer_legal_moves_and_require_a_promotion_choice(promotion):
    ui, message = inputs('chess')
    if promotion:
        view = copy.deepcopy(message['view'])
        view['bd'] = [0] * 64
        view['bd'][8] = 1
        view['bd'][1] = -4
        view['legalMoves'] = [{'fr': 1, 'fc': 0, 'tr': 0, 'tc': column, 'promo': kind}
                              for column in (0, 1) for kind in ('Q', 'R', 'B', 'N')]
        message = {**message, 'view': view, 'state': view}

    def act(event, frame):
        return ui.reduce({'type': 'ui_event', 'event': event, 'state_changed': message}, frame['local_state'])

    first = ui.reduce(message)
    assert not first['scene']['controls']
    targets = first['scene']['targets']
    assert len(targets) == len({target['position']['cell'] for target in targets})
    reached = []
    for event in offered_events(first['scene']):
        if event['type'] != 'drop':
            assert 'make_move' not in act(event, first)
            continue
        result = act(event, first)
        if promotion:
            assert 'make_move' not in result
            assert len(result['scene']['controls']) == 4
            for control in result['scene']['controls']:
                reached.append(act({'type': 'tap', 'id': control['id']}, result)['make_move'])
        else:
            reached.append(result['make_move'])
    assert sorted(json.dumps(move, sort_keys=True) for move in reached) == sorted(
        json.dumps(move, sort_keys=True) for move in message['view']['legalMoves'])
    assert not ui.reduce({**message, 'replay': True})['scene']['targets']


@pytest.mark.parametrize('kind', ['battleship', 'crazy_eights', 'hearts', 'spades', 'guess_who'])
def test_only_declared_taps_can_commit_offered_moves(kind):
    ui, message = inputs(kind)
    frame = ui.reduce(message)
    event = next(event for event in offered_events(frame['scene']) if event['id'].startswith('intent_'))
    for extra in ({'type': 'rotate', 'delta': 90}, {'type': 'scale', 'factor': 1.1},
                  {'type': 'change', 'value': 'ignored'},
                  {'type': 'drop', 'piece_id': event['id'], 'target_id': event['id']}):
        answer = ui.reduce({'type': 'ui_event', 'event': {**event, **extra},
                            'state_changed': message}, frame['local_state'])
        assert 'make_move' not in answer


def test_spades_preserves_its_free_suit_variant_in_rules_and_offered_cards():
    body = GameImport.model_validate(package('spades'))
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    case = body.unit_tests['cases'][0]
    state = copy.deepcopy(case['state'])
    state.update(trick=[{'seat': 0, 'card': '3H'}], current=1, leader=0, pendingWin=None)
    state['hands'][1] = ['2H', '2S']
    player = case['ctx']['players'][1]['id']
    result = logic.call('applyMove', state, player, {'card': '2S'}, ctx=case['ctx'], seed=11)
    assert result['state']['hands'][1] == ['2H']
    view = logic.call('viewFor', state, player, ctx=case['ctx'], seed=11)
    ui = DeclarativeLogic(body.declarative_ui)
    message = {'type':'state_changed', 'view':view, 'state':view, 'status':'ongoing',
               'my_player_index':1, 'acting_for_player_index':1, 'move_count':1}
    frame = ui.reduce(message)
    offered = [ui.reduce({'type':'ui_event','event':event,'state_changed':message},
                         frame['local_state']).get('make_move')
               for event in offered_events(frame['scene'])]
    assert {'card':'2H'} in offered and {'card':'2S'} in offered


def test_spades_rules_pass_seeded_schema_and_token_conservation_walks():
    body = GameImport.model_validate(package('spades'))
    report = run_random_walks(body.server_code, game_schemas=body.game_schemas(),
                              rules=GameRules(allowed_player_counts=(4,), allows_leave_mid_match=False,
                                              allows_join_mid_match=False),
                              run_seed=27, max_walks=8, budget_seconds=20, max_moves_per_walk=1000,
                              contract=body.unit_tests)
    assert report.passed, report.failures
    assert report.walks_completed == 8


def test_quoridor_wall_hints_on_a_crowded_board_preserve_both_routes():
    body = GameImport.model_validate(package('quoridor'))
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = body.unit_tests['cases'][0]['ctx']
    first, second = [player['id'] for player in ctx['players']]
    state = logic.call('newMatch', ctx=ctx)['state']
    # The horizontal barrier leaves just column 8 open across rows 7 and 8.
    state['walls'] = [
        {'r': r, 'c': c, 'o': 'H'} for r in [1, 3, 5, 7] for c in [0, 2, 4, 6]
    ]
    state['wallsLeft'] = [2, 2]
    blocks_only_route = {'r': 7, 'c': 7, 'o': 'V'}
    crosses_wall = {'r': 7, 'c': 6, 'o': 'V'}
    overlaps_wall = {'r': 7, 'c': 5, 'o': 'H'}
    keeps_routes = {'r': 0, 'c': 0, 'o': 'V'}

    view = logic.call('viewFor', state, first, ctx=ctx, seed=73)
    assert logic.call('viewFor', state, first, ctx=ctx, seed=73) == view
    assert keeps_routes in view['legalWalls']
    for wall in [blocks_only_route, crosses_wall, overlaps_wall]:
        assert wall not in view['legalWalls']
        with pytest.raises(InvalidMoveError, match='illegal wall'):
            logic.call('applyMove', state, first, {'type': 'wall', **wall}, ctx=ctx)
    assert logic.call('applyMove', state, first, {'type': 'wall', **keeps_routes}, ctx=ctx)['turn'] == [second]
    for viewer in [second, None]:
        assert logic.call('viewFor', state, viewer, ctx=ctx)['legalWalls'] == []


def test_quoridor_leaving_records_a_terminal_settlement_and_keeps_it_on_later_leaves():
    body = GameImport.model_validate(package('quoridor'))
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = {'players':[{'id':name,'kind':'human','active':True,'max_loss':10}
                      for name in ('alice','bob')], 'pot':17, 'move_count':0}
    opened = logic.call('newMatch', ctx=ctx, seed=5)
    first = logic.call('playerLeft', opened['state'], 'alice', ctx=ctx, seed=6,
                       time_limit_seconds=2)
    assert first['turn'] is None and sum(first['payouts'].values()) == 17
    ctx['players'][0]['active'] = False
    second = logic.call('playerLeft', first['state'], 'bob', ctx=ctx, seed=7,
                        time_limit_seconds=2)
    assert second['state'] == first['state'] and second['turn'] is None
    assert second['payouts'] == {'bob':17}


def test_guess_who_features_are_visible_and_accessible_without_revealing_secret_choices():
    body = package('guess_who')
    assets = body['declarative_ui']['assets']
    assert len(assets) == 24
    cleo = base64.b64decode(assets['person_2']['uri'].split(',',1)[1]).decode()
    ava = base64.b64decode(assets['person_0']['uri'].split(',',1)[1]).decode()
    assert 'stroke="#172033"' in cleo and 'stroke="#172033"' not in ava
    ui, message = inputs('guess_who')
    pieces = ui.reduce(message)['scene']['pieces']
    assert 'Are they wearing glasses? Yes' in pieces[2]['aria_label']
    assert 'Are they wearing glasses? No' in pieces[0]['aria_label']
    assert all(piece['actions'] == ['tap'] for piece in pieces)


@pytest.mark.parametrize('kind', KINDS)
def test_converted_rules_and_every_ui_string_are_translated_with_matching_parameters(kind):
    body = package(kind)
    prepare(GameImport.model_validate(body))
    assert {case['kind'] for case in body['unit_tests']['cases']} == {'initial', 'intermediate', 'terminal'}
    english = body['declarative_ui']['strings']
    for locale in ('es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar'):
        translation = body['translations'][locale]
        assert translation['game_logic_rules'] != body['rules']
        assert translation['game_ui_rules'] != body['ui_instructions']
        assert set(translation['client_strings']) == set(english)
        for key, source in english.items():
            translated = translation['client_strings'][key]
            assert translated and (translated != source or source in ('No', 'correct', 'incorrect'))
            assert set(re.findall(r'\{\w+\}', translated)) == set(re.findall(r'\{\w+\}', source))
        ui, message = inputs(kind)
        message['locale'] = locale
        message['strings'] = translation['client_strings']
        assert ui.reduce(message)['scene']['labels'][0]['text'] == translation['display_name']


def test_generator_rebuilds_from_tracked_inputs_only_and_is_repeatable(tmp_path):
    (tmp_path / 'tools').mkdir()
    destination = tmp_path / 'games/declarative'
    destination.mkdir(parents=True)
    (destination / 'locales').mkdir()
    shutil.copy(ROOT / 'games/alternative-names.json', destination.parent)
    shutil.copy(ROOT / 'tools/build_html_declarative_conversions.mjs', tmp_path / 'tools')
    for name in ['html_conversions_ui.js', 'locales/html_conversions.json', *(kind+'.json' for kind in KINDS)]:
        shutil.copy(DIRECTORY / name, destination / name)
    expected = {kind: (destination / (kind+'.json')).read_bytes() for kind in KINDS}
    for _ in range(2):
        subprocess.run(['node', 'tools/build_html_declarative_conversions.mjs'], cwd=tmp_path,
                       check=True, capture_output=True, timeout=30)
        assert {kind: (destination / (kind+'.json')).read_bytes() for kind in KINDS} == expected
