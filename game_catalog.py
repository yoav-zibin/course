"""Public catalog shared by the Portal's curated and recently played rows."""

import json
from dataclasses import dataclass, replace
from functools import lru_cache
from pathlib import Path

from game_platform.models import Game


@dataclass(frozen=True)
class GameCategory:
    id: str
    title: str
    game_ids: tuple[str, ...]


@lru_cache(maxsize=1)
def game_categories() -> tuple[GameCategory, ...]:
    manifest = Path(__file__).with_name("game_carousels.json")
    return tuple(
        GameCategory(row["id"], row["title"], tuple(row["games"]))
        for row in json.loads(manifest.read_text(encoding="utf-8"))
    )


@dataclass(frozen=True)
class GameCatalog:
    games: dict[str, Game]
    rows: dict[str, tuple[str, ...]]

    @classmethod
    def build(cls, games):
        playable = {
            game.id: replace(
                game, code="", server_code=None,
                import_package={
                    "declarative_ui": {},
                    "images": bool((game.import_package or {}).get("images")),
                },
            )
            for game in games
            if game.is_declarative and game.published and not game.deleted
        }
        rows = {
            row.id: tuple(game_id for game_id in row.game_ids if game_id in playable)
            for row in game_categories()
        }
        assigned = {game_id for row in rows.values() for game_id in row}
        unassigned = sorted(
            (game for game_id, game in playable.items() if game_id not in assigned),
            key=lambda game: (game.name.casefold(), game.id),
        )
        rows["miscellaneous"] += tuple(game.id for game in unassigned)
        return cls(playable, rows)
