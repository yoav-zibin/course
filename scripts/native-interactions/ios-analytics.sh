#!/usr/bin/env bash
# Compare an unprofiled display interval with a separate sampling pass, using
# the same release binary, isolated Firebase client and freshly installed app.
set -euo pipefail
app=${1:?compiled simulator app}
device=${2:?simulator ID}
out=${3:?output directory}
scripts=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"
library="$out/AnalyticsTiming.dylib"
sdk=$(xcrun --sdk iphonesimulator --show-sdk-path)
xcrun clang -isysroot "$sdk" -target "$(uname -m)-apple-ios17.0-simulator" -dynamiclib -fobjc-arc \
  -framework Foundation -framework QuartzCore "$scripts/AnalyticsTiming.m" "$scripts/ResponseSamples.m" -o "$library"
codesign --force --sign - "$library"
xcrun simctl bootstatus "$device" -b
bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")
export SIMCTL_CHILD_DYLD_INSERT_LIBRARIES="$library"
unset SIMCTL_CHILD_BUILDPLAY_RESPONSE_STACKS
for mode in timing profile; do
  if xcrun simctl get_app_container "$device" "$bundle" >/dev/null 2>&1; then
    xcrun simctl uninstall "$device" "$bundle"
  fi
  if [[ "$mode" == profile ]]; then export SIMCTL_CHILD_BUILDPLAY_RESPONSE_STACKS=1; fi
  bash scripts/verify-native-analytics.sh ios "$app" "$device" "$out/$mode-worklet.json"
  mv "$out/analytics-sdk.json" "$out/$mode-sdk.json"
  cache="$(xcrun simctl get_app_container "$device" "$bundle" data)/Library/Caches"
  for ((i=0; i<25; i++)); do
    if [[ -s "$cache/analytics-main.json" ]] && { [[ "$mode" == timing ]] || [[ -s "$cache/response-stacks.jsonl" ]]; }; then break; fi
    sleep 1
  done
  cp "$cache/analytics-main.json" "$out/$mode-main.json"
  if [[ "$mode" == profile ]]; then
    PYTHONPATH="$scripts" python3 - "$cache/response-stacks.jsonl" "$out" <<'PY'
import json, pathlib, sys, time
from response_profiles import ios_stacks
source, out = map(pathlib.Path, sys.argv[1:])
timing = json.loads((out / 'profile-main.json').read_text())
size = -1
for _ in range(30):
    observed = source.stat().st_size
    if observed and observed == size:
        break
    size = observed
    time.sleep(.5)
rows = [json.loads(line) for line in source.read_text().splitlines() if line]
# Include the surrounding SDK initialization, and separately the synchronous
# configure interval. Stacks include waiting on each sampled thread.
for name, duration in [('initialization', 800), ('configure', timing['configureMs'])]:
    samples = ios_stacks(rows, timing['startMs'], duration)
    (out / f'analytics-{name}.folded').write_text(''.join(f'{stack} {weight}\n' for stack, weight in samples.items()))
PY
  fi
done
cat "$out/timing-main.json"
