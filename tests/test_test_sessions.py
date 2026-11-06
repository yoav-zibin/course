"""Private test recording persistence and ownership."""

from game_platform.json_file_store import JsonFileStore
from game_platform.tests.helpers import Api


def recording():
    return {"client_code": "<html></html>", "server_code": "const game = {};",
            "scenarios": [{"id": "0", "mode": "pass"}],
            "events": [{"type": "state", "at": 12, "scenario": "0", "reply": {"state": {"n": 1}}}]}


def test_recording_is_private_versioned_and_deletable(api):
    alice = api.new_user("alice")
    bob = api.new_user("bob")
    body = {"revision": 0, "recording": recording()}
    assert api.request("POST", "/game-test-sessions", json=body).status_code == 401
    created = api.ok("POST", "/game-test-sessions", as_user=alice, json=body)
    path = "/game-test-sessions/" + created["id"]
    assert api.request("GET", path, as_user=bob).status_code == 404
    assert api.request("PUT", path, as_user=bob, json=body).status_code == 404
    assert api.request("DELETE", path, as_user=bob).status_code == 404
    assert api.ok("GET", "/game-test-sessions", as_user=bob)["items"] == []
    assert api.ok("GET", path, as_user=alice)["recording"] == recording()
    body["revision"] = 1
    body["recording"]["events"].append({"type": "click", "at": 15})
    assert api.ok("PUT", path, as_user=alice, json=body)["revision"] == 2
    assert api.request("PUT", path, as_user=alice, json=body).status_code == 409
    assert api.request("DELETE", path, as_user=alice).status_code == 204
    assert api.request("GET", path, as_user=alice).status_code == 404


def test_recording_survives_file_restart(tmp_path):
    path = tmp_path / "data.json"
    store = JsonFileStore(path)
    api = Api(store=store)
    owner = api.new_user("owner")
    password = api.passwords_by_user_id[owner]
    saved = api.ok("POST", "/game-test-sessions", as_user=owner,
                   json={"revision": 0, "recording": recording()})
    store.close()
    store = JsonFileStore(path)
    api = Api(store=store)
    result = api.request("GET", "/game-test-sessions/" + saved["id"], as_user=owner, password=password)
    assert result.status_code == 200
    assert result.json()["recording"] == recording()
    store.close()


def test_recording_limits_and_invalid_body(api):
    owner = api.new_user("owner")
    payload = recording()
    payload["client_code"] = "x" * 200_001
    assert api.request("POST", "/game-test-sessions", as_user=owner,
                       json={"revision": 0, "recording": payload}).status_code == 422
    payload = recording()
    payload["events"] = [{"value": "x" * 1000}] * 4000
    assert api.request("POST", "/game-test-sessions", as_user=owner,
                       json={"revision": 0, "recording": payload}).status_code == 413


def test_large_repetitive_matrix_recording_can_be_saved(api):
    owner = api.new_user("owner")
    payload = recording()
    payload["events"] = [{"type": "state", "at": n, "scenario": str(n % 30),
                          "reply": {"state": {"board": ["x"] * 9},
                                    "views": {"human-1": {"board": ["x"] * 9}},
                                    "padding": "x" * 1000}} for n in range(1500)]
    saved = api.ok("POST", "/game-test-sessions", as_user=owner,
                   json={"revision": 0, "recording": payload})
    assert api.ok("GET", "/game-test-sessions/" + saved["id"], as_user=owner)["recording"] == payload


def test_account_delete_removes_recordings(api):
    owner = api.new_user("owner")
    saved = api.ok("POST", "/game-test-sessions", as_user=owner,
                   json={"revision": 0, "recording": recording()})
    api.platform.admin_delete_user(owner)
    assert api.platform._store.get_game_test_session(saved["id"]) is None


def test_account_merge_moves_recordings_to_survivor(api):
    source = api.new_user("source")
    target = api.new_user("target")
    other = api.new_user("other")
    saved = api.ok("POST", "/game-test-sessions", as_user=source,
                   json={"revision": 0, "recording": recording()})
    api.ok("POST", f"/users/{source}/merge", as_user=source,
           json={"into_user_id": target, "into_password": api.passwords_by_user_id[target]})
    path = "/game-test-sessions/" + saved["id"]
    assert api.ok("GET", path, as_user=target)["recording"] == recording()
    assert api.request("GET", path, as_user=other).status_code == 404
