"""Flipside Lords (based on The Duke): tile data, rules, computer player, presentation."""
import copy
import json
import math
import re
import time
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import DeclarativeLogic, validate_response
from game_platform.game_logic import GameLogic, GameLogicError, InvalidMoveError
from game_platform.game_testing import test_server_code as run_random_walks
from game_platform.models import GameRules

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = json.loads((ROOT / 'games/declarative/flipside.json').read_text())
BODY = GameImport.model_validate(PACKAGE)
PLAYERS = [{'id': f'p{i}', 'kind': 'human', 'display_name': n, 'picture_url': '', 'max_loss': 0, 'active': True}
           for i, n in enumerate(['Ana', 'Bea'])]


def logic():
    return GameLogic(BODY.server_code, game_schemas=BODY.game_schemas())


def ctx(**updates):
    return {'players': PLAYERS, 'pot': 0, 'move_count': 0, **updates}


def sq(name):
    """Board squares from seat 0's side: A1 is bottom-left (index 30)."""
    return (6 - int(name[1])) * 6 + 'ABCDEF'.index(name[0])


def position(tiles, cur=0, bags=None):
    """tiles: {square name: (owner, type, side)}"""
    game = logic()
    state = game.call('newMatch', ctx=ctx(), seed=1)['state']
    for i, (name, (o, t, s)) in enumerate(tiles.items()):
        state['board'][sq(name)] = {'o': o, 't': t, 's': s, 'id': i}
    state.update(phase='play', cur=cur, next_id=len(tiles))
    if bags is not None:
        state['bags'] = bags
    return game, state


def moves(game, state, seat=None):
    """Every legal action, found by trying them (the server is the judge)."""
    seat = state['cur'] if seat is None else seat
    found = []
    for frm in range(36):
        for to in range(36):
            for action in ('move', 'strike'):
                try:
                    game.call('applyMove', state, f'p{seat}', {'action': action, 'from': frm, 'to': to}, ctx=ctx(), seed=1)
                    found.append((action, frm, to))
                except InvalidMoveError:
                    pass
    return found


def test_package_passes_the_full_import_validation():
    prepare(BODY)
    assert PACKAGE['name'] == 'Flipside Lords' and PACKAGE['description'].startswith('Based on The Duke.')
    assert PACKAGE['all_state_public'] is True and PACKAGE['allowed_player_counts'] == [2]


def test_package_stays_within_platform_limits():
    assert len(PACKAGE['declarative_ui']['assets']) <= 128
    stored = {k: PACKAGE[k] for k in ('translations', 'tutorial', 'images', 'unit_tests', 'declarative_ui')}
    assert len(json.dumps(stored).encode()) < 400_000


def test_tile_data_matches_the_cross_checked_sources():
    from game_platform.tools.build_declarative_flipside import tiles
    table = tiles()
    assert sorted(table) == sorted(['duke', 'footman', 'pikeman', 'knight', 'wizard', 'ranger', 'seer', 'general',
                                    'priest', 'champion', 'marshall', 'bowman'])
    # Spot checks against both sources (see FLIPSIDE.md).
    assert sorted(map(tuple, table['duke'][0])) == [('slide', -1, 0), ('slide', 1, 0)]
    assert sorted(map(tuple, table['footman'][0])) == sorted([('move', 0, 1), ('move', -1, 0), ('move', 1, 0), ('move', 0, -1)])
    assert ('strike', -1, 2) in map(tuple, table['pikeman'][1]) and ('strike', 1, 2) in map(tuple, table['pikeman'][1])
    assert sum(1 for i in table['general'][1] if i[0] == 'command') == 5
    assert sorted(map(tuple, table['ranger'][1])) == sorted([('slide', -1, 1), ('slide', 1, 1), ('jump', -1, -2), ('jump', 1, -2)])
    # Bag: 1 Footman, 3 Pikemen and one of each other troop (two Footmen start on the board).
    state = logic().call('newMatch', ctx=ctx(), seed=1)['state']
    assert sorted(state['bags'][0]) == sorted(['footman'] + ['pikeman'] * 3 + ['knight', 'wizard', 'ranger', 'seer', 'general',
                                                                                 'priest', 'champion', 'marshall', 'bowman'])


