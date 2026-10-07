"""Tests for third-party login, login codes, and account merging."""

import datetime as dt

import pytest

from pathlib import Path

import game_platform.api as api_module
import game_platform.oauth as oauth_module
from game_platform.config import (
    AppleAuthConfig,
    AuthConfig,
    EmailAuthConfig,
    GoogleAuthConfig,
    SmsAuthConfig,
)
from game_platform.json_file_store import JsonFileStore
from game_platform.models import GameRules
from game_platform.service import (
    ConflictError,
    GamePlatform,
    InvalidRequestError,
    NotFoundError,
)
from game_platform.store import InMemoryStore
from game_platform.testing import Api, error


class Clock:
    def __init__(self) -> None:
        self.now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)

    def __call__(self) -> dt.datetime:
        return self.now

    def advance(self, **kwargs: int) -> None:
        self.now += dt.timedelta(**kwargs)


class RecordingSender:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send_login_code(self, destination: str, code: str) -> None:
        self.sent.append((destination, code))


def _google_api(
    monkeypatch: pytest.MonkeyPatch, subject: str = "sub-1", name: str = "Gina"
) -> Api:
    api = Api(auth_config=AuthConfig(google=GoogleAuthConfig(client_id="g-client")))
    monkeypatch.setattr(
        api_module,
        "verify_google_id_token",
        lambda token, client_id: (subject, name),
    )
    return api


def _track(api: Api, response: dict) -> str:
    """Registers an /auth/* response's credentials with the test helper."""
    api.passwords_by_user_id[response["user_id"]] = response["password"]
    return response["user_id"]


def _sms_api() -> tuple[Api, RecordingSender]:
    sender = RecordingSender()
    api = Api(
        auth_config=AuthConfig(sms=SmsAuthConfig(provider="twilio")),
        sms_sender=sender,
    )
    return api, sender


# /auth/config


def test_auth_config_reports_the_enabled_login_methods() -> None:
    api = Api(
        auth_config=AuthConfig(
            google=GoogleAuthConfig(client_id="g-client"),
            apple=AppleAuthConfig(client_id="apple-client"),
            sms=SmsAuthConfig(provider="twilio"),
            email=EmailAuthConfig(provider="smtp"),
        )
    )
    assert api.ok("GET", "/auth/config") == {
        "google_client_id": "g-client",
        "apple_client_id": "apple-client",
        "phone_login_enabled": True,
        "email_login_enabled": True,
    }


def test_auth_config_is_all_disabled_by_default() -> None:
    assert Api().ok("GET", "/auth/config") == {
        "google_client_id": "",
        "apple_client_id": "",
        "phone_login_enabled": False,
        "email_login_enabled": False,
    }


# Google login


def test_google_login_creates_a_user_on_first_use(monkeypatch: pytest.MonkeyPatch) -> None:
    api = _google_api(monkeypatch)
    first = api.ok("POST", "/auth/google", json={"id_token": "token"})
    assert first["display_name"] == "Gina"
    assert first["password"]
    assert first["merged_from_user_id"] is None
    assert [
        (account["kind"], account["identifier"])
        for account in first["linked_accounts"]
    ] == [("google", "sub-1")]
    # The same Google account logs back into the same user.
    second = api.ok("POST", "/auth/google", json={"id_token": "token"})
    assert second["user_id"] == first["user_id"]


def test_google_login_needs_configuration() -> None:
    assert error(Api().request("POST", "/auth/google", json={"id_token": "x"})) == (
        501,
        "Google login is not configured",
    )


def test_google_login_rejects_bad_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    api = _google_api(monkeypatch)
    monkeypatch.setattr(
        api_module,
        "verify_google_id_token",
        lambda token, client_id: (_ for _ in ()).throw(
            api_module.ProviderError("Google rejected the token")
        ),
    )
    assert error(api.request("POST", "/auth/google", json={"id_token": "bad"})) == (
        502,
        "Google rejected the token",
    )


# Apple login


def _apple_api(
    monkeypatch: pytest.MonkeyPatch,
    subject: str = "apple-sub-1",
    email: str = "ada@example.com",
) -> Api:
    api = Api(auth_config=AuthConfig(apple=AppleAuthConfig(client_id="apple-client")))
    monkeypatch.setattr(
        api_module,
        "verify_apple_id_token",
        lambda token, client_id: (subject, email),
    )
    return api


