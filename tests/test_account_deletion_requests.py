"""Confirmed deletion scheduling, private lifecycle metadata and frozen auth."""
import datetime as dt
from dataclasses import replace
import hashlib
from urllib.parse import parse_qs, urlparse

import pytest

from game_platform.config import AuthConfig, GoogleAuthConfig
from game_platform.json_file_store import JsonFileStore
from game_platform.service import AccountDeletionInProgressError, ConflictError, GamePlatform
from game_platform.store import InMemoryStore
from game_platform.tests.helpers import Api


NOW = dt.datetime(2026, 11, 19, 12, tzinfo=dt.timezone.utc)
PATH = "/users/me/deletion-request"
FIELDS = ("deletion_requested_at", "deletion_scheduled_at", "deletion_started_at")


def fixed_api(**kwargs):
    api = Api(**kwargs)
    api.platform._clock = lambda: NOW
    return api


@pytest.mark.parametrize("body", [{}, {"confirmed": False}, {"confirmed": 1}, {"confirmed": "true"}, {"confirmed": None}, {"confirmed": True, "user_id": "someone-else"}])
def test_deletion_requires_explicit_strict_confirmation(body):
    api = fixed_api()
    user = api.new_user("Deletion confirmation")
    assert api.request("POST", PATH, as_user=user, json=body).status_code == 422
    assert api.platform._store.get_user(user).deletion_scheduled_at is None


def test_request_is_own_authenticated_idempotent_and_private():
    api = fixed_api()
    user, other = api.new_user("Owner"), api.new_user("Other")
    assert api.request("POST", PATH, json={"confirmed": True}).status_code == 401
    result = api.ok("POST", PATH, as_user=user, json={"confirmed": True})
    assert dt.datetime.fromisoformat(result["deletion_requested_at"].replace("Z", "+00:00")) == NOW
    assert dt.datetime.fromisoformat(result["deletion_scheduled_at"].replace("Z", "+00:00")) == NOW + dt.timedelta(hours=24)
    api.platform._clock = lambda: NOW + dt.timedelta(hours=2)
    repeated = api.ok("POST", PATH, as_user=user, json={"confirmed": True})
    assert all(repeated[field] == result[field] for field in FIELDS)
    own = api.ok("GET", f"/users/{user}", as_user=user)
    assert own["deletion_scheduled_at"] == result["deletion_scheduled_at"]
    for viewer in (None, other):
        public = api.ok("GET", f"/users/{user}", as_user=viewer)
        assert all(public[field] is None for field in FIELDS)
    assert api.platform._store.get_user(other).deletion_scheduled_at is None


def test_undo_deadline_is_exclusive_and_cancel_allows_a_fresh_24_hours():
    api = fixed_api()
    user = api.new_user("Undo")
    api.ok("POST", PATH, as_user=user, json={"confirmed": True})
    api.platform._clock = lambda: NOW + dt.timedelta(hours=24) - dt.timedelta(microseconds=1)
    cancelled = api.ok("DELETE", PATH, as_user=user)
    assert all(cancelled[field] is None for field in FIELDS)
    api.platform._clock = lambda: NOW + dt.timedelta(days=2)
    api.ok("POST", PATH, as_user=user, json={"confirmed": True})
    api.platform._clock = lambda: NOW + dt.timedelta(days=3)
    assert api.request("DELETE", PATH, as_user=user).status_code == 409
    assert api.platform._store.get_user(user).deletion_scheduled_at == NOW + dt.timedelta(days=3)


