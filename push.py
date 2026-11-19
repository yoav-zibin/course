"""Delivers browser and native push notifications.

The service decides *who* is told *what* ([GamePlatform] composes localized messages);
this module decides *how*. [PushNotifier] is the interface the service depends on.
[LogPushNotifier] writes notifications to the server log (development only).
[WebPushNotifier] encrypts and posts them to the browsers' push services (RFC 8030,
payload encryption RFC 8291, VAPID signatures RFC 8292).
[ExpoPushDelivery] routes native messages through Expo to FCM/APNs and checks
delivery receipts; [RoutedPushNotifier] enforces the current account preference.

Delivery never happens on the request path: [enqueue] only queues, and a worker
thread does the network I/O, so a slow push service can't stall the platform, which
serializes all requests under one lock. Notifications are best-effort: a lost one is
annoying, not corrupting, so failures are logged, not raised.
"""

import base64
import datetime as dt
import json
import logging
import queue
import threading
from urllib.parse import urlsplit

import requests
from collections.abc import Sequence
from contextlib import nullcontext
from dataclasses import dataclass
from typing import Protocol

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pywebpush import WebPushException, webpush

from game_platform.config import PushConfig
from game_platform.models import WebPushSubscription
from game_platform.store import Store

logger = logging.getLogger(__name__)


@dataclass(frozen=True, kw_only=True)
class PushMessage:
    """One notification to one subscription: what to show and where a click goes."""

    subscription: WebPushSubscription
    title: str
    body: str
    # Opened when the user clicks the notification (a portal match link).
    url: str
    # Browsers replace a showing notification that has the same tag.
    tag: str
    notification_id: str = ""


class PushNotifier(Protocol):
    def enqueue(self, messages: Sequence[PushMessage]) -> None:
        """Queues notifications for delivery. Never blocks on network I/O and never
        raises: the action a notification reports has already happened."""
        ...

    def close(self) -> None:
        """Delivers what's queued and stops the worker thread, if any."""
        ...


class LogPushNotifier:
    """Writes notifications to the log instead of delivering them. For development."""

    def enqueue(self, messages: Sequence[PushMessage]) -> None:
        for message in messages:
            logger.info(
                "push to %s (%s): %s — %s",
                message.subscription.user_id,
                message.subscription.endpoint,
                message.title,
                message.body,
            )

    def close(self) -> None:
        pass

    def deliver(self, message: PushMessage) -> None:
        self.enqueue([message])


def validate_push_endpoint(endpoint: str) -> None:
    """Real delivery only contacts browser push services, never arbitrary URLs."""
    try:
        url = urlsplit(endpoint)
        host = (url.hostname or "").lower()
        allowed = host in {
            "fcm.googleapis.com", "android.googleapis.com",
            "updates.push.services.mozilla.com",
        } or any(host.endswith("." + suffix) for suffix in (
            "push.apple.com", "notify.windows.com",
        ))
        if (url.scheme != "https" or not allowed or url.port not in (None, 443)
                or url.username or url.password or url.fragment):
            raise ValueError("endpoint must be an HTTPS browser push-service URL")
    except ValueError:
        raise ValueError("endpoint must be an HTTPS browser push-service URL") from None


class _PushSession(requests.Session):
    def post(self, url, **kwargs):
        validate_push_endpoint(url)
        # Even a trusted service's redirect must not turn into a request to
        # an internal host. pywebpush handles a 3xx as a delivery failure.
        kwargs["allow_redirects"] = False
        return super().post(url, **kwargs)


