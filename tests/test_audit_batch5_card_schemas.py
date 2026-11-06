"""Reviewed card-game schemas exercised through the production QuickJS boundary."""
from copy import deepcopy
import datetime as dt
import json
from pathlib import Path

import pytest

from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.game_schemas import compile_game_schemas

ROOT = Path(__file__).parents[1] / 'games' / 'audit-batch5'
NOW = dt.datetime(2026, 11, 6, tzinfo=dt.timezone.utc)


def started(name, seed=11):
    schemas = json.loads((ROOT / (name + '.schema.json')).read_text())
    logic = GameLogic((ROOT / (name + '.server.js')).read_text(), game_schemas=schemas)
    n = 2 if name == 'guess-who' else 4
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'display_name': f'P{i}',
                        'picture_url': '', 'max_loss': 10} for i in range(n)],
           'pot': n * 10, 'move_count': 0}
    return logic, schemas, ctx, logic.call('newMatch', ctx=ctx, seed=seed, now=NOW)


@pytest.mark.parametrize('name', ['guess-who', 'spades'])
@pytest.mark.parametrize('method', ['randomMove', 'computerMove'])
@pytest.mark.parametrize('seed', [11, 29, 20261106])
def test_seeded_full_games_validate_all_states_moves_and_private_views(name, method, seed):
    logic, _, ctx, current = started(name, seed)
    for step in range(100):
        for viewer in [p['id'] for p in ctx['players']] + [None]:
            view = logic.call('viewFor', current['state'], viewer, ctx=ctx, now=NOW)
            if name == 'spades':
                assert view['hands'] is None
                assert (view['hand'] is None) == (viewer is None)
            elif current['turn'] is not None:
                assert view['oppSecret'] is None and view['reveal'] is None
                assert (view['mySecret'] is None) == (viewer is None)
        if current['turn'] is None:
            break
        pid = current['turn'][0]
        move = logic.call(method, current['state'], pid, ctx=ctx, seed=seed+step, now=NOW)
        current = logic.call('applyMove', current['state'], pid, move,
                             ctx=ctx, seed=seed+step, now=NOW)
        ctx['move_count'] += 1
    assert current['turn'] is None
    assert sum(current['payouts'].values()) == ctx['pot']
    if name == 'spades':
        assert ctx['move_count'] == 65
        assert sum(current['state']['tricksWon']) == 13


@pytest.mark.parametrize('name,moves', [
    ('guess-who', [None, {}, {'kind': 'ask', 'q': True}, {'kind': 'ask', 'q': 14},
                   {'kind': 'ask', 'q': -1}, {'kind': 'ask', 'q': '0'},
                   {'kind': 'guess', 'idx': 24}, {'kind': 'guess', 'idx': 0.5},
                   {'kind': 'guess', 'idx': 1, 'q': 0}]),
    ('spades', [None, {}, {'card': 'AS'}, {'card': '15S'}, {'card': '2X'},
                {'card': 2}, {'collect': False}, {'newGame': 1},
                {'aiMode': 'other'}, {'card': '2S', 'collect': True}]),
])
def test_malformed_move_variants_rejected_before_game_execution(name, moves):
    logic, _, ctx, current = started(name)
    for move in moves:
        with pytest.raises(InvalidMoveError, match='invalid move'):
            logic.call('applyMove', current['state'], current['turn'][0], move,
                       ctx=ctx, now=NOW)


def test_every_spades_control_variant_validates_and_retains_rules():
    logic, _, ctx, current = started('spades')
    for move in [{'aiMode': 'random'}, {'aiMode': 'smart'},
                 {'newGame': True}, {'newGame': True, 'aiMode': 'random'}]:
        result = logic.call('applyMove', deepcopy(current['state']), current['turn'][0],
                            move, ctx=ctx, now=NOW, seed=29)
        assert result['turn'] is not None
        assert sum(map(len, result['state']['hands'])) == 52
        if 'aiMode' in move:
            assert result['state']['aiMode'] == move['aiMode']


@pytest.mark.parametrize('name', ['guess-who', 'spades'])
def test_state_and_view_shapes_reject_corruption_and_private_field_leaks(name):
    logic, schemas, ctx, current = started(name)
    validators = compile_game_schemas(schemas)
    bad = deepcopy(current['state'])
    if name == 'guess-who':
        bad['s'][0] = 24
    else:
        bad['hands'][0][0] = 'AS'
    assert not validators['state'].is_valid(bad)
    spectator = logic.call('viewFor', current['state'], None, ctx=ctx, now=NOW)
    bad_view = deepcopy(spectator)
    if name == 'guess-who':
        bad_view['oppSecret'] = current['state']['s'][1]
    else:
        bad_view['hands'] = current['state']['hands']
    assert not validators['view'].is_valid(bad_view)
    assert not validators['state'].is_valid({**current['state'], 'extra_secret': 1})
    assert not validators['view'].is_valid({**spectator, 'extra_secret': 1})
