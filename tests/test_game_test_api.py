"""End-to-end HTTP flow for the /game-test traces: submissions, the
server-check run, move rows, match verification, status, and the POST
/games gate, over a fake-Firestore QueryStore."""

import json
import pathlib

import pytest

from game_platform import game_traces as gt
from game_platform.scaling_service import ScalablePlatform
from game_platform.tests.fake_firestore import FakeClient, query_store
from game_platform.tests.helpers import Api

SECRET = "api-trace-secret-0123456789"
EXAMPLE = json.loads(
    (
        pathlib.Path(__file__).resolve().parent.parent
        / "examples"
        / "agent-game.json"
    ).read_text()
)
BODY = {**EXAMPLE, "game_addition_request_id_and_secret": SECRET}
PLAYERS = [
    {
        "id": "human-1",
        "kind": "human",
        "display_name": "Player 1",
        "picture_url": "",
        "max_loss": 0,
    }
]
STATES = [{"n": 0}, {"n": 1}, {"n": 2}, {"n": 3}]


@pytest.fixture
def api():
    store = query_store("tracens", FakeClient())
    api = Api(store=store)
    api.client.app.state.platform = ScalablePlatform(
        store=store, computer_move_delay_seconds=0
    )
    return api


def submit(api, secret=SECRET, body=BODY):
    response = api.client.post(
        "/game-test/submissions",
        json={"secret": secret, "game_name": body["name"], "body": body},
    )
    assert response.status_code == 201, response.text
    return response.json()["submission_id"]


