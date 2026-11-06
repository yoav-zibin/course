"""Backfill Draft 2020-12 schemas on persisted v2 game versions."""

import argparse
import json
from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path
from typing import Any

from game_platform.config import Config, load_config
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


# Accepts any JSON for state, move and view: the behavior before schemas were required. A
# stopgap that gets a server started; replace it with the version's real schemas.
PERMISSIVE_SCHEMAS: dict[str, Any] = {"state": {}, "move": {}, "view": {}}


def missing_versions(store: Store) -> list[tuple[str, int]]:
    """The (game id, version) of every server-code version that has no schemas."""
    return sorted(
        (game.id, game.version)
        for game in store.list_all_game_versions()
        if game.server_code is not None and game.game_schemas is None
    )


def repo_schemas(games_dir: Path) -> dict[str, dict[str, Any]]:
    """The schemas shipped with the built-in games: games/<game id>.schema.json."""
    found: dict[str, dict[str, Any]] = {}
    for file in sorted(games_dir.glob("*.schema.json")):
        found[file.name.removesuffix(".schema.json")] = json.loads(
            file.read_text(encoding="utf-8")
        )
    return found


def plan_schema_map(
    missing: list[tuple[str, int]],
    supplied: Mapping[str, Mapping[str, Any]],
    *,
    shipped: Mapping[str, Mapping[str, Any]] | None = None,
    permissive_rest: bool = False,
) -> tuple[dict[str, Mapping[str, Any]], dict[str, str]]:
    """The schemas to write for each missing version, and where each came from.

    A version in [supplied] uses it. Otherwise the newest missing version of a game with a
    shipped schema file uses that file (older versions may have had other shapes), and the
    rest get permissive schemas only when [permissive_rest] is set.
    """
    newest: dict[str, int] = {}
    for game_id, version in missing:
        newest[game_id] = max(version, newest.get(game_id, 0))
    plan: dict[str, Mapping[str, Any]] = {}
    source: dict[str, str] = {}
    for game_id, version in missing:
        key = version_key(game_id, version)
        if key in supplied:
            plan[key], source[key] = supplied[key], "the schema map"
        elif shipped and game_id in shipped and version == newest[game_id]:
            plan[key], source[key] = shipped[game_id], f"games/{game_id}.schema.json"
        elif permissive_rest:
            plan[key], source[key] = PERMISSIVE_SCHEMAS, "permissive (no validation)"
    return plan, source


def open_store(config: Config) -> SavingStore:
    """The store the server itself would use for this configuration (see main.py)."""
    if config.firestore.enabled and config.firestore.mode == "query":
        from google.cloud import firestore

        from game_platform.query_store import QueryStore

        return QueryStore(
            firestore.Client(
                project=config.firestore.project_id or None,
                database=config.firestore.database,
            ),
            namespace=config.firestore.namespace,
        )
    if config.firestore.enabled:
        from game_platform.firestore_store import FirestoreStore

        return FirestoreStore.connect(
            project_id=config.firestore.project_id,
            database=config.firestore.database,
            collection_prefix=config.firestore.collection_prefix,
            min_write_interval_seconds=0,
        )
    return JsonFileStore(
        config.data_file.path,
        min_write_interval_seconds=0,
        backup_interval_seconds=config.data_file.backup_interval_seconds,
        backup_keep=config.data_file.backup_keep,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="server config JSON")
    parser.add_argument(
        "--schemas",
        type=Path,
        help="JSON map from game-id@version to its state/move/view schemas",
    )
    parser.add_argument(
        "--use-repo-schemas",
        action="store_true",
        help="use games/<id>.schema.json for the newest missing version of a built-in game",
    )
    parser.add_argument(
        "--permissive-rest",
        action="store_true",
        help="give every other missing version schemas that accept any JSON (a stopgap)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="list the missing versions and the schemas each would get; write nothing",
    )
    args = parser.parse_args()
    config = load_config(args.config)
    store = open_store(config)
    try:
        missing = missing_versions(store)
        supplied = _load_schema_map(args.schemas) if args.schemas else {}
        shipped = repo_schemas(Path(__file__).with_name("games")) if args.use_repo_schemas else None
        plan, source = plan_schema_map(
            missing, supplied, shipped=shipped, permissive_rest=args.permissive_rest
        )
        for game_id, version in missing:
            key = version_key(game_id, version)
            print(f"{key}: {source.get(key, 'NO SCHEMA GIVEN')}")
        if args.dry_run:
            print(f"{len(missing)} version(s) are missing schemas; nothing was written.")
            return
        count = backfill_game_schemas(store, plan)
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
