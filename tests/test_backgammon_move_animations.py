"""Accepted backgammon routes drive pure, reloadable presentation paths."""
import copy
import json
from pathlib import Path

import pytest

from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_logic import GameLogic
from game_platform.tests.test_backgammon_opening_undo_cube import board
from game_platform.tests.test_declarative_backgammon import context
from game_platform.tests.test_declarative_examples import message
from game_platform.tools.build_declarative_backgammon import source_schemas

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope='module')
def games():
    payload = json.loads((ROOT / 'games/declarative/backgammon.json').read_text())
    return GameLogic(payload['server_code'], game_schemas=source_schemas()), DeclarativeLogic(payload['declarative_ui'])


def apply(games, own, enemy, dice, source, target, bar=0):
    rules, ui = games
    ctx = context()
    state = board(rules, ctx, own, enemy, dice, bar=bar)
    original = copy.deepcopy(state)
    previous = ui.reduce(message(rules, {'state': state, 'turn': ['a']}, ctx, 'b'))
    result = rules.call('applyMove', state, 'a', {'action': 'move', 'from': source, 'to': target}, ctx=ctx, seed=13)
    assert state == original
    changed = message(rules, result, {**ctx, 'move_count': 1}, 'b')
    assert changed['view']['last_move'] == result['state']['last_move']
    assert changed['view']['last_move']['before'] == {key: state[key] for key in ('owner', 'cnt', 'bar', 'off')}
    frame = ui.reduce(changed, previous['local_state'])
    return changed, frame, previous


def final_endpoints(frame):
    pieces = {piece['id']: piece for piece in frame['scene']['pieces']}
    endings = {}
    for animation in frame['last_move_animations']:
        piece = animation['piece_id']
        # Existing Piece.z works on installed hosts predating animation.z.
        assert pieces[piece]['z'] == 100000
        assert set(animation) <= {'piece_id', 'path', 'duration_ms'}
        if piece in endings:
            assert animation['path'][0] == endings[piece]
        endings[piece] = animation['path'][-1]
    for piece, ending in endings.items():
        assert ending == {key: pieces[piece][key] for key in ('board', 'position')}


def test_combined_doubles_keep_each_authoritative_stop_and_interleave_hits(games):
    changed, frame, before = apply(games, {9: 1}, {8: 1, 6: 1, 23: 13}, [1, 1, 1, 1], 9, 5)
    assert changed['view']['last_move']['steps'] == [
        {'from': 9, 'to': 8}, {'from': 8, 'to': 7}, {'from': 7, 'to': 6}, {'from': 6, 'to': 5}]
    mover = before['local_state']['stacks'][0]['9'][-1]
    first_hit = before['local_state']['stacks'][1]['8'][-1]
    second_hit = before['local_state']['stacks'][1]['6'][-1]
    assert [entry['piece_id'] for entry in frame['last_move_animations']] == [
        mover, first_hit, mover, mover, second_hit, mover]
    assert frame['last_move_animations'][1]['path'][-1]['position']['x'] == 336
    final_endpoints(frame)
    repeated = games[1].reduce(changed, frame['local_state'])
    assert repeated['last_move_animations'] == frame['last_move_animations']


def test_forced_combined_route_matches_the_only_safe_order(games):
    changed, frame, _ = apply(games, {9: 1}, {5: 2, 8: 1, 23: 12}, [1, 4], 9, 4)
    assert changed['view']['last_move']['steps'] == [{'from': 9, 'to': 8}, {'from': 8, 'to': 4}]
    assert [entry['piece_id'].split('_')[1] for entry in frame['last_move_animations']] == ['0', '1', '0']
    final_endpoints(frame)


@pytest.mark.parametrize('own,enemy,dice,source,target,bar', [
    ({6: 1}, {5: 1, 23: 14}, [1, 2], 6, 5, 0),
    ({9: 1}, {23: 15}, [1, 1, 1, 1], 9, 5, 0),
    ({}, {0: 15}, [1, 2], 'bar', 21, 1),
    ({0: 1, 1: 1}, {20: 15}, [1, 2], 0, 'off', 0),
    ({20: 15}, {0: 15}, [1, 2], 20, 19, 0),
])
def test_reload_derives_complete_paths_from_filtered_view_without_local_state(games, own, enemy, dice, source, target, bar):
    changed, frame, _ = apply(games, own, enemy, dice, source, target, bar)
    mounted = games[1].reduce(changed)
    assert mounted['last_move_animations']
    final_endpoints(frame)
    final_endpoints(mounted)
    if target == 'off':
        assert frame['last_move_animations'][0]['path'][0]['board'] == 'main'
        assert frame['last_move_animations'][0]['path'][-1]['board'] == 'off'


def test_nonchecker_commands_replace_move_metadata_and_legacy_views_fall_back(games):
    rules, ui = games
    ctx = context()
    state = rules.call('newMatch', ctx=ctx, seed=7)['state']
    result = rules.call('applyMove', state, 'a', {'action': 'configure', 'difficulty': 1, 'goal': 5, 'cube_enabled': True}, ctx=ctx, seed=7)
    changed = message(rules, result, {**ctx, 'move_count': 1}, 'b')
    assert changed['view']['last_move'] == {'seat': 0, 'move_count': 1, 'steps': []}
    assert ui.reduce(changed)['last_move_animations'] == []
    legacy = copy.deepcopy(changed)
    legacy['view'].pop('last_move')
    assert ui.reduce(legacy)['last_move_animations'] is None
    assert all(piece.get('z', 0) < 100000 for piece in ui.reduce(legacy)['scene']['pieces'])


def test_movers_hits_and_stack_settling_draw_above_board_decoration(games):
    _, frame, _ = apply(games, {9: 1}, {8: 1, 6: 1, 23: 13}, [1, 1, 1, 1], 9, 5)
    animated = {entry['piece_id'] for entry in frame['last_move_animations']}
    assert animated
    for piece in frame['scene']['pieces']:
        assert (piece.get('z', 0) == 100000) == (piece['id'] in animated)
    assert {piece['type'] for piece in frame['scene']['pieces'] if piece['id'] in animated} <= {'p0', 'p1', 'p0_off', 'p1_off'}


def test_help_panel_keeps_control_after_an_animated_move(games):
    changed, _, _ = apply(games, {9: 1}, {8: 1, 23: 14}, [1, 2], 9, 8)
    changed['my_player_index'] = changed['acting_for_player_index'] = 0
    assert changed['view']['cur'] == 0
    ui = games[1]
    frame = ui.reduce(changed)
    help_frame = ui.reduce({'type': 'ui_event', 'state_changed': changed,
                            'event': {'type': 'tap', 'id': 'help'}}, frame['local_state'])
    panel = next(piece for piece in help_frame['scene']['pieces'] if piece['id'] == 'help_panel')
    checkers = [piece for piece in help_frame['scene']['pieces'] if piece['id'].startswith('checker_')]
    assert checkers and all(piece['z'] < panel['z'] for piece in checkers)
    assert not help_frame['scene']['targets']
