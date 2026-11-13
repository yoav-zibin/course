"""Declared action affordances are portable data, not inferred rule permissions."""

import json

import pytest
from jsonschema import Draft202012Validator

from game_platform.declarative_ui import (
    SCHEMA, DeclarativeLogic, DeclarativeUIError, accepted_platform_host,
    client_document, embedded_spec,
    validate_response,
)
from game_platform.tests.test_declarative_ui import declarative_payload, spec, state_changed


def piece(**updates):
    return {"id": "token", "type": "token", "board": "board",
            "position": {"cell": "0"}, **updates}


@pytest.mark.parametrize("actions", [[], ["tap"], ["rotate", "scale"],
                                     ["tap", "move", "rotate", "scale"]])
def test_piece_action_metadata_accepts_only_declared_portable_operations(actions):
    ui = spec()
    target = {"id": "destination", "board": "board", "position": {"cell": "1"}}
    properties = {"actions": actions}
    if "move" in actions:
        properties["move_targets"] = [target["id"]]
    result = {"scene": {"pieces": [piece(**properties)], "targets": [target]}}
    assert validate_response(ui, result) == result


@pytest.mark.parametrize("properties", [
    {"actions": ["click"]}, {"actions": ["tap", "tap"]},
    {"actions": "tap"}, {"actions": None},
    {"actions": ["move"]}, {"actions": ["move"], "move_targets": []},
    {"actions": ["move"], "move_targets": ["missing"]},
])
def test_invalid_or_unfulfillable_piece_actions_are_rejected(properties):
    with pytest.raises(DeclarativeUIError):
        validate_response(spec(), {"scene": {"pieces": [piece(**properties)]}})


def test_legacy_tap_and_inferred_move_remain_valid_without_new_action_metadata():
    ui = spec()
    target = {"id": "destination", "board": "board", "position": {"cell": "1"}}
    for properties in [{}, {"move_targets": ["destination"]},
                       {"actions": [], "move_targets": ["destination"]}]:
        validate_response(ui, {"scene": {"pieces": [piece(**properties)],
                                        "targets": [target]}})


REDUCER = """
const gameUI={reduce(message,localState){
  const m=message.type==='ui_event'?message.state_changed:message;
  const state=Object.assign({rotation:0,scale:1},localState||{});
  if(message.type==='ui_event'){
    if(message.event.type==='rotate')state.rotation+=message.event.delta;
    if(message.event.type==='scale')state.scale*=message.event.factor;
  }
  return {scene:{pieces:[{id:'token',type:'token',board:'board',
    position:{cell:'0'},rotation:state.rotation,scale:state.scale,
    actions:m.acting_for_player_index===null?[]:['tap','rotate','scale']}]},
    local_state:state};
}};
"""


@pytest.mark.parametrize("event,expected", [
    ({"type": "rotate", "id": "token", "delta": 90}, {"rotation": 90, "scale": 1}),
    ({"type": "rotate", "id": "token", "delta": -90}, {"rotation": -90, "scale": 1}),
    ({"type": "scale", "id": "token", "factor": 1.1}, {"rotation": 0, "scale": 1.1}),
    ({"type": "scale", "id": "token", "factor": 1 / 1.1}, {"rotation": 0, "scale": 1 / 1.1}),
])
def test_rotate_and_scale_events_are_json_requests_handled_by_pure_quickjs(event, expected):
    logic = DeclarativeLogic(spec(REDUCER))
    initial = logic.reduce(state_changed())
    assert initial["local_state"] == {"rotation": 0, "scale": 1}
    result = logic.reduce({"type": "ui_event", "state_changed": state_changed(),
                           "event": event}, initial["local_state"])
    assert result["local_state"] == expected
    assert "make_move" not in result
    assert result["scene"]["pieces"][0][event["type"] if event["type"] == "scale" else "rotation"] == expected[event["type"] if event["type"] == "scale" else "rotation"]