def play_verified_match(
    api, submission_id, mode, resolution, orientation, secret=SECRET
):
    session = f"{mode}-{resolution}-{orientation}"
    config = {
        "num_players": 1,
        "resolution": resolution,
        "orientation": orientation,
        "human_player_index": None,
    }
    for i in range(3):
        response = api.client.post(
            "/game-test/moves",
            json={
                "secret": secret,
                "submission_id": submission_id,
                "session_id": session,
                "mode": mode,
                "config": config,
                "player_index": 0,
                "move_number": i,
                "state": STATES[i],
                "view": STATES[i],
                "move": {"add": 1},
            },
        )
        assert response.status_code == 201, response.text
        assert len(response.json()["md5"]) == 32
    response = api.client.post(
        "/game-test/verify-match",
        json={
            "secret": secret,
            "submission_id": submission_id,
            "session_id": session,
            "mode": mode,
            "config": config,
            "players": PLAYERS,
            "pot": 0,
            "match_seed": 7,
            "states": STATES,
            "moves": [{"player_index": 0, "move": {"add": 1}} for _ in range(3)],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["verified"] is True


def run_full_flow(api, secret, body):
    """Drive the whole recorded /game-test flow for an import body over HTTP:
    step 1 submission, step 2 server check, steps 3+5 verified matches for
    every resolution/orientation, step 4 computer configs. Returns
    (submission_id, server-check report). Assumes the counter example's
    one-player shape (states {n:0..3}, moves {add: 1})."""
    submission_id = submit(api, secret, body)
    response = api.client.post(
        "/game-test/server-check",
        json={"secret": secret, "submission_id": submission_id},
    )
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["passed"], report
    for mode in (gt.MODE_PASS_AND_PLAY, gt.MODE_MULTIPLAYER):
        for resolution in gt.RESOLUTIONS:
            for orientation in gt.ORIENTATIONS:
                play_verified_match(
                    api,
                    submission_id,
                    mode,
                    resolution["label"],
                    orientation,
                    secret=secret,
                )
    from game_platform.agent_import import GameImport

    pairs = gt.step4_required_pairs(GameImport.model_validate(body))
    for count, seat in pairs:
        config = {
            "num_players": count,
            "resolution": gt.RESOLUTIONS[0]["label"],
            "orientation": gt.ORIENTATIONS[0],
            "human_player_index": seat,
        }
        for j in range(gt.STEP4_MIN_MOVES_PER_CONFIG):
            response = api.client.post(
                "/game-test/moves",
                json={
                    "secret": secret,
                    "submission_id": submission_id,
                    "session_id": f"computers-{count}-{seat}",
                    "mode": gt.MODE_AGAINST_COMPUTERS,
                    "config": config,
                    "player_index": seat,
                    "move_number": j,
                    "state": {"n": j},
                    "view": {"n": j},
                    "move": {"add": 1},
                },
            )
            assert response.status_code == 201, response.text
    return submission_id, report


def test_get_submission_roundtrip(api):
    response = api.client.get("/game-test/submission", params={"secret": SECRET})
    assert response.status_code == 404
    submission_id = submit(api)
    response = api.client.get("/game-test/submission", params={"secret": SECRET})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["submission_id"] == submission_id
    assert data["game_name"] == BODY["name"]
    from game_platform.agent_import import GameImport

    assert data["body"] == GameImport.model_validate(BODY).model_dump()


def test_submission_with_broken_code_is_rejected_and_not_stored(api):
    broken = {**BODY, "server_code": "const game = {};"}
    response = api.client.post(
        "/game-test/submissions",
        json={"secret": SECRET, "game_name": BODY["name"], "body": broken},
    )
    assert response.status_code == 422, response.text
    assert "erification" in response.text
    response = api.client.get("/game-test/submission", params={"secret": SECRET})
    assert response.status_code == 404


def test_submission_rejects_a_mismatched_secret(api):
    response = api.client.post(
        "/game-test/submissions",
        json={"secret": "some-other-secret-0123", "game_name": "x", "body": BODY},
    )
    assert response.status_code == 422


def test_verify_match_rejects_a_tampered_state(api):
    submission_id = submit(api)
    config = {
        "num_players": 1,
        "resolution": gt.RESOLUTIONS[0]["label"],
        "orientation": "vertical",
        "human_player_index": None,
    }
    tampered = [dict(state) for state in STATES]
    tampered[2] = {"n": 99}
    response = api.client.post(
        "/game-test/verify-match",
        json={
            "secret": SECRET,
            "submission_id": submission_id,
            "session_id": "s1",
            "mode": "pass_and_play",
            "config": config,
            "players": PLAYERS,
            "pot": 0,
            "match_seed": 7,
            "states": tampered,
            "moves": [{"player_index": 0, "move": {"add": 1}} for _ in range(3)],
        },
    )
    assert response.status_code == 422


def test_verify_match_against_computers_allows_a_capped_end(api):
    # Step 4 sessions are verified by replay too, strict about the
    # single-player turn, but a session stopped at the move cap may end
    # mid-match — the same payload as pass-and-play must end terminally.
    submission_id = submit(api)
    config = {
        "num_players": 1,
        "resolution": gt.RESOLUTIONS[0]["label"],
        "orientation": "vertical",
        "human_player_index": 0,
    }
    payload = {
        "secret": SECRET,
        "submission_id": submission_id,
        "session_id": "s1",
        "config": config,
        "players": PLAYERS,
        "pot": 0,
        "match_seed": 7,
        "states": STATES[:3],
        "moves": [{"player_index": 0, "move": {"add": 1}} for _ in range(2)],
    }
    response = api.client.post(
        "/game-test/verify-match",
        json={**payload, "mode": "against_computers"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["verified"] is True
    response = api.client.post(
        "/game-test/verify-match", json={**payload, "mode": "pass_and_play"}
    )
    assert response.status_code == 422


def test_full_flow_then_import(api):
    # The import gate refuses an untested game first.
    response = api.client.post("/games", json=BODY)
    assert response.status_code == 422
    assert "Game testing is incomplete" in response.text

    submission_id, report = run_full_flow(api, SECRET, BODY)
    assert report["states_visited"] >= 4
    assert report["terminal_states"] >= 1

    response = api.client.get("/game-test/status", params={"secret": SECRET})
    assert response.status_code == 200
    status = response.json()
    assert status["complete"] is True, status
    assert status["gaps"] == []

    # And now the very same payload imports.
    response = api.client.post("/games", json=BODY)
    assert response.status_code == 201, response.text
    assert response.json()["name"] == BODY["name"]
