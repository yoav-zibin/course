"""Player screenshots and diagnostic bundles remain private, durable and bounded."""

import base64
import copy
import datetime as dt
import json
import logging
import os
import uuid

import pytest

from game_platform.bug_reports import MAX_REPORT_BYTES, REPORTS_PER_DAY
from game_platform.json_file_store import JsonFileStore
from game_platform.query_store import QueryStore
from game_platform.service import ConflictError, TooManyRequestsError
from game_platform.store import InMemoryStore
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api


AUTH = ("codex-reviewer", "test-bug-report-master")
SCREENSHOT = "data:image/png;base64," + base64.b64encode(
    base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9SIAAAAASUVORK5CYII=")
).decode()
WHEN = "2026-11-19T02:00:00+00:00"


@pytest.fixture(params=["memory", "json", "query", "emulator"])
def store(request, tmp_path):
    if request.param == "memory":
        result = InMemoryStore()
    elif request.param == "json":
        result = JsonFileStore(tmp_path / "data.json")
    elif request.param == "query":
        result = query_store("player_bugs")
    else:
        endpoint = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
        if not endpoint:
            pytest.skip("requires Firestore emulator")
        assert endpoint.startswith(("127.0.0.1:", "localhost:"))
        from google.cloud import firestore
        result = QueryStore.initialize(firestore.Client(project="demo-game-platform"),
                                       namespace="player_bugs_" + uuid.uuid4().hex)
    yield result
    if hasattr(result, "close"):
        result.close()


@pytest.fixture
def api(store):
    return Api(store=store, master_password=AUTH[1])


def row(report_id="report-1", **changes):
    return {"id": report_id, "text": "The board freezes after a move.",
            "screenshot": SCREENSHOT, "diagnostics": {"apiCalls": [{"status": 500, "durationMs": 112}]},
            "user": None, "reporter_user_id": None, "status": "open", "created_at": WHEN,
            "updated_at": WHEN, "resolution": "", "commit": None, "changed_by": None, **changes}


def payload(**changes):
    return {"text": "The board freezes after a move.", "screenshot": SCREENSHOT,
            "diagnostics": {"pages": ["/portal"], "logs": [{"level": "error", "message": "Illegal move"}]}, **changes}


def test_anonymous_capture_and_authenticated_user_context_are_private(api):
    anonymous = api.client.post("/bug-reports", json=payload())
    assert anonymous.status_code == 201, anonymous.text
    assert anonymous.headers["cache-control"] == "private, no-store"
    assert set(anonymous.json()) == {"id", "status", "created_at"}
    anonymous_id = anonymous.json()["id"]
    alice = api.new_user("Alice")
    sent = api.request("POST", "/bug-reports", as_user=alice, json=payload())
    assert sent.status_code == 201, sent.text
    report_id = sent.json()["id"]
    detail = api.client.get(f"/admin/bug-reports/{report_id}", auth=AUTH)
    assert detail.status_code == 200
    report = detail.json()
    assert report["score"] is None
    assert report["score_rationale"] == report["changes_summary"] == ""
    assert report["screenshot"] == SCREENSHOT
    assert report["diagnostics"]["logs"][0]["message"] == "Illegal move"
    assert report["user"]["id"] == alice and report["user"]["display_name"] == "Alice"
    assert report["user"]["is_guest"] is True
    assert "password" not in report["user"]
    assert api.passwords_by_user_id[alice] not in detail.text
    assert api.client.get(f"/admin/bug-reports/{anonymous_id}", auth=AUTH).json()["user"] is None
    page = api.client.get("/admin/bug-reports", auth=AUTH)
    assert page.status_code == 200
    assert {item["id"] for item in page.json()["items"]} == {anonymous_id, report_id}
    assert all("screenshot" not in item and "diagnostics" not in item for item in page.json()["items"])
    for path in ("/admin/bug-reports", f"/admin/bug-reports/{report_id}"):
        denied = api.client.get(path)
        assert denied.status_code == 401 and denied.headers["cache-control"] == "private, no-store"
    invalid = api.client.post("/bug-reports", json=payload(),
                              headers={"X-User-Id": alice, "X-User-Password": "invalid"})
    assert invalid.status_code == 401


