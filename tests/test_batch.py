"""GET /batch — one call that runs several GETs and returns each status and body.

The portal's refresh fires a burst of GETs at once (user, games, matches, open
matches); batching them into a single call cuts the request count. A failing
sub-request reports its own status and never fails the whole batch."""

import json

from game_platform.tests.helpers import Api


def _batch(api: Api, items, as_user=None):
    return api.request(
        "GET", "/batch", as_user=as_user, params={"requests": json.dumps(items)}
    )


def test_batch_runs_several_gets_and_returns_them_in_order(api: Api) -> None:
    alice = api.new_user("Alice")
    api.new_game(owner=alice)
    response = _batch(
        api,
        [
            {"method": "GET", "path": "/games"},
            {"method": "GET", "path": f"/users/{alice}"},
            f"/games/popular?limit=1",
        ],
        as_user=alice,
    )
    assert response.status_code == 200
    results = response.json()
    assert [result["status"] for result in results] == [200, 200, 200]
    assert len(results[0]["body"]) == 1
    assert results[1]["body"]["display_name"] == "Alice"
    assert results[2]["body"] == []


def test_batch_keeps_a_failing_sub_request_from_failing_the_batch(api: Api) -> None:
    alice = api.new_user("Alice")
    response = _batch(
        api,
        [
            {"method": "GET", "path": "/games"},
            {"method": "GET", "path": "/games/no-such-game"},
            {"method": "GET", "path": f"/users/{alice}"},
        ],
        as_user=alice,
    )
    assert response.status_code == 200
    results = response.json()
    assert [result["status"] for result in results] == [200, 404, 200]
    assert "detail" in results[1]["body"]


def test_batch_rejects_non_get_and_nested_batch_per_item(api: Api) -> None:
    alice = api.new_user("Alice")
    response = _batch(
        api,
        [
            {"method": "POST", "path": "/games"},
            {"method": "GET", "path": "/batch?requests=[]"},
            {"method": "GET", "path": "/games"},
        ],
        as_user=alice,
    )
    assert response.status_code == 200
    results = response.json()
    assert [result["status"] for result in results] == [400, 400, 200]


def test_batch_rejects_invalid_json_and_too_many_requests(api: Api) -> None:
    alice = api.new_user("Alice")
    response = api.request(
        "GET", "/batch", as_user=alice, params={"requests": "not-json"}
    )
    assert response.status_code == 400
    response = _batch(
        api, [{"method": "GET", "path": "/games"}] * 51, as_user=alice
    )
    assert response.status_code == 400
    response = _batch(api, [], as_user=alice)
    assert response.status_code == 200
    assert response.json() == []
