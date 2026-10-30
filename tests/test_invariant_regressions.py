"""Regression cases found while auditing account replacement invariants."""
from dataclasses import replace

from game_platform.service import GamePlatform
from game_platform.store import InMemoryStore
from game_platform.tests.test_speed_matches import World


def test_merge_reassigns_timeout_participation_to_survivor():
    world = World()
    platform = world.platform
    match_id = world.match(joiners=(world.bob,), first=(1,))
    world.clock.advance(61)
    timed_out = world.get(match_id)
    assert timed_out.timeouts[0].user_id == world.bob
    assert timed_out.involves(world.bob)

    platform.merge_users(caller_id=world.bob, from_user_id=world.bob, into_user_id=world.cy)
    merged = world.get(match_id)
    assert not merged.involves(world.bob), "replaced users must not retain match participation"
    assert merged.involves(world.cy), "survivor must inherit timeout viewer access"
    assert merged.timeouts[0].user_id == world.cy


def test_merge_preserves_token_balance_and_clears_replaced_balance():
    store = InMemoryStore()
    platform = GamePlatform(store=store)
    source = platform.create_user(display_name="source")
    target = platform.create_user(display_name="target")
    # Valid persisted balances, e.g. from earlier payouts; independent of grant policy.
    store.put_user(replace(source, token_balance=23))
    store.put_user(replace(target, token_balance=17))
    survivor = platform.merge_users(caller_id=source.id, from_user_id=source.id, into_user_id=target.id)
    assert survivor.token_balance == 40
    assert store.get_user(source.id).token_balance == 0


def test_merge_keeps_latest_grant_day_and_alias_cannot_duplicate_balance():
    store = InMemoryStore()
    platform = GamePlatform(store=store)
    source = platform.create_user(display_name="source")
    target = platform.create_user(display_name="target")
    third = platform.create_user(display_name="third")
    store.put_user(replace(source, token_balance=23, last_token_grant_day="2026-10-30"))
    store.put_user(replace(target, token_balance=17, last_token_grant_day="2026-10-29"))
    first = platform.merge_users(caller_id=source.id, from_user_id=source.id, into_user_id=target.id)
    assert first.last_token_grant_day == "2026-10-30"
    second = platform.merge_users(caller_id=target.id, from_user_id=source.id, into_user_id=third.id)
    assert second.token_balance == 40
    assert second.last_token_grant_day == "2026-10-30"
    assert store.get_user(source.id).token_balance == 0
    assert store.get_user(target.id).token_balance == 0
