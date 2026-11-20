"""Real query-store migration behavior, including held-pot recovery."""

import copy
import datetime as dt
import json
from dataclasses import replace

import pytest

from game_platform import match_kind_migration as migration
from game_platform.models import Match, Move, Seat, User
from game_platform.tests.fake_firestore import query_store

NOW = dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc)


def match(store, identity, humans=("alice",), computers=0, **kwargs):
    seats = tuple(Seat(player_index=i, kind="human", user_id=user)
                  for i, user in enumerate(humans))
    seats += tuple(Seat(player_index=len(seats)+i, kind="computer", user_id=None)
                   for i in range(computers))
    value = Match(id=identity, game_id="game", game_version=1, owner_user_id="alice",
                  status="ongoing", seats=seats, state={"unchanged": True},
                  turn_of_player_indices=frozenset({0}), end_reason=None,
                  moves=(Move(move_number=1, player_index=0, made_by_user_id="alice",
                              created_at=NOW, new_state={"unchanged": True},
                              next_turn_player_indices=frozenset({0})),),
                  hidden_for_user_ids=frozenset(), created_at=NOW, updated_at=NOW,
                  **kwargs)
    store.put_match(value)
    ref = store.ref("matches", identity)
    row = ref.get().to_dict()
    payload = json.loads(row["json"])
    payload.pop("match_kind", None)
    row.pop("match_kind", None)
    row["unknown"] = b"preserved"
    row["json"] = json.dumps(payload)
    ref.set(row)
    return ref, row


def finish(store, directory, **kwargs):
    for _ in range(20):
        result = migration.cleanup(store, directory, page_size=1, max_documents=1, **kwargs)
        if result["complete"]:
            return result
    raise AssertionError("Migration did not finish")


def test_backfill_preserves_state_and_moves_and_deletion_refunds_atomically(tmp_path):
    store = query_store("match_kinds")
    try:
        for user in ("alice", "bob"):
            store.put_user(User(id=user, display_name=user, password="not-a-real-credential",
                                token_balance=5, created_at=NOW, updated_at=NOW))
        computer, original = match(store, "computer", computers=1)
        solo, _ = match(store, "solo")
        multiplayer, _ = match(store, "multiplayer", humans=("alice", "bob"))
        invalid, _ = match(store, "mixed", humans=("alice", "bob"), computers=1,
                           token_pot=10, bet_per_player=5)
        before_children = {path: copy.deepcopy(row) for path, row in store.client.docs.items()
                           if "/moves/" in path}
        result = finish(store, tmp_path / "apply", apply=True)
        assert result["counts"]["deleted"] == 1
        assert result["counts"]["updated"] == 3
        assert invalid.get().to_dict()["tombstone"]
        assert store.get_user("alice").token_balance == 10
        assert store.get_user("bob").token_balance == 10
        for ref, kind in ((computer, "computer"), (solo, "pass_and_play"),
                          (multiplayer, "multiplayer")):
            row = ref.get().to_dict()
            assert row["match_kind"] == kind
            assert json.loads(row["json"])["match_kind"] == kind
            assert json.loads(row["json"])["state"] == {"unchanged": True}
            assert row["unknown"] == b"preserved"
        assert computer.get().to_dict()["participants"] == ["alice"]
        assert {path: row for path, row in store.client.docs.items()
                if "/moves/" in path} == before_children
        recoveries = [json.loads(file.read_text()) for file in (tmp_path / "apply/preimages").glob("*.json")]
        deleted = next(entry for entry in recoveries if entry["move_children"])
        assert any(entry["path"] == store.ref("users", "alice").path
                   for entry in deleted["documents"])
        assert len(deleted["move_children"]) == 1
        assert store.counts()["matches_total"] == 3
        writes = store.client.writes
        verified = finish(store, tmp_path / "verify", apply=True)
        assert verified["counts"]["backfill"] == verified["counts"]["invalid"] == 0
        assert store.client.writes == writes
    finally:
        store.close()


def test_dry_run_is_read_only_and_resume_source_is_bound(tmp_path):
    store = query_store("match_kind_audit")
    try:
        match(store, "computer", computers=2)
        match(store, "bad", humans=("alice", "bob"), computers=1)
        before = copy.deepcopy(store.client.docs)
        result = finish(store, tmp_path / "audit")
        assert result["counts"]["backfill"] == result["counts"]["invalid"] == 1
        assert store.client.docs == before
        assert not (tmp_path / "audit/preimages").exists()
        with pytest.raises(ValueError, match="different source"):
            migration.cleanup(store, tmp_path / "audit", apply=True)
    finally:
        store.close()


def test_incompatible_paid_single_owner_computer_match_is_deleted_and_refunded(tmp_path):
    store = query_store("paid_solo_migration")
    try:
        store.put_user(User(id="alice", display_name="Alice", password="test-only",
                            token_balance=5, created_at=NOW, updated_at=NOW))
        ref, _ = match(store, "paid-computer", computers=1, token_pot=5, bet_per_player=5)
        result = finish(store, tmp_path / "apply", apply=True)
        assert result["counts"]["invalid"] == result["counts"]["deleted"] == 1
        assert store.get_match("paid-computer") is None
        assert ref.get().to_dict()["tombstone"]
        assert store.get_user("alice").token_balance == 10
        assert store.counts()["matches_total"] == 0
    finally:
        store.close()


@pytest.mark.parametrize("humans,computers,status,explicit,expected", [
    (["alice"], 2, "ongoing", None, "computer"),
    (["alice", "bob"], 1, "ongoing", None, None),
    (["alice"], 1, "ongoing", "multiplayer", None),
    (["alice"], 0, "waiting_for_players", None, "multiplayer"),
    (["alice"], 0, "over", None, "pass_and_play"),
    (["alice", "bob"], 0, "ongoing", "pass_and_play", None),
    (["alice", None], 0, "ongoing", "pass_and_play", "pass_and_play"),
    (["bob"], 0, "ongoing", None, None),
])
def test_classifies_account_rosters(humans, computers, status, explicit, expected):
    payload = {"owner_user_id": "alice", "status": status, "match_kind": explicit,
               "seats": [{"kind": "human", "user_id": user} for user in humans]
                        + [{"kind": "computer", "user_id": None}] * computers}
    assert migration.classify(payload) == expected
