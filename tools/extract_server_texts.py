"""Finds the texts a game's SERVER writes and lists them as templates in the game's page table.

    python tools/extract_server_texts.py                 # dry run over every game in games/
    python tools/extract_server_texts.py --write         # add the `server_...` keys to the pages
    python tools/extract_server_texts.py --write --report reports/server-texts-review.md
    python tools/extract_server_texts.py --server X.server.js --page X.html [--write]

What it reads in `*.server.js` (docs/game-translation.md, "Texts the server writes"):

1. the argument of `new InvalidMove(...)`: string literals, template literals (`${expr}`
   becomes `{p1}`, `{p2}`...), concatenations (`'must top ' + state.highBid`) and conditionals
   between texts (`c ? 'a' : 'b'` gives both);
2. display strings written into the match state: arguments of `log(...)`, `_log(...)`,
   `log.push(...)`, `msgs.push(...)`, assignments to `.log`/`.msg`/`.message`/`.text`/`.reason` (and a variable called msg, message or reason), and the
   values of the properties `msg`, `text`, `label`, `description`, `desc`, `banner`, `title`,
   `message`, `note`, `summary`, `reason`. A property whose value is one lowercase word
   (`msg: 'refill'`) is a code, not a text, and is skipped.

Whatever it cannot read (a message taken from a variable, built from too many pieces, ...) is
listed in the review list, never guessed. A template is added once (a second run adds nothing)
under a key `server_<words>`, and only to games whose page already has an `i18n-strings` block.
The page's English output does not change: the keys are only used when a text is shown with
`tx(...)` or when the platform translates a rejected move.

For a game whose server code is not in the repository, `--fetch-community` reads the public
record (`GET {base}/games/{id}`, read-only) and keeps the server code next to the page as
`games/community/<id>.original.server.js` when the record's version is the one the page was
converted from; otherwise the game is listed as left out.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

KEY_PREFIX = "server_"
_BLOCK = re.compile(
    r"""(<script\b(?=[^>]*\bid\s*=\s*["']i18n-strings["'])[^>]*>)(.*?)(</script\s*>)""", re.S | re.I
)

def _load_reader():
    """game_server_texts.py, the reader shared with game_text.lint, loaded by path so that
    this tool runs from any checkout, whatever the package is called."""
    import importlib.util

    path = ROOT / "game_server_texts.py"
    spec = importlib.util.spec_from_file_location("game_server_texts", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["game_server_texts"] = module
    spec.loader.exec_module(module)
    return module


_reader = _load_reader()
extract, Found, Result = _reader.extract, _reader.Found, _reader.Result


# Keys and the page's table


def slug(template: str) -> str:
    words = re.findall(r"[a-z0-9]+", re.sub(r"\{p\d+\}", " ", template.lower()))
    return "_".join(words)[:40].strip("_") or "text"


def assign_keys(templates: list[str], table: dict[str, str]) -> dict[str, str]:
    """A `server_...` key for each template not already in [table] (as a server_ text)."""
    have = {text: key for key, text in table.items() if key.startswith(KEY_PREFIX)}
    used = set(table)
    new: dict[str, str] = {}
    for template in templates:
        if template in have or template in new.values():
            continue
        base = KEY_PREFIX + slug(template)
        key, n = base, 2
        while key in used:
            key, n = f"{base}_{n}", n + 1
        used.add(key)
        new[key] = template
    return new


def read_table(page: str) -> dict[str, str] | None:
    m = _BLOCK.search(page)
    return json.loads(m.group(2)) if m else None


def add_to_page(page: str, new: dict[str, str]) -> str:
    """The page with [new] keys appended to its i18n-strings block (nothing else changes)."""
    m = _BLOCK.search(page)
    assert m is not None
    body = m.group(2)
    end = body.rstrip().rfind("}")
    head = body[:end].rstrip()
    indent = re.search(r'\n(\s*)"', head)
    pad = indent.group(1) if indent else "  "
    lines = ",\n".join(f"{pad}{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in new.items())
    newline = "\r\n" if "\r\n" in body else "\n"
    lines = lines.replace("\n", newline)
    joined = head + ("," if not head.endswith("{") else "") + newline + lines + newline + body[end:]
    return page[: m.start(2)] + joined + page[m.end(2) :]


# The games of the repository


@dataclass
class Game:
    name: str
    page: Path
    server: Path | None


def games_in_repo() -> list[Game]:
    found = []
    for page in sorted([*(ROOT / "games").glob("*.html"), *(ROOT / "games").glob("*/*.html")]):
        if page.name.endswith(".original.html"):
            continue
        server = page.with_name(page.stem + ".server.js")
        if not server.exists():
            server = page.with_name(page.stem + ".original.server.js")
        found.append(Game(str(page.relative_to(ROOT / "games")).replace("\\", "/"), page, server if server.exists() else None))
    return found


def fetch_community(base: str, left_out: dict[str, str]) -> None:
    """Saves the server code of the community games next to their pages (read-only GETs)."""
    manifest = json.loads((ROOT / "games/community/manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["games"]:
        game_id = entry["id"]
        target = ROOT / "games/community" / f"{game_id}.original.server.js"
        if target.exists():
            continue
        try:
            with urllib.request.urlopen(
                urllib.request.Request(f"{base.rstrip('/')}/games/{game_id}", headers={"User-Agent": "server-text-extractor"}),
                timeout=30,
            ) as response:
                record = json.load(response)
        except Exception as error:  # noqa: BLE001 - listed, never fatal
            left_out[game_id] = f"the public record could not be read ({error})"
            continue
        code = record.get("server_code")
        if not code:
            left_out[game_id] = "the public record has no server code"
        elif record.get("version") != entry["version_fetched"]:
            left_out[game_id] = (
                f"production is at version {record.get('version')} but the page was converted from "
                f"version {entry['version_fetched']}"
            )
        else:
            target.write_text(code, encoding="utf-8", newline="\n")


def process(games: list[Game], *, write: bool) -> tuple[list[str], dict[str, str]]:
    """Returns the review list (markdown lines) and the games that had to be left out."""
    review = []
    skipped: dict[str, str] = {}
    extras_file = ROOT / "tools" / "server_texts_extra.json"
    extras = json.loads(extras_file.read_text(encoding="utf-8")) if extras_file.exists() else {}
    totals = [0, 0, 0]
    for game in games:
        if game.server is None:
            skipped[game.name] = "no server code in the repository"
            continue
        page = game.page.read_text(encoding="utf-8")
        table = read_table(page)
        if table is None:
            skipped[game.name] = "the page has no i18n-strings block"
            continue
        result = extract(game.server.read_text(encoding="utf-8"))
        for text in extras.get(game.name, []):
            result.found.append(Found("InvalidMove", 0, text, "tools/server_texts_extra.json"))
        templates = list(dict.fromkeys(f.template for f in result.found))
        new = assign_keys(templates, table)
        totals[0] += len(templates)
        totals[1] += len(new)
        totals[2] += len(result.unreadable)
        if write and new:
            if len(table) + len(new) > 400:
                skipped[game.name] = f"{len(table) + len(new)} texts would pass the limit of 400"
                continue
            game.page.write_bytes(add_to_page(page, new).encode("utf-8"))
        review.append(f"\n### {game.name}\n")
        review.append(f"{len(templates)} templates, {len(new)} new, {len(result.unreadable)} unreadable\n")
        notes = {f.template: f for f in result.found if f.notes}
        for f in notes.values():
            review.append(f"- `{f.template}` (line {f.line}): {'; '.join(f.notes)}")
        if any(f.kind == "state" for f in result.found):
            states = sorted({f.template for f in result.found if f.kind == "state"})
            review.append("- state texts (log lines, labels, descriptions; wrap them with `tx(...)` in the page): "
                          + "; ".join(f"`{t}`" for t in states))
        for line, source, reason in result.unreadable:
            review.append(f"- NOT READ, line {line}: `{source}`: {reason}")
    review.insert(0, f"Templates found: {totals[0]}, added: {totals[1]}, not readable: {totals[2]}.")
    return review, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--write", action="store_true", help="add the keys to the pages (default: dry run)")
    parser.add_argument("--report", type=Path, help="write the review list here (markdown)")
    parser.add_argument("--server", type=Path)
    parser.add_argument("--page", type=Path)
    parser.add_argument("--fetch-community", metavar="BASE_URL", help="read the community games' server code from BASE_URL")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    left_out: dict[str, str] = {}
    if args.fetch_community:
        fetch_community(args.fetch_community, left_out)
    if args.server and args.page:
        games = [Game(args.page.name, args.page, args.server)]
    else:
        games = games_in_repo()
    review, skipped = process(games, write=args.write)
    for game_id, reason in left_out.items():
        skipped[f"community/{game_id}.html"] = reason
    if skipped:
        review.append("\n### Left out\n")
        review.extend(f"- {name}: {reason}" for name, reason in skipped.items())
    text = "# Server texts: review list\n\n" + "\n".join(review) + "\n"
    if args.report:
        args.report.write_text(text, encoding="utf-8", newline="\n")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
