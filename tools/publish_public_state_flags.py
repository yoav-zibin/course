"""Apply the reviewed public-state metadata to existing games through PATCH.

Run without --apply to inspect the guarded plan. The secret file contains a
password as text, a JSON string, or private JSON with a `master_password` key. No game
source, rules, UI or validation artifacts are sent to the update endpoint.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

MANIFEST = Path(__file__).resolve().parents[1] / "games/public-state-review.json"


def source_hash(game):
    return hashlib.sha256(game["server_code"].encode()).hexdigest()


def reviewed_games(path):
    manifest = json.loads(path.read_text())
    rows = manifest["games"]
    if not rows or len(rows) > 500 or len({row["id"] for row in rows}) != len(rows):
        raise ValueError("review must contain 1–500 distinct existing game IDs")
    for row in rows:
        if (not isinstance(row["id"], str) or not row["id"]
                or type(row["version"]) is not int or row["version"] < 1
                or type(row["all_state_public"]) is not bool
                or len(row["server_code_sha256"]) != 64
                or any(c not in "0123456789abcdef" for c in row["server_code_sha256"])
                or not row["reason"].strip()):
            raise ValueError("invalid reviewed game entry")
    return rows


def request(base, path, body=None):
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=None if body is None else json.dumps(body).encode(),
        method="GET" if body is None else "PATCH",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        # Validation details may echo a submitted secret. Never print them.
        raise RuntimeError(f"{req.method} {path}: HTTP {exc.code}") from None


def game_path(row):
    return "/games/" + urllib.parse.quote(row["id"], safe="")


def check_current(row, current, *, require_field=False):
    if (current.get("id") != row["id"]
            or current.get("renderer_type") != "declarative"
            or source_hash(current) != row["server_code_sha256"]):
        raise ValueError(f"{row['name']}: game source changed since review")
    present = type(current.get("all_state_public")) is bool
    if require_field and not present:
        raise ValueError("Deploy the all_state_public API before applying the review")
    matching = present and current["all_state_public"] is row["all_state_public"]
    # A completed metadata PATCH creates a version. Reruns accept that result,
    # but an edit needing a write must still be the exact reviewed version.
    if (not matching and current.get("version") != row["version"]
            or matching and current.get("version", 0) < row["version"]):
        raise ValueError(f"{row['name']}: game version changed since review")
    return not matching


def publish(base, rows, *, secret=None):
    # Validate every reviewed source before the first mutation.
    plan = [(row, request(base, game_path(row))) for row in rows]
    for row, current in plan:
        check_current(row, current, require_field=secret is not None)
    results = []
    for row, current in plan:
        pending = check_current(row, current)
        action = "would_update" if pending else "already_current"
        if pending and secret is not None:
            # Recheck immediately before each metadata-only write as well.
            current = request(base, game_path(row))
            if check_current(row, current, require_field=True):
                current = request(base, game_path(row), {
                    "all_state_public": row["all_state_public"],
                    "game_addition_request_id_and_secret": secret,
                })
                if check_current(row, current, require_field=True):
                    raise ValueError(f"{row['name']}: update did not persist")
                action = "updated"
            else:
                action = "already_current"
        results.append({"id": row["id"], "name": row["name"],
                        "version": current["version"],
                        "all_state_public": row["all_state_public"], "action": action})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="https://buildplay.fun")
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--secret-file", type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    secret = None
    if args.apply:
        if args.secret_file is None:
            parser.error("--apply requires a private --secret-file")
        raw = args.secret_file.read_text().strip()
        try:
            value = json.loads(raw)
        except ValueError:
            value = raw
        secret = value.get("master_password") if isinstance(value, dict) else value
        if not isinstance(secret, str) or not secret:
            parser.error("secret file must contain a nonempty master_password")
    rows = reviewed_games(args.manifest)
    results = publish(args.base_url, rows, secret=secret)
    report = {"base_url": args.base_url, "applied": args.apply, "games": results}
    if args.report:
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    counts = {action: sum(row["action"] == action for row in results)
              for action in {row["action"] for row in results}}
    print(json.dumps({"games": len(results), "actions": counts}))


if __name__ == "__main__":
    main()
