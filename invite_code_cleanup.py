"""Daily, bounded reclamation of expired match invite codes.

The cursor is durable so a busy day's timeout resumes at the next page. Every
candidate is checked again in its own transaction: a code released and reused
after the page was read must never be removed from its new match.
"""

import argparse
import datetime as dt
import logging
import re
import time
from contextlib import ExitStack
from dataclasses import replace
from pathlib import Path

from game_platform.account_deletion_worker import bounded_int, open_store
from game_platform.config import load_config
from game_platform.observability import log_event, setup_logging
from game_platform.service import INVITE_CODE_CAPACITY as CODE_CAPACITY, INVITE_MAX_AGE as MAX_AGE

CHECKPOINT = "invite_code_cleanup"


def _release_candidate(store, token, now):
    with store.atomic():
        invite = store.get_invite(token)
        if invite is None:
            return False
        match = store.get_match(invite.match_id)
        short_code = re.fullmatch(r"[a-z]{4}", token) is not None
        expired = invite.created_at < now - MAX_AGE or (
            invite.expires_at is not None and invite.expires_at <= now)
        inactive = match is None or match.status != "waiting_for_players"
        detached = short_code and match is not None and match.invite_code != token
        if not (expired or inactive or detached or invite.revoked):
            return False
        if match is not None and match.invite_code == token:
            store.put_match(replace(match, invite_code=None))
        store.delete_invite(token)
        return True


def _checkpoint(store, cursor, now, *, complete):
    with store.atomic():
        ref = store.ref("meta", CHECKPOINT)
        current = store.raw_get(ref) or {}
        store.raw_put(ref, {**current, "after": cursor, "updated_at": now,
                           **({"last_completed_at": now} if complete else {})})


def capacity_report(store):
    """The 64 existing counter shards count current reservations, not views."""
    used = store.counts().get("invites_codes_total", 0)
    report = {"used": used, "capacity": CODE_CAPACITY,
              "used_fraction": used / CODE_CAPACITY}
    if used * 2 > CODE_CAPACITY:
        log_event("invite_code_capacity_high", level=logging.WARNING, alert="minor",
                  **report,
                  action="Reclaim invite codes more aggressively or increase code length")
    return report


def sweep(store, *, now=None, page_size=100, max_records=1_000_000,
          max_seconds=1800, clock=time.monotonic):
    """Reclaim invitations without enumerating matches or loading a collection."""
    if not 1 <= page_size <= 100:
        raise ValueError("page_size must be between 1 and 100")
    if max_records < 1 or max_seconds < 1:
        raise ValueError("cleanup budgets must be positive")
    now = now if now is not None else dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("invite cleanup requires a timezone-aware clock")
    deadline = clock() + max_seconds
    with store.atomic():
        after = (store.raw_get(store.ref("meta", CHECKPOINT)) or {}).get("after")
    result = {"scanned": 0, "released": 0, "conflicts": 0,
              "more_work_may_remain": True}
    from game_platform.service import ConflictError

    while result["scanned"] < max_records and clock() < deadline:
        limit = min(page_size, max_records-result["scanned"])
        # The ordinary query cache is unnecessary in a once-daily scan. Each
        # query is bounded and ordered by document ID, including tombstones.
        docs = store._run_query("invites", (), limit=limit, after=after,
                                transaction=None)
        for doc in docs:
            row = store._decode("invites", doc.to_dict(), doc.reference)
            if row is not None:
                try:
                    result["released"] += int(_release_candidate(store, row.token, now))
                except ConflictError:
                    # An active account purge or another API write owns the
                    # record. Never force a stale match write past its fence.
                    result["conflicts"] += 1
            result["scanned"] += 1
        after = docs[-1].id if docs else after
        if len(docs) < limit:
            result["more_work_may_remain"] = False
            after = None
        _checkpoint(store, after, now, complete=not result["more_work_may_remain"])
        if not result["more_work_may_remain"]:
            break
    result.update(capacity_report(store))
    if result["more_work_may_remain"] or result["conflicts"]:
        log_event("invite_code_cleanup_incomplete", level=logging.WARNING, alert="minor",
                  **result, action="Inspect the daily invite cleanup worker and resume its sweep")
    log_event("invite_code_cleanup_completed", **result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--page-size", type=bounded_int(1, 100), default=100)
    parser.add_argument("--max-records", type=bounded_int(1, 10_000_000), default=1_000_000)
    parser.add_argument("--max-seconds", type=bounded_int(1, 3000), default=1800)
    parser.add_argument("--check-config", action="store_true")
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        if not args.check_config:
            # The existing Ops Agent consumes this file and the existing minor
            # log policy sends capacity/cleanup alerts to configured channels.
            setup_logging(config.log_level, config.monitoring.log_format,
                          config.monitoring.log_file or "/var/log/game-platform/server.log")
        with ExitStack() as resources:
            client, store = open_store(config)
            resources.callback(client.close)
            resources.callback(store.close)
            if store.health() is not None:
                raise RuntimeError("Configured query storage is unavailable")
            if args.check_config:
                return 0
            sweep(store, page_size=args.page_size, max_records=args.max_records,
                  max_seconds=args.max_seconds)
        return 0
    except Exception as error:
        # Exception messages can contain private configuration or account data.
        log_event("invite_code_cleanup_failed", level=logging.ERROR, alert="major",
                  error_type=type(error).__name__, action="Inspect the daily invite cleanup worker")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
