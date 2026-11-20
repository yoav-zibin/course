"""Presentation behavior independently exercised against portable reducer events."""
import base64

from game_platform.declarative_ui import DeclarativeLogic
from game_platform.tools.build_declarative_backgammon import specification


def changed(**overrides):
    view = {'owner': [1] + [-1] * 22 + [0], 'cnt': [15] + [0] * 22 + [15],
            'bar': [0, 0], 'off': [0, 0], 'cur': 0, 'n': 0, 'winner': None,
            'needRoll': True, 'dice': [], 'moves': [], 'legalMoves': [],
            'opening': True, 'opening_roll': None, 'can_undo': False,
            'configured': False, 'difficulty': 1, 'goal': 5, 'cube_enabled': True,
            'scores': [0, 0], 'round_winner': None,
            'cube': {'value': 1, 'owner': None, 'offer': None}, 'can_double': False}
    view.update(overrides)
    return {'type': 'state_changed', 'status': 'ongoing', 'state': view, 'view': view,
            'my_player_index': 0, 'acting_for_player_index': 0, 'turn_of_player_indices': [0],
            'move_count': 0, 'locale': 'en', 'direction': 'ltr', 'strings': {},
            'players': [{'player_index': 0, 'name': 'Alice', 'kind': 'human'},
                        {'player_index': 1, 'name': 'Computer', 'kind': 'computer'}]}


def tap(ui, message, frame, piece):
    return ui.reduce({'type': 'ui_event', 'state_changed': message,
                      'event': {'type': 'tap', 'id': piece}}, frame['local_state'])


def test_options_choose_real_settings_and_color_swap_without_mutating_authority():
    ui = DeclarativeLogic(specification())
    message = changed()
    frame = ui.reduce(message)
    assert not frame['scene']['targets']
    assert all(not piece['actions'] for piece in frame['scene']['pieces'] if piece['id'].startswith('die_'))
    for choice in ('goal_11', 'difficulty_3', 'cube_off', 'swap_colors'):
        frame = tap(ui, message, frame, choice)
        assert 'make_move' not in frame
    red_seat = next(piece for piece in frame['scene']['pieces'] if piece['id'] == 'checker_0_0')
    assert red_seat['asset'] == 'checker_ivory'
    started = tap(ui, message, frame, 'start_game')
    assert started['make_move'] == {'action': 'configure', 'difficulty': 3, 'goal': 11, 'cube_enabled': False}
    assert message['view']['configured'] is False
    assert message['view']['difficulty'] == 1


def test_help_owns_interaction_and_hint_is_only_a_local_legal_choice():
    ui = DeclarativeLogic(specification())
    message = changed(configured=True, opening=False, needRoll=False, dice=[1, 2], moves=[1, 2],
                      legalMoves=[{'from': 23, 'to': 22}, {'from': 23, 'to': 21}])
    frame = ui.reduce(message)
    hinted = tap(ui, message, frame, 'hint')
    assert 'make_move' not in hinted
    assert any(piece.get('selected') for piece in hinted['scene']['pieces'])
    assert any(label['id'] == 'hint_move' and '24 → 23' in label['text'] for label in hinted['scene']['labels'])
    help_frame = tap(ui, message, hinted, 'help')
    assert not help_frame['scene']['targets']
    assert not help_frame['scene']['controls']
    assert [piece['id'] for piece in help_frame['scene']['pieces'] if piece['actions']] == ['close_help']
    closed = tap(ui, message, help_frame, 'close_help')
    assert closed['scene']['targets']
    assert any(piece['actions'] == ['move'] for piece in closed['scene']['pieces'])


