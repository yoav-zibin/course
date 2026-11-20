"""Stitch & Time (based on Patchwork): patch data, rules, computer player, presentation."""
import copy
import json
import math
import re
import time
from collections import Counter
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import DeclarativeLogic, validate_response
from game_platform.game_logic import GameLogic, GameLogicError, InvalidMoveError
from game_platform.game_testing import test_server_code as run_random_walks
from game_platform.models import GameRules

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = json.loads((ROOT / 'games/declarative/stitchtime.json').read_text())
BODY = GameImport.model_validate(PACKAGE)
PLAYERS = [{'id': f'p{i}', 'kind': 'human', 'display_name': n, 'picture_url': '', 'max_loss': 0, 'active': True}
           for i, n in enumerate(['Ana', 'Bea'])]


def logic():
    return GameLogic(BODY.server_code, game_schemas=BODY.game_schemas())


def ctx(**updates):
    return {'players': PLAYERS, 'pot': 0, 'move_count': 0, **updates}


def fresh(seed=1):
    game = logic()
    return game, game.call('newMatch', ctx=ctx(), seed=seed)['state']


def patches():
    from game_platform.tools.build_declarative_stitchtime import patches as read
    return read()


def test_package_passes_the_full_import_validation():
    prepare(BODY)
    assert PACKAGE['name'] == 'Stitch & Time' and PACKAGE['description'].startswith('Based on Patchwork.')
    assert PACKAGE['all_state_public'] is True and PACKAGE['allowed_player_counts'] == [2]


def test_package_stays_within_platform_limits():
    assert len(PACKAGE['declarative_ui']['assets']) <= 128
    stored = {k: PACKAGE[k] for k in ('translations', 'tutorial', 'images', 'unit_tests', 'declarative_ui')}
    assert len(json.dumps(stored).encode()) < 400_000


def test_the_33_patches_match_the_cross_checked_data():
    table = patches()
    assert len(table) == 33
    cells = [sum(r.count('#') for r in p['rows']) for p in table]
    assert min(cells) == 2 and max(cells) == 8
    assert table[0] == {'cost': 2, 'time': 1, 'income': 0, 'rows': ['##']}       # the 1x2 starting patch
    # Totals shared by both independent sources (see STITCHTIME.md).
    assert sum(p['cost'] for p in table) == 133 and sum(p['time'] for p in table) == 107
    assert sum(p['income'] for p in table) == 38 and sum(cells) == 166
    assert Counter(p['income'] for p in table) == Counter({0: 11, 1: 10, 2: 8, 3: 4})


def test_setup_follows_the_rulebook():
    game, state = fresh(5)
    assert state['buttons'] == [5, 5] and state['pos'] == [0, 0]
    assert sorted(state['circle']) == list(range(33)) and state['circle'][-1] == 0
    assert state['leather'] == [20, 26, 32, 44, 50]


def test_advance_moves_just_past_the_rival_for_a_button_per_space():
    game, state = fresh()
    state['pos'] = [3, 9]
    state['top'] = 1
    after = game.call('applyMove', state, 'p0', {'advance': True}, ctx=ctx(), seed=1)
    s = after['state']
    # 3 -> 10: 7 buttons, plus income at space 5 (income 0 here).
    assert s['pos'][0] == 10 and s['buttons'][0] == 5 + 7
    assert after['turn'] == ['p1']


def test_the_player_behind_moves_and_ties_go_to_the_token_on_top():
    game, state = fresh()
    state['pos'] = [4, 2]
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'advance': True}, ctx=ctx(), seed=1)
    state['pos'] = [4, 4]
    state['top'] = 1
    game.call('applyMove', state, 'p1', {'advance': True}, ctx=ctx(), seed=1)
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'advance': True}, ctx=ctx(), seed=1)


def test_buying_pays_places_moves_and_turns_the_circle():
    game, state = fresh(3)
    table = patches()
    options = state['circle'][:3]
    k = next(i for i, p in enumerate(options) if table[p]['cost'] <= 5)
    p = options[k]
    with pytest.raises(InvalidMoveError):  # only the next three
        game.call('applyMove', state, 'p0', {'buy': 3, 'o': 0, 'x': 0, 'y': 0}, ctx=ctx(), seed=1)
    after = game.call('applyMove', state, 'p0', {'buy': k, 'o': 0, 'x': 0, 'y': 0}, ctx=ctx(), seed=1)['state']
    assert after['buttons'][0] == 5 - table[p]['cost'] and after['income'][0] == table[p]['income']
    assert after['pos'][0] == table[p]['time']
    # The token moves to the bought patch: skipped patches go to the back.
    assert after['circle'] == state['circle'][k + 1:] + state['circle'][:k]
    covered = sum(1 for c in after['quilts'][0] if c == p)
    assert covered == sum(r.count('#') for r in table[p]['rows'])


