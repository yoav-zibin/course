"""Scheduled purge boundaries, resumability, physical deletion and stale writers."""
import datetime as dt
from dataclasses import replace
from unittest.mock import patch

import pytest

from game_platform.account_deletion import _claim, run_due_account_deletions
from game_platform.models import Feedback, LinkedAccount, Move, TokenMovement, UserNotification, WebPushSubscription
from game_platform.query_store import QueryStore
from game_platform.service import ConflictError, GamePlatform
from game_platform.store import InMemoryStore
from game_platform.tests.fake_firestore import FakeClient, query_store
from game_platform.tests.helpers import Api

NOW = dt.datetime(2026, 11, 19, tzinfo=dt.timezone.utc)


def setup(query=True):
    client = FakeClient() if query else None
    store = query_store("deletion", client) if query else InMemoryStore()
    api = Api(store=store)
    api.platform._clock = lambda: NOW
    return api, store, client


def schedule(api, user):
    api.ok("POST", "/users/me/deletion-request", as_user=user, json={"confirmed": True})
    return api.platform._store.get_user(user).deletion_scheduled_at


def drain(platform, due, *, steps=1000):
    for _ in range(200):
        result = run_due_account_deletions(platform, now=due, max_steps=steps)
        if not result["more_work_may_remain"]:
            return result
    raise AssertionError("bounded purge never finished")


@pytest.mark.parametrize("query", [False, True])
def test_due_boundary_deletes_all_involvement_and_preserves_unrelated_games_users(query):
    api, store, client = setup(query)
    target, owner, unrelated = [api.new_user(n) for n in ("Erase", "Owner", "Keep")]
    game = api.new_game(owner=owner)
    owned = api.new_match(owner=target, game_id=game)
    shared = api.new_match(owner=owner, game_id=game, joiners=[target], start=True)
    finished = api.platform.make_move(caller_id=owner, match_id=shared,
        expected_move_count=None, move={"turn_indices": None, "state": {"finished": True}})
    assert finished.status == "over"
    keep = api.new_match(owner=unrelated, game_id=game)
    due = schedule(api, target)
    before = run_due_account_deletions(api.platform, now=due-dt.timedelta(microseconds=1))
    assert before["claimed"] == 0 and store.get_user(target) is not None
    drain(api.platform, due)
    assert store.get_user(target) is None
    assert store.get_match(owned) is None and store.get_match(shared) is None
    assert store.get_match(keep) is not None
    assert store.get_user(owner) is not None and store.get_user(unrelated) is not None
    assert store.get_game(game) is not None and not store.get_game(game).deleted
    if query:
        for match_id in (owned, shared):
            prefix = store.ref("matches", match_id).path
            assert not any(path == prefix or path.startswith(prefix + "/") for path in client.docs)


def test_cancelled_request_cannot_be_claimed_from_a_stale_due_snapshot():
    api, store, _ = setup()
    user = api.new_user("Undo")
    due = schedule(api, user)
    request_ref = store.ref("account_deletions", user)
    assert store.raw_get(request_ref)
    api.ok("DELETE", "/users/me/deletion-request", as_user=user)
    assert not _claim(api.platform, request_ref, due)
    assert store.get_user(user).deletion_scheduled_at is None
    drain(api.platform, due)
    assert store.get_user(user) is not None


def test_claim_is_irreversible_and_fresh_writes_reject_cached_users_and_matches():
    api, store, client = setup()
    target, other = api.new_user("Erase"), api.new_user("Other")
    game = api.new_game(owner=target)
    match = api.new_match(owner=target, game_id=game, joiners=[other])
    stale = query_store("deletion", client)
    old_user, old_match = stale.get_user(target), stale.get_match(match)
    due = schedule(api, target)
    assert _claim(api.platform, store.ref("account_deletions", target), due)
    with pytest.raises(ConflictError):
        stale.put_user(replace(old_user, display_name="resurrected"))
    with pytest.raises(ConflictError):
        stale.put_match(old_match)
    assert api.request("DELETE", "/users/me/deletion-request", as_user=target).status_code in (401, 409, 410)
    drain(api.platform, due)
    for operation in (lambda: stale.put_user(old_user), lambda: stale.put_match(old_match)):
        with pytest.raises(ConflictError): operation()
    assert store.get_user(target) is None and store.get_match(match) is None
    assert client.docs[store.ref("account_deletion_fences", target).path] == {"deleted": True}
    assert not store.raw_get(store.ref("account_deletions", target))


