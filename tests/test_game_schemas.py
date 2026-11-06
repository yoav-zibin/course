import datetime as dt
import logging

import pytest

from game_platform.backfill_game_schemas import backfill_game_schemas
from game_platform.game_input_metrics import game_input_metrics
from game_platform.tests.helpers import UnrestrictedGameLogic as GameLogic
from game_platform.game_logic import GameLogicError, InvalidMoveError
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


def test_api_rejects_missing_or_malformed_game_schemas(api: Api):
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
    assert missing.status_code == 422
    assert "game_schemas is required" in missing.text

    malformed = api.request(
        "POST",
        "/games",
        as_user=owner,
        json={**body, "game_schemas": {"state": {"type": "invalid"}, "move": True, "view": True}},
    )
    assert malformed.status_code == 422


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


def test_missing_persisted_schemas_are_backfilled_before_platform_start():
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
    with pytest.raises(ValueError, match="legacy-v2@1"):
        GamePlatform(store=store)

    assert backfill_game_schemas(store, {"legacy-v2@1": SCHEMAS}) == 1
    assert GamePlatform(store=store)
