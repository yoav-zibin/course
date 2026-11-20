"""Verified login rewards are daily, durable and capped independently of spending."""

import datetime as dt
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

import pytest
from pydantic import TypeAdapter

from game_platform import scaling_accounts
from game_platform.json_file_store import JsonFileStore
from game_platform.models import LinkedAccount, User
from game_platform.query_store import QueryStore
from game_platform.scaling_service import ScalablePlatform
from game_platform.service import ConflictError, GamePlatform, InvalidRequestError, NotFoundError
from game_platform.store import InMemoryStore
from game_platform.tests.fake_firestore import query_store


NOW = dt.datetime(2026, 11, 17, tzinfo=dt.timezone.utc)


@pytest.fixture(params=["memory", "query"])
def platform(request):
    if request.param == "query":
        store = query_store()
        with store.atomic():
            store.raw_put(store.collection("meta").document("account_lookups"), {"ready": True})
        return ScalablePlatform(store=store, clock=lambda: NOW)
    return GamePlatform(store=InMemoryStore(), clock=lambda: NOW)


def login(platform, kind="google", identifier="subject", **kwargs):
    return platform.login_with_linked_account(
        kind=kind, identifier=identifier, display_name="Player", **kwargs
    )[0]


@pytest.mark.parametrize("kind,identifier", [
    ("google", "subject"), ("email", "player@example.test"), ("phone", "+15551234567"),
])
def test_verified_login_rewards_once_per_day_even_after_spending_and_linking(platform, kind, identifier):
    user = login(platform, kind, identifier)
    assert user.token_balance == 10
    assert user.verified_login_bonus_granted
    platform._store.put_user(replace(user, token_balance=7))

    platform._clock = lambda: NOW + dt.timedelta(days=3)
    again = login(platform, kind, identifier)
    assert again.id == user.id
    assert again.token_balance == 17
    linked = login(platform, "email", "another@example.test", as_user_id=user.id)
    assert linked.id == user.id
    assert linked.token_balance == 17


@pytest.mark.parametrize("kind,identifier", [
    ("email", "player@example.test"), ("phone", "+15551234567"),
])
def test_guest_gets_bonus_only_after_correct_verification(platform, kind, identifier):
    guest = platform.create_user(display_name="Guest")
    assert guest.token_balance == 0
    assert not guest.verified_login_bonus_granted
    verification_id, code, _ = platform.start_verification(kind=kind, identifier=identifier)
    assert platform._store.get_user(guest.id).token_balance == 0
    wrong = "000000" if code != "000000" else "111111"
    with pytest.raises(InvalidRequestError, match="wrong code"):
        platform.verify_code(verification_id=verification_id, code=wrong, as_user_id=guest.id)
    assert platform._store.get_user(guest.id) == guest

    upgraded, _ = platform.verify_code(
        verification_id=verification_id, code=code, as_user_id=guest.id
    )
    assert upgraded.id == guest.id
    assert upgraded.token_balance == 10
    assert upgraded.verified_login_bonus_granted


def test_external_phone_denial_does_not_credit_guest(platform):
    guest = platform.create_user(display_name="Guest")
    verification_id, _, _ = platform.start_verification(kind="phone", identifier="+15551234567")
    with pytest.raises(InvalidRequestError, match="wrong code"):
        platform.finish_external_phone(verification_id, approved=False, as_user_id=guest.id)
    assert platform._store.get_user(guest.id) == guest
    upgraded, _ = platform.finish_external_phone(verification_id, approved=True, as_user_id=guest.id)
    assert upgraded.id == guest.id
    assert upgraded.token_balance == 10


def legacy_verified_user(platform, kind="google", identifier="legacy-subject"):
    return platform.create_user(
        display_name="Existing player",
        linked_accounts=(LinkedAccount(kind=kind, identifier=identifier, linked_at=NOW),),
    )