@pytest.mark.parametrize("event", [
    {"type": "rotate", "id": "token"},
    {"type": "rotate", "id": "token", "delta": 0},
    {"type": "rotate", "id": "token", "delta": 361},
    {"type": "rotate", "id": "token", "delta": -361},
    {"type": "rotate", "id": "token", "delta": "90"},
    {"type": "rotate", "id": "token", "delta": 90, "factor": 1.1},
    {"type": "scale", "id": "token"},
    {"type": "scale", "id": "token", "factor": 0},
    {"type": "scale", "id": "token", "factor": -1},
    {"type": "scale", "id": "token", "factor": 101},
    {"type": "scale", "id": "token", "factor": True},
    {"type": "scale", "id": "token", "factor": 1.1, "delta": 90},
    {"type": "tap", "id": "token", "delta": 90},
    {"type": "tap", "id": "token", "factor": 1.1},
])
def test_malformed_or_cross_operation_event_parameters_are_rejected(event):
    with pytest.raises(DeclarativeUIError):
        DeclarativeLogic(spec(REDUCER)).reduce({"type": "ui_event", "event": event,
                                              "state_changed": state_changed()})


def test_protocol_schema_and_probe_expose_rotation_scaling_without_publishing(api):
    Draft202012Validator.check_schema(SCHEMA)
    response = api.client.post("/games/declarative/validate", json={
        "declarative_ui": spec(REDUCER), "message": {
            "type": "ui_event", "state_changed": state_changed(),
            "event": {"type": "rotate", "id": "token", "delta": 90}},
        "local_state": {"rotation": 90, "scale": 1.5},
    })
    assert response.status_code == 200, response.text
    assert response.json()["local_state"] == {"rotation": 180, "scale": 1.5}
    assert api.client.get("/games").json() == []
    assert "/static/declarative-ui.js?v=3" in client_document(spec())
    assert "/static/declarative-ui.css?v=3" in client_document(spec())


def legacy_client_document(ui, asset_query=""):
    return client_document(ui).replace('href="/static/declarative-ui.css?v=3"',
                                      f'href="/static/declarative-ui.css{asset_query}"').replace(
        'src="/static/declarative-ui.js?v=3"', f'src="/static/declarative-ui.js{asset_query}"')


@pytest.mark.parametrize("asset_query", ["", "?v=2"])
def test_exact_legacy_platform_host_keeps_recorded_body_and_hash_unchanged(asset_query):
    from game_platform.agent_import import GameImport
    from game_platform import game_traces as traces
    from game_platform.tests.fake_firestore import FakeClient, query_store
    from game_platform.tests.test_game_traces import SECRET, complete_run, submit

    request = declarative_payload()
    request["game_addition_request_id_and_secret"] = SECRET
    request["client_code"] = legacy_client_document(request["declarative_ui"], asset_query)
    body = GameImport.model_validate(request)
    assert body.client_code == request["client_code"]
    assert accepted_platform_host(body.declarative_ui, body.client_code)
    assert embedded_spec(body.client_code) == body.declarative_ui
    assert GameImport.model_validate(body.model_dump()).model_dump() == body.model_dump()
    canonical = json.loads(json.dumps(body.model_dump(), sort_keys=True))
    assert GameImport.model_validate(canonical).model_dump() == body.model_dump()
    store = query_store("legacy-hint-host", FakeClient())
    row = submit(store, body)
    complete_run(store, body, row["id"])
    loaded = GameImport.model_validate(traces.load_submission_body(store, row))
    assert loaded.client_code == request["client_code"]
    assert traces.inputs_hash(loaded.model_dump()) == row["inputs_hash"]
    class Platform:
        _store = store
    traces.assert_complete(Platform(), loaded)


@pytest.mark.parametrize("change", [
    lambda code: code + '<script>alert(1)</script>',
    lambda code: code.replace('/static/declarative-ui.js"', '/static/declarative-ui.js?v=1"'),
    lambda code: code.replace('host.send(event.data)', 'alert(event.data)'),
])
def test_legacy_host_recognition_does_not_accept_modified_html_or_unknown_versions(change):
    from game_platform.agent_import import GameImport
    from pydantic import ValidationError

    request = declarative_payload()
    modified = change(legacy_client_document(request["declarative_ui"]))
    assert not accepted_platform_host(request["declarative_ui"], modified)
    assert embedded_spec(modified) is None
    request["client_code"] = modified
    with pytest.raises(ValidationError):
        GameImport.model_validate(request)
