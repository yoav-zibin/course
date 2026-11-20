"""Private account-ID exemptions never change other reporters' durable quota."""

import copy
import datetime as dt
import hashlib
from dataclasses import replace

import pytest

from game_platform.config import BugReportConfig
from game_platform.models import LinkedAccount
from game_platform.query_store import QueryStore
from game_platform.service import TooManyRequestsError
from game_platform.tests.helpers import Api
from game_platform.tests.test_bug_reports import AUTH, REPORTS_PER_DAY, api, payload, row, store


CLIENT_KEY = "client:" + hashlib.sha256(b"testclient").hexdigest()


def configured(api, user_ids):
    result = Api(store=api.platform._store, master_password=AUTH[1],
                 bug_report_config=BugReportConfig(unlimited_user_ids=tuple(user_ids)))
    result.passwords_by_user_id.update(api.passwords_by_user_id)
    return result


def verified_user(api, name, kind):
    identity = api.new_user(name)
    user = api.platform._store.get_user(identity)
    account = LinkedAccount(kind=kind, identifier=f"synthetic-{identity}" if kind == "google" else f"{identity}@example.test",
                            linked_at=user.created_at)
    api.platform._store.put_user(replace(user, linked_accounts=(account,)))
    return identity


def limits(store, keys):
    if isinstance(store, QueryStore):
        return {key: store.ref("bug_report_limits", key).get().to_dict() for key in keys}
    inner = getattr(store, "_inner", store)
    snapshot = inner.snapshot().bug_report_limits
    return {key: copy.deepcopy(snapshot.get(key)) for key in keys}


@pytest.mark.parametrize("kind", ["google", "email"])
def test_configured_owner_or_student_bypasses_exhausted_user_and_shared_client(api, kind):
    approved = verified_user(api, "Approved reporter", kind)
    # Exhaust both real endpoint counters before the private policy is enabled.
    for _ in range(REPORTS_PER_DAY):
        assert api.request("POST", "/bug-reports", as_user=approved,
                           json=payload(screenshot=None)).status_code == 201
    keys = [CLIENT_KEY, "user:" + approved]
    before = limits(api.platform._store, keys)
    assert all(len(value["times"]) == REPORTS_PER_DAY for value in before.values())
    enabled = configured(api, [approved])
    for _ in range(REPORTS_PER_DAY + 1):
        response = enabled.request("POST", "/bug-reports", as_user=approved, json=payload(screenshot=None))
        assert response.status_code == 201, response.text
        saved = api.platform._store.get_bug_report(response.json()["id"])
        assert saved["reporter_user_id"] == approved
        assert saved["user"]["id"] == approved
    assert limits(api.platform._store, keys) == before
    # Sharing the approved reporter's network does not confer the exception.
    other = enabled.new_user("Unlisted guest")
    assert enabled.request("POST", "/bug-reports", as_user=other,
                           json=payload(screenshot=None)).status_code == 429
    assert enabled.client.post("/bug-reports", json=payload(screenshot=None)).status_code == 429


def test_unlimited_submissions_do_not_consume_other_reporters_shared_quota(api):
    approved = verified_user(api, "Approved student", "email")
    enabled = configured(api, [approved])
    for _ in range(REPORTS_PER_DAY + 1):
        assert enabled.request("POST", "/bug-reports", as_user=approved,
                               json=payload(screenshot=None)).status_code == 201
    assert limits(api.platform._store, [CLIENT_KEY, "user:" + approved]) == {
        CLIENT_KEY: None, "user:" + approved: None,
    }
    # Ordinary anonymous reporters still receive their full existing allowance.
    for _ in range(REPORTS_PER_DAY):
        assert enabled.client.post("/bug-reports", json=payload(screenshot=None)).status_code == 201
    assert enabled.client.post("/bug-reports", json=payload(screenshot=None)).status_code == 429


