"""Keep shared web/native practice on the deterministic server game API."""
from pathlib import Path

from game_platform.game_logic import _PRELUDE


def test_shared_practice_uses_the_server_runtime_prelude():
    source = (Path(__file__).parents[1] / "frontends" / "portal" / "src" / "game" / "practicePrelude.ts").read_text(
        encoding="utf-8"
    )
    browser_prelude = source.split("const PRACTICE_PRELUDE = String.raw`", 1)[1].split("`;", 1)[0]
    assert browser_prelude == _PRELUDE
