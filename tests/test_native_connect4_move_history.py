"""Native rack Connect Four records public gravity provenance after acceptance."""
import copy
import json
from pathlib import Path

import pytest

from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.tests.test_declarative_backgammon import context

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope='module')
def rules():
    source = json.loads((ROOT/'tests/fixtures/declarative/connect4-native-package.json').read_text())['game']
    schemas = copy.deepcopy(source['game_schemas'])
    for name in ('state', 'view'):
        schemas[name]['properties']['last_move'] = {
            'type': ['object', 'null'], 'additionalProperties': False,
            'required': ['seat', 'column', 'cell'], 'properties': {
                'seat': {'type': 'integer', 'minimum': 0, 'maximum': 1},
                'column': {'type': 'integer', 'minimum': 0, 'maximum': 6},
                'cell': {'type': 'integer', 'minimum': 0, 'maximum': 41}}}
    return GameLogic(source['server_code']+'\n'+(ROOT/'games/declarative/connect4-move-history.js').read_text(), game_schemas=schemas)


def test_same_column_moves_record_exact_landing_cells_and_public_actor(rules):
    ctx = context()
    result = rules.call('newMatch',ctx=ctx,seed=7)
    assert result['state']['last_move'] is None
    for count,cell in enumerate([38,31,24]):
        actor = count%2
        before = copy.deepcopy(result['state'])
        result = rules.call('applyMove',result['state'],ctx['players'][actor]['id'],{'column':3},ctx={**ctx,'move_count':count},seed=7)
        assert result['state']['last_move'] == {'seat':actor,'column':3,'cell':cell}
        assert result['state']['board'][cell] == actor
        assert result['state']['disc_ids'][cell] == count
        assert before.get('last_move') != result['state']['last_move']
        for viewer in ('a','b',None):
            view = rules.call('viewFor',result['state'],viewer,ctx={**ctx,'move_count':count+1},seed=7)
            assert view['last_move'] == result['state']['last_move']


def test_rejected_moves_keep_previous_provenance_and_legacy_inputs_can_continue(rules):
    ctx = context()
    initial = rules.call('newMatch',ctx=ctx,seed=7)['state']
    initial.pop('last_move')
    accepted = rules.call('applyMove',initial,'a',{'column':6},ctx=ctx,seed=7)['state']
    assert accepted['last_move'] == {'seat':0,'column':6,'cell':41}
    saved = copy.deepcopy(accepted)
    for actor,move in [('a',{'column':0}),('b',{'column':7}),('b',{'column':0,'last_move':{}})]:
        with pytest.raises(InvalidMoveError):
            rules.call('applyMove',accepted,actor,move,ctx={**ctx,'move_count':1},seed=7)
        assert accepted == saved
