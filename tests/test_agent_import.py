import subprocess

import pytest

from game_platform.agent_import import AGENT_IMPORT_OWNER_ID, MAX_BODY_BYTES, GameImport, prepare
from game_platform.i18n import LOCALE_CODES as LANGUAGES


def translations_for(body):
    """Translations of the payload's own texts, marked with the locale so a test can
    tell a supplied translation from a machine one."""
    from game_platform.game_tutorial import vocabulary
    from game_platform.game_text import extract_strings
    table = extract_strings(body['client_code']) or {}
    tutorial_vocab = vocabulary(body['tutorial']['html'])
    out = {}
    for locale in LANGUAGES:
        if locale == 'en':
            continue
        mark = f'[{locale}] '
        out[locale] = {
            'display_name': mark + body['name'],
            'short_description': mark + body['description'],
            'game_logic_rules': mark + body['rules'],
            'game_ui_rules': mark + body['ui_instructions'],
            'tutorial_strings': {s: mark + s for s in tutorial_vocab},
            'client_strings': {k: mark + v for k, v in table.items()},
        }
    return out


def payload():
    """A complete import body, standalone: the hand-written example game, with its
    translations re-marked per locale so tests can tell a supplied translation
    from a machine one. No builder fixture is involved."""
    import json
    from pathlib import Path
    body = json.loads((Path(__file__).resolve().parent.parent / 'examples' / 'agent-game.json').read_text())
    body['translations'] = translations_for(body)
    return body


def assert_no_games(api):
    assert api.ok('GET', '/games') == []


def test_authenticated_complete_import_is_published_and_translated(api):
    owner, other = api.new_user('Owner'), api.new_user('Other')
    body = payload()
    result = api.request('POST', '/games', as_user=owner, json=body)
    assert result.status_code == 201, result.text
    g = result.json()
    assert g['owner_user_id'] == owner
    assert g['version'] == 1 and g['published'] is True
    assert g['code'] == body['client_code']
    assert g['server_code'] == body['server_code']
    assert g['game_schemas'] == {k: body['unit_tests'][k + '_schema'] for k in ('state', 'move', 'view')}
    assert g['game_logic_rules'] == body['rules']
    assert g['game_ui_rules'] == body['ui_instructions']
    assert g['tutorial_html'] == body['tutorial']['html']
    assert sorted(g['translations']) == sorted(LANGUAGES)
    assert g['translations']['es']['display_name'] == '[es] ' + body['name']
    assert g['translations']['en']['display_name'] == body['name']
    # Published: anyone can read the game, and drafts no longer exist at all.
    assert api.request('GET', f"/games/{g['id']}").status_code == 200
    assert api.request('GET', '/game-drafts', as_user=owner).status_code == 404
    assert api.request('GET', f"/game-drafts/{g['id']}", as_user=owner).status_code == 404
    # The supplied translations are served: per-game strings and the portal bundle.
    strings = api.ok('GET', f"/games/{g['id']}/versions/1/strings", params={'lang': 'es'})
    assert strings['status'] == 'translated'
    assert strings['name'] == '[es] ' + body['name']
    assert strings['description'] == '[es] ' + body['description']
    assert strings['strings']['add'] == '[es] Add one'
    bundle = api.ok('GET', '/i18n/bundle/es')
    assert bundle['games'][g['id']]['name'] == '[es] ' + body['name']
    assert bundle['games'][g['id']]['status'] == 'translated'


def test_anonymous_import_publishes_an_ownerless_game(api):
    body = payload()
    result = api.client.post('/games', json=body)
    assert result.status_code == 201, result.text
    g = result.json()
    assert g['owner_user_id'] == AGENT_IMPORT_OWNER_ID
    assert g['version'] == 1 and g['published'] is True
    assert api.request('GET', f"/games/{g['id']}").status_code == 200
    # No account owns it, so no one can unpublish it.
    owner = api.new_user('Owner')
    assert api.request('POST', f"/games/{g['id']}/unpublish", as_user=owner).status_code == 403


