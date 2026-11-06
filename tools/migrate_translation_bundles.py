#!/usr/bin/env python3
"""Folds the old one-row-per-translation documents into one bundle per language.

Run once on the VM after deploying the version that reads bundles (it keeps working before:
until the bundles exist, the server reads the old rows once at startup). Safe to run again,
and while the server is running: it only adds entries that no bundle has yet, and a
translation the server wrote meanwhile is never overwritten.

    python3 -m game_platform.tools.migrate_translation_bundles --project PROJECT \
        --database DATABASE --namespace NAMESPACE --dry-run
    python3 -m game_platform.tools.migrate_translation_bundles --project PROJECT \
        --database DATABASE --namespace NAMESPACE

The three values are the `firestore` section of config.json (`project_id`, `database`,
`namespace`). The old rows are left where they are (delete the `<namespace>_translations`
collection later if you like); after the run the server ignores them. See
docs/game-translation.md.
"""

from __future__ import annotations

import argparse
import datetime as dt
from typing import Any


def migrate(client: Any, namespace: str, *, dry_run: bool = False) -> dict[str, int]:
    """Folds the old rows of [namespace] into bundles; returns the counts."""
    from game_platform.query_store import QueryStore, _BundleBackend
    from game_platform.translation_bundle import TranslationMemory, unpack

    store = QueryStore(client, namespace=namespace)
    backend = _BundleBackend(store, ignore_migrated_marker=True)
    old_rows = backend.read_legacy() or []
    old = {(row.locale, row.source_hash) for row in old_rows}
    bundled = {
        (document["locale"], source_hash)
        for document in backend.read_bundles()
        for source_hash in (document.get("entries") or {})
    }
    counts = {"old_rows": len(old), "already_bundled": len(old & bundled)}
    if dry_run:
        counts["to_fold"] = len(old - bundled)
        return counts
    counts["folded"] = TranslationMemory(backend).fold_legacy()
    # Verify from the database itself, not from memory.
    saved = {(row.locale, row.source_hash) for row in unpack(backend.read_bundles())}
    if old - saved:
        raise SystemExit(
            f"{len(old - saved)} translations are still missing from the bundles; "
            "the migration is not marked as done"
        )
    client.collection(namespace + "_meta").document("translations").set(
        {"bundled": True, "migrated_at": dt.datetime.now(dt.timezone.utc), "rows": len(old)}
    )
    counts["bundled_total"] = len(saved)
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--project", default="", help="Google Cloud project id")
    parser.add_argument("--database", default="(default)")
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--dry-run", action="store_true", help="only count, change nothing")
    args = parser.parse_args()
    from google.cloud import firestore

    client = firestore.Client(project=args.project or None, database=args.database)
    for name, value in migrate(client, args.namespace, dry_run=args.dry_run).items():
        print(f"{name}: {value}")
    print("dry run: nothing was changed" if args.dry_run else "done")


if __name__ == "__main__":
    main()
