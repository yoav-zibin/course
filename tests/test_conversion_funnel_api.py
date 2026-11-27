"""Private history APIs keep authorization, scopes and retained IDs intact."""

import json

import pytest

from game_platform.json_file_store import JsonFileStore
from game_platform.scaling_service import ScalablePlatform
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api


@pytest.fixture(params=["memory", "query"])
def api(request):
    store = query_store("conversion_api") if request.param == "query" else None
    fixture = Api(store=store)
    if store is not None:
        fixture.platform = ScalablePlatform(store=store, clock=fixture.platform._clock,
                                            computer_move_delay_seconds=0)
        fixture.client.app.state.platform = fixture.platform
    return fixture


def lobby(api, owner, game_id=None):
    game_id = game_id or api.new_game(owner=owner, allowed_player_counts=[2])
    match_id = api.new_match(owner=owner, game_id=game_id)
    return match_id, api.platform._store.get_match(match_id).invite_code


def recruit(api, match_id, name="Private recruited profile"):
    result = api.ok("POST", "/users", json={"display_name": name, "invite_match_id": match_id})
    api.passwords_by_user_id[result["id"]] = result["password"]
    return result["id"]


def pages(api, path, **params):
    rows, cursor = [], None
    while True:
        result = api.ok("GET", path, params={**params, "limit": 2,
                                            **({"cursor": cursor} if cursor else {})})
        rows.extend(result["items"])
        cursor = result["next_cursor"]
        if cursor is None:
            return rows


def assert_no_profile_data(value):
    private = {"display_name", "email", "phone", "password", "linked_accounts",
               "picture_url", "ip_address", "headers", "request_headers"}
    if isinstance(value, dict):
        assert not (private & value.keys())
        for child in value.values():
            assert_no_profile_data(child)
    elif isinstance(value, list):
        for child in value:
            assert_no_profile_data(child)


@pytest.mark.parametrize("path", [
    "/admin/recruitment/{user_id}", "/admin/conversion-funnel",
    "/admin/conversion-funnel/events", "/admin/conversion-funnel/invites",
])
def test_every_history_admin_api_requires_admin_authorization(api, path):
    user_id = api.new_user("Private ordinary account")
    path = path.format(user_id=user_id)
    player = {"X-User-Id": user_id, "X-User-Password": api.passwords_by_user_id[user_id]}
    assert api.client.get(path).status_code == 401
    assert api.client.get(path, headers=player).status_code == 401
    assert api.client.get(path, auth=("admin", "wrong")).status_code == 401
    # Browser requests require a pinned Google admin session even with API Basic.
    assert api.client.get(path, headers={"Sec-Fetch-Mode": "cors"},
                          auth=("admin", api.client.app.state.master_password)).status_code == 401
    response = api.request("GET", path)
    assert response.status_code == 200
    assert_no_profile_data(response.json())


def test_own_chain_cannot_be_read_with_spoofed_or_other_account_credentials(api):
    owner = api.new_user("Private root profile")
    match_id, _ = lobby(api, owner)
    child = recruit(api, match_id)
    other = api.new_user("Private unrelated profile")
    assert api.client.get("/users/me/recruitment").status_code == 401
    assert api.client.get("/users/me/recruitment", headers={
        "X-User-Id": child, "X-User-Password": api.passwords_by_user_id[other],
    }).status_code == 401
    own = api.ok("GET", "/users/me/recruitment", as_user=child,
                 params={"user_id": other})
    assert own["user_id"] == child
    assert own["inviter_chain"] == [owner]
    assert api.ok("GET", "/users/me/recruitment", as_user=other)["inviter_chain"] == []
    assert api.request("GET", f"/users/{child}/recruitment", as_user=other).status_code == 404
    assert_no_profile_data(own)


