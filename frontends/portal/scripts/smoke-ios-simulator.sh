#!/usr/bin/env bash
set -euo pipefail
app_path=${1:?Provide the simulator app path}
results_path=${2:?Provide the results directory}
scripts_path=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$results_path/screenshots"
simulator_id=''

run_phase() {
  local phase=$1 deadline=$2 output=$3
  shift 3
  python3 "$scripts_path/run-ios-smoke-phase.py" "$phase" "$deadline" "$output" "$@"
}

run_diagnostic() {
  local phase=$1 deadline=$2 output=$3
  shift 3
  python3 "$scripts_path/run-ios-smoke-phase.py" --tail "$phase" "$deadline" "$output" "$@"
}

capture_failure() {
  local status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    printf 'Simulator smoke failed (exit %s); collecting bounded diagnostics.\n' "$status"
    # Capture the failing interval first, before slower host/state inspection.
    # Explicit UTC offsets are supported by Apple's documented --start/--end:
    # https://developer.apple.com/documentation/technotes/tn3163-understanding-the-synchronization-of-nspersistentcloudkitcontainer
    local window failure_start failure_end
    if window=$(python3 "$scripts_path/ios-smoke-diagnostic-window.py" "$results_path/phases.jsonl" "$results_path/failure-window.json"); then
      IFS='|' read -r failure_start failure_end <<< "$window"
      if [[ -n "$simulator_id" ]]; then
        run_diagnostic simulator-log 25 "$results_path/simulator-system.log" xcrun simctl spawn "$simulator_id" log show \
          --start "$failure_start" --end "$failure_end" --style compact \
          --predicate 'process == "BuildPlay" OR process == "SpringBoard" OR process == "runningboardd" OR process == "amfid" OR process == "installd"' || true
      fi
      run_diagnostic apple-host-log 25 "$results_path/apple-host.log" /usr/bin/log show \
        --start "$failure_start" --end "$failure_end" --style compact \
        --predicate 'process == "CoreSimulatorService" OR process == "simdiskimaged" OR process == "syspolicyd" OR process == "launchd_sim" OR process == "amfid" OR process == "installd"' || true
    else
      printf 'Could not determine the failing log interval; preserving original smoke failure.\n'
    fi
    # comm is the executable name, not its arguments or environment.
    run_phase host-cpu 10 "$results_path/host-cpu.log" ps -axo pid,ppid,pcpu,pmem,etime,comm || true
    run_phase device-state 20 "$results_path/failure-devices.json" xcrun simctl list devices available --json || true
  fi
  exit "$status"
}
trap capture_failure EXIT

# Keep machine-readable stdout separate from CoreSimulator stderr warnings.
# The outer phase still bounds and terminates this wrapper and its xcrun child.
run_phase list-devices 60 "$results_path/list-devices.log" python3 -c '
import subprocess,sys
with open(sys.argv[1], "wb") as output:
    result = subprocess.run(["xcrun", "simctl", "list", "devices", "available", "--json"], stdout=output)
raise SystemExit(result.returncode)
' "$results_path/devices.json"
python3 "$scripts_path/select-ios-simulator.py" "$results_path/devices.json" > "$results_path/selected-simulator.json"
simulator_id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["udid"])' "$results_path/selected-simulator.json")
printf '%s\n' "$simulator_id" > "$results_path/simulator.udid"
printf 'Selected simulator: '
cat "$results_path/selected-simulator.json"
bundle_id=$(python3 - "$app_path/Info.plist" <<'PY'
import plistlib
import sys
with open(sys.argv[1], 'rb') as source:
    print(plistlib.load(source)['CFBundleIdentifier'])
PY
)

# -b boots when needed and waits through migration; no ignored boot errors.
run_phase boot 600 "$results_path/boot.log" xcrun simctl bootstatus "$simulator_id" -b
run_phase install 300 "$results_path/install.log" xcrun simctl install "$simulator_id" "$app_path"
if [[ ${GITHUB_ACTIONS:-false} == true ]]; then
  # A fresh CI sandbox renders the exact public SVG-disc package so the native
  # screenshot covers artwork alignment, with no account or server activity.
  run_phase fixture 120 "$results_path/fixture.log" python3 "$scripts_path/seed-ios-connect4-fixture.py" \
    --local-only "$simulator_id" "$bundle_id" "$results_path/connect4-fixture.json"
fi
# Apple documents 3–5 minute launch stalls while GateKeeper scans dyld caches:
# https://developer.apple.com/documentation/xcode-release-notes/xcode-16_2-release-notes
SIMCTL_CHILD_BUILDPLAY_LOCAL_UI_TEST=1 run_phase launch 360 "$results_path/launch.log" \
  xcrun simctl launch --terminate-running-process "$simulator_id" "$bundle_id"
sleep 8
run_phase screenshot 120 "$results_path/screenshot.log" xcrun simctl io "$simulator_id" screenshot "$results_path/screenshots/portal-launch.png"
run_phase processes 90 "$results_path/processes.log" xcrun simctl spawn "$simulator_id" launchctl list
python3 - "$results_path/processes.log" "$bundle_id" <<'PY'
import sys
with open(sys.argv[1]) as source:
    rows = source.read().splitlines()
if not any(sys.argv[2] in row and row.split()[0].isdigit() for row in rows):
    raise SystemExit("BuildPlay exited after launch; inspect the screenshot and launch logs")
PY
