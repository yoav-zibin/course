"""Public-state metadata survives imports, partial updates and old stored records."""

import hashlib
import json
from dataclasses import replace

import pytest
from pydantic import ValidationError

from game_platform.agent_import import GameImport, GameUpdate
from game_platform.declarative_ui import client_document
from game_platform.json_file_store import read_snapshot, write_snapshot
from game_platform.models import GameRules
from game_platform.tests.helpers import (
    ECHO_SERVER_CODE, TEST_DECLARATIVE_UI, TEST_GAME_SCHEMAS, TEST_GAME_SECRET,
)
from game_platform.tests.test_agent_import import payload


@pytest.fixture
def classified_game(api):
    return api.platform.create_game(
        name="Public board", description="All pieces are visible",
        rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                        allows_join_mid_match=False),
        code=client_document(TEST_DECLARATIVE_UI), server_code=ECHO_SERVER_CODE,
        game_schemas=TEST_GAME_SCHEMAS, import_package={
            "declarative_ui": TEST_DECLARATIVE_UI,
            "game_addition_request_secret_hash": hashlib.sha256(TEST_GAME_SECRET.encode()).hexdigest(),
        },
    )


def test_import_defaults_to_private_state():
    body = payload()
    body.pop("all_state_public", None)
    assert GameImport.model_validate(body).all_state_public is False


@pytest.mark.parametrize("value", [None, "true", 1, 0, []])
def test_public_state_requires_a_boolean(value):
    body = payload()
    body["all_state_public"] = value
    with pytest.raises(ValidationError):
        GameImport.model_validate(body)
    with pytest.raises(ValidationError):
        GameUpdate.model_validate({"game_addition_request_id_and_secret": TEST_GAME_SECRET,
                                   "all_state_public": value})


@pytest.mark.parametrize("endpoint", ["/games", "/games/declarative"])
def test_public_state_import_is_exposed_by_detail_version_and_catalog(api, endpoint):
    body = payload()
    body["all_state_public"] = True
    created = api.client.post(endpoint, json=body)
    assert created.status_code == 201, created.text
    game = created.json()
    assert game["all_state_public"] is True
    for path in (f"/games/{game['id']}", f"/games/{game['id']}/versions/1"):
        assert api.ok("GET", path)["all_state_public"] is True
    items = api.ok("GET", "/games")
    assert next(item for item in items if item["id"] == game["id"])["all_state_public"] is True


def test_public_state_metadata_patch_preserves_pinned_versions_and_omitted_values(api, classified_game):
    path = f"/games/{classified_game.id}"
    secret = {"game_addition_request_id_and_secret": TEST_GAME_SECRET}
    assert api.ok("GET", path)["all_state_public"] is False
    public = api.ok("PATCH", path, json={**secret, "all_state_public": True})
    assert public["all_state_public"] is True and public["version"] == 2
    assert public["server_code"] == classified_game.server_code
    assert api.ok("GET", path + "/versions/1")["all_state_public"] is False
    # An unrelated partial update keeps the classification, and an identical
    # flag is a no-op. The fixture deliberately has no server test artifacts.
    renamed = api.ok("PATCH", path, json={**secret, "name": "Visible board"})
    assert renamed["all_state_public"] is True and renamed["version"] == 3
    same = api.ok("PATCH", path, json={**secret, "all_state_public": True})
    assert same["version"] == 3
    private = api.ok("PATCH", path, json={**secret, "all_state_public": False})
    assert private["all_state_public"] is False and private["version"] == 4
    assert api.ok("GET", path + "/versions/2")["all_state_public"] is True


def test_public_state_roundtrips_storage_and_old_records_default_false(api, classified_game, tmp_path):
    public = replace(classified_game, all_state_public=True)
    api.platform._store.put_game_version(public)
    path = tmp_path / "data.json"
    write_snapshot(path, api.platform._store.snapshot())
    assert read_snapshot(path).game_versions[0].all_state_public is True
    old = json.loads(path.read_text())
    del old["data"]["game_versions"][0]["all_state_public"]
    path.write_text(json.dumps(old))
    assert read_snapshot(path).game_versions[0].all_state_public is False
