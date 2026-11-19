"""Exercise Play artifact checks using real JAR signatures and synthetic data."""

import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
from zipfile import ZipFile

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/play_bundle.py"
SPEC = importlib.util.spec_from_file_location("play_bundle", SCRIPT)
bundle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bundle)


def varint(value):
    result = bytearray()
    while value >= 128:
        result.append((value & 127) | 128)
        value >>= 7
    result.append(value)
    return bytes(result)


def field(number, value):
    if isinstance(value, int):
        return varint(number << 3) + varint(value)
    if isinstance(value, str):
        value = value.encode()
    return varint((number << 3) | 2) + varint(len(value)) + value


def manifest(package="fun.buildplay", version=301, raw_version=None, major=False):
    package_attribute = field(2, "package") + field(3, package)
    version_attribute = (field(1, bundle.ANDROID_NAMESPACE) + field(2, "versionCode")
                         + field(3, str(version) if raw_version is None else raw_version)
                         + field(6, field(7, field(6, version))))
    root = field(3, "manifest") + field(4, package_attribute) + field(4, version_attribute)
    if major:
        root += field(4, field(1, bundle.ANDROID_NAMESPACE) + field(2, "versionCodeMajor")
                      + field(3, "1") + field(6, field(7, field(6, 1))))
    return field(1, root)


def contents():
    files = {
        "base/": b"",  # Unsigned directory bookkeeping is legitimate.
        "base/manifest/AndroidManifest.xml": manifest(),
        "base/assets/app.config": json.dumps({"android": {"package": "fun.buildplay", "versionCode": 301},
                                             "extra": {"apiUrl": bundle.API_URL}}).encode(),
        "base/assets/index.android.bundle": b"synthetic Hermes JavaScript " + bundle.API_URL.encode(),
    }
    for abi, (elf_class, machine) in bundle.RUNTIME_ABIS.items():
        files[f"base/lib/{abi}/libbuildplay-runtime.so"] = (
            b"\x7fELF" + bytes((elf_class, 1, 1)) + b"\x00" * 9 + b"\x03\x00" + machine.to_bytes(2, "little"))
    return files


