"""The single game update endpoint authenticates and validates each actual change."""

import copy
import hashlib

import pytest

from game_platform import agent_import, game_checks, game_traces
from game_platform.service import InvalidRequestError
from game_platform.tests.test_agent_import import payload


SECRET = "partial-update-secret-0123456789"
MASTER = "admin"


@pytest.fixture
def imported_game(api, monkeypatch):
    """Seed a complete valid package while keeping validation selection observable."""
    owner = api.new_user("Author")
    raw = payload()
    raw["game_addition_request_id_and_secret"] = SECRET
    body = agent_import.GameImport.model_validate(raw)
    with monkeypatch.context() as seed:
        seed.setattr(game_checks, "run_checks", lambda *args, **kwargs: {})
        package = agent_import.prepare(body)
    game = api.platform.import_agent_game(
         name=body.name, description=body.description,
        rules=body.game_rules(), code=body.client_code,
        server_code=body.server_code, game_schemas=body.game_schemas(),
        import_package=package, request_id=SECRET,
    )
    # Exercise exactly the same preparation as the subprocess, with visible spies.
    monkeypatch.setattr(agent_import, "verify_submission", lambda body, *args, **kwargs:
                        agent_import.prepare(body, *args, **kwargs))
    # The HTTP validator already checks the candidate's server logic. The service's
    # independent publication gate has its own regression coverage.
    monkeypatch.setattr(api.platform, "_gate_server_code", lambda *args, **kwargs: None)
    checks = []
    monkeypatch.setattr(game_checks, "CHECKS", tuple(
        (name, lambda *args, _name=name, **kwargs:
         (checks.append(_name) or {"passed": True, "details": []}))
        for name, _check in game_checks.CHECKS
    ))
    return owner, game, raw, checks


def patch_game(api, game, **fields):
    return api.client.patch(f"/games/{game.id}", json={
        "game_addition_request_id_and_secret": SECRET, **fields,
    })


def fail_test_page(*args, **kwargs):
    raise AssertionError("This change must not require the test game page")


@pytest.mark.parametrize("field", [
    "name", "description", "rules", "ui_instructions", "tutorial", "images", "translations", "alternative_names",
])
def test_metadata_changes_skip_test_page_and_logic_checks(api, imported_game, monkeypatch, field):
    _owner, game, raw, checks = imported_game
    monkeypatch.setattr(game_traces, "assert_complete", fail_test_page)
    if field in {"name", "description", "rules", "ui_instructions"}:
        value = "Updated " + raw[field]
    elif field == "alternative_names":
        value = ["First to Three"]
    else:
        value = copy.deepcopy(raw[field])
        if field == "tutorial":
            value["text"] = "A clearer tutorial description."
        elif field == "images":
            value[1]["caption"] = "A clearer supporting image caption"
        else:
            value["es"]["display_name"] = "Nombre actualizado"
    result = patch_game(api, game, **{field: value})
    assert result.status_code == 200, result.text
    assert result.json()["version"] == 2
    assert checks == []
    stored = api.platform.find_game_by_id(game.id)
    assert stored.server_code == game.server_code
    assert stored.game_schemas == game.game_schemas
    assert stored.code == game.code
    assert stored.import_package["unit_tests"] == game.import_package["unit_tests"]
    old = api.client.get(f"/games/{game.id}/versions/1").json()
    assert old["name"] == game.name and old["description"] == game.description
    if field == "rules":
        assert result.json()["game_logic_rules"] == value
    elif field == "ui_instructions":
        assert result.json()["game_ui_rules"] == value
    elif field == "name":
        assert result.json()["name"] == value
        assert result.json()["translations"]["en"]["display_name"] == value