def test_existing_verified_user_receives_bonus_on_next_verified_login(platform):
    user = legacy_verified_user(platform)
    platform._store.put_user(replace(user, token_balance=41))
    result = login(platform, identifier="legacy-subject")
    assert result.id == user.id
    assert result.token_balance == 51
    assert login(platform, identifier="legacy-subject").token_balance == 51


def test_bonus_marker_survives_merge_into_stronger_unrewarded_account(platform):
    rewarded = login(platform, "email", "rewarded@example.test")
    platform._store.put_user(replace(rewarded, token_balance=27))
    stronger = legacy_verified_user(platform)
    merged = platform.merge_users(
        caller_id=rewarded.id, from_user_id=rewarded.id,
        into_user_id=stronger.id, into_password=stronger.password,
    )
    assert merged.id == stronger.id
    assert merged.verified_login_bonus_granted
    assert merged.token_balance == 27
    assert platform._store.get_user(rewarded.id).token_balance == 0
    assert login(platform, identifier="legacy-subject").token_balance == 27
    assert login(platform, "email", "rewarded@example.test", as_user_id=rewarded.id).token_balance == 27
    assert login(platform, "phone", "+15551234567", as_user_id=rewarded.id).token_balance == 27


def test_guest_login_merging_into_rewarded_account_does_not_duplicate_bonus(platform):
    rewarded = login(platform)
    platform._store.put_user(replace(rewarded, token_balance=3))
    guest = platform.create_user(display_name="Guest")
    merged, replaced_id = platform.login_with_linked_account(
        kind="google", identifier="subject", display_name="Player", as_user_id=guest.id,
    )
    assert replaced_id == guest.id
    assert merged.id == rewarded.id
    assert merged.token_balance == 3


def test_bonus_and_marker_survive_file_restart(tmp_path):
    path = tmp_path / "users.json"
    store = JsonFileStore(path)
    user = login(GamePlatform(store=store, clock=lambda: NOW))
    store.put_user(replace(user, token_balance=19))
    store.close()

    restarted = JsonFileStore(path)
    try:
        result = login(GamePlatform(store=restarted, clock=lambda: NOW))
        assert result.id == user.id
        assert result.verified_login_bonus_granted
        assert result.token_balance == 19
    finally:
        restarted.close()


def test_old_user_record_without_bonus_marker_loads_as_eligible():
    user = GamePlatform().create_user(display_name="Existing guest")
    adapter = TypeAdapter(User)
    data = adapter.dump_python(user)
    del data["verified_login_bonus_granted"]
    assert not adapter.validate_python(data).verified_login_bonus_granted


def test_query_restart_and_retries_credit_exactly_once():
    store = query_store()
    first = ScalablePlatform(store=store, clock=lambda: NOW)
    user = login(first)
    second = ScalablePlatform(store=QueryStore(store.client, namespace=store.namespace), clock=lambda: NOW)
    assert login(second).token_balance == 10
    assert login(first).token_balance == 10
    first.run_token_ledger()
    credits = [doc.to_dict()["amount"] for doc in store._query("token_ledger", [], limit=100)]
    assert credits.count(10) == 1
    assert sum(credits) == 10
    assert second._store.get_user(user.id).verified_login_bonus_granted


def test_query_failed_bonus_commit_can_retry_without_partial_identity_or_credit(monkeypatch):
    store = query_store()
    platform = ScalablePlatform(store=store, clock=lambda: NOW)
    original_put = store.put_user

    def reject_bonus(user):
        original_put(user)
        if user.verified_login_bonus_granted:
            raise RuntimeError("interrupted transaction")

    with monkeypatch.context() as patch:
        patch.setattr(store, "put_user", reject_bonus)
        with pytest.raises(RuntimeError, match="interrupted transaction"):
            login(platform)
    assert store.find_linked_account("google", "subject") is None
    assert store._query("token_ledger", [], limit=100) == []
    assert login(platform).token_balance == 10


