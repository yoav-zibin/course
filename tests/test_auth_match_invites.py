"""All signup methods retain match-invite attribution in both storage modes."""
import datetime as dt

import pytest

from game_platform import api as api_module
from game_platform.config import AuthConfig, EmailAuthConfig, GoogleAuthConfig, SmsAuthConfig
from game_platform.scaling_service import ScalablePlatform
from game_platform.query_store import QueryStore
from game_platform.service import ConflictError, InvalidRequestError, NotFoundError, VERIFICATION_MAX_ATTEMPTS
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api
from game_platform.tests.test_auth import RecordingSender


def signup_api(store=None):
    sender = RecordingSender()
    api = Api(auth_config=AuthConfig(
        email=EmailAuthConfig(provider="smtp"),
        google=GoogleAuthConfig(client_id="fake-local-client"),
    ), email_sender=sender)
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    if store is not None:
        api.platform = ScalablePlatform(store=store, clock=lambda: now)
        api.client.app.state.platform = api.platform
    else:
        api.platform._clock = lambda: now
    return api, sender


def invite_for(api, inviter):
    match = api.new_match(owner=inviter, game_id=api.new_game(owner=inviter))
    return api.ok("POST", f"/matches/{match}/invites", as_user=inviter)["token"]


def assert_invited_signup(api, sender, provider, monkeypatch):
    monkeypatch.setattr(api_module, "verify_google_id_token",
                        lambda token, client: ("fake-local-subject", "New player", "", ""))
    inviter = api.new_user("Inviter")
    token = invite_for(api, inviter)

    def login(invite):
        if provider == "google":
            body = {"id_token": "fake-local-token"}
        else:
            started = api.ok("POST", "/auth/email/start", json={"email": "new@example.test"})
            body = {"verification_id": started["verification_id"], "code": sender.sent[-1][1]}
        endpoint = "/auth/google" if provider == "google" else "/auth/email/verify"
        return api.ok("POST", endpoint,
                      json={**body, "invite_token": invite})

    response = login(token)
    user = api.platform._store.get_user(response["user_id"])
    assert user.invited_by_user_id == inviter
    assert user.invited_via_invite_token == token
    other = api.new_user("Another inviter")
    assert login(invite_for(api, other))["user_id"] == user.id
    stored = api.platform._store.get_user(user.id)
    assert stored.invited_by_user_id == inviter
    assert stored.invited_via_invite_token == token


@pytest.mark.parametrize("provider", ["email", "google"])
@pytest.mark.parametrize("mode", ["memory", "query"])
def test_signups_keep_the_match_invite_but_existing_logins_do_not_change_it(mode, provider, monkeypatch):
    api, sender = signup_api(query_store() if mode == "query" else None)
    assert_invited_signup(api, sender, provider, monkeypatch)


def test_query_email_http_verification_accepts_the_campaign_parameter():
    api, _ = signup_api(query_store())
    identity, code, _ = api.platform.start_verification(kind="email", identifier="campaign@example.test")
    response = api.client.post("/auth/email/verify", json={"verification_id": identity, "code": code},
                               headers={"X-Campaign-Code": "students-a"})
    assert response.status_code == 200, response.text
    assert api.platform._store.raw_get(api.platform._store.ref("verifications", identity)) is None
    from game_platform.service import CAMPAIGN_EXPERIMENT_ID

    campaign = next(item for item in api.platform._store.list_experiments()
                    if item.id == CAMPAIGN_EXPERIMENT_ID)
    variant = next(item for item in campaign.variants if item.key == "students-a")
    assert any(event.kind == "signup" and event.variant_id == variant.id
               and event.user_id == response.json()["user_id"]
               for event in api.platform._store.list_experiment_events())


def assert_external_phone_signup(store):
    api, _ = signup_api(store)
    api.client.app.state.auth_config = AuthConfig(sms=SmsAuthConfig(provider="verify"))

    class LocalVerifyClient:
        def start_verification(self, number, channel):
            assert (number, channel) == ("+15551234567", "sms")

        def check_verification(self, number, code):
            assert number == "+15551234567"
            return code == "local-approved-code"

    api.client.app.state.verify_client = LocalVerifyClient()
    inviter = api.new_user("Phone inviter")
    token = invite_for(api, inviter)
    identity = api.ok("POST", "/auth/phone/start", json={"phone_number": "+15551234567"})["verification_id"]
    wrong = api.request("POST", "/auth/phone/verify", json={"verification_id": identity, "code": "wrong"})
    assert wrong.status_code == 400, wrong.text
    assert store.raw_get(store.ref("verifications", identity))["attempts"] == 1
    api.client.app.state.platform = ScalablePlatform(
        store=QueryStore(store.client, namespace=store.namespace), clock=api.platform._clock,
    )
    response = api.ok("POST", "/auth/phone/verify", json={
        "verification_id": identity, "code": "local-approved-code", "invite_token": token,
    })
    user = store.get_user(response["user_id"])
    assert user.invited_via_invite_token == token
    assert user.invited_by_user_id == inviter
    assert api.request("POST", "/auth/phone/verify", json={
        "verification_id": identity, "code": "local-approved-code",
    }).status_code == 404


def test_query_external_phone_verification_uses_persisted_challenges():
    assert_external_phone_signup(query_store())


def test_query_external_phone_checks_kind_expiry_and_persistent_attempt_limit():
    api, _ = signup_api(query_store())
    first = api.platform
    second = ScalablePlatform(store=QueryStore(first._store.client, namespace=first._store.namespace),
                              clock=first._clock)
    identity, _, _ = first.start_verification(kind="phone", identifier="+15551234567")
    for _ in range(VERIFICATION_MAX_ATTEMPTS):
        with pytest.raises(InvalidRequestError, match="wrong code"):
            second.finish_external_phone(identity, approved=False)
    with pytest.raises(ConflictError, match="too many wrong codes"):
        first.finish_external_phone(identity, approved=True)
    identity, _, _ = first.start_verification(kind="email", identifier="local@example.test")
    with pytest.raises(NotFoundError):
        first.pending_external_phone(identity)
    identity, _, _ = first.start_verification(kind="phone", identifier="+15551234567")
    now = first._clock() + dt.timedelta(minutes=11)
    first._clock = lambda: now
    with pytest.raises(NotFoundError):
        first.finish_external_phone(identity, approved=True)
