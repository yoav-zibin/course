"""Bounded, hash-guarded schema recovery for frozen historical game code.

Run before constructing GamePlatform or serving requests. This changes only the
missing contract on each exact existing version, including versions pinned by
old matches. It does not publish code, create versions, or provide a runtime
fallback for unknown games. QueryStore's operation lock makes each read/compare/
write a Firestore transaction; a concurrent edit aborts rather than being lost.
"""

from __future__ import annotations

from contextlib import nullcontext
from copy import deepcopy
from dataclasses import replace
import hashlib
import json
import logging
from pathlib import Path
import re
from typing import Any

from game_platform.game_schemas import compile_game_schemas
from game_platform.store import Store

logger = logging.getLogger(__name__)
RECOVERY_DIRECTORY = Path(__file__).resolve().parent / "games" / "schema-recovery"
MAX_RECOVERY_ENTRIES = 200
_SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def _sha256(code: str | None) -> str:
    return hashlib.sha256((code or "").encode("utf-8")).hexdigest()


def _load_recovery(directory: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Validate the entire immutable bundle before performing its first write."""
    entries = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    contracts = json.loads((directory / "contracts.json").read_text(encoding="utf-8"))
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_RECOVERY_ENTRIES:
        raise ValueError("schema recovery manifest must contain 1 to 200 entries")
    if not isinstance(contracts, dict):
        raise ValueError("schema recovery contracts must be an object")
    seen: set[tuple[str, int]] = set()
    checked: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("schema recovery entry must be an object")
        game_id, version = entry.get("id"), entry.get("version")
        if not isinstance(game_id, str) or not game_id or type(version) is not int or version < 1:
            raise ValueError("schema recovery entry needs an id and positive integer version")
        identity = (game_id, version)
        if identity in seen:
            raise ValueError(f"duplicate schema recovery entry: {game_id}@{version}")
        seen.add(identity)
        for field in ("client_sha256", "server_sha256"):
            value = entry.get(field)
            if not isinstance(value, str) or _SHA256.fullmatch(value) is None:
                raise ValueError(f"invalid schema recovery {field}: {game_id}@{version}")
        contract = entry.get("contract")
        if not isinstance(contract, str) or not contract or contract not in contracts:
            raise ValueError(f"missing reviewed contract: {game_id}@{version}")
        if contract in checked:
            continue
        schemas = contracts[contract]
        if not isinstance(schemas, dict) or set(schemas) != {"state", "move", "view"}:
            raise ValueError(f"invalid reviewed contract: {contract}")
        if any(not isinstance(schema, dict) or not schema for schema in schemas.values()):
            raise ValueError(f"reviewed contract cannot use a boolean or empty root schema: {contract}")
        compile_game_schemas(schemas)
        checked.add(contract)
    return entries, contracts


def apply_legacy_schema_recovery(
    store: Store, directory: Path | None = None
) -> list[dict[str, Any]]:
    """Fill missing contracts only for exact frozen, reviewed game versions.

    All non-schema fields come from the freshly read stored record, never the
    manifest. Existing author contracts always win, including stricter ones.
    Old/deleted/unpublished versions can still have ongoing matches, so preserve
    their visibility and recover them too. The bounded manifest is the read set;
    this function never scans users, matches, or all game versions.

    Snapshot stores have no cross-process operation lock and are only supported
    here during serial startup. Their own public write method handles saving;
    acquiring their non-reentrant private lock would deadlock nested calls.
    """
    try:
        entries, contracts = _load_recovery(directory or RECOVERY_DIRECTORY)
    except Exception as error:
        logger.exception("legacy-schema-recovery bundle could not be loaded")
        return [{"id": "legacy-schema-recovery", "status": "error", "detail": str(error)}]

    results: list[dict[str, Any]] = []
    for entry in entries:
        result: dict[str, Any] = {"id": entry["id"], "version": entry["version"]}
        try:
            schemas = contracts[entry["contract"]]
            # QueryStore buffers the complete comparison and write together.
            # Its commit checks the read document versions against concurrent
            # writers; a conflict leaves the author's record untouched.
            with getattr(store, "operation_lock", None) or nullcontext():
                game = store.get_game_version(entry["id"], entry["version"])
                if game is None:
                    result["status"] = "skipped_missing"
                elif game.game_schemas is not None:
                    result["status"] = (
                        "unchanged" if game.game_schemas == schemas else "skipped_existing_schema"
                    )
                elif game.server_code is None:
                    result["status"] = "skipped_client_only"
                elif (_sha256(game.code) != entry["client_sha256"]
                      or _sha256(game.server_code) != entry["server_sha256"]):
                    result["status"] = "skipped_code_hash"
                else:
                    store.put_game_version(replace(game, game_schemas=deepcopy(schemas)))
                    result["status"] = "updated"
        except Exception as error:
            # A transaction failure is reported, never treated as success and
            # never retried against a stale copy of the game.
            result.update(status="error", detail=str(error))
            logger.exception("legacy-schema-recovery failed for %s@%s", entry["id"], entry["version"])
        logger.info("legacy-schema-recovery: %s", json.dumps(result, sort_keys=True))
        results.append(result)
    return results
