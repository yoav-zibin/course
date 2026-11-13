"""Publish the reviewed packages through the ordinary authoring and import APIs.

Runs real QuickJS rules and presentation events, then asks the server to replay
every trace. This is protocol/rules evidence; run the browser suite separately
for layout and gestures. It creates authoring traces and game records, never
production accounts or matches. Private resubmission secrets stay in a mode-0600
file outside the checkout. Re-running resumes the same publications.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import ContractLogic
from game_platform.game_traces import RESOLUTIONS, canonical_json
from game_platform.tools.declarative_demo import DEMO_KINDS

PACKAGES = Path(__file__).resolve().parents[1] / "games" / "declarative"


def ui_message(logic, result, ctx, seat, seed):
    player_id = ctx["players"][seat]["id"]
    view = logic.call("viewFor", result["state"], player_id, ctx=ctx, seed=seed)
    return {
        "type": "state_changed", "state": view, "view": view,
        "status": "over" if result["turn"] is None else "ongoing",
        "move_count": ctx["move_count"], "my_player_index": seat,
        "acting_for_player_index": seat if player_id in (result["turn"] or []) else None,
        "turn_of_player_indices": None if result["turn"] is None else [
            next(i for i, p in enumerate(ctx["players"]) if p["id"] == pid)
            for pid in result["turn"]
        ],
        "players": [{"player_index": i, "player_id": p["id"],
                     "kind": p["kind"], "name": p["display_name"]}
                    for i, p in enumerate(ctx["players"])],
        "locale": "en", "direction": "ltr", "strings": {},
    }


def scene_event(ui, message, frame, move):
    """Find a real offered UI action producing the chosen authoritative move."""
    scene = frame["scene"]
    events = [{"type": "drop", "id": p["id"], "piece_id": p["id"], "target_id": target}
               for p in scene.get("pieces", []) for target in p.get("move_targets", [])]
    events += [{"type": "tap", "id": item["id"]}
               for group in ("controls", "targets") for item in scene.get(group, [])
               if not item.get("disabled")]
    events += [{"type": "tap", "id": item["id"]} for item in scene.get("pieces", [])
               if "tap" in item.get("actions", [])]
    # Reviewed packages name targets after their JSON intent. Try likely IDs
    # first on large boards; the reducer must still emit an exact matching move.
    likely_ids = {"_".join(f"{key}_{value}" for key, value in move.items())}
    if isinstance(move.get("action"), str):
        likely_ids.add(move["action"])
    if "to" in move:
        likely_ids.add(f"to_{move['to']}")
    events.sort(key=lambda event: event.get("target_id", event["id"]) not in likely_ids)
    for event in events:
        answer = ui.reduce({"type": "ui_event", "event": event,
                            "state_changed": message}, frame.get("local_state"))
        if canonical_json(answer.get("make_move")) == canonical_json(move):
            return answer
    raise ValueError(f"no offered UI action emits {move!r}")


def play_trace(body, *, seed, mode, human_seat=None):
    """Finish a match through offered JSON UI events and authoritative rules."""
    players = [{"id": f"authoring-seat-{i}", "kind": "human" if mode != "against_computers" or i == human_seat else "computer",
                "display_name": f"Seat {i + 1}", "picture_url": "", "max_loss": 0}
               for i in range(2)]
    ctx = {"players": players, "pot": 0, "move_count": 0}
    logic = ContractLogic(body.server_code, body.unit_tests, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    result = logic.call("newMatch", ctx=ctx, seed=seed)
    states, moves, observations = [result["state"]], [], []
    local = [None, None]
    for index in range(1000):
        if result["turn"] is None:
            return {"players": players, "pot": 0, "match_seed": seed,
                    "states": states, "moves": moves}, observations
        ctx["move_count"] = index
        seat = next(i for i, p in enumerate(players) if p["id"] == result["turn"][0])
        message = ui_message(logic, result, ctx, seat, seed + index)
        frame = ui.reduce(message, local[seat])
        move = logic.call("computerMove", result["state"], players[seat]["id"], ctx=ctx, seed=seed + index)
        emitted = scene_event(ui, message, frame, move)
        local[seat] = emitted.get("local_state")
        observations.append({"state": result["state"], "view": message["view"], "move": move,
                             "move_number": index, "player_index": seat})
        result = logic.call("applyMove", result["state"], players[seat]["id"], emitted["make_move"], ctx=ctx, seed=(seed + index) % 2**32)
        moves.append({"player_index": seat, "move": move})
        states.append(result["state"])
    raise ValueError("match did not end within 1000 moves")


def save_private(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(8)}.tmp")
    try:
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def request(base, path, data=None):
    raw = None if data is None else json.dumps(data, ensure_ascii=False).encode()
    for attempt in range(5):
        req = urllib.request.Request(base + path, data=raw, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=210) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if exc.code == 429 and attempt < 4:
                time.sleep(min(15, int(exc.headers.get("Retry-After", "5"))))
                continue
            detail = exc.read().decode(errors="replace")
            private_keys = {"secret", "game_addition_request_id_and_secret"}
            parts = urllib.parse.urlsplit(path)
            query = urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
            private_values = [value for key, value in query if key in private_keys]
            private_values += [data[key] for key in private_keys if data and data.get(key)]
            safe_path = urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode([
                (key, "[private secret]" if key in private_keys else value) for key, value in query
            ])))
            for value in private_values:
                detail = detail.replace(value, "[private secret]")
            raise RuntimeError(f"{safe_path}: HTTP {exc.code}: {detail[:5000]}") from None


def publication_evidence(kind, body, entry, game):
    return {"kind": kind, "id": game["id"], "name": game["name"], "version": game["version"],
            "renderer_type": game["renderer_type"], "authoring_complete": True,
            "server_code_sha256": hashlib.sha256(body.server_code.encode()).hexdigest(),
            "verified_sessions": entry["sessions"]}


def publish(base, state_path, kinds):
    state = json.loads(state_path.read_text()) if state_path.exists() else {"base_url": base, "games": {}}
    if state["base_url"] != base:
        raise ValueError("use a different private state file for each target server")
    evidence = []
    configurations = [("pass_and_play", None), ("multiplayer", None),
                      ("against_computers", 0), ("against_computers", 1), ("multiplayer", None)]
    for kind in kinds:
        entry = state["games"].setdefault(kind, {"secret": secrets.token_urlsafe(32)})
        package = json.loads((PACKAGES / f"{kind}.json").read_text())
        package["game_addition_request_id_and_secret"] = entry["secret"]
        body = GameImport.model_validate(package)
        source_hash = hashlib.sha256(canonical_json(body.model_dump()).encode()).hexdigest()
        if entry.get("source_hash") != source_hash:
            entry.update(source_hash=source_hash, steps={}, sessions=[])
        save_private(state_path, state)
        if entry.get("id") and entry.get("published_source_hash") == source_hash:
            current = request(base, f"/games/{urllib.parse.quote(entry['id'], safe='')}")
            actual_hash = hashlib.sha256(canonical_json(current).encode()).hexdigest()
            if actual_hash == entry.get("published_game_hash"):
                evidence.append(publication_evidence(kind, body, entry, current))
                print(f"Already current {kind}: {current['id']} v{current['version']}", flush=True)
                continue
        common = {"secret": entry["secret"]}
        if not entry.get("submission_id") or not entry["steps"].get("submitted"):
            submitted = request(base, "/game-test/submissions", {**common, "game_name": body.name, "body": package})
            entry["submission_id"] = submitted["submission_id"]
            entry["steps"]["submitted"] = True
            save_private(state_path, state)
        common["submission_id"] = entry["submission_id"]
        if not entry["steps"].get("server_check"):
            checked = request(base, "/game-test/server-check", common)
            if not checked.get("passed"):
                raise RuntimeError(f"{kind}: server checks failed: {checked}")
            entry["steps"]["server_check"] = True
            save_private(state_path, state)
        for i, (mode, seat) in enumerate(configurations):
            if str(i) in entry["steps"]:
                continue
            trace, observations = play_trace(body, seed=903 + i, mode=mode, human_seat=seat)
            config = {"num_players": 2, "resolution": RESOLUTIONS[i]["label"],
                      "orientation": "vertical" if i % 2 == 0 else "horizontal",
                      "human_player_index": seat}
            session = f"release-{kind}-{secrets.token_hex(8)}"
            record = {**common, "mode": mode, "config": config, "session_id": session}
            verified = request(base, "/game-test/verify-match", {**record, **trace})
            if not verified.get("verified"):
                raise RuntimeError(f"{kind}: trace replay failed")
            if mode == "against_computers":
                observation = next(row for row in observations if row["player_index"] == seat)
                request(base, "/game-test/moves", {**record, **observation})
            entry["steps"][str(i)] = True
            entry["sessions"].append({"mode": mode, "config": config, "moves_verified": len(trace["moves"])})
            save_private(state_path, state)
        status = request(base, "/game-test/status?" + urllib.parse.urlencode({"secret": entry["secret"]}))
        if not status.get("steps", {}).get("complete"):
            raise RuntimeError(f"{kind}: authoring gate incomplete: {status.get('gaps')}")
        # Freeze the exact tested host, even if a deployment changed the default
        # renderer asset version between step 1 and this final import. Known old
        # platform hosts remain valid; regenerating one would change the hash.
        tested = request(base, "/game-test/submission?" + urllib.parse.urlencode({"secret": entry["secret"]}))
        recorded = GameImport.model_validate(tested["body"])
        if tested["submission_id"] != entry["submission_id"] or (
            recorded.model_dump(exclude={"client_code"}) != body.model_dump(exclude={"client_code"})
        ):
            raise RuntimeError(f"{kind}: the latest tested package changed; restart its authoring flow")
        # Repeated imports with this private secret update the same game.
        game = request(base, "/games/declarative", recorded.model_dump())
        entry["id"] = game["id"]
        entry["version"] = game["version"]
        entry["published_source_hash"] = source_hash
        entry["published_game_hash"] = hashlib.sha256(canonical_json(game).encode()).hexdigest()
        save_private(state_path, state)
        evidence.append(publication_evidence(kind, body, entry, game))
        print(f"Published {kind}: {game['id']} v{game['version']}", flush=True)
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--state-file", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--kinds", nargs="+", choices=DEMO_KINDS, default=list(DEMO_KINDS))
    args = parser.parse_args()
    checkout = PACKAGES.parents[1]
    if args.state_file.resolve().is_relative_to(checkout):
        parser.error("private state file must be outside the checkout")
    if args.report.resolve() == args.state_file.resolve():
        parser.error("report and private state must use different files")
    evidence = publish(args.base_url.rstrip("/"), args.state_file, args.kinds)
    args.report.write_text(json.dumps({"base_url": args.base_url, "games": evidence}, indent=2) + "\n")


if __name__ == "__main__":
    main()
