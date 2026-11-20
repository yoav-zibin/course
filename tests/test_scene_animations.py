"""Explicit scene animation responses work during local and accepted own turns."""
import copy

import pytest

from game_platform.declarative_ui import DeclarativeLogic, DeclarativeUIError, validate_response
from game_platform.tests.test_declarative_ui import spec, state_changed


def scene():
    return {'pieces': [{'id': 'token0', 'type': 'token', 'board': 'board',
                        'position': {'cell': '0'}, 'rotation': 90}]}


def animation(**values):
    return {'piece_id': 'token0', 'key': 'turn:1', 'from': {'rotation': 0}, **values}


def test_reducer_can_return_scene_and_explicit_animations_on_both_input_types():
    code = """const gameUI={reduce(m){return {
      scene:{pieces:[{id:'token0',type:'token',board:'board',position:{cell:'0'},rotation:90}]},
      animations:[{piece_id:'token0',key:'turn:1',from:{rotation:0},duration_ms:400}]};}};"""
    logic = DeclarativeLogic(spec(code))
    changed = state_changed()
    for message in [changed, {'type': 'ui_event', 'event': {'type': 'tap', 'id': 'token0'},
                             'state_changed': changed}]:
        result = logic.reduce(message)
        assert result['animations'] == [animation(duration_ms=400)]
        assert result['scene']['pieces'][0]['rotation'] == 90
        assert 'make_move' not in result
        assert logic.reduce(message) == result


def test_scene_animations_accept_independent_transforms_and_board_relative_positions():
    ui = spec()
    ui['boards'].append({'id': 'tray', 'kind': 'zone', 'x': 600, 'y': 0,
                         'width': 100, 'height': 600})
    for start in [{'rotation': -90}, {'scale': .2}, {'opacity': 0},
                  {'position': {'cell': '8'}}, {'position': {'x': -50, 'y': 100}},
                  {'board': 'tray', 'position': {'x': 50, 'y': 100},
                   'rotation': 0, 'scale': 2, 'opacity': .5}]:
        value = {'scene': scene(), 'animations': [animation(**{'from': start})]}
        assert validate_response(ui, value) is value
    assert validate_response(ui, {'scene': scene(), 'animations': []})
    assert validate_response(ui, {'scene': scene()})


def test_parallel_animations_allow_same_event_key_on_different_pieces():
    final = scene()
    final['pieces'].append({**copy.deepcopy(final['pieces'][0]), 'id': 'token1'})
    animations = [animation(), animation(piece_id='token1')]
    assert validate_response(spec(), {'scene': final, 'animations': animations})


@pytest.mark.parametrize('value', [
    None, {}, [None], [{}], [animation(piece_id='missing')],
    [animation(key='')], [animation(key='key with spaces')], [animation(extra=True)],
    [animation(duration_ms=-1)], [animation(duration_ms=5001)], [animation(duration_ms=1.5)],
    [animation(delay_ms=-1)], [animation(delay_ms=5001)], [animation(delay_ms=True)],
    [animation(**{'from': {}})], [animation(**{'from': {'board': 'board'}})],
    [animation(**{'from': {'extra': 0}})], [animation(**{'from': {'rotation': True}})],
    [animation(**{'from': {'rotation': 100001}})], [animation(**{'from': {'rotation': -100001}})],
    [animation(**{'from': {'scale': 0}})], [animation(**{'from': {'scale': 101}})],
    [animation(**{'from': {'opacity': -0.1}})], [animation(**{'from': {'opacity': 1.1}})],
    [animation(**{'from': {'board': 'missing', 'position': {'cell': '0'}}})],
    [animation(**{'from': {'position': {'cell': '9'}}})],
    [animation(**{'from': {'position': {'x': 0}}})],
    [animation(**{'from': {'position': {'cell': '0', 'x': 0, 'y': 0}}})],
    [animation(), animation(key='different')], [animation()] * 129,
])
def test_scene_animation_rejects_invalid_shapes_values_and_references(value):
    with pytest.raises(DeclarativeUIError):
        validate_response(spec(), {'scene': scene(), 'animations': value})


def test_scene_animations_reject_hidden_references_and_invalid_explicit_cells():
    hidden = scene()
    hidden['pieces'][0]['hidden'] = True
    with pytest.raises(DeclarativeUIError, match='visible'):
        validate_response(spec(), {'scene': hidden, 'animations': [animation()]})
    ui = spec()
    ui['boards'][0]['cells'] = [{'id': 'named', 'x': 100, 'y': 100}]
    final = scene()
    final['pieces'][0]['position'] = {'cell': 'named'}
    with pytest.raises(DeclarativeUIError, match='unknown board cell'):
        validate_response(ui, {'scene': final,
                              'animations': [animation(**{'from': {'position': {'cell': '0'}}})]})


def test_explicit_response_and_optional_last_move_hook_can_coexist():
    code = """const gameUI={reduce(){return {
      scene:{pieces:[{id:'token0',type:'token',board:'board',position:{cell:'0'},rotation:90}]},
      animations:[{piece_id:'token0',key:'turn:1',from:{rotation:0}}]};},
      getLastMoveAnimations(){return [];}};"""
    result = DeclarativeLogic(spec(code)).reduce(state_changed())
    assert result['animations'] == [animation()]
    assert result['last_move_animations'] == []
