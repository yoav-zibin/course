"""Rules and presentation checks for the edge-target games: Sim, Paper Soccer, Hackenbush, Cartographers."""
import json
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.tools.publish_declarative_games import scene_event

EXAMPLES = Path(__file__).resolve().parents[1] / 'games' / 'declarative'
KINDS = ('sim', 'paper_soccer', 'hackenbush', 'cartographers', 'dots_boxes')
CTX = {'players': [{'id': 'a', 'kind': 'human', 'display_name': 'A', 'picture_url': '', 'max_loss': 0, 'active': True},
                   {'id': 'b', 'kind': 'human', 'display_name': 'B', 'picture_url': '', 'max_loss': 0, 'active': True}],
       'pot': 10, 'move_count': 0}


def load(kind):
    return GameImport.model_validate(json.loads((EXAMPLES / (kind + '.json')).read_text(encoding='utf-8')))


def engine(kind):
    body = load(kind)
    return GameLogic(body.server_code, game_schemas=body.game_schemas()), DeclarativeLogic(body.declarative_ui)


def start(game, seed=3):
    return game.call('newMatch', ctx=dict(CTX), seed=seed)['state']


def play(game, state, who, move, seed=5):
    return game.call('applyMove', state, who, move, ctx=dict(CTX), seed=seed)


def frame(game, ui, state, viewer='a', local=None, event=None):
    view = game.call('viewFor', state, viewer, ctx=dict(CTX), seed=1)
    seat = 0 if viewer == 'a' else 1 if viewer == 'b' else None
    message = {'type': 'state_changed', 'view': view, 'status': 'ongoing' if not state['over'] else 'over',
               'acting_for_player_index': seat if state['turn'] == seat and not state['over'] else None,
               'my_player_index': seat, 'move_count': 4, 'strings': {}, 'locale': 'en', 'direction': 'ltr', 'players': []}
    if event:
        return ui.reduce({'type': 'ui_event', 'event': event, 'state_changed': message}, local), message
    return ui.reduce(message, local), message


@pytest.mark.parametrize('kind', KINDS)
def test_only_the_player_to_move_is_offered_targets(kind):
    game, ui = engine(kind)
    state = start(game)
    mover, _ = frame(game, ui, state, 'a')
    waiting, _ = frame(game, ui, state, 'b')
    spectator, _ = frame(game, ui, state, None)
    assert mover['scene']['targets'] or mover['scene']['controls']
    for scene in (waiting['scene'], spectator['scene']):
        assert not scene['targets'] and not scene['controls']


def test_sim_crossing_diagonals_get_distinct_targets():
    game, ui = engine('sim')
    scene = frame(game, ui, start(game))[0]['scene']
    assert len(scene['targets']) == 15
    spots = {(round(target['position']['x']), round(target['position']['y'])) for target in scene['targets']}
    assert len(spots) == 15
    # The three long diagonals cross at the hexagon centre, yet each keeps its own marker.
    centre = [target for target in scene['targets'] if target['aria_label'] in ('Line 1–4', 'Line 2–5', 'Line 3–6')]
    assert len(centre) == 3 and len({(round(t['position']['x']), round(t['position']['y'])) for t in centre}) == 3


def test_sim_completing_own_triangle_loses_and_pays_the_other_player():
    game, _ = engine('sim')
    state = start(game)
    # Edges 0-1, 0-2, 1-2 are indices 0, 1, 5. Player b fills filler edges between player a's moves.
    sequence = [('a', 0), ('b', 2), ('a', 1), ('b', 3), ('a', 5)]
    result = {'state': state}
    for who, edge in sequence:
        result = play(game, result['state'], who, {'edge': edge})
    assert result['state']['over'] and result['state']['winner'] == 1
    assert result['turn'] is None and result['payouts'] == {'b': 10}
    with pytest.raises(InvalidMoveError):
        play(game, state, 'a', {'edge': 0, 'extra': 1})
    with pytest.raises(InvalidMoveError):
        play(game, state, 'b', {'edge': 0})


