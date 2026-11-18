"""Cross-platform regression checks for simulator choice and bounded smoke phases."""

import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import time

import pytest


SCRIPTS = Path(__file__).resolve().parents[1] / "frontends" / "portal" / "scripts"


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


select_simulator = load_script("select-ios-simulator").select_simulator
run_phase = load_script("run-ios-smoke-phase").run_phase


def phone(name, udid, *, available=True, booted=False):
    return {"name": name, "udid": udid, "isAvailable": available, "state": "Booted" if booted else "Shutdown"}


def test_current_runner_chooses_newest_runtime_instead_of_oldest_model_name():
    selected = select_simulator({"devices": {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-2": [phone("iPhone 16e", "old", booted=True)],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-4": [phone("iPhone 17", "middle")],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [phone("iPhone 17 Pro", "new")],
    }})
    assert selected["udid"] == "new"
    assert selected["version"] == "26.5"


def test_mature_ios18_preference_uses_its_newest_installed_patch():
    selected = select_simulator({"devices": {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [phone("iPhone 17", "new", booted=True)],
        "com.apple.CoreSimulator.SimRuntime.iOS-18-2": [phone("iPhone 16", "old18")],
        "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [phone("iPhone 16 Pro", "preferred")],
    }})
    assert selected["udid"] == "preferred"


def test_runtime_sort_is_numeric_and_booted_preference_stays_within_runtime():
    selected = select_simulator({"devices": {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-9": [phone("iPhone 16", "wrong", booted=True)],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-10": [phone("iPhone 17", "cold"), phone("iPhone 17 Pro", "warm", booted=True)],
    }})
    assert selected["udid"] == "warm"
    assert selected["booted"] is True


def test_unavailable_devices_and_non_iphone_runtimes_cannot_win():
    selected = select_simulator({"devices": {
        "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [phone("iPhone 16", "unavailable", available=False)],
        "com.apple.CoreSimulator.SimRuntime.iOS-27-0": [phone("iPad Pro", "tablet")],
        "com.apple.CoreSimulator.SimRuntime.watchOS-27-0": [phone("iPhone misleading", "watch")],
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [phone("iPhone 17", "valid")],
    }})
    assert selected["udid"] == "valid"


def test_no_available_iphone_reports_actionable_error():
    with pytest.raises(ValueError, match="No available iPhone simulator"):
        select_simulator({"devices": {"com.apple.CoreSimulator.SimRuntime.iOS-26-5": [phone("iPad", "tablet")]}})


def test_cli_outputs_selected_runtime_metadata(tmp_path):
    devices = tmp_path / "devices.json"
    devices.write_text(json.dumps({"devices": {"iOS 26.5": [phone("iPhone 17", "selected")]}}))
    result = subprocess.run([sys.executable, str(SCRIPTS / "select-ios-simulator.py"), str(devices)], capture_output=True, text=True, check=True)
    assert json.loads(result.stdout) == {"udid": "selected", "name": "iPhone 17", "runtime": "iOS 26.5", "version": "26.5", "booted": False}


def test_phase_preserves_failure_output_and_exit_code(tmp_path):
    output = tmp_path / "install.log"
    status = run_phase("install", 5, output, [sys.executable, "-c", "import sys; print('install failed', flush=True); sys.exit(7)"])
    assert status == 7
    assert output.read_text() == "install failed\n"
    summary = json.loads((tmp_path / "phases.jsonl").read_text())
    assert summary["exit_code"] == 7
    assert summary["timed_out"] is False


def test_phase_deadline_terminates_descendants_instead_of_leaking_background_work(tmp_path):
    marker = tmp_path / "leaked-child"
    ready = tmp_path / "child-started"
    child = f"import time; from pathlib import Path; Path({str(ready)!r}).write_text('ready'); time.sleep(2); Path({str(marker)!r}).write_text('leaked')"
    parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-S','-c',{child!r}]); print('launch pending',flush=True); time.sleep(30)"
    started = time.monotonic()
    status = run_phase("launch", 1, tmp_path / "launch.log", [sys.executable, "-S", "-c", parent])
    assert status == 124
    assert time.monotonic() - started < 5
    assert ready.exists()
    time.sleep(2.1)
    assert not marker.exists()
    summary = json.loads((tmp_path / "phases.jsonl").read_text())
    assert summary["timed_out"] is True
    assert "launch pending" in (tmp_path / "launch.log").read_text()


