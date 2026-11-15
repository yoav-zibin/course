"""Avoid repeated schemas without dropping either runtime or example checks."""
from copy import deepcopy
from unittest.mock import patch

import pytest

from game_platform.game_contract import ContractLogic
from game_platform.game_logic import GameLogicError, InvalidMoveError


NUMBER_OBJECT = {
    'type': 'object', 'properties': {'n': {'type': 'integer', 'minimum': 0}},
    'required': ['n'], 'additionalProperties': False,
}
CONTRACT = {name + '_schema': deepcopy(NUMBER_OBJECT) for name in ('state', 'move', 'view')}
CONTRACT['cases'] = []
CTX = {'players': [{'id': 'human', 'kind': 'human'}], 'pot': 0, 'move_count': 0}
SOURCE = """
const game = {
  newMatch(ctx) { return {state: {n: 0}, turn: ['human']}; },
  applyMove(state, playerId, move, ctx) {
    return {state: {n: state.n + move.n}, turn: ['human']};
  },
  viewFor(state, playerId, ctx) { return state; },
  randomMove(state, playerId, ctx) { return {n: 1}; },
  computerMove(state, playerId, ctx) { return {n: 1}; },
};
"""


@pytest.mark.parametrize('function,args,checks', [
    ('newMatch', (), ['state']),
    ('applyMove', ({'n': 0}, 'human', {'n': 1}), ['state', 'move', 'state']),
    ('viewFor', ({'n': 0}, None), ['state', 'view']),
    ('randomMove', ({'n': 0}, 'human'), ['state', 'move']),
    ('computerMove', ({'n': 0}, 'human'), ['state', 'move']),
])
def test_identical_schemas_check_each_input_and_output_once(function, args, checks):
    logic = ContractLogic(SOURCE, CONTRACT)
    with patch.object(logic, '_schema_message', wraps=logic._schema_message) as runtime, \
            patch.object(logic, 'check', wraps=logic.check) as extra:
        logic.call(function, *args, ctx=CTX)
    assert [call.args[0] for call in runtime.call_args_list] == checks
    assert extra.call_count == 0


@pytest.mark.parametrize('function,args,source,error', [
    ('applyMove', ({'n': -1}, 'human', {'n': 1}), SOURCE, GameLogicError),
    ('applyMove', ({'n': 0}, 'human', {'n': -1}), SOURCE, InvalidMoveError),
    ('newMatch', (), SOURCE.replace('state: {n: 0}', 'state: {n: -1}'), GameLogicError),
    ('viewFor', ({'n': 0}, None), SOURCE.replace('return state;', 'return {n: -1};'), GameLogicError),
    ('randomMove', ({'n': 0}, 'human'), SOURCE.replace('return {n: 1};', 'return {n: -1};'), GameLogicError),
])
def test_identical_schemas_still_reject_invalid_values(function, args, source, error):
    with pytest.raises(error):
        ContractLogic(source, CONTRACT).call(function, *args, ctx=CTX)


@pytest.mark.parametrize('strict_contract', [True, False])
@pytest.mark.parametrize('schema', ['state', 'move', 'view'])
def test_different_example_and_runtime_schemas_both_remain_enforced(schema, strict_contract):
    contract = deepcopy(CONTRACT)
    runtime = {name: deepcopy(NUMBER_OBJECT) for name in ('state', 'move', 'view')}
    relaxed = contract[schema + '_schema'] if not strict_contract else runtime[schema]
    relaxed['properties']['n']['minimum'] = -1
    logic = ContractLogic(SOURCE, contract, game_schemas=runtime)
    if schema == 'state':
        function, args = 'viewFor', ({'n': -1}, None)
    elif schema == 'move':
        function, args = 'applyMove', ({'n': 0}, 'human', {'n': -1})
    else:
        logic = ContractLogic(SOURCE.replace('return state;', 'return {n: -1};'), contract,
                              game_schemas=runtime)
        function, args = 'viewFor', ({'n': 0}, None)
    with pytest.raises(InvalidMoveError if schema == 'move' else GameLogicError):
        logic.call(function, *args, ctx=CTX)


def test_boolean_and_numeric_enum_schemas_are_not_collapsed_by_python_equality():
    contract = {**CONTRACT, 'move_schema': {'enum': [True]}}
    runtime = {name: deepcopy(NUMBER_OBJECT) for name in ('state', 'view')}
    runtime['move'] = {'enum': [1]}
    logic = ContractLogic(SOURCE.replace('return {n: 1};', 'return 1;'), contract,
                          game_schemas=runtime)
    with pytest.raises(GameLogicError, match='move_schema'):
        logic.call('randomMove', {'n': 0}, 'human', ctx=CTX)


def test_direct_example_schema_checks_are_still_available():
    with pytest.raises(GameLogicError, match='state_schema'):
        ContractLogic(SOURCE, CONTRACT).check('state_schema', {'n': -1})


@pytest.mark.parametrize('strict_contract', [True, False])
def test_different_state_schemas_still_check_returned_state(strict_contract):
    contract = deepcopy(CONTRACT)
    runtime = {name: deepcopy(NUMBER_OBJECT) for name in ('state', 'move', 'view')}
    relaxed = contract['state_schema'] if not strict_contract else runtime['state']
    relaxed['properties']['n']['minimum'] = -1
    with pytest.raises(GameLogicError):
        ContractLogic(SOURCE.replace('state: {n: 0}', 'state: {n: -1}'), contract,
                      game_schemas=runtime).call('newMatch', ctx=CTX)


@pytest.mark.parametrize('function', ['viewFor', 'randomMove', 'computerMove'])
def test_view_or_move_named_state_field_is_not_a_match_result(function):
    contract = deepcopy(CONTRACT)
    runtime = {name: deepcopy(NUMBER_OBJECT) for name in ('state', 'move', 'view')}
    runtime['state']['properties']['n']['minimum'] = -1
    for name in ('move', 'view'):
        contract[name + '_schema'] = runtime[name] = {
            'type': 'object', 'properties': {'state': {'type': 'string'}},
            'required': ['state'], 'additionalProperties': False,
        }
    source = SOURCE.replace('return state;', "return {state: 'a label'};").replace(
        'return {n: 1};', "return {state: 'a label'};")
    who = None if function == 'viewFor' else 'human'
    assert ContractLogic(source, contract, game_schemas=runtime).call(
        function, {'n': 0}, who, ctx=CTX) == {'state': 'a label'}
