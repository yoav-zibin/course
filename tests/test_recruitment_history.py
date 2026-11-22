import datetime as dt
from dataclasses import replace

import pytest

from game_platform.models import User
from game_platform.recruitment_history import (
    backfill_nodes, canonical_user_id, inviter_chain, mark_deleted, mark_merged,
    record_attribution, record_node,
)
from game_platform.store import InMemoryStore
from game_platform.tests.fake_firestore import query_store


NOW = dt.datetime(2026, 11, 22, tzinfo=dt.timezone.utc)


@pytest.fixture(params=[False, True], ids=["memory", "query"])
def store(request):
    return query_store() if request.param else InMemoryStore()


def user(user_id, **kwargs):
    return User(id=user_id, display_name="Private name", password="private-password",
                email="private@example.test", created_at=NOW, updated_at=NOW, **kwargs)


def recruit(store, child, parent):
    record_node(store, child, NOW)
    return record_attribution(store, child, parent, via_match_id="shared-match", at=NOW)


def test_all_generations_survive_deleted_accounts_and_extend_when_root_is_recruited(store):
    store.put_user(user("root"))
    store.put_user(user("child"))
    store.put_user(user("grandchild"))
    recruit(store, "child", "root")
    recruit(store, "grandchild", "child")
    assert inviter_chain(store, "grandchild") == ["child", "root"]
    recruit(store, "root", "earlier-root")
    assert inviter_chain(store, "grandchild") == ["child", "root", "earlier-root"]
    mark_deleted(store, "child", NOW)
    store.delete_user("child")
    mark_deleted(store, "root", NOW)
    store.delete_user("root")
    assert inviter_chain(store, "grandchild") == ["child", "root", "earlier-root"]
    node = store.get_analytics("recruitment_nodes", "child")
    assert node["deleted_at"] == NOW.isoformat()
    assert "Private name" not in str(node)
    assert "private@example.test" not in str(node)
    assert "private-password" not in str(node)


def test_first_inviter_wins_and_self_links_and_cycles_are_rejected(store):
    recruit(store, "b", "a")
    recruit(store, "c", "b")
    recruit(store, "b", "another")
    assert inviter_chain(store, "c") == ["b", "a"]
    recruit(store, "a", "c")
    recruit(store, "a", "a")
    assert inviter_chain(store, "a") == []


def test_merge_aliases_resolve_without_losing_ancestors_or_old_ids(store):
    recruit(store, "old", "root")
    recruit(store, "child", "old")
    mark_merged(store, "old", "survivor", NOW)
    assert canonical_user_id(store, "old") == "survivor"
    assert inviter_chain(store, "old") == ["root"]
    assert inviter_chain(store, "child") == ["survivor", "root"]
    old = store.get_analytics("recruitment_nodes", "old")
    assert old["user_id"] == "old"
    assert old["inviter_user_id"] == "root"
    assert old["merged_into_user_id"] == "survivor"
    # A merged edge becomes internal to one logical account. Its external root
    # remains the inviter, and the child's premerge edge is retained for audit.
    mark_merged(store, "survivor", "child", NOW)
    assert inviter_chain(store, "child") == ["root"]
    child = store.get_analytics("recruitment_nodes", "child")
    assert child["original_inviter_user_id"] == "old"
    assert child["inviter_user_id"] == "root"


def test_missing_ancestor_and_malformed_cycles_stop_without_losing_known_path(store):
    node = record_node(store, "child", NOW)
    store.put_analytics("recruitment_nodes", "child", {**node, "inviter_user_id": "missing"})
    assert inviter_chain(store, "child") == ["missing"]
    node = record_node(store, "missing", NOW)
    store.put_analytics("recruitment_nodes", "missing", {**node, "inviter_user_id": "child"})
    assert inviter_chain(store, "child") == ["missing"]
    store.put_analytics("recruitment_nodes", "missing", {**node, "merged_into_user_id": "child"})
    store.put_analytics("recruitment_nodes", "child", {**record_node(store, "child"),
                                                       "merged_into_user_id": "missing"})
    assert canonical_user_id(store, "child") is None
    assert inviter_chain(store, "child") == []


def test_backfill_is_bounded_idempotent_and_does_not_restore_personal_origins(store):
    for account in (
        user("a-root"), user("b-personal", invited_by_user_id="a-root"),
        user("c-match", invited_by_user_id="a-root", invited_via_match_id="match"),
        user("d-token", invited_by_user_id="c-match", invited_via_invite_token="abcd"),
    ):
        store.put_user(account)
    cursor = None
    processed = created = 0
    while True:
        result = backfill_nodes(store, limit=2, cursor=cursor)
        assert result["processed"] <= 2
        processed += result["processed"]
        created += result["created"]
        cursor = result["next_cursor"]
        if cursor is None:
            break
    assert processed == created == 4
    assert inviter_chain(store, "b-personal") == []
    assert inviter_chain(store, "d-token") == ["c-match", "a-root"]
    # Account deletion cleanup may null/reparent live fields; history wins.
    store.put_user(replace(store.get_user("c-match"), invited_by_user_id=None))
    assert inviter_chain(store, "d-token") == ["c-match", "a-root"]
    assert backfill_nodes(store)["created"] == 0
    events = store.list_analytics("funnel_events")
    signups = [event for event in events if event["event"] == "account_created"]
    recruited = [event for event in events if event["event"] == "recruited"]
    assert len(signups) == 4
    assert all(event["reconstructed"] for event in signups)
    assert {event["user_id"] for event in recruited} == {"c-match", "d-token"}
    assert next(event for event in recruited if event["user_id"] == "d-token")["on_signup"] is True
    assert "on_signup" not in next(event for event in recruited if event["user_id"] == "c-match")


def test_merging_a_distant_ancestor_preserves_external_ancestry_without_cycles(store):
    recruit(store, "ancestor", "root")
    recruit(store, "middle", "ancestor")
    recruit(store, "survivor", "middle")
    recruit(store, "descendant", "survivor")
    mark_merged(store, "ancestor", "survivor", NOW)
    assert inviter_chain(store, "survivor") == ["root"]
    assert inviter_chain(store, "middle") == ["survivor", "root"]
    assert inviter_chain(store, "descendant") == ["survivor", "root"]
    node = store.get_analytics("recruitment_nodes", "survivor")
    assert node["original_inviter_user_id"] == "middle"
    assert store.get_analytics("recruitment_nodes", "ancestor")["inviter_user_id"] == "root"


def test_merging_a_root_into_its_child_leaves_one_recruitable_logical_root(store):
    recruit(store, "child", "root")
    mark_merged(store, "root", "child", NOW)
    assert inviter_chain(store, "child") == []
    assert store.get_analytics("recruitment_nodes", "child")["original_inviter_user_id"] == "root"
    recruit(store, "child", "earlier-root")
    assert inviter_chain(store, "root") == ["earlier-root"]
