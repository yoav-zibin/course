"""Write the scheduled review prompt from the public catalog to stdout."""

import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


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


def main():
    manifest = Path(__file__).resolve().parents[1] / "game_carousels.json"
    rows = json.loads(manifest.read_text(encoding="utf-8"))
    assigned = {game_id for row in rows for game_id in row["games"]}
    games = list(catalog())
    pending = sorted(
        (game for game in games if game["id"] not in assigned),
        key=lambda game: (game["name"].casefold(), game["id"]),
    )
    today = datetime.now(timezone.utc).date()
    print(f"Weekly catalog review for {today} UTC\n")
    print(
        "Check the games below against the existing carousels. Research public online "
        "play counts or comparable popularity signals, add each game ID to the best-fit "
        "row in popularity order, and cite the strongest sources in the change. Consider a "
        "new category if several titles share a clear theme. Keep Miscellaneous last and "
        "leave Chess, Backgammon, and Connect Four at the start of Board & Strategy Games.\n"
    )
    print(
        "Update [the carousel manifest](../blob/main/game_carousels.json) and follow "
        "[the ranking guide](../blob/main/docs/game-carousels.md).\n"
    )
    print(f"### Published games awaiting review ({len(pending)} of {len(games)})\n")
    if not pending:
        print("Every published game already has a position.")
    for game in pending:
        # Untrusted catalog names are plain text, with no Markdown or mentions.
        name = game["name"].replace("`", "'").replace("\n", " ").replace("\r", " ")
        print(f"- `{name}` · `{game['id']}`")


if __name__ == "__main__":
    main()
