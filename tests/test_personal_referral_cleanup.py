"""Private, resumable removal of retired codes preserves match recruitment."""

import datetime as dt
import json
from dataclasses import replace

import pytest

from game_platform.models import Invite, InviteAcceptance, LinkedAccount, User
from game_platform.personal_referral_cleanup import clean_user, cleanup, cleanup_json_file
from game_platform.query_store import QueryStore
from game_platform.scaling_referrals import rebuild, report, users
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api


def legacy_user(store, identity, *, inviter=None, token=None, match=None):
    user_id = identity
    now = dt.datetime(2026, 11, 20, tzinfo=dt.UTC)
    store.put_user(User(id=user_id, display_name=identity, password="fixture-password",
                        created_at=now, updated_at=now))
    ref = store.ref("users", user_id)
    row = ref.get().to_dict()
    payload = json.loads(row["json"])
    payload.update(referral_code="private-personal-code", invited_by_user_id=inviter,
                   invited_via_invite_token=token, invited_via_match_id=match,
                   unknown={"referral_code": "unrelated nested game data"})
    row.update(json=json.dumps(payload), invited_by_user_id=inviter,
               referral_code="legacy-index", unknown_metadata=b"retain-exactly")
    ref.set(row)
    return user_id, ref, row


def finish(store, directory, **kwargs):
    for _ in range(100):
        result = cleanup(store, directory, **kwargs)
        if result["complete"]:
            return result
    raise AssertionError("cleanup failed to complete")


@pytest.mark.parametrize("origin", [None, "token", "match"])
def test_raw_user_cleanup_keeps_unknown_fields_and_only_match_origin_edges(origin):
    payload = {"id": "child", "referral_code": "personal", "password": "private",
               "invited_by_user_id": "parent", "unknown": {"referral_code": "nested"}}
    if origin:
        payload["invited_via_invite_token" if origin == "token" else "invited_via_match_id"] = "match-origin"
    row = {"json": json.dumps(payload), "invited_by_user_id": "parent", "revision": 42,
           "created_at": dt.datetime(2026, 1, 1, tzinfo=dt.UTC), "referral_code": "indexed"}
    after = clean_user(row)
    updated = json.loads(after["json"])
    assert "referral_code" not in after and "referral_code" not in updated
    assert updated["unknown"] == payload["unknown"]
    assert updated["password"] == payload["password"]
    assert after["created_at"] == row["created_at"] and after["revision"] == 42
    assert updated["invited_by_user_id"] == after["invited_by_user_id"] == ("parent" if origin else None)
    assert clean_user(after) == after


def test_dry_run_is_read_only_and_apply_resumes_removing_reservations_and_snapshot_codes(tmp_path):
    store = query_store("personal_referral_cleanup")
    owner, _, _ = legacy_user(store, "owner")
    personal, personal_ref, personal_before = legacy_user(store, "personal", inviter=owner)
    token_child, token_ref, _ = legacy_user(store, "token-child", inviter=owner, token="expired")
    match_child, match_ref, _ = legacy_user(store, "match-child", inviter=token_child, match="historical-match")
    reservation = store.ref("referrals", "private-personal-code")
    reservation.set({"user_id": owner})
    run = store.ref("dashboard_runs", "referrals:old")
    run.set({"complete": True, "generated_at": "historical"})
    unrelated = store.ref("dashboard_runs", "unrelated-daily-report")
    unrelated.set({"complete": True, "summary": {"users": 4, "matches": 2}})
    node = run.collection("referral_nodes").document("child")
    node.set({"id": personal, "referral_code": "private-personal-code", "parent_id": owner})
    pointer = store.collection("meta").document("referral_dashboard")
    pointer.set({"run_id": "old"})
    before = dict(store.client.docs)
    try:
        dry = finish(store, tmp_path / "dry", page_size=1, max_documents=1)
        assert dry["counts"]["users"]["legacy"] == 4
        assert dry["counts"]["referrals"]["legacy"] == 1
        assert dry["counts"]["referral_nodes"]["legacy"] == 1
        assert store.client.docs == before
        assert not (tmp_path / "dry" / "preimages").exists()
        first = cleanup(store, tmp_path / "apply", apply=True, max_documents=1)
        assert not first["complete"] and first["processed_this_pass"] == 1
        cold = QueryStore(store.client, namespace=store.namespace)
        try:
            applied = finish(cold, tmp_path / "apply", apply=True, page_size=1, max_documents=1)
            assert applied["complete"]
            assert json.loads(personal_ref.get().to_dict()["json"])["invited_by_user_id"] is None
            assert personal_ref.get().to_dict()["unknown_metadata"] == personal_before["unknown_metadata"]
            assert json.loads(token_ref.get().to_dict()["json"])["invited_by_user_id"] == owner
            assert json.loads(match_ref.get().to_dict()["json"])["invited_by_user_id"] == token_child
            assert not reservation.get().exists and not pointer.get().exists
            assert not node.get().exists and not run.get().exists
            assert unrelated.get().to_dict() == {"complete": True, "summary": {"users": 4, "matches": 2}}
            backups = [json.loads(path.read_text()) for path in (tmp_path / "apply" / "preimages").glob("*.json")]
            assert any(row["path"] == personal_ref.path and row["fields"] for row in backups)
            assert any(row["path"] == reservation.path and row["deleted"] for row in backups)
            with pytest.raises(ValueError):
                report(cold)
            assert cold.get_analytics("recruitment_nodes", token_child)["inviter_user_id"] == owner
            assert cold.get_analytics("recruitment_nodes", match_child)["inviter_user_id"] == token_child
            assert cold.get_analytics("recruitment_nodes", personal)["inviter_user_id"] is None
            verified = finish(cold, tmp_path / "verify", page_size=1)
            assert all(verified["counts"][kind]["legacy"] == 0
                       for kind in ("users", "referrals", "referral_nodes", "dashboard_runs"))
            for _ in range(100):
                if rebuild(cold, run_id="match-only", max_records=1)["complete"]:
                    break
            assert users(cold)["items"][0]["id"] == owner
            assert users(cold)["items"][0]["total_invites"] == 2
            assert "referral_code" not in users(cold)["items"][0]
        finally:
            cold.close()
    finally:
        store.close()


