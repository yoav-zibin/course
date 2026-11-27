from types import SimpleNamespace
from dataclasses import replace
from unittest.mock import Mock, patch
import threading
import json
from concurrent.futures import ThreadPoolExecutor

from game_platform.service import GamePlatform
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api


def test_catalog_api_does_not_open_transactions_or_load_game_code():
    store = query_store()
    api = Api(store=store)
    owner = api.new_user('catalog owner')
    game_id = api.new_game(owner=owner)
    hidden = api.new_game(owner=owner)
    api.ok('POST', f'/games/{hidden}/unpublish', as_user=owner)
    store.clear_cache()
    store.client.read_paths.clear()
    with patch.object(store.client, 'transaction', side_effect=AssertionError('catalog transaction')):
        rows = api.ok('GET', '/games', params={'q': 'POKER', 'owner_user_id': owner})
        assert [row['id'] for row in rows] == [game_id]
        assert 'code' not in rows[0] and 'server_code' not in rows[0]
    assert not any('/body/' in path for path in store.client.read_paths)


def test_popularity_metadata_read_hides_unpublished_games_from_all_accounts():
    store = query_store()
    api = Api(store=store)
    owner = api.new_user('popularity owner')
    game_id = api.new_game(owner=owner)
    store.clear_cache()
    store.client.read_paths.clear()
    with patch.object(store.client, 'transaction', side_effect=AssertionError('popularity transaction')):
        assert api.ok('GET', f'/games/{game_id}/popularity')['score'] == 0
    assert not any('/body/' in path for path in store.client.read_paths)
    api.ok('POST', f'/games/{game_id}/unpublish', as_user=owner)
    store.client.read_paths.clear()
    with patch.object(store.client, 'transaction', side_effect=AssertionError('private popularity transaction')):
        assert api.request('GET', f'/games/{game_id}/popularity').status_code == 404
    # Supplied credentials must be checked freshly, even for metadata reads,
    # so a separate purge worker cannot leave cached credentials authenticated.
    with patch.object(store.client, 'transaction', wraps=store.client.transaction) as transaction:
        assert api.request('GET', f'/games/{game_id}/popularity', as_user=owner).status_code == 404
    transaction.assert_called_once_with()
    assert not any('/body/' in path for path in store.client.read_paths)


def test_modern_game_metadata_does_not_decode_the_full_import_package_twice():
    store = query_store()
    api = Api(store=store)
    owner = api.new_user('metadata owner')
    game_id = api.new_game(owner=owner)
    game = replace(store.get_game(game_id), import_package={'images': []})
    store.put_game_version(game)
    raw = store.raw_get(store.ref('games', game_id))['json']
    with patch('game_platform.query_store.json.loads', wraps=json.loads) as loads:
        metadata = store.get_game_without_code(game_id)
    assert metadata.import_package == {'images': []}
    assert not any(call.args and call.args[0] == raw for call in loads.call_args_list)


def test_legacy_game_metadata_still_converts_import_artifacts():
    store = query_store()
    api = Api(store=store)
    owner = api.new_user('legacy metadata owner')
    game_id = api.new_game(owner=owner)
    ref = store.ref('games', game_id)
    raw = store.raw_get(ref)
    record = json.loads(raw['json'])
    record['import_package'] = None  # An old record predates imported declarative packages.
    record['builder_workflow'] = {'artifacts': {'logic': {'value': {'text': 'Legacy rules'}}}}
    store.raw_put(ref, {**raw, 'json': json.dumps(record)})
    assert store.get_game_without_code(game_id).import_package['rules_text'] == 'Legacy rules'


def test_recent_games_summary_uses_metadata_and_keeps_visibility_and_order():
    store = query_store()
    api = Api(store=store)
    owner = api.new_user('recent owner')
    first, hidden, last = [api.new_game(owner=owner) for _ in range(3)]
    api.ok('POST', f'/games/{hidden}/unpublish', as_user=owner)
    store.put_user(replace(store.get_user(owner), recent_game_ids=(last, hidden, first)))
    store.clear_cache()
    store.client.read_paths.clear()
    with patch.object(store.client, 'transaction', side_effect=AssertionError('recent games transaction')):
        games = api.platform.list_recent_games(caller_id=owner, include_code=False)
    assert [game.id for game in games] == [last, first]
    assert not any('/body/' in path for path in store.client.read_paths)
    rows = api.ok('GET', '/users/me/recent-games', as_user=owner)
    assert [row['id'] for row in rows] == [last, first]
    assert all('code' not in row and 'server_code' not in row for row in rows)


def test_recent_game_pages_recover_match_history_and_keep_new_plays_past_the_legacy_cap():
    store = query_store()
    api = Api(store=store)
    try:
        owner = api.new_user('recent owner')
        opponent = api.new_user('other account')
        older = api.new_game(owner=owner, allowed_player_counts=[2])
        played = api.new_match(owner=owner, game_id=older, joiners=[opponent])
        lobby = api.new_game(owner=owner)
        api.new_match(owner=owner, game_id=lobby)
        head = tuple(f'current-{i}' for i in range(8))
        template = store.get_game(older)
        for game_id in (*head, 'new-play'):
            store.add_game_version(replace(template, id=game_id))
        store.put_user(replace(store.get_user(owner), recent_game_ids=head))
        path = '/v2/users/me/recent-games'
        first = api.ok('GET', path, as_user=owner)
        assert [game['id'] for game in first['items']] == list(head)
        assert api.request('GET', path, as_user=opponent, params={'cursor': first['next_cursor']}).status_code == 400
        tail = api.ok('GET', path, as_user=owner, params={'cursor': first['next_cursor']})
        assert [game['id'] for game in tail['items']] == [older]
        assert tail['next_cursor'] is None
        store.delete_match(played)
        api.ok('POST', '/users/me/recent-games/new-play', as_user=owner)
        all_games = api.ok('GET', path, as_user=owner, params={'limit': 100})
        assert [game['id'] for game in all_games['items']] == ['new-play', *head, older]
    finally:
        api.client.close()
        store.close()