def test_apple_login_creates_a_user(monkeypatch: pytest.MonkeyPatch) -> None:
    api = _apple_api(monkeypatch)
    # Apple shares the user's name only on the very first sign-in.
    first = api.ok(
        "POST", "/auth/apple", json={"id_token": "token", "name": "Ada Appleseed"}
    )
    assert first["display_name"] == "Ada Appleseed"
    assert [
        (account["kind"], account["identifier"])
        for account in first["linked_accounts"]
    ] == [("apple", "apple-sub-1")]
    # Later sign-ins carry no name; the email's local part is the fallback.
    second = api.ok("POST", "/auth/apple", json={"id_token": "token"})
    assert second["user_id"] == first["user_id"]
    assert second["display_name"] == "Ada Appleseed"


def test_apple_login_falls_back_to_email_prefix_without_a_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = _apple_api(monkeypatch)
    response = api.ok("POST", "/auth/apple", json={"id_token": "token"})
    assert response["display_name"] == "ada"


def test_apple_login_needs_configuration() -> None:
    assert error(Api().request("POST", "/auth/apple", json={"id_token": "x"})) == (
        501,
        "Apple login is not configured",
    )


def test_apple_login_rejects_bad_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    api = _apple_api(monkeypatch)
    monkeypatch.setattr(
        api_module,
        "verify_apple_id_token",
        lambda token, client_id: (_ for _ in ()).throw(
            api_module.ProviderError("Apple token signature is invalid")
        ),
    )
    assert error(api.request("POST", "/auth/apple", json={"id_token": "bad"})) == (
        502,
        "Apple token signature is invalid",
    )


# Apple ID token verification (unit tests with a fixed RSA test vector)


_APPLE_TEST_JWKS = {
    "keys": [
        {
            "kty": "RSA",
            "kid": "test-key-1",
            "use": "sig",
            "alg": "RS256",
            "n": "n23LDiAa1mCVGxC73MnVMl0vmb34ue67maU1MYjBCE4NOL7UYqqk87Eo0yKMjar-l2Yco-u-00kZwNUe8Mr3JP0El5D-tMaRm6zXUhr534vg-s6pYPj7tAEmpzxpPdm1PXqsQfGofffOJ4Sxg5ZGNgT1oBBgfWJ82FEShPgbOebFZzqaRWF_Hy_cMsz_T0niviXWxEmiCs1VB4s-IY_Qkj8CQKGUr216TCHPlrOcl69eWpg9scCGP7oZ23yiebfSNvYqpzMPeDbVuim0n40JSyWhVuZcOY2xWsxqsrbxgoJLaFaSZ_Xw-0A8r7FBdnQp2VPqnpMoKhG-faddzPfUzw",
            "e": "AQAB",
        }
    ]
}

_APPLE_TEST_TOKEN_GOOD = (
    "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LTEiLCJ0eXAiOiJKV1QifQ"
    ".eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIiwiYXVkIjoiYXBwbGUtY2xpZW50LWlkIiwic3ViIjoiYXBwbGUtc3ViLTEiLCJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ"
    ".ZwkJAoTG7i2mshF_tZHdRps3gIgO4zFRDwqQu_ymYTyeIU1dWzXIc5aZp1GK8wK1jgDwHgl7awfEDu0BmmagT-vkSG4-hKYAUKoxDHp_D860JROPmyn9ijqi-Epk_8FPWurkek1ZlAmw4DwKjLpeOW-1Fdp6dfMWwJclk0wKcHA4Nu5RvP_kr4CSpDCrumQTU_mIc8K6o5hNoBzHuXXFG_5hsfY7CDXI7YaocmaPfx52uhP5EpU43nc1etp3X5Gt6aoXNZ9o1QrGS-wP2Ixz8lgniwysTr_lmSQgL1EyegTwt1PAoucz9BNJtS0IIMCMftmouuLqm_R6jEoezUYkUg"
)

