#!/usr/bin/env python3
"""Check the compiled archive's SDK and iOS 27 scene lifecycle before upload."""

import argparse
import json
from pathlib import Path
import plistlib
import re
import sys
from xml.parsers.expat import ExpatError


MINIMUM_IOS_SDK = 27
MINIMUM_XCODE = 2700
APPLICATION_SCENE_ROLE = "UIWindowSceneSessionRoleApplication"


def verify_metadata(info):
    if not isinstance(info, dict):
        raise ValueError("The compiled Info.plist must contain a dictionary")
    if (info.get("CFBundleSupportedPlatforms") != ["iPhoneOS"]
            or info.get("DTPlatformName") != "iphoneos"):
        raise ValueError("Expected an archived iPhoneOS application, not a simulator bundle")

    sdk = info.get("DTSDKName")
    match = re.fullmatch(r"iphoneos([0-9]+)(?:\.[0-9]+){0,2}", sdk) if isinstance(sdk, str) else None
    if match is None or int(match.group(1)) < MINIMUM_IOS_SDK:
        raise ValueError("The compiled DTSDKName must identify iPhoneOS SDK 27 or later")

    xcode = info.get("DTXcode")
    if (not isinstance(xcode, str) or re.fullmatch(r"[0-9]{4,6}", xcode) is None
            or int(xcode) < MINIMUM_XCODE):
        raise ValueError("The compiled DTXcode must identify Xcode 27 or later")

    manifest = info.get("UIApplicationSceneManifest")
    configurations = manifest.get("UISceneConfigurations") if isinstance(manifest, dict) else None
    application_scenes = configurations.get(APPLICATION_SCENE_ROLE) if isinstance(configurations, dict) else None
    if not isinstance(application_scenes, list) or not application_scenes:
        raise ValueError("SDK 27 requires application scene configurations in UIApplicationSceneManifest")

    delegates = []
    for scene in application_scenes:
        delegate = scene.get("UISceneDelegateClassName") if isinstance(scene, dict) else None
        if (not isinstance(delegate, str)
                or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*", delegate) is None):
            raise ValueError("Every application scene must name a resolved UISceneDelegateClassName")
        delegates.append(delegate)

    return {"platform": "iphoneos", "sdk": sdk, "xcode": xcode,
            "scene_delegates": delegates}


def verify_app(app):
    app = Path(app)
    if app.suffix != ".app" or not app.is_dir():
        raise ValueError("Pass the archived application .app directory")
    with (app / "Info.plist").open("rb") as source:
        return verify_metadata(plistlib.load(source))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app", type=Path, help="Archived Products/Applications/BuildPlay.app")
    arguments = parser.parse_args(argv)
    try:
        proof = verify_app(arguments.app)
    except (OSError, ValueError, plistlib.InvalidFileException, ExpatError) as error:
        print(f"iOS distribution SDK check failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(proof, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
