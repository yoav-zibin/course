"""Validate the signed Android artifact before opening a Google Play edit.

The AAB manifest is AAPT2's protobuf XML, not text XML. Only the root fields
needed here are decoded, using the wire numbers in AOSP's Resources.proto:
https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/tools/aapt2/Resources.proto
No network download or Android SDK is needed to inspect an artifact.
"""

import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from zipfile import BadZipFile, ZipFile


PACKAGE = "fun.buildplay"
API_URL = "https://buildplay.fun"
ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"
# (ELF class, e_machine), following the Android NDK ABI definitions.
RUNTIME_ABIS = {"armeabi-v7a": (1, 40), "arm64-v8a": (2, 183),
                "x86": (1, 3), "x86_64": (2, 62)}


def _varint(data, offset):
    value = 0
    for shift in range(0, 70, 7):
        if offset >= len(data):
            break
        byte = data[offset]
        offset += 1
        if shift == 63 and byte > 1:
            break
        value |= (byte & 127) << shift
        if byte < 128:
            return value, offset
    raise ValueError("Malformed Android manifest protobuf varint")


def _fields(data):
    """Read a bounded message without interpreting or recursively walking XML."""
    result = {}
    offset = 0
    while offset < len(data):
        key, offset = _varint(data, offset)
        number, wire = key >> 3, key & 7
        if number == 0 or number >= 1 << 29:
            raise ValueError("Malformed Android manifest protobuf field")
        if wire == 0:
            value, offset = _varint(data, offset)
        else:
            if wire == 2:
                size, offset = _varint(data, offset)
            elif wire in (1, 5):
                size = 8 if wire == 1 else 4
            else:
                raise ValueError("Unsupported Android manifest protobuf wire type")
            end = offset + size
            if end > len(data):
                raise ValueError("Truncated Android manifest protobuf field")
            value, offset = data[offset:end], end
        result.setdefault(number, []).append((wire, value))
    return result


def _one(fields, number, wire=2, default=None):
    values = fields.get(number, [])
    if not values:
        return default
    if len(values) != 1 or values[0][0] != wire:
        raise ValueError("Ambiguous Android manifest protobuf field")
    return values[0][1]


def _text(fields, number):
    try:
        return _one(fields, number, default=b"").decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("Malformed Android manifest text") from error


def _manifest_identity(data):
    node = _fields(data)
    element = _one(node, 1)
    if element is None or 2 in node:
        raise ValueError("Android manifest has no root element")
    root = _fields(element)
    if _text(root, 3) != "manifest" or _text(root, 2):
        raise ValueError("Android manifest root is not manifest")
    attributes = {}
    for wire, value in root.get(4, []):
        if wire != 2:
            raise ValueError("Malformed Android manifest attribute")
        attribute = _fields(value)
        key = (_text(attribute, 1), _text(attribute, 2))
        if key in attributes:
            raise ValueError("Duplicate Android manifest attribute")
        attributes[key] = attribute
    package = _text(attributes.get(("", "package"), {}), 3)
    version = attributes.get((ANDROID_NAMESPACE, "versionCode"), {})
    # AAPT2's compiled value is authoritative; checking the raw text alone can
    # accept a different version from the one Android/Google Play installs.
    compiled = _one(version, 6)
    primitive = _one(_fields(compiled), 7) if compiled is not None else None
    primitive_fields = _fields(primitive) if primitive is not None else {}
    if len(primitive_fields) != 1 or not ({6, 7} & primitive_fields.keys()):
        raise ValueError("Android manifest versionCode is not a compiled integer")
    version_code = _one(primitive_fields, next(iter(primitive_fields)), wire=0)
    raw_version = _text(version, 3)
    if raw_version and raw_version not in (str(version_code), hex(version_code)):
        raise ValueError("Android manifest versionCode text and compiled value differ")
    major = attributes.get((ANDROID_NAMESPACE, "versionCodeMajor"))
    if major is not None:
        # BuildPlay uses ordinary Play version codes; do not silently accept a
        # different longVersionCode from an unexpected versionCodeMajor.
        raise ValueError("Android manifest unexpectedly declares versionCodeMajor")
    return package, version_code


