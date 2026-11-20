"""Cancellable 24-hour account requests and bounded, resumable live purges.

The user, request and irreversible fence are read/written in the same unit of
work. A purge never uses a maintenance cursor over mutable records: it removes
the first matching record, checkpoints child cleanup, then queries again.
"""
import contextlib
import datetime as dt
import json
from dataclasses import replace
from urllib.parse import urlsplit

GRACE = dt.timedelta(hours=24)


def _now(platform, now=None):
    value = platform.now() if now is None else now
    if value.tzinfo is None:
        raise ValueError("account deletion requires a timezone-aware clock")
    return value.astimezone(dt.timezone.utc)


def request(platform, caller_id, *, confirmed):
    from game_platform.service import InvalidRequestError, ConflictError
    if confirmed is not True:
        raise InvalidRequestError("confirm account deletion before scheduling it")
    store = platform._store
    with platform._lock:
        user = platform._require_user(caller_id)
        if user.deletion_started_at is not None:
            raise ConflictError("account deletion has already started")
        if user.deletion_requested_at is not None:
            return user
        now = _now(platform)
        user = replace(user, deletion_requested_at=now,
                       deletion_scheduled_at=now + GRACE, updated_at=now)
        store.put_user(user)
        if getattr(store, "scalable", False):
            store.raw_put(store.ref("account_deletions", user.id), {
                "user_id": user.id, "requested_at": now, "due_at": now + GRACE,
                "started_at": None, "stage": 0, "account_index": 0,
            })
        return user


def cancel(platform, caller_id):
    from game_platform.service import ConflictError
    store = platform._store
    with platform._lock:
        user = platform._require_user(caller_id)
        if user.deletion_started_at is not None or (
            user.deletion_scheduled_at is not None
            and _now(platform) >= user.deletion_scheduled_at
        ):
            raise ConflictError("the cancellation period has ended")
        if user.deletion_requested_at is None:
            return user
        user = replace(user, deletion_requested_at=None,
                       deletion_scheduled_at=None, updated_at=_now(platform))
        store.put_user(user)
        if getattr(store, "scalable", False):
            # Reads the same request document as a competing purge claim.
            store.raw_put(store.ref("account_deletions", user.id), None)
        return user


@contextlib.contextmanager
def _maintenance(store):
    previous = getattr(store._local, "account_deletion_maintenance", False)
    store._local.account_deletion_maintenance = True
    try:
        yield
    finally:
        store._local.account_deletion_maintenance = previous


def _due(store, now, limit):
    from google.cloud.firestore_v1.base_query import FieldFilter
    # A single-field range query, not _query's document-name ordering (which
    # would require an unnecessary composite). No cached query decisions.
    return list(store.collection("account_deletions")
                .where(filter=FieldFilter("due_at", "<=", now))
                .order_by("due_at").limit(limit).stream())


def _claim(platform, ref, now):
    store = platform._store
    with store.atomic(), _maintenance(store):
        job = store.raw_get(ref)
        if not job or job["due_at"] > now:
            return False
        user = store.get_user(job["user_id"])
        if user is None:
            store.raw_put(ref, None)
            return False
        if job.get("started_at"):
            return False
        if (user.deletion_requested_at != job.get("requested_at")
                or user.deletion_scheduled_at is None
                or user.deletion_scheduled_at > now):
            store.raw_put(ref, None)
            return False
        store.put_user(replace(user, deletion_started_at=now,
                               notifications_enabled=False, notifications=(),
                               updated_at=now))
        # Deliberately retain only an irreversible boolean in a SHA256-keyed
        # fence after the account itself is physically removed.
        store.raw_put(store.ref("account_deletion_fences", user.id), {"deleted": True})
        store.raw_put(ref, {**job, "started_at": now,
                           "accounts": list(dict.fromkeys((user.id, *user.replaced_user_ids))),
                           "stage": 0, "account_index": 0})
        return True


