#!/usr/bin/env bash
set -euo pipefail
results_dir=${1:?Pass the directory for logs, screenshots, and the Xcode result bundle}
mkdir -p "$results_dir"
results_dir=$(cd "$results_dir" && pwd)
cd "$(dirname "$0")/.."

xcodebuild -version
xcrun simctl list devices available --json > "$results_dir/simulators.json"
python3 scripts/select-simulator.py "$results_dir/simulators.json" > "$results_dir/simulator.udid"
simulator_udid=$(cat "$results_dir/simulator.udid")
echo "Testing on iPhone simulator $simulator_udid"
if ! xcrun simctl list devices booted --json | python3 -c \
  'import json,sys; target=sys.argv[1]; sys.exit(not any(d["udid"] == target for ds in json.load(sys.stdin)["devices"].values() for d in ds))' \
  "$simulator_udid"; then
  xcrun simctl boot "$simulator_udid"
fi
python3 - "$simulator_udid" <<'PY'
import subprocess
import sys

try:
    subprocess.run(["xcrun", "simctl", "bootstatus", sys.argv[1], "-b"],
                   check=True, timeout=600)
except subprocess.TimeoutExpired:
    raise SystemExit("iPhone simulator boot did not finish within 600 seconds.")
PY

# A single simulator keeps screenshot fallback and UI tests on the same device.
xcodebuild \
  -project GamePortal.xcodeproj \
  -scheme GamePortal \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$simulator_udid" \
  -destination-timeout 120 \
  -parallel-testing-enabled NO \
  -test-timeouts-enabled YES \
  -default-test-execution-time-allowance 300 \
  -maximum-test-execution-time-allowance 300 \
  -derivedDataPath "${GITHUB_WORKSPACE:-$results_dir}/ios-portal-build" \
  -resultBundlePath "$results_dir/SimulatorTests.xcresult" \
  ARCHS='arm64 x86_64' ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO \
  test-without-building
