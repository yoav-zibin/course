"""Publish the reviewed packages through the ordinary authoring and import APIs.

Runs real QuickJS rules and presentation events, then asks the server to replay
every trace. This is protocol/rules evidence; run the browser suite separately
for layout and gestures. It creates authoring traces and game records, never
production accounts or matches. Private submission secrets stay in a mode-0600
file outside the checkout. Re-running resumes the same publications.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_contract import ContractLogic
from game_platform.game_traces import RESOLUTIONS, canonical_json, step4_required_pairs
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


def offered_events(scene):
    """Every event a player can send from this scene, including rotate/flip tools."""
    pieces = [piece for piece in scene.get("pieces", []) if not piece.get("hidden")]
    events = [{"type": "drop", "id": p["id"], "piece_id": p["id"], "target_id": target}
              for p in pieces for target in p.get("move_targets", [])]
    events += [{"type": "tap", "id": item["id"]}
               for group in ("controls", "targets") for item in scene.get(group, [])
               if not item.get("disabled")]
    events += [{"type": "tap", "id": item["id"]} for item in pieces
               if "tap" in item.get("actions", [])]
    for piece in pieces:
        if "rotate" in piece.get("actions", []):
            events += [{"type": "rotate", "id": piece["id"], "delta": 90},
                       {"type": "rotate", "id": piece["id"], "delta": -90}]
        if "flip" in piece.get("actions", []):
            events.append({"type": "flip", "id": piece["id"]})
    return events


def _move_tokens(value):
    """Scalar values of a move, as the strings a reviewed package uses in IDs."""
    if isinstance(value, dict):
        return {token for item in value.values() for token in _move_tokens(item)}
    if isinstance(value, list):
        return {token for item in value for token in _move_tokens(item)}
    return {str(value).lower()}


def _dos_match_event(ui, message, frame, move):
    def tap(ident):
        nonlocal frame
        event = {"type": "tap", "id": ident}
        if event not in offered_events(frame["scene"]):
            raise ValueError(f"Dos did not offer {ident}")
        frame = ui.reduce({"type": "ui_event", "event": event,
                           "state_changed": message}, frame.get("local_state"))

    def page_to(key, index):
        target = index // 14
        prefix = "dos_hand" if key == "handPage" else "dos_center"
        while frame["local_state"][key] != target:
            direction = "next" if frame["local_state"][key] < target else "previous"
            tap(f"{prefix}_{direction}")

    for placement in move["placements"]:
        for ref in sorted(placement["cards"], key=lambda item: item["i"]):
            page_to("handPage", ref["i"])
            tap(f"dos_hand_{ref['i']}")
        page_to("centerPage", placement["pile"])
        tap(f"dos_pile_{placement['pile']}")
        edit = frame["local_state"]["dosEdit"]
        if edit:
            for index, ref in enumerate(edit["placement"]["cards"]):
                desired = next(item for item in placement["cards"] if item["i"] == ref["i"])
                for key in ("num", "color"):
                    if key in ref:
                        for _ in range(10):
                            if frame["local_state"]["dosEdit"]["placement"]["cards"][index][key] == desired[key]:
                                break
                            tap(f"dos_cycle_{key}_{index}")
                        else:
                            raise ValueError("Dos declaration was not reachable")
            for key, suffix in (("centerNum", "num"), ("centerColor", "color")):
                if key in edit["placement"]:
                    for _ in range(10):
                        if frame["local_state"]["dosEdit"]["placement"][key] == placement[key]:
                            break
                        tap(f"dos_cycle_center_{suffix}")
                    else:
                        raise ValueError("Dos center declaration was not reachable")
            tap("dos_add_match")
    if move.get("bonus"):
        tap("dos_bonus_mode")
        for ref in move["bonus"]:
            page_to("handPage", ref["i"])
            tap(f"dos_hand_{ref['i']}")
            index = len(frame["local_state"]["dosBonus"]) - 1
            for key in ("num", "color"):
                if key in ref:
                    for _ in range(10):
                        if frame["local_state"]["dosBonus"][index][key] == ref[key]:
                            break
                        tap(f"dos_cycle_bonus_{index}")
                    else:
                        raise ValueError("Dos bonus declaration was not reachable")
    for event in offered_events(frame["scene"]):
        result = ui.reduce({"type": "ui_event", "event": event,
                            "state_changed": message}, frame.get("local_state"))
        if canonical_json(result.get("make_move")) == canonical_json(move):
            return result
    raise ValueError(f"Dos did not offer the completed move {move!r}")


def scene_event(ui, message, frame, move, *, budget=4000, depth=8):
    """Find real offered UI actions producing the chosen authoritative move.

    Single taps/drops are tried first. Multi-step moves (select, rotate, flip,
    then place; or place, then choose a follow-up) are found by a bounded
    best-first search over distinct local states. Events whose IDs mention the
    move's values are tried first; the reducer must still emit the exact move.
    """
    if (isinstance(move, dict) and move.get("type") == "match" and
            any(event["id"].startswith("dos_hand_") for event in offered_events(frame["scene"]))):
        return _dos_match_event(ui, message, frame, move)
    likely_ids = set()
    if isinstance(move, dict):
        likely_ids.add("_".join(f"{key}_{value}" for key, value in move.items()))
    elif isinstance(move, str):
        likely_ids.add(move)
    if isinstance(move, dict) and isinstance(move.get("action"), str):
        likely_ids.add(move["action"])
    if isinstance(move, dict) and "to" in move:
        likely_ids.add(f"to_{move['to']}")
    tokens = _move_tokens(move)

    def relevance(event):
        ident = event.get("target_id", event["id"])
        parts = set(ident.lower().replace("-", "_").replace(":", "_").replace(".", "_").split("_"))
        return (ident not in likely_ids, -len(parts & tokens), event["type"] in ("rotate", "flip"))

    target = canonical_json(move)
    seen = {canonical_json(frame.get("local_state"))}
    frontier = [(0, (), frame)]
    calls = 0
    while frontier:
        frontier.sort(key=lambda item: item[0])
        _, path, current = frontier.pop(0)
        events = sorted(offered_events(current["scene"]), key=relevance)
        for event in events:
            if calls >= budget:
                break
            calls += 1
            answer = ui.reduce({"type": "ui_event", "event": event,
                                "state_changed": message}, current.get("local_state"))
            emitted = answer.get("make_move")
            if canonical_json(emitted) == target:
                return answer
            key = canonical_json(answer.get("local_state"))
            if emitted is None and len(path) + 1 < depth and key not in seen:
                seen.add(key)
                # Shallow paths and events naming more of the move's values first.
                not_likely, minus_matches, _ = relevance(event)
                priority = (len(path) + 1) * 0.5 + not_likely + minus_matches
                frontier.append((priority, path + (event,), answer))
    raise ValueError(f"no offered UI action emits {move!r}")


def play_trace(body, *, seed, mode, human_seat=None, num_players=None):
    """Finish a match through offered JSON UI events and authoritative rules."""
    count = num_players if num_players is not None else min(body.allowed_player_counts)
    players = [{"id": f"authoring-seat-{i}", "kind": "human" if mode != "against_computers" or i == human_seat else "computer",
                "display_name": f"Seat {i + 1}", "picture_url": "", "max_loss": 0}
               for i in range(count)]
    ctx = {"players": players, "pot": 0, "move_count": 0}
    logic = ContractLogic(body.server_code, body.unit_tests, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    result = logic.call("newMatch", ctx=ctx, seed=seed)
    states, moves, observations = [result["state"]], [], []
    local = [None] * count
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


def publication_configurations(body):
    """Cover each declared roster and every human seat required for computer play."""
    counts = sorted(body.allowed_player_counts)
    configurations = (
        [("pass_and_play", count, None) for count in counts]
        + [("against_computers", count, seat)
           for count, seat in step4_required_pairs(body)]
        + [("multiplayer", count, None) for count in counts]
    )
    while len(configurations) < len(RESOLUTIONS):
        configurations.append(("multiplayer", counts[0], None))
    return configurations


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


class ExistingPublication(RuntimeError):
    def __init__(self, game_id):
        self.existing_game_id = game_id
        super().__init__("The submission secret already identifies a published game")


def request(base, path, data=None, *, method=None):
    raw = None if data is None else json.dumps(data, ensure_ascii=False).encode()
    for attempt in range(5):
        req = urllib.request.Request(base + path, data=raw, method=method,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=210) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            if exc.code == 409 and path == "/games/declarative":
                try:
                    response = json.loads(detail)
                    message = response.get("detail") if isinstance(response, dict) else None
                except ValueError:
                    message = None
                existing = re.fullmatch(
                    r"(?:This secret already belongs to a game|game already exists); "
                    r"use PATCH /games/([A-Za-z0-9_-]{1,100})", message,
                ) if isinstance(message, str) else None
                if existing:
                    raise ExistingPublication(existing.group(1)) from None
            # A concurrent catalog/translation write may reject the transaction
            # before commit. PATCH retries retain the same target and payload;
            # creation retries retain the same unique submission secret.
            publication = path == "/games/declarative" or method == "PATCH"
            retryable = exc.code == 429 or (exc.code == 409 and publication)
            if retryable and attempt < 4:
                time.sleep(min(15, int(exc.headers.get("Retry-After", "5"))))
                continue
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
        for i, (mode, count, seat) in enumerate(publication_configurations(body)):
            step_key = f"{i}:{mode}:{count}:{seat if seat is not None else 'all'}"
            if step_key in entry["steps"]:
                continue
            trace, observations = play_trace(body, seed=903 + i, mode=mode, human_seat=seat,
                                             num_players=count)
            config = {"num_players": len(trace["players"]), "resolution": RESOLUTIONS[i % len(RESOLUTIONS)]["label"],
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
            entry["steps"][step_key] = True
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
        # Creation and updates share the tested payload, but updates always
        # name the saved game explicitly and use the single PATCH endpoint.
        if entry.get("id"):
            game = request(base, f"/games/{urllib.parse.quote(entry['id'], safe='')}",
                           recorded.model_dump(exclude_none=True), method="PATCH")
        else:
            try:
                game = request(base, "/games/declarative", recorded.model_dump(exclude_none=True))
            except ExistingPublication as existing:
                # Creation may have committed before its response or local ID
                # was saved. Recover the secret-bound ID, then use PATCH.
                entry["id"] = existing.existing_game_id
                save_private(state_path, state)
                game = request(base, f"/games/{urllib.parse.quote(entry['id'], safe='')}",
                               recorded.model_dump(exclude_none=True), method="PATCH")
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
