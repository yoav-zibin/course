from types import SimpleNamespace
from dataclasses import replace
from unittest.mock import Mock, patch
import threading
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


def test_popularity_metadata_read_preserves_private_game_visibility_without_transactions():
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
    with patch.object(store.client, 'transaction', side_effect=AssertionError('private popularity transaction')):
        assert api.request('GET', f'/games/{game_id}/popularity').status_code == 404
        assert api.ok('GET', f'/games/{game_id}/popularity', as_user=owner)['score'] == 0


def test_translation_bundle_batches_only_the_game_tables_not_already_cached():
    platform = object.__new__(GamePlatform)
    prefetch = Mock()
    platform._store = SimpleNamespace(scalable=True, prefetch_game_versions=prefetch)
    platform._bundle_tables = {('known', 1): ({},)}
    platform._bundle_source_lock = threading.Lock()
    games = [SimpleNamespace(id=key, version=1, code='', name=key, description='')
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
        id='one', version=1, code='', name='One', description='')]

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
