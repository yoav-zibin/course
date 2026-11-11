"""Server-recorded traces for the /game-test flow.

The game-test page drives a linear, five-step test run (see
GAME_DEVELOPMENT_GUIDE.md §9). Every step reports back here, and the rows it
leaves in the `game_test_traces` collection are what POST /games checks
before it accepts a game:

- one `submission` row per step 1: the exact import payload the agent is
  testing (stored chunked, like game bodies), its canonical hash, the game
  name and the submission secret's hash — never the secret itself;
- one `server_check` row per step 2 run, with the run's metadata (duration,
  walks completed, moves made, distinct states visited, terminal states);
- one `move` row per move played in steps 3–5, holding the creation time,
  an md5 of the state, view and move, and the UI configuration played in;
- one `session` row per match played in steps 3–5, holding the match's
  full record — roster, seed, and every state and move — appended one
  move at a time as the match is played. Each appended move is verified
  on arrival (the server re-applies it to the previous recorded state
  and compares), so a match's evidence is durable from its first move:
  if the page dies mid-match, the recorded prefix survives and the page
  resumes the match from it when the inputs are loaded again;
- one `match_verified` row per match the server re-played and confirmed:
  pass-and-play and multiplayer matches played to the end (steps 3 and 5),
  and against-the-computer sessions (step 4), which may stop at the move
  cap. Verification of the two single-player modes is strict about the
  turn: every next turn must name exactly one player (or be null). A
  session writes this row when its terminal move is appended (or, for a
  capped step-4 session, when the session is closed); the whole-match
  verify endpoint remains for pages that still record that way.

At submission time the latest `submission` row for the secret must hash to
exactly the payload being submitted, and steps 2–5 must be complete for it:
any code change after step 1 therefore forces a fresh run.
"""

import datetime as dt
import hashlib
import json
import secrets as secrets_module
import subprocess
import sys
import time

TRACE_KIND = "game_test_traces"
CHUNK_CHARS = 180_000
MAX_MOVES_PER_MATCH = 1000

# The five play resolutions, mirroring RESOLUTIONS in static/game-test.js.
RESOLUTIONS = (
    {"label": "iPhone 16 Pro Max (phone)", "width": 430, "height": 932},
    {"label": "Samsung Galaxy S25 Ultra (phone)", "width": 412, "height": 915},
    {"label": "iPad Air 11-inch (tablet)", "width": 820, "height": 1180},
    {"label": "Samsung Galaxy Tab S10 (tablet)", "width": 800, "height": 1280},
    {"label": "MacBook Air 13-inch (laptop)", "width": 1440, "height": 900},
)
RESOLUTION_LABELS = frozenset(r["label"] for r in RESOLUTIONS)
ORIENTATIONS = ("vertical", "horizontal")
MODE_PASS_AND_PLAY = "pass_and_play"
MODE_AGAINST_COMPUTERS = "against_computers"
MODE_MULTIPLAYER = "multiplayer"
MODES = (MODE_PASS_AND_PLAY, MODE_AGAINST_COMPUTERS, MODE_MULTIPLAYER)
VERIFIED_MODES = (MODE_PASS_AND_PLAY, MODE_AGAINST_COMPUTERS, MODE_MULTIPLAYER)
# Step 4 evidence bar: every (player count, human seat) pair of
# step4_required_pairs(), each with at least one recorded move (a match
# can legitimately be shorter than any fixed move count — "Count to
# three" takes exactly 3 moves).
STEP4_MIN_MOVES_PER_CONFIG = 1

SERVER_CHECK_TIMEOUT_SECONDS = 90


# ---------------------------------------------------------------------------
# Hashing and canonical form
# ---------------------------------------------------------------------------


def canonical_json(value) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def secret_hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def inputs_hash(body_dict) -> str:
    # game_id is a submission-time targeting hint (which existing game a
    # master-password update applies to), never part of the game's
    # identity: it is excluded, so a payload hashes the same with and
    # without it — including payloads stored before the field existed.
    if isinstance(body_dict, dict) and "game_id" in body_dict:
        body_dict = {k: v for k, v in body_dict.items() if k != "game_id"}
    return hashlib.sha256(canonical_json(body_dict).encode("utf-8")).hexdigest()


def move_md5(state, view, move) -> str:
    return hashlib.md5(
        canonical_json([state, view, move]).encode("utf-8")
    ).hexdigest()


# ---------------------------------------------------------------------------
# Store access (QueryStore only; traces live in Firestore)
# ---------------------------------------------------------------------------


def traces_supported(store) -> bool:
    return all(
        hasattr(store, name)
        for name in ("raw_get", "raw_put", "_query", "atomic", "ref")
    )


def _now():
    return dt.datetime.now(dt.timezone.utc)


def _query_all(store, filters):
    rows = []
    after = None
    while True:
        docs = store._query(TRACE_KIND, filters, limit=100, after=after)
        rows.extend(doc.to_dict() for doc in docs)
        if len(docs) < 100:
            return rows
        after = docs[-1].id


def record_submission(store, *, secret, game_name, body_dict):
    """Step 1: store the exact import payload under test, chunked like a
    game body, and return the submission row."""
    submission_id = secrets_module.token_hex(16)
    ref = store.ref(TRACE_KIND, submission_id)
    text = canonical_json(body_dict)
    parts = [text[i : i + CHUNK_CHARS] for i in range(0, len(text), CHUNK_CHARS)]
    row = {
        "kind": "submission",
        "submission_id": submission_id,
        "secret_hash": secret_hash(secret),
        "game_name": game_name,
        "inputs_hash": inputs_hash(body_dict),
        "chunks": len(parts),
        "created_at": _now(),
        "created_ns": time.time_ns(),
    }
    with store.atomic():
        for i, part in enumerate(parts):
            store.raw_put(
                ref.collection("chunks").document(f"{i:06}"), {"text": part}
            )
        store.raw_put(ref, row)
    return {"id": submission_id, **row}