def test_resume_rejects_different_namespace_or_mode(tmp_path):
    store = query_store("source_a")
    other = QueryStore.initialize(store.client, namespace="source_b")
    try:
        cleanup(store, tmp_path / "state", max_documents=1)
        with pytest.raises(ValueError):
            cleanup(store, tmp_path / "state", apply=True)
        with pytest.raises(ValueError):
            cleanup(other, tmp_path / "state")
    finally:
        other.close()
        store.close()


def test_legacy_active_invites_are_archived_without_inventing_view_events(tmp_path):
    from game_platform.conversion_funnel import allocation_id, summary
    store = query_store("legacy_invite_archive")
    now = dt.datetime(2026, 11, 20, tzinfo=dt.UTC)
    invite = Invite(token="abcd", match_id="historical-match", created_by_user_id="owner",
                    created_at=now, views=7,
                    acceptances=(InviteAcceptance(user_id="newcomer", accepted_at=now, signed_up=True),))
    try:
        store.put_invite(invite)
        dry = finish(store, tmp_path / "preview", page_size=1, max_documents=1)
        assert dry["counts"]["invite_history"]["legacy"] == 1
        assert store.list_analytics("invite_history") == []
        applied = finish(store, tmp_path / "apply", apply=True, page_size=1, max_documents=1)
        assert applied["counts"]["invite_history"]["updated"] == 1
        row = store.get_analytics("invite_history", allocation_id(invite))
        assert row["views"] == 7 and row["reconstructed"] is True
        assert row["acceptances"] == [{"user_id": "newcomer", "accepted_at": now.isoformat(), "signed_up": True}]
        events = store.list_analytics("funnel_events")
        assert len(events) == 1 and events[0]["event"] == "invite_created" and events[0]["reconstructed"]
        assert "link_opened" not in summary(store)["events"]
        assert finish(store, tmp_path / "apply", apply=True)["processed_this_pass"] == 0
    finally:
        store.close()


def test_linked_identity_writes_and_restart_create_no_personal_reservations():
    store = query_store("no_personal_reservations")
    try:
        api = Api(store=store)
        owner = api.new_user("owner")
        store.put_user(replace(store.get_user(owner), linked_accounts=(
            LinkedAccount(kind="google", identifier="verified-subject", linked_at=store.get_user(owner).created_at),)))
        cold = QueryStore(store.client, namespace=store.namespace)
        try:
            assert cold.find_linked_account("google", "verified-subject").id == owner
            assert list(cold.collection("referrals").limit(1).stream()) == []
            assert "referral_code" not in json.loads(cold.raw_get(cold.ref("users", owner))["json"])
        finally:
            cold.close()
    finally:
        store.close()


def test_legacy_json_file_cleanup_preserves_game_content_and_has_private_backup(tmp_path):
    path = tmp_path / "legacy.json"
    original = {"format_version": 1, "data": {"users": [
        {"id": "personal", "referral_code": "code", "invited_by_user_id": "parent"},
        {"id": "match", "referral_code": "code2", "invited_by_user_id": "parent", "invited_via_invite_token": "gone"},
    ], "games": [{"referral_code": "part of game"}]}}
    path.write_text(json.dumps(original))
    assert cleanup_json_file(path, tmp_path / "backups")["legacy"] == 2
    assert json.loads(path.read_text()) == original
    assert cleanup_json_file(path, tmp_path / "backups", apply=True)["updated"] == 2
    after = json.loads(path.read_text())
    assert after["data"]["users"][0]["invited_by_user_id"] is None
    assert after["data"]["users"][1]["invited_by_user_id"] == "parent"
    assert after["data"]["games"] == original["data"]["games"]
    backup, = (tmp_path / "backups").glob("*.json")
    assert json.loads(backup.read_text()) == original and backup.stat().st_mode & 0o077 == 0
    assert cleanup_json_file(path, tmp_path / "backups", apply=True)["updated"] == 0