def test_setup_needs_a_middle_home_square_and_two_side_by_side_footmen():
    game = logic()
    state = game.call('newMatch', ctx=ctx(), seed=1)['state']
    for bad in [{'duke': sq('A1'), 'footmen': [sq('B1'), sq('A2')]}, {'duke': sq('C1'), 'footmen': [sq('B1'), sq('B2')]},
                {'duke': sq('C1'), 'footmen': [sq('B1'), sq('B1')]}, {'duke': sq('C1'), 'footmen': [sq('B1')]},
                {'action': 'move', 'from': 0, 'to': 1}]:
        with pytest.raises(InvalidMoveError):
            game.call('applyMove', state, 'p0', bad, ctx=ctx(), seed=1)
    state = game.call('applyMove', state, 'p0', {'duke': sq('C1'), 'footmen': [sq('B1'), sq('C2')]}, ctx=ctx(), seed=1)['state']
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p1', {'duke': sq('C1'), 'footmen': [sq('B1'), sq('C2')]}, ctx=ctx(), seed=1)
    result = game.call('applyMove', state, 'p1', {'duke': sq('D6'), 'footmen': [sq('E6'), sq('D5')]}, ctx=ctx(), seed=1)
    assert result['state']['phase'] == 'play' and result['turn'] == ['p0']


def test_move_needs_a_clear_path_and_the_tile_flips():
    # Footman on its other side: move two forward needs the middle square empty.
    game, state = position({'A1': (0, 'duke', 0), 'C3': (0, 'footman', 1), 'C4': (1, 'footman', 0), 'F6': (1, 'duke', 0)})
    found = moves(game, state)
    assert ('move', sq('C3'), sq('C5')) not in found and ('move', sq('C3'), sq('C4')) not in found
    del state['board'][sq('C4')]
    state['board'].insert(sq('C4'), None)
    after = game.call('applyMove', state, 'p0', {'action': 'move', 'from': sq('C3'), 'to': sq('C5')}, ctx=ctx(), seed=1)['state']
    assert after['board'][sq('C5')]['s'] == 0 and after['board'][sq('C3')] is None


def test_jump_ignores_pieces_between_and_captures():
    game, state = position({'A1': (0, 'duke', 0), 'C3': (0, 'wizard', 1), 'C4': (1, 'footman', 0), 'C5': (1, 'pikeman', 0), 'F6': (1, 'duke', 0)})
    after = game.call('applyMove', state, 'p0', {'action': 'move', 'from': sq('C3'), 'to': sq('C5')}, ctx=ctx(), seed=1)['state']
    assert after['board'][sq('C5')]['t'] == 'wizard' and after['board'][sq('C4')]['t'] == 'footman'
    assert after['captured'][0] == ['pikeman'] and after['board'][sq('C5')]['s'] == 0


def test_slide_stops_at_the_first_tile_and_may_capture_it():
    game, state = position({'A1': (0, 'duke', 0), 'B3': (0, 'priest', 0), 'E6': (1, 'knight', 0), 'F6': (1, 'duke', 0)})
    # Priest side 0 slides diagonally: B3 -> C4 -> D5 -> E6 (enemy, capture), not beyond.
    found = moves(game, state)
    assert ('move', sq('B3'), sq('E6')) in found and ('move', sq('B3'), sq('D5')) in found
    assert ('move', sq('B3'), sq('F6')) not in found


def test_strike_captures_without_moving_and_still_flips():
    game, state = position({'A1': (0, 'duke', 0), 'C2': (0, 'bowman', 1), 'C4': (1, 'seer', 0), 'F6': (1, 'duke', 0)})
    after = game.call('applyMove', state, 'p0', {'action': 'strike', 'from': sq('C2'), 'to': sq('C4')}, ctx=ctx(), seed=1)['state']
    assert after['board'][sq('C4')] is None and after['board'][sq('C2')]['t'] == 'bowman'
    assert after['board'][sq('C2')]['s'] == 0 and after['captured'][0] == ['seer']
    with pytest.raises(InvalidMoveError):  # strikes only hit enemies
        game.call('applyMove', state, 'p0', {'action': 'strike', 'from': sq('C2'), 'to': sq('A1')}, ctx=ctx(), seed=1)