def test_resubmission_with_the_same_request_id_updates_the_game(api):
    owner = api.new_user('Owner')
    secret = 'resubmit-secret-0123456789'
    body = payload(); body['game_addition_request_id_and_secret'] = secret
    first = api.ok('POST', '/games', as_user=owner, json=body)
    assert first['version'] == 1
    updated = payload()
    updated['game_addition_request_id_and_secret'] = secret
    updated['description'] = 'Reach three by adding one, now with a twist.'
    updated['translations'] = translations_for(updated)
    second = api.ok('POST', '/games', as_user=owner, json=updated)
    assert second['id'] == first['id']
    assert second['version'] == 2
    assert second['description'] == updated['description']
    assert second['translations']['es']['short_description'] == '[es] ' + updated['description']
    assert api.ok('GET', f"/games/{first['id']}")['version'] == 2
    strings = api.ok('GET', f"/games/{first['id']}/versions/2/strings", params={'lang': 'es'})
    assert strings['description'] == '[es] ' + updated['description']


def test_resubmission_may_redesign_the_state_shape(api):
    """A resubmission carrying a new import package is gated on the NEW
    package's tests, not the stored one. Here the state field is renamed
    n -> m in the code, the schemas and the cases alike; the stored
    contract (additionalProperties: false, requires n) could never pass
    against the redesigned code."""
    owner = api.new_user('Owner')
    secret = 'redesign-secret-0123456789'
    body = payload(); body['game_addition_request_id_and_secret'] = secret
    first = api.ok('POST', '/games', as_user=owner, json=body)
    assert first['version'] == 1

    def rename(value):
        if isinstance(value, dict):
            return {('m' if key == 'n' else key): rename(item) for key, item in value.items()}
        if isinstance(value, list):
            return ['m' if item == 'n' else rename(item) for item in value]
        return value

    updated = payload()
    updated['game_addition_request_id_and_secret'] = secret
    updated['server_code'] = (
        updated['server_code']
        .replace('{n:0}', '{m:0}')
        .replace('state.n', 'state.m')
        .replace('const n=', 'const m=')
        .replace('n>=3', 'm>=3')
        .replace('{n}', '{m}')
        .replace('{n:state.m}', '{m:state.m}')
    )
    updated['client_code'] = updated['client_code'].replace('.n', '.m')
    updated['unit_tests'] = rename(updated['unit_tests'])
    updated['translations'] = translations_for(updated)
    second = api.ok('POST', '/games', as_user=owner, json=updated)
    assert second['id'] == first['id'] and second['version'] == 2
    assert second['game_schemas']['state']['required'] == ['m']


def test_identical_resubmission_is_a_noop(api):
    owner = api.new_user('Owner')
    body = payload(); body['game_addition_request_id_and_secret'] = 'identical-secret-0123456789'
    first = api.ok('POST', '/games', as_user=owner, json=body)
    second = api.ok('POST', '/games', as_user=owner, json=body)
    assert second['id'] == first['id'] and second['version'] == 1
    assert api.ok('GET', '/games') != [] and len(api.ok('GET', '/games')) == 1


def test_a_missing_request_id_is_rejected(api):
    owner = api.new_user('Owner')
    body = payload(); del body['game_addition_request_id_and_secret']
    assert api.request('POST', '/games', as_user=owner, json=body).status_code == 422
    assert_no_games(api)


def test_a_different_secret_creates_a_new_game(api):
    owner = api.new_user('Owner')
    body = payload(); body['game_addition_request_id_and_secret'] = 'secret-one-0123456789'
    first = api.ok('POST', '/games', as_user=owner, json=body)
    body['game_addition_request_id_and_secret'] = 'secret-two-0123456789'
    second = api.ok('POST', '/games', as_user=owner, json=body)
    assert second['id'] != first['id']
    assert len(api.ok('GET', '/games')) == 2


def test_short_request_id_is_rejected(api):
    owner = api.new_user('Owner')
    body = payload(); body['game_addition_request_id_and_secret'] = 'too-short'
    assert api.request('POST', '/games', as_user=owner, json=body).status_code == 422
    assert_no_games(api)


