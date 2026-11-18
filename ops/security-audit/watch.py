#!/usr/bin/env python3
"""Queue security reviews without advancing the last successfully audited commit."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

REPOSITORY = "yoav-zibin/course"
REMOTE = "https://github.com/yoav-zibin/course.git"
RETRY_SECONDS = 20 * 3600


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


def check(root, *, dry_run=False):
    state = json.loads((root / "state.json").read_text())
    if state["repository"] != REPOSITORY or state["branch"] != "main":
        raise ValueError("Unexpected security audit target")
    checkpoint = state["last_audited_commit"]
    if not re.fullmatch(r"[0-9a-f]{40}", checkpoint):
        raise ValueError("Invalid security checkpoint; refusing to skip history")
    remote = subprocess.run(
        ["/usr/bin/git", "ls-remote", "--exit-code", REMOTE, "refs/heads/main"],
        check=True, capture_output=True, text=True, timeout=30,
    )
    head, ref = remote.stdout.strip().split()
    if ref != "refs/heads/main" or not re.fullmatch(r"[0-9a-f]{40}", head):
        raise ValueError("Unexpected remote revision")
    if head == checkpoint:
        return "No unaudited security commits"
    pending_path = root / "pending.json"
    pending = json.loads(pending_path.read_text()) if pending_path.exists() else {}
    now = time.time()
    if pending.get("head") == head and now - pending.get("queued_at", 0) < RETRY_SECONDS:
        return "Security audit already queued; waiting for successful review"
    if dry_run:
        return f"Would queue security audit {checkpoint}..{head}"
    prompt = (root / "instructions.txt").read_text()
    prompt += f"\nObserved main: {head}. Previous successful audit: {checkpoint}. Fetch again.\n"
    result = subprocess.run(
        ["/usr/bin/codex", "queue", "--thread", state["thread_id"],
         "--message", prompt, "--resume"],
        capture_output=True, text=True, timeout=60,
    )
    result.check_returncode()
    # Queue success is not audit success. Only the reviewing agent may advance
    # state.json after reviewing, fixing, verifying, and publishing the changes.
    save_json(pending_path, {"head": head, "queued_at": now})
    if "warn" in (result.stdout + result.stderr).lower():
        raise RuntimeError("Codex queued the review but could not resume; inspect daemon health")
    return f"Queued daily security audit through {head}"


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    with (args.state_dir / "watch.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        print(check(args.state_dir, dry_run=args.dry_run), flush=True)


if __name__ == "__main__":
    main()