@pytest.mark.parametrize("field", ["server_code", "unit_tests", "allowed_player_counts"])
def test_logic_changes_use_saved_contract_without_test_page(api, imported_game, monkeypatch, field):
    _owner, game, raw, checks = imported_game
    monkeypatch.setattr(game_traces, "assert_complete", fail_test_page)
    if field == "server_code":
        value = raw[field] + "\n// Updated implementation"
    elif field == "unit_tests":
        value = copy.deepcopy(raw[field])
        value["cases"][0]["name"] = "Renamed initial example"
    else:
        value = [1, 2]
    result = patch_game(api, game, **{field: value})
    assert result.status_code == 200, result.text
    assert "approved_examples" in checks
    assert "random_walks" in checks
    stored = api.platform.find_game_by_id(game.id)
    assert stored.game_schemas == game.game_schemas
    if field != "unit_tests":
        assert stored.import_package["unit_tests"] == game.import_package["unit_tests"]
    if field != "server_code":
        assert stored.server_code == game.server_code


def test_tests_only_change_cannot_publish_when_logic_check_fails(api, imported_game, monkeypatch):
    _owner, game, raw, _checks = imported_game
    monkeypatch.setattr(game_traces, "assert_complete", fail_test_page)
    tests = copy.deepcopy(raw["unit_tests"])
    tests["cases"][0]["name"] = "A new test case title"
    monkeypatch.setattr(game_checks, "CHECKS", (("random_walks", lambda *args, **kwargs:
                        {"passed": False, "details": "Candidate failed the walk"}),))
    result = patch_game(api, game, unit_tests=tests)
    assert result.status_code in {400, 422}, result.text
    assert "random_walks" in result.text
    assert api.platform.find_game_by_id(game.id).version == 1


def test_presentation_change_requires_merged_payload_test_page(api, imported_game, monkeypatch):
    _owner, game, raw, checks = imported_game
    spec = copy.deepcopy(raw["declarative_ui"])
    spec["piece_types"]["token"]["color"] = "#abcdef"
    seen = []

    def reject(platform, body):
        seen.append(body)
        raise InvalidRequestError("The updated presentation has not passed /game-test")

    monkeypatch.setattr(game_traces, "assert_complete", reject)
    result = patch_game(api, game, declarative_ui=spec)
    assert result.status_code in {400, 422}, result.text
    assert "/game-test" in result.text
    assert len(seen) == 1
    assert seen[0].declarative_ui == spec
    assert seen[0].server_code == game.server_code
    assert seen[0].unit_tests == raw["unit_tests"]
    assert seen[0].game_addition_request_id_and_secret == SECRET
    assert checks == []
    assert api.platform.find_game_by_id(game.id).version == 1


def test_successful_presentation_change_skips_random_walks(api, imported_game, monkeypatch):
    _owner, game, raw, checks = imported_game
    spec = copy.deepcopy(raw["declarative_ui"])
    spec["piece_types"]["token"]["color"] = "#abcdef"
    seen = []
    monkeypatch.setattr(game_traces, "assert_complete", lambda platform, body: seen.append(body))
    result = patch_game(api, game, declarative_ui=spec)
    assert result.status_code == 200, result.text
    assert len(seen) == 1
    assert result.json()["declarative_ui"] == spec
    assert "random_walks" not in checks
    assert "approved_examples" not in checks
    assert api.client.get(f"/games/{game.id}/versions/1").json()["declarative_ui"] == raw["declarative_ui"]


def test_unchanged_fields_do_not_repeat_validation(api, imported_game, monkeypatch):
    _owner, game, raw, checks = imported_game
    monkeypatch.setattr(game_traces, "assert_complete", fail_test_page)
    result = patch_game(api, game, server_code=raw["server_code"],
                        unit_tests=raw["unit_tests"], declarative_ui=raw["declarative_ui"],
                        name=raw["name"])
    assert result.status_code == 200, result.text
    assert result.json()["version"] == 1
    assert checks == []


@pytest.mark.parametrize("field", ["name", "server_code", "unit_tests", "images", "declarative_ui"])
def test_explicit_null_is_rejected_without_new_version(api, imported_game, field):
    _owner, game, _raw, checks = imported_game
    result = patch_game(api, game, **{field: None})
    assert result.status_code == 422, result.text
    assert api.platform.find_game_by_id(game.id).version == 1
    assert checks == []


