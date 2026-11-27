#!/usr/bin/env bash
# Exercise the production JSI endpoint, Worklet and Firebase SDK on a disposable CI device.
set -euo pipefail
platform=${1:?android or ios}
product=${2:?compiled release app}
device=${3:?disposable simulator or emulator ID}
output=${4:?result JSON path}
test "${GITHUB_ACTIONS:-}" = true
scratch=$(mktemp -d "$RUNNER_TEMP/buildplay-analytics.XXXXXX")
cp index.ts "$scratch/original-entry"
log_pid=
cleanup() {
  if [[ -n "$log_pid" ]]; then kill "$log_pid" 2>/dev/null || true; fi
  cp "$scratch/original-entry" index.ts
}
trap cleanup EXIT
cp scripts/analytics-probe.js index.ts
CI=1 npx --no-install expo export --platform "$platform" --output-dir "$scratch/export" --max-workers 2
bundles=("$scratch/export/_expo/static/js/$platform/"*.hbc)
test "${#bundles[@]}" = 1
file=$(python3 -c 'import hashlib;print(hashlib.sha256(b"ci.analytics.probe").hexdigest()+".json")')

if [[ "$platform" == android ]]; then
  package=fun.buildplay.debug
  test "$(adb -s "$device" shell getprop ro.kernel.qemu | tr -d '\r')" = 1
  adb -s "$device" root
  adb -s "$device" wait-for-device
  test "$(adb -s "$device" shell id -u | tr -d '\r')" = 0
  # Block HTTPS for the app and Play Services for the lifetime of this emulator.
  # This verification reads local SDK results and sends no events to production.
  for table in iptables ip6tables; do
    adb -s "$device" shell "$table -I OUTPUT -p tcp --dport 443 -j REJECT"
    adb -s "$device" shell "$table -I OUTPUT -p udp --dport 443 -j REJECT"
  done
  build_tools=$(find "$ANDROID_HOME/build-tools" -maxdepth 2 -name apksigner | sort -V | tail -1)
  build_tools=$(dirname "$build_tools")
  cp "$product" "$scratch/probe.apk"
  mkdir -p "$scratch/assets"
  cp "${bundles[0]}" "$scratch/assets/index.android.bundle"
  (cd "$scratch" && zip -qd probe.apk assets/index.android.bundle 'META-INF/*.SF' 'META-INF/*.RSA' 'META-INF/MANIFEST.MF' && zip -q0 probe.apk assets/index.android.bundle)
  "$build_tools/zipalign" -P 16 -f 4 "$scratch/probe.apk" "$scratch/aligned.apk"
  "$build_tools/apksigner" sign --ks android/app/debug.keystore --ks-pass pass:android --out "$scratch/signed.apk" "$scratch/aligned.apk"
  adb -s "$device" install -r "$scratch/signed.apk"
  adb -s "$device" shell am force-stop "$package"
  adb -s "$device" shell setprop debug.firebase.analytics.app "$package"
  adb -s "$device" shell setprop log.tag.FA VERBOSE
  adb -s "$device" shell setprop log.tag.FA-SVC VERBOSE
  adb -s "$device" logcat -T 1 -s FA:V FA-SVC:V > "$scratch/sdk.log" &
  log_pid=$!
  activity=$(adb -s "$device" shell cmd package resolve-activity --brief "$package" | tr -d '\r' | tail -1)
  adb -s "$device" shell am start -n "$activity"
  result_path="/data/data/$package/files/BuildPlayShared/$file"
  read_result() {
    adb -s "$device" shell test -f "$result_path" && adb -s "$device" exec-out cat "$result_path";
  }
elif [[ "$platform" == ios ]]; then
  app="$scratch/BuildPlay.app"
  ditto "$product" "$app"
  test "$(/usr/libexec/PlistBuddy -c 'Print :DTPlatformName' "$app/Info.plist")" = iphonesimulator
  bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Info.plist")
  cp "${bundles[0]}" "$app/main.jsbundle"
  # This simulator uses a synthetic Firebase client with no registered stream.
  python3 - "$app" "$bundle" <<'PY'
import pathlib, plistlib, sys
config = dict(BUNDLE_ID=sys.argv[2], PROJECT_ID="demo-buildplay-analytics", GCM_SENDER_ID="123456789012",
              GOOGLE_APP_ID="1:123456789012:ios:0000000000000000000000", API_KEY="A" * 39, PLIST_VERSION="1")
(pathlib.Path(sys.argv[1]) / "BuildPlayFirebase.plist").write_bytes(plistlib.dumps(config))
PY
  codesign --force --sign - --preserve-metadata=identifier,entitlements "$app"
  xcrun simctl install "$device" "$app"
  xcrun simctl spawn "$device" log stream --level debug --style compact \
    --predicate 'process == "BuildPlay" AND eventMessage CONTAINS "I-ACS"' > "$scratch/sdk.log" &
  log_pid=$!
  xcrun simctl launch --terminate-running-process "$device" "$bundle" -FIRDebugEnabled
  container=$(xcrun simctl get_app_container "$device" "$bundle" data)
  read_result() { cat "$container/Library/Application Support/BuildPlayShared/$file" 2>/dev/null; }
else
  exit 2
fi

for ((attempt=0; attempt<90; attempt++)); do
  if read_result > "$scratch/envelope" && [[ -s "$scratch/envelope" ]]; then break; fi
  sleep 1
done
python3 - "$scratch/envelope" "$output" <<'PY'
import json, pathlib, sys
envelope = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert envelope['key'] == 'ci.analytics.probe'
rows = json.loads(envelope['value'])
pathlib.Path(sys.argv[2]).write_text(json.dumps(rows, indent=2) + '\n')
assert [r.get('status') for r in rows] == ['enabled', 'enabled', 'disabled'], rows
print('Firebase SDK results', rows)
PY
# The logEvent API returns void even when measurement rejects a screen. Check
# the SDK's own local diagnostics before counting the delivery path as verified.
python3 - "$scratch/sdk.log" "$output" <<'PY'
import json, pathlib, re, sys, time
log, output = map(pathlib.Path, sys.argv[1:])
deadline = time.monotonic() + 15
while True:
    messages = log.read_text(errors='replace')
    received = [name for name in ('games', 'match') if re.search(r'\b' + name + r'\b', messages)]
    rejected = re.findall(r'cannot log (?:a )?screen view[^\n]*', messages, re.I)
    if len(received) == 2 or rejected or time.monotonic() >= deadline:
        break
    time.sleep(.5)
# Only retain the two fixture labels and SDK error codes from the device log.
summary = {'screens': received, 'rejected': bool(rejected),
           'rejectedInBackground': any('background' in m.lower() or 'not active' in m.lower() for m in rejected),
           'appleMessageCodes': sorted(set(re.findall(r'I-ACS\d+', messages))),
           'logLines': len(messages.splitlines())}
output.with_name('analytics-sdk.json').write_text(json.dumps(summary, indent=2) + '\n')
assert received == ['games', 'match'] and not rejected, summary
PY
