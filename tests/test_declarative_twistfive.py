"""Twist Five (based on Pentago): rules, computer player, presentation and translations."""
import json
import math
import re
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import DeclarativeLogic, validate_response
from game_platform.game_logic import GameLogic, GameLogicError, InvalidMoveError
from game_platform.game_testing import test_server_code as run_random_walks
from game_platform.models import GameRules

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = json.loads((ROOT / 'games/declarative/twistfive.json').read_text())
BODY = GameImport.model_validate(PACKAGE)
PLAYERS = [{'id': f'p{i}', 'kind': 'human', 'display_name': name, 'picture_url': '', 'max_loss': 0, 'active': True}
           for i, name in enumerate(['Ana', 'Bea'])]


def logic():
    return GameLogic(BODY.server_code, game_schemas=BODY.game_schemas())


def ctx(**updates):
    return {'players': PLAYERS, 'pot': 0, 'move_count': 0, **updates}


def position(gold, black, cur=0, plates=(0, 0, 0, 0)):
    game = logic()
    state = game.call('newMatch', ctx=ctx(), seed=1)['state']
    next_id = 0
    for seat, cells in enumerate([gold, black]):
        for cell in cells:
            state['board'][cell] = seat
            state['ids'][cell] = next_id
            next_id += 1
    state.update(cur=cur, next_id=next_id, plates=list(plates))
    return game, state


def test_package_passes_the_full_import_validation():
    prepare(BODY)
    assert {case['kind'] for case in PACKAGE['unit_tests']['cases']} == {'initial', 'intermediate', 'terminal'}
    assert PACKAGE['name'] == 'Twist Five' and PACKAGE['description'].startswith('Based on Pentago.')


def test_seeded_random_walks_always_reach_a_legal_end():
    report = run_random_walks(BODY.server_code, game_schemas=BODY.game_schemas(),
                              rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                                              allows_join_mid_match=False),
                              run_seed=31, max_walks=100, budget_seconds=math.inf, max_moves_per_walk=40,
                              contract=BODY.unit_tests)
    assert report.passed, report.failures
    # Fix coverage by count rather than CI throughput; per-call limits remain enforced.
    # Each walk also fuzzes malformed moves and must reach a legal terminal state.
    assert report.walks_completed == 100 and report.terminal_states == 100


def test_five_by_placement_wins_at_once_and_a_twist_is_then_refused():
    game, state = position([0, 1, 2, 3, 20, 26], [14, 15, 21, 27, 33, 35])
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'cell': 4, 'quadrant': 1, 'direction': 'clockwise'}, ctx=ctx(), seed=1)
    result = game.call('applyMove', state, 'p0', {'cell': 4}, ctx=ctx(), seed=1)
    assert result['turn'] is None and result['state']['winner'] == 0
    assert result['state']['line'] == [0, 1, 2, 3, 4] and result['state']['plates'] == [0, 0, 0, 0]


def test_a_twist_is_required_when_the_placement_does_not_win():
    game, state = position([0], [35], cur=0)
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'cell': 7}, ctx=ctx(), seed=1)


def test_turning_a_plate_completes_five_and_marbles_keep_their_identity():
    game, state = position([0, 1, 2, 9, 30], [6, 7, 13, 25, 31])
    moved_id = state['ids'][9]
    result = game.call('applyMove', state, 'p0', {'cell': 15, 'quadrant': 1, 'direction': 'clockwise'}, ctx=ctx(), seed=1)
    after = result['state']
    assert after['winner'] == 0 and after['line'] == [0, 1, 2, 3, 4]
    assert after['ids'][4] == moved_id and after['plates'] == [0, 90, 0, 0]


def test_a_turn_that_gives_both_players_five_is_a_draw_and_a_full_board_is_a_draw():
    game, state = position([0, 1, 2, 9, 30], [12, 13, 14, 11, 17])
    result = game.call('applyMove', state, 'p0', {'cell': 15, 'quadrant': 1, 'direction': 'clockwise'}, ctx=ctx(), seed=1)
    assert result['turn'] is None and result['state']['winner'] == -1
    # 35 marbles in a pattern without five, last hole filled: draw.
    pattern = [0, 0, 1, 1, 0, 0,  1, 1, 0, 0, 1, 1,  0, 0, 1, 1, 0, 0,  1, 1, 0, 0, 1, 1,  0, 0, 1, 1, 0, 0,  1, 1, 0, 0, 1, -1]
    gold = [i for i, v in enumerate(pattern) if v == 0]
    black = [i for i, v in enumerate(pattern) if v == 1]
    game, state = position(gold, black, cur=1)
    endings = set()
    for q in range(4):
        for direction in ('clockwise', 'counterclockwise'):
            r = game.call('applyMove', state, 'p1', {'cell': 35, 'quadrant': q, 'direction': direction}, ctx=ctx(), seed=1)
            assert r['turn'] is None
            endings.add(r['state']['winner'])
    assert -1 in endings


