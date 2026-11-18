#!/usr/bin/env python3
"""Manual, simulator-only controls for one immutable, trusted BuildPlay artifact.

No app source, canonical artifact, production signing, provider secrets or real
device data are changed. A successful alternative is diagnostic evidence only.
"""

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import zipfile


REPOSITORY = "yoav-zibin/course"
RUN_ID = 44413435121
ARTIFACT_ID = 14481145602
SOURCE_SHA = "d1c48c87f0b0e640aabdc0f0b45f4f5a6b31969a"
ARTIFACT_DIGEST = "sha256:71c407fa23f70ba5cfe6e8c3c31ff5f1250138d53d17a4b9788bb425437dbb82"
ARCHIVE_SHA256 = "9068a08989eaf417cbe0418f8aae0c630353f4b9740cd338ae8a3548390829e3"
SCRIPTS = Path(__file__).resolve().parents[1] / "frontends/portal/scripts"


def load_script(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_provenance(data):
    run, artifact = data["run"], data["artifact"]
    if (run["id"] != RUN_ID or run["head_sha"] != SOURCE_SHA
            or run["repository"]["full_name"] != REPOSITORY
            or run["head_repository"]["full_name"] != REPOSITORY
            or run["event"] != "push" or run["head_branch"] != "main"
            or artifact["id"] != ARTIFACT_ID or artifact["name"] != "BuildPlay-ios-simulator"
            or artifact["expired"] or artifact["digest"] != ARTIFACT_DIGEST
            or artifact["workflow_run"]["id"] != RUN_ID
            or artifact["workflow_run"]["head_sha"] != SOURCE_SHA):
        raise ValueError("Artifact provenance does not match the pinned trusted d1 build")


def fetch_provenance(output):
    def read(path):
        return json.loads(subprocess.check_output(["gh", "api", path], text=True, timeout=60))
    data = {"run": read(f"repos/{REPOSITORY}/actions/runs/{RUN_ID}"),
            "artifact": read(f"repos/{REPOSITORY}/actions/artifacts/{ARTIFACT_ID}")}
    validate_provenance(data)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, indent=2) + "\n")


def validate_archive(archive):
    with zipfile.ZipFile(archive) as bundle:
        for item in bundle.infolist():
            name = PurePosixPath(item.filename)
            if name.is_absolute() or ".." in name.parts:
                raise ValueError("Archive has an escaping path")
            if stat.S_ISLNK(item.external_attr >> 16):
                target = PurePosixPath(bundle.read(item).decode())
                depth = 0
                if target.is_absolute():
                    raise ValueError("Archive has an absolute symlink")
                for part in (*name.parent.parts, *target.parts):
                    depth += -1 if part == ".." else 0 if part == "." else 1
                    if depth < 0:
                        raise ValueError("Archive symlink escapes its extraction directory")


def trusted_archive_hash(archive):
    value = hashlib.sha256(archive.read_bytes()).hexdigest()
    if value != ARCHIVE_SHA256:
        raise ValueError("Downloaded simulator archive does not match the verified trusted payload")
    return value


def variant_entitlements(name, original):
    if name in ("original", "original-recheck"):
        return None
    if name == "app-id-only":
        # Apple's default private Keychain group remains this same app ID when
        # no explicit sharing group is requested. This is a controlled probe.
        return {"application-identifier": original["application-identifier"]}
    if name == "empty-control":
        return {}
    raise ValueError("Unknown diagnostic signature variant")


def copy_variant(canonical, destination):
    if destination.exists():
        raise ValueError("Diagnostic variant destination must be fresh")
    shutil.copytree(canonical, destination, symlinks=True)


