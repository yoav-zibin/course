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


def test_inputs_hash_ignores_the_game_id_targeting_hint():
    base = {"name": "X", "game_addition_request_id_and_secret": SECRET}
    assert gt.inputs_hash(base) == gt.inputs_hash({**base, "game_id": "some-game"})
    assert gt.inputs_hash(base) == gt.inputs_hash({**base, "game_id": None})


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
    counts = list(body.allowed_player_counts)
    # Step 3: one verified match per allowed player count.
    for i, count in enumerate(counts):
        add_row(
            store,
            submission_id,
            kind="match_verified",
            mode=gt.MODE_PASS_AND_PLAY,
            num_players=count,
            resolution=gt.RESOLUTIONS[i % len(gt.RESOLUTIONS)]["label"],
            orientation=gt.ORIENTATIONS[i % 2],
            moves=3,
        )
    # Step 5: one verified match per allowed player count, at the
    # remaining resolutions, so the flow-wide screen coverage (judged
    # over the union of all three match steps) is complete.
    for i, resolution in enumerate(gt.RESOLUTIONS):
        add_row(
            store,
            submission_id,
            kind="match_verified",
            mode=gt.MODE_MULTIPLAYER,
            num_players=counts[i % len(counts)],
            resolution=resolution["label"],
            orientation=gt.ORIENTATIONS[i % 2],
            moves=3,
        )
    # Step 4: the required (player count, human seat) pairs.
    for count, seat in gt.step4_required_pairs(body):
        for j in range(gt.STEP4_MIN_MOVES_PER_CONFIG):
            add_row(
                store,
                submission_id,
                kind="move",
                mode=gt.MODE_AGAINST_COMPUTERS,
                num_players=count,
                resolution=gt.RESOLUTIONS[0]["label"],
                orientation=gt.ORIENTATIONS[0],
                human_player_index=seat,
                player_index=seat,
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
    assert steps["step3"]["verified"] == steps["step3"]["required"] == len(
        body.allowed_player_counts
    )


def test_step3_needs_one_match_per_player_count(store, body):
    # The counter game allows only 1 player: step 3 is done after ONE
    # verified pass-and-play match, at any single screen size — the
    # screen sizes are not step 3's axis any more.
    row = submit(store, body)
    add_row(store, row["id"], kind="server_check", passed=True)
    steps, _ = gt.evaluate(store, SECRET, body)
    assert steps["step3"]["missing"] == ["a match with 1 players"]
    add_row(
        store,
        row["id"],
        kind="match_verified",
        mode=gt.MODE_PASS_AND_PLAY,
        num_players=1,
        resolution=gt.RESOLUTIONS[0]["label"],
        orientation="vertical",
        moves=3,
    )
    steps, _ = gt.evaluate(store, SECRET, body)
    assert steps["step3"]["done"]


def test_display_coverage_is_judged_once_across_the_flow(store, body):
    # Screen sizes ride on whichever match step shows them: with step 3
    # and step 4 played at the first resolution only, step 5 is charged
    # with the sizes nobody has shown yet — and step 4's rows count.
    row = submit(store, body)
    add_row(store, row["id"], kind="server_check", passed=True)
    add_row(
        store,
        row["id"],
        kind="match_verified",
        mode=gt.MODE_PASS_AND_PLAY,
        num_players=1,
        resolution=gt.RESOLUTIONS[0]["label"],
        orientation="vertical",
        moves=3,
    )
    for count, seat in gt.step4_required_pairs(body):
        add_row(
            store,
            row["id"],
            kind="move",
            mode=gt.MODE_AGAINST_COMPUTERS,
            num_players=count,
            resolution=gt.RESOLUTIONS[1]["label"],
            orientation="horizontal",
            human_player_index=seat,
            player_index=seat,
            move_number=0,
            md5="0" * 32,
        )
    steps, gaps = gt.evaluate(store, SECRET, body)
    assert steps["step4"]["done"]
    assert steps["step5"]["missing_resolutions"] == [
        resolution["label"] for resolution in gt.RESOLUTIONS[2:]
    ]
    assert steps["step5"]["missing_orientations"] == []
    assert any("step 5" in gap and gt.RESOLUTIONS[2]["label"] in gap for gap in gaps)
    # One multiplayer match per remaining resolution completes the flow's
    # screen coverage (and the per-count requirement rides along).
    for resolution in gt.RESOLUTIONS[2:]:
        add_row(
            store,
            row["id"],
            kind="match_verified",
            mode=gt.MODE_MULTIPLAYER,
            num_players=1,
            resolution=resolution["label"],
            orientation="vertical",
            moves=3,
        )
    steps, _ = gt.evaluate(store, SECRET, body)
    assert steps["step5"]["done"]


def test_step4_requires_the_seat_pairs(store, body):
    # A 2–4 player variant: the pairs are the smallest count from its
    # first and last seat, plus the largest count from its last seat.
    # Playing only seat 0 does not finish step 4.
    variant = body.model_copy(update={"allowed_player_counts": [2, 4]})
    assert gt.step4_required_pairs(variant) == [(2, 0), (2, 1), (4, 3)]
    row = submit(store, variant)
    add_row(store, row["id"], kind="server_check", passed=True)
    add_row(
        store,
        row["id"],
        kind="move",
        mode=gt.MODE_AGAINST_COMPUTERS,
        num_players=2,
        resolution=gt.RESOLUTIONS[0]["label"],
        orientation="vertical",
        human_player_index=0,
        player_index=0,
        move_number=0,
        md5="0" * 32,
    )
    steps, gaps = gt.evaluate(store, SECRET, variant)
    assert not steps["step4"]["done"]
    assert steps["step4"]["missing"] == [
        "a match with 2 players played as seat 1",
        "a match with 4 players played as seat 3",
    ]
    assert any("step 4" in gap and "seat 1" in gap for gap in gaps)


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


MULTI_TURN_CODE = (
    "const game={newMatch(ctx){return {state:{n:0},turn:[ctx.players[0].id]};},"
    "applyMove(state,id,move,ctx){if(move.add!==1)throw new InvalidMove('Add one');"
    "const n=state.n+1;return n>=3?{state:{n},turn:null,payouts:{}}:"
    "{state:{n},turn:ctx.players.map(p=>p.id)};},"
    "viewFor(state,id,ctx){return {n:state.n};},"
    "computerMove(){return {add:1}},randomMove(){return {add:1}}};"
)

TWO_PLAYERS = PLAYERS + [
    {
        "id": "human-2",
        "kind": "human",
        "display_name": "Player 2",
        "picture_url": "",
        "max_loss": 0,
    }
]


def test_replay_match_strict_single_turn_rejects_a_multi_player_turn(body):
    # Pass-and-play verification is strict: every next turn must name
    # exactly one player (or be null, ending the match).
    multi = body.model_copy(update={"server_code": MULTI_TURN_CODE})
    states, moves = play_counter_match()
    ok, failure = gt.replay_match(
        multi,
        players=TWO_PLAYERS,
        pot=0,
        match_seed=7,
        states=states,
        moves=moves,
        strict_single_turn=True,
    )
    assert not ok and failure["move_index"] == 0
    assert "exactly one player" in failure["error"]


def test_replay_match_strict_single_turn_also_binds_a_capped_session(body):
    # Against-the-computer sessions may end at the move cap without a
    # terminal state (require_terminal=False), but the strict
    # single-player turn check still applies to every move.
    multi = body.model_copy(update={"server_code": MULTI_TURN_CODE})
    states, moves = play_counter_match()
    ok, failure = gt.replay_match(
        multi,
        players=TWO_PLAYERS,
        pot=0,
        match_seed=7,
        states=states[:3],
        moves=moves[:2],
        strict_single_turn=True,
        require_terminal=False,
    )
    assert not ok and failure["move_index"] == 0
    assert "exactly one player" in failure["error"]


def test_replay_match_capped_session_may_end_mid_match(body):
    states, moves = play_counter_match()
    ok, failure = gt.replay_match(
        body,
        players=PLAYERS,
        pot=0,
        match_seed=7,
        states=states[:3],
        moves=moves[:2],
        strict_single_turn=True,
        require_terminal=False,
    )
    assert ok, failure


def test_replay_match_without_strict_single_turn_allows_a_multi_player_turn(body):
    # Multiplayer verification (each seat on its own screen) keeps the
    # runtime's set-valued turns.
    multi = body.model_copy(update={"server_code": MULTI_TURN_CODE})
    states, moves = play_counter_match()
    ok, failure = gt.replay_match(
        multi, players=TWO_PLAYERS, pot=0, match_seed=7, states=states, moves=moves
    )
    assert ok, failure


def test_run_server_checks_records_walk_metadata(body):
    report = gt.run_server_checks(body)
    assert report["passed"], report["checks"]
    assert report["walks_completed"] > 0
    assert report["moves_made"] > 0
    assert report["states_visited"] >= 4  # n = 0..3
    assert report["terminal_states"] >= 1
    assert report["duration_ms"] >= 0
