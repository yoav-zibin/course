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
