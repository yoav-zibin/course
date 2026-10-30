"""Corruption mutations and HTTP contract checks for the pure validator."""
from copy import deepcopy
import pytest
from game_platform.invariants import InvariantRequest, check_invariants


def snapshot():
    return dict(users=[dict(id="a"), dict(id="b")], games=[dict(id="g", version=1,
        owner_user_id="a", rules=dict(allowed_player_counts=[2]))], matches=[dict(
        id="m", game_id="g", game_version=1, owner_user_id="a", status="ongoing",
        seats=[dict(player_index=0, kind="human", user_id="a"), dict(player_index=1, kind="human", user_id="b")],
        initial_turn_player_indices=[0], turn_of_player_indices=[1],
        moves=[dict(move_number=1, player_index=0, made_by_user_id="a", next_turn_player_indices=[1])])])


def report(data):
    return check_invariants(InvariantRequest.model_validate(data))


def test_valid_snapshot_is_not_mutated():
    data = snapshot(); before = deepcopy(data)
    assert report(data).valid
    assert data == before


@pytest.mark.parametrize('field,value,code', [
    ('owner_user_id', 'missing', 'missing_user'),
    ('game_version', 9, 'missing_game_version'),
    ('turn_of_player_indices', [], 'invalid_turn_set'),
    ('turn_of_player_indices', [0], 'history_current_turn'),
    ('status', 'waiting_for_players', 'waiting_history'),
])
def test_match_corruption(field, value, code):
    data = snapshot(); data['matches'][0][field] = value
    assert code in {v.code for v in report(data).violations}


def test_history_uses_preceding_turn_not_resulting_turn():
    data = snapshot()
    assert report(data).valid  # seat 0 moves, granting seat 1 the next turn
    data['matches'][0]['moves'][0]['player_index'] = 1
    assert 'out_of_turn_move' in {v.code for v in report(data).violations}


def test_terminal_and_legacy_history():
    data = snapshot(); match = data['matches'][0]
    match['initial_turn_player_indices'] = None
    assert report(data).valid
    assert report(data).warnings[0].code == 'initial_turn_unavailable'
    match['moves'][0]['next_turn_player_indices'] = None
    match['moves'].append(dict(move_number=2, player_index=1, made_by_user_id='b', next_turn_player_indices=[0]))
    assert 'move_after_terminal' in {v.code for v in report(data).violations}


def test_replacement_chain_and_owned_assets():
    data = snapshot()
    data['users'][0].update(replaced_by_user_id='b')
    data['users'][1].update(replaced_by_user_id='a')
    codes = {v.code for v in report(data).violations}
    assert {'replacement_not_terminal', 'replaced_user_reference'} <= codes


def test_finished_shared_seats_after_merge_are_legal():
    data = snapshot(); match = data['matches'][0]
    match.update(status='over', turn_of_player_indices=None, end_reason='finished')
    match['moves'][0]['next_turn_player_indices'] = None
    match['seats'][1]['user_id'] = 'a'
    assert report(data).valid


def test_server_computer_author_and_dynamic_history_are_not_false_positives():
    data = snapshot(); game = data['games'][0]; match = data['matches'][0]
    game['server_code'] = 'server code not executed'
    game['rules']['allows_join_mid_match'] = True
    match['moves'][0].update(made_by_user_id='', player_index=1)
    assert report(data).valid
    assert any(w.code == 'membership_history_unavailable' for w in report(data).warnings)


def test_timeout_participation_is_checked():
    data = snapshot()
    data['users'].append(dict(id='old', replaced_by_user_id='a'))
    data['users'][0]['replaced_user_ids'] = ['old']
    data['matches'][0]['timeouts'] = [dict(player_index=1,user_id='old')]
    assert 'replaced_user_reference' in {v.code for v in report(data).violations}


def test_http_validation_does_not_require_real_server_records(api):
    response = api.client.post('/validation/invariants', json=snapshot())
    assert response.status_code == 200
    assert response.json()['valid']
    assert api.client.post('/validation/invariants', json={'users': 'wrong'}).status_code == 422
    data = snapshot(); data['matches'][0]['moves'][0]['player_index'] = True
    assert api.client.post('/validation/invariants', json=data).status_code == 422


def test_duplicate_keys_and_bounded_report():
    data = snapshot(); data['users'] *= 1100
    result = report(data)
    assert not result.valid and result.truncated
    assert len(result.violations) + len(result.warnings) == 1000


def test_http_malformed_snapshots_never_crash(api):
    import random
    rng = random.Random(912)
    invalid_values = [None, True, 3, 'bad', {'nested': []}]
    for step in range(60):
        data = snapshot()
        key = rng.choice(['users', 'games', 'matches'])
        data[key] = rng.choice(invalid_values)
        response = api.client.post('/validation/invariants', json=data)
        assert response.status_code == 422, (step, key, response.text)


def test_report_never_echoes_private_fields(api):
    data = snapshot()
    data['users'][0]['password'] = 'private-test-secret'
    data['users'][0]['email'] = 'private@example.invalid'
    data['matches'][0]['owner_user_id'] = 'missing'
    response = api.client.post('/validation/invariants', json=data)
    assert response.status_code == 200
    assert not response.json()['valid']
    assert 'private-test-secret' not in response.text
    assert 'private@example.invalid' not in response.text
