"""Lantern Trails (based on Tsuro): rules, computer player, presentation and translations."""
import copy
import itertools
import json
import time
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import DeclarativeLogic, validate_response
from game_platform.game_logic import GameLogic, GameLogicError, InvalidMoveError
from game_platform.game_testing import test_server_code as run_random_walks
from game_platform.models import GameRules

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = json.loads((ROOT / 'games/declarative/lanterntrails.json').read_text())
BODY = GameImport.model_validate(PACKAGE)
NAMES = ['Ana', 'Bea', 'Cai', 'Dev', 'Eko', 'Fia', 'Gil', 'Hal']


def players(n, kind='human'):
    return [{'id': f'p{i}', 'kind': kind, 'display_name': NAMES[i], 'picture_url': '', 'max_loss': 0, 'active': True}
            for i in range(n)]


def logic():
    return GameLogic(BODY.server_code, game_schemas=BODY.game_schemas())


def ctx(n=2, **updates):
    return {'players': players(n), 'pot': 0, 'move_count': 0, **updates}


def walk(game, n, seed, chooser='randomMove', limit=200):
    """Yield (state, player, move, result) through one seeded game."""
    c = ctx(n)
    result = game.call('newMatch', ctx=c, seed=seed)
    for step in range(limit):
        if result['turn'] is None:
            return
        c['move_count'] = step
        state, pid = result['state'], result['turn'][0]
        move = game.call(chooser, state, pid, ctx=c, seed=seed * 1000 + step)
        result = game.call('applyMove', state, pid, move, ctx=c, seed=seed * 1000 + step)
        yield state, pid, move, result
    raise AssertionError('game did not end')


def test_package_passes_the_full_import_validation():
    prepare(BODY)
    kinds = {case['kind'] for case in PACKAGE['unit_tests']['cases']}
    assert kinds == {'initial', 'intermediate', 'terminal'}
    assert PACKAGE['name'] == 'Lantern Trails' and PACKAGE['description'].startswith('Based on Tsuro.')
    assert PACKAGE['allowed_player_counts'] == list(range(2, 9))
    # Hands and the draw pile are private.
    assert PACKAGE['all_state_public'] is False


def test_package_stays_within_platform_limits():
    ui = PACKAGE['declarative_ui']
    assert len(ui['assets']) <= 128
    stored = {key: PACKAGE[key] for key in ('translations', 'tutorial', 'images', 'unit_tests', 'declarative_ui')}
    assert len(json.dumps(stored).encode()) < 400_000


def test_the_35_tiles_are_every_pairing_of_eight_points_once_up_to_rotation():
    game = logic()
    state = game.call('newMatch', ctx=ctx(), seed=3)['state']
    every = sorted(state['pile'] + state['hands'][0] + state['hands'][1])
    assert every == list(range(35))
    from game_platform.tools.build_declarative_lanterntrails import TILES

    def rotate(conn, k):
        out = [0] * 8
        for p in range(8):
            out[(p + 2 * k) % 8] = (conn[p] + 2 * k) % 8
        return out
    seen = set()
    for conn in TILES:
        assert sorted(conn) == list(range(8)) and all(conn[conn[p]] == p and conn[p] != p for p in range(8))
        classes = {tuple(rotate(conn, k)) for k in range(4)}
        assert not classes & seen
        seen |= classes
    # 105 pairings of 8 points in all, every one reached exactly once.
    assert len(seen) == 105 and len(TILES) == 35


@pytest.mark.parametrize('count', [2, 3, 5, 8])
def test_seeded_random_walks_always_reach_a_legal_end(count):
    report = run_random_walks(BODY.server_code, game_schemas=BODY.game_schemas(),
                              rules=GameRules(allowed_player_counts=(count,), allows_leave_mid_match=False,
                                              allows_join_mid_match=False),
                              run_seed=40 + count, max_walks=60, budget_seconds=60, max_moves_per_walk=150,
                              contract=BODY.unit_tests)
    assert report.passed, report.failures
    assert report.walks_completed >= (15 if count == 8 else 30) and report.terminal_states == report.walks_completed