@pytest.mark.parametrize("field,value", [
    ("images", [{"caption": "Cover", "svg": '<svg><script>run()</script></svg>'}] * 4),
    ("unit_tests", {"state_schema": {"$ref": "https://example.com/schema"}}),
    ("tutorial", {"text": "Broken", "html": "<h1>Missing device meta tag</h1>"}),
])
def test_invalid_changed_artifact_is_rejected_before_checks(api, imported_game, field, value):
    _owner, game, _raw, checks = imported_game
    result = patch_game(api, game, **{field: value})
    assert result.status_code in {400, 422}, result.text
    assert api.platform.find_game_by_id(game.id).version == 1
    assert checks == []


def test_account_owner_cannot_bypass_secret_authentication(api, imported_game):
    owner, game, _raw, checks = imported_game
    headers = {"X-User-Id": owner, "X-User-Password": api.passwords_by_user_id[owner]}
    missing = api.client.patch(f"/games/{game.id}", headers=headers, json={"name": "Unauthorized"})
    wrong = api.client.patch(f"/games/{game.id}", headers=headers, json={
        "name": "Unauthorized", "game_addition_request_id_and_secret": "a-different-secret-012345",
    })
    assert missing.status_code == 422, missing.text
    assert wrong.status_code in {401, 403, 422}, wrong.text
    assert api.platform.find_game_by_id(game.id).version == 1
    assert checks == []


def test_master_password_preserves_secret_and_owner(api, imported_game, monkeypatch):
    owner, game, _raw, checks = imported_game
    api.client.app.state.master_password = MASTER
    monkeypatch.setattr(game_traces, "assert_complete", fail_test_page)
    first = api.client.patch(f"/games/{game.id}", json={
        "game_addition_request_id_and_secret": MASTER, "name": "Updated by master",
    })
    assert first.status_code == 200, first.text
    stored = api.platform.find_game_by_id(game.id)
    assert not hasattr(stored, "owner_user_id")
    assert stored.import_package["game_addition_request_secret_hash"] == hashlib.sha256(SECRET.encode()).hexdigest()
    assert "game_addition_request_id_and_secret" not in stored.import_package
    second = patch_game(api, game, description="Updated with the original secret")
    assert second.status_code == 200, second.text
    assert second.json()["version"] == 3
    assert checks == []


@pytest.mark.parametrize("path", ["/games", "/games/declarative"])
def test_creation_routes_cannot_update_existing_games(api, imported_game, path):
    _owner, game, raw, _checks = imported_game
    raw["name"] = "Attempted POST update"
    response = api.client.post(path, json=raw)
    assert response.status_code in {409, 422}, response.text
    assert "PATCH" in response.text
    assert api.platform.find_game_by_id(game.id).version == 1
    assert len(api.client.get("/games").json()) == 1


def test_change_after_validation_started_cannot_be_overwritten(api, imported_game, monkeypatch):
    owner, game, _raw, _checks = imported_game
    monkeypatch.setattr(game_traces, "assert_complete", fail_test_page)
    api.platform.set_translations(translations=[("es", game.name, "Nombre anterior")])
    translations_before = api.platform._store.list_translations()

    def validate_and_change_saved_game(body, **kwargs):
        package = agent_import.prepare(body, **kwargs)
        api.platform.update_game( game_id=game.id,
                                 name="Concurrent accepted name")
        return package

    monkeypatch.setattr(agent_import, "verify_submission", validate_and_change_saved_game)
    result = patch_game(api, game, description="A candidate based on the stale version")
    assert result.status_code == 409, result.text
    stored = api.platform.find_game_by_id(game.id)
    assert stored.version == 2
    assert stored.name == "Concurrent accepted name"
    assert stored.description == game.description
    assert api.platform._store.list_translations() == translations_before


