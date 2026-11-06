import subprocess

import pytest

from game_platform.agent_import import MAX_BODY_BYTES, GameImport, prepare
from game_platform.tests.test_builder_flow import approved_draft


def payload():
    d = approved_draft()
    a = d.builder_workflow['artifacts']
    from game_platform.tests.test_builder_flow import fixture
    f = fixture()
    return dict(name=d.name, description=d.description, allowed_player_counts=[1],
                client_code=f['code'], server_code=f['server_code'],
                rules=a['logic']['value']['text'], ui_instructions=a['ui']['value']['text'],
                tutorial=a['tutorial']['value'], images=a['images']['value']['images'],
                unit_tests=f['contract'])


def test_authenticated_complete_import_is_private_and_reviewable(api):
    owner, other = api.new_user('Owner'), api.new_user('Other')
    body = payload()
    result = api.request('POST', '/agent/games', as_user=owner, json=body)
    assert result.status_code == 201, result.text
    d = result.json()
    assert d['owner_user_id'] == owner
    assert d['code'] == body['client_code']
    assert d['server_code'] == body['server_code']
    assert d['game_schemas'] == {k: body['unit_tests'][k + '_schema'] for k in ('state', 'move', 'view')}
    assert d['builder_workflow']['artifacts']['tests']['value'] == body['unit_tests']
    assert d['builder_workflow']['final_approval'] is None
    assert api.request('GET', f"/game-drafts/{d['id']}", as_user=other).status_code == 404
    assert api.request('GET', f"/games/{d['id']}").status_code == 404
    assert api.request('POST', f"/game-drafts/{d['id']}/publish", as_user=owner,
                       json={'expected_revision': d['revision']}).status_code == 409


@pytest.mark.parametrize('password', [None, 'wrong'])
def test_auth_precedes_upload_parsing(api, password):
    owner = api.new_user('Owner')
    headers = {} if password is None else {'X-User-Id': owner, 'X-User-Password': password}
    response = api.client.post('/agent/games', content=b'not json', headers=headers)
    assert response.status_code == 401
    assert api.ok('GET', '/game-drafts', as_user=owner) == []


@pytest.mark.parametrize('field,value', [('owner_user_id', 'someone-else'), ('id', 'existing'),
    ('published', True), ('server_code', ''), ('allowed_player_counts', [1, 1]),
    ('client_code', 'x' * 200001), ('tutorial', None)])
def test_reject_invalid_or_spoofed_fields_without_writes(api, field, value):
    owner = api.new_user('Owner')
    body = payload(); body[field] = value
    assert api.request('POST', '/agent/games', as_user=owner, json=body).status_code == 422
    assert api.ok('GET', '/game-drafts', as_user=owner) == []


def test_streaming_limit_and_media_types(api):
    owner = api.new_user('Owner')
    headers = {'X-User-Id': owner, 'X-User-Password': api.passwords_by_user_id[owner]}
    assert api.client.post('/agent/games', content='{}', headers=headers).status_code == 415
    headers['Content-Type'] = 'application/json'
    assert api.client.post('/agent/games', content=iter([b'x' * 450001] * 2), headers=headers).status_code == 413
    headers['Content-Encoding'] = 'gzip'
    assert api.client.post('/agent/games', content='{}', headers=headers).status_code == 415
    assert api.ok('GET', '/game-drafts', as_user=owner) == []


@pytest.mark.parametrize('mutation', ['svg', 'remote_schema', 'wrong_example', 'broken_code', 'unicode_size'])
def test_reject_unsafe_artifacts(api, mutation):
    owner = api.new_user('Owner'); body = payload()
    if mutation == 'svg': body['images'][0]['svg'] = '<svg><script>alert(1)</script></svg>'
    if mutation == 'remote_schema': body['unit_tests']['state_schema'] = {'$ref': 'https://example.com/private'}
    if mutation == 'wrong_example': body['unit_tests']['cases'][0]['expected_state'] = {'n': 999}
    if mutation == 'broken_code': body['server_code'] = 'while(true){}'
    if mutation == 'unicode_size': body['client_code'] = 'é' * 100001
    assert api.request('POST', '/agent/games', as_user=owner, json=body).status_code == 422
    assert api.ok('GET', '/game-drafts', as_user=owner) == []


