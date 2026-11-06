"""The 2026-games cleanup: delete_game_version guards and the migration plan/apply.

Live Firestore is never touched here: every test seeds an InMemoryStore (or a
QueryStore on the transactional Firestore fake, or a JsonFileStore on a tmp
file) and checks the plan/apply against that seed.
"""

import datetime as dt
import importlib.util
import json
from dataclasses import replace
from pathlib import Path

import pytest

from game_platform.json_file_store import JsonFileStore
from game_platform.models import Game, GameDraft, GameRules, Match, Seat, User
from game_platform.query_store import QueryStore
from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore

PACKAGE_DIR = Path(__file__).parent.parent
NOW = dt.datetime(2026, 11, 6, tzinfo=dt.timezone.utc)
RULES = GameRules(
    allowed_player_counts=(2,),
    allows_leave_mid_match=False,
    allows_join_mid_match=False,
)


def load_tool():
    spec = importlib.util.spec_from_file_location(
        "cleanup_2026_games", PACKAGE_DIR / "cleanup_2026_games.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tool = load_tool()
BATTLESHIP = "77181f30-f03a-4524-b662-33c1f6131389"
PRESIDENT = "97b92313-84a8-4c0e-9a3c-9e23c270c970"
CHEAT = "8f692b3e-5f36-41b8-8942-38f5c7b3dc14"
LANDLORD = "5119b8b8-44b7-415b-b0d8-07c9e36fc273"


def game(game_id, version, name="Game"):
    return Game(
        id=game_id,
        version=version,
        owner_user_id="author",
        name=name,
        description="Seeded game",
        rules=RULES,
        code="<div>seed</div>",
        server_code=None,
        created_at=NOW,
        updated_at=NOW,
    )


def user(user_id, balance=10):
    return User(
        id=user_id,
        display_name=user_id,
        password="<redacted>",
        token_balance=balance,
        created_at=NOW,
        updated_at=NOW,
    )


def match(match_id, game_id, version, *, status="ongoing", token_pot=0):
    return Match(
        id=match_id,
        game_id=game_id,
        owner_user_id="p0",
        game_version=version,
        status=status,
        seats=(
            Seat(player_index=0, kind="human", user_id="p0"),
            Seat(player_index=1, kind="human", user_id="p1"),
        ),
        state={},
        turn_of_player_indices=frozenset({0}),
        end_reason=None,
        moves=(),
        hidden_for_user_ids=frozenset(),
        created_at=NOW,
        updated_at=NOW,
        token_pot=token_pot,
    )


def seeded_store():
    """Battleship v1..v10 (v1..v9 doomed), President v1..v7 (kept), Cheat
    v1..v3 (removed entirely), a paid match pinning Battleship v9, a match
    pinning President v7, a match pinning Cheat v2, and a Cheat draft."""
    store = InMemoryStore()
    for user_id in ("author", "p0", "p1"):
        store.put_user(user(user_id))
    for version in range(1, 11):
        store.add_game_version(game(BATTLESHIP, version, "Battleship"))
    for version in range(1, 8):
        store.add_game_version(game(PRESIDENT, version, "President"))
    for version in (1, 2, 3):
        store.add_game_version(game(CHEAT, version, "Cheat (BS)"))
    store.put_match(match("m-battleship-old", BATTLESHIP, 9, token_pot=10))
    store.put_match(match("m-president", PRESIDENT, 7))
    store.put_match(
        match("m-cheat-old", CHEAT, 2, status="waiting_for_players")
    )
    store.put_game_draft(
        GameDraft(
            id=CHEAT,
            owner_user_id="author",
            name="Cheat (BS)",
            description="Seeded draft",
            rules=RULES,
            code="<div>seed</div>",
            server_code=None,
            game_schemas=None,
            created_at=NOW,
            updated_at=NOW,
            base_version=3,
            revision=1,
        )
    )
    return store


def test_delete_game_version_refuses_latest_unless_allowed():
    store = InMemoryStore()
    store.add_game_version(game("g", 1))
    store.add_game_version(game("g", 2))
    with pytest.raises(ValueError, match="latest"):
        store.delete_game_version("g", 2)
    assert store.get_game_version("g", 2) is not None
    store.delete_game_version("g", 2, allow_latest=True)
    assert store.get_game_version("g", 2) is None
    assert store.get_game("g").version == 1
    with pytest.raises(ValueError, match="no such game version"):
        store.delete_game_version("g", 2)
    with pytest.raises(ValueError, match="no such game version"):
        store.delete_game_version("missing", 1)


def test_delete_game_version_refuses_pinned_version_until_matches_go():
    store = seeded_store()
    with pytest.raises(ValueError, match="pinned by 1 match"):
        store.delete_game_version(BATTLESHIP, 9)
    assert store.get_game_version(BATTLESHIP, 9) is not None
    store.delete_match("m-battleship-old")
    store.delete_game_version(BATTLESHIP, 9)
    assert store.get_game_version(BATTLESHIP, 9) is None
    assert store.get_game(BATTLESHIP).version == 10


def test_delete_game_version_keeps_other_versions_and_survives_reload():
    store = InMemoryStore()
    for version in (1, 2, 3):
        store.add_game_version(game("g", version))
    store.delete_game_version("g", 2)
    assert store.get_game_version("g", 1) is not None
    assert store.get_game_version("g", 2) is None
    assert store.get_game_version("g", 3) is not None
    assert store.get_game("g").version == 3
    reloaded = InMemoryStore.of_snapshot(store.snapshot())
    assert [g.version for g in reloaded.list_all_game_versions()] == [1, 3]
    assert reloaded.get_game("g").version == 3
    reloaded.add_game_version(game("g", 4))
    assert reloaded.get_game("g").version == 4
    with pytest.raises(AssertionError):
        reloaded.put_game_version(game("g", 2))


def test_dry_run_plan_computes_correct_sets_and_deletes_nothing():
    store = seeded_store()
    before_versions = store.list_all_game_versions()
    before_matches = store.list_all_matches()
    plan = tool.build_plan(store)
    assert plan["delete_pairs"] == (
        [[BATTLESHIP, version] for version in range(1, 10)]
        + [[CHEAT, version] for version in (1, 2, 3)]
        + [[PRESIDENT, version] for version in range(1, 7)]
    )
    assert plan["remove_games"] == [CHEAT]
    assert [row["match_id"] for row in plan["affected_matches"]] == [
        "m-battleship-old",
        "m-cheat-old",
    ]
    assert plan["total_pot_at_risk"] == 10
    assert plan["drafts_to_delete"] == [
        {"draft_id": CHEAT, "owner_user_id": "author"}
    ]
    assert plan["blockers"] == []
    assert plan["confirm_token"].startswith("cleanup-2026-")
    # A dry-run plan is read-only.
    assert store.list_all_game_versions() == before_versions
    assert store.list_all_matches() == before_matches
    assert store.get_game_draft(CHEAT) is not None


def test_apply_deletes_matches_first_then_versions_and_refunds_pots():
    store = seeded_store()
    platform = GamePlatform(store=store, clock=lambda: NOW)
    plan = tool.build_plan(store)
    order: list[str] = []
    original_delete_match = platform._delete_match_and_invites
    original_delete_version = store.delete_game_version

    def traced_delete_match(match_id):
        order.append(f"match:{match_id}")
        return original_delete_match(match_id)

    def traced_delete_version(game_id, version, *, allow_latest=False):
        order.append(f"version:{game_id}@{version}")
        return original_delete_version(game_id, version, allow_latest=allow_latest)

    platform._delete_match_and_invites = traced_delete_match
    store.delete_game_version = traced_delete_version
    try:
        result = tool.apply_plan(store, platform, plan)
    finally:
        platform._delete_match_and_invites = original_delete_match
        store.delete_game_version = original_delete_version
    assert result == {
        "deleted_matches": ["m-battleship-old", "m-cheat-old"],
        "deleted_versions": [[BATTLESHIP, version] for version in range(1, 10)]
        + [[CHEAT, version] for version in (1, 2, 3)]
        + [[PRESIDENT, version] for version in range(1, 7)],
        "removed_games": [CHEAT],
        "deleted_drafts": [CHEAT],
    }
    # Every match deletion precedes every version deletion.
    first_version = next(i for i, step in enumerate(order) if step.startswith("version:"))
    assert all(step.startswith("match:") for step in order[:first_version])
    # The paid match's pot went back to its two humans, 5 tokens each.
    assert store.get_user("p0").token_balance == 15
    assert store.get_user("p1").token_balance == 15
    assert store.get_match("m-battleship-old") is None
    assert store.get_match("m-cheat-old") is None
    assert store.get_match("m-president") is not None
    assert store.get_game_version(BATTLESHIP, 9) is None
    assert store.get_game(BATTLESHIP).version == 10
    assert store.get_game_version(PRESIDENT, 6) is None
    assert store.get_game(PRESIDENT).version == 7
    assert store.get_game_version(CHEAT, 2) is None
    assert store.get_game_version(CHEAT, 3) is None
    assert store.get_game(CHEAT) is None
    assert store.get_game_draft(CHEAT) is None
    # A second plan on the cleaned store is empty.
    assert tool.build_plan(store)["delete_pairs"] == []


def test_apply_refuses_unresolved_beat_the_landlord():
    store = InMemoryStore()
    store.add_game_version(game(LANDLORD, 1, "Beat the Landlord"))
    store.add_game_version(game(LANDLORD, 2, "Beat the Landlord"))
    plan = tool.build_plan(store)
    assert plan["delete_pairs"] == []
    assert plan["blockers"] == [
        "unresolved game would be affected: Beat the Landlord "
        "(Beat the Landlord: maybe Doudizhu, unconfirmed); versions [1, 2]"
    ]
    with pytest.raises(ValueError, match="unresolved game"):
        tool.apply_plan(store, GamePlatform(store=store, clock=lambda: NOW), plan)
    assert store.list_all_game_versions() != []


def test_apply_refuses_stale_manifest_and_unexpected_games():
    store = InMemoryStore()
    for version in range(1, 12):
        store.add_game_version(game(BATTLESHIP, version, "Battleship"))
    plan = tool.build_plan(store)
    assert plan["blockers"] == [
        "stale manifest: Battleship live latest is v11, expected v10"
    ]
    with pytest.raises(ValueError, match="stale manifest"):
        tool.apply_plan(store, GamePlatform(store=store, clock=lambda: NOW), plan)
    assert [g.version for g in store.list_all_game_versions()] == list(range(1, 12))

    unknown = InMemoryStore()
    unknown.add_game_version(game("some-new-game", 1, "Some New Game"))
    plan = tool.build_plan(unknown)
    assert plan["blockers"] == [
        "unexpected live game: Some New Game (some-new-game); versions [1] "
        "— classify it before applying"
    ]
    with pytest.raises(ValueError, match="unexpected live game"):
        tool.apply_plan(unknown, GamePlatform(store=unknown, clock=lambda: NOW), plan)
    assert unknown.get_game("some-new-game") is not None


def test_apply_refuses_a_plan_from_changed_live_state():
    store = seeded_store()
    platform = GamePlatform(store=store, clock=lambda: NOW)
    plan = tool.build_plan(store)
    # A new match pinning a doomed version changes the plan's token.
    store.put_match(match("m-extra", BATTLESHIP, 9))
    with pytest.raises(ValueError, match="live state changed"):
        tool.apply_plan(store, platform, plan)
    assert store.get_match("m-extra") is not None
    assert store.get_game_version(BATTLESHIP, 9) is not None


def test_saving_store_version_delete_round_trips_through_a_file(tmp_path):
    path = tmp_path / "data.json"
    store = JsonFileStore(path, min_write_interval_seconds=0)
    try:
        for version in (1, 2, 3):
            store.add_game_version(game("g", version))
        store.delete_game_version("g", 2)
        store.flush()
    finally:
        store.close()
    reopened = JsonFileStore(path, min_write_interval_seconds=0)
    try:
        assert [g.version for g in reopened.list_all_game_versions()] == [1, 3]
        assert reopened.get_game("g").version == 3
        reopened.add_game_version(game("g", 4))
        assert reopened.get_game("g").version == 4
    finally:
        reopened.close()


# QueryStore on the transactional Firestore fake from the legacy-migration
# tests, extended with the where/order_by/limit calls _query makes.
from game_platform.tests.test_legacy_schema_migrations import (  # noqa: E402
    _Collection,
    _TransactionalClient,
)


class _WhereCollection(_Collection):
    def __init__(self, client, path):
        super().__init__(client, path)
        self._filters: list[tuple[str, str, object]] = []
        self._limit: int | None = None

    def _clone(self):
        clone = _WhereCollection(self.client, self.path)
        clone._filters = list(self._filters)
        clone._limit = self._limit
        return clone

    def where(self, filter=None, **_kwargs):
        clone = self._clone()
        clone._filters.append((filter.field_path, filter.op_string, filter.value))
        return clone

    def order_by(self, _field, **_kwargs):
        return self

    def limit(self, count):
        clone = self._clone()
        clone._limit = count
        return clone

    def stream(self, transaction=None):
        found = super().stream(transaction)
        kept = []
        for snapshot in found:
            data = snapshot.to_dict() or {}
            if all(
                (data.get(field) == value if op == "==" else value in (data.get(field) or []))
                for field, op, value in self._filters
            ):
                kept.append(snapshot)
        return kept if self._limit is None else kept[: self._limit]


class _WhereClient(_TransactionalClient):
    def collection(self, name):
        return _WhereCollection(self, name)


def _query_store():
    client = _WhereClient()
    client.docs["cleanup_meta/schema"] = {"version": 1}
    return QueryStore(client, namespace="cleanup")


def test_query_store_delete_game_version_guards_and_repoints_latest():
    store = _query_store()
    for version in (1, 2):
        store.add_game_version(game("g", version))
    with pytest.raises(ValueError, match="latest"):
        store.delete_game_version("g", 2)
    store.put_match(match("m1", "g", 1))
    with pytest.raises(ValueError, match="pinned"):
        store.delete_game_version("g", 1)
    store.delete_match("m1")
    store.delete_game_version("g", 1)
    assert store.get_game_version("g", 1) is None
    assert store.get_game("g").version == 2
    store.delete_game_version("g", 2, allow_latest=True)
    assert store.get_game_version("g", 2) is None
    assert store.get_game("g") is None


def test_cli_dry_run_then_apply_via_tmp_config(tmp_path, capsys):
    data_path = tmp_path / "data.json"
    store = JsonFileStore(data_path, min_write_interval_seconds=0)
    try:
        for user_id in ("author", "p0", "p1"):
            store.put_user(user(user_id))
        for version in (1, 2, 3):
            store.add_game_version(game(CHEAT, version, "Cheat (BS)"))
        for version in range(1, 8):
            store.add_game_version(game(PRESIDENT, version, "President"))
        store.put_match(match("m-cheat-old", CHEAT, 2, status="waiting_for_players"))
        store.flush()
    finally:
        store.close()
    config = json.loads((PACKAGE_DIR / "config.example.json").read_text())
    config["data_file"]["path"] = str(data_path)
    config["firestore"]["enabled"] = False
    config_path = tmp_path / "config.json"
    config_path.write_text(json.dumps(config))
    journal = tmp_path / "journal.json"
    # Dry run: prints the plan, writes the journal, deletes nothing.
    assert tool.main(["--config", str(config_path), "--journal", str(journal)]) == 0
    dry = json.loads(journal.read_text())
    assert dry["mode"] == "dry-run" and dry["result"] is None
    assert dry["plan"]["remove_games"] == [CHEAT]
    assert dry["plan"]["blockers"] == []
    out = capsys.readouterr().out
    assert "Dry run only: nothing deleted." in out
    assert "Cheat (BS)" in out
    check = JsonFileStore(data_path, min_write_interval_seconds=0)
    try:
        assert len(check.list_all_game_versions()) == 10
        assert check.get_match("m-cheat-old") is not None
    finally:
        check.close()
    # --apply without the token is refused; with it, the deletion happens.
    assert (
        tool.main(
            [
                "--config", str(config_path),
                "--apply",
                "--i-understand-this-deletes-matches",
                "--journal", str(journal),
            ]
        )
        == 2
    )
    assert (
        tool.main(
            [
                "--config", str(config_path),
                "--apply",
                "--confirm", dry["plan"]["confirm_token"],
                "--i-understand-this-deletes-matches",
                "--journal", str(journal),
            ]
        )
        == 0
    )
    applied = json.loads(journal.read_text())
    assert applied["mode"] == "apply"
    assert applied["result"]["removed_games"] == [CHEAT]
    assert applied["result"]["deleted_matches"] == ["m-cheat-old"]
    check = JsonFileStore(data_path, min_write_interval_seconds=0)
    try:
        assert check.get_game(CHEAT) is None
        assert check.get_match("m-cheat-old") is None
        assert check.get_game(PRESIDENT).version == 7
    finally:
        check.close()


def test_keep_list_is_35_sheet_games_plus_audit_gomoku():
    assert len(tool.KEEP_LATEST) == 35
    assert set(tool.KEEP_LATEST) <= set(tool.GAME_NAMES)
    assert tool.EXTRA_KEEP_LATEST == {
        "b59b79d7-660b-4823-8a81-159e0a6a2809": 3
    }
    assert len(tool.DELETE_ENTIRELY) == 13
    assert tool.UNRESOLVED["5119b8b8-44b7-415b-b0d8-07c9e36fc273"].startswith(
        "Beat the Landlord"
    )
    assert set(tool.UNRESOLVED) == {"5119b8b8-44b7-415b-b0d8-07c9e36fc273", "debug", "poker", "tictactoe"}
    assert not (set(tool.KEEP_LATEST) & set(tool.DELETE_ENTIRELY))
    assert not (set(tool.ALL_KEEP_LATEST) & set(tool.UNRESOLVED))
    assert json.dumps(tool.build_plan(InMemoryStore()))  # empty store plans cleanly