# Field-filtered phases, one matching record per transaction. Re-querying from
# the start avoids skipping rows created before a saved document-name cursor.
_PHASES = (
    ("matches", "historical_participants", "array_contains"),
    ("matches", "participants", "array_contains"),
    ("matches", "owner_user_id", "=="),
    ("push_subscriptions", "user_id", "=="),
    ("invites", "participants", "array_contains"),
    ("invites", "created_by_user_id", "=="),
    ("libraries", "user_id", "=="),
    ("experiment_assignments", "user_id", "=="),
    ("experiment_events", "user_id", "=="),
    # Keep this checkpoint number for already-running purge jobs; it is skipped.
    ("token_ledger", "user_id", "=="),
    ("feedback", "reporter_user_id", "=="),
    ("feedback", "target_id", "=="),
    ("bug_reports", "reporter_user_id", "=="),
    ("outbox", "user_id", "=="),
    ("push_receipts", "user_id", "=="),
    ("requests", "user_id", "=="),
    ("matchmaking", "user_id", "=="),
    ("users", "invited_by_user_id", "=="),
)


def _tree_step(store, job):
    """Delete at most 400 children, then the tombstoned parent; resumable."""
    tree = job["tree"]
    if tree["kind"] == "token_ledger":
        # A job started by older code may already target a ledger row.
        # Retain it and resume at the unchanged phase checkpoint.
        retained = dict(job)
        retained.pop("tree")
        return retained
    ref = store.collection(tree["kind"]).document(tree["doc"])
    parent = store.raw_get(ref)
    if parent and not parent.get("tombstone"):
        if tree["kind"] == "invites":
            # Short codes may be reserved by a different match between this
            # purge's tombstone and physical cleanup. The old account cannot
            # write past its deletion fence; this live row is a new allocation.
            # Drop only our stale checkpoint/marker, preserving the new invite.
            if tree.get("identity") is not None:
                store.raw_put(store.ref("cleanup", "invites:" + tree["identity"]), None)
            return {k: v for k, v in job.items() if k != "tree"}
        from game_platform.service import ConflictError
        raise ConflictError("purge target changed unexpectedly")
    remaining = False
    for name in ("body", "moves", "entries", "evidence"):
        children = list(ref.collection(name).order_by("__name__").limit(100)
                        .stream(transaction=store._local.uow["tx"]))
        for child in children:
            store.raw_put(child.reference, None)
        remaining |= bool(children)
    if not remaining:
        markers = store._query("cleanup", [("path", "==", ref.path)], limit=1)
        if markers:
            store.raw_put(markers[0].reference, None)
            return job
        store.raw_put(ref, None)
        if tree.get("identity") is not None:
            store.raw_put(store.ref("cleanup", tree["kind"] + ":" + tree["identity"]), None)
        return {k: v for k, v in job.items() if k != "tree"}
    return job


def _tombstone(store, job, kind, doc, record=None):
    """Reuse typed-store deletion/counters, while retaining child-cleanup work."""
    identity = None
    if record is not None and kind in ("matches", "users", "invites", "push_subscriptions"):
        identity = record.token if kind == "invites" else record.id
        getattr(store, {"matches": "delete_match", "users": "delete_user",
                        "invites": "delete_invite",
                        "push_subscriptions": "delete_push_subscription"}[kind])(identity)
    elif record is not None and kind in ("libraries", "experiment_assignments", "experiment_events"):
        if kind == "libraries":
            from game_platform.scaling_library import identity as library_id
            identity = library_id(record.user_id, record.game_id)
        elif kind == "experiment_assignments":
            identity = json.dumps([record.user_id, record.experiment_id])
        else:
            identity = record.id
        store._delete(kind, identity)
    else:
        # Raw headers were not inserted through typed aggregate counters.
        store.raw_put(doc.reference, {"tombstone": True})
    return {**job, "tree": {"kind": kind, "doc": doc.id, "identity": identity}}