def test_patches_must_fit_and_be_affordable():
    game, state = fresh(3)
    table = patches()
    p = state['circle'][0]
    with pytest.raises(InvalidMoveError):  # off the quilt
        game.call('applyMove', state, 'p0', {'buy': 0, 'o': 0, 'x': 8, 'y': 8}, ctx=ctx(), seed=1)
    poor = copy.deepcopy(state)
    poor['buttons'] = [table[p]['cost'] - 1, 5]
    if table[p]['cost'] > 0:
        with pytest.raises(InvalidMoveError):
            game.call('applyMove', poor, 'p0', {'buy': 0, 'o': 0, 'x': 0, 'y': 0}, ctx=ctx(), seed=1)
    full = copy.deepcopy(state)
    full['quilts'][0] = [5] * 81
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', full, 'p0', {'buy': 0, 'o': 0, 'x': 0, 'y': 0}, ctx=ctx(), seed=1)


def test_income_and_leather_are_collected_when_passed():
    game, state = fresh()
    state.update(pos=[19, 30], top=1, income=[3, 0])
    s = game.call('applyMove', state, 'p0', {'advance': True}, ctx=ctx(), seed=1)['state']
    # 19 -> 31: income spaces 23 and 29 (2 x 3), leather at 20 and 26.
    assert s['buttons'][0] == 5 + 12 + 6 and s['pending'][0] == 2 and s['leather'] == [32, 44, 50]
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', s, 'p1', {'advance': True}, ctx=ctx(), seed=1)
    s2 = game.call('applyMove', s, 'p0', {'leather': 40}, ctx=ctx(), seed=1)['state']
    assert s2['quilts'][0][40] == 33 and s2['pending'][0] == 1
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', s2, 'p0', {'leather': 40}, ctx=ctx(), seed=1)


def test_the_first_full_seven_by_seven_earns_the_bonus_and_scoring_counts_empties():
    game, state = fresh()
    quilt = [-1] * 81
    for y in range(7):
        for x in range(7):
            if (x, y) != (6, 6):
                quilt[y * 9 + x] = 5
    state['quilts'][0] = quilt
    state.update(pos=[40, 50], top=1, leather=[], pending=[1, 0])
    s = game.call('applyMove', state, 'p0', {'leather': 6 * 9 + 6}, ctx=ctx(), seed=1)['state']
    assert s['bonus'] == 0
    end = copy.deepcopy(s)
    end.update(pos=[52, 53], first_end=1)
    res = game.call('applyMove', end, 'p0', {'advance': True}, ctx=ctx(), seed=1)
    final = res['state']
    assert res['turn'] is None and final['phase'] == 'over'
    empty0 = sum(1 for c in final['quilts'][0] if c < 0)
    assert final['scores'][0] == final['buttons'][0] + 7 - 2 * empty0
    assert final['scores'][1] == final['buttons'][1] - 2 * 81


def test_a_tie_goes_to_the_first_to_reach_the_end():
    game, state = fresh()
    state.update(pos=[52, 53], first_end=1, buttons=[0, 1], top=1)
    res = game.call('applyMove', state, 'p0', {'advance': True}, ctx=ctx(), seed=1)
    final = res['state']
    assert final['scores'][0] == final['scores'][1] and final['winner'] == 1


def test_no_moves_after_the_end_and_strangers_are_refused():
    game, state = fresh()
    state.update(pos=[52, 53], top=1)
    final = game.call('applyMove', state, 'p0', {'advance': True}, ctx=ctx(), seed=1)['state']
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', final, 'p0', {'advance': True}, ctx=ctx(), seed=1)
    with pytest.raises((InvalidMoveError, GameLogicError)):
        game.call('applyMove', fresh()[1], 'stranger', {'advance': True}, ctx=ctx(), seed=1)