def test_exemption_uses_only_authenticated_configured_id_not_submitted_identity(api):
    approved = verified_user(api, "Shared display name", "google")
    attacker = verified_user(api, "Shared display name", "google")
    guest = api.new_user("Shared display name")
    enabled = configured(api, [approved])
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for index in range(REPORTS_PER_DAY):
        api.platform._store.create_bug_report(row(f"already-{index}", created_at=now, updated_at=now),
                                              rate_keys=[CLIENT_KEY])
    forged = payload(screenshot=None, diagnostics={
        "user": {"id": approved, "is_guest": False, "linked_account_kinds": ["google"]},
        "reporter_user_id": approved, "unlimited_user_ids": [approved],
        "_review_policy": {"owner_suggestion_authorized": True},
    })
    for identity in (attacker, guest):
        assert enabled.request("POST", "/bug-reports", as_user=identity, json=forged).status_code == 429
    assert enabled.client.post("/bug-reports", json=forged,
                               headers={"X-Forwarded-For": approved}).status_code == 429
    wrong_password = enabled.request("POST", "/bug-reports", as_user=approved,
                                     password=api.passwords_by_user_id[attacker], json=forged)
    assert wrong_password.status_code == 401
    assert enabled.client.post("/bug-reports", json={**forged, "reporter_user_id": approved}).status_code == 422
    assert enabled.request("POST", "/bug-reports", as_user=approved, json=forged).status_code == 201


def test_merged_credentials_use_the_authenticated_canonical_allowlisted_account(api):
    approved = verified_user(api, "Approved reporter", "google")
    old_account = api.new_user("An older guest account")
    merged = api.ok("POST", f"/users/{old_account}/merge", as_user=old_account,
                    json={"into_user_id": approved,
                          "into_password": api.passwords_by_user_id[approved]})
    assert merged["id"] == approved
    enabled = configured(api, [approved])
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for index in range(REPORTS_PER_DAY):
        api.platform._store.create_bug_report(row(f"shared-{index}", created_at=now, updated_at=now),
                                              rate_keys=[CLIENT_KEY])
    response = enabled.request("POST", "/bug-reports", as_user=old_account, json=payload(screenshot=None))
    assert response.status_code == 201, response.text
    stored = api.platform._store.get_bug_report(response.json()["id"])
    assert stored["reporter_user_id"] == stored["user"]["id"] == approved


def test_account_quota_denial_is_atomic_and_exempt_save_preserves_recovery(store):
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    account_key = "user:ordinary"
    fresh_client = "client:fresh-network"
    for index in range(REPORTS_PER_DAY):
        store.create_bug_report(row(f"prior-{index}", created_at=now, updated_at=now), rate_keys=[account_key])
    before = limits(store, [account_key, fresh_client])
    with pytest.raises(TooManyRequestsError):
        store.create_bug_report(row("denied", created_at=now, updated_at=now),
                                rate_keys=[fresh_client, account_key])
    assert store.get_bug_report("denied") is None
    assert limits(store, [account_key, fresh_client]) == before
    report = row("approved-unlimited", created_at=now, updated_at=now)
    store.create_bug_report(report, rate_keys=[])
    assert store.get_bug_report(report["id"]) == report
    assert limits(store, [account_key, fresh_client]) == before
    if isinstance(store, QueryStore):
        cold = QueryStore(store.client, namespace=store.namespace)
    else:
        from game_platform.store import InMemoryStore
        cold = InMemoryStore.of_snapshot(getattr(store, "_inner", store).snapshot())
    assert cold.get_bug_report(report["id"]) == report
    assert limits(cold, [account_key, fresh_client]) == before


