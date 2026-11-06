"""Frozen schema recovery changes contracts only and cannot clobber an author."""
from copy import deepcopy
from dataclasses import replace
import datetime as dt
import hashlib
import json
from pathlib import Path

from google.api_core.exceptions import Aborted
import pytest

from game_platform.legacy_schema_migrations import apply_legacy_schema_recovery
from game_platform.game_logic import GameLogic
from game_platform.models import Game, GameRules, Match, Seat, User
from game_platform.query_store import QueryStore
from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore
from game_platform.tests.fake_firestore import Collection, Document, FakeClient

ROOT = Path(__file__).parents[1]
NOW = dt.datetime(2026, 11, 6, tzinfo=dt.timezone.utc)
CODE = (ROOT / 'games' / 'tictactoe.server.js').read_text()
SCHEMAS = json.loads((ROOT / 'games' / 'tictactoe.schema.json').read_text())


def game(version=1, **changes):
    return replace(Game(
        id='legacy', version=version, owner_user_id='author', name='Author title',
        description='Author description', code='<p>unchanged client</p>', server_code=CODE,
        builder_workflow={'author-note': 'keep me'},
        rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                        allows_join_mid_match=False), created_at=NOW, updated_at=NOW,
    ), **changes)


def entry(g, contract='reviewed'):
    return dict(id=g.id, version=g.version,
                client_sha256=hashlib.sha256(g.code.encode()).hexdigest(),
                server_sha256=hashlib.sha256((g.server_code or '').encode()).hexdigest(),
                contract=contract)


def bundle(path, games, contracts=None):
    (path / 'manifest.json').write_text(json.dumps([entry(g) for g in games]))
    (path / 'contracts.json').write_text(json.dumps(contracts or {'reviewed': SCHEMAS}))
    return path


def test_exact_versions_only_preserves_metadata_and_new_author_schema(tmp_path):
    old = game()
    # A stricter author contract must survive even if the same frozen code is
    # named by the recovery manifest. Version numbers/timestamps never change.
    strict = deepcopy(SCHEMAS)
    strict['state']['title'] = 'Author reviewed'
    current = game(2, game_schemas=strict)
    store = InMemoryStore()
    store.add_game_version(old)
    store.add_game_version(current)
    directory = bundle(tmp_path, [old, current])
    assert [r['status'] for r in apply_legacy_schema_recovery(store, directory)] == [
        'updated', 'skipped_existing_schema']
    assert store.get_game_version(old.id, 1) == replace(old, game_schemas=SCHEMAS)
    assert store.get_game(old.id) == current
    assert [r['status'] for r in apply_legacy_schema_recovery(store, directory)] == [
        'unchanged', 'skipped_existing_schema']


@pytest.mark.parametrize('field,value', [('code', '<p>author edit</p>'),
                                        ('server_code', CODE+'\n// author edit')])
def test_skips_intervening_code_edits(tmp_path, field, value):
    original = game()
    store = InMemoryStore()
    changed = replace(original, **{field: value})
    store.add_game_version(changed)
    assert apply_legacy_schema_recovery(store, bundle(tmp_path, [original]))[0]['status'] == 'skipped_code_hash'
    assert store.get_game(original.id) == changed


def test_missing_and_client_only_versions_are_never_created_or_converted(tmp_path):
    absent = game()
    client_only = game(id='client-only', server_code=None)
    store = InMemoryStore()
    store.add_game_version(client_only)
    statuses = [r['status'] for r in apply_legacy_schema_recovery(
        store, bundle(tmp_path, [absent, client_only]))]
    assert statuses == ['skipped_missing', 'skipped_client_only']
    assert store.get_game('legacy') is None
    assert store.get_game(client_only.id) == client_only


def test_unpublished_deleted_history_is_recovered_without_changing_visibility(tmp_path):
    original = game()
    store = InMemoryStore()
    store.add_game_version(original)
    store.set_game_published(original.id, False)
    store.delete_game(original.id)
    before = store.get_game(original.id)
    assert apply_legacy_schema_recovery(store, bundle(tmp_path, [original]))[0]['status'] == 'updated'
    assert store.get_game(original.id) == replace(before, game_schemas=SCHEMAS)


@pytest.mark.parametrize('damage', ['duplicate', 'bad-hash', 'missing-contract',
                                   'bad-schema', 'boolean', 'empty', 'too-many'])