def test_translation_bundle_batches_only_the_game_tables_not_already_cached():
    platform = object.__new__(GamePlatform)
    prefetch = Mock()
    platform._store = SimpleNamespace(scalable=True, prefetch_game_versions=prefetch)
    platform._bundle_tables = {('known', 1): ({},)}
    platform._bundle_source_lock = threading.Lock()
    games = [SimpleNamespace(id=key, version=1, code='', name=key, description='', import_package=None)
             for key in ['known', 'new']]
    platform._bundle_published_games = lambda: games

    def table(game):
        platform._bundle_tables[(game.id, game.version)] = ({},)
        return {}

    platform._bundle_table = table
    platform._translate_for_bundle = lambda texts, code: SimpleNamespace(texts={}, status='source')
    assert len(platform.translation_bundle('en').games) == 2
    prefetch.assert_called_once_with([('new', 1)])
    prefetch.reset_mock()
    platform.translation_bundle('en')
    prefetch.assert_not_called()


def test_concurrent_locales_share_one_cold_bundle_source_load():
    platform = object.__new__(GamePlatform)
    loading = threading.Event()
    release = threading.Event()
    second_waiting = threading.Event()

    class ObservedLock:
        def __init__(self):
            self.lock = threading.Lock()

        def __enter__(self):
            if self.lock.locked():
                second_waiting.set()
            self.lock.acquire()

        def __exit__(self, *_):
            self.lock.release()

    def fetch(_):
        loading.set()
        assert release.wait(5)

    prefetch = Mock(side_effect=fetch)
    platform._store = SimpleNamespace(scalable=True, prefetch_game_versions=prefetch)
    platform._bundle_source_lock = ObservedLock()
    platform._bundle_tables = {}
    platform._bundle_published_games = lambda: [SimpleNamespace(
        id='one', version=1, code='', name='One', description='', import_package=None)]

    def table(game):
        platform._bundle_tables[(game.id, game.version)] = ({},)
        return {}

    platform._bundle_table = table
    platform._translate_for_bundle = lambda texts, code: SimpleNamespace(texts={}, status='source')
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(platform.translation_bundle, 'en')
        assert loading.wait(5)
        second = pool.submit(platform.translation_bundle, 'es')
        try:
            assert second_waiting.wait(5)
        finally:
            release.set()
        assert set(first.result().games) == set(second.result().games) == {'one'}
    prefetch.assert_called_once_with([('one', 1)])


def test_import_identity_lookups_do_not_load_other_games_code():
    store = query_store()
    api = Api(store=store)
    owner = api.new_user('import owner')
    game_id = api.new_game(owner=owner)
    other = api.new_game(owner=owner)
    original = store.get_game(game_id)
    store.put_game_version(replace(original, import_package={'game_addition_request_id_and_secret': 'known-secret'}))
    store.clear_cache()
    store.client.read_paths.clear()
    found = api.platform.find_game_by_addition_request_id('known-secret')
    assert found is not None and found.id == game_id and found.code == original.code
    assert not any(store.ref('games', other).path + '/body/' in p for p in store.client.read_paths)
    with patch.object(store, 'list_games', side_effect=AssertionError('scanned all game code')):
        assert api.platform.find_game_by_id(game_id).code == original.code
        assert api.platform.find_game_by_id('missing') is None
        assert api.platform.find_game_by_id('') is None
    store.delete_game(game_id)
    assert api.platform.find_game_by_id(game_id) is None


def test_translation_bundle_reuses_cached_tables_with_game_scoped_translations():
    platform = object.__new__(GamePlatform)
    prefetch = Mock()
    platform._store = SimpleNamespace(scalable=True, prefetch_game_versions=prefetch)
    platform._bundle_source_lock = threading.Lock()
    platform._bundle_tables = {("one", 1): ({"add": "Add one"},)}
    game = SimpleNamespace(id="one", version=1, code="", name="One", description="A game",
        import_package={"translations": {"es": {
            "display_name": "Uno", "short_description": "Un juego", "client_strings": {"add": "Añadir uno"},
        }}})
    platform._bundle_published_games = lambda: [game]
    platform._translate_for_bundle = Mock(return_value=SimpleNamespace(texts={}, status="source"))

    bundle = platform.translation_bundle("es")

    assert bundle.status == "translated"
    assert bundle.games["one"].name == "Uno"
    assert bundle.games["one"].description == "Un juego"
    assert bundle.games["one"].strings == {"add": "Añadir uno"}
    # Game translations are read from metadata alongside the cached table. They
    # require neither another source read nor lookup of globally shared texts.
    prefetch.assert_not_called()
    platform._translate_for_bundle.assert_called_once_with([], "es")