def test_capture_motion_is_stable_across_identical_authority_snapshots():
    ui = DeclarativeLogic(specification())
    before = changed(configured=True, opening=False, needRoll=False, dice=[1, 2], moves=[1, 2])
    frame = ui.reduce(before)
    after = changed(configured=True, opening=False, needRoll=False, dice=[2], moves=[2],
                    owner=[-1] * 23 + [0], cnt=[0] * 23 + [15], bar=[0, 1], off=[0, 14])
    after['move_count'] = 1
    moved = ui.reduce(after, frame['local_state'])
    capture = next(piece for piece in moved['scene']['pieces'] if piece.get('animation', {}).get('delay_ms') == 400)
    repeated = ui.reduce(after, moved['local_state'])
    assert next(piece for piece in repeated['scene']['pieces'] if piece['id'] == capture['id'])['animation'] == capture['animation']


def test_fixed_wood_board_declares_reference_motion_and_invisible_graph_cells():
    spec = specification()
    assert spec['viewport']['camera_enabled'] is False
    assert spec['motion'] == {'move_ms': 800, 'roll_ms': 500, 'roll_settle_ms': 1000,
                              'turn_pause_ms': 500, 'animate_own': True, 'easing': 'ease-in-out-quad'}
    main = next(board for board in spec['boards'] if board['id'] == 'main')
    assert len(main['cells']) == 24
    assert all(cell['color'] == '#00000000' for cell in main['cells'])
    assert main['line_color'] == '#00000000'
    assert next(cell for cell in main['cells'] if cell['id'] == '0')['x'] == 636
    artwork = base64.b64decode(spec['assets']['board_art']['uri'].split(',')[1]).decode()
    assert 'stroke-opacity=".12"' in artwork
    assert '<text' not in artwork


def test_opening_and_blocked_roll_notices_keep_their_clock_on_repeated_polls():
    ui = DeclarativeLogic(specification())
    before = changed(configured=True, opening_roll=[5, None])
    before['move_count'] = 1
    frame = ui.reduce(before)
    after = changed(configured=True, opening=False, opening_roll=[5, 2], needRoll=False,
                    dice=[5, 2], moves=[5, 2],
                    last_roll={'seat': 0, 'turn': 0, 'values': [5, 2], 'move_count': 2})
    after['move_count'] = 2
    advanced = ui.reduce(after, frame['local_state'])
    notice = next(piece for piece in advanced['scene']['pieces'] if piece['id'] == 'opening_notice')
    assert notice['text'] == 'Alice moves first'
    assert notice['animation'] == {'kind': 'notice', 'key': 'opening_notice:2',
                                   'duration_ms': 2000, 'delay_ms': 1000}
    repeated = ui.reduce(after, advanced['local_state'])
    assert next(piece for piece in repeated['scene']['pieces'] if piece['id'] == notice['id']) == notice

    ready = changed(configured=True, opening=False)
    initial = ui.reduce(ready)
    blocked = changed(configured=True, opening=False, cur=1, n=1,
                      last_roll={'seat': 0, 'turn': 0, 'values': [2, 3], 'move_count': 1})
    blocked['move_count'] = 1
    passed = ui.reduce(blocked, initial['local_state'])
    no_moves = next(piece for piece in passed['scene']['pieces'] if piece['id'] == 'no_moves_notice')
    assert no_moves['animation'] == {'kind': 'notice', 'key': 'no_moves_notice:1',
                                     'duration_ms': 2000, 'delay_ms': 1000}


def test_partial_opening_explains_one_die_and_only_offers_the_current_players_die():
    ui = DeclarativeLogic(specification())
    message = changed(configured=True, cur=1, opening_roll=[5, None])
    message.update(my_player_index=1, acting_for_player_index=1, turn_of_player_indices=[1])
    frame = ui.reduce(message)
    pieces = {piece['id']: piece for piece in frame['scene']['pieces']}
    labels = {label['id']: label['text'] for label in frame['scene']['labels']}
    assert pieces['die_0']['aria_label'] == 'Die 1: 5'
    assert pieces['die_0']['actions'] == []
    assert pieces['die_1']['aria_label'] == 'Die 2: roll your opening die'
    assert pieces['die_1']['actions'] == ['tap']
    assert pieces['roll']['text'] == 'Roll one die'
    assert labels['turn'] == 'Each player rolls one die.'
    assert labels['opening_status'] == 'Higher die starts with both dice.'
    assert not frame['scene']['targets']
    assert 'make_move' not in tap(ui, message, frame, 'die_0')
    assert tap(ui, message, frame, 'die_1')['make_move'] == {'action': 'roll'}