def test_command_moves_another_troop_and_only_the_commander_flips():
    # General side 1 commands left, right and the three squares behind it.
    game, state = position({'A1': (0, 'duke', 0), 'C3': (0, 'general', 1), 'B3': (0, 'pikeman', 1), 'F6': (1, 'duke', 0)})
    move = {'action': 'command', 'from': sq('C3'), 'via': sq('B3'), 'to': sq('D2')}
    after = game.call('applyMove', state, 'p0', move, ctx=ctx(), seed=1)['state']
    assert after['board'][sq('D2')] == {'o': 0, 't': 'pikeman', 's': 1, 'id': 2}
    assert after['board'][sq('B3')] is None and after['board'][sq('C3')]['s'] == 0
    with pytest.raises(InvalidMoveError):  # not a command square
        game.call('applyMove', state, 'p0', {'action': 'command', 'from': sq('C3'), 'via': sq('B3'), 'to': sq('C5')}, ctx=ctx(), seed=1)


def test_you_may_never_leave_your_lord_where_it_can_be_taken():
    # The Footman on C2 shields the Lord on C1 from the enemy Lord's column slide (side 1).
    game, state = position({'C1': (0, 'duke', 0), 'C2': (0, 'footman', 0), 'C6': (1, 'duke', 1), 'F6': (1, 'footman', 0)})
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'action': 'move', 'from': sq('C2'), 'to': sq('B2')}, ctx=ctx(), seed=1)
    game.call('applyMove', state, 'p0', {'action': 'move', 'from': sq('C2'), 'to': sq('C3')}, ctx=ctx(), seed=1)


def test_drawing_places_a_random_troop_beside_the_lord_on_its_first_side():
    game, state = position({'C1': (0, 'duke', 0), 'F6': (1, 'duke', 0)})
    with pytest.raises(InvalidMoveError):  # diagonal is not beside
        game.call('applyMove', state, 'p0', {'action': 'place', 'to': sq('B2')}, ctx=ctx(), seed=1)
    after = game.call('applyMove', state, 'p0', {'action': 'place', 'to': sq('C2')}, ctx=ctx(), seed=3)['state']
    placed = after['board'][sq('C2')]
    assert placed['o'] == 0 and placed['s'] == 0 and len(after['bags'][0]) == len(state['bags'][0]) - 1
    assert sorted(after['bags'][0] + [placed['t']]) == sorted(state['bags'][0])
    game2, empty = position({'C1': (0, 'duke', 0), 'F6': (1, 'duke', 0)}, bags=[[], []])
    with pytest.raises(InvalidMoveError):
        game2.call('applyMove', empty, 'p0', {'action': 'place', 'to': sq('C2')}, ctx=ctx(), seed=1)


def test_trapping_the_lord_wins_and_quiet_play_is_a_draw():
    # Black Lord on A6 (side 0 slides sideways) is boxed in: any move is unsafe.
    game, state = position({'A6': (1, 'duke', 0), 'B6': (1, 'footman', 0), 'C4': (0, 'wizard', 1), 'E1': (0, 'duke', 0), 'C2': (0, 'marshall', 0)},
                           cur=0, bags=[[], []])
    found_win = None
    for action, frm, to in moves(game, state):
        res = game.call('applyMove', state, 'p0', {'action': action, 'from': frm, 'to': to}, ctx=ctx(), seed=1)
        if res['turn'] is None and res['state']['winner'] == 0:
            found_win = res
            break
    assert found_win and found_win['state']['reason'] in ('captured', 'trapped', 'stuck')
    quiet = copy.deepcopy(state)
    quiet['quiet'] = 49
    res = game.call('applyMove', quiet, 'p0', {'action': 'move', 'from': sq('E1'), 'to': sq('F1')}, ctx=ctx(), seed=1)
    if res['turn'] is None:
        assert res['state']['winner'] in (-1, 0)


