"""Bounded compatibility metadata for account purges of pre-feature records.

Only query headers change. Game/match JSON, move history, revisions, balances and
counters are preserved. A durable cursor resumes across hourly runs; no users
collection is enumerated. New writers already maintain these associations.
"""

import json
from urllib.parse import parse_qs, urlsplit

KINDS = ("matches", "outbox", "push_receipts", "requests", "matchmaking")
CHECKPOINT = "account-deletion-metadata-v1"


def _ids(values):
    return {value for value in values if isinstance(value, str) and value}


def _payload(row):
    value = row.get("json")
    return json.loads(value) if isinstance(value, str) else {}


def _match_ids(row):
    payload = _payload(row)
    return _ids([
        row.get("owner_user_id"), payload.get("owner_user_id"),
        *row.get("participants", ()), *row.get("historical_participants", ()),
        *payload.get("hidden_for_user_ids", ()),
        *(seat.get("user_id") for seat in payload.get("seats", ())),
        *(timeout.get("user_id") for timeout in payload.get("timeouts", ())),
        *(move.get("made_by_user_id") for move in payload.get("moves", ())),
    ])


def _outbox_metadata(row):
    payload = _payload(row)
    subscription = payload.get("subscription") or {}
    result = {}
    user_id = row.get("user_id") or subscription.get("user_id") or payload.get("user_id")
    if isinstance(user_id, str) and user_id:
        result["user_id"] = user_id
    match_id = row.get("match_id")
    if not match_id:
        url = payload.get("url")
        if isinstance(url, str):
            parsed = urlsplit(url)
            for part in (parsed.fragment, parsed.query):
                query = parse_qs(part)
                match_id = (query.get("match") or query.get("rematch") or query.get("replay")
                            or query.get("match_id") or [None])[0]
                if match_id:
                    break
    if isinstance(match_id, str) and match_id:
        result["match_id"] = match_id
    return result


def _step(store, checkpoint):
    state = store.raw_get(checkpoint) or {"stage": 0}
    if state.get("complete"):
        return False
    stage = state["stage"]
    if stage >= len(KINDS):
        store.raw_put(checkpoint, {"complete": True, "stage": stage})
        return False
    kind = KINDS[stage]
    if kind == "matches" and state.get("match_doc"):
        ref = store.collection(kind).document(state["match_doc"])
        row = store.raw_get(ref)
        doc_id = ref.id
        if row is None:
            store.raw_put(checkpoint, {"stage": stage, "last_doc": doc_id})
            return True
    else:
        docs = store._query(kind, limit=1, after=state.get("last_doc"))
        if not docs:
            store.raw_put(checkpoint, {"stage": stage + 1})
            return True
        ref, doc_id = docs[0].reference, docs[0].id
        # Register this header in the transactional read set as well as the query.
        row = store.raw_get(ref)
    if row.get("deletion_metadata_version") == 1:
        store.raw_put(checkpoint, {"stage": stage, "last_doc": doc_id})
        return True
    if kind == "matches":
        participants = _match_ids(row)
        query = ref.collection("moves").order_by("__name__")
        if state.get("move_after"):
            query = query.start_after({"__name__": ref.collection("moves").document(state["move_after"])})
        moves = list(query.limit(100).stream(transaction=store._local.uow["tx"]))
        for move in moves:
            participants.update(_ids([_payload(move.to_dict()).get("made_by_user_id")]))
        update = {**row, "historical_participants": sorted(participants)}
        if len(moves) == 100:
            next_state = {"stage": stage, "match_doc": doc_id, "move_after": moves[-1].id}
        else:
            update["deletion_metadata_version"] = 1
            next_state = {"stage": stage, "last_doc": doc_id}
    else:
        update = {**row, "deletion_metadata_version": 1}
        if kind == "outbox":
            update.update(_outbox_metadata(row))
        # Old hashed idempotency/matchmaking keys do not reveal the caller.
        # Their existing match_id provides the deletion association instead.
        next_state = {"stage": stage, "last_doc": doc_id}
    store.raw_put(ref, update)
    store.raw_put(checkpoint, next_state)
    return True


def backfill_account_deletion_metadata(store, *, max_steps=1000):
    if not 1 <= max_steps <= 10000:
        raise ValueError("max_steps must be between 1 and 10000")
    from game_platform.account_deletion import _maintenance

    checkpoint = store.ref("migration", CHECKPOINT)
    processed = 0
    while processed < max_steps:
        with store.atomic(), _maintenance(store):
            advanced = _step(store, checkpoint)
            complete = bool((store.raw_get(checkpoint) or {}).get("complete"))
        if advanced:
            processed += 1
        if complete:
            return {"complete": True, "processed": processed}
    return {"complete": False, "processed": processed}