def test_anonymous_resubmission_updates_an_ownerless_game(api):
    secret = 'anonymous-secret-0123456789'
    body = payload(); body['game_addition_request_id_and_secret'] = secret
    first = api.ok('POST', '/games', json=body)
    assert first['owner_user_id'] == AGENT_IMPORT_OWNER_ID
    updated = payload()
    updated['game_addition_request_id_and_secret'] = secret
    updated['description'] = 'Reach three by adding one, anonymously updated.'
    updated['translations'] = translations_for(updated)
    second = api.ok('POST', '/games', json=updated)
    assert second['id'] == first['id'] and second['version'] == 2
    assert second['owner_user_id'] == AGENT_IMPORT_OWNER_ID


def test_resubmission_by_another_user_updates_via_the_secret(api):
    first_owner = api.new_user('First'); second_owner = api.new_user('Second')
    secret = 'shared-secret-0123456789'
    body = payload(); body['game_addition_request_id_and_secret'] = secret
    first = api.ok('POST', '/games', as_user=first_owner, json=body)
    updated = payload()
    updated['game_addition_request_id_and_secret'] = secret
    updated['description'] = 'Reach three by adding one, updated by another account.'
    updated['translations'] = translations_for(updated)
    second = api.ok('POST', '/games', as_user=second_owner, json=updated)
    assert second['id'] == first['id'] and second['version'] == 2
    assert second['owner_user_id'] == first_owner


def test_wrong_password_is_rejected_before_upload_parsing(api):
    owner = api.new_user('Owner')
    headers = {'X-User-Id': owner, 'X-User-Password': 'wrong'}
    response = api.client.post('/games', content=b'not json', headers=headers)
    assert response.status_code == 401
    assert_no_games(api)


def test_anonymous_malformed_body_is_rejected_by_validation(api):
    headers = {'Content-Type': 'application/json'}
    response = api.client.post('/games', content=b'not json', headers=headers)
    assert response.status_code == 422
    assert_no_games(api)


@pytest.mark.parametrize('field,value', [('owner_user_id', 'someone-else'), ('id', 'existing'),
    ('published', True), ('server_code', ''), ('allowed_player_counts', [1, 1]),
    ('client_code', 'x' * 200001), ('tutorial', None)])
def test_reject_invalid_or_spoofed_fields_without_writes(api, field, value):
    owner = api.new_user('Owner')
    body = payload(); body[field] = value
    assert api.request('POST', '/games', as_user=owner, json=body).status_code == 422
    assert_no_games(api)


def test_a_game_still_needs_client_code(api):
    owner = api.new_user('Owner'); body = payload()
    del body['client_code']
    assert api.request('POST', '/games', as_user=owner, json=body).status_code == 422
    assert_no_games(api)


@pytest.mark.parametrize('mutation', ['missing_translations', 'missing_locale',
    'missing_client_string', 'missing_tutorial_string', 'extra_locale'])
def test_reject_missing_or_incomplete_translations(api, mutation):
    owner = api.new_user('Owner'); body = payload()
    if mutation == 'missing_translations':
        del body['translations']
    elif mutation == 'missing_locale':
        del body['translations']['es']
    elif mutation == 'missing_client_string':
        del body['translations']['es']['client_strings']['add']
    elif mutation == 'missing_tutorial_string':
        del body['translations']['es']['tutorial_strings']['How to play']
    elif mutation == 'extra_locale':
        body['translations']['en'] = body['translations']['es']
    assert api.request('POST', '/games', as_user=owner, json=body).status_code == 422
    assert_no_games(api)


def test_reject_translation_with_changed_placeholder(api):
    owner = api.new_user('Owner'); body = payload()
    body['rules'] = 'One player adds one each turn, starting at zero. End at {target}. No stakes, joining or leaving.'
    body['translations'] = translations_for(body)
    body['translations']['es']['game_logic_rules'] = 'Un jugador suma uno en cada turno.'
    assert api.request('POST', '/games', as_user=owner, json=body).status_code == 422
    assert_no_games(api)


