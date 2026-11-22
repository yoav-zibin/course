"""Remove retired personal referral codes and personal-only recruitment edges.

Run with application writers stopped. Dry-run is the default. Apply writes keep
private Firestore-typed preimages and bounded, source-bound resume checkpoints.
Match-origin recruitment is retained even when its short invite has expired.
"""

import fcntl
import hashlib
import json
import os
from pathlib import Path

from game_platform.platform_game_cleanup import (
    _private_directory, _private_file, _save, _backup, digest, run_cli, typed_fields,
)

POLICY = "remove-personal-referrals-v1"
REPORT_SUMMARY_FIELDS = frozenset({"users", "invited_users", "inviters", "biggest_tree", "longest_chain", "cycles_broken"})


def _is_referral_report(row):
    return (isinstance(row, dict) and isinstance(row.get("summary"), dict)
            and REPORT_SUMMARY_FIELDS <= row["summary"].keys()
            and row.get("phase") in ("users", "prepare", "drain"))


def without_personal_attribution(user):
    """Keep unknown user fields and durable match-origin recruitment markers."""
    result = {name: value for name, value in user.items() if name != "referral_code"}
    if (result.get("invited_by_user_id")
            and not (result.get("invited_via_invite_token") or result.get("invited_via_match_id"))):
        result["invited_by_user_id"] = None
    return result


def clean_user(row):
    if row is None:
        return None
    result = {name: value for name, value in row.items() if name != "referral_code"}
    if row.get("tombstone") or "json" not in row:
        return without_personal_attribution(result)
    user = json.loads(row["json"])
    if not isinstance(user, dict):
        raise ValueError("Expected a user JSON object")
    updated = without_personal_attribution(user)
    if updated != user:
        result["json"] = json.dumps(updated, ensure_ascii=False, separators=(",", ":"))
    if not (user.get("invited_via_invite_token") or user.get("invited_via_match_id")):
        if result.get("invited_by_user_id") or user.get("invited_by_user_id"):
            result["invited_by_user_id"] = None
    return result


def _backup_deletion(directory, ref, before):
    entry = {"path": ref.path, "fields": typed_fields(before),
             "before_sha256": digest(before), "after_sha256": None, "deleted": True}
    _private_directory(directory)
    identity = hashlib.sha256(json.dumps(entry, sort_keys=True).encode()).hexdigest()
    _save(directory / (identity + ".json"), entry)


