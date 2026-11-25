"""Private player bug reports, with bounded diagnostic evidence and review state.

Screenshots and diagnostic bodies are kept out of ordinary HTTP logs. The small
report header is separate from its immutable payload, so an hourly queue check
never downloads screenshots. Report text is untrusted user content, not agent
instructions; reviewers must independently reproduce and assess a request.
"""

import asyncio
import base64
import datetime as dt
import hashlib
import json
import re
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, JsonValue, StringConstraints, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from game_platform import observability
from game_platform.paging import decode_cursor, encode_cursor, page_size


UPLOAD_TIMEOUT_SECONDS = 15
MAX_REPORT_BYTES = 760_000
MAX_SCREENSHOT_CHARS = 500_000
MAX_DIAGNOSTIC_BYTES = 100_000
# Installed clients can still send their previous snapshot size. Trim before saving.
MAX_INCOMING_DIAGNOSTIC_BYTES = 180_000
_HISTORY_FIELDS = ("logs", "apiCalls", "events", "pages")
REPORTS_PER_DAY = 20
AUTOMATIC_DEDUPE_MINUTES = 5
ReportStatus = Literal["open", "handling", "escalated", "handled"]
_DIAGNOSTIC_SECRET = re.compile(
    r'''(?:password|passwd|passcode|secret|token|authorization|api[_-]?key)["']?\s*[:=]\s*'''
    r'''(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&"']+)'''
    r'''|(?:bearer|basic)\s+[^\s,;&"']+''', re.I,
)


class BugReportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=10_000)]
    screenshot: str | None = Field(default=None, max_length=MAX_SCREENSHOT_CHARS)
    diagnostics: dict[str, JsonValue] = Field(default_factory=dict)
    automatic: Annotated[bool, Field(strict=True)] = False

    @field_validator("screenshot")
    @classmethod
    def image_data_url(cls, value):
        if value is None:
            return value
        prefixes = {"data:image/jpeg;base64,": b"\xff\xd8\xff", "data:image/png;base64,": b"\x89PNG\r\n\x1a\n"}
        for prefix, signature in prefixes.items():
            if value.startswith(prefix):
                try:
                    raw = base64.b64decode(value[len(prefix):], validate=True)
                except ValueError:
                    break
                if raw.startswith(signature):
                    return value
                break
        raise ValueError("screenshot must be a JPEG or PNG data URL")

    @field_validator("diagnostics")
    @classmethod
    def bounded_diagnostics(cls, value):
        if _json_bytes(value) > MAX_INCOMING_DIAGNOSTIC_BYTES:
            raise ValueError("diagnostics too large")
        return value


class BugReportStatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: ReportStatus
    resolution: Annotated[str, StringConstraints(strip_whitespace=True, max_length=20_000)] = ""
    commit: Annotated[str, StringConstraints(strip_whitespace=True, max_length=128)] | None = None
    changes_summary: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2_000)] | None = None
    rollout_verified: bool = False
    expected_status: ReportStatus | None = None
    expected_updated_at: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def explained_resolution(self):
        if self.status in ("escalated", "handled") and not self.resolution:
            raise ValueError("handled and escalated reports require an explanation")
        if self.rollout_verified and (self.status != "handled" or not self.commit):
            raise ValueError("verified rollout requires a handled report and a commit")
        return self


class BugReportAssessmentChange(BaseModel):
    """An admin assessment is independent of authorization and report status."""
    model_config = ConfigDict(extra="forbid")
    score: Annotated[int, Field(strict=True, ge=0, le=10)]
    score_rationale: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)]
    expected_status: ReportStatus
    expected_updated_at: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class BugReportAuthorizationScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    repository: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    branch: Annotated[str, StringConstraints(min_length=1, max_length=200)]
    thread_id: uuid.UUID
    api_origin: tuple[Literal["https"], Annotated[str, StringConstraints(min_length=1, max_length=253)], Annotated[int, Field(ge=1, le=65535)]]


class BugReportAuthorizationChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approved", "declined"]
    reporter_user_id: str | None = Field(max_length=200)
    scope: BugReportAuthorizationScope
    decided_at: AwareDatetime
    expected_status: ReportStatus
    expected_updated_at: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    import_existing: bool = False