def test_phase_caps_diagnostic_output_without_turning_success_into_failure(tmp_path):
    output = tmp_path / "diagnostic.log"
    assert run_phase("diagnostic", 5, output, [sys.executable, "-c", "print('x'*4096)"], max_output_bytes=32) == 0
    assert len(output.read_bytes()) < 100
    assert "Output truncated" in output.read_text()
    summary = json.loads((tmp_path / "phases.jsonl").read_text())
    assert summary["output_truncated"] is True
    assert summary["output_bytes"] > 4096


@pytest.mark.parametrize("boot_failure", [False, True])
def test_shell_smoke_orchestration_keeps_local_only_gate_and_captures_failures(tmp_path, boot_failure):
    """Exercise shell/selector/phase interop without requiring Apple tools on Linux."""
    bin_path = tmp_path / "bin"
    bin_path.mkdir()
    app = tmp_path / "BuildPlay.app"
    app.mkdir()
    (app / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": "edu.columbia.gameportal.starter"}))
    calls = tmp_path / "calls.jsonl"
    mock = bin_path / "xcrun"
    mock.write_text(f"""#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
with open({str(calls)!r},'a') as log:
    log.write(json.dumps({{'args':args,'local_only':os.environ.get('SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST')=='1'}})+'\\n')
if args[:3]==['simctl','list','devices']:
    print('CoreSimulator diagnostic warning',file=sys.stderr)
    print(json.dumps({{'devices':{{
      'com.apple.CoreSimulator.SimRuntime.iOS-26-2':[{{'name':'iPhone 16e','udid':'old','isAvailable':True,'state':'Shutdown'}}],
      'com.apple.CoreSimulator.SimRuntime.iOS-26-5':[{{'name':'iPhone 17','udid':'new','isAvailable':True,'state':'Shutdown'}}]
    }}}}))
elif args[:2]==['simctl','bootstatus']:
    print('boot migration pending' if {boot_failure!r} else 'boot complete')
    sys.exit(7 if {boot_failure!r} else 0)
elif args[:2]==['simctl','launch']:
    if os.environ.get('SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST')!='1':sys.exit(9)
    print('edu.columbia.gameportal.starter: 123')
elif args[:2]==['simctl','io']:
    Path(args[-1]).write_bytes(b'fake screenshot')
elif args[:2]==['simctl','spawn'] and 'launchctl' in args:
    print('123 0 edu.columbia.gameportal.starter')
""")
    mock.chmod(0o755)
    for command, body in {"sleep": "exit 0", "ps": "printf '101 CoreSimulatorService\\n'"}.items():
        executable = bin_path / command
        executable.write_text(f"#!/usr/bin/env bash\n{body}\n")
        executable.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_path}{os.pathsep}{os.environ['PATH']}"}
    results = tmp_path / "results"
    completed = subprocess.run(["bash", str(SCRIPTS / "smoke-ios-simulator.sh"), str(app), str(results)], env=env, capture_output=True, text=True, timeout=30)
    assert completed.returncode == (7 if boot_failure else 0), completed.stdout + completed.stderr
    selected = json.loads((results / "selected-simulator.json").read_text())
    assert selected["udid"] == "new"
    phases = [json.loads(line) for line in (results / "phases.jsonl").read_text().splitlines()]
    recorded = [json.loads(line) for line in calls.read_text().splitlines()]
    if boot_failure:
        assert (results / "failure-devices.json").exists()
        assert (results / "host-cpu.log").read_text() == "101 CoreSimulatorService\n"
        assert "simulator-log" in [phase["phase"] for phase in phases]
        assert not any(call["args"][:2] == ["simctl", "install"] for call in recorded)
    else:
        launch = next(call for call in recorded if call["args"][:2] == ["simctl", "launch"])
        assert launch["local_only"] is True
        assert (results / "screenshots" / "portal-launch.png").exists()
        assert {phase["phase"]: phase["deadline_seconds"] for phase in phases} == {
            "list-devices": 60, "boot": 600, "install": 120, "launch": 360, "screenshot": 45, "processes": 30,
        }
