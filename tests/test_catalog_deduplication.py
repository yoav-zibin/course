"""Catalog deduplication hides only frozen duplicates and retains playable history."""
from copy import deepcopy
from dataclasses import replace
import datetime as dt
import hashlib
import json
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from game_platform.api import create_app
from game_platform.catalog_deduplication import apply_catalog_deduplication
from game_platform.models import Game, GameDraft, GameRules, User
from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore

ROOT = Path(__file__).parents[1]
NOW = dt.datetime(2026, 11, 6, tzinfo=dt.timezone.utc)
CODE = (ROOT / 'games' / 'tictactoe.server.js').read_text()
CLIENT = (ROOT / 'games' / 'tictactoe.html').read_text()
SCHEMAS = json.loads((ROOT / 'games' / 'tictactoe.schema.json').read_text())
RULES = GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                 allows_join_mid_match=False)


def game(game_id, version=2, **changes):
    return replace(Game(id=game_id, version=version, owner_user_id='author',
                        name='Same title', description='Same rules', rules=RULES,
                        code=CLIENT, server_code=CODE, game_schemas=SCHEMAS,
                        created_at=NOW, updated_at=NOW), **changes)


def frozen(g):
    return dict(id=g.id, version=g.version,
                client_sha256=hashlib.sha256(g.code.encode()).hexdigest(),
                server_sha256=hashlib.sha256(g.server_code.encode()).hexdigest(),
                allowed_player_counts=list(g.rules.allowed_player_counts),
                allows_leave_mid_match=g.rules.allows_leave_mid_match,
                allows_join_mid_match=g.rules.allows_join_mid_match)


@pytest.fixture
def case(tmp_path):
    store = InMemoryStore()
    keeper, duplicate = game('keeper'), game('duplicate')
    # A named rule variant is outside the manifest even if the title matches.
    variant = game('variant', 1, rules=replace(RULES, allowed_player_counts=(3,)))
    for g in [keeper, duplicate, variant]:
        for v in range(1, g.version+1):
            store.add_game_version(replace(g, version=v))
    for user_id in ('author', 'p0', 'p1'):
        store.put_user(User(id=user_id, display_name=user_id, password='local',
                            token_balance=83, created_at=NOW, updated_at=NOW))
    platform = GamePlatform(store=store, clock=lambda: NOW, require_game_strings=True)
    row = {'keep': frozen(keeper), 'remove': frozen(duplicate),
           'reason': 'Reviewed same-rule duplicate; retain published keeper'}
    path = tmp_path / 'manifest.json'
    path.write_text(json.dumps([row]))
    return platform, store, keeper, duplicate, variant, path, row


def run(case):
    platform, _, _, _, _, path, _ = case
    return apply_catalog_deduplication(platform, manifest_path=path)


def test_unpublishes_without_deletion_or_new_versions_and_is_idempotent(case, monkeypatch):
    platform, store, keeper, duplicate, variant, _, _ = case
    original_versions = store.list_all_game_versions()
    original_users = store.list_users()
    def forbidden(*args, **kwargs):
        raise AssertionError('Catalog cleanup must never physically delete a game')
    monkeypatch.setattr(store, 'delete_game', forbidden)
    assert run(case)[0]['status'] == 'unpublished'
    assert {g.id for g in platform.list_games(owner_user_id=None)} == {keeper.id, variant.id}
    assert store.get_game(keeper.id) == keeper
    assert store.get_game(variant.id) == variant
    assert store.get_game(duplicate.id) == replace(duplicate, published=False)
    assert store.list_all_game_versions() == [
        replace(g, published=False) if g.id == duplicate.id else g for g in original_versions]
    assert store.list_users() == original_users
    draft = store.get_game_draft(duplicate.id)
    assert draft.code == duplicate.code
    assert draft.server_code == duplicate.server_code
    assert draft.game_schemas == duplicate.game_schemas
    assert draft.rules == duplicate.rules
    assert draft.base_version == duplicate.version
    assert draft.revision == 1
    versions = store.list_all_game_versions()
    assert run(case)[0]['status'] == 'unchanged'
    assert store.get_game_draft(duplicate.id) == draft
    assert store.list_all_game_versions() == versions


def test_preserves_existing_working_draft_exactly(case):
    _, store, _, duplicate, _, _, _ = case
    author_work = GameDraft(id=duplicate.id, owner_user_id='author', name='Unfinished author work',
                           description='Keep this draft', rules=RULES, code=CLIENT+'<!-- WIP -->',
                           server_code=CODE+'\n// unfinished', game_schemas=SCHEMAS,
                           created_at=NOW-dt.timedelta(days=1), updated_at=NOW,
                           base_version=duplicate.version, revision=7,
                           builder_workflow={'author-note': 'preserve'})
    store.put_game_draft(author_work)
    assert run(case)[0]['status'] == 'unpublished'
    assert store.get_game_draft(duplicate.id) == author_work
    assert run(case)[0]['status'] == 'unchanged'
    assert store.get_game_draft(duplicate.id) == author_work