def test_restart_large_history_and_more_than_100_matches_removes_children_aliases_and_jobs():
    api, store, client = setup()
    target, alias, other = [api.new_user(n) for n in ("Canonical", "Alias", "Survivor")]
    linked = LinkedAccount(kind="email", identifier="erase@example.invalid", linked_at=NOW)
    store.put_user(replace(store.get_user(target), replaced_user_ids=(alias,), linked_accounts=(linked,)))
    store.put_user(replace(store.get_user(alias), replaced_by_user_id=target))
    game = api.new_game(owner=other)
    original = api.new_match(owner=other, game_id=game, joiners=[target])
    template = store.get_match(original)
    move = Move(move_number=1, player_index=1, made_by_user_id=target,
                created_at=NOW, new_state={}, next_turn_player_indices=None)
    for i in range(105):
        store.put_match(replace(template, id=f"erase-match-{i}", moves=(move,)))
    history = tuple(replace(move, move_number=i+1) for i in range(237))
    store.put_match(replace(template, id="long-history", moves=history))
    for kind in ("jobs", "failed_jobs", "requests", "matchmaking", "outbox"):
        store.raw_put(store.ref(kind, "pending-"+kind), {"match_id": "long-history"})
    due = schedule(api, target)
    first = run_due_account_deletions(api.platform, now=due, max_steps=3)
    assert first["more_work_may_remain"]
    restarted = query_store("deletion", client)
    platform = GamePlatform(store=restarted, clock=lambda: due)
    with patch.object(restarted, "list_users", side_effect=AssertionError("global users scan")):
        with patch.object(restarted, "_list_all", side_effect=AssertionError("unbounded list helper")):
            drain(platform, due, steps=100)
    assert restarted.get_user(target) is None and restarted.get_user(alias) is None
    assert restarted.get_user(other) is not None and restarted.get_game(game) is not None
    assert not restarted.find_linked_account("email", linked.identifier)
    for kind in ("matches", "moves", "jobs", "failed_jobs", "requests", "matchmaking", "outbox"):
        assert not any(path.startswith("deletion_"+kind+"/") for path in client.docs)
    assert not any("/moves/" in path for path in client.docs)


def test_match_refund_happens_once_across_partial_child_cleanup_restart():
    api, store, client = setup()
    target, other = api.new_user("Delete"), api.new_user("Refund")
    game = api.new_game(owner=other)
    match_id = api.new_match(owner=other, game_id=game, joiners=[target])
    store.put_match(replace(store.get_match(match_id), token_pot=20))
    original_balance = store.get_user(other).token_balance
    due = schedule(api, target)
    drain(api.platform, due, steps=1)
    assert store.get_user(other).token_balance == original_balance + 10
    drain(GamePlatform(store=query_store("deletion", client), clock=lambda: due), due)
    assert store.get_user(other).token_balance == original_balance + 10


def test_private_support_payloads_are_erased_but_permanent_token_ledger_is_retained():
    api, store, client = setup()
    target, other = api.new_user("Remove name"), api.new_user("Keep name")
    legacy_ref = store.ref("token_ledger", "legacy-credit")
    legacy_row = {"user_id": target, "amount": 10, "balance": 10, "created_at": NOW}
    store.raw_put(legacy_ref, legacy_row)
    # Pending accounting survives the entire purge before background export.
    pending = TokenMovement(id="pending-credit", user_id=target, amount=10,
        balance_before=0, reason="sign_in_bonus", created_at=NOW)
    store.append_token_movement(pending)
    report = {"id": "private-report", "reporter_user_id": target,
              "created_at": NOW.isoformat(), "status": "open", "text": "Account issue",
              "screenshot": "private-image", "diagnostics": {"private": "evidence"}}
    store.create_bug_report(report, rate_keys=["user:"+target])
    store.put_feedback(Feedback(id="about-deleted-user", reporter_user_id=other,
        target_type="user", target_id=target, target_name="Remove name",
        text="Private report about user", created_at=NOW, updated_at=NOW))
    store.put_feedback(Feedback(id="keep-feedback", reporter_user_id=other,
        target_type="platform", target_id="", text="Keep this report",
        created_at=NOW, updated_at=NOW))
    subscription = WebPushSubscription(id="private-device", user_id=target,
        endpoint="https://push.invalid/private-device", p256dh="fake-public-key",
        auth="fake-auth", created_at=NOW, updated_at=NOW)
    store.put_push_subscription(subscription)
    store.raw_put(store.ref("push_receipts", "private-receipt"),
                  {"user_id": target, "endpoint": subscription.endpoint})
    due = schedule(api, target)
    drain(api.platform, due, steps=10)
    assert not store.get_bug_report(report["id"])
    assert not store.get_push_subscription(subscription.id)
    assert not store.raw_get(store.ref("endpoints", subscription.endpoint))
    assert not store.raw_get(store._feedback_target_ref("user", target))
    for kind, field in [("feedback", "reporter_user_id"), ("bug_reports", "reporter_user_id"),
                        ("push_receipts", "user_id")]:
        assert not store._query(kind, [(field, "==", target)])
    assert store.raw_get(legacy_ref) == legacy_row
    store.flush_token_movements()
    assert store.list_token_movements() == [pending]
    assert store.raw_get(legacy_ref) == legacy_row
    assert not store._query("feedback", [("target_id", "==", target)])
    assert len(store._query("feedback", [("id", "==", "keep-feedback")])) == 1
    with pytest.raises(ConflictError):
        store.create_bug_report(report, rate_keys=["user:"+target])