def test_mixed_logic_and_presentation_change_runs_both_gates(api, imported_game, monkeypatch):
    _owner, game, raw, checks = imported_game
    spec = copy.deepcopy(raw["declarative_ui"])
    spec["piece_types"]["token"]["color"] = "#abcdef"
    seen = []
    monkeypatch.setattr(game_traces, "assert_complete", lambda platform, body: seen.append(body))
    result = patch_game(api, game, declarative_ui=spec,
                        server_code=raw["server_code"] + "\n// Logic updated too")
    assert result.status_code == 200, result.text
    assert len(seen) == 1
    assert "approved_examples" in checks and "random_walks" in checks
    assert "localization" in checks


def test_persisted_size_limit_includes_the_duplicated_game_schemas(monkeypatch):
    raw = payload()
    raw.pop("client_code")
    raw["declarative_ui"]["ui_code"] += "\n//" + "u" * 180000
    raw["server_code"] += "\n//" + "s" * (199000 - len(raw["server_code"]) - 3)
    raw["unit_tests"]["state_schema"]["description"] = "s" * 195000
    body = agent_import.GameImport.model_validate(raw)
    monkeypatch.setattr(game_checks, "run_checks", lambda *args, **kwargs: {})
    with pytest.raises(InvalidRequestError, match="Stored game package exceeds"):
        agent_import.prepare(body)


@pytest.mark.parametrize("name", ["A renamed game", "Count for {player}"])
def test_name_only_change_replaces_stale_foreign_names_without_translations(
        api, imported_game, monkeypatch, name):
    _owner, game, raw, checks = imported_game
    monkeypatch.setattr(game_traces, "assert_complete", fail_test_page)
    result = patch_game(api, game, name=name)
    assert result.status_code == 200, result.text
    assert result.json()["name"] == name
    assert all(item["display_name"] == name for item in result.json()["translations"].values())
    assert result.json()["translations"]["es"]["short_description"] == raw["translations"]["es"]["short_description"]
    old = api.client.get(f"/games/{game.id}/versions/1").json()
    assert old["translations"]["es"]["display_name"] == raw["translations"]["es"]["display_name"]
    assert checks == []


def test_invalid_translation_batch_cannot_save_a_game_version(api, imported_game, monkeypatch):
    _owner, game, raw, checks = imported_game
    monkeypatch.setattr(game_traces, "assert_complete", fail_test_page)
    api.platform.set_translations(translations=[("es", game.name, "Nombre anterior")])
    translations_before = api.platform._store.list_translations()
    # Authored translations are validated in their own package, without any
    # authority to write the administrator's global translation memory.
    translations = copy.deepcopy(raw["translations"])
    key = next(iter(translations["es"]["client_strings"]))
    del translations["es"]["client_strings"][key]
    result = patch_game(api, game, translations=translations)
    assert result.status_code in {400, 422}, result.text
    assert "incomplete" in result.text
    stored = api.platform.find_game_by_id(game.id)
    assert stored.version == 1 and stored.name == game.name
    assert api.platform._store.list_translations() == translations_before
    assert checks == []


def test_openapi_exposes_optional_update_fields_and_resolvable_references(api):
    document = api.client.get("/openapi.json").json()
    patch = document["paths"]["/games/{game_id}"]["patch"]
    schema = patch["requestBody"]["content"]["application/json"]["schema"]
    assert schema["required"] == ["game_addition_request_id_and_secret"]
    assert {
        "name", "description", "allowed_player_counts", "allows_leave_mid_match",
        "allows_join_mid_match", "client_code", "declarative_ui", "server_code",
        "language", "rules", "ui_instructions", "tutorial", "images", "unit_tests", "translations",
    } <= set(schema["properties"])

    def check_references(value):
        if isinstance(value, dict):
            if "$ref" in value:
                pointer = value["$ref"]
                assert pointer.startswith("#/"), pointer
                resolved = document
                for key in pointer[2:].split("/"):
                    resolved = resolved[key.replace("~1", "/").replace("~0", "~")]
            for item in value.values():
                check_references(item)
        elif isinstance(value, list):
            for item in value:
                check_references(item)

    check_references(document)
