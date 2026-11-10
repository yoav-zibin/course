import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from game_platform.api import create_app
from game_platform.schemas import (
    GameUpdate,
    InviteCreate,
    MatchCreate,
    MatchUpdate,
    MoveCreate,
    QuickMatchRequest,
    UserCreate,
    UserUpdate,
)
from game_platform.tests.helpers import Api

DEBUG_PATHS = (
    "/console",
    "/portal",
    "/static/welcome.html",
    "/static/welcome.css",
    "/static/welcome.js",
    "/browse",
    "/static/common.css",
    "/static/common.js",
    "/static/console.js",
    "/static/browse.js",
    "/static/portal.js",
)


@pytest.mark.parametrize("path", DEBUG_PATHS)
def test_debug_pages_are_served(api: Api, path: str) -> None:
    assert api.request("GET", path).status_code == 200


def test_root_serves_the_welcome_page(api: Api) -> None:
    response = api.client.get("/", follow_redirects=False)
    assert response.status_code == 200
    assert "Game platform · Welcome" in response.text


def test_debug_tools_can_be_disabled() -> None:
    client = TestClient(create_app(debug_tools=False))
    statuses = {
        path: client.get(path).status_code for path in DEBUG_PATHS
    }
    assert set(statuses.values()) == {404}


def test_debug_endpoints_are_not_in_the_api_schema(api: Api) -> None:
    paths = api.ok("GET", "/openapi.json")["paths"]
    assert all(not path.startswith("/v2/admin") for path in paths)
    assert sorted(path for path in paths if not path.startswith("/v2/") and path != "/storage/capabilities") == [
        "/auth/config",
        "/auth/email/start",
        "/auth/email/verify",
        "/auth/google",
        "/auth/me",
        "/auth/phone/start",
        "/auth/phone/verify",
        "/batch",
        "/c/{campaign_code}",
        "/client-errors",
        "/feedback",
        "/game-test/moves",
        "/game-test/server-check",
        "/game-test/status",
        "/game-test/submission",
        "/game-test/submissions",
        "/game-test/verify-match",
        "/games",
        "/games/schema",
        "/games/versions",
        "/games/{game_id}",
        "/games/{game_id}/unpublish",
        "/games/{game_id}/versions/{version}",
        "/games/{game_id}/versions/{version}/cover",
        "/games/{game_id}/versions/{version}/strings",
        "/health",
        "/i18n/bundle/{locale}",
        "/i18n/games/{locale}",
        "/i18n/locales",
        "/i18n/{locale}",
        "/invites/{token}",
        "/invites/{token}/accept",
        "/invites/{token}/qr.svg",
        "/invites/{token}/revoke",
        "/matches",
        "/matches/open",
        "/matches/{match_id}",
        "/matches/{match_id}/history",
        "/matches/{match_id}/invites",
        "/matches/{match_id}/join",
        "/matches/{match_id}/leave",
        "/matches/{match_id}/maybeLeave",
        "/matches/{match_id}/moves",
        "/matches/{match_id}/playerLeft",
        "/matches/{match_id}/players/{user_id}",
        "/matches/{match_id}/rematch",
        "/matches/{match_id}/start",
        "/matchmaking/quick-match",
        "/push/config",
        "/push/subscriptions",
        "/push/subscriptions/{subscription_id}",
        "/push/test",
        "/users",
        "/users/me/experiments/skin",
        "/users/me/invites",
        "/users/me/recent-games",
        "/users/me/recent-games/{game_id}",
        "/users/me/referrals",
        "/users/me/saved-games",
        "/users/me/saved-games/{game_id}",
        "/users/{user_id}",
        "/users/{user_id}/merge",
        "/validation/invariants",
    ]


@pytest.mark.parametrize(
    "model",
    [
        UserCreate,
        UserUpdate,
        GameUpdate,
        MatchCreate,
        MatchUpdate,
            MoveCreate,
        QuickMatchRequest,
        InviteCreate,
    ],
)
def test_request_examples_shown_in_the_console_are_valid(
    api: Api, model: type[BaseModel]
) -> None:
    schemas = api.ok("GET", "/openapi.json")["components"]["schemas"]
    (example,) = schemas[model.__name__]["examples"]
    model.model_validate(example)


def test_the_all_data_endpoint_is_gone(api: Api) -> None:
    # The browse page reads bounded /v2/admin pages instead of one response
    # holding the whole dataset.
    assert api.request("GET", "/debug/all-data").status_code == 404


def test_without_a_master_password_the_debug_tools_are_open(api: Api) -> None:
    assert api.request("GET", "/browse").status_code == 200


def test_the_master_password_protects_browse() -> None:
    client = TestClient(create_app(master_password="s3cret"))

    def status(path: str, auth: tuple[str, str] | None = None) -> int:
        if auth is None:
            return client.get(path).status_code
        return client.get(path, auth=auth).status_code

    assert {
        "browse, no password": status("/browse"),
        "browse, right password": status("/browse", ("admin", "s3cret")),
        "console, no password": status("/console"),
        "API, no password": status("/games"),
    } == {
        "browse, no password": 401,
        "browse, right password": 200,
        "console, no password": 200,
        "API, no password": 200,
    }
    # The challenge makes the browser ask for the password.
    response = client.get("/browse")
    assert (response.json(), response.headers["www-authenticate"]) == (
        {
            "detail": "the master password is required (any username)",
            "code": "master_password_required",
        },
        'Basic realm="Game platform debug tools"',
    )


def test_browsers_revalidate_pages_and_scripts(api: Api) -> None:
    def cache_control(path: str) -> str | None:
        return api.request("GET", path).headers.get("cache-control")

    assert {
        path: cache_control(path) for path in ("/portal", "/static/portal.js", "/games")
    } == {"/portal": "no-cache", "/static/portal.js": "no-cache", "/games": None}
