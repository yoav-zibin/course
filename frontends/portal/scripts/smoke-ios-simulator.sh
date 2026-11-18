#!/usr/bin/env bash
set -euo pipefail
app_path=${1:?Provide the simulator app path}
results_path=${2:?Provide the results directory}
mkdir -p "$results_path/screenshots"
xcrun simctl list devices available --json > "$results_path/devices.json"
simulator_id=$(python3 - "$results_path/devices.json" <<'PY'
import json
import sys
with open(sys.argv[1]) as source:
    devices = json.load(source)["devices"]
phones = [device for runtime, group in devices.items() if "iOS" in runtime
          for device in group if device.get("isAvailable") and "iPhone" in device["name"]]
if not phones:
    raise SystemExit("No available iPhone simulator on the selected runner")
phones.sort(key=lambda device: (device["state"] != "Booted", device["name"]))
print(phones[0]["udid"])
PY
)
printf '%s\n' "$simulator_id" > "$results_path/simulator.udid"
bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Info.plist")
xcrun simctl boot "$simulator_id" 2>/dev/null || true
xcrun simctl bootstatus "$simulator_id" -b
xcrun simctl install "$simulator_id" "$app_path"
SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST=1 xcrun simctl launch --terminate-running-process "$simulator_id" "$bundle_id" \
  > "$results_path/launch.log" 2>&1
sleep 8
xcrun simctl io "$simulator_id" screenshot "$results_path/screenshots/portal-launch.png"
xcrun simctl spawn "$simulator_id" launchctl list > "$results_path/processes.log"
python3 - "$results_path/processes.log" "$bundle_id" <<'PY'
import sys
with open(sys.argv[1]) as source:
    rows = source.read().splitlines()
if not any(sys.argv[2] in row and row.split()[0].isdigit() for row in rows):
    raise SystemExit("BuildPlay exited after launch; inspect the screenshot and launch logs")
PY
