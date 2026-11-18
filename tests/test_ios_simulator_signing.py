"""The simulator signer cannot alter real-device apps or leak app entitlements."""

import importlib.util
from pathlib import Path
import plistlib
import subprocess
import sys

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "frontends/portal/scripts/sign-ios-simulator.py"
spec = importlib.util.spec_from_file_location("simulator_signing", SCRIPT)
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


def app_fixture(tmp_path, **overrides):
    app = tmp_path / "Portal with spaces.app"
    app.mkdir()
    info = {"CFBundleIdentifier": "org.example.portal", "CFBundleExecutable": "CustomPortal",
            "CFBundleSupportedPlatforms": ["iPhoneSimulator"], "DTPlatformName": "iphonesimulator"}
    info.update(overrides)
    (app / "Info.plist").write_bytes(plistlib.dumps(info))
    (app / "CustomPortal").write_bytes(b"original binary")
    return app


@pytest.mark.parametrize("metadata", [
    {"CFBundleSupportedPlatforms": ["iPhoneOS"], "DTPlatformName": "iphoneos"},
    {"CFBundleSupportedPlatforms": ["iPhoneSimulator"], "DTPlatformName": "iphoneos"},
    {"CFBundleSupportedPlatforms": ["iPhoneOS"], "DTPlatformName": "iphonesimulator"},
    {"CFBundleSupportedPlatforms": ["iPhoneSimulator", "iPhoneOS"]},
    {"CFBundleSupportedPlatforms": "iPhoneSimulator"},
])
def test_device_or_conflicting_metadata_never_reaches_signing(tmp_path, metadata):
    app = app_fixture(tmp_path, **metadata)
    before = {p.name: p.read_bytes() for p in app.iterdir()}
    calls = []
    with pytest.raises(ValueError, match="non-iPhone-Simulator"):
        signing.sign_simulator(app, run=lambda *args, **kwargs: calls.append(args))
    assert calls == []
    assert {p.name: p.read_bytes() for p in app.iterdir()} == before


def test_missing_platform_metadata_and_escaping_executable_are_rejected(tmp_path):
    app = app_fixture(tmp_path)
    info = plistlib.loads((app / "Info.plist").read_bytes())
    del info["CFBundleSupportedPlatforms"], info["DTPlatformName"]
    (app / "Info.plist").write_bytes(plistlib.dumps(info))
    with pytest.raises(ValueError, match="non-iPhone-Simulator"):
        signing.simulator_metadata(app)
    info.update({"DTPlatformName": "iphonesimulator", "CFBundleExecutable": "../outside"})
    (app / "Info.plist").write_bytes(plistlib.dumps(info))
    with pytest.raises(ValueError, match="filename inside"):
        signing.simulator_metadata(app)


def fake_apple_tools(calls, *, architectures="x86_64 arm64", wrong_entitlement=False):
    def run(arguments, **options):
        assert options == {"check": True, "capture_output": True, "text": True, "timeout": 120}
        calls.append(list(arguments))
        output = ""
        if arguments[0] == signing.LIPO:
            assert Path(arguments[-1]).name == "CustomPortal"
            output = architectures
        elif "--force" in arguments and "--entitlements" in arguments:
            path = Path(arguments[arguments.index("--entitlements") + 1])
            run.entitlements = plistlib.loads(path.read_bytes())
            run.temporary_path = path
        elif "--display" in arguments:
            entitlements = dict(run.entitlements)
            if wrong_entitlement:
                entitlements["keychain-access-groups"] = ["another.group"]
            output = plistlib.dumps(entitlements).decode()
        return subprocess.CompletedProcess(arguments, 0, output, "")
    return run


def test_inside_out_signing_uses_actual_identity_and_verifies_both_slices(tmp_path):
    app = app_fixture(tmp_path)
    outer = app / "Frameworks/Outer.framework"
    inner = outer / "Frameworks/Inner.framework"
    inner.mkdir(parents=True)
    dylib = app / "Frameworks/standalone.dylib"
    dylib.write_bytes(b"library")
    calls = []
    runner = fake_apple_tools(calls)
    result = signing.sign_simulator(app, run=runner)
    signed = [call for call in calls if "--force" in call]
    assert [Path(call[-1]) for call in signed] == [inner, outer, dylib, app]
    for call in signed[:-1]:
        assert "--entitlements" not in call
        assert "--deep" not in call
        assert call[call.index("--sign") + 1] == "-"
    assert "--generate-entitlement-der" in signed[-1]
    assert signed[-1][signed[-1].index("--identifier") + 1] == "org.example.portal"
    assert runner.entitlements == {
        "application-identifier": "TESTTEAM00.org.example.portal",
        "keychain-access-groups": ["TESTTEAM00.org.example.portal"],
    }
    assert not runner.temporary_path.exists()
    for operation in ("--verify", "--display"):
        matching = [call for call in calls if operation in call]
        assert {call[call.index("--arch") + 1] for call in matching} == {"arm64", "x86_64"}
    assert result["nested_code_signed"] == 3
    assert (app / "CustomPortal").read_bytes() == b"original binary"


def test_thin_or_incorrectly_signed_artifact_cannot_be_packaged_as_verified(tmp_path):
    app = app_fixture(tmp_path)
    calls = []
    with pytest.raises(ValueError, match="arm64 and x86_64"):
        signing.sign_simulator(app, run=fake_apple_tools(calls, architectures="x86_64"))
    assert len(calls) == 1 and calls[0][0] == signing.LIPO
    with pytest.raises(ValueError, match="unexpected Keychain entitlements"):
        signing.sign_simulator(app, run=fake_apple_tools([], wrong_entitlement=True))


def test_external_nested_code_is_rejected_before_any_tool_can_mutate_it(tmp_path):
    app = app_fixture(tmp_path)
    outside = tmp_path / "device-library.dylib"
    outside.write_bytes(b"physical app library")
    (app / "external.dylib").symlink_to(outside)
    calls = []
    with pytest.raises(ValueError, match="outside its app"):
        signing.sign_simulator(app, run=lambda *args, **kwargs: calls.append(args))
    assert calls == []
    assert outside.read_bytes() == b"physical app library"


def test_cli_preserves_signing_failure_reason_and_returns_failure(tmp_path, monkeypatch, capsys):
    app = app_fixture(tmp_path)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), str(app)])

    def fail(_app):
        raise subprocess.CalledProcessError(1, [signing.CODESIGN], stderr="nested framework signature failed")

    monkeypatch.setattr(signing, "sign_simulator", fail)
    assert signing.main() == 1
    assert "nested framework signature failed" in capsys.readouterr().err