def test_walk_invariants_tiles_hands_dragon_and_payouts():
    game = logic()
    dragon_seen = False
    for n in (2, 3, 4, 6, 8):
        for seed in range(1, 9):
            for state, pid, move, result in walk(game, n, seed):
                s = result['state']
                assert len(s['pile']) + sum(map(len, s['hands'])) + sum(1 for t in s['board'] if t) == 35
                alive = [i for i, m in enumerate(s['markers']) if m and m['out'] is None]
                assert all(len(h) <= 3 for h in s['hands'])
                assert all(not s['hands'][i] for i, m in enumerate(s['markers']) if m and m['out'])
                if s['phase'] == 'play' and s['pile'] and result['turn'] is not None:
                    assert all(len(s['hands'][i]) == 3 for i in alive)
                if s['dragon'] is not None and result['turn'] is not None:
                    dragon_seen = True
                    assert n >= 3 and not s['pile'] and s['dragon'] in alive
                if result['turn'] is None:
                    assert s['winners'] and sum(result['payouts'].values()) == 0
    assert dragon_seen


def test_start_gates_must_be_free_and_play_waits_for_every_gate():
    game = logic()
    c = ctx(3)
    state = game.call('newMatch', ctx=c, seed=1)['state']
    assert state['phase'] == 'start'
    for bad in [{'gate': 48}, {'gate': -1}, {'gate': 1.5}, {'tile': state['hands'][0][0], 'rotation': 0}]:
        with pytest.raises(InvalidMoveError):
            game.call('applyMove', state, 'p0', bad, ctx=c, seed=1)
    state = game.call('applyMove', state, 'p0', {'gate': 5}, ctx=c, seed=1)['state']
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p1', {'gate': 5}, ctx=c, seed=1)
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p0', {'gate': 6}, ctx=c, seed=1)
    state = game.call('applyMove', state, 'p1', {'gate': 17}, ctx=c, seed=1)['state']
    result = game.call('applyMove', state, 'p2', {'gate': 30}, ctx=c, seed=1)
    # Gates in seat order, then the first player lays the first tile.
    assert result['state']['phase'] == 'play' and result['turn'] == ['p0']
    assert [m['out'] for m in result['state']['markers']] == [None, None, None]


def started(game, n=2, seed=1, gates=(4, 28, 16, 40, 10, 34, 22, 46)):
    c = ctx(n)
    state = game.call('newMatch', ctx=c, seed=seed)['state']
    for seat in range(n):
        state = game.call('applyMove', state, f'p{seat}', {'gate': gates[seat]}, ctx=c, seed=seed)['state']
    return c, state


def test_tiles_must_come_from_the_hand_with_a_valid_turn_and_in_turn():
    game = logic()
    c, state = started(game)
    mine, theirs = state['hands'][0][0], state['hands'][1][0]
    for bad in [{'tile': theirs, 'rotation': 0}, {'tile': mine, 'rotation': 4}, {'tile': mine, 'rotation': -1},
                {'tile': 35, 'rotation': 0}, {'tile': mine}, {'gate': 3}]:
        with pytest.raises(InvalidMoveError):
            game.call('applyMove', state, 'p0', bad, ctx=c, seed=2)
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'p1', {'tile': theirs, 'rotation': 0}, ctx=c, seed=2)
    with pytest.raises((InvalidMoveError, GameLogicError)):
        game.call('applyMove', state, 'stranger', {'tile': mine, 'rotation': 0}, ctx=c, seed=2)


def options(game, c, state, seat):
    """Every hand tile and turn: the result, or the refusal text."""
    out = []
    pid = c['players'][seat]['id']
    for tile in state['hands'][seat]:
        for rotation in range(4):
            try:
                out.append((tile, rotation, game.call('applyMove', state, pid, {'tile': tile, 'rotation': rotation}, ctx=c, seed=5)))
            except InvalidMoveError as error:
                out.append((tile, rotation, str(error)))
    return out


def test_leaving_the_board_is_refused_while_another_tile_or_turn_stays_on():
    game = logic()
    for seed in range(1, 60):
        for state, pid, move, result in walk(game, 2, seed):
            if state['phase'] != 'play':
                continue
            seat = state['cur']
            found = options(game, ctx(2), state, seat)
            refused = [o for o in found if isinstance(o[2], str)]
            if refused and len(refused) < len(found):
                assert all('off the board' in o[2] for o in refused)
                # Every accepted choice keeps this lantern off the edge.
                assert all(o[2]['state']['markers'][seat]['out'] != 'edge' for o in found if not isinstance(o[2], str))
                return
    pytest.fail('no position with both safe and fatal choices found')


