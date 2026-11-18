"""Short-lived, proof-bound system-browser login handoff for the native portal.

Only an opaque session ID and a fresh authorization code enter the callback URL.
Exchange requires both the initiating app's verifier and the code delivered to
the authenticated browser; knowing a started session's proof is insufficient.
Sessions are process-local and intentionally fail closed after a server restart.
"""
import hashlib
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from game_platform.schemas import AuthResponse


class StartSession(BaseModel):
    model_config = ConfigDict(extra="forbid")
    challenge: Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class ExchangeSession(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verifier: Annotated[str, Field(min_length=43, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]
    code: Annotated[str, Field(min_length=43, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


@dataclass
class Session:
    challenge: str
    deadline: float
    user_id: str | None = None
    authorization_code_hash: str | None = None


class AppSessions:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.lock = threading.Lock()
        self.sessions: dict[str, Session] = {}

    def start(self, challenge: str) -> str:
        with self.lock:
            now = self.clock()
            self.sessions = {key: value for key, value in self.sessions.items() if value.deadline > now}
            if len(self.sessions) >= 1000:
                raise HTTPException(429, "Too many pending app logins. Try again shortly.")
            token = secrets.token_urlsafe(32)
            self.sessions[token] = Session(challenge, now + 300)
            return token

    def _session(self, token: str) -> Session:
        session = self.sessions.get(token)
        if session is None or session.deadline <= self.clock():
            self.sessions.pop(token, None)
            raise HTTPException(404, "This app login expired. Start again in the app.")
        return session

    def complete(self, token: str, user_id: str) -> str:
        with self.lock:
            session = self._session(token)
            if session.user_id is not None:
                raise HTTPException(409, "This app login was already confirmed.")
            code = secrets.token_urlsafe(32)
            session.user_id = user_id
            session.authorization_code_hash = hashlib.sha256(code.encode()).hexdigest()
            session.deadline = min(session.deadline, self.clock() + 60)
            return code

    def exchange(self, token: str, verifier: str, code: str) -> str:
        with self.lock:
            session = self._session(token)
            if not secrets.compare_digest(session.challenge, hashlib.sha256(verifier.encode()).hexdigest()):
                raise HTTPException(403, "Invalid app login proof.")
            if session.user_id is None:
                raise HTTPException(409, "Confirm the account in your browser first.")
            if session.authorization_code_hash is None or not secrets.compare_digest(
                session.authorization_code_hash, hashlib.sha256(code.encode()).hexdigest()
            ):
                raise HTTPException(403, "Invalid app login proof.")
            self.sessions.pop(token)
            return session.user_id


def make_router(platform_dependency, caller_dependency) -> APIRouter:
    router = APIRouter(prefix="/auth/app-sessions", tags=["app login"])
    sessions = AppSessions()

    @router.post("", status_code=201)
    def start(body: StartSession, request: Request, response: Response):
        token = sessions.start(body.challenge)
        base = request.app.state.public_base_url or str(request.base_url).rstrip("/")
        response.headers["Cache-Control"] = "no-store"
        return {"session_id": token, "login_url": f"{base}/portal#app-login={token}", "expires_in_seconds": 300}

    @router.post("/{token}/complete")
    def complete(token: str, response: Response, caller_id=Depends(caller_dependency)):
        code = sessions.complete(token, caller_id)
        response.headers["Cache-Control"] = "no-store"
        return {"callback_url": f"buildplay://auth?session={token}&code={code}"}

    @router.post("/{token}/exchange")
    def exchange(token: str, body: ExchangeSession, response: Response, platform=Depends(platform_dependency)) -> AuthResponse:
        user_id = sessions.exchange(token, body.verifier, body.code)
        response.headers["Cache-Control"] = "no-store"
        return AuthResponse.of(platform.get_user(user_id))

    return router
