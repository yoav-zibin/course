"""Failure evidence survives context disposal and subsequent runtime calls."""

import datetime as dt
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from game_platform.game_contract import ContractLogic
from game_platform.game_logic import GameLogic, GameLogicError, GameLogicTimeout, InvalidMoveError


SCHEMAS = {"state": True, "move": True, "view": True}
CTX = {
    "players": [{"id": "human-1", "kind": "human", "active": True}],
    "pot": 0, "move_count": 4,
}


def runner(source, **kwargs):
    return GameLogic(source, game_schemas=SCHEMAS, game_id="test-game", game_version=3, **kwargs)


def test_exception_has_exact_detached_arguments_and_replay_context():
    source = 'const game = {viewFor(state) {throw new Error("broken " + state.n);}};'
    logic = runner(source)
    state = {"n": 7, "private_cards": ["A", "K"]}
    now = dt.datetime(2026, 11, 18, 1, 2, 3, 456000, tzinfo=dt.timezone.utc)
    seed = 2**255 + 123
    with pytest.raises(GameLogicError) as caught:
        logic.call("viewFor", state, "human-1", ctx=CTX, seed=seed, now=now)
    report = caught.value.bug_report
    state["n"] = 99
    assert report["arguments"] == [{"n": 7, "private_cards": ["A", "K"]}, "human-1"]
    assert json.loads(report["input_json"]) == {"args": report["arguments"], "ctx": CTX}
    assert report["seed"] == str(seed)
    assert report["seed_type"] == "integer"
    assert report["effective_seed"] == format(seed, "064x")
    assert report["frozen_time_millis"] == int(now.timestamp() * 1000)
    assert report["server_code_sha256"] == hashlib.sha256(source.encode()).hexdigest()
    assert report["game_schemas"] == SCHEMAS
    assert report["game_id"] == "test-game" and report["game_version"] == 3
    assert report["kind"] == "exception"
    assert "broken 7" in report["message"]
    assert report["memory_used_bytes"] > 0
    assert logic._context is None


def test_timeout_evidence_keeps_effective_limit_and_metrics_before_discard():
    logic = runner('const game = {viewFor() {while(true) {}}};', time_limit_seconds=0.1)
    with pytest.raises(GameLogicTimeout) as caught:
        logic.call("viewFor", {}, "human-1", ctx=CTX, time_limit_seconds=0.02)
    report = caught.value.bug_report
    assert report["kind"] == "timeout"
    assert report["time_limit_seconds"] == 0.02
    assert report["duration_seconds"] > 0
    assert report["memory_used_bytes"] > 0
    assert report["memory_limit_bytes"] == 64 * 1024 * 1024


def test_memory_cap_records_snapshot_without_inventing_a_peak():
    logic = runner('const game = {viewFor() {return new Array(1000000).fill(7);}};', memory_limit_bytes=2 * 1024 * 1024)
    with pytest.raises(GameLogicError) as caught:
        logic.call("viewFor", {}, "human-1", ctx=CTX)
    report = caught.value.bug_report
    assert report["kind"] == "memory_limit"
    assert report["memory_limit_bytes"] == 2 * 1024 * 1024
    assert report["memory_used_bytes"] > 0
    assert "peak usage and rejected allocation size unavailable" in report["memory_measurement"]


def test_schema_output_failure_records_result_and_drops_poisoned_context():
    logic = GameLogic(
        'let n = 0; const game = {viewFor() {return {n: ++n};}};',
        game_schemas={**SCHEMAS, "view": {"type": "string"}},
    )
    for _ in range(2):
        with pytest.raises(GameLogicError) as caught:
            logic.call("viewFor", {}, "human-1", ctx=CTX)
        assert caught.value.bug_report["result"] == {"n": 1}
        assert caught.value.bug_report["kind"] == "invalid_result"
        assert logic._context is None