@pytest.mark.parametrize('role', ['keep', 'remove'])
@pytest.mark.parametrize('change', ['version', 'code', 'server_code', 'allowed_player_counts',
                                   'allows_leave_mid_match', 'allows_join_mid_match'])
def test_both_sides_are_guarded_against_author_updates(case, role, change):
    _, store, keeper, duplicate, _, _, _ = case
    original = keeper if role == 'keep' else duplicate
    if change == 'version':
        store.add_game_version(replace(original, version=original.version+1))
    elif change in {'code', 'server_code'}:
        value = original.code+'<!-- author edit -->' if change == 'code' else original.server_code+'\n// author edit'
        store.put_game_version(replace(original, **{change: value}))
    else:
        value = (2, 3) if change == 'allowed_player_counts' else True
        store.put_game_version(replace(original, rules=replace(original.rules, **{change: value})))
    before = store.list_all_game_versions()
    assert run(case)[0]['status'] == 'skipped_guard'
    assert store.list_all_game_versions() == before
    assert store.get_game(duplicate.id).published
    assert store.get_game_draft(duplicate.id) is None


@pytest.mark.parametrize('condition', ['missing', 'deleted', 'unpublished'])
def test_never_hides_duplicate_when_keeper_is_unavailable(case, condition):
    _, store, keeper, duplicate, _, path, row = case
    if condition == 'missing':
        row['keep']['id'] = 'not-present'
        path.write_text(json.dumps([row]))
    elif condition == 'deleted':
        store.delete_game(keeper.id)
    else:
        store.set_game_published(keeper.id, False)
    assert run(case)[0]['status'] in {'skipped_missing', 'skipped_keeper_unavailable'}
    assert store.get_game(duplicate.id).published
    assert store.get_game_draft(duplicate.id) is None


@pytest.mark.parametrize('damage', ['same-id', 'duplicate-removal', 'bad-hash', 'missing-rules', 'too-many'])
def test_invalid_entire_manifest_refused_before_any_change(case, damage):
    _, store, _, duplicate, _, path, row = case
    damaged = deepcopy(row)
    rows = [row, damaged]
    if damage == 'same-id':
        damaged['keep'] = deepcopy(damaged['remove'])
    elif damage == 'bad-hash':
        damaged['remove']['id'] = 'other'
        damaged['remove']['server_sha256'] = 'bad'
    elif damage == 'missing-rules':
        damaged['remove']['id'] = 'other'
        damaged['keep'].pop('allowed_player_counts')
    elif damage == 'too-many':
        rows = [row]*21
    # duplicate-removal uses the unchanged duplicate second row.
    path.write_text(json.dumps(rows))
    before = store.list_all_game_versions()
    results = run(case)
    assert any(r['status'] == 'error' for r in results)
    assert store.list_all_game_versions() == before
    assert store.get_game(duplicate.id).published
    assert store.get_game_draft(duplicate.id) is None


def test_existing_match_source_view_and_legal_move_continue_after_unpublishing(case):
    platform, store, _, duplicate, _, _, _ = case
    match = platform.create_match(caller_id='p0', game_id=duplicate.id, num_computer_opponents=0)
    platform.join_match(caller_id='p1', match_id=match.id)
    original = platform.start_match(caller_id='p0', match_id=match.id,
                                    first_turn_player_indices=frozenset({0}), initial_state={})
    users = store.list_users()
    assert run(case)[0]['status'] == 'unpublished'
    assert store.get_match(match.id) == original
    assert store.list_users() == users
    client = TestClient(create_app(platform))
    headers = {'X-User-Id': 'p0', 'X-User-Password': 'local'}
    source_path = f'/games/{duplicate.id}/versions/{duplicate.version}'
    assert client.get(source_path).status_code == 404
    source = client.get(source_path, headers=headers)
    assert source.status_code == 200
    assert source.json()['server_code'] == duplicate.server_code
    assert source.json()['game_schemas'] == duplicate.game_schemas
    view = client.get(f'/matches/{match.id}', headers=headers)
    assert view.status_code == 200
    assert view.json()['state']['board'] == ['']*9
    moved = client.post(f'/matches/{match.id}/moves', headers=headers,
                        json={'move': {'cell': 0}, 'expected_move_count': 0})
    assert moved.status_code == 201, moved.text
    assert moved.json()['state']['board'][0] == 'X'
    assert store.get_match(match.id).game_version == duplicate.version
    assert store.get_game(duplicate.id).published is False


