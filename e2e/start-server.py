"""Starts a throwaway game server for the Playwright UI tests.

The code imports itself as `game_platform`, so this script links the repo under
that name in a temp folder and runs the server with isolated test wallets.
"""
import datetime as dt
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
port = os.environ.get("E2E_PORT", "8123")

with tempfile.TemporaryDirectory() as tmp:
    package_alias = Path(tmp) / "game_platform"
    try:
        package_alias.symlink_to(repo, target_is_directory=True)
    except OSError:
        if os.name != "nt":
            raise
        shutil.copytree(
            repo,
            package_alias,
            ignore=shutil.ignore_patterns(".git", ".venv", "node_modules", "__pycache__"),
        )
    # Paid-match browser checks use explicit existing wallets. Guest creation
    # and entering a match never grant tokens.
    sys.path.insert(0, tmp)
    from game_platform.json_file_store import JsonFileStore
    from game_platform.models import User

    store = JsonFileStore(Path(tmp) / "data.json")
    now = dt.datetime.now(dt.timezone.utc)
    for project in ("chromium", "mobile"):
        # Match the two CI retries so each attempt gets an independent wallet.
        for attempt in range(3):
            for name in ("Alice", "Bob"):
                store.put_user(User(
                    id=f"paid-{project}-{attempt}-{name.lower()}", display_name=name,
                    password="paid-match-test-wallet", token_balance=10,
                    created_at=now, updated_at=now,
                ))
    store.close()
    config = Path(tmp) / "config.json"
    config.write_text(
        '{"server": {"host": "127.0.0.1", "port": %s},'
        ' "master_password": "e2e-test-master",'
        ' "data_file": {"path": "%s"}}' % (port, (Path(tmp) / "data.json").as_posix())
    )
    sys.exit(
        subprocess.call(
            [sys.executable, "-m", "game_platform.main", "--config", str(config)],
            cwd=tmp,
        )
    )