@pytest.fixture(scope="module")
def signing_key(tmp_path_factory):
    if not shutil.which("keytool") or not shutil.which("java"):
        pytest.skip("A Java runtime with keytool is required for signature integration tests")
    directory = tmp_path_factory.mktemp("play-artifact-signing")
    key = directory / "synthetic.p12"
    result = subprocess.run(["keytool", "-genkeypair", "-keystore", str(key), "-storepass", "synthetic-password",
                             "-alias", "synthetic", "-keyalg", "RSA", "-keysize", "2048", "-validity", "2",
                             "-dname", "CN=Synthetic Play artifact tests", "-noprompt"],
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    return key


@pytest.fixture
def artifact(tmp_path, signing_key):
    count = 0

    def build(files=None, signed=True):
        nonlocal count
        count += 1
        path = tmp_path / f"BuildPlay-{count}.aab"
        with ZipFile(path, "w") as archive:
            for name, data in (contents() if files is None else files).items():
                archive.writestr(name, data)
        if signed:
            result = subprocess.run([*bundle._jarsigner_command(), "-keystore", str(signing_key),
                                     "-storepass", "synthetic-password", str(path), "synthetic"],
                                    capture_output=True, text=True, timeout=60)
            assert result.returncode == 0, result.stderr
        return path

    return build


def test_signed_complete_production_artifact_returns_exact_hash(artifact):
    path = artifact()
    assert bundle.validate_bundle(path, 301) == hashlib.sha256(path.read_bytes()).hexdigest()


@pytest.mark.parametrize(("package", "version", "error"), [
    ("fun.buildplay.debug", 301, "manifest package"),
    ("fun.buildplay", 302, "manifest versionCode"),
])
def test_native_manifest_identity_overrides_valid_expo_config(artifact, package, version, error):
    files = contents()
    files["base/manifest/AndroidManifest.xml"] = manifest(package, version)
    with pytest.raises(ValueError, match=error):
        bundle.validate_bundle(artifact(files), 301)


def test_manifest_compiled_version_cannot_hide_behind_expected_raw_text(artifact):
    files = contents()
    files["base/manifest/AndroidManifest.xml"] = manifest(version=302, raw_version="301")
    with pytest.raises(ValueError, match="text and compiled value differ"):
        bundle.validate_bundle(artifact(files, signed=False), 301)


def test_unexpected_long_version_code_is_rejected(artifact):
    files = contents()
    files["base/manifest/AndroidManifest.xml"] = manifest(major=True)
    with pytest.raises(ValueError, match="versionCodeMajor"):
        bundle.validate_bundle(artifact(files, signed=False), 301)


@pytest.mark.parametrize(("section", "key", "value", "error"), [
    ("android", "package", "fun.buildplay.debug", "app.config package"),
    ("android", "versionCode", 302, "app.config versionCode"),
    ("android", "versionCode", "301", "app.config versionCode"),
    ("extra", "apiUrl", "https://staging.buildplay.fun", "API URL"),
])
def test_embedded_config_matches_the_production_build(artifact, section, key, value, error):
    files = contents()
    config = json.loads(files["base/assets/app.config"])
    config[section][key] = value
    files["base/assets/app.config"] = json.dumps(config).encode()
    with pytest.raises(ValueError, match=error):
        bundle.validate_bundle(artifact(files, signed=False), 301)


@pytest.mark.parametrize("name", ["base/assets/index.android.bundle", *[
    f"base/lib/{abi}/libbuildplay-runtime.so" for abi in bundle.RUNTIME_ABIS]])
def test_every_embedded_runtime_component_is_required(artifact, name):
    files = contents()
    del files[name]
    with pytest.raises(ValueError, match="missing"):
        bundle.validate_bundle(artifact(files, signed=False), 301)


def test_native_runtime_must_be_the_correct_abi(artifact):
    files = contents()
    files["base/lib/arm64-v8a/libbuildplay-runtime.so"] = files["base/lib/x86_64/libbuildplay-runtime.so"]
    with pytest.raises(ValueError, match="invalid ELF ABI for arm64-v8a"):
        bundle.validate_bundle(artifact(files, signed=False), 301)


def test_missing_production_url_in_embedded_javascript_is_rejected(artifact):
    files = contents()
    files["base/assets/index.android.bundle"] = b"synthetic JavaScript for a different backend"
    with pytest.raises(ValueError, match="embedded JavaScript"):
        bundle.validate_bundle(artifact(files, signed=False), 301)


def test_completely_unsigned_artifact_is_rejected(artifact):
    with pytest.raises(ValueError, match="signature"):
        bundle.validate_bundle(artifact(signed=False), 301)


def test_unsigned_entry_added_to_a_signed_artifact_is_rejected(artifact):
    path = artifact()
    with ZipFile(path, "a") as archive:
        archive.writestr("base/assets/unsigned.txt", "unsigned addition")
    with pytest.raises(ValueError, match="unsigned entries"):
        bundle.validate_bundle(path, 301)


def test_modified_signed_payload_is_rejected_even_with_matching_config(artifact):
    path = artifact()
    with ZipFile(path) as archive:
        files = {entry.filename: archive.read(entry) for entry in archive.infolist()}
    files["base/assets/index.android.bundle"] += b"; tampered payload"
    path = artifact(files, signed=False)
    with pytest.raises(ValueError, match="signature"):
        bundle.validate_bundle(path, 301)


def test_duplicate_archive_entry_is_rejected(artifact):
    path = artifact(signed=False)
    with pytest.warns(UserWarning, match="Duplicate name"):
        with ZipFile(path, "a") as archive:
            archive.writestr("base/assets/app.config", contents()["base/assets/app.config"])
    with pytest.raises(ValueError, match="duplicate archive"):
        bundle.validate_bundle(path, 301)


@pytest.mark.parametrize("data", [b"\x0a\xff", b"\x00", b"\x0a\x05x", b"\x0b", b"\x0a\x00\x0a\x00"])
def test_malformed_or_ambiguous_native_manifest_is_rejected(artifact, data):
    files = contents()
    files["base/manifest/AndroidManifest.xml"] = data
    with pytest.raises(ValueError, match="manifest|protobuf"):
        bundle.validate_bundle(artifact(files, signed=False), 301)


@pytest.mark.parametrize("version", [True, 0, -1, 2_100_000_001, "301"])
def test_invalid_expected_version_is_rejected_before_opening_artifact(version):
    with pytest.raises(ValueError, match="Play range"):
        bundle.validate_bundle("does-not-exist.aab", version)
