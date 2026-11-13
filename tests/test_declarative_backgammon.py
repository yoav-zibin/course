"""Ordinary Backgammon authority behind the portable UI and normal match API."""
import copy
import hashlib
import json
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import verify_examples
from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.tests.helpers import Api
from game_platform.tests.test_declarative_examples import message
from game_platform.tools.build_declarative_backgammon import SOURCE_SHA256, source_schemas

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope='module')
def payload():
    return json.loads((ROOT / 'games/declarative/backgammon.json').read_text())


@pytest.fixture(scope='module')
def body(payload):
    return GameImport.model_validate(payload)


def context():
    return {'players': [{'id': 'a', 'kind': 'human', 'display_name': 'Alice', 'picture_url': '', 'max_loss': 5, 'active': True},
                        {'id': 'b', 'kind': 'human', 'display_name': 'Bob', 'picture_url': '', 'max_loss': 5, 'active': True}],
            'pot': 10, 'move_count': 0}


def setup_board(logic, ctx, own, enemy, dice, bar=0):
    state = logic.call('newMatch', ctx=ctx, seed=7)['state']
    state.update(owner=[-1] * 24, cnt=[0] * 24, bar=[bar, 0],
                 off=[15 - sum(own.values()) - bar, 15 - sum(enemy.values())],
                 cur=0, dice=dice, moves=dice, needRoll=False)
    for seat, counts in enumerate([own, enemy]):
        for point, count in counts.items():
            state['owner'][point], state['cnt'][point] = seat, count
    return state


def emitted_move(ui, frame, changed, move):
    if move['action'] in ('roll', 'pass'):
        event = {'type': 'tap', 'id': move['action']}
    else:
        target = 'to_' + str(move['to'])
        # Pick the offered checker by its source position in local presentation
        # memory; native clients need only inspect the rendered move_targets.
        ids = frame['local_state']['stacks'][changed['view']['cur']][str(move['from'])]
        piece = next(piece for piece in frame['scene']['pieces'] if piece['id'] == ids[-1])
        assert piece['actions'] == ['move'] and target in piece['move_targets']
        event = {'type': 'drop', 'id': piece['id'], 'piece_id': piece['id'], 'target_id': target}
    return ui.reduce({'type': 'ui_event', 'event': event, 'state_changed': changed}, frame['local_state'])


def test_complete_package_uses_exact_ordinary_authority(body):
    canonical = (ROOT / 'games/audit-batch3/backgammon.server.js').read_text()
    assert body.server_code == canonical
    assert hashlib.sha256(body.server_code.encode()).hexdigest() == SOURCE_SHA256
    assert body.game_schemas() == source_schemas()
    prepared = prepare(body)
    assert set(prepared['translations']) == {'en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar'}
    assert all(value['display_name'].endswith(' (Declarative)') for value in prepared['translations'].values())
    assert all(case['passed'] for case in verify_examples(body.server_code, body.unit_tests))
    assert len(body.declarative_ui['boards'][0]['cells']) == 24


