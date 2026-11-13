"""The native UI boundary: shape/ref validation, bounded VM, imports and versions."""

import base64
import json

import pytest
from jsonschema import Draft202012Validator
from pydantic import ValidationError

from game_platform.agent_import import GameImport, prepare
from game_platform.declarative_ui import (
    SCHEMA, DeclarativeLogic, DeclarativeUIError, client_document, embedded_spec,
    validate_spec,
)
from game_platform.tests.test_agent_import import payload


def spec(code=None):
    return {
        "format": "buildplay-ui", "version": 1,
        "viewport": {"width": 600, "height": 600},
        "boards": [{"id": "board", "kind": "grid", "x": 0, "y": 0,
                    "width": 600, "height": 600, "rows": 3, "columns": 3}],
        "piece_types": {"token": {"shape": "circle", "color": "#123456"}},
        "strings": {"add": "Add one", "count": "Count: {n}"},
        "ui_code": code or """
          const gameUI = {reduce(message, localState) {
            const state = message.type === 'ui_event' ? message.state_changed : message;
            const next = {scene: {
              pieces: [{id:'token0', type:'token', board:'board', position:{cell:'0'},
                        text:String(state.view.n), rotation:45, scale:1.2,
                        move_targets:['destination']}],
              targets:[{id:'destination',board:'board',position:{cell:'1'}}],
              controls:[{id:'add',kind:'button',label:'Add one'}]
            }, local_state:{selected:message.type === 'ui_event' ? message.event.id : null}};
            if(message.type === 'ui_event' && state.acting_for_player_index !== null)
              next.make_move = {add:1};
            return next;
          }};
        """,
    }


def state_changed(**overrides):
    return {"type": "state_changed", "view": {"n": 1}, "state": {"n": 1},
            "acting_for_player_index": 0, "my_player_index": 0,
            "status": "ongoing", **overrides}


def declarative_payload():
    body = payload()
    body["declarative_ui"] = spec()
    body.pop("client_code")
    for locale, translation in body["translations"].items():
        translation["client_strings"] = {key: f"[{locale}] " + value for key, value in body["declarative_ui"]["strings"].items()}
    return body


def test_schema_is_valid_and_reducer_returns_json_without_browser_apis():
    Draft202012Validator.check_schema(SCHEMA)
    logic = DeclarativeLogic(spec())
    initial = logic.reduce(state_changed())
    assert initial["scene"]["pieces"][0]["text"] == "1"
    assert "make_move" not in initial
    result = logic.reduce({"type": "ui_event", "event": {"type": "tap", "id": "add"},
                           "state_changed": state_changed()}, initial["local_state"])
    assert result["make_move"] == {"add": 1}
    assert result["local_state"] == {"selected": "add"}


def test_reducer_globals_cannot_retain_secret_or_interaction_state():
    ui = spec("let count=0; const gameUI={reduce(m,s){count++;return {scene:{},local_state:{count,previous:s}}}}")
    logic = DeclarativeLogic(ui)
    assert logic.reduce(state_changed())["local_state"]["count"] == 1
    assert logic.reduce(state_changed())["local_state"]["count"] == 1
    assert logic.reduce(state_changed(), {"selected": "x"})["local_state"]["previous"] == {"selected": "x"}


@pytest.mark.parametrize("source", [
    "while(true){}",
    "const gameUI={reduce(){while(true){}}}",
    "const gameUI={reduce(){return {scene:{},local_state:fetch('https://example.com')}}}",
    "const gameUI={reduce(){return {scene:{},local_state:document.cookie}}}",
    "const gameUI={reduce(){return {scene:{},local_state:Math.random()}}}",
    "const gameUI={reduce(){return {scene:{},local_state:Date.now()}}}",
    "const gameUI={reduce(){return {scene:{},local_state:'x'.repeat(300000)}}}",
])
def test_vm_has_no_io_or_time_randomness_and_is_bounded(source):
    with pytest.raises(DeclarativeUIError):
        DeclarativeLogic(spec(source)).reduce(state_changed())


@pytest.mark.parametrize("scene", [
    {"pieces": [{"id": "x", "type": "missing", "board": "board", "position": {"cell": "0"}}]},
    {"pieces": [{"id": "x", "type": "token", "board": "missing", "position": {"cell": "0"}}]},
    {"pieces": [{"id": "x", "type": "token", "board": "board", "position": {"cell": "9"}}]},
    {"pieces": [{"id": "x", "type": "token", "board": "board", "position": {"cell": "0"}, "asset": "missing"}]},
    {"pieces": [{"id": "x", "type": "token", "board": "board", "position": {"cell": "0"}, "move_targets": ["missing"]}]},
    {"controls": [{"id": "x", "kind": "button", "label": "a"}, {"id": "x", "kind": "button", "label": "b"}]},
    {"controls": [{"id": "x", "kind": "choice", "label": "a"}]},
    {"pieces": [{"id": "x", "type": "token", "board": "board", "position": {"cell": "0"}, "rotation": None}]},
    {"innerHTML": "<script>alert(1)</script>"},
])
def test_scene_rejects_unknown_references_bad_geometry_and_markup(scene):
    source = "const gameUI={reduce(){return " + json.dumps({"scene": scene}) + "}}"
    with pytest.raises(DeclarativeUIError):
        DeclarativeLogic(spec(source)).reduce(state_changed())


