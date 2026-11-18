"""Paginated responses keep their JSON contract on the native serialization path."""

import datetime as dt
from dataclasses import replace
from unittest.mock import patch

import pytest
from fastapi.encoders import jsonable_encoder

from game_platform.scaling_service import ScalablePlatform
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api, FakeClock
from game_platform.tests.test_server_matches import COUNTER_GAME


@pytest.fixture
def paginated_api():
    store = query_store("response_serialization")
    api = Api(store=store)
    api.platform = ScalablePlatform(
        store=store, clock=FakeClock(), computer_move_delay_seconds=0,
    )
    api.client.app.state.platform = api.platform
    owner = api.new_user("owner")
    other = api.new_user("other")
    games = [api.new_game(owner=owner) for _ in range(2)]
    schemas = {
        "state": {
            "type": "object",
            "properties": {
                f"field_{index}": {
                    "description": "Unicode café, quotes \" and a newline\n",
                    "default": {"nested": [None, True, 1.25, 2**60]},
                    "anyOf": [{"type": "string"}, {"type": "null"}],
                }
                for index in range(32)
            },
        },
        "move": True,
        "view": True,
    }
    for game_id in games:
        store.put_game_version(replace(store.get_game(game_id), game_schemas=schemas))
        api.ok("PUT", f"/v2/users/me/saved-games/{game_id}", as_user=owner)
    match_id = api.new_match(owner=owner, game_id=games[0])
    # Match responses include server_time; hold it constant for encoder parity.
    api.platform._clock = lambda: dt.datetime(2026, 1, 2, tzinfo=dt.timezone.utc)
    try:
        yield api, store, owner, other, games, match_id
    finally:
        api.platform.close_workers()
        api.client.close()
        store.close()


@pytest.mark.parametrize(
    "path",
    [
        "/v2/games",
        "/v2/builder/games",
        "/v2/users/me/saved-games",
        "/v2/matches/open",
        "/v2/matches",
    ],
)
def test_pages_keep_encoder_json_without_python_response_traversal(paginated_api, path):
    api, _, owner, _, _, _ = paginated_api
    route = next(route for route in api.client.app.routes if getattr(route, "path", None) == path)
    arguments = {"platform": api.platform, "limit": 1, "cursor": None}
    if path == "/v2/games":
        arguments["q"] = ""
    elif path not in ("/v2/matches/open",):
        arguments["caller_id"] = owner
    if path == "/v2/matches":
        arguments.update(status=None, game_id=None)
    # This is the previous untyped route's serialization, including nested
    # models, timestamps, optional fields and schema-defined JSON values.
    expected = jsonable_encoder(route.endpoint(**arguments))
    assert expected["items"]
    with patch(
        "fastapi.routing.jsonable_encoder",
        side_effect=AssertionError("page fell back to Python JSON traversal"),
    ):
        response = api.ok("GET", path, as_user=owner, params={"limit": "1"})
    assert response == expected
    assert all("code" not in item and "server_code" not in item for item in response["items"])


def test_catalog_pages_preserve_visibility_and_caller_bound_cursors(paginated_api):
    api, store, owner, other, games, _ = paginated_api
    assert api.request("GET", "/v2/builder/games").status_code == 401
    first = api.ok("GET", "/v2/builder/games", as_user=owner, params={"limit": "1"})
    assert first["next_cursor"]
    second = api.ok(
        "GET", "/v2/builder/games", as_user=owner,
        params={"limit": "1", "cursor": first["next_cursor"]},
    )
    assert {item["id"] for item in first["items"] + second["items"]} == set(games)
    assert second["next_cursor"] is None
    assert api.request(
        "GET", "/v2/builder/games", as_user=other,
        params={"cursor": first["next_cursor"]},
    ).status_code == 400
    assert api.request(
        "GET", "/v2/games", params={"cursor": first["next_cursor"]},
    ).status_code == 400

    # Warm public and library reads must still reflect a committed unpublish.
    api.ok("GET", "/v2/games")
    api.ok("PUT", f"/v2/users/me/saved-games/{games[0]}", as_user=other)
    api.ok("GET", "/v2/users/me/saved-games", as_user=other)
    store.put_game_version(replace(store.get_game(games[0]), published=False))
    assert [item["id"] for item in api.ok("GET", "/v2/games")["items"]] == [games[1]]
    assert api.ok("GET", "/v2/users/me/saved-games", as_user=other)["items"] == []
    assert len(api.ok("GET", "/v2/builder/games", as_user=owner)["items"]) == 2
    assert api.ok("GET", "/v2/matches/open")["items"] == []


def test_match_pages_preserve_private_membership_and_player_state_views(paginated_api):
    api, store, owner, other, _, _ = paginated_api
    outsider = api.new_user("outsider")
    game_id = api.create_game({
        "name": "Private counter", "code": "<div></div>",
        "allowed_player_counts": [2], "server_code": COUNTER_GAME,
    }, owner)["id"]
    match_id = api.new_match(owner=owner, game_id=game_id, joiners=[other], start=True)
    store.put_match(replace(store.get_match(match_id), private=True))

    assert api.request("GET", "/v2/matches").status_code == 401
    for caller in (owner, other):
        page = api.ok("GET", "/v2/matches", as_user=caller, params={"game_id": game_id})
        assert page["next_cursor"] is None
        assert len(page["items"]) == 1
        match = page["items"][0]
        assert match["id"] == match_id and match["private"] is True
        assert match["state"] == {"count": 0, "your_secret": f"secret-of-{caller}"}
        assert not {"seed", "initial_state", "moves", "pending_leave_state"} & match.keys()
    assert api.ok("GET", "/v2/matches", as_user=outsider)["items"] == []
    assert match_id not in {item["id"] for item in api.ok("GET", "/v2/matches/open")["items"]}