def test_anonymous_report_still_works_when_no_master_password_is_configured():
    api = Api(master_password="")
    sent = api.client.post("/bug-reports", json=payload(screenshot=None))
    assert sent.status_code == 201
    assert api.client.get("/admin/bug-reports").status_code == 503
    assert api.client.get("/admin/bug-reports/missing").status_code == 503
    assert api.client.post("/admin/bug-reports/missing/assessment", json={
        "score": 5, "score_rationale": "Review", "expected_status": "open",
        "expected_updated_at": WHEN,
    }).status_code == 503


def test_diagnostics_redact_credentials_and_retain_correlating_request_ids(api):
    request_id = uuid.uuid4().hex
    diagnostics = {"requestId": request_id, "user": {"password": "private-password", "id": "alice"},
                   "apiCalls": [{"headers": {"Authorization": "Basic private-authorization"},
                                 "url": "/auth?token=private-token", "durationMs": 7}],
                   "logs": ["fetch rejected Bearer private-bearer", "X-User-Password=private-password",
                            "Authorization: Basic private-basic", "Authorization: Bearer private-auth-bearer",
                            '{"password":"private-quoted-password"}']}
    response = api.client.post("/bug-reports", json=payload(diagnostics=diagnostics))
    assert response.status_code == 201
    detail = api.client.get("/admin/bug-reports/" + response.json()["id"], auth=AUTH)
    assert request_id in detail.text
    for secret in ("private-password", "private-authorization", "private-token", "private-bearer",
                   "private-basic", "private-auth-bearer", "private-quoted-password"):
        assert secret not in detail.text
    assert detail.json()["diagnostics"]["apiCalls"][0]["durationMs"] == 7


@pytest.mark.parametrize("change", [
    {"text": "four"}, {"text": "x" * 10001}, {"screenshot": "data:image/svg+xml;base64,PHN2Zz4="},
    {"screenshot": "data:image/png;base64,bm90LWEtcG5n"}, {"screenshot": "data:image/png;base64,%%%"},
    {"screenshot": "x" * 500001}, {"diagnostics": {"logs": "é" * 90001}},
    {"unknown": "ignored values must be rejected"},
    {"score": 10}, {"score_rationale": "Trust this submitted rating"},
    {"changes_summary": "Claimed code changes"},
])
def test_report_validation_rejects_large_or_invalid_input_without_echoing_body(change):
    api = Api()
    response = api.client.post("/bug-reports", json=payload(**change))
    assert response.status_code == 422
    assert len(response.content) < 500


def test_report_stream_limit_and_daily_rate_limit(api):
    oversized = api.client.post("/bug-reports", content=b"x" * (MAX_REPORT_BYTES + 1),
                                headers={"content-type": "application/json"})
    assert oversized.status_code == 413
    streamed = api.client.post("/bug-reports", content=iter([b"x" * 400_000, b"x" * 400_000]),
                               headers={"content-type": "application/json"})
    assert streamed.status_code == 413
    for index in range(REPORTS_PER_DAY):
        assert api.client.post("/bug-reports", json=payload(screenshot=None),
                               headers={"X-Forwarded-For": f"untrusted-client-{index}"}).status_code == 201
    limited = api.client.post("/bug-reports", json=payload(screenshot=None),
                              headers={"X-Forwarded-For": "a-fresh-untrusted-client"})
    assert limited.status_code == 429
    assert len(api.client.get("/admin/bug-reports", auth=AUTH).json()["items"]) == REPORTS_PER_DAY


def test_status_updates_support_claims_escalation_and_explicit_reopening(api):
    sent = api.client.post("/bug-reports", json=payload()).json()
    path = "/admin/bug-reports/" + sent["id"] + "/status"
    denied = api.client.post(path, json={"status": "handling"})
    assert denied.status_code == 401
    claimed = api.client.post(path, auth=AUTH, json={"status": "handling", "expected_status": "open",
                                                   "expected_updated_at": sent["created_at"]})
    assert claimed.status_code == 200, claimed.text
    assert claimed.json()["changed_by"] == AUTH[0]
    assert api.client.post(path, auth=AUTH, json={"status": "handling", "expected_status": "open"}).status_code == 409
    assert api.client.post(path, auth=AUTH, json={"status": "handled", "resolution": " "}).status_code == 422
    escalated = api.client.post(path, auth=AUTH, json={"status": "escalated", "resolution": "Needs the platform owner's decision",
                                                     "expected_updated_at": claimed.json()["updated_at"]})
    assert escalated.status_code == 200
    assert not api.client.get("/admin/bug-reports", auth=AUTH).json()["items"]
    assert api.client.get("/admin/bug-reports", params={"status": "escalated"}, auth=AUTH).json()["items"][0]["id"] == sent["id"]
    assert api.client.get("/admin/bug-reports", params={"status": "all"}, auth=AUTH).json()["items"]
    reopened = api.client.post(path, auth=AUTH, json={"status": "open", "resolution": "Owner approved"})
    assert reopened.status_code == 200
    handled = api.client.post(path, auth=AUTH, json={"status": "handled", "resolution": "Reproduced and fixed; move retry regression passes",
                                                   "commit": "123abcd", "expected_status": "open"})
    assert handled.status_code == 200 and handled.json()["commit"] == "123abcd"
    assert api.client.post("/admin/bug-reports/missing/status", auth=AUTH, json={"status": "open"}).status_code == 404


