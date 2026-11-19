#!/usr/bin/env python3
"""Manual iOS parity audit: reuse a trusted app; navigate and play through XCTest."""
import argparse
from collections import Counter
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import selectors
import subprocess
import sys
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "yoav-zibin/course"
FIXTURE = ROOT / "tests/fixtures/portal-parity/common.json"
SOURCE = "600e8e35ab3d7338055e4f28eaa3d165be4bdba2"
FIXTURE_SHA256 = "fbd617434c939ae69795cb635c06f68f111a5e6a8336851a55e36af928b93625"
BUNDLE = "edu.columbia.gameportal.starter"
KEY = "buildplay.shared.v1.visitor"
SCRIPTS = ROOT / "frontends/portal/scripts"


def helper(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_fixture(path=FIXTURE):
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != FIXTURE_SHA256:
        raise ValueError("Parity fixture changed; review and repin its checksum")
    value = json.loads(raw)
    if value.get("sourceSha") != SOURCE or value.get("viewport") != {"width": 402, "height": 874}:
        raise ValueError("Expected the reviewed 600 source and matched 402x874 viewport")
    if set(value.get("storage", {})) != {KEY} or json.loads(value["storage"][KEY]) != value["accountData"]:
        raise ValueError("Only the reviewed visitor snapshot may be seeded")
    data = value["accountData"]
    if data.get("selectedId") is not None or data.get("queues") or data.get("conflicts") or data.get("archives"):
        raise ValueError("Audit starts at Catalog without online queues or private archives")
    if {g["matchId"] for g in value["games"]} != set(data["local"]):
        raise ValueError("Unexpected local match in public parity fixture")
    for match in data["local"].values():
        if match.get("owner_user_id") != "visitor" or match.get("localMode") != "computer":
            raise ValueError("Only synthetic visitor computer-practice matches are allowed")
    return value


def validate_provenance(run, artifact, jobs, run_id):
    build = next((j for j in jobs["jobs"] if j["name"] == "BuildPlay iOS (simulator build)"), None)
    if (run.get("id") != run_id or run.get("head_sha") != SOURCE
            or run.get("repository", {}).get("full_name") != REPOSITORY
            or run.get("head_repository", {}).get("full_name") != REPOSITORY
            or run.get("head_branch") != "main" or run.get("event") != "push"
            or run.get("path") != ".github/workflows/portal-apps.yml"
            or not build or build.get("conclusion") != "success"
            or artifact.get("name") != "BuildPlay-ios-simulator" or artifact.get("expired")
            or artifact.get("workflow_run", {}).get("id") != run_id
            or artifact.get("workflow_run", {}).get("head_sha") != SOURCE
            or not re.fullmatch(r"sha256:[0-9a-f]{64}", artifact.get("digest", ""))):
        raise ValueError("Simulator artifact does not match the trusted successful 600 app build")


def provenance(run_id, output):
    load_fixture()
    def read(path):
        return json.loads(subprocess.check_output(["gh", "api", path], text=True, timeout=60))
    run = read(f"repos/{REPOSITORY}/actions/runs/{run_id}")
    jobs = read(f"repos/{REPOSITORY}/actions/runs/{run_id}/jobs?per_page=100")
    artifacts = read(f"repos/{REPOSITORY}/actions/runs/{run_id}/artifacts?per_page=100")
    matches = [a for a in artifacts["artifacts"] if a["name"] == "BuildPlay-ios-simulator" and not a["expired"]]
    if len(matches) != 1:
        raise ValueError("Expected one unexpired simulator artifact")
    validate_provenance(run, matches[0], jobs, run_id)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"run": run, "artifact": matches[0], "jobs": jobs,
                                  "fixtureSha256": FIXTURE_SHA256}, indent=2) + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as sink:
            sink.write(f'artifact_id={matches[0]["id"]}\n')


