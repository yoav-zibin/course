"""Shared links recruit once and retain conversion evidence after deletion."""

from dataclasses import replace

import pytest

from game_platform.conversion_funnel import summary
from game_platform.scaling_service import ScalablePlatform
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api


@pytest.fixture(params=["memory", "query"])
def linked_api(request):
    api = Api(store=query_store() if request.param == "query" else None)
    if request.param == "query":
        api.platform = ScalablePlatform(store=api.platform._store,
                                       clock=api.platform._clock, computer_move_delay_seconds=0)
        api.client.app.state.platform = api.platform
    return api


def lobby(api, owner, *, players=2):
    match = api.new_match(owner=owner, game_id=api.new_game(owner=owner, allowed_player_counts=[players]))
    return match, api.ok("GET", f"/matches/{match}")["invite_code"]


def signup(api, **attribution):
    account = api.ok("POST", "/users", json={"display_name": "New player", **attribution})
    api.passwords_by_user_id[account["id"]] = account["password"]
    return account["id"]


@pytest.mark.parametrize("link", ["match", "invite"])
@pytest.mark.parametrize("existing", [False, True])
def test_both_shared_links_recruit_new_or_unattributed_existing_accounts(linked_api, link, existing):
    api = linked_api
    owner = api.new_user("Owner")
    match, token = lobby(api, owner)
    target = {"invite_match_id": match} if link == "match" else {"invite_token": token}
    user = api.new_user("Existing") if existing else signup(api, **target)
    if existing:
        path = f"/matches/{match}" if link == "match" else f"/invites/{token}"
        api.ok("GET", path, as_user=user)
    stored = api.platform._store.get_user(user)
    assert stored.invited_by_user_id == owner
    assert stored.invited_via_match_id == match
    assert api.ok("GET", "/users/me/recruitment", as_user=user)["inviter_chain"] == [owner]
    other = api.new_user("Other owner")
    other_match, other_token = lobby(api, other)
    api.ok("GET", f"/matches/{other_match}", as_user=user)
    api.ok("GET", f"/invites/{other_token}", as_user=user)
    assert api.platform._store.get_user(user).invited_by_user_id == owner


def test_full_spectator_links_still_recruit_without_acceptance(linked_api):
    api = linked_api
    owner, player = api.new_user("Owner"), api.new_user("Player")
    match, token = lobby(api, owner)
    api.ok("POST", f"/invites/{token}/accept", as_user=player)
    newcomer = signup(api, invite_token=token)
    api.ok("POST", f"/invites/{token}/accept", as_user=newcomer)
    assert api.platform._store.get_user(newcomer).invited_by_user_id == owner
    assert len(api.platform._store.get_invite(token).acceptances) == 1


def test_self_cycles_private_and_unknown_targets_do_not_recruit(linked_api):
    api = linked_api
    owner = api.new_user("Owner")
    match, token = lobby(api, owner)
    api.ok("GET", f"/invites/{token}", as_user=owner)
    assert api.platform._store.get_user(owner).invited_by_user_id is None
    child = signup(api, invite_match_id=match)
    child_match, _ = lobby(api, child)
    api.ok("GET", f"/matches/{child_match}", as_user=owner)
    assert api.platform._store.get_user(owner).invited_by_user_id is None
    assert api.platform._store.get_user(signup(api, invite_match_id="unknown")).invited_by_user_id is None
    game = api.platform._store.get_match(match)
    api.platform._store.put_match(replace(game, match_kind="pass_and_play"))
    assert api.platform._store.get_user(signup(api, invite_match_id=match)).invited_by_user_id is None


def test_personal_referral_routes_fields_and_codes_are_removed(linked_api):
    api = linked_api
    owner = api.new_user("Owner")
    assert api.request("GET", "/r/48213").status_code == 404
    assert api.request("POST", "/users", json={"display_name": "Invalid", "invited_by_user_id": owner}).status_code == 422
    assert "referral_code" not in api.ok("GET", f"/users/{owner}", as_user=owner)
    assert not hasattr(api.platform._store.get_user(owner), "referral_code")


def test_visitor_funnel_and_ancestry_survive_invite_match_and_user_deletion(linked_api):
    api = linked_api
    store = api.platform._store
    owner = api.new_user("Owner")
    match, token = lobby(api, owner)
    headers = {"X-Visitor-Id": "visitor-example-123", "X-Link-Open": "1"}
    for _ in range(2):
        assert api.client.get(f"/invites/{token}", headers=headers).status_code == 200
    response = api.client.post("/users", json={"display_name": "New", "invite_token": token}, headers=headers)
    assert response.status_code == 201
    account = response.json()
    api.passwords_by_user_id[account["id"]] = account["password"]
    joined_headers = {**headers, "X-User-Id": account["id"], "X-User-Password": account["password"]}
    assert api.client.post(f"/invites/{token}/accept", headers=joined_headers).status_code == 200
    api.ok("POST", f"/matches/{match}/start", as_user=owner)
    assert store.get_invite(token) is None
    retained = store.list_analytics("invite_history")
    assert len(retained) == 1 and retained[0]["views"] == 2
    assert retained[0]["acceptances"][0]["user_id"] == account["id"]
    before = summary(store, match_id=match)
    assert before["events"]["link_opened"] == 2
    assert before["distinct_visitors"]["link_opened"] == 1
    assert before["events"]["account_created"] == 1
    assert before["events"]["recruited"] == 1
    assert before["events"]["match_joined"] == 1
    assert before["events"]["match_started"] == 1
    api.ok("DELETE", f"/admin/users/{owner}")
    assert store.get_match(match) is None
    assert api.ok("GET", "/users/me/recruitment", as_user=account["id"])["inviter_chain"] == [owner]
    api.ok("DELETE", f"/admin/users/{account['id']}")
    historical = api.ok("GET", f"/admin/recruitment/{account['id']}")
    assert historical["inviter_chain"] == [owner]
    assert historical["node"]["deleted_at"]
    after = api.ok("GET", "/admin/conversion-funnel", params={"match_id": match})
    assert all(after["events"][stage] == count for stage, count in before["events"].items())
    assert after["events"]["match_deleted"] == 1
    rows = store.list_analytics("funnel_events") + store.list_analytics("recruitment_nodes")
    assert all(not ({"display_name", "email", "password", "ip_address"} & row.keys()) for row in rows)


