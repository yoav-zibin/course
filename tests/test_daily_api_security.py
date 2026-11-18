"""Regression tests for the daily API security review, with explicit credentials."""

from dataclasses import replace
import hashlib

import pytest
from fastapi.testclient import TestClient

from game_platform.api import create_app
from game_platform.models import with_package_secret_hash
from game_platform.tests.helpers import Api

MASTER = "daily-audit-master-password"
SECRET = "daily-audit-game-secret-0123456789"


def game_fixture():
    api = Api(master_password=MASTER)
    owner = api.new_user("owner")
    other = api.new_user("other")
    game_id = api.new_game(owner=owner)
    stored = api.platform._store.get_game(game_id)
    package = with_package_secret_hash(stored.import_package, hashlib.sha256(SECRET.encode()).hexdigest())
    api.platform._store.put_game_version(replace(stored, import_package=package))
    return api, owner, other, game_id


def credentials(api, user):
    return {"X-User-Id": user, "X-User-Password": api.passwords_by_user_id[user]}


@pytest.mark.parametrize("method,suffix,body", [("PATCH", "", {"name": "Changed"}), ("DELETE", "", None), ("POST", "/unpublish", None)])
def test_account_ownership_does_not_authorize_global_game_changes(method, suffix, body):
    api, owner, other, game_id = game_fixture()
    path = f"/games/{game_id}{suffix}"
    for user in (owner, other):
        result = api.client.request(method, path, headers=credentials(api, user), json=body)
        assert result.status_code == (422 if method == "PATCH" else 403)
    wrong = {**body, "game_addition_request_id_and_secret": "wrong-secret"} if method == "PATCH" else body
    result = api.client.request(method, path, headers={"X-Game-Secret": "wrong-secret"}, json=wrong)
    assert result.status_code == 403
    assert api.platform._store.get_game(game_id).published
    assert not api.platform._store.get_game(game_id).deleted
    assert api.platform._store.get_game(game_id).name == "Poker"


@pytest.mark.parametrize("method,suffix,body,expected", [("PATCH", "", {"name": "Changed"}, 200), ("DELETE", "", None, 204), ("POST", "/unpublish", None, 200)])
@pytest.mark.parametrize("capability", ["secret", "master"])
def test_game_changes_accept_independent_game_or_master_capability(method, suffix, body, expected, capability):
    api, _, _, game_id = game_fixture()
    if method == "PATCH":
        body = {**body, "game_addition_request_id_and_secret": SECRET if capability == "secret" else MASTER}
        options = {}
    else:
        options = {"headers": {"X-Game-Secret": SECRET}} if capability == "secret" else {"auth": ("admin", MASTER)}
    response = api.client.request(method, f"/games/{game_id}{suffix}", json=body, **options)
    assert response.status_code == expected, response.text
    assert response.headers["cache-control"] == "private, no-store"


def test_unicode_body_master_preserves_the_game_secret():
    api, _, _, game_id = game_fixture()
    api.client.app.state.master_password = "μαстер-秘密-🔐"
    response = api.client.patch(f"/games/{game_id}", json={
        "name": "Changed by master", "game_addition_request_id_and_secret": api.client.app.state.master_password,
    })
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    again = api.client.patch(f"/games/{game_id}", json={
        "name": "Changed by original game secret", "game_addition_request_id_and_secret": SECRET,
    })
    assert again.status_code == 200, again.text


@pytest.mark.parametrize("path,method", [("/admin/stats", "GET"), ("/browse", "GET"), ("/v2/admin/users", "GET"), ("/game-proposals", "GET"), ("/game-proposals/anything", "DELETE")])
def test_unconfigured_master_disables_protected_operations(path, method):
    client = TestClient(create_app())
    for auth in (None, ("admin", ""), ("admin", "anything")):
        assert client.request(method, path, auth=auth).status_code == 503


