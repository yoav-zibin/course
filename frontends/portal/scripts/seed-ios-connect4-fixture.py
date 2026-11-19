#!/usr/bin/env python3
"""Seed a public local Connect Four match before the isolated CI app's first launch."""

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import uuid
import xml.etree.ElementTree as ET
from xml.parsers.expat import ExpatError


ROOT = Path(__file__).resolve().parents[3]
PUBLIC_PACKAGE = ROOT / "tests/fixtures/declarative/connect4-native-package.json"
STORAGE_KEY = "buildplay.shared.v1.visitor"
MATCH_ID = "local-ci-connect4-alignment"
COLUMNS = [0, 6, 3, 4, 0, 6]
DERIVE_POSE = r"""
const vm = require('node:vm');
const fs = require('node:fs');
const game = JSON.parse(fs.readFileSync(0, 'utf8'));
const rules = vm.runInNewContext(game.server_code + '\n;game;', {InvalidMove: Error}, {timeout:1000});
const ctx = {players:[0,1].map(i=>({id:'local-player-'+i,kind:'human',active:true,
  display_name:'Player '+(i+1),picture_url:'',max_loss:0})),pot:0,move_count:0,
  random:()=>0.5,now:Date.parse('2026-01-01T00:00:00.000Z')};
let current = rules.newMatch(ctx);
const copy = value=>JSON.parse(JSON.stringify(value));
const view = ()=>copy(rules.viewFor(current.state,current.turn[0],ctx));
const initialState = view(), moves=[];
for(const column of [0,6,3,4,0,6]){
  const actor = ctx.players.findIndex(p=>p.id===current.turn?.[0]);
  if(actor<0)throw Error('Fixture ended before all six moves');
  current = rules.applyMove(current.state,ctx.players[actor].id,{column},ctx);
  ctx.move_count++;
  if(!current.turn || current.turn.length!==1)throw Error('Fixture must remain ongoing');
  moves.push({move_number:ctx.move_count,player_index:actor,new_state:view(),
    next_turn_player_indices:[ctx.players.findIndex(p=>p.id===current.turn[0])]});
}
const state=view(), turn=[ctx.players.findIndex(p=>p.id===current.turn[0])];
const ui = vm.runInNewContext(game.declarative_ui.ui_code+'\n;gameUI;', {}, {timeout:1000});
const message={type:'state_changed',state,view:state,status:'ongoing',move_count:6,
  last_move_player_index:1,players:ctx.players.map((p,i)=>({...p,player_index:i})),
  my_player_index:turn[0],acting_for_player_index:turn[0],turn_of_player_index:turn[0],
  turn_of_player_indices:turn,locale:'en',direction:'ltr',strings:game.declarative_ui.strings||{}};
process.stdout.write(JSON.stringify({logicState:current.state,state,initialState,moves,turn,
  scene:ui.reduce(message,{}).scene}));
"""


def safe_directory(path, root, create=False):
    """Reject symlinks in every component below the already-owned root."""
    path, root = Path(path), Path(root)
    if not path.is_relative_to(root):
        raise ValueError("Fixture path leaves the owned simulator")
    current = root
    for part in path.relative_to(root).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Fixture paths must not contain symbolic links")
        if not current.exists() and create:
            current.mkdir()
        if not current.is_dir():
            raise ValueError("Expected an existing simulator directory")
    return path


def find_container(home, simulator_id, bundle_id):
    identifier = str(uuid.UUID(simulator_id)).upper()
    devices = Path(home).resolve() / "Library/Developer/CoreSimulator/Devices"
    if devices.is_symlink():
        raise ValueError("Simulator device directory must not be a symbolic link")
    device = safe_directory(devices / identifier, devices)
    applications = safe_directory(device / "data/Containers/Data/Application", device)
    candidates = list(applications.iterdir())
    if len(candidates) > 256:
        raise ValueError("Unexpectedly large isolated simulator container inventory")
    found = []
    for candidate in candidates:
        if candidate.is_symlink() or not candidate.is_dir():
            continue
        metadata = candidate / ".com.apple.mobile_container_manager.metadata.plist"
        if metadata.is_symlink() or not metadata.is_file() or metadata.stat().st_size > 65_536:
            continue
        try:
            value = plistlib.loads(metadata.read_bytes())
        except (ValueError, plistlib.InvalidFileException, ExpatError):
            continue
        if isinstance(value, dict) and value.get("MCMMetadataIdentifier") == bundle_id:
            found.append(candidate)
    if len(found) != 1:
        raise ValueError("Expected exactly one matching installed app container")
    return device, found[0]


def require_fresh_container(container):
    for relative in ["Documents", "Library/Application Support"]:
        directory = container / relative
        if directory.exists() or directory.is_symlink():
            safe_directory(directory, container)
            if any(directory.iterdir()):
                raise ValueError("Refusing to replace existing app data; fixture needs an unlaunched app")


def svg_document(asset):
    uri = asset.get("uri", "")
    if not uri.startswith("data:image/svg+xml;base64,"):
        raise ValueError("Connect Four regression requires embedded SVG assets")
    return ET.fromstring(base64.b64decode(uri.split(",", 1)[1], validate=True))


