"""Login codes cost money (SMS) or reputation (email) to send, so besides the
per-destination limit, one client may only request a few an hour and the whole server
caps how many it sends, and old request records are forgotten (bug 10: a script
looping over phone numbers could send unlimited texts)."""

import contextlib
import datetime as dt
import types

import pytest

import game_platform.service as service_module
from game_platform.scaling_service import ScalablePlatform
from game_platform.service import (
    VERIFICATION_MAX_STARTS_PER_CLIENT_PER_HOUR,
    ConflictError,
    GamePlatform,
)
from game_platform.store import InMemoryStore
from game_platform.tests.test_auth import Clock, _sms_api
from game_platform.tests.helpers import error


def _platform() -> tuple[GamePlatform, Clock]:
    clock = Clock()
    return GamePlatform(store=InMemoryStore(), clock=clock), clock


def test_one_client_cannot_loop_over_phone_numbers() -> None:
    platform, clock = _platform()
    for n in range(VERIFICATION_MAX_STARTS_PER_CLIENT_PER_HOUR):
        platform.start_verification(kind="phone", identifier=f"+1555000{n:04d}", client="1.2.3.4")
    with pytest.raises(ConflictError):
        platform.start_verification(kind="phone", identifier="+15559999999", client="1.2.3.4")
    # Another client is unaffected, and the first may try again an hour later.
    platform.start_verification(kind="phone", identifier="+15559999999", client="5.6.7.8")
    clock.advance(minutes=61)
    platform.start_verification(kind="phone", identifier="+15558888888", client="1.2.3.4")


def test_the_whole_server_sends_at_most_the_global_number_of_codes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service_module, "VERIFICATION_MAX_STARTS_PER_HOUR_TOTAL", 3)
    platform, clock = _platform()
    for n in range(3):
        platform.start_verification(kind="email", identifier=f"u{n}@x.com", client=f"10.0.0.{n}")
    with pytest.raises(ConflictError):
        platform.start_verification(kind="email", identifier="u9@x.com", client="10.0.0.9")
    clock.advance(minutes=61)
    platform.start_verification(kind="email", identifier="u9@x.com", client="10.0.0.9")


def test_old_request_records_are_forgotten() -> None:
    platform, clock = _platform()
    for n in range(5):
        platform.start_verification(kind="email", identifier=f"u{n}@x.com", client=f"10.0.0.{n}")
    clock.advance(minutes=61)
    platform.start_verification(kind="email", identifier="new@x.com", client="10.0.0.99")
    assert list(platform._verification_starts) == ["new@x.com"]
    assert list(platform._verification_client_starts) == ["10.0.0.99"]
    assert len(platform._verifications) == 1


def test_the_api_limits_each_client_across_destinations() -> None:
    api, sender = _sms_api()
    for n in range(VERIFICATION_MAX_STARTS_PER_CLIENT_PER_HOUR):
        api.ok("POST", "/auth/phone/start", json={"phone_number": f"+1555000{n:04d}"})
    response = api.request("POST", "/auth/phone/start", json={"phone_number": "+15559999999"})
    assert error(response) == (409, "too many codes requested; try again later")
    assert len(sender.sent) == VERIFICATION_MAX_STARTS_PER_CLIENT_PER_HOUR


def test_spoofed_forwarded_for_headers_do_not_reset_the_limit() -> None:
    api, sender = _sms_api()
    for n in range(VERIFICATION_MAX_STARTS_PER_CLIENT_PER_HOUR + 3):
        api.client.post(
            "/auth/phone/start",
            json={"phone_number": f"+1555000{n:04d}"},
            headers={"X-Forwarded-For": f"203.0.113.{n}"},
        )
    assert len(sender.sent) == VERIFICATION_MAX_STARTS_PER_CLIENT_PER_HOUR


class _FakeQueryStore:
    """The few QueryStore calls start_verification makes, in memory."""

    def __init__(self) -> None:
        self.docs: dict[tuple[str, str], dict] = {}

    def ref(self, kind: str, identity: str) -> tuple[str, str]:
        return (kind, identity)

    def raw_get(self, ref):
        return self.docs.get(ref)

    def raw_put(self, ref, data) -> None:
        if data is None:
            self.docs.pop(ref, None)
        else:
            self.docs[ref] = data

    @contextlib.contextmanager
    def atomic(self):
        yield


def test_the_firestore_service_applies_the_same_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = Clock()
    ids = iter(range(10_000))
    platform = types.SimpleNamespace(
        _store=_FakeQueryStore(), _clock=clock,
        _new_id=lambda: f"id{next(ids)}", _new_verification_code=lambda: "123456",
    )
    start = lambda identifier, client: ScalablePlatform.start_verification(  # noqa: E731
        platform, kind="phone", identifier=identifier, client=client
    )
    for n in range(VERIFICATION_MAX_STARTS_PER_CLIENT_PER_HOUR):
        start(f"+1555000{n:04d}", "1.2.3.4")
    with pytest.raises(ConflictError):
        start("+15559999999", "1.2.3.4")
    start("+15559999999", "5.6.7.8")
    # The server-wide cap counts every client.
    import game_platform.scaling_service as scaling_module

    monkeypatch.setattr(scaling_module, "VERIFICATION_MAX_STARTS_PER_HOUR_TOTAL", 12)
    start("+15557777777", "9.9.9.9")
    with pytest.raises(ConflictError):
        start("+15556666666", "8.8.8.8")
    clock.advance(minutes=61)
    start("+15556666666", "8.8.8.8")
    # Every limit record expires (Firestore deletes it by its expires_at TTL).
    assert all("expires_at" in doc for doc in platform._store.docs.values())
