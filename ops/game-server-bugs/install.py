#!/usr/bin/env python3
"""Install this user's daily game-bug Codex queue timer; no credentials are copied."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

ROOT = Path(__file__).resolve().parent
REPOSITORY = ROOT.parent.parent
UNIT = "buildplay-game-server-bugs"


def unit_path(path):
    # systemd expands percent specifiers even inside quoted values.
    return json.dumps(str(path).replace("%", "%%").replace("$", "$$"))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--thread-id", required=True)
    credentials = parser.add_mutually_exclusive_group(required=True)
    credentials.add_argument("--server-config", type=Path, help="Server JSON containing master_password")
    credentials.add_argument("--password-file", type=Path, help="Private file containing the master password")
    parser.add_argument("--state-dir", type=Path,
                        default=Path.home() / ".local/share/buildplay-game-server-bugs")
    parser.add_argument("--api-base", default="https://buildplay.fun")
    args = parser.parse_args()
    uuid.UUID(args.thread_id)
    if args.server_config is not None:
        credential = {"server_config": str(args.server_config.resolve(strict=True))}
    else:
        password_file = args.password_file.resolve(strict=True)
        if password_file.stat().st_mode & 0o077:
            raise ValueError("The existing master-password file must be private (mode 600)")
        credential = {"password_file": str(password_file)}
    state = args.state_dir.resolve()
    state.mkdir(parents=True, mode=0o700, exist_ok=True)
    state.chmod(0o700)
    config = {"repository": "yoav-zibin/course", "branch": "main", "thread_id": args.thread_id,
              "api_base": args.api_base, "repository_path": str(REPOSITORY), **credential}
    sys.path.insert(0, str(ROOT))
    from review import BugAPI, save_json
    BugAPI(config)  # Validate the configured origin before installing a live timer.
    save_json(state / "config.json", config)
    directory = Path.home() / ".config/systemd/user"
    directory.mkdir(parents=True, exist_ok=True)
    service = directory / (UNIT + ".service")
    timer = directory / (UNIT + ".timer")
    service.write_text(
        "[Unit]\nDescription=Queue daily Codex review of game-server bugs\n"
        "Wants=network-online.target codex-remote-control.service\n"
        "After=network-online.target codex-remote-control.service\n\n"
        "[Service]\nType=oneshot\nWorkingDirectory=" + str(REPOSITORY).replace("%", "%%") + "\n"
        "ExecStart=/usr/bin/python3 " + unit_path(ROOT / "review.py") +
        " --state-dir " + unit_path(state) + " watch\nTimeoutStartSec=100\nUMask=0077\n"
    )
    timer.write_text(
        "[Unit]\nDescription=Review game-server bugs daily at 07:00 UTC\n\n"
        "[Timer]\nOnCalendar=*-*-* 07:00:00 UTC\nPersistent=true\nUnit=" + UNIT +
        ".service\n\n[Install]\nWantedBy=timers.target\n"
    )
    subprocess.run(["systemd-analyze", "--user", "verify", str(service), str(timer)], check=True)
    subprocess.run(["systemctl", "--user", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "--user", "enable", "--now", UNIT + ".timer"], check=True)
    subprocess.run(["systemctl", "--user", "list-timers", UNIT + ".timer", "--no-pager"], check=True)


if __name__ == "__main__":
    main()