def seed(simulator_id, output, *, home=None, environment=None):
    environment = os.environ if environment is None else environment
    if environment.get("GITHUB_ACTIONS") != "true" or environment.get("RUNNER_OS") != "macOS":
        raise ValueError("Seeding is restricted to the fresh GitHub macOS audit simulator")
    fixture = load_fixture()
    owned = json.loads((output / "owned-simulator.json").read_text())
    if owned != {"udid": simulator_id, "createdBy": "portal-parity-ios", "sourceSha": SOURCE}:
        raise ValueError("Simulator ownership proof does not match this audit")
    store = helper("seed-ios-connect4-fixture")
    device, container = store.find_container(Path.home() if home is None else home, simulator_id, BUNDLE)
    store.require_fresh_container(container)
    directory = store.safe_directory(container / "Library/Application Support/BuildPlayShared", container, create=True)
    for key, value in fixture["storage"].items():
        filename = directory / (hashlib.sha256(key.encode()).hexdigest() + ".json")
        with filename.open("x") as sink:
            json.dump({"key": key, "value": value}, sink)
            sink.flush()
            os.fsync(sink.fileno())
    (output / "seed-proof.json").write_text(json.dumps({"sourceSha": SOURCE, "fixtureSha256": FIXTURE_SHA256,
        "simulator": device.name, "bundleId": BUNDLE, "storageKeys": list(fixture["storage"]),
        "initialMatchIds": list(fixture["accountData"]["local"]), "credentialsSeeded": False}, indent=2) + "\n")
    return container


def read_data(container):
    path = container / "Library/Application Support/BuildPlayShared" / (hashlib.sha256(KEY.encode()).hexdigest() + ".json")
    envelope = json.loads(path.read_text())
    if envelope.get("key") != KEY:
        raise ValueError("Unexpected saved account envelope")
    return json.loads(envelope["value"])


def clean_match(match):
    return {key: value for key, value in match.items() if key not in ("pending", "conflict")}


def match_difference(actual, expected):
    actual, expected = clean_match(actual), clean_match(expected)
    absent = object()
    return [key for key in sorted(set(actual) | set(expected)) if actual.get(key, absent) != expected.get(key, absent)]


def flat_nodes(tree):
    if isinstance(tree, dict):
        yield tree
        for child in tree.get("children", []):
            yield from flat_nodes(child)


def bounds(node):
    text = node.get("attributes", {}).get("bounds", "")
    numbers = re.findall(r"-?\d+(?:\.\d+)?", text)
    if len(numbers) != 4:
        return None
    x, y, right, bottom = map(float, numbers)
    return {"x": x, "y": y, "width": right - x, "height": bottom - y}


def node_label(node):
    attributes = node.get("attributes", {})
    return attributes.get("accessibilityText") or attributes.get("text") or attributes.get("title") or ""


def expected_labels(scene):
    names = []
    for piece in scene.get("pieces", []):
        if not piece.get("hidden"):
            names.append(piece.get("aria_label") or piece.get("text") or piece["id"])
    names.extend(t.get("aria_label") or t.get("label") or f'Destination {t["id"]}' for t in scene.get("targets", []))
    return Counter(names)


def render_signature(tree, scene):
    desired = expected_labels(scene)
    actual, geometry = Counter(), []
    for node in flat_nodes(tree):
        label = node_label(node)
        base = next((name for name in desired if label == name or label.startswith(name + ":")), None)
        if base:
            actual[base] += 1
            geometry.append({"label": label, "bounds": bounds(node)})
    if any(actual[name] < count for name, count in desired.items()):
        return None
    return sorted(geometry, key=lambda item: json.dumps(item, sort_keys=True))


def flow_text(commands):
    # JSON command arrays are valid YAML; this avoids shell/YAML interpolation.
    return f"appId: {BUNDLE}\n---\n" + json.dumps(commands, indent=2) + "\n"


def parse_json_output(text):
    for match in re.finditer(r"\{", text):
        try:
            value, _ = json.JSONDecoder().raw_decode(text[match.start():])
            if isinstance(value, dict) and any(key in value for key in ("attributes", "children", "devices")):
                return value
        except ValueError:
            pass
    raise ValueError("Expected device or accessibility JSON in the driver's output")