def load_submission_body(store, row):
    ref = store.ref(TRACE_KIND, row["id"])
    parts = []
    for i in range(row["chunks"]):
        chunk = store.raw_get(ref.collection("chunks").document(f"{i:06}"))
        if chunk is None:
            raise ValueError("submission body chunk is missing")
        parts.append(chunk["text"])
    return json.loads("".join(parts))


def submissions_with_ids(store, digest):
    """All step-1 rows for a secret hash, oldest first, each with its id."""
    found = []
    after = None
    while True:
        docs = store._query(
            TRACE_KIND,
            (("secret_hash", "==", digest), ("kind", "==", "submission")),
            limit=100,
            after=after,
        )
        for doc in docs:
            row = doc.to_dict()
            # The document id is the store's hashed ref key; the row's own
            # submission_id field is the identity every other row points at.
            row["id"] = row["submission_id"]
            found.append(row)
        if len(docs) < 100:
            break
        after = docs[-1].id
    found.sort(key=lambda r: (r.get("created_ns", 0), r["id"]))
    return found


def latest_submission(store, digest):
    rows = submissions_with_ids(store, digest)
    return rows[-1] if rows else None


def record_row(store, row):
    row = {"created_at": _now(), "created_ns": time.time_ns(), **row}
    store.raw_put(store.ref(TRACE_KIND, secrets_module.token_hex(16)), row)
    return row


def rows_for_submission(store, submission_id, *, kind=None):
    filters = [("submission_id", "==", submission_id)]
    if kind is not None:
        filters.append(("kind", "==", kind))
    return _query_all(store, tuple(filters))


# ---------------------------------------------------------------------------
# Step 2: the server-side checks, run in a killable subprocess
# ---------------------------------------------------------------------------


def run_server_checks(body):
    """The four server-side platform checks (localization is a client-text
    lint and runs at import). Returns the report dict recorded in step 2's
    trace row. Game bugs surface as failed checks, not exceptions."""
    from game_platform import game_checks
    from game_platform.game_testing import format_report, test_server_code

    spec = {"tests": body.unit_tests}
    rules = body.game_rules()
    started = time.monotonic()
    checks = {
        "approved_examples": game_checks.examples(
            body.client_code, body.server_code, spec, rules
        ),
        "settlement_probes": game_checks.settlement_probes(
            body.client_code, body.server_code, spec, rules
        ),
        "move_agreement": game_checks.move_agreement(
            body.client_code, body.server_code, spec, rules
        ),
    }
    report = test_server_code(
        body.server_code,
        game_schemas={
            "state": body.unit_tests["state_schema"],
            "move": body.unit_tests["move_schema"],
            "view": body.unit_tests["view_schema"],
        },
        rules=rules,
        contract=body.unit_tests,
        budget_seconds=24,
        max_walks=1000,
    )
    checks["random_walks"] = {
        "passed": report.passed,
        "details": format_report(report),
    }
    return {
        "passed": all(result["passed"] for result in checks.values()),
        "checks": checks,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "walks_completed": report.walks_completed,
        "moves_made": report.moves_made,
        "states_visited": report.states_visited,
        "terminal_states": report.terminal_states,
    }


def run_server_checks_subprocess(body):
    """run_server_checks in a subprocess, so a hanging game cannot hang the
    request (mirrors agent_import.verify_submission)."""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "game_platform.game_traces"],
            input=json.dumps({"body": body.model_dump()}),
            text=True,
            capture_output=True,
            timeout=SERVER_CHECK_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "passed": False,
            "error": f"server checks exceeded the {SERVER_CHECK_TIMEOUT_SECONDS} second limit",
        }
    if result.returncode:
        return {"passed": False, "error": "server checks could not run"}
    response = json.loads(result.stdout)
    if "error" in response:
        return {"passed": False, "error": response["error"]}
    return response["report"]


# ---------------------------------------------------------------------------
# Steps 3 and 5: replay a finished match against the step-1 server code
# ---------------------------------------------------------------------------


def _logic_for(body):
    from game_platform.game_contract import ContractLogic

    return ContractLogic(
        body.server_code,
        body.unit_tests,
        game_schemas=body.game_schemas(),
        game_id="game-test-verify",
    )


def _ctx_players(players):
    return [
        {
            key: player[key]
            for key in ("id", "kind", "display_name", "picture_url", "max_loss")
        }
        for player in players
    ]


def apply_step(logic, *, players, pot, match_seed, index, state, entry):
    """Apply one recorded move with the submission's server code, in the
    page's own ctx/seed scheme. Returns (result, None) or
    (None, failure-detail-dict). Shared by the whole-match replay and by
    the per-move session validation, so the two can never drift apart."""
    mover = players[entry["player_index"]]["id"]
    ctx = {
        "players": [dict(p) for p in _ctx_players(players)],
        "pot": pot,
        "move_count": index,
    }
    seed = (match_seed + index) % 2**32
    try:
        result = logic.call(
            "applyMove", state, mover, entry["move"], ctx=ctx, seed=seed
        )
    except Exception as exc:
        return None, {
            "move_index": index,
            "error": f"applyMove rejected or failed at move {index}: {exc}",
        }
    return result, None


