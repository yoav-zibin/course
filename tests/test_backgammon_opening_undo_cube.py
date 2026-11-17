"""Opening initiative, turn-local undo and cube offers use authoritative state."""
import copy
from pathlib import Path

import pytest

from game_platform.game_logic import GameLogic, InvalidMoveError
from game_platform.tests.test_declarative_backgammon import (
    apply_with_counted_random, context, setup_board,
)
from game_platform.tools.build_declarative_backgammon import source_schemas

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope='module')
def code():
    return '\n'.join((ROOT / 'games/declarative' / name).read_text() for name in (
        'backgammon.server.js', 'backgammon-roll-history.js',
        'backgammon-combined-moves.js', 'backgammon-opening-undo.js'))


@pytest.fixture(scope='module')
def rules(code):
    return GameLogic(code, game_schemas=source_schemas())


def board(rules, ctx, own=None, enemy=None, dice=(1, 2), bar=0):
    state = setup_board(rules, ctx, own or {6: 1}, enemy or {5: 1, 23: 14}, list(dice), bar)
    state.update(opening=False, opening_roll=None, undo_stack=[],
                 cube={'value': 1, 'owner': None, 'offer': None}, configured=True, difficulty=1,
                 cube_enabled=True, goal=1, scores=[0, 0], round_winner=None)
    return state


def configured(rules, ctx):
    state = rules.call('newMatch', ctx=ctx, seed=7)['state']
    return rules.call('applyMove', state, 'a', {'action': 'configure', 'difficulty': 1, 'goal': 5,
                                             'cube_enabled': True}, ctx=ctx, seed=7)['state']


def opening_pair(code, state, ctx, draws):
    count = 0
    for step in range(2):
        draw = draws[state['cur']]
        observed = apply_with_counted_random(code, state, {**ctx, 'move_count': ctx['move_count']+step},
                                             {'action': 'roll'}, (draw,))
        assert observed['count'] == 1
        count += observed['count']
        state = observed['result']['state']
    return {'count': count, 'result': observed['result']}


@pytest.mark.parametrize('draws,seat,faces', [
    ((.1, .8), 1, [1, 5]), ((.9, .2), 0, [6, 2]),
])
def test_each_seat_rolls_once_and_higher_opens_with_those_dice(code, rules, draws, seat, faces):
    ctx = context()
    original = configured(rules, ctx)
    assert original['opening'] and original['opening_roll'] == [None, None]
    first_seat = original['cur']
    first = apply_with_counted_random(code, original, ctx, {'action': 'roll'}, (draws[first_seat],))
    partial = first['result']['state']
    assert first['count'] == 1 and partial['opening'] and partial['needRoll']
    assert partial['opening_roll'][first_seat] == faces[first_seat]
    assert partial['opening_roll'][1-first_seat] is None
    assert partial['cur'] == 1-first_seat and partial['moves'] == []
    assert partial['last_roll'] is None
    partial_view = rules.call('viewFor', partial, None, ctx=ctx, seed=7)
    assert partial_view['opening_roll'] == partial['opening_roll']
    observed = opening_pair(code, original, ctx, draws)
    result, state = observed['result'], observed['result']['state']
    assert observed['count'] == 2
    assert state['opening'] is False and state['opening_roll'] == faces
    assert state['cur'] == seat and result['turn'] == [ctx['players'][seat]['id']]
    assert state['moves'] == state['dice'] == faces and not state['needRoll']
    assert state['last_roll'] == {'seat': seat, 'turn': 0, 'values': faces, 'move_count': 2}
    view = rules.call('viewFor', state, ctx['players'][seat]['id'], ctx=ctx, seed=7)
    assert not view['can_undo'] and view['legalMoves']
    public = rules.call('viewFor', state, None, ctx=ctx, seed=7)
    assert public['cnt'] == view['cnt'] and not public['legalMoves'] and not public['combinedMoves']
    assert 'undo_stack' not in view


