"""Automatic errors are labelled, deduplicated and cannot spend manual quota."""

import pytest

from game_platform.bug_reports import REPORTS_PER_DAY
from game_platform.json_file_store import JsonFileStore
from game_platform.tests.test_bug_reports import AUTH, SCREENSHOT, api, store, payload, row


def test_automatic_metadata_identity_and_evidence_are_server_controlled(api):
    user = api.new_user("Reporter")
    sent = api.request("POST", "/bug-reports", as_user=user, json=payload(
        automatic=True, text="Automatic error: password=private-auto-password",
        diagnostics={"automatic_error": {"kind": "error", "message": "Authorization: Bearer private-auto-token",
                                         "stack": "at render (/portal:4:2)", "url": "/portal"},
                     "user": {"id": "somebody-else"}}))
    assert sent.status_code == 201
    detail = api.client.get("/admin/bug-reports/" + sent.json()["id"], auth=AUTH).json()
    assert detail["automatic"] is True
    assert detail["screenshot"] is None
    assert detail["reporter_user_id"] == detail["user"]["id"] == user
    assert "private-auto-password" not in detail["text"]
    assert "private-auto-token" not in str(detail["diagnostics"])
    assert detail["diagnostics"]["automatic_error"]["stack"] == "at render (/portal:4:2)"
    header = api.client.get("/admin/bug-reports", auth=AUTH).json()["items"][0]
    assert header["automatic"] is True
    assert "diagnostics" not in header and "screenshot" not in header


def test_old_and_new_manual_reports_default_to_manual(api):
    api.platform._store.create_bug_report(row("historical"), rate_keys=[])
    response = api.client.post("/bug-reports", json=payload())
    assert response.status_code == 201
    assert set(response.json()) == {"id", "status", "created_at"}
    for report_id in ["historical", response.json()["id"]]:
        detail = api.client.get("/admin/bug-reports/" + report_id, auth=AUTH).json()
        assert detail["automatic"] is False
        assert detail["screenshot"] == SCREENSHOT
    assert all(item["automatic"] is False for item in api.client.get("/admin/bug-reports", auth=AUTH).json()["items"])


@pytest.mark.parametrize("automatic", ["true", "false", 0, 1, None, []])
def test_automatic_flag_requires_a_boolean(api, automatic):
    assert api.client.post("/bug-reports", json=payload(automatic=automatic)).status_code == 422


def test_repeated_automatic_error_is_suppressed_without_spending_slots(api):
    automatic = payload(automatic=True, diagnostics={"automatic_error": {
        "kind": "error", "message": "Board render failed", "stack": "at render (/portal:4:2)", "url": "/portal"},
        "session": "first", "logs": [{"at": 1}]})
    first = api.client.post("/bug-reports", json=automatic)
    assert first.status_code == 201
    for index in range(REPORTS_PER_DAY + 2):
        automatic["diagnostics"]["session"] = str(index)
        automatic["diagnostics"]["logs"] = [{"at": index}]
        duplicate = api.client.post("/bug-reports", json=automatic)
        assert duplicate.status_code == 200
        assert duplicate.json() == {"status": "duplicate"}
    assert len(api.client.get("/admin/bug-reports", auth=AUTH).json()["items"]) == 1
    for index in range(REPORTS_PER_DAY):
        assert api.client.post("/bug-reports", json=payload(text=f"Manual report number {index}")).status_code == 201
    assert api.client.post("/bug-reports", json=payload()).status_code == 429


def test_automatic_and_manual_daily_quotas_are_independent(api):
    for automatic in (True, False):
        for index in range(REPORTS_PER_DAY):
            response = api.client.post("/bug-reports", json=payload(automatic=automatic, text=f"Report {automatic} number {index}"))
            assert response.status_code == 201, response.text
        assert api.client.post("/bug-reports", json=payload(automatic=automatic, text=f"Extra report {automatic}")).status_code == 429
    assert len(api.client.get("/admin/bug-reports", params={"limit": 100}, auth=AUTH).json()["items"]) == 2 * REPORTS_PER_DAY