def check_step_result(result, *, index, strict_single_turn):
    """The turn-shape rules for one applied move: with
    [strict_single_turn] (the single-player modes: pass-and-play and
    against the computer), the next turn must name exactly one player, or
    be null ending the match — a multi-player turn cannot be played on
    the single shared screen. Returns a failure dict or None."""
    turn = result.get("turn")
    if strict_single_turn and turn is not None and len(turn) != 1:
        return {
            "move_index": index,
            "error": f"the next turn after move {index} names {len(turn)} players; "
            "a single-player match must have exactly one player in the "
            "next turn, or no next turn when the match ends",
        }
    return None


def replay_match(body, *, players, pot, match_seed, states, moves, strict_single_turn=False, require_terminal=True):
    """Re-apply every recorded move with the submission's server code, in
    the page's own ctx/seed scheme, and compare each resulting state.
    Returns (True, None) or (False, failure-detail-dict).

    With [require_terminal] false (an against-the-computer session
    stopped at the move cap), the last move may leave a next turn."""
    logic = _logic_for(body)
    for i, entry in enumerate(moves):
        result, failure = apply_step(
            logic,
            players=players,
            pot=pot,
            match_seed=match_seed,
            index=i,
            state=states[i],
            entry=entry,
        )
        if failure is not None:
            return False, failure
        if canonical_json(result.get("state")) != canonical_json(states[i + 1]):
            return False, {
                "move_index": i,
                "error": f"the state after move {i} does not match the recorded match",
                "expected": states[i + 1],
                "actual": result.get("state"),
            }
        failure = check_step_result(
            result, index=i, strict_single_turn=strict_single_turn
        )
        if failure is not None:
            return False, failure
        turn = result.get("turn")
        if i < len(moves) - 1 and turn is None:
            return False, {
                "move_index": i,
                "error": f"the match ended at move {i}, before all recorded moves were played",
            }
        if require_terminal and i == len(moves) - 1 and turn is not None:
            return False, {
                "move_index": i,
                "error": "the match is not over: the final state still has a next turn",
            }
    return True, None


# ---------------------------------------------------------------------------
# Steps 3–5: incremental play sessions, one verified move at a time
# ---------------------------------------------------------------------------


class StepFailure(Exception):
    """One move failed server-side validation; carries the failure dict
    the endpoints return as the 422 detail."""

    def __init__(self, failure):
        super().__init__(failure.get("error", "step failed"))
        self.failure = failure


def _write_chunks(store, doc_ref, text):
    """Store [text] under [doc_ref]'s chunks subcollection, the layout
    submission bodies use; returns the chunk count."""
    parts = [
        text[i : i + CHUNK_CHARS] for i in range(0, len(text), CHUNK_CHARS)
    ] or [""]
    for i, part in enumerate(parts):
        store.raw_put(
            doc_ref.collection("chunks").document(f"{i:06}"), {"text": part}
        )
    return len(parts)


def _read_chunks(store, doc_ref, count):
    parts = []
    for i in range(count):
        chunk = store.raw_get(doc_ref.collection("chunks").document(f"{i:06}"))
        if chunk is None:
            raise ValueError("a stored chunk is missing")
        parts.append(chunk["text"])
    return "".join(parts)


def _session_ref(store, session_id):
    return store.ref(TRACE_KIND, session_id)


def get_session(store, session_id):
    row = store.raw_get(_session_ref(store, session_id))
    if row is None or row.get("kind") != "session":
        return None
    return row


def create_session(store, *, secret, submission_id, session_id, mode, config, players, pot, match_seed, initial_state, initial_turn):
    """Open a play session for a match about to be played: store its
    header and initial state. Any other open session for the submission
    is abandoned — the page plays one match at a time, and a fresh start
    supersedes the match it replaces (a reload instead resumes the open
    session, see open_session)."""
    ref = _session_ref(store, session_id)
    if store.raw_get(ref) is not None:
        raise ValueError("a session with this id already exists")
    for other in _query_all(
        store,
        (
            ("kind", "==", "session"),
            ("submission_id", "==", submission_id),
            ("status", "==", "open"),
        ),
    ):
        if other["session_id"] == session_id:
            continue
        stale = dict(other)
        stale["status"] = "abandoned"
        store.raw_put(_session_ref(store, other["session_id"]), stale)
    row = {
        "kind": "session",
        "session_id": session_id,
        "secret_hash": secret_hash(secret),
        "submission_id": submission_id,
        "mode": mode,
        "num_players": config["num_players"],
        "resolution": config["resolution"],
        "orientation": config["orientation"],
        "human_player_index": config.get("human_player_index"),
        "players": players,
        "pot": pot,
        "match_seed": match_seed,
        "initial_turn": initial_turn,
        "move_count": 0,
        "status": "open",
        "created_at": _now(),
        "created_ns": time.time_ns(),
        "updated_ns": time.time_ns(),
    }
    with store.atomic():
        row["initial_chunks"] = _write_chunks(
            store, ref, canonical_json(initial_state)
        )
        store.raw_put(ref, row)
    return row


def _entry_ref(store, session_id, index):
    return _session_ref(store, session_id).collection("entries").document(
        f"{index:06}"
    )


def _entry(store, session_id, index):
    return store.raw_get(_entry_ref(store, session_id, index))


