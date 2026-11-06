"""Private, bounded recordings for the browser game test matrix."""

import base64
import datetime as dt
import json
import uuid
import zlib
from dataclasses import replace

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from game_platform.models import GameTestSession

MAX_RECORDING_BYTES = 4_000_000
MAX_STORED_BYTES = 650_000


class Recording(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client_code: str = Field(min_length=1, max_length=200_000)
    server_code: str = Field(min_length=1, max_length=200_000)
    scenarios: list[dict[str, JsonValue]] = Field(max_length=110)
    events: list[dict[str, JsonValue]] = Field(max_length=5000)


class SaveRecording(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    recording: Recording


async def _body(request: Request) -> SaveRecording:
    if request.headers.get("content-type", "").split(";")[0].lower() != "application/json":
        raise HTTPException(415, "Use application/json")
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise HTTPException(415, "Compressed bodies are not supported")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_RECORDING_BYTES:
            raise HTTPException(413, "Recording exceeds 4000000 bytes")
    try:
        body = SaveRecording.model_validate_json(raw)
    except ValidationError as exc:
        raise HTTPException(422, "Invalid recording") from exc
    return body


def _pack(recording: Recording) -> str:
    data = recording.model_dump_json().encode("utf-8")
    if len(data) > MAX_RECORDING_BYTES:
        raise HTTPException(413, "Recording exceeds 4000000 bytes")
    packed = base64.b64encode(zlib.compress(data)).decode("ascii")
    if len(packed) > MAX_STORED_BYTES:
        raise HTTPException(413, "Recording is too large to store; start a new session")
    return packed


def _unpack(data: str) -> dict:
    return json.loads(zlib.decompress(base64.b64decode(data, validate=True)))


def make_router(platform_dependency, caller_dependency):
    router = APIRouter()

    @router.post("/game-test-sessions", status_code=201)
    async def create(request: Request, platform=Depends(platform_dependency),
                     caller=Depends(caller_dependency)):
        body = await _body(request)
        if body.revision != 0:
            raise HTTPException(422, "New recordings require revision 0")
        now = dt.datetime.now(dt.timezone.utc)
        session = GameTestSession(id=uuid.uuid4().hex, owner_user_id=caller,
                                  created_at=now, updated_at=now, revision=1,
                                  data=_pack(body.recording))
        with platform._lock:
            platform._store.put_game_test_session(session)
        return {"id": session.id, "revision": session.revision}

    @router.get("/game-test-sessions")
    def list_sessions(platform=Depends(platform_dependency), caller=Depends(caller_dependency),
                      cursor: str | None = None):
        store = platform._store
        with platform._lock:
            if getattr(store, "scalable", False):
                try:
                    page = store.page("game_test_sessions", filters=[("owner_user_id", "==", caller)],
                                      limit=50, cursor=cursor, scope=caller)
                except ValueError as exc:
                    raise HTTPException(400, str(exc)) from exc
                rows, next_cursor = page.items, page.next_cursor
            else:
                if cursor:
                    raise HTTPException(400, "Invalid cursor")
                rows, next_cursor = store.list_game_test_sessions(owner_user_id=caller), None
        return {"items": [{"id": s.id, "created_at": s.created_at,
                            "updated_at": s.updated_at, "revision": s.revision} for s in rows],
                "next_cursor": next_cursor}

    def owned(platform, caller, session_id):
        session = platform._store.get_game_test_session(session_id)
        if session is None or session.owner_user_id != caller:
            raise HTTPException(404, "Recording not found")
        return session

    @router.get("/game-test-sessions/{session_id}")
    def get_session(session_id: str, platform=Depends(platform_dependency),
                    caller=Depends(caller_dependency)):
        with platform._lock:
            session = owned(platform, caller, session_id)
        return {"id": session.id, "revision": session.revision, "recording": _unpack(session.data)}

    @router.put("/game-test-sessions/{session_id}")
    async def update(session_id: str, request: Request, platform=Depends(platform_dependency),
                     caller=Depends(caller_dependency)):
        body = await _body(request)
        with platform._lock:
            session = owned(platform, caller, session_id)
            if session.revision != body.revision:
                raise HTTPException(409, "Recording changed; reload before saving")
            session = replace(session, data=_pack(body.recording),
                              revision=session.revision + 1,
                              updated_at=dt.datetime.now(dt.timezone.utc))
            platform._store.put_game_test_session(session)
        return {"id": session.id, "revision": session.revision}

    @router.delete("/game-test-sessions/{session_id}", status_code=204)
    def delete(session_id: str, platform=Depends(platform_dependency),
               caller=Depends(caller_dependency)):
        with platform._lock:
            owned(platform, caller, session_id)
            platform._store.delete_game_test_session(session_id)

    return router