def _clear_match_inbox(store, user_id, match_id, *, invite_token=None):
    if not user_id or not match_id:
        return
    from game_platform.scaling_service import _message_match_id
    user = store.get_user(user_id)
    if user is None:
        return
    kept = tuple(n for n in user.notifications
                 if n.match_id != match_id and _message_match_id(n.url) != match_id
                 and (not invite_token or urlsplit(n.url).path not in
                      (f"/i/{invite_token}", f"/invite/{invite_token}")))
    if kept != user.notifications:
        store.put_user(replace(user, notifications=kept))


def _match_step(platform, job, doc):
    store = platform._store
    row = doc.to_dict()
    if row.get("json"):
        match_id = json.loads(row["json"])["id"]
    else:
        cleanup = store._query("cleanup", [("path", "==", doc.reference.path)], limit=1)
        match_id = row.get("id") or (cleanup[0].to_dict().get("identity") if cleanup else None)
    # The match parent's document ID is already SHA256(match_id), including
    # legacy tombstones whose JSON was removed by an earlier delete operation.
    store.raw_put(store.collection("match_deletion_fences").document(doc.id), {"deleted": True})
    # Generated inbox messages can contain an erased actor's display name.
    # Only known participants are read, one bounded inbox per committed step.
    participants = sorted(set(row.get("historical_participants", ()))
                          | set(row.get("participants", ())))
    index = job.get("inbox_index", 0) if job.get("inbox_doc") == doc.id else 0
    if match_id and index < len(participants):
        _clear_match_inbox(store, participants[index], match_id)
        return {**job, "inbox_doc": doc.id, "inbox_index": index + 1}
    # Remove dependent rows first, in bounded individual transactions.
    for kind in ("invites", "jobs", "failed_jobs", "requests", "matchmaking", "outbox", "game_server_bugs"):
        children = store._query(kind, [("match_id", "==", match_id)], limit=1) if match_id else []
        if children:
            child = children[0]
            record = store._decode(kind, child.to_dict(), child.reference) if kind == "invites" else None
            if record is not None:
                _clear_match_inbox(store, record.recipient_user_id, match_id, invite_token=record.token)
            return _tombstone(store, job, kind, child, record)
    if match_id:
        feedback = store._query("feedback", [("target_type", "==", "match"),
                                             ("target_id", "==", match_id)], limit=1)
        if feedback:
            return _tombstone(store, job, "feedback", feedback[0])
        store.raw_put(store._feedback_target_ref("match", match_id), None)
    match = store._decode("matches", row, doc.reference, detail=False)
    # Refunds and tombstone commit together, so a crash can never refund twice.
    if match is not None:
        platform._refund_held_pot(match)
    return _tombstone(store, job, "matches", doc, match)