@pytest.mark.parametrize("message", [state_changed(), {"type": "ui_event", "event": {"type": "tap", "id": "a"},
    "state_changed": state_changed(acting_for_player_index=None)},
    {"type": "ui_event", "event": {"type": "tap", "id": "a"},
     "state_changed": state_changed(replay={})},
    {"type": "ui_event", "event": {"type": "tap", "id": "a"},
     "state_changed": state_changed(replay={"index": 0, "total": 2})}])
def test_presentation_may_only_move_from_current_player_event(message):
    ui = spec("const gameUI={reduce(){return {scene:{},make_move:{add:1}}}}")
    with pytest.raises(DeclarativeUIError, match="current player UI event"):
        DeclarativeLogic(ui).reduce(message)


def test_inline_asset_data_is_type_checked_and_svg_is_inert():
    ui = spec()
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>'
    ui["assets"] = {"disc": {"media_type": "image/svg+xml", "uri": "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()}}
    ui["piece_types"]["token"]["asset"] = "disc"
    ui["piece_types"]["token"]["back_asset"] = "disc"
    validate_spec(ui)
    ui["piece_types"]["token"]["back_asset"] = "missing"
    with pytest.raises(DeclarativeUIError, match="asset reference"):
        validate_spec(ui)
    ui["piece_types"]["token"]["back_asset"] = "disc"
    ui["assets"]["disc"]["uri"] = "data:image/svg+xml;base64," + base64.b64encode(b'<svg><script>alert(1)</script></svg>').decode()
    with pytest.raises(DeclarativeUIError, match="inert SVG"):
        validate_spec(ui)
    ui["assets"]["disc"] = {"media_type": "image/png", "uri": "data:image/png;base64," + base64.b64encode(b"not png").decode()}
    with pytest.raises(DeclarativeUIError, match="signature"):
        validate_spec(ui)


def test_spec_topology_references_and_version_are_strict():
    ui = spec()
    ui["version"] = 2
    with pytest.raises(DeclarativeUIError): validate_spec(ui)
    ui = spec()
    ui["boards"][0].update(kind="graph", cells=[{"id": "a", "x": 0, "y": 0}], links=[{"from": "a", "to": "b"}])
    with pytest.raises(DeclarativeUIError, match="links"): validate_spec(ui)


def test_declarative_import_generates_host_without_changing_html_payload_identity():
    original = payload()
    legacy = GameImport.model_validate(original)
    assert "declarative_ui" not in legacy.model_dump()
    assert legacy.client_code == original["client_code"]
    body = GameImport.model_validate(declarative_payload())
    assert body.client_code == client_document(body.declarative_ui)
    assert embedded_spec(body.client_code) == body.declarative_ui
    assert GameImport.model_validate(body.model_dump()).model_dump() == body.model_dump()
    canonical = json.loads(json.dumps(body.model_dump(), sort_keys=True))
    assert GameImport.model_validate(canonical).client_code == body.client_code
    altered = declarative_payload()
    altered["client_code"] = "<script>alert(1)</script>"
    with pytest.raises(ValidationError): GameImport.model_validate(altered)


def test_generated_html_escapes_spec_so_assets_and_source_cannot_break_out():
    ui = spec()
    ui["strings"]["count"] = "</script><script>alert(1)</script>"
    html = client_document(ui)
    assert "</script><script>alert(1)</script>" not in html
    assert embedded_spec(html) == ui
    assert embedded_spec(html + "<!--modified-->") is None


def test_probe_endpoints_are_bounded_and_do_not_publish(api):
    schema = api.client.get("/games/declarative/schema")
    assert schema.status_code == 200
    assert schema.json()["properties"]["version"] == {"const": 1}
    body = {"declarative_ui": spec(), "message": state_changed()}
    result = api.client.post("/games/declarative/validate", json=body)
    assert result.status_code == 200, result.text
    assert result.json()["scene"]["pieces"][0]["text"] == "1"
    assert api.client.get("/games").json() == []
    assert api.client.post("/games/declarative/validate", json={**body, "unknown": True}).status_code == 422
    assert api.client.post("/games/declarative/validate", content="{}", headers={"Content-Type": "text/plain"}).status_code == 415
    assert api.client.post("/games/declarative/validate", content="x"*900001, headers={"Content-Type": "application/json"}).status_code == 413
    result = api.client.post("/games/declarative/client", json=spec())
    assert result.status_code == 200 and result.json()["client_code"] == client_document(spec())


@pytest.mark.parametrize("message", [
    None, [], {}, {"type": "ui_event", "event": {"type": "tap", "id": "a"}, "state_changed": None},
    {"type": "ui_event", "event": {"type": "drop", "id": "a"}, "state_changed": state_changed()},
    {"type": "ui_event", "event": {"type": "tap", "id": []}, "state_changed": state_changed()},
    state_changed(acting_for_player_index="0"), state_changed(status="waiting"),
])
def test_malformed_reducer_message_is_422_instead_of_server_error(api, message):
    result = api.client.post("/games/declarative/validate", json={"declarative_ui": spec(), "message": message})
    assert result.status_code == 422, result.text


def test_example_downloads_are_allowlisted_and_do_not_publish(api):
    from game_platform.declarative_ui import EXAMPLE_IDS
    manifest = api.client.get("/games/declarative/examples")
    assert manifest.status_code == 200
    assert [item["id"] for item in manifest.json()["examples"]] == list(EXAMPLE_IDS)
    assert api.client.get("/games/declarative/examples/not-a-game").status_code == 404
    example = api.client.get(manifest.json()["examples"][0]["url"])
    assert example.status_code == 200
    assert GameImport.model_validate(example.json()).declarative_ui["version"] == 1
    assert api.client.get("/games").json() == []


def test_published_declarative_packages_are_pinned_to_each_game_version(api, monkeypatch):
    # The shared import suite independently checks rule tests, localization and
    # trace requirements; this focuses on submission serialization/versioning.
    import game_platform.agent_import as imports
    monkeypatch.setattr(imports, "verify_submission", lambda body: {"declarative_ui": body.declarative_ui, "tutorial": body.tutorial})
    body = declarative_payload()
    response = api.client.post("/games/declarative", json=body)
    assert response.status_code == 201, response.text
    first = response.json()
    assert first["renderer_type"] == "declarative"
    assert first["declarative_ui"] == body["declarative_ui"]
    assert first["tutorial_text"] == body["tutorial"]["text"]
    body["declarative_ui"]["piece_types"]["token"]["color"] = "#654321"
    second = api.client.post("/games/declarative", json=body)
    assert second.status_code == 201, second.text
    assert second.json()["version"] == 2
    pinned = api.client.get(f"/games/{first['id']}/versions/1").json()
    assert pinned["declarative_ui"]["piece_types"]["token"]["color"] == "#123456"
    assert api.client.get("/games").json()[0]["renderer_type"] == "declarative"
    assert "declarative_ui" not in api.client.get("/games").json()[0]


def test_prepare_renders_verified_player_and_spectator_views(monkeypatch):
    body = GameImport.model_validate(declarative_payload())
    # Preserve real artifact/translation/render checks while avoiding another
    # full eight-second random walk (covered by the existing import suite).
    from game_platform import game_checks
    monkeypatch.setattr(game_checks, "run_checks", lambda *args, **kwargs: {})
    package = prepare(body)
    assert package["declarative_ui"] == body.declarative_ui
    broken = declarative_payload()
    broken["declarative_ui"]["ui_code"] = "const gameUI={reduce(m){return {scene:{pieces:[{id:'bad',type:'missing',board:'board',position:{cell:'0'}}]}}}}"
    from game_platform.service import InvalidRequestError
    with pytest.raises(InvalidRequestError, match="piece type"):
        prepare(GameImport.model_validate(broken))


def test_declarative_game_requires_full_query_store_trace_flow_and_retests_changes():
    from game_platform import game_traces as traces
    from game_platform.service import InvalidRequestError
    from game_platform.tests.fake_firestore import FakeClient, query_store
    from game_platform.tests.test_game_traces import SECRET, complete_run, submit

    store = query_store("declarative-traces", FakeClient())
    class Platform:
        _store = store

    request = declarative_payload()
    request["game_addition_request_id_and_secret"] = SECRET
    body = GameImport.model_validate(request)
    with pytest.raises(InvalidRequestError, match="no test run"):
        traces.assert_complete(Platform(), body)
    row = submit(store, body)
    with pytest.raises(InvalidRequestError, match="step 2"):
        traces.assert_complete(Platform(), body)
    complete_run(store, body, row["id"])
    traces.assert_complete(Platform(), body)
    # The actual storage path canonicalizes object keys. Normalization must
    # regenerate exactly the same host and hash when authors resume the flow.
    loaded = GameImport.model_validate(traces.load_submission_body(store, row))
    assert loaded.client_code == body.client_code
    assert traces.inputs_hash(loaded.model_dump()) == row["inputs_hash"]
    traces.assert_complete(Platform(), loaded)
    changed = loaded.model_dump()
    changed.pop("client_code")
    changed["declarative_ui"]["piece_types"]["token"]["color"] = "#abcdef"
    with pytest.raises(InvalidRequestError, match="does not match"):
        traces.assert_complete(Platform(), GameImport.model_validate(changed))
