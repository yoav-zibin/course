"""Atomic same-checker gestures preserve canonical legality and ordinary moves."""
import json
from pathlib import Path

import pytest

from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.tests.test_declarative_backgammon import context, setup_board
from game_platform.tools.build_declarative_backgammon import source_schemas

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope='module')
def rules():
    package = json.loads((ROOT / 'games/declarative/backgammon.json').read_text())
    base = (ROOT / 'games/declarative/backgammon.server.js').read_text()
    retained = base + '\n' + (ROOT / 'games/declarative/backgammon-roll-history.js').read_text()
    return (GameLogic(package['server_code'], game_schemas=source_schemas()),
            GameLogic(retained, game_schemas=source_schemas()))


def offered(logic, state, ctx):
    view = logic.call('viewFor', state, 'a', ctx=ctx, seed=13)
    return {(move['from'], move['to']) for move in view['combinedMoves']}


def walk(logic, state, ctx, positions):
    result = {'state': state}
    for source, target in zip(positions, positions[1:]):
        result = logic.call('applyMove', result['state'], 'a',
                            {'action': 'move', 'from': source, 'to': target}, ctx=ctx, seed=13)
    return result


def test_doubles_offer_each_same_checker_prefix_and_apply_four_steps_as_one_command(rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, {9: 1}, {23: 15}, [1, 1, 1, 1])
    assert offered(combined, state, ctx) == {(9, 7), (9, 6), (9, 5)}
    for count in (2, 3, 4):
        result = combined.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 9 - count}, ctx=ctx, seed=13)
        assert result == walk(canonical, state, ctx, list(range(9, 8 - count, -1)))
        assert len(result['state']['moves']) == 4 - count
    assert result['state']['needRoll'] and result['state']['cur'] == 1


def test_normal_dice_combine_when_both_orders_have_the_same_complete_outcome(rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, {9: 1}, {23: 15}, [1, 4])
    assert offered(combined, state, ctx) == {(9, 4)}
    result = combined.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 4}, ctx=ctx, seed=13)
    assert result == walk(canonical, state, ctx, [9, 8, 4]) == walk(canonical, state, ctx, [9, 5, 4])


def test_equal_hit_counts_with_different_capture_locations_are_ambiguous(rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, {10: 1}, {9: 1, 6: 1, 23: 13}, [1, 4])
    first = walk(canonical, state, ctx, [10, 9, 5])
    second = walk(canonical, state, ctx, [10, 6, 5])
    assert first['state']['bar'] == second['state']['bar'] == [0, 1]
    assert first['state']['cnt'] != second['state']['cnt']
    assert (10, 5) not in offered(combined, state, ctx)
    with pytest.raises(InvalidMoveError):
        combined.call('applyMove', state, 'a', {'action': 'move', 'from': 10, 'to': 5}, ctx=ctx, seed=13)


def test_a_one_and_four_shortcut_is_ambiguous_when_only_one_order_hits_a_blot(rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, {10: 1}, {9: 1, 23: 14}, [1, 4])
    hit = walk(canonical, state, ctx, [10, 9, 5])
    clear = walk(canonical, state, ctx, [10, 6, 5])
    assert hit['state']['bar'] == [0, 1] and clear['state']['bar'] == [0, 0]
    assert (10, 5) not in offered(combined, state, ctx)
    with pytest.raises(InvalidMoveError):
        combined.call('applyMove', state, 'a', {'action': 'move', 'from': 10, 'to': 5}, ctx=ctx, seed=13)


def test_doubles_can_combine_through_forced_intermediate_hits(rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, {9: 1}, {8: 1, 6: 1, 23: 13}, [1, 1, 1, 1])
    assert offered(combined, state, ctx) == {(9, 7), (9, 6), (9, 5)}
    result = combined.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 5}, ctx=ctx, seed=13)
    assert result == walk(canonical, state, ctx, [9, 8, 7, 6, 5])
    assert result['state']['bar'] == [0, 2] and result['state']['cnt'][5] == 1


@pytest.mark.parametrize('own,enemy,path', [
    ({10: 1}, {9: 2, 23: 13}, [10, 6, 5]),
    ({9: 1}, {5: 2, 8: 1, 23: 12}, [9, 8, 4]),
])
def test_a_forced_legal_order_can_combine_even_when_it_hits(own, enemy, path, rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, own, enemy, [1, 4])
    assert (path[0], path[-1]) in offered(combined, state, ctx)
    result = combined.call('applyMove', state, 'a', {'action': 'move', 'from': path[0], 'to': path[-1]}, ctx=ctx, seed=13)
    assert result == walk(canonical, state, ctx, path)


