"""Ordinary Backgammon authority behind the portable UI and normal match API."""
import copy
import hashlib
import json
from pathlib import Path

import pytest
import quickjs

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
    if move['action'] == 'roll':
        die = next(piece for piece in frame['scene']['pieces'] if piece['type'] == 'die' and piece['actions'] == ['tap'])
        event = {'type': 'tap', 'id': die['id']}
    elif move['action'] == 'pass':
        event = {'type': 'tap', 'id': 'pass'}
    else:
        target = 'to_' + str(move['to'])
        # Pick the offered checker by its source position in local presentation
        # memory; native clients need only inspect the rendered move_targets.
        ids = frame['local_state']['stacks'][changed['view']['cur']][str(move['from'])]
        piece = next(piece for piece in frame['scene']['pieces'] if piece['id'] == ids[-1])
        assert piece['actions'] == ['move'] and target in piece['move_targets']
        event = {'type': 'drop', 'id': piece['id'], 'piece_id': piece['id'], 'target_id': target}
    return ui.reduce({'type': 'ui_event', 'event': event, 'state_changed': changed}, frame['local_state'])


def test_complete_package_wraps_ordinary_authority_with_roll_history_and_combined_moves(body):
    canonical = (ROOT / 'games/declarative/backgammon.server.js').read_text()
    wrapper = (ROOT / 'games/declarative/backgammon-roll-history.js').read_text()
    compound = (ROOT / 'games/declarative/backgammon-combined-moves.js').read_text()
    assert body.server_code == canonical + '\n' + wrapper + '\n' + compound
    assert hashlib.sha256(canonical.encode()).hexdigest() == SOURCE_SHA256
    assert body.game_schemas() == source_schemas()
    prepared = prepare(body)
    assert set(prepared['translations']) == {'en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar'}
    assert all(value['display_name'].endswith(' (Declarative)') for value in prepared['translations'].values())
    assert all(case['passed'] for case in verify_examples(body.server_code, body.unit_tests))
    assert len(body.unit_tests['cases']) == 6
    assert sum(case['kind'] == 'intermediate' for case in body.unit_tests['cases']) == 4
    assert any(case['name'] == 'Combined four ones' for case in body.unit_tests['cases'])
    combined_cases = json.loads((ROOT / 'tests/fixtures/declarative/backgammon-combined-cases.json').read_text())
    assert [case['name'] for case in combined_cases] == [
        'Combined four ones', 'Combined one and four', 'Forced combined hit', 'Ambiguous combined hit stays single']
    assert all(case['passed'] for case in verify_examples(body.server_code, {**body.unit_tests, 'cases': combined_cases}))
    assert len(body.declarative_ui['boards'][0]['cells']) == 24
    assert body.declarative_ui == json.loads((ROOT / 'static/backgammon-declarative-ui.json').read_text())


def dice(frame):
    return [piece for piece in frame['scene']['pieces'] if piece['type'] == 'die']


def without_roll_metadata(result):
    plain = copy.deepcopy(result)
    plain['state'].pop('last_roll', None)
    return plain


def apply_with_counted_random(code, state, ctx, move, draws=(.1, .8)):
    runtime = quickjs.Context()
    runtime.eval('class InvalidMove extends Error {}')
    runtime.eval(code)
    return json.loads(runtime.eval(
        '(() => {const ctx=' + json.dumps(ctx) + ';const values=' + json.dumps(draws) + ';let count=0;'
        'ctx.random=()=>values[count++ % values.length];const result=game.applyMove('
        + json.dumps(state) + ',' + json.dumps(ctx['players'][state['cur']]['id']) + ',' + json.dumps(move) + ',ctx);'
        'return JSON.stringify({result,count});})()'))