def test_batch_cannot_access_master_password_admin_collections():
    api = Api(master_password=MASTER)
    user = api.new_user("player")
    import json
    response = api.client.get("/batch", params={"requests": json.dumps(["/admin/stats", "/v2/admin/users"])}, headers=credentials(api, user))
    assert [row["status"] for row in response.json()] == [401, 401]


def test_credentials_private_profiles_and_admin_errors_are_never_http_cached():
    api = Api(master_password=MASTER)
    created = api.client.post("/users", json={"display_name": "new user"})
    assert created.headers["cache-control"] == "private, no-store"
    user = created.json()
    private = api.client.get("/auth/me", headers={"X-User-Id": user["id"], "X-User-Password": user["password"]})
    assert private.headers["cache-control"] == "private, no-store"
    assert private.json()["password"] == user["password"]
    for path in ("/matches/unknown", "/v2/matches/unknown/history", "/admin/stats", "/v2/admin/users"):
        assert api.client.get(path).headers["cache-control"] == "private, no-store"


def test_user_api_rejects_client_wallet_balances_and_cross_user_changes():
    api = Api(master_password=MASTER)
    owner, other = api.new_user("owner"), api.new_user("other")
    assert api.client.post("/users", json={"display_name": "attacker", "token_balance": 1000000}).status_code == 422
    for field in ("token_balance", "verified_login_bonus_granted", "password", "replaced_by_user_id"):
        response = api.client.patch(f"/users/{owner}", headers=credentials(api, owner), json={field: 1000000})
        assert response.status_code == 422
    assert api.client.patch(f"/users/{other}", headers=credentials(api, owner), json={"display_name": "stolen"}).status_code == 403
    assert api.platform.get_user(owner).token_balance == 0
    assert api.platform.get_user(other).display_name == "other"


def test_game_test_submission_cannot_bypass_expensive_validation_limit():
    api = Api(master_password=MASTER)
    slots = api.client.app.state.import_slots
    assert slots.acquire(blocking=False)
    assert slots.acquire(blocking=False)
    try:
        response = api.client.post("/game-test/submissions", json={"secret": SECRET, "game_name": "Bounded", "body": {}})
        assert response.status_code == 429
        assert response.headers["retry-after"] == "15"
    finally:
        slots.release()
        slots.release()


@pytest.mark.parametrize("query_backend", [False, True])
def test_new_game_secret_cannot_overwrite_another_games_translations(query_backend):
    from game_platform.tests.test_agent_import import payload
    from game_platform.translation import text_hash
    from unittest.mock import patch

    from game_platform.tests.fake_firestore import FakeClient, query_store
    store = query_store("translation-auth", FakeClient()) if query_backend else None
    api = Api(master_password=MASTER, store=store)
    owner = api.new_user("victim owner")
    author = api.new_user("other author")
    body = payload()
    victim = api.create_game({"name": body["name"], "description": body["description"],
        "allowed_player_counts": [2], "code": body["client_code"]}, owner)["id"]
    api.platform.set_translation(locale="es", source=body["name"], text="Protected game name")
    api.platform.set_translation(locale="es", source="Add one", text="Protected action")
    api.platform._bundle_games_ttl_seconds = 0
    if query_backend:
        from game_platform import game_traces
        from game_platform.agent_import import GameImport
        from game_platform.tests.test_game_traces import complete_run
        parsed = GameImport.model_validate(body)
        submission = game_traces.record_submission(store, secret=body["game_addition_request_id_and_secret"],
            game_name=body["name"], body_dict=parsed.model_dump())
        complete_run(store, parsed, submission["id"])
    with patch.object(api.platform, "set_translations", side_effect=AssertionError("imports must not change global translations")):
        imported = api.ok("POST", "/games", as_user=author, json=body)
    authored = body["translations"]
    authored["es"]["client_strings"]["add"] = "Only this game's updated action"
    updated = api.client.patch(f"/games/{imported['id']}", json={
        "game_addition_request_id_and_secret": body["game_addition_request_id_and_secret"],
        "translations": authored,
    })
    assert updated.status_code == 200, updated.text
    # Both games use identical source words, but their authors cannot alter each
    # other's translation records by selecting a fresh game capability.
    assert api.platform._store.get_translations("es", [text_hash(body["name"])])[text_hash(body["name"])].text == "Protected game name"
    names = api.ok("GET", "/i18n/games/es")["games"]
    assert names[victim]["name"] == "Protected game name"
    assert names[imported["id"]]["name"] == body["translations"]["es"]["display_name"]
    bundle = api.ok("GET", "/i18n/bundle/es")["games"]
    assert bundle[victim]["strings"]["add"] == "Protected action"
    assert bundle[imported["id"]]["strings"]["add"] == authored["es"]["client_strings"]["add"]
    assert api.ok("GET", f"/games/{imported['id']}/versions/2/strings", params={"lang": "es"})["strings"]["add"] == authored["es"]["client_strings"]["add"]


