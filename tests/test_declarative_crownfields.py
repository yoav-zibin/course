"""Crownfields (based on Kingdomino): rules, data, computer player, presentation and translations."""
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
PACKAGE = json.loads((ROOT / 'games/declarative/crownfields.json').read_text())
BODY = GameImport.model_validate(PACKAGE)
NAMES = ['Ana', 'Bea', 'Cai', 'Dev']
SIZE, KEEP = 9, 40


def players(n):
    return [{'id': f'p{i}', 'kind': 'human', 'display_name': NAMES[i], 'picture_url': '', 'max_loss': 0, 'active': True}
            for i in range(n)]


def logic():
    return GameLogic(BODY.server_code, game_schemas=BODY.game_schemas())


def ctx(n=2, **updates):
    return {'players': players(n), 'pot': 0, 'move_count': 0, **updates}


def walk(game, n, seed, chooser='randomMove'):
    c = ctx(n)
    result = game.call('newMatch', ctx=c, seed=seed)
    for step in range(300):
        if result['turn'] is None:
            return
        c['move_count'] = step
        state, pid = result['state'], result['turn'][0]
        move = game.call(chooser, state, pid, ctx=c, seed=seed * 1000 + step)
        result = game.call('applyMove', state, pid, move, ctx=c, seed=seed * 1000 + step)
        yield state, pid, move, result
    raise AssertionError('game did not end')


def tiles():
    from game_platform.tools.build_declarative_crownfields import tiles as read
    return read()


def test_package_passes_the_full_import_validation():
    prepare(BODY)
    assert PACKAGE['name'] == 'Crownfields' and PACKAGE['description'].startswith('Based on Kingdomino.')
    assert PACKAGE['allowed_player_counts'] == [2, 3, 4]
    # The order of the face-down pile is private.
    assert PACKAGE['all_state_public'] is False


def test_package_stays_within_platform_limits():
    assert len(PACKAGE['declarative_ui']['assets']) <= 128
    stored = {key: PACKAGE[key] for key in ('translations', 'tutorial', 'images', 'unit_tests', 'declarative_ui')}
    assert len(json.dumps(stored).encode()) < 400_000


def test_the_48_tiles_match_the_published_terrain_and_crown_counts():
    table = tiles()
    assert len(table) == 48
    squares, crowns = [0] * 6, [0] * 6
    for halves in table:
        for terrain, count in halves:
            squares[terrain] += 1
            crowns[terrain] += count
    # wheat, forest, lake, meadow, marsh, mine
    assert squares == [26, 22, 18, 14, 10, 6]
    assert crowns == [5, 6, 6, 6, 6, 10]
    # Spot checks: the plainest and the richest tiles.
    assert table[0] == [[0, 0], [0, 0]] and table[47] == [[0, 0], [5, 3]]
    # Numbers grow with value: no crowns before 19, three-crown mines last.
    assert all(c == 0 for halves in table[:18] for _, c in halves)


@pytest.mark.parametrize('count, used, kings', [(2, 24, 4), (3, 36, 3), (4, 48, 4)])
def test_setup_uses_the_official_tile_and_king_counts(count, used, kings):
    game = logic()
    state = game.call('newMatch', ctx=ctx(count), seed=5)['state']
    assert len(state['pile']) + len(state['next']) == used and len(state['kings']) == kings
    assert [t['n'] for t in state['next']] == sorted(t['n'] for t in state['next'])
    assert sorted(state['setup_order']) == list(range(kings)) and state['stage'] == 'pick'


def test_rounds_follow_the_row_order_and_everyone_places_twelve_tiles():
    game = logic()
    for n in (2, 3, 4):
        for seed in range(1, 6):
            steps = list(walk(game, n, seed))
            for state, pid, move, result in steps:
                s = result['state']
                if s['phase'] == 'play' and s['stage'] == 'place' and s['pos'] == 0 and state['phase'] == 'setup':
                    # The first king to act holds the lowest tile.
                    assert s['king'] == s['row'][0]['king']
                if 'pick' in move:
                    picked = [t for t in s['next'] if t['king'] is not None]
                    assert len(picked) == len(set(t['king'] for t in picked))
            final = steps[-1][3]['state']
            assert final['phase'] == 'over'
            for seat in range(n):
                assert len(final['laid'][seat]) + final['discards'][seat] == 12
            assert final['round'] == (6 if n == 2 else 12)