def test_failed_verification_reports_how_to_reproduce_it_and_inserts_nothing(api):
    """A game whose server code fails verification is refused with a 422
    that says how to reproduce the failure (seed, ctx, exact arguments,
    result, time and memory), and nothing is inserted."""
    owner = api.new_user('Owner'); body = payload()
    # The counter game, but applyMove returns a turn naming a player who
    # is not in the match: the approved examples and the random walks both
    # fail, and the walks report the exact call that broke.
    body['server_code'] = (
        "const game={newMatch(ctx){return {state:{n:0},turn:[ctx.players[0].id]};},"
        "applyMove(state,id,move,ctx){if(move.add!==1)throw new InvalidMove('Add one');"
        "const n=state.n+1;return n>=3?{state:{n},turn:null,"
        "payouts:Object.fromEntries(ctx.players.filter(p=>p.kind==='human').map(p=>[p.id,ctx.pot]))}"
        ":{state:{n},turn:['ghost-player']};},"
        "viewFor(state,id,ctx){return {n:state.n};},"
        "computerMove(){return {add:1}},randomMove(){return {add:1}}};"
    )
    response = api.request('POST', '/games', as_user=owner, json=body)
    assert response.status_code == 422
    detail = response.json()['detail']
    assert 'Game verification failed' in detail
    assert 'seed' in detail and 'ctx:' in detail and 'arguments:' in detail
    assert 'took' in detail and 'memory' in detail
    assert 'ghost-player' in detail
    assert_no_games(api)


def test_reject_test_case_roster_outside_allowed_player_counts(api):
    """A unit test whose ctx roster is not one of the allowed player
    counts is rejected: a human plus a computer is two seats."""
    owner = api.new_user('Owner'); body = payload()
    case = body['unit_tests']['cases'][0]
    case['ctx']['players'].append(
        {"id": "u2", "kind": "computer", "max_loss": 0})
    response = api.request('POST', '/games', as_user=owner, json=body)
    assert response.status_code == 422
    assert 'roster' in response.json()['detail'].lower()
    assert_no_games(api)


def test_streaming_limit_and_media_types(api):
    owner = api.new_user('Owner')
    headers = {'X-User-Id': owner, 'X-User-Password': api.passwords_by_user_id[owner]}
    assert api.client.post('/games', content='{}', headers=headers).status_code == 415
    headers['Content-Type'] = 'application/json'
    assert api.client.post('/games', content=iter([b'x' * 450001] * 2), headers=headers).status_code == 413
    headers['Content-Encoding'] = 'gzip'
    assert api.client.post('/games', content='{}', headers=headers).status_code == 415
    assert_no_games(api)


@pytest.mark.parametrize('mutation', ['svg', 'remote_schema', 'wrong_example', 'broken_code', 'unicode_size'])
def test_reject_unsafe_artifacts(api, mutation):
    owner = api.new_user('Owner'); body = payload()
    if mutation == 'svg': body['images'][0]['svg'] = '<svg><script>alert(1)</script></svg>'
    if mutation == 'remote_schema': body['unit_tests']['state_schema'] = {'$ref': 'https://example.com/private'}
    if mutation == 'wrong_example': body['unit_tests']['cases'][0]['expected_state'] = {'n': 999}
    if mutation == 'broken_code': body['server_code'] = 'while(true){}'
    if mutation == 'unicode_size': body['client_code'] = 'é' * 100001
    assert api.request('POST', '/games', as_user=owner, json=body).status_code == 422
    assert_no_games(api)


