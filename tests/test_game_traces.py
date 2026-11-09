"""Traces for the /game-test flow: step-1 storage, step-2 metadata, move
rows, match replay verification, and the completion evaluation that gates
POST /games. Runs against the fake Firestore client."""

import json
import pathlib

import pytest

from game_platform import game_traces as gt
from game_platform.agent_import import GameImport
from game_platform.service import InvalidRequestError
from game_platform.tests.fake_firestore import FakeClient, query_store

SECRET = "trace-test-secret-0123456789"

EXAMPLE = json.loads(
    (
        pathlib.Path(__file__).resolve().parent.parent
        / "examples"
        / "agent-game.json"
    ).read_text()
)


@pytest.fixture
def store():
    return query_store("tracens", FakeClient())


@pytest.fixture
def body():
    payload = dict(EXAMPLE)
    payload["game_addition_request_id_and_secret"] = SECRET
    return GameImport.model_validate(payload)


def submit(store, body, secret=SECRET):
    return gt.record_submission(
        store, secret=secret, game_name=body.name, body_dict=body.model_dump()
    )


def add_row(store, submission_id, **fields):
    return gt.record_row(
        store,
        {"secret_hash": gt.secret_hash(SECRET), "submission_id": submission_id, **fields},
    )


def complete_run(store, body, submission_id):
    add_row(store, submission_id, kind="server_check", passed=True)
    for mode in (gt.MODE_PASS_AND_PLAY, gt.MODE_MULTIPLAYER):
        for count, resolution, orientation in gt.covering_configs(body):
            add_row(
                store,
                submission_id,
                kind="match_verified",
                mode=mode,
                num_players=count,
                resolution=resolution,
                orientation=orientation,
                moves=3,
            )
    for i in range(gt.STEP4_MIN_CONFIGS):
        for j in range(gt.STEP4_MIN_MOVES_PER_CONFIG):
            add_row(
                store,
                submission_id,
                kind="move",
                mode=gt.MODE_AGAINST_COMPUTERS,
                num_players=body.allowed_player_counts[0],
                resolution=gt.RESOLUTIONS[i % len(gt.RESOLUTIONS)]["label"],
                orientation=gt.ORIENTATIONS[i % 2],
                human_player_index=0,
                player_index=0,
                move_number=j,
                md5="0" * 32,
            )


def test_submission_roundtrip_and_latest(store, body):
    first = submit(store, body)
    loaded = gt.load_submission_body(store, {**first, "id": first["id"]})
    assert loaded == body.model_dump()
    second = submit(store, body)
    latest = gt.latest_submission(store, gt.secret_hash(SECRET))
    assert latest["id"] == second["id"]
    assert latest["inputs_hash"] == gt.inputs_hash(body.model_dump())
    # Another secret sees nothing.
    assert gt.latest_submission(store, gt.secret_hash("other-secret-012345")) is None


def test_move_md5_is_over_state_view_and_move():
    digest = gt.move_md5({"n": 1}, {"n": 1}, {"add": 1})
    assert len(digest) == 32
    assert digest != gt.move_md5({"n": 2}, {"n": 1}, {"add": 1})
    assert digest == gt.move_md5({"n": 1}, {"n": 1}, {"add": 1})


def test_evaluate_reports_each_missing_step(store, body):
    _, gaps = gt.evaluate(store, SECRET, body)
    assert any("no test run" in gap for gap in gaps)
    row = submit(store, body)
    steps, gaps = gt.evaluate(store, SECRET, body)
    assert steps["step1"]["done"] and not steps["step2"]["done"]
    assert any("step 2" in gap for gap in gaps)
    assert any("step 3" in gap for gap in gaps)
    assert any("step 4" in gap for gap in gaps)
    assert any("step 5" in gap for gap in gaps)
    complete_run(store, body, row["id"])
    steps, gaps = gt.evaluate(store, SECRET, body)
    assert gaps == []
    assert steps["complete"] is True
    assert steps["step3"]["verified"] == steps["step3"]["required"] == 5