def _state_before(store, row):
    """The session's current (last recorded) state."""
    if row["move_count"] == 0:
        return json.loads(
            _read_chunks(
                store, _session_ref(store, row["session_id"]), row["initial_chunks"]
            )
        )
    entry = _entry(store, row["session_id"], row["move_count"] - 1)
    return json.loads(
        _read_chunks(
            store, _entry_ref(store, row["session_id"], row["move_count"] - 1),
            entry["chunks"],
        )
    )


def record_verified_row(store, *, secret, submission_id, session_id, mode, num_players, resolution, orientation, moves):
    record_row(
        store,
        {
            "kind": "match_verified",
            "secret_hash": secret_hash(secret),
            "submission_id": submission_id,
            "session_id": session_id,
            "mode": mode,
            "num_players": num_players,
            "resolution": resolution,
            "orientation": orientation,
            "moves": moves,
        },
    )


def append_session_move(store, row, *, secret, body, player_index, move, view, state_after, turn_after):
    """Verify and record one move of an open session. The move is
    re-applied to the session's last recorded state with the submission's
    server code; only when the result matches the claimed next state is
    anything stored. Returns (session row, finished). Raises StepFailure
    with the replay-style failure dict when the move does not check out —
    the session is left exactly as it was, so play can resume from the
    last recorded move."""
    index = row["move_count"]
    if index >= MAX_MOVES_PER_MATCH:
        raise StepFailure(
            {"move_index": index, "error": "too many moves in one match"}
        )
    state_before = _state_before(store, row)
    result, failure = apply_step(
        _logic_for(body),
        players=row["players"],
        pot=row["pot"],
        match_seed=row["match_seed"],
        index=index,
        state=state_before,
        entry={"player_index": player_index, "move": move},
    )
    if failure is not None:
        raise StepFailure(failure)
    if canonical_json(result.get("state")) != canonical_json(state_after):
        raise StepFailure(
            {
                "move_index": index,
                "error": f"the state after move {index} does not match the recorded match",
                "expected": state_after,
                "actual": result.get("state"),
            }
        )
    failure = check_step_result(
        result,
        index=index,
        strict_single_turn=row["mode"]
        in (MODE_PASS_AND_PLAY, MODE_AGAINST_COMPUTERS),
    )
    if failure is not None:
        raise StepFailure(failure)
    turn = result.get("turn")
    if canonical_json(turn) != canonical_json(turn_after):
        raise StepFailure(
            {
                "move_index": index,
                "error": f"the turn after move {index} reported by the page "
                "does not match the server code's result",
            }
        )
    record_row(
        store,
        {
            "kind": "move",
            "secret_hash": secret_hash(secret),
            "submission_id": row["submission_id"],
            "session_id": row["session_id"],
            "mode": row["mode"],
            "num_players": row["num_players"],
            "resolution": row["resolution"],
            "orientation": row["orientation"],
            "human_player_index": row["human_player_index"],
            "player_index": player_index,
            "move_number": index,
            "md5": move_md5(state_before, view, move),
        },
    )
    finished = turn is None
    updated = dict(row)
    updated["move_count"] = index + 1
    updated["updated_ns"] = time.time_ns()
    if finished:
        updated["status"] = "finished"
    entry_ref = _entry_ref(store, row["session_id"], index)
    with store.atomic():
        chunks = _write_chunks(store, entry_ref, canonical_json(state_after))
        store.raw_put(
            entry_ref,
            {
                "player_index": player_index,
                "move": move,
                "turn_after": turn,
                "chunks": chunks,
            },
        )
        store.raw_put(_session_ref(store, row["session_id"]), updated)
    if finished:
        record_verified_row(
            store,
            secret=secret,
            submission_id=row["submission_id"],
            session_id=row["session_id"],
            mode=row["mode"],
            num_players=row["num_players"],
            resolution=row["resolution"],
            orientation=row["orientation"],
            moves=index + 1,
        )
    return updated, finished


def last_entry_matches(store, row, *, player_index, move, state_after):
    """True when the session's last recorded move is exactly this one —
    a retried append of a move that already landed (its response was
    lost on the wire) succeeds without recording it twice."""
    if row["move_count"] == 0:
        return False
    entry = _entry(store, row["session_id"], row["move_count"] - 1)
    if entry is None or entry["player_index"] != player_index:
        return False
    if canonical_json(entry["move"]) != canonical_json(move):
        return False
    recorded = json.loads(
        _read_chunks(
            store,
            _entry_ref(store, row["session_id"], row["move_count"] - 1),
            entry["chunks"],
        )
    )
    return canonical_json(recorded) == canonical_json(state_after)


def close_session(store, row, *, secret):
    """Finish a step-4 session that stopped at the move cap without a
    terminal move: its moves were each verified as they were appended,
    so closing only writes the verified row."""
    if row["mode"] != MODE_AGAINST_COMPUTERS:
        raise ValueError("only an against-the-computer session can be closed early")
    if row["move_count"] < 1:
        raise ValueError("the session has no recorded moves to verify")
    updated = dict(row)
    updated["status"] = "finished"
    updated["updated_ns"] = time.time_ns()
    store.raw_put(_session_ref(store, row["session_id"]), updated)
    record_verified_row(
        store,
        secret=secret,
        submission_id=row["submission_id"],
        session_id=row["session_id"],
        mode=row["mode"],
        num_players=row["num_players"],
        resolution=row["resolution"],
        orientation=row["orientation"],
        moves=row["move_count"],
    )
    return updated


