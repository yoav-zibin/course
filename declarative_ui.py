"""Portable presentation reducers: JSON in, JSON out, in a bounded QuickJS VM.

The authoritative rules remain GameLogic. Presentation gets only the viewer's
state_changed message and local interaction state; it has no platform bindings.
The schema is also the public native-renderer contract.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
from pathlib import Path
from urllib.parse import urlsplit

import quickjs
from fastapi import Request
from jsonschema import Draft202012Validator
from referencing import Registry

SCHEMA_PATH = Path(__file__).with_name("schemas") / "declarative-ui.schema.json"
SCHEMA = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
MAX_SPEC_BYTES = 350_000
MAX_MESSAGE_BYTES = 900_000
MAX_RESULT_BYTES = 256_000
TIME_LIMIT_SECONDS = 0.05
MEMORY_LIMIT_BYTES = 16 * 1024 * 1024
EXAMPLE_IDS = ("tictactoe", "connect4", "reversi", "nim", "mancala", "gomoku", "hex", "domineering", "memory", "pig", "backgammon")
EXAMPLE_DIRECTORY = Path(__file__).with_name("games") / "declarative"
_SPEC_VALIDATOR = Draft202012Validator(SCHEMA, registry=Registry())
_RESPONSE_VALIDATOR = Draft202012Validator(
    {"$ref": "#/$defs/response", "$defs": SCHEMA["$defs"]}, registry=Registry()
)
_MESSAGE_VALIDATOR = Draft202012Validator(
    {"$ref": "#/$defs/message", "$defs": SCHEMA["$defs"]}, registry=Registry()
)


class DeclarativeUIError(ValueError):
    """An invalid package, message, reducer or scene, safe to report to an author."""


def _encoded(value, limit, label):
    stack = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        if depth > 64:
            raise DeclarativeUIError(f"{label} must be at most 64 levels deep")
        if isinstance(item, dict):
            stack.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            stack.extend((child, depth + 1) for child in item)
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError, RecursionError) as exc:
        raise DeclarativeUIError(f"{label} must contain finite JSON values") from exc
    if len(encoded.encode("utf-8")) > limit:
        raise DeclarativeUIError(f"{label} exceeds {limit} UTF-8 bytes")
    return encoded


def _validate(validator, value, label):
    error = next(validator.iter_errors(value), None)
    if error:
        location = ".".join(map(str, error.absolute_path)) or "$"
        # Schema errors can include arbitrary author code or asset data. Report
        # the location and keyword rather than reflecting their contents.
        raise DeclarativeUIError(f"{label} at {location} violates {error.validator}")


def _unique(items, label):
    ids = [item["id"] for item in items]
    if len(set(ids)) != len(ids):
        raise DeclarativeUIError(f"{label} IDs must be unique")
    return set(ids)


def _asset_reference(name, assets):
    if name is not None and name not in assets:
        raise DeclarativeUIError("Unknown asset reference")


def validate_spec(spec):
    """Validate shape, topology, references and inline image data without I/O."""
    _encoded(spec, MAX_SPEC_BYTES, "Declarative package")
    _validate(_SPEC_VALIDATOR, spec, "Declarative package")
    boards = spec["boards"]
    _unique(boards, "Board")
    assets = spec.get("assets", {})
    for asset in assets.values():
        uri, media_type = asset["uri"], asset["media_type"]
        if uri.startswith("https://"):
            try:
                parsed = urlsplit(uri)
                if not parsed.hostname or parsed.username or parsed.password:
                    raise ValueError("invalid asset URL")
                _ = parsed.port
            except ValueError as exc:
                raise DeclarativeUIError("Asset URL must be HTTPS without credentials") from exc
            continue
        prefix = "data:" + media_type + ";base64,"
        if not uri.startswith(prefix):
            raise DeclarativeUIError("Inline asset URI must match its media_type")
        try:
            data = base64.b64decode(uri[len(prefix):], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise DeclarativeUIError("Inline asset must be valid base64") from exc
        if len(data) > 120_000:
            raise DeclarativeUIError("Each inline asset must be at most 120000 bytes")
        if media_type == "image/png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
            raise DeclarativeUIError("PNG asset has an invalid signature")
        if media_type == "image/jpeg" and not data.startswith(b"\xff\xd8\xff"):
            raise DeclarativeUIError("JPEG asset has an invalid signature")
        if media_type == "image/svg+xml":
            import re
            import xml.etree.ElementTree as ET
            from game_platform.game_artifacts import validate_image
            try:
                svg = data.decode("utf-8")
                validate_image({"caption": "Declarative asset", "svg": svg})
                if re.search(r"<\?(?!xml\s)|url\(\s*(?!#[\w-]+\s*\))", svg, re.I):
                    raise ValueError("SVG processing instructions or external resources")
                for element in ET.fromstring(svg).iter():
                    if element.tag.startswith("{") and not element.tag.startswith("{http://www.w3.org/2000/svg}"):
                        raise ValueError("Foreign SVG namespace")
                    if any(key.split("}")[-1].lower().startswith("on") for key in element.attrib):
                        raise ValueError("SVG event handlers")
            except Exception as exc:
                raise DeclarativeUIError("SVG asset must use the platform's inert SVG subset") from exc
    for board in boards:
        _asset_reference(board.get("background_asset"), assets)
        cells = _unique(board.get("cells", []), "Cell")
        if board["kind"] in ("hex", "graph", "track") and not cells:
            raise DeclarativeUIError("Hex, graph and track boards require nonempty cells")
        if board["kind"] == "grid" and board["rows"] * board["columns"] > 2048:
            raise DeclarativeUIError("A grid may have at most 2048 cells")
        for link in board.get("links", []):
            if link["from"] not in cells or link["to"] not in cells:
                raise DeclarativeUIError("Board links must reference existing explicit cells")
    for piece_type in spec["piece_types"].values():
        _asset_reference(piece_type.get("asset"), assets)
        _asset_reference(piece_type.get("back_asset"), assets)
    return spec


def validate_response(spec, response):
    _encoded(response, MAX_RESULT_BYTES, "Reducer response")
    _validate(_RESPONSE_VALIDATOR, response, "Reducer response")
    scene = response["scene"]
    ids = set()
    for kind in ("pieces", "targets", "labels", "controls", "paths"):
        group = _unique(scene.get(kind, []), kind.capitalize())
        if group & ids:
            raise DeclarativeUIError("Scene IDs must be unique across all element kinds")
        ids.update(group)
    boards = {board["id"]: board for board in spec["boards"]}
    assets = spec.get("assets", {})
    targets = {target["id"]: target for target in scene.get("targets", [])}
    for item in [*scene.get("pieces", []), *scene.get("targets", [])]:
        board = boards.get(item["board"])
        if board is None:
            raise DeclarativeUIError("Scene references an unknown board")
        position = item["position"]
        if "cell" in position:
            cell = position["cell"]
            if board.get("cells"):
                exists = any(other["id"] == cell for other in board["cells"])
            elif board["kind"] == "grid":
                exists = cell.isascii() and cell.isdigit() and str(int(cell)) == cell and int(cell) < board["rows"] * board["columns"]
            else:
                exists = False
            if not exists:
                raise DeclarativeUIError("Scene references an unknown board cell")
    for piece in scene.get("pieces", []):
        if piece["type"] not in spec["piece_types"]:
            raise DeclarativeUIError("Scene references an unknown piece type")
        _asset_reference(piece.get("asset"), assets)
        for target in piece.get("move_targets", []):
            if target not in targets:
                raise DeclarativeUIError("Piece move_targets must reference scene targets")
    for control in scene.get("controls", []):
        if control["kind"] == "choice" and not control.get("options"):
            raise DeclarativeUIError("Choice controls require nonempty options")
        if "min" in control and "max" in control and control["min"] > control["max"]:
            raise DeclarativeUIError("Control min must not exceed max")
    return response


class DeclarativeLogic:
    """Stateless presentation VM; local state crosses the boundary only as JSON."""

    def __init__(self, spec):
        validate_spec(spec)
        # Detach caller mutations so validation and execution use the same source.
        self.spec = json.loads(_encoded(spec, MAX_SPEC_BYTES, "Declarative package"))

    def reduce(self, message, local_state=None):
        message_json = _encoded(message, MAX_MESSAGE_BYTES, "Reducer message")
        _validate(_MESSAGE_VALIDATOR, message, "Reducer message")
        local_json = _encoded(local_state, MAX_RESULT_BYTES, "Local state")
        context = quickjs.Context()
        context.set_memory_limit(MEMORY_LIMIT_BYTES)
        context.set_time_limit(TIME_LIMIT_SECONDS)
        context.set_max_stack_size(256 * 1024)
        try:
            context.eval("Math.random = function(){throw new Error('randomness is unavailable in presentation')}; Date = undefined;")
            context.eval(self.spec["ui_code"])
            result = context.eval(
                "JSON.stringify(gameUI.reduce(JSON.parse(" + json.dumps(message_json) + "),JSON.parse(" + json.dumps(local_json) + ")))"
            )
            if not isinstance(result, str) or len(result.encode("utf-8")) > MAX_RESULT_BYTES:
                raise DeclarativeUIError("Reducer must return a JSON response under 256000 bytes")
            response = json.loads(result)
        except (quickjs.JSException, ValueError, TypeError, RecursionError) as exc:
            if isinstance(exc, DeclarativeUIError):
                raise
            raise DeclarativeUIError("Presentation reducer failed or exceeded its time/memory limit") from exc
        validate_response(self.spec, response)
        if "make_move" in response:
            state = message if message["type"] == "state_changed" else message.get("state_changed", {})
            if (message["type"] != "ui_event" or state.get("acting_for_player_index") is None
                    or state.get("status") != "ongoing" or state.get("replay") is not None):
                raise DeclarativeUIError("Only a current player UI event may emit make_move")
        return response


def client_document(spec):
    """Platform-owned compatibility host for existing test/practice clients."""
    return _client_document(spec, asset_query="?v=5")


def _client_document(spec, *, asset_query):
    def data(value):
        # Recorded test payloads canonicalize object-key order. Keep the generated
        # host byte-identical after a stored submission is loaded again.
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).replace("<", "\\u003c")
    return (
        '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<link rel="stylesheet" href="/static/declarative-ui.css' + asset_query + '"><div id="declarative-game"></div>'
        '<script type="application/json" id="i18n-strings">' + data(spec.get("strings", {})) + '</script>'
        '<script type="application/json" id="declarative-spec">' + data(spec) + '</script>'
        '<script src="/static/declarative-ui.js' + asset_query + '"></script><script>'
        'const host=DeclarativeUI.mount(document.getElementById("declarative-game"),'
        'JSON.parse(document.getElementById("declarative-spec").textContent),'
        '{onMove:move=>parent.postMessage({type:"make_move",move},"*"),'
        'onReady:()=>parent.postMessage({type:"game_ready"},"*")});'
        'addEventListener("message",event=>{if(event.source===parent&&event.data?.type==="state_changed")host.send(event.data)});'
        '</script>'
    )


def accepted_platform_host(spec, code):
    """Exact current/legacy trusted templates, preserving recorded payload hashes.

    New submissions without client_code use the current versioned asset URLs.
    Stored submissions keep their known v2/v3/v4 or original unversioned host
    byte-for-byte so recorded publication evidence and pinned code remain valid.
    """
    return code in (
        client_document(spec),
        _client_document(spec, asset_query="?v=4"),
        _client_document(spec, asset_query="?v=3"),
        _client_document(spec, asset_query="?v=2"),
        _client_document(spec, asset_query=""),
    )


def embedded_spec(code):
    """Recognize only an exact generated host, never arbitrary HTML with a marker."""
    import re
    match = re.search(r'<script type="application/json" id="declarative-spec">(.*?)</script>', code, re.S)
    if match:
        try:
            spec = json.loads(match.group(1))
            if accepted_platform_host(spec, code):
                return spec
        except (ValueError, TypeError, AttributeError):
            pass
    return None


def localization_errors(spec, server_code):
    from game_platform.game_text import server_text_problems
    return server_text_problems(spec.get("strings", {}), server_code)


def verify_example_presentations(spec, cases):
    """Render the verified views for mover and other/spectator before and after."""
    logic = DeclarativeLogic(spec)
    for case in cases:
        roster = case["ctx"]["players"]
        players = [{"player_index": i, "player_id": player["id"], "kind": player["kind"], "name": player.get("display_name", "")} for i, player in enumerate(roster)]
        for after in (False, True):
            prefix = "expected_" if after else ""
            turn = case.get("expected_turn") if after else [case["player_id"]]
            indices = None if turn is None else [i for i, player in enumerate(roster) if player["id"] in turn]
            for suffix, viewer in (("mover", case["player_id"]), ("other", case.get("other_player_id"))):
                view = case[prefix + "view_of_" + suffix]
                seat = next((i for i, player in enumerate(roster) if player["id"] == viewer), None)
                message = {"type": "state_changed", "state": view, "view": view, "players": players, "turn_of_player_indices": indices,
                           "status": "over" if turn is None else "ongoing", "end_reason": "finished" if turn is None else None,
                           "move_count": case["ctx"].get("move_count", 0) + int(after), "my_player_index": seat,
                           "acting_for_player_index": seat if indices and seat in indices else None,
                           "token_pot": case["ctx"].get("pot", 0), "strings": spec.get("strings", {})}
                first = logic.reduce(message)
                if first != logic.reduce(message):
                    raise DeclarativeUIError("Presentation reducer must be deterministic")


async def _read_json(request):
    from fastapi import HTTPException
    if request.headers.get("content-type", "").split(";")[0].lower() != "application/json":
        raise HTTPException(415, "Use application/json")
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise HTTPException(415, "Compressed request bodies are not supported")
    raw_length = request.headers.get("content-length")
    if raw_length is not None:
        try:
            length = int(raw_length)
        except ValueError as exc:
            raise HTTPException(400, "Invalid Content-Length") from exc
        if length < 0:
            raise HTTPException(400, "Invalid Content-Length")
        if length > MAX_MESSAGE_BYTES:
            raise HTTPException(413, "Request exceeds 900000 bytes")
    data = bytearray()
    try:
        async with asyncio.timeout(15):
            async for chunk in request.stream():
                if len(data) + len(chunk) > MAX_MESSAGE_BYTES:
                    raise HTTPException(413, "Request exceeds 900000 bytes")
                data.extend(chunk)
    except TimeoutError as exc:
        raise HTTPException(408, "Upload exceeded the 15 second limit") from exc
    try:
        return json.loads(data)
    except (ValueError, UnicodeDecodeError, RecursionError) as exc:
        raise HTTPException(422, "Request must contain valid JSON") from exc


def make_router(caller_dependency):
    from fastapi import APIRouter, Depends, HTTPException, Request
    from starlette.concurrency import run_in_threadpool
    router = APIRouter()

    @router.get("/games/declarative/schema")
    def schema(caller=Depends(caller_dependency)):
        return SCHEMA

    @router.get("/games/declarative/examples")
    def examples(caller=Depends(caller_dependency)):
        result = []
        for kind in EXAMPLE_IDS:
            body = json.loads((EXAMPLE_DIRECTORY / (kind + ".json")).read_text(encoding="utf-8"))
            result.append({"id": kind, "name": body["name"], "description": body["description"],
                           "url": "/games/declarative/examples/" + kind})
        return {"examples": result}

    @router.get("/games/declarative/examples/{kind}")
    def example(kind: str, caller=Depends(caller_dependency)):
        if kind not in EXAMPLE_IDS:
            raise HTTPException(404, "Unknown declarative example")
        return json.loads((EXAMPLE_DIRECTORY / (kind + ".json")).read_text(encoding="utf-8"))

    @router.post("/games/declarative/validate")
    async def validate(request: Request, caller=Depends(caller_dependency)):
        slots = request.app.state.import_slots
        if not slots.acquire(blocking=False):
            raise HTTPException(429, "Validation capacity is busy", headers={"Retry-After": "15"})
        try:
            body = await _read_json(request)
            if not isinstance(body, dict) or set(body) - {"declarative_ui", "message", "local_state"} or not {"declarative_ui", "message"} <= set(body):
                raise HTTPException(422, "Expected declarative_ui, message and optional local_state")
            try:
                logic = await run_in_threadpool(DeclarativeLogic, body["declarative_ui"])
                return await run_in_threadpool(logic.reduce, body["message"], body.get("local_state"))
            except DeclarativeUIError as exc:
                raise HTTPException(422, str(exc)) from exc
        finally:
            slots.release()

    @router.post("/games/declarative/client")
    async def client(request: Request, caller=Depends(caller_dependency)):
        body = await _read_json(request)
        try:
            validate_spec(body)
            return {"client_code": client_document(body)}
        except DeclarativeUIError as exc:
            raise HTTPException(422, str(exc)) from exc

    return router
