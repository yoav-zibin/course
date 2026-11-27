import datetime as dt
import hashlib
import json
import time
from dataclasses import replace
from unittest.mock import patch
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI, Request, Response
from fastapi.testclient import TestClient

from game_platform import admin_auth, oauth
from game_platform.api import _check_master_write_origin, _get_platform, create_app
from game_platform.config import AuthConfig, GoogleAuthConfig, Config
from game_platform.service import GamePlatform
from game_platform.student_dashboard import CoursePerson


MASTER = ("admin", "fixture-master")
ROSTER = [
    CoursePerson("teacher", "Teacher Example", "instructor", None, "teacher@example.test", ("teacher@example.test",)),
    CoursePerson("alice", "Alice Example", "student", "alice@university.example.test", "alice@example.test",
                 ("alice@university.example.test", "alice@example.test")),
    *(CoursePerson(f"student-{index}", f"Student {index}", "student", f"student-{index}@university.example.test",
                   None, (f"student-{index}@university.example.test",)) for index in range(11)),
]


def client_for(platform=None):
    app = FastAPI()
    app.state.platform = platform or GamePlatform()
    app.state.master_password = MASTER[1]
    app.state.admin_google_emails = frozenset(email for person in ROSTER for email in person.emails)
    app.state.public_base_url = "https://testserver"
    app.state.auth_config = AuthConfig(google=GoogleAuthConfig(client_id="fixture-google-client"))
    admin_auth.install(app, platform_dependency=_get_platform,
                       write_origin_check=_check_master_write_origin)

    @app.get("/admin/private")
    def private(request: Request):
        return admin_auth.admin_page_access(request) or Response("private fixture")

    @app.get("/who-am-i")
    def identity(request: Request):
        return {"id": admin_auth.admin_session_user_id(request)}

    return TestClient(app, base_url="https://testserver", follow_redirects=False)


def google_login(client, *, headers=None):
    with patch.object(admin_auth, "verify_google_admin_token", return_value=(
        "fixture-google-subject", "Alice Example", "alice@example.test", "")):
        response = client.post("/auth/admin-session", json={"id_token": "fixture-id-token"},
                               headers=headers or {})
    assert response.status_code == 200
    return response


def test_admin_requires_fresh_google_proof_and_saves_google_email_without_credentials():
    client = client_for()
    assert client.get("/admin/private").status_code == 303
    before = client.get("/admin/private", auth=MASTER)
    assert before.status_code == 303
    assert before.headers["location"] == "/admin/login?next=%2Fadmin%2Fprivate"
    with patch.object(admin_auth, "verify_google_admin_token", side_effect=oauth.ProviderError("invalid proof")):
        assert client.post("/auth/admin-session", json={"id_token": "bad"}).status_code == 401
    response = google_login(client)
    cookie = response.headers["set-cookie"]
    for expected in ("Secure", "HttpOnly", "SameSite=strict", "Path=/", "Max-Age=28800"):
        assert expected in cookie
    assert "Domain=" not in cookie
    assert "no-store" in response.headers["cache-control"]
    assert "password" not in response.text
    user_id = response.json()["user"]["id"]
    user = client.app.state.platform.get_user(user_id)
    assert user.email == "alice@example.test"
    assert [(account.kind, account.identifier) for account in user.linked_accounts] == [("google", "fixture-google-subject")]
    assert client.get("/admin/private", auth=MASTER).text == "private fixture"
    # Course Google proof alone authorizes the browser; no password is sent.
    assert client.get("/admin/private").text == "private fixture"
    assert client.get("/who-am-i").json() == {"id": user_id}
    status = client.get("/auth/admin-session")
    assert status.json()["user"]["email"] == "alice@example.test"
    assert "fixture-id-token" not in status.text and "password" not in status.text