def test_an_opening_tie_is_visible_and_rerolls_without_creating_four_moves(code, rules):
    ctx = context()
    original = configured(rules, ctx)
    tied = opening_pair(code, original, ctx, (.4, .4))
    state = tied['result']['state']
    assert tied['count'] == 2 and state['opening_roll'] == [3, 3]
    assert state['opening'] and state['needRoll'] and state['moves'] == []
    assert state['cur'] == original['cur'] and state['undo_stack'] == []
    view = rules.call('viewFor', state, None, ctx=ctx, seed=7)
    assert view['opening'] and view['opening_roll'] == [3, 3]
    assert not view['legalMoves'] and not view['can_undo'] and not view['can_double']
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', state, ctx['players'][state['cur']]['id'], {'action': 'undo'}, ctx=ctx, seed=7)
    next_roll = apply_with_counted_random(code, state, {**ctx, 'move_count': 2}, {'action': 'roll'}, (.8,))
    assert next_roll['count'] == 1 and next_roll['result']['state']['opening']
    assert next_roll['result']['state']['opening_roll'][1-state['cur']] is None
    resolved = opening_pair(code, state, {**ctx, 'move_count': 2}, (.8, .1))
    assert resolved['count'] == 2 and resolved['result']['state']['moves'] == [5, 1]
    assert resolved['result']['state']['opening'] is False


def test_opening_respects_current_player_and_malformed_move_schema(rules):
    ctx = context()
    state = configured(rules, ctx)
    other = ctx['players'][1-state['cur']]['id']
    with pytest.raises(InvalidMoveError, match='not your turn'):
        rules.call('applyMove', state, other, {'action': 'roll'}, ctx=ctx, seed=7)
    for action in ('undo', 'double', 'take', 'drop'):
        with pytest.raises(InvalidMoveError):
            rules.call('applyMove', state, ctx['players'][state['cur']]['id'], {'action': action}, ctx=ctx, seed=7)
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', state, ctx['players'][state['cur']]['id'],
                   {'action': 'roll', 'dice': [6, 6]}, ctx=ctx, seed=7)


def test_undo_restores_capture_dice_and_roll_without_randomness(code, rules):
    ctx = context()
    state = board(rules, ctx)
    state['last_roll'] = {'seat': 0, 'turn': 0, 'values': [1, 2], 'move_count': 1}
    before = copy.deepcopy(state)
    moved = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 6, 'to': 5}, ctx=ctx, seed=7)
    assert state == before
    assert moved['state']['bar'] == [0, 1] and moved['state']['moves'] == [2]
    view = rules.call('viewFor', moved['state'], 'a', ctx=ctx, seed=7)
    assert view['can_undo'] and 'undo_stack' not in view
    observed = apply_with_counted_random(code, moved['state'], ctx, {'action': 'undo'})
    assert observed['count'] == 0
    assert observed['result'] == {'state': before, 'turn': ['a']}
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', moved['state'], 'b', {'action': 'undo'}, ctx=ctx, seed=7)
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', before, 'a', {'action': 'undo'}, ctx=ctx, seed=7)


def test_combined_drag_is_one_undo_choice_and_finished_turn_cannot_be_undone(rules):
    ctx = context()
    state = board(rules, ctx, {9: 1}, {23: 15}, [1, 1, 1, 1])
    moved = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 7}, ctx=ctx, seed=7)
    assert moved['state']['moves'] == [1, 1] and len(moved['state']['undo_stack']) == 1
    undone = rules.call('applyMove', moved['state'], 'a', {'action': 'undo'}, ctx=ctx, seed=7)
    assert undone['state'] == state
    finished = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 5}, ctx=ctx, seed=7)
    assert finished['state']['needRoll'] and finished['state']['cur'] == 1
    assert finished['state']['undo_stack'] == []
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', finished['state'], 'b', {'action': 'undo'}, ctx=ctx, seed=7)


