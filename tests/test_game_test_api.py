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


SESSION_CONFIG = {
    "num_players": 1,
    "resolution": gt.RESOLUTIONS[0]["label"],
    "orientation": "vertical",
    "human_player_index": None,
}


def start_session(api, submission_id, session_id="sess-1", mode="pass_and_play", secret=SECRET):
    response = api.client.post(
        "/game-test/sessions",
        json={
            "secret": secret,
            "submission_id": submission_id,
            "session_id": session_id,
            "mode": mode,
            "config": SESSION_CONFIG,
            "players": PLAYERS,
            "pot": 0,
            "match_seed": 7,
            "initial_state": {"n": 0},
            "initial_turn": ["human-1"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def append_move(api, session_id, n, secret=SECRET, state_after=None, turn_after="auto"):
    if turn_after == "auto":
        turn_after = ["human-1"] if n < 3 else None
    response = api.client.post(
        f"/game-test/sessions/{session_id}/moves",
        json={
            "secret": secret,
            "submission_id": api_submission(api, secret),
            "player_index": 0,
            "move": {"add": 1},
            "view": {"n": n - 1},
            "state_after": state_after if state_after is not None else {"n": n},
            "turn_after": turn_after,
        },
    )
    return response


def api_submission(api, secret=SECRET):
    response = api.client.get("/game-test/submission", params={"secret": secret})
    assert response.status_code == 200, response.text
    return response.json()["submission_id"]


def test_session_records_moves_incrementally_and_finishes(api):
    submission_id = submit(api)
    start_session(api, submission_id)
    for n in (1, 2):
        response = append_move(api, "sess-1", n)
        assert response.status_code == 201, response.text
        assert response.json() == {"move_count": n, "finished": False}
    # Nothing is verified yet: the match is still in progress.
    status = api.client.get("/game-test/status", params={"secret": SECRET}).json()
    assert status["steps"]["step3"]["verified"] == 0
    # The terminal move finishes and verifies the match on the spot.
    response = append_move(api, "sess-1", 3)
    assert response.status_code == 201, response.text
    assert response.json() == {"move_count": 3, "finished": True}
    status = api.client.get("/game-test/status", params={"secret": SECRET}).json()
    assert status["steps"]["step3"]["verified"] == 1
    assert status["steps"]["step3"]["missing"] == []
    # No open session remains to resume.
    data = api.client.get("/game-test/open-session", params={"secret": SECRET}).json()
    assert data["session"] is None


def test_session_open_session_returns_the_resume_payload(api):
    submission_id = submit(api)
    start_session(api, submission_id)
    append_move(api, "sess-1", 1)
    append_move(api, "sess-1", 2)
    data = api.client.get("/game-test/open-session", params={"secret": SECRET}).json()
    session = data["session"]
    assert session["session_id"] == "sess-1"
    assert session["mode"] == "pass_and_play"
    assert session["move_count"] == 2
    assert session["states"] == [{"n": 0}, {"n": 1}, {"n": 2}]
    assert session["moves"] == [
        {"player_index": 0, "move": {"add": 1}},
        {"player_index": 0, "move": {"add": 1}},
    ]
    assert session["turns"] == [["human-1"], ["human-1"], ["human-1"]]
    assert session["match_seed"] == 7


def test_session_rejects_a_tampered_state_and_keeps_the_prefix(api):
    submission_id = submit(api)
    start_session(api, submission_id)
    response = append_move(api, "sess-1", 1, state_after={"n": 99})
    assert response.status_code == 422, response.text
    # The failed move recorded nothing; the correct move still lands.
    data = api.client.get("/game-test/open-session", params={"secret": SECRET}).json()
    assert data["session"]["move_count"] == 0
    response = append_move(api, "sess-1", 1)
    assert response.status_code == 201, response.text


def test_session_append_is_idempotent_for_a_retried_move(api):
    submission_id = submit(api)
    start_session(api, submission_id)
    response = append_move(api, "sess-1", 1)
    assert response.status_code == 201
    # Same move posted again (its first response was lost on the wire):
    # it succeeds as a duplicate and is not recorded twice.
    response = append_move(api, "sess-1", 1)
    assert response.status_code == 201, response.text
    assert response.json()["duplicate"] is True
    assert response.json()["move_count"] == 1


def test_session_close_finishes_a_capped_computer_session(api):
    submission_id = submit(api)
    config = {**SESSION_CONFIG, "human_player_index": 0}
    response = api.client.post(
        "/game-test/sessions",
        json={
            "secret": SECRET,
            "submission_id": submission_id,
            "session_id": "sess-4",
            "mode": "against_computers",
            "config": config,
            "players": PLAYERS,
            "pot": 0,
            "match_seed": 7,
            "initial_state": {"n": 0},
            "initial_turn": ["human-1"],
        },
    )
    assert response.status_code == 201, response.text
    for n in (1, 2):
        response = api.client.post(
            "/game-test/sessions/sess-4/moves",
            json={
                "secret": SECRET,
                "submission_id": submission_id,
                "player_index": 0,
                "move": {"add": 1},
                "view": {"n": n - 1},
                "state_after": {"n": n},
                "turn_after": ["human-1"],
            },
        )
        assert response.status_code == 201, response.text
    response = api.client.post(
        "/game-test/sessions/sess-4/close",
        json={"secret": SECRET, "submission_id": submission_id},
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"finished": True, "moves_verified": 2}
    # Step 4 counts the pair from the session's move rows.
    status = api.client.get("/game-test/status", params={"secret": SECRET}).json()
    assert status["steps"]["step4"]["done"] is True


def test_new_session_abandons_the_previous_open_one(api):
    submission_id = submit(api)
    start_session(api, submission_id, session_id="sess-a")
    start_session(api, submission_id, session_id="sess-b")
    data = api.client.get("/game-test/open-session", params={"secret": SECRET}).json()
    assert data["session"]["session_id"] == "sess-b"
    response = api.client.post(
        "/game-test/sessions/sess-b/abandon",
        json={"secret": SECRET, "submission_id": submission_id},
    )
    assert response.status_code == 200, response.text
    data = api.client.get("/game-test/open-session", params={"secret": SECRET}).json()
    assert data["session"] is None


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