def test_offline_query_merge_preserves_spent_bonus_marker():
    store = query_store()
    platform = ScalablePlatform(store=store, clock=lambda: NOW)
    rewarded = login(platform, "email", "rewarded@example.test")
    store.put_user(replace(rewarded, token_balance=5))
    stronger = legacy_verified_user(platform)
    result = scaling_accounts.merge_users(
        store, run_id="bonus-merge", source_id=rewarded.id, into_id=stronger.id,
    )
    assert result["complete"]
    assert login(platform, identifier="legacy-subject").token_balance == 5
    assert store.get_user(stronger.id).verified_login_bonus_granted
    assert store.get_user(stronger.id).free_tokens_granted == 10
    platform._clock = lambda: NOW + dt.timedelta(days=2)
    assert platform.claim_daily_login(caller_id=rewarded.id).token_balance == 15
    assert store.get_user(stronger.id).free_tokens_granted == 20


def test_offline_query_deletion_records_removed_balance_once_after_account_removal():
    store = query_store()
    platform = ScalablePlatform(store=store, clock=lambda: NOW)
    user = login(platform)
    for _ in range(100):
        result = scaling_accounts.delete_user(
            store, run_id="rewarded-account-deletion", user_id=user.id,
            max_records=2, platform=platform,
        )
        if result["complete"]:
            break
    assert result["complete"]
    assert store.get_user(user.id) is None
    assert scaling_accounts.delete_user(
        store, run_id="rewarded-account-deletion", max_records=2,
    )["processed"] == 0
    # Both events can materialize after the related account has gone.
    platform.run_token_ledger()
    rows = sorted(store.list_token_movements(), key=lambda row: row.amount)
    assert [(row.user_id, row.amount, row.balance_before, row.reason) for row in rows] == [
        (user.id, -10, 10, "account_deleted"),
        (user.id, 10, 0, "sign_in_bonus"),
    ]
    assert platform.run_token_ledger() == 0
    assert sorted(store.list_token_movements(), key=lambda row: row.amount) == rows


def test_daily_visits_need_not_be_consecutive_and_cap_lifetime_grants(platform):
    user = login(platform)
    assert user.token_balance == user.free_tokens_granted == 10
    assert user.last_token_grant_day == NOW.date().isoformat()
    assert platform.claim_daily_login(caller_id=user.id).token_balance == 10
    for day in range(1, 10):
        current = platform.get_user(user.id)
        platform._store.put_user(replace(current, token_balance=0))
        platform._clock = lambda day=day: NOW + dt.timedelta(days=day * 3)
        reward = platform.claim_daily_login(caller_id=user.id)
        assert reward.token_balance == 10
        assert reward.free_tokens_granted == (day + 1) * 10
        assert platform.claim_daily_login(caller_id=user.id) == reward
    platform._store.put_user(replace(reward, token_balance=0))
    platform._clock = lambda: NOW + dt.timedelta(days=100)
    capped = login(platform)
    assert capped.token_balance == 0
    assert capped.free_tokens_granted == 100


def test_legacy_thousand_token_bonus_is_preserved_and_not_rewarded_again(platform):
    user = legacy_verified_user(platform)
    user = replace(user, token_balance=1000, verified_login_bonus_granted=True)
    platform._store.put_user(user)
    platform._clock = lambda: NOW + dt.timedelta(days=100)
    assert login(platform, identifier="legacy-subject").token_balance == 1000
    platform._store.put_user(replace(user, token_balance=7))
    assert platform.claim_daily_login(caller_id=user.id).token_balance == 7


def test_guest_visits_never_receive_daily_tokens(platform):
    guest = platform.create_user(display_name="Guest")
    for day in (0, 1, 100):
        platform._clock = lambda day=day: NOW + dt.timedelta(days=day)
        assert platform.claim_daily_login(caller_id=guest.id) == guest