def test_author_can_republish_the_preserved_draft(case):
    platform, store, _, duplicate, _, _, _ = case
    assert run(case)[0]['status'] == 'unpublished'
    draft = platform.get_game_draft(caller_id='author', draft_id=duplicate.id)
    published = platform.publish_game_draft(caller_id='author', draft_id=draft.id,
                                           expected_revision=draft.revision)
    assert published.id == duplicate.id
    assert published.published and not published.deleted
    assert published.code == duplicate.code
    assert published.server_code == duplicate.server_code
    assert published.game_schemas == duplicate.game_schemas
    assert duplicate.id in {g.id for g in platform.list_games(owner_user_id=None)}
    assert store.get_game_version(duplicate.id, duplicate.version).server_code == duplicate.server_code
    # An explicit owner decision to republish unchanged code must survive the
    # next startup, not be silently undone by the frozen retirement manifest.
    assert run(case)[0]['status'] == 'unchanged'
    assert store.get_game(duplicate.id).published


def test_author_can_publish_a_new_revision_without_future_retirement(case):
    platform, store, _, duplicate, _, _, _ = case
    assert run(case)[0]['status'] == 'unpublished'
    draft = platform.get_game_draft(caller_id='author', draft_id=duplicate.id)
    edited = platform.save_game_draft(
        caller_id='author', draft_id=draft.id, name=draft.name, description=draft.description,
        rules=draft.rules, code=draft.code+'<!-- Author revised this game -->',
        server_code=draft.server_code, game_schemas=draft.game_schemas,
        expected_revision=draft.revision)
    published = platform.publish_game_draft(caller_id='author', draft_id=edited.id,
                                           expected_revision=edited.revision)
    assert published.version == duplicate.version+1
    assert run(case)[0]['status'] == 'unchanged'
    assert store.get_game(duplicate.id).published
    assert store.get_game_draft(duplicate.id).code == edited.code


def _query_platform(store):
    # Exercise the real GamePlatform draft/publication methods with QueryStore
    # without running unrelated startup seeding/query workers in the tiny fake.
    platform = GamePlatform.__new__(GamePlatform)
    platform._store = store
    platform._lock = store.operation_lock
    platform._clock = lambda: NOW
    platform._require_game_strings = True
    return platform


def _query_case(path):
    from game_platform.tests.test_legacy_schema_migrations import query_store
    store = query_store()
    keeper, duplicate = game('keeper', 1), game('duplicate', 1)
    store.add_game_version(keeper)
    store.add_game_version(duplicate)
    path.write_text(json.dumps([{'keep': frozen(keeper), 'remove': frozen(duplicate),
                                 'reason': 'Reviewed duplicate'}]))
    return store, _query_platform(store), keeper, duplicate


def test_query_marker_survives_a_fresh_store_and_normal_same_source_republish(tmp_path):
    from game_platform.query_store import QueryStore
    path = tmp_path / 'manifest.json'
    store, platform, keeper, duplicate = _query_case(path)
    assert apply_catalog_deduplication(platform, manifest_path=path)[0]['status'] == 'unpublished'
    assert store.get_game(duplicate.id).published is False
    marker_paths = [p for p in store.client.docs if p.startswith(store.namespace+'_migration/')]
    assert len(marker_paths) == 1
    # A new Python store/platform wrapper reads committed Firestore data; no
    # migration function's in-memory applied set can explain its behavior.
    reloaded = QueryStore(store.client, namespace=store.namespace)
    restarted = _query_platform(reloaded)
    draft = restarted.get_game_draft(caller_id='author', draft_id=duplicate.id)
    published = restarted.publish_game_draft(caller_id='author', draft_id=draft.id,
                                              expected_revision=draft.revision)
    assert published.version == duplicate.version
    assert published.published
    writes = store.client.writes
    assert apply_catalog_deduplication(restarted, manifest_path=path)[0]['status'] == 'unchanged'
    assert reloaded.get_game(duplicate.id).published
    assert reloaded.get_game(keeper.id) == keeper
    assert store.client.writes == writes
    assert reloaded.get_game_draft(duplicate.id) == draft


def test_query_marker_and_visibility_roll_back_together_on_author_race(tmp_path):
    from game_platform.query_store import QueryStore
    path = tmp_path / 'manifest.json'
    store, platform, keeper, duplicate = _query_case(path)
    edited = replace(keeper, code=keeper.code+'<!-- concurrent author revision -->')
    def concurrent_edit():
        # An independent instance changes the keeper after the retirement's
        # guard reads but before commit. Real QueryStore optimistic commit must
        # discard the entire hide/draft/marker batch.
        other = QueryStore(store.client, namespace=store.namespace)
        other.put_game_version(edited)
    store.client.before_commit = concurrent_edit
    assert apply_catalog_deduplication(platform, manifest_path=path)[0]['status'] == 'error'
    assert store.get_game(keeper.id) == edited
    assert store.get_game(duplicate.id) == duplicate
    assert store.get_game_draft(duplicate.id) is None
    assert not any(p.startswith(store.namespace+'_migration/') for p in store.client.docs)
    assert apply_catalog_deduplication(platform, manifest_path=path)[0]['status'] == 'skipped_guard'
    assert store.get_game(duplicate.id).published


