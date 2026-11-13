"""What a browser sees when it opens an API address (the branded pages in api.py)."""

from game_platform.tests.helpers import Api

BROWSER = {"Accept": "text/html,application/xhtml+xml"}


def _get(api: Api, path: str, **kwargs):
    return api.client.get(path, headers=BROWSER, follow_redirects=False, **kwargs)


def test_a_json_route_opened_in_a_browser_goes_to_the_portal(api: Api) -> None:
    user = api.new_user("alice")
    response = _get(api, f"/users/{user}")
    assert response.status_code == 303 and response.headers["location"] == "/portal"


def test_an_error_opened_in_a_browser_is_a_page(api: Api) -> None:
    response = _get(api, "/games/nope/versions/1")
    assert response.status_code == 404 and "text/html" in response.headers["content-type"]


def test_the_health_check_shows_its_json_in_a_browser(api: Api) -> None:
    response = _get(api, "/health")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["status"] == "ok"


def test_admin_routes_and_the_api_description_show_their_json_in_a_browser(api: Api) -> None:
    for path in ("/admin/game-input-metrics", "/openapi.json"):
        response = _get(api, path)
        assert response.status_code == 200, path
        assert response.headers["content-type"].startswith("application/json"), path


def test_raw_in_the_address_keeps_the_json_for_any_route(api: Api) -> None:
    user = api.new_user("alice")
    response = _get(api, f"/users/{user}", params={"raw": "1"})
    assert response.status_code == 200 and response.json()["id"] == user
    missing = _get(api, "/games/nope/versions/1", params={"raw": "1"})
    assert missing.status_code == 404 and missing.headers["content-type"].startswith("application/json")
