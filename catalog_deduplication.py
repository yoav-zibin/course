"""Retire reviewed duplicate public entries, preserving drafts and old matches.

This bounded release action is reversible through the author's normal draft
publication. It never deletes game versions, drafts, matches or users and never
classifies games by name alone. Run after version-repair migrations at startup.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
import re
from weakref import WeakKeyDictionary

from game_platform.store import InMemoryStore
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from game_platform.service import GamePlatform

MANIFEST = Path(__file__).resolve().parent / 'games/catalog-deduplication.json'
logger = logging.getLogger(__name__)
_MEMORY_APPLIED = WeakKeyDictionary()
_HASH = re.compile(r'[0-9a-f]{64}\Z')


def _sha(text: str | None) -> str:
    return hashlib.sha256((text or '').encode()).hexdigest()


def _guard(game, record):
    return (game.version == record['version']
            and _sha(game.code) == record['client_sha256']
            and _sha(game.server_code) == record['server_sha256']
            and list(game.rules.allowed_player_counts) == record['allowed_player_counts']
            and game.rules.allows_leave_mid_match == record['allows_leave_mid_match']
            and game.rules.allows_join_mid_match == record['allows_join_mid_match'])


def _load(path):
    entries = json.loads(Path(path).read_text())
    if not isinstance(entries, list) or not 1 <= len(entries) <= 20:
        raise ValueError('deduplication needs1..20 reviewed pairs')
    removed = set()
    for entry in entries:
        for role in ('keep', 'remove'):
            r = entry[role]
            if not isinstance(r['id'], str) or not r['id'] or type(r['version']) is not int or r['version'] < 1:
                raise ValueError('invalid game/version')
            if not all(isinstance(r[k], str) and _HASH.fullmatch(r[k]) for k in ('client_sha256', 'server_sha256')):
                raise ValueError('invalid source hash')
            counts = r['allowed_player_counts']
            if not isinstance(counts, list) or not counts or any(type(n) is not int or not 1 <= n <= 10 for n in counts):
                raise ValueError('invalid player counts')
            if any(type(r[k]) is not bool for k in ('allows_leave_mid_match', 'allows_join_mid_match')):
                raise ValueError('invalid join/leave rules')
        target = entry['remove']['id']
        if target == entry['keep']['id'] or target in removed:
            raise ValueError('self-pair or duplicate removal')
        removed.add(target)
    if removed & {e['keep']['id'] for e in entries}:
        raise ValueError('a keeper cannot also be removed')
    return entries



def _marker_key(entry):
    identity = [entry['remove']['id'], entry['remove']['version'], entry['keep']['id']]
    return 'catalog-retire-' + _sha(json.dumps(identity, separators=(',', ':')))


def _journal(store, key):
    # Production QueryStore already offers a transaction-aware internal migration
    # collection. No new collection/model/snapshot format or credentials needed.
    if getattr(store, 'scalable', False) and all(
        callable(getattr(store, name, None)) for name in ('collection', 'raw_get', 'raw_put')
    ):
        ref = store.collection('migration').document(key)
        return lambda: store.raw_get(ref) is not None, lambda: store.raw_put(ref, {'applied': True})
    if isinstance(store, InMemoryStore):
        keys = _MEMORY_APPLIED.setdefault(store, set())
        return lambda: key in keys, lambda: keys.add(key)
    # Do not promise durable operator overrides on an unsupported persistent
    # adapter. This release targets the existing production QueryStore.
    return None

def apply_catalog_deduplication(platform: GamePlatform, manifest_path=None) -> list[dict[str, Any]]:
    try:
        entries = _load(manifest_path or MANIFEST)
    except Exception as error:
        logger.exception('catalog-deduplication manifest refused')
        return [{'status': 'error', 'detail': str(error)}]
    results = []
    for entry in entries:
        result = {'id': entry['remove']['id'], 'keep_id': entry['keep']['id']}
        try:
            # The existing platform lock is QueryStore's operation transaction.
            # Both fresh source guards and the reversible visibility update share it.
            with platform._lock:
                journal = _journal(platform._store, _marker_key(entry))
                if journal is None:
                    result['status'] = 'skipped_unsupported_store'
                else:
                    applied, mark = journal
                    if applied():
                        result['status'] = 'unchanged'
                    else:
                        game = platform._store.get_game(result['id'])
                        keeper = platform._store.get_game(result['keep_id'])
                        if game is None:
                            result['status'] = 'skipped_missing'
                        elif not game.published or game.deleted:
                            result['status'] = 'unchanged'
                        elif keeper is None or keeper.deleted or not keeper.published:
                            result['status'] = 'skipped_keeper_unavailable'
                        elif not _guard(game, entry['remove']) or not _guard(keeper, entry['keep']):
                            result['status'] = 'skipped_guard'
                        else:
                            platform.unpublish_game(caller_id=game.owner_user_id, game_id=game.id)
                            mark()
                            result['status'] = 'unpublished'
        except Exception as error:
            result.update(status='error', detail=str(error))
            logger.exception('catalog-deduplication failed for %s', result['id'])
        logger.info('catalog-deduplication: %s', json.dumps(result, sort_keys=True))
        results.append(result)
    return results
