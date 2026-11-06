import datetime as dt
import logging
from pathlib import Path

import pytest

from game_platform.backfill_game_schemas import (
    PERMISSIVE_SCHEMAS,
    backfill_game_schemas,
    missing_versions,
    plan_schema_map,
    repo_schemas,
)
from game_platform.game_input_metrics import game_input_metrics
from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.game_logic import GameLogicError, InvalidMoveError
from game_platform.game_testing import _infer_value_schema, infer_game_schemas
from game_platform.tests.helpers import run_unrestricted_server_code as _test_server_code
from game_platform.models import Game, GameRules
from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore
from game_platform.tests.helpers import Api

SCHEMAS = {
    "state": {
        "type": "object",
        "required": ["count"],
        "properties": {"count": {"type": "integer"}},
        "additionalProperties": False,
    },
    "move": {
        "type": "object",
        "required": ["add"],
        "properties": {"add": {"const": 1}},
        "additionalProperties": False,
    },
    "view": True,
}

GAME_CODE = """
const game = {
  newMatch(ctx) { return {state: {count: 0}, turn: [ctx.players[0].id]}; },
  applyMove(state, playerId, move, ctx) {
    if (!move || typeof move.add !== "number") {
      throw new InvalidMove("move must contain a numeric add value");
    }
    return {state: {count: state.count + move.add}, turn: null,
            payouts: {[playerId]: ctx.pot}};
  },
  randomMove() { return {add: 5}; },
  viewFor() { return {}; },
};
"""

RULES = GameRules(
    allowed_player_counts=(2,),
    allows_leave_mid_match=False,
    allows_join_mid_match=False,
)


def _ctx():
    return {
        "players": [
            {"id": "u1", "kind": "human", "display_name": "User",
             "picture_url": "", "max_loss": 10},
            {"id": "u2", "kind": "human", "display_name": "Other",
             "picture_url": "", "max_loss": 10},
        ],
        "pot": 20,
        "move_count": 0,
    }


def test_invalid_player_move_is_rejected_before_game_code_and_recorded(caplog, api: Api):
    logic = GameLogic(
        GAME_CODE,
        game_schemas=SCHEMAS,
        game_id="schema-validation-test",
        game_version=3,
    )
    before = next(
        (
            row["invalid_count"]
            for row in game_input_metrics()
            if row["game_id"] == "schema-validation-test"
        ),
        0,
    )
    with caplog.at_level(logging.WARNING, logger="game_platform.game_input_metrics"):
        with pytest.raises(InvalidMoveError, match="invalid move"):
            logic.call(
                "applyMove", {"count": 0}, "u1", {"add": 5}, ctx=_ctx()
            )
    after = next(
        row["invalid_count"]
        for row in game_input_metrics()
        if row["game_id"] == "schema-validation-test"
    )
    assert after == before + 1
    assert "game input failed JSON Schema validation" in caplog.text
    metric = next(
        row
        for row in api.ok("GET", "/admin/game-input-metrics")
        if row["game_id"] == "schema-validation-test"
    )
    assert metric["invalid_count"] == after


def test_random_walk_fails_on_invalid_generated_move():
    report = _test_server_code(
        GAME_CODE,
        game_schemas=SCHEMAS,
        game_id="random-walk-schema-test",
        rules=RULES,
        run_seed=7,
    )
    assert not report.passed
    assert report.failures
    assert all(failure.function == "randomMove" for failure in report.failures)
    assert all("returned invalid move" in failure.message for failure in report.failures)


def test_invalid_state_and_view_results_are_game_bugs():
    bad_state = GameLogic(
        GAME_CODE.replace("{count: 0}", "{other: 0}"),
        game_schemas=SCHEMAS,
    )
    with pytest.raises(GameLogicError, match="returned invalid state"):
        bad_state.call("newMatch", ctx=_ctx())

    view_schemas = {**SCHEMAS, "view": {"type": "object", "required": ["visible"]}}
    bad_view = GameLogic(GAME_CODE, game_schemas=view_schemas)
    with pytest.raises(GameLogicError, match="returned invalid view"):
        bad_view.call("viewFor", {"count": 0}, "u1", ctx=_ctx())


def test_estimate_win_chance_does_not_swallow_invalid_generated_move():
    code = GAME_CODE.replace(
        "viewFor() { return {}; },",
        "viewFor(state, playerId, ctx) { "
        "return {chance: ctx.estimateWinChance(state, playerId)}; },",
    )
    logic = GameLogic(code, game_schemas=SCHEMAS, game_id="estimate-schema-test")
    with pytest.raises(GameLogicError, match="invalid move in estimateWinChance"):
        logic.call("viewFor", {"count": 0}, "u1", ctx=_ctx())