def test_known_account_password_or_master_password_cannot_forge_google_cookie():
    client = client_for()
    platform = client.app.state.platform
    with patch.object(admin_auth, "verify_google_admin_token", side_effect=oauth.ProviderError("private token response")):
        response = client.post("/auth/admin-session", json={"id_token": "invalid"}, auth=MASTER)
    assert response.status_code == 401
    assert "private token response" not in response.text
    assert "set-cookie" not in response.headers
    assert platform._store.list_users() == []
    # Even knowledge of the shared password cannot construct an opaque session.
    client.cookies.set(admin_auth.ADMIN_COOKIE, hashlib.sha256(MASTER[1].encode()).hexdigest())
    assert client.get("/admin/private", auth=MASTER).status_code == 303
    assert client.get("/who-am-i").json() == {"id": None}


@pytest.mark.parametrize("email", ["alice@university.example.test", "alice@example.test", "ALICE@EXAMPLE.TEST", "TEACHER@EXAMPLE.TEST"])
def test_course_primary_personal_and_instructor_emails_are_exactly_allowed(email):
    client = client_for()
    with patch.object(admin_auth, "verify_google_admin_token", return_value=("subject", "Person", email, "")):
        response = client.post("/auth/admin-session", json={"id_token": "fresh-proof"})
    assert response.status_code == 200
    assert "authorization" not in response.request.headers
    assert client.get("/admin/private").text == "private fixture"


@pytest.mark.parametrize("email", ["outsider@example.test", "alice+extra@example.test", "a.lice@example.test"])
def test_name_matches_and_email_variations_cannot_authorize_or_create_an_account(email):
    client = client_for()
    with patch.object(admin_auth, "verify_google_admin_token", return_value=("subject", "Teacher Example", email, "")):
        response = client.post("/auth/admin-session", json={"id_token": "fresh-proof"})
    assert response.status_code == 403
    assert "set-cookie" not in response.headers
    assert client.app.state.platform._store.list_users() == []
    assert not client.app.state.admin_google_sessions.sessions


def test_empty_config_denies_access_and_authorization_never_fetches_the_dashboard_roster():
    client = client_for()
    with patch("game_platform.student_dashboard.fetch_roster", side_effect=AssertionError("authorization fetched a sheet")):
        google_login(client)
        assert client.get("/auth/admin-session").json()["signed_in"]
    assert not hasattr(admin_auth, "fetch_roster")
    empty = client_for()
    empty.app.state.admin_google_emails = frozenset()
    with patch.object(admin_auth, "verify_google_admin_token", return_value=("subject", "Alice", "alice@example.test", "")):
        response = empty.post("/auth/admin-session", json={"id_token": "fresh-proof"})
    assert response.status_code == 403
    assert empty.app.state.platform._store.list_users() == []
    assert not empty.app.state.admin_google_sessions.sessions


def test_configured_emails_are_normalized_and_validated():
    assert Config(admin_google_emails=[" Teacher@Example.Test ", "teacher@example.test"]).admin_google_emails == ("teacher@example.test",)
    for invalid in ("", "not-an-email", "a@b", "a b@example.test", "a@example..test", ".a@example.test"):
        with pytest.raises(ValueError):
            Config(admin_google_emails=[invalid])
    with pytest.raises(ValueError):
        Config(admin_google_emails=[f"member{index}@example.test" for index in range(65)])