def test_pile_order_is_hidden_from_every_view():
    game = logic()
    state = game.call('newMatch', ctx=ctx(3), seed=2)['state']
    for who in ('p0', None):
        view = game.call('viewFor', state, who, ctx=ctx(3), seed=1)
        assert view['pile'] == len(state['pile']) and 'setup_order' not in view
    assert game.call('viewFor', state, None, ctx=ctx(3), seed=1)['me'] == -1


def lay_position(game, grid_cells, tile, seed=3):
    """A 2-player state where p0 must lay tile number `tile` on a realm made of grid_cells."""
    c = ctx(2)
    state = game.call('newMatch', ctx=c, seed=seed)['state']
    for cell, square in grid_cells.items():
        state['grids'][0][cell] = square
    state.update(phase='play', stage='place', pos=0, king=0, round=1, kings=[0, 0, 1, 1],
                 row=[{'n': tile, 'king': 0}, {'n': 1, 'king': 1}, {'n': 2, 'king': 2}, {'n': 3, 'king': 3}])
    return c, state


def test_a_tile_must_touch_the_keep_or_matching_terrain():
    game = logic()
    # Tile 13 is wheat + forest.
    c, state = lay_position(game, {}, 13)
    ok = game.call('applyMove', state, 'p0', {'cell': KEEP + 1, 'dir': 0}, ctx=c, seed=1)
    assert ok['state']['grids'][0][KEEP + 1] == [0, 0] and ok['state']['grids'][0][KEEP + 2] == [1, 0]
    for bad in [{'cell': KEEP + 2, 'dir': 0},            # not touching anything
                {'cell': KEEP + SIZE + 1, 'dir': 0},     # only diagonal to the keep
                {'cell': KEEP, 'dir': 0},                # on the keep
                {'cell': 80, 'dir': 0},                  # off the work area
                {'cell': 3.5, 'dir': 0}, {'cell': 41, 'dir': 4}]:
        with pytest.raises(InvalidMoveError):
            game.call('applyMove', state, 'p0', bad, ctx=c, seed=1)
    # Matching terrain counts: a forest half next to an existing forest square.
    c, state = lay_position(game, {KEEP + 1: [1, 0]}, 3)            # tile 3 is forest + forest
    ok = game.call('applyMove', state, 'p0', {'cell': KEEP + 2, 'dir': 0}, ctx=c, seed=1)
    assert ok['state']['grids'][0][KEEP + 3] == [1, 0]
    c, state = lay_position(game, {KEEP + 1: [2, 0]}, 3)            # but not next to a lake
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'cell': KEEP + 2, 'dir': 0}, ctx=c, seed=1)


def test_the_realm_must_fit_a_five_by_five_square():
    game = logic()
    # Wheat runs from the keep four squares to the right: one more is too wide.
    row = {KEEP + i: [0, 0] for i in range(1, 5)}
    c, state = lay_position(game, row, 1)                           # tile 1 is wheat + wheat
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'cell': KEEP + 5, 'dir': 1}, ctx=c, seed=1)
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'cell': KEEP - 1, 'dir': 2}, ctx=c, seed=1)
    ok = game.call('applyMove', state, 'p0', {'cell': KEEP + SIZE + 1, 'dir': 0}, ctx=c, seed=1)
    assert ok['state']['grids'][0][KEEP + SIZE + 2] == [0, 0]


def test_a_tile_that_fits_must_be_laid_and_one_that_cannot_is_discarded():
    game = logic()
    c, state = lay_position(game, {}, 13)
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'discard': True}, ctx=c, seed=1)
    case = next(c for c in PACKAGE['unit_tests']['cases'] if c['name'].startswith('A tile that fits nowhere'))
    seat = next(i for i, p in enumerate(case['ctx']['players']) if p['id'] == case['player_id'])
    assert case['move'] == {'discard': True}
    assert case['expected_state']['discards'][seat] == case['state']['discards'][seat] + 1
    assert case['expected_state']['grids'] == case['state']['grids']


def properties(grid):
    seen, out = set(), []
    for start, square in enumerate(grid):
        if not square or square[0] == 6 or start in seen:
            continue
        stack, size, crowns = [start], 0, 0
        seen.add(start)
        while stack:
            cell = stack.pop()
            size += 1
            crowns += grid[cell][1]
            r, c = divmod(cell, SIZE)
            for dr, dc in ((0, 1), (1, 0), (0, -1), (-1, 0)):
                rr, cc = r + dr, c + dc
                if 0 <= rr < SIZE and 0 <= cc < SIZE:
                    j = rr * SIZE + cc
                    if j not in seen and grid[j] and grid[j][0] == square[0]:
                        seen.add(j)
                        stack.append(j)
        out.append((size, crowns))
    return out