def test_cube_take_changes_ownership_and_restores_roller_without_rolling(code, rules):
    ctx = context()
    state = board(rules, ctx, dice=[])
    state['needRoll'] = True
    assert rules.call('viewFor', state, 'a', ctx=ctx, seed=7)['can_double']
    offered = apply_with_counted_random(code, state, ctx, {'action': 'double'})
    assert offered['count'] == 0
    pending = offered['result']['state']
    assert pending['cube'] == {'value': 1, 'owner': None, 'offer': 0}
    assert offered['result']['turn'] == ['b'] and pending['cur'] == 1
    assert rules.call('computerMove', pending, 'b', ctx=ctx, seed=7) == {'action': 'take'}
    for move in ({'action': 'roll'}, {'action': 'double'}, {'action': 'undo'}):
        with pytest.raises(InvalidMoveError):
            rules.call('applyMove', pending, 'b', move, ctx=ctx, seed=7)
    taken = apply_with_counted_random(code, pending, ctx, {'action': 'take'})
    assert taken['count'] == 0
    accepted = taken['result']['state']
    assert taken['result']['turn'] == ['a'] and accepted['needRoll']
    assert accepted['cube'] == {'value': 2, 'owner': 1, 'offer': None}
    assert not rules.call('viewFor', accepted, 'a', ctx=ctx, seed=7)['can_double']
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', accepted, 'a', {'action': 'double'}, ctx=ctx, seed=7)


def test_cube_drop_awards_original_pot_and_cannot_increase_the_stake(code, rules):
    ctx = context()
    state = board(rules, ctx, dice=[])
    state['needRoll'] = True
    offered = rules.call('applyMove', state, 'a', {'action': 'double'}, ctx=ctx, seed=7)
    dropped = rules.call('applyMove', offered['state'], 'b', {'action': 'drop'}, ctx=ctx, seed=7)
    assert dropped['turn'] is None and dropped['state']['winner'] == 0
    assert dropped['payouts'] == {'a': 10, 'b': 0}
    assert state['cube'] == {'value': 1, 'owner': None, 'offer': None}
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', state, 'a', {'action': 'double', 'value': 64}, ctx=ctx, seed=7)
    state['cube']['value'] = 64
    assert not rules.call('viewFor', state, 'a', ctx=ctx, seed=7)['can_double']
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', state, 'a', {'action': 'double'}, ctx=ctx, seed=7)


def test_snapshots_are_bounded_and_never_recursive(rules):
    ctx = context()
    state = board(rules, ctx, {20: 15}, {0: 15}, [1, 1, 1, 1])
    for step in range(3):
        move = rules.call('computerMove', state, 'a', ctx=ctx, seed=7)
        state = rules.call('applyMove', state, 'a', move, ctx=ctx, seed=7)['state']
        assert len(state['undo_stack']) == step + 1
        assert all('undo_stack' not in snapshot for snapshot in state['undo_stack'])
    for count in range(3, 0, -1):
        assert len(state['undo_stack']) == count
        state = rules.call('applyMove', state, 'a', {'action': 'undo'}, ctx=ctx, seed=7)['state']
    assert not state['undo_stack'] and state['moves'] == [1, 1, 1, 1]


def test_modern_matches_do_not_settle_at_arbitrary_action_or_turn_counts(rules):
    ctx = {**context(), 'move_count': 301}
    state = board(rules, ctx, {20: 15}, {0: 15}, [1])
    state['n'] = 120
    moved = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 20, 'to': 19}, ctx=ctx, seed=7)
    assert moved['turn'] == ['b'] and moved['state']['n'] == 121
    assert moved['state']['winner'] is None and moved['state']['round_winner'] is None
    assert 'payouts' not in moved and moved['state']['scores'] == [0, 0]
    rolled = rules.call('applyMove', moved['state'], 'b', {'action': 'roll'},
                        ctx={**ctx, 'move_count': 302}, seed=13)
    assert rolled['turn'] is not None and rolled['state']['winner'] is None
    assert rolled['state']['last_roll']['turn'] == 121
    assert rolled['state']['last_roll']['move_count'] == 303
    state = board(rules, ctx, {9: 1}, {23: 15}, [1, 1, 1, 1])
    state['n'] = 301
    view = rules.call('viewFor', state, 'a', ctx=ctx, seed=7)
    assert {'from': 9, 'to': 5} in view['combinedMoves'] and view['n'] == 301
    combined = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 9, 'to': 5}, ctx=ctx, seed=7)
    assert combined['state']['n'] == 302 and combined['turn'] == ['b']
    assert combined['state']['winner'] is None