class WebPushNotifier:
    """Sends real Web Push messages from a worker thread.

    [store] drops subscriptions whose endpoint is gone (the push service answers 404
    or 410), so dead browsers don't accumulate. It must be safe for concurrent use
    (JsonFileStore is; InMemoryStore isn't).
    """

    def __init__(self, *, config: PushConfig, store: Store) -> None:
        if not config.vapid_private_key:
            raise ValueError(
                'push.provider is "webpush" but vapid_private_key is empty: set it in '
                "the config or the GAME_PLATFORM_VAPID_PRIVATE_KEY environment variable "
                "(generate a pair with --generate-vapid-keys)"
            )
        if not config.vapid_subject:
            raise ValueError(
                'push.provider is "webpush" but vapid_subject is empty: give push '
                'services an operator contact, e.g. "mailto:you@example.com"'
            )
        # Fail fast on a malformed key. pywebpush wants the key as a base64url
        # string: its Vapid.from_string base64-decodes what it is given, so the
        # configured value (base64url PKCS#8, like generate_vapid_keys makes)
        # is passed through unchanged — a PEM rendering, bytes or text, breaks it.
        _load_private_key(config.vapid_private_key)
        self._private_key = config.vapid_private_key
        self._subject = config.vapid_subject
        self._ttl = config.ttl_seconds
        self._store = store
        self._queue: queue.Queue[PushMessage | None] = queue.Queue()
        self._worker = threading.Thread(
            target=self._work, name="web-push-sender", daemon=True
        )
        self._worker.start()

    def enqueue(self, messages: Sequence[PushMessage]) -> None:
        for message in messages:
            self._queue.put(message)

    def close(self) -> None:
        self._queue.put(None)
        self._worker.join(timeout=10)

    def _work(self) -> None:
        while True:
            item = self._queue.get()
            try:
                if item is None:
                    return
                self._send(item)
            except Exception:
                # The worker must survive whatever a push service does.
                logger.exception("push delivery failed unexpectedly")
            finally:
                self._queue.task_done()

    def deliver(self, message: PushMessage) -> None:
        """Synchronous outbox delivery; transient failures remain retryable."""
        self._send(message, retry_errors=True)

    def _send(self, message: PushMessage, *, retry_errors: bool = False) -> None:
        subscription = message.subscription
        try:
            validate_push_endpoint(subscription.endpoint)
        except ValueError:
            logger.warning("skipping subscription with an unsupported push-service endpoint")
            return
        try:
            with _PushSession() as session:
                self._send_to_service(message, session)
        except WebPushException as error:
            response = getattr(error, "response", None)
            status = response.status_code if response is not None else None
            if status in (404, 410):
                self._store.delete_push_subscription_by_endpoint(subscription.endpoint)
            elif retry_errors:
                raise
            else:
                logger.warning("push delivery failed (%s)", status)

    def _send_to_service(self, message: PushMessage, session: requests.Session) -> None:
        subscription = message.subscription
        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {
                    "p256dh": subscription.p256dh,
                    "auth": subscription.auth,
                },
            },
            data=json.dumps(
                {
                    "title": message.title,
                    "body": message.body,
                    "url": message.url,
                    "tag": message.tag,
                    "user_id": subscription.user_id,
                    "notification_id": message.notification_id,
                }
            ),
            vapid_private_key=self._private_key,
            vapid_claims={"sub": self._subject},
            ttl=self._ttl,
            headers={"Urgency": "high"},
            timeout=30,
            requests_session=session,
        )


def make_push_notifier(config: PushConfig, store: Store) -> PushNotifier:
    """The [config.provider]'s notifier. Raises ValueError on incomplete VAPID setup."""
    browser = (WebPushNotifier(config=config, store=store)
               if config.provider == "webpush" else LogPushNotifier())
    return RoutedPushNotifier(config=config, store=store, browser=browser)


