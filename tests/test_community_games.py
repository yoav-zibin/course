"""games/community: community games made translatable (docs/game-translation.md, "Converting an existing game")."""

import hashlib
import json
from pathlib import Path

import pytest

from game_platform import game_text

COMMUNITY = Path(__file__).resolve().parent.parent / "games" / "community"
MANIFEST = json.loads((COMMUNITY / "manifest.json").read_text(encoding="utf-8"))
GAMES = MANIFEST["games"]


def test_every_file_is_in_the_manifest() -> None:
    listed = {entry["converted"] for entry in GAMES} | {entry["original"] for entry in GAMES}
    on_disk = {path.name for path in COMMUNITY.glob("*.html")}
    assert on_disk == listed
    assert len(GAMES) == len({entry["id"] for entry in GAMES})


@pytest.mark.parametrize("entry", GAMES, ids=[entry["name"] + " " + entry["id"][:8] for entry in GAMES])
def test_converted_game_has_no_lint_problems(entry: dict) -> None:
    code = (COMMUNITY / entry["converted"]).read_text(encoding="utf-8")
    assert game_text.lint(code) == []
    table = game_text.extract_strings(code)
    assert table is not None and len([k for k in table if not k.startswith("server_")]) == entry["texts"]
    helper = game_text.HELPER_JS.strip()
    assert helper in code, "the platform helper is pasted unchanged"


@pytest.mark.parametrize("entry", GAMES, ids=[entry["id"][:8] for entry in GAMES])
def test_original_is_the_fetched_code_and_had_no_block(entry: dict) -> None:
    original = (COMMUNITY / entry["original"]).read_bytes()
    assert hashlib.sha256(original).hexdigest() == entry["original_sha256"]
    assert game_text.extract_strings(original.decode("utf-8")) is None
