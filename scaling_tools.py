"""Initialize, seed and inspect the on-demand store.

Run with python -m game_platform.scaling_tools --help. All writes require an
explicit destination database and namespace. The maintenance commands are
offline: stop writers first. Checkpoints resume at a completed parent record,
never midway through a mutation.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
from dataclasses import replace

from google.cloud import firestore
from game_platform.models import (
    Game,
    GameRules,
    Match,
    Move,
    Seat,
    User,
)
from game_platform.query_store import QueryStore



def documents(collection, *, after=None, page_size=100):
    while True:
        query = collection.order_by("__name__").limit(page_size)
        if after:
            query = query.start_after({"__name__": collection.document(after)})
        docs = list(query.stream())
        if not docs:
            return
        for doc in docs:
            yield doc
        after = docs[-1].id


def seed(store, *, run_id, users, games, matches, moves_per_match, max_writes):
    if min(users, games) < 1 or min(matches, moves_per_match) < 0:
        raise ValueError("invalid seed sizes")
    # Conservative cap, including metadata, lookups, bodies and counters. A hard
    # operation budget must be chosen explicitly before any generation starts.
    estimated = users * 8 + games * 12 + matches * (16 + moves_per_match * 6)
    if estimated > max_writes:
        raise ValueError(
            f"estimated {estimated} writes exceeds --max-writes {max_writes}"
        )
    manifest = store.ref("seed_runs", run_id)
    settings = {
        "users": users,
        "games": games,
        "matches": matches,
        "moves_per_match": moves_per_match,
    }
    prior = store.raw_get(manifest) or {}
    if prior and prior.get("settings") != settings:
        raise ValueError("run ID already has different settings")
    base = dt.datetime(2026, 9, 1, tzinfo=dt.timezone.utc)

    def identity(kind, i):
        return f"synthetic-{run_id}-{kind}-{i}"

    for i in range(prior.get("users_done", 0), users):
        uid = identity("user", i)
        # A crash can occur between creating a user and saving the checkpoint.
        # Never reset a previously generated user (including its token balance)
        # when resuming that range.
        with store.atomic():
            if store.get_user(uid) is None:
                store.put_user(
                    User(
                        id=uid,
                        display_name=f"Synthetic {i}",
                        password=hashlib.sha256(uid.encode()).hexdigest(),
                        referral_code=hashlib.sha256(
                            (uid + "ref").encode()
                        ).hexdigest()[:16],
                        created_at=base,
                        updated_at=base,
                    )
                )
        if i % 100 == 0:
            store.raw_put(manifest, {"settings": settings, "users_done": i + 1})
    for i in range(prior.get("games_done", 0), games):
        gid = identity("game", i)
        if not store.get_game(gid):
            store.add_game_version(
                Game(
                    id=gid,
                    version=1,
                    owner_user_id=identity("user", i % users),
                    name=f"Synthetic countdown {i}",
                    description="Synthetic capacity fixture",
                    rules=GameRules(
                        allowed_player_counts=(1,),
                        allows_leave_mid_match=False,
                        allows_join_mid_match=False,
                    ),
                    code="<div>Synthetic fixture</div>",
                    created_at=base,
                    updated_at=base,
                )
            )
        if i % 100 == 0:
            store.raw_put(
                manifest,
                {"settings": settings, "users_done": users, "games_done": i + 1},
            )
    for i in range(prior.get("matches_done", 0), matches):
        mid = identity("match", i)
        created = base + dt.timedelta(seconds=(i * 7919) % (30 * 86400))
        current = store.get_match(mid)
        if not current:
            current = Match(
                id=mid,
                game_id=identity("game", i % games),
                game_version=1,
                owner_user_id=identity("user", i % users),
                status="ongoing" if moves_per_match else "over",
                end_reason=None if moves_per_match else "finished",
                seats=(
                    Seat(
                        player_index=0,
                        kind="human",
                        user_id=identity("user", i % users),
                    ),
                ),
                state={"remaining": moves_per_match},
                initial_state={"remaining": moves_per_match},
                initial_turn_player_indices=frozenset([0]),
                turn_of_player_indices=frozenset([0]) if moves_per_match else None,
                moves=(),
                hidden_for_user_ids=frozenset(),
                created_at=created,
                updated_at=created,
            )
            store.put_match(current)
        for n in range(len(current.moves), moves_per_match):
            current = store.get_match(mid)
            terminal = n + 1 == moves_per_match
            state = {"remaining": moves_per_match - n - 1}
            move = Move(
                move_number=n + 1,
                player_index=0,
                made_by_user_id=current.owner_user_id,
                created_at=created + dt.timedelta(seconds=n + 1),
                new_state=state,
                next_turn_player_indices=None if terminal else frozenset([0]),
            )
            current = replace(
                current,
                state=state,
                status="over" if terminal else "ongoing",
                end_reason="finished" if terminal else None,
                moves=current.moves.append(move),
                turn_of_player_indices=move.next_turn_player_indices,
                updated_at=move.created_at,
            )
            store.put_match(current)
        if i % 100 == 0:
            store.raw_put(
                manifest,
                {
                    "settings": settings,
                    "users_done": users,
                    "games_done": games,
                    "matches_done": i + 1,
                },
            )
    store.raw_put(
        manifest,
        {
            "settings": settings,
            "users_done": users,
            "games_done": games,
            "matches_done": matches,
            "complete": True,
        },
    )
    return {
        "run_id": run_id,
        "complete": True,
        "counts": store.counts(),
        "estimated_write_cap": estimated,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=[
            "init",
            "seed",
            "counts",
            "export",
            "validate",
            "cleanup",
            "dashboard",
            "activity",
            "merge",
            "delete-user",
            "libraries",
            "experiment-dashboard",
            "referral-dashboard",
        ],
    )
    parser.add_argument("--from-user", help="merge: the user merged away")
    parser.add_argument("--into-user", help="merge: the surviving user")
    parser.add_argument("--user-id", help="delete-user: the user to delete")
    parser.add_argument("--project", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--namespace", required=True)
    parser.add_argument(
        "--allow-production",
        action="store_true",
        help="allow maintenance of an explicitly named production namespace; never permits fake-data seeding",
    )
    parser.add_argument("--source-writers-stopped", action="store_true")
    parser.add_argument("--run-id", default="capacity-1")
    parser.add_argument("--as-of", help="dashboard window end date, YYYY-MM-DD")
    parser.add_argument("--users", type=int, default=100)
    parser.add_argument("--games", type=int, default=10)
    parser.add_argument("--matches", type=int, default=1000)
    parser.add_argument("--moves-per-match", type=int, default=5)
    parser.add_argument("--max-writes", type=int, default=0)
    parser.add_argument("--output", help="private export directory")
    parser.add_argument(
        "--cursor", help="next_cursor from the previous validation page"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="maximum parent records for validation/cleanup",
    )
    args = parser.parse_args()
    if (
        args.command
        in (
            "init",
            "seed",
            "cleanup",
            "dashboard",
            "activity",
            "merge",
            "delete-user",
            "libraries",
            "experiment-dashboard",
            "referral-dashboard",
        )
        and args.database == "(default)"
        and not os.environ.get("FIRESTORE_EMULATOR_HOST")
    ):
        if args.command in ("seed", "activity") or not args.allow_production:
            parser.error(
                "default-database maintenance requires --allow-production; fake-data generation is forbidden"
            )
    client = firestore.Client(project=args.project, database=args.database)
    store = (
        QueryStore.initialize(client, namespace=args.namespace)
        if args.command == "init"
        else QueryStore(client, namespace=args.namespace)
    )
    if args.command == "referral-dashboard":
        if not args.source_writers_stopped:
            parser.error("referral report requires stopped source writers")
        from game_platform.scaling_referrals import rebuild

        result = rebuild(store, run_id=args.run_id, max_records=args.limit)
    elif args.command == "experiment-dashboard":
        if not args.source_writers_stopped:
            parser.error("experiment report requires stopped source writers")
        from game_platform.scaling_experiment_report import rebuild

        result = rebuild(store, run_id=args.run_id, max_records=args.limit)
    elif args.command == "libraries":
        if not args.source_writers_stopped:
            parser.error("library normalization requires stopped writers")
        from game_platform.scaling_library import normalize

        result = normalize(store, run_id=args.run_id, max_records=args.limit)
    elif args.command == "activity":
        if not args.source_writers_stopped:
            parser.error("historical activity requires stopped destination writers")
        from game_platform.scaling_activity import generate

        result = generate(
            store,
            run_id=args.run_id,
            users=args.users,
            games=args.games,
            matches=args.matches,
            max_writes=args.max_writes,
        )
    elif args.command == "dashboard":
        if not args.source_writers_stopped:
            parser.error("dashboard rebuild requires stopped source writers")
        from game_platform.scaling_dashboard import rebuild

        result = rebuild(
            store, run_id=args.run_id, max_records=args.limit, as_of=args.as_of
        )
    elif args.command == "seed":
        result = seed(
            store,
            run_id=args.run_id,
            users=args.users,
            games=args.games,
            matches=args.matches,
            moves_per_match=args.moves_per_match,
            max_writes=args.max_writes,
        )
    elif args.command == "export":
        if not args.source_writers_stopped or not args.output:
            parser.error("export requires --source-writers-stopped and --output")
        from game_platform.scaling_maintenance import export_namespace

        result = export_namespace(store, args.output)
    elif args.command == "validate":
        from game_platform.scaling_maintenance import validate_matches

        result = validate_matches(store, limit=args.limit, cursor=args.cursor)
    elif args.command == "cleanup":
        from game_platform.scaling_maintenance import cleanup

        result = cleanup(store, limit=args.limit)
    elif args.command == "merge":
        if not args.source_writers_stopped:
            parser.error("merge requires a source write-maintenance window")
        if not args.from_user or not args.into_user:
            parser.error("merge requires --from-user and --into-user")
        from game_platform.scaling_accounts import merge_users

        result = merge_users(
            store,
            run_id=args.run_id,
            source_id=args.from_user,
            into_id=args.into_user,
            max_records=args.limit,
        )
    elif args.command == "delete-user":
        if not args.source_writers_stopped:
            parser.error("delete-user requires a source write-maintenance window")
        if not args.user_id:
            parser.error("delete-user requires --user-id")
        from game_platform.scaling_accounts import delete_user
        from game_platform.scaling_service import ScalablePlatform

        result = delete_user(
            store,
            run_id=args.run_id,
            user_id=args.user_id,
            max_records=args.limit,
            platform=ScalablePlatform(store=store),
        )
    else:
        result = store.counts()
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