def test_coverage_is_per_parameter_not_cross_product(store, body):
    # The counter game allows only 2 players, so the old cross product would
    # demand 10 matches; per-parameter coverage needs just 5 (one per
    # resolution; the orientations and the single count ride along).
    row = submit(store, body)
    add_row(store, row["id"], kind="server_check", passed=True)
    configs = gt.covering_configs(body)
    assert len(configs) == 5
    for count, resolution, orientation in configs[:-1]:
        add_row(
            store,
            row["id"],
            kind="match_verified",
            mode=gt.MODE_PASS_AND_PLAY,
            num_players=count,
            resolution=resolution,
            orientation=orientation,
            moves=3,
        )
    steps, gaps = gt.evaluate(store, SECRET, body)
    missing = steps["step3"]["missing"]
    assert missing == [f"a match at {configs[-1][1]}"]
    assert any("step 3" in gap and configs[-1][1] in gap for gap in gaps)
    count, resolution, orientation = configs[-1]
    add_row(
        store,
        row["id"],
        kind="match_verified",
        mode=gt.MODE_PASS_AND_PLAY,
        num_players=count,
        resolution=resolution,
        orientation=orientation,
        moves=3,
    )
    steps, _ = gt.evaluate(store, SECRET, body)
    assert steps["step3"]["done"]


def test_evaluate_rejects_changed_payload(store, body):
    submit(store, body)
    changed = body.model_copy(update={"name": "A different name"})
    _, gaps = gt.evaluate(store, SECRET, changed)
    assert len(gaps) == 1 and "does not match" in gaps[0]


def test_assert_complete_gate(store, body):
    class FakePlatform:
        _store = store

    with pytest.raises(InvalidRequestError):
        gt.assert_complete(FakePlatform(), body)
    row = submit(store, body)
    complete_run(store, body, row["id"])
    gt.assert_complete(FakePlatform(), body)  # no raise once complete


def test_assert_complete_skips_stores_without_traces(body):
    from game_platform.store import InMemoryStore

    class FakePlatform:
        _store = InMemoryStore()

    gt.assert_complete(FakePlatform(), body)  # dev stores skip the gate


PLAYERS = [
    {
        "id": "human-1",
        "kind": "human",
        "display_name": "Player 1",
        "picture_url": "",
        "max_loss": 0,
    }
]


def play_counter_match():
    states = [{"n": 0}, {"n": 1}, {"n": 2}, {"n": 3}]
    moves = [{"player_index": 0, "move": {"add": 1}} for _ in range(3)]
    return states, moves


def test_replay_match_accepts_the_counter_game(body):
    states, moves = play_counter_match()
    ok, failure = gt.replay_match(
        body, players=PLAYERS, pot=0, match_seed=7, states=states, moves=moves
    )
    assert ok, failure


def test_replay_match_catches_a_tampered_state(body):
    states, moves = play_counter_match()
    states[2] = {"n": 99}
    ok, failure = gt.replay_match(
        body, players=PLAYERS, pot=0, match_seed=7, states=states, moves=moves
    )
    assert not ok and failure["move_index"] == 1


def test_replay_match_requires_a_terminal_end(body):
    states, moves = play_counter_match()
    ok, failure = gt.replay_match(
        body,
        players=PLAYERS,
        pot=0,
        match_seed=7,
        states=states[:3],
        moves=moves[:2],
    )
    assert not ok and "not over" in failure["error"]


def test_replay_match_rejects_an_illegal_move(body):
    states, moves = play_counter_match()
    moves[1] = {"player_index": 0, "move": {"add": 2}}
    ok, failure = gt.replay_match(
        body, players=PLAYERS, pot=0, match_seed=7, states=states, moves=moves
    )
    assert not ok and failure["move_index"] == 1


def test_run_server_checks_records_walk_metadata(body):
    report = gt.run_server_checks(body)
    assert report["passed"], report["checks"]
    assert report["walks_completed"] > 0
    assert report["moves_made"] > 0
    assert report["states_visited"] >= 4  # n = 0..3
    assert report["terminal_states"] >= 1
    assert report["duration_ms"] >= 0