def _query_step(platform, ref):
    store = platform._store
    with store.atomic(), _maintenance(store):
        job = store.raw_get(ref)
        if not job or not job.get("started_at"):
            return None
        canonical = store.get_user(job["user_id"])
        if canonical is None or canonical.deletion_started_at is None:
            raise RuntimeError("account purge lost its irreversible claim")
        if job.get("tree"):
            store.raw_put(ref, _tree_step(store, job))
            return True
        accounts = job["accounts"]
        phase, index = job.get("stage", 0), job.get("account_index", 0)
        if phase < len(_PHASES):
            kind, field, op = _PHASES[phase]
            if kind == "token_ledger":
                store.raw_put(ref, {**job, "stage": phase + 1, "account_index": 0})
                return True
            account_id = accounts[index]
            filters = [(field, op, account_id)]
            if kind == "feedback" and field == "target_id":
                filters.append(("target_type", "==", "user"))
            docs = store._query(kind, filters, limit=1)
            if docs:
                doc = docs[0]
                if kind == "matches":
                    job = _match_step(platform, job, doc)
                elif kind == "users":
                    user = store._decode(kind, doc.to_dict(), doc.reference)
                    if user is not None:
                        store.put_user(replace(user, invited_by_user_id=None))
                else:
                    from game_platform.query_store import TYPES
                    record = store._decode(kind, doc.to_dict(), doc.reference) if kind in TYPES else None
                    job = _tombstone(store, job, kind, doc, record)
            else:
                index += 1
                job = {**job, "account_index": index if index < len(accounts) else 0,
                       "stage": phase if index < len(accounts) else phase + 1}
            store.raw_put(ref, job)
            return True
        if not job.get("reports", {}).get("complete"):
            from game_platform.account_deletion_reports import purge_report_step
            job, finished = purge_report_step(store, job)
            if not finished:
                store.raw_put(ref, job)
                return True
        # Aliases must disappear before the survivor; otherwise an old password
        # could resolve back to its emptied alias after the survivor vanished.
        final_index = job.get("final_index", 0)
        ordered = [*accounts[1:], accounts[0]]
        account_id = ordered[final_index]
        user = store.get_user(account_id)
        store.raw_put(store.ref("account_deletion_fences", account_id), {"deleted": True})
        if user is not None:
            identity_index = job.get("identity_index", 0)
            if identity_index < len(user.linked_accounts):
                account = user.linked_accounts[identity_index]
                scope = json.dumps([account.kind, account.identifier])
                reservation = store.raw_get(store.ref("identities", scope))
                if reservation and reservation.get("user_id") in accounts:
                    store.raw_put(store.ref("identities", scope), None)
                verification = store.raw_get(store.ref("verification_limits", scope))
                if verification and verification.get("active_id"):
                    store.raw_put(store.ref("verifications", verification["active_id"]), None)
                store.raw_put(store.ref("verification_limits", scope), None)
                store.raw_put(ref, {**job, "identity_index": identity_index + 1})
                return True
            # Same ownership checks as the existing account finalizer, after
            # releasing identities in individually checkpointed bounded steps.
            if user.referral_code:
                referral = store.ref("referrals", user.referral_code)
                reservation = store.raw_get(referral)
                if reservation and reservation.get("user_id") in accounts:
                    store.raw_put(referral, None)
            platform._record_token_movement(user, -user.token_balance, reason="account_deleted")
            store.delete_user(account_id)
            # User records have no child documents; finish the existing cleanup
            # contract in this same bounded transaction.
            store.raw_put(store.ref("users", account_id), None)
            store.raw_put(store.ref("cleanup", "users:" + account_id), None)
        store.raw_put(store.ref("feedback_limits", account_id), None)
        store.raw_put(store._feedback_target_ref("user", account_id), None)
        store.raw_put(store.ref("bug_report_limits", "user:" + account_id), None)
        if final_index + 1 == len(ordered):
            store.raw_put(ref, None)
            return False
        store.raw_put(ref, {**job, "final_index": final_index + 1, "identity_index": 0})
        return True


