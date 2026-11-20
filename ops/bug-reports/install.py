#!/usr/bin/env python3
"""Install the authorized hourly player bug-report check for an existing Codex thread."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.parse
import uuid

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parent.parent
UNIT = "buildplay-bug-reports"


def unit_path(path):
    return json.dumps(str(path).replace("%", "%%").replace("$", "$$"))


def api_origin(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = urllib.parse.urlsplit(value.rstrip("/"))
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username or
                parsed.password or parsed.path or parsed.query or parsed.fragment):
            return None
        return parsed.hostname.casefold(), parsed.port if parsed.port is not None else 443
    except ValueError:
        return None


def with_owner_google_user_id(config, previous, *, owner_google_user_id=None,
                              validate_owner_id):
    """Keep an owner pin only within its repository/API origin, or replace it."""
    candidate = owner_google_user_id
    if candidate is None and isinstance(previous, dict):
        origin = api_origin(config.get("api_base"))
        if (previous.get("repository") == config.get("repository") and
                origin is not None and origin == api_origin(previous.get("api_base"))):
            candidate = previous.get("owner_google_user_id")
    owner = validate_owner_id(candidate)
    result = dict(config)
    result.pop("owner_google_user_id", None)
    if owner is not None:
        result["owner_google_user_id"] = owner
    return result


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--thread-id", required=True)
    parser.add_argument("--password-file", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path,
                        default=Path.home() / ".local/share/buildplay-bug-reports")
    parser.add_argument("--api-base", default="https://buildplay.fun")
    parser.add_argument("--owner-google-user-id",
                        help="Canonical UUID of the verified Google owner account")
    args = parser.parse_args()
    uuid.UUID(args.thread_id)
    password_file = args.password_file.resolve(strict=True)
    if password_file.stat().st_mode & 0o077:
        raise ValueError("The existing master-password file must be private (mode 600)")
    state = args.state_dir.resolve()
    state.mkdir(parents=True, mode=0o700, exist_ok=True)
    state.chmod(0o700)
    config = {"repository": "yoav-zibin/course", "branch": "main", "thread_id": args.thread_id,
              "api_base": args.api_base, "password_file": str(password_file),
              "repository_path": str(REPOSITORY)}
    sys.path.insert(0, str(ROOT))
    from review import BugAPI, save_json, validate_owner_google_user_id
    previous = json.loads((state / "config.json").read_text()) if (state / "config.json").exists() else None
    config = with_owner_google_user_id(
        config, previous, owner_google_user_id=args.owner_google_user_id,
        validate_owner_id=validate_owner_google_user_id,
    )
    BugAPI(config)
    save_json(state / "config.json", config)
    directory = Path.home() / ".config/systemd/user"
    directory.mkdir(parents=True, exist_ok=True)
    service = directory / (UNIT + ".service")
    timer = directory / (UNIT + ".timer")
    service.write_text(
        "[Unit]\nDescription=Check player bug reports and queue Codex repairs\n"
        "Wants=network-online.target codex-remote-control.service\n"
        "After=network-online.target codex-remote-control.service\n\n"
        "[Service]\nType=oneshot\nWorkingDirectory=" + str(REPOSITORY).replace("%", "%%") + "\n"
        "ExecStart=/usr/bin/python3 " + unit_path(ROOT / "review.py") +
        " --state-dir " + unit_path(state) + " watch\nTimeoutStartSec=300\nUMask=0077\n"
    )
    timer.write_text(
        "[Unit]\nDescription=Check player bug reports every hour\n\n"
        "[Timer]\nOnCalendar=*-*-* *:00:00 UTC\nPersistent=true\nUnit=" + UNIT +
        ".service\n\n[Install]\nWantedBy=timers.target\n"
    )
    subprocess.run(["systemd-analyze", "--user", "verify", str(service), str(timer)], check=True)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", UNIT + ".timer"], check=True)
    subprocess.run(["systemctl", "--user", "list-timers", UNIT + ".timer", "--no-pager"], check=True)


if __name__ == "__main__":
    main()