def test_paper_soccer_bounce_keeps_the_turn_and_goal_wins():
    game, ui = engine('paper_soccer')
    state = start(game)
    assert state['ball'] == 5 * 9 + 4
    # Fresh points pass the turn.
    result = play(game, state, 'a', {'to': 4 * 9 + 4})
    assert result['state']['turn'] == 1 and result['turn'] == ['b']
    result = play(game, result['state'], 'b', {'to': 3 * 9 + 4})
    result = play(game, result['state'], 'a', {'to': 2 * 9 + 4})
    result = play(game, result['state'], 'b', {'to': 1 * 9 + 4})
    # The goal line is already drawn, so reaching it bounces: player a moves again.
    result = play(game, result['state'], 'a', {'to': 4})
    assert result['state']['ball'] == 4 and result['state']['turn'] == 0 and result['turn'] == ['a']
    # A line already drawn cannot be drawn twice, in either direction.
    with pytest.raises(InvalidMoveError):
        play(game, result['state'], 'a', {'to': 1 * 9 + 4})
    # The goal mouth is open: stepping through it wins for the attacker.
    finished = play(game, result['state'], 'a', {'to': 99})
    assert finished['state']['over'] and finished['state']['winner'] == 0
    assert finished['turn'] is None and finished['payouts'] == {'a': 10}


def test_paper_soccer_sidelines_are_walls_but_diagonals_off_them_are_open():
    game, ui = engine('paper_soccer')
    state = start(game)
    state['ball'] = 0
    moves = {move['to'] for move in game.call('viewFor', state, 'a', ctx=dict(CTX), seed=1)['legal']}
    assert moves == {10}


def test_paper_soccer_points_are_flexible_targets_on_a_graph_board():
    game, ui = engine('paper_soccer')
    scene = frame(game, ui, start(game))[0]['scene']
    assert {target['position']['cell'] for target in scene['targets']} == {'39', '40', '41', '48', '50', '57', '58', '59'}
    assert all('hit_area' in target for target in scene['targets'])
    assert any(path['id'] == 'pitch' for path in scene['paths'])


def test_hackenbush_cut_removes_branches_that_lose_the_ground():
    game, ui = engine('hackenbush')
    state = start(game)
    # Blue (player 1) cuts the first blue stalk's root edge: its whole stalk falls.
    with pytest.raises(InvalidMoveError):
        play(game, state, 'a', {'edge': 1})  # Edge 1 is red.
    result = play(game, state, 'a', {'edge': 0})
    alive = result['state']['alive']
    assert alive[:5] == [0, 0, 0, 0, 0] and all(alive[5:])
    scene = frame(game, ui, result['state'], 'b')[0]['scene']
    assert scene['targets'] and all(target['id'].startswith('edge_') for target in scene['targets'])
    assert {path['id'] for path in scene['paths'] if path['id'].startswith('branch_')} == {f'branch_{i}' for i in range(5, 17)}


def test_hackenbush_player_without_a_branch_to_cut_loses():
    game, _ = engine('hackenbush')
    state = start(game)
    state['alive'] = [1 if edge in (0, 1) else 0 for edge in range(17)]
    result = play(game, state, 'a', {'edge': 0})
    assert result['state']['over'] and result['state']['winner'] == 0 and result['payouts'] == {'a': 10}


def test_cartographers_shapes_can_be_rotated_and_placed_with_previews():
    game, ui = engine('cartographers')
    state = start(game)
    first, message = frame(game, ui, state)
    scene = first['scene']
    assert first['local_state']['rot'] == 0
    assert scene['targets'] and all(target['preview'] for target in scene['targets'])
    assert any(control['id'] == 'rotate' for control in scene['controls']) == (len({m['rot'] for m in message['view']['legal']}) > 1)
    if any(control['id'] == 'rotate' for control in scene['controls']):
        turned, _ = frame(game, ui, state, 'a', first['local_state'], {'type': 'tap', 'id': 'rotate'})
        assert turned['local_state']['rot'] != first['local_state']['rot']
        assert 'make_move' not in turned
    for move in message['view']['legal'][:25]:
        emitted = scene_event(ui, message, first, move)
        assert emitted.get('make_move') == move


