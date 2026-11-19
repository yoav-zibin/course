#!/usr/bin/env python3
"""Verify simulated linker entitlements and ad-hoc sign the macOS host safely.

Never use these synthetic entitlements for a device archive or TestFlight.
"""

import argparse
import importlib.util
import json
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile


CODESIGN = "/usr/bin/codesign"
LIPO = "/usr/bin/lipo"
SIMULATOR_PREFIX = "TESTTEAM00"
ARCHITECTURES = ("arm64", "x86_64")


def load_helper(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


simulated_entitlements = load_helper('prepare-ios-simulator-entitlements').simulated_entitlements
entitlement_sections = load_helper('ios-simulator-macho').entitlement_sections


def simulator_metadata(app):
    app = Path(app).resolve(strict=True)
    with (app / "Info.plist").open("rb") as source:
        info = plistlib.load(source)
    platforms = info.get("CFBundleSupportedPlatforms")
    platform = info.get("DTPlatformName")
    # Check every supplied platform marker: conflicting device metadata must
    # never pass merely because another field happens to mention Simulator.
    if (platforms is None and platform is None
            or platforms is not None and platforms != ["iPhoneSimulator"]
            or platform is not None and platform != "iphonesimulator"):
        raise ValueError("Refusing to sign a non-iPhone-Simulator app or device archive")
    identifier = info.get("CFBundleIdentifier", "")
    executable = info.get("CFBundleExecutable", "")
    if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+", identifier):
        raise ValueError("The simulator bundle identifier must be fully resolved")
    if not isinstance(executable, str) or not executable or Path(executable).name != executable or executable in (".", ".."):
        raise ValueError("The simulator executable must be a filename inside its app")
    binary = app / executable
    if not binary.is_file() or not binary.resolve().is_relative_to(app):
        raise ValueError("The simulator executable is missing or outside its app")
    return app, identifier, binary


def nested_code(app):
    targets = []
    for path in app.rglob("*"):
        if path.suffix in (".app", ".appex"):
            raise ValueError("Nested apps/extensions need their own signing identity")
        if path.suffix == ".framework" and path.is_dir() or path.suffix == ".dylib" and path.is_file():
            if not path.resolve().is_relative_to(app):
                raise ValueError("Nested simulator code points outside its app")
            # A versioned framework may contain aliases to code already signed
            # through its canonical path; do not mutate symlink destinations.
            if not path.is_symlink():
                targets.append(path)
    return sorted(targets, key=lambda item: (-len(item.parts), str(item)))


def read_entitlements(result):
    # --xml is required: current codesign otherwise displays a human-readable
    # DER representation. Older versions emitted XML on stderr with a banner.
    for text in (result.stdout, result.stderr):
        start, end = text.find("<?xml"), text.rfind("</plist>")
        if start >= 0 and end >= start:
            return plistlib.loads(text[start:end + len("</plist>")].encode())
    raise ValueError("codesign did not return signed simulator entitlements")


def sign_simulator(app, run=subprocess.run):
    app, identifier, binary = simulator_metadata(app)
    targets = nested_code(app)

    def command(arguments):
        return run(arguments, check=True, capture_output=True, text=True, timeout=120)

    architectures = command([LIPO, "-archs", str(binary)]).stdout.split()
    if set(architectures) != set(ARCHITECTURES):
        raise ValueError("Expected the arm64 and x86_64 simulator slices before signing")
    expected = simulated_entitlements(identifier)
    sections = entitlement_sections(binary)
    with tempfile.TemporaryDirectory(prefix="buildplay-simulator-sign-") as temporary:
        simulated_path = Path(temporary) / 'simulated.xcent'
        simulated_der = Path(temporary) / 'simulated.xcent.der'
        simulated_path.write_bytes(plistlib.dumps(expected))
        command(['/usr/bin/derq', 'query', '-f', 'xml', '-i', str(simulated_path), '-o', str(simulated_der), '--raw'])
        expected_der = simulated_der.read_bytes()
        if not expected_der:
            raise ValueError('Missing simulated DER entitlement encoding')
        for architecture in ARCHITECTURES:
            actual = plistlib.loads(sections[architecture]['__entitlements'].rstrip(b'\0'))
            if actual != expected or sections[architecture]['__ents_der'] != expected_der:
                raise ValueError(f'The {architecture} linker-embedded simulator entitlements do not match')
        entitlement_path = Path(temporary) / "simulator.entitlements"
        # The simulator executable is a macOS host process: putting iOS App ID
        # entitlements in its real signature makes AMFI reject an ad-hoc binary.
        # Xcode supplies iOS permissions through the two linker sections above.
        entitlement_path.write_bytes(plistlib.dumps({}))
        # Sign from the inside out. Frameworks and dylibs get no application
        # entitlements; --deep is reserved for verification, never signing.
        for target in targets:
            command([CODESIGN, "--force", "--sign", "-", "--timestamp=none", str(target)])
        command([CODESIGN, "--force", "--sign", "-", "--timestamp=none",
                 "--identifier", identifier, "--generate-entitlement-der",
                 "--entitlements", str(entitlement_path), str(app)])
        for architecture in ARCHITECTURES:
            command([CODESIGN, "--verify", "--deep", "--strict", "--arch", architecture, str(app)])
            actual = read_entitlements(command([
                CODESIGN, "--display", "--arch", architecture,
                "--entitlements", "-", "--xml", str(app),
            ]))
            if actual != {}:
                raise ValueError(f"The {architecture} host signature must not claim restricted iOS entitlements")
        if entitlement_sections(binary) != sections:
            raise ValueError('Host signing changed the simulated entitlement sections')
    return {"bundle_identifier": identifier, "architectures": list(ARCHITECTURES),
            "simulator_keychain_group": expected['application-identifier'],
            "simulated_entitlements_embedded": True, "host_entitlements": {},
            "nested_code_signed": len(targets)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path, help="Compiled universal iPhone Simulator .app")
    arguments = parser.parse_args()
    try:
        print(json.dumps(sign_simulator(arguments.app)))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"Simulator signing failed: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            detail = error.stderr or error.stdout or ""
            if detail:
                print(detail[:8_000], file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
