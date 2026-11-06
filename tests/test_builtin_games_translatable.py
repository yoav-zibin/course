"""The built-in games whose client page is translatable (docs/game-translation.md)."""

from pathlib import Path

import pytest

from game_platform import game_text

GAMES = Path(__file__).resolve().parent.parent / "games"

TRANSLATABLE = [
    "tictactoe.html",
    "poker.html",
    "audit-batch1/battleship.html",
    "audit-batch1/beat-the-landlord.html",
    "audit-batch1/crazy-eights.html",
    "audit-batch1/go-fish.html",
    "audit-batch1/lost-cities.html",
    "audit-batch1/president.html",
    "audit-batch2/3-minute-chess.html",
    "audit-batch2/4-player-chess.html",
    "audit-batch2/blokus.html",
    "audit-batch2/guandan.html",
    "audit-batch2/mini-golf-duels.html",
    "audit-batch2/quoridor.html",
]


@pytest.mark.parametrize("name", TRANSLATABLE)
def test_the_page_passes_the_translation_lint(name: str) -> None:
    assert game_text.lint((GAMES / name).read_text(encoding="utf-8")) == []


@pytest.mark.parametrize("name", TRANSLATABLE)
def test_the_page_uses_the_current_helper(name: str) -> None:
    code = (GAMES / name).read_text(encoding="utf-8")
    assert game_text.HELPER_JS.strip() in code
