"""Notification delivery preferences, inbox, directed invites and native registration."""

from dataclasses import replace

import pytest

from game_platform.config import PushConfig
from game_platform.json_file_store import JsonFileStore
from game_platform.tests.helpers import Api
from game_platform.tests.test_push import FakeNotifier, _subscribe_ok


def _feed(api, user, **params):
    return api.ok("GET", "/users/me/notifications", as_user=user,
                  params={key: str(value) for key, value in params.items()})


def legacy_directed_invite(api, match_id, *, sender, recipient):
    """Seed a historical directed invite; new clients only share match URLs."""
    platform = api.client.app.state.platform
    with platform._lock:
        store = platform._store
        match = store.get_match(match_id)
        invite = replace(store.get_invite(match.invite_code), recipient_user_id=recipient)
        store.put_invite(invite)
        platform._notify_match_event("notify.invite_request", match=match,
            recipient_ids=[recipient], actor_name=store.get_user(sender).display_name,
            tag_suffix="invite", url=f"/i/{invite.token}")
        return invite


def test_inbox_works_without_push_and_is_private_and_idempotently_read():
    api = Api()
    alice, bob, other = (api.new_user(name) for name in ("alice", "bob", "other"))
    game = api.new_game(owner=alice)
    match = api.new_match(owner=alice, game_id=game, joiners=[bob], start=True)
    api.move(match, as_user=alice, next_turn=1)
    page = _feed(api, bob)
    assert page["unread_count"] == 1
    entry, = page["items"]
    assert entry["event"] == "turn"
    assert entry["match_id"] == match
    assert entry["body"] == "alice moved. Your turn in Poker"
    assert entry["url"].endswith("#match=" + match)
    assert entry["read_at"] is None
    assert _feed(api, other)["items"] == []
    assert api.request("GET", "/users/me/notifications").status_code == 401
    path = f"/users/me/notifications/{entry['id']}/read"
    assert api.request("POST", path, as_user=other).status_code == 404
    read = api.ok("POST", path, as_user=bob)
    assert read["read_at"] is not None
    assert api.ok("POST", path, as_user=bob) == read
    assert _feed(api, bob)["unread_count"] == 0
    assert _feed(api, bob)["items"] == []
    assert "notifications" not in api.ok("GET", f"/users/{bob}", as_user=other)


def test_profile_opt_out_suppresses_push_but_keeps_inbox():
    notifier = FakeNotifier()
    api = Api(push_notifier=notifier)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    profile = api.ok("GET", f"/users/{bob}", as_user=bob)
    assert profile["notifications_enabled"] is True
    assert profile["notification_prompt_seen"] is False
    assert api.ok("GET", f"/users/{bob}", as_user=alice)["notifications_enabled"] is None
    _subscribe_ok(api, bob, "https://push.example.com/bob")
    off = {"notifications_enabled": False, "notification_prompt_seen": True}
    assert api.request("PATCH", f"/users/{bob}", as_user=alice, json=off).status_code == 403
    profile = api.ok("PATCH", f"/users/{bob}", as_user=bob, json=off)
    assert profile["notifications_enabled"] is False
    assert profile["notification_prompt_seen"] is True
    for invalid in (None, "false", 0):
        assert api.request("PATCH", f"/users/{bob}", as_user=bob,
                           json={"notifications_enabled": invalid}).status_code == 422
    game = api.new_game(owner=alice)
    match = api.new_match(owner=alice, game_id=game, joiners=[bob], start=True)
    api.move(match, as_user=alice, next_turn=1)
    assert notifier.messages == []
    assert _feed(api, bob)["items"][0]["event"] == "turn"
    api.ok("PATCH", f"/users/{bob}", as_user=bob, json={"notifications_enabled": True})
    api.move(match, as_user=bob, next_turn=0)
    api.move(match, as_user=alice, next_turn=1)
    message, = notifier.messages
    assert message.notification_id == _feed(api, bob)["items"][0]["id"]


def test_targeted_invites_are_rejected_without_notifications_or_code_changes():
    notifier = FakeNotifier()
    api = Api(push_notifier=notifier)
    alice, bob, outsider = (api.new_user(name) for name in ("alice", "bob", "outsider"))
    _subscribe_ok(api, bob, "https://push.example.com/bob")
    game = api.new_game(owner=alice)
    match = api.new_match(owner=alice, game_id=game)
    original = api.ok("GET", f"/matches/{match}")["invite_code"]
    for recipient in (bob, alice, "nobody"):
        response = api.request("POST", f"/matches/{match}/invites", as_user=alice,
                               json={"recipient_user_id": recipient})
        assert response.status_code == 400
        assert response.json()["detail"] == "targeted invites are no longer supported; share the match URL"
    assert notifier.messages == []
    assert _feed(api, bob)["items"] == []
    shared = api.ok("POST", f"/matches/{match}/invites", as_user=alice)
    assert shared["token"] == original
    assert shared["recipient_user_id"] is None
    assert api.ok("GET", f"/invites/{original}")["match"]["id"] == match
    assert api.ok("POST", f"/invites/{original}/accept", as_user=bob)["id"] == match
    assert _feed(api, outsider)["items"] == []
    assert api.request("POST", f"/matches/{match}/invites", as_user=outsider,
                       json={"recipient_user_id": bob}).status_code == 403