@pytest.mark.parametrize('seed', [7, 31])
def test_same_full_match_through_regular_rules_and_declarative_events(body, seed):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ordinary = GameLogic((ROOT / 'games/audit-batch3/backgammon.server.js').read_text(), game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    result = rules.call('newMatch', ctx=ctx, seed=seed)
    regular = ordinary.call('newMatch', ctx=ctx, seed=seed)
    local = None
    for step in range(320):
        assert result == regular
        ctx['move_count'] = step
        viewer = result['turn'][0]
        changed = message(rules, result, ctx, viewer)
        frame = ui.reduce(changed, local)
        assert 'make_move' not in frame
        checkers = [piece for piece in frame['scene']['pieces'] if piece['type'] in ('p0', 'p1')]
        assert len(checkers) == 30 and len({piece['id'] for piece in checkers}) == 30
        for passive in (message(rules, result, ctx, None), {**changed, 'replay': True}):
            passive_frame = ui.reduce(passive, frame['local_state'])
            assert not passive_frame['scene']['targets'] and not passive_frame['scene']['controls']
            assert all(piece['actions'] == [] for piece in passive_frame['scene']['pieces'])
        move = ordinary.call('computerMove' if step % 2 else 'randomMove', regular['state'], viewer, ctx=ctx, seed=seed + step)
        event_result = emitted_move(ui, frame, changed, move)
        assert event_result.get('make_move') == move
        local = event_result['local_state']
        result = rules.call('applyMove', result['state'], viewer, event_result['make_move'], ctx=ctx, seed=seed + step)
        regular = ordinary.call('applyMove', regular['state'], viewer, move, ctx=ctx, seed=seed + step)
        for seat in range(2):
            assert result['state']['off'][seat] + result['state']['bar'][seat] + sum(
                count for owner, count in zip(result['state']['owner'], result['state']['cnt']) if owner == seat) == 15
        if result['turn'] is None:
            assert result == regular and sum(result['payouts'].values()) == 10
            final = ui.reduce(message(rules, result, {**ctx, 'move_count': step + 1}, viewer), local)
            assert not final['scene']['targets'] and not final['scene']['controls']
            assert all(piece['actions'] == [] for piece in final['scene']['pieces'])
            break
    else:
        pytest.fail('Backgammon did not finish')


def test_bar_entry_higher_die_and_maximum_dice_come_from_server(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    bar = setup_board(rules, ctx, {}, {21: 2, 19: 13}, [1, 2], bar=1)
    changed = message(rules, {'state': bar, 'turn': ['a']}, ctx, 'a')
    assert changed['view']['legalMoves'] == [{'from': 'bar', 'to': 22, 'die': 2, 'idx': 1}]
    frame = ui.reduce(changed)
    actionable = [piece for piece in frame['scene']['pieces'] if piece['actions']]
    assert len(actionable) == 1 and actionable[0]['move_targets'] == ['to_22']
    assert [target['id'] for target in frame['scene']['targets']] == ['to_22']
    for invalid in ({'action': 'move', 'from': 'bar', 'to': 23}, {'action': 'pass'}):
        with pytest.raises(InvalidMoveError):
            rules.call('applyMove', bar, 'a', invalid, ctx=ctx, seed=7)
    blocked_bear = setup_board(rules, ctx, {1: 1, 3: 1}, {2: 2, 20: 13}, [1, 2])
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', blocked_bear, 'a', {'action': 'move', 'from': 1, 'to': 'off'}, ctx=ctx, seed=7)
    changed = message(rules, {'state': blocked_bear, 'turn': ['a']}, ctx, 'a')
    frame = ui.reduce(changed)
    checker_id = frame['local_state']['stacks'][0]['1'][-1]
    offered = next(piece for piece in frame['scene']['pieces'] if piece['id'] == checker_id)
    assert 'to_off' not in offered['move_targets'] and 'to_0' in offered['move_targets']
    # Tampering with a presentation's legalMoves never bypasses applyMove.
    forged = copy.deepcopy(changed)
    forged['view']['legalMoves'] = [{'from': 1, 'to': 'off', 'die': 2, 'idx': 1}]
    forged_frame = ui.reduce(forged)
    attempted = emitted_move(ui, forged_frame, forged, {'action': 'move', 'from': 1, 'to': 'off'})['make_move']
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', blocked_bear, 'a', attempted, ctx=ctx, seed=7)


def test_checkers_keep_identity_when_moving_hitting_and_bearing_off(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    state = setup_board(rules, ctx, {6: 1}, {5: 1, 23: 14}, [1])
    before = ui.reduce(message(rules, {'state': state, 'turn': ['a']}, ctx, 'a'))
    white = before['local_state']['stacks'][0]['6'][-1]
    black = before['local_state']['stacks'][1]['5'][-1]
    result = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 6, 'to': 5}, ctx=ctx, seed=7)
    after = ui.reduce(message(rules, result, {**ctx, 'move_count': 1}, 'a'), before['local_state'])
    assert after['local_state']['stacks'][0]['5'] == [white]
    assert after['local_state']['stacks'][1]['bar'] == [black]
    # An unambiguous ordinary bearing-off sequence uses both dice and ends.
    state = setup_board(rules, ctx, {0: 1, 1: 1}, {20: 15}, [1, 2])
    before = ui.reduce(message(rules, {'state': state, 'turn': ['a']}, ctx, 'a'))
    checker = before['local_state']['stacks'][0]['0'][-1]
    first = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 0, 'to': 'off'}, ctx=ctx, seed=7)
    assert first['state']['moves'] == [2]
    after = ui.reduce(message(rules, first, {**ctx, 'move_count': 1}, 'a'), before['local_state'])
    assert after['local_state']['stacks'][0]['off'][-1] == checker
    final = rules.call('applyMove', first['state'], 'a', {'action': 'move', 'from': 1, 'to': 'off'}, ctx=ctx, seed=7)
    assert final['state']['off'][0] == 15 and final['turn'] is None