def test_bundle_is_fully_validated_before_any_write(tmp_path, damage):
    original = game()
    store = InMemoryStore()
    store.add_game_version(original)
    good = entry(original)
    bad = dict(good, id='other', contract='broken')
    entries = [good, bad]
    contracts = {'reviewed': SCHEMAS, 'broken': deepcopy(SCHEMAS)}
    if damage == 'duplicate':
        entries = [good, good]
    elif damage == 'bad-hash':
        bad['server_sha256'] = 'wrong'
    elif damage == 'missing-contract':
        contracts.pop('broken')
    elif damage == 'bad-schema':
        contracts['broken']['state'] = {'type': 'invalid'}
    elif damage == 'boolean':
        contracts['broken']['move'] = True
    elif damage == 'empty':
        contracts['broken']['view'] = {}
    else:
        entries = [dict(good, id=f'legacy-{i}') for i in range(201)]
    (tmp_path / 'manifest.json').write_text(json.dumps(entries))
    (tmp_path / 'contracts.json').write_text(json.dumps(contracts))
    assert apply_legacy_schema_recovery(store, tmp_path)[0]['status'] == 'error'
    assert store.get_game(original.id) == original


def test_existing_match_view_and_move_resume_without_rewriting_match_or_balances(tmp_path):
    old, current = game(), game(2, game_schemas=SCHEMAS)
    store = InMemoryStore()
    store.add_game_version(old)
    store.add_game_version(current)
    for i, balance in enumerate((73, 91)):
        store.put_user(User(id=f'p{i}', display_name=f'P{i}', password='local',
                            token_balance=balance, created_at=NOW, updated_at=NOW))
    ctx = {'players': [{'id': f'p{i}', 'kind': 'human', 'max_loss': 0} for i in range(2)],
           'pot': 0, 'move_count': 0}
    initial = GameLogic(CODE, game_schemas=SCHEMAS).call('newMatch', ctx=ctx, now=NOW)
    historic = Match(id='existing', game_id=old.id, game_version=1, owner_user_id='p0',
                     status='ongoing', seats=tuple(Seat(player_index=i, kind='human', user_id=f'p{i}') for i in range(2)),
                     state=initial['state'], turn_of_player_indices=frozenset({0}), end_reason=None,
                     moves=(), hidden_for_user_ids=frozenset(), created_at=NOW, updated_at=NOW)
    store.put_match(historic)
    # The exact blocked old-version behavior, even though v2 already works.
    assert GamePlatform(store=store, clock=lambda: NOW).view_state(historic, 'p0') is None
    before_users = store.list_users()
    assert apply_legacy_schema_recovery(store, bundle(tmp_path, [old]))[0]['status'] == 'updated'
    assert store.get_match(historic.id) == historic
    assert store.list_users() == before_users
    assert store.get_game(old.id) == current
    platform = GamePlatform(store=store, clock=lambda: NOW)
    assert platform.view_state(historic, 'p0')['board'] == ['']*9
    after = platform.make_move(caller_id='p0', match_id=historic.id, new_state=None,
                               next_turn_player_indices=None, expected_move_count=0,
                               move={'cell': 0})
    assert after.game_version == 1
    assert len(after.moves) == 1
    assert after.state['board'][0] == 'X'


# A transaction-aware extension of the shared Firestore fake. QueryStore's real
# atomic/read-buffer/write path is exercised; optimistic commit checks reject a
# concurrent author's change, rather than trusting a mocked transaction lock.
class _Tx:
    def __init__(self, client):
        self.client, self.reads, self.writes = client, {}, []
        self.in_progress = False
        self.id = b'local-transaction'

    def _begin(self, **kwargs):
        self.in_progress = True

    def set(self, ref, data):
        self.writes.append((ref, deepcopy(data)))

    def delete(self, ref):
        self.writes.append((ref, None))

    def _commit(self):
        if self.client.before_commit:
            callback, self.client.before_commit = self.client.before_commit, None
            callback()
        if any(self.client.docs.get(path) != value for path, value in self.reads.items()):
            raise Aborted('concurrent document edit')
        for ref, data in self.writes:
            ref.delete() if data is None else ref.set(data)
        self.in_progress = False

    def _rollback(self):
        self.in_progress = False

    def _clean_up(self):
        self.in_progress = False