def test_capacity_and_timeout_release_slots(api, monkeypatch):
    owner = api.new_user('Owner'); slots = api.client.app.state.import_slots
    slots.acquire(); slots.acquire()
    try:
        assert api.request('POST', '/games', as_user=owner, json=payload()).status_code == 429
    finally:
        slots.release(); slots.release()
    def timeout(*args, **kwargs): raise subprocess.TimeoutExpired('validator', 20)
    monkeypatch.setattr(subprocess, 'run', timeout)
    assert api.request('POST', '/games', as_user=owner, json=payload()).status_code == 422
    assert slots.acquire(blocking=False) and slots.acquire(blocking=False)
    slots.release(); slots.release()
    assert_no_games(api)


def test_imported_game_roundtrips_existing_file_storage(tmp_path):
    # An imported game (no draft involved) survives a file-storage round-trip.
    from game_platform.json_file_store import write_snapshot, read_snapshot
    from game_platform.service import GamePlatform
    from game_platform.store import InMemoryStore
    store = InMemoryStore(); platform = GamePlatform(store=store)
    owner = platform.create_user(display_name='Owner'); body = GameImport(**payload())
    game = platform.import_agent_game(caller_id=owner.id, name=body.name,
        description=body.description, rules=body.game_rules(),
        code=body.client_code, server_code=body.server_code,
        game_schemas=body.game_schemas(), import_package=prepare(body))
    assert game.published is True and game.version == 1
    path = tmp_path / 'data.json'; write_snapshot(path, store.snapshot())
    assert read_snapshot(path).game_versions[0] == game


def test_openapi_documents_complete_payload(api):
    schema = api.client.get('/openapi.json').json()
    body = schema['paths']['/games']['post']['requestBody']
    required = body['content']['application/json']['schema']['required']
    assert 'unit_tests' in required and 'translations' in required
    # The schema is public now: credentials are optional for the whole endpoint.
    assert api.ok('GET', '/games/schema')['additionalProperties'] is False
    # The old /agent/games path is gone: the import lives at POST /games now.
    assert api.client.post('/agent/games', json=payload()).status_code == 404


def test_malformed_json_and_server_error_do_not_echo_source(api, monkeypatch):
    owner = api.new_user('Owner')
    headers = {'X-User-Id': owner, 'X-User-Password': api.passwords_by_user_id[owner],
               'Content-Type': 'application/json'}
    result = api.client.post('/games', content='{"private-source":', headers=headers)
    assert result.status_code == 422 and 'private-source' not in result.text
    def fail(*args, **kwargs):
        return subprocess.CompletedProcess(args=[], returncode=1, stdout='', stderr='secret internal path')
    monkeypatch.setattr(subprocess, 'run', fail)
    result = api.request('POST', '/games', as_user=owner, json=payload())
    assert result.status_code == 422 and 'secret internal path' not in result.text
    assert_no_games(api)


def test_existing_games_untouched(api):
    owner = api.new_user('Owner')
    existing = api.new_game(owner=owner)
    before = api.ok('GET', f'/games/{existing}')
    imported = api.ok('POST', '/games', as_user=owner, json=payload())
    assert imported['id'] != existing
    assert api.ok('GET', f'/games/{existing}') == before


def test_import_stores_only_the_secret_hash(api):
    import hashlib
    import json
    secret = 'hash-storage-secret-0123456789'
    body = payload(); body['game_addition_request_id_and_secret'] = secret
    created = api.ok('POST', '/games', json=body)
    package = api.platform.find_game_by_id(created['id']).import_package
    assert package['game_addition_request_secret_hash'] == \
        hashlib.sha256(secret.encode()).hexdigest()
    assert 'game_addition_request_id_and_secret' not in package
    assert secret not in json.dumps(package)


def master_api():
    from game_platform.tests.helpers import Api
    return Api(master_password='the-master-password-0123')


