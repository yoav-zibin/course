"""Add a month of synthetic users, games, and matches to the scaling Firestore DB.

This tool is intentionally restricted to the game-platform-scaling project/database.
It writes records directly using the Firestore store's serialization format and never
calls the game builder or any model API.
"""

from __future__ import annotations

import argparse
import bisect
import datetime as dt
import json
import random
import re
from dataclasses import replace
from pathlib import Path
from typing import Any

from google.cloud import firestore

from game_platform.firestore_store import (
    _ITEM_ADAPTERS,
    _RECORD_ADAPTERS,
    _Writes,
    _document_id,
    _item_id,
    _write_text,
)
from game_platform.models import Game, GameRules, Match, Move, Seat, User

SCALING_PROJECT = "project-c9ca4f0b-4e47-43ff-847"
SCALING_DATABASE = "game-platform-scaling"
_DEFAULT_CONFIG = Path("/home/zachary/game_platform/config.scaling.json")
_RUN_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
_GENERIC_GAME_CODE = "<main><p>Synthetic scaling-test game.</p></main>"


def _random_time(rng: random.Random, start: dt.datetime, end: dt.datetime) -> dt.datetime:
    span = (end - start).total_seconds()
    return start + dt.timedelta(seconds=rng.random() * span)


def make_dataset(
    *,
    users_count: int,
    matches_count: int,
    games_count: int,
    end_at: dt.datetime,
    seed: int,
    run_id: str,
) -> tuple[list[User], list[Game], list[Match]]:
    """Builds synthetic records covering the 30 days ending at [end_at]."""
    if not _RUN_ID_PATTERN.fullmatch(run_id):
        raise ValueError("run_id must use lowercase letters, digits, and hyphens")
    if users_count < 2 and matches_count:
        raise ValueError("at least two users are required when creating matches")
    if users_count < 1 and games_count:
        raise ValueError("at least one user is required when creating games")
    if games_count < 1 and matches_count:
        raise ValueError("at least one game is required when creating matches")

    rng = random.Random(seed)
    start_at = end_at - dt.timedelta(days=30)
    users: list[User] = []
    for index in range(users_count):
        created_at = (
            start_at
            if index < 2
            else _random_time(rng, start_at, end_at)
        )
        user_id = f"synthetic-{run_id}-user-{index + 1:06d}"
        users.append(
            User(
                id=user_id,
                display_name=f"Synthetic player {index + 1:06d}",
                email=f"synthetic-{run_id}-{index + 1:06d}@example.invalid",
                password=f"synthetic-unused-{rng.getrandbits(256):064x}",
                created_at=created_at,
                updated_at=created_at,
            )
        )

    users_by_time = sorted((user.created_at, user.id) for user in users)
    user_times = [item[0] for item in users_by_time]
    user_ids_by_time = [item[1] for item in users_by_time]

    games: list[Game] = []
    for index in range(games_count):
        created_at = start_at if index == 0 else _random_time(rng, start_at, end_at)
        eligible_users = bisect.bisect_right(user_times, created_at)
        owner_user_id = user_ids_by_time[rng.randrange(eligible_users)]
        game_id = f"synthetic-{run_id}-game-{index + 1:06d}"
        games.append(
            Game(
                id=game_id,
                version=1,
                owner_user_id=owner_user_id,
                name=f"Synthetic game {index + 1:06d}",
                description="Synthetic placeholder game for scaling tests.",
                rules=GameRules(
                    allowed_player_counts=(2,),
                    allows_leave_mid_match=False,
                    allows_join_mid_match=False,
                ),
                code=_GENERIC_GAME_CODE,
                created_at=created_at,
                updated_at=created_at,
            )
        )

    games_by_time = sorted((game.created_at, game.id) for game in games)
    game_times = [item[0] for item in games_by_time]
    game_ids_by_time = [item[1] for item in games_by_time]

    matches: list[Match | None] = [None] * matches_count
    order = sorted(
        (
            _random_time(rng, start_at, end_at),
            index,
        )
        for index in range(matches_count)
    )
    for created_at, index in order:
        eligible_users = bisect.bisect_right(user_times, created_at)
        eligible_games = bisect.bisect_right(game_times, created_at)
        player_count = 1 if index % 10 == 9 else 2
        players = rng.sample(user_ids_by_time[:eligible_users], player_count)
        game_id = game_ids_by_time[rng.randrange(eligible_games)]
        game_version = 1
        status = (
            "waiting_for_players"
            if index % 10 == 9
            else "ongoing"
            if index % 10 in (7, 8)
            else "over"
        )
        updated_at = _random_time(rng, created_at, end_at)
        move_count = (
            0
            if status == "waiting_for_players"
            else rng.randint(1, 8)
            if status == "ongoing"
            else rng.randint(2, 12)
        )
        seats = tuple(
            Seat(player_index=seat_index, kind="human", user_id=user_id)
            for seat_index, user_id in enumerate(players)
        )
        moves = tuple(
            Move(
                move_number=move_number,
                player_index=move_number % player_count,
                made_by_user_id=players[move_number % player_count],
                created_at=created_at
                + (updated_at - created_at)
                * ((move_number + 1) / (move_count + 1)),
                new_state={"synthetic": True, "ply": move_number + 1},
                next_turn_player_indices=(
                    None
                    if status == "over" and move_number == move_count - 1
                    else frozenset({(move_number + 1) % player_count})
                ),
            )
            for move_number in range(move_count)
        )
        matches[index] = Match(
            id=f"synthetic-{run_id}-match-{index + 1:07d}",
            game_id=game_id,
            owner_user_id=players[0],
            game_version=game_version,
            status=status,
            seats=seats,
            state=moves[-1].new_state if moves else None,
            turn_of_player_indices=(
                frozenset({0}) if status == "ongoing" else None
            ),
            end_reason="finished" if status == "over" else None,
            moves=moves,
            hidden_for_user_ids=frozenset(),
            created_at=created_at,
            updated_at=updated_at,
            initial_state={"synthetic": True, "ply": 0} if moves else None,
            initial_turn_player_indices=frozenset({0}) if moves else None,
        )

    return users, games, [match for match in matches if match is not None]