def test_cartographers_players_fill_their_own_maps_and_seasons_are_scored():
    game, ui = engine('cartographers')
    state = start(game)
    assert len(state['deck']) == 12 and state['maps'][0] == state['maps'][1]
    result = {'state': state}
    for step in range(24):
        who = 'a' if result['state']['turn'] == 0 else 'b'
        move = game.call('computerMove', result['state'], who, ctx=dict(CTX), seed=step + 1)
        result = play(game, result['state'], who, move, seed=step + 1)
        if step == 5:
            assert [len(season) for season in result['state']['seasons']] == [1, 1]
        if result['turn'] is None:
            break
    assert result['state']['over'] and result['turn'] is None
    assert sum(result['payouts'].values()) == 10
    assert all(len(season) == 4 for season in result['state']['seasons'])
    assert result['state']['maps'][0] != result['state']['maps'][1]
    mountains = [i for i, v in enumerate(state['maps'][0]) if v == 4]
    assert all(result['state']['maps'][seat][i] == 4 for seat in (0, 1) for i in mountains)


def test_cartographers_blocked_players_pass_and_malformed_moves_are_rejected():
    game, ui = engine('cartographers')
    state = start(game)
    state['maps'][0] = [4] * 49
    legal = game.call('viewFor', state, 'a', ctx=dict(CTX), seed=1)['legal']
    assert legal == [{'cell': -1, 'rot': 0}]
    scene = frame(game, ui, state)[0]['scene']
    assert [control['label'] for control in scene['controls']] == ['Pass (no room)'] and not scene['targets']
    assert play(game, state, 'a', {'cell': -1, 'rot': 0})['turn'] == ['b']
    fresh = start(game)
    for bad in ({'cell': 0, 'rot': 9}, {'cell': 99, 'rot': 0}, {'cell': 0}, {'rot': 0}):
        with pytest.raises(InvalidMoveError):
            play(game, fresh, 'a', bad)


def test_dots_boxes_closing_a_box_claims_it_and_keeps_the_turn():
    game, ui = engine('dots_boxes')
    state = start(game)
    # Box 0 has sides 0 (top), 4 (bottom), 20 (left) and 21 (right).
    result = {'state': state}
    for who, edge in [('a', 0), ('b', 4), ('a', 20)]:
        result = play(game, result['state'], who, {'edge': edge})
    assert result['state']['turn'] == 1 and result['state']['boxes'][0] == -1
    result = play(game, result['state'], 'b', {'edge': 21})
    assert result['state']['boxes'][0] == 1 and result['state']['turn'] == 1 and result['turn'] == ['b']
    scene = frame(game, ui, result['state'], 'b')[0]['scene']
    assert len(scene['targets']) == 36 and all('label' not in target for target in scene['targets']) and any(piece['id'] == 'box_0' for piece in scene['pieces'])
    with pytest.raises(InvalidMoveError):
        play(game, result['state'], 'b', {'edge': 21})
    with pytest.raises(InvalidMoveError):
        play(game, result['state'], 'a', {'edge': 1})


def test_dots_boxes_game_ends_with_the_larger_box_count():
    game, _ = engine('dots_boxes')
    result = {'state': start(game)}
    for step in range(80):
        who = 'a' if result['state']['turn'] == 0 else 'b'
        result = play(game, result['state'], who, game.call('computerMove', result['state'], who, ctx=dict(CTX), seed=step + 1), seed=step + 1)
        if result['turn'] is None:
            break
    boxes = result['state']['boxes']
    assert result['state']['over'] and -1 not in boxes
    mine = boxes.count(0)
    assert result['state']['winner'] == (-1 if mine == 8 else 0 if mine > 8 else 1)