def test_api_generates_missing_and_rejects_malformed_game_schemas(api: Api):
    owner = api.new_user("owner")
    body = {
        "name": "Needs schemas",
        "allowed_player_counts": [2],
        "allows_leave_mid_match": False,
        "allows_join_mid_match": False,
        "code": "<div></div>",
        "server_code": GAME_CODE,
    }
    missing = api.request(
        "POST", "/games", as_user=owner, json={**body, "game_schemas": None}
    )
    assert missing.status_code == 201
    generated_schemas = missing.json()["game_schemas"]
    assert set(generated_schemas) == {"state", "move", "view"}
    assert isinstance(generated_schemas["state"], dict), missing.json()
    assert generated_schemas["state"]["properties"]["count"]["type"] == "integer"

    tested = api.ok(
        "POST",
        "/games/test",
        as_user=owner,
        json={
            "server_code": GAME_CODE,
            "game_schemas": None,
            "allowed_player_counts": [2],
            "allows_leave_mid_match": False,
            "allows_join_mid_match": False,
        },
    )
    assert tested["game_schemas"] == missing.json()["game_schemas"]

    malformed = api.request(
        "POST",
        "/games",
        as_user=owner,
        json={**body, "game_schemas": {"state": {"type": "invalid"}, "move": True, "view": True}},
    )
    assert malformed.status_code == 422


def test_draft_publication_generates_schemas(api: Api):
    owner = api.new_user("draft-owner")
    draft = api.ok(
        "POST",
        "/game-drafts",
        as_user=owner,
        json={
            "name": "Generated draft",
            "allowed_player_counts": [2],
            "allows_leave_mid_match": False,
            "allows_join_mid_match": False,
            "code": "<div></div>",
            "server_code": GAME_CODE,
            "game_schemas": None,
        },
    )
    published = api.ok(
        "POST",
        f"/game-drafts/{draft['id']}/publish",
        as_user=owner,
        json={"expected_revision": draft["revision"]},
    )
    assert set(published["game_schemas"]) == {"state", "move", "view"}
    stored_draft = api.ok(
        "GET", f"/game-drafts/{draft['id']}", as_user=owner
    )
    assert stored_draft["game_schemas"] == published["game_schemas"]


def test_random_walk_schema_inference_covers_generated_game_values():
    schemas, report = infer_game_schemas(
        GAME_CODE,
        game_id="schema-inference-test",
        rules=RULES,
        budget_seconds=0.1,
        run_seed=123,
    )
    assert report.walks_completed > 0
    assert set(schemas) == {"state", "move", "view"}
    assert schemas["state"]["properties"]["count"]["type"] == "integer"
    assert schemas["move"]["properties"]["add"]["type"] == "integer"
    assert schemas["view"]["type"] == "object"


def test_schema_inference_includes_terminal_views():
    from jsonschema import validate

    code = GAME_CODE.replace("viewFor() { return {}; }",
                             "viewFor(state) { return {line: state.count ? [0, 1, 2] : null}; }")
    schemas, report = infer_game_schemas(code, game_id="terminal-view",
                                         rules=RULES, budget_seconds=0.3, run_seed=123)
    assert report.passed
    validate({"line": None}, schemas["view"])
    validate({"line": [0, 1, 2]}, schemas["view"])


def test_schema_inference_keeps_nested_constraints_for_nullable_values():
    schema = _infer_value_schema([None, {"count": 1}])
    assert schema == {
        "type": ["null", "object"],
        "properties": {"count": {"type": "integer"}},
        "additionalProperties": True,
    }


def test_game_schemas_round_trip_and_are_in_openapi(api: Api):
    owner = api.new_user("owner")
    game = api.ok(
        "POST",
        "/games",
        as_user=owner,
        json={
            "name": "Schema contract",
            "allowed_player_counts": [2],
            "code": "<div></div>",
            "server_code": GAME_CODE,
            "game_schemas": SCHEMAS,
        },
    )
    assert game["game_schemas"] == SCHEMAS

    definitions = api.client.get("/openapi.json").json()["components"]["schemas"]
    assert set(definitions["GameSchemas"]["properties"]) == {"state", "move", "view"}
    for model in (
        "GameCreate",
        "GameUpdate",
        "GameDraftSave",
        "GameTestRequest",
        "EmulatorResetRequest",
        "GameOut",
    ):
        assert "game_schemas" in definitions[model]["properties"]