def test_two_central_dice_replace_the_roll_button_and_only_offer_legal_rolls(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    result = rules.call('newMatch', ctx=ctx, seed=7)
    viewer = result['turn'][0]
    changed = message(rules, result, ctx, viewer)
    frame = ui.reduce(changed)
    assert [piece['id'] for piece in dice(frame)] == ['die_0', 'die_1']
    assert [piece['position'] for piece in dice(frame)] == [{'x': 336, 'y': 180}, {'x': 336, 'y': 260}]
    assert all(piece['asset'] == 'die_0_used_0' and piece['actions'] == ['tap'] for piece in dice(frame))
    assert not frame['scene']['controls']
    for piece in dice(frame):
        event = {'type': 'ui_event', 'event': {'type': 'tap', 'id': piece['id']}, 'state_changed': changed}
        assert ui.reduce(event, frame['local_state'])['make_move'] == {'action': 'roll'}
        for passive in (message(rules, result, ctx, None), {**changed, 'replay': True},
                        {**changed, 'acting_for_player_index': None}):
            passive_frame = ui.reduce(passive, frame['local_state'])
            assert len(dice(passive_frame)) == 2
            assert all(piece['actions'] == [] for piece in dice(passive_frame))
            assert 'make_move' not in ui.reduce({**event, 'state_changed': passive}, frame['local_state'])


def test_doubles_spend_one_half_die_per_authoritative_move(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    state = setup_board(rules, ctx, {20: 15}, {0: 15}, [])
    state['needRoll'] = True
    initial = ui.reduce(message(rules, {'state': state, 'turn': ['a']}, ctx, 'a'))
    for seed in range(1, 101):
        result = rules.call('applyMove', state, 'a', {'action': 'roll'}, ctx=ctx, seed=seed)
        if len(result['state']['moves']) == 4:
            break
    else:
        pytest.fail('No deterministic doubles roll found')
    value = result['state']['moves'][0]
    local = initial['local_state']
    for used in range(4):
        ctx['move_count'] = used + 1
        changed = message(rules, result, ctx, 'a')
        frame = ui.reduce(changed, local)
        assert [piece['asset'] for piece in dice(frame)] == [
            f'die_{value}_used_{min(used, 2)}', f'die_{value}_used_{max(0, used - 2)}']
        assert all(piece['actions'] == [] for piece in dice(frame))
        assert next(label['text'] for label in frame['scene']['labels'] if label['id'] == 'moves_remaining') == f'Moves remaining: {4 - used}'
        assert 'make_move' not in ui.reduce({'type': 'ui_event', 'event': {'type': 'tap', 'id': 'die_0'}, 'state_changed': changed}, frame['local_state'])
        move = rules.call('computerMove', result['state'], 'a', ctx=ctx, seed=seed)
        local = emitted_move(ui, frame, changed, move)['local_state']
        result = rules.call('applyMove', result['state'], 'a', move, ctx=ctx, seed=seed)
    assert result['state']['needRoll'] and result['state']['cur'] == 1
    next_frame = ui.reduce(message(rules, result, {**ctx, 'move_count': 5}, 'b'), local)
    assert all(piece['asset'] == f'die_{value}_used_2' and piece['actions'] == ['tap'] for piece in dice(next_frame))
    assert next_frame['local_state']['roll']['cur'] == 0
    assert next_frame['local_state']['roll']['turn'] == 0
    # A fresh next-turn roll replaces the retained pair and starts unspent.
    fresh = rules.call('applyMove', result['state'], 'b', {'action': 'roll'}, ctx={**ctx, 'move_count': 5}, seed=13)
    assert not fresh['state']['needRoll']
    fresh_frame = ui.reduce(message(rules, fresh, {**ctx, 'move_count': 6}, 'b'), next_frame['local_state'])
    assert [piece['asset'] for piece in dice(fresh_frame)] == [f'die_{die}_used_0' for die in fresh['state']['dice'][:2]]
    assert fresh_frame['local_state']['roll']['cur'] == 1
    assert fresh_frame['local_state']['roll']['turn'] == 1
    earlier = ui.reduce({**message(rules, {'state': state, 'turn': ['a']}, ctx, 'a'), 'replay': True}, fresh_frame['local_state'])
    assert all(piece['asset'] == 'die_0_used_0' and piece['actions'] == [] for piece in dice(earlier))


def test_ordinary_used_die_keeps_its_face_and_midturn_mount_does_not_invent_a_roll(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    state = setup_board(rules, ctx, {20: 15}, {0: 15}, [1, 2])
    changed = message(rules, {'state': state, 'turn': ['a']}, ctx, 'a')
    frame = ui.reduce(changed)
    result = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 20, 'to': 19}, ctx=ctx, seed=7)
    changed = message(rules, result, {**ctx, 'move_count': 1}, 'a')
    after = ui.reduce(changed, frame['local_state'])
    assert [piece['asset'] for piece in dice(after)] == ['die_1_used_2', 'die_2_used_0']
    fresh = ui.reduce(changed)
    assert [piece['asset'] for piece in dice(fresh)] == ['die_2_used_0', 'die_0_used_0']
    assert 'unknown' in dice(fresh)[1]['aria_label']


@pytest.mark.parametrize('blocked', [False, True])
def test_roll_metadata_records_the_same_two_random_draws_even_when_the_turn_auto_passes(body, blocked):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = context()
    if blocked:
        state = setup_board(rules, ctx, {}, {18: 2, 19: 2, 20: 2, 21: 2, 22: 2, 23: 5}, [], bar=1)
    else:
        state = setup_board(rules, ctx, {20: 15}, {0: 15}, [])
    state['needRoll'] = True
    canonical = (ROOT / 'games/declarative/backgammon.server.js').read_text()
    ordinary = apply_with_counted_random(canonical, state, ctx, {'action': 'roll'})
    recorded = apply_with_counted_random(body.server_code, state, ctx, {'action': 'roll'})
    assert ordinary['count'] == recorded['count'] == 2
    assert without_roll_metadata(recorded['result']) == ordinary['result']
    last = recorded['result']['state']['last_roll']
    assert last == {'seat': 0, 'turn': 0, 'values': [1, 5], 'move_count': 1}
    assert recorded['result']['state']['needRoll'] is blocked
    changed = message(rules, recorded['result'], {**ctx, 'move_count': 1}, 'b' if blocked else 'a')
    assert changed['view']['last_roll'] == last
    # A reload needs no earlier local scene or extra history, even after a
    # blocked roll that never persisted a nonempty authoritative dice array.
    frame = DeclarativeLogic(body.declarative_ui).reduce(changed)
    used = 2 if blocked else 0
    assert [piece['asset'] for piece in dice(frame)] == [f'die_1_used_{used}', f'die_5_used_{used}']
    assert all(piece['animation']['key'] == 'roll:0:0' for piece in dice(frame))


def test_turn_completion_retains_exact_roll_faces_without_local_presentation_memory(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = context()
    state = setup_board(rules, ctx, {20: 15}, {0: 15}, [])
    state['needRoll'] = True
    result = rules.call('applyMove', state, 'a', {'action': 'roll'}, ctx=ctx, seed=13)
    original = copy.deepcopy(result['state']['last_roll'])
    count = 1
    while not result['state']['needRoll']:
        move = rules.call('computerMove', result['state'], 'a', ctx={**ctx, 'move_count': count}, seed=13)
        result = rules.call('applyMove', result['state'], 'a', move, ctx={**ctx, 'move_count': count}, seed=13)
        count += 1
        assert result['state']['last_roll'] == original
    changed = message(rules, result, {**ctx, 'move_count': count}, 'b')
    frame = DeclarativeLogic(body.declarative_ui).reduce(changed)
    assert [piece['asset'] for piece in dice(frame)] == [f'die_{value}_used_2' for value in original['values']]
    assert all(piece['actions'] == ['tap'] and piece['animation']['key'] == 'roll:0:0' for piece in dice(frame))


def test_endcap_without_a_roll_does_not_invent_faces_or_consume_randomness(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = {**context(), 'move_count': 301}
    state = setup_board(rules, ctx, {20: 15}, {0: 15}, [])
    state['needRoll'] = True
    state['last_roll'] = {'seat': 1, 'turn': 0, 'values': [2, 6], 'move_count': 300}
    recorded = apply_with_counted_random(body.server_code, state, ctx, {'action': 'roll'})
    canonical = (ROOT / 'games/declarative/backgammon.server.js').read_text()
    ordinary = apply_with_counted_random(canonical, state, ctx, {'action': 'roll'})
    assert recorded['count'] == ordinary['count'] == 0
    assert without_roll_metadata(recorded['result']) == ordinary['result']
    assert recorded['result']['state']['last_roll'] == state['last_roll']


def test_finite_match_end_keeps_the_last_roll_when_the_authority_advances_its_turn_counter(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = {**context(), 'move_count': 291}
    state = setup_board(rules, ctx, {20: 15}, {0: 15}, [1])
    state['n'] = 120
    state['last_roll'] = {'seat': 0, 'turn': 120, 'values': [1, 2], 'move_count': 290}
    before = message(rules, {'state': state, 'turn': ['a']}, ctx, 'a')
    previous = ui.reduce(before)
    result = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 20, 'to': 19}, ctx=ctx, seed=13)
    assert result['turn'] is None and result['state']['n'] == 121 and not result['state']['needRoll']
    final = message(rules, result, {**ctx, 'move_count': 292}, 'a')
    frame = ui.reduce(final)
    assert [piece['asset'] for piece in dice(frame)] == ['die_1_used_2', 'die_2_used_2']
    assert all(piece['actions'] == [] for piece in dice(frame))
    # Earlier pinned rules can recover the same ended pair from the latest
    # eligible history turn, or retain a pair already observed locally.
    legacy_view = {**final['view'], 'last_roll': None}
    legacy_final = {**final, 'state': legacy_view, 'view': legacy_view}
    for history, local in [
        ([{'view': {**before['view'], 'n': 119, 'dice': [6, 6, 6, 6], 'moves': [6, 6, 6, 6]}, 'move_count': 285},
          {'view': {**before['view'], 'dice': [1, 2], 'moves': [1, 2]}, 'move_count': 290}], None),
        ([], previous['local_state']),
    ]:
        recovered = ui.reduce({**legacy_final, 'presentation_history': history}, local)
        assert [piece['asset'] for piece in dice(recovered)] == ['die_1_used_2', 'die_2_used_2']


def test_legacy_computer_turn_recovers_its_roll_from_filtered_history(body):
    canonical = (ROOT / 'games/declarative/backgammon.server.js').read_text()
    rules = GameLogic(canonical, game_schemas=body.game_schemas())
    ctx = context()
    ctx['players'][0]['kind'] = 'computer'
    state = setup_board(rules, ctx, {20: 15}, {0: 15}, [])
    state['needRoll'] = True
    result = rules.call('applyMove', state, 'a', {'action': 'roll'}, ctx=ctx, seed=13)
    values = result['state']['dice'][:2]
    observations = []
    count = 1
    while not result['state']['needRoll']:
        filtered = message(rules, result, {**ctx, 'move_count': count}, 'b')
        observations.append({'view': filtered['view'], 'move_count': count, 'last_move_player_index': 0})
        move = rules.call('computerMove', result['state'], 'a', ctx={**ctx, 'move_count': count}, seed=13)
        result = rules.call('applyMove', result['state'], 'a', move, ctx={**ctx, 'move_count': count}, seed=13)
        count += 1
    final = message(rules, result, {**ctx, 'move_count': count}, 'b')
    assert final['view']['dice'] == [] and 'last_roll' not in final['view']
    ui = DeclarativeLogic(body.declarative_ui)
    frame = ui.reduce({**final, 'presentation_history': observations})
    assert [piece['asset'] for piece in dice(frame)] == [f'die_{value}_used_2' for value in values]
    assert all(piece['actions'] == ['tap'] and piece['animation']['key'] == 'roll:0:0' for piece in dice(frame))
    # Polls must not retrigger rolling while only spent halves or labels change.
    again = ui.reduce({**final, 'presentation_history': observations}, frame['local_state'])
    assert [piece['animation'] for piece in dice(again)] == [piece['animation'] for piece in dice(frame)]
    earlier = {**message(rules, {'state': state, 'turn': ['a']}, ctx, 'b'), 'replay': True,
               'presentation_history': observations}
    replay = ui.reduce(earlier, frame['local_state'])
    assert all(piece['asset'] == 'die_0_used_0' and piece['actions'] == [] and 'animation' not in piece for piece in dice(replay))


def test_history_never_overrides_a_recorded_roll_or_supplies_future_replay_faces(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = context()
    state = setup_board(rules, ctx, {20: 15}, {0: 15}, [])
    state['needRoll'] = True
    result = apply_with_counted_random(body.server_code, state, ctx, {'action': 'roll'})['result']
    changed = message(rules, result, {**ctx, 'move_count': 1}, 'a')
    false_view = {**changed['view'], 'dice': [6, 6, 6, 6], 'moves': [6, 6, 6, 6]}
    ui = DeclarativeLogic(body.declarative_ui)
    frame = ui.reduce({**changed, 'presentation_history': [{'view': false_view, 'move_count': 1}]})
    assert [piece['asset'] for piece in dice(frame)] == ['die_1_used_0', 'die_5_used_0']
    partial = {**changed['view'], 'last_roll': None, 'dice': [5], 'moves': [5]}
    replay = ui.reduce({**changed, 'view': partial, 'state': partial, 'move_count': 2, 'replay': True,
                        'presentation_history': [{'view': false_view, 'move_count': 3}]})
    assert [piece['asset'] for piece in dice(replay)] == ['die_5_used_0', 'die_0_used_0']


def test_legacy_roll_memory_stays_visible_across_an_unobserved_turn(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    state = setup_board(rules, ctx, {20: 15}, {0: 15}, [1, 5])
    rolled = message(rules, {'state': state, 'turn': ['a']}, ctx, 'a')
    first = ui.reduce(rolled)
    later_view = {**rolled['view'], 'last_roll': None, 'dice': [], 'moves': [], 'needRoll': True, 'n': 2}
    later = {**rolled, 'view': later_view, 'state': later_view, 'move_count': 10}
    retained = ui.reduce(later, first['local_state'])
    assert [piece['asset'] for piece in dice(retained)] == ['die_1_used_2', 'die_5_used_2']
    assert [piece['animation'] for piece in dice(retained)] == [piece['animation'] for piece in dice(first)]


def test_legal_drop_hit_areas_cover_point_triangles_and_the_off_tray(body):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    for own, enemy, dice_values, point, expected in [
        ({20: 15}, {0: 15}, [1, 2], 'to_19', {'x': -24, 'y': -200, 'width': 48, 'height': 220}),
        ({6: 1}, {5: 1, 23: 14}, [1], 'to_5', {'x': -24, 'y': -20, 'width': 48, 'height': 220}),
        ({0: 1, 1: 1}, {20: 15}, [1, 2], 'to_off', {'x': -24, 'y': -15, 'width': 48, 'height': 220}),
    ]:
        state = setup_board(rules, ctx, own, enemy, dice_values)
        scene = ui.reduce(message(rules, {'state': state, 'turn': ['a']}, ctx, 'a'))['scene']
        target = next(item for item in scene['targets'] if item['id'] == point)
        assert target['hit_area'] == expected
        passive = ui.reduce(message(rules, {'state': state, 'turn': ['a']}, ctx, None))['scene']
        assert not passive['targets']


@pytest.mark.parametrize('seed', [7, 31])
def test_same_full_match_through_regular_rules_and_declarative_events(body, seed):
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ordinary = GameLogic((ROOT / 'games/declarative/backgammon.server.js').read_text(), game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = context()
    result = rules.call('newMatch', ctx=ctx, seed=seed)
    regular = ordinary.call('newMatch', ctx=ctx, seed=seed)
    local = None
    for step in range(320):
        assert without_roll_metadata(result) == regular
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
            assert without_roll_metadata(result) == regular and sum(result['payouts'].values()) == 10
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
                   {'action': 'roll', 'last_roll': {'seat': 0, 'turn': 0, 'values': [6, 6], 'move_count': 1}},
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