def test_setup_is_authoritative_and_cannot_be_changed_after_starting(rules):
    ctx = context()
    initial = rules.call('newMatch', ctx=ctx, seed=7)
    state = initial['state']
    assert initial['turn'] == ['a'] and state['configured'] is False
    assert state['goal'] == 5 and state['difficulty'] == 1 and state['cube_enabled']
    view = rules.call('viewFor', state, 'a', ctx=ctx, seed=7)
    assert not view['legalMoves'] and not view['can_double'] and not view['can_undo']
    for malformed in (
        {'action': 'roll'},
        {'action': 'configure', 'difficulty': 4, 'goal': 5, 'cube_enabled': True},
        {'action': 'configure', 'difficulty': 3, 'goal': 2, 'cube_enabled': True},
        {'action': 'configure', 'difficulty': 3, 'goal': 15, 'cube_enabled': 'yes'},
        {'action': 'configure', 'difficulty': 3, 'goal': 15, 'cube_enabled': True, 'scores': [15, 0]},
    ):
        with pytest.raises(InvalidMoveError):
            rules.call('applyMove', state, 'a', malformed, ctx=ctx, seed=7)
    settings = {'action': 'configure', 'difficulty': 3, 'goal': 15, 'cube_enabled': False}
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', state, 'b', settings, ctx=ctx, seed=7)
    started = rules.call('applyMove', state, 'a', settings, ctx=ctx, seed=7)['state']
    assert started['configured'] and started['difficulty'] == 3 and started['goal'] == 15
    assert started['cube_enabled'] is False and started['scores'] == [0, 0]
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', started, 'a', settings, ctx=ctx, seed=7)
    started.update(opening=False, needRoll=True)
    assert not rules.call('viewFor', started, 'a', ctx=ctx, seed=7)['can_double']
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', started, 'a', {'action': 'double'}, ctx=ctx, seed=7)


@pytest.mark.parametrize('enemy,bar,multiplier', [
    ({20: 14}, 0, 1), ({20: 15}, 0, 2), ({0: 1, 20: 14}, 0, 3), ({20: 14}, 1, 3),
])
def test_round_score_counts_cube_gammon_and_backgammon_then_next_resets_only_board(rules, enemy, bar, multiplier):
    ctx = context()
    state = board(rules, ctx, {1: 1}, enemy, [2])
    state.update(goal=15, scores=[0, 1], difficulty=3)
    state['cube'] = {'value': 4, 'owner': 1, 'offer': None}
    if bar:
        state['bar'][1] = bar
        state['off'][1] = 0
    result = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 1, 'to': 'off'}, ctx=ctx, seed=7)
    final = result['state']
    assert final['scores'] == [4 * multiplier, 1]
    assert final['round_winner'] == 0 and final['winner'] is None
    assert result['turn'] == ['a'] and 'payouts' not in result
    view = rules.call('viewFor', final, 'a', ctx=ctx, seed=7)
    assert not view['legalMoves'] and not view['can_double'] and not view['can_undo']
    assert rules.call('computerMove', final, 'a', ctx=ctx, seed=7) == {'action': 'next'}
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', final, 'a', {'action': 'roll'}, ctx=ctx, seed=7)
    next_round = rules.call('applyMove', final, 'a', {'action': 'next'}, ctx=ctx, seed=7)['state']
    initial = rules.call('newMatch', ctx=ctx, seed=7)['state']
    for field in ('owner', 'cnt', 'bar', 'off', 'moves', 'dice', 'opening_roll', 'cube'):
        assert next_round[field] == initial[field]
    assert next_round['opening'] and next_round['configured'] and next_round['round_winner'] is None
    assert next_round['scores'] == final['scores'] and next_round['difficulty'] == 3
    assert next_round['goal'] == 15 and next_round['n'] == 0 and next_round['last_roll'] is None


