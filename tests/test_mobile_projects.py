"""The portal has one shared application; native modules are libraries only."""
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def tracked_files(pattern):
    names = subprocess.check_output(
        ["git", "ls-files", "-z", "--", pattern], cwd=ROOT
    ).decode().split("\0")
    return [ROOT / name for name in names if name and (ROOT / name).is_file()]


def test_portal_has_one_expo_application_for_all_three_platforms():
    portal = ROOT / "frontends/portal"
    package = json.loads((portal / "package.json").read_text())
    assert package["main"] == "index.ts"
    assert {"expo", "react", "react-native", "react-native-web"} <= package["dependencies"].keys()
    assert (portal / "app.config.ts").is_file()
    assert (portal / "src/App.tsx").is_file()
    assert (portal / "src/game/GameRenderer.tsx").is_file()
    assert package["expo"]["autolinking"]["nativeModulesDir"] == "./modules"


def test_native_modules_do_not_add_another_application():
    modules = ROOT / "frontends/portal/modules"
    manifests = list(modules.glob("*/android/src/main/AndroidManifest.xml"))
    assert manifests
    for manifest in manifests:
        assert ET.parse(manifest).getroot().find("application") is None
    for module in modules.glob("*/expo-module.config.json"):
        config = json.loads(module.read_text())
        assert {"apple", "android"} <= set(config["platforms"])
        assert config["apple"]["modules"]
        assert config["android"]["modules"]


def test_old_native_applications_and_committed_generated_projects_are_removed():
    assert not (ROOT / "android/app/src/main/AndroidManifest.xml").exists()
    assert not (ROOT / "frontends/ios-game-portal/GamePortal.xcodeproj/project.pbxproj").exists()
    assert not (ROOT / "frontends/react-native-game-portal/package.json").exists()
    assert tracked_files("*.xcodeproj/project.pbxproj") == []
    assert tracked_files("frontends/portal/android/app/src/main/AndroidManifest.xml") == []