def test_scoring_is_size_times_crowns_per_group():
    game = logic()
    grid_cells = {KEEP + 1: [0, 1], KEEP + 2: [0, 0], KEEP + 3: [0, 0],      # wheat 3 squares, 1 crown -> 3
                  KEEP - 1: [2, 1], KEEP - 2: [2, 1],                        # lake 2 squares, 2 crowns -> 4
                  KEEP + SIZE: [1, 0],                                       # forest without crowns -> 0
                  KEEP - SIZE: [0, 2]}                                       # separate wheat group -> 2
    c, state = lay_position(game, grid_cells, 13)
    view = game.call('viewFor', state, 'p0', ctx=c, seed=1)
    assert view['live_scores'][0] == 3 + 4 + 0 + 2


def test_winners_follow_the_official_tie_breaks():
    game = logic()
    for n in (2, 3, 4):
        for seed in range(1, 8):
            final = list(walk(game, n, seed))[-1][3]
            s = final['state']
            keys = []
            for grid in s['grids']:
                props = properties(grid)
                keys.append((sum(a * b for a, b in props), max([a for a, _ in props] or [0]), sum(b for _, b in props)))
            assert s['scores'] == [k[0] for k in keys]
            best = max(keys)
            assert s['winners'] == [i for i, k in enumerate(keys) if k == best]


WALKS = {2: 15, 3: 12, 4: 10}


@pytest.mark.parametrize('count', [2, 3, 4])
def test_seeded_random_walks_always_reach_a_legal_end(count):
    report = run_random_walks(BODY.server_code, game_schemas=BODY.game_schemas(),
                              rules=GameRules(allowed_player_counts=(count,), allows_leave_mid_match=False,
                                              allows_join_mid_match=False),
                              run_seed=60 + count, max_walks=WALKS[count], budget_seconds=math.inf, max_moves_per_walk=200,
                              contract=BODY.unit_tests)
    assert report.passed, report.failures
    # Fixed coverage by count, independent of CI speed; per-call limits still apply.
    assert report.walks_completed == WALKS[count] and report.terminal_states == WALKS[count]


def test_out_of_turn_bad_picks_and_moves_after_the_end_are_refused():
    game = logic()
    c = ctx(2)
    state = game.call('newMatch', ctx=c, seed=4)['state']
    actor = f"p{state['kings'][state['king']]}"
    other = 'p1' if actor == 'p0' else 'p0'
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, other, {'pick': 0}, ctx=c, seed=1)
    for bad in [{'pick': 7}, {'pick': -1}, {'cell': 41, 'dir': 0}, {'discard': True}]:
        with pytest.raises(InvalidMoveError):
            game.call('applyMove', state, actor, bad, ctx=c, seed=1)
    after = game.call('applyMove', state, actor, {'pick': 0}, ctx=c, seed=1)['state']
    nxt = f"p{after['kings'][after['king']]}"
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', after, nxt, {'pick': 0}, ctx=c, seed=1)
    with pytest.raises((InvalidMoveError, GameLogicError)):
        game.call('applyMove', after, 'stranger', {'pick': 1}, ctx=c, seed=1)
    final = list(walk(game, 2, 9))[-1][3]
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', final['state'], 'p0', {'pick': 0}, ctx=c, seed=1)


def test_payouts_go_to_human_winners_or_back_to_everyone():
    game = logic()
    c = {'players': players(3), 'pot': 9, 'move_count': 0}
    c['players'][2]['kind'] = 'computer'
    for seed in range(1, 6):
        result = game.call('newMatch', ctx=c, seed=seed)
        step = 0
        while result['turn']:
            pid = result['turn'][0]
            move = game.call('randomMove', result['state'], pid, ctx=c, seed=step)
            result = game.call('applyMove', result['state'], pid, move, ctx=c, seed=step)
            step += 1
        assert sum(result['payouts'].values()) == 9 and set(result['payouts']) == {'p0', 'p1'}
        human_winners = [w for w in result['state']['winners'] if w < 2]
        if human_winners:
            assert all(result['payouts'][f'p{w}'] > 0 for w in human_winners)


