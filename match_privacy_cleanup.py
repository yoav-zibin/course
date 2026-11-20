"""Remove the retired match audience flag from every persisted match.

Run after deploying the all-public match behavior. This selective storage
maintenance preserves player state, move children, unknown legacy metadata and
per-user hidden-list settings. It does not deserialize through today's models.
Use a private state directory for bounded resume and typed recovery preimages;
run a fresh dry-run in a separate directory afterward to verify zero flags.
"""

import json
import os

from game_platform.platform_game_cleanup import cleanup_records, run_cli

KINDS = ("matches",)
POLICY = "all-public-matches-v1"


def without_privacy(row):
    if row is None:
        return None
    result = {key: value for key, value in row.items() if key != "private"}
    raw = row.get("json")
    if raw is not None:
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError("Expected a match JSON object")
        if "private" in payload:
            payload.pop("private")
            result["json"] = json.dumps(payload, ensure_ascii=False,
                                        separators=(",", ":"))
    return result


def cleanup(store, directory, *, apply=False, page_size=50, max_documents=10000):
    return cleanup_records(store, directory, kinds=KINDS,
                           transform=without_privacy, policy=POLICY,
                           apply=apply, page_size=page_size,
                           max_documents=max_documents)


def main(argv=None):
    return run_cli(argv, operation=cleanup, description=__doc__)


if __name__ == "__main__":
    os.umask(0o077)
    raise SystemExit(main())
