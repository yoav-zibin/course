"""Portable visual events and filtered history remain bounded presentation data."""

import json
from pathlib import Path

import pytest

from game_platform.declarative_ui import (
    DeclarativeLogic, DeclarativeUIError, validate_response,
)
from game_platform.tests.test_declarative_ui import spec, state_changed


ANIMATION_CASES = json.loads((Path(__file__).with_name("fixtures") /
                             "declarative/piece-animation-cases.json").read_text())
HIT_AREA_CASES = json.loads((Path(__file__).with_name("fixtures") /
                            "declarative/target-hit-area-cases.json").read_text())


def animated_response(animation):
    return {"scene": {"pieces": [{"id": "die", "type": "token", "board": "board",
                                  "position": {"cell": "0"}, "actions": [],
                                  "animation": animation}]}}


@pytest.mark.parametrize("case", ANIMATION_CASES)
def test_roll_animation_matches_browser_boundary_cases(case):
    response = animated_response(case["value"])
    if case["valid"]:
        assert validate_response(spec(), response) == response
        assert response["scene"]["pieces"][0]["actions"] == []
    else:
        with pytest.raises(DeclarativeUIError):
            validate_response(spec(), response)


def test_roll_keys_have_the_same_identifier_length_limit_as_browser_pieces():
    validate_response(spec(), animated_response({"kind": "roll", "key": "r" * 80}))
    with pytest.raises(DeclarativeUIError):
        validate_response(spec(), animated_response({"kind": "roll", "key": "r" * 81}))


@pytest.mark.parametrize("case", HIT_AREA_CASES)
def test_target_hit_area_matches_browser_geometry_cases(case):
    response = {"scene": {"targets": [{"id": "destination", "board": "board",
                                       "position": {"cell": "1"},
                                       "hit_area": case["value"]}]}}
    if case["valid"]:
        assert validate_response(spec(), response) == response
        assert response["scene"]["targets"][0]["position"] == {"cell": "1"}
    else:
        with pytest.raises(DeclarativeUIError):
            validate_response(spec(), response)


def test_target_hit_area_limits_match_existing_logical_geometry_and_do_not_apply_to_pieces():
    target = {"id": "destination", "board": "board", "position": {"cell": "1"},
              "hit_area": {"x": -100000, "y": 100000, "width": 100000, "height": 100000}}
    validate_response(spec(), {"scene": {"targets": [target]}})
    for width in [float("inf"), float("nan")]:
        with pytest.raises(DeclarativeUIError):
            validate_response(spec(), {"scene": {"targets": [
                {**target, "hit_area": {**target["hit_area"], "width": width}}]}})
    with pytest.raises(DeclarativeUIError):
        validate_response(spec(), {"scene": {"pieces": [
            {"id": "die", "type": "token", "board": "board", "position": {"cell": "0"},
             "hit_area": HIT_AREA_CASES[0]["value"]}]}})


@pytest.mark.parametrize("nested", [False, True])
def test_presentation_history_accepts_twelve_filtered_json_snapshots_without_permissions(nested):
    code = """const gameUI={reduce(message){
      const m=message.type==='ui_event'?message.state_changed:message;
      return {scene:{},local_state:{history:m.presentation_history}};
    }};"""
    history = [{"view": {"visible": [i, None, False]}, "move_count": i,
                "last_move_player_index": i % 10 if i else None} for i in range(12)]
    changed = state_changed(move_count=12, acting_for_player_index=None,
                            presentation_history=history)
    message = {"type": "ui_event", "event": {"type": "tap", "id": "die"},
               "state_changed": changed} if nested else changed
    result = DeclarativeLogic(spec(code)).reduce(message)
    assert result["local_state"]["history"] == history
    assert "make_move" not in result
    assert DeclarativeLogic(spec(code)).reduce(
        state_changed(presentation_history=[]))["local_state"]["history"] == []


@pytest.mark.parametrize("history", [
    None, {}, "history", [{"view": {}, "move_count": 0}] * 13,
    [{}], [{"view": {}}], [{"move_count": 0}],
    [{"view": {}, "move_count": -1}], [{"view": {}, "move_count": .5}],
    [{"view": {}, "move_count": True}],
    [{"view": {}, "move_count": 0, "last_move_player_index": -1}],
    [{"view": {}, "move_count": 0, "last_move_player_index": 10}],
    [{"view": {}, "move_count": 0, "last_move_player_index": "0"}],
    [{"view": {}, "move_count": 0, "last_move_player_index": True}],
    [{"view": {}, "move_count": 0, "acting_for_player_index": 0}],
    [{"view": {}, "move_count": 0, "state": {"hidden": "secret"}}],
])
def test_history_rejects_overflow_invalid_counters_actors_and_extra_permission_fields(history):
    with pytest.raises(DeclarativeUIError):
        DeclarativeLogic(spec()).reduce(state_changed(presentation_history=history))


def test_history_views_can_be_any_filtered_json_and_actor_is_optional():
    code = "const gameUI={reduce(m){return {scene:{},local_state:m.presentation_history}}};"
    history = [{"view": view, "move_count": i}
               for i, view in enumerate([None, False, 2, "visible", [1, 2], {"open": 3}])]
    assert DeclarativeLogic(spec(code)).reduce(
        state_changed(presentation_history=history))["local_state"] == history


def test_history_cannot_authorize_a_spectator_to_emit_a_move():
    code = "const gameUI={reduce(){return {scene:{},make_move:{action:'roll'}}}};"
    changed = state_changed(acting_for_player_index=None, presentation_history=[
        {"view": {}, "move_count": 0, "last_move_player_index": 0}])
    with pytest.raises(DeclarativeUIError, match="current player"):
        DeclarativeLogic(spec(code)).reduce({"type": "ui_event", "state_changed": changed,
                                            "event": {"type": "tap", "id": "die"}})
