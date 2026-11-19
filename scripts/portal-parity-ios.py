#!/usr/bin/env python3
"""Manual iOS parity audit: reuse a trusted app; navigate and play through XCTest."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
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


class Audit:
    def __init__(self, output, maestro):
        self.output, self.maestro = output.resolve(), str(maestro)
        self.phase = helper("run-ios-smoke-phase")
        self.fixture = load_fixture()
        self.device = None
        self.container = None
        self.first = True
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

    def flow(self, name, commands):
        path = self.output / "flows" / (name + ".yaml")
        path.parent.mkdir(exist_ok=True)
        path.write_text(flow_text([{"launchApp": {"stopApp": False}}, *commands]))
        command = [self.maestro, "--device", self.device, "test", "--no-ansi", "--debug-output", self.output / "maestro-debug", "--format", "JUNIT", "--output", self.output / (name + "-junit.xml")]
        if not self.first:
            command.append("--no-reinstall-driver")
        command.append(path)
        self.run(name, command, 240 if self.first else 120)
        self.first = False

    def hierarchy(self, name):
        return self.capture(name + "-hierarchy", [self.maestro, "--device", self.device, "hierarchy", "--no-reinstall-driver"], 90)

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
            {"assertVisible": selector("Let’s play.")}, {"takeScreenshot": str(self.output / "page-catalog")},
            {"tapOn": selector("Matches")}, {"assertVisible": selector("Open a match or invite link")},
            {"takeScreenshot": str(self.output / "page-matches")},
            {"tapOn": selector("On this device")}, {"assertVisible": selector("Practice with a computer")},
            {"takeScreenshot": str(self.output / "page-local")},
            {"scrollUntilVisible": {"element": selector("Preferences"), "direction": "DOWN", "timeout": 30000}},
            {"tapOn": selector("Preferences")}, {"assertVisible": selector("Navigation layout")},
            {"takeScreenshot": str(self.output / "page-preferences")},
            {"tapOn": selector("Log in")}, {"assertVisible": selector("Continue as guest")},
            {"takeScreenshot": str(self.output / "page-account")}, {"tapOn": selector("Close dialog")},
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
                {"scrollUntilVisible": {"element": open_selector, "direction": "DOWN", "timeout": 30000}},
                {"tapOn": open_selector}, {"tapOn": selector("Focus mode")},
                {"scrollUntilVisible": {"element": selector("Play history"), "direction": "DOWN", "timeout": 25000}},
            ])
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
                {"scrollUntilVisible": {"element": selector("Play history"), "direction": "DOWN", "timeout": 25000}},
            ])
            final = game["steps"][-1]
            self.board_stage(game, game["slug"] + "-restart", final["expectedMatch"], final["scene"])
            self.flow(game["slug"] + "-zoom", [{"tapOn": selector("Zoom in")}, {"takeScreenshot": str(self.output / (game["slug"] + "-zoom125"))}, {"tapOn": selector("Reset board view")}, {"tapOn": selector("Exit focus mode")}])

    def extra_practice(self):
        before = set(read_data(self.container)["local"])
        self.flow("extra-practice-seat2", [
            {"tapOn": selector("BuildPlay home")},
            {"scrollUntilVisible": {"element": selector("Play Tic-tac-toe"), "direction": "DOWN", "timeout": 30000}},
            {"tapOn": selector("Play Tic-tac-toe")},
            {"scrollUntilVisible": {"element": selector("Your seat against computers: Player 2"), "direction": "DOWN", "timeout": 30000}},
            {"tapOn": selector("Your seat against computers: Player 2")},
            {"tapOn": selector("Practice with computers")}, {"tapOn": selector("Focus mode")},
            {"scrollUntilVisible": {"element": selector("Play history"), "direction": "DOWN", "timeout": 25000}},
        ])
        data = read_data(self.container)
        added = [match for key, match in data["local"].items() if key not in before]
        if (len(added) != 1 or added[0]["players"][1]["kind"] != "human"
                or added[0]["players"][0]["kind"] != "computer" or added[0]["move_count"] != 1
                or added[0]["turn_of_player_indices"] != [1]):
            raise RuntimeError("Actual Practice UI did not create the computer-first human-seat-2 game")
        (self.output / "extra-practice-seat2-match.json").write_text(json.dumps(added[0], indent=2) + "\n")
        self.screenshot("extra-practice-seat2")
        self.report["extraPractice"] = {"createdThroughUI": True, "computerMovedFirst": True, "humanSeat": 1}

    def execute(self, app):
        if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "macOS":
            raise ValueError("This driver runs only on the isolated GitHub Mac")
        os.environ["SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST"] = "1"
        os.environ["MAESTRO_CLI_NO_ANALYTICS"] = "1"
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
                self.run("failure-screen", ["xcrun", "simctl", "io", self.device, "screenshot", self.output / "failure.png"], 120, False)
                if self.container:
                    (self.output / "failure-account-data.json").write_text(json.dumps(read_data(self.container), indent=2) + "\n")
            raise
        finally:
            self.save_report()
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