def test_manual_unlimited_policy_does_not_exempt_automatic_error_storms(api):
    from game_platform.tests.test_bug_report_quotas import configured, verified_user

    owner = verified_user(api, "Approved reporter", "google")
    enabled = configured(api, [owner])
    for index in range(REPORTS_PER_DAY):
        assert enabled.request("POST", "/bug-reports", as_user=owner,
                               json=payload(automatic=True, text=f"Unexpected exception {index}")).status_code == 201
    assert enabled.request("POST", "/bug-reports", as_user=owner,
                           json=payload(automatic=True, text="Unexpected overflow exception")).status_code == 429
    assert enabled.request("POST", "/bug-reports", as_user=owner,
                           json=payload(text="A considered manual report after automatic errors")).status_code == 201


def test_automatic_dedupe_expires_and_identity_is_part_of_fingerprint(store):
    initial = row("initial", automatic=True, reporter_user_id="alice")
    assert store.create_bug_report(initial, rate_keys=["client:shared", "user:alice"]) is True
    later = row("duplicate", automatic=True, reporter_user_id="alice",
                created_at="2026-11-19T02:04:59+00:00")
    assert store.create_bug_report(later, rate_keys=["client:shared", "user:alice"]) is False
    assert store.get_bug_report("duplicate") is None
    assert store.create_bug_report(row("bob", automatic=True, reporter_user_id="bob"),
                                   rate_keys=["client:shared", "user:bob"]) is True
    expired = row("expired", automatic=True, reporter_user_id="alice", created_at="2026-11-19T02:05:00+00:00")
    assert store.create_bug_report(expired, rate_keys=["client:shared", "user:alice"]) is True


def test_automatic_dedupe_and_independent_quota_survive_json_restart(tmp_path):
    path = tmp_path / "automatic.json"
    initial = JsonFileStore(path)
    try:
        assert initial.create_bug_report(row("first", automatic=True), rate_keys=["client:shared"]) is True
    finally:
        initial.close()
    restarted = JsonFileStore(path)
    try:
        assert restarted.create_bug_report(row("same-again", automatic=True), rate_keys=["client:shared"]) is False
        assert restarted.get_bug_report("same-again") is None
        for index in range(REPORTS_PER_DAY):
            assert restarted.create_bug_report(row(f"manual-{index}"), rate_keys=["client:shared"]) is True
        assert restarted.create_bug_report(row("same-after-manual", automatic=True), rate_keys=["client:shared"]) is False
        assert restarted.create_bug_report(row("different-auto", automatic=True, text="A separate unexpected exception"),
                                           rate_keys=["client:shared"]) is True
    finally:
        restarted.close()


def test_query_automatic_dedupe_is_shared_and_failed_report_does_not_claim_fingerprint(monkeypatch):
    from game_platform.query_store import QueryStore
    from game_platform.tests.fake_firestore import query_store

    store = query_store("automatic_report_recovery")
    report = row("auto-retry", automatic=True)
    header = store.ref("bug_reports", report["id"])
    original = store.raw_put

    def fail_header(ref, data):
        if ref.path == header.path:
            raise RuntimeError("simulated automatic report-header failure")
        return original(ref, data)

    with monkeypatch.context() as patch:
        patch.setattr(store, "raw_put", fail_header)
        with pytest.raises(RuntimeError, match="simulated automatic report-header failure"):
            store.create_bug_report(report, rate_keys=["client:shared"])
    assert not header.get().exists
    assert not header.collection("body").document("report").get().exists
    assert store.create_bug_report(report, rate_keys=["client:shared"]) is True
    other_process = QueryStore(store.client, namespace=store.namespace)
    store.client.read_paths.clear()
    assert other_process.create_bug_report(row("auto-duplicate", automatic=True), rate_keys=["client:shared"]) is False
    assert not any("/body/" in path for path in store.client.read_paths)
    assert store.client.queries == 0
    assert other_process.get_bug_report("auto-duplicate") is None