def test_computer_beats_random_play_quickly():
    game = logic()
    wins, worst = 0, 0.0
    for seed in range(12):
        c = ctx(2)
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
        wins += 0 in result['state']['winners']
    assert wins >= 10, wins
    assert worst < 0.1


# ---- presentation ------------------------------------------------------------
UI = DeclarativeLogic(PACKAGE['declarative_ui'])


def message(view, seat, n=2, status='ongoing'):
    acting = view['kings'][view['king']] if view['phase'] != 'over' else None
    return {'type': 'state_changed', 'state': view, 'view': view, 'status': status, 'move_count': 5,
            'my_player_index': seat, 'acting_for_player_index': seat if acting == seat else None,
            'turn_of_player_indices': [acting] if acting is not None else None,
            'players': [{'player_index': i, 'player_id': f'p{i}', 'kind': 'human', 'name': NAMES[i]} for i in range(n)],
            'locale': 'en', 'direction': 'ltr', 'strings': {}}


def reduce(msg, local=None, event=None):
    payload = msg if event is None else {'type': 'ui_event', 'state_changed': msg, 'event': event}
    response = UI.reduce(payload, local)
    validate_response(PACKAGE['declarative_ui'], response)
    return response


def ids(response, group='targets'):
    return [item['id'] for item in response['scene'][group]]


def test_picking_selects_then_confirms():
    game = logic()
    c = ctx(2)
    state = game.call('newMatch', ctx=c, seed=1)['state']
    seat = state['kings'][state['king']]
    view = game.call('viewFor', state, f'p{seat}', ctx=c, seed=1)
    first = reduce(message(view, seat))
    assert [t for t in ids(first) if t.startswith('next-')] == ['next-0', 'next-1', 'next-2', 'next-3']
    chosen = reduce(message(view, seat), first['local_state'], {'type': 'tap', 'id': 'next-2'})
    assert 'make_move' not in chosen and 'take' in ids(chosen, 'controls')
    again = reduce(message(view, seat), chosen['local_state'], {'type': 'tap', 'id': 'next-2'})
    assert again['make_move'] == {'pick': 2}
    button = reduce(message(view, seat), chosen['local_state'], {'type': 'tap', 'id': 'take'})
    assert button['make_move'] == {'pick': 2}


def test_laying_previews_turns_and_sends_a_legal_move():
    game = logic()
    c, state = lay_position(game, {}, 13)
    view = game.call('viewFor', state, 'p0', ctx=c, seed=1)
    first = reduce(message(view, 0))
    squares = [t for t in ids(first) if t.startswith('square-')]
    assert f'square-{KEEP + 1}' in squares and f'square-{KEEP}' not in squares
    assert {'rot-cw', 'rot-ccw'} <= set(ids(first))
    picked = reduce(message(view, 0), first['local_state'], {'type': 'tap', 'id': f'square-{KEEP + 1}'})
    ghost = next(p for p in picked['scene']['pieces'] if p['id'] == 'ghost')
    assert ghost['asset'] == 'fit_ok'
    handle = next(p for p in picked['scene']['pieces'] if p['id'] == 'mytile')
    assert 'rotate' in handle['actions'] and 'lay' in ids(picked)
    sent = reduce(message(view, 0), picked['local_state'], {'type': 'tap', 'id': 'lay'})
    move = sent['make_move']
    assert move['cell'] == KEEP + 1
    game.call('applyMove', state, 'p0', move, ctx=c, seed=1)
    # Turning toward the keep does not fit: red frame, no destination.
    local = picked['local_state']
    seen = set()
    for _ in range(4):
        local = reduce(message(view, 0), local, {'type': 'rotate', 'id': 'mytile', 'delta': 90})['local_state']
        response = reduce(message(view, 0), local)
        ghost = next(p for p in response['scene']['pieces'] if p['id'] == 'ghost')
        seen.add(ghost['asset'])
        if ghost['asset'] == 'fit_bad':
            assert 'lay' not in ids(response)
            assert next(ctrl for ctrl in response['scene']['controls'] if ctrl['id'] == 'lay-button')['disabled']
    assert seen == {'fit_ok', 'fit_bad'}