def test_schedule_survives_json_store_restart(tmp_path):
    file = tmp_path / "accounts.json"
    store = JsonFileStore(file, min_write_interval_seconds=0)
    api = fixed_api(store=store)
    user = api.new_user("Durable request")
    password = api.passwords_by_user_id[user]
    api.ok("POST", PATH, as_user=user, json={"confirmed": True})
    store.close()
    reopened = JsonFileStore(file, min_write_interval_seconds=0)
    try:
        again = fixed_api(store=reopened)
        again.platform._clock = lambda: NOW + dt.timedelta(hours=23)
        assert reopened.get_user(user).deletion_scheduled_at == NOW + dt.timedelta(hours=24)
        response = again.request("DELETE", PATH, as_user=user, password=password)
        assert response.status_code == 200 and response.json()["deletion_scheduled_at"] is None
    finally:
        reopened.close()


@pytest.mark.parametrize("pending_side", ["source", "target"])
def test_pending_deletion_cannot_be_merged_away(pending_side):
    api = fixed_api()
    source, target = api.new_user("Source"), api.new_user("Target")
    pending = source if pending_side == "source" else target
    api.ok("POST", PATH, as_user=pending, json={"confirmed": True})
    result = api.request("POST", f"/users/{source}/merge", as_user=source,
                         json={"into_user_id": target, "into_password": api.passwords_by_user_id[target]})
    assert result.status_code == 409
    assert api.platform._store.get_user(source).replaced_by_user_id is None
    assert api.platform._store.get_user(pending).deletion_scheduled_at == NOW + dt.timedelta(hours=24)


def test_offline_merge_finalize_refuses_pending_account_before_rewriting_identities():
    from game_platform.scaling_accounts import _merge_finalize
    platform = GamePlatform(clock=lambda: NOW)
    source = platform.create_user(display_name="Offline source")
    target = platform.create_user(display_name="Offline target")
    platform._store._users[source.id] = replace(source, deletion_requested_at=NOW,
                                              deletion_scheduled_at=NOW + dt.timedelta(hours=24))
    with pytest.raises(ConflictError, match="cancel the account deletion"):
        _merge_finalize(platform._store, {"source_id": source.id, "into_id": target.id})
    assert platform._store.get_user(source.id).replaced_by_user_id is None


def test_merged_alias_credentials_fail_closed_when_survivor_is_gone_or_purging():
    api = fixed_api()
    alias, survivor = api.new_user("Alias"), api.new_user("Survivor")
    api.ok("POST", f"/users/{alias}/merge", as_user=alias,
           json={"into_user_id": survivor, "into_password": api.passwords_by_user_id[survivor]})
    row = api.platform._store.get_user(survivor)
    # Simulate an external worker's committed claim, bypassing the API itself.
    api.platform._store._users[survivor] = replace(row, deletion_started_at=NOW)
    for user in (alias, survivor):
        assert api.request("GET", "/users/me/notifications", as_user=user).status_code == 401
    api.platform._store._users.pop(survivor)
    assert api.request("GET", "/users/me/notifications", as_user=alias).status_code == 401


def test_frozen_public_profile_does_not_unauthenticate_other_match_participants():
    api = fixed_api()
    frozen, viewer = api.new_user("Frozen"), api.new_user("Still active")
    row = api.platform._store.get_user(frozen)
    api.platform._store._users[frozen] = replace(row, deletion_started_at=NOW)
    assert api.request("GET", f"/users/{frozen}", as_user=viewer).status_code == 404
    profiles = api.ok("GET", "/users", as_user=viewer, params={"ids": f"{frozen},{viewer}"})
    assert [row["id"] for row in profiles] == [viewer]


def test_old_alias_credentials_schedule_the_canonical_account_only():
    api = fixed_api()
    alias, survivor = api.new_user("Old alias"), api.new_user("Canonical")
    api.ok("POST", f"/users/{alias}/merge", as_user=alias,
           json={"into_user_id": survivor, "into_password": api.passwords_by_user_id[survivor]})
    result = api.ok("POST", PATH, as_user=alias, json={"confirmed": True})
    assert result["id"] == survivor and result["deletion_scheduled_at"] is not None
    assert api.platform._store.get_user(alias).deletion_scheduled_at is None