def reviewed_report(row):
    # Historical reports remain unassessed; zero means a considered decision.
    authorization = row.get("authorization") or {}
    status = row["status"]
    stage = {"open": "unhandled", "handling": "in_progress", "escalated": "awaiting_approval", "handled": "handled"}[status]
    if status == "handled" and row.get("rolled_out_at"):
        stage = "rolled_out"
    elif authorization.get("decision") == "declined":
        stage = "declined"
    elif status == "handling" and row.get("released_at"):
        stage = "released"
    elif status in ("open", "escalated") and authorization.get("decision") == "approved":
        stage = "approved"
    return {"score": None, "score_rationale": "", "changes_summary": "", "automatic": False,
            "authorization": None, "released_at": None, "release_commit": None, "rolled_out_at": None,
            **row, "workflow_stage": stage}


def report_summary(row):
    return {key: value for key, value in row.items() if key not in ("screenshot", "diagnostics")}


def take_report_slot(previous, now, *, automatic=False, fingerprint=None):
    """Independent manual/automatic rolling-day budgets in one bounded record."""
    previous = previous or {}
    field = "automatic_times" if automatic else "times"
    since = (dt.datetime.fromisoformat(now) - dt.timedelta(days=1)).isoformat()
    times = [time for time in previous.get(field, []) if time > since]
    if len(times) >= REPORTS_PER_DAY:
        from game_platform.service import TooManyRequestsError
        raise TooManyRequestsError("you can send at most 20 bug reports a day; try again tomorrow")
    updated = {**previous, field: [*times, now]}
    if automatic:
        dedupe_since = (dt.datetime.fromisoformat(now) - dt.timedelta(minutes=AUTOMATIC_DEDUPE_MINUTES)).isoformat()
        fingerprints = {key: time for key, time in previous.get("automatic_fingerprints", {}).items()
                        if time > dedupe_since}
        if fingerprint:
            fingerprints[fingerprint] = now
        updated["automatic_fingerprints"] = dict(sorted(fingerprints.items(), key=lambda item: item[1])[-REPORTS_PER_DAY:])
    return updated


def prepare_report_limits(previous_by_key, row):
    """Return atomic quota updates, or None for a recent automatic duplicate.

    Fingerprints omit transient session logs and timestamps. Identity comes from
    the server-owned reporter field; anonymous requests are scoped by the IP
    quota record. No raw error text is retained in quota records.
    """
    automatic = row.get("automatic") is True
    fingerprint = None
    if automatic:
        error = (row.get("diagnostics") or {}).get("automatic_error")
        error = error if isinstance(error, dict) else {}
        stable = [row.get("reporter_user_id"), row["text"],
                  *[error.get(key) for key in ("kind", "message", "stack", "url")]]
        fingerprint = hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=False,
                                                separators=(",", ":")).encode()).hexdigest()
        since = (dt.datetime.fromisoformat(row["created_at"]) - dt.timedelta(minutes=AUTOMATIC_DEDUPE_MINUTES)).isoformat()
        if any((previous or {}).get("automatic_fingerprints", {}).get(fingerprint, "") > since
               for previous in previous_by_key.values()):
            return None
    return {key: take_report_slot(previous, row["created_at"], automatic=automatic, fingerprint=fingerprint)
            for key, previous in previous_by_key.items()}


def changed_report(row, change, *, changed_by, now):
    """Check an optimistic claim/review before changing a stored report header."""
    if ((change.get("expected_status") is not None and row["status"] != change["expected_status"])
            or (change.get("expected_updated_at") is not None and row["updated_at"] != change["expected_updated_at"])):
        from game_platform.service import ConflictError
        raise ConflictError("this bug report changed; reload it before updating")
    if "decision" in change:
        from game_platform.service import ConflictError
        decision = BugReportAuthorizationChange.model_validate(change)
        stored_id = row.get("reporter_user_id")
        user = row.get("user")
        if (stored_id != decision.reporter_user_id
                or (user is not None if stored_id is None else (user or {}).get("id") != stored_id)):
            raise ConflictError("the reporter identity changed")
        current = row.get("authorization")
        if current and (decision.import_existing or current["scope"] != decision.scope.model_dump(mode="json")
                        or dt.datetime.fromisoformat(current["decided_at"]) >= decision.decided_at):
            raise ConflictError("this report already has a newer or differently scoped decision")
        updates = {"authorization": {**decision.model_dump(
            mode="json", include={"decision", "reporter_user_id", "scope", "decided_at"}), "recorded_by": changed_by}}
    elif "score" in change:
        # The shared store operation keeps assessment CAS atomic in every
        # backend. Validate its shape here too, so internal callers cannot
        # combine an assessment with an unrelated status or evidence edit.
        assessment = BugReportAssessmentChange.model_validate(change)
        updates = {"score": assessment.score, "score_rationale": assessment.score_rationale}
    else:
        updates = {"status": change["status"], "resolution": change["resolution"],
                   "commit": change.get("commit")}
        if change["status"] == "handling" and change.get("commit"):
            if change["commit"] != row.get("release_commit") or not row.get("released_at"):
                updates.update(release_commit=change["commit"], released_at=now, rolled_out_at=None)
        elif change["status"] == "handled" and change.get("rollout_verified"):
            released_at = row.get("released_at") if row.get("release_commit") == change["commit"] else None
            updates.update(release_commit=change["commit"], released_at=released_at or now,
                           rolled_out_at=now)
        elif row["status"] == "handled" and change["status"] != "handled":
            updates.update(release_commit=None, released_at=None, rolled_out_at=None)
        if change.get("changes_summary") is not None:
            updates["changes_summary"] = change["changes_summary"]
    return {**row, **updates, "updated_at": now, "changed_by": changed_by}