def test_seeded_random_walks_always_reach_a_legal_end():
    report = run_random_walks(BODY.server_code, game_schemas=BODY.game_schemas(),
                              rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False, allows_join_mid_match=False),
                              run_seed=81, max_walks=30, budget_seconds=math.inf, max_moves_per_walk=300, contract=BODY.unit_tests)
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
            'acting_for_player_index': seat if view['turn'] == seat else None,
            'turn_of_player_indices': [view['turn']] if view['turn'] is not None and view['turn'] >= 0 else None,
            'players': [{'player_index': i, 'player_id': f'p{i}', 'kind': 'human', 'name': n} for i, n in enumerate(['Ana', 'Bea'])],
            'locale': 'en', 'direction': 'ltr', 'strings': {}}


def reduce(msg, local=None, event=None):
    payload = msg if event is None else {'type': 'ui_event', 'state_changed': msg, 'event': event}
    response = UI.reduce(payload, local)
    validate_response(PACKAGE['declarative_ui'], response)
    return response


def ids(response, group='targets'):
    return [item['id'] for item in response['scene'][group]]


def test_picking_shows_a_fitting_ghost_and_turns_keep_it_fitting():
    game, state = fresh(3)
    state['quilts'][0][0] = 5
    view = game.call('viewFor', state, 'p0', ctx=ctx(), seed=1)
    first = reduce(message(view, 0))
    assert {'buy-0', 'buy-1', 'buy-2', 'advance'} <= set(ids(first)) or 'advance' in ids(first)
    k = next(i for i, p in enumerate(state['circle'][:3]) if patches()[p]['cost'] <= 5)
    picked = reduce(message(view, 0), first['local_state'], {'type': 'tap', 'id': f'buy-{k}'})
    assert 'place' in ids(picked) and {'rot-cw', 'rot-ccw', 'mirror'} <= set(ids(picked))
    local = picked['local_state']
    for event in ({'type': 'tap', 'id': 'rot-cw'}, {'type': 'tap', 'id': 'mirror'}, {'type': 'rotate', 'id': 'mypatch', 'delta': -90},
                  {'type': 'flip', 'id': 'mypatch'}):
        local = reduce(message(view, 0), local, event)['local_state']
        assert 'place' in ids(reduce(message(view, 0), local))
    sent = reduce(message(view, 0), local, {'type': 'tap', 'id': 'place'})['make_move']
    assert sent['buy'] == k
    game.call('applyMove', state, 'p0', sent, ctx=ctx(), seed=1)


def test_advance_and_leather_and_waiting():
    game, state = fresh()
    state.update(pos=[2, 6], top=1)
    view = game.call('viewFor', state, 'p0', ctx=ctx(), seed=1)
    first = reduce(message(view, 0))
    advance = next(t for t in first['scene']['targets'] if t['id'] == 'advance')
    assert '+5' in advance['label'] and advance['hit_area']['height'] >= 44
    assert reduce(message(view, 0), first['local_state'], {'type': 'tap', 'id': 'advance'})['make_move'] == {'advance': True}
    state['pending'] = [1, 0]
    view = game.call('viewFor', state, 'p0', ctx=ctx(), seed=1)
    lea = reduce(message(view, 0))
    assert sum(1 for t in ids(lea) if t.startswith('leather-')) == 81
    other = game.call('viewFor', state, 'p1', ctx=ctx(), seed=1)
    waiting = reduce(message(other, 1))
    assert set(ids(waiting)) == {'rival'}
    rival = reduce(message(other, 1), waiting['local_state'], {'type': 'tap', 'id': 'rival'})
    assert any(l['id'] == 'hint' and 'Looking at' in l['text'] for l in rival['scene']['labels'])


def test_end_screen_shows_the_score_breakdown():
    game, state = fresh()
    state.update(pos=[52, 53], first_end=1, top=1)
    final = game.call('applyMove', state, 'p0', {'advance': True}, ctx=ctx(), seed=1)['state']
    view = game.call('viewFor', final, 'p0', ctx=ctx(), seed=1)
    end = reduce(message(view, 0, status='over'))
    labels = {l['id']: l['text'] for l in end['scene']['labels']}
    assert labels['status'].endswith('!') and 'score-0' in labels and 'score-1' in labels
    assert not any(t.startswith('buy-') for t in ids(end))


def test_every_language_has_every_string_and_placeholder():
    source = PACKAGE['declarative_ui']['strings']
    for locale, translation in PACKAGE['translations'].items():
        strings = translation['client_strings']
        assert set(strings) == set(source), locale
        for key, text in source.items():
            assert set(re.findall(r'\{\w+\}', text)) == set(re.findall(r'\{\w+\}', strings[key])), (locale, key)