def test_recycled_code_does_not_mark_old_account_as_a_new_signup(linked_api):
    api = linked_api
    owner = api.new_user("Owner")
    match, token = lobby(api, owner)
    user = signup(api, invite_token=token)
    api.ok("POST", f"/invites/{token}/accept", as_user=user)
    api.ok("POST", f"/matches/{match}/start", as_user=owner)
    api.platform._new_invite_token = lambda: token
    next_match, next_token = lobby(api, owner)
    assert next_token == token
    api.ok("POST", f"/invites/{next_token}/accept", as_user=user)
    assert api.platform._store.get_invite(token).acceptances[0].signed_up is False
    assert len(api.platform._store.list_analytics("invite_history")) == 2
    assert next_match != match


@pytest.mark.parametrize("legacy_live_field_cleared", [False, True])
def test_deleted_inviter_cannot_be_replaced_by_opening_another_owners_links(linked_api, legacy_live_field_cleared):
    api = linked_api
    owner = api.new_user("Original owner")
    match, token = lobby(api, owner)
    recruit = signup(api, invite_token=token)
    api.ok("DELETE", f"/admin/users/{owner}")
    stored = api.platform._store.get_user(recruit)
    assert stored.invited_by_user_id == owner
    if legacy_live_field_cleared:
        # Older deletion behavior removed the live pointer. Permanent history
        # must still reject a different parent after upgrading that account.
        api.platform._store.put_user(replace(stored, invited_by_user_id=None))
    other = api.new_user("Another owner")
    other_match, other_token = lobby(api, other)
    before = summary(api.platform._store)["events"]["recruited"]
    api.ok("GET", f"/matches/{other_match}", as_user=recruit)
    api.ok("GET", f"/invites/{other_token}", as_user=recruit)
    assert api.ok("GET", "/users/me/recruitment", as_user=recruit)["inviter_chain"] == [owner]
    assert api.platform._store.get_user(recruit).invited_by_user_id == (None if legacy_live_field_cleared else owner)
    assert summary(api.platform._store)["events"]["recruited"] == before


def test_share_play_completion_and_revocation_are_permanent_observed_stages(linked_api):
    api = linked_api
    owner = api.new_user("Owner")
    match, token = lobby(api, owner)
    visitor = {"X-Visitor-Id": "anonymous-forwarder"}
    assert api.client.post(f"/matches/{match}/share", json={"channel": "share_link"}, headers=visitor).status_code == 204
    player = signup(api, invite_match_id=match)
    api.ok("POST", f"/invites/{token}/accept", as_user=player)
    api.ok("POST", f"/matches/{match}/start", as_user=owner)
    assert api.move(match, as_user=owner, next_turn=1).status_code == 201
    assert api.move(match, as_user=player, next_turn=None).status_code == 201
    counts = summary(api.platform._store, match_id=match)
    assert counts["events"]["invite_shared"] == 1
    assert counts["distinct_visitors"]["invite_shared"] == 1
    assert counts["events"]["match_played"] == 1
    assert counts["events"]["match_completed"] == 1
    assert counts["events"]["player_played"] == 2
    assert counts["distinct_accounts"]["player_played"] == 2
    assert counts["distinct_accounts"]["match_started"] == 2
    assert counts["distinct_accounts"]["match_completed"] == 2
    other_match, other_token = lobby(api, owner)
    api.ok("POST", f"/invites/{other_token}/revoke", as_user=owner)
    active = api.platform._store.get_invite(other_token)
    archived = api.platform._store.get_analytics("invite_history", active.allocation_id)
    assert archived["revoked"] and archived["revoked_at"]
    api.platform._store.delete_invite(other_token)
    assert summary(api.platform._store, match_id=other_match)["events"]["invite_revoked"] == 1


def test_first_player_conversion_does_not_read_previous_move_pages():
    from unittest.mock import patch
    from game_platform.query_store import QueryStore

    store = query_store('first_play_without_history')
    api = Api(store=store)
    api.platform = ScalablePlatform(store=store, clock=api.platform._clock, computer_move_delay_seconds=0)
    api.client.app.state.platform = api.platform
    owner = api.new_user('Owner')
    match, token = lobby(api, owner)
    player = signup(api, invite_token=token)
    api.ok('POST', f'/invites/{token}/accept', as_user=player)
    api.ok('POST', f'/matches/{match}/start', as_user=owner)
    assert api.move(match, as_user=owner, next_turn=1).status_code == 201
    cold = QueryStore(store.client, namespace=store.namespace)
    api.platform = ScalablePlatform(store=cold, clock=api.platform._clock, computer_move_delay_seconds=0)
    api.client.app.state.platform = api.platform
    with patch.object(cold, '_read_moves', side_effect=AssertionError('previous history was loaded')):
        assert api.move(match, as_user=player, next_turn=0).status_code == 201
        assert api.move(match, as_user=owner, next_turn=1).status_code == 201
    assert summary(cold, match_id=match)['events']['player_played'] == 2
