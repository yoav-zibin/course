"""Cross-platform regression checks for simulator choice and bounded smoke phases."""

import importlib.util
import datetime as dt
import json
import os
from pathlib import Path
import plistlib
import signal
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
phase_runner = load_script("run-ios-smoke-phase")
run_phase = phase_runner.run_phase
diagnostic_window = load_script("ios-smoke-diagnostic-window").diagnostic_window


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


def test_diagnostic_tail_keeps_the_final_launch_error_when_output_is_capped(tmp_path):
    output = tmp_path / "diagnostic.log"
    command = [sys.executable, "-S", "-c", "print('early context '*2048); print('SBMainWorkspace RequestDenied')"]
    assert run_phase("diagnostic", 5, output, command, max_output_bytes=64, retain_tail=True) == 0
    assert output.read_text().endswith("SBMainWorkspace RequestDenied\n")
    assert len(output.read_bytes()) < 150
    summary = json.loads((tmp_path / "phases.jsonl").read_text())
    assert summary["output_truncated"] is True
    assert summary["output_retention"] == "tail"


@pytest.mark.parametrize("restricted_signal", [signal.SIGTERM, 0, signal.SIGKILL])
def test_timeout_cleanup_eperm_preserves_timeout_and_reaps_owned_child(tmp_path, monkeypatch, restricted_signal):
    real_killpg = os.killpg

    def restricted_killpg(pid, number):
        if number == restricted_signal:
            raise PermissionError("restricted by macOS")
        return real_killpg(pid, number)

    monkeypatch.setattr(phase_runner.os, "killpg", restricted_killpg)
    pid_file = tmp_path / "child.pid"
    ignore_term = restricted_signal == signal.SIGKILL
    child = f"import os,signal,time; from pathlib import Path; signal.signal(signal.SIGTERM,signal.SIG_IGN) if {ignore_term!r} else None; Path({str(pid_file)!r}).write_text(str(os.getpid())); print('phase started',flush=True); time.sleep(30)"
    status = run_phase("apple-host-log", 1, tmp_path / "host.log", [sys.executable, "-S", "-c", child])
    assert status == 124
    summary = json.loads((tmp_path / "phases.jsonl").read_text())
    assert summary["timed_out"] is True
    assert summary["cleanup_restrictions"]
    assert "Cleanup restricted" in (tmp_path / "host.log").read_text()
    assert "Could not start phase" not in (tmp_path / "host.log").read_text()
    with pytest.raises(ProcessLookupError):
        os.kill(int(pid_file.read_text()), 0)


def test_diagnostics_choose_launch_window_instead_of_boot_or_later_diagnostics():
    window = diagnostic_window([
        {"phase": "boot", "started_at": "2026-11-18T23:09:13+00:00", "elapsed_seconds": 151.7},
        {"phase": "install", "started_at": "2026-11-18T23:11:53+00:00", "elapsed_seconds": 103.8},
        {"phase": "launch", "started_at": "2026-11-18T23:13:42.633714+00:00", "elapsed_seconds": 7.425},
        {"phase": "device-state", "started_at": "2026-11-18T23:14:30+00:00", "elapsed_seconds": 20},
    ])
    assert window["source_phase"] == "launch"
    assert window["start"] == "2026-11-18 23:13:37+0000"
    assert window["end"] == "2026-11-18 23:13:55+0000"


def test_diagnostics_include_post_launch_failure_and_honor_timestamp_offset():
    window = diagnostic_window([
        {"phase": "launch", "started_at": "2026-11-19T01:13:42+02:00", "elapsed_seconds": 7},
        {"phase": "processes", "started_at": "2026-11-19T01:14:03+02:00", "finished_at": "2026-11-19T01:14:08+02:00", "elapsed_seconds": 5},
    ])
    assert window["source_phase"] == "processes"
    assert window["start"] == "2026-11-18 23:13:37+0000"
    assert window["end"] == "2026-11-18 23:14:13+0000"


def test_diagnostics_do_not_use_a_previous_invocations_launch():
    window = diagnostic_window([
        {"phase": "launch", "started_at": "2026-11-18T20:00:00+00:00", "elapsed_seconds": 7},
        {"phase": "list-devices", "started_at": "2026-11-18T23:13:42+00:00", "elapsed_seconds": 5},
    ])
    assert window["source_phase"] == "list-devices"
    assert window["start"] == "2026-11-18 23:13:37+0000"
    assert window["end"] == "2026-11-18 23:13:52+0000"


def test_missing_phase_metadata_uses_a_short_window_not_all_early_boot_logs():
    window = diagnostic_window([], now=dt.datetime(2026, 11, 18, 23, 14, 0, tzinfo=dt.timezone.utc))
    assert window["source_phase"] == "before-first-phase"
    assert window["start"] == "2026-11-18 23:13:25+0000"
    assert window["end"] == "2026-11-18 23:14:05+0000"


