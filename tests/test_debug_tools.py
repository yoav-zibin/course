import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from game_platform.api import create_app
from game_platform.agent_import import GameUpdate
from game_platform.schemas import (
    InviteCreate,
    MatchCreate,
    MoveCreate,
    UserCreate,
    UserUpdate,
)
from game_platform.tests.helpers import Api, login_google_admin

DEBUG_PATHS = (
    "/console",
    "/portal",
    "/static/welcome.html",
    "/browse",
    "/static/common.css",
    "/static/common.js",
    "/static/console.js",
    "/static/browse.js",
    "/static/app/entry.json",
    "/portal-worker.js",
)


@pytest.mark.parametrize("path", DEBUG_PATHS)
def test_debug_pages_are_served(api: Api, path: str) -> None:
    if path in ("/console", "/browse"):
        credentials = ("fixture-admin", api.client.app.state.master_password)
        denied = api.client.get(path, follow_redirects=False)
        assert denied.status_code == 303
        assert denied.headers["location"].startswith("/admin/login?next=")
        login_google_admin(api.client)
        response = api.client.get(path, follow_redirects=False)
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
    else:
        assert api.request("GET", path).status_code == 200


def test_root_serves_the_shared_player_application(api: Api) -> None:
    response = api.client.get("/", follow_redirects=False)
    assert response.status_code == 200
    assert 'id="root"' in response.text
    assert "/static/app/_expo/static/js/web/" in response.text
    assert response.content == api.client.get("/portal").content


def test_debug_tools_can_be_disabled() -> None:
    client = TestClient(create_app(debug_tools=False))
    statuses = {
        path: client.get(path).status_code for path in DEBUG_PATHS
    }
    assert set(statuses.values()) == {404}


def test_debug_endpoints_are_not_in_the_api_schema(api: Api) -> None:
    paths = api.ok("GET", "/openapi.json")["paths"]
    assert all(not path.startswith(("/admin/", "/v2/admin")) for path in paths)
    assert sorted(path for path in paths if not path.startswith("/v2/") and path != "/storage/capabilities") == [
        "/auth/app-sessions",
        "/auth/app-sessions/{token}/complete",
        "/auth/app-sessions/{token}/exchange",
        "/auth/config",
        "/auth/daily-login",
        "/auth/email/start",
        "/auth/email/verify",
        "/auth/google",
        "/auth/me",
        "/auth/phone/start",
        "/auth/phone/verify",
        "/batch",
        "/bug-reports",
        "/c/{campaign_code}",
        "/client-errors",
        "/feedback",
        "/game-proposals",
        "/game-proposals/{proposal_id}",
        "/game-test/moves",
        "/game-test/open-session",
        "/game-test/server-check",
        "/game-test/sessions",
        "/game-test/sessions/{session_id}/abandon",
        "/game-test/sessions/{session_id}/close",
        "/game-test/sessions/{session_id}/moves",
        "/game-test/status",
        "/game-test/submission",
        "/game-test/submissions",
        "/game-test/verify-match",
        "/games",
        "/games/declarative",
        "/games/declarative/client",
        "/games/declarative/examples",
        "/games/declarative/examples/{kind}",
        "/games/declarative/schema",
        "/games/declarative/validate",
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
        "/invites/{token}/revoke",
        "/legacy/games",
        "/legacy/games/{game_id}",
        "/matches",
        "/matches/single-player-sync",
        "/matches/{match_id}",
        "/matches/{match_id}/game",
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
        "/push/config",
        "/push/native-subscriptions",
        "/push/subscriptions",
        "/push/subscriptions/{subscription_id}",
        "/push/test",
        "/users",
        "/users/me/deletion-request",
        "/users/me/invites",
        "/users/me/notifications",
        "/users/me/notifications/{notification_id}/read",
        "/users/me/recent-games",
        "/users/me/recent-games/{game_id}",
        "/users/me/referrals",
        "/users/me/saved-games",
        "/users/me/saved-games/{game_id}",
        "/users/{user_id}",
        "/users/{user_id}/merge",
        "/validation/invariants",
    ]
    assert set(paths["/users/me/deletion-request"]) == {"post", "delete"}


@pytest.mark.parametrize(
    "model",
    [
        UserCreate,
        UserUpdate,
        GameUpdate,
        MatchCreate,
        MoveCreate,
        InviteCreate,
    ],
)
def test_request_examples_shown_in_the_console_are_valid(
    api: Api, model: type[BaseModel]
) -> None:
    document = api.ok("GET", "/openapi.json")
    schema = (document["paths"]["/games/{game_id}"]["patch"]["requestBody"]
              ["content"]["application/json"]["schema"] if model is GameUpdate
              else document["components"]["schemas"][model.__name__])
    (example,) = schema["examples"]
    model.model_validate(example)


def test_the_all_data_endpoint_is_gone(api: Api) -> None:
    # The browse page reads bounded /v2/admin pages instead of one response
    # holding the whole dataset.
    assert api.request("GET", "/debug/all-data").status_code == 404


def test_without_machine_master_the_browser_still_requires_course_google() -> None:
    client = TestClient(create_app())
    assert client.get("/browse", follow_redirects=False).status_code == 303
    assert client.get("/admin/stats").status_code == 503


def test_google_protects_html_while_machine_master_still_protects_api() -> None:
    client = TestClient(create_app(master_password="s3cret", admin_api_key="s3cret"))

    def status(path: str, auth: tuple[str, str] | None = None) -> int:
        if auth is None:
            return client.get(path, follow_redirects=False).status_code
        return client.get(path, auth=auth, follow_redirects=False).status_code

    assert {
        "browse, no password": status("/browse"),
        "browse, right password": status("/browse", ("admin", "s3cret")),
        "console, no password": status("/console"),
        "API, no password": status("/games"),
    } == {
        "browse, no password": 303,
        "browse, right password": 303,
        "console, no password": 303,
        "API, no password": 200,
    }
    # Non-browser API automation retains its explicit Basic challenge.
    response = client.get("/admin/stats")
    assert (response.json(), response.headers["www-authenticate"]) == (
        {
            "detail": "An admin API credential is required.",
            "code": "admin_api_credential_required",
        },
        'Basic realm="Game platform debug tools"',
    )


def test_browsers_revalidate_pages_and_scripts(api: Api) -> None:
    def cache_control(path: str) -> str | None:
        return api.request("GET", path).headers.get("cache-control")

    assert {
        path: cache_control(path) for path in ("/portal", "/portal-worker.js", "/games")
    } == {"/portal": "no-cache", "/portal-worker.js": "no-cache", "/games": None}