def test_unknown_persistent_adapter_is_not_hidden_without_a_durable_marker(case):
    platform, store, _, duplicate, _, _, _ = case
    class PersistentAdapter:
        """A store wrapper without QueryStore's transactional journal API."""
        def __getattr__(self, name):
            return getattr(store, name)
    platform._store = PersistentAdapter()
    assert run(case)[0]['status'] == 'skipped_unsupported_store'
    assert store.get_game(duplicate.id) == duplicate
    assert store.get_game_draft(duplicate.id) is None


def _snapshot_platform(backing):
    """Real SavingStore behavior and metrics wrapper; fake only remote persistence."""
    import threading
    from types import SimpleNamespace
    from game_platform.firestore_store import FirestoreStore
    from game_platform.saving_store import SavingStore
    from game_platform.observability import TimedStore, current

    class Ref:
        def __init__(self, key): self.key = key
        def get(self): return SimpleNamespace(exists=self.key in backing['receipts'])
        def create(self, value):
            if self.key in backing['receipts']: raise RuntimeError('receipt exists')
            if backing.get('claim_error'): raise RuntimeError('receipt write failed')
            backing['receipts'][self.key] = value
        def set(self, value): backing['receipts'][self.key] = value

    class SnapshotStore(FirestoreStore):
        def __init__(self):
            self._prefix = 'production_test_'
            self._client = SimpleNamespace(collection=lambda name: SimpleNamespace(
                document=lambda key: Ref(name+'/'+key)))
            inner = InMemoryStore.of_snapshot(backing['snapshot'])
            SavingStore.__init__(self, inner, min_write_interval_seconds=60, writer_name='test-catalog')
        def _save(self, snapshot): backing['snapshot'] = snapshot

    raw = SnapshotStore()
    wrapped = TimedStore(raw, current())
    platform = GamePlatform.__new__(GamePlatform)
    platform._store = wrapped
    platform._lock = threading.RLock()
    platform._clock = lambda: NOW
    platform._require_game_strings = True
    return platform, raw


def test_snapshot_metrics_wrapper_retirement_and_restart_preserve_author_restore(case):
    _, store, keeper, duplicate, _, path, _ = case
    backing = {'snapshot': store.snapshot(), 'receipts': {}}
    platform, raw = _snapshot_platform(backing)
    try:
        assert apply_catalog_deduplication(platform, path)[0]['status'] == 'unpublished'
        assert raw.get_game(keeper.id).published
        assert not raw.get_game(duplicate.id).published
        assert raw.get_game_draft(duplicate.id).game_schemas == duplicate.game_schemas
        assert list(backing['receipts'].values()) == [{'claimed': True, 'applied': True}]
        platform.publish_game_draft(caller_id='author', draft_id=duplicate.id, expected_revision=raw.get_game_draft(duplicate.id).revision)
        raw.flush()
    finally:
        raw.close()
    restarted, raw2 = _snapshot_platform(backing)
    try:
        assert apply_catalog_deduplication(restarted, path)[0]['status'] == 'unchanged'
        assert raw2.get_game(duplicate.id).published
    finally:
        raw2.close()


def test_snapshot_claim_failure_does_not_hide_or_create_draft(case):
    _, store, _, duplicate, _, path, _ = case
    backing = {'snapshot': store.snapshot(), 'receipts': {}, 'claim_error': True}
    platform, raw = _snapshot_platform(backing)
    try:
        assert apply_catalog_deduplication(platform, path)[0]['status'] == 'error'
        assert raw.get_game(duplicate.id).published
        assert raw.get_game_draft(duplicate.id) is None
    finally:
        raw.close()


def test_snapshot_crash_after_claim_never_rehides_a_restored_game(case, monkeypatch):
    _, store, _, duplicate, _, path, _ = case
    backing = {'snapshot': store.snapshot(), 'receipts': {}}
    platform, raw = _snapshot_platform(backing)
    try:
        def interrupted(**kwargs): raise RuntimeError('interrupted after durable claim')
        monkeypatch.setattr(platform, 'unpublish_game', interrupted)
        assert apply_catalog_deduplication(platform, path)[0]['status'] == 'error'
        assert raw.get_game(duplicate.id).published
        assert list(backing['receipts'].values()) == [{'claimed': True}]
    finally:
        raw.close()
    restarted, raw2 = _snapshot_platform(backing)
    try:
        assert apply_catalog_deduplication(restarted, path)[0]['status'] == 'unchanged'
        assert raw2.get_game(duplicate.id).published
    finally:
        raw2.close()
