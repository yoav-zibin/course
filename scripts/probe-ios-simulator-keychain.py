#!/usr/bin/env python3
"""Build a tiny, backend-free UIKit probe of simulated private Keychain permissions."""

import argparse
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import time
import uuid


SCRIPTS = Path(__file__).resolve().parents[1] / "frontends/portal/scripts"
BUNDLE_ID = "edu.columbia.gameportal.starter"
ARCHITECTURES = ("arm64", "x86_64")
SOURCE = r'''
#import <UIKit/UIKit.h>
#import <Security/Security.h>

static NSDictionary *probe(BOOL explicitGroup) {
  NSData *expected = [@"synthetic-local-only-probe" dataUsingEncoding:NSUTF8StringEncoding];
  NSMutableDictionary *identity = [@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService:[[NSUUID UUID] UUIDString],
    (__bridge id)kSecAttrAccount:@"synthetic-probe"} mutableCopy];
  if (explicitGroup) identity[(__bridge id)kSecAttrAccessGroup] = @"TESTTEAM00.edu.columbia.gameportal.starter";
  NSMutableDictionary *addition = [identity mutableCopy];
  addition[(__bridge id)kSecValueData] = expected;
  addition[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
  OSStatus added = SecItemAdd((__bridge CFDictionaryRef)addition, NULL);
  NSMutableDictionary *query = [identity mutableCopy];
  query[(__bridge id)kSecReturnData] = @YES;
  query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
  CFTypeRef copied = NULL;
  OSStatus matched = SecItemCopyMatching((__bridge CFDictionaryRef)query, &copied);
  BOOL equal = matched == errSecSuccess && copied && CFGetTypeID(copied) == CFDataGetTypeID()
    && [(__bridge NSData *)copied isEqualToData:expected];
  if (copied) CFRelease(copied);
  OSStatus deleted = SecItemDelete((__bridge CFDictionaryRef)identity);
  return @{ @"add":@(added), @"copy":@(matched), @"delete":@(deleted), @"data_equal":@(equal) };
}

@interface ProbeDelegate : UIResponder <UIApplicationDelegate>
@property(strong, nonatomic) UIWindow *window;
@end
@implementation ProbeDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
  self.window = [[UIWindow alloc] initWithFrame:[UIScreen mainScreen].bounds];
  UIViewController *controller = [UIViewController new];
  controller.view.backgroundColor = UIColor.systemBackgroundColor;
  UILabel *label = [[UILabel alloc] initWithFrame:CGRectMake(24, 100, 340, 180)];
  label.numberOfLines = 0;
  label.text = @"BuildPlay isolated Keychain probe";
  [controller.view addSubview:label];
  self.window.rootViewController = controller;
  [self.window makeKeyAndVisible];
  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *proof = @{ @"default":probe(NO), @"private_group":probe(YES) };
    NSData *json = [NSJSONSerialization dataWithJSONObject:proof options:NSJSONWritingPrettyPrinted error:NULL];
    NSString *path = [NSHomeDirectory() stringByAppendingPathComponent:@"Documents/keychain-proof.json"];
    [[NSFileManager defaultManager] createDirectoryAtPath:[path stringByDeletingLastPathComponent]
      withIntermediateDirectories:YES attributes:nil error:NULL];
    [json writeToFile:path atomically:YES];
    label.text = @"Keychain probe finished.\nOnly synthetic status data was recorded.";
  });
  return YES;
}
@end
int main(int argc, char **argv) {
  @autoreleasepool { return UIApplicationMain(argc, argv, nil, NSStringFromClass(ProbeDelegate.class)); }
}
'''


def load_helper(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), SCRIPTS / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_proof(proof):
    for scope in ("default", "private_group"):
        result = proof.get(scope, {})
        if any(type(result.get(operation)) is not int or result[operation] != 0 for operation in ("add", "copy", "delete")) or result.get("data_equal") is not True:
            raise ValueError(f"{scope} Keychain add/copy/delete and synthetic data equality must all succeed")
    return proof