def outside_viewport(geometry, width=402, height=874):
    return [item for item in geometry if item.get("bounds") and (
        item["bounds"]["x"] < -2 or item["bounds"]["y"] < 0
        or item["bounds"]["x"] + item["bounds"]["width"] > width + 2
        or item["bounds"]["y"] + item["bounds"]["height"] > height - 24)]


def selector(text):
    return {"text": "^" + re.escape(text) + "$"}


def expand_compact_hierarchy(value):
    schema = value.get("ui_schema", {})
    abbreviations = schema.get("abbreviations", {})
    if schema.get("platform") != "ios" or not isinstance(value.get("elements"), list):
        raise ValueError("Expected the pinned Maestro iOS compact accessibility schema")
    def expand(node):
        return {"attributes": {abbreviations.get(key, key): item for key, item in node.items() if key != "c"},
                "children": [expand(child) for child in node.get("c", [])]}
    return {"attributes": {}, "children": [expand(node) for node in value["elements"]]}


class MaestroMcp:
    """One supported Maestro session; no per-test random-port cold starts."""
    def __init__(self, executable, output):
        self.output = output
        self.sequence = 0
        self.pending = bytearray()
        self.stderr = (output / "maestro-mcp-stderr.log").open("wb")
        self.process = subprocess.Popen([str(executable), "mcp", "--no-viewer", "--working-dir", str(output)],
                                        cwd=output, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=self.stderr, start_new_session=True, bufsize=0)
        os.set_blocking(self.process.stdout.fileno(), False)
        try:
            self.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                         "clientInfo": {"name": "buildplay-runtime-parity", "version": "1"}}, 90)
            self.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except Exception:
            self.close()
            raise

    def send(self, value):
        self.process.stdin.write((json.dumps(value) + "\n").encode())
        self.process.stdin.flush()

    def request(self, method, params, timeout):
        self.sequence += 1
        request_id = self.sequence
        request = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        started = time.monotonic()
        self.send(request)
        with (self.output / "maestro-mcp-protocol.jsonl").open("a") as trace, selectors.DefaultSelector() as watcher:
            trace.write(json.dumps({"direction": "request", "message": request}) + "\n"); trace.flush()
            watcher.register(self.process.stdout, selectors.EVENT_READ)
            while True:
                while b"\n" in self.pending:
                    line, _, rest = self.pending.partition(b"\n")
                    self.pending = bytearray(rest)
                    try:
                        response = json.loads(line)
                    except ValueError:
                        continue
                    trace.write(json.dumps({"direction": "response", "message": response}) + "\n"); trace.flush()
                    if response.get("id") == request_id:
                        if "error" in response:
                            raise RuntimeError(f"Maestro MCP protocol error: {response['error']}")
                        return response["result"]
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise TimeoutError(f"Maestro MCP {method} exceeded {timeout}s; protocol/bootstrap logs preserved")
                if not watcher.select(min(1, remaining)):
                    if self.process.poll() is not None:
                        raise RuntimeError("Maestro MCP exited; bootstrap stderr preserved")
                    continue
                raw = os.read(self.process.stdout.fileno(), 65536)
                if not raw:
                    raise RuntimeError("Maestro MCP closed stdout; bootstrap stderr preserved")
                self.pending.extend(raw)
                if len(self.pending) > 8_000_000:
                    raise RuntimeError("Maestro MCP response exceeds the bounded audit capture")

    def tool(self, name, arguments, timeout):
        result = self.request("tools/call", {"name": name, "arguments": arguments}, timeout)
        content = "\n".join(block.get("text", "") for block in result.get("content", []) if block.get("type") == "text")
        if result.get("isError"):
            raise RuntimeError(f"Maestro {name}: {content}")
        return json.loads(content)

    def close(self):
        try:
            self.process.stdin.close()
        except OSError:
            pass
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            helper("run-ios-smoke-phase").stop_process_group(self.process)
        self.process.stdout.close()
        self.stderr.close()