def test_master_password_with_game_id_updates_the_named_game():
    import hashlib
    api = master_api()
    secret = 'real-secret-0123456789abcdef'
    body = payload(); body['game_addition_request_id_and_secret'] = secret
    first = api.ok('POST', '/games', json=body)
    updated = payload()
    updated['game_addition_request_id_and_secret'] = 'the-master-password-0123'
    updated['game_id'] = first['id']
    updated['description'] = 'Refactored without knowing the secret.'
    updated['translations'] = translations_for(updated)
    second = api.ok('POST', '/games', json=updated)
    assert second['id'] == first['id'] and second['version'] == 2
    assert second['description'] == updated['description']
    # The game kept its own secret: the stored hash is unchanged, and the
    # real secret still updates the game afterwards.
    package = api.platform.find_game_by_id(first['id']).import_package
    assert package['game_addition_request_secret_hash'] == \
        hashlib.sha256(secret.encode()).hexdigest()
    again = payload(); again['game_addition_request_id_and_secret'] = secret
    again['description'] = 'Updated with the real secret again.'
    again['translations'] = translations_for(again)
    third = api.ok('POST', '/games', json=again)
    assert third['id'] == first['id'] and third['version'] == 3


def test_master_password_without_game_id_is_rejected():
    api = master_api()
    body = payload()
    body['game_addition_request_id_and_secret'] = 'the-master-password-0123'
    assert api.request('POST', '/games', json=body).status_code == 422
    assert_no_games(api)


def test_master_password_with_an_unknown_game_id_is_rejected():
    api = master_api()
    body = payload()
    body['game_addition_request_id_and_secret'] = 'the-master-password-0123'
    body['game_id'] = 'no-such-game'
    assert api.request('POST', '/games', json=body).status_code == 422
    assert_no_games(api)


def test_game_id_must_belong_to_the_secret(api):
    secret = 'pinned-secret-0123456789'
    body = payload(); body['game_addition_request_id_and_secret'] = secret
    first = api.ok('POST', '/games', json=body)
    wrong = payload()
    wrong['game_addition_request_id_and_secret'] = 'other-secret-0123456789'
    wrong['game_id'] = first['id']
    assert api.request('POST', '/games', json=wrong).status_code == 422
    assert api.ok('GET', f"/games/{first['id']}")['version'] == 1
    pinned = payload(); pinned['game_addition_request_id_and_secret'] = secret
    pinned['game_id'] = first['id']
    pinned['description'] = 'Pinned update.'
    pinned['translations'] = translations_for(pinned)
    second = api.ok('POST', '/games', json=pinned)
    assert second['id'] == first['id'] and second['version'] == 2


def test_legacy_plaintext_package_still_matches_and_migrates(api):
    import hashlib
    from dataclasses import replace
    secret = 'legacy-secret-0123456789'
    body = payload(); body['game_addition_request_id_and_secret'] = secret
    first = api.ok('POST', '/games', json=body)
    # Rewrite the stored record the way pre-hash-only records look.
    platform = api.platform
    game = platform.find_game_by_id(first['id'])
    legacy_package = {k: v for k, v in game.import_package.items()
                      if k != 'game_addition_request_secret_hash'}
    legacy_package['game_addition_request_id_and_secret'] = secret
    platform._store._game_versions[first['id']][0] = \
        replace(game, import_package=legacy_package)
    assert platform.find_game_by_addition_request_id(secret).id == first['id']
    updated = payload(); updated['game_addition_request_id_and_secret'] = secret
    updated['description'] = 'Migrated on resubmission.'
    updated['translations'] = translations_for(updated)
    second = api.ok('POST', '/games', json=updated)
    assert second['id'] == first['id'] and second['version'] == 2
    migrated = platform.find_game_by_id(first['id']).import_package
    assert 'game_addition_request_id_and_secret' not in migrated
    assert migrated['game_addition_request_secret_hash'] == \
        hashlib.sha256(secret.encode()).hexdigest()


def test_workflow_limit_rejects_before_storage(api):
    owner = api.new_user('Owner'); body = payload()
    body['unit_tests']['extra_documentation'] = 'x' * 400000
    assert api.request('POST', '/games', as_user=owner, json=body).status_code == 422
    assert_no_games(api)


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
    assert api.client.post('/games', content='{}', headers=headers).status_code == 408
    slots = api.client.app.state.import_slots
    assert slots.acquire(blocking=False) and slots.acquire(blocking=False)
    slots.release(); slots.release()