def validate_signature(signature):
    if (signature.get("host_entitlements") != {} or signature.get("simulated_entitlements_embedded") is not True
            or signature.get("bundle_identifier") != BUNDLE_ID
            or set(signature.get("architectures", [])) != set(ARCHITECTURES)
            or signature.get("simulator_keychain_group") != "TESTTEAM00." + BUNDLE_ID):
        raise ValueError("Probe requires both simulated XML/DER slices and an empty host signature")
    return signature


def compile_command(architecture, sdk, source, binary, xml, der):
    if architecture not in ARCHITECTURES:
        raise ValueError("Unsupported simulator architecture")
    return ["xcrun", "--sdk", "iphonesimulator", "clang", "-target", f"{architecture}-apple-ios15.1-simulator", "-isysroot", str(sdk),
            "-fobjc-arc", "-framework", "Foundation", "-framework", "UIKit", "-framework", "Security", str(source), "-o", str(binary),
            "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__entitlements", "-Xlinker", str(xml),
            "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__ents_der", "-Xlinker", str(der)]


def execute(output):
    output.mkdir(parents=True, exist_ok=True)
    phase = load_helper("run-ios-smoke-phase").run_phase
    selector = load_helper("select-ios-simulator").select_simulator
    simulator_id = None

    def run(label, seconds, command):
        status = phase(label, seconds, output / (label + ".log"), list(map(str, command)))
        if status:
            raise RuntimeError(f"{label} failed with status {status}")

    def capture(label, seconds, command):
        # Keep machine-readable stdout separate from CoreSimulator warnings.
        target = output / (label + ".stdout")
        wrapper = "import subprocess,sys\nwith open(sys.argv[1],'wb') as output:\n result=subprocess.run(sys.argv[2:],stdout=output)\nraise SystemExit(result.returncode)"
        run(label, seconds, [sys.executable, "-c", wrapper, target, *command])
        return target.read_text().strip()

    try:
        with tempfile.TemporaryDirectory(prefix="buildplay-keychain-probe-") as temporary:
            work = Path(temporary)
            app = work / "BuildPlayKeychainProbe.app"
            app.mkdir()
            source = work / "Probe.m"
            source.write_text(SOURCE)
            (app / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": BUNDLE_ID, "CFBundleExecutable": "BuildPlayKeychainProbe",
                "CFBundleName": "BuildPlayKeychainProbe", "CFBundleDisplayName": "BuildPlay", "CFBundlePackageType": "APPL",
                "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0", "CFBundleSupportedPlatforms": ["iPhoneSimulator"],
                "DTPlatformName": "iphonesimulator", "MinimumOSVersion": "15.1", "LSRequiresIPhoneOS": True,
                "UILaunchScreen": {}, "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"]}))
            entitlements = work / "entitlements"
            run("prepare-entitlements", 90, [sys.executable, SCRIPTS / "prepare-ios-simulator-entitlements.py", entitlements, BUNDLE_ID])
            sdk = capture("sdk", 30, ["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"])
            for architecture in ARCHITECTURES:
                run("compile-" + architecture, 180, compile_command(architecture, sdk, source, work / architecture,
                    entitlements / "BuildPlay-Simulated.xcent", entitlements / "BuildPlay-Simulated.xcent.der"))
            run("universal", 30, ["xcrun", "lipo", "-create", work / "arm64", work / "x86_64", "-output", app / "BuildPlayKeychainProbe"])
            signature = json.loads(capture("verify-simulated-sections-and-host-signature", 180, [sys.executable, SCRIPTS / "sign-ios-simulator.py", app]))
            validate_signature(signature)
            (output / "signature-proof.json").write_text(json.dumps(signature, indent=2) + "\n")
            run("xcode-first-launch", 600, ["sudo", "xcodebuild", "-runFirstLaunch"])
            run("runtime-caches", 600, ["xcrun", "simctl", "runtime", "dyld_shared_cache", "update", "--all"])
            devices = json.loads(capture("devices", 60, ["xcrun", "simctl", "list", "devices", "available", "--json"]))
            selected = selector(devices)
            model = next(device for group in devices["devices"].values() for device in group if device["udid"] == selected["udid"])
            created = capture("create", 60, ["xcrun", "simctl", "create", "BuildPlay isolated Keychain probe", model.get("deviceTypeIdentifier") or model["name"], selected["runtime"]])
            # Only a validated owned UUID may reach shutdown/delete, even when
            # create's output is malformed. Never accept special targets like all.
            simulator_id = str(uuid.UUID(created)).upper()
            (output / "simulator.json").write_text(json.dumps({**selected, "owned_probe_udid": simulator_id}, indent=2))
            run("boot", 600, ["xcrun", "simctl", "bootstatus", simulator_id, "-b"])
            run("install", 300, ["xcrun", "simctl", "install", simulator_id, app])
            old_gate = os.environ.get("SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST")
            os.environ["SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST"] = "1"
            try:
                run("launch", 180, ["xcrun", "simctl", "launch", simulator_id, BUNDLE_ID])
            finally:
                if old_gate is None:
                    os.environ.pop("SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST", None)
                else:
                    os.environ["SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST"] = old_gate
            container = Path(capture("data-container", 45, ["xcrun", "simctl", "get_app_container", simulator_id, BUNDLE_ID, "data"]))
            owned_data = Path.home() / "Library/Developer/CoreSimulator/Devices" / simulator_id / "data"
            if not container.resolve().is_relative_to(owned_data.resolve()):
                raise ValueError("Probe result container is outside its owned simulator")
            proof_path = container / "Documents/keychain-proof.json"
            deadline = time.monotonic() + 120
            while not proof_path.is_file() and time.monotonic() < deadline:
                time.sleep(1)
            if not proof_path.is_file() or proof_path.stat().st_size > 16_384:
                raise ValueError("The isolated app did not produce a bounded Keychain result")
            proof = json.loads(proof_path.read_text())
            (output / "keychain-proof.json").write_text(json.dumps(proof, indent=2) + "\n")
            validate_proof(proof)
            run("screenshot", 45, ["xcrun", "simctl", "io", simulator_id, "screenshot", output / "keychain-probe.png"])
            print("Keychain probe passed: all six SecItem statuses are 0; both synthetic values round-trip.", flush=True)
            return 0
    except Exception:
        if simulator_id:
            try:
                phases = [json.loads(line) for line in (output / "phases.jsonl").read_text().splitlines()]
                window = load_helper("ios-smoke-diagnostic-window").diagnostic_window(phases)
                (output / "failure-window.json").write_text(json.dumps(window, indent=2) + "\n")
                bounds = ["--start", window["start"], "--end", window["end"], "--style", "compact"]
                predicate = 'process == "BuildPlayKeychainProbe" OR process == "SpringBoard" OR process == "runningboardd" OR process == "amfid" OR process == "installd" OR process == "securityd"'
                phase("failure-simulator-log", 30, output / "failure-simulator.log", ["xcrun", "simctl", "spawn", simulator_id, "log", "show", *bounds, "--predicate", predicate], retain_tail=True)
                phase("failure-host-log", 30, output / "failure-host.log", ["/usr/bin/log", "show", *bounds, "--predicate", 'process == "amfid" OR process == "CoreSimulatorService" OR process == "launchd_sim"'], retain_tail=True)
            except (ValueError, OSError, RuntimeError, subprocess.SubprocessError):
                print("Bounded failure-log collection could not complete.", flush=True)
        raise
    finally:
        if simulator_id:
            for label, operation in (("shutdown", "shutdown"), ("delete", "delete")):
                phase(label, 30, output / (label + ".log"), ["xcrun", "simctl", operation, simulator_id])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    try:
        raise SystemExit(execute(arguments.output.resolve()))
    except (KeyError, ValueError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Isolated Keychain probe failed: {error}", file=sys.stderr)
        raise SystemExit(1)