@pytest.mark.parametrize("status", ["open", "handling", "escalated", "handled"])
def test_assessment_is_guarded_and_preserves_status_resolution_and_evidence(api, status):
    # Legacy records have no assessment, rather than a fabricated zero score.
    original = row(status=status, resolution="Existing review notes", commit="published-sha",
                   changes_summary="Existing implemented changes")
    api.platform._store.create_bug_report(original, rate_keys=[])
    path = "/admin/bug-reports/report-1"
    detail = api.client.get(path, auth=AUTH).json()
    assert detail["score"] is None and detail["score_rationale"] == ""
    listed = api.client.get("/admin/bug-reports", params={"status": "all"}, auth=AUTH).json()["items"][0]
    assert listed["score"] is None
    assessment = {"score": 0, "score_rationale": "  Verified the published behavior; no fix is needed.  ",
                  "expected_status": status, "expected_updated_at": WHEN}
    assert api.client.post(path + "/assessment", json=assessment).status_code == 401
    updated = api.client.post(path + "/assessment", auth=AUTH, json=assessment)
    assert updated.status_code == 200, updated.text
    assert updated.json()["score"] == 0
    assert updated.json()["score_rationale"] == assessment["score_rationale"].strip()
    assert updated.json()["changed_by"] == AUTH[0]
    assert updated.json()["updated_at"] != WHEN
    assert all(updated.json()[key] == original[key] for key in ("status", "resolution", "commit", "changes_summary"))
    assert "screenshot" not in updated.json() and "diagnostics" not in updated.json()
    persisted = api.client.get(path, auth=AUTH).json()
    assert persisted["screenshot"] == original["screenshot"]
    assert persisted["diagnostics"] == original["diagnostics"]
    assert api.client.post(path + "/assessment", auth=AUTH, json=assessment).status_code == 409
    # Matching the timestamp alone must not defeat the status comparison.
    wrong_status = {**assessment, "expected_updated_at": persisted["updated_at"],
                    "expected_status": "handling" if status != "handling" else "open"}
    assert api.client.post(path + "/assessment", auth=AUTH, json=wrong_status).status_code == 409
    fresh = {**assessment, "score": 10, "expected_updated_at": persisted["updated_at"]}
    assert api.client.post(path + "/assessment", auth=AUTH, json=fresh).json()["score"] == 10
    assert api.client.post("/admin/bug-reports/missing/assessment", auth=AUTH, json=assessment).status_code == 404


@pytest.mark.parametrize("change", [
    {"score": value} for value in (-1, 11, 1.0, 1.5, "8", True, False, None)
] + [
    {"score_rationale": " "}, {"score_rationale": "x" * 2001},
    {"expected_status": None}, {"expected_updated_at": ""},
    {"status": "handled"}, {"resolution": "Overwrite notes"}, {"changes_summary": "Unrelated edit"},
])
def test_assessment_rejects_invalid_ratings_and_unrelated_updates(change):
    api = Api(master_password=AUTH[1])
    api.platform._store.create_bug_report(row(), rate_keys=[])
    assessment = {"score": 8, "score_rationale": "Fixes a reproducible broken turn.",
                  "expected_status": "open", "expected_updated_at": WHEN, **change}
    response = api.client.post("/admin/bug-reports/report-1/assessment", auth=AUTH, json=assessment)
    assert response.status_code == 422, response.text
    assert api.platform._store.get_bug_report("report-1") == row()


