#!/usr/bin/env python3
"""Delete every game/version outside the "2026 games added" sheet.

The keep list is the 35 sheet games (Doudizhu excluded: it has no repo id, and
"Beat the Landlord" is only a hypothesis for it) plus the one extra keeper the
2026-11-06 catalog audit names (Gomoku b59b79d7, the surviving Gomoku). Every
other live game/version is deleted: all versions of the 13 confirmed non-keep
games, and every version below latest for keep games. The delete set is
recomputed live from the store on every run; only the keep list and the
expected latest versions are embedded here.

    python -m game_platform.cleanup_2026_games --config config.json
    python -m game_platform.cleanup_2026_games --config config.json --apply \
        --confirm <token printed by the dry run> \
        --i-understand-this-deletes-matches --journal cleanup-journal.json

DRY-RUN IS THE DEFAULT: without --apply the script prints the full plan and
deletes nothing. --apply refuses unless:
- the live latest version of every keep game present matches the embedded
  expected latest (a stale manifest stops the run; the diff is printed),
- no unresolved game would be affected (Beat the Landlord, or the
  debug/poker/tictactoe fixtures, whose fate is still undecided),
- no unexpected live game id is present (anything not keep / delete /
  unresolved must be classified first),
- --confirm carries the token printed by a dry run of the same live state,
  and --i-understand-this-deletes-matches is given.

--apply deletes in this order: matches pinning a deleted (game_id, version)
first, via GamePlatform._delete_match_and_invites (which refunds any held pot
to the match's human players), then the game versions, then the games/<id>
docs (via the store's soft delete) for fully removed games, then drafts of
fully removed games. Test sessions carry no game id in the store record, so
they are counted in the plan but never deleted by this script. Game version
errors have no store delete API, so their counts are reported and the records
are left behind. Take Away has no game id (file-only, games/take-away.*), so
it is not in any set here; a live game of that name would show as unexpected.

A JSON journal of what was planned (dry run) or done (--apply) is written to
--journal (default cleanup-2026-games-journal.json in the working directory).
This script never touches production unless --config points at it; run the
dry run against the production config first and read the plan.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from game_platform.config import load_config
from game_platform.json_file_store import JsonFileStore
from game_platform.saving_store import SavingStore
from game_platform.service import GamePlatform
from game_platform.store import Store

# Sheet name -> (game id, expected latest version). Latest versions are the
# audit's (2026-11-06): every one matches the highest version in the repo's
# schema-recovery contracts except Stack Duel, whose audit latest (8) is one
# above the contracts' highest (7) — a v8 evidently exists live.
KEEP_LATEST: dict[str, int] = {
    "f4e55ca5-464e-4ad0-9aae-79f8cc3e7cad": 4,  # Checkers
    "87a0d4f0-7020-4397-9358-82daa3452960": 6,  # 4-player Chess
    "916ab616-6abf-4c92-83c5-43cbdd4c8ab9": 2,  # Bulls and Cows
    "79830aee-0a91-406d-a2f7-c103002203f7": 3,  # Nine Stars
    "3e816ad0-0823-4068-946f-cab07a8f7126": 4,  # Guandan
    "36e5f0d8-4806-439f-af08-b28c593347c1": 8,  # Stack Duel
    "c8039b20-7c3e-4993-bae1-f59dfacd1ccc": 3,  # Fox and Geese
    "d650dbad-c760-48db-a445-c9def2134ca1": 3,  # Brazilian Truco
    "875244c9-937c-481b-9883-16085f4f10f7": 2,  # Spades
    "9069ae35-61f3-4a38-8e5c-480e53f289b8": 4,  # BlackJack ("Blackjack Table")
    "dbf85e1d-cacc-4845-9bb4-de349e13b005": 3,  # MiniGolf ("Mini Golf Duels")
    "97b92313-84a8-4c0e-9a3c-9e23c270c970": 7,  # President
    "affb52d8-f070-4600-bc10-580af8bc06e0": 3,  # Mancala
    "cbd19f63-bc51-49a9-bb45-858ec9b12828": 4,  # Chutes & Ladders
    "7bed6e20-99b4-4749-888e-43b0e90ba866": 2,  # Connect Four
    "77181f30-f03a-4524-b662-33c1f6131389": 10,  # Battleship
    "db3a74e1-0df1-44bf-a060-4da18b3a7e6e": 4,  # Lost Cities
    "d1e3d28c-cb11-4f91-91b5-f746c8440cf6": 4,  # Rummy 500
    "2b02b029-eb34-436c-bf2a-0d53148a253e": 4,  # ERS
    "42d06892-449c-44d2-9251-7b9448ce4ddc": 3,  # War
    "571c1cc4-a48d-40be-88fd-df1d5cc21d10": 2,  # Nim
    "3a6438c0-c712-4301-ade9-eb4b60346658": 3,  # Blokus
    "4f49cbdc-cf96-4657-a50e-3082935e1cdf": 6,  # Last Floe
    "076f078a-56cd-44b3-8930-81abc488508a": 5,  # Chess
    "f8d1a658-3af8-483a-8555-0e02e7212be4": 3,  # 3 minute chess
    "d66436fd-b19c-4fcb-8280-9ae7fb75daf6": 3,  # hearts ("Hearts")
    "a1ca4c85-b8a5-4b63-a9dc-f01c87a0d65f": 2,  # SOS
    "b7e3617b-5592-4fa2-ab91-dcb9a42364c1": 5,  # Quoridor
    "c435beb6-12d7-427e-80ba-2ebb619cabfa": 3,  # 6 card Golf ("6-Card Golf")
    "f7a5f84d-dfed-496c-b1d3-fafda5cea92c": 3,  # Go Fish
    "78fd2784-c810-4f2a-8166-92776a817b7f": 4,  # guess who ("Guess Who?")
    "58bd6827-f156-4cd2-ac31-53953b6df61a": 3,  # spoons ("Spoons")
    "fc63dfc7-d091-460f-b9f9-5877851d64fa": 2,  # Dots and Boxes ("Dots & Boxes")
    "5e1786fb-2a04-4cbe-8047-caf129c84a22": 2,  # Reversi
    "22260b8e-cd94-4664-98e6-de8db8173ef9": 4,  # Crazy Eights
}
# Not on the 2026 sheet, but the audit says keep it: the surviving Gomoku
# after the duplicate 39a5e1f5 is deleted. Without this entry the migration
# could never apply while this game exists live (it would be "unexpected").
EXTRA_KEEP_LATEST: dict[str, int] = {
    "b59b79d7-660b-4823-8a81-159e0a6a2809": 3,  # Gomoku (audit-only keeper)
}
ALL_KEEP_LATEST: dict[str, int] = {**KEEP_LATEST, **EXTRA_KEEP_LATEST}

GAME_NAMES: dict[str, str] = {
    "f4e55ca5-464e-4ad0-9aae-79f8cc3e7cad": "Checkers",
    "87a0d4f0-7020-4397-9358-82daa3452960": "4-player Chess",
    "916ab616-6abf-4c92-83c5-43cbdd4c8ab9": "Bulls and Cows",
    "79830aee-0a91-406d-a2f7-c103002203f7": "Nine Stars",
    "3e816ad0-0823-4068-946f-cab07a8f7126": "Guandan",
    "36e5f0d8-4806-439f-af08-b28c593347c1": "Stack Duel",
    "c8039b20-7c3e-4993-bae1-f59dfacd1ccc": "Fox and Geese",
    "d650dbad-c760-48db-a445-c9def2134ca1": "Brazilian Truco",
    "875244c9-937c-481b-9883-16085f4f10f7": "Spades",
    "9069ae35-61f3-4a38-8e5c-480e53f289b8": "BlackJack",
    "dbf85e1d-cacc-4845-9bb4-de349e13b005": "MiniGolf",
    "97b92313-84a8-4c0e-9a3c-9e23c270c970": "President",
    "affb52d8-f070-4600-bc10-580af8bc06e0": "Mancala",
    "cbd19f63-bc51-49a9-bb45-858ec9b12828": "Chutes & Ladders",
    "7bed6e20-99b4-4749-888e-43b0e90ba866": "Connect Four",
    "77181f30-f03a-4524-b662-33c1f6131389": "Battleship",
    "db3a74e1-0df1-44bf-a060-4da18b3a7e6e": "Lost Cities",
    "d1e3d28c-cb11-4f91-91b5-f746c8440cf6": "Rummy 500",
    "2b02b029-eb34-436c-bf2a-0d53148a253e": "ERS",
    "42d06892-449c-44d2-9251-7b9448ce4ddc": "War",
    "571c1cc4-a48d-40be-88fd-df1d5cc21d10": "Nim",
    "3a6438c0-c712-4301-ade9-eb4b60346658": "Blokus",
    "4f49cbdc-cf96-4657-a50e-3082935e1cdf": "Last Floe",
    "076f078a-56cd-44b3-8930-81abc488508a": "Chess",
    "f8d1a658-3af8-483a-8555-0e02e7212be4": "3 minute chess",
    "d66436fd-b19c-4fcb-8280-9ae7fb75daf6": "hearts",
    "a1ca4c85-b8a5-4b63-a9dc-f01c87a0d65f": "SOS",
    "b7e3617b-5592-4fa2-ab91-dcb9a42364c1": "Quoridor",
    "c435beb6-12d7-427e-80ba-2ebb619cabfa": "6 card Golf",
    "f7a5f84d-dfed-496c-b1d3-fafda5cea92c": "Go Fish",
    "78fd2784-c810-4f2a-8166-92776a817b7f": "guess who",
    "58bd6827-f156-4cd2-ac31-53953b6df61a": "spoons",
    "fc63dfc7-d091-460f-b9f9-5877851d64fa": "Dots and Boxes",
    "5e1786fb-2a04-4cbe-8047-caf129c84a22": "Reversi",
    "22260b8e-cd94-4664-98e6-de8db8173ef9": "Crazy Eights",
    "b59b79d7-660b-4823-8a81-159e0a6a2809": "Gomoku (audit-only keeper)",
    "20a83777-0f59-4105-a09e-0267b9c15e40": "Backgammon",
    "8d523bfd-9632-4759-98de-717fb744180e": "Backgammon (copy)",
    "8f692b3e-5f36-41b8-8942-38f5c7b3dc14": "Cheat (BS)",
    "a5a16425-bc14-4260-9946-763b11f0739b": "Chopsticks",
    "8b87f4a0-3735-442b-bf9c-e1b24aaf2df8": "Dragonimo",
    "39a5e1f5-c20c-40b1-a633-a8457d273eaf": "Gomoku (duplicate)",
    "788b39a9-6358-4598-9903-92ce97aa5502": "Nine Stars (Demo)",
    "569fac2e-82eb-486b-9446-6afae3984efe": "Solo Countdown",
    "aac01cd8-9436-456b-9e8b-a5f87b815e07": "Star Count",
    "d00a8d7b-320e-43bc-824f-ff899ff93687": "Tap to 10",
    "3acab71b-7f71-41eb-88a9-864272c12c37": "Tic Tac Toe",
    "ad578d02-f485-4e11-a1d4-08bcd4f462a9": "Tower of Hanoi",
    "4d15d9d7-0788-4304-9b30-9b5c2bd7f487": "4x5 tictactoe",
    "5119b8b8-44b7-415b-b0d8-07c9e36fc273": "Beat the Landlord",
    "debug": "Debug game (fixture)",
    "poker": "Poker (fixture)",
    "tictactoe": "Tic-tac-toe (fixture)",
}

# Confirmed non-keep games: every live version is deleted. 13 ids; the audit's
# "18 ids" also counts Beat the Landlord (unresolved) and the three fixtures
# (unresolved) plus file-only Take Away (no id).
DELETE_ENTIRELY: dict[str, str] = {
    game_id: GAME_NAMES[game_id]
    for game_id in (
        "20a83777-0f59-4105-a09e-0267b9c15e40",
        "8d523bfd-9632-4759-98de-717fb744180e",
        "8f692b3e-5f36-41b8-8942-38f5c7b3dc14",
        "a5a16425-bc14-4260-9946-763b11f0739b",
        "8b87f4a0-3735-442b-bf9c-e1b24aaf2df8",
        "39a5e1f5-c20c-40b1-a633-a8457d273eaf",
        "788b39a9-6358-4598-9903-92ce97aa5502",
        "569fac2e-82eb-486b-9446-6afae3984efe",
        "aac01cd8-9436-456b-9e8b-a5f87b815e07",
        "d00a8d7b-320e-43bc-824f-ff899ff93687",
        "3acab71b-7f71-41eb-88a9-864272c12c37",
        "ad578d02-f485-4e11-a1d4-08bcd4f462a9",
        "4d15d9d7-0788-4304-9b30-9b5c2bd7f487",
    )
}

# Decided by nobody yet: never kept, never deleted. Any live version of one
# blocks --apply. Doudizhu itself has no id and is not in any set: if "Beat
# the Landlord" turns out to be Doudizhu it moves to KEEP_LATEST; until then
# it stays here. The fixtures stay here until they are kept as infra or
# deleted by an explicit decision.
UNRESOLVED: dict[str, str] = {
    "5119b8b8-44b7-415b-b0d8-07c9e36fc273": "Beat the Landlord: maybe Doudizhu, unconfirmed",
    "debug": "fixture: keep as infra or delete, undecided",
    "poker": "fixture: keep as infra or delete, undecided",
    "tictactoe": "fixture: keep as infra or delete, undecided",
}


def _name(game_id: str) -> str:
    return GAME_NAMES.get(game_id, game_id)


def build_plan(store: Store) -> dict[str, Any]:
    """Enumerates the live store and computes exactly what would be deleted.
    Deletes nothing. Old-version pairs are recomputed live, never hardcoded."""
    versions = store.list_all_game_versions()
    matches = store.list_all_matches()
    by_game: dict[str, list[int]] = {}
    live_names: dict[str, str] = {}
    for game in versions:
        by_game.setdefault(game.id, []).append(game.version)
        live_names[game.id] = game.name
    live_latest = {game_id: max(vs) for game_id, vs in by_game.items()}

    delete_pairs: list[list[Any]] = []
    remove_games: list[str] = []
    stale_manifest: list[dict[str, Any]] = []
    unresolved_affected: list[dict[str, Any]] = []
    unexpected: list[dict[str, Any]] = []
    for game_id, vs in sorted(by_game.items()):
        if game_id in ALL_KEEP_LATEST:
            expected = ALL_KEEP_LATEST[game_id]
            if live_latest[game_id] != expected:
                stale_manifest.append(
                    {
                        "game_id": game_id,
                        "name": _name(game_id),
                        "expected_latest": expected,
                        "live_latest": live_latest[game_id],
                    }
                )
            delete_pairs.extend(
                [game_id, version] for version in sorted(vs) if version < live_latest[game_id]
            )
        elif game_id in DELETE_ENTIRELY:
            delete_pairs.extend([game_id, version] for version in sorted(vs))
            remove_games.append(game_id)
        elif game_id in UNRESOLVED:
            unresolved_affected.append(
                {
                    "game_id": game_id,
                    "name": _name(game_id),
                    "reason": UNRESOLVED[game_id],
                    "versions": sorted(vs),
                }
            )
        else:
            unexpected.append(
                {
                    "game_id": game_id,
                    "name": live_names.get(game_id, game_id),
                    "versions": sorted(vs),
                }
            )

    doomed = {(game_id, version) for game_id, version in delete_pairs}
    affected_matches = [
        {
            "match_id": match.id,
            "game_id": match.game_id,
            "game_version": match.game_version,
            "status": match.status,
            "token_pot": match.token_pot,
        }
        for match in matches
        if (match.game_id, match.game_version) in doomed
    ]
    affected_matches.sort(key=lambda row: (row["game_id"], row["game_version"], row["match_id"]))

    # Drafts are keyed by game id, so drafts of fully removed games are
    # attributable; the draft scan covers current users only (the store has no
    # list-all-drafts). Test sessions carry no game id in the store record, so
    # they are counted for review and never deleted by this script.
    drafts_to_delete: list[dict[str, str]] = []
    test_session_count = 0
    for user in store.list_users():
        for draft in store.list_game_drafts(owner_user_id=user.id):
            if draft.id in remove_games:
                drafts_to_delete.append(
                    {"draft_id": draft.id, "owner_user_id": user.id}
                )
        test_session_count += len(
            store.list_game_test_sessions(owner_user_id=user.id)
        )
    drafts_to_delete.sort(key=lambda row: (row["draft_id"], row["owner_user_id"]))

    version_error_count = 0
    for game_id, version in delete_pairs:
        version_error_count += len(
            store.list_game_version_errors(game_id=game_id, version=version)
        )

    plan: dict[str, Any] = {
        "live_game_count": len(by_game),
        "live_version_count": len(versions),
        "live_match_count": len(matches),
        "live_latest": {game_id: live_latest[game_id] for game_id in sorted(live_latest)},
        "keep_game_count": len(ALL_KEEP_LATEST),
        "stale_manifest": stale_manifest,
        "unresolved_affected": unresolved_affected,
        "unexpected": unexpected,
        "delete_pairs": sorted(delete_pairs),
        "delete_version_count": len(delete_pairs),
        "remove_games": sorted(remove_games),
        "affected_matches": affected_matches,
        "affected_match_count": len(affected_matches),
        "total_pot_at_risk": sum(row["token_pot"] for row in affected_matches),
        "drafts_to_delete": drafts_to_delete,
        "test_session_count": test_session_count,
        "version_error_count": version_error_count,
        "blockers": [],
    }
    plan["blockers"] = plan_blockers(plan)
    plan["confirm_token"] = confirm_token(plan)
    return plan


def plan_blockers(plan: dict[str, Any]) -> list[str]:
    """Why --apply must refuse this plan (empty means it may proceed)."""
    blockers = []
    for row in plan["stale_manifest"]:
        blockers.append(
            f"stale manifest: {_name(row['game_id'])} live latest is "
            f"v{row['live_latest']}, expected v{row['expected_latest']}"
        )
    for row in plan["unresolved_affected"]:
        blockers.append(
            f"unresolved game would be affected: {_name(row['game_id'])} "
            f"({row['reason']}); versions {row['versions']}"
        )
    for row in plan["unexpected"]:
        blockers.append(
            f"unexpected live game: {row['name']} ({row['game_id']}); "
            f"versions {row['versions']} — classify it before applying"
        )
    return blockers


def confirm_token(plan: dict[str, Any]) -> str:
    """Binds an --apply to one exact live plan, so state that changed since
    the dry run cannot be applied under an old token."""
    digest = hashlib.sha256(
        json.dumps(
            {
                "delete_pairs": plan["delete_pairs"],
                "remove_games": plan["remove_games"],
                "affected_matches": [row["match_id"] for row in plan["affected_matches"]],
                "drafts_to_delete": plan["drafts_to_delete"],
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()[:16]
    return f"cleanup-2026-{digest}"


def print_plan(plan: dict[str, Any]) -> None:
    print(
        f"Live: {plan['live_game_count']} games, {plan['live_version_count']} "
        f"versions, {plan['live_match_count']} matches."
    )
    print(
        f"Plan: delete {plan['delete_version_count']} version(s), remove "
        f"{len(plan['remove_games'])} game(s) entirely, delete "
        f"{plan['affected_match_count']} match(es), delete "
        f"{len(plan['drafts_to_delete'])} draft(s)."
    )
    if plan["delete_pairs"]:
        print("Versions to delete (game_id@version):")
        for game_id, version in plan["delete_pairs"]:
            print(f"  {_name(game_id)} {game_id}@v{version}")
    if plan["remove_games"]:
        print("Games to remove entirely:")
        for game_id in plan["remove_games"]:
            print(f"  {_name(game_id)} {game_id}")
    if plan["affected_matches"]:
        print("Matches to delete (pot refunded to their human players first):")
        for row in plan["affected_matches"]:
            print(
                f"  {row['match_id']} {_name(row['game_id'])}@v{row['game_version']} "
                f"status={row['status']} token_pot={row['token_pot']}"
            )
        print(
            f"Pot-refund note: {plan['total_pot_at_risk']} token(s) held by those "
            "matches are refunded to their active human players by "
            "_delete_match_and_invites before anything else is deleted."
        )
    if plan["drafts_to_delete"]:
        print("Drafts to delete:")
        for row in plan["drafts_to_delete"]:
            print(f"  {row['draft_id']} (owner {row['owner_user_id']})")
    print(
        f"Test sessions in store (review only, never deleted here): "
        f"{plan['test_session_count']}. Game version-error records on deleted "
        f"versions (left behind; no store API deletes them): "
        f"{plan['version_error_count']}."
    )
    for blocker in plan["blockers"]:
        print(f"BLOCKER: {blocker}")
    if plan["blockers"]:
        print("--apply is refused until every blocker is resolved.")
    else:
        print(
            "No blockers. To apply, re-run with --apply --confirm "
            f"{plan['confirm_token']} --i-understand-this-deletes-matches"
        )


def apply_plan(store: Store, platform: GamePlatform, plan: dict[str, Any]) -> dict[str, Any]:
    """Applies [plan] after re-checking it against the live store. Matches
    first (with pot refunds), then versions, then whole games, then drafts.
    Raises ValueError when the live state no longer matches the plan or a
    blocker appeared; in that case nothing is deleted."""
    fresh = build_plan(store)
    if fresh["confirm_token"] != plan["confirm_token"]:
        raise ValueError(
            "live state changed since this plan was made; re-run the dry run "
            "and confirm the new token"
        )
    if fresh["blockers"]:
        raise ValueError("refusing to apply: " + "; ".join(fresh["blockers"]))
    deleted_matches: list[str] = []
    deleted_pairs: list[list[Any]] = []
    removed_games: list[str] = []
    deleted_drafts: list[str] = []
    with platform._lock:
        for row in plan["affected_matches"]:
            platform._delete_match_and_invites(row["match_id"])
            deleted_matches.append(row["match_id"])
        for game_id, version in plan["delete_pairs"]:
            # Fully removed games need their latest version deleted too; keep
            # games only ever delete below-latest versions, so the store's
            # latest-version guard still protects them here.
            store.delete_game_version(
                game_id,
                version,
                allow_latest=game_id in plan["remove_games"],
            )
            deleted_pairs.append([game_id, version])
        for game_id in plan["remove_games"]:
            store.delete_game(game_id)
            removed_games.append(game_id)
        for row in plan["drafts_to_delete"]:
            store.delete_game_draft(row["draft_id"])
            deleted_drafts.append(row["draft_id"])
    return {
        "deleted_matches": deleted_matches,
        "deleted_versions": deleted_pairs,
        "removed_games": removed_games,
        "deleted_drafts": deleted_drafts,
    }


def _open_store(config) -> Store:
    # Same store selection as export_game_schema_inventory.py.
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="server config JSON")
    parser.add_argument(
        "--apply", action="store_true", help="actually delete; dry-run by default"
    )
    parser.add_argument(
        "--confirm",
        default="",
        help="token printed by the dry run for this exact live state",
    )
    parser.add_argument(
        "--i-understand-this-deletes-matches",
        action="store_true",
        help="required with --apply: affected matches are deleted, with pot refunds",
    )
    parser.add_argument(
        "--journal",
        type=Path,
        default=Path("cleanup-2026-games-journal.json"),
        help="JSON journal of what was planned/done",
    )
    args = parser.parse_args(argv)
    if args.apply and not args.i_understand_this_deletes_matches:
        print("--apply requires --i-understand-this-deletes-matches", file=sys.stderr)
        return 2
    config = load_config(args.config)
    store = _open_store(config)
    try:
        # No GamePlatform here: constructing one backfills missing referral
        # codes, which would mutate the store during a dry run.
        plan = build_plan(store)
        print_plan(plan)
        if not args.apply:
            args.journal.write_text(
                json.dumps(
                    {"mode": "dry-run", "plan": plan, "result": None},
                    ensure_ascii=False,
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )
            print(f"Dry run only: nothing deleted. Journal: {args.journal}")
            return 0
        if args.confirm != plan["confirm_token"]:
            print(
                "--confirm does not match this live plan's token "
                f"({plan['confirm_token']}); re-run the dry run",
                file=sys.stderr,
            )
            return 2
        if plan["blockers"]:
            for blocker in plan["blockers"]:
                print(f"BLOCKER: {blocker}", file=sys.stderr)
            return 2
        platform = GamePlatform(store=store)
        result = apply_plan(store, platform, plan)
        args.journal.write_text(
            json.dumps(
                {"mode": "apply", "plan": plan, "result": result},
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(
            f"Applied: deleted {len(result['deleted_matches'])} match(es), "
            f"{len(result['deleted_versions'])} version(s), removed "
            f"{len(result['removed_games'])} game(s), deleted "
            f"{len(result['deleted_drafts'])} draft(s). Journal: {args.journal}"
        )
        return 0
    finally:
        if isinstance(store, SavingStore):
            store.close()


if __name__ == "__main__":
    raise SystemExit(main())