def cleanup(store, directory, *, apply=False, page_size=50, max_documents=10000):
    """One bounded pass; repeat with the same private directory to resume."""
    if not 1 <= page_size <= 100 or not 1 <= max_documents <= 100000:
        raise ValueError("Invalid maintenance bounds")
    directory = Path(directory)
    _private_directory(directory)
    identity = {"project": store.client.project,
                "database": getattr(store.client, "_database", "fake"),
                "namespace": store.namespace, "policy": POLICY, "apply": apply}
    with _private_file(directory / "lock", os.O_CREAT | os.O_RDWR) as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = directory / "progress.json"
        progress = (json.loads(path.read_text()) if path.exists() else {
            "source": identity, "stage": "users", "complete": False,
            "counts": {kind: {"scanned": 0, "legacy": 0, "updated": 0}
                       for kind in ("users", "referrals", "dashboard_runs", "referral_nodes", "report_pointers", "invite_history")},
            "backfill": {"processed": 0, "created": 0, "attributed": 0}})
        if progress["source"] != identity:
            raise ValueError("Maintenance checkpoint has a different source or mode")
        if not path.exists():
            _save(path, progress)
        processed = 0

        def update(ref, kind, transform):
            nonlocal processed
            with store.atomic():
                before = store.raw_get(ref)
                after = transform(before)
                changed = before != after
                if apply and changed:
                    if after is None:
                        _backup_deletion(directory / "preimages", ref, before)
                    else:
                        _backup(directory / "preimages", ref, before, after)
                    store.raw_put(ref, after)
            counts = progress["counts"][kind]
            counts["scanned"] += 1
            counts["legacy"] += int(changed)
            counts["updated"] += int(apply and changed)
            processed += 1

        while not progress["complete"] and processed < max_documents:
            stage = progress["stage"]
            if stage in ("users", "referrals"):
                docs = store._run_query(stage, (), limit=min(page_size, max_documents - processed),
                                        after=progress.get("after"), transaction=None)
                if not docs:
                    progress["stage"] = "referrals" if stage == "users" else "reports"
                    progress.pop("after", None)
                for doc in docs:
                    update(doc.reference, stage, clean_user if stage == "users" else lambda _: None)
                    progress["after"] = doc.id
                    _save(path, progress)
            elif stage == "reports":
                if not progress.get("report"):
                    docs = store._run_query("dashboard_runs", (), limit=1,
                                            after=progress.get("after"), transaction=None)
                    if not docs:
                        progress["stage"] = "pointer"
                    else:
                        # Count parent scans in the pass budget, including unrelated
                        # dashboards with no referral_nodes subcollection.
                        update(docs[0].reference, "dashboard_runs", lambda row: row)
                        progress["report"] = docs[0].id
                        progress["report_removable"] = _is_referral_report(docs[0].to_dict())
                    _save(path, progress)
                    continue
                nodes = store.collection("dashboard_runs").document(progress["report"]).collection("referral_nodes")
                query = nodes.order_by("__name__").limit(min(page_size, max_documents - processed))
                if progress.get("node_after"):
                    query = query.start_after({"__name__": nodes.document(progress["node_after"])})
                docs = list(query.stream())
                if not docs:
                    if progress.get("report_removable"):
                        update(store.collection("dashboard_runs").document(progress["report"]),
                               "dashboard_runs", lambda _: None)
                    progress["after"] = progress.pop("report")
                    progress.pop("node_after", None)
                    progress.pop("report_removable", None)
                for doc in docs:
                    update(doc.reference, "referral_nodes", lambda _: None)
                    progress["report_removable"] = True
                    progress["node_after"] = doc.id
                    _save(path, progress)
            elif stage == "pointer":
                # Every old snapshot may include personal-only edges. Unpublish it
                # until a new report is rebuilt from the cleaned user records.
                update(store.collection("meta").document("referral_dashboard"),
                       "report_pointers", lambda _: None)
                progress["stage"] = "invites"
            elif stage == "invites":
                from game_platform.conversion_funnel import archive_invite, allocation_id, record_event
                docs = store._run_query("invites", (), limit=min(page_size, max_documents - processed),
                                        after=progress.get("invite_after"), transaction=None)
                if not docs:
                    progress["stage"] = "backfill"
                    progress["complete"] = not apply
                for doc in docs:
                    with store.atomic():
                        invite = store._decode("invites", store.raw_get(doc.reference), doc.reference)
                        changed = False
                        if invite is not None:
                            allocation = allocation_id(invite)
                            prior = store.get_analytics("invite_history", allocation)
                            previous_event = store.get_analytics("funnel_events", "invite:" + allocation)
                            changed = prior is None or previous_event is None
                            if apply:
                                archived = archive_invite(store, invite)
                                if prior is None:
                                    archived["reconstructed"] = True
                                    store.put_analytics("invite_history", allocation, archived)
                                record_event(store, "invite_created", at=invite.created_at,
                                             identity="invite:" + allocation,
                                             match_id=invite.match_id, owner_user_id=invite.created_by_user_id,
                                             invite_allocation_id=allocation, reconstructed=True)
                    counts = progress["counts"]["invite_history"]
                    counts["scanned"] += 1
                    counts["legacy"] += int(changed)
                    counts["updated"] += int(apply and changed)
                    processed += 1
                    progress["invite_after"] = doc.id
                    _save(path, progress)
            else:
                from game_platform.recruitment_history import backfill_nodes
                result = backfill_nodes(store, limit=min(page_size, max_documents - processed),
                                        cursor=progress.get("backfill_cursor"))
                processed += result["processed"]
                for name in ("processed", "created", "attributed"):
                    progress["backfill"][name] += result[name]
                progress["backfill_cursor"] = result["next_cursor"]
                progress["complete"] = result["next_cursor"] is None
            _save(path, progress)
        return {"complete": progress["complete"], "processed_this_pass": processed,
                "apply": apply, "counts": progress["counts"], "backfill": progress["backfill"]}


def cleanup_json_file(path, directory, *, apply=False):
    """Equivalent explicit cleanup for a stopped legacy JSON-file deployment."""
    path, directory = Path(path), Path(directory)
    _private_directory(directory)
    before = path.read_bytes()
    snapshot = json.loads(before)
    if snapshot.get("format_version") != 1 or not isinstance(snapshot.get("data"), dict):
        raise ValueError("Expected a version-one JSON store")
    users = snapshot["data"]["users"]
    cleaned = [without_personal_attribution(user) for user in users]
    changed = sum(user != updated for user, updated in zip(users, cleaned))
    if apply and changed:
        backup = directory / (hashlib.sha256(before).hexdigest() + ".json")
        _save(backup, snapshot)
        snapshot["data"]["users"] = cleaned
        _save(path, snapshot)
    return {"complete": True, "apply": apply, "scanned": len(users),
            "legacy": changed, "updated": changed if apply else 0}


def main(argv=None):
    return run_cli(argv, operation=cleanup, description=__doc__)


if __name__ == "__main__":
    os.umask(0o077)
    raise SystemExit(main())
