from game_platform.tests.helpers import TEST_DECLARATIVE_UI
from pathlib import Path
import datetime as dt
import re
from dataclasses import replace

import pytest

from fastapi.testclient import TestClient

from game_platform.api import create_app
from game_platform.json_file_store import JsonFileStore
from game_platform.models import GameRules
from game_platform.schemas import GameOut
from game_platform.service import GamePlatform
from game_platform.tests.helpers import Api, ECHO_SERVER_CODE, TEST_GAME_SCHEMAS, error


def _invite(api: Api, match_id: str, *, as_user: str, **body: object) -> dict:
    response = api.request(
        "POST", f"/matches/{match_id}/invites", as_user=as_user, json=body or None
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_an_invite_link_seats_someone_in_a_public_match(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    match_id = api.ok(
        "POST", "/matches", as_user=alice, json={"game_id": game_id}
    )["id"]
    invite = _invite(api, match_id, as_user=alice)
    token = invite["token"]
    assert re.fullmatch(r"[a-z]{4}", token)
    assert api.ok("GET", f"/matches/{match_id}")["invite_code"] == token
    assert invite["url"] == f"http://testserver/invite/{token}"
    assert "qr_code_url" not in invite

    view = api.ok("GET", f"/invites/{token}")
    assert view["match"]["id"] == match_id
    assert view["game_name"] == "Poker"
    assert view["created_by_display_name"] == "alice"
    assert (view["usable"], view["unusable_reason"]) == (True, None)

    joined = api.ok("POST", f"/invites/{token}/accept", as_user=bob)
    assert api.summary(joined)["players"] == ["alice", "bob"]
    # Accepting again (or the creator opening their own link) changes nothing.
    assert api.ok("POST", f"/invites/{token}/accept", as_user=bob)["id"] == match_id
    assert api.ok("POST", f"/invites/{token}/accept", as_user=alice)["id"] == match_id

    (mine,) = api.ok("GET", "/users/me/invites", as_user=alice)
    assert [a["user_id"] for a in mine["acceptances"]] == [bob]


def test_invite_code_exists_at_match_creation_and_is_shared_by_players(api: Api) -> None:
    alice = api.new_user("alice")
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice))
    token = api.ok("GET", f"/matches/{match_id}")["invite_code"]
    assert re.fullmatch(r"[a-z]{4}", token)
    assert _invite(api, match_id, as_user=alice)["token"] == token
    assert _invite(api, match_id, as_user=alice, max_uses=1, expires_in_seconds=60)["token"] == token
    bob = api.new_user("bob")
    api.ok("POST", f"/invites/{token}/accept", as_user=bob)
    assert _invite(api, match_id, as_user=bob)["token"] == token


def test_links_use_the_configured_public_address() -> None:
    # POST /games is deleted; create the game through the service directly.
    platform = GamePlatform(store=None)
    client = TestClient(create_app(platform, public_base_url="https://play.example.com/"))
    alice = client.post("/users", json={"display_name": "alice"}).json()
    headers = {"X-User-Id": alice["id"], "X-User-Password": alice["password"]}
    game = GameOut.of(
        platform.create_game(

            name="Poker",
            description="",
            rules=GameRules(
                allowed_player_counts=(2,),
                allows_leave_mid_match=False,
                allows_join_mid_match=False,
            ),
            code="",
            server_code=ECHO_SERVER_CODE,
            game_schemas=TEST_GAME_SCHEMAS,
            import_package={"declarative_ui": TEST_DECLARATIVE_UI},
        )
    ).model_dump(mode="json")
    match = client.post("/matches", headers=headers, json={"game_id": game["id"]}).json()
    invite = client.post(f"/matches/{match['id']}/invites", headers=headers).json()
    assert invite["url"] == f"https://play.example.com/invite/{invite['token']}"


def test_full_match_invite_opens_as_a_viewer_without_adding_a_seat(api: Api) -> None:
    alice, bob, carol = [api.new_user(name) for name in ("alice", "bob", "carol")]
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice, allowed_player_counts=(2,)), joiners=[bob])
    token = api.ok("GET", f"/matches/{match_id}")["invite_code"]
    view = api.ok("GET", f"/invites/{token}")
    assert not view["usable"]
    spectator = api.ok("POST", f"/invites/{token}/accept", as_user=carol)
    assert spectator["id"] == match_id
    assert [player["user_id"] for player in spectator["players"]] == [alice, bob]
    assert api.platform._store.get_invite(token).acceptances == ()


def test_week_old_codes_are_unusable_even_before_daily_cleanup(api: Api) -> None:
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice))
    token = api.ok("GET", f"/matches/{match_id}")["invite_code"]
    invite = api.platform._store.get_invite(token)
    api.platform._clock = lambda: invite.created_at + dt.timedelta(days=7)
    assert api.request("GET", f"/invites/{token}").status_code == 404
    assert api.request("POST", f"/invites/{token}/accept", as_user=bob).status_code == 404