def test_when_every_choice_leaves_the_board_one_must_still_be_played():
    case = next(c for c in PACKAGE['unit_tests']['cases'] if c['name'].startswith('When every tile'))
    game = logic()
    seat = case['state']['cur']
    found = options(game, case['ctx'] | {'move_count': case['ctx']['move_count']}, case['state'], seat)
    assert found and all(not isinstance(o[2], str) and o[2]['state']['markers'][seat]['out'] == 'edge' for o in found)
    assert case['expected_state']['markers'][seat]['out'] == 'edge'


def test_two_lanterns_that_meet_are_both_out_and_share_the_win():
    case = next(c for c in PACKAGE['unit_tests']['cases'] if c['name'].startswith('Two lanterns meet'))
    after = case['expected_state']
    assert [m['out'] for m in after['markers']] == ['collision', 'collision']
    assert case['expected_turn'] is None and sorted(after['winners']) == [0, 1]
    assert case['expected_view_of_mover']['winner'] == -1


def test_a_tile_can_send_a_rival_off_the_edge():
    case = next(c for c in PACKAGE['unit_tests']['cases'] if c['name'].startswith('Laying a tile can send'))
    seat = case['state']['cur']
    before = [m['out'] for m in case['state']['markers']]
    after = [m['out'] for m in case['expected_state']['markers']]
    assert after[seat] is None and any(a == 'edge' and b is None for a, b in zip(after, before))


