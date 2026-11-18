"""Games remain platform data when loading legacy records or maintaining accounts."""

import datetime as dt
import json
from dataclasses import replace

from pydantic import TypeAdapter

from game_platform.models import Game, GameRules
from game_platform.query_store import QueryStore
from game_platform.scaling_indexes import index_config
from game_platform.store import InMemoryStore, Snapshot
from game_platform.tests.fake_firestore import query_store


def game():
    now = dt.datetime(2026, 11, 18, tzinfo=dt.timezone.utc)
    return Game(
        id="platform-game", version=1, name="Platform game", description="",
        rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                        allows_join_mid_match=False),
        code="<main>Game</main>", created_at=now, updated_at=now,
    )


def test_legacy_snapshot_discards_game_owner_without_requiring_its_account():
    store = InMemoryStore()
    store.add_game_version(game())
    adapter = TypeAdapter(Snapshot)
    legacy = adapter.dump_python(store.snapshot(), mode="json")
    legacy["game_versions"][0]["owner_user_id"] = "deleted-creator"
    restored = InMemoryStore.of_snapshot(adapter.validate_python(legacy))
    assert restored.list_games() == [game()]
    saved = adapter.dump_python(restored.snapshot(), mode="json")
    assert "owner_user_id" not in saved["game_versions"][0]
    assert saved["users"] == []


def test_query_legacy_game_owner_is_ignored_and_removed_when_rewritten():
    store = query_store("legacy_platform_game")
    store.add_game_version(game())
    for kind, identity in (("games", game().id), ("game_versions", game().id + "@1")):
        ref = store.ref(kind, identity)
        row = store.raw_get(ref)
        payload = json.loads(row["json"])
        payload["owner_user_id"] = "deleted-creator"
        store.raw_put(ref, {**row, "owner_user_id": "deleted-creator",
                            "json": json.dumps(payload)})
    store.clear_cache()
    restarted = QueryStore(store.client, namespace=store.namespace)
    loaded = restarted.get_game(game().id)
    assert loaded == game()
    restarted.put_game_version(replace(loaded, name="Updated"))
    for kind, identity in (("games", game().id), ("game_versions", game().id + "@1")):
        row = restarted.raw_get(restarted.ref(kind, identity))
        assert "owner_user_id" not in row
        assert "owner_user_id" not in json.loads(row["json"])
    assert len(restarted.list_games_without_code()) == 1


def test_game_index_configuration_has_no_user_ownership_queries():
    config = index_config("platform")
    game_groups = {"platform_games", "platform_game_versions"}
    assert all(
        field["fieldPath"] != "owner_user_id"
        for index in config["indexes"] if index["collectionGroup"] in game_groups
        for field in index["fields"]
    )
    assert all(
        override["fieldPath"] != "owner_user_id"
        for override in config["fieldOverrides"]
        if override["collectionGroup"] in game_groups
    )
