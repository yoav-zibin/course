"""Run the hourly, resumable account-deletion sweep against the configured store."""

import argparse
import json
import logging
import time
from contextlib import ExitStack
from pathlib import Path

from game_platform.config import load_config

logger = logging.getLogger(__name__)


def open_store(config):
    """Use the API's explicit database/namespace, never a snapshot writer."""
    if not config.firestore.enabled:
        raise ValueError("The deletion worker requires query-mode Firestore")
    if (config.firestore.database == "(default)"
            and not config.firestore.allow_default_database_query):
        raise ValueError("The default database requires the existing production opt-in")
    from google.cloud import firestore
    from game_platform.query_store import QueryStore

    client = firestore.Client(project=config.firestore.project_id or None,
                              database=config.firestore.database)
    try:
        return client, QueryStore(client, namespace=config.firestore.namespace)
    except BaseException:
        client.close()
        raise


def sweep(platform, *, limit, max_steps, max_seconds, clock=time.monotonic):
    """Drain bounded passes without postponing every batch to another hour."""
    from game_platform.account_deletion import run_due_account_deletions

    deadline = clock() + max_seconds
    totals = {"claimed": 0, "completed": 0, "processed": 0, "passes": 0,
              "more_work_may_remain": False}
    while totals["processed"] < max_steps and clock() < deadline:
        result = run_due_account_deletions(
            platform, limit=limit, max_steps=min(1000, max_steps-totals["processed"]))
        totals["passes"] += 1
        for key in ("claimed", "completed", "processed"):
            totals[key] += result.get(key, 0)
        totals["more_work_may_remain"] = bool(result.get("more_work_may_remain"))
        if not totals["more_work_may_remain"] or not result.get("processed", 0):
            break
    return totals


def bounded_int(minimum, maximum):
    def parse(text):
        value = int(text)
        if not minimum <= value <= maximum:
            raise argparse.ArgumentTypeError(f"must be between {minimum} and {maximum}")
        return value
    return parse


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--limit", type=bounded_int(1, 100), default=25)
    parser.add_argument("--max-steps", type=bounded_int(1, 100_000), default=50_000)
    parser.add_argument("--max-seconds", type=bounded_int(1, 3000), default=1800)
    parser.add_argument("--check-config", action="store_true",
                        help="Check storage connectivity without claiming or deleting accounts")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        config = load_config(args.config)
        with ExitStack() as resources:
            client, store = open_store(config)
            resources.callback(client.close)
            resources.callback(store.close)
            if store.health() is not None:
                raise RuntimeError("Configured query storage is unavailable")
            if args.check_config:
                print(json.dumps({"mode": "check-config", "storage": "ok",
                                  "namespace": config.firestore.namespace}))
                return 0
            from game_platform.scaling_service import ScalablePlatform

            # This maintenance task needs neither catalog validation nor gameplay,
            # translation, push-delivery or HTTP workers.
            platform = ScalablePlatform(store=store, check_game_schemas=False)
            resources.callback(platform.close_workers)
            result = sweep(platform, limit=args.limit, max_steps=args.max_steps,
                           max_seconds=args.max_seconds)
            print(json.dumps(result, sort_keys=True))
            if result["more_work_may_remain"]:
                logger.warning("Deletion work remains; durable progress will resume next run")
            return 0
    except Exception as error:
        # Validation errors may embed private configuration or a user record.
        # Neither configuration nor exception values belong in the journal.
        logger.error("Account deletion job failed (%s); durable work can be retried",
                     type(error).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
