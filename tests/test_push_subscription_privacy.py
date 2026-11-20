"""Push cleanup is scoped to the exact registration that was delivered."""
import datetime as dt
import logging
import os
import uuid
from dataclasses import replace

import pytest
from pywebpush import WebPushException

from game_platform.config import PushConfig
from game_platform.models import User, WebPushSubscription
from game_platform.push import ExpoPushDelivery, LogPushNotifier, PushMessage, WebPushNotifier, generate_vapid_keys
from game_platform.store import InMemoryStore
from game_platform.tests.fake_firestore import FakeClient, query_store


@pytest.fixture(params=["memory", "query", "emulator"])
def registration(request):
    client = None
    if request.param == "emulator":
        address = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
        if not address:
            pytest.skip("requires a local Firestore emulator")
        assert address.startswith(("127.0.0.1:", "localhost:"))
        from google.cloud import firestore
        from game_platform.query_store import QueryStore
        client = firestore.Client(project="demo-game-platform")
        store = QueryStore.initialize(client, namespace="push_privacy_" + uuid.uuid4().hex)
    else:
        store = query_store("push-privacy", FakeClient()) if request.param == "query" else InMemoryStore()
    now = dt.datetime.now(dt.timezone.utc)
    for identity in ("alice", "bob"):
        store.put_user(User(id=identity, display_name=identity, password="test", created_at=now, updated_at=now))
    subscription = WebPushSubscription(id="device", user_id="alice", endpoint="expo:ExponentPushToken[private-device]",
        delivery="expo", p256dh="", auth="", created_at=now, updated_at=now)
    store.put_push_subscription(subscription)
    message = PushMessage(subscription=subscription, title="Match", body="Your turn", url="/portal#match=test", tag="turn")
    yield store, message
    if hasattr(store, "close"):
        store.close()
    if client is not None:
        client.close()


def replacement(subscription, change):
    return replace(subscription, user_id="bob" if change == "owner" else "alice",
                   updated_at=subscription.updated_at + dt.timedelta(seconds=1))


@pytest.mark.parametrize("at_receipt", [False, True])
@pytest.mark.parametrize("change", ["owner", "generation"])
def test_stale_expo_errors_preserve_replacement_registration(registration, monkeypatch, at_receipt, change):
    store, message = registration
    newer = replacement(message.subscription, change)
    delivery = ExpoPushDelivery(config=PushConfig(), store=store)
    dead = {"status": "error", "details": {"error": "DeviceNotRegistered"}}

    def gateway(action, _payload):
        if action == "send" and at_receipt:
            return {"status": "ok", "id": "old-receipt"}
        store.put_push_subscription(newer)
        return {"old-receipt": dead} if at_receipt else dead

    monkeypatch.setattr(delivery, "_post", gateway)
    delivery.deliver(message)
    if at_receipt:
        if getattr(store, "scalable", False):
            ref = store.ref("push_receipts", "old-receipt")
            row = store.raw_get(ref)
            store.raw_put(ref, {**row, "due_at": dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)})
        else:
            delivery._pending["old-receipt"]["due_at"] = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
        delivery.run_receipts()
    assert store.get_push_subscription_by_endpoint(newer.endpoint) == newer


@pytest.mark.parametrize("legacy_receipt", [False, True])
def test_receipt_only_invalidates_the_registration_it_identifies(registration, monkeypatch, legacy_receipt):
    store, message = registration
    delivery = ExpoPushDelivery(config=PushConfig(), store=store)
    dead = {"status": "error", "details": {"error": "DeviceNotRegistered"}}
    monkeypatch.setattr(delivery, "_post", lambda action, payload:
                        {"status": "ok", "id": "receipt"} if action == "send" else {"receipt": dead})
    delivery.deliver(message)
    if getattr(store, "scalable", False):
        ref = store.ref("push_receipts", "receipt")
        row = store.raw_get(ref)
    else:
        row = delivery._pending["receipt"]
    row["due_at"] = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
    if legacy_receipt:
        row.pop("subscription_id")
        row.pop("subscription_updated_at")
    if getattr(store, "scalable", False):
        store.raw_put(ref, row)
    delivery.run_receipts()
    current = store.get_push_subscription_by_endpoint(message.subscription.endpoint)
    assert (current is not None) == legacy_receipt


@pytest.mark.parametrize("change", ["owner", "generation"])
def test_stale_browser_errors_preserve_replacement_registration(registration, monkeypatch, change):
    store, message = registration
    subscription = replace(message.subscription, endpoint="https://fcm.googleapis.com/private-device", delivery="webpush")
    store.put_push_subscription(subscription)
    newer = replacement(subscription, change)
    private_key, _ = generate_vapid_keys()
    delivery = WebPushNotifier(config=PushConfig(vapid_private_key=private_key, vapid_subject="mailto:test@example.invalid"), store=store)

    def send(*_args):
        store.put_push_subscription(newer)
        response = type("Response", (), {"status_code": 410})()
        raise WebPushException("gone", response=response)

    monkeypatch.setattr(delivery, "_send_to_service", send)
    try:
        delivery.deliver(replace(message, subscription=subscription))
    finally:
        delivery.close()
    assert store.get_push_subscription_by_endpoint(newer.endpoint) == newer


def test_development_push_log_does_not_include_device_credential(registration, caplog):
    _store, message = registration
    with caplog.at_level(logging.INFO, logger="game_platform.push"):
        LogPushNotifier().deliver(message)
    assert "push to alice" in caplog.text
    assert message.subscription.endpoint not in caplog.text
    assert "private-device" not in caplog.text


def test_gateway_error_details_are_not_logged(registration, monkeypatch, caplog):
    store, message = registration
    delivery = ExpoPushDelivery(config=PushConfig(), store=store)
    monkeypatch.setattr(delivery, "_post", lambda *_args: {
        "status": "error", "details": {"error": "unrecognized-private-device-details"}})
    delivery.deliver(message)
    assert "Expo push rejected a notification" in caplog.text
    assert "unrecognized-private-device-details" not in caplog.text
