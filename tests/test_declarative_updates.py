"""Partial updates must not separate native presentation from its tested rules."""

import copy

import pytest

from game_platform.declarative_ui import client_document
from game_platform.models import GameRules
from game_platform.tests.helpers import ECHO_SERVER_CODE, TEST_GAME_SCHEMAS


@pytest.fixture
def declarative_game(api):
    owner = api.new_user("Author")
    spec = {
        "format": "buildplay-ui", "version": 1,
        "viewport": {"width": 100, "height": 100},
        "boards": [{"id": "table", "kind": "zone", "x": 0, "y": 0,
                    "width": 100, "height": 100}],
        "piece_types": {"token": {"shape": "circle"}},
        "ui_code": "var gameUI={reduce(){return {scene:{}}}}",
    }
    game = api.platform.create_game(
        caller_id=owner, name="Native game", description="A scene",
        rules=GameRules(allowed_player_counts=(2,), allows_leave_mid_match=False,
                        allows_join_mid_match=False),
        code=client_document(spec), server_code=ECHO_SERVER_CODE,
        game_schemas=TEST_GAME_SCHEMAS, import_package={"declarative_ui": spec},
    )
    return owner, game, spec


@pytest.mark.parametrize("patch", [
    {"code": "<div>Different HTML</div>"},
    {"client_code": "<div>Different HTML</div>"},
    {"server_code": ECHO_SERVER_CODE + "\n// different source",
     "game_schemas": TEST_GAME_SCHEMAS},
    {"game_schemas": {"state": {"type": "object"}, "move": True, "view": True}},
    {"allowed_player_counts": [2, 3]},
    {"allows_leave_mid_match": True},
    {"allows_join_mid_match": True},
])
def test_partial_behavior_changes_are_rejected_without_new_version(api, declarative_game, patch):
    owner, game, _ = declarative_game
    response = api.request("PATCH", f"/games/{game.id}", as_user=owner, json=patch)
    assert response.status_code == 400, response.text
    assert "POST /games/declarative" in response.json()["detail"]
    stored = api.client.get(f"/games/{game.id}").json()
    assert stored["version"] == 1
    assert stored["client_code"] == game.code
    assert stored["server_code"] == game.server_code


def test_metadata_changes_and_identical_behavior_remain_supported(api, declarative_game):
    owner, game, spec = declarative_game
    unchanged = api.ok("PATCH", f"/games/{game.id}", as_user=owner, json={
        "client_code": game.code, "server_code": game.server_code,
        "game_schemas": game.game_schemas, "allowed_player_counts": [2],
        "allows_join_mid_match": False, "allows_leave_mid_match": False,
    })
    assert unchanged["version"] == 1
    renamed = api.ok("PATCH", f"/games/{game.id}", as_user=owner,
                     json={"name": "Renamed", "description": "A new description"})
    assert renamed["version"] == 2
    assert renamed["declarative_ui"] == spec
    assert api.client.get(f"/games/{game.id}/versions/1").json()["name"] == game.name


def test_complete_import_can_replace_presentation_as_one_pinned_package(api, declarative_game):
    owner, game, spec = declarative_game
    updated = copy.deepcopy(spec)
    updated["piece_types"]["token"]["color"] = "#abcdef"
    replacement = api.platform.import_agent_game(
        caller_id=owner, name=game.name, description=game.description,
        rules=game.rules, code=client_document(updated), server_code=game.server_code,
        game_schemas=game.game_schemas,
        import_package={"declarative_ui": updated}, existing_game_id=game.id,
    )
    assert replacement.version == 2
    assert replacement.import_package["declarative_ui"] == updated
    pinned = api.client.get(f"/games/{game.id}/versions/1").json()
    assert pinned["declarative_ui"] == spec
    assert pinned["client_code"] == client_document(spec)
