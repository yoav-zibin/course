#!/usr/bin/env python3
"""Check private player bug reports and queue repairs in the existing Codex thread."""

import argparse
import base64
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
# four-byte Unicode, 100 headers exceed the private response cap; 25 fit.
PAGE_LIMIT = 25
STATUSES = ("open", "handling", "escalated", "handled")


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
    return config


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
    identifiers = BugAPI(config).pending_ids()
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
    api = BugAPI(configuration(state_dir))
    directory = state_dir / "snapshots"
    directory.mkdir(mode=0o700, exist_ok=True)
    count = 0
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, suffix=".jsonl", delete=False) as handle:
        path = Path(handle.name)
        try:
            for identifier in sorted(api.pending_ids()):
                body = api.get(identifier)
                if body["status"] not in ("open", "handling"):
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
    body = BugAPI(configuration(state_dir)).get(identifier)
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
    return {"id": identifier, "status": body["status"], "private_report": str(path)}


def set_status(state_dir, identifier, *, status, notes_file, commit=None,
               expected_status=None, expected_updated_at=None):
    report_id(identifier)
    notes = notes_file.read_text().strip()
    if not notes:
        raise ValueError("Resolution or escalation notes are required")
    body = {"status": status, "resolution": notes}
    if commit is not None:
        body["commit"] = commit
    if expected_status is not None:
        body["expected_status"] = expected_status
    if expected_updated_at is not None:
        body["expected_updated_at"] = expected_updated_at
    result = BugAPI(configuration(state_dir)).request(
        "/admin/bug-reports/" + urllib.parse.quote(identifier, safe="") + "/status",
        method="POST", body=body,
    )
    if not isinstance(result, dict) or result.get("id") != identifier or result.get("status") != status:
        raise RuntimeError("The API did not confirm the status; fetch the report before retrying")
    return {"id": identifier, "status": status}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE)
    commands = parser.add_subparsers(dest="command", required=True)
    watcher = commands.add_parser("watch")
    watcher.add_argument("--dry-run", action="store_true")
    commands.add_parser("snapshot")
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
    else:
        result = set_status(args.state_dir, args.id, status=args.status, notes_file=args.notes_file,
                            commit=args.commit, expected_status=args.expected_status,
                            expected_updated_at=args.expected_updated_at)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
