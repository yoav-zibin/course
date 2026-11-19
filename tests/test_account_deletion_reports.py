"""Referral snapshot payload removal is bounded and restartable."""
from copy import deepcopy

import pytest

from game_platform.account_deletion import _maintenance
from game_platform.account_deletion_reports import purge_report_step
from game_platform.query_store import key
from game_platform.service import ConflictError
from game_platform.tests.fake_firestore import query_store


SUMMARY = {"users": 200, "invited_users": 180, "inviters": 20,
           "biggest_tree": 32, "longest_chain": 4, "cycles_broken": 0}


def report(store, identity, phase="drain"):
    ref = store.ref("dashboard_runs", "referrals:" + identity)
    ref.set({"phase": phase, "summary": SUMMARY, "complete": phase == "drain"})
    return ref


def node(ref, user_id, *, parent=None, name="Private name"):
    target = ref.collection("referral_nodes").document(key(user_id))
    target.set({"id": user_id, "display_name": name, "picture_url": "private-avatar",
                "referral_code": "12345", "search_tokens": ["private"],
                "parent_id": parent, "parent_name": "Deleted inviter" if parent else "",
                "child_count": 3, "total_invites": 5, "active": True})
    return target


def step(store, ref):
    with store.atomic(), _maintenance(store):
        job, done = purge_report_step(store, store.raw_get(ref))
        store.raw_put(ref, job)
    return done


def finish(store, ref):
    for _ in range(500):
        if step(store, ref):
            return
    raise AssertionError("bounded referral cleanup never completed")


def test_snapshot_cleanup_erases_canonical_alias_and_cached_parent_names_only():
    store = query_store("referral_erasure")
    try:
        reports = [report(store, "published"), report(store, "unfinished", "prepare")]
        headers = [ref.get().to_dict() for ref in reports]
        for ref in reports:
            node(ref, "target")
            node(ref, "alias")
            node(ref, "child", parent="target", name="Keep child name")
            node(ref, "alias-child", parent="alias", name="Keep alias child")
            node(ref, "unrelated", parent="someone-else", name="Keep untouched")
        unrelated = store.ref("dashboard_runs", "activity:unrelated")
        unrelated.set({"counts": {"users": 10}, "complete": True})
        unrelated_before = unrelated.get().to_dict()
        ref = store.ref("account_deletions", "target")
        ref.set({"accounts": ["target", "alias"], "stage": 18})
        store.client.read_paths.clear()
        finish(store, ref)
        for index, report_ref in enumerate(reports):
            assert report_ref.get().to_dict() == headers[index]
            nodes = report_ref.collection("referral_nodes")
            assert not nodes.document(key("target")).get().exists
            assert not nodes.document(key("alias")).get().exists
            for child in ("child", "alias-child"):
                row = nodes.document(key(child)).get().to_dict()
                assert row["parent_id"] is None and row["parent_name"] == ""
                assert row["display_name"].startswith("Keep") and row["total_invites"] == 5
            assert nodes.document(key("unrelated")).get().to_dict()["parent_id"] == "someone-else"
        assert unrelated.get().to_dict() == unrelated_before
        assert not any("_users/" in path or "_counters/" in path for path in store.client.read_paths)
        assert store.raw_get(ref)["stage"] == 18
    finally:
        store.close()


def test_large_child_set_checkpoints_one_row_and_resumes_in_new_process():
    store = query_store("referral_resume")
    reopened = None
    try:
        report_ref = report(store, "many-children")
        node(report_ref, "target")
        for index in range(105):
            node(report_ref, f"child-{index}", parent="target")
        ref = store.ref("account_deletions", "target")
        ref.set({"accounts": ["target"]})
        for _ in range(3):
            assert not step(store, ref)
        remaining = [row for row in report_ref.collection("referral_nodes").stream()
                     if row.to_dict()["parent_id"] == "target"]
        assert len(remaining) == 104
        from game_platform.query_store import QueryStore
        reopened = QueryStore(store.client, namespace=store.namespace)
        finish(reopened, ref)
        assert all(row.to_dict()["parent_id"] is None for row in report_ref.collection("referral_nodes").stream())
        before = deepcopy(store.client.docs)
        assert step(reopened, ref)
        assert store.client.docs == before
    finally:
        if reopened:
            reopened.close()
        store.close()


def test_stale_referral_writes_cannot_restore_fenced_user_or_parent_name():
    store = query_store("referral_fence")
    try:
        ref = report(store, "fenced")
        store.raw_put(store.ref("account_deletion_fences", "target"), {"deleted": True})
        for user_id, parent in (("target", None), ("other", "target")):
            with pytest.raises(ConflictError):
                store.raw_put(ref.collection("referral_nodes").document(key(user_id)),
                              {"id": user_id, "parent_id": parent, "parent_name": "Erased name"})
        store.raw_put(ref.collection("referral_nodes").document(key("other")),
                      {"id": "other", "parent_id": None, "parent_name": ""})
    finally:
        store.close()
