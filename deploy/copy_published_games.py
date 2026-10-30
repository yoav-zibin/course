"""Copy public game records between configured Firestore databases.

The export contains only active, published game versions and their code. It never
exports users, matches, drafts, invites, or builder conversations. Import refuses to
overwrite game IDs already present in the destination unless their records are exact
matches, making reruns safe.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from google.cloud import firestore


def _client(config_path: Path) -> tuple[firestore.Client, str]:
    config = json.loads(config_path.read_text())
    firestore_config = config["firestore"]
    if not firestore_config.get("enabled"):
        raise ValueError(f"Firestore is not enabled in {config_path}")
    client = firestore.Client(
        project=firestore_config.get("project_id") or None,
        database=firestore_config.get("database") or "(default)",
    )
    return client, firestore_config.get("collection_prefix", "")


def _read_text(snapshot: Any) -> str:
    data = snapshot.to_dict()
    count = data.get("chunks", 1)
    if count == 1:
        return data["json"]
    chunks = snapshot.reference.collection("chunks").order_by("__name__").stream()
    parts = [data["json"], *(chunk.to_dict()["json"] for chunk in chunks)]
    if len(parts) != count:
        raise ValueError(
            f"{snapshot.reference.path}: expected {count} text chunks, found {len(parts)}"
        )
    return "".join(parts)


def _string_records(client: firestore.Client, collection: str) -> set[str]:
    return {
        json.loads(_read_text(document))
        for document in client.collection(collection).stream()
    }


def _raw_document(snapshot: Any) -> dict[str, Any]:
    return {
        "id": snapshot.id,
        "data": snapshot.to_dict(),
        "chunks": [
            {"id": chunk.id, "data": chunk.to_dict()}
            for chunk in snapshot.reference.collection("chunks")
            .order_by("__name__")
            .stream()
        ],
    }


def export_games(config_path: Path) -> None:
    client, prefix = _client(config_path)
    versions_collection = f"{prefix}game_versions"
    deleted = _string_records(client, f"{prefix}deleted_game_ids")
    unpublished = _string_records(client, f"{prefix}unpublished_game_ids")
    game_documents = list(client.collection(versions_collection).stream())
    records = [(document, json.loads(_read_text(document))) for document in game_documents]
    public_ids = {record["id"] for _, record in records} - deleted - unpublished
    selected = [
        (document, record)
        for document, record in records
        if record["id"] in public_ids
    ]
    selected.sort(key=lambda item: (item[1]["id"], item[1]["version"]))
    bundle = {
        "format": 1,
        "game_ids": sorted(public_ids),
        "versions": [
            {"game_id": record["id"], **_raw_document(document)}
            for document, record in selected
        ],
    }
    json.dump(bundle, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    sys.stderr.write(
        f"Exported {len(public_ids)} published games and {len(selected)} versions.\n"
    )


def _document_matches(
    client: firestore.Client, collection: str, source: dict[str, Any]
) -> bool:
    reference = client.collection(collection).document(source["id"])
    snapshot = reference.get()
    if not snapshot.exists or snapshot.to_dict() != source["data"]:
        return False
    target_chunks = [
        {"id": chunk.id, "data": chunk.to_dict()}
        for chunk in reference.collection("chunks").order_by("__name__").stream()
    ]
    return target_chunks == source["chunks"]


def import_games(config_path: Path, *, dry_run: bool) -> None:
    bundle = json.load(sys.stdin)
    if bundle.get("format") != 1:
        raise ValueError("Unsupported game-copy bundle format")
    client, prefix = _client(config_path)
    collection = f"{prefix}game_versions"
    game_ids = set(bundle["game_ids"])
    deleted = _string_records(client, f"{prefix}deleted_game_ids")
    unpublished = _string_records(client, f"{prefix}unpublished_game_ids")
    blocked = game_ids & (deleted | unpublished)
    if blocked:
        raise ValueError(
            f"Destination has deleted or unpublished markers for {len(blocked)} source game IDs"
        )

    destination_versions: dict[str, list[dict[str, Any]]] = {}
    for document in client.collection(collection).stream():
        record = json.loads(_read_text(document))
        if record["id"] in game_ids:
            destination_versions.setdefault(record["id"], []).append(
                _raw_document(document)
            )
    source_versions: dict[str, list[dict[str, Any]]] = {}
    for version in bundle["versions"]:
        source_versions.setdefault(version["game_id"], []).append(version)

    already_present: set[str] = set()
    for game_id, existing in destination_versions.items():
        incoming = source_versions.get(game_id, [])
        existing_by_id = {item["id"]: item for item in existing}
        incoming_by_id = {item["id"]: item for item in incoming}
        if existing_by_id.keys() != incoming_by_id.keys() or any(
            not _document_matches(client, collection, item)
            for item in incoming
        ):
            raise ValueError(
                f"Destination already has a different game record for {game_id}; no records were written"
            )
        already_present.add(game_id)

    writes: list[tuple[Any, dict[str, Any]]] = []
    for version in bundle["versions"]:
        if version["game_id"] in already_present:
            continue
        reference = client.collection(collection).document(version["id"])
        writes.append((reference, version["data"]))
        writes.extend(
            (reference.collection("chunks").document(chunk["id"]), chunk["data"])
            for chunk in version["chunks"]
        )

    new_games = len(game_ids) - len(already_present)
    if dry_run:
        sys.stderr.write(
            f"Would import {new_games} games, "
            f"{len(bundle['versions'])} versions, and {len(writes)} Firestore documents; "
            f"{len(already_present)} identical games are already present.\n"
        )
        return

    committed = 0
    batch = client.batch()
    pending = 0
    for reference, data in writes:
        batch.set(reference, data)
        pending += 1
        if pending == 400:
            batch.commit()
            committed += pending
            batch = client.batch()
            pending = 0
    if pending:
        batch.commit()
        committed += pending

    sys.stderr.write(
        f"Imported {new_games} games, {len(bundle['versions'])} versions, "
        f"and {committed} Firestore documents; "
        f"{len(already_present)} identical games were already present.\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("export", "import"))
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.mode == "export":
        export_games(args.config)
    else:
        import_games(args.config, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