def fixture_snapshot(package_path=PUBLIC_PACKAGE):
    source = Path(package_path).read_bytes()
    package = json.loads(source)
    game = package["game"]
    if (game.get("allowed_player_counts") != [2] or not game.get("supports_local_practice")
            or not isinstance(game.get("server_code"), str) or not game.get("game_schemas")):
        raise ValueError("Expected the exact public Connect Four local-practice package")
    try:
        output = subprocess.run(["node", "-e", DERIVE_POSE], input=json.dumps(game),
                                capture_output=True, text=True, timeout=10, check=True)
    except subprocess.CalledProcessError as error:
        raise ValueError(f"Public Connect Four rules could not derive the fixture: {error.stderr[:500]}") from error
    except subprocess.TimeoutExpired as error:
        raise ValueError("Public Connect Four fixture derivation exceeded ten seconds") from error
    if len(output.stdout) > 512_000:
        raise ValueError("Derived fixture exceeds its byte limit")
    pose = json.loads(output.stdout)
    spec = game["declarative_ui"]
    boards = {board["id"]: board for board in spec["boards"]}
    rack = boards["rack"]
    rack_svg = svg_document(spec["assets"][rack["background_asset"]])
    holes = {(rack["x"] + float(circle.attrib["cx"]), rack["y"] + float(circle.attrib["cy"]))
             for circle in rack_svg.iter() if circle.tag.rsplit("}", 1)[-1] == "circle"}
    discs = []
    for piece in pose["scene"]["pieces"]:
        if piece.get("board") != "main" or piece.get("type") not in ("p0", "p1"):
            continue
        kind = spec["piece_types"][piece["type"]]
        if kind.get("shape") != "image":
            raise ValueError("Regression must exercise SVG image discs, not plain circle shapes")
        disc_svg = svg_document(spec["assets"][kind["asset"]])
        if disc_svg.attrib.get("viewBox") != "0 0 48 48":
            raise ValueError("Expected the public disc SVG viewBox that exercises nested viewport placement")
        board = boards[piece["board"]]
        center = (board["x"] + piece["position"]["x"], board["y"] + piece["position"]["y"])
        if center not in holes:
            raise ValueError("Authored disc center no longer coincides with a rack hole")
        discs.append({"id": piece["id"], "asset": kind["asset"], "center": list(center),
                      "width": kind["width"], "height": kind["height"]})
    if len(discs) != len(COLUMNS):
        raise ValueError("Expected six placed SVG discs in the regression fixture")
    match = {
        "id": MATCH_ID, "game_id": game["id"], "game_version": game["version"],
        "owner_user_id": "visitor", "players": [
            {"player_index": i, "id": f"local-player-{i}", "kind": "human",
             "user_id": "visitor" if i == 0 else None, "active": True, "name": f"Player {i + 1}"}
            for i in range(2)
        ], "status": "ongoing", "end_reason": None, "state": pose["state"],
        "logicState": pose["logicState"], "turn_of_player_indices": pose["turn"],
        "move_count": len(COLUMNS), "last_move_player_index": 1,
        "created_at": "2026-01-01T00:00:00.000Z", "localMode": "pass", "practiceSeed": 420,
        "moves": pose["moves"], "initialState": pose["initialState"], "initialTurn": [0],
        "awaitingHandoff": False, "token_pot": 0, "bet_per_player": 0,
    }
    data = {"version": 1, "responses": {f'/games/{game["id"]}/versions/{game["version"]}': game},
            "queues": {}, "conflicts": {}, "local": {MATCH_ID: match}, "archives": [],
            "archivedMatches": [], "selectedId": MATCH_ID}
    proof = {"source": package["source"], "source_sha256": hashlib.sha256(source).hexdigest(),
             "storage_key": STORAGE_KEY, "match_id": MATCH_ID, "move_count": len(COLUMNS),
             "columns": COLUMNS, "placed_svg_discs": discs, "network": "disabled-by-local-ui-test-launch"}
    return data, proof


def seed_fixture(simulator_id, bundle_id, proof_path, *, local_only=False,
                 home=None, environment=None, package_path=PUBLIC_PACKAGE):
    environment = os.environ if environment is None else environment
    if (not local_only or environment.get("GITHUB_ACTIONS") != "true"
            or environment.get("RUNNER_OS") != "macOS"):
        raise ValueError("Fixture is restricted to an explicit local-only GitHub macOS simulator launch")
    if not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", bundle_id):
        raise ValueError("Expected a resolved application bundle identifier")
    device, container = find_container(Path.home() if home is None else home, simulator_id, bundle_id)
    require_fresh_container(container)
    data, proof = fixture_snapshot(package_path)
    directory = safe_directory(container / "Library/Application Support/BuildPlayShared", container, create=True)
    filename = hashlib.sha256(STORAGE_KEY.encode()).hexdigest() + ".json"
    envelope = json.dumps({"key": STORAGE_KEY, "value": json.dumps(data, separators=(",", ":"))}, separators=(",", ":"))
    # Exclusive creation protects an earlier fixture or an unexpected saved game.
    with (directory / filename).open("x", encoding="utf-8") as output:
        output.write(envelope)
        output.flush()
        os.fsync(output.fileno())
    proof.update({"simulator_id": device.name, "bundle_identifier": bundle_id,
                  "storage_sha256": hashlib.sha256(envelope.encode()).hexdigest()})
    Path(proof_path).write_text(json.dumps(proof, indent=2) + "\n")
    return proof


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--local-only", action="store_true", required=True)
    parser.add_argument("simulator_id")
    parser.add_argument("bundle_id")
    parser.add_argument("proof", type=Path)
    arguments = parser.parse_args(argv)
    try:
        proof = seed_fixture(arguments.simulator_id, arguments.bundle_id, arguments.proof,
                             local_only=arguments.local_only)
    except (OSError, ValueError, KeyError, ET.ParseError, subprocess.SubprocessError) as error:
        print(f"Connect Four simulator fixture failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(proof, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