def test_json_restart_preserves_exempt_report_and_prior_limited_quota(tmp_path):
    from game_platform.json_file_store import JsonFileStore

    path = tmp_path / "private-reports.json"
    initial = JsonFileStore(path)
    try:
        for index in range(REPORTS_PER_DAY):
            initial.create_bug_report(row(f"limited-{index}"), rate_keys=["client:shared"])
        initial.create_bug_report(row("unlimited-saved"), rate_keys=[])
    finally:
        initial.close()
    restarted = JsonFileStore(path)
    try:
        assert restarted.get_bug_report("unlimited-saved") == row("unlimited-saved")
        with pytest.raises(TooManyRequestsError):
            restarted.create_bug_report(row("still-limited"), rate_keys=["client:shared"])
        assert restarted.get_bug_report("still-limited") is None
        restarted.create_bug_report(row("unlimited-after-restart"), rate_keys=[])
        assert restarted.get_bug_report("unlimited-after-restart") == row("unlimited-after-restart")
    finally:
        restarted.close()


def test_query_unlimited_evidence_failure_rolls_back_and_retry_recovers(monkeypatch):
    from game_platform.tests.fake_firestore import query_store

    store = query_store("unlimited_report_recovery")
    report = row("unlimited-retry")
    original = store.raw_put
    header = store.ref("bug_reports", report["id"])

    def failed_header(ref, data):
        if ref.path == header.path:
            raise RuntimeError("simulated report-header failure")
        return original(ref, data)

    with monkeypatch.context() as patch:
        patch.setattr(store, "raw_put", failed_header)
        with pytest.raises(RuntimeError, match="simulated report-header failure"):
            store.create_bug_report(report, rate_keys=[])
    assert not header.get().exists
    assert not header.collection("body").document("report").get().exists
    store.create_bug_report(report, rate_keys=[])
    assert QueryStore(store.client, namespace=store.namespace).get_bug_report(report["id"]) == report
    assert store.client.queries == 0
    assert not any("_bug_report_limits/" in path for path in store.client.read_paths)


def test_query_merge_during_upload_cannot_grant_exemption_from_a_stale_cached_identity(monkeypatch):
    from game_platform.bug_reports import BugReportCreate
    from game_platform.read_cache import ReadCache
    from game_platform.scaling_service import ScalablePlatform
    from game_platform.tests.fake_firestore import query_store

    store = query_store("unlimited_identity_race")
    store.collection("meta").document("account_lookups").set({"ready": True})
    store._cache.close()
    store._cache = ReadCache(clock=lambda: 1000.0)
    api = Api(store=store, master_password=AUTH[1])
    approved = verified_user(api, "Approved source", "google")
    unlisted = verified_user(api, "Unlisted survivor", "google")
    enabled = configured(api, [approved])
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for index in range(REPORTS_PER_DAY):
        store.create_bug_report(row(f"prior-{index}", created_at=now, updated_at=now), rate_keys=[CLIENT_KEY])
    before = limits(store, [CLIENT_KEY, "user:" + approved, "user:" + unlisted])
    # This worker's regular get_user cache still holds the approved account.
    assert store.get_user(approved).replaced_by_user_id is None
    other_worker = QueryStore(store.client, namespace=store.namespace)
    merge_platform = ScalablePlatform(store=other_worker)
    validate = BugReportCreate.model_validate_json

    def merge_after_authentication(cls, value):
        result = validate(value)
        survivor = merge_platform.merge_users(caller_id=approved, from_user_id=approved,
                                               into_user_id=unlisted,
                                               into_password=api.passwords_by_user_id[unlisted])
        assert survivor.id == unlisted
        # The authenticated request already captured approved before upload;
        # only a fresh read in the report transaction sees this replacement.
        assert store.get_user(approved).replaced_by_user_id is None
        assert other_worker.get_user(approved).replaced_by_user_id == unlisted
        return result

    with monkeypatch.context() as patch:
        patch.setattr(BugReportCreate, "model_validate_json", classmethod(merge_after_authentication))
        response = enabled.request("POST", "/bug-reports", as_user=approved, json=payload(screenshot=None))
    assert response.status_code == 429, response.text
    assert limits(store, [CLIENT_KEY, "user:" + approved, "user:" + unlisted]) == before
    assert len(store.list_bug_reports(status=None, limit=100)[0]) == REPORTS_PER_DAY
