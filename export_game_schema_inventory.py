"""Export selected game-version code and rules for JSON Schema authoring."""

import argparse
import dataclasses
import json
import re
from pathlib import Path
from typing import Any

from game_platform.config import load_config
from game_platform.json_file_store import JsonFileStore
from game_platform.saving_store import SavingStore
from game_platform.store import Store


def _open_store(config) -> Store:
    if config.firestore.enabled:
        from google.cloud import firestore

        from game_platform.query_store import QueryStore

        return QueryStore(
            firestore.Client(
                project=config.firestore.project_id or None,
                database=config.firestore.database,
            ),
            namespace=config.firestore.namespace,
        )
    return JsonFileStore(
        config.data_file.path,
        min_write_interval_seconds=0,
        backup_interval_seconds=config.data_file.backup_interval_seconds,
        backup_keep=config.data_file.backup_keep,
    )


def export_game_schema_inventory(
    store: Store, refs: list[str] | None = None
) -> dict[str, dict[str, Any]]:
    if refs is None:
        refs = [
            f"{game.id}@{game.version}"
            for game in store.list_all_game_versions()
            if game.server_code is not None and game.game_schemas is None
        ]
    inventory = {}
    for ref in dict.fromkeys(refs):
        game_id, at, version_text = ref.rpartition("@")
        if not at or not game_id or not version_text.isdecimal():
            raise ValueError(f"invalid game version reference: {ref}")
        version = int(version_text)
        game = store.get_game_version(game_id, version)
        if game is None:
            raise ValueError(f"game version not found: {ref}")
        if game.server_code is None:
            raise ValueError(f"version is not server-side: {ref}")
        inventory[ref] = {
            "name": game.name,
            "rules": dataclasses.asdict(game.rules),
            "server_code": game.server_code,
            "game_schemas": game.game_schemas,
        }
    return inventory


def _read_refs(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    refs = re.findall(r"[A-Za-z0-9_:-]+@\d+", text)
    if not refs:
        raise ValueError(f"no game-id@version references found in {path}")
    return list(dict.fromkeys(refs))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="server config JSON")
    parser.add_argument(
        "--refs",
        type=Path,
        help="optional text file of game-id@version references; defaults to all missing-schema server versions",
    )
    parser.add_argument("--output", type=Path, required=True, help="output JSON path")
    args = parser.parse_args()

    config = load_config(args.config)
    store = _open_store(config)
    try:
        refs = _read_refs(args.refs) if args.refs else None
        inventory = export_game_schema_inventory(store, refs)
        args.output.write_text(
            json.dumps(inventory, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Exported {len(inventory)} server-side game versions to {args.output}.")
    finally:
        if isinstance(store, SavingStore):
            store.close()


if __name__ == "__main__":
    main()