def test_discard_is_offered_only_when_nothing_fits():
    case = next(c for c in PACKAGE['unit_tests']['cases'] if c['name'].startswith('A tile that fits nowhere'))
    seat = next(i for i, p in enumerate(case['ctx']['players']) if p['id'] == case['player_id'])
    n = len(case['ctx']['players'])
    response = reduce(message(case['view_of_mover'], seat, n))
    assert 'discard' in ids(response, 'controls') and not [t for t in ids(response) if t.startswith('square-')]
    sent = reduce(message(case['view_of_mover'], seat, n), response['local_state'], {'type': 'tap', 'id': 'discard'})
    assert sent['make_move'] == {'discard': True}
    game = logic()
    c, state = lay_position(game, {}, 13)
    view = game.call('viewFor', state, 'p0', ctx=c, seed=1)
    assert 'discard' not in ids(reduce(message(view, 0)), 'controls')


def test_every_kingdom_is_visible_and_waiting_players_get_no_actions():
    game = logic()
    c, state = lay_position(game, {KEEP + 1: [0, 0]}, 13)
    view = game.call('viewFor', state, 'p1', ctx=c, seed=1)
    waiting = reduce(message(view, 1))
    assert not ids(waiting) and not waiting['scene']['controls']
    pieces = {p['id']: p for p in waiting['scene']['pieces']}
    # The big kingdom is the viewer's own; the opponent's sits beside it, small.
    assert 'keep-1' in pieces and 'mini-keep-0' in pieces and 'mini-keep-1' not in pieces
    assert pieces['mini-0-' + str(KEEP + 1)]['asset'] == 'mq_0_0'
    # A real game: the opponent's most recent tile is outlined beside yours.
    steps = list(walk(game, 2, 4, 'computerMove'))
    mid = next(st[3]['state'] for st in steps if st[3]['state'].get('laid') and len(st[3]['state']['laid'][0]) >= 3 and st[3]['turn'])
    seen = reduce(message(game.call('viewFor', mid, 'p1', ctx=ctx(), seed=1), 1))
    assert any(p['id'] == 'last-mini-0' for p in seen['scene']['pieces'])
    labels = {l['id']: l['text'] for l in waiting['scene']['labels']}
    assert labels['my-title'].startswith('Jade · Bea (you)') and labels['mini-name-0'] == 'Amber · Ana'
    assert labels['status'].startswith('Amber · Ana ') and '(you)' not in labels['status']


def test_your_seat_is_marked_you_and_no_label_leaves_the_viewport():
    game = logic()
    c, state = lay_position(game, {}, 13)
    view = game.call('viewFor', state, 'p0', ctx=c, seed=1)
    response = reduce(message(view, 0))
    labels = {l['id']: l for l in response['scene']['labels']}
    assert '(you)' in labels['status']['text'] and '(you)' in labels['my-title']['text']
    assert all(0 <= l['y'] <= 730 - 14 for l in labels.values())
    # The opponent column does not overlap the big kingdom (x 4..418).
    assert all(l['x'] >= 424 for i, l in labels.items() if i.startswith('mini-'))


def test_end_screen_names_the_winner_with_their_score():
    game = logic()
    final = list(walk(game, 2, 4, 'computerMove'))[-1][3]['state']
    view = game.call('viewFor', final, 'p0', ctx=ctx(), seed=1)
    response = reduce(message(view, 0, status='over'))
    status = next(label for label in response['scene']['labels'] if label['id'] == 'status')['text']
    if len(final['winners']) == 1:
        assert status.endswith(f"wins with {final['scores'][final['winners'][0]]}!")
    else:
        assert status.startswith('Shared win: ')
    labels = [label['id'] for label in response['scene']['labels']]
    assert any(i.startswith('legend-total-0') for i in labels) and any(i.startswith('legend-total-1') for i in labels)
    # The draft rows are gone, both realms are drawn and every group is listed.
    assert 'row-label' not in labels and {'keep-0', 'keep-1'} <= {p['id'] for p in response['scene']['pieces']}
    assert not any(i.startswith('legend-more') for i in labels)
    assert all(l['y'] >= 64 for l in response['scene']['labels'] if l['id'].startswith('end-name-'))


def test_every_language_has_every_string_and_placeholder():
    source = PACKAGE['declarative_ui']['strings']
    for locale, translation in PACKAGE['translations'].items():
        strings = translation['client_strings']
        assert set(strings) == set(source), locale
        for key, text in source.items():
            assert set(re.findall(r'\{\w+\}', text)) == set(re.findall(r'\{\w+\}', strings[key])), (locale, key)