@pytest.mark.parametrize("missing", ["score", "score_rationale", "expected_status", "expected_updated_at"])
def test_assessment_requires_rationale_and_both_guards(missing):
    api = Api(master_password=AUTH[1])
    api.platform._store.create_bug_report(row(), rate_keys=[])
    assessment = {"score": 5, "score_rationale": "Improves move feedback after a verified delay.",
                  "expected_status": "open", "expected_updated_at": WHEN}
    del assessment[missing]
    assert api.client.post("/admin/bug-reports/report-1/assessment", auth=AUTH, json=assessment).status_code == 422
    assert api.platform._store.get_bug_report("report-1") == row()


def test_status_changes_store_actual_changes_separately_and_preserve_assessment(api):
    api.platform._store.create_bug_report(row(score=7, score_rationale="Fixes a repeatable match error."), rate_keys=[])
    path = "/admin/bug-reports/report-1/status"
    first = api.client.post(path, auth=AUTH, json={"status": "handling", "resolution": "Investigating timing",
                                                 "changes_summary": "  Repaired the move deadline calculation.  "})
    assert first.status_code == 200
    assert first.json()["changes_summary"] == "Repaired the move deadline calculation."
    handled = api.client.post(path, auth=AUTH, json={"status": "handled", "resolution": "Published and verified",
                                                   "commit": "abc123"})
    assert handled.status_code == 200
    assert handled.json()["score"] == 7
    assert handled.json()["score_rationale"] == "Fixes a repeatable match error."
    assert handled.json()["changes_summary"] == first.json()["changes_summary"]
    invalid = api.client.post(path, auth=AUTH, json={"status": "handled", "resolution": "Validated",
                                                   "changes_summary": "x" * 2001})
    assert invalid.status_code == 422
    assert api.client.get("/admin/bug-reports/report-1", auth=AUTH).json()["changes_summary"] == first.json()["changes_summary"]


