from pathlib import Path

from game_platform.json_file_store import JsonFileStore
from game_platform.tests.helpers import Api


def test_unpublish_hides_public_routes_and_keeps_owner_library(api: Api):
    owner, other = api.new_user('owner'), api.new_user('other')
    game = api.new_game(owner=owner, allowed_player_counts=[1])
    assert api.request('POST', f'/games/{game}/unpublish').status_code == 401
    assert api.request('POST', f'/games/{game}/unpublish', as_user=other).status_code == 403
    before = api.ok('GET', f'/games/{game}')
    hidden = api.ok('POST', f'/games/{game}/unpublish', as_user=owner)
    assert not hidden['published']
    assert hidden['version'] == before['version']
    assert hidden['code'] == before['code']
    assert api.ok('GET', '/games') == []
    assert api.ok('GET', '/games', params={'owner_user_id':owner}) == []
    for caller in [None, other]:
        assert api.request('GET', f'/games/{game}', as_user=caller).status_code == 404
        assert api.request('GET', f'/games/{game}/versions/1', as_user=caller).status_code == 404
    assert api.ok('GET', f'/games/{game}', as_user=owner) == hidden
    assert api.request('POST', '/matches', as_user=owner, json={'game_id':game}).status_code == 404
    assert api.request('PATCH', f'/games/{game}', as_user=owner, json={'name':'private'}).status_code == 409


def test_existing_participants_keep_playing_but_outsiders_cannot_read_or_join(api: Api):
    owner, a, b, outsider = [api.new_user(name) for name in ['owner','a','b','outsider']]
    game = api.new_game(owner=owner, allowed_player_counts=[2,3], allows_join_mid_match=True)
    match = api.new_match(owner=a, game_id=game, joiners=[b], start=True)
    api.ok('POST', f'/games/{game}/unpublish', as_user=owner)
    assert api.ok('GET', '/matches/open') == []
    for caller in [None, outsider]:
        assert api.request('GET', f'/matches/{match}', as_user=caller).status_code == 404
        assert api.request('GET', f'/matches/{match}/moves', as_user=caller).status_code == 404
        assert api.request('GET', f'/games/{game}/versions/1', as_user=caller).status_code == 404
    assert api.request('POST', f'/matches/{match}/join', as_user=outsider).status_code == 409
    for participant in [a,b,owner]:
        assert api.ok('GET', f'/games/{game}/versions/1', as_user=participant)['published'] is False
        assert api.ok('GET', f'/matches/{match}', as_user=participant)['status'] == 'ongoing'
    assert api.move(match, as_user=a, next_turn=1, state={'turn':1}).status_code == 201
    assert api.move(match, as_user=b, next_turn=None, state={'done':True}).status_code == 201


def test_unpublish_then_resubmit_republishes_and_delete(api: Api):
    from game_platform.tests.test_agent_import import payload, translations_for

    owner = api.new_user('owner')
    secret = 'unpublish-secret-0123456789'
    body = payload(); body['game_addition_request_id_and_secret'] = secret
    first = api.ok('POST', '/games', as_user=owner, json=body)
    assert first['published'] is True
    hidden = api.ok('POST', f"/games/{first['id']}/unpublish", as_user=owner)
    assert not hidden['published']
    assert api.ok('GET', '/games') == []
    updated = payload(); updated['game_addition_request_id_and_secret'] = secret
    updated['description'] = 'Reach three by adding one, republished.'
    updated['translations'] = translations_for(updated)
    second = api.ok('POST', '/games', as_user=owner, json=updated)
    assert second['id'] == first['id'] and second['version'] == 2
    assert second['published'] is True
    assert api.ok('GET', f"/games/{first['id']}") == second
    api.ok('POST', f"/games/{first['id']}/unpublish", as_user=owner)
    api.ok('DELETE', f"/games/{first['id']}", as_user=owner)
    assert api.request('GET', f"/games/{first['id']}").status_code == 404


def test_unpublish_survives_restart_without_exposing_source(tmp_path: Path):
    path = tmp_path/'data.json'
    store = JsonFileStore(path)
    api = Api(store=store)
    owner = api.new_user('owner')
    game = api.new_game(owner=owner)
    api.ok('POST', f'/games/{game}/unpublish', as_user=owner)
    store.close()
    restored = JsonFileStore(path)
    try:
        client = Api(store=restored)
        client.passwords_by_user_id = api.passwords_by_user_id
        assert client.ok('GET','/games') == []
        assert client.request('GET',f'/games/{game}').status_code == 404
        hidden = client.ok('GET', f'/games/{game}', as_user=owner)
        assert hidden['published'] is False
        assert hidden['code'] == '<div>poker</div>'
    finally:
        restored.close()