def test_bearing_off_preserves_the_canonical_single_if_its_endpoint_is_already_legal(rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, {1: 1, 0: 1}, {23: 15}, [1, 2])
    direct = canonical.call('applyMove', state, 'a', {'action': 'move', 'from': 1, 'to': 'off'}, ctx=ctx, seed=13)
    indirect = walk(canonical, state, ctx, [1, 0, 'off'])
    assert direct['state']['cnt'] == indirect['state']['cnt']
    assert direct['state']['off'] == indirect['state']['off']
    assert direct['state']['moves'] != indirect['state']['moves']
    assert direct['turn'] != indirect['turn']
    assert (1, 'off') not in offered(combined, state, ctx)
    assert combined.call('applyMove', state, 'a', {'action': 'move', 'from': 1, 'to': 'off'}, ctx=ctx, seed=13) == direct


def test_bar_priority_prevents_switching_to_a_second_checker_mid_gesture(rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, {}, {0: 15}, [1, 2], bar=2)
    assert not offered(combined, state, ctx)
    with pytest.raises(InvalidMoveError):
        combined.call('applyMove', state, 'a', {'action': 'move', 'from': 'bar', 'to': 21}, ctx=ctx, seed=13)
    state = setup_board(combined, ctx, {}, {0: 15}, [1, 2], bar=1)
    assert offered(combined, state, ctx) == {('bar', 21)}
    result = combined.call('applyMove', state, 'a', {'action': 'move', 'from': 'bar', 'to': 21}, ctx=ctx, seed=13)
    assert result == walk(canonical, state, ctx, ['bar', 23, 21])


def test_canonical_maximum_use_and_higher_die_rules_still_filter_every_leg(rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, {}, {21: 2, 19: 13}, [1, 2], bar=1)
    expected = canonical.call('viewFor', state, 'a', ctx=ctx, seed=13)['legalMoves']
    assert expected == [{'from': 'bar', 'to': 22, 'die': 2, 'idx': 1}]
    assert combined.call('viewFor', state, 'a', ctx=ctx, seed=13)['legalMoves'] == expected
    assert not offered(combined, state, ctx)
    for destination in (21, 23):
        with pytest.raises(InvalidMoveError):
            combined.call('applyMove', state, 'a', {'action': 'move', 'from': 'bar', 'to': destination}, ctx=ctx, seed=13)


def test_shortcuts_cannot_cross_the_end_of_a_turn_or_continue_after_winning(rules):
    combined, canonical = rules
    ctx = context()
    state = setup_board(combined, ctx, {9: 1}, {23: 15}, [1, 1])
    assert offered(combined, state, ctx) == {(9, 7)}
    with pytest.raises(InvalidMoveError):
        combined.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 6}, ctx=ctx, seed=13)
    state = setup_board(combined, ctx, {0: 1}, {23: 15}, [1, 1, 1, 1])
    assert not offered(combined, state, ctx)
    result = combined.call('applyMove', state, 'a', {'action': 'move', 'from': 0, 'to': 'off'}, ctx=ctx, seed=13)
    assert result == canonical.call('applyMove', state, 'a', {'action': 'move', 'from': 0, 'to': 'off'}, ctx=ctx, seed=13)
    assert result['turn'] is None and len(result['state']['moves']) == 3


def test_compound_uses_the_real_command_count_and_preserves_canonical_endcaps(rules):
    combined, canonical = rules
    ctx = {**context(), 'move_count': 299}
    state = setup_board(combined, ctx, {9: 1}, {23: 15}, [1, 1, 1, 1])
    result = combined.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 5}, ctx=ctx, seed=13)
    assert result == walk(canonical, state, ctx, [9, 8, 7, 6, 5])
    assert result['state']['cnt'][5] == 1 and result['state']['winner'] is None
    state['n'] = 120
    ended = combined.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 5}, ctx=ctx, seed=13)
    assert ended == walk(canonical, state, ctx, [9, 8, 7, 6, 5])
    assert ended['state']['cnt'][5] == 1 and ended['turn'] is None
    capped = {**ctx, 'move_count': 301}
    assert not offered(combined, state, capped)
    assert combined.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 5}, ctx=capped, seed=13) == \
        canonical.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 5}, ctx=capped, seed=13)
