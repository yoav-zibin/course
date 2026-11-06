"""tools/publish_game_code.py: which client file a game id on the command line stands for."""

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("publish_game_code", ROOT / "tools" / "publish_game_code.py")
assert _spec is not None and _spec.loader is not None
publish_game_code = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(publish_game_code)

BATTLESHIP_ID = "77181f30-f03a-4524-b662-33c1f6131389"


def test_a_file_name_is_an_id_for_the_original_built_in_games() -> None:
    assert publish_game_code.resolve("tictactoe") == ("tictactoe", ROOT / "games" / "tictactoe.html")


def test_a_manifest_id_finds_its_client_file() -> None:
    game_id, file = publish_game_code.resolve(BATTLESHIP_ID)
    assert game_id == BATTLESHIP_ID
    assert file == ROOT / "games" / "audit-batch1" / "battleship.html"


def test_id_equals_file_names_any_game() -> None:
    page = ROOT / "games" / "playroom" / "reversi.html"
    game_id, file = publish_game_code.resolve(f"some-id={page}")
    assert game_id == "some-id" and file == page
    assert publish_game_code.resolve("nosuch")[1] is None