def test_legacy_purge_checkpoint_skips_ledger_and_still_clears_later_private_phases():
    api, store, _ = setup()
    target = api.new_user("Erase")
    ledger_ref = store.ref("token_ledger", "retained-ledger")
    original = {"user_id": target, "amount": 10, "balance": 10, "created_at": NOW}
    store.raw_put(ledger_ref, original)
    store.create_bug_report({"id": "later-private-report", "reporter_user_id": target,
        "created_at": NOW.isoformat(), "status": "open", "text": "Private",
        "screenshot": "private-image", "diagnostics": {}},
        rate_keys=["user:"+target])
    due = schedule(api, target)
    job_ref = store.ref("account_deletions", target)
    assert _claim(api.platform, job_ref, due)
    job = store.raw_get(job_ref)
    store.raw_put(job_ref, {**job, "stage": 9, "tree": {
        "kind": "token_ledger", "doc": ledger_ref.id, "identity": None}})
    drain(api.platform, due)
    assert store.get_user(target) is None
    assert store.raw_get(ledger_ref) == original
    assert store.get_bug_report("later-private-report") is None


def test_json_store_restart_resumes_an_irreversible_partial_purge(tmp_path):
    from game_platform.json_file_store import JsonFileStore
    path = tmp_path / "accounts.json"
    store = JsonFileStore(path)
    api = Api(store=store)
    api.platform._clock = lambda: NOW
    user = api.new_user("Remove after restart")
    game = api.new_game(owner=user)
    api.new_match(owner=user, game_id=game)
    due = schedule(api, user)
    first = run_due_account_deletions(api.platform, now=due, max_steps=1)
    assert first["more_work_may_remain"]
    store.close()
    reopened = JsonFileStore(path)
    try:
        platform = GamePlatform(store=reopened, clock=lambda: due)
        assert reopened.get_user(user).deletion_started_at is not None
        drain(platform, due)
        assert reopened.get_user(user) is None and reopened.get_game(game) is not None
    finally:
        reopened.close()


def test_normal_match_tombstone_after_backfill_remains_discoverable_for_purge():
    from game_platform.account_deletion_backfill import backfill_account_deletion_metadata
    api, store, client = setup()
    target, other = api.new_user("Former player"), api.new_user("Owner")
    game = api.new_game(owner=other)
    match_id = api.new_match(owner=other, game_id=game)
    match = store.get_match(match_id)
    move = Move(move_number=1, player_index=0, made_by_user_id=target,
                created_at=NOW, new_state={}, next_turn_player_indices=None)
    store.put_match(replace(match, moves=(move,)))
    assert backfill_account_deletion_metadata(store)["complete"]
    store.delete_match(match_id)
    row = store.raw_get(store.ref("matches", match_id))
    assert row["tombstone"] and "json" not in row
    assert target in row["historical_participants"]
    assert any("/moves/" in p for p in client.docs)
    due = schedule(api, target)
    drain(api.platform, due)
    prefix = store.ref("matches", match_id).path
    assert not any(path == prefix or path.startswith(prefix+"/") for path in client.docs)