def _json_bytes(value):
    return len(json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8"))


def _recent_diagnostics(value):
    if _json_bytes(value) <= MAX_DIAGNOSTIC_BYTES:
        return value
    histories = {key: list(reversed(value[key])) for key in _HISTORY_FIELDS if isinstance(value.get(key), list)}
    result = {**value, **{key: [] for key in histories}}
    if _json_bytes(result) > MAX_DIAGNOSTIC_BYTES:
        # Keep room for recent activity even when a legacy client's metadata is large.
        result = {key: [] for key in histories} | {"context": "[truncated]"}
        for key in ("version", "sessionId", "capturedAt", "automatic_error"):
            if key in value and _json_bytes({**result, key: value[key]}) <= MAX_DIAGNOSTIC_BYTES:
                result[key] = value[key]
    size = _json_bytes(result)
    history_budget = MAX_DIAGNOSTIC_BYTES - size

    def recorded_at(entry):
        at = entry.get("at") if isinstance(entry, dict) else None
        return at if isinstance(at, str) else ""

    indices = {key: 0 for key, entries in histories.items() if entries}
    while indices:
        key = max(indices, key=lambda name: recorded_at(histories[name][indices[name]]))
        entry = histories[key][indices[key]]
        indices[key] += 1
        if indices[key] == len(histories[key]):
            del indices[key]
        entry_bytes = _json_bytes(entry)
        if entry_bytes > history_budget:
            continue
        cost = entry_bytes + bool(result[key])
        if size + cost > MAX_DIAGNOSTIC_BYTES:
            break
        result[key].append(entry)
        size += cost
    for key in histories:
        result[key].reverse()
    return result


def clean_diagnostics(value):
    # Retain useful stacks, event names and timing while removing credentials
    # even if an older or modified client forgot its own redaction pass.
    def strings(item):
        if isinstance(item, dict):
            return {key: strings(value) for key, value in item.items()}
        if isinstance(item, list):
            return [strings(value) for value in item]
        if isinstance(item, str):
            # Opaque UUIDs/request ids are essential for correlating the report
            # with server traces. Unlike the public client-error logger, this
            # private store preserves them while removing labelled credentials.
            return _DIAGNOSTIC_SECRET.sub("<redacted>", item)[:20_000]
        return item
    if isinstance(value, dict):
        value = {key: entries[-200:] if key in _HISTORY_FIELDS and isinstance(entries, list) else entries
                 for key, entries in value.items()}
    return strings(observability.redact(value, keep_long_strings=True))


def make_router(platform_dependency, master_dependency, caller_dependency, automation_dependency):
    router = APIRouter()

    @router.post("/bug-reports", status_code=201)
    async def submit_report(request: Request, platform=Depends(platform_dependency), caller_id=Depends(caller_dependency)):
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_REPORT_BYTES:
            raise HTTPException(413, "bug report too large")
        body = bytearray()
        try:
            async with asyncio.timeout(UPLOAD_TIMEOUT_SECONDS):
                async for chunk in request.stream():
                    if len(body) + len(chunk) > MAX_REPORT_BYTES:
                        raise HTTPException(413, "bug report too large")
                    body.extend(chunk)
        except TimeoutError:
            raise HTTPException(408, "bug report upload timed out") from None
        try:
            report = BugReportCreate.model_validate_json(bytes(body))
        except ValueError:
            # Do not echo the invalid input: it may be private diagnostic data.
            raise HTTPException(422, "invalid bug report: check text, screenshot and diagnostic size") from None
        # ASGI's client is resolved by the server's trusted-proxy policy. The
        # logging context accepts X-Forwarded-For for attribution and must not
        # be used for quotas: a browser can supply its own header prefix.
        client = request.client.host if request.client else "unknown"

        def save():
            # Read identity and save evidence in the same unit of work: the
            # query backend bypasses stale caches for transaction reads.
            with platform._lock:
                now = dt.datetime.now(dt.timezone.utc).isoformat()
                user = platform._store.get_user(caller_id) if caller_id else None
                # Only authenticated, canonical server identity and private operator
                # configuration grant this exception. Submitted diagnostics, names,
                # email addresses and client headers cannot claim it. Manual
                # exemptions do not spend shared network slots. Automatic errors
                # always receive bounded quotas, including for exempt users.
                unlimited = (not report.automatic and user is not None and user.id == caller_id
                             and user.replaced_by_user_id is None
                             and caller_id in request.app.state.bug_report_config.unlimited_user_ids)
                rate_keys = [] if unlimited else ["client:" + hashlib.sha256(client.encode()).hexdigest()]
                if caller_id and not unlimited:
                    rate_keys.append("user:" + caller_id)
                user_info = None if user is None else {
                    "id": user.id, "display_name": user.display_name, "email": user.email,
                    "locale": user.locale, "is_guest": not bool(user.linked_accounts),
                    "linked_account_kinds": [account.kind for account in user.linked_accounts],
                    "created_at": user.created_at.isoformat(), "updated_at": user.updated_at.isoformat(),
                    "token_balance": user.token_balance,
                }
                row = {"id": uuid.uuid4().hex, "text": clean_diagnostics(report.text) if report.automatic else report.text,
                       "screenshot": None if report.automatic else report.screenshot, "automatic": report.automatic,
                       "diagnostics": _recent_diagnostics(clean_diagnostics(report.diagnostics)), "user": user_info,
                       "reporter_user_id": caller_id, "status": "open", "created_at": now,
                       "updated_at": now, "resolution": "", "commit": None, "changed_by": None,
                       "score": None, "score_rationale": "", "changes_summary": ""}
                created = platform._store.create_bug_report(row, rate_keys=rate_keys)
                if created is False:
                    return JSONResponse(status_code=200, content={"status": "duplicate"})
                return {"id": row["id"], "status": row["status"], "created_at": now}

        return await run_in_threadpool(save)

    private = APIRouter(include_in_schema=False,
                        dependencies=[Depends(master_dependency)])

    @private.get("/admin/bug-reports")
    def list_reports(status: Literal["open", "handling", "escalated", "handled", "all"] = "open", limit: int = Query(default=50, ge=1, le=100),
                     cursor: str | None = None, platform=Depends(platform_dependency)):
        store = platform._store
        status = None if status == "all" else status
        scope = [getattr(store, "namespace", "local"), "bug-reports", status]
        try:
            after = decode_cursor(scope, cursor)
            page_size(limit)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        rows, next_after = store.list_bug_reports(status=status, limit=limit, after=after)
        return {"items": [reviewed_report(row) for row in rows],
                "next_cursor": encode_cursor(scope, next_after) if next_after else None}

    @private.get("/admin/bug-reports/{report_id}")
    def get_report(report_id: str, platform=Depends(platform_dependency)):
        row = platform._store.get_bug_report(report_id)
        if row is None:
            raise HTTPException(404, "no bug report with that id")
        return reviewed_report(row)

    def reviewer_name(request):
        import binascii
        changed_by = "admin"
        authorization = request.headers.get("authorization", "")
        if authorization.lower().startswith("basic "):
            try:
                changed_by = base64.b64decode(authorization[6:], validate=True).decode().partition(":")[0][:200] or "admin"
            except (ValueError, binascii.Error, UnicodeError):
                pass
        return changed_by

    def update_review(report_id, payload, request, platform):
        row = platform._store.set_bug_report_status(report_id, payload.model_dump(), changed_by=reviewer_name(request),
                                                   now=dt.datetime.now(dt.timezone.utc).isoformat())
        if row is None:
            raise HTTPException(404, "no bug report with that id")
        return reviewed_report(row)

    @private.post("/admin/bug-reports/{report_id}/status")
    def set_status(report_id: str, payload: BugReportStatusChange, request: Request,
                   platform=Depends(platform_dependency)):
        return update_review(report_id, payload, request, platform)

    @private.post("/admin/bug-reports/{report_id}/assessment")
    def set_assessment(report_id: str, payload: BugReportAssessmentChange, request: Request,
                       platform=Depends(platform_dependency)):
        return update_review(report_id, payload, request, platform)

    @private.post("/admin/bug-reports/{report_id}/authorization", dependencies=[Depends(automation_dependency)])
    def set_authorization(report_id: str, payload: BugReportAuthorizationChange, request: Request,
                          platform=Depends(platform_dependency)):
        return update_review(report_id, payload, request, platform)

    router.include_router(private)
    return router
