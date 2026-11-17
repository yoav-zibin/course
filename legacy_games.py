"""Remove HTML-game matches while preserving their game source for migration.

The query-store migration checkpoints every bounded transaction. It runs before
HTTP traffic and workers start, and never invokes the retired games' rules.
"""

from __future__ import annotations

import datetime as dt
import json
from urllib.parse import parse_qs, urlsplit

RUN_ID = "retire-html-game-matches-v1"
RELATED_KINDS = ("invites", "jobs", "failed_jobs", "matchmaking", "requests", "outbox")
# Move and job documents bypass the model-record 800 KB limit and may approach
# Firestore's 1 MiB document limit. Eight deletions leave transaction room for
# checkpoints and index entries below the 10 MiB request limit.
DELETE_PAGE_SIZE = 8


def retire_html_matches(platform, *, max_steps=None):
    """Delete retired matches, refund their held stakes, and resume on restart.

    ``max_steps`` permits bounded maintenance and interruption tests. Normal
    startup finishes the job before serving or resuming computer moves.
    """
    if max_steps is not None and (type(max_steps) is not int or max_steps < 1):
        raise ValueError("max_steps must be a positive integer")
    store = platform._store
    if not getattr(store, "scalable", False):
        removed = 0
        with platform._lock:
            for match in store.list_all_matches():
                game = store.get_game_version(match.game_id, match.game_version)
                if game is not None and not game.is_declarative:
                    platform._delete_match_and_invites(match.id)
                    removed += 1
        flush = getattr(store, "flush", None)
        if flush:
            flush()
        return {"complete": True, "matches_deleted": removed}

    progress = store.ref("migration", RUN_ID)
    steps = 0
    while max_steps is None or steps < max_steps:
        with store.atomic():
            job = store.raw_get(progress) or {
                "stage": "matches", "last_id": None, "matches_deleted": 0,
                "started_at": dt.datetime.now(dt.timezone.utc),
            }
            if job.get("complete"):
                return job
            stage = job["stage"]
            if stage == "matches":
                _match_step(platform, store, job)
            elif stage == "moves":
                _moves_step(store, job)
            elif stage == "markers":
                _marker_step(store, job)
            else:
                _related_step(store, job)
            store.raw_put(progress, job)
        steps += 1
    return job


def _match_step(platform, store, job):
    docs = store._query("matches", limit=1, after=job.get("last_id"))
    if not docs:
        job.update(stage=RELATED_KINDS[0], last_id=None)
        return
    doc = docs[0]
    row = doc.to_dict()
    match = store._decode("matches", row, doc.reference, detail=False)
    job["last_id"] = doc.id
    if match is None:
        return
    game = store.get_game_version_without_code(match.game_id, match.game_version)
    if game is None or game.is_declarative:
        return
    # Refund and tombstone commit with the checkpoint. A retry never refunds
    # twice, including a crash before the match's child documents are removed.
    platform._refund_held_pot(match)
    store.delete_match(match.id)
    store.raw_put(_retired_match_ref(store, match.id), {"match_id": match.id})
    job.update(stage="moves", match_id=match.id)
    job["matches_deleted"] += 1


def _moves_step(store, job):
    ref = store.ref("matches", job["match_id"])
    docs = list(ref.collection("moves").order_by("__name__").limit(DELETE_PAGE_SIZE)
                .stream(transaction=store._local.uow["tx"]))
    for doc in docs:
        store.raw_put(doc.reference, None)
    if not docs:
        store.raw_put(ref, None)
        store.raw_put(store.ref("cleanup", "matches:" + job["match_id"]), None)
        job.update(stage="matches")
        job.pop("match_id", None)


def _retired_match_ref(store, match_id):
    from game_platform.query_store import key

    return store.ref("migration", RUN_ID).collection("matches").document(key(match_id))


def _marker_step(store, job):
    docs = list(store.ref("migration", RUN_ID).collection("matches")
                .order_by("__name__").limit(DELETE_PAGE_SIZE)
                .stream(transaction=store._local.uow["tx"]))
    for doc in docs:
        store.raw_put(doc.reference, None)
    if not docs:
        job.update(complete=True, finished_at=dt.datetime.now(dt.timezone.utc))


def _related_step(store, job):
    kind = job["stage"]
    docs = store._query(kind, limit=DELETE_PAGE_SIZE, after=job.get("last_id"))
    for doc in docs:
        row = doc.to_dict()
        if not row or row.get("tombstone"):
            continue
        record = store._decode(kind, row, doc.reference) if kind == "invites" else None
        match_id = record.match_id if record else row.get("match_id")
        if kind == "outbox" and not match_id:
            # Old outbox records only store the serialized click destination.
            message = json.loads(row["json"])
            match_id = parse_qs(urlsplit(message.get("url", "")).fragment).get("match", [None])[0]
        if match_id and store.raw_get(_retired_match_ref(store, match_id)):
            if record:
                store._update_counts(kind, record.token, row, None)
            store.raw_put(doc.reference, None)
    if docs:
        job["last_id"] = docs[-1].id
    if len(docs) < DELETE_PAGE_SIZE:
        index = RELATED_KINDS.index(kind) + 1
        if index == len(RELATED_KINDS):
            job.update(stage="markers", last_id=None)
        else:
            job.update(stage=RELATED_KINDS[index], last_id=None)