class ExpoPushDelivery:
    """Native push through Expo, with delayed delivery-receipt processing.

    Query mode persists receipts so restarts do not lose invalid-token cleanup.
    Local file mode retains pending receipts in memory, like its delivery queue.
    """

    def __init__(self, *, config: PushConfig, store: Store) -> None:
        self.config, self.store = config, store
        self._pending: dict[str, dict] = {}
        self._lock = threading.Lock()

    def _post(self, action: str, payload: dict) -> dict:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.config.expo_access_token:
            headers["Authorization"] = f"Bearer {self.config.expo_access_token}"
        response = requests.post(
            f"https://exp.host/--/api/v2/push/{action}", json=payload,
            headers=headers, timeout=30, allow_redirects=False,
        )
        # Keep tokens and server response bodies out of error logs.
        if response.status_code != 200:
            raise RuntimeError(f"Expo push {action} returned HTTP {response.status_code}")
        result = response.json()
        if not isinstance(result, dict) or "data" not in result:
            raise RuntimeError(f"Expo push {action} returned an invalid response")
        return result["data"]

    def deliver(self, message: PushMessage) -> None:
        token = message.subscription.endpoint.removeprefix("expo:")
        ticket = self._post("send", {
            "to": token, "title": message.title, "body": message.body,
            "sound": "default", "priority": "high", "channelId": "matches",
            "ttl": self.config.ttl_seconds,
            "data": {"url": message.url, "user_id": message.subscription.user_id,
                     "notification_id": message.notification_id},
        })
        if not isinstance(ticket, dict):
            raise RuntimeError("Expo push returned an invalid ticket")
        if ticket.get("status") != "ok":
            self._handle_error(ticket, message.subscription.endpoint)
            return
        receipt_id = ticket.get("id")
        if not isinstance(receipt_id, str) or not receipt_id or "/" in receipt_id or len(receipt_id) > 128:
            raise RuntimeError("Expo push returned an invalid receipt ID")
        now = dt.datetime.now(dt.timezone.utc)
        record = {"receipt_id": receipt_id, "endpoint": message.subscription.endpoint,
                  "user_id": message.subscription.user_id,
                  "created_at": now, "due_at": now + dt.timedelta(minutes=15)}
        if getattr(self.store, "scalable", False):
            with self.store.atomic():
                self.store.raw_put(self.store.ref("push_receipts", receipt_id), record)
        else:
            with self._lock:
                self._pending[receipt_id] = record

    def _handle_error(self, result: dict, endpoint: str) -> None:
        error = (result.get("details") or {}).get("error", "UnknownError")
        if error == "DeviceNotRegistered":
            self.store.delete_push_subscription_by_endpoint(endpoint)
        elif error in {"MessageRateExceeded", "ExpoServerError", "InternalServerError", "UnknownError"}:
            raise RuntimeError("Expo push delivery temporarily failed")
        else:
            logger.warning("Expo push rejected a notification (%s)", error)

    def run_receipts(self, limit: int = 10) -> None:
        now = dt.datetime.now(dt.timezone.utc)
        scalable = getattr(self.store, "scalable", False)
        if scalable:
            from google.cloud.firestore_v1.base_query import FieldFilter
            records = {}
            for doc in (self.store.collection("push_receipts")
                        .where(filter=FieldFilter("due_at", "<=", now))
                        .order_by("due_at").limit(limit).stream()):
                with self.store.atomic():
                    row = self.store.raw_get(doc.reference)
                    if not row or row["due_at"] > now:
                        continue
                    # Claim before network I/O; a failed/crashed check retries.
                    self.store.raw_put(doc.reference, {**row, "due_at": now + dt.timedelta(minutes=1)})
                    records[row["receipt_id"]] = row
        else:
            with self._lock:
                records = {key: row for key, row in self._pending.items() if row["due_at"] <= now}
                records = dict(list(records.items())[:limit])
                for key, row in records.items():
                    self._pending[key] = {**row, "due_at": now + dt.timedelta(minutes=1)}
        if not records:
            return
        receipts = self._post("getReceipts", {"ids": list(records)})
        if not isinstance(receipts, dict):
            raise RuntimeError("Expo push returned invalid receipts")
        for key, row in records.items():
            receipt = receipts.get(key)
            if receipt is None and now - row["created_at"] < dt.timedelta(hours=24):
                continue
            if isinstance(receipt, dict) and receipt.get("status") == "error":
                self._handle_error(receipt, row["endpoint"])
            if scalable:
                with self.store.atomic():
                    self.store.raw_put(self.store.ref("push_receipts", key), None)
            else:
                with self._lock:
                    self._pending.pop(key, None)


