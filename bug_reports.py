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
from pydantic import BaseModel, ConfigDict, Field, JsonValue, StringConstraints, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from game_platform import observability
from game_platform.paging import decode_cursor, encode_cursor, page_size


UPLOAD_TIMEOUT_SECONDS = 15
MAX_REPORT_BYTES = 760_000
MAX_SCREENSHOT_CHARS = 500_000
MAX_DIAGNOSTIC_BYTES = 180_000
REPORTS_PER_DAY = 20
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
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_DIAGNOSTIC_BYTES:
            raise ValueError("diagnostics too large")
        return value


class BugReportStatusChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: ReportStatus
    resolution: Annotated[str, StringConstraints(strip_whitespace=True, max_length=20_000)] = ""
    commit: Annotated[str, StringConstraints(strip_whitespace=True, max_length=128)] | None = None
    expected_status: ReportStatus | None = None
    expected_updated_at: str | None = Field(default=None, max_length=100)

    @model_validator(mode="after")
    def explained_resolution(self):
        if self.status in ("escalated", "handled") and not self.resolution:
            raise ValueError("handled and escalated reports require an explanation")
        return self


def report_summary(row):
    return {key: value for key, value in row.items() if key not in ("screenshot", "diagnostics")}


def take_report_slot(previous, now):
    """A bounded rolling-day limiter, committed atomically with the report."""
    since = (dt.datetime.fromisoformat(now) - dt.timedelta(days=1)).isoformat()
    times = [time for time in (previous or {}).get("times", []) if time > since]
    if len(times) >= REPORTS_PER_DAY:
        from game_platform.service import TooManyRequestsError
        raise TooManyRequestsError("you can send at most 20 bug reports a day; try again tomorrow")
    return {"times": [*times, now]}


def changed_report(row, change, *, changed_by, now):
    """Check an optimistic claim/review before changing a stored report header."""
    if ((change.get("expected_status") is not None and row["status"] != change["expected_status"])
            or (change.get("expected_updated_at") is not None and row["updated_at"] != change["expected_updated_at"])):
        from game_platform.service import ConflictError
        raise ConflictError("this bug report changed; reload it before updating")
    return {**row, "status": change["status"], "resolution": change["resolution"],
            "commit": change.get("commit"), "updated_at": now, "changed_by": changed_by}


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
    return strings(observability.redact(value, keep_long_strings=True))


def make_router(platform_dependency, master_dependency, caller_dependency):
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
        rate_keys = ["client:" + hashlib.sha256(client.encode()).hexdigest()]
        if caller_id:
            rate_keys.append("user:" + caller_id)

        def save():
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            user = platform._store.get_user(caller_id) if caller_id else None
            user_info = None if user is None else {
                "id": user.id, "display_name": user.display_name, "email": user.email,
                "locale": user.locale, "is_guest": not bool(user.linked_accounts),
                "linked_account_kinds": [account.kind for account in user.linked_accounts],
                "created_at": user.created_at.isoformat(), "updated_at": user.updated_at.isoformat(),
                "token_balance": user.token_balance,
            }
            row = {"id": uuid.uuid4().hex, "text": report.text, "screenshot": report.screenshot,
                   "diagnostics": clean_diagnostics(report.diagnostics), "user": user_info,
                   "reporter_user_id": caller_id, "status": "open", "created_at": now,
                   "updated_at": now, "resolution": "", "commit": None, "changed_by": None}
            platform._store.create_bug_report(row, rate_keys=rate_keys)
            return {"id": row["id"], "status": row["status"], "created_at": now}

        return await run_in_threadpool(save)

    def require_configured_master(request: Request):
        if not request.app.state.master_password:
            raise HTTPException(503, "bug report review requires a configured master password")

    private = APIRouter(include_in_schema=False,
                        dependencies=[Depends(require_configured_master), Depends(master_dependency)])

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
        return {"items": rows, "next_cursor": encode_cursor(scope, next_after) if next_after else None}

    @private.get("/admin/bug-reports/{report_id}")
    def get_report(report_id: str, platform=Depends(platform_dependency)):
        row = platform._store.get_bug_report(report_id)
        if row is None:
            raise HTTPException(404, "no bug report with that id")
        return row

    @private.post("/admin/bug-reports/{report_id}/status")
    def set_status(report_id: str, payload: BugReportStatusChange, request: Request,
                   platform=Depends(platform_dependency)):
        import binascii
        changed_by = "admin"
        authorization = request.headers.get("authorization", "")
        if authorization.lower().startswith("basic "):
            try:
                changed_by = base64.b64decode(authorization[6:], validate=True).decode().partition(":")[0][:200] or "admin"
            except (ValueError, binascii.Error, UnicodeError):
                pass
        row = platform._store.set_bug_report_status(report_id, payload.model_dump(), changed_by=changed_by,
                                                   now=dt.datetime.now(dt.timezone.utc).isoformat())
        if row is None:
            raise HTTPException(404, "no bug report with that id")
        return row

    router.include_router(private)
    return router
