"""Platform games have capabilities, without a creator account or user owner."""

from dataclasses import asdict
import hashlib
import json
from pathlib import Path

import pytest

from game_platform.models import GameRules
from game_platform.tests.helpers import (
    Api,
    ECHO_SERVER_CODE,
    TEST_DECLARATIVE_UI,
    TEST_GAME_SCHEMAS,
)


SECRET = "platform-owned-game-secret-0123456789"
MASTER = "platform-owned-game-master-password"
STALE_ACCOUNT = {"X-User-Id": "deleted-user", "X-User-Password": "expired-password"}


@pytest.mark.parametrize("path", ["/games", "/games/declarative"])
@pytest.mark.parametrize("headers", [{}, STALE_ACCOUNT])
def test_creating_a_game_does_not_need_or_record_an_account(path, headers, monkeypatch):
    api = Api(master_password=MASTER)

    def unexpected_authentication(**kwargs):
        raise AssertionError("game publication must not look up a creator account")

    monkeypatch.setattr(api.platform, "authenticate", unexpected_authentication)
    schema = api.client.get("/games/schema", headers=headers)
    assert schema.status_code == 200, schema.text
    assert not {"user_id", "owner_user_id", "caller_id"} & schema.json()["properties"].keys()
    body = json.loads((Path(__file__).resolve().parent.parent / "examples/agent-game.json").read_text())
    result = api.client.post(path, headers=headers, json=body)
    assert result.status_code == 201, result.text
    game = result.json()
    assert "owner_user_id" not in game
    stored = api.platform._store.get_game(game["id"])
    assert "owner_user_id" not in asdict(stored)
    assert api.platform._store.list_users() == []
    assert "owner_user_id" not in api.client.get("/games").json()[0]
    openapi = api.client.get("/openapi.json").json()
    assert not any(parameter["name"].lower().startswith("x-user-")
                   for parameter in openapi["paths"][path]["post"].get("parameters", []))


def platform_game(api):
    """Create a platform fixture without creating a player account."""
    return api.platform.create_game(
        name="Platform game", description="A shared game", rules=GameRules(
            allowed_player_counts=(2,), allows_leave_mid_match=False, allows_join_mid_match=False),
        code="<div>Platform game</div>", server_code=ECHO_SERVER_CODE,
        game_schemas=TEST_GAME_SCHEMAS,
        import_package={"declarative_ui": TEST_DECLARATIVE_UI,
                        "game_addition_request_secret_hash": hashlib.sha256(SECRET.encode()).hexdigest()},
    )


@pytest.mark.parametrize("method,suffix", [("PATCH", ""), ("DELETE", ""), ("POST", "/unpublish")])
@pytest.mark.parametrize("capability", ["secret", "master"])
def test_game_capabilities_work_with_stale_account_headers(method, suffix, capability, monkeypatch):
    api = Api(master_password=MASTER)
    game = platform_game(api)

    def unexpected_authentication(**kwargs):
        raise AssertionError("a game capability must not authenticate an unrelated account")

    monkeypatch.setattr(api.platform, "authenticate", unexpected_authentication)
    headers = dict(STALE_ACCOUNT)
    options = {}
    if method == "PATCH":
        options["json"] = {"name": "Updated platform game",
                           "game_addition_request_id_and_secret": SECRET if capability == "secret" else MASTER}
    elif capability == "secret":
        headers["X-Game-Secret"] = SECRET
    else:
        options["auth"] = ("admin", MASTER)
    result = api.client.request(method, f"/games/{game.id}{suffix}", headers=headers, **options)
    assert result.status_code == (204 if method == "DELETE" else 200), result.text
    assert result.headers["cache-control"] == "private, no-store"
    assert api.platform._store.list_users() == []


@pytest.mark.parametrize("method,suffix", [("DELETE", ""), ("POST", "/unpublish")])
def test_an_account_alone_has_no_authority_over_platform_games(method, suffix):
    api = Api(master_password=MASTER)
    game = platform_game(api)
    user = api.new_user("Player")
    credentials = {"X-User-Id": user, "X-User-Password": api.passwords_by_user_id[user]}
    result = api.client.request(method, f"/games/{game.id}{suffix}", headers=credentials)
    assert result.status_code == 401
    assert api.platform._store.get_game(game.id).published
    assert not api.platform._store.get_game(game.id).deleted
