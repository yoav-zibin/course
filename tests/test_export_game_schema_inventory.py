import datetime as dt

import pytest

from game_platform.export_game_schema_inventory import (
    _read_refs,
    export_game_schema_inventory,
)
from game_platform.models import Game, GameRules
from game_platform.store import InMemoryStore


def test_export_contains_only_requested_game_logic_fields():
    store = InMemoryStore()
    game = Game(
        id="private-game-id",
        version=1,
        owner_user_id="private-owner-id",
        name="Example",
        description="Example description",
        rules=GameRules(
            allowed_player_counts=(2,),
            allows_leave_mid_match=False,
            allows_join_mid_match=False,
        ),
        code="<p>client</p>",
        server_code="const game = {};",
        game_schemas=None,
        created_at=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
        updated_at=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc),
    )
    store.add_game_version(game)

    result = export_game_schema_inventory(store, ["private-game-id@1"])

    assert result == {
        "private-game-id@1": {
            "name": "Example",
            "rules": {
                "allowed_player_counts": (2,),
                "allows_leave_mid_match": False,
                "allows_join_mid_match": False,
            },
            "server_code": "const game = {};",
            "game_schemas": None,
        }
    }


def test_export_defaults_to_only_server_versions_missing_schemas():
    store = InMemoryStore()
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    for game in (
        Game(
            id="missing",
            version=1,
            owner_user_id="owner",
            name="Missing schema",
            description="",
            rules=GameRules(
                allowed_player_counts=(2,),
                allows_leave_mid_match=False,
                allows_join_mid_match=False,
            ),
            code="",
            server_code="const game = {};",
            game_schemas=None,
            created_at=now,
            updated_at=now,
        ),
        Game(
            id="already-schemaed",
            version=1,
            owner_user_id="owner",
            name="Has schema",
            description="",
            rules=GameRules(
                allowed_player_counts=(2,),
                allows_leave_mid_match=False,
                allows_join_mid_match=False,
            ),
            code="",
            server_code="const game = {};",
            game_schemas={"state": True, "move": True, "view": True},
            created_at=now,
            updated_at=now,
        ),
        Game(
            id="legacy",
            version=1,
            owner_user_id="owner",
            name="Legacy",
            description="",
            rules=GameRules(
                allowed_player_counts=(2,),
                allows_leave_mid_match=False,
                allows_join_mid_match=False,
            ),
            code="",
            server_code=None,
            game_schemas=None,
            created_at=now,
            updated_at=now,
        ),
    ):
        store.add_game_version(game)

    assert list(export_game_schema_inventory(store)) == ["missing@1"]


@pytest.mark.parametrize(
    ("refs", "message"),
    [
        (["not-a-version"], "invalid"),
        (["absent-game@1"], "not found"),
    ],
)
def test_export_rejects_bad_or_missing_refs(refs, message):
    with pytest.raises(ValueError, match=message):
        export_game_schema_inventory(InMemoryStore(), refs)


def test_read_refs_extracts_versions_from_startup_error(tmp_path):
    refs_file = tmp_path / "missing.txt"
    refs_file.write_text(
        "ValueError: versions missing: 076f078a-56cd-44b3-8930-81abc488508a@4, "
        "tictactoe@2. Backfill these versions.",
        encoding="utf-8",
    )

    assert _read_refs(refs_file) == [
        "076f078a-56cd-44b3-8930-81abc488508a@4",
        "tictactoe@2",
    ]