def test_rematch_request_only_notifies_once_and_recipient_can_accept():
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    match = api.new_match(owner=alice, game_id=game, joiners=[bob], start=True)
    api.move(match, as_user=alice, next_turn=None)
    path = f"/matches/{match}/rematch"
    rematch = api.ok("POST", path, as_user=alice)
    first = _feed(api, bob)
    entry = first["items"][0]
    assert entry["event"] == "rematch_request"
    assert entry["url"].endswith("#rematch=" + match)
    assert api.ok("POST", path, as_user=alice)["id"] == rematch["id"]
    assert _feed(api, bob) == first
    assert api.ok("POST", path, as_user=bob)["id"] == rematch["id"]
    assert api.ok("GET", f"/matches/{rematch['id']}", as_user=bob)["id"] == rematch["id"]


def test_inbox_is_bounded_and_pages_without_duplicates():
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game)
    match = api.platform._store.get_match(match_id)
    for number in range(105):
        api.platform._notify_match_event("notify.turn", match=replace(match, id=f"match-{number}"),
                                        recipient_ids=[bob, bob], tag_suffix="turn")
    assert len(api.platform.get_user(bob).notifications) == 100
    first = _feed(api, bob, limit=60)
    assert first["unread_count"] == 100
    second = _feed(api, bob, limit=60, cursor=first["next_cursor"])
    assert len(first["items"]) == 60
    assert len(second["items"]) == 40
    assert second["next_cursor"] is None
    assert len({item["id"] for item in first["items"] + second["items"]}) == 100
    assert api.request("GET", "/users/me/notifications", as_user=bob,
                       params={"limit": "101"}).status_code == 422
    assert api.request("GET", "/users/me/notifications", as_user=bob,
                       params={"cursor": "foreign"}).status_code == 400


def test_inbox_groups_latest_match_update_across_pages_and_dismisses_older_updates():
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    first = api.platform._store.get_match(api.new_match(owner=alice, game_id=game))
    second = api.platform._store.get_match(api.new_match(owner=alice, game_id=game))
    for match, event in ((first, "turn"), (second, "turn"), (first, "match_over")):
        api.platform._notify_match_event(f"notify.{event}", match=match,
                                        recipient_ids=[bob], tag_suffix=event)
    all_entries = api.platform.get_user(bob).notifications
    page = _feed(api, bob, limit=1)
    latest, = page["items"]
    assert latest["match_id"] == first.id
    assert latest["event"] == "match_over"
    assert page["unread_count"] == 2
    next_page = _feed(api, bob, limit=1, cursor=page["next_cursor"])
    assert [item["match_id"] for item in next_page["items"]] == [second.id]
    assert next_page["next_cursor"] is None

    read = api.ok("POST", f"/users/me/notifications/{latest['id']}/read", as_user=bob)
    assert set(read["dismissed_notification_ids"]) == {
        item.id for item in all_entries if item.match_id == first.id
    }
    assert _feed(api, bob)["unread_count"] == 1
    assert [item["match_id"] for item in _feed(api, bob)["items"]] == [second.id]
    # A cursor remains usable after its row is dismissed.
    assert _feed(api, bob, cursor=page["next_cursor"])["items"] == next_page["items"]


def test_reading_older_snapshot_preserves_newer_same_match_with_equal_timestamp():
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    match = api.platform._store.get_match(api.new_match(owner=alice, game_id=game))
    now = api.platform._clock()
    api.platform._clock = lambda: now
    snapshots = []
    for _ in range(3):
        api.platform._notify_match_event("notify.turn", match=match,
                                        recipient_ids=[bob], tag_suffix="turn")
        snapshots.append(_feed(api, bob)["items"][0])
    assert len({item["created_at"] for item in snapshots}) == 1
    clicked = snapshots[1]
    read = api.ok("POST", f"/users/me/notifications/{clicked['id']}/read", as_user=bob)
    assert set(read["dismissed_notification_ids"]) == {item["id"] for item in snapshots[:2]}
    remaining, = _feed(api, bob)["items"]
    assert remaining["id"] == snapshots[2]["id"]
    assert _feed(api, bob)["unread_count"] == 1