def apple_time(value):
    return value.astimezone(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S%z")


def diagnose(archive, output, provenance):
    validate_provenance(json.loads(provenance.read_text()))
    validate_archive(archive)
    archive_hash = trusted_archive_hash(archive)
    output.mkdir(parents=True, exist_ok=True)
    phase = load_script("run-ios-smoke-phase").run_phase
    signing = load_script("sign-ios-simulator")
    selector = load_script("select-ios-simulator").select_simulator
    summary = {"source_sha": SOURCE_SHA, "artifact_id": ARTIFACT_ID,
               "canonical_archive_sha256": archive_hash, "variants": []}

    def run(label, timeout, argv, *, tail=False):
        options = {"retain_tail": True} if tail else {}
        return phase(label, timeout, output / f"{label}.log", list(map(str, argv)), **options)

    def require(label, timeout, argv):
        if run(label, timeout, argv):
            raise RuntimeError(f"{label} failed; inspect its bounded phase log")
        return (output / f"{label}.log").read_text().strip()

    def launch_logs(label, start):
        end = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=2)
        window = ["--start", apple_time(start - dt.timedelta(seconds=2)), "--end", apple_time(end)]
        host = 'process == "amfid" OR process == "taskgated-helper" OR process == "syspolicyd" OR process == "launchd_sim" OR process == "CoreSimulatorService" OR (process == "kernel" AND (eventMessage CONTAINS[c] "signature" OR eventMessage CONTAINS[c] "entitle" OR eventMessage CONTAINS[c] "BuildPlay"))'
        simulator = 'process == "BuildPlay" OR process == "SpringBoard" OR process == "runningboardd" OR process == "amfid" OR process == "launchd" OR process == "securityd"'
        # Capture the actual launch interval first, before inventories, process
        # listings or screenshots can consume the diagnostic deadline.
        run(f"{label}-host-window", 60, ["/usr/bin/log", "show", *window, "--style", "compact", "--info", "--debug", "--predicate", host], tail=True)
        run(f"{label}-sim-window", 60, ["xcrun", "simctl", "spawn", simulator_id, "log", "show", *window, "--style", "compact", "--info", "--debug", "--predicate", simulator], tail=True)

    def crash_reports(label, start):
        roots = [Path.home() / "Library/Logs/DiagnosticReports",
                 Path.home() / f"Library/Developer/CoreSimulator/Devices/{simulator_id}/data/Library/Logs/CrashReporter"]
        destination = output / f"{label}-crashes"
        for index, root in enumerate(roots):
            for report in list(root.glob(f"{binary.name}*.ips"))[:8]:
                if report.is_file() and report.stat().st_mtime >= start.timestamp() - 2 and report.stat().st_size <= 2_000_000:
                    destination.mkdir(exist_ok=True)
                    shutil.copyfile(report, destination / f"{index}-{report.name}")

    with tempfile.TemporaryDirectory(prefix="buildplay-ios-diagnostic-") as temporary:
        workspace = Path(temporary)
        require("unpack", 90, ["ditto", "-x", "-k", archive, workspace / "canonical"])
        canonical, bundle_id, binary = signing.simulator_metadata(workspace / "canonical/BuildPlay.app")
        canonical_binary_hash = hashlib.sha256(binary.read_bytes()).hexdigest()
        require("canonical-verify", 60, [signing.CODESIGN, "--verify", "--deep", "--strict", "--all-architectures", canonical])
        xml = require("canonical-entitlements", 30, [signing.CODESIGN, "--display", "--entitlements", "-", "--xml", canonical])
        original = signing.read_entitlements(subprocess.CompletedProcess([], 0, xml, ""))
        (output / "canonical-entitlements.plist").write_bytes(plistlib.dumps(original))
        sdk = Path(require("sdk-path", 30, ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"]))
        platform = Path(require("platform-path", 30, ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-platform-path"]))
        templates = output / "xcode-simulator-templates"
        templates.mkdir()
        for index, source in enumerate([platform / "Entitlements.plist", platform / "Developer/Entitlements.plist",
                                        sdk / "Entitlements.plist", sdk / "SDKSettings.plist", sdk / "SDKSettings.json"]):
            if source.is_file() and source.stat().st_size <= 1_000_000:
                shutil.copyfile(source, templates / f"{index}-{source.name}")
        require("xcode-first-launch", 600, ["sudo", "xcodebuild", "-runFirstLaunch"])
        require("runtime-caches", 600, ["xcrun", "simctl", "runtime", "dyld_shared_cache", "update", "--all"])
        devices = require("devices", 60, ["xcrun", "simctl", "list", "devices", "available", "--json"])
        device_data = json.loads(devices)
        selected = selector(device_data)
        device = next(d for records in device_data["devices"].values() for d in records if d["udid"] == selected["udid"])
        simulator_id = require("create", 60, ["xcrun", "simctl", "create", "BuildPlay isolated diagnostics", device.get("deviceTypeIdentifier") or device["name"], selected["runtime"]])
        summary["simulator"] = {**selected, "diagnostic_udid": simulator_id}
        (output / "simulator.json").write_text(json.dumps(summary["simulator"], indent=2))
        try:
            require("boot", 600, ["xcrun", "simctl", "bootstatus", simulator_id, "-b"])
            control_start = dt.datetime.now(dt.timezone.utc)
            control = run("preferences-control", 180, ["xcrun", "simctl", "launch", simulator_id, "com.apple.Preferences"])
            summary["preferences_control_exit_code"] = control
            launch_logs("preferences-control", control_start)
            variants = ["original", "app-id-only", "empty-control"]
            for name in variants:
                if name != "original" and control:
                    summary["variants_skipped"] = "Preferences readiness control failed; signatures were not varied"
                    break
                variant = workspace / "variants" / name / "BuildPlay.app"
                copy_variant(canonical, variant)
                signing.simulator_metadata(variant)
                entitlements = variant_entitlements(name, original)
                if entitlements is not None:
                    file = workspace / f"{name}.entitlements"
                    file.write_bytes(plistlib.dumps(entitlements))
                    require(f"{name}-sign", 60, [signing.CODESIGN, "--force", "--sign", "-", "--timestamp=none", "--generate-entitlement-der", "--entitlements", file, variant])
                require(f"{name}-verify", 60, [signing.CODESIGN, "--verify", "--deep", "--strict", "--all-architectures", variant])
                require(f"{name}-entitlements", 30, [signing.CODESIGN, "--display", "--entitlements", "-", "--xml", variant])
                run(f"{name}-uninstall", 60, ["xcrun", "simctl", "uninstall", simulator_id, bundle_id])
                require(f"{name}-install", 300, ["xcrun", "simctl", "install", simulator_id, variant])
                installed = require(f"{name}-installed-container", 30, ["xcrun", "simctl", "get_app_container", simulator_id, bundle_id, "app"])
                signing.simulator_metadata(Path(installed))
                require(f"{name}-installed-signature", 60, [signing.CODESIGN, "--verify", "--deep", "--strict", "--all-architectures", installed])
                require(f"{name}-installed-entitlements", 30, [signing.CODESIGN, "--display", "--entitlements", "-", "--xml", installed])
                start = dt.datetime.now(dt.timezone.utc)
                old_gate = os.environ.get("SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST")
                os.environ["SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST"] = "1"
                try:
                    status = run(f"{name}-launch", 180, ["xcrun", "simctl", "launch", "--terminate-running-process", simulator_id, bundle_id])
                finally:
                    if old_gate is None:
                        os.environ.pop("SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST", None)
                    else:
                        os.environ["SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST"] = old_gate
                launch_logs(name, start)
                crash_reports(name, start)
                record = {"variant": name, "launch_exit_code": status, "entitlements": original if entitlements is None else entitlements,
                          "installed_binary_matches_variant": hashlib.sha256((Path(installed) / binary.name).read_bytes()).digest() == hashlib.sha256((variant / binary.name).read_bytes()).digest()}
                summary["variants"].append(record)
                if not status:
                    time.sleep(8)
                    run(f"{name}-screenshot", 45, ["xcrun", "simctl", "io", simulator_id, "screenshot", output / f"{name}.png"])
                    run(f"{name}-processes", 30, ["xcrun", "simctl", "spawn", simulator_id, "launchctl", "list"])
                (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
                if name == "original" and not status:
                    break
                if name in ("app-id-only", "empty-control") and not status and "original-recheck" not in variants:
                    # A later success may simply mean SpringBoard became ready.
                    # Reinstall an untouched original copy once after controls;
                    # never infer an entitlement fix from sequence alone.
                    variants.append("original-recheck")
        finally:
            summary["canonical_unchanged"] = hashlib.sha256(binary.read_bytes()).hexdigest() == canonical_binary_hash and hashlib.sha256(archive.read_bytes()).hexdigest() == archive_hash
            (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
            run("shutdown", 30, ["xcrun", "simctl", "shutdown", simulator_id])
            run("delete", 30, ["xcrun", "simctl", "delete", simulator_id])
        if not summary["canonical_unchanged"]:
            raise RuntimeError("Canonical artifact changed during diagnostics")
    return 0 if summary["variants"] and summary["variants"][0]["launch_exit_code"] == 0 else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    provenance = commands.add_parser("provenance")
    provenance.add_argument("output", type=Path)
    diagnostic = commands.add_parser("diagnose")
    diagnostic.add_argument("archive", type=Path)
    diagnostic.add_argument("output", type=Path)
    diagnostic.add_argument("--provenance", required=True, type=Path)
    args = parser.parse_args()
    try:
        if args.command == "provenance":
            fetch_provenance(args.output)
            return 0
        return diagnose(args.archive.resolve(), args.output.resolve(), args.provenance)
    except (KeyError, ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Simulator diagnostics stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
