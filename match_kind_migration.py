"""Backfill match kinds and retire incompatible legacy matches.

Run after the match-kind release, using the existing production configuration.
The default is read-only. Apply saves private typed recovery records before each
atomic change. Invalid matches use normal administrative deletion, including
stake refunds, invite removal, counters and bounded child cleanup.
"""

import fcntl
import hashlib
import json
import os
from pathlib import Path

from game_platform.platform_game_cleanup import (
    _private_directory, _private_file, _save, digest, run_cli, typed_fields,
)

POLICY = "cloud-match-kinds-v1"
KINDS = frozenset({"computer", "pass_and_play", "multiplayer"})


def classify(payload):
    """Infer only unambiguous legacy kinds; reject incompatible account rosters."""
    owner = payload.get("owner_user_id")
    seats = payload.get("seats")
    if not owner or not isinstance(seats, list) or not seats:
        return None
    if any(not isinstance(seat, dict) or seat.get("kind") not in {"human", "computer"}
           for seat in seats):
        return None
    humans = [seat for seat in seats if seat["kind"] == "human"]
    computers = [seat for seat in seats if seat["kind"] == "computer"]
    if not humans:
        return None
    people = {seat.get("user_id") for seat in humans if seat.get("user_id")}
    timed_out = {item.get("user_id") for item in payload.get("timeouts", [])}
    explicit = payload.get("match_kind")
    if explicit is not None and explicit not in KINDS:
        return None
    free = all(payload.get(field, 0) in (0, None)
               for field in ("bet_per_player", "token_pot"))
    if computers:
        if (len(humans) != 1 or people != {owner}
                or timed_out - {None, owner}
                or explicit in {"multiplayer", "pass_and_play"} or not free):
            return None
        return "computer"
    if owner not in people:
        return None
    if explicit == "computer":
        return None
    if explicit == "pass_and_play":
        return "pass_and_play" if people == {owner} and free else None
    # A one-account lobby is waiting for human opponents. A completed/running
    # one-account game, or local handoff seats, belongs to that account alone.
    if people == {owner} and (len(humans) > 1 or payload.get("status") != "waiting_for_players"):
        return "pass_and_play" if free else None
    if any(not seat.get("user_id") for seat in humans) or len(people) != len(humans):
        return None
    return "multiplayer"


def migrated_row(row, payload, kind):
    """Preserve immutable rules/state, unknown metadata and existing move children."""
    result = dict(row)
    value = dict(payload)
    value["match_kind"] = kind
    result["match_kind"] = kind
    # The old audience flag must not override the kind's access policy.
    value.pop("private", None)
    result.pop("private", None)
    if kind != "multiplayer":
        value["invite_code"] = None
        # Legacy cloud games already have a durable revision. The first
        # portable snapshot must use this version when continuing elsewhere.
        value["cloud_revision"] = max(1, value.get("cloud_revision", 0))
        owner = value["owner_user_id"]
        result["participants"] = [owner]
        result["visible_to"] = [] if owner in value.get("hidden_for_user_ids", []) else [owner]
    # Do not rewrite byte-for-byte JSON when it already has the desired fields.
    if value != payload:
        result["json"] = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return result


def _backup_transaction(store, directory, match_ref, *, include_moves):
    """Capture every affected document, including refunds and insert-only ledger rows."""
    uow = store._local.uow
    entries = []
    for ref, after in uow["writes"].values():
        before = uow["reads"].get(ref.path)
        entries.append({"path": ref.path,
                        "before_fields": typed_fields(before) if before is not None else None,
                        "after_sha256": digest(after) if after is not None else None})
    moves = []
    if include_moves:
        for document in match_ref.collection("moves").stream(transaction=uow["tx"]):
            moves.append({"path": document.reference.path,
                          "fields": typed_fields(document.to_dict())})
    recovery = {"policy": POLICY, "documents": entries, "move_children": moves}
    name = hashlib.sha256(json.dumps(recovery, sort_keys=True).encode()).hexdigest()
    _private_directory(directory)
    _save(directory / (name + ".json"), recovery)


def cleanup(store, directory, *, apply=False, page_size=50, max_documents=10000):
    """Bounded, resumable sweep; transaction rereads protect live gameplay."""
    if not 1 <= page_size <= 100 or not 1 <= max_documents <= 100000:
        raise ValueError("Invalid maintenance bounds")
    from game_platform.scaling_service import ScalablePlatform

    directory = Path(directory)
    _private_directory(directory)
    identity = {"project": store.client.project,
                "database": getattr(store.client, "_database", "fake"),
                "namespace": store.namespace, "policy": POLICY, "apply": apply}
    platform = ScalablePlatform(store=store, check_game_schemas=False)
    try:
        with _private_file(directory / "lock", os.O_CREAT | os.O_RDWR) as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            path = directory / "progress.json"
            progress = json.loads(path.read_text()) if path.exists() else {
                "source": identity, "complete": False,
                "counts": {"scanned": 0, "tombstones": 0, "backfill": 0,
                           "invalid": 0, "updated": 0, "deleted": 0,
                           **{kind: 0 for kind in sorted(KINDS)}}}
            if progress["source"] != identity:
                raise ValueError("Maintenance checkpoint has a different source or mode")
            if not path.exists():
                _save(path, progress)
            processed = 0
            while not progress["complete"] and processed < max_documents:
                docs = store._run_query("matches", (),
                                        limit=min(page_size, max_documents-processed),
                                        after=progress.get("last_doc"), transaction=None)
                if not docs:
                    progress["complete"] = True
                    _save(path, progress)
                    break
                for document in docs:
                    outcome = {}
                    with store.atomic():
                        before = store.raw_get(document.reference)
                        if not before or before.get("tombstone"):
                            outcome["tombstones"] = 1
                        else:
                            payload = json.loads(before["json"])
                            if not isinstance(payload, dict):
                                raise ValueError("Expected a match JSON object")
                            kind = classify(payload)
                            if kind is None:
                                outcome["invalid"] = 1
                                if apply:
                                    # The admin helper first applies gameplay clocks;
                                    # maintenance must also retire hidden/legacy games
                                    # without executing their old rules.
                                    platform._delete_match_and_invites(payload["id"])
                                    _backup_transaction(store, directory / "preimages",
                                                        document.reference, include_moves=True)
                                    outcome["deleted"] = 1
                            else:
                                outcome[kind] = 1
                                after = migrated_row(before, payload, kind)
                                invites = (store.list_invites(match_id=payload["id"])
                                           if kind != "multiplayer" else [])
                                if before != after or invites:
                                    outcome["backfill"] = 1
                                    if apply:
                                        for invite in invites:
                                            store.delete_invite(invite.token)
                                        store.raw_put(document.reference, after)
                                        _backup_transaction(store, directory / "preimages",
                                                            document.reference, include_moves=False)
                                        outcome["updated"] = 1
                    counts = progress["counts"]
                    counts["scanned"] += 1
                    for name, count in outcome.items():
                        counts[name] += count
                    progress["last_doc"] = document.id
                    processed += 1
                    _save(path, progress)
            return {"complete": progress["complete"], "apply": apply,
                    "processed_this_pass": processed, "counts": progress["counts"]}
    finally:
        platform.close_workers()


def main(argv=None):
    return run_cli(argv, operation=cleanup, description=__doc__)


if __name__ == "__main__":
    os.umask(0o077)
    raise SystemExit(main())