@pytest.mark.parametrize('player,move', [
    ('p1', {'cell': 7, 'quadrant': 0, 'direction': 'clockwise'}),          # out of turn
    ('p0', {'cell': 0, 'quadrant': 0, 'direction': 'clockwise'}),          # hole taken
    ('p0', {'cell': 36, 'quadrant': 0, 'direction': 'clockwise'}),         # off the board
    ('p0', {'cell': 7, 'quadrant': 4, 'direction': 'clockwise'}),          # no such plate
    ('p0', {'cell': 7, 'quadrant': 0, 'direction': 'sideways'}),           # no such direction
    ('nobody', {'cell': 7, 'quadrant': 0, 'direction': 'clockwise'}),      # not a player
])
def test_illegal_moves_are_rejected_by_the_server(player, move):
    game, state = position([0], [35], cur=0)
    # A stranger is already refused by the platform before the game runs.
    with pytest.raises(InvalidMoveError if player != 'nobody' else (InvalidMoveError, GameLogicError)):
        game.call('applyMove', state, player, move, ctx=ctx(), seed=1)


def test_no_move_is_accepted_after_the_game_ends():
    game, state = position([0, 1, 2, 3, 20, 26], [14, 15, 21, 27, 33, 35])
    over = game.call('applyMove', state, 'p0', {'cell': 4}, ctx=ctx(), seed=1)['state']
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', over, 'p1', {'cell': 5, 'quadrant': 0, 'direction': 'clockwise'}, ctx=ctx(), seed=1)


def test_computer_plays_legally_within_the_time_limit_and_beats_random_play():
    game = logic()
    wins = 0
    for match in range(20):
        result = game.call('newMatch', ctx=ctx(), seed=match)
        for i in range(40):
            pid = result['turn'][0]
            fn = 'computerMove' if pid == f'p{match % 2}' else 'randomMove'
            move = game.call(fn, result['state'], pid, ctx=ctx(move_count=i), seed=match * 97 + i)
            result = game.call('applyMove', result['state'], pid, move, ctx=ctx(move_count=i), seed=match * 97 + i)
            if result['turn'] is None:
                break
        wins += result['state']['winner'] == match % 2
    assert wins >= 19


def test_computer_takes_an_immediate_win_and_blocks_an_immediate_loss():
    game, state = position([0, 1, 2, 3, 20, 26], [14, 15, 21, 27, 33, 35])
    assert game.call('computerMove', state, 'p0', ctx=ctx(), seed=1) == {'cell': 4}
    # Black has four down column D (3, 9, 15, 21); gold caps 33, so only 27 is open.
    game, state = position([0, 7, 30, 33], [3, 9, 15, 21], cur=0)
    move = game.call('computerMove', state, 'p0', ctx=ctx(), seed=2)
    after = game.call('applyMove', state, 'p0', move, ctx=ctx(), seed=2)['state']
    reply = game.call('computerMove', after, 'p1', ctx=ctx(), seed=3)
    final = game.call('applyMove', after, 'p1', reply, ctx=ctx(), seed=3)['state']
    assert final['winner'] != 1


# ---------- presentation ----------

UI = DeclarativeLogic(BODY.declarative_ui)


def message(state, seat=0, acting=True, status='ongoing'):
    view = logic().call('viewFor', state, f'p{seat}', ctx=ctx(), seed=1)
    return {'type': 'state_changed', 'state': view, 'view': view, 'status': status, 'move_count': 3,
            'my_player_index': seat, 'acting_for_player_index': state['cur'] if acting else None,
            'players': [{'player_index': i, 'player_id': p['id'], 'kind': 'human', 'name': p['display_name']} for i, p in enumerate(PLAYERS)],
            'locale': 'en', 'direction': 'ltr', 'strings': {}}


def tap(msg, frame, ident):
    return UI.reduce({'type': 'ui_event', 'event': {'type': 'tap', 'id': ident}, 'state_changed': msg}, frame.get('local_state'))


def test_placement_offers_every_empty_hole_then_eight_large_previewed_arrows():
    game, state = position([0], [35])
    msg = message(state)
    first = UI.reduce(msg)
    validate_response(BODY.declarative_ui, first)
    holes = [t['id'] for t in first['scene']['targets']]
    assert len(holes) == 34 and 'hole-0' not in holes
    second = tap(msg, first, 'hole-14')
    validate_response(BODY.declarative_ui, second)
    arrows = second['scene']['targets']
    assert len(arrows) == 8 and all(t['hit_area']['width'] >= 76 and t['hit_area']['height'] >= 76 for t in arrows)
    assert all(t['asset'] in ('arrow_cw', 'arrow_ccw') and t['aria_label'].startswith('Turn the ') for t in arrows)
    # The plate holding the new marble previews its marbles after the turn.
    tl = next(t for t in arrows if t['id'] == 'twist-0-clockwise')
    assert len(tl['preview']) == 2
    handles = [p for p in second['scene']['pieces'] if p['type'] == 'plate']
    assert len(handles) == 4 and all(p['actions'] == ['rotate'] for p in handles)
    assert all(not p['actions'] for p in second['scene']['pieces'] if p['type'] != 'plate')
    assert 'change' in [c['id'] for c in second['scene']['controls']]