def test_allowed_invalid_move_and_bad_caller_inputs_have_no_bug_evidence():
    logic = runner('const game = {applyMove() {throw new InvalidMove("illegal");}, viewFor() {return {};}};')
    with pytest.raises(InvalidMoveError) as rejected:
        logic.call("applyMove", {}, "human-1", {}, ctx=CTX)
    # The service can retain these inputs if a game's own bot made the
    # illegal move; the expected human rejection is still not a game bug.
    assert rejected.value.rejected_call_report["arguments"] == [{}, "human-1", {}]
    with pytest.raises(GameLogicError) as caught:
        logic.call("viewFor", {}, "human-1", ctx={"players": []})
    assert caught.value.bug_report is None
    with pytest.raises(GameLogicError) as caught:
        logic.call("unknown", ctx=CTX)
    assert caught.value.bug_report is None


def test_player_left_may_reject_an_unavailable_departure():
    logic = runner('const game = {playerLeft() {throw new InvalidMove("cannot leave now");}};')
    with pytest.raises(InvalidMoveError):
        logic.call("playerLeft", {}, "human-1", ctx=CTX)


@pytest.mark.parametrize("function,args", [
    ("newMatch", ()), ("computerMove", ({}, "human-1")),
    ("randomMove", ({}, "human-1")), ("viewFor", ({}, "human-1")),
])
def test_invalid_move_from_non_rejecting_functions_is_a_game_bug(function, args):
    logic = runner('const game = {' + function + '() {throw new InvalidMove("unexpected");}};')
    with pytest.raises(GameLogicError) as caught:
        logic.call(function, *args, ctx=CTX)
    assert caught.value.bug_report["kind"] == "exception"
    assert "unexpectedly raised InvalidMove" in caught.value.bug_report["message"]


def test_load_and_constructor_failures_have_evidence():
    logic = runner('throw new Error("bad startup");')
    with pytest.raises(GameLogicError) as caught:
        logic.load()
    assert caught.value.bug_report["phase"] == "load"
    assert caught.value.bug_report["function"] == "<load>"
    assert caught.value.bug_report["memory_used_bytes"] > 0
    with pytest.raises(GameLogicError) as caught:
        logic.has("playerLeft")
    assert caught.value.bug_report["kind"] == "initialization"
    with pytest.raises(GameLogicError) as caught:
        GameLogic("const game = {};", game_schemas={"state": {"type": "nonsense"}})
    assert caught.value.bug_report["kind"] == "invalid_schema"


def test_initialization_timeout_uses_the_initialization_budget():
    logic = runner("while (true) {}", time_limit_seconds=0.02)
    with pytest.raises(GameLogicError) as caught:
        logic.call("playerLeft", {}, "human-1", ctx=CTX, time_limit_seconds=2)
    assert caught.value.bug_report["phase"] == "load"
    assert caught.value.bug_report["kind"] == "timeout"
    assert caught.value.bug_report["time_limit_seconds"] == 0.02


def test_additional_contract_output_failure_has_evidence():
    contract = {"state_schema": True, "move_schema": True, "view_schema": {"type": "string"}}
    logic = ContractLogic('const game = {viewFor() {return {n: 1};}};', contract, game_schemas=SCHEMAS)
    with pytest.raises(GameLogicError) as caught:
        logic.call("viewFor", {}, "human-1", ctx=CTX)
    assert caught.value.bug_report["kind"] == "invalid_result"
    assert caught.value.bug_report["result"] == {"n": 1}
    assert caught.value.bug_report["arguments"] == [{}, "human-1"]


def test_concurrent_failures_keep_their_own_inputs_and_results():
    logic = runner('const game = {newMatch(ctx) {return {state: {n: ctx.move_count}, turn: []};}};')

    def fail(n):
        with pytest.raises(GameLogicError) as caught:
            logic.call("newMatch", ctx={**CTX, "move_count": n}, seed=n)
        return caught.value.bug_report

    with ThreadPoolExecutor(max_workers=4) as executor:
        reports = list(executor.map(fail, range(12)))
    for n, report in enumerate(reports):
        assert report["ctx"]["move_count"] == n
        assert report["result"]["state"]["n"] == n
        assert report["seed"] == str(n)