def test_reward_days_are_utc_and_same_day_login_cannot_repeat_a_grant(platform):
    user = login(platform)
    platform._clock = lambda: dt.datetime(2026, 11, 18, 0, 30,
                                         tzinfo=dt.timezone(dt.timedelta(hours=2)))
    assert platform.claim_daily_login(caller_id=user.id).token_balance == 10
    platform._clock = lambda: NOW + dt.timedelta(days=1)
    awarded = platform.claim_daily_login(caller_id=user.id)
    assert awarded.token_balance == 20
    assert awarded.last_token_grant_day == "2026-11-18"
    assert login(platform).token_balance == 20


def test_merging_verified_accounts_combines_lifetime_reward_totals(platform):
    first, second = login(platform, identifier="first"), login(platform, identifier="second")
    platform._store.put_user(replace(first, free_tokens_granted=40, token_balance=3))
    platform._store.put_user(replace(second, free_tokens_granted=60, token_balance=7))
    merged = platform.merge_users(caller_id=first.id, from_user_id=first.id,
                                  into_user_id=second.id, into_password=second.password)
    assert merged.free_tokens_granted == 100
    assert merged.token_balance == 10
    platform._clock = lambda: NOW + dt.timedelta(days=2)
    assert platform.claim_daily_login(caller_id=first.id).token_balance == 10
    assert login(platform, identifier="first").free_tokens_granted == 100


def test_daily_login_api_requires_auth_and_keeps_reward_metadata_private():
    from game_platform.tests.helpers import Api
    api = Api()
    api.platform._clock = lambda: NOW
    assert api.request("POST", "/auth/daily-login").status_code == 401
    guest = api.new_user("Guest")
    guest_visit = api.ok("POST", "/auth/daily-login", as_user=guest)
    assert guest_visit["token_balance"] == 0
    assert guest_visit["is_verified"] is False
    user = login(api.platform)
    api.passwords_by_user_id[user.id] = user.password
    first_visit = api.ok("POST", "/auth/daily-login", as_user=user.id)
    assert first_visit["token_balance"] == first_visit["free_tokens_granted"] == 10
    assert first_visit["is_verified"] is True
    api.platform._clock = lambda: NOW + dt.timedelta(days=5)
    daily = api.ok("POST", "/auth/daily-login", as_user=user.id)
    assert daily["token_balance"] == daily["free_tokens_granted"] == 20
    assert daily["last_token_grant_day"] == "2026-11-22"
    other = api.ok("GET", f"/users/{user.id}", as_user=guest)
    assert other["free_tokens_granted"] is None and other["is_verified"] is None
    authenticated = api.ok("GET", "/auth/me", as_user=user.id)
    assert authenticated["free_tokens_granted"] == 20
    assert authenticated["last_token_grant_day"] == "2026-11-22"
    assert authenticated["is_verified"] is True


@pytest.fixture
def emulator_store():
    address = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not address:
        pytest.skip("requires Firestore emulator")
    assert address.startswith(("127.0.0.1:", "localhost:")), "use a local test database only"
    from google.cloud import firestore

    store = QueryStore.initialize(
        firestore.Client(project="demo-game-platform"),
        namespace="login_bonus_" + uuid.uuid4().hex,
    )
    try:
        yield store
    finally:
        store.close()


def test_emulator_two_instances_award_same_identity_exactly_once(emulator_store):
    first = ScalablePlatform(store=emulator_store, clock=lambda: NOW)
    user = legacy_verified_user(first)
    barrier = threading.Barrier(2)

    def attempt(_):
        store = QueryStore(emulator_store.client, namespace=emulator_store.namespace)
        other = ScalablePlatform(store=store, clock=lambda: NOW)
        try:
            barrier.wait(timeout=10)
            try:
                return login(other, identifier="legacy-subject").token_balance
            except ConflictError:
                return "conflict"
        finally:
            store.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))
    assert all(result in (10, "conflict") for result in results), results
    # An aborted login may be retried, including when both contenders aborted.
    assert login(first, identifier="legacy-subject").token_balance == 10
    fresh = QueryStore(emulator_store.client, namespace=emulator_store.namespace)
    try:
        restarted = ScalablePlatform(store=fresh, clock=lambda: NOW)
        assert login(restarted, identifier="legacy-subject").token_balance == 10
        assert fresh.get_user(user.id).verified_login_bonus_granted
        restarted.run_token_ledger()
        credits = [doc.to_dict()["amount"] for doc in fresh._query("token_ledger", [], limit=100)]
        assert credits.count(10) == 1
        assert sum(credits) == 10
    finally:
        fresh.close()