@pytest.mark.parametrize("query", [False, True])
def test_codes_are_unique_and_released_on_start_end_and_delete(query: bool) -> None:
    from game_platform.tests.fake_firestore import query_store

    api = Api(store=query_store() if query else None)
    if query:
        from game_platform.scaling_service import ScalablePlatform
        api.platform = ScalablePlatform(store=api.platform._store, clock=api.platform._clock,
                                       computer_move_delay_seconds=0)
        api.client.app.state.platform = api.platform
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = api.new_game(owner=alice)
    codes = iter(["aaaa", "aaaa", "bbbb", "aaaa", "cccc"])
    api.platform._new_invite_token = lambda: next(codes)
    first = api.new_match(owner=alice, game_id=game, joiners=[bob])
    second = api.new_match(owner=alice, game_id=game)
    assert api.ok("GET", f"/matches/{first}")["invite_code"] == "aaaa"
    assert api.ok("GET", f"/matches/{second}")["invite_code"] == "bbbb"
    if query:
        assert api.platform._store.counts()["invites_codes_total"] == 2
    started = api.ok("POST", f"/matches/{first}/start", as_user=alice)
    assert started["invite_code"] is None
    assert api.request("GET", "/invites/aaaa").status_code == 404
    third = api.new_match(owner=alice, game_id=game)
    assert api.ok("GET", f"/matches/{third}")["invite_code"] == "aaaa"
    # Ending the old match must never release the code now assigned to another.
    assert api.move(first, as_user=alice, next_turn=None).is_success
    assert api.ok("GET", "/invites/aaaa")["match"]["id"] == third
    api.ok("DELETE", f"/matches/{second}", as_user=alice)
    assert api.request("GET", "/invites/bbbb").status_code == 404
    if query:
        assert api.platform._store.counts()["invites_codes_total"] == 1


def test_solo_matches_do_not_reserve_invite_codes(api: Api) -> None:
    alice = api.new_user("alice")
    match = api.new_match(owner=alice, game_id=api.new_game(owner=alice, allowed_player_counts=(1,)))
    assert api.ok("GET", f"/matches/{match}")["invite_code"] is None
    assert api.platform._store.list_invites() == []


def test_code_allocation_failure_does_not_collect_a_stake(api: Api) -> None:
    alice = api.new_user("alice", tokens=20)
    game = api.new_game(owner=alice)
    api.platform._new_invite_token = lambda: "busy"
    api.new_match(owner=alice, game_id=game)
    response = api.request("POST", "/matches", as_user=alice,
                           json={"game_id": game, "bet_per_player": 5})
    assert response.status_code == 409
    assert api.platform._store.get_user(alice).token_balance == 20
    assert len(api.platform._store.list_matches_involving(alice)) == 1


def test_only_players_create_invites_and_only_creators_or_owners_revoke(
    api: Api,
) -> None:
    alice, bob, carol = api.new_user("alice"), api.new_user("bob"), api.new_user("carol")
    match_id = api.new_match(
        owner=alice, game_id=api.new_game(owner=alice), joiners=[bob]
    )
    assert error(
        api.request("POST", f"/matches/{match_id}/invites", as_user=carol)
    ) == (403, "you are not a player in this match")
    bobs = _invite(api, match_id, as_user=bob)["token"]
    assert error(api.request("POST", f"/invites/{bobs}/revoke", as_user=carol)) == (
        403,
        "only the invite's creator or the match's owner can revoke it",
    )
    # The match's owner may revoke an invite someone else made.
    assert api.ok("POST", f"/invites/{bobs}/revoke", as_user=alice)["revoked"] is True
    assert error(api.request("GET", "/invites/nope")) == (404, "invite not found")


def test_deleting_a_match_deletes_its_invites(api: Api) -> None:
    alice = api.new_user("alice")
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice))
    token = _invite(api, match_id, as_user=alice)["token"]
    api.ok("DELETE", f"/matches/{match_id}", as_user=alice)
    assert error(api.request("GET", f"/invites/{token}")) == (404, "invite not found")
    assert api.ok("GET", "/users/me/invites", as_user=alice) == []


def test_merging_accounts_keeps_invites(api: Api) -> None:
    alice, alice2, bob = (
        api.new_user("alice"),
        api.new_user("alice (phone)"),
        api.new_user("bob"),
    )
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice))
    token = _invite(api, match_id, as_user=alice)["token"]
    api.ok("POST", f"/invites/{token}/accept", as_user=bob)
    api.ok("POST", f"/users/{alice}/merge", as_user=alice, json={"into_user_id": alice2, "into_password": api.passwords_by_user_id[alice2]})

    (invite,) = api.ok("GET", "/users/me/invites", as_user=alice2)
    assert invite["created_by_user_id"] == alice2
    assert [a["user_id"] for a in invite["acceptances"]] == [bob]


def test_invites_survive_a_restart(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path)
    api = Api(store=store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice))
    token = _invite(api, match_id, as_user=alice)["token"]
    api.ok("POST", f"/invites/{token}/accept", as_user=bob)
    store.close()

    restarted = Api(store=JsonFileStore(path))
    restarted.passwords_by_user_id = api.passwords_by_user_id
    (invite,) = restarted.ok("GET", "/users/me/invites", as_user=alice)
    assert [a["user_id"] for a in invite["acceptances"]] == [bob]
    assert restarted.ok("GET", f"/invites/{token}")["usable"] is True
