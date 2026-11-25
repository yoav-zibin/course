"""Shared reporting on HTML documents and Google sign-in for admin pages.

HTML is modified as a bounded prefix stream. JSON, images, downloads and game
data retain their ordinary transport. Admin documents require a verified Google
session whose email appears in the course allowlist.
"""

import hashlib
import posixpath
import re

from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import Request
from starlette.responses import HTMLResponse


ADMIN_PAGES = frozenset({
    "/admin", "/admin/referrals", "/admin/students", "/browse", "/stats",
    "/feedback", "/bug-reports", "/console", "/docs", "/redoc",
})
ADMIN_FILES = frozenset({
    "admin.html", "invites.html", "students.html", "browse.html", "stats.html",
    "feedback.html", "bug-reports.html", "console.html",
})
PUBLIC_PAGES = frozenset({"/", "/portal", "/admin/login"})
REPORTING_VERSION = "3"
_HEAD = re.compile(br"<head(?:\s[^>]*)?>", re.I)
_DOCTYPE = re.compile(br"<!doctype[^>]*>", re.I)


def admin_document(path):
    normalized = posixpath.normpath(path)
    return normalized in ADMIN_PAGES or (
        normalized.startswith("/static/") and normalized.rsplit("/", 1)[-1] in ADMIN_FILES
    )


def _html_candidate(scope, headers):
    path = scope["path"]
    return (path in PUBLIC_PAGES or admin_document(path) or path.endswith(".html")
            or "text/html" in headers.get("accept", ""))


def reporting_markup(admin=False):
    return (
        f'<link rel="stylesheet" href="/static/site-bug-report.css?v={REPORTING_VERSION}">'
        f'<script src="/static/site-bug-report.js?v={REPORTING_VERSION}"'
        f' data-admin="{"true" if admin else "false"}"></script>'
    ).encode()


class SitePagesMiddleware:
    def __init__(self, app, *, debug_tools=True):
        self.app = app
        self.debug_tools = debug_tools

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        original_headers = Headers(scope=scope)
        path = scope["path"]
        admin = admin_document(path)
        if self.debug_tools and admin and scope["method"] in ("GET", "HEAD"):
            from game_platform.admin_auth import admin_page_access

            request = Request(scope, receive)
            try:
                denied = await run_in_threadpool(admin_page_access, request)
            except HTTPException as error:
                from game_platform.api import (_error_page_content, _handle_http_exception,
                                               _is_html_navigation, _page_locale)

                request.state.locale = _page_locale(request)
                response = await _handle_http_exception(request, error)
                if _is_html_navigation(request):
                    body = _error_page_content(error.status_code, request.state.locale, admin=True).encode()
                    response = HTMLResponse(body if scope["method"] != "HEAD" else b"",
                                            status_code=error.status_code, headers=error.headers)
                response.headers["Cache-Control"] = "private, no-store"
                response.headers["Content-Language"] = request.state.locale
                await response(scope, receive, send)
                return
            if denied is not None:
                await denied(scope, receive, send)
                return

        # The old file ETag cannot validate HTML that now has a new shared
        # script. Revalidation happens below against the transformed ETag.
        candidate = _html_candidate(scope, original_headers)
        if candidate:
            scope = {**scope, "headers": [(name, value) for name, value in scope.get("headers", ())
                                         if name.lower() not in (b"if-none-match", b"if-modified-since")]}
            scope["extensions"] = {key: value for key, value in scope.get("extensions", {}).items()
                                   if key not in ("http.response.pathsend", "http.response.zerocopysend")}

        admin_mode = admin or path in ("/admin/login", "/static/admin-login.html")
        snippet = reporting_markup(admin_mode)
        pending_start = None
        prefix = bytearray()
        inject = False
        not_modified = False
        started = False

        async def send_document(message):
            nonlocal pending_start, inject, not_modified, started
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                status = message["status"]
                inject = (headers.get("content-type", "").lower().startswith("text/html")
                          and (status == 200 or status >= 400)
                          and not headers.get("content-encoding"))
                if not inject:
                    await send(message)
                    started = True
                    return
                if "content-length" in headers:
                    del headers["content-length"]
                if "accept-ranges" in headers:
                    del headers["accept-ranges"]
                previous_etag = headers.get("etag")
                if previous_etag:
                    digest = hashlib.sha256((previous_etag + REPORTING_VERSION + str(admin_mode)).encode()).hexdigest()[:24]
                    etag = f'"site-reporting-{digest}"'
                    headers["etag"] = etag
                    not_modified = status == 200 and original_headers.get("if-none-match") == etag
                if admin_mode:
                    headers["cache-control"] = "private, no-store"
                if not_modified:
                    message["status"] = 304
                    if "content-type" in headers:
                        del headers["content-type"]
                    await send(message)
                    await send({"type": "http.response.body", "body": b""})
                    started = True
                else:
                    pending_start = message
                return
            if message["type"] != "http.response.body" or not inject:
                await send(message)
                return
            if not_modified:
                return
            if scope["method"] == "HEAD":
                if not started:
                    await send(pending_start)
                    started = True
                await send(message)
                return
            if started:
                await send(message)
                return
            prefix.extend(message.get("body", b""))
            head = _HEAD.search(prefix)
            if head is None and len(prefix) < 16384 and message.get("more_body", False):
                return
            if b"/static/site-bug-report.js" in prefix:
                body = bytes(prefix)
            else:
                doctype = _DOCTYPE.search(prefix) if head is None else None
                position = head.end() if head else doctype.end() if doctype else 0
                body = bytes(prefix[:position]) + snippet + bytes(prefix[position:])
            prefix.clear()
            await send(pending_start)
            started = True
            await send({**message, "body": body})

        await self.app(scope, receive, send_document)