def test_bounded_pagination_excludes_evidence_and_scopes_cursors(api):
    store = api.platform._store
    for index in range(7):
        store.create_bug_report(row(f"report-{index}"), rate_keys=[])
    rows, cursor = [], None
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        response = api.client.get("/admin/bug-reports", params=params, auth=AUTH)
        assert response.status_code == 200, response.text
        page = response.json()
        assert len(page["items"]) <= 2
        rows.extend(page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
        assert api.client.get("/admin/bug-reports", params={"status": "handled", "cursor": cursor}, auth=AUTH).status_code == 400
    assert len({item["id"] for item in rows}) == 7
    assert all("screenshot" not in item and "diagnostics" not in item for item in rows)
    for limit in (0, 101):
        assert api.client.get("/admin/bug-reports", params={"limit": limit}, auth=AUTH).status_code == 422


def test_storage_round_trip_is_immutable_and_rolls_limit_window_forward(store):
    report = row()
    expected = copy.deepcopy(report)
    store.create_bug_report(report, rate_keys=["client:one"])
    report["diagnostics"]["apiCalls"].clear()
    assert store.get_bug_report("report-1") == expected
    restored = store.get_bug_report("report-1")
    restored["diagnostics"].clear()
    assert store.get_bug_report("report-1") == expected
    for index in range(REPORTS_PER_DAY - 1):
        store.create_bug_report(row(f"extra-{index}"), rate_keys=["client:one"])
    with pytest.raises(TooManyRequestsError):
        store.create_bug_report(row("denied"), rate_keys=["client:one"])
    assert store.get_bug_report("denied") is None
    tomorrow = (dt.datetime.fromisoformat(WHEN) + dt.timedelta(days=1, seconds=1)).isoformat()
    store.create_bug_report(row("tomorrow", created_at=tomorrow, updated_at=tomorrow), rate_keys=["client:one"])
    assert store.get_bug_report("tomorrow")


def test_json_report_and_rate_limit_survive_reload(tmp_path):
    path = tmp_path / "reports.json"
    store = JsonFileStore(path)
    for index in range(REPORTS_PER_DAY):
        store.create_bug_report(row(str(index)), rate_keys=["user:one"])
    store.close()
    reloaded = JsonFileStore(path)
    try:
        assert reloaded.get_bug_report("0") == row("0")
        with pytest.raises(TooManyRequestsError):
            reloaded.create_bug_report(row("one-more"), rate_keys=["user:one"])
        reloaded.set_bug_report_status("0", {"status": "handled", "resolution": "Fixed", "commit": "abc"},
                                      changed_by="codex", now="2026-11-19T03:00:00+00:00")
        reloaded.set_bug_report_status("0", {"score": 6, "score_rationale": "Repairs a verified match failure.",
                                             "expected_status": "handled", "expected_updated_at": "2026-11-19T03:00:00+00:00"},
                                      changed_by="codex", now="2026-11-19T04:00:00+00:00")
    finally:
        reloaded.close()
    after_review = JsonFileStore(path)
    try:
        assert after_review.get_bug_report("0")["status"] == "handled"
        assert after_review.get_bug_report("0")["score"] == 6
        assert after_review.get_bug_report("0")["commit"] == "abc"
    finally:
        after_review.close()


def test_query_listing_reads_only_headers_and_status_update_does_not_touch_payload():
    store = query_store("private_reports")
    store.create_bug_report(row(), rate_keys=["client:one"])
    assert store.client.queries == 0  # Submission uses bounded document reads.
    store.client.read_paths.clear()
    assert len(store.list_bug_reports(status="open", limit=1)[0]) == 1
    assert not any("/body/" in path for path in store.client.read_paths)
    payload_path = next(path for path in store.client.docs if "/body/" in path)
    before = copy.deepcopy(store.client.docs[payload_path])
    store.set_bug_report_status("report-1", {"status": "handling", "resolution": "", "expected_status": "open"},
                                changed_by="codex", now="2026-11-19T03:00:00+00:00")
    assert store.client.docs[payload_path] == before
    with pytest.raises(ConflictError):
        store.set_bug_report_status("report-1", {"status": "handled", "resolution": "fixed", "expected_status": "open"},
                                    changed_by="codex", now="2026-11-19T04:00:00+00:00")
    assert store.get_bug_report("report-1")["status"] == "handling"
    store.client.read_paths.clear()
    store.set_bug_report_status("report-1", {"score": 8, "score_rationale": "Fixes a broken match action.",
                                             "expected_status": "handling", "expected_updated_at": "2026-11-19T03:00:00+00:00"},
                                changed_by="codex", now="2026-11-19T05:00:00+00:00")
    assert not any("/body/" in path for path in store.client.read_paths)
    assert store.client.docs[payload_path] == before
    assert store.get_bug_report("report-1")["score"] == 8


def test_report_diagnostic_bodies_do_not_enter_http_logs(caplog):
    caplog.set_level(logging.INFO)
    api = Api(master_password=AUTH[1])
    private = "private-report-content-that-must-not-enter-server-logs"
    sent = api.client.post("/bug-reports", json=payload(text=private, diagnostics={"logs": [private]}))
    assert sent.status_code == 201
    report_id = sent.json()["id"]
    detail = api.client.get(f"/admin/bug-reports/{report_id}", auth=AUTH)
    assert detail.status_code == 200
    assert api.client.post(f"/admin/bug-reports/{report_id}/assessment", auth=AUTH,
                           json={"score": 5, "score_rationale": private, "expected_status": "open",
                                 "expected_updated_at": detail.json()["updated_at"]}).status_code == 200
    assert api.client.post(f"/admin/bug-reports/{report_id}/status", auth=AUTH,
                           json={"status": "escalated", "resolution": private,
                                 "changes_summary": private}).status_code == 200
    messages = "\n".join(record.getMessage() + json.dumps(getattr(record, "_fields", {}), default=str) for record in caplog.records)
    assert private not in messages
    calls = [json.loads(record.getMessage().split("API_CALL ", 1)[1])
             for record in caplog.records if "API_CALL " in record.getMessage()]
    assert len(calls) == 4
    assert all("request_body" not in call and "response_body" not in call for call in calls)


def test_incomplete_report_upload_times_out_without_storing_private_evidence(monkeypatch):
    import asyncio
    import game_platform.bug_reports as module

    api = Api()
    cancelled = []

    async def incomplete_stream(self):
        yield b'{"text":"private-incomplete-report'
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)

    with monkeypatch.context() as patch:
        patch.setattr(module, "UPLOAD_TIMEOUT_SECONDS", 0.01)
        patch.setattr(module.Request, "stream", incomplete_stream)
        response = api.client.post("/bug-reports", json=payload())
    assert response.status_code == 408
    assert response.json()["detail"] == "bug report upload timed out"
    assert response.headers["cache-control"] == "private, no-store"
    assert cancelled == [True]
    assert api.platform._store.list_bug_reports(status=None, limit=1) == ([], None)
    # Cancellation cannot poison later requests or consume a report slot.
    assert api.client.post("/bug-reports", json=payload()).status_code == 201
