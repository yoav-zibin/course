#!/usr/bin/env python3
"""Queue the daily Codex review and privately retrieve its game-bug evidence."""

import argparse
import base64
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
DEFAULT_STATE = Path.home() / ".local/share/buildplay-game-server-bugs"


def save_json(path, value):
    """Replace private scheduler state only after the operation succeeded."""
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
        raise ValueError("Unexpected game-bug review repository or branch")
    if not re.fullmatch(r"[0-9a-f-]{36}", config.get("thread_id", "")):
        raise ValueError("A valid existing Codex thread_id is required")
    return config


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A redirect must never forward the master password to another host.
        return None


class BugAPI:
    def __init__(self, config):
        base = config["api_base"].rstrip("/")
        parsed = urllib.parse.urlsplit(base)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or
                parsed.password or parsed.query or parsed.fragment or parsed.path):
            raise ValueError("api_base must be an HTTPS origin")
        self.base = base
        self.password_file = Path(config["password_file"])

    def request(self, path, *, method="GET", body=None):
        if self.password_file.stat().st_mode & 0o077:
            raise RuntimeError("The master-password file must be private (mode 600)")
        password = self.password_file.read_text().rstrip("\n")
        headers = {
            "Accept": "application/json",
            "Authorization": "Basic " + base64.b64encode(
                ("game-bug-review:" + password).encode()
            ).decode(),
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
                payload = response.read()
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as error:
            # Response bodies can contain private game state. Keep them out of journals.
            raise RuntimeError(f"Game-bug API returned HTTP {error.code}") from None

    def pages(self, *, limit=50):
        cursor = None
        seen = set()
        while True:
            query = {"examined": "false", "limit": limit}
            if cursor is not None:
                query["cursor"] = cursor
            body = self.request("/game-server-bugs?" + urllib.parse.urlencode(query))
            if not isinstance(body, dict) or not isinstance(body.get("items"), list):
                raise RuntimeError("Unexpected game-bug page response")
            yield body["items"]
            cursor = body.get("next_cursor")
            if cursor is None:
                return
            if not isinstance(cursor, str) or not cursor or cursor in seen:
                raise RuntimeError("Invalid or repeated game-bug cursor")
            seen.add(cursor)

    def get(self, bug_id):
        if not isinstance(bug_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", bug_id):
            raise ValueError("Invalid bug id")
        bug = self.request("/game-server-bugs/" + urllib.parse.quote(bug_id, safe=""))
        if (not isinstance(bug, dict) or bug.get("id") != bug_id or
                not isinstance(bug.get("examined"), bool) or
                not isinstance(bug.get("evidence"), dict)):
            raise RuntimeError("Unexpected game-bug detail response")
        return bug

    def has_pending(self):
        return any(page for page in self.pages(limit=1))


def watch(state_dir, *, dry_run=False, day=None):
    config = configuration(state_dir)
    day = day or dt.datetime.now(dt.timezone.utc).date().isoformat()
    receipt = state_dir / ("queued-" + day + ".json")
    if receipt.exists():
        return "Daily game-bug review already queued for " + day
    if not BugAPI(config).has_pending():
        return "No unexamined game-server bugs"
    if dry_run:
        return "Would queue daily game-bug review for " + day
    prompt = (ROOT / "instructions.txt").read_text()
    prompt += ("\nReview date (UTC): " + day + ".\n"
               "Scheduler state directory: " + str(state_dir.resolve()) + ".\n"
               "Repository: " + config["repository_path"] + ".\n")
    result = subprocess.run(
        ["/usr/bin/codex", "queue", "--thread", config["thread_id"],
         "--message", prompt, "--resume"],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode or "warn" in (result.stdout + result.stderr).lower():
        raise RuntimeError("Could not confirm Codex queue/resume; no success receipt saved")
    # Queueing never examines a bug. Only the actual reviewing agent may do that.
    save_json(receipt, {"date": day, "thread_id": config["thread_id"],
                        "queued_at": dt.datetime.now(dt.timezone.utc).isoformat()})
    return "Queued daily game-bug review in Codex for " + day


def snapshot(state_dir):
    """Stream all evidence to a private file; print only its location and count."""
    api = BugAPI(configuration(state_dir))
    directory = state_dir / "snapshots"
    directory.mkdir(mode=0o700, exist_ok=True)
    count = 0
    skipped = 0
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, suffix=".jsonl", delete=False) as handle:
        path = Path(handle.name)
        try:
            for page in api.pages():
                for header in page:
                    # LIST contains lightweight summaries. Fetch each complete
                    # report and recheck its status before saving private evidence.
                    bug = api.get(header.get("id"))
                    if bug["examined"] or bug.get("examined_at") is not None:
                        skipped += 1
                        continue
                    handle.write(json.dumps(bug, ensure_ascii=False) + "\n")
                    count += 1
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            path.unlink(missing_ok=True)
            raise
    return {"unexamined_bugs": count, "skipped_examined": skipped, "private_snapshot": str(path)}


def examine(state_dir, bug_id, *, outcome, notes_file, fix_game_version=None, fix_commit=None):
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", bug_id):
        raise ValueError("Invalid bug id")
    notes = notes_file.read_text().strip()
    if not notes:
        raise ValueError("Review notes are required")
    if outcome == "fixed" and fix_game_version is None:
        raise ValueError("A verified published game version is required for fixed bugs")
    body = {"outcome": outcome, "notes": notes}
    if fix_game_version is not None:
        body["fix_game_version"] = fix_game_version
    if fix_commit is not None:
        body["fix_commit"] = fix_commit
    result = BugAPI(configuration(state_dir)).request(
        "/game-server-bugs/" + urllib.parse.quote(bug_id, safe="") + "/examine",
        method="POST", body=body,
    )
    if not isinstance(result, dict) or not result.get("examined_at"):
        raise RuntimeError("The API did not confirm the bug was examined; fetch it before retrying")
    return {"id": bug_id, "outcome": result.get("outcome", outcome), "examined_at": result["examined_at"]}


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE)
    commands = parser.add_subparsers(dest="command", required=True)
    watcher = commands.add_parser("watch")
    watcher.add_argument("--dry-run", action="store_true")
    commands.add_parser("snapshot")
    review = commands.add_parser("examine")
    review.add_argument("id")
    review.add_argument("--outcome", choices=["fixed", "escalated", "obsolete"], required=True)
    review.add_argument("--notes-file", type=Path, required=True)
    review.add_argument("--fix-game-version", type=int)
    review.add_argument("--fix-commit")
    args = parser.parse_args()
    if args.command == "watch":
        with (args.state_dir / "watch.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            result = watch(args.state_dir, dry_run=args.dry_run)
    elif args.command == "snapshot":
        result = snapshot(args.state_dir)
    else:
        result = examine(args.state_dir, args.id, outcome=args.outcome,
                         notes_file=args.notes_file, fix_game_version=args.fix_game_version,
                         fix_commit=args.fix_commit)
    print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