def abandon_session(store, row):
    updated = dict(row)
    updated["status"] = "abandoned"
    updated["updated_ns"] = time.time_ns()
    store.raw_put(_session_ref(store, row["session_id"]), updated)
    return updated


def open_session(store, submission_id):
    """The submission's one open session (latest, if several somehow
    remain), or None."""
    rows = _query_all(
        store,
        (
            ("kind", "==", "session"),
            ("submission_id", "==", submission_id),
            ("status", "==", "open"),
        ),
    )
    if not rows:
        return None
    rows.sort(key=lambda r: (r.get("created_ns", 0), r["session_id"]))
    return rows[-1]


def session_payload(store, row):
    """Everything the page needs to resume an open session: its header,
    every recorded state (initial first), every move and every turn."""
    ref = _session_ref(store, row["session_id"])
    states = [json.loads(_read_chunks(store, ref, row["initial_chunks"]))]
    moves = []
    turns = [row.get("initial_turn")]
    for i in range(row["move_count"]):
        entry_ref = _entry_ref(store, row["session_id"], i)
        entry = store.raw_get(entry_ref)
        moves.append({"player_index": entry["player_index"], "move": entry["move"]})
        turns.append(entry["turn_after"])
        states.append(json.loads(_read_chunks(store, entry_ref, entry["chunks"])))
    return {
        "session_id": row["session_id"],
        "mode": row["mode"],
        "config": {
            "num_players": row["num_players"],
            "resolution": row["resolution"],
            "orientation": row["orientation"],
            "human_player_index": row["human_player_index"],
        },
        "players": row["players"],
        "pot": row["pot"],
        "match_seed": row["match_seed"],
        "move_count": row["move_count"],
        "states": states,
        "moves": moves,
        "turns": turns,
    }


# ---------------------------------------------------------------------------
# Evaluating a run: what is done, what is missing
# ---------------------------------------------------------------------------


def counts_missing(rows, body):
    """Allowed player counts no verified match in [rows] has covered yet.
    Steps 3 and 5 each owe one full match per allowed player count —
    counts are not cosmetic (hands, turn rotation and per-player state
    all change with the count), so this axis is never shared or cut."""
    counts = {row["num_players"] for row in rows}
    return [
        f"a match with {count} players"
        for count in body.allowed_player_counts
        if count not in counts
    ]


def display_missing(rows):
    """(missing strings, missing resolution labels, missing orientations)
    for the screen sizes and orientations no row in [rows] has covered.

    Screen coverage is judged ONCE across the whole flow — over the
    union of the step 3 and 5 verified matches and the step 4 move rows
    — not once per step: replay verification is size-blind (a transition
    verifies identically at every size), so each size only needs one
    recorded match somewhere in the run for a human to have seen the
    layout there. The gaps are charged to step 5, the last match step,
    whose list adds the matches covering whatever is still missing."""
    resolutions = {row["resolution"] for row in rows}
    missing_resolutions = [
        resolution["label"]
        for resolution in RESOLUTIONS
        if resolution["label"] not in resolutions
    ]
    orientations = {row["orientation"] for row in rows}
    missing_orientations = [o for o in ORIENTATIONS if o not in orientations]
    missing = [f"a match at {label}" for label in missing_resolutions]
    missing += [f"a match in {o} orientation" for o in missing_orientations]
    return missing, missing_resolutions, missing_orientations


def step4_required_pairs(body):
    """The (player count, human seat) pairs step 4 must record: the
    smallest player count played from its first and last seat, plus the
    largest count from its last seat when the game allows more than one
    count. The seat is the axis that matters (a roster that mis-seats
    the human stalls the match); computer moves are computed on the
    server, so screen size and orientation add nothing here — they
    still count toward the flow's shared screen coverage."""
    counts = sorted(body.allowed_player_counts)
    pairs = {(counts[0], 0), (counts[0], counts[0] - 1)}
    if len(counts) > 1:
        pairs.add((counts[-1], counts[-1] - 1))
    return sorted(pairs)


