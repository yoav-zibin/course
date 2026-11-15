"""Keep the supported native app inventory at one application per platform."""
from pathlib import Path
import re
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def tracked_files(pattern):
    names = subprocess.check_output(
        ["git", "ls-files", "-z", "--", pattern], cwd=ROOT
    ).decode().split("\0")
    return [ROOT / name for name in names if name and (ROOT / name).is_file()]


def test_repository_has_only_the_playroom_android_application():
    manifests = tracked_files("*/src/main/AndroidManifest.xml")
    assert {p.relative_to(ROOT).as_posix() for p in manifests} == {
        "android/app/src/main/AndroidManifest.xml"
    }


def test_repository_has_only_the_gameportal_ios_application():
    projects = tracked_files("*.xcodeproj/project.pbxproj")
    applications = []
    for project in projects:
        count = len(re.findall(
            r'productType\s*=\s*"?com\.apple\.product-type\.application"?\s*;',
            project.read_text(),
        ))
        applications.extend([project.relative_to(ROOT).as_posix()] * count)
    assert applications == [
        "frontends/ios-game-portal/GamePortal.xcodeproj/project.pbxproj"
    ]