def test_emulator_concurrent_retained_sessions_award_one_daily_reward(emulator_store):
    first = ScalablePlatform(store=emulator_store, clock=lambda: NOW)
    user = login(first)
    next_visit = NOW + dt.timedelta(days=4)
    first._clock = lambda: next_visit
    barrier = threading.Barrier(2)

    def visit(_):
        store = QueryStore(emulator_store.client, namespace=emulator_store.namespace)
        other = ScalablePlatform(store=store, clock=lambda: next_visit)
        try:
            barrier.wait(timeout=10)
            try:
                return other.claim_daily_login(caller_id=user.id).token_balance
            except ConflictError:
                return "conflict"
        finally:
            store.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert all(value in (20, "conflict") for value in pool.map(visit, range(2)))
    rewarded = first.claim_daily_login(caller_id=user.id)
    assert rewarded.token_balance == rewarded.free_tokens_granted == 20
    first.run_token_ledger()
    credits = [doc.to_dict() for doc in emulator_store._query("token_ledger", [], limit=100)]
    assert sorted((row["amount"], row["balance_before"], row["reason"]) for row in credits) == [
        (10, 0, "sign_in_bonus"), (10, 10, "daily_login"),
    ]


def test_emulator_bonus_and_code_consumption_roll_back_then_survive_restart(emulator_store, monkeypatch):
    first = ScalablePlatform(store=emulator_store, clock=lambda: NOW)
    guest = first.create_user(display_name="Guest")
    verification_id, code, _ = first.start_verification(kind="email", identifier="player@example.test")
    grant = first._grant_verified_login_bonus

    def interrupted_grant(user):
        grant(user)
        raise RuntimeError("interrupted before commit")

    with monkeypatch.context() as patch:
        patch.setattr(first, "_grant_verified_login_bonus", interrupted_grant)
        with pytest.raises(RuntimeError, match="interrupted before commit"):
            first.verify_code(verification_id=verification_id, code=code, as_user_id=guest.id)
    with emulator_store.atomic():
        saved = emulator_store.get_user(guest.id)
        assert saved.token_balance == 0
        assert not saved.verified_login_bonus_granted
        assert not saved.linked_accounts
        assert emulator_store.find_linked_account("email", "player@example.test") is None
        assert emulator_store.raw_get(emulator_store.ref("verifications", verification_id))

    fresh = QueryStore(emulator_store.client, namespace=emulator_store.namespace)
    try:
        restarted = ScalablePlatform(store=fresh, clock=lambda: NOW)
        upgraded, _ = restarted.verify_code(
            verification_id=verification_id, code=code, as_user_id=guest.id,
        )
        assert upgraded.id == guest.id
        assert upgraded.token_balance == 10
        assert upgraded.verified_login_bonus_granted
        with pytest.raises(NotFoundError):
            restarted.verify_code(verification_id=verification_id, code=code, as_user_id=guest.id)
        assert login(restarted, "email", "player@example.test").token_balance == 10
        assert fresh.raw_get(fresh.ref("verifications", verification_id)) is None
        restarted.run_token_ledger()
        credits = [doc.to_dict()["amount"] for doc in fresh._query("token_ledger", [], limit=100)]
        assert sum(credits) == 10
    finally:
        fresh.close()