def test_capacity_and_timeout_release_slots(api, monkeypatch):
    owner = api.new_user('Owner'); slots = api.client.app.state.builder_slots
    slots.acquire(); slots.acquire()
    try:
        assert api.request('POST', '/agent/games', as_user=owner, json=payload()).status_code == 429
    finally:
        slots.release(); slots.release()
    def timeout(*args, **kwargs): raise subprocess.TimeoutExpired('validator', 20)
    monkeypatch.setattr(subprocess, 'run', timeout)
    assert api.request('POST', '/agent/games', as_user=owner, json=payload()).status_code == 422
    assert slots.acquire(blocking=False) and slots.acquire(blocking=False)
    slots.release(); slots.release()
    assert api.ok('GET', '/game-drafts', as_user=owner) == []


def test_import_artifacts_roundtrip_existing_file_storage(tmp_path):
    from game_platform.json_file_store import write_snapshot, read_snapshot
    from game_platform.service import GamePlatform
    from game_platform.store import InMemoryStore
    store = InMemoryStore(); platform = GamePlatform(store=store)
    owner = platform.create_user(display_name='Owner'); body = GameImport(**payload())
    d = platform.save_game_draft(caller_id=owner.id, draft_id=None, expected_revision=None,
        name=body.name, description=body.description, rules=body.game_rules(),
        code=body.client_code, server_code=body.server_code,
        game_schemas=body.game_schemas(), _initial_workflow=prepare(body))
    path = tmp_path / 'data.json'; write_snapshot(path, store.snapshot())
    assert read_snapshot(path).game_drafts[0] == d


def test_openapi_documents_complete_payload(api):
    schema = api.client.get('/openapi.json').json()
    body = schema['paths']['/agent/games']['post']['requestBody']
    assert 'unit_tests' in body['content']['application/json']['schema']['required']
    assert api.client.get('/agent/games/schema').status_code == 401
    owner = api.new_user('Owner')
    assert api.ok('GET', '/agent/games/schema', as_user=owner)['additionalProperties'] is False


def test_malformed_json_and_server_error_do_not_echo_source(api, monkeypatch):
    owner = api.new_user('Owner')
    headers = {'X-User-Id': owner, 'X-User-Password': api.passwords_by_user_id[owner],
               'Content-Type': 'application/json'}
    result = api.client.post('/agent/games', content='{"private-source":', headers=headers)
    assert result.status_code == 422 and 'private-source' not in result.text
    def fail(*args, **kwargs):
        return subprocess.CompletedProcess(args=[], returncode=1, stdout='', stderr='secret internal path')
    monkeypatch.setattr(subprocess, 'run', fail)
    result = api.request('POST', '/agent/games', as_user=owner, json=payload())
    assert result.status_code == 422 and 'secret internal path' not in result.text
    assert api.ok('GET', '/game-drafts', as_user=owner) == []


def test_existing_games_untouched(api):
    owner = api.new_user('Owner')
    existing = api.new_game(owner=owner)
    before = api.ok('GET', f'/games/{existing}')
    imported = api.ok('POST', '/agent/games', as_user=owner, json=payload())
    assert imported['id'] != existing
    assert api.ok('GET', f'/games/{existing}') == before


def test_workflow_limit_rejects_before_storage(api):
    owner = api.new_user('Owner'); body = payload()
    body['unit_tests']['extra_documentation'] = 'x' * 400000
    assert api.request('POST', '/agent/games', as_user=owner, json=body).status_code == 422
    assert api.ok('GET', '/game-drafts', as_user=owner) == []


def test_upload_timeout_releases_capacity(api, monkeypatch):
    import asyncio
    import game_platform.agent_import as module
    owner = api.new_user('Owner')
    headers = {'X-User-Id': owner, 'X-User-Password': api.passwords_by_user_id[owner],
               'Content-Type': 'application/json'}
    monkeypatch.setattr(module, 'UPLOAD_TIMEOUT_SECONDS', 0.01)
    async def slow_stream(self):
        await asyncio.sleep(.05)
        yield b'{}'
    monkeypatch.setattr(module.Request, 'stream', slow_stream)
    assert api.client.post('/agent/games', content='{}', headers=headers).status_code == 408
    slots = api.client.app.state.builder_slots
    assert slots.acquire(blocking=False) and slots.acquire(blocking=False)
    slots.release(); slots.release()