def test_reaching_match_goal_pays_once_and_cube_drop_awards_a_single_game(rules):
    ctx = context()
    state = board(rules, ctx, {0: 1}, {20: 15}, [1])
    state.update(goal=7, scores=[2, 0])
    state['cube']['value'] = 4
    ended = rules.call('applyMove', state, 'a', {'action': 'move', 'from': 0, 'to': 'off'}, ctx=ctx, seed=7)
    assert ended['state']['scores'] == [10, 0] and ended['state']['winner'] == 0
    assert ended['turn'] is None and ended['payouts'] == {'a': 10, 'b': 0}
    with pytest.raises(InvalidMoveError):
        rules.call('applyMove', ended['state'], 'a', {'action': 'next'}, ctx=ctx, seed=7)
    state = board(rules, ctx, dice=[])
    state.update(goal=5, scores=[1, 0], needRoll=True)
    state['cube']['value'] = 2
    offered = rules.call('applyMove', state, 'a', {'action': 'double'}, ctx=ctx, seed=7)
    dropped = rules.call('applyMove', offered['state'], 'b', {'action': 'drop'}, ctx=ctx, seed=7)
    assert dropped['state']['scores'] == [3, 0] and dropped['state']['round_winner'] == 0
    assert dropped['turn'] == ['a'] and 'payouts' not in dropped


def test_difficulty_changes_real_legal_choices_without_seeing_future_dice(code, rules):
    ctx = context()
    state = board(rules, ctx, {8: 2, 9: 3, 5: 3, 14: 3, 23: 3},
                  {21: 2, 17: 2, 16: 3, 2: 3, 3: 3}, [4, 5])
    expected = [
        {'action': 'move', 'from': 5, 'to': 1}, {'action': 'move', 'from': 9, 'to': 5},
        {'action': 'move', 'from': 14, 'to': 9}, {'action': 'move', 'from': 23, 'to': 18},
    ]
    for difficulty, command in enumerate(expected):
        state['difficulty'] = difficulty
        original = copy.deepcopy(state)
        for _ in range(2):
            move = rules.call('computerMove', state, 'a', ctx=ctx, seed=7)
            assert move == command and state == original
            rules.call('applyMove', state, 'a', move, ctx=ctx, seed=7)
        # Every level's choice uses the current legal pair; the next accepted
        # roll still draws exactly the supplied pair, independently of planning.
        ready = copy.deepcopy(state)
        ready.update(needRoll=True, moves=[], dice=[])
        observed = apply_with_counted_random(code, ready, ctx, {'action': 'roll'}, (.1, .8))
        assert observed['count'] == 2 and observed['result']['state']['last_roll']['values'] == [1, 5]


def test_real_computer_match_continues_across_rounds_until_goal_and_pays_once(rules):
    ctx = context()
    result = rules.call('newMatch', ctx=ctx, seed=7)
    result = rules.call('applyMove', result['state'], 'a',
                        {'action': 'configure', 'difficulty': 2, 'goal': 3, 'cube_enabled': True},
                        ctx=ctx, seed=7)
    completed_rounds = 0
    for count in range(1, 1500):
        ctx['move_count'] = count
        state = result['state']
        player = result['turn'][0]
        move = rules.call('computerMove', state, player, ctx=ctx, seed=count + 11)
        if state['round_winner'] is not None:
            completed_rounds += 1
            assert move == {'action': 'next'}
            assert max(state['scores']) < state['goal'] and 'payouts' not in result
        result = rules.call('applyMove', state, player, move, ctx=ctx, seed=count + 11)
        after = result['state']
        for seat in range(2):
            assert after['off'][seat] + after['bar'][seat] + sum(
                amount for owner, amount in zip(after['owner'], after['cnt']) if owner == seat) == 15
        if result['turn'] is None:
            assert after['off'][after['winner']] == 15
            assert after['scores'][after['winner']] >= 3 and sum(result['payouts'].values()) == 10
            assert completed_rounds > 0
            break
    else:
        pytest.fail('The deterministic computer match did not reach its real score goal')