def _read(archive, name, limit):
    try:
        entry = archive.getinfo(name)
    except KeyError as error:
        raise ValueError(f"Android bundle is missing {name}") from error
    if entry.file_size == 0 or entry.file_size > limit:
        raise ValueError(f"Android bundle has an empty or oversized {name}")
    return archive.read(entry)


def _jarsigner_command():
    if executable := shutil.which("jarsigner"):
        return [executable, "-J-Duser.language=en", "-J-Duser.country=US"]
    # Some minimal JRE installations include the jartool module without the
    # jarsigner launcher. CI uses a full JDK, but local verification can use it.
    if executable := shutil.which("java"):
        return [executable, "-Duser.language=en", "-Duser.country=US", "-m",
                "jdk.jartool/sun.security.tools.jarsigner.Main"]
    raise ValueError("Java jarsigner is required to verify the Android bundle")


def _verify_signature(path):
    try:
        result = subprocess.run([*_jarsigner_command(), "-verify", "-strict", str(path)],
                                capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError("Could not verify Android bundle signature") from error
    # Jarsigner strict warning bits: 4 includes the expected self-signed upload
    # certificate, 16 means unsigned content. Never accept the latter. Ordinary
    # ZIP directory entries and the signature bookkeeping are handled by Java.
    # https://docs.oracle.com/en/java/javase/21/docs/specs/man/jarsigner.html
    if result.returncode not in (0, 4) or not re.search(r"^jar verified[.,]", result.stdout, re.MULTILINE):
        raise ValueError("Android bundle signature is invalid, missing, or has unsigned entries")


def validate_bundle(path, expected_version: int) -> str:
    """Return SHA-256 only after the artifact's production identity is verified."""
    if type(expected_version) is not int or not 1 <= expected_version <= 2_100_000_000:
        raise ValueError("Expected Android version code is outside the Play range")
    path = Path(path).resolve()
    try:
        with ZipFile(path) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError("Android bundle has duplicate archive entries")
            package, version = _manifest_identity(_read(archive, "base/manifest/AndroidManifest.xml", 2 << 20))
            if package != PACKAGE:
                raise ValueError(f"Android manifest package must be {PACKAGE}")
            if version != expected_version:
                raise ValueError("Android manifest versionCode does not match the requested version")
            config = json.loads(_read(archive, "base/assets/app.config", 1 << 20))
            if not isinstance(config, dict):
                raise ValueError("Android bundle app.config must be an object")
            android, extra = config.get("android"), config.get("extra")
            if not isinstance(android, dict) or android.get("package") != PACKAGE:
                raise ValueError(f"Android bundle app.config package must be {PACKAGE}")
            if type(android.get("versionCode")) is not int or android["versionCode"] != expected_version:
                raise ValueError("Android bundle app.config versionCode does not match the requested version")
            if not isinstance(extra, dict) or extra.get("apiUrl") != API_URL:
                raise ValueError(f"Android bundle API URL must be {API_URL}")
            javascript = _read(archive, "base/assets/index.android.bundle", 128 << 20)
            if API_URL.encode() not in javascript:
                raise ValueError("Android embedded JavaScript does not contain the production API URL")
            for abi, (elf_class, machine) in RUNTIME_ABIS.items():
                name = f"base/lib/{abi}/libbuildplay-runtime.so"
                try:
                    with archive.open(name) as stream:
                        header = stream.read(20)
                except KeyError as error:
                    raise ValueError(f"Android bundle is missing native runtime for {abi}") from error
                if (len(header) != 20 or header[:4] != b"\x7fELF" or header[4:6] != bytes((elf_class, 1))
                        or int.from_bytes(header[16:18], "little") != 3
                        or int.from_bytes(header[18:20], "little") != machine):
                    raise ValueError(f"Android native runtime has an invalid ELF ABI for {abi}")
    except (BadZipFile, json.JSONDecodeError, UnicodeDecodeError, OSError) as error:
        raise ValueError("Android bundle is not a readable, valid artifact") from error
    _verify_signature(path)
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()