def preserve_driver_logs(output, started, *, home=None, device=None, max_bytes=512_000):
    """Keep only fresh tool/crash logs, including otherwise hidden Maestro files."""
    home = Path.home() if home is None else Path(home)
    output = Path(output)
    destination = output / "driver-diagnostics"
    destination.mkdir(exist_ok=True)
    roots = [(output / "maestro-debug", "tool"), (output / "maestro-state", "tool"),
             (home / ".maestro/tests", "tool"), (home / "Library/Logs/DiagnosticReports", "crash")]
    if device:
        roots.append((home / "Library/Developer/CoreSimulator/Devices" / device / "data/Library/Logs/CrashReporter", "crash"))
    records = []
    for root, kind in roots:
        if not root.is_dir() or root.is_symlink():
            continue
        for path in root.rglob("*"):
            if len(records) >= 40:
                break
            try:
                if path.is_symlink() or not path.is_file() or path.stat().st_mtime < started:
                    continue
                if kind == "tool":
                    eligible = path.name == "maestro.log" or re.fullmatch(r"xctest_runner_.*\.log", path.name)
                else:
                    eligible = path.suffix in (".ips", ".crash") and re.search(r"maestro|xctest|testmanager|BuildPlay", path.name, re.I)
                if not eligible or not path.resolve().is_relative_to(root.resolve()):
                    continue
                size = path.stat().st_size
                with path.open("rb") as source:
                    source.seek(max(0, size - max_bytes))
                    raw = source.read(max_bytes)
                target = destination / f"{len(records):02d}-{path.name}"
                target.write_bytes(raw)
                records.append({"source": str(path), "copy": target.name, "originalBytes": size,
                                "retainedBytes": len(raw), "tailOnly": size > max_bytes,
                                "sha256": hashlib.sha256(raw).hexdigest()})
            except OSError as error:
                records.append({"source": str(path), "error": type(error).__name__})
    (destination / "log-sources.json").write_text(json.dumps(records, indent=2) + "\n")


