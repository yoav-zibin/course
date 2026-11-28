"""Write the scheduled review prompt from the public catalog to stdout."""

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

REPOSITORY = "yoav-zibin/course"
ISSUE_TITLE = "Weekly BuildPlay carousel review"
MANIFEST_URL = f"https://raw.githubusercontent.com/{REPOSITORY}/main/game_carousels.json"


def catalog():
    cursor = None
    seen = set()
    while True:
        query = urlencode({"limit": 100, **({"cursor": cursor} if cursor else {})})
        with urlopen(f"https://buildplay.fun/v2/games?{query}", timeout=30) as response:
            page = json.load(response)
        yield from page["items"]
        cursor = page["next_cursor"]
        if cursor is None:
            return
        if cursor in seen:
            raise ValueError("Catalog repeated a page cursor")
        seen.add(cursor)


def review(rows):
    assigned = {game_id for row in rows for game_id in row["games"]}
    games = list(catalog())
    pending = sorted(
        (game for game in games if game["id"] not in assigned),
        key=lambda game: (game["name"].casefold(), game["id"]),
    )
    today = datetime.now(timezone.utc).date()
    repo_main = f"https://github.com/{REPOSITORY}/blob/main"
    lines = [
        f"Weekly catalog review for {today} UTC",
        "",
        "Check the games below against the existing carousels. Research public online "
        "play counts or comparable popularity signals, add each game ID to the best-fit "
        "row in popularity order, and cite the strongest sources in the change. Consider a "
        "new category if several titles share a clear theme. Keep Miscellaneous last and "
        "leave Chess, Backgammon, and Connect Four at the start of Board & Strategy Games.",
        "",
        f"Update [the carousel manifest]({repo_main}/game_carousels.json) and follow "
        f"[the ranking guide]({repo_main}/docs/game-carousels.md).",
        "",
        f"### Published games awaiting review ({len(pending)} of {len(games)})",
        "",
    ]
    if not pending:
        lines.append("Every published game already has a position.")
    for game in pending:
        # Untrusted catalog names are plain text, with no Markdown or mentions.
        name = game["name"].replace("`", "'").replace("\n", " ").replace("\r", " ")
        lines.append(f"- `{name}` · `{game['id']}`")
    return "\n".join(lines) + "\n"


def publish(body):
    issues = json.loads(subprocess.check_output(
        ["gh", "issue", "list", "--repo", REPOSITORY, "--state", "open",
         "--search", f'{ISSUE_TITLE} in:title', "--json", "number,title"],
        text=True,
    ))
    number = next((str(issue["number"]) for issue in issues if issue["title"] == ISSUE_TITLE), None)
    action = ["edit", number] if number else ["create", "--title", ISSUE_TITLE]
    subprocess.run(
        ["gh", "issue", *action, "--repo", REPOSITORY, "--body-file", "-"],
        input=body, text=True, check=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publish", action="store_true", help="Post the prompt using GitHub CLI")
    args = parser.parse_args()
    if args.publish:
        with urlopen(MANIFEST_URL, timeout=30) as response:
            rows = json.load(response)
        publish(review(rows))
    else:
        manifest = Path(__file__).resolve().parents[1] / "game_carousels.json"
        print(review(json.loads(manifest.read_text(encoding="utf-8"))), end="")


if __name__ == "__main__":
    main()