def test_master_password_authorizes_automation_and_browser_requires_google():
    app = create_app(master_password="master-password-fixture",
                     admin_google_emails=["alice@example.test"],
                     auth_config=AuthConfig(google=GoogleAuthConfig(client_id="fixture-google-client")))
    client = TestClient(app, base_url="https://testserver", follow_redirects=False)
    assert client.get("/admin/stats", auth=("machine", "retired-api-key-fixture")).status_code == 401
    assert client.get("/admin/stats", auth=("machine", "master-password-fixture")).status_code == 200
    browser = client.get("/admin/stats", auth=("machine", "master-password-fixture"),
                         headers={"Sec-Fetch-Mode": "cors", "Accept": "application/json"})
    assert browser.status_code == 401
    assert "www-authenticate" not in browser.headers
    google_login(client)
    assert client.get("/admin/stats").status_code == 200
    assert client.get("/admin", follow_redirects=False).status_code == 200
    assert app.state.master_password == "master-password-fixture"

    # A cached, malformed Basic header must not bring back the browser's
    # password prompt, including the legacy feedback review action.
    operator = client.get("/auth/admin-session").json()["user"]["id"]
    report, _ = app.state.platform.send_feedback(caller_id=operator, kind="bug",
        target_type="platform", target_id="platform", text="Feedback review fixture")
    reviewed = client.post(f"/admin/feedback/{report.id}/status", json={"status": "reviewed"},
                           headers={"Authorization": "Basic invalid", "Sec-Fetch-Mode": "cors"})
    assert reviewed.status_code == 200
    assert "www-authenticate" not in reviewed.headers






def test_admin_google_login_does_not_link_to_a_borrowed_user_header():
    client = client_for()
    borrowed = client.app.state.platform.create_user(display_name="Different guest")
    response = google_login(client, headers={"X-User-Id": borrowed.id, "X-User-Password": borrowed.password})
    assert response.json()["user"]["id"] != borrowed.id
    assert client.app.state.platform.get_user(borrowed.id).linked_accounts == ()


def test_admin_login_and_logout_reject_cross_origin_writes():
    client = client_for()
    with patch.object(admin_auth, "verify_google_admin_token") as verify:
        response = client.post("/auth/admin-session", json={"id_token": "token"}, auth=MASTER,
                               headers={"Origin": "https://other.example"})
        assert response.status_code == 403
        verify.assert_not_called()
    google_login(client)
    assert client.delete("/auth/admin-session", headers={"Origin": "https://other.example"}).status_code == 403
    assert client.get("/auth/admin-session").json()["signed_in"]
    assert client.delete("/auth/admin-session", headers={"Origin": "https://testserver"}).status_code == 204
    assert client.get("/auth/admin-session").json() == {"signed_in": False}


def test_google_session_rotation_expiry_and_server_restart_fail_closed():
    client = client_for()
    google_login(client)
    old_token = client.cookies.get(admin_auth.ADMIN_COOKIE)
    google_login(client)
    sessions = client.app.state.admin_google_sessions
    assert sessions.get(old_token) is None
    token = client.cookies.get(admin_auth.ADMIN_COOKIE)
    assert old_token != token
    assert token not in sessions.sessions  # Only a hash is retained server-side.
    restarted = client_for(client.app.state.platform)
    restarted.cookies.set(admin_auth.ADMIN_COOKIE, token)
    assert restarted.get("/auth/admin-session").json() == {"signed_in": False}
    sessions.clock = lambda: time.monotonic() + admin_auth.SESSION_SECONDS + 1
    assert client.get("/auth/admin-session").json() == {"signed_in": False}
    assert client.get("/admin/private", auth=MASTER).status_code == 303


def test_google_session_follows_canonical_merge_but_rejects_deleted_or_unlinked_owner():
    client = client_for()
    response = google_login(client)
    platform = client.app.state.platform
    original = platform.get_user(response.json()["user"]["id"])
    survivor = platform.create_user(display_name="Surviving account")
    platform._store.put_user(replace(survivor, linked_accounts=original.linked_accounts))
    platform._store.put_user(replace(original, replaced_by_user_id=survivor.id, linked_accounts=()))
    assert client.get("/who-am-i").json() == {"id": survivor.id}
    platform._store.put_user(replace(platform.get_user(survivor.id), deletion_started_at=dt.datetime.now(dt.timezone.utc)))
    assert client.get("/auth/admin-session").json() == {"signed_in": False}
    assert client.get("/admin/private", auth=MASTER).status_code == 303


@pytest.mark.parametrize("value", ["https://evil.example", "//evil.example", "/\\evil.example", "/admin/login", "/portal", "/admin\n/evil"])
def test_admin_return_url_is_same_origin_and_protected(value):
    assert admin_auth.safe_admin_next(value) == "/admin"