@pytest.mark.parametrize(("failure_phase", "fixture_enabled"), [(None,False), ("boot",False), ("launch",False), (None,True), ("fixture",True)])
def test_shell_smoke_orchestration_keeps_local_only_gate_and_captures_failures(tmp_path, failure_phase, fixture_enabled):
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
    print('boot migration pending' if {failure_phase!r}=='boot' else 'boot complete')
    sys.exit(7 if {failure_phase!r}=='boot' else 0)
elif args[:2]==['simctl','launch']:
    if os.environ.get('SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST')!='1':sys.exit(9)
    if {failure_phase!r}=='launch':
        print('FBSOpenApplicationServiceErrorDomain: SBMainWorkspace RequestDenied')
        sys.exit(1)
    print('edu.columbia.gameportal.starter: 123')
elif args[:2]==['simctl','io']:
    Path(args[-1]).write_bytes(b'fake screenshot')
elif args[:2]==['simctl','spawn'] and 'launchctl' in args:
    print('123 0 edu.columbia.gameportal.starter')
""")
    mock.chmod(0o755)
    # The real fixture's data/safety contract has its own tests. This shim
    # verifies CI shell ordering and failure gating without Apple tools.
    python = bin_path / "python3"
    python.write_text(f"""#!{sys.executable} -S
import json,os,sys
from pathlib import Path
args=sys.argv[1:]
if args and args[0].endswith('/seed-ios-connect4-fixture.py'):
    with open({str(calls)!r},'a') as log:
        log.write(json.dumps({{'args':['fixture',*args[1:]],'local_only':False}})+'\\n')
    if {failure_phase!r}=='fixture':sys.exit(11)
    Path(args[-1]).write_text('{{"public_fixture":true}}')
else:
    os.execv({sys.executable!r},[{sys.executable!r},*args])
""")
    python.chmod(0o755)
    for command, body in {"sleep": "exit 0", "ps": "printf '101 CoreSimulatorService\\n'"}.items():
        executable = bin_path / command
        executable.write_text(f"#!/usr/bin/env bash\n{body}\n")
        executable.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_path}{os.pathsep}{os.environ['PATH']}", "GITHUB_ACTIONS": "true" if fixture_enabled else "false", "RUNNER_OS": "macOS" if fixture_enabled else "Linux"}
    results = tmp_path / "results"
    completed = subprocess.run(["bash", str(SCRIPTS / "smoke-ios-simulator.sh"), str(app), str(results)], env=env, capture_output=True, text=True, timeout=30)
    assert completed.returncode == (7 if failure_phase == "boot" else 11 if failure_phase == "fixture" else 1 if failure_phase == "launch" else 0), completed.stdout + completed.stderr
    selected = json.loads((results / "selected-simulator.json").read_text())
    assert selected["udid"] == "new"
    phases = [json.loads(line) for line in (results / "phases.jsonl").read_text().splitlines()]
    recorded = [json.loads(line) for line in calls.read_text().splitlines()]
    if failure_phase:
        assert (results / "failure-devices.json").exists()
        assert (results / "host-cpu.log").read_text() == "101 CoreSimulatorService\n"
        names = [phase["phase"] for phase in phases]
        assert names.index("simulator-log") < names.index("apple-host-log") < names.index("host-cpu") < names.index("device-state")
        window = json.loads((results / "failure-window.json").read_text())
        assert window["source_phase"] == failure_phase
        logs = next(call["args"] for call in recorded if call["args"][:4] == ["simctl", "spawn", "new", "log"])
        assert "--last" not in logs
        assert logs[logs.index("--start") + 1] == window["start"]
        assert logs[logs.index("--end") + 1] == window["end"]
        assert all(name in logs[-1] for name in ["BuildPlay", "SpringBoard", "runningboardd", "amfid", "installd"])
        if failure_phase == "boot":
            assert not any(call["args"][:2] == ["simctl", "install"] for call in recorded)
        elif failure_phase == "fixture":
            assert not any(call["args"][:2] == ["simctl", "launch"] for call in recorded)
        else:
            assert sum(call["args"][:2] == ["simctl", "launch"] for call in recorded) == 1
    else:
        launch = next(call for call in recorded if call["args"][:2] == ["simctl", "launch"])
        assert launch["local_only"] is True
        assert (results / "screenshots" / "portal-launch.png").exists()
        expected = {"list-devices":60,"boot":600,"install":300,"launch":360,"screenshot":120,"processes":90}
        if fixture_enabled:
            expected['fixture']=60
            seed = next(index for index,call in enumerate(recorded) if call['args'][0]=='fixture')
            install = next(index for index,call in enumerate(recorded) if call['args'][:2]==['simctl','install'])
            started = next(index for index,call in enumerate(recorded) if call['args'][:2]==['simctl','launch'])
            assert install < seed < started
            assert recorded[seed]['args'][1]=='--local-only'
            assert (results/'connect4-fixture.json').exists()
        assert {phase["phase"]: phase["deadline_seconds"] for phase in phases} == expected