def evaluate(store, secret, body):
    """(steps, gaps) for the latest step-1 submission of [secret] against
    the import payload [body] (a GameImport)."""
    digest = secret_hash(secret)
    latest = latest_submission(store, digest)
    steps = {"step1": {"done": False}, "step2": {"done": False}}
    if latest is None:
        return steps, [
            "no test run was recorded for this secret — start at step 1 of the "
            "/game-test flow"
        ]
    steps["step1"] = {
        "done": True,
        "submission_id": latest["id"],
        "game_name": latest.get("game_name"),
        "created_at": _iso(latest.get("created_at")),
    }
    if latest.get("inputs_hash") != inputs_hash(body.model_dump()):
        return steps, [
            "the submitted payload does not match the last tested inputs — "
            "the code changed after step 1; restart the test flow at step 1"
        ]
    submission_id = latest["id"]
    checks = rows_for_submission(store, submission_id, kind="server_check")
    steps["step2"] = {"done": any(row.get("passed") for row in checks)}
    verified = rows_for_submission(store, submission_id, kind="match_verified")
    moves = rows_for_submission(store, submission_id, kind="move")
    gaps = []
    if not steps["step2"]["done"]:
        gaps.append("step 2 (server code tests) has not passed for the tested inputs")
    for step, label, mode in (
        ("step3", "step 3", MODE_PASS_AND_PLAY),
        ("step5", "step 5", MODE_MULTIPLAYER),
    ):
        rows = [row for row in verified if row["mode"] == mode]
        missing = counts_missing(rows, body)
        entry = {
            "done": not missing,
            "verified": len(rows),
            "required": len(body.allowed_player_counts),
            "missing": missing,
        }
        if step == "step5":
            # Screen sizes and orientations are covered once across the
            # whole flow (see display_missing); the gaps land here
            # because step 5 is the last match step.
            union = verified + [
                row for row in moves if row["mode"] == MODE_AGAINST_COMPUTERS
            ]
            d_missing, d_resolutions, d_orientations = display_missing(union)
            entry["missing"] = missing + d_missing
            entry["missing_resolutions"] = d_resolutions
            entry["missing_orientations"] = d_orientations
            entry["done"] = not entry["missing"]
            missing = entry["missing"]
        steps[step] = entry
        if missing:
            gaps.append(
                f"{label} ({mode.replace('_', ' ')}) is incomplete: missing "
                + "; ".join(missing)
            )
    pair_moves = {}
    for row in moves:
        if row["mode"] != MODE_AGAINST_COMPUTERS:
            continue
        pair = (row["num_players"], row.get("human_player_index"))
        pair_moves[pair] = pair_moves.get(pair, 0) + 1
    required_pairs = step4_required_pairs(body)
    played_pairs = [
        pair
        for pair in required_pairs
        if pair_moves.get(pair, 0) >= STEP4_MIN_MOVES_PER_CONFIG
    ]
    missing_pairs = [pair for pair in required_pairs if pair not in played_pairs]
    steps["step4"] = {
        "done": not missing_pairs,
        "configs": len(played_pairs),
        "required_configs": len(required_pairs),
        "missing": [
            f"a match with {count} players played as seat {seat}"
            for count, seat in missing_pairs
        ],
    }
    if missing_pairs:
        gaps.append(
            "step 4 (against the computer) is incomplete: missing "
            + "; ".join(steps["step4"]["missing"])
        )
    steps["complete"] = not gaps
    return steps, gaps


def assert_complete(platform, body):
    """The POST /games gate: raises InvalidRequestError listing what the
    test flow still owes. Stores without Firestore traces (local dev) skip
    the gate — production always runs the query store."""
    from game_platform.service import InvalidRequestError

    store = getattr(platform, "_store", None)
    if store is None or not traces_supported(store):
        return
    _, gaps = evaluate(store, body.game_addition_request_id_and_secret, body)
    if gaps:
        raise InvalidRequestError(
            "Game testing is incomplete: "
            + "; ".join(gaps)
            + ". Run the full test flow at /game-test with this game's "
            "game_addition_request_id_and_secret, then resubmit the identical payload."
        )