def test_arrow_taps_and_rotate_tools_emit_the_same_twist_move():
    game, state = position([0], [35])
    msg = message(state)
    placed = tap(msg, UI.reduce(msg), 'hole-14')
    assert tap(msg, placed, 'twist-2-counterclockwise')['make_move'] == {'cell': 14, 'quadrant': 2, 'direction': 'counterclockwise'}
    rotated = UI.reduce({'type': 'ui_event', 'event': {'type': 'rotate', 'id': 'plate-3', 'delta': 90}, 'state_changed': msg},
                        placed['local_state'])
    assert rotated['make_move'] == {'cell': 14, 'quadrant': 3, 'direction': 'clockwise'}
    # With a plate selected, every arrow is still a legal destination.
    handle = next(p for p in placed['scene']['pieces'] if p['id'] == 'plate-0')
    assert len(handle['move_targets']) == 8
    dropped = UI.reduce({'type': 'ui_event', 'event': {'type': 'drop', 'id': 'plate-0', 'piece_id': 'plate-0', 'target_id': 'twist-1-clockwise'},
                         'state_changed': msg}, placed['local_state'])
    assert dropped['make_move'] == {'cell': 14, 'quadrant': 1, 'direction': 'clockwise'}
    undone = tap(msg, placed, 'change')
    assert 'make_move' not in undone and len(undone['scene']['targets']) == 34


def test_a_winning_hole_is_placed_without_asking_for_a_turn():
    game, state = position([0, 1, 2, 3, 20, 26], [14, 15, 21, 27, 33, 35])
    msg = message(state)
    assert tap(msg, UI.reduce(msg), 'hole-4')['make_move'] == {'cell': 4}


def test_marbles_ride_their_plate_so_a_turn_animates_rigidly():
    """A marble's local offset must land on its authoritative hole after the plate turns."""
    game, state = position([0, 1, 2, 9, 30], [6, 7, 13, 25, 31])
    after = game.call('applyMove', state, 'p0', {'cell': 16, 'quadrant': 1, 'direction': 'counterclockwise'}, ctx=ctx(), seed=1)['state']
    after = game.call('applyMove', after, 'p1', {'cell': 20, 'quadrant': 1, 'direction': 'counterclockwise'}, ctx=ctx(), seed=1)['state']
    scene = UI.reduce(message(after, seat=0))['scene']
    centers = {q: (105 + 210 * (q & 1), 105 + 210 * (q >> 1)) for q in range(4)}
    for piece in scene['pieces']:
        if not piece['id'].startswith('marble-'):
            continue
        plate = next(p for p in scene['pieces'] if p['id'] == piece['parent'])
        q = int(plate['id'].split('-')[1])
        assert plate['rotation'] == after['plates'][q]
        dx, dy = piece['position']['x'], piece['position']['y']
        angle = math.radians(plate['rotation'])
        x = centers[q][0] + dx * math.cos(angle) - dy * math.sin(angle)
        y = centers[q][1] + dx * math.sin(angle) + dy * math.cos(angle)
        cell = round((y - 35) / 70) * 6 + round((x - 35) / 70)
        identity = int(piece['id'].split('-')[1])
        assert after['ids'][cell] == identity and piece['asset'] == ('gold', 'black')[after['board'][cell]]


def test_spectators_and_waiting_players_get_no_actions_and_the_end_shows_the_line():
    game, state = position([0], [35])
    waiting = UI.reduce(message(state, seat=1, acting=False))['scene']
    assert not waiting['targets'] and all(not p['actions'] for p in waiting['pieces'])
    assert waiting['labels'][0]['text'].startswith('Waiting for Gold')
    game, state = position([0, 1, 2, 3, 20, 26], [14, 15, 21, 27, 33, 35])
    over = game.call('applyMove', state, 'p0', {'cell': 4}, ctx=ctx(), seed=1)['state']
    end = UI.reduce(message(over, seat=1, acting=False, status='over'))['scene']
    assert end['labels'][0]['text'] == 'Gold · Ana wins!' and end['paths'][0]['id'] == 'win-line'
    rings = [p for p in end['pieces'] if p['type'] == 'win_ring']
    assert [p['position']['cell'] for p in rings] == ['0', '1', '2', '3', '4'] and all(p['z'] > 5 for p in rings)


def test_every_language_has_every_string_with_matching_placeholders():
    english = PACKAGE['declarative_ui']['strings']
    for locale, translation in PACKAGE['translations'].items():
        strings = translation['client_strings']
        assert set(strings) == set(english), locale
        for key, source in english.items():
            assert strings[key], (locale, key)
            assert set(re.findall(r'\{\w+\}', strings[key])) == set(re.findall(r'\{\w+\}', source)), (locale, key)
        msg = message(position([0], [35])[1])
        msg.update(locale=locale, strings=strings)
        assert UI.reduce(msg)['scene']['labels'][0]['text'] == strings['place_turn'].replace('{name}', strings['you'].replace('{name}', strings['seat_name'].replace('{color}', strings['gold']).replace('{name}', 'Ana')))