@pytest.mark.parametrize("headers", [
    {"Origin": "https://attacker.example"}, {"Origin": "null"},
    {"Origin": "http://testserver.attacker.example"}, {"Origin": "http://testserver:81"}, {"Origin": "http://testserver:0"},
    {"Origin": "//testserver"}, {"Origin": "http://testserver:bad"},
    {"Origin": "http://testserver/path"}, {"Sec-Fetch-Site": "cross-site"},
    {"Referer": "https://attacker.example/form"}, {"Sec-Fetch-Site": "same-site"},
])
def test_ambient_master_cannot_unpublish_from_a_cross_origin_browser_request(headers):
    api, _, _, game_id = game_fixture()
    response = api.client.post(f"/games/{game_id}/unpublish", auth=("admin", MASTER), headers=headers)
    assert response.status_code == 403
    assert api.platform._store.get_game(game_id).published


@pytest.mark.parametrize("headers", [
    {}, {"Origin": "http://testserver"}, {"Origin": "http://testserver:80"}, {"Origin": "http://TESTSERVER"},
    {"Referer": "http://testserver/admin?tab=games"}, {"Sec-Fetch-Site": "same-origin"},
])
def test_master_game_writes_allow_same_origin_browsers_and_explicit_cli_auth(headers):
    api, _, _, game_id = game_fixture()
    response = api.client.post(f"/games/{game_id}/unpublish", auth=("admin", MASTER), headers=headers)
    assert response.status_code == 200
    assert not api.platform._store.get_game(game_id).published


def test_public_base_origin_is_trusted_behind_a_proxy_without_prefix_matching():
    api, _, _, game_id = game_fixture()
    api.client.app.state.public_base_url = "https://play.example.com/portal"
    path = f"/games/{game_id}/unpublish"
    assert api.client.post(path, auth=("admin", MASTER), headers={"Origin": "https://play.example.com.attacker.example"}).status_code == 403
    assert api.client.post(path, auth=("admin", MASTER), headers={"Origin": "https://play.example.com:443"}).status_code == 200


def test_explicit_game_secret_is_independent_of_ambient_master_origin_checks():
    api, _, _, game_id = game_fixture()
    response = api.client.post(f"/games/{game_id}/unpublish", auth=("admin", MASTER),
        headers={"Origin": "https://author.example", "Sec-Fetch-Site": "cross-site", "X-Game-Secret": SECRET})
    assert response.status_code == 200


def test_master_protected_admin_writes_reject_cross_origin_requests():
    api, _, _, game_id = game_fixture()
    path = f"/admin/games/{game_id}"
    assert api.client.delete(path, auth=("admin", MASTER), headers={"Origin": "null"}).status_code == 403
    assert not api.platform._store.get_game(game_id).deleted
    assert api.client.delete(path, auth=("admin", MASTER), headers={"Origin": "http://testserver"}).status_code == 204
