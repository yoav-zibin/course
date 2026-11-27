"""Invitation lifecycle and cleanup against a loopback Firestore emulator only."""

import os
import uuid

import pytest
from google.cloud import firestore

from game_platform.conversion_funnel import summary
from game_platform.query_store import QueryStore
from game_platform.models import Invite
from game_platform.recruitment_history import inviter_chain
from game_platform.scaling_service import ScalablePlatform
from game_platform.tests.helpers import Api
from game_platform.tests.test_personal_referral_cleanup import legacy_user, finish

pytestmark = pytest.mark.skipif(not os.environ.get("FIRESTORE_EMULATOR_HOST"),
                                reason="requires Firestore emulator")


@pytest.fixture
def store():
    assert os.environ["FIRESTORE_EMULATOR_HOST"].startswith(("127.0.0.1:", "localhost:"))
    client = firestore.Client(project="demo-game-platform")
    value = QueryStore.initialize(client, namespace="invitation_" + uuid.uuid4().hex)
    try:
        yield value
    finally:
        value.close()
        client.close()


def test_open_signup_join_start_and_delete_retain_full_funnel_after_restart(store):
    api = Api(store=store)
    api.platform = ScalablePlatform(store=store, clock=api.platform._clock,
                                   computer_move_delay_seconds=0)
    api.client.app.state.platform = api.platform
    owner = api.new_user("Owner")
    match_id = api.new_match(owner=owner, game_id=api.new_game(owner=owner, allowed_player_counts=(2,)))
    token = store.get_match(match_id).invite_code
    opened = api.client.get(f"/invites/{token}", headers={"X-Visitor-Id": "browser-unique-id"})
    assert opened.status_code == 200
    signup = api.client.post("/users", json={"display_name": "New player", "invite_token": token},
                             headers={"X-Visitor-Id": "browser-unique-id"})
    assert signup.status_code == 201
    user = signup.json()
    api.passwords_by_user_id[user["id"]] = user["password"]
    started = api.ok("POST", f"/invites/{token}/accept", as_user=user["id"])
    assert started["status"] == "ongoing"
    assert store.get_invite(token) is None
    store.delete_match(match_id)
    store.delete_user(owner)
    cold = QueryStore(store.client, namespace=store.namespace)
    try:
        assert cold.get_match(match_id) is None and cold.get_user(owner) is None
        assert cold.get_user(user["id"]).invited_by_user_id == owner
        assert inviter_chain(cold, user["id"]) == [owner]
        history, = cold.list_analytics("invite_history", filters=[("match_id", "==", match_id)])
        assert history["released_at"] and history["views"] == 1
        assert history["acceptances"][0]["user_id"] == user["id"]
        events, cursor = [], None
        while True:
            page = cold.page_analytics("funnel_events", filters=[("match_id", "==", match_id)],
                                       limit=2, cursor=cursor)
            events.extend(page.items)
            cursor = page.next_cursor
            if cursor is None:
                break
        stages = {row["event"] for row in events}
        assert {"link_opened", "account_created", "recruited", "match_joined", "match_started", "match_deleted"} <= stages
        totals = summary(cold, owner_user_id=owner, match_id=match_id)
        assert totals["events"]["account_created"] == totals["events"]["match_started"] == 1
        assert totals["distinct_visitors"]["link_opened"] == 1
    finally:
        cold.close()


def test_cleanup_has_private_preimages_preserves_match_edge_and_backfills_nodes(store, tmp_path):
    owner, _, _ = legacy_user(store, "owner")
    child, _, _ = legacy_user(store, "match-child", inviter=owner, token="expired-code")
    personal, _, _ = legacy_user(store, "personal-child", inviter=owner)
    retained = Invite(token="abcd", match_id="retained-match", created_by_user_id=owner,
                      created_at=store.get_user(owner).created_at, views=5)
    store.put_invite(retained)
    reservation = store.ref("referrals", "retired-code")
    reservation.set({"user_id": owner})
    dry = finish(store, tmp_path / "preview", page_size=1, max_documents=1)
    assert dry["counts"]["users"]["legacy"] == 3 and reservation.get().exists
    result = finish(store, tmp_path / "apply", apply=True, page_size=1, max_documents=1)
    assert result["complete"] and not reservation.get().exists
    cold = QueryStore(store.client, namespace=store.namespace)
    try:
        assert cold.get_user(personal).invited_by_user_id is None
        assert cold.get_user(child).invited_by_user_id == owner
        assert inviter_chain(cold, child) == [owner]
        archive, = cold.list_analytics("invite_history")
        assert archive["views"] == 5 and archive["reconstructed"] is True
        assert summary(cold, match_id="retained-match")["events"]["invite_created"] == 1
        assert list((tmp_path / "apply" / "preimages").glob("*.json"))
    finally:
        cold.close()
