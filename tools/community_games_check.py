#!/usr/bin/env python3
"""Read-only check before publishing games/community/: is each game on the server still the
version the conversion was made from?

    python3 tools/community_games_check.py --target https://buildplay.fun

For each game in games/community/manifest.json it GETs the live game and compares its client code
with games/community/<id>.original.html. A game that differs was saved by its owner since the
conversion (publishing the converted file would overwrite that change): convert the new version
again first. Standard library only; makes only GET requests.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

COMMUNITY = Path(__file__).resolve().parent.parent / "games" / "community"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", required=True, help="the server's address")
    args = parser.parse_args()
    target = args.target.rstrip("/")
    manifest = json.loads((COMMUNITY / "manifest.json").read_text(encoding="utf-8"))
    problems = 0
    for entry in manifest["games"]:
        original = (COMMUNITY / entry["original"]).read_text(encoding="utf-8").replace("\r\n", "\n")
        try:
            with urllib.request.urlopen(f"{target}/games/{entry['id']}", timeout=60) as response:
                live = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            print(f"{entry['id']} {entry['name']}: cannot read it ({error})")
            problems += 1
            continue
        code = (live.get("client_code") or live.get("code") or "").replace("\r\n", "\n")
        if code == original:
            print(f"{entry['id']} {entry['name']}: unchanged since version {entry['version_fetched']}: ok to publish")
        elif "i18n-strings" in code:
            print(f"{entry['id']} {entry['name']}: version {live.get('version')} already has an i18n-strings block: do not publish")
            problems += 1
        else:
            print(f"{entry['id']} {entry['name']}: version {live.get('version')} differs from the converted one (was {entry['version_fetched']}): convert it again")
            problems += 1
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
