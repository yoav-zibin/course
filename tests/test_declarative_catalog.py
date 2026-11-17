"""Only declarative games are playable; HTML source remains available for migration."""

import datetime as dt
import json
from dataclasses import replace

import pytest

from game_platform.agent_import import GameImport
from game_platform.models import Game
from game_platform.scaling_service import ScalablePlatform
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api
from game_platform.tests.test_agent_import import payload


def archive_html(api, owner):
    body = GameImport.model_validate(payload())
    now = dt.datetime.now(dt.timezone.utc)
    game = Game(id="legacy-counter", version=1, owner_user_id=owner,
                name="Legacy counter", description=body.description,
                rules=body.game_rules(), code="<html>Archived counter</html>",
                server_code=body.server_code, game_schemas=body.game_schemas(),
                created_at=now, updated_at=now,
                import_package={"rules_text": body.rules, "ui_text": body.ui_instructions,
                                "unit_tests": body.unit_tests, "images": body.images,
                                "tutorial": body.tutorial,
                                "translations": {locale: translation.model_dump()
                                                 for locale, translation in body.translations.items()},
                                "game_addition_request_id_and_secret": "private-secret-value",
                                "game_addition_request_secret_hash": "private-hash-value"})
    api.platform._store.add_game_version(game)
    return game


def catalog_api(query_mode):
    api = Api(store=query_store("declarative-catalog") if query_mode else None)
    if query_mode:
        api.platform = ScalablePlatform(store=api.platform._store, computer_move_delay_seconds=0)
        api.client.app.state.platform = api.platform
    return api


@pytest.mark.parametrize("query_mode", [False, True])
def test_html_games_are_archived_and_only_declarative_games_use_portal_apis(query_mode):
    api = catalog_api(query_mode)
    owner = api.new_user("Author and player")
    html = archive_html(api, owner)
    body = GameImport.model_validate(payload())
    native = api.platform.import_agent_game(
        caller_id=owner, name="Declarative counter", description=body.description,
        rules=body.game_rules(), code=body.client_code, server_code=body.server_code,
        game_schemas=body.game_schemas(), import_package={"declarative_ui": body.declarative_ui})
    listed = api.ok("GET", "/games")
    assert [game["id"] for game in listed] == [native.id]
    assert listed[0]["renderer_type"] == "declarative"
    assert "code" not in listed[0] and "declarative_ui" not in listed[0]
    assert api.request("GET", f"/games/{html.id}").status_code == 404
    assert api.request("GET", f"/games/{html.id}/versions/1").status_code == 404
    assert api.request("GET", f"/games/{html.id}/versions/1/strings").status_code == 404
    refs = f"{html.id}@1,{native.id}@1"
    assert [game["id"] for game in api.ok("GET", "/games/versions", params={"refs": refs})] == [native.id]
    assert html.id not in api.ok("GET", "/i18n/bundle/en")["games"]
    store = api.platform._store
    store.put_user(replace(store.get_user(owner), saved_game_ids=(html.id, native.id),
                           recent_game_ids=(html.id, native.id)))
    store.record_game_match_start(html.id, 10)
    assert all(row["id"] != html.id for row in api.ok("GET", "/games/popular"))
    assert [row["id"] for row in api.ok("GET", "/users/me/saved-games", as_user=owner)] == [native.id]
    assert [row["id"] for row in api.ok("GET", "/users/me/recent-games", as_user=owner)] == [native.id]
    if query_mode:
        assert [row["id"] for row in api.ok("GET", "/v2/users/me/saved-games", as_user=owner)["items"]] == [native.id]
    assert api.platform._store.get_game(html.id).code == html.code
    archive = api.ok("GET", "/legacy/games")
    assert [game["id"] for game in archive["items"]] == [html.id]
    detail = api.ok("GET", f"/legacy/games/{html.id}")
    assert detail["code"] == html.code and detail["server_code"] == html.server_code
    assert detail["import_package"]["unit_tests"] == html.import_package["unit_tests"]
    assert detail["import_package"]["images"] == html.import_package["images"]
    assert len(detail["versions"]) == 1
    assert "private-secret-value" not in json.dumps(detail)
    assert "private-hash-value" not in json.dumps(detail)
    assert detail["supports_local_practice"] is False
    assert api.request("POST", "/matches", as_user=owner,
                       json={"game_id": html.id, "num_computer_opponents": 0}).status_code == 404
    assert api.request("PATCH", f"/games/{html.id}", as_user=owner,
                       json={"name": "Updated HTML"}).status_code == 400
    assert api.request("POST", "/matchmaking/quick-match", as_user=owner,
                       json={"game_id": html.id}).status_code == 404
    assert api.request("POST", f"/games/{html.id}/unpublish", as_user=owner).status_code == 400
    assert api.request("DELETE", f"/games/{html.id}", as_user=owner).status_code == 400
    assert api.request("PUT", f"/users/me/saved-games/{html.id}", as_user=owner).status_code == 404
    assert api.request("POST", f"/users/me/recent-games/{html.id}", as_user=owner).status_code == 404
    if query_mode:
        rows, cursor = [], None
        while True:
            page = api.ok("GET", "/v2/games", params={"limit": "1", **({"cursor": cursor} if cursor else {})})
            rows.extend(page["items"])
            cursor = page["next_cursor"]
            if cursor is None:
                break
        assert [row["id"] for row in rows] == [native.id]
    match_id = api.new_match(owner=owner, game_id=native.id, start=True)
    forged = api.request("POST", f"/matches/{match_id}/moves", as_user=owner,
                         json={"move": {"add": 99, "state": {"n": 3}}, "expected_move_count": 0})
    assert forged.status_code == 400, forged.text
    assert api.ok("GET", f"/matches/{match_id}", as_user=owner)["state"] == {"n": 0}
    moved = api.ok("POST", f"/matches/{match_id}/moves", as_user=owner,
                   json={"move": {"add": 1}, "expected_move_count": 0})
    assert moved["state"] == {"n": 1}


