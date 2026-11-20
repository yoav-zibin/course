import json
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport
from game_platform.game_logic import GameLogic, InvalidMoveError


PACKAGE = Path(__file__).resolve().parents[1] / 'games' / 'declarative' / 'connect6.json'


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


def test_opening_uses_one_stone_then_each_turn_requires_two():
    game = logic()
    ctx = context()
    match = game.call('newMatch', ctx=ctx, seed=7)

    opening = game.call('applyMove', match['state'], 'black', {'cell': 0}, ctx=ctx, seed=7)
    assert opening['turn'] == ['white']
    assert opening['state']['opening'] is False
    assert opening['state']['pending'] == 0

    first = game.call('applyMove', opening['state'], 'white', {'cell': 1}, ctx=ctx, seed=8)
    assert first['turn'] == ['white']
    assert first['state']['pending'] == 1

    with pytest.raises(InvalidMoveError):
        game.call('applyMove', first['state'], 'white', {'cell': 1}, ctx=ctx, seed=9)

    second = game.call('applyMove', first['state'], 'white', {'cell': 2}, ctx=ctx, seed=9)
    assert second['turn'] == ['black']
    assert second['state']['pending'] == 0


@pytest.mark.parametrize(
    ('line', 'winning_cell'),
    [
        ([0, 1, 2, 3, 4], 5),
        ([0, 19, 38, 57, 76], 95),
        ([0, 20, 40, 60, 80], 100),
        ([5, 23, 41, 59, 77], 95),
    ],
)
def test_six_or_more_wins_on_every_line_axis(line, winning_cell):
    game = logic()
    ctx = context()
    match = game.call('newMatch', ctx=ctx, seed=11)
    state = match['state']
    state.update(opening=False, pending=1, turn=0)
    for cell in line:
        state['board'][cell] = 0

    result = game.call('applyMove', state, 'black', {'cell': winning_cell}, ctx=ctx, seed=12)

    assert result['turn'] is None
    assert result['state']['winner'] == 0
    assert result['payouts'] == {'black': 9}
