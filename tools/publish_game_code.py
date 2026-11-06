#!/usr/bin/env python3
"""Publishes the client code of built-in games from this repository to a running server.

A game stored in the server's database does not change when its file in games/ does: each change
needs a new version. This sends games/<id>.html (or games/<folder>/<id>.html) to
PUT /admin/games/<id>/code, which saves it as the next version (the server code and schemas of
the game are kept). A game whose live code is already the file's is skipped.

    python3 tools/publish_game_code.py --target https://buildplay.fun --password MASTER tictactoe poker
    python3 tools/publish_game_code.py --target https://buildplay.fun --dry-run tictactoe poker

Standard library only. Needs the master password, except with --dry-run (which only reads).
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

GAMES_DIR = Path(__file__).resolve().parent.parent / "games"


def call(method: str, url: str, *, body: dict | None = None, password: str = "") -> tuple[int, str]:
    request = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    request.add_header("Content-Type", "application/json")
    if password:
        request.add_header("Authorization", "Basic " + base64.b64encode(f":{password}".encode()).decode())
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()
    except (urllib.error.URLError, TimeoutError) as error:
        return 0, str(error)


def game_file(game_id: str) -> Path | None:
    for candidate in [GAMES_DIR / f"{game_id}.html", *sorted(GAMES_DIR.glob(f"*/{game_id}.html"))]:
        if candidate.is_file():
            return candidate
    return None


def normalized(text: str) -> str:
    return text.replace("\r\n", "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("games", nargs="+", help="game ids, such as tictactoe poker")
    parser.add_argument("--target", required=True, help="the server's address")
    parser.add_argument("--password", default="", help="the server's master password")
    parser.add_argument("--dry-run", action="store_true", help="say what would change; write nothing")
    args = parser.parse_args()
    target = args.target.rstrip("/")
    if not args.dry_run and not args.password:
        sys.exit("--password is needed unless --dry-run")

    failed = False
    for game_id in args.games:
        file = game_file(game_id)
        if file is None:
            print(f"{game_id}: no file games/{game_id}.html here")
            failed = True
            continue
        code = file.read_text(encoding="utf-8")
        status, text = call("GET", f"{target}/games/{game_id}?raw=1")
        if status != 200:
            print(f"{game_id}: the server has no such game ({status})")
            failed = True
            continue
        live = json.loads(text)
        if normalized(live.get("code", "")) == normalized(code):
            print(f"{game_id}: already version {live['version']}, nothing to do")
            continue
        if args.dry_run:
            print(f"{game_id}: version {live['version']} differs from {file.name}; would publish version {live['version'] + 1}")
            continue
        status, text = call("PUT", f"{target}/admin/games/{game_id}/code", body={"code": normalized(code)}, password=args.password)
        if status == 200:
            print(f"{game_id}: published version {json.loads(text)['version']}")
        else:
            print(f"{game_id}: refused ({status}) {text[:300]}")
            failed = True
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
