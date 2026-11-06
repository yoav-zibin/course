"""Backfill Draft 2020-12 schemas on persisted v2 game versions."""

import argparse
import json
from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path
from typing import Any

from game_platform.config import load_config
from game_platform.game_schemas import compile_game_schemas
from game_platform.json_file_store import JsonFileStore
from game_platform.saving_store import SavingStore
from game_platform.store import Store


def version_key(game_id: str, version: int) -> str:
    return f"{game_id}@{version}"


def backfill_game_schemas(
    store: Store, schemas_by_version: Mapping[str, Mapping[str, Any]]
) -> int:
    """Validate a complete migration map before writing any changed versions."""
    versions = store.list_all_game_versions()
    missing = {
        version_key(game.id, game.version): game
        for game in versions
        if game.server_code is not None and game.game_schemas is None
    }
    supplied = set(schemas_by_version)
    if supplied != set(missing):
        absent = sorted(set(missing) - supplied)
        unexpected = sorted(supplied - set(missing))
        details = []
        if absent:
            details.append(f"missing schemas for {', '.join(absent)}")
        if unexpected:
            details.append(f"unexpected versions {', '.join(unexpected)}")
        raise ValueError("; ".join(details))

    for key, schemas in schemas_by_version.items():
        compile_game_schemas(schemas)

    for key, game in missing.items():
        store.put_game_version(replace(game, game_schemas=dict(schemas_by_version[key])))
    return len(missing)


def _load_schema_map(path: Path) -> dict[str, dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or any(
        not isinstance(key, str) or not isinstance(value, dict)
        for key, value in data.items()
    ):
        raise ValueError("schema map must be a JSON object keyed by game-id@version")
    return data


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="server config JSON")
    parser.add_argument(
        "--schemas",
        type=Path,
        required=True,
        help="JSON map from game-id@version to its state/move/view schemas",
    )
    args = parser.parse_args()
    config = load_config(args.config)
    if config.firestore.enabled:
        from game_platform.firestore_store import FirestoreStore

        store: SavingStore = FirestoreStore.connect(
            project_id=config.firestore.project_id,
            database=config.firestore.database,
            collection_prefix=config.firestore.collection_prefix,
            min_write_interval_seconds=0,
        )
    else:
        store = JsonFileStore(
            config.data_file.path,
            min_write_interval_seconds=0,
            backup_interval_seconds=config.data_file.backup_interval_seconds,
            backup_keep=config.data_file.backup_keep,
        )
    try:
        count = backfill_game_schemas(store, _load_schema_map(args.schemas))
        store.flush()
        if store.last_write_error is not None:
            raise RuntimeError(
                f"failed to persist schema backfill: {store.last_write_error}"
            )
        print(f"Backfilled game_schemas on {count} game version(s).")
    finally:
        store.close()


if __name__ == "__main__":
    main()
