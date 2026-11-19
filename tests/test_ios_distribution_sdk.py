"""Distribution checks use archived metadata, not the runner's selected Xcode."""

import copy
import importlib.util
import json
from pathlib import Path
import plistlib
import subprocess
import sys

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/verify-ios-distribution-sdk.py"
spec = importlib.util.spec_from_file_location("ios_distribution_sdk", SCRIPT)
sdk_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sdk_check)


def archived_info(**changes):
    return {
        "CFBundleSupportedPlatforms": ["iPhoneOS"], "DTPlatformName": "iphoneos",
        "DTSDKName": "iphoneos27.1", "DTXcode": "2710",
        "UIApplicationSceneManifest": {
            "UIApplicationSupportsMultipleScenes": False,
            "UISceneConfigurations": {"UIWindowSceneSessionRoleApplication": [
                {"UISceneConfigurationName": "Default Configuration",
                 "UISceneDelegateClassName": "BuildPlay.SceneDelegate"}
            ]},
        },
        **changes,
    }


@pytest.mark.parametrize(("sdk", "xcode"), [
    ("iphoneos27", "2700"), ("iphoneos27.1", "2710"),
    ("iphoneos27.2.1", "2721"), ("iphoneos28.0", "2800"),
])
def test_new_sdk_and_scene_lifecycle_accepted_without_modifying_metadata(sdk, xcode):
    info = archived_info(DTSDKName=sdk, DTXcode=xcode)
    original = copy.deepcopy(info)
    assert sdk_check.verify_metadata(info) == {
        "platform": "iphoneos", "sdk": sdk, "xcode": xcode,
        "scene_delegates": ["BuildPlay.SceneDelegate"],
    }
    assert info == original


@pytest.mark.parametrize("sdk", [None, "iphoneos26.5", "iphonesimulator27.1", "iphoneos27beta", "iphoneos27.", "iphoneos27.1\n", 27])
def test_old_or_malformed_compiled_sdk_rejected_even_with_new_xcode(sdk):
    with pytest.raises(ValueError, match="DTSDKName"):
        sdk_check.verify_metadata(archived_info(DTSDKName=sdk))


@pytest.mark.parametrize("xcode", [None, "2650", "27.1", "271", "2710beta", "2710\n", 2710, True])
def test_old_or_malformed_compiled_xcode_rejected_even_with_new_sdk(xcode):
    with pytest.raises(ValueError, match="DTXcode"):
        sdk_check.verify_metadata(archived_info(DTXcode=xcode))


@pytest.mark.parametrize("changes", [
    {"CFBundleSupportedPlatforms": ["iPhoneSimulator"], "DTPlatformName": "iphonesimulator"},
    {"CFBundleSupportedPlatforms": ["iPhoneOS"], "DTPlatformName": "iphonesimulator"},
    {"CFBundleSupportedPlatforms": ["iPhoneOS", "iPhoneSimulator"]},
    {"DTPlatformName": None},
])
def test_simulator_or_conflicting_platform_metadata_cannot_pass(changes):
    with pytest.raises(ValueError, match="archived iPhoneOS"):
        sdk_check.verify_metadata(archived_info(**changes))


@pytest.mark.parametrize("manifest", [
    None, {}, {"UISceneConfigurations": {}},
    {"UISceneConfigurations": {"UIWindowSceneSessionRoleApplication": []}},
    {"UISceneConfigurations": {"UIWindowSceneSessionRoleApplication": {}}},
    {"UISceneConfigurations": {"UIWindowSceneSessionRoleExternalDisplay": [{}]}},
])
def test_sdk_27_without_application_scene_lifecycle_rejected(manifest):
    with pytest.raises(ValueError, match="application scene configurations"):
        sdk_check.verify_metadata(archived_info(UIApplicationSceneManifest=manifest))


@pytest.mark.parametrize("delegate", [None, "", "$(PRODUCT_MODULE_NAME).SceneDelegate", "BuildPlay.SceneDelegate\n", 123])
def test_each_scene_requires_resolved_delegate_including_after_valid_scene(delegate):
    info = archived_info()
    scenes = info["UIApplicationSceneManifest"]["UISceneConfigurations"]["UIWindowSceneSessionRoleApplication"]
    scenes.append({"UISceneDelegateClassName": delegate})
    with pytest.raises(ValueError, match="resolved UISceneDelegateClassName"):
        sdk_check.verify_metadata(info)


@pytest.mark.parametrize("format", [plistlib.FMT_XML, plistlib.FMT_BINARY])
def test_cli_reads_actual_archived_plist_including_binary_format(tmp_path, format):
    app = tmp_path / "Archive with spaces.xcarchive/Products/Applications/BuildPlay.app"
    app.mkdir(parents=True)
    info = app / "Info.plist"
    info.write_bytes(plistlib.dumps(archived_info(), fmt=format))
    before = info.read_bytes()
    completed = subprocess.run([sys.executable, str(SCRIPT), str(app)], capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout)["sdk"] == "iphoneos27.1"
    assert info.read_bytes() == before


def test_cli_fails_old_archive_regardless_of_environment_selection(tmp_path):
    app = tmp_path / "BuildPlay.app"
    app.mkdir()
    (app / "Info.plist").write_bytes(plistlib.dumps(archived_info(DTSDKName="iphoneos26.5", DTXcode="2660")))
    completed = subprocess.run([sys.executable, str(SCRIPT), str(app)], capture_output=True, text=True,
                               env={"DEVELOPER_DIR": "/Applications/Xcode_27.1.app/Contents/Developer"})
    assert completed.returncode == 1
    assert "DTSDKName" in completed.stderr
    assert not completed.stdout


@pytest.mark.parametrize("contents", [
    b"not a plist", b'<?xml version="1.0"?><plist><dict>',
    plistlib.dumps(["not a dictionary"]),
])
def test_cli_rejects_malformed_plist_without_traceback(tmp_path, contents):
    app = tmp_path / "BuildPlay.app"
    app.mkdir()
    (app / "Info.plist").write_bytes(contents)
    completed = subprocess.run([sys.executable, str(SCRIPT), str(app)], capture_output=True, text=True)
    assert completed.returncode == 1
    assert "iOS distribution SDK check failed" in completed.stderr
    assert "Traceback" not in completed.stderr
    assert not completed.stdout