def test_invalid_api_move_is_rejected_without_advancing_the_match(api: Api):
    owner, other = api.new_user("owner"), api.new_user("other")
    game = api.ok(
        "POST",
        "/games",
        as_user=owner,
        json={
            "name": "Strict move",
            "allowed_player_counts": [2],
            "code": "<div></div>",
            "server_code": GAME_CODE,
            "game_schemas": SCHEMAS,
        },
    )
    match = api.ok(
        "POST", "/matches", as_user=owner, json={"game_id": game["id"]}
    )
    api.ok("POST", f"/matches/{match['id']}/join", as_user=other)
    started = api.ok("POST", f"/matches/{match['id']}/start", as_user=owner, json={})
    assert started["move_count"] == 0

    rejected = api.request(
        "POST",
        f"/matches/{match['id']}/moves",
        as_user=owner,
        json={"move": {"add": 5}, "expected_move_count": 0},
    )
    assert rejected.status_code == 400
    current = api.ok("GET", f"/matches/{match['id']}", as_user=owner)
    assert current["move_count"] == 0
    assert api.ok("GET", f"/matches/{match['id']}/moves", as_user=owner) == []
    metric = next(
        row
        for row in api.ok("GET", "/admin/game-input-metrics")
        if row["game_id"] == game["id"] and row["input"] == "move"
    )
    assert metric["invalid_count"] >= 1


def test_missing_persisted_schemas_degrade_startup_but_block_game_logic():
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    store = InMemoryStore()
    game = Game(
        id="legacy-v2",
        version=1,
        owner_user_id="owner",
        name="Legacy",
        description="",
        rules=RULES,
        code="<div></div>",
        server_code=GAME_CODE,
        created_at=now,
        updated_at=now,
    )
    store.add_game_version(game)
    platform = GamePlatform(store=store)
    with pytest.raises(GameLogicError, match="game_schemas"):
        platform._logic_for(game)

    assert backfill_game_schemas(store, {"legacy-v2@1": SCHEMAS}) == 1
    backfilled = GamePlatform(store=store)
    assert backfilled._logic_for(store.get_game_version("legacy-v2", 1))


def _legacy(game_id, version, now):
    return Game(
        id=game_id,
        version=version,
        owner_user_id="owner",
        name=game_id,
        description="",
        rules=RULES,
        code="<div></div>",
        server_code=GAME_CODE,
        created_at=now,
        updated_at=now,
    )


def test_the_backfill_plan_uses_shipped_schemas_for_the_newest_version_and_a_stopgap_for_the_rest():
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    store = InMemoryStore()
    for game_id, version in (("poker", 1), ("poker", 2), ("other", 1)):
        store.add_game_version(_legacy(game_id, version, now))
    missing = missing_versions(store)
    assert missing == [("other", 1), ("poker", 1), ("poker", 2)]
    shipped = repo_schemas(Path(__file__).parent.parent / "games")
    assert {"poker", "tictactoe", "debug"} <= set(shipped)

    plan, source = plan_schema_map(missing, {}, shipped=shipped, permissive_rest=True)
    assert source == {
        "other@1": "permissive (no validation)",
        "poker@1": "permissive (no validation)",
        "poker@2": "games/poker.schema.json",
    }
    assert plan["poker@2"] == shipped["poker"] and plan["other@1"] == PERMISSIVE_SCHEMAS
    # Without the stopgap, versions with no schema are left out, so the backfill refuses.
    partial, _ = plan_schema_map(missing, {}, shipped=shipped)
    assert set(partial) == {"poker@2"}
    with pytest.raises(ValueError, match="missing schemas for other@1, poker@1"):
        backfill_game_schemas(store, partial)
    # A given schema wins over everything else.
    chosen, why = plan_schema_map(missing, {"poker@2": SCHEMAS}, shipped=shipped, permissive_rest=True)
    assert chosen["poker@2"] == SCHEMAS and why["poker@2"] == "the schema map"

    assert backfill_game_schemas(store, plan) == 3
    assert GamePlatform(store=store)
    assert missing_versions(store) == []


def test_the_backfill_opens_the_same_store_as_the_server_in_query_mode():
    from unittest.mock import patch

    from game_platform import backfill_game_schemas as module
    from game_platform.config import Config

    config = Config.model_validate(
        {"firestore": {"enabled": True, "mode": "query", "project_id": "p", "database": "d", "namespace": "production_v1"}}
    )
    with patch("google.cloud.firestore.Client") as client, patch("game_platform.query_store.QueryStore") as store:
        module.open_store(config)
    client.assert_called_once_with(project="p", database="d")
    assert store.call_args.kwargs == {"namespace": "production_v1"}