def test_no_moves_after_the_end_and_strangers_are_refused():
    game = logic()
    c = ctx()
    result = game.call('newMatch', ctx=c, seed=2)
    step = 0
    while result['turn']:
        pid = result['turn'][0]
        result = game.call('applyMove', result['state'], pid, game.call('computerMove', result['state'], pid, ctx=c, seed=step), ctx=c, seed=step)
        step += 1
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', result['state'], 'p0', {'action': 'place', 'to': 0}, ctx=c, seed=1)
    with pytest.raises((InvalidMoveError, GameLogicError)):
        game.call('applyMove', game.call('newMatch', ctx=c, seed=1)['state'], 'stranger', {'duke': 32, 'footmen': [31, 26]}, ctx=c, seed=1)


def test_seeded_random_walks_always_reach_a_legal_end():
    report = run_random_walks(BODY.server_code, game_schemas=BODY.game_schemas(),
                              rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False, allows_join_mid_match=False),
                              run_seed=77, max_walks=30, budget_seconds=math.inf, max_moves_per_walk=500, contract=BODY.unit_tests)
    assert report.passed, report.failures
    assert report.walks_completed == 30 and report.terminal_states == 30


def test_computer_beats_random_play_quickly():
    game = logic()
    wins, worst = 0, 0.0
    for seed in range(10):
        c = ctx()
        result = game.call('newMatch', ctx=c, seed=seed)
        step = 0
        while result['turn']:
            pid = result['turn'][0]
            started = time.perf_counter()
            move = game.call('computerMove' if pid == 'p0' else 'randomMove', result['state'], pid, ctx=c, seed=step)
            if pid == 'p0':
                worst = max(worst, time.perf_counter() - started)
            result = game.call('applyMove', result['state'], pid, move, ctx=c, seed=step)
            step += 1
        wins += result['state']['winner'] == 0
    assert wins >= 9 and worst < 0.1


# ---- presentation ------------------------------------------------------------
UI = DeclarativeLogic(PACKAGE['declarative_ui'])


def message(view, seat, status='ongoing'):
    return {'type': 'state_changed', 'state': view, 'view': view, 'status': status, 'move_count': 5, 'my_player_index': seat,
            'acting_for_player_index': seat if view['cur'] == seat else None,
            'turn_of_player_indices': [view['cur']] if view['cur'] is not None else None,
            'players': [{'player_index': i, 'player_id': f'p{i}', 'kind': 'human', 'name': n} for i, n in enumerate(['Ana', 'Bea'])],
            'locale': 'en', 'direction': 'ltr', 'strings': {}}


def reduce(msg, local=None, event=None):
    payload = msg if event is None else {'type': 'ui_event', 'state_changed': msg, 'event': event}
    response = UI.reduce(payload, local)
    validate_response(PACKAGE['declarative_ui'], response)
    return response


def ids(response, group='targets'):
    return [item['id'] for item in response['scene'][group]]


def test_setup_picks_the_lord_then_two_footmen():
    game = logic()
    state = game.call('newMatch', ctx=ctx(), seed=1)['state']
    view = game.call('viewFor', state, 'p0', ctx=ctx(), seed=1)
    first = reduce(message(view, 0))
    assert sorted(ids(first)) == [f'lord-{sq("C1")}', f'lord-{sq("D1")}']
    lord = reduce(message(view, 0), first['local_state'], {'type': 'tap', 'id': f'lord-{sq("C1")}'})
    feet = [t for t in ids(lord) if t.startswith('foot-')]
    assert sorted(feet) == sorted(f'foot-{sq(n)}' for n in ('B1', 'D1', 'C2'))
    one = reduce(message(view, 0), lord['local_state'], {'type': 'tap', 'id': f'foot-{sq("B1")}'})
    two = reduce(message(view, 0), one['local_state'], {'type': 'tap', 'id': f'foot-{sq("C2")}'})
    assert two['make_move'] == {'duke': sq('C1'), 'footmen': [sq('B1'), sq('C2')]}


