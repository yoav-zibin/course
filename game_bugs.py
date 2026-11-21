"""Durable, private reports of defects in published server-side game logic.

The evidence contains hidden game state and random seeds. Only the master
password API exposes it; ordinary players must never receive these reports.
"""

import datetime as dt
import hashlib
import json
import uuid
from dataclasses import asdict
from typing import Literal

from game_platform.paging import decode_cursor, encode_cursor


def add_game_server_bug(store, *, game, function, error, match=None, evidence=None):
    """Add a defect independently of the game transaction that is failing.

    Callers supply the runtime's exact invocation evidence. Source and rules are
    snapshotted so a later publication or version deletion cannot erase the
    information needed to reproduce and review the defect.
    """
    report = evidence if evidence is not None else getattr(error, "bug_report", None)
    if report is None:
        return None  # InvalidMove and invalid caller inputs are not game defects.
    report = dict(report)
    report.update({
        "server_code": game.server_code,
        "game_schemas": game.game_schemas,
        "game_description": game.description,
        "game_rules": asdict(game.rules),
        "textual_rules": (game.import_package or {}).get("rules_text"),
        "unit_tests": (game.import_package or {}).get("unit_tests"),
        "server_code_sha256": hashlib.sha256((game.server_code or "").encode()).hexdigest(),
    })
    # Copy JSON containers before the caller can mutate them. JSON also preserves
    # arbitrarily large integer seeds without Firestore's signed-int64 coercion.
    report = json.loads(json.dumps(report, allow_nan=False))
    row = {
        "id": uuid.uuid4().hex,
        "game_id": game.id,
        "game_version": game.version,
        "game_name": game.name,
        "match_id": match.id if match is not None else None,
        "function": function,
        "kind": report.get("kind", "contract"),
        "message": str(error)[:2000],
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "examined": False,
        "examined_at": None,
        "review": None,
        "evidence": report,
    }
    store.put_game_server_bug(row)
    return row


def make_router(platform_dependency, master_dependency):
    from fastapi import APIRouter, Depends, HTTPException, Query, Request
    from pydantic import BaseModel, Field, field_validator

    router = APIRouter(include_in_schema=False,
                       dependencies=[Depends(master_dependency)])

    class ReviewIn(BaseModel):
        outcome: Literal["fixed", "escalated", "obsolete"]
        notes: str = Field(min_length=1, max_length=20000)
        fix_game_version: int | None = Field(default=None, ge=1)
        fix_commit: str | None = Field(default=None, max_length=128)

        @field_validator("notes")
        @classmethod
        def nonempty_notes(cls, value):
            if not value.strip():
                raise ValueError("review notes must explain the examination")
            return value.strip()

    @router.get("/game-server-bugs")
    def list_bugs(
        examined: bool | None = False,
        limit: int = Query(default=50, ge=1, le=100),
        cursor: str | None = None,
        platform=Depends(platform_dependency),
    ):
        store = platform._store
        scope = [getattr(store, "namespace", "local"), "game-server-bugs", examined]
        try:
            after = decode_cursor(scope, cursor)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        items, next_after = store.list_game_server_bugs(examined=examined, limit=limit, after=after)
        return {"items": items, "next_cursor": encode_cursor(scope, next_after) if next_after else None}

    @router.get("/game-server-bugs/{bug_id}")
    def get_bug(bug_id: str, platform=Depends(platform_dependency)):
        row = platform._store.get_game_server_bug(bug_id)
        if row is None:
            raise HTTPException(404, "no game server bug with that id")
        return row

    @router.post("/game-server-bugs/{bug_id}/examine")
    def examine_bug(bug_id: str, payload: ReviewIn, platform=Depends(platform_dependency)):
        review = payload.model_dump()
        bug = platform._store.get_game_server_bug(bug_id)
        if bug is None:
            raise HTTPException(404, "no game server bug with that id")
        if payload.outcome == "fixed" and not bug["examined"]:
            if payload.fix_game_version is None:
                raise HTTPException(422, "a fixed bug needs the verified published game version")
            if payload.fix_game_version <= bug["game_version"]:
                raise HTTPException(422, "a fix must be published as a newer game version")
            fixed = platform._store.get_game_version(bug["game_id"], payload.fix_game_version)
            if fixed is None or not fixed.published or fixed.deleted:
                raise HTTPException(422, "the fix game version must exist and be published")
            if fixed.server_code == bug["evidence"].get("server_code"):
                raise HTTPException(422, "the fix must change the reported server-side logic")
        try:
            row = platform._store.examine_game_server_bug(bug_id, review)
        except ValueError as error:
            raise HTTPException(409, str(error)) from error
        if row is None:
            raise HTTPException(404, "no game server bug with that id")
        return row

    return router