def test_scoped_totals_and_pages_do_not_mix_owners_or_duplicate_records(api):
    first, second = api.new_user("Private first owner"), api.new_user("Private second owner")
    game_id = api.new_game(owner=first, allowed_player_counts=[2])
    matches = [lobby(api, first, game_id)[0], lobby(api, first, game_id)[0],
               lobby(api, second, game_id)[0]]
    for match_id in matches:
        recruit(api, match_id)
    global_totals = api.ok("GET", "/admin/conversion-funnel")
    owner_totals = api.ok("GET", "/admin/conversion-funnel", params={"owner_user_id": first})
    match_totals = api.ok("GET", "/admin/conversion-funnel", params={"match_id": matches[0]})
    disjoint = api.ok("GET", "/admin/conversion-funnel",
                      params={"owner_user_id": second, "match_id": matches[0]})
    assert global_totals["events"]["recruited"] == 3
    assert owner_totals["events"]["recruited"] == 2
    assert owner_totals["distinct_accounts"]["recruited"] == 2
    assert match_totals["events"]["recruited"] == 1
    assert disjoint["events"] == {}
    events = pages(api, "/admin/conversion-funnel/events", owner_user_id=first)
    assert len(events) > 2
    assert len({event["id"] for event in events}) == len(events)
    assert all(event["owner_user_id"] == first and event["match_id"] in matches[:2] for event in events)
    allocations = pages(api, "/admin/conversion-funnel/invites", owner_user_id=first)
    assert {row["match_id"] for row in allocations} == set(matches[:2])
    assert_no_profile_data({"events": events, "allocations": allocations})


@pytest.mark.parametrize("collection", ["events", "invites"])
def test_pagination_rejects_invalid_bounds_and_cross_scope_cursors(api, collection):
    owner, other = api.new_user("Owner"), api.new_user("Other")
    game_id = api.new_game(owner=owner, allowed_player_counts=[2])
    for _ in range(3):
        lobby(api, owner, game_id)
    path = "/admin/conversion-funnel/" + collection
    for limit in (0, 101):
        response = api.request("GET", path, params={"limit": limit})
        assert response.status_code in (400, 422)
    first = api.ok("GET", path, params={"owner_user_id": owner, "limit": 1})
    assert first["next_cursor"]
    response = api.request("GET", path, params={"owner_user_id": other,
                                               "cursor": first["next_cursor"]})
    assert response.status_code == 400


def test_unknown_admin_id_returns_not_found_without_creating_a_history_node(api):
    store = api.platform._store
    assert store.get_analytics("recruitment_nodes", "unknown-account") is None
    response = api.request("GET", "/admin/recruitment/unknown-account")
    assert response.status_code == 404
    assert store.get_analytics("recruitment_nodes", "unknown-account") is None


def test_deleted_account_and_match_history_remain_private_after_json_reload(tmp_path):
    path = tmp_path / "retained-history.json"
    store = JsonFileStore(path)
    api = Api(store=store)
    owner = api.new_user("Private root name")
    match_id, _ = lobby(api, owner)
    child = recruit(api, match_id, name="Private child name")
    password = api.passwords_by_user_id[child]
    before = api.ok("GET", "/admin/conversion-funnel", params={"match_id": match_id})
    api.ok("DELETE", f"/admin/users/{owner}")
    api.ok("DELETE", f"/admin/users/{child}")
    store.close()
    cold = JsonFileStore(path)
    try:
        restored = Api(store=cold)
        ancestry = restored.ok("GET", f"/admin/recruitment/{child}")
        assert ancestry["node"]["deleted_at"]
        assert ancestry["inviter_chain"] == [owner]
        totals = restored.ok("GET", "/admin/conversion-funnel", params={"match_id": match_id})
        for stage, count in before["events"].items():
            assert totals["events"][stage] == count
        allocations = pages(restored, "/admin/conversion-funnel/invites", match_id=match_id)
        assert len(allocations) == 1 and allocations[0]["released_at"]
        assert restored.client.get("/users/me/recruitment", headers={
            "X-User-Id": child, "X-User-Password": password,
        }).status_code == 401
        assert_no_profile_data({"ancestry": ancestry, "allocations": allocations})
        encoded = json.dumps(cold.list_analytics("recruitment_nodes")
                             + cold.list_analytics("invite_history")
                             + cold.list_analytics("funnel_events"))
        assert "Private root name" not in encoded
        assert "Private child name" not in encoded
        assert password not in encoded
    finally:
        cold.close()