def test_match_bug_evidence_survives_operation_rollback_but_not_account_purge():
    api, store, client = setup()
    user = api.new_user("Private reproduction")
    game = api.new_game(owner=user)
    match = api.new_match(owner=user, game_id=game)
    report = {"id": "reproduction", "match_id": match, "game_id": game,
              "examined": False, "evidence": {"private_match_state": "secret fixture"}}
    with pytest.raises(RuntimeError, match="failed game operation"):
        with store.atomic():
            store.put_game_server_bug(report)
            raise RuntimeError("failed game operation")
    assert store.get_game_server_bug(report["id"])["evidence"] == report["evidence"]
    due = schedule(api, user)
    drain(api.platform, due)
    assert store.get_game_server_bug(report["id"]) is None
    prefix = store.ref("game_server_bugs", report["id"]).path
    assert not any(path == prefix or path.startswith(prefix+"/") for path in client.docs)
    with pytest.raises(ConflictError):
        store.put_game_server_bug(report)


@pytest.mark.parametrize("query", [False, True])
def test_generated_match_inbox_copies_are_removed_without_touching_unrelated_messages(query):
    api, store, _ = setup(query)
    target, other = api.new_user("Erase actor"), api.new_user("Keep recipient")
    game = api.new_game(owner=other)
    match = api.new_match(owner=other, game_id=game, joiners=[target])
    private = UserNotification(id="generated-name", event="joined", title="Match",
        body="Erase actor joined", url=f"/static/portal.html#match={match}", created_at=NOW)
    keep = replace(private, id="unrelated-notification", body="Unrelated event",
                   url="/portal#match=unrelated-match")
    store.put_user(replace(store.get_user(other), notifications=(private, keep)))
    due = schedule(api, target)
    drain(api.platform, due, steps=10)
    assert store.get_user(other).notifications == (keep,)


@pytest.mark.parametrize("query", [False, True])
@pytest.mark.parametrize("legacy", [False, True])
def test_invite_inbox_copies_are_erased_even_for_a_recipient_outside_the_match(query, legacy):
    api, store, _ = setup(query)
    target, recipient = api.new_user("Erase inviter"), api.new_user("Keep recipient")
    game = api.new_game(owner=target)
    match = api.new_match(owner=target, game_id=game)
    invite = api.ok("POST", f"/matches/{match}/invites", as_user=target,
                    json={"recipient_user_id": recipient})
    user = store.get_user(recipient)
    assert len(user.notifications) == 1
    notification = user.notifications[0]
    assert notification.url.endswith("/i/" + invite["token"])
    if legacy:
        notification = replace(notification, match_id=None)
    keep = replace(notification, id="unrelated", match_id="other-match", url="/i/unrelated-token", body="Keep this")
    store.put_user(replace(user, notifications=(notification, keep)))
    drain(api.platform, schedule(api, target), steps=10)
    assert store.get_user(recipient).notifications == (keep,)


def test_full_worker_scrubs_completed_referral_snapshot_before_removing_account():
    from game_platform.scaling_referrals import _node, rebuild
    api, store, _ = setup()
    target, child = api.new_user("Erase cached name"), api.new_user("Keep child")
    store.put_user(replace(store.get_user(child), invited_by_user_id=target))
    for _ in range(10):
        if rebuild(store, run_id="privacy", max_records=20)["complete"]:
            break
    report = store.ref("dashboard_runs", "referrals:privacy")
    assert store.raw_get(_node(report, target))["display_name"] == "Erase cached name"
    assert store.raw_get(_node(report, child))["parent_name"] == "Erase cached name"
    header = store.raw_get(report)
    due = schedule(api, target)
    drain(api.platform, due, steps=5)
    assert store.get_user(target) is None
    assert store.raw_get(_node(report, target)) is None
    child_row = store.raw_get(_node(report, child))
    assert child_row["display_name"] == "Keep child" and child_row["parent_name"] == ""
    assert child_row["parent_id"] is None and store.get_user(child) is not None
    assert store.raw_get(report) == header


def test_large_linked_identity_set_schedules_claims_and_purges_with_bounded_writes():
    api, store, client = setup()
    target = api.new_user("Many linked identities")
    accounts = tuple(LinkedAccount(kind="email", identifier=f"identity-{i}@example.invalid", linked_at=NOW) for i in range(447))
    store.put_user(replace(store.get_user(target), linked_accounts=accounts))
    due = schedule(api, target)
    assert _claim(api.platform, store.ref("account_deletions", target), due)
    drain(api.platform, due, steps=50)
    assert store.get_user(target) is None
    assert not any(path.startswith("deletion_identities/") for path in client.docs)
