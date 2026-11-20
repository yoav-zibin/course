"""New matches are public; previously private matches retain their audience."""

import json
import datetime as dt
from dataclasses import replace
from pathlib import Path

import pytest

from game_platform.json_file_store import JsonFileStore
from game_platform.tests.helpers import Api


def test_legacy_private_requests_are_rejected_without_creating_a_public_match(api: Api) -> None:
    alice = api.new_user("alice")
    response = api.request("POST", "/matches", as_user=alice,
                           json={"game_id": api.new_game(owner=alice), "private": True})
    assert response.status_code == 422
    assert api.ok("GET", "/matches", as_user=alice) == []


def test_new_matches_remain_public(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match = api.ok("POST", "/matches", as_user=alice, json={"game_id": api.new_game(owner=alice)})
    assert "private" not in match
    assert "matchmaking_player_count" not in match
    for caller in (None, alice, bob):
        public = api.ok("GET", f"/matches/{match['id']}", as_user=caller)
        assert public["id"] == match["id"]
        assert "private" not in public
    joined = api.ok("POST", f"/matches/{match['id']}/join", as_user=bob)
    assert [player["user_id"] for player in joined["players"]] == [alice, bob]


def test_stored_private_matches_keep_their_audience_after_a_restart(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path)
    api = Api(store=store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice))
    store.close()
    snapshot = json.loads(path.read_text())
    snapshot["data"]["matches"][0]["private"] = True
    snapshot["data"]["matches"][0]["matchmaking_player_count"] = 2
    path.write_text(json.dumps(snapshot))

    restarted = Api(store=JsonFileStore(path))
    restarted.passwords_by_user_id = api.passwords_by_user_id
    for caller in (None, bob):
        for suffix in ("", "/history", "/moves"):
            assert restarted.request("GET", f"/matches/{match_id}{suffix}", as_user=caller).status_code == 404
    own = restarted.ok("GET", f"/matches/{match_id}", as_user=alice)
    assert own["id"] == match_id and own["private"] is True
    assert restarted.request("POST", f"/matches/{match_id}/join", as_user=bob).status_code == 404
    invite = restarted.ok("POST", f"/matches/{match_id}/invites", as_user=alice)
    assert restarted.ok("GET", f"/invites/{invite['token']}")["match"]["id"] == match_id
    joined = restarted.ok("POST", f"/invites/{invite['token']}/accept", as_user=bob)
    assert joined["status"] == "waiting_for_players"
    restarted.platform._store.close()
    stored_match = json.loads(path.read_text())["data"]["matches"][0]
    assert stored_match["private"] is True
    assert "matchmaking_player_count" not in stored_match


@pytest.mark.parametrize("unusable", ["revoked", "expired", "consumed"])
def test_unusable_legacy_private_invites_cannot_reveal_match(api: Api, unusable):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice))
    store = api.platform._store
    store.put_match(replace(store.get_match(match_id), private=True))
    invite = api.ok("POST", f"/matches/{match_id}/invites", as_user=alice, json={"max_uses": 1})
    if unusable == "consumed":
        api.ok("POST", f"/invites/{invite['token']}/accept", as_user=bob)
    else:
        record = store.get_invite(invite["token"])
        store.put_invite(replace(record, revoked=unusable == "revoked",
            expires_at=api.platform.now() - dt.timedelta(seconds=1) if unusable == "expired" else None))
    assert api.request("GET", f"/invites/{invite['token']}").status_code == 404


@pytest.mark.parametrize("computers", [1, 2, -1, True, "1", None])
def test_online_creation_rejects_computer_requests(api: Api, computers) -> None:
    alice = api.new_user("alice")
    game_id = api.new_game(owner=alice)
    response = api.request("POST", "/matches", as_user=alice,
                           json={"game_id": game_id, "num_computer_opponents": computers})
    assert response.status_code == 422
    assert "human players only" in response.text
    assert api.ok("GET", "/matches", as_user=alice) == []


def test_cached_client_zero_computers_still_creates_one_human_seat(api: Api) -> None:
    alice = api.new_user("alice")
    match = api.ok("POST", "/matches", as_user=alice,
                   json={"game_id": api.new_game(owner=alice), "num_computer_opponents": 0})
    assert [(p["kind"], p["user_id"]) for p in match["players"]] == [("human", alice)]


def test_api_schema_has_no_retired_match_options(api: Api) -> None:
    schema = api.client.get("/openapi.json").json()
    properties = schema["components"]["schemas"]["MatchCreate"]["properties"]
    assert "private" not in properties
    assert "num_computer_opponents" not in properties
    assert "/matchmaking/quick-match" not in schema["paths"]
    assert "/matches/open" not in schema["paths"]
    assert "/v2/matches/open" not in schema["paths"]
    assert "patch" not in schema["paths"]["/matches/{match_id}"]
