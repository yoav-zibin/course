"""Connect Four declares gravity using the last accepted, public move."""
import copy
import json
from pathlib import Path

import pytest
import quickjs

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import verify_examples
from game_platform.game_logic import GameLogic


PACKAGE = Path(__file__).resolve().parents[1] / 'games/declarative/connect4.json'


def package():
    return GameImport.model_validate(json.loads(PACKAGE.read_text()))


def animations(body, view, scene):
    # Exercise the authored hook independently of host interpolation policy.
    vm = quickjs.Context()
    return json.loads(vm.eval(body.declarative_ui['ui_code'] + '\n' +
        'JSON.stringify(gameUI.getLastMoveAnimations(' + json.dumps(view) + ',' + json.dumps(scene) + '))'))


@pytest.mark.parametrize('column', range(7))
@pytest.mark.parametrize('row', range(6))
def test_every_landing_cell_declares_a_vertical_fall(column, row):
    body = package()
    case = body.unit_tests['cases'][0]
    ctx = copy.deepcopy(case['ctx'])
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    state = rules.call('newMatch', ctx=ctx, seed=7)['state']
    for occupied_row in range(row + 1, 6):
        state['board'][occupied_row * 7 + column] = occupied_row % 2
    result = rules.call('applyMove', state, ctx['players'][0]['id'], {'column':column}, ctx=ctx, seed=7)
    cell = row * 7 + column
    assert result['state']['last_move'] == {'seat':0, 'column':column, 'cell':cell}
    # Waiting opponents and spectators receive the same animation provenance.
    for viewer in (ctx['players'][1]['id'], None):
        view = rules.call('viewFor', result['state'], viewer, ctx=ctx, seed=7)
        assert view['last_move'] == result['state']['last_move']
        scene = DeclarativeLogic(body.declarative_ui).reduce({
            'type':'state_changed', 'view':view, 'status':'over' if result['turn'] is None else 'ongoing',
            'my_player_index':1 if viewer else None, 'acting_for_player_index':None, 'move_count':1,
        })['scene']
        plan = animations(body, view, scene)
        assert len(plan) == 1 and plan[0]['piece_id'] == 'piece_' + str(cell)
        start, end = plan[0]['path']
        board = body.declarative_ui['boards'][0]
        final_x = (column + .5) * board['width'] / board['columns']
        final_y = (row + .5) * board['height'] / board['rows']
        assert start['position']['x'] == pytest.approx(final_x)
        assert start['position']['y'] < 0 < final_y
        assert start['board'] == end['board'] == 'main'
        piece = next(piece for piece in scene['pieces'] if piece['id'] == plan[0]['piece_id'])
        assert end['position'] == piece['position'] == {'cell':str(cell)}
        assert len(scene['pieces']) == 6 - row


def test_initial_positions_and_old_views_do_not_invent_a_last_move():
    body = package()
    case = body.unit_tests['cases'][0]
    view = copy.deepcopy(case['view_of_mover'])
    scene = DeclarativeLogic(body.declarative_ui).reduce({
        'type':'state_changed', 'view':view, 'status':'ongoing',
        'acting_for_player_index':0, 'my_player_index':0, 'move_count':0,
    })['scene']
    assert view['last_move'] is None
    assert animations(body, view, scene) == []
    del view['last_move']
    assert animations(body, view, scene) is None


def test_connect_four_documented_examples_include_last_move_provenance():
    body = package()
    results = verify_examples(body.server_code, body.unit_tests)
    assert all(case['passed'] for case in results), results
    for case in body.unit_tests['cases']:
        move = case['expected_state']['last_move']
        assert move['column'] == case['move']['column']
        assert case['expected_view_of_other']['last_move'] == move


def test_native_rack_hook_uses_retained_move_or_pinned_disc_identity():
    root = PACKAGE.parents[2]
    game = json.loads((root / 'tests/fixtures/declarative/connect4-native-package.json').read_text())['game']
    source = game['declarative_ui']['ui_code'] + '\n' + (root / 'games/declarative/connect4-move-animations.js').read_text()
    vm = quickjs.Context()
    vm.eval(source)
    before = {'board':[-1] * 42, 'disc_ids':[-1] * 42, 'turn':1, 'turns':0,
              'over':False, 'winner':-1, 'legal':[]}
    invoke = lambda view: json.loads(vm.eval(
        'JSON.stringify((()=>{const view=' + json.dumps(view) + ';const scene=gameUI.reduce({'
        'type:"state_changed",view,status:"ongoing",acting_for_player_index:null}).scene;'
        'return gameUI.getLastMoveAnimations(view,scene);})())'))
    assert invoke(before) == []
    for column in range(7):
        for row in range(6):
            view = copy.deepcopy(before)
            cell = row * 7 + column
            view['turns'] = 1
            view['board'][cell] = 1
            view['disc_ids'][cell] = 0
            for with_retained_move in (False, True):
                if with_retained_move:
                    view['last_move'] = {'seat':1, 'column':column, 'cell':cell}
                plan = invoke(view)
                assert len(plan) == 1 and plan[0]['piece_id'] == 'disc_0'
                start, end = plan[0]['path']
                assert start['position'] == {'x':25 + 50 * column, 'y':-28}
                assert end['position'] == {'x':25 + 50 * column, 'y':34 + 50 * row}
                assert start['board'] == end['board'] == 'main'
    # Neither a missing ID map nor inconsistent provenance invents a path.
    assert invoke({**before, 'turns':1}) is None
    assert invoke({**before, 'disc_ids':None}) is None


@pytest.mark.parametrize('columns', ([0, 4, 1, 4, 2], [0, 3, 0, 3, 1, 3, 1]))
def test_computer_blocks_immediate_losses_and_takes_wins(columns):
    body = package()
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = copy.deepcopy(body.unit_tests['cases'][0]['ctx'])
    result = rules.call('newMatch', ctx=ctx, seed=7)
    for index, column in enumerate(columns):
        ctx['move_count'] = index
        result = rules.call('applyMove', result['state'], result['turn'][0],
                            {'column': column}, ctx=ctx, seed=7)
    ctx['move_count'] = len(columns)
    for seed in (1, 7):
        move = rules.call('computerMove', result['state'], result['turn'][0],
                          ctx=ctx, seed=seed)
        assert move == {'column': 3}