class _Doc(Document):
    def get(self, transaction=None):
        if transaction is not None:
            assert transaction.in_progress
            transaction.reads.setdefault(self.path, deepcopy(self.client.docs.get(self.path)))
        return super().get(transaction)


class _Collection(Collection):
    def document(self, name):
        return _Doc(self.client, f'{self.path}/{name}')


class _TransactionalClient(FakeClient):
    def __init__(self):
        super().__init__()
        self.before_commit = None
        self.transactions = []

    def collection(self, name):
        return _Collection(self, name)

    def transaction(self):
        tx = _Tx(self)
        self.transactions.append(tx)
        return tx


def query_store():
    client = _TransactionalClient()
    client.docs['recovery_meta/schema'] = {'version': 1}
    return QueryStore(client, namespace='recovery')


def test_query_store_recovery_is_bounded_and_persists_both_latest_and_historical(tmp_path):
    store = query_store()
    old, current = game(), game(2)
    store.add_game_version(old)
    store.add_game_version(current)
    directory = bundle(tmp_path, [old, current])
    reads_before, queries_before = store.client.reads, store.client.queries
    assert [r['status'] for r in apply_legacy_schema_recovery(store, directory)] == ['updated', 'updated']
    assert store.get_game_version(old.id, 1) == replace(old, game_schemas=SCHEMAS)
    assert store.get_game(old.id) == replace(current, game_schemas=SCHEMAS)
    assert store.client.queries == queries_before  # point reads only; no history scan
    # QueryStore splits code into child body documents. Their reads and the
    # verification reads above stay bounded by these two manifest entries.
    assert store.client.reads - reads_before <= 16
    writes = store.client.writes
    assert [r['status'] for r in apply_legacy_schema_recovery(store, directory)] == ['unchanged', 'unchanged']
    assert store.client.writes == writes


def test_query_transaction_does_not_overwrite_concurrent_author_schema(tmp_path):
    store = query_store()
    original = game()
    store.add_game_version(original)
    strict = deepcopy(SCHEMAS)
    strict['state']['title'] = 'Concurrent author'
    edited = replace(original, game_schemas=strict)
    # An independent writer commits after recovery's reads but before its commit.
    # It must be left intact when the recovery transaction aborts.
    from game_platform.query_store import ADAPTERS
    def concurrent_edit():
        for kind, identity in [('game_versions', 'legacy@1'), ('games', 'legacy')]:
            ref = store.ref(kind, identity)
            data = deepcopy(store.client.docs[ref.path])
            data['json'] = ADAPTERS[kind].dump_json(edited).decode()
            store.client.docs[ref.path] = data
    store.client.before_commit = concurrent_edit
    assert apply_legacy_schema_recovery(store, bundle(tmp_path, [original]))[0]['status'] == 'error'
    assert store.get_game(original.id).game_schemas == strict
    assert store.get_game_version(original.id, 1).game_schemas == strict
    assert apply_legacy_schema_recovery(store, tmp_path)[0]['status'] == 'skipped_existing_schema'


@pytest.mark.parametrize('value', [None, False, 3, 1.5, 'text', [], [1, 2],
                                 {'note': ['arbitrary'], 'counter': 'custom'}])
def test_debug_recovery_preserves_its_documented_arbitrary_json_state(value):
    """Debug is deliberately an opaque JSON editor, not an object-only game."""
    from game_platform.game_logic import GameLogic
    root = Path(__file__).parents[1]
    schemas = json.loads((root / 'games/schema-recovery/contracts.json').read_text())['debug@2']
    logic = GameLogic((root / 'games/debug.server.js').read_text(), game_schemas=schemas)
    ctx = {'players': [{'id': 'p0', 'kind': 'human', 'max_loss': 10},
                       {'id': 'p1', 'kind': 'human', 'max_loss': 10}],
           'pot': 20, 'move_count': 0}
    initial = logic.call('newMatch', ctx=ctx)
    result = logic.call('applyMove', initial['state'], 'p0',
                        {'new_state': value, 'next_turn_player_indices': None}, ctx=ctx)
    assert result['state'] == value
    assert result['turn'] is None and result['payouts'] == {'p0': 10, 'p1': 10}
    for viewer in ('p0', 'p1', None):
        assert logic.call('viewFor', result['state'], viewer, ctx=ctx) == value
