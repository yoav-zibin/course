#!/usr/bin/env bash
# Run with the release app pointed at the fixture server on the simulator host.
set -euo pipefail
app=$1
fixture=$2
results=$3
sim=$4
samples=${5:-3}
scripts=$(cd "$(dirname "$0")" && pwd)
bundle=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
mkdir -p "$results/project"
cp -R "$scripts/project.yml" "$scripts/InteractionTests" "$results/project/"
(cd "$results/project" && xcodegen generate)
xcrun simctl bootstatus "$sim" -b
python3 "$scripts/startup_fixture.py" "$fixture" >"$results/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for attempt in {1..20}; do
  if curl --silent --fail http://127.0.0.1:18764/__requests >/dev/null; then break; fi
  sleep .2
done
build=(xcodebuild -project "$results/project/Interactions.xcodeproj" -scheme Interactions -configuration Release
  -destination "platform=iOS Simulator,id=$sim" -derivedDataPath "$results/derived" -parallel-testing-enabled NO)
"${build[@]}" build-for-testing >"$results/build.log"
for ((sample=1;sample<=samples;sample++)); do
  for action in ColdHome ColdBackgammon; do
    name="$sample-$action"
    xcrun simctl uninstall "$sim" "$bundle" 2>/dev/null || true
    xcrun simctl install "$sim" "$app"
    curl -fsS -X POST http://127.0.0.1:18764/__reset >/dev/null
    status=0
    "${build[@]}" test-without-building "-only-testing:InteractionTests/StartupTests/test$action" \
        -resultBundlePath "$results/$name.xcresult" | tee "$results/$name.log" || status=$?
    curl -fsS http://127.0.0.1:18764/__requests >"$results/$name-requests.json"
    if ((status)); then exit "$status"; fi
    if [[ "$action" == ColdBackgammon ]]; then
      jq -e '([.[].path] | index("/matches/benchmark-opening")!=null and index("/games/5f5293c3-2a3a-4eec-b631-9debf59be0ca/versions/10")!=null)' "$results/$name-requests.json" >/dev/null
    fi
  done
done
python3 - "$results" "$samples" <<'PY'
import json, re, sys
from pathlib import Path
directory=Path(sys.argv[1])
rows=[]
for sample in range(1,int(sys.argv[2])+1):
    events={}
    for action in ('ColdHome','ColdBackgammon'):
        for key,elapsed in re.findall(r'STARTUP_MS (\w+) ([\d.]+)',(directory/f'{sample}-{action}.log').read_text()):
            events[key+'_ms']=round(float(elapsed),1)
    if len(events)!=3:
        raise ValueError(f'Missing a verified startup milestone in trial {sample}')
    rows.append(events)
(directory/'startup.json').write_text(json.dumps(rows,indent=2)+'\n')
PY