def test_legacy_admin_delete_cannot_abandon_a_pending_full_purge():
    api = fixed_api()
    user = api.new_user("Pending full purge")
    api.ok("POST", PATH, as_user=user, json={"confirmed": True})
    response = api.request("DELETE", f"/admin/users/{user}")
    assert response.status_code == 409
    assert api.platform._store.get_user(user).deletion_scheduled_at == NOW + dt.timedelta(hours=24)


@pytest.mark.parametrize("locale", ["es", "ar"])
def test_query_admin_delete_refusal_uses_the_shared_localized_lifecycle_error(locale):
    from game_platform import i18n
    from game_platform.scaling_service import ScalablePlatform
    from game_platform.tests.fake_firestore import query_store

    store = query_store("deletion_admin_locale")
    try:
        api = fixed_api(store=store)
        api.platform = ScalablePlatform(store=store, clock=lambda: NOW)
        api.client.app.state.platform = api.platform
        user = api.new_user("Pending deletion")
        api.ok("POST", PATH, as_user=user, json={"confirmed": True})
        response = api.request("DELETE", f"/admin/users/{user}", params={"lang": locale})
        assert response.status_code == 409
        assert response.json() == {
            "code": "account_deletion_admin_pending",
            "detail": i18n.messages(locale)["error.account_deletion_admin_pending"],
        }
        assert store.get_user(user).deletion_scheduled_at == NOW + dt.timedelta(hours=24)
    finally:
        store.close()


def test_purging_auth_rechecks_fresh_transaction_instead_of_stale_profile_cache():
    class CachedStore(InMemoryStore):
        def __init__(self):
            super().__init__()
            self.depth, self.stale = 0, {}
            self.operation_lock = self
        def __enter__(self): self.depth += 1
        def __exit__(self, *_): self.depth -= 1
        def get_user(self, user_id):
            return super().get_user(user_id) if self.depth else self.stale.get(user_id, super().get_user(user_id))
    store = CachedStore()
    platform = GamePlatform(store=store, clock=lambda: NOW)
    user = platform.create_user(display_name="Cached identity")
    store.stale[user.id] = user
    store._users[user.id] = replace(user, deletion_started_at=NOW)
    assert store.get_user(user.id).deletion_started_at is None
    with pytest.raises(AccountDeletionInProgressError):
        platform.authenticate(user_id=user.id, password=user.password)


def test_google_login_cannot_treat_a_frozen_authenticated_caller_as_anonymous(monkeypatch):
    import game_platform.api as api_module
    api = fixed_api(auth_config=AuthConfig(google=GoogleAuthConfig(client_id="test-client")))
    user = api.new_user("Frozen caller")
    row = api.platform._store.get_user(user)
    api.platform._store._users[user] = replace(row, deletion_started_at=NOW)
    monkeypatch.setattr(api_module, "verify_google_id_token", lambda *_: ("new-subject", "New name", "new@example.test", ""))
    response = api.request("POST", "/auth/google", as_user=user, json={"id_token": "test-token"})
    assert response.status_code == 401
    assert len(api.platform._store.list_users()) == 1


def test_browser_handoff_cannot_exchange_credentials_after_external_purge_claim():
    api = fixed_api()
    user = api.new_user("Browser handoff")
    verifier = "a" * 64
    token = api.ok("POST", "/auth/app-sessions", json={"challenge": hashlib.sha256(verifier.encode()).hexdigest()})["session_id"]
    callback = api.ok("POST", f"/auth/app-sessions/{token}/complete", as_user=user)["callback_url"]
    code = parse_qs(urlparse(callback).query)["code"][0]
    row = api.platform._store.get_user(user)
    api.platform._store._users[user] = replace(row, deletion_started_at=NOW)
    result = api.request("POST", f"/auth/app-sessions/{token}/exchange", json={"verifier": verifier, "code": code})
    assert result.status_code == 401 and "password" not in result.json()
