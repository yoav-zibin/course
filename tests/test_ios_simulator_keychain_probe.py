"""The fast probe requires real synthetic Keychain operations, not launch alone."""
import importlib.util
from pathlib import Path
import json
import os
import plistlib
import time

import pytest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("keychain_probe", ROOT / "scripts/probe-ios-simulator-keychain.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


def success():
    return {name: {"add": 0, "copy": 0, "delete": 0, "data_equal": True} for name in ("default", "private_group")}


@pytest.mark.parametrize("scope", ["default", "private_group"])
@pytest.mark.parametrize("operation", ["add", "copy", "delete", "data_equal"])
def test_each_status_and_both_data_equalities_gate_probe_success(scope, operation):
    proof = success()
    assert probe.validate_proof(proof) == proof
    proof[scope][operation] = False if operation == "data_equal" else -34018
    with pytest.raises(ValueError, match=scope):
        probe.validate_proof(proof)


def test_missing_and_non_numeric_status_cannot_pass_as_success():
    with pytest.raises(ValueError):
        probe.validate_proof({})
    proof = success()
    proof["default"]["add"] = False
    with pytest.raises(ValueError):
        probe.validate_proof(proof)


@pytest.mark.parametrize("field,value", [("host_entitlements", {"application-identifier": "restricted"}),
    ("simulated_entitlements_embedded", False), ("architectures", ["arm64"]), ("simulator_keychain_group", "other.group")])
def test_host_and_simulated_entitlement_boundaries_gate_launch(field, value):
    signature = {"host_entitlements": {}, "simulated_entitlements_embedded": True,
        "bundle_identifier": probe.BUNDLE_ID, "architectures": list(probe.ARCHITECTURES),
        "simulator_keychain_group": "TESTTEAM00." + probe.BUNDLE_ID}
    assert probe.validate_signature(signature) == signature
    signature[field] = value
    with pytest.raises(ValueError, match="simulated XML/DER"):
        probe.validate_signature(signature)


@pytest.mark.parametrize("architecture", probe.ARCHITECTURES)
def test_compile_embeds_both_sections_only_in_simulator_targets(architecture):
    args = probe.compile_command(architecture, "/SDK with spaces", "/source.m", "/probe", "/XML with spaces", "/DER with spaces")
    assert args[args.index("-target") + 1] == architecture + "-apple-ios15.1-simulator"
    assert args.count("__TEXT") == 2
    assert "__entitlements" in args and "__ents_der" in args
    assert "/XML with spaces" in args and "/DER with spaces" in args
    assert all(name in args for name in ("UIKit", "Foundation", "Security"))
    assert "-sectcreate,__TEXT" not in " ".join(args)


def container(root, name, *, identity=probe.BUNDLE_ID, modified=None):
    path = root / "Containers/Data/Application" / name
    (path / "Documents").mkdir(parents=True)
    (path / ".com.apple.mobile_container_manager.metadata.plist").write_bytes(plistlib.dumps({"MCMMetadataIdentifier": identity}))
    result = path / "Documents/keychain-proof.json"
    result.write_text(json.dumps(success()))
    if modified is not None:
        os.utime(result, (modified, modified))
    return result


def test_owned_filesystem_proof_requires_current_launch_and_matching_container(tmp_path):
    started = time.time()
    container(tmp_path, "wrong-app", identity="other.app")
    container(tmp_path, "stale", modified=started - 60)
    expected = container(tmp_path, "current", modified=started + 1)
    assert probe.find_owned_proof(tmp_path, started) == expected


def test_duplicate_matching_proofs_fail_closed(tmp_path):
    container(tmp_path, "first")
    container(tmp_path, "second")
    with pytest.raises(ValueError, match="More than one"):
        probe.find_owned_proof(tmp_path, time.time())


def test_owned_scan_does_not_follow_a_proof_symlink_outside_its_container(tmp_path):
    owned = tmp_path / "owned"
    candidate = container(owned, "current")
    candidate.unlink()
    outside = tmp_path / "outside.json"
    outside.write_text(json.dumps(success()))
    candidate.symlink_to(outside)
    assert probe.find_owned_proof(owned, time.time()) is None


def test_proof_scan_is_bounded_by_result_size_and_container_count(tmp_path):
    candidate = container(tmp_path, "oversize")
    candidate.write_bytes(b'x' * 16_385)
    with pytest.raises(ValueError, match="byte limit"):
        probe.find_owned_proof(tmp_path, time.time())
    candidate.unlink()
    for index in range(257):
        (tmp_path / "Containers/Data/Application" / str(index)).mkdir()
    with pytest.raises(ValueError, match="inventory"):
        probe.find_owned_proof(tmp_path, time.time())
