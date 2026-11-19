"""The simulator signer cannot alter real-device apps or leak app entitlements."""

import importlib.util
from pathlib import Path
import plistlib
import subprocess
import struct
import sys

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "frontends/portal/scripts/sign-ios-simulator.py"
spec = importlib.util.spec_from_file_location("simulator_signing", SCRIPT)
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


def simulated_binary(identifier='org.example.portal', *, der=b'simulated-der', overrides=None, embedded=True):
    values = signing.simulated_entitlements(identifier)
    slices = []
    for cpu, architecture in [(0x0100000C, 'arm64'), (0x01000007, 'x86_64')]:
        xml = plistlib.dumps((overrides or {}).get(architecture, values))
        contents = [('__entitlements', xml), ('__ents_der', der)] if embedded else []
        command_size = 72 + 80 * len(contents)
        cursor = 32 + command_size
        sections = b''
        payload = b''
        for name, content in contents:
            sections += struct.pack('<16s16sQQIIIIIIII', name.encode(), b'__TEXT', 0, len(content), cursor, 0, 0, 0, 0, 0, 0, 0)
            cursor += len(content)
            payload += content
        header = struct.pack('<IIIIIIII', 0xFEEDFACF, cpu, 0, 2, 1, command_size, 0, 0)
        segment = struct.pack('<II16sQQQQiiII', 0x19, command_size, b'__TEXT', 0, cursor, 0, cursor, 7, 5, len(contents), 0)
        slices.append((cpu, header + segment + sections + payload))
    offset = 48
    table = b''
    for cpu, content in slices:
        table += struct.pack('>IIIII', cpu, 0, offset, len(content), 0)
        offset += len(content)
    return struct.pack('>II', 0xCAFEBABE, 2) + table + b''.join(content for _, content in slices)


def app_fixture(tmp_path, **overrides):
    app = tmp_path / "Portal with spaces.app"
    app.mkdir()
    info = {"CFBundleIdentifier": "org.example.portal", "CFBundleExecutable": "CustomPortal",
            "CFBundleSupportedPlatforms": ["iPhoneSimulator"], "DTPlatformName": "iphonesimulator"}
    info.update(overrides)
    (app / "Info.plist").write_bytes(plistlib.dumps(info))
    (app / "CustomPortal").write_bytes(simulated_binary(info['CFBundleIdentifier']))
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
        elif arguments[0] == '/usr/bin/derq':
            Path(arguments[arguments.index('-o') + 1]).write_bytes(b'simulated-der')
        elif "--force" in arguments and "--entitlements" in arguments:
            path = Path(arguments[arguments.index("--entitlements") + 1])
            run.entitlements = plistlib.loads(path.read_bytes())
            run.temporary_path = path
        elif "--display" in arguments:
            entitlements = dict(run.entitlements)
            if wrong_entitlement:
                entitlements["keychain-access-groups"] = ["another.group"]
            # Current macOS defaults to an abstract DER representation; only
            # --xml promises the plist format consumed by the signer.
            output = plistlib.dumps(entitlements).decode() if "--xml" in arguments else "[Dict] [application-identifier] [String]"
        return subprocess.CompletedProcess(arguments, 0, output, "")
    return run


def test_inside_out_signing_uses_actual_identity_and_verifies_both_slices(tmp_path):
    app = app_fixture(tmp_path)
    original_binary = (app / 'CustomPortal').read_bytes()
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
    assert runner.entitlements == {}
    assert not runner.temporary_path.exists()
    for operation in ("--verify", "--display"):
        matching = [call for call in calls if operation in call]
        assert {call[call.index("--arch") + 1] for call in matching} == {"arm64", "x86_64"}
        if operation == "--display":
            assert all("--xml" in call for call in matching)
    assert result["nested_code_signed"] == 3
    assert result['simulated_entitlements_embedded'] is True
    assert (app / "CustomPortal").read_bytes() == original_binary


def test_thin_or_incorrectly_signed_artifact_cannot_be_packaged_as_verified(tmp_path):
    app = app_fixture(tmp_path)
    calls = []
    with pytest.raises(ValueError, match="arm64 and x86_64"):
        signing.sign_simulator(app, run=fake_apple_tools(calls, architectures="x86_64"))
    assert len(calls) == 1 and calls[0][0] == signing.LIPO
    with pytest.raises(ValueError, match="must not claim restricted iOS entitlements"):
        signing.sign_simulator(app, run=fake_apple_tools([], wrong_entitlement=True))


@pytest.mark.parametrize('architecture', ['arm64', 'x86_64'])
def test_each_architecture_requires_exact_linker_embedded_identity(tmp_path, architecture):
    app = app_fixture(tmp_path)
    (app / 'CustomPortal').write_bytes(simulated_binary(overrides={architecture: {'application-identifier': 'other.app'}}))
    calls = []
    with pytest.raises(ValueError, match='linker-embedded simulator entitlements do not match'):
        signing.sign_simulator(app, run=fake_apple_tools(calls))
    assert not any('--force' in call for call in calls)


def test_missing_or_invalid_der_sections_cannot_be_hidden_by_host_signing(tmp_path):
    app = app_fixture(tmp_path)
    calls = []
    (app / 'CustomPortal').write_bytes(simulated_binary(embedded=False))
    with pytest.raises(ValueError, match='missing linker-embedded'):
        signing.sign_simulator(app, run=fake_apple_tools(calls))
    (app / 'CustomPortal').write_bytes(simulated_binary(der=b'wrong-DER'))
    with pytest.raises(ValueError, match='linker-embedded simulator entitlements do not match'):
        signing.sign_simulator(app, run=fake_apple_tools(calls))
    assert not any('--force' in call for call in calls)


def test_macho_sections_reject_out_of_bounds_slices(tmp_path):
    binary = tmp_path / 'binary'
    valid = simulated_binary()
    binary.write_bytes(valid)
    assert set(signing.entitlement_sections(binary)) == {'arm64', 'x86_64'}
    malformed = bytearray(valid)
    struct.pack_into('>I', malformed, 16, len(valid) + 1)
    binary.write_bytes(malformed)
    with pytest.raises(ValueError, match='architecture range'):
        signing.entitlement_sections(binary)


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
