"""All matches are public, including records with obsolete audience flags."""

import json
import datetime as dt
from dataclasses import replace
from pathlib import Path

import pytest

from game_platform.json_file_store import JsonFileStore
from game_platform.tests.helpers import Api


@pytest.mark.parametrize("obsolete_private", [True, False, None])
def test_cached_client_audience_option_is_ignored(api: Api, obsolete_private) -> None:
    alice = api.new_user("alice")
    match = api.ok("POST", "/matches", as_user=alice,
                   json={"game_id": api.new_game(owner=alice), "private": obsolete_private})
    assert "private" not in match
    assert api.ok("GET", f"/matches/{match['id']}")["id"] == match["id"]


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


def test_stored_audience_flags_disappear_and_matches_are_public_after_a_restart(tmp_path: Path) -> None:
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
    for caller in (None, alice, bob):
        for suffix in ("", "/history", "/moves"):
            response = restarted.ok("GET", f"/matches/{match_id}{suffix}", as_user=caller)
            if not suffix:
                assert response["id"] == match_id and "private" not in response
    joined = restarted.ok("POST", f"/matches/{match_id}/join", as_user=bob)
    assert [player["user_id"] for player in joined["players"]] == [alice, bob]
    restarted.platform._store.close()
    stored_match = json.loads(path.read_text())["data"]["matches"][0]
    assert "private" not in stored_match
    assert "matchmaking_player_count" not in stored_match


@pytest.mark.parametrize("unusable", ["revoked", "expired", "consumed"])
def test_unusable_invites_do_not_restrict_match_access(api: Api, unusable):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice))
    store = api.platform._store
    invite = api.ok("POST", f"/matches/{match_id}/invites", as_user=alice, json={"max_uses": 1})
    if unusable == "consumed":
        # Older stored capabilities may still carry a per-invite use limit.
        store.put_invite(replace(store.get_invite(invite["token"]), max_uses=1))
        api.ok("POST", f"/invites/{invite['token']}/accept", as_user=bob)
    else:
        record = store.get_invite(invite["token"])
        store.put_invite(replace(record, revoked=unusable == "revoked",
            expires_at=api.platform.now() - dt.timedelta(seconds=1) if unusable == "expired" else None))
    view = api.request("GET", f"/invites/{invite['token']}")
    assert view.status_code == (200 if unusable == "consumed" else 404)
    assert api.ok("GET", f"/matches/{match_id}")["id"] == match_id
    assert api.request("GET", f"/matches/{match_id}/history").status_code == 200


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
    for name in ("MatchOut", "MatchSummaryOut"):
        assert "private" not in schema["components"]["schemas"][name]["properties"]
    for path in ("/matches/{match_id}", "/matches/{match_id}/history", "/matches/{match_id}/moves",
                 "/v2/matches/{match_id}/history"):
        assert "invite" not in {item["name"] for item in schema["paths"][path]["get"].get("parameters", [])}
    assert "num_computer_opponents" not in properties
    assert "/matchmaking/quick-match" not in schema["paths"]
    assert "/matches/open" not in schema["paths"]
    assert "/v2/matches/open" not in schema["paths"]
    assert "patch" not in schema["paths"]["/matches/{match_id}"]
