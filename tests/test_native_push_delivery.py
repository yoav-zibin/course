"""Native gateway delivery, receipts, and opt-out after a message was queued."""

import datetime as dt
from dataclasses import replace

import pytest

from game_platform.config import PushConfig
from game_platform.models import User, WebPushSubscription
from game_platform.push import ExpoPushDelivery, PushMessage, RoutedPushNotifier
from game_platform.store import InMemoryStore


def setup_message():
    store = InMemoryStore()
    now = dt.datetime.now(dt.timezone.utc)
    store.put_user(User(id="alice", display_name="Alice", password="secret", created_at=now, updated_at=now))
    subscription = WebPushSubscription(
        id="phone", user_id="alice", endpoint="expo:ExponentPushToken[device-token]",
        delivery="expo", platform="ios", p256dh="", auth="", created_at=now, updated_at=now,
    )
    store.put_push_subscription(subscription)
    message = PushMessage(subscription=subscription, title="Chess", body="Your turn",
                          url="/portal#match=123", tag="match-123-turn", notification_id="notice-1")
    return store, message


def fake_gateway(monkeypatch, responses):
    calls = []

    class Response:
        status_code = 200

        def __init__(self, value):
            self.value = value

        def json(self):
            return {"data": self.value}

    def post(url, **kwargs):
        calls.append((url, kwargs))
        return Response(responses.pop(0))

    monkeypatch.setattr("game_platform.push.requests.post", post)
    return calls


def test_expo_payload_carries_recipient_route_and_inbox_id(monkeypatch):
    store, message = setup_message()
    calls = fake_gateway(monkeypatch, [{"status": "ok", "id": "receipt-1"}])
    delivery = ExpoPushDelivery(config=PushConfig(expo_access_token="gateway-secret"), store=store)
    delivery.deliver(message)
    url, options = calls[0]
    assert url == "https://exp.host/--/api/v2/push/send"
    assert options["json"]["to"] == "ExponentPushToken[device-token]"
    assert options["json"]["data"] == {
        "url": "/portal#match=123", "user_id": "alice", "notification_id": "notice-1",
    }
    assert options["json"]["channelId"] == "matches"
    assert options["headers"]["Authorization"] == "Bearer gateway-secret"
    assert options["allow_redirects"] is False
    assert "secret" not in str(options["json"])
    assert "receipt-1" in delivery._pending


@pytest.mark.parametrize("at_receipt", [False, True])
def test_expo_drops_uninstalled_device(monkeypatch, at_receipt):
    store, message = setup_message()
    dead = {"status": "error", "details": {"error": "DeviceNotRegistered"}}
    responses = [{"status": "ok", "id": "receipt-1"}, {"receipt-1": dead}] if at_receipt else [dead]
    calls = fake_gateway(monkeypatch, responses)
    delivery = ExpoPushDelivery(config=PushConfig(), store=store)
    delivery.deliver(message)
    if at_receipt:
        delivery._pending["receipt-1"]["due_at"] = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
        delivery.run_receipts()
        assert calls[1][1]["json"] == {"ids": ["receipt-1"]}
        assert not delivery._pending
    assert store.get_push_subscription_by_endpoint(message.subscription.endpoint) is None


def test_gateway_transient_errors_remain_retryable(monkeypatch):
    store, message = setup_message()
    fake_gateway(monkeypatch, [{"status": "error", "details": {"error": "MessageRateExceeded"}}])
    delivery = ExpoPushDelivery(config=PushConfig(), store=store)
    with pytest.raises(RuntimeError, match="temporarily failed"):
        delivery.deliver(message)
    assert store.get_push_subscription_by_endpoint(message.subscription.endpoint)


def test_receipt_not_ready_is_retained_and_success_is_removed(monkeypatch):
    store, message = setup_message()
    fake_gateway(monkeypatch, [{"status": "ok", "id": "receipt-1"}, {}, {"receipt-1": {"status": "ok"}}])
    delivery = ExpoPushDelivery(config=PushConfig(), store=store)
    delivery.deliver(message)
    for _ in range(2):
        delivery._pending["receipt-1"]["due_at"] = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
        delivery.run_receipts()
    assert not delivery._pending


@pytest.mark.parametrize("change", ["opt_out", "reassigned", "removed", "expired", "expired_naive", "native_disabled"])
def test_queued_push_rechecks_subscription_and_profile(monkeypatch, change):
    store, message = setup_message()
    sent = []
    if change == "opt_out":
        store.put_user(replace(store.get_user("alice"), notifications_enabled=False))
    elif change == "reassigned":
        store.put_push_subscription(replace(message.subscription, user_id="bob"))
    elif change == "removed":
        store.delete_push_subscription(message.subscription.id)
    elif change in {"expired", "expired_naive"}:
        expiration = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
        if change == "expired_naive":
            expiration = expiration.replace(tzinfo=None)
        store.put_push_subscription(replace(message.subscription, expiration_time=expiration))

    class Browser:
        def close(self):
            pass

    notifier = RoutedPushNotifier(config=PushConfig(native_enabled=change != "native_disabled"), store=store, browser=Browser())
    monkeypatch.setattr(notifier.native, "deliver", sent.append)
    try:
        notifier.deliver(message)
    finally:
        notifier.close()
    assert sent == []


def test_router_delivers_to_native_and_browser(monkeypatch):
    store, message = setup_message()
    native, browser = [], []

    class Browser:
        def deliver(self, item):
            browser.append(item)

        def close(self):
            pass

    notifier = RoutedPushNotifier(config=PushConfig(), store=store, browser=Browser())
    monkeypatch.setattr(notifier.native, "deliver", native.append)
    try:
        notifier.deliver(message)
        web = replace(message.subscription, delivery="webpush", endpoint="https://fcm.googleapis.com/web")
        store.put_push_subscription(web)
        web_message = replace(message, subscription=web)
        notifier.deliver(web_message)
    finally:
        notifier.close()
    assert native == [message]
    assert browser == [web_message]


def test_disabled_native_receipts_do_not_reschedule_the_durable_worker(monkeypatch):
    from unittest.mock import Mock
    from game_platform.scaling_service import ScalablePlatform
    from game_platform.tests.fake_firestore import FakeClient, query_store

    store = query_store("disabled_native_receipts", FakeClient())
    notifier = RoutedPushNotifier(config=PushConfig(native_enabled=False), store=store, browser=Mock())
    platform = ScalablePlatform(store=store, push_notifier=notifier)
    receipt = store.ref("push_receipts", "old-ticket")
    store.raw_put(receipt, {"due_at": dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)})
    wakeups, processed = [], []
    monkeypatch.setattr(platform, "_wake_after", lambda delay=0.1: wakeups.append(delay))
    passes = 0

    def wait(_timeout):
        nonlocal passes
        passes += 1
        if passes == 2:
            platform._stop_workers.set()

    def drain(limit=10):
        processed.append(limit)
        store.raw_put(receipt, None)

    monkeypatch.setattr(platform._worker_event, "wait", wait)
    monkeypatch.setattr(notifier.native, "run_receipts", drain)
    try:
        platform._work_loop()
        assert processed == []
        assert store.raw_get(receipt) is not None
        assert wakeups == [], "disabled receipt delivery must not cause a 100ms Firestore polling loop"
        # Re-enabling delivery processes the retained receipt normally.
        notifier.config = PushConfig(native_enabled=True)
        passes = 0
        platform._stop_workers.clear()
        platform._work_loop()
        assert processed == [10]
        assert store.raw_get(receipt) is None
        assert wakeups == []
    finally:
        notifier.close()
        store.close()