def test_lanterns_follow_channels_across_earlier_tiles():
    game = logic()
    for seed in range(1, 30):
        for state, pid, move, result in walk(game, 2, seed):
            last = result['state']['last']
            if last and last['kind'] == 'tile' and any(len(m['steps']) >= 4 for m in last['moved']):
                moved = max(last['moved'], key=lambda m: len(m['steps']))
                squares = [step // 8 for step in moved['steps']]
                # It passed through squares other than the new one.
                assert len(set(squares)) >= 3 and last['square'] in squares
                return
    pytest.fail('no chained move found')


def test_the_dragon_holder_draws_first_when_tiles_come_back():
    game = logic()
    for seed in range(1, 200):
        for state, pid, move, result in walk(game, 4, seed):
            holder = state['dragon']
            if holder is None or move.get('tile') is None:
                continue
            after = result['state']
            returned = [i for i, m in enumerate(after['markers']) if m['out'] and not state['markers'][i]['out']]
            if returned and result['turn'] is not None and after['markers'][holder]['out'] is None and holder != state['cur']:
                assert len(after['hands'][holder]) > len(state['hands'][holder])
                assert after['dragon'] != holder or not after['pile']
                return
    pytest.fail('no Dragon return found')


def test_when_all_tiles_are_played_the_remaining_lanterns_share_the_win():
    """Rare in real play, so build it: a real midgame, then every other tile
    laid on the squares no lantern faces, leaving one tile in one hand."""
    game = logic()
    for seed in range(1, 80):
        for state, pid, move, result in walk(game, 2, seed):
            s = copy.deepcopy(result['state'])
            if result['turn'] is None or s['phase'] != 'play':
                continue
            fronts = {m['at'] // 8 for m in s['markers']}
            if len(fronts) != 2:
                continue
            seat = s['cur']
            spare = s['pile'] + s['hands'][1 - seat] + s['hands'][seat][1:]
            free = [sq for sq in range(36) if s['board'][sq] is None and sq not in fronts]
            if len(spare) != len(free):
                continue
            for sq, tile in zip(free, spare):
                s['board'][sq] = [tile, 0]
            s['pile'], s['hands'][1 - seat], s['hands'][seat] = [], [], s['hands'][seat][:1]
            for rotation in range(4):
                try:
                    end = game.call('applyMove', s, f'p{seat}', {'tile': s['hands'][seat][0], 'rotation': rotation}, ctx=ctx(), seed=1)
                except InvalidMoveError:
                    continue
                if all(m['out'] is None for m in end['state']['markers']):
                    assert end['turn'] is None and sorted(end['state']['winners']) == [0, 1]
                    assert sum(1 for t in end['state']['board'] if t) == 35
                    return
    pytest.fail('no position found')


def test_payouts_go_to_human_winners_or_back_to_everyone():
    game = logic()
    c = {'players': players(2), 'pot': 10, 'move_count': 0}
    c['players'][1]['kind'] = 'computer'
    for seed in range(1, 40):
        result = game.call('newMatch', ctx=c, seed=seed)
        step = 0
        while result['turn']:
            pid = result['turn'][0]
            move = game.call('randomMove', result['state'], pid, ctx=c, seed=step)
            result = game.call('applyMove', result['state'], pid, move, ctx=c, seed=step)
            step += 1
        winners = result['state']['winners']
        assert result['payouts'] == {'p0': 10}
        assert 0 in winners or result['payouts']['p0'] == 10


def test_views_hide_other_hands_and_the_pile_order():
    game = logic()
    c, state = started(game, 3)
    mine = game.call('viewFor', state, 'p1', ctx=c, seed=1)
    spectator = game.call('viewFor', state, None, ctx=c, seed=1)
    assert mine['hand'] == state['hands'][1] and mine['me'] == 1
    assert spectator['hand'] is None and spectator['me'] == -1
    for view in (mine, spectator):
        assert 'hands' not in view and view['pile'] == len(state['pile'])
        assert view['hand_counts'] == [3, 3, 3]


def test_no_moves_after_the_end():
    game = logic()
    *_, (state, pid, move, result) = walk(game, 2, 7)
    assert result['turn'] is None
    with pytest.raises(InvalidMoveError):
        game.call('applyMove', result['state'], 'p0', {'tile': 0, 'rotation': 0}, ctx=ctx(), seed=1)


def test_computer_is_legal_fast_and_outlasts_random_play():
    game = logic()
    wins = 0
    worst = 0.0
    for seed in range(24):
        c = ctx(2)
        result = game.call('newMatch', ctx=c, seed=seed)
        step = 0
        while result['turn']:
            pid = result['turn'][0]
            chooser = 'computerMove' if pid == 'p0' else 'randomMove'
            started_at = time.perf_counter()
            move = game.call(chooser, result['state'], pid, ctx=c, seed=step)
            if pid == 'p0':
                worst = max(worst, time.perf_counter() - started_at)
            result = game.call('applyMove', result['state'], pid, move, ctx=c, seed=step)
            step += 1
        wins += result['state']['winners'] == [0]
    assert wins >= 16, wins
    assert worst < 0.1


def test_computer_stays_fast_with_eight_lanterns():
    game = logic()
    worst = 0.0
    for state, pid, move, result in walk(game, 8, 3, chooser='computerMove'):
        started_at = time.perf_counter()
        game.call('computerMove', state, pid, ctx=ctx(8), seed=1)
        worst = max(worst, time.perf_counter() - started_at)
    assert worst < 0.1


# ---- presentation ------------------------------------------------------------
UI = DeclarativeLogic(PACKAGE['declarative_ui'])


def message(view, seat, n=2, status='ongoing'):
    return {'type': 'state_changed', 'state': view, 'view': view, 'status': status, 'move_count': 5,
            'my_player_index': seat, 'acting_for_player_index': seat if view['cur'] == seat else None,
            'turn_of_player_indices': [view['cur']] if view['cur'] is not None else None,
            'players': [{'player_index': i, 'player_id': f'p{i}', 'kind': 'human', 'name': NAMES[i]} for i in range(n)],
            'locale': 'en', 'direction': 'ltr', 'strings': {}}


def reduce(msg, local=None, event=None):
    payload = msg if event is None else {'type': 'ui_event', 'state_changed': msg, 'event': event}
    response = UI.reduce(payload, local)
    validate_response(PACKAGE['declarative_ui'], response)
    return response


def ids(response, group='targets'):
    return [item['id'] for item in response['scene'][group]]


def test_start_offers_edge_squares_then_big_gate_pickers():
    game = logic()
    c = ctx(2)
    state = game.call('newMatch', ctx=c, seed=1)['state']
    view = game.call('viewFor', state, 'p0', ctx=c, seed=1)
    first = reduce(message(view, 0))
    edges = ids(first)
    assert len(edges) == 20 and all(t.startswith('edge-') for t in edges)
    picked = reduce(message(view, 0), first['local_state'], {'type': 'tap', 'id': 'edge-0'})
    gates = [t for t in picked['scene']['targets'] if t['id'].startswith('gate-')]
    # A corner square has four gates; each picker is at least 112 units wide.
    assert len(gates) == 4 and all(t['hit_area']['width'] >= 112 for t in gates)
    chosen = reduce(message(view, 0), picked['local_state'], {'type': 'tap', 'id': gates[0]['id']})
    assert chosen['make_move'] == {'gate': int(gates[0]['id'].split('-')[1])}


def play_view(seed=1):
    game = logic()
    c, state = started(game, 2, seed)
    return game, c, state, game.call('viewFor', state, 'p0', ctx=c, seed=1)


def test_rotating_the_tile_updates_the_preview_and_placing_sends_that_turn():
    game, c, state, view = play_view()
    first = reduce(message(view, 0))
    hand = [p for p in first['scene']['pieces'] if p['id'].startswith('hand-')]
    assert len(hand) == 3 and all(set(p['actions']) == {'tap', 'rotate', 'move'} for p in hand)
    assert {'rot-cw', 'rot-ccw'} <= set(ids(first))
    tile = int(hand[0]['id'].split('-')[1])
    seen = set()
    local = first['local_state']
    for turn in range(4):
        response = reduce(message(view, 0), local)
        ghost = next(p for p in response['scene']['pieces'] if p['id'] == 'ghost')
        assert ghost['rotation'] % 360 == turn * 90 and ghost['asset'] == f'tile_{tile}'
        if 'place' in ids(response):
            placed = reduce(message(view, 0), response['local_state'], {'type': 'tap', 'id': 'place'})
            move = placed['make_move']
            assert move == {'tile': tile, 'rotation': turn}
            game.call('applyMove', state, 'p0', move, ctx=c, seed=1)
            seen.add(turn)
        else:
            # An illegal turn offers no destination, and no piece points at one.
            assert all('place' not in p.get('move_targets', []) for p in response['scene']['pieces'])
            assert next(ctrl for ctrl in response['scene']['controls'] if ctrl['id'] == 'place-button')['disabled']
        local = reduce(message(view, 0), response['local_state'], {'type': 'tap', 'id': 'rot-cw'})['local_state']
    assert seen


def test_host_rotate_tool_and_drag_place_the_selected_tile():
    game, c, state, view = play_view(seed=2)
    first = reduce(message(view, 0))
    tile = state['hands'][0][1]
    rotated = reduce(message(view, 0), first['local_state'], {'type': 'rotate', 'id': f'hand-{tile}', 'delta': -90})
    ghost = next(p for p in rotated['scene']['pieces'] if p['id'] == 'ghost')
    assert ghost['asset'] == f'tile_{tile}' and ghost['rotation'] == -90
    local = rotated['local_state']
    for _ in range(4):
        response = reduce(message(view, 0), local)
        if 'place' in ids(response):
            dropped = reduce(message(view, 0), local, {'type': 'drop', 'id': f'hand-{tile}', 'piece_id': f'hand-{tile}', 'target_id': 'place'})
            assert dropped['make_move']['tile'] == tile
            game.call('applyMove', state, 'p0', dropped['make_move'], ctx=c, seed=1)
            return
        local = reduce(message(view, 0), local, {'type': 'drop', 'id': f'hand-{tile}', 'piece_id': f'hand-{tile}', 'target_id': 'rot-cw'})['local_state']
    # Every turn of this tile is fatal while another tile is safe: fine too.


def test_waiting_players_and_spectators_get_no_actions():
    game, c, state, view = play_view()
    other = game.call('viewFor', state, 'p1', ctx=c, seed=1)
    waiting = reduce(message(other, 1))
    assert not waiting['scene']['targets'] and not waiting['scene']['controls']
    assert all(not p['actions'] for p in waiting['scene']['pieces'])
    spectator = game.call('viewFor', state, None, ctx=c, seed=1)
    watch = reduce(message(spectator, None))
    assert not any(p['id'].startswith('hand-') for p in watch['scene']['pieces'])


def test_end_screen_names_the_winner_and_rings_their_lantern():
    game = logic()
    *_, (state, pid, move, result) = walk(game, 2, 11, chooser='computerMove')
    final = result['state']
    view = game.call('viewFor', final, 'p0', ctx=ctx(), seed=1)
    response = reduce(message(view, 0, status='over'))
    status = next(label for label in response['scene']['labels'] if label['id'] == 'status')['text']
    if len(final['winners']) == 1:
        assert status.endswith(' wins!')
    else:
        assert status.startswith('Shared win: ')
    rings = [p for p in response['scene']['pieces'] if p['id'].startswith('win-')]
    assert len(rings) == len(final['winners'])


def test_every_language_has_every_string_and_placeholder():
    source = PACKAGE['declarative_ui']['strings']
    import re
    for locale, translation in PACKAGE['translations'].items():
        strings = translation['client_strings']
        assert set(strings) == set(source), locale
        for key, text in source.items():
            assert set(re.findall(r'\{\w+\}', text)) == set(re.findall(r'\{\w+\}', strings[key])), (locale, key)