def test_opening_tie_feedback_survives_the_computer_reroll_repeated_polls_and_remount():
    ui = DeclarativeLogic(specification())
    # A human opening tie is immediately followed by the computer's new die.
    # This final frame previously looked identical to the initial one-die roll.
    message = changed(configured=True, cur=1, opening_roll=[5, None],
                      last_roll={'seat': 0, 'turn': 0, 'values': [5, 5], 'move_count': 5})
    message.update(move_count=6, my_player_index=1, acting_for_player_index=1,
                   turn_of_player_indices=[1])
    frame = ui.reduce(message)
    for state in (None, frame['local_state']):
        repeated = ui.reduce(message, state)
        label = next(item for item in repeated['scene']['labels'] if item['id'] == 'opening_status')
        assert label['text'] == 'Tie 5–5: roll one die again.'
        assert 'animation' not in label
        assert not repeated['scene']['targets']
        assert tap(ui, message, repeated, 'roll')['make_move'] == {'action': 'roll'}
    message['view']['opening_roll'] = [5, 5]
    tied = ui.reduce(message)
    assert next(piece for piece in tied['scene']['pieces'] if piece['id'] == 'die_1')['actions'] == ['tap']


def test_new_opening_instructions_are_localized_even_with_an_older_saved_locale_table():
    from game_platform.tools.build_declarative_backgammon import LOCALES, strings

    ui = DeclarativeLogic(specification())
    for index, locale in enumerate(LOCALES):
        table = strings(index)
        message = changed(configured=True, cur=1, opening_roll=[5, None],
                          last_roll={'seat': 0, 'turn': 0, 'values': [5, 5], 'move_count': 5})
        message.update(locale=locale, my_player_index=1, acting_for_player_index=1,
                       turn_of_player_indices=[1],
                       strings={key: value for key, value in table.items() if key not in (
                           'opening_rule', 'opening_goal', 'opening_tied_roll',
                           'opening_roll', 'opening_die_roll')})
        frame = ui.reduce(message)
        assert next(item for item in frame['scene']['labels'] if item['id'] == 'turn')['text'] == table['opening_rule']
        assert next(item for item in frame['scene']['labels'] if item['id'] == 'opening_status')['text'] == table['opening_tied_roll'].replace('{a}', '5').replace('{b}', '5')
        assert next(piece for piece in frame['scene']['pieces'] if piece['id'] == 'roll')['text'] == table['opening_roll']


def test_round_end_preserves_spent_faces_and_only_offers_the_next_game():
    ui = DeclarativeLogic(specification())
    before = changed(configured=True, opening=False, needRoll=False, n=4,
                     moves=[2, 5], dice=[2, 5],
                     last_roll={'seat': 0, 'turn': 4, 'values': [2, 5], 'move_count': 12})
    before['move_count'] = 12
    frame = ui.reduce(before)
    after = changed(configured=True, opening=False, needRoll=True, n=4,
                    scores=[1, 0], round_winner=0,
                    last_roll={'seat': 0, 'turn': 4, 'values': [2, 5], 'move_count': 12})
    after['move_count'] = 14
    result = ui.reduce(after, frame['local_state'])
    dice = [piece for piece in result['scene']['pieces'] if piece['type'] == 'die']
    assert [piece['asset'] for piece in dice] == ['die_2_used_2', 'die_5_used_2']
    assert all(not piece['actions'] for piece in dice)
    assert not result['scene']['targets']
    assert next(piece for piece in result['scene']['pieces'] if piece['id'] == 'next')['actions'] == ['tap']
    assert tap(ui, after, result, 'next')['make_move'] == {'action': 'next'}