class Audit:
    def __init__(self, output, maestro):
        self.output, self.maestro = output.resolve(), str(maestro)
        self.phase = helper("run-ios-smoke-phase")
        self.fixture = load_fixture()
        self.device = None
        self.container = None
        self.first = True
        self.mcp = None
        self.started = time.time()
        self.report = {"sourceSha": SOURCE, "fixtureSha256": FIXTURE_SHA256, "platform": "ios",
                       "viewport": self.fixture["viewport"], "stages": [], "actions": [], "passed": False}

    def run(self, name, command, timeout=120, required=True):
        code = self.phase.run_phase(name, timeout, self.output / (name + ".log"), list(map(str, command)))
        if code and required:
            raise RuntimeError(f"{name} failed with exit {code}; original output preserved")
        return code

    def capture(self, name, command, timeout=120):
        # A wrapper keeps stdout-only JSON separate from driver progress logs.
        target = self.output / (name + ".json")
        wrapper = "import subprocess,sys; f=open(sys.argv[1],'wb'); p=subprocess.run(sys.argv[2:],stdout=f); f.close(); sys.exit(p.returncode)"
        self.run(name, [sys.executable, "-c", wrapper, target, *command], timeout)
        return parse_json_output(target.read_text())

    def mcp_tool(self, phase, tool, arguments, timeout):
        started = time.monotonic()
        record = {"phase": phase, "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "deadline_seconds": timeout, "transport": "persistent Maestro MCP/XCTest", "exit_code": 1}
        try:
            result = self.mcp.tool(tool, arguments, timeout)
            record["exit_code"] = 0
            return result
        except TimeoutError:
            record["timed_out"] = True
            raise
        finally:
            record["finished_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            record["elapsed_seconds"] = round(time.monotonic() - started, 3)
            with (self.output / "phases.jsonl").open("a") as sink:
                sink.write(json.dumps(record) + "\n")

    def flow(self, name, commands):
        path = self.output / "flows" / (name + ".yaml")
        path.parent.mkdir(exist_ok=True)
        path.write_text(flow_text([{"launchApp": {"stopApp": False}}, *commands]))
        names = [c["takeScreenshot"] for c in commands if "takeScreenshot" in c]
        if any(not re.fullmatch(r"[a-z0-9-]+", item) for item in names):
            raise ValueError("Audit screenshot names must be plain relative basenames")
        if self.mcp is None:
            self.mcp = MaestroMcp(self.maestro, self.output)
        started = time.monotonic()
        print(f"{name}: real Maestro/XCTest flow starting", flush=True)
        result = self.mcp_tool(name, "run", {"device_id": self.device, "files": [str(path)]}, 600 if self.first else 120)
        (self.output / (name + "-maestro-result.json")).write_text(json.dumps(result, indent=2) + "\n")
        if result.get("success") is not True:
            raise RuntimeError(f"{name}: Maestro flow did not succeed")
        # MCP's Orchestra has no CLI bundle allocator: relative takeScreenshot
        # names are written directly in the process's workflow-owned cwd.
        for screenshot in names:
            if not (self.output / (screenshot + ".png")).read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("Expected the actual native PNG from Maestro")
        print(f"{name}: real Maestro/XCTest flow passed in {time.monotonic() - started:.1f}s", flush=True)
        self.first = False

    def hierarchy(self, name, timeout=90):
        compact = self.mcp_tool(name + "-hierarchy", "inspect_screen", {"device_id": self.device}, timeout)
        (self.output / (name + "-compact-hierarchy.json")).write_text(json.dumps(compact, indent=2) + "\n")
        tree = expand_compact_hierarchy(compact)
        (self.output / (name + "-hierarchy.json")).write_text(json.dumps(tree, indent=2) + "\n")
        return tree

    def edge_scroll(self, name, label, direction, timeout=25):
        # The renderer legitimately claims drags starting on playable cells.
        # Scroll the page through the blank right margin, never the board center.
        deadline = time.monotonic() + timeout
        for attempt in range(8):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            tree = self.hierarchy(f"{name}-{attempt}", remaining)
            for node in flat_nodes(tree):
                box = bounds(node)
                if node_label(node) == label and box and box["height"] > 0 and box["y"] >= 65 and box["y"] + box["height"] <= 840:
                    return
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            start, end = ("99%,25%", "99%,80%") if direction == "UP" else ("99%,80%", "99%,25%")
            command = {"swipe": {"start": start, "end": end, "duration": 500}}
            self.mcp_tool(f"{name}-edge-swipe{attempt}", "run", {"device_id": self.device, "yaml": flow_text([command])}, remaining)
            self.report.setdefault("scrollActions", []).append({"stage": name, "driver": "Maestro/XCTest physical swipe", **command})
        raise RuntimeError(f"{name}: {label} did not enter the visible viewport after bounded physical edge scrolling")

    def frame_board(self, name, title):
        self.edge_scroll(name + "-top", title, "UP")
        self.edge_scroll(name + "-bottom", "Play history", "DOWN")

    def save_report(self):
        (self.output / "manifest.json").write_text(json.dumps(self.report, indent=2) + "\n")

    def screenshot(self, name):
        self.run(name + "-screenshot", ["xcrun", "simctl", "io", self.device, "screenshot", self.output / (name + ".png")], 120)

    def wait_match(self, game, expected, stage):
        deadline = time.monotonic() + 35
        actual = {}
        while time.monotonic() < deadline:
            actual = read_data(self.container).get("local", {}).get(game["matchId"], {})
            if not match_difference(actual, expected):
                (self.output / (stage + "-match.json")).write_text(json.dumps(actual, indent=2) + "\n")
                return actual
            time.sleep(.3)
        (self.output / (stage + "-actual-mismatch.json")).write_text(json.dumps(actual, indent=2) + "\n")
        raise RuntimeError(f'{stage}: saved state differs in {match_difference(actual, expected)}')

    def settled(self, stage, scene):
        previous = None
        for index in range(5):
            tree = self.hierarchy(f"{stage}-settle{index}")
            signature = render_signature(tree, scene)
            if signature is not None and signature == previous:
                (self.output / (stage + "-hierarchy.json")).write_text(json.dumps(tree, indent=2) + "\n")
                geometry = {"renderedMarkers": signature, "canvas": None, "stage": None}
                for node in flat_nodes(tree):
                    if node_label(node).startswith("Game board. Use pieces"):
                        geometry["canvas"] = bounds(node)
                    if node.get("attributes", {}).get("resource-id") == "game-stage":
                        geometry["stage"] = bounds(node)
                return geometry
            previous = signature
            time.sleep(1)
        raise RuntimeError(f"{stage}: expected pieces/targets did not settle in the real accessibility hierarchy")

    def board_stage(self, game, stage, expected, scene):
        self.wait_match(game, expected, stage)
        geometry = self.settled(stage, scene)
        self.screenshot(stage)
        clipped = outside_viewport(geometry["renderedMarkers"])
        geometry["markersWithinViewport"] = not clipped
        geometry["clippedMarkers"] = clipped
        record = {"name": stage, "screenshot": stage + ".png", "match": stage + "-match.json", "geometry": geometry}
        self.report["stages"].append(record)
        self.save_report()
        if clipped:
            raise RuntimeError(f"{stage}: board markers are clipped; full screenshot and bounds preserved")

    def pages(self):
        self.flow("pages", [
            {"assertVisible": selector("Let’s play.")}, {"takeScreenshot": "page-catalog"},
            {"tapOn": selector("Matches")}, {"assertVisible": selector("Open a match or invite link")},
            {"takeScreenshot": "page-matches"},
            {"tapOn": selector("On this device")}, {"assertVisible": selector("Practice with a computer")},
            {"takeScreenshot": "page-local"},
            {"scrollUntilVisible": {"element": selector("Preferences"), "direction": "DOWN", "timeout": 30000}},
            {"tapOn": selector("Preferences")},
            {"scrollUntilVisible": {"element": selector("Navigation layout"), "direction": "UP", "timeout": 30000}},
            {"assertVisible": selector("Navigation layout")},
            {"takeScreenshot": "page-preferences"},
            {"tapOn": selector("Log in")}, {"assertVisible": selector("Continue as guest")},
            {"takeScreenshot": "page-account"}, {"tapOn": selector("Close dialog")},
        ])
        for page in ["catalog", "matches", "local", "preferences", "account"]:
            self.report["stages"].append({"name": "page-" + page, "screenshot": "page-" + page + ".png"})
        self.save_report()

    def games(self):
        for game in self.fixture["games"]:
            package = self.fixture["accountData"]["responses"][f'/games/{game["gameId"]}/versions/{game["gameVersion"]}']
            open_selector = {**selector("Open match"), "below": selector(package["name"]), "index": 0}
            self.flow(game["slug"] + "-open", [
                {"tapOn": selector("On this device")},
                {"scrollUntilVisible": {"element": selector("Practice with a computer"), "direction": "UP", "timeout": 30000}},
                {"scrollUntilVisible": {"element": open_selector, "direction": "DOWN", "timeout": 30000}},
                {"tapOn": open_selector}, {"tapOn": selector("Focus mode")},
            ])
            self.frame_board(game["slug"] + "-initial-frame", package["name"])
            self.board_stage(game, game["slug"] + "-initial", game["initial"], game["initialScene"])
            for step in game["steps"]:
                stage = f'{game["slug"]}-step{step["number"]}'
                self.flow(stage + "-touch", [{"tapOn": selector(action["label"])} for action in step["uiActions"]])
                self.report["actions"].append({"stage": stage, "driver": "Maestro/XCTest physical taps", "selectors": [a["label"] for a in step["uiActions"]], "humanMove": step["humanMove"]})
                self.board_stage(game, stage, step["expectedMatch"], step["scene"])
            if read_data(self.container).get("selectedId") != game["matchId"]:
                raise RuntimeError("The selected match was not saved before the real app restart")
            self.run(game["slug"] + "-terminate", ["xcrun", "simctl", "terminate", self.device, BUNDLE], 60)
            self.run(game["slug"] + "-relaunch", ["xcrun", "simctl", "launch", self.device, BUNDLE], 120)
            self.flow(game["slug"] + "-restart-view", [
                {"tapOn": selector("Focus mode")},
            ])
            self.frame_board(game["slug"] + "-restart-frame", package["name"])
            final = game["steps"][-1]
            self.board_stage(game, game["slug"] + "-restart", final["expectedMatch"], final["scene"])
            self.flow(game["slug"] + "-zoom", [{"tapOn": selector("Zoom in")}, {"takeScreenshot": game["slug"] + "-zoom125"}, {"tapOn": selector("Reset board view")}, {"tapOn": selector("Exit focus mode")}])

    def extra_practice(self):
        before = set(read_data(self.container)["local"])
        self.flow("extra-practice-seat2", [
            {"tapOn": selector("BuildPlay home")},
            {"scrollUntilVisible": {"element": selector("Let’s play."), "direction": "UP", "timeout": 30000}},
            {"scrollUntilVisible": {"element": selector("Play Tic-tac-toe"), "direction": "DOWN", "timeout": 30000}},
            {"tapOn": selector("Play Tic-tac-toe")},
            {"scrollUntilVisible": {"element": selector("Your seat against computers: Player 2"), "direction": "DOWN", "timeout": 30000}},
            {"tapOn": selector("Your seat against computers: Player 2")},
            {"tapOn": selector("Practice with computers")}, {"tapOn": selector("Focus mode")},
        ])
        self.frame_board("extra-practice-seat2-frame", "Tic-tac-toe")
        data = read_data(self.container)
        added = [match for key, match in data["local"].items() if key not in before]
        if (len(added) != 1 or added[0]["players"][1]["kind"] != "human"
                or added[0]["players"][0]["kind"] != "computer" or added[0]["move_count"] != 1
                or added[0]["turn_of_player_indices"] != [1]):
            raise RuntimeError("Actual Practice UI did not create the computer-first human-seat-2 game")
        (self.output / "extra-practice-seat2-match.json").write_text(json.dumps(added[0], indent=2) + "\n")
        self.screenshot("extra-practice-seat2")
        self.report["extraPractice"] = {"createdThroughUI": True, "computerMovedFirst": True, "humanSeat": 1}

    def driver_diagnostics(self):
        # Collect before owned-device shutdown so a second failure identifies
        # XCTest bootstrap/server readiness rather than losing its evidence.
        preserve_driver_logs(self.output, self.started, device=self.device)
        self.run("driver-status", ["curl", "--silent", "--show-error", "--max-time", "10", "--include", "http://127.0.0.1:22087/status"], 15, False)
        self.run("driver-listener", ["/usr/sbin/lsof", "-nP", "-iTCP:22087", "-sTCP:LISTEN"], 20, False)
        self.run("driver-host-processes", ["ps", "-axo", "pid,ppid,pcpu,pmem,etime,comm"], 25, False)
        end = datetime.datetime.now(datetime.timezone.utc)
        start = end - datetime.timedelta(minutes=3)
        window = ["--start", start.strftime("%Y-%m-%d %H:%M:%S+0000"), "--end", end.strftime("%Y-%m-%d %H:%M:%S+0000")]
        predicate = 'process CONTAINS[c] "maestro" OR process CONTAINS[c] "xctest" OR process == "testmanagerd" OR (process == "runningboardd" AND eventMessage CONTAINS[c] "maestro") OR (process == "amfid" AND eventMessage CONTAINS[c] "maestro")'
        for name, prefix in [("driver-simulator-log", ["xcrun", "simctl", "spawn", self.device, "log"]),
                             ("driver-host-log", ["/usr/bin/log"])]:
            self.phase.run_phase(name, 30, self.output / (name + ".log"),
                                 prefix + ["show", "--style", "compact", *window, "--predicate", predicate], retain_tail=True)
        preserve_driver_logs(self.output, self.started, device=self.device)

    def execute(self, app):
        if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "macOS":
            raise ValueError("This driver runs only on the isolated GitHub Mac")
        os.environ["SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST"] = "1"
        os.environ["MAESTRO_CLI_NO_ANALYTICS"] = "1"
        os.environ["MAESTRO_DRIVER_STARTUP_TIMEOUT"] = "360000"
        # EnvUtils.xdgStateHome() honors this; hierarchy/bootstrap logs also
        # remain visible and confined to this fresh workflow's output.
        os.environ["XDG_STATE_HOME"] = str(self.output / "maestro-state")
        self.output.mkdir(parents=True, exist_ok=True)
        try:
            self.run("prewarm", ["sudo", "xcodebuild", "-runFirstLaunch"], 300)
            self.run("dyld-cache", ["xcrun", "simctl", "runtime", "dyld_shared_cache", "update", "--all"], 600)
            devices = self.capture("devices", ["xcrun", "simctl", "list", "devices", "available", "--json"], 60)
            choices = [(tuple(map(int, re.findall(r"\d+", runtime.rsplit("iOS-", 1)[-1]))), runtime)
                       for runtime, values in devices["devices"].items()
                       if "iOS-" in runtime and any(v.get("name") == "iPhone 17" and v.get("isAvailable", True) for v in values)]
            if not choices:
                raise ValueError("Expected the validated 402x874 iPhone 17 simulator runtime")
            runtime = max(choices)[1]
            created = subprocess.check_output(["xcrun", "simctl", "create", "BuildPlay Parity " + os.environ.get("GITHUB_RUN_ID", "manual"), "com.apple.CoreSimulator.SimDeviceType.iPhone-17", runtime], text=True, timeout=60).strip()
            self.device = str(uuid.UUID(created)).upper()
            (self.output / "owned-simulator.json").write_text(json.dumps({"udid": self.device, "createdBy": "portal-parity-ios", "sourceSha": SOURCE}))
            self.run("boot", ["xcrun", "simctl", "bootstatus", self.device, "-b"], 600)
            _, identifier, binary = helper("sign-ios-simulator").simulator_metadata(app)
            if identifier != BUNDLE or not (app / "main.jsbundle").is_file():
                raise ValueError("Expected the existing standalone BuildPlay simulator app")
            self.report["canonicalBinarySha256"] = hashlib.sha256(binary.read_bytes()).hexdigest()
            self.report["embeddedJavaScriptSha256"] = hashlib.sha256((app / "main.jsbundle").read_bytes()).hexdigest()
            self.run("canonical-signature", ["codesign", "--verify", "--deep", "--strict", "--all-architectures", app], 60)
            self.run("install", ["xcrun", "simctl", "install", self.device, app], 300)
            self.container = seed(self.device, self.output)
            self.run("launch", ["xcrun", "simctl", "launch", self.device, BUNDLE], 360)
            self.pages()
            self.games()
            self.extra_practice()
            self.report["passed"] = True
        except Exception as error:
            self.report["error"] = str(error)
            if self.device:
                if self.mcp:
                    try:
                        self.hierarchy("failure")
                    except Exception as hierarchy_error:
                        self.report["failureHierarchyError"] = str(hierarchy_error)
                try:
                    self.driver_diagnostics()
                except Exception as diagnostic_error:
                    self.report["diagnosticError"] = type(diagnostic_error).__name__
                self.run("failure-screen", ["xcrun", "simctl", "io", self.device, "screenshot", self.output / "failure.png"], 120, False)
                if self.container:
                    (self.output / "failure-account-data.json").write_text(json.dumps(read_data(self.container), indent=2) + "\n")
            raise
        finally:
            self.save_report()
            if self.mcp:
                self.mcp.close()
            if self.device:
                self.run("final-processes", ["xcrun", "simctl", "spawn", self.device, "launchctl", "list"], 60, False)
                self.run("shutdown", ["xcrun", "simctl", "shutdown", self.device], 60, False)
                self.run("delete-owned", ["xcrun", "simctl", "delete", self.device], 60, False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    p = subs.add_parser("provenance"); p.add_argument("run_id", type=int); p.add_argument("output", type=Path)
    p = subs.add_parser("audit"); p.add_argument("app", type=Path); p.add_argument("output", type=Path); p.add_argument("--maestro", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "provenance":
            provenance(args.run_id, args.output)
        else:
            Audit(args.output, args.maestro).execute(args.app.resolve())
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"iOS parity audit failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