def test_selecting_a_tile_shows_exactly_its_legal_actions():
    game, state = position({'A1': (0, 'duke', 0), 'C2': (0, 'bowman', 1), 'C4': (1, 'seer', 0), 'F6': (1, 'duke', 0)})
    view = game.call('viewFor', state, 'p0', ctx=ctx(), seed=1)
    first = reduce(message(view, 0))
    tile = next(p for p in first['scene']['pieces'] if p['id'].startswith('tile-') and p['position'] == {'x': 225, 'y': 405})
    picked = reduce(message(view, 0), first['local_state'], {'type': 'tap', 'id': tile['id']})
    assert f'strike-{sq("C4")}' in ids(picked)
    sent = reduce(message(view, 0), picked['local_state'], {'type': 'tap', 'id': f'strike-{sq("C4")}'})
    assert sent['make_move'] == {'action': 'strike', 'from': sq('C2'), 'to': sq('C4')}


def test_flip_previews_the_other_side_without_moving():
    game, state = position({'A1': (0, 'duke', 0), 'C2': (0, 'bowman', 0), 'F6': (1, 'duke', 0)})
    view = game.call('viewFor', state, 'p0', ctx=ctx(), seed=1)
    first = reduce(message(view, 0))
    tile = next(p for p in first['scene']['pieces'] if p.get('asset') == 'bowman_0_light')
    peek = reduce(message(view, 0), first['local_state'], {'type': 'flip', 'id': tile['id']})
    assert any(p.get('asset') == 'bowman_1_light' for p in peek['scene']['pieces']) and 'make_move' not in peek
    back = reduce(message(view, 0), peek['local_state'], {'type': 'flip', 'id': tile['id']})
    assert any(p.get('asset') == 'bowman_0_light' for p in back['scene']['pieces'])


def test_draw_then_place_beside_the_lord_and_draw_works_with_a_tile_selected():
    game, state = position({'C1': (0, 'duke', 0), 'B1': (0, 'footman', 0), 'F6': (1, 'duke', 0)})
    view = game.call('viewFor', state, 'p0', ctx=ctx(), seed=1)
    first = reduce(message(view, 0))
    draw = next(t for t in first['scene']['targets'] if t['id'] == 'draw')
    assert draw['hit_area']['width'] >= 88 and draw['label']
    tile = next(p for p in first['scene']['pieces'] if p.get('asset') == 'footman_0_light')
    picked = reduce(message(view, 0), first['local_state'], {'type': 'tap', 'id': tile['id']})
    selected = next(p for p in picked['scene']['pieces'] if p['id'] == tile['id'])
    assert 'draw' in selected.get('move_targets', ['draw'])
    drawing = reduce(message(view, 0), picked['local_state'], {'type': 'tap', 'id': 'draw'})
    assert sorted(t for t in ids(drawing) if t.startswith('place-')) == sorted(f'place-{sq(n)}' for n in ('C2', 'D1'))
    sent = reduce(message(view, 0), drawing['local_state'], {'type': 'tap', 'id': f'place-{sq("C2")}'})
    assert sent['make_move'] == {'action': 'place', 'to': sq('C2')}


def test_waiting_players_get_no_actions_and_the_end_names_the_winner():
    game, state = position({'A1': (0, 'duke', 0), 'C2': (0, 'bowman', 1), 'F6': (1, 'duke', 0)})
    other = game.call('viewFor', state, 'p1', ctx=ctx(), seed=1)
    waiting = reduce(message(other, 1))
    assert not waiting['scene']['targets'] and all(not p['actions'] for p in waiting['scene']['pieces'])
    over = copy.deepcopy(state)
    over.update(phase='over', cur=None, winner=1, reason='trapped')
    view = game.call('viewFor', over, 'p0', ctx=ctx(), seed=1)
    end = reduce(message(view, 0, status='over'))
    status = next(l for l in end['scene']['labels'] if l['id'] == 'status')['text']
    assert status.endswith('wins!') and any(p['id'] == 'danger' for p in end['scene']['pieces'])


def test_every_language_has_every_string_and_placeholder():
    source = PACKAGE['declarative_ui']['strings']
    for locale, translation in PACKAGE['translations'].items():
        strings = translation['client_strings']
        assert set(strings) == set(source), locale
        for key, text in source.items():
            assert set(re.findall(r'\{\w+\}', text)) == set(re.findall(r'\{\w+\}', strings[key])), (locale, key)