def test_standard_import_catalog_pinned_match_and_cheat_rejections(payload):
    api = Api()
    alice, bob = api.new_user('Alice'), api.new_user('Bob')
    game = api.ok('POST', '/games', as_user=alice, json=payload)
    assert game['published'] and game['renderer_type'] == 'declarative'
    assert game['server_code'] == payload['server_code']
    assert any(item['id'] == game['id'] and item['name'].endswith(' (Declarative)') for item in api.ok('GET', '/games'))
    pinned = api.ok('GET', f"/games/{game['id']}/versions/{game['version']}")
    assert pinned['declarative_ui'] == payload['declarative_ui']
    match_id = api.new_match(owner=alice, game_id=game['id'], joiners=[bob], start=True)
    before = api.ok('GET', f'/matches/{match_id}', as_user=alice)
    assert before['game_version'] == game['version']
    current = [alice, bob][before['state']['cur']]
    other = bob if current == alice else alice

    def rejected(move, who=current):
        snapshot = api.ok('GET', f'/matches/{match_id}', as_user=alice)
        response = api.request('POST', f'/matches/{match_id}/moves', as_user=who, json={'move': move})
        assert response.status_code in (400, 403, 409, 422), response.text
        after = api.ok('GET', f'/matches/{match_id}', as_user=alice)
        assert after['state'] == snapshot['state'] and after['move_count'] == snapshot['move_count']

    rejected({'action': 'roll'}, other)
    rejected({'action': 'move', 'from': 0, 'to': 23})
    for forged in ({'action': 'roll', 'dice': [6, 6, 6, 6]}, {'action': 'roll', 'state': {'off': [15, 0]}},
                   {'action': 'roll', 'payouts': {alice: 100000}}, {'action': 'move', 'from': 1, 'to': 'off', 'die': 6}):
        rejected(forged)
    rolled = api.ok('POST', f'/matches/{match_id}/moves', as_user=current, json={'move': {'action': 'roll'}})
    assert rolled['move_count'] == before['move_count'] + 1
    view = rolled['state']
    assert len(view['dice']) in (2, 4) and all(1 <= die <= 6 for die in view['dice'])
    rejected({'action': 'roll'})
    rejected({'action': 'move', 'from': 0, 'to': 23})
    rejected({'action': 'move', 'from': None, 'to': 0})
    move = view['legalMoves'][0]
    accepted = api.ok('POST', f'/matches/{match_id}/moves', as_user=current,
                      json={'move': {'action': 'move', 'from': move['from'], 'to': move['to']}})
    assert accepted['move_count'] == rolled['move_count'] + 1
    assert api.ok('GET', f'/matches/{match_id}/history', as_user=bob)['moves']