def test_admin_return_url_preserves_tab_and_student_filters():
    assert admin_auth.safe_admin_next("/admin#students") == "/admin#students"
    assert admin_auth.safe_admin_next("/admin/students?student=fixture") == "/admin/students?student=fixture"
    assert admin_auth.safe_admin_next("/static/students.html") == "/static/students.html"


def claims(**updates):
    now = int(time.time())
    return {"aud": "fixture-client", "iss": "https://accounts.google.com", "sub": "fixture-subject",
            "email": "alice@example.test", "email_verified": "true", "iat": str(now),
            "exp": str(now + 3600), "name": "Alice", **updates}


@pytest.mark.parametrize("updates", [{"aud": "other-client"}, {"iss": "https://evil.example"},
                                    {"exp": "1"}, {"iat": "1"}, {"iat": str(int(time.time()) + 3600)},
                                    {"email_verified": False}, {"email_verified": "false"},
                                    {"email": ""}, {"sub": ""}])
def test_google_admin_token_checks_issuer_audience_freshness_and_verified_email(updates):
    with patch.object(oauth.google_id_token, "verify_oauth2_token", return_value=claims(**updates)), pytest.raises(oauth.ProviderError):
        oauth.verify_google_admin_token("opaque-token", "fixture-client")


def test_google_admin_token_accepts_verified_profile_and_sanitizes_provider_errors():
    with patch.object(oauth.google_id_token, "verify_oauth2_token", return_value=claims()):
        assert oauth.verify_google_admin_token("opaque-token", "fixture-client") == (
            "fixture-subject", "Alice", "alice@example.test", "")
    with patch.object(oauth.google_id_token, "verify_oauth2_token", side_effect=ValueError("private-token-in-url")):
        with pytest.raises(oauth.ProviderError) as failure:
            oauth.verify_google_admin_token("opaque-token", "fixture-client")
    assert "private-token" not in str(failure.value)


def test_google_verifies_a_real_signature_using_public_certificates_without_token_urls():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    from google.auth import crypt, jwt

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = dt.datetime.now(dt.timezone.utc)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "disposable-test-key")])
    certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                   .public_key(key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(now - dt.timedelta(days=1)).not_valid_after(now + dt.timedelta(days=1))
                   .sign(key, hashes.SHA256()).public_bytes(serialization.Encoding.PEM).decode())
    signer = crypt.RSASigner.from_string(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()),
        key_id="fixture-key")
    signed_claims = claims(iat=int(time.time()), exp=int(time.time()) + 3600)
    token = jwt.encode(signer, signed_claims).decode()
    requests = []

    def certificate_request(url, **kwargs):
        requests.append((url, kwargs))
        assert token not in url and "id_token" not in url
        assert kwargs["timeout"] == 10
        return SimpleNamespace(status=200, data=json.dumps({"fixture-key": certificate}).encode())

    with patch.object(oauth, "GoogleRequest", return_value=certificate_request):
        assert oauth.verify_google_admin_token(token, "fixture-client")[:3] == (
            "fixture-subject", "Alice", "alice@example.test")
        with pytest.raises(oauth.ProviderError):
            oauth.verify_google_admin_token(token.rsplit(".", 1)[0] + ".AAAA", "fixture-client")
        with pytest.raises(oauth.ProviderError):
            oauth.verify_google_admin_token(token, "wrong-audience")
    assert requests and all("certs" in url for url, _ in requests)


def test_ordinary_google_login_keeps_optional_email_profile_contract():
    profile = claims(email="", email_verified=False, iat=int(time.time()) - 1200)
    with patch.object(oauth.google_id_token, "verify_oauth2_token", return_value=profile):
        assert oauth.verify_google_id_token("fixture-token", "fixture-client") == (
            "fixture-subject", "Alice", "", "")
        with pytest.raises(oauth.ProviderError):
            oauth.verify_google_admin_token("fixture-token", "fixture-client")