def _memory_run(platform, now, limit, max_steps):
    """Small/local JSON stores persist the lifecycle on User itself."""
    store = platform._store
    completed = claimed = processed = 0
    with platform._lock:
        due = [u for u in store.list_users() if u.deletion_scheduled_at is not None
               and u.deletion_scheduled_at <= now and u.replaced_by_user_id is None][:limit]
        for user in due:
            if processed >= max_steps:
                break
            if user.deletion_started_at is None:
                user = replace(user, deletion_started_at=now, notifications_enabled=False, notifications=())
                store.put_user(user)
                claimed += 1
            accounts = {user.id, *user.replaced_user_ids}
            for match in store.list_all_matches():
                related = {match.owner_user_id, *match.human_user_ids, *match.hidden_for_user_ids,
                           *(m.made_by_user_id for m in match.moves),
                           *(t.user_id for t in match.timeouts)}
                if related & accounts:
                    inner = getattr(store, "_inner", store)
                    bugs = getattr(inner, "_game_server_bugs", {})
                    for bug_id, bug in list(bugs.items()):
                        if bug.get("match_id") == match.id:
                            del bugs[bug_id]
                    for participant in related:
                        _clear_match_inbox(store, participant, match.id)
                    for invite in store.list_invites(match_id=match.id):
                        _clear_match_inbox(store, invite.recipient_user_id, match.id, invite_token=invite.token)
                    platform._delete_match_and_invites(match.id)
                    processed += 1
                    if processed >= max_steps:
                        break
            if processed >= max_steps:
                continue
            for account_id in accounts:
                for subscription in store.list_push_subscriptions(user_id=account_id):
                    store.delete_push_subscription(subscription.id)
                for invite in store.list_invites():
                    if invite.created_by_user_id == account_id or invite.recipient_user_id == account_id or any(a.user_id == account_id for a in invite.acceptances):
                        store.delete_invite(invite.token)
                for assignment in store.list_experiment_assignments():
                    if assignment.user_id == account_id:
                        store.delete_experiment_assignment(user_id=account_id, experiment_id=assignment.experiment_id)
                for event in store.list_experiment_events():
                    if event.user_id == account_id:
                        store.delete_experiment_event(event.id)
            for other in store.list_users():
                if other.id not in accounts and other.invited_by_user_id in accounts:
                    store.put_user(replace(other, invited_by_user_id=None))
            # Local/JSON storage keeps these private support records in its
            # snapshot; remove them under the same operation lock before the
            # user write schedules that snapshot's durable save.
            inner = getattr(store, "_inner", store)
            for name in ("_feedback", "_bug_reports"):
                records = getattr(inner, name, {})
                for identity, record in list(records.items()):
                    reporter = record.get("reporter_user_id") if isinstance(record, dict) else record.reporter_user_id
                    target = record.get("target_id") if isinstance(record, dict) else getattr(record, "target_id", None)
                    target_type = record.get("target_type") if isinstance(record, dict) else getattr(record, "target_type", None)
                    if reporter in accounts or (target_type == "user" and target in accounts):
                        del records[identity]
            for account_id in accounts:
                getattr(inner, "_bug_report_limits", {}).pop("user:" + account_id, None)
            for account_id in [*(accounts - {user.id}), user.id]:
                deleted = store.get_user(account_id)
                if deleted and deleted.referral_code:
                    platform._user_ids_by_code.pop(deleted.referral_code, None)
                if deleted is not None:
                    platform._record_token_movement(deleted, -deleted.token_balance, reason="account_deleted")
                store.delete_user(account_id)
            completed += 1
            processed += 1
    return {"claimed": claimed, "completed": completed, "processed": processed,
            "more_work_may_remain": any(u.deletion_scheduled_at and u.deletion_scheduled_at <= now for u in store.list_users())}


def run_due_account_deletions(platform, *, limit=25, max_steps=1000, now=None):
    """Run one bounded pass; repeat while more_work within the caller's budget."""
    if not 1 <= limit <= 100 or not 1 <= max_steps <= 10000:
        raise ValueError("limit must be1..100 and max_steps1..10000")
    now = _now(platform, now)
    store = platform._store
    if not getattr(store, "scalable", False):
        return _memory_run(platform, now, limit, max_steps)
    from game_platform.account_deletion_backfill import backfill_account_deletion_metadata
    backfill = backfill_account_deletion_metadata(store, max_steps=max_steps)
    if not backfill["complete"]:
        return {"claimed": 0, "completed": 0, "processed": backfill["processed"],
                "more_work_may_remain": True}
    docs = _due(store, now, limit)
    claimed = completed = 0
    processed = backfill["processed"]
    for doc in docs:
        if processed >= max_steps:
            break
        from game_platform.service import ConflictError
        try:
            claimed += int(_claim(platform, doc.reference, now))
        except ConflictError:
            processed += 1
            continue
        while processed < max_steps:
            try:
                advanced = _query_step(platform, doc.reference)
            except ConflictError:
                # Another worker or a pre-claim writer won this transaction.
                # Its checkpoint is authoritative; a later bounded pass resumes.
                processed += 1
                break
            processed += 1
            if advanced is not True:
                completed += int(advanced is False)
                break
    return {"claimed": claimed, "completed": completed, "processed": processed,
            "more_work_may_remain": bool(_due(store, now, 1))}