_APPLE_TEST_TOKEN_WRONG_AUD = (
    "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LTEiLCJ0eXAiOiJKV1QifQ"
    ".eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIiwiYXVkIjoib3RoZXItYXBwIiwic3ViIjoiYXBwbGUtc3ViLTEiLCJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ"
    ".hPC2Gsmon1OZfIQVGuuYi5Ff96fFF1fwff5mQ2EWqIy2EI6DsqVgnzCSszx80VhLXrZ8omYBSlbpmAOwJFukRn0uBPWvgLXFI3I0FFQfEpbjqLXtFDpEvrbSTCdpgX7yhtRdB5CzbCSzCWRGpuKhI8mGW797GBndDbjhd5P_NKfKhM3DebXnPxQQrNV7l1tZIq9Fu_pMZ0nOuGZRkG2a0V_JxTXaQBqNxVwfMiveIlA0VI5LITHsSvdX5uuh27uE_qUT_LZApXtY52QGMne-jhmbe00LK-_LMhEo4mBQGYHg7fOh57dnu_NaFcpy8Ooff-N2NsNgAJje-qYR9Edm2Q"
)

_APPLE_TEST_TOKEN_EXPIRED = (
    "eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3Qta2V5LTEiLCJ0eXAiOiJKV1QifQ"
    ".eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIiwiYXVkIjoiYXBwbGUtY2xpZW50LWlkIiwic3ViIjoiYXBwbGUtc3ViLTEiLCJlbWFpbCI6ImFkYUBleGFtcGxlLmNvbSIsImlhdCI6MTYwMDAwMDAwMCwiZXhwIjoxNzAwMDAwMDAxfQ"
    ".EJsPXH5JLpTUHcFjfKhc4lIYu71bqBvRQwsQFIKbr6PbltL_oLBshcD1IB9nhEXKg9dxW1GueiYaiDEkdPd0I1rv3Naw56wKjs8WpEqapTdEnSQgfBFMGEizBZEcXX8oMBcZhyQlap3Bh_jgsa-JpFIpp2xOAxa57w0LHt_INOd1H3sSQ_DIXP6Co_AsWe7m8yi4dY1kTsihG-TQpSw6iG_S2sp0IgBPrdbsqCAUbTgvImzbuad8wyr9H05Kqtydd0qYDKMRYBZzMzYapqXzvJXlSBJW2qseEWGcjP2OjZ76Q4hQ4rlppaN2JjQfQcQAnk8lz1tdIzS7acTuH91Gbg"
)

_APPLE_TEST_TOKEN_TAMPERED = _APPLE_TEST_TOKEN_GOOD[:-1] + "A"


def _apple_keys(monkeypatch: pytest.MonkeyPatch, keys: dict = _APPLE_TEST_JWKS) -> None:
    class _Response:
        status_code = 200

        def json(self) -> dict:
            return keys

    monkeypatch.setattr(oauth_module.httpx, "get", lambda *args, **kwargs: _Response())


def test_verify_apple_id_token_accepts_a_valid_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _apple_keys(monkeypatch)
    assert oauth_module.verify_apple_id_token(
        _APPLE_TEST_TOKEN_GOOD, "apple-client-id"
    ) == ("apple-sub-1", "ada@example.com")


def test_verify_apple_id_token_rejects_a_tampered_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _apple_keys(monkeypatch)
    with pytest.raises(
        oauth_module.ProviderError, match="Apple token signature is invalid"
    ):
        oauth_module.verify_apple_id_token(
            _APPLE_TEST_TOKEN_TAMPERED, "apple-client-id"
        )


