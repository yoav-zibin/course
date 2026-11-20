"""Complete rule/UI traces and inactive controls for Jiayi's replacement games."""
import json
from pathlib import Path
import pytest
from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.tools.publish_declarative_games import play_trace

ROOT = Path(__file__).resolve().parents[1]

@pytest.mark.parametrize('kind', ['snap', 'slapjack'])
@pytest.mark.parametrize('count', [2, 6])
def test_replacement_finishes_through_offered_ui(kind, count):
    package = json.loads((ROOT / 'games/declarative' / f'{kind}.json').read_text())
    package['game_addition_request_id_and_secret'] = 'test-only-replacement-fixture'
    body = GameImport.model_validate(package)
    trace, observations = play_trace(body, seed=903, mode='pass_and_play', num_players=count)
    assert observations and trace['moves']
    assert trace['states'][-1]['winners']
    assert len(trace['states']) == len(trace['moves']) + 1
    ui = DeclarativeLogic(body.declarative_ui)
    observation = observations[0]
    message = {'type': 'state_changed', 'view': observation['view'], 'status': 'ongoing',
               'move_count': 0, 'my_player_index': observation['player_index'],
               'acting_for_player_index': observation['player_index'],
               'players': [{'name': f'Seat {i + 1}'} for i in range(count)], 'strings': {}}
    for extra in ({'acting_for_player_index': None}, {'replay': {'index': 0}}, {'status': 'over'}):
        inactive = {**message, **extra}
        frame = ui.reduce(inactive, None)
        assert not frame['scene']['controls']
        answer = ui.reduce({'type': 'ui_event', 'state_changed': inactive,
                            'event': {'type': 'tap', 'id': 'flip'}}, None)
        assert answer.get('make_move') is None
