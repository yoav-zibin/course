"""Fresh Google proof and fixed, privately configured email authorization for admin.

Opaque cookies are process-local, not signed with the shared master password.
Restarting the server logs out admin browsers. The authorized emails are pinned
in private server configuration, with no authorization-time network lookup.
Unattended API clients use a separate private credential.
"""

import hashlib
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated
from urllib.parse import quote, urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, ConfigDict, Field

from game_platform.oauth import ProviderError, verify_google_admin_token


ADMIN_COOKIE = "__Host-buildplay-admin"
SESSION_SECONDS = 8 * 60 * 60
STATIC_HTML = frozenset({
    "admin.html", "browse.html", "stats.html", "feedback.html", "bug-reports.html",
    "students.html", "invites.html", "console.html", "game-test.html", "game-server-bugs.html",
})
ADMIN_PATHS = frozenset({
    "/admin", "/browse", "/stats", "/feedback", "/bug-reports", "/console", "/docs", "/redoc",
    "/invites", "/game-test", "/game-server-bugs",
})


def safe_admin_next(value: str | None) -> str:
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value or any(ord(char) < 32 for char in value):
        return "/admin"
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or parsed.path == "/admin/login":
        return "/admin"
    path = parsed.path.rstrip("/") or "/"
    if (path in ADMIN_PATHS or path.startswith("/admin/")
            or path.startswith("/static/") and path.removeprefix("/static/") in STATIC_HTML):
        return value
    return "/admin"


@dataclass(frozen=True)
class AdminSession:
    user_id: str
    google_subject: str
    email: str
    deadline: float


class AdminSessions:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.sessions: dict[str, AdminSession] = {}

    @staticmethod
    def _key(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def start(self, *, user_id, google_subject, email):
        with self.lock:
            now = self.clock()
            self.sessions = {key: value for key, value in self.sessions.items() if value.deadline > now}
            if len(self.sessions) >= 1000:
                raise HTTPException(429, "Too many admin sign-ins. Try again shortly.")
            token = secrets.token_urlsafe(32)
            self.sessions[self._key(token)] = AdminSession(user_id, google_subject, email, now + SESSION_SECONDS)
            return token

    def get(self, token):
        if not token or len(token) > 128:
            return None
        with self.lock:
            key = self._key(token)
            session = self.sessions.get(key)
            if session is None or session.deadline <= self.clock():
                self.sessions.pop(key, None)
                return None
            return session

    def revoke(self, token):
        if token and len(token) <= 128:
            with self.lock:
                self.sessions.pop(self._key(token), None)


def course_admin_email_allowed(request: Request, email: str) -> bool:
    return email.strip().casefold() in getattr(request.app.state, "admin_google_emails", frozenset())


def _valid_session(request: Request):
    sessions = getattr(request.app.state, "admin_google_sessions", None)
    if sessions is None:
        return None
    token = request.cookies.get(ADMIN_COOKIE)
    session = sessions.get(token)
    if session is None:
        return None
    if not course_admin_email_allowed(request, session.email):
        sessions.revoke(token)
        return None
    from game_platform.service import NotFoundError, AccountDeletionInProgressError
    try:
        user = request.app.state.platform.get_user(session.user_id)
    except (NotFoundError, AccountDeletionInProgressError):
        sessions.revoke(token)
        return None
    if not any(account.kind == "google" and account.identifier == session.google_subject
               for account in user.linked_accounts):
        sessions.revoke(token)
        return None
    return session, user


def admin_session_user_id(request: Request) -> str | None:
    valid = _valid_session(request)
    return valid[1].id if valid else None


def admin_page_access(request: Request) -> Response | None:
    """Return a sign-in redirect for protected HTML without fresh Google proof.

    Routing middleware calls this for admin HTML. Names and account passwords
    cannot substitute for fresh Google proof of an explicitly listed email.
    """
    if _valid_session(request):
        return None
    target = safe_admin_next(request.url.path + ("?" + request.url.query if request.url.query else ""))
    response = RedirectResponse("/admin/login?next=" + quote(target, safe=""), status_code=303)
    response.headers["Cache-Control"] = "no-store"
    return response


class AdminGoogleLogin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_token: Annotated[str, Field(min_length=1, max_length=16_384)]


def _cookie_options(request):
    return {"key": ADMIN_COOKIE, "secure": True, "httponly": True,
            "samesite": "strict", "path": "/"}


def _google_client_id(request):
    return request.app.state.auth_config.google.client_id


def install(app, *, platform_dependency, master_dependency, write_origin_check):
    sessions = AdminSessions()
    app.state.admin_google_sessions = sessions
    app.state.admin_google_emails = frozenset(email.strip().casefold() for email in getattr(app.state, "admin_google_emails", ()))
    router = APIRouter(include_in_schema=False)

    @router.get("/admin/login")
    def login_page():
        return FileResponse(Path(__file__).parent / "static" / "admin-login.html",
                            headers={"Cache-Control": "no-store"})

    @router.get("/auth/admin-session")
    def session_status(request: Request, response: Response):
        response.headers["Cache-Control"] = "no-store"
        valid = _valid_session(request)
        if not valid:
            return {"signed_in": False}
        session, user = valid
        return {"signed_in": True, "user": {"id": user.id, "display_name": user.display_name,
                                               "email": session.email},
                "expires_in_seconds": max(0, int(session.deadline - sessions.clock()))}

    @router.post("/auth/admin-session")
    def sign_in(body: AdminGoogleLogin, request: Request, response: Response,
                platform=Depends(platform_dependency)):
        write_origin_check(request)
        client_id = _google_client_id(request)
        if not client_id:
            raise HTTPException(503, "Google admin sign-in is not configured.")
        try:
            subject, name, email, picture = verify_google_admin_token(body.id_token, client_id)
        except ProviderError:
            raise HTTPException(401, "A fresh Google sign-in with a verified email is required.") from None
        if not course_admin_email_allowed(request, email):
            raise HTTPException(403, "This Google account is not listed for course admin access.",
                                headers={"Cache-Control": "no-store"})
        # Select the operator using only the verified Google subject. Never
        # link/merge with an X-User-Id/password supplied by this request.
        user, _ = platform.login_with_linked_account(
            kind="google", identifier=subject, display_name=name, email=email,
            picture_url=picture, as_user_id=None,
        )
        sessions.revoke(request.cookies.get(ADMIN_COOKIE))
        token = sessions.start(user_id=user.id, google_subject=subject, email=email)
        response.set_cookie(value=token, max_age=SESSION_SECONDS, **_cookie_options(request))
        response.headers["Cache-Control"] = "no-store"
        return {"signed_in": True, "user": {"id": user.id, "display_name": user.display_name, "email": email},
                "expires_in_seconds": SESSION_SECONDS}

    @router.delete("/auth/admin-session", status_code=204)
    def sign_out(request: Request, response: Response):
        write_origin_check(request)
        sessions.revoke(request.cookies.get(ADMIN_COOKIE))
        response.delete_cookie(**_cookie_options(request))
        response.headers["Cache-Control"] = "no-store"

    app.include_router(router)
