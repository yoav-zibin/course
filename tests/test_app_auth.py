"""Native login uses a short-lived browser confirmation and POST-only proof.

No provider/network is used: fixtures exercise the existing account credentials
and a deterministic clock covers session expiry and bounded in-memory state.
"""
import hashlib
import logging
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from game_platform.app_auth import AppSessions


VERIFIER = "a" * 64
CHALLENGE = hashlib.sha256(VERIFIER.encode()).hexdigest()
UNKNOWN_CODE = "unknown-code-" + "x" * 43


def start(api):
    response = api.request("POST", "/auth/app-sessions", json={"challenge": CHALLENGE})
    assert response.status_code == 201
    assert "no-store" in response.headers["cache-control"]
    data = response.json()
    assert data["expires_in_seconds"] == 300
    assert VERIFIER not in data["login_url"]
    return data


def test_browser_handoff_requires_confirmation_then_proof_and_is_single_use(api):
    alice = api.new_user("Alice")
    session = start(api)
    token = session["session_id"]
    assert urlparse(session["login_url"]).fragment == f"app-login={token}"
    body = {"verifier": VERIFIER, "code": UNKNOWN_CODE}
    assert api.request("POST", f"/auth/app-sessions/{token}/exchange", json=body).status_code == 409
    assert api.request("POST", f"/auth/app-sessions/{token}/complete").status_code == 401
    completed = api.ok("POST", f"/auth/app-sessions/{token}/complete", as_user=alice)
    callback = urlparse(completed["callback_url"])
    assert (callback.scheme, callback.netloc) == ("buildplay", "auth")
    query = parse_qs(callback.query)
    assert set(query) == {"session", "code"}
    assert query["session"] == [token]
    code = query["code"][0]
    assert len(code) >= 43 and code not in session.values()
    assert VERIFIER not in completed["callback_url"]
    assert api.passwords_by_user_id[alice] not in completed["callback_url"]
    # A starter who knows the legitimate verifier/session cannot poll-exchange
    # the victim's account after confirmation without the fresh callback code.
    assert api.request("POST", f"/auth/app-sessions/{token}/exchange", json={"verifier": VERIFIER}).status_code == 422
    assert api.request("POST", f"/auth/app-sessions/{token}/exchange", json=body).status_code == 403
    body["code"] = code
    wrong = api.request("POST", f"/auth/app-sessions/{token}/exchange", json={"verifier": "b" * 64, "code": code})
    assert wrong.status_code == 403  # Wrong proof cannot consume the real login.
    response = api.request("POST", f"/auth/app-sessions/{token}/exchange", json=body)
    assert response.status_code == 200
    assert "no-store" in response.headers["cache-control"]
    assert response.json()["user_id"] == alice
    assert response.json()["password"] == api.passwords_by_user_id[alice]
    assert api.request("POST", f"/auth/app-sessions/{token}/exchange", json=body).status_code == 404


def test_confirmed_browser_account_cannot_be_replaced_by_later_account_switch(api):
    alice, bob = api.new_user("Alice"), api.new_user("Bob")
    token = start(api)["session_id"]
    completed = api.ok("POST", f"/auth/app-sessions/{token}/complete", as_user=alice)
    code = parse_qs(urlparse(completed["callback_url"]).query)["code"][0]
    assert api.request("POST", f"/auth/app-sessions/{token}/complete", as_user=bob).status_code == 409
    result = api.ok("POST", f"/auth/app-sessions/{token}/exchange", json={"verifier": VERIFIER, "code": code})
    assert result["user_id"] == alice


@pytest.mark.parametrize("challenge", ["", "short", "G" * 64, "0" * 65])
def test_browser_handoff_rejects_malformed_challenges(api, challenge):
    assert api.request("POST", "/auth/app-sessions", json={"challenge": challenge}).status_code == 422


def test_exchange_is_post_only_and_verifier_shape_is_bounded(api):
    token = start(api)["session_id"]
    assert api.request("GET", f"/auth/app-sessions/{token}/exchange?verifier={VERIFIER}").status_code == 405
    for value in ["too-short", "x" * 129, "=" * 64]:
        assert api.request("POST", f"/auth/app-sessions/{token}/exchange", json={"verifier": value, "code": UNKNOWN_CODE}).status_code == 422
    for code in ["", "short", "x" * 129, "=" * 43]:
        assert api.request("POST", f"/auth/app-sessions/{token}/exchange", json={"verifier": VERIFIER, "code": code}).status_code == 422


def test_session_ttl_completion_window_and_restart_fail_closed():
    now = [0.0]
    sessions = AppSessions(clock=lambda: now[0])
    expired = sessions.start(CHALLENGE)
    now[0] = 301
    with pytest.raises(HTTPException) as failure:
        sessions.complete(expired, "alice")
    assert failure.value.status_code == 404
    token = sessions.start(CHALLENGE)
    code = sessions.complete(token, "alice")
    assert sessions.sessions[token].authorization_code_hash == hashlib.sha256(code.encode()).hexdigest()
    assert sessions.sessions[token].authorization_code_hash != code
    now[0] += 61
    with pytest.raises(HTTPException) as failure:
        sessions.exchange(token, VERIFIER, code)
    assert failure.value.status_code == 404
    active = sessions.start(CHALLENGE)
    with pytest.raises(HTTPException) as failure:
        AppSessions(clock=lambda: now[0]).complete(active, "alice")
    assert failure.value.status_code == 404


def test_handoff_session_count_is_bounded_and_expired_capacity_is_reclaimed():
    now = [0.0]
    sessions = AppSessions(clock=lambda: now[0])
    for _ in range(1000):
        sessions.start(CHALLENGE)
    with pytest.raises(HTTPException) as failure:
        sessions.start(CHALLENGE)
    assert failure.value.status_code == 429
    now[0] = 301
    assert sessions.start(CHALLENGE)
    assert len(sessions.sessions) == 1


def test_authorization_codes_are_fresh_and_bound_to_their_completed_session():
    sessions = AppSessions()
    first, second = sessions.start(CHALLENGE), sessions.start(CHALLENGE)
    assert sessions.sessions[first].authorization_code_hash is None
    first_code, second_code = sessions.complete(first, "alice"), sessions.complete(second, "bob")
    assert first_code != second_code
    with pytest.raises(HTTPException) as failure:
        sessions.exchange(first, VERIFIER, second_code)
    assert failure.value.status_code == 403
    assert sessions.exchange(first, VERIFIER, first_code) == "alice"
    assert sessions.exchange(second, VERIFIER, second_code) == "bob"


def test_handoff_proofs_and_callback_codes_never_enter_request_logs(api, caplog):
    caplog.set_level(logging.INFO, logger="game_platform.events")
    alice = api.new_user("Alice")
    token = start(api)["session_id"]
    completed = api.ok("POST", f"/auth/app-sessions/{token}/complete", as_user=alice)
    code = parse_qs(urlparse(completed["callback_url"]).query)["code"][0]
    api.ok("POST", f"/auth/app-sessions/{token}/exchange", json={"verifier": VERIFIER, "code": code})
    messages = [record.getMessage() for record in caplog.records if "API_CALL " in record.getMessage() and "/auth/app-sessions" in record.getMessage()]
    assert messages
    logged = "\n".join(messages)
    for secret in (VERIFIER, code, api.passwords_by_user_id[alice]):
        assert secret not in logged
    assert "request_body" not in logged and "response_body" not in logged
    from game_platform.observability import redact
    assert redact({"verifier": VERIFIER, "callback_url": completed["callback_url"]}) == {"verifier": "<redacted>", "callback_url": "<redacted>"}