class RoutedPushNotifier:
    """Routes browser/native messages and rechecks preferences before delivery."""

    def __init__(self, *, config: PushConfig, store: Store, browser) -> None:
        self.config, self.store, self.browser = config, store, browser
        self.native = ExpoPushDelivery(config=config, store=store)
        self._queue: queue.Queue[PushMessage | None] = queue.Queue()
        self._worker = threading.Thread(target=self._work, name="push-router", daemon=True)
        self._worker.start()

    def enqueue(self, messages: Sequence[PushMessage]) -> None:
        for message in messages:
            self._queue.put(message)

    def deliver(self, message: PushMessage) -> None:
        # A queued push must not survive opt-out, logout, or endpoint reassignment.
        # Transactional point reads bypass the query store's stale read cache.
        with self.store.atomic() if getattr(self.store, "scalable", False) else nullcontext():
            subscription = self.store.get_push_subscription_by_endpoint(message.subscription.endpoint)
            if subscription is None or subscription.user_id != message.subscription.user_id:
                return
            user = self.store.get_user(subscription.user_id)
            if user is None or not user.notifications_enabled:
                return
        expiration = subscription.expiration_time
        if expiration is not None and expiration.tzinfo is None:
            expiration = expiration.replace(tzinfo=dt.timezone.utc)
        if expiration is not None and expiration <= dt.datetime.now(dt.timezone.utc):
            self.store.delete_push_subscription_by_endpoint(subscription.endpoint)
            return
        if subscription.delivery == "expo":
            if self.config.native_enabled:
                self.native.deliver(message)
        else:
            self.browser.deliver(message)

    @property
    def receipts_enabled(self) -> bool:
        return self.config.native_enabled

    def run_receipts(self, limit: int = 10) -> None:
        if self.receipts_enabled:
            self.native.run_receipts(limit)

    def _work(self) -> None:
        while True:
            try:
                message = self._queue.get(timeout=30)
            except queue.Empty:
                if not getattr(self.store, "scalable", False):
                    try:
                        self.run_receipts()
                    except Exception:
                        logger.warning("native push receipt check failed")
                continue
            try:
                if message is None:
                    return
                self.deliver(message)
            except Exception:
                logger.warning("push delivery failed")
            finally:
                self._queue.task_done()

    def close(self) -> None:
        self._queue.put(None)
        self._worker.join(timeout=10)
        self.browser.close()


# VAPID keys (RFC 8292): one EC P-256 pair per deployment. The private key signs every
# push request; browsers subscribe with the public key (applicationServerKey). Both
# are base64url strings: the private key is PKCS#8 DER, the public key the
# uncompressed point.


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def generate_vapid_keys() -> tuple[str, str]:
    """A new VAPID key pair: (private, public). The private key goes in the config's
    push.vapid_private_key (or GAME_PLATFORM_VAPID_PRIVATE_KEY); the public key is
    served to browsers by /push/config. Rotating the pair invalidates existing
    subscriptions: browsers re-subscribe with the new key."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    private_der = private_key.private_bytes(
        serialization.Encoding.DER,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    public_point = private_key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return _b64url_encode(private_der), _b64url_encode(public_point)


def _load_private_key(private_key_b64url: str) -> ec.EllipticCurvePrivateKey:
    try:
        key = serialization.load_der_private_key(
            _b64url_decode(private_key_b64url), password=None
        )
    except (ValueError, TypeError) as error:
        raise ValueError(
            "vapid_private_key is not a base64url-encoded PKCS#8 key; "
            "generate one with --generate-vapid-keys"
        ) from error
    if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(
        key.curve, ec.SECP256R1
    ):
        raise ValueError(
            "vapid_private_key must be a P-256 EC key; generate one with "
            "--generate-vapid-keys"
        )
    return key


def vapid_public_key(private_key_b64url: str) -> str:
    """The base64url public key browsers subscribe with, for a configured private key."""
    public_point = (
        _load_private_key(private_key_b64url)
        .public_key()
        .public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )
    return _b64url_encode(public_point)
