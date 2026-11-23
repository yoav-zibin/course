"""Twist Five declares rigid plate turns from its filtered accepted view."""
import json
from pathlib import Path

import pytest

from game_platform.tests.test_declarative_twistfive import BODY, UI, ctx, message, position, tap


@pytest.mark.parametrize('direction,angle,expected', [
    ('clockwise', 0, 90), ('counterclockwise', 0, -90),
    ('clockwise', 270, 360), ('counterclockwise', -270, -360),
])
def test_accepted_own_turn_rotates_plate_and_every_marble_together(direction, angle, expected):
    rules, state = position([0, 7], [6, 35], plates=(angle, 0, 0, 0))
    result = rules.call('applyMove', state, 'p0', {'cell': 1, 'quadrant': 0, 'direction': direction},
                        ctx=ctx(move_count=4), seed=7)
    changed = message(result['state'], seat=0, acting=False)
    changed.update(move_count=5, last_move_player_index=0)
    frame = UI.reduce(changed)
    pieces = {piece['id']: piece for piece in frame['scene']['pieces']}
    rotation, reveal = frame['timeline']['steps']
    assert rotation == [{'piece_id': 'plate-0', 'from': {'rotation': angle}, 'duration_ms': 600}]
    assert pieces['plate-0']['rotation'] == expected
    assert {p['id'] for p in pieces.values() if p.get('parent') == 'plate-0'} == {
        'marble-0', 'marble-1', 'marble-2', 'marble-4'}
    assert reveal == [{'piece_id': 'last-ring', 'from': {'opacity': 0}, 'duration_ms': 0}]
    assert UI.reduce(changed, frame['local_state'])['timeline'] == frame['timeline']
    assert 'make_move' not in frame


def test_local_hole_selection_and_turn_submission_do_not_replay_the_accepted_rotation():
    rules, state = position([0, 7], [6, 35])
    result = rules.call('applyMove', state, 'p0', {'cell': 1, 'quadrant': 0, 'direction': 'clockwise'},
                        ctx=ctx(move_count=4), seed=7)
    changed = message(result['state'], seat=1)
    frame = UI.reduce(changed)
    selected = tap(changed, frame, 'hole-20')
    assert selected['local_state']['pending'] == 20
    assert 'timeline' not in selected and 'make_move' not in selected
    submitted = tap(changed, selected, 'twist-1-counterclockwise')
    assert submitted['make_move'] == {'cell': 20, 'quadrant': 1, 'direction': 'counterclockwise'}
    assert 'timeline' not in submitted


def test_initial_and_winning_placement_without_a_turn_explicitly_settle_immediately():
    _, initial = position([], [])
    assert UI.reduce(message(initial))['animations'] == []
    rules, state = position([0, 1, 2, 3, 20, 26], [14, 15, 21, 27, 33, 35])
    result = rules.call('applyMove', state, 'p0', {'cell': 4}, ctx=ctx(), seed=7)
    assert UI.reduce(message(result['state'], acting=False, status='over'))['animations'] == []


def test_browser_flow_fixture_matches_the_accepted_public_view_and_declared_rotations():
    root = Path(__file__).resolve().parents[1]
    flow = json.loads((root / 'tests/fixtures/declarative/twistfive-animation-flow.json').read_text())
    rules, state = position([0, 7], [6, 35])
    result = rules.call('applyMove', state, 'p0', flow['move'], ctx=ctx(move_count=4), seed=7)
    assert flow['before']['view'] == rules.call('viewFor', state, 'p0', ctx=ctx(), seed=7)
    assert flow['after']['view'] == rules.call('viewFor', result['state'], 'p0', ctx=ctx(), seed=7)
    frame = UI.reduce(flow['after'])
    assert frame['timeline'] == flow['timeline']
    assert BODY.server_code == (root / 'games/declarative/twistfive.server.js').read_text()