def test_legacy_invites_and_match_links_group_and_dismiss_without_match_id(monkeypatch):
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    match_id = api.new_match(owner=alice, game_id=game)
    for _ in range(2):
        legacy_directed_invite(api, match_id, sender=alice, recipient=bob)
    match = api.platform._store.get_match(match_id)
    api.platform._notify_match_event("notify.turn", match=match,
                                    recipient_ids=[bob], tag_suffix="turn")
    user = api.platform.get_user(bob)
    rematch_entry = replace(user.notifications[0], id="legacy-rematch",
                            event="rematch_request", url=f"/portal#rematch={match_id}",
                            match_id=None)
    api.platform._store.put_user(replace(user, notifications=tuple(
        replace(item, match_id=None) for item in (rematch_entry, *user.notifications)
    )))
    entry, = _feed(api, bob)["items"]
    assert entry["match_id"] == match_id
    assert _feed(api, bob)["unread_count"] == 1
    read = api.ok("POST", f"/users/me/notifications/{entry['id']}/read", as_user=bob)
    assert len(read["dismissed_notification_ids"]) == 4
    assert _feed(api, bob)["items"] == []
    # Already-read legacy history must not perform invite lookups on each poll.
    user = api.platform.get_user(bob)
    api.platform._store.put_user(replace(user, notifications=tuple(
        replace(item, match_id=None) for item in user.notifications
    )))
    monkeypatch.setattr(api.platform._store, "get_invite", lambda token: pytest.fail("read history fetched an invite"))
    assert _feed(api, bob)["items"] == []


def test_notification_preferences_inbox_and_native_subscription_survive_disk_and_merge(tmp_path):
    path = tmp_path / "accounts.json"
    store = JsonFileStore(path, min_write_interval_seconds=0)
    api = Api(store=store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    match = api.new_match(owner=alice, game_id=game)
    legacy_directed_invite(api, match, sender=alice, recipient=bob)
    api.ok("PATCH", f"/users/{bob}", as_user=bob,
           json={"notifications_enabled": False, "notification_prompt_seen": True})
    _native(api, bob)
    store.close()
    restored = JsonFileStore(path, min_write_interval_seconds=0)
    try:
        account = restored.get_user(bob)
        assert account.notification_prompt_seen is True
        assert account.notifications_enabled is False
        assert account.notifications[0].event == "invite_request"
        api.platform._store = restored
        # Merge into the survivor, retaining source history and its opt-out.
        merged = api.ok("POST", f"/users/{bob}/merge", as_user=bob,
                        json={"into_user_id": alice, "into_password": api.passwords_by_user_id[alice]})
        assert merged["notifications_enabled"] is False
        assert merged["notification_prompt_seen"] is True
        assert _feed(api, alice)["items"][0]["event"] == "invite_request"
        assert restored.get_user(bob).notifications == ()
        assert restored.list_push_subscriptions(user_id=alice)[0].delivery == "expo"
    finally:
        restored.close()


def _native(api, user, token="ExponentPushToken[abc_123-DEF]"):
    return api.request("POST", "/push/native-subscriptions", as_user=user,
                       json={"token": token, "platform": "android"})


def test_native_tokens_upsert_move_accounts_and_unsubscribe():
    api = Api()
    alice, bob = api.new_user("alice"), api.new_user("bob")
    first = _native(api, alice)
    assert first.status_code == 201
    subscription = first.json()
    assert subscription["delivery"] == "expo"
    assert subscription["platform"] == "android"
    assert subscription["endpoint"] == "expo:ExponentPushToken[abc_123-DEF]"
    updated = _native(api, bob)
    assert updated.status_code == 200
    assert updated.json()["id"] == subscription["id"]
    assert api.ok("GET", "/push/subscriptions", as_user=alice) == []
    assert api.request("DELETE", "/push/subscriptions", as_user=alice,
                       params={"endpoint": subscription["endpoint"]}).status_code == 403
    api.ok("DELETE", "/push/subscriptions", as_user=bob,
           params={"endpoint": subscription["endpoint"]})
    assert api.ok("GET", "/push/subscriptions", as_user=bob) == []
    assert api.request("POST", "/push/native-subscriptions",
                       json={"token": "ExpoPushToken[valid]", "platform": "ios"}).status_code == 401


@pytest.mark.parametrize("token", ["https://arbitrary.example", "expo:ExpoPushToken[abc]",
                                    "ExpoPushToken[]", "ExpoPushToken[abc]tail", "abc"])
def test_native_tokens_are_validated(token):
    api = Api()
    user = api.new_user("alice")
    assert _native(api, user, token).status_code == 422


def test_native_push_can_be_disabled_on_server():
    api = Api(push_config=PushConfig(native_enabled=False))
    user = api.new_user("alice")
    assert _native(api, user).status_code == 503
    assert api.ok("GET", "/push/config")["native_enabled"] is False
