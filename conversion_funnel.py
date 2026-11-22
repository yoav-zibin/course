"""Permanent conversion evidence, separate from expiring lobby reservations.

Only internal IDs and event timestamps belong here. Never copy account profiles,
credentials, network addresses, or request headers into historical analytics.
All mutations run inside the caller's ordinary store transaction.
"""

import datetime as dt
import hashlib
import json
import re
import secrets


def timestamp(value):
    return value.isoformat() if isinstance(value, dt.datetime) else value


def visitor(value):
    return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{8,128}", value) else None


def record_event(store, event, *, at, identity=None, **fields):
    identity = identity or secrets.token_hex(16)
    existing = store.get_analytics("funnel_events", identity)
    if existing is not None:
        return existing
    row = {"id": identity, "event": event, "occurred_at": timestamp(at),
           **{key: value for key, value in fields.items() if value is not None}}
    if "visitor_id" in row:
        row["visitor_id"] = visitor(row["visitor_id"])
        if row["visitor_id"] is None:
            del row["visitor_id"]
    store.put_analytics("funnel_events", identity, row)
    _count_event(store, row)
    return row


def allocation_id(invite):
    # Stable fallback for allocations made before permanent history existed.
    return invite.allocation_id or f"legacy:{invite.token}:{timestamp(invite.created_at)}"


def archive_invite(store, invite, *, at=None, event=None):
    identity = allocation_id(invite)
    prior = store.get_analytics("invite_history", identity) or {}
    row = {**prior, "id": identity, "token": invite.token,
           "match_id": invite.match_id, "owner_user_id": prior.get("owner_user_id", invite.created_by_user_id),
           "created_at": timestamp(invite.created_at), "expires_at": timestamp(invite.expires_at),
           "views": invite.views, "revoked": invite.revoked,
           "acceptances": [{"user_id": item.user_id, "accepted_at": timestamp(item.accepted_at),
                            "signed_up": item.signed_up} for item in invite.acceptances]}
    if invite.revoked:
        row.setdefault("revoked_at", timestamp(at or dt.datetime.now(dt.timezone.utc)))
    if event:
        row.setdefault("released_at", timestamp(at or dt.datetime.now(dt.timezone.utc)))
        row.setdefault("release_reason", event)
    store.put_analytics("invite_history", identity, row)
    return row


def link_opened(store, match, *, at, user_id=None, visitor_id=None, invite=None):
    if match.effective_match_kind != "multiplayer":
        return
    record_event(store, "link_opened", at=at, match_id=match.id,
                 owner_user_id=match.owner_user_id, user_id=user_id, visitor_id=visitor_id,
                 link_kind="invite" if invite else "match",
                 invite_allocation_id=allocation_id(invite) if invite else None)


def _scope_id(owner_user_id=None, match_id=None):
    source = json.dumps([owner_user_id, match_id], separators=(",", ":"))
    return "scope:" + hashlib.sha256(source.encode()).hexdigest()


def _count_event(store, event):
    """Small transactional counters and distinct markers; no reporting scans."""
    owner, match = event.get("owner_user_id"), event.get("match_id")
    scopes = {(None, None)}
    if owner:
        scopes.add((owner, None))
    if match:
        scopes.add((None, match))
    if owner and match:
        scopes.add((owner, match))
    for owner_id, match_id in sorted(scopes, key=str):
        identity = _scope_id(owner_id, match_id)
        total = store.get_analytics("funnel_totals", identity) or {
            "id": identity, "owner_user_id": owner_id, "match_id": match_id,
            "events": {}, "distinct_accounts": {}, "distinct_visitors": {}}
        stage = event["event"]
        total["events"][stage] = total["events"].get(stage, 0) + 1
        accounts = {event["user_id"]} if event.get("user_id") else set()
        if stage in {"match_started", "match_completed", "match_deleted"}:
            accounts.update(event.get("participant_user_ids", []))
        dimensions = (("distinct_accounts", accounts),
                      ("distinct_visitors", {event["visitor_id"]} if event.get("visitor_id") else set()))
        for dimension, actors in dimensions:
            for actor in sorted(actors):
                source = json.dumps([identity, stage, dimension, actor], separators=(",", ":"))
                marker = "distinct:" + hashlib.sha256(source.encode()).hexdigest()
                if store.get_analytics("funnel_totals", marker) is None:
                    store.put_analytics("funnel_totals", marker, {"id": marker, "seen": True})
                    total[dimension][stage] = total[dimension].get(stage, 0) + 1
        store.put_analytics("funnel_totals", identity, total)


def summary(store, *, owner_user_id=None, match_id=None):
    row = store.get_analytics("funnel_totals", _scope_id(owner_user_id, match_id)) or {}
    return {key: row.get(key, {}) for key in ("events", "distinct_accounts", "distinct_visitors")}
