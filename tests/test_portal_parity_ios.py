"""Read-only artifact provenance, isolated seeding and actual UI evidence gates."""
import copy
import importlib.util
import json
from pathlib import Path
import plistlib
import uuid

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("portal_parity", ROOT / "scripts/portal-parity-ios.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
CI = {"GITHUB_ACTIONS": "true", "RUNNER_OS": "macOS"}
UDID = "C92A109F-C627-4C8F-AD8C-731FA18390AC"


def provenance():
    run = {"id": 52, "head_sha": audit.SOURCE, "repository": {"full_name": audit.REPOSITORY},
           "head_repository": {"full_name": audit.REPOSITORY}, "head_branch": "main", "event": "push",
           "path": ".github/workflows/portal-apps.yml"}
    artifact = {"name": "BuildPlay-ios-simulator", "expired": False, "digest": "sha256:" + "a" * 64,
                "workflow_run": {"id": 52, "head_sha": audit.SOURCE}}
    jobs = {"jobs": [{"name": "BuildPlay iOS (simulator build)", "conclusion": "success"}]}
    return run, artifact, jobs


def test_completed_simulator_build_can_be_reused_before_distribution_run_finishes():
    run, artifact, jobs = provenance()
    run["status"] = "in_progress"
    audit.validate_provenance(run, artifact, jobs, 52)


def test_driver_log_collection_retains_hidden_startup_tail_without_other_files(tmp_path):
    import os
    import time

    output = tmp_path / "results"
    hidden = output / "maestro-debug/.maestro/tests/session"
    hidden.mkdir(parents=True)
    started = time.time() - 5
    (hidden / "xctest_runner_now.log").write_bytes(b"early" + b"last-readiness-failure")
    (hidden / "maestro.log").write_text("driver bootstrap")
    (hidden / "credentials.json").write_text("never copy arbitrary files")
    old = hidden / "xctest_runner_old.log"
    old.write_text("old unrelated run")
    os.utime(old, (started - 10, started - 10))
    outside = tmp_path / "outside.log"
    outside.write_text("outside permitted tool tree")
    (hidden / "xctest_runner_link.log").symlink_to(outside)
    audit.preserve_driver_logs(output, started, home=tmp_path, max_bytes=22)
    directory = output / "driver-diagnostics"
    records = json.loads((directory / "log-sources.json").read_text())
    assert {Path(record["source"]).name for record in records} == {"xctest_runner_now.log", "maestro.log"}
    startup = next(record for record in records if "xctest_runner" in record["source"])
    assert startup["tailOnly"] and startup["retainedBytes"] == 22
    assert (directory / startup["copy"]).read_bytes().endswith(b"last-readiness-failure")
    assert not list(directory.glob(".*"))


def test_mcp_keeps_one_session_and_plain_screenshot_names_without_game_injection(tmp_path, monkeypatch):
    sessions = []
    class FakeMcp:
        def __init__(self, executable, output):
            self.output, self.calls = output, []
            sessions.append(self)
        def tool(self, name, arguments, timeout):
            self.calls.append((name, arguments, timeout))
            commands = json.loads(Path(arguments["files"][0]).read_text().split("---\n", 1)[1])
            for command in commands:
                if "takeScreenshot" in command:
                    (self.output / (command["takeScreenshot"] + ".png")).write_bytes(b"\x89PNG\r\n\x1a\nactual native capture")
            return {"success": True}
    monkeypatch.setattr(audit, "MaestroMcp", FakeMcp)
    runner = audit.Audit(tmp_path, "maestro")
    runner.device = UDID
    runner.flow("first", [{"takeScreenshot": "page-catalog"}])
    runner.flow("second", [{"tapOn": audit.selector("Cell 1")}])
    assert len(sessions) == 1
    assert [call[2] for call in sessions[0].calls] == [600, 120]
    assert (tmp_path / "page-catalog.png").is_file()
    assert not any(word in (tmp_path / "flows/second.yaml").read_text() for word in ["clearState", "clearKeychain", "eval"])
    with pytest.raises(ValueError, match="relative basenames"):
        runner.flow("escape", [{"takeScreenshot": "../page-catalog"}])


def test_compact_mcp_hierarchy_preserves_real_native_labels_bounds_and_ids():
    compact = {"ui_schema": {"platform": "ios", "abbreviations": {"b": "bounds", "a11y": "accessibilityText", "rid": "resource-id"}},
               "elements": [{"rid": "game-stage", "b": "[0,100][402,700]", "c": [{"a11y": "Cell 1: Move", "b": "[10,110][54,154]"}]}]}
    tree = audit.expand_compact_hierarchy(compact)
    child = tree["children"][0]["children"][0]
    assert audit.node_label(child) == "Cell 1: Move"
    assert audit.bounds(child) == {"x": 10, "y": 110, "width": 44, "height": 44}
    assert tree["children"][0]["attributes"]["resource-id"] == "game-stage"
    with pytest.raises(ValueError, match="compact accessibility schema"):
        audit.expand_compact_hierarchy({"ui_schema": {"platform": "android"}, "elements": []})


def test_board_scroll_uses_real_far_edge_swipe_until_target_is_in_safe_viewport(tmp_path):
    runner = audit.Audit(tmp_path, "maestro")
    runner.device = UDID
    trees = iter([{"attributes": {"accessibilityText": "Play history", "bounds": "[10,900][110,930]"}},
                  {"attributes": {"accessibilityText": "Play history", "bounds": "[10,750][110,780]"}}])
    runner.hierarchy = lambda name, timeout: next(trees)
    calls = []
    runner.mcp_tool = lambda *args: calls.append(args) or {"success": True}
    runner.edge_scroll("board", "Play history", "DOWN")
    assert len(calls) == 1
    header, commands = calls[0][2]["yaml"].split("---\n", 1)
    assert header.strip() == "appId: " + audit.BUNDLE
    assert json.loads(commands) == [{"swipe": {"start": "99%,80%", "end": "99%,25%", "duration": 500}}]
    assert calls[0][1] == "run" and calls[0][2]["device_id"] == UDID
    assert runner.report["scrollActions"][0]["driver"] == "Maestro/XCTest physical swipe"


@pytest.mark.parametrize("change", ["source", "fork", "workflow", "artifact", "expired", "digest", "build"])
def test_untrusted_or_unsuccessful_artifact_rejected(change):
    run, artifact, jobs = provenance()
    if change == "source": run["head_sha"] = "0" * 40
    elif change == "fork": run["head_repository"]["full_name"] = "other/fork"
    elif change == "workflow": run["path"] = ".github/workflows/unrelated.yml"
    elif change == "artifact": artifact["workflow_run"]["head_sha"] = "0" * 40
    elif change == "expired": artifact["expired"] = True
    elif change == "digest": artifact["digest"] = ""
    else: jobs["jobs"][0]["conclusion"] = "failure"
    with pytest.raises(ValueError, match="trusted"):
        audit.validate_provenance(run, artifact, jobs, 52)


def owned_container(tmp_path):
    output = tmp_path / "results"
    output.mkdir()
    (output / "owned-simulator.json").write_text(json.dumps({"udid": UDID, "createdBy": "portal-parity-ios", "sourceSha": audit.SOURCE}))
    app = tmp_path / "Library/Developer/CoreSimulator/Devices" / UDID / "data/Containers/Data/Application" / str(uuid.uuid4()).upper()
    app.mkdir(parents=True)
    (app / ".com.apple.mobile_container_manager.metadata.plist").write_bytes(plistlib.dumps({"MCMMetadataIdentifier": audit.BUNDLE}))
    return output, app


def test_same_public_fixture_is_seeded_once_without_account_credentials_or_online_queues(tmp_path):
    output, app = owned_container(tmp_path)
    assert audit.seed(UDID, output, home=tmp_path, environment=CI) == app
    data = audit.read_data(app)
    fixture = audit.load_fixture()
    assert data == fixture["accountData"] and data["selectedId"] is None
    assert len(data["local"]) == 3 and not data["queues"] and not data["conflicts"]
    assert all(match["localMode"] == "computer" for match in data["local"].values())
    assert len(list((app / "Library/Application Support/BuildPlayShared").iterdir())) == 1
    assert not json.loads((output / "seed-proof.json").read_text())["credentialsSeeded"]
    with pytest.raises(ValueError, match="existing app data"):
        audit.seed(UDID, output, home=tmp_path, environment=CI)
    assert audit.read_data(app) == data


@pytest.mark.parametrize("failure", ["environment", "ownership", "documents", "symlink"])
def test_seeding_refuses_other_hosts_devices_existing_private_data_or_symlink_escape(tmp_path, failure):
    output, app = owned_container(tmp_path)
    environment = CI
    if failure == "environment": environment = {}
    elif failure == "ownership": (output / "owned-simulator.json").write_text('{}')
    elif failure == "documents":
        (app / "Documents").mkdir(); (app / "Documents/portal.json").write_text("private original")
    else:
        outside = tmp_path / "outside"; outside.mkdir(); (app / "Library").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        audit.seed(UDID, output, home=tmp_path, environment=environment)
    assert not list(app.glob("**/BuildPlayShared/*.json"))
    if failure == "documents": assert (app / "Documents/portal.json").read_text() == "private original"
    if failure == "symlink": assert not list((tmp_path / "outside").iterdir())


def test_only_presentation_ram_fields_are_ignored_in_exact_persisted_match_comparison():
    expected = {"state": {"board": [0, 1]}, "turn_of_player_indices": [0], "move_count": 2, "moves": []}
    actual = {**copy.deepcopy(expected), "pending": 0, "conflict": None}
    assert not audit.match_difference(actual, expected)
    actual["state"]["board"][1] = 0
    assert audit.match_difference(actual, expected) == ["state"]
    actual = copy.deepcopy(expected); actual.pop("turn_of_player_indices")
    assert audit.match_difference(actual, expected) == ["turn_of_player_indices"]


def test_render_gate_waits_for_final_computer_piece_count_and_positioned_accessibility_labels():
    def tree(labels):
        return {"children": [{"attributes": {"accessibilityText": name, "bounds": "[10,100][50,140]"}} for name in labels]}
    scene = {"pieces": [{"id": "a", "text": "X"}, {"id": "b", "text": "O"}], "targets": [{"id": "cell_2", "label": "Cell 3"}]}
    assert audit.render_signature(tree(["X", "Cell 3"]), scene) is None
    assert audit.render_signature(tree(["X", "O", "Cell 3"]), scene) is not None
    assert audit.render_signature(tree(["X", "O", "Cell 4"]), scene) is None


def test_full_board_geometry_gate_rejects_below_fold_marker_and_keeps_raw_bounds():
    inside = {"label": "Cell 1", "bounds": {"x": 20, "y": 100, "width": 44, "height": 44}}
    below = {"label": "Cell 9", "bounds": {"x": 20, "y": 850, "width": 44, "height": 44}}
    assert not audit.outside_viewport([inside])
    assert audit.outside_viewport([inside, below]) == [below]


def test_generated_flows_use_physical_driver_commands_never_clear_data_or_inject_game_moves():
    text = audit.flow_text([{"launchApp": {"stopApp": False}}, {"tapOn": audit.selector("Cell 1")}])
    header, body = text.split("---\n", 1)
    assert header.strip() == "appId: " + audit.BUNDLE
    commands = json.loads(body)
    assert commands[0] == {"launchApp": {"stopApp": False}}
    assert "clearState" not in text and "clearKeychain" not in text and "eval" not in text


def test_driver_progress_can_precede_structured_hierarchy_without_faking_elements():
    assert audit.parse_json_output('\x1b[32mDriver ready\x1b[0m\n{"status":"connecting"}\n{"attributes":{},"children":[]}\n') == {"attributes": {}, "children": []}
    with pytest.raises(ValueError): audit.parse_json_output('{"error":"driver unavailable"}')
