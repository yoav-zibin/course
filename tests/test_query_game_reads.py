"""Game-version reads load only the requested version's source code."""

import datetime as dt
from dataclasses import replace

import pytest

from game_platform.models import Game, GameRules
from game_platform.tests.fake_firestore import query_store


def game_version(version=1, **changes):
    now = dt.datetime(2026, 11, 12, tzinfo=dt.timezone.utc)
    game = Game(
        id="game-read-cost",
        version=version,
        owner_user_id="owner",
        name="Read cost",
        description="",
        rules=GameRules(
            allowed_player_counts=(2,),
            allows_leave_mid_match=False,
            allows_join_mid_match=False,
        ),
        code="historical client",
        server_code="historical server",
        created_at=now,
        updated_at=now,
    )
    return replace(game, **changes)


@pytest.mark.parametrize("published,deleted", [(True, False), (False, False), (False, True)])
@pytest.mark.parametrize("transactional", [False, True])
@pytest.mark.parametrize("requested_version", [1, 2])
def test_version_read_keeps_current_visibility_without_loading_current_code(
    published, deleted, transactional, requested_version
):
    store = query_store()
    historical = game_version()
    store.add_game_version(historical)
    current = game_version(
        2, code="new client" * 50_000, published=published, deleted=deleted
    )
    store.add_game_version(current)
    store.clear_cache()
    store.client.read_paths.clear()

    if transactional:
        with store.atomic():
            found = store.get_game_version(historical.id, requested_version)
    else:
        found = store.get_game_version(historical.id, requested_version)

    requested = historical if requested_version == 1 else current
    assert found == replace(requested, published=published, deleted=deleted)
    current_path = store.ref("games", historical.id).path
    assert current_path in store.client.read_paths
    assert not any(
        path.startswith(current_path + "/body/") for path in store.client.read_paths
    )
    version_path = store.ref("game_versions", f"{historical.id}@{requested_version}").path
    chunks = store.client.docs[version_path]["body_chunks"]
    assert len(store.client.read_paths) == 2 + chunks  # two metadata docs plus requested body


def test_missing_version_does_not_load_the_current_game():
    store = query_store()
    store.add_game_version(game_version())
    store.clear_cache()
    store.client.read_paths.clear()

    assert store.get_game_version("game-read-cost", 99) is None
    assert store.client.read_paths == [store.ref("game_versions", "game-read-cost@99").path]


def test_retained_version_remains_readable_without_a_current_game():
    store = query_store()
    historical = game_version()
    store.add_game_version(historical)
    store.client.docs.pop(store.ref("games", historical.id).path)
    store.clear_cache()

    assert store.get_game_version(historical.id, historical.version) == historical
