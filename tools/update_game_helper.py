"""Re-pastes the current game_i18n_helper.js into every game page that carries an older copy.

    python tools/update_game_helper.py            # rewrite the pages
    python tools/update_game_helper.py --check    # only report pages that are out of date

A page's copy starts at the line "// Translation helper (docs/game-translation.md)" and ends
with the closing brace of `applyLocale`. Pages without a copy (and the `*.original.html`
snapshots of games before they were converted) are left alone. Run it after changing the
helper; game_text.HELPER_JS (the agent's prompt) reads the same file.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HELPER = (ROOT / "game_i18n_helper.js").read_text(encoding="utf-8")
START = "// Translation helper (docs/game-translation.md)"
_COPY = re.compile(re.escape(START) + r".*?\nfunction applyLocale\(message\) \{.*?\n\}\n", re.S)


def pages() -> list[Path]:
    found = [*ROOT.glob("games/*.html"), *ROOT.glob("games/*/*.html")]
    return sorted(p for p in found if not p.name.endswith(".original.html"))


def update(path: Path, *, write: bool) -> str:
    """'current', 'updated', 'updated (dry run)' or 'no helper'."""
    raw = path.read_bytes().decode("utf-8")
    crlf = "\r\n" in raw
    code = raw.replace("\r\n", "\n")
    if START not in code:
        return "no helper"
    new, count = _COPY.subn(lambda _m: HELPER.replace("\r\n", "\n"), code)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one helper copy, found {count}")
    if new == code:
        return "current"
    if write:
        path.write_bytes((new.replace("\n", "\r\n") if crlf else new).encode("utf-8"))
    return "updated" if write else "out of date"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true", help="report only; exit 1 if any page is out of date")
    args = parser.parse_args()
    outdated = 0
    for path in pages():
        result = update(path, write=not args.check)
        if result != "no helper":
            print(f"{result:12} {path.relative_to(ROOT)}")
        outdated += result == "out of date"
    return 1 if args.check and outdated else 0


if __name__ == "__main__":
    sys.exit(main())
