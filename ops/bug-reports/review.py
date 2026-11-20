#!/usr/bin/env python3
"""Check private player bug reports and queue repairs in the existing Codex thread."""

import argparse
import base64
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parent
DEFAULT_STATE = Path.home() / ".local/share/buildplay-bug-reports"
RETRY_SECONDS = 6 * 3600
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
# Headers contain up to 10k description + 20k review-note characters. With
# JSON escapes control characters to six bytes each; twenty maximal headers
# still fit, including when the text needs more space than four-byte Unicode.
PAGE_LIMIT = 20
STATUSES = ("open", "handling", "escalated", "handled")
MAX_STUDENT_ACCOUNTS = 24  # Twelve people can each have multiple verified accounts.


def save_json(path, value):
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(value, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def configuration(state_dir):
    config = json.loads((state_dir / "config.json").read_text())
    if config.get("repository") != "yoav-zibin/course" or config.get("branch") != "main":
        raise ValueError("Unexpected bug-report repository or branch")
    uuid.UUID(config.get("thread_id", ""))
    if not Path(config["repository_path"]).is_dir():
        raise ValueError("The configured repository must exist")
    validate_owner_google_user_id(config.get("owner_google_user_id"))
    validate_student_user_ids(config.get("student_user_ids"))
    return config


def validate_owner_google_user_id(value):
    if value is None:
        return None
    try:
        if not isinstance(value, str) or str(uuid.UUID(value)) != value:
            raise ValueError
    except (ValueError, AttributeError):
        raise ValueError("Invalid owner Google user ID") from None
    return value


def owner_suggestion_authorized(config, report):
    """Match the private owner pin against authenticated, server-derived context."""
    owner = validate_owner_google_user_id(config.get("owner_google_user_id"))
    user = report.get("user")
    if not owner or not isinstance(user, dict):
        return False
    providers = user.get("linked_account_kinds")
    return (report.get("reporter_user_id") == owner and user.get("id") == owner
            and user.get("is_guest") is False and isinstance(providers, list)
            and "google" in providers)


def validate_student_user_ids(value):
    if value is None:
        return []
    try:
        if not isinstance(value, list) or len(value) > MAX_STUDENT_ACCOUNTS:
            raise ValueError
        if any(validate_owner_google_user_id(identifier) is None for identifier in value):
            raise ValueError
        if len(set(value)) != len(value):
            raise ValueError
    except (ValueError, TypeError):
        raise ValueError("Invalid student user IDs") from None
    return list(value)


def reporter_identity(report):
    """Return consistent server context, distinguishing anonymous from malformed."""
    identifier, user = report.get("reporter_user_id"), report.get("user")
    if identifier is None and user is None:
        return True, None
    return (isinstance(identifier, str) and isinstance(user, dict)
            and user.get("id") == identifier), identifier


def student_suggestion_authorized(config, report):
    consistent, identifier = reporter_identity(report)
    return (consistent and identifier is not None
            and identifier != config.get("owner_google_user_id")
            and identifier in validate_student_user_ids(config.get("student_user_ids")))


def authorization_scope(config):
    parsed = urllib.parse.urlsplit(config["api_base"].rstrip("/"))
    return {"repository": config["repository"], "branch": config["branch"],
            "thread_id": str(uuid.UUID(config["thread_id"])),
            "api_origin": [parsed.scheme, parsed.hostname, parsed.port if parsed.port is not None else 443]}


def authorizations(state_dir, config):
    empty = {"scope": authorization_scope(config), "approved": {}, "declined": {}, "pending": None}
    path = state_dir / "authorizations.json"
    if not path.exists():
        return empty
    if path.stat().st_mode & 0o077:
        raise RuntimeError("The authorization state must be private (mode 600)")
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError("Invalid private authorization state")
    if value.get("scope") != empty["scope"]:
        return empty  # A different server, repository or conversation grants no approval.
    if (not isinstance(value.get("approved"), dict) or not isinstance(value.get("declined"), dict)
            or (value.get("pending") is not None and not isinstance(value["pending"], dict))):
        raise ValueError("Invalid private authorization state")
    for decisions in (value["approved"], value["declined"]):
        for identifier, decision in decisions.items():
            report_id(identifier)
            if not isinstance(decision, dict) or not isinstance(decision.get("user_response"), str):
                raise ValueError("Invalid private authorization state")
    if value["pending"] is not None:
        report_id(value["pending"].get("report_id"))
    return value


@contextmanager
def authorization_lock(state_dir):
    with (state_dir / "authorizations.lock").open("a") as lock:
        os.fchmod(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def with_review_policy(config, report, authorization=None):
    # Always overwrite incoming flags. Submitted evidence cannot grant approval.
    authorization = authorization or {"approved": {}, "declined": {}, "pending": None}
    owner = owner_suggestion_authorized(config, report)
    student = student_suggestion_authorized(config, report)
    consistent, identifier = reporter_identity(report)
    approval = authorization["approved"].get(report["id"], {})
    explicit = (consistent and bool(approval) and approval.get("reporter_user_id") == identifier)
    declined = report["id"] in authorization["declined"]
    pending = authorization["pending"]
    return {**report, "_review_policy": {
        "owner_suggestion_authorized": owner,
        "student_suggestion_authorized": student,
        "preauthorized": owner or student,
        "explicitly_authorized": explicit,
        "authorization_required": declined or not (owner or student or explicit),
        "authorization_declined": declined,
        "authorization_pending": bool(pending and pending["report_id"] == report["id"]),
        "pending_authorization_report_id": pending["report_id"] if pending else None,
    }}


def review_ids(api, authorization):
    identifiers = set(api.pending_ids())
    identifiers.update(identifier for identifier, decision in authorization["approved"].items()
                       if decision.get("active") is True)
    if authorization["pending"]:
        identifiers.add(authorization["pending"]["report_id"])
    return identifiers


def authorization_status(state_dir):
    state = authorizations(state_dir, configuration(state_dir))
    return {"private_authorizations": str(state_dir / "authorizations.json"),
            "pending_report_id": state["pending"]["report_id"] if state["pending"] else None,
            "approved_reports": len(state["approved"])}


def request_authorization(state_dir, identifier, *, summary_file):
    """Reserve the sole question; no report status or approval changes here."""
    report_id(identifier)
    summary = " ".join(summary_file.read_text().split())
    if not 5 <= len(summary) <= 500:
        raise ValueError("A concise 5–500 character behavior summary is required")
    config = configuration(state_dir)
    with authorization_lock(state_dir):
        state = authorizations(state_dir, config)
        if state["pending"]:
            if state["pending"]["report_id"] != identifier:
                raise RuntimeError("Another report is awaiting Yoav's decision; do not ask a second question")
            return authorization_status(state_dir)
        report = BugAPI(config).get(identifier)
        if report["status"] == "handled":
            raise ValueError("A handled report does not need authorization")
        policy = with_review_policy(config, report, state)["_review_policy"]
        if not policy["authorization_required"]:
            raise ValueError("This report is already authorized")
        if policy["authorization_declined"]:
            raise ValueError("Yoav already declined this report; await his explicit decision to reconsider")
        consistent, user_id = reporter_identity(report)
        if not consistent:
            raise ValueError("The server-derived reporter identity is inconsistent")
        user = report.get("user") or {}
        name = user.get("display_name")
        name = " ".join(name.split())[:160] if isinstance(name, str) and name.strip() else "Signed-out reporter" if user_id is None else "Unnamed signed-in reporter"
        state["pending"] = {"report_id": identifier, "reporter_user_id": user_id,
                            "reporter_name": name, "summary": summary, "requested_at": time.time()}
        save_json(state_dir / "authorizations.json", state)
    return authorization_status(state_dir)


def decide_authorization(state_dir, identifier, *, decision, user_response_file,
                         confirmed_direct_reply=False):
    """Call only after Yoav's direct reply in the configured conversation."""
    report_id(identifier)
    if confirmed_direct_reply is not True:
        raise PermissionError("A direct reply from Yoav in this conversation is required")
    if decision not in ("approved", "declined"):
        raise ValueError("Invalid authorization decision")
    response = user_response_file.read_text().strip()
    if not response or len(response) > 10_000:
        raise ValueError("Private notes quoting Yoav's direct response are required")
    config = configuration(state_dir)
    with authorization_lock(state_dir):
        state = authorizations(state_dir, config)
        pending = state["pending"]
        pending_matches = bool(pending and pending["report_id"] == identifier)
        subject = pending if pending_matches else (state["declined"].get(identifier) or state["approved"].get(identifier))
        if not subject:
            raise ValueError("The decision must match the sole pending report or update its recorded decision")
        report = BugAPI(config).get(identifier)
        consistent, user_id = reporter_identity(report)
        if not consistent or user_id != subject["reporter_user_id"]:
            raise ValueError("The server-derived reporter identity changed")
        state[decision][identifier] = {"reporter_user_id": user_id, "user_response": response,
                                        "decided_at": time.time(), "active": decision == "approved" and report["status"] != "handled"}
        state["declined" if decision == "approved" else "approved"].pop(identifier, None)
        if pending_matches:
            state["pending"] = None
        save_json(state_dir / "authorizations.json", state)
    return {**authorization_status(state_dir), "id": identifier, "decision": decision}


def complete_authorization(state_dir, config, identifier):
    with authorization_lock(state_dir):
        state = authorizations(state_dir, config)
        changed = False
        if state["approved"].get(identifier, {}).get("active") is True:
            state["approved"][identifier]["active"] = False
            changed = True
        if state["pending"] and state["pending"]["report_id"] == identifier:
            state["pending"] = None  # Another reviewer resolved it; this grants no permission.
            changed = True
        if changed:
            save_json(state_dir / "authorizations.json", state)


def report_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", value):
        raise ValueError("Invalid bug-report id")
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward a master password to a redirect destination.


class BugAPI:
    def __init__(self, config):
        self.base = config["api_base"].rstrip("/")
        parsed = urllib.parse.urlsplit(self.base)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or
                parsed.password or parsed.query or parsed.fragment or parsed.path):
            raise ValueError("api_base must be an HTTPS origin")
        self.password_file = Path(config["password_file"])

    def request(self, path, *, method="GET", body=None):
        if self.password_file.stat().st_mode & 0o077:
            raise RuntimeError("The master-password file must be private (mode 600)")
        password = self.password_file.read_text().rstrip("\n")
        headers = {"Accept": "application/json", "Authorization": "Basic " +
                   base64.b64encode(("bug-report-review:" + password).encode()).decode()}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
                payload = response.read(MAX_RESPONSE_BYTES + 1)
                if len(payload) > MAX_RESPONSE_BYTES:
                    raise RuntimeError("Bug-report API response exceeded the private download limit")
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as error:
            # Report text, screenshots and logs must not enter the service journal.
            raise RuntimeError(f"Bug-report API returned HTTP {error.code}") from None

    def pages(self, *, status, limit=PAGE_LIMIT):
        if status not in STATUSES:
            raise ValueError("Invalid bug-report status")
        cursor = None
        seen = set()
        while True:
            query = {"status": status, "limit": limit}
            if cursor is not None:
                query["cursor"] = cursor
            body = self.request("/admin/bug-reports?" + urllib.parse.urlencode(query))
            if not isinstance(body, dict) or not isinstance(body.get("items"), list):
                raise RuntimeError("Unexpected bug-report page response")
            yield body["items"]
            cursor = body.get("next_cursor")
            if cursor is None:
                return
            if not isinstance(cursor, str) or not cursor or cursor in seen:
                raise RuntimeError("Invalid or repeated bug-report cursor")
            seen.add(cursor)

    def pending_ids(self):
        # Escalated reports wait for the user's decision; the hourly job cannot reopen them.
        return {report_id(row.get("id"))
                for status in ("open", "handling")
                for page in self.pages(status=status)
                for row in page}

    def get(self, identifier):
        identifier = report_id(identifier)
        body = self.request("/admin/bug-reports/" + urllib.parse.quote(identifier, safe=""))
        if not isinstance(body, dict) or body.get("id") != identifier or body.get("status") not in STATUSES:
            raise RuntimeError("Unexpected bug-report detail response")
        return body


def watch(state_dir, *, dry_run=False, now=None):
    config = configuration(state_dir)
    identifiers = review_ids(BugAPI(config), authorizations(state_dir, config))
    receipt = state_dir / "pending.json"
    if not identifiers:
        if not dry_run:
            receipt.unlink(missing_ok=True)
        return "No unhandled player bug reports"
    now = time.time() if now is None else now
    pending = json.loads(receipt.read_text()) if receipt.exists() else {}
    if (identifiers.issubset(set(pending.get("report_ids", []))) and
            0 <= now - pending.get("queued_at", 0) < RETRY_SECONDS):
        return "Player bug-report repair already queued; retrying unfinished work after six hours"
    if dry_run:
        return f"Would queue repair of {len(identifiers)} unhandled player bug reports"
    prompt = (ROOT / "instructions.txt").read_text()
    prompt += ("\nScheduler state directory: " + str(state_dir.resolve()) + ".\n"
               "Repository: " + config["repository_path"] + ".\n"
               "Observed unhandled reports: " + str(len(identifiers)) + ". Fetch the current queue.\n")
    result = subprocess.run(
        ["/usr/bin/codex", "queue", "--thread", config["thread_id"],
         "--message", prompt, "--resume"],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode or "warn" in (result.stdout + result.stderr).lower():
        raise RuntimeError("Could not confirm Codex queue/resume; no success receipt saved")
    # A delivery receipt is never a resolution. An interrupted repair retries after six hours.
    save_json(receipt, {"report_ids": sorted(identifiers), "queued_at": now,
                        "thread_id": config["thread_id"]})
    return f"Queued repair of {len(identifiers)} player bug reports in the existing Codex thread"


def watch_locked(state_dir, *, dry_run=False):
    with (state_dir / "watch.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return "Another player bug-report check is running"
        return watch(state_dir, dry_run=dry_run)


def snapshot(state_dir):
    """Save full pending evidence privately; stdout contains only the path and count."""
    config = configuration(state_dir)
    api = BugAPI(config)
    authorization = authorizations(state_dir, config)
    directory = state_dir / "snapshots"
    directory.mkdir(mode=0o700, exist_ok=True)
    count = 0
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, suffix=".jsonl", delete=False) as handle:
        path = Path(handle.name)
        try:
            for identifier in sorted(review_ids(api, authorization)):
                body = with_review_policy(config, api.get(identifier), authorization)
                if body["status"] == "handled":
                    complete_authorization(state_dir, config, identifier)
                    authorization = authorizations(state_dir, config)
                    continue
                if body["status"] == "escalated" and not (
                        body["_review_policy"]["explicitly_authorized"] or
                        body["_review_policy"]["authorization_pending"]):
                    continue
                handle.write(json.dumps(body, ensure_ascii=False) + "\n")
                count += 1
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise
    return {"unhandled_reports": count, "private_snapshot": str(path)}


def get_report(state_dir, identifier):
    """Retrieve even a resolved report privately, for lost-response confirmation."""
    config = configuration(state_dir)
    report = BugAPI(config).get(identifier)
    if report["status"] == "handled":
        complete_authorization(state_dir, config, identifier)
    body = with_review_policy(config, report, authorizations(state_dir, config))
    directory = state_dir / "snapshots"
    directory.mkdir(mode=0o700, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, suffix=".json", delete=False) as handle:
        path = Path(handle.name)
        try:
            json.dump(body, handle, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise
    return {"id": identifier, "status": body["status"], "private_report": str(path),
            **body["_review_policy"]}


def set_status(state_dir, identifier, *, status, notes_file, commit=None,
               expected_status=None, expected_updated_at=None):
    report_id(identifier)
    notes = notes_file.read_text().strip()
    if not notes:
        raise ValueError("Resolution or escalation notes are required")
    if expected_status is None or not expected_updated_at:
        raise ValueError("Both expected status and updated-at guards are required")
    config = configuration(state_dir)
    api = BugAPI(config)
    current = api.get(identifier)
    if current["status"] != expected_status or current.get("updated_at") != expected_updated_at:
        raise RuntimeError("The report changed; fetch it before updating its status")
    policy = with_review_policy(config, current, authorizations(state_dir, config))["_review_policy"]
    if status in ("open", "handling", "handled") and policy["authorization_required"]:
        raise PermissionError("Yoav's explicit authorization is required before working on this report")
    body = {"status": status, "resolution": notes}
    if commit is not None:
        body["commit"] = commit
    if expected_status is not None:
        body["expected_status"] = expected_status
    if expected_updated_at is not None:
        body["expected_updated_at"] = expected_updated_at
    result = api.request(
        "/admin/bug-reports/" + urllib.parse.quote(identifier, safe="") + "/status",
        method="POST", body=body,
    )
    if not isinstance(result, dict) or result.get("id") != identifier or result.get("status") != status:
        raise RuntimeError("The API did not confirm the status; fetch the report before retrying")
    if status == "handled":
        complete_authorization(state_dir, config, identifier)
    return {"id": identifier, "status": status}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE)
    commands = parser.add_subparsers(dest="command", required=True)
    watcher = commands.add_parser("watch")
    watcher.add_argument("--dry-run", action="store_true")
    commands.add_parser("snapshot")
    commands.add_parser("authorizations")
    permission = commands.add_parser("request-authorization")
    permission.add_argument("id")
    permission.add_argument("--summary-file", type=Path, required=True)
    decision = commands.add_parser("decide-authorization", description="Record only Yoav's direct reply in this conversation")
    decision.add_argument("id")
    decision.add_argument("--decision", choices=("approved", "declined"), required=True)
    decision.add_argument("--user-response-file", type=Path, required=True)
    decision.add_argument("--from-yoav-in-this-thread", action="store_true", required=True)
    detail = commands.add_parser("get")
    detail.add_argument("id")
    change = commands.add_parser("status")
    change.add_argument("id")
    change.add_argument("--status", choices=STATUSES, required=True)
    change.add_argument("--notes-file", type=Path, required=True)
    change.add_argument("--commit")
    change.add_argument("--expected-status", choices=STATUSES)
    change.add_argument("--expected-updated-at")
    args = parser.parse_args()
    if args.command == "watch":
        result = watch_locked(args.state_dir, dry_run=args.dry_run)
    elif args.command == "snapshot":
        result = snapshot(args.state_dir)
    elif args.command == "get":
        result = get_report(args.state_dir, args.id)
    elif args.command == "authorizations":
        result = authorization_status(args.state_dir)
    elif args.command == "request-authorization":
        result = request_authorization(args.state_dir, args.id, summary_file=args.summary_file)
    elif args.command == "decide-authorization":
        result = decide_authorization(args.state_dir, args.id, decision=args.decision,
                                      user_response_file=args.user_response_file,
                                      confirmed_direct_reply=args.from_yoav_in_this_thread)
    else:
        result = set_status(args.state_dir, args.id, status=args.status, notes_file=args.notes_file,
                            commit=args.commit, expected_status=args.expected_status,
                            expected_updated_at=args.expected_updated_at)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
