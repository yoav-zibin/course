"""Guarded, repeatable updates to published game code shipped with a release."""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from game_platform.service import GamePlatform

from game_platform.service import NotFoundError

logger = logging.getLogger(__name__)
BATCH1_DIRECTORY = Path(__file__).resolve().parent / "games" / "audit-batch1"
BATCH2_DIRECTORY = Path(__file__).resolve().parent / "games" / "audit-batch2"
BATCH3_DIRECTORY = Path(__file__).resolve().parent / "games" / "audit-batch3"
BATCH4_DIRECTORY = Path(__file__).resolve().parent / "games" / "audit-batch4"


def _sha256(code: str | None) -> str:
    return hashlib.sha256((code or "").encode("utf-8")).hexdigest()


def apply_audit_batch1(platform: GamePlatform) -> list[dict[str, Any]]:
    return _apply_audit_batch(platform, BATCH1_DIRECTORY, "audit-batch1")


def apply_audit_batch2(platform: GamePlatform) -> list[dict[str, Any]]:
    return _apply_audit_batch(platform, BATCH2_DIRECTORY, "audit-batch2")


def apply_audit_batch3(platform: GamePlatform) -> list[dict[str, Any]]:
    return _apply_audit_batch(platform, BATCH3_DIRECTORY, "audit-batch3")


def apply_audit_batch4(platform: GamePlatform) -> list[dict[str, Any]]:
    return _apply_audit_batch(platform, BATCH4_DIRECTORY, "audit-batch4")


def _apply_audit_batch(
    platform: GamePlatform, directory: Path, batch_name: str
) -> list[dict[str, Any]]:
    """Publish only reviewed originals; keep author edits and old versions intact.

    Each game is its own platform operation. The version/hash precondition and
    update share the operation lock (a store transaction for query-backed stores),
    so an intervening author update cannot be overwritten. update_game retains
    the normal server-code publish gate and writes both code parts together.
    """
    results: list[dict[str, Any]] = []
    try:
        entries = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if not isinstance(entries, list):
            raise ValueError("batch manifest must be a list")
    except Exception as error:
        logger.exception("%s manifest could not be loaded", batch_name)
        return [{"id": batch_name, "status": "error", "detail": str(error)}]

    for entry in entries:
        result: dict[str, Any] = {"id": entry.get("id"), "name": entry.get("name")}
        try:
            client = (directory / entry["client"]).read_text(encoding="utf-8")
            server = (directory / entry["server"]).read_text(encoding="utf-8")
            with platform._lock:
                try:
                    game = platform.get_game(entry["id"])
                except NotFoundError:
                    result["status"] = "skipped_missing_or_unpublished"
                else:
                    result["version"] = game.version
                    if game.deleted:
                        result["status"] = "skipped_deleted"
                    elif not game.published:
                        result["status"] = "skipped_missing_or_unpublished"
                    elif _sha256(game.code) == _sha256(client) and _sha256(
                        game.server_code
                    ) == _sha256(server):
                        result["status"] = "unchanged"
                    elif game.version != entry["expected_version"]:
                        result["status"] = "skipped_version"
                    elif (
                        _sha256(game.code) != entry["original_client_sha256"]
                        or _sha256(game.server_code) != entry["original_server_sha256"]
                    ):
                        result["status"] = "skipped_hash"
                    else:
                        updated = platform.update_game(
                            caller_id=game.owner_user_id,
                            game_id=game.id,
                            code=client,
                            server_code=server,
                            _admin=True,
                            # A slower production CPU still has to finish whole
                            # walks. Keep all checks and the 100ms call limit.
                            _test_budget_seconds=5.0 if batch_name in {"audit-batch2", "audit-batch3", "audit-batch4"} else 1.0,
                        )
                        result.update(status="updated", version=updated.version)
        except Exception as error:
            # One refused publish must not prevent checking the other games.
            result.update(status="error", detail=str(error))
            logger.exception("%s failed for %s", batch_name, result["id"])
        logger.info("%s: %s", batch_name, json.dumps(result, sort_keys=True))
        results.append(result)
    return results