def _client_and_prefix(config_path: Path) -> tuple[firestore.Client, str]:
    config = json.loads(config_path.read_text())
    firestore_config = config.get("firestore", {})
    if not firestore_config.get("enabled"):
        raise ValueError("Firestore must be enabled in the scaling config")
    project_id = firestore_config.get("project_id") or SCALING_PROJECT
    database = firestore_config.get("database") or "(default)"
    if project_id != SCALING_PROJECT or database != SCALING_DATABASE:
        raise ValueError(
            "Refusing to seed a non-scaling database; expected "
            f"{SCALING_PROJECT}/{SCALING_DATABASE}, got {project_id}/{database}"
        )
    return (
        firestore.Client(project=project_id, database=database),
        firestore_config.get("collection_prefix", ""),
    )


def _assert_absent(
    client: firestore.Client,
    prefix: str,
    run_id: str,
    *,
    users_count: int,
    matches_count: int,
    games_count: int,
) -> str:
    marker_id = f"synthetic-{run_id}"
    marker = client.collection(f"{prefix}meta").document(marker_id)
    if marker.get().exists:
        raise ValueError(
            f"Seed marker {marker_id!r} already exists; refusing to run twice"
        )

    references = [
        client.collection(f"{prefix}{collection}").document(_document_id(key))
        for collection, keys in (
            (
                "users",
                (
                    f"synthetic-{run_id}-user-{index + 1:06d}"
                    for index in range(users_count)
                ),
            ),
            (
                "game_versions",
                (
                    f"synthetic-{run_id}-game-{index + 1:06d}@1"
                    for index in range(games_count)
                ),
            ),
            (
                "matches",
                (
                    f"synthetic-{run_id}-match-{index + 1:07d}"
                    for index in range(matches_count)
                ),
            ),
        )
        for key in keys
    ]
    for offset in range(0, len(references), 400):
        existing = [
            document.reference.path
            for document in client.get_all(references[offset : offset + 400])
            if document.exists
        ]
        if existing:
            raise ValueError(
                "Refusing to overwrite an existing synthetic record: "
                + existing[0]
            )
    return marker_id