def _iso(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


# ---------------------------------------------------------------------------
# HTTP endpoints used by the test page
# ---------------------------------------------------------------------------


def make_router(platform_dependency):
    from fastapi import APIRouter, Depends, HTTPException
    from pydantic import BaseModel, Field

    from game_platform.agent_import import GameImport

    router = APIRouter()

    class ConfigIn(BaseModel):
        num_players: int = Field(ge=1, le=10)
        resolution: str
        orientation: str
        human_player_index: int | None = None

    class SubmissionIn(BaseModel):
        secret: str
        game_name: str = Field(min_length=1, max_length=200)
        body: dict

    class ServerCheckIn(BaseModel):
        secret: str
        submission_id: str

    class MoveIn(BaseModel):
        secret: str
        submission_id: str
        session_id: str = Field(min_length=1, max_length=100)
        mode: str
        config: ConfigIn
        player_index: int = Field(ge=0, le=9)
        move_number: int = Field(ge=0)
        state: object
        view: object
        move: object

    class PlayerIn(BaseModel):
        id: str
        kind: str = "human"
        display_name: str = ""
        picture_url: str = ""
        max_loss: int = 0

    class MoveEntryIn(BaseModel):
        player_index: int = Field(ge=0, le=9)
        move: object

    class VerifyMatchIn(BaseModel):
        secret: str
        submission_id: str
        session_id: str = Field(min_length=1, max_length=100)
        mode: str
        config: ConfigIn
        players: list[PlayerIn] = Field(min_length=1, max_length=10)
        pot: int = 0
        match_seed: int
        states: list
        moves: list[MoveEntryIn]

    def store_of(platform):
        store = getattr(platform, "_store", None)
        if store is None or not traces_supported(store):
            raise HTTPException(
                501, "game test traces require the Firestore query store"
            )
        return store

    def check_secret(secret):
        if not 16 <= len(secret) <= 200:
            raise HTTPException(
                422, "the secret must be 16 to 200 characters, like the import secret"
            )

    def check_config(config, body):
        if config.resolution not in RESOLUTION_LABELS:
            raise HTTPException(422, f"unknown resolution {config.resolution!r}")
        if config.orientation not in ORIENTATIONS:
            raise HTTPException(422, f"unknown orientation {config.orientation!r}")
        if config.num_players not in body.allowed_player_counts:
            raise HTTPException(
                422,
                f"the game does not allow {config.num_players} players",
            )

    def owned_submission(store, secret, submission_id):
        row = latest_submission(store, secret_hash(secret))
        if row is None or row["id"] != submission_id:
            raise HTTPException(
                404, "no step 1 submission with that id for this secret"
            )
        return row

    def stored_body(store, row):
        try:
            return GameImport.model_validate(load_submission_body(store, row))
        except Exception as exc:
            raise HTTPException(422, f"the stored step 1 inputs are invalid: {exc}")

    @router.post("/game-test/submissions", status_code=201)
    def submit_inputs(payload: SubmissionIn, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(payload.secret)
        try:
            body = GameImport.model_validate(payload.body)
        except Exception as exc:
            raise HTTPException(422, f"the submission payload is invalid: {exc}")
        if body.game_addition_request_id_and_secret != payload.secret:
            raise HTTPException(
                422,
                "the secret must equal the payload's game_addition_request_id_and_secret",
            )
        # The inputs are stored server-side from here on, so they must pass
        # the same verification as a final submission (translations,
        # artifacts and all the code checks) before anything is recorded.
        from game_platform.agent_import import verify_submission

        verify_submission(body)
        row = record_submission(
            store,
            secret=payload.secret,
            game_name=payload.game_name,
            body_dict=body.model_dump(),
        )
        return {
            "submission_id": row["id"],
            "inputs_hash": row["inputs_hash"],
            "created_at": _iso(row["created_at"]),
        }

    @router.get("/game-test/submission")
    def get_submission(secret: str, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(secret)
        row = latest_submission(store, secret_hash(secret))
        if row is None:
            raise HTTPException(
                404,
                "no inputs stored for this secret — store them first with "
                "POST /game-test/submissions",
            )
        return {
            "submission_id": row["id"],
            "game_name": row["game_name"],
            "created_at": _iso(row["created_at"]),
            "body": load_submission_body(store, row),
        }

    @router.post("/game-test/server-check")
    def server_check(payload: ServerCheckIn, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(payload.secret)
        row = owned_submission(store, payload.secret, payload.submission_id)
        body = stored_body(store, row)
        report = run_server_checks_subprocess(body)
        record = {
            "kind": "server_check",
            "secret_hash": secret_hash(payload.secret),
            "submission_id": payload.submission_id,
            "passed": bool(report.get("passed")),
            "duration_ms": report.get("duration_ms"),
            "walks_completed": report.get("walks_completed"),
            "moves_made": report.get("moves_made"),
            "states_visited": report.get("states_visited"),
            "terminal_states": report.get("terminal_states"),
            "checks": _compact_checks(report.get("checks")),
            "error": report.get("error"),
        }
        record_row(store, record)
        return report

    @router.post("/game-test/moves", status_code=201)
    def record_move(payload: MoveIn, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(payload.secret)
        if payload.mode not in MODES:
            raise HTTPException(422, f"unknown play mode {payload.mode!r}")
        row = owned_submission(store, payload.secret, payload.submission_id)
        check_config(payload.config, stored_body(store, row))
        digest = move_md5(payload.state, payload.view, payload.move)
        record_row(
            store,
            {
                "kind": "move",
                "secret_hash": secret_hash(payload.secret),
                "submission_id": payload.submission_id,
                "session_id": payload.session_id,
                "mode": payload.mode,
                "num_players": payload.config.num_players,
                "resolution": payload.config.resolution,
                "orientation": payload.config.orientation,
                "human_player_index": payload.config.human_player_index,
                "player_index": payload.player_index,
                "move_number": payload.move_number,
                "md5": digest,
            },
        )
        return {"md5": digest}

    @router.post("/game-test/verify-match")
    def verify_match(payload: VerifyMatchIn, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(payload.secret)
        if payload.mode not in VERIFIED_MODES:
            raise HTTPException(
                422,
                "match verification is for pass-and-play, against-the-computer "
                "and multiplayer matches",
            )
        if not payload.moves or len(payload.states) != len(payload.moves) + 1:
            raise HTTPException(
                422, "states must hold the initial state plus one per move"
            )
        if len(payload.moves) > MAX_MOVES_PER_MATCH:
            raise HTTPException(422, "too many moves in one match")
        row = owned_submission(store, payload.secret, payload.submission_id)
        body = stored_body(store, row)
        check_config(payload.config, body)
        if payload.config.num_players != len(payload.players):
            raise HTTPException(
                422, "the player roster does not match the configuration"
            )
        for entry in payload.moves:
            if entry.player_index >= len(payload.players):
                raise HTTPException(422, "a move names a player outside the roster")
        ok, failure = replay_match(
            body,
            players=[player.model_dump() for player in payload.players],
            pot=payload.pot,
            match_seed=payload.match_seed,
            states=payload.states,
            moves=[entry.model_dump() for entry in payload.moves],
            strict_single_turn=payload.mode
            in (MODE_PASS_AND_PLAY, MODE_AGAINST_COMPUTERS),
            require_terminal=payload.mode != MODE_AGAINST_COMPUTERS,
        )
        if not ok:
            raise HTTPException(422, failure)
        record_verified_row(
            store,
            secret=payload.secret,
            submission_id=payload.submission_id,
            session_id=payload.session_id,
            mode=payload.mode,
            num_players=payload.config.num_players,
            resolution=payload.config.resolution,
            orientation=payload.config.orientation,
            moves=len(payload.moves),
        )
        return {"verified": True, "moves_verified": len(payload.moves)}

    class SessionIn(BaseModel):
        secret: str
        submission_id: str
        session_id: str = Field(min_length=1, max_length=100)
        mode: str
        config: ConfigIn
        players: list[PlayerIn] = Field(min_length=1, max_length=10)
        pot: int = 0
        match_seed: int
        initial_state: object
        initial_turn: list[str] | None = None

    class SessionMoveIn(BaseModel):
        secret: str
        submission_id: str
        player_index: int = Field(ge=0, le=9)
        move: object
        view: object = None
        state_after: object
        turn_after: list[str] | None = None

    class SessionRefIn(BaseModel):
        secret: str
        submission_id: str

    def check_turn(turn, players, field):
        if turn is None:
            return
        ids = {player.id for player in players}
        if not isinstance(turn, list) or any(t not in ids for t in turn):
            raise HTTPException(
                422, f"{field} must be null or a list of roster player ids"
            )

    def owned_session(store, secret, submission_id, session_id):
        row = get_session(store, session_id)
        if (
            row is None
            or row["submission_id"] != submission_id
            or row["secret_hash"] != secret_hash(secret)
        ):
            raise HTTPException(404, "no session with that id for this submission")
        return row

    @router.post("/game-test/sessions", status_code=201)
    def start_session(payload: SessionIn, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(payload.secret)
        if payload.mode not in MODES:
            raise HTTPException(422, f"unknown play mode {payload.mode!r}")
        row = owned_submission(store, payload.secret, payload.submission_id)
        body = stored_body(store, row)
        check_config(payload.config, body)
        if payload.config.num_players != len(payload.players):
            raise HTTPException(
                422, "the player roster does not match the configuration"
            )
        check_turn(payload.initial_turn, payload.players, "initial_turn")
        try:
            session = create_session(
                store,
                secret=payload.secret,
                submission_id=payload.submission_id,
                session_id=payload.session_id,
                mode=payload.mode,
                config=payload.config.model_dump(),
                players=[player.model_dump() for player in payload.players],
                pot=payload.pot,
                match_seed=payload.match_seed,
                initial_state=payload.initial_state,
                initial_turn=payload.initial_turn,
            )
        except ValueError as exc:
            raise HTTPException(409, str(exc))
        return {"session_id": session["session_id"], "move_count": 0, "status": "open"}

    @router.post("/game-test/sessions/{session_id}/moves", status_code=201)
    def append_move(session_id: str, payload: SessionMoveIn, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(payload.secret)
        row = owned_session(store, payload.secret, payload.submission_id, session_id)
        if payload.player_index >= len(row["players"]):
            raise HTTPException(422, "the move names a player outside the roster")
        if row["status"] == "finished":
            return {
                "move_count": row["move_count"],
                "finished": True,
                "duplicate": True,
            }
        if row["status"] != "open":
            raise HTTPException(409, "the session is not open")
        if last_entry_matches(
            store,
            row,
            player_index=payload.player_index,
            move=payload.move,
            state_after=payload.state_after,
        ):
            return {
                "move_count": row["move_count"],
                "finished": False,
                "duplicate": True,
            }
        sub = owned_submission(store, payload.secret, payload.submission_id)
        body = stored_body(store, sub)
        try:
            updated, finished = append_session_move(
                store,
                row,
                secret=payload.secret,
                body=body,
                player_index=payload.player_index,
                move=payload.move,
                view=payload.view,
                state_after=payload.state_after,
                turn_after=payload.turn_after,
            )
        except StepFailure as exc:
            raise HTTPException(422, exc.failure)
        return {"move_count": updated["move_count"], "finished": finished}

    @router.post("/game-test/sessions/{session_id}/close")
    def close(session_id: str, payload: SessionRefIn, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(payload.secret)
        row = owned_session(store, payload.secret, payload.submission_id, session_id)
        if row["status"] == "finished":
            return {"finished": True, "moves_verified": row["move_count"]}
        if row["status"] != "open":
            raise HTTPException(409, "the session is not open")
        try:
            updated = close_session(store, row, secret=payload.secret)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        return {"finished": True, "moves_verified": updated["move_count"]}

    @router.post("/game-test/sessions/{session_id}/abandon")
    def abandon(session_id: str, payload: SessionRefIn, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(payload.secret)
        row = owned_session(store, payload.secret, payload.submission_id, session_id)
        if row["status"] == "open":
            abandon_session(store, row)
        return {"abandoned": True}

    @router.get("/game-test/open-session")
    def get_open_session(secret: str, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(secret)
        row = latest_submission(store, secret_hash(secret))
        if row is None:
            raise HTTPException(
                404, "no inputs stored for this secret — store them first"
            )
        session = open_session(store, row["id"])
        return {
            "submission_id": row["id"],
            "session": session_payload(store, session) if session else None,
        }

    @router.get("/game-test/status")
    def status(secret: str, platform=Depends(platform_dependency)):
        store = store_of(platform)
        check_secret(secret)
        row = latest_submission(store, secret_hash(secret))
        if row is None:
            return {"submission": None, "steps": {"step1": {"done": False}},
                    "gaps": ["no test run was recorded for this secret"],
                    "complete": False}
        body = stored_body(store, row)
        steps, gaps = evaluate(store, secret, body)
        return {
            "submission": {
                "id": row["id"],
                "game_name": row.get("game_name"),
                "created_at": _iso(row.get("created_at")),
            },
            "steps": steps,
            "gaps": gaps,
            "complete": not gaps,
        }

    return router


def _compact_checks(checks):
    if not checks:
        return None
    compact = {}
    for name, result in checks.items():
        details = result.get("details")
        text = details if isinstance(details, str) else canonical_json(details)
        compact[name] = {
            "passed": bool(result.get("passed")),
            "details": text[:4000],
        }
    return compact


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.read())
        from game_platform.agent_import import GameImport

        report = run_server_checks(GameImport.model_validate(request["body"]))
        print(json.dumps({"report": report}, default=str))
    except Exception:
        # Like agent_import's runner: never echo submitted code or internals.
        print(
            json.dumps(
                {
                    "error": "the server code or schemas could not be checked; "
                    "run the page's local checks for details"
                }
            )
        )
