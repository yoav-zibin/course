"""Retired online matchmaking routes are absent from the API contract."""

import pytest

from game_platform.tests.helpers import Api


@pytest.mark.parametrize("path", ["/matches/open", "/v2/matches/open"])
def test_open_match_listing_is_removed(api: Api, path: str) -> None:
    assert api.request("GET", path).status_code == 404
    assert path not in api.client.app.openapi()["paths"]


def test_quick_match_is_removed(api: Api) -> None:
    owner = api.new_user("owner")
    game = api.new_game(owner=owner)
    response = api.request("POST", "/matchmaking/quick-match", as_user=owner,
                           json={"game_id": game})
    assert response.status_code == 404
    assert "/matchmaking/quick-match" not in api.client.app.openapi()["paths"]


def test_online_computer_configuration_is_removed(api: Api) -> None:
    owner = api.new_user("owner")
    match_id = api.new_match(owner=owner, game_id=api.new_game(owner=owner))
    response = api.request("PATCH", f"/matches/{match_id}", as_user=owner,
                           json={"num_computer_opponents": 1})
    assert response.status_code == 405
    assert "patch" not in api.client.app.openapi()["paths"]["/matches/{match_id}"]