def _write_records(
    client: firestore.Client,
    prefix: str,
    users: list[User],
    games: list[Game],
    matches: list[Match],
) -> int:
    writes = _Writes(client)
    total = 0

    def put(collection: str, key: str, text: str, *, old_chunks: int = 1) -> None:
        nonlocal total
        reference = client.collection(f"{prefix}{collection}").document(
            _document_id(key)
        )
        _write_text(writes, reference, text, old_chunks)
        total += 1

    user_adapter = _RECORD_ADAPTERS["users"]
    for user in users:
        put("users", user.id, user_adapter.dump_json(user).decode())

    game_adapter = _RECORD_ADAPTERS["game_versions"]
    for game in games:
        put(
            "game_versions",
            f"{game.id}@{game.version}",
            game_adapter.dump_json(game).decode(),
        )

    match_adapter = _RECORD_ADAPTERS["matches"]
    move_adapter = _ITEM_ADAPTERS["matches"]
    for match in matches:
        parent = replace(match, moves=())
        put("matches", match.id, match_adapter.dump_json(parent).decode())
        for index, move in enumerate(match.moves):
            reference = (
                client.collection(f"{prefix}matches")
                .document(_document_id(match.id))
                .collection("moves")
                .document(_item_id(index))
            )
            _write_text(writes, reference, move_adapter.dump_json(move).decode(), 1)
            total += 1
    writes.commit()
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=_DEFAULT_CONFIG)
    parser.add_argument("--users", type=int, default=1_000)
    parser.add_argument("--matches", type=int, default=10_000)
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--run-id", default="october-2026")
    parser.add_argument("--seed", type=int, default=202610)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="generate and summarize records without connecting to Firestore",
    )
    args = parser.parse_args()
    if min(args.users, args.matches, args.games) < 0:
        parser.error("record counts must be non-negative")
    end_at = dt.datetime.now(dt.timezone.utc)
    users, games, matches = make_dataset(
        users_count=args.users,
        matches_count=args.matches,
        games_count=args.games,
        end_at=end_at,
        seed=args.seed,
        run_id=args.run_id,
    )
    move_count = sum(len(match.moves) for match in matches)
    if args.dry_run:
        print(
            json.dumps(
                {
                    "run_id": args.run_id,
                    "window_start": (end_at - dt.timedelta(days=30)).isoformat(),
                    "window_end": end_at.isoformat(),
                    "users": len(users),
                    "games": len(games),
                    "matches": len(matches),
                    "moves": move_count,
                    "firestore_documents": len(users)
                    + len(games)
                    + len(matches)
                    + move_count,
                    "builder_calls": 0,
                },
                indent=2,
            )
        )
        return

    client, prefix = _client_and_prefix(args.config)
    marker_id = _assert_absent(
        client,
        prefix,
        args.run_id,
        users_count=len(users),
        matches_count=len(matches),
        games_count=len(games),
    )
    marker = client.collection(f"{prefix}meta").document(marker_id)
    marker.set(
        {
            "kind": "synthetic-monthly-seed",
            "status": "writing",
            "run_id": args.run_id,
            "users": len(users),
            "games": len(games),
            "matches": len(matches),
            "moves": move_count,
            "started_at": end_at.isoformat(),
        }
    )
    try:
        written = _write_records(client, prefix, users, games, matches)
    except Exception as error:
        marker.set(
            {
                "kind": "synthetic-monthly-seed",
                "status": "failed",
                "run_id": args.run_id,
                "error_type": type(error).__name__,
            },
            merge=True,
        )
        raise
    marker.set(
        {
            "status": "complete",
            "firestore_documents_written": written,
            "completed_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        },
        merge=True,
    )
    print(
        f"Seeded {len(users)} users, {len(games)} games, {len(matches)} matches, "
        f"{move_count} moves ({written} Firestore documents); no builder calls made."
    )


if __name__ == "__main__":
    main()
