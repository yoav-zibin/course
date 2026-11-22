"""Durable invitation analytics survive reloads and use scoped bounded pages."""

import json

import pytest

from game_platform.json_file_store import JsonFileStore
from game_platform.store import InMemoryStore
from game_platform.query_store import QueryStore
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api


@pytest.fixture(params=["memory", "json", "query"])
def analytics(request, tmp_path):
    if request.param == "memory":
        store = InMemoryStore()
    elif request.param == "json":
        store = JsonFileStore(tmp_path / "history.json")
    else:
        store = query_store("analytics_store")
    yield store
    if hasattr(store, "close"):
        store.close()


def test_analytics_pages_are_scoped_filtered_and_copy_records(analytics):
    for i in range(7):
        analytics.put_analytics("invite_history", f"allocation-{i}", {
            "match_id": f"match-{i}", "owner_user_id": "owner" if i < 5 else "other",
            "created_at": "2026-11-22T00:00:00Z", "counters": {"views": i}})
    filters = [("owner_user_id", "==", "owner")]
    first = analytics.page_analytics("invite_history", filters=filters, limit=2, scope="owner")
    second = analytics.page_analytics("invite_history", filters=filters, limit=2,
                                      cursor=first.next_cursor, scope="owner")
    third = analytics.page_analytics("invite_history", filters=filters, limit=2,
                                     cursor=second.next_cursor, scope="owner")
    rows = first.items + second.items + third.items
    assert len(rows) == 5 and len({row["id"] for row in rows}) == 5
    assert third.next_cursor is None
    with pytest.raises(ValueError):
        analytics.page_analytics("invite_history", filters=filters, cursor=first.next_cursor, scope="other")
    row = rows[0]
    row["counters"]["views"] = 1000
    assert analytics.get_analytics("invite_history", row["id"])["counters"]["views"] != 1000
    assert len(analytics.list_analytics("invite_history")) == 7


def test_funnel_events_are_insert_only_and_do_not_allow_other_collections(analytics):
    row = {"event": "view", "allocation_id": "allocation", "occurred_at": "2026-11-22T00:00:00Z"}
    analytics.put_analytics("funnel_events", "event", row)
    analytics.put_analytics("funnel_events", "event", row)
    with pytest.raises(ValueError, match="insert-only"):
        analytics.put_analytics("funnel_events", "event", {**row, "event": "signup"})
    assert analytics.get_analytics("funnel_events", "event")["event"] == "view"
    with pytest.raises(ValueError):
        analytics.get_analytics("users", "account")
    with pytest.raises(ValueError):
        analytics.put_analytics("invite_history", "one", {"id": "different"})
    with pytest.raises(ValueError):
        analytics.page_analytics("invite_history", filters=[("match_id", "!=", "x")])


def test_direct_deletion_preserves_allocations_events_and_recruitment_nodes(analytics):
    api = Api(store=analytics)
    owner, friend = api.new_user("owner"), api.new_user("friend")
    match_id = api.new_match(owner=owner, game_id=api.new_game(owner=owner), joiners=[friend], start=True)
    allocations = [row for row in analytics.list_analytics("invite_history") if row["match_id"] == match_id]
    assert len(allocations) == 1 and allocations[0]["released_at"]
    analytics.delete_match(match_id)
    analytics.delete_user(owner)
    analytics.delete_match(match_id)
    analytics.delete_user(owner)
    assert analytics.get_match(match_id) is None and analytics.get_user(owner) is None
    assert analytics.get_analytics("invite_history", allocations[0]["id"]) == allocations[0]
    node = analytics.get_analytics("recruitment_nodes", owner)
    assert node["user_id"] == owner and node["deleted_at"]
    events = analytics.list_analytics("funnel_events")
    assert sum(row["event"] == "match_deleted" for row in events) == 1
    started, = [row for row in events if row["event"] == "match_started"]
    assert set(started["participant_user_ids"]) == {owner, friend}
    from game_platform.conversion_funnel import summary
    assert summary(analytics, owner_user_id=owner)["events"]["match_deleted"] == 1


def test_all_analytics_collections_round_trip_through_json(tmp_path):
    path = tmp_path / "history.json"
    store = JsonFileStore(path)
    records = {
        "recruitment_nodes": {"user_id": "deleted-account", "inviter_user_id": "older-account", "deleted_at": "2026-11-22T00:00:00Z"},
        "invite_history": {"token": "aaaa", "match_id": "deleted-match", "released_at": "2026-11-22T00:00:00Z", "views": 3},
        "funnel_events": {"event": "signup", "user_id": "deleted-account", "allocation_id": "allocation"},
        "funnel_totals": {"scope": "all", "events": {"signup": 1}},
    }
    try:
        for kind, row in records.items():
            store.put_analytics(kind, "record", row)
    finally:
        store.close()
    cold = JsonFileStore(path)
    try:
        for kind, row in records.items():
            assert cold.get_analytics(kind, "record") == {**row, "id": "record"}
        assert set(records) <= set(json.loads(path.read_text())["data"])
    finally:
        cold.close()


def test_query_analytics_share_atomic_rollback_and_reload():
    store = query_store("analytics_atomic")
    try:
        with pytest.raises(RuntimeError):
            with store.atomic():
                store.put_analytics("invite_history", "allocation", {"match_id": "match"})
                store.put_analytics("funnel_events", "event", {"event": "view"})
                raise RuntimeError("rollback")
        assert store.get_analytics("invite_history", "allocation") is None
        assert store.get_analytics("funnel_events", "event") is None
        store.put_analytics("recruitment_nodes", "account", {"user_id": "account", "inviter_user_id": None})
        cold = QueryStore(store.client, namespace=store.namespace)
        try:
            assert cold.get_analytics("recruitment_nodes", "account")["user_id"] == "account"
        finally:
            cold.close()
    finally:
        store.close()
