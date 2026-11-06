from pathlib import Path

from game_platform.tests.helpers import Api

SERVER = (Path(__file__).resolve().parents[1] / "games" / "take-away.server.js").read_text()
SCHEMAS = {"state": True, "move": True, "view": True}


def test_mixed_simulation_is_private_to_test_endpoints_and_deterministic(api: Api):
    user = api.new_user("tester")
    players = [
        {"kind": "human", "max_loss": 3},
        {"kind": "human", "max_loss": 4},
        {"kind": "computer"},
    ]
    body = {"server_code": SERVER, "game_schemas": SCHEMAS, "players": players, "seed": 17}
    assert api.request("POST", "/game-test-emulator/reset", json=body).status_code == 401
    assert api.request("POST", "/emulator/reset", as_user=user, json=body).status_code == 422
    first = api.ok("POST", "/game-test-emulator/reset", as_user=user, json=body)
    assert first == api.ok("POST", "/game-test-emulator/reset", as_user=user, json=body)
    assert first["turn"] == ["human-1"]
    action = {**body, "state": first["state"], "turn": first["turn"],
              "move_count": first["move_count"], "player_id": "human-1", "move": {"take": 3}}
    assert api.request("POST", "/emulator/act", as_user=user, json=action).status_code == 422
    illegal = api.ok("POST", "/game-test-emulator/act", as_user=user,
                     json={**action, "move": {"take": 4}})
    assert illegal["error"] and illegal["state"] == first["state"]
    second = api.ok("POST", "/game-test-emulator/act", as_user=user, json=action)
    assert second == api.ok("POST", "/game-test-emulator/act", as_user=user, json=action)
    assert second["state"]["remaining"] == 6 and second["turn"] == ["human-2"]
    action.update(state=second["state"], turn=second["turn"],
                  move_count=second["move_count"], player_id="human-2")
    over = api.ok("POST", "/game-test-emulator/act", as_user=user, json=action)
    assert over["status"] == "over"
    assert over["state"]["winner"] == "computer-1"
    assert over["payouts"] == {"human-1": 4, "human-2": 3}
    assert all(view["remaining"] == 0 for view in over["views"].values())


def test_take_away_human_winner_gets_pot(api: Api):
    user = api.new_user("tester")
    players = [{"kind": "human", "max_loss": 3}, {"kind": "human", "max_loss": 4}]
    body = {"server_code": SERVER, "game_schemas": SCHEMAS, "players": players, "seed": 17}
    reply = api.ok("POST", "/game-test-emulator/reset", as_user=user, json=body)
    for player in ("human-1", "human-2", "human-1"):
        reply = api.ok("POST", "/game-test-emulator/act", as_user=user, json={
            **body, "state": reply["state"], "turn": reply["turn"],
            "move_count": reply["move_count"], "player_id": player, "move": {"take": 3},
        })
        assert reply["error"] is None
    assert reply["status"] == "over"
    assert reply["payouts"] == {"human-1": 7, "human-2": 0}
