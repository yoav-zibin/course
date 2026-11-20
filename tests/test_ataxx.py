import json
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport
from game_platform.game_logic import GameLogic, InvalidMoveError


PACKAGE = Path(__file__).resolve().parents[1] / 'games' / 'declarative' / 'ataxx.json'


def logic():
    body = GameImport.model_validate(json.loads(PACKAGE.read_text(encoding='utf-8')))
    return GameLogic(body.server_code, game_schemas=body.game_schemas())


def context():
    return {
        'players': [
            {'id': 'black', 'kind': 'human', 'display_name': 'Black', 'picture_url': '', 'max_loss': 0},
            {'id': 'white', 'kind': 'human', 'display_name': 'White', 'picture_url': '', 'max_loss': 0},
        ],
        'pot': 9,
        'move_count': 0,
    }


def test_corner_setup_clone_and_jump():
    game = logic()
    ctx = context()
    match = game.call('newMatch', ctx=ctx, seed=1)
    state = match['state']
    assert len(state['board']) == 49
    assert [state['board'][cell] for cell in (0, 6, 42, 48)] == [0, 1, 1, 0]

    cloned = game.call('applyMove', state, 'black', {'from': 0, 'to': 1}, ctx=ctx, seed=2)
    assert cloned['state']['board'][0] == 0
    assert cloned['state']['board'][1] == 0

    jumped = game.call('applyMove', state, 'black', {'from': 0, 'to': 14}, ctx=ctx, seed=3)
    assert jumped['state']['board'][0] == -1
    assert jumped['state']['board'][14] == 0


def test_destination_converts_all_adjacent_opponents_including_diagonals():
    game = logic()
    ctx = context()
    state = game.call('newMatch', ctx=ctx, seed=4)['state']
    for cell in (2, 7, 8):
        state['board'][cell] = 1

    result = game.call('applyMove', state, 'black', {'from': 0, 'to': 1}, ctx=ctx, seed=5)

    assert [result['state']['board'][cell] for cell in (2, 7, 8)] == [0, 0, 0]


def test_player_with_no_legal_move_is_skipped():
    game = logic()
    ctx = context()
    state = game.call('newMatch', ctx=ctx, seed=6)['state']
    state['board'] = [0] * 49
    state['board'][0] = 1
    state['board'][25] = state['board'][26] = -1

    result = game.call('applyMove', state, 'black', {'from': 24, 'to': 25}, ctx=ctx, seed=7)

    assert result['turn'] == ['black']
    assert result['state']['over'] is False


def test_capturing_the_last_opponent_piece_wins():
    game = logic()
    ctx = context()
    state = game.call('newMatch', ctx=ctx, seed=8)['state']
    state['board'] = [-1] * 49
    state['board'][0] = state['board'][48] = 0
    state['board'][1] = 1

    result = game.call('applyMove', state, 'black', {'from': 0, 'to': 2}, ctx=ctx, seed=9)

    assert result['turn'] is None
    assert result['state']['winner'] == 0
    assert result['payouts'] == {'black': 9}


def test_move_limit_ends_with_piece_majority():
    game = logic()
    ctx = context()
    state = game.call('newMatch', ctx=ctx, seed=10)['state']
    state['turns'] = 299

    result = game.call('applyMove', state, 'black', {'from': 0, 'to': 1}, ctx=ctx, seed=11)

    assert result['turn'] is None
    assert result['state']['winner'] == 0
    assert result['payouts'] == {'black': 9}


def test_moves_beyond_two_squares_are_rejected():
    game = logic()
    ctx = context()
    state = game.call('newMatch', ctx=ctx, seed=12)['state']

    with pytest.raises(InvalidMoveError):
        game.call('applyMove', state, 'black', {'from': 0, 'to': 24}, ctx=ctx, seed=13)