@pytest.mark.parametrize("query_mode", [False, True])
def test_migration_preserves_old_html_versions_in_legacy_detail(query_mode):
    api = catalog_api(query_mode)
    owner = api.new_user("Migrator")
    html = archive_html(api, owner)
    body = GameImport.model_validate(payload())
    migrated = api.platform.import_agent_game(
        caller_id=owner, existing_game_id=html.id, name=body.name,
        description=body.description, rules=body.game_rules(), code=body.client_code,
        server_code=body.server_code, game_schemas=body.game_schemas(),
        import_package={"declarative_ui": body.declarative_ui})
    assert migrated.id == html.id and migrated.version == 2
    assert api.ok("GET", f"/games/{html.id}")["renderer_type"] == "declarative"
    assert api.request("GET", f"/games/{html.id}/versions/1").status_code == 404
    archive = api.ok("GET", f"/legacy/games/{html.id}")
    assert archive["version"] == 1
    assert archive["versions"][0]["code"] == html.code
    assert api.platform._store.get_game_version(html.id, 1).code == html.code


def test_unpublished_legacy_game_source_requires_owner(api):
    owner, stranger = api.new_user("Author"), api.new_user("Stranger")
    html = archive_html(api, owner)
    api.platform._store.set_game_published(html.id, False)
    assert api.ok("GET", "/legacy/games")["items"] == []
    assert api.request("GET", f"/legacy/games/{html.id}").status_code == 404
    assert api.request("GET", f"/legacy/games/{html.id}", as_user=stranger).status_code == 404
    response = api.request("GET", f"/legacy/games/{html.id}", as_user=owner)
    assert response.status_code == 200 and response.json()["code"] == html.code
    assert response.headers["Cache-Control"] == "private, no-store"


@pytest.mark.parametrize("query_mode", [False, True])
def test_stale_html_match_records_cannot_be_read_joined_or_rematched(query_mode, monkeypatch):
    from game_platform.service import NotFoundError

    api = catalog_api(query_mode)
    owner = api.new_user("Player")
    html = archive_html(api, owner)
    body = GameImport.model_validate(payload())
    native = api.platform.import_agent_game(
        caller_id=owner, name=body.name, description=body.description,
        rules=body.game_rules(), code=body.client_code, server_code=body.server_code,
        game_schemas=body.game_schemas(), import_package={"declarative_ui": body.declarative_ui})
    current_id = api.new_match(owner=owner, game_id=native.id, start=True)
    current = api.platform._store.get_match(current_id)
    stale = replace(current, id="stale-html-match", game_id=html.id, game_version=1)
    api.platform._store.put_match(stale)
    assert api.request("GET", f"/matches/{stale.id}", as_user=owner).status_code == 404
    assert api.request("POST", f"/matches/{stale.id}/join", as_user=owner).status_code == 404
    assert api.request("POST", f"/matches/{stale.id}/rematch", as_user=owner).status_code == 404
    assert all(match["id"] != stale.id for match in api.ok("GET", "/matches", as_user=owner))
    with pytest.raises(NotFoundError):
        api.platform._join(stale, caller_id="other-player")

    def forbidden_logic(_game):
        raise AssertionError("retired HTML game logic executed")

    monkeypatch.setattr(api.platform, "_logic_for", forbidden_logic)
    assert api.platform.view_state(stale, owner) is None
    api.platform._run_computer_moves(stale.id)