def test_verify_apple_id_token_rejects_a_wrong_audience(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _apple_keys(monkeypatch)
    with pytest.raises(
        oauth_module.ProviderError, match="the token was issued for a different app"
    ):
        oauth_module.verify_apple_id_token(
            _APPLE_TEST_TOKEN_WRONG_AUD, "apple-client-id"
        )


def test_verify_apple_id_token_rejects_an_expired_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _apple_keys(monkeypatch)
    with pytest.raises(oauth_module.ProviderError, match="Apple token is expired"):
        oauth_module.verify_apple_id_token(
            _APPLE_TEST_TOKEN_EXPIRED, "apple-client-id"
        )


def test_verify_apple_id_token_rejects_an_unknown_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _apple_keys(monkeypatch, {"keys": []})
    with pytest.raises(
        oauth_module.ProviderError, match="Apple token was signed by an unknown key"
    ):
        oauth_module.verify_apple_id_token(_APPLE_TEST_TOKEN_GOOD, "apple-client-id")


def test_verify_apple_id_token_rejects_a_non_jwt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _apple_keys(monkeypatch)
    with pytest.raises(oauth_module.ProviderError, match="Apple token is not a JWT"):
        oauth_module.verify_apple_id_token("not-a-token", "apple-client-id")


# Phone and email codes


def test_phone_login_sends_and_verifies_a_code() -> None:
    api, sender = _sms_api()
    started = api.ok("POST", "/auth/phone/start", json={"phone_number": "+1 (555) 123-4567"})
    assert started["expires_in_seconds"] == 600
    assert len(sender.sent) == 1
    destination, code = sender.sent[0]
    assert destination == "+15551234567"
    response = api.ok(
        "POST",
        "/auth/phone/verify",
        json={
            "verification_id": started["verification_id"],
            "code": code,
            "display_name": "Tex",
        },
    )
    assert response["display_name"] == "Tex"
    assert [
        (account["kind"], account["identifier"])
        for account in response["linked_accounts"]
    ] == [("phone", "+15551234567")]
    # Codes are single-use.
    assert error(
        api.request(
            "POST",
            "/auth/phone/verify",
            json={"verification_id": started["verification_id"], "code": code},
        )
    ) == (404, "verification not found or expired")


def test_email_login_normalizes_the_address() -> None:
    sender = RecordingSender()
    api = Api(
        auth_config=AuthConfig(email=EmailAuthConfig(provider="smtp")),
        email_sender=sender,
    )
    started = api.ok("POST", "/auth/email/start", json={"email": "  Player@Example.COM "})
    destination, code = sender.sent[0]
    assert destination == "player@example.com"
    response = api.ok(
        "POST", "/auth/email/verify",
        json={"verification_id": started["verification_id"], "code": code},
    )
    # Without a display name, the address's local part is used.
    assert response["display_name"] == "player"


def test_phone_login_needs_configuration() -> None:
    assert error(
        Api().request("POST", "/auth/phone/start", json={"phone_number": "+15551234567"})
    ) == (501, "phone login is not configured")


def test_email_login_needs_configuration() -> None:
    assert error(
        Api().request("POST", "/auth/email/start", json={"email": "a@b.c"})
    ) == (501, "email login is not configured")


def test_bad_phone_numbers_and_emails_are_rejected() -> None:
    api, _ = _sms_api()
    assert error(
        api.request("POST", "/auth/phone/start", json={"phone_number": "555-1234"})
    )[0] == 400
    email_api = Api(auth_config=AuthConfig(email=EmailAuthConfig(provider="smtp")))
    assert error(email_api.request("POST", "/auth/email/start", json={"email": "nope"}))[
        0
    ] == 400


def test_wrong_codes_are_rejected_then_locked_out() -> None:
    api, sender = _sms_api()
    started = api.ok("POST", "/auth/phone/start", json={"phone_number": "+15551234567"})
    body = {"verification_id": started["verification_id"], "code": "000000"}
    for _ in range(5):
        assert error(api.request("POST", "/auth/phone/verify", json=body)) == (
            400,
            "wrong code",
        )
    assert error(api.request("POST", "/auth/phone/verify", json=body)) == (
        409,
        "too many wrong codes; request a new one",
    )


def test_a_new_code_invalidates_the_previous_one() -> None:
    api, sender = _sms_api()
    first = api.ok("POST", "/auth/phone/start", json={"phone_number": "+15551234567"})
    second = api.ok("POST", "/auth/phone/start", json={"phone_number": "+15551234567"})
    _, first_code = sender.sent[0]
    _, second_code = sender.sent[1]
    assert error(
        api.request(
            "POST",
            "/auth/phone/verify",
            json={"verification_id": first["verification_id"], "code": first_code},
        )
    ) == (404, "verification not found or expired")
    response = api.ok(
        "POST",
        "/auth/phone/verify",
        json={"verification_id": second["verification_id"], "code": second_code},
    )
    assert response["user_id"]


def test_too_many_code_requests_are_rate_limited() -> None:
    clock = Clock()
    platform = GamePlatform(
        store=InMemoryStore(), clock=clock, new_verification_code=lambda: "123456"
    )
    for _ in range(5):
        platform.start_verification(kind="email", identifier="a@b.c")
    with pytest.raises(ConflictError):
        platform.start_verification(kind="email", identifier="a@b.c")


def test_expired_codes_are_rejected() -> None:
    clock = Clock()
    platform = GamePlatform(
        store=InMemoryStore(), clock=clock, new_verification_code=lambda: "123456"
    )
    verification_id, code, _ = platform.start_verification(
        kind="phone", identifier="+15551234567"
    )
    clock.advance(minutes=11)
    with pytest.raises(NotFoundError):
        platform.verify_code(verification_id=verification_id, code=code)


def test_unknown_verification_ids_are_rejected() -> None:
    api, _ = _sms_api()
    assert error(
        api.request(
            "POST", "/auth/phone/verify",
            json={"verification_id": "nope", "code": "123456"},
        )
    ) == (404, "verification not found or expired")


# Linking and merging


def test_linking_a_login_to_the_current_account(monkeypatch: pytest.MonkeyPatch) -> None:
    api = _google_api(monkeypatch)
    bob = api.new_user("bob")
    response = api.ok("POST", "/auth/google", json={"id_token": "token"}, as_user=bob)
    assert response["user_id"] == bob
    assert response["merged_from_user_id"] is None
    assert ("google", "sub-1") in [
        (account["kind"], account["identifier"])
        for account in response["linked_accounts"]
    ]
    # /auth/me shows the same linked logins.
    me = api.ok("GET", "/auth/me", as_user=bob)
    assert me["user_id"] == bob
    assert ("google", "sub-1") in [
        (account["kind"], account["identifier"]) for account in me["linked_accounts"]
    ]


def test_linking_a_login_owned_by_someone_else_merges_the_accounts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = _google_api(monkeypatch)
    google_id = _track(api, api.ok("POST", "/auth/google", json={"id_token": "token"}))
    game_id = api.new_game(owner=google_id)
    match_id = api.new_match(game_id=game_id, owner=google_id)
    bob = api.new_user("bob")
    response = api.ok("POST", "/auth/google", json={"id_token": "token"}, as_user=bob)
    assert response["user_id"] == bob
    assert response["merged_from_user_id"] == google_id
    # The old account is gone and its stuff moved to bob.
    assert error(api.request("GET", f"/users/{google_id}")) == (
        404,
        "user not found",
    )
    assert api.ok("GET", f"/games/{game_id}")["owner_user_id"] == bob
    assert api.ok("GET", f"/matches/{match_id}")["owner_user_id"] == bob
    assert ("google", "sub-1") in [
        (account["kind"], account["identifier"])
        for account in response["linked_accounts"]
    ]


def test_merge_moves_everything_and_deletes_the_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = _google_api(monkeypatch)
    ann = api.new_user("ann")
    bob = api.new_user("bob")
    # Ann links a Google login and owns a game and a match she plays in.
    ann_auth = api.ok("POST", "/auth/google", json={"id_token": "token"}, as_user=ann)
    assert ann_auth["user_id"] == ann
    game_id = api.new_game(owner=ann)
    match_id = api.new_match(game_id=game_id, owner=ann)
    merged = api.ok("POST", f"/users/{ann}/merge", json={"into_user_id": bob}, as_user=ann)
    assert merged["id"] == bob
    assert error(api.request("GET", f"/users/{ann}")) == (404, "user not found")
    assert api.ok("GET", f"/games/{game_id}")["owner_user_id"] == bob
    match = api.ok("GET", f"/matches/{match_id}")
    assert match["owner_user_id"] == bob
    assert match["players"][0]["user_id"] == bob
    assert ("google", "sub-1") in [
        (account["kind"], account["identifier"])
        for account in api.ok("GET", "/auth/me", as_user=bob)["linked_accounts"]
    ]


def test_merge_requires_authenticating_as_the_source() -> None:
    api = Api()
    ann = api.new_user("ann")
    bob = api.new_user("bob")
    # Bob can't absorb Ann's account.
    assert error(
        api.request("POST", f"/users/{ann}/merge", json={"into_user_id": bob}, as_user=bob)
    ) == (403, "only the merged-away user can request the merge")
    # Nobody can merge a user into itself.
    assert error(
        api.request(
            "POST", f"/users/{ann}/merge", json={"into_user_id": ann}, as_user=ann
        )
    ) == (400, "cannot merge a user into itself")
    # The target has to exist.
    assert error(
        api.request(
            "POST", f"/users/{ann}/merge", json={"into_user_id": "nobody"}, as_user=ann
        )
    ) == (404, "user not found")
    # Anonymous callers can't merge at all.
    assert error(
        api.request("POST", f"/users/{ann}/merge", json={"into_user_id": bob})
    )[0] == 401


def test_merge_rewrites_match_seats_and_hidden_flags() -> None:
    api = Api()
    ann = api.new_user("ann")
    bob = api.new_user("bob")
    carol = api.new_user("carol")
    game_id = api.new_game(owner=ann, allowed_player_counts=(2, 3))
    match_id = api.new_match(game_id=game_id, owner=carol, joiners=[ann], start=True)
    # End the match, then have Ann hide it from her own list.
    turn = api.match_summary(match_id)["turn"]
    api.move(match_id, as_user=carol if 0 in turn else ann, next_turn=None)
    api.ok("DELETE", f"/matches/{match_id}", as_user=ann)
    api.ok("POST", f"/users/{ann}/merge", json={"into_user_id": bob}, as_user=ann)
    match = api.ok("GET", f"/matches/{match_id}")
    assert match["players"][1]["user_id"] == bob
    # Bob's own list hides it now, Ann's credentials are dead.
    assert match_id not in [m["id"] for m in api.ok("GET", "/matches", as_user=bob)]
    assert error(api.request("GET", "/matches", as_user=ann))[0] == 401


def test_merge_does_not_duplicate_an_already_linked_login(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    api = _google_api(monkeypatch)
    ann = api.new_user("ann")
    bob = api.new_user("bob")
    api.ok("POST", "/auth/google", json={"id_token": "token"}, as_user=ann)
    # Bob links a *different* Google account first.
    monkeypatch.setattr(
        api_module, "verify_google_id_token", lambda token, cid: ("sub-2", "Bea")
    )
    api.ok("POST", "/auth/google", json={"id_token": "token"}, as_user=bob)
    # Merge Ann into Bob: Bob keeps both logins, no duplicates.
    api.ok("POST", f"/users/{ann}/merge", json={"into_user_id": bob}, as_user=ann)
    kinds = [
        (account["kind"], account["identifier"])
        for account in api.ok("GET", "/auth/me", as_user=bob)["linked_accounts"]
    ]
    assert sorted(kinds) == [("google", "sub-1"), ("google", "sub-2")]


def test_merge_works_through_the_file_backed_store(tmp_path: Path) -> None:
    """The live server persists with JsonFileStore, which must implement every store
    method the merge uses (regression test: it once missed two)."""
    store = JsonFileStore(tmp_path / "data.json")
    try:
        platform = GamePlatform(store=store, clock=Clock())
        ann = platform.create_user(display_name="ann")
        bob = platform.create_user(display_name="bob")
        game = platform.create_game(
            caller_id=ann.id,
            name="g",
            description="",
            rules=GameRules(
                allowed_player_counts=(2,),
                allows_leave_mid_match=True,
                allows_join_mid_match=False,
            ),
            code="<div/>",
        )
        merged = platform.merge_users(
            caller_id=ann.id, from_user_id=ann.id, into_user_id=bob.id
        )
        assert merged.id == bob.id
        assert store.get_game(game.id).owner_user_id == bob.id  # type: ignore[union-attr]
        assert store.get_user(ann.id) is None
    finally:
        store.close()


# Open matches


def test_open_matches_lists_joinable_matches_without_login() -> None:
    api = Api()
    owner = api.new_user("owner")
    game_id = api.new_game(owner=owner, allowed_player_counts=(2, 3))
    waiting = api.new_match(game_id=game_id, owner=owner)
    response = api.client.get("/matches/open")
    assert response.status_code == 200
    assert [match["id"] for match in response.json()] == [waiting]


def test_open_matches_excludes_full_matches_but_keeps_joinable_ones() -> None:
    api = Api()
    owner = api.new_user("owner")
    other = api.new_user("other")
    strict_id = api.new_game(owner=owner, allowed_player_counts=(2,))
    api.new_match(game_id=strict_id, owner=owner, joiners=[other], start=True)
    open_id = api.new_game(
        owner=owner, allowed_player_counts=(2, 3), allows_join_mid_match=True
    )
    joinable = api.new_match(game_id=open_id, owner=owner, joiners=[other], start=True)
    response = api.client.get("/matches/open")
    assert [match["id"] for match in response.json()] == [joinable]


def test_login_with_an_invalid_kind_is_rejected() -> None:
    platform = GamePlatform(store=InMemoryStore(), clock=Clock())
    with pytest.raises(InvalidRequestError):
        platform.start_verification(kind="oauth", identifier="x")  # type: ignore[arg-type]
