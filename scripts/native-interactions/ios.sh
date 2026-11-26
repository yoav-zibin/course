#!/usr/bin/env bash
# Run against a dedicated simulator with a release app, local visitor and real touch input.
set -euo pipefail
app=${1:?Provide a simulator .app}
fixture=${2:?Provide the generated Backgammon fixture directory}
results=${3:?Provide the results directory}
sim=${4:?Provide a disposable simulator UDID}
scripts=$(cd "$(dirname "$0")" && pwd)
bundle=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
mkdir -p "$results/project"
cp -R "$scripts/project.yml" "$scripts/InteractionTests" "$results/project/"
cp "$fixture/pose.json" "$results/project/InteractionTests/"
(cd "$results/project" && xcodegen generate)
xcrun simctl bootstatus "$sim" -b
xcrun simctl install "$sim" "$app"
data=$(xcrun simctl get_app_container "$sim" "$bundle" data)
store="$data/Library/Application Support/BuildPlayShared"
filename=$(jq -r .filename "$fixture/pose.json")
mkdir -p "$store"
if [[ -e "$store/$filename" ]]; then
  jq -e --arg match "$(jq -r .id "$fixture/pose.json")" '(.value | fromjson | .local | keys) == [$match]' "$store/$filename" >/dev/null
fi
build=(xcodebuild -project "$results/project/Interactions.xcodeproj" -scheme Interactions -configuration Release
  -destination "platform=iOS Simulator,id=$sim" -derivedDataPath "$results/derived" -parallel-testing-enabled NO)
"${build[@]}" build-for-testing > "$results/build.log"
record_pid=''
stop_recording() {
  if [[ -n "$record_pid" ]]; then
    kill -INT "$record_pid" 2>/dev/null || true
    wait "$record_pid" || true
    record_pid=''
  fi
}
trap stop_recording EXIT
verify_move() {
  python3 - "$fixture/pose.json" "$store/$filename" "$1" <<'PY'
import json, sys
pose = json.load(open(sys.argv[1]))
match = json.loads(json.load(open(sys.argv[2]))['value'])['local'][pose['id']]
proof = {'move_count':match['move_count'],'expected_move_count':pose['moveCount']+1,
         'counts':match['logicState']['cnt'],'owners':match['logicState']['owner']}
proof['committed'] = (proof['move_count']==proof['expected_move_count'] and proof['counts']==pose['expectedCounts']
                      and proof['owners']==pose['expectedOwners'])
with open(sys.argv[3],'w') as output:
    json.dump(proof,output,indent=2)
print('Legal checker move committed:',proof['committed'])
PY
  jq -e '.committed' "$1" >/dev/null
}
case "${SCENARIO:-board}" in
  board) actions=(SelectChecker OpenReport DragChecker CommitChecker) ;;
  landscape) actions=(CommitLandscapeChecker TapLandscapeChecker) ;;
  *) echo "Expected board or landscape scenario" >&2; exit 2 ;;
esac
for action in "${actions[@]}"; do
  xcrun simctl terminate "$sim" "$bundle" 2>/dev/null || true
  cp "$fixture/$filename" "$store/$filename"
  if [[ "$action" == DragChecker ]]; then
    xcrun simctl io "$sim" recordVideo --codec=h264 "$results/drag.mov" >"$results/recording.log" 2>&1 &
    record_pid=$!
  fi
  "${build[@]}" test-without-building "-only-testing:InteractionTests/BoardTests/test$action" \
    -resultBundlePath "$results/$action.xcresult" | tee "$results/$action.log"
  stop_recording
  case "$action" in
    CommitChecker) verify_move "$results/legal-drop.json" ;;
    CommitLandscapeChecker) verify_move "$results/landscape-drop.json" ;;
    TapLandscapeChecker) verify_move "$results/landscape-tap.json" ;;
    *) xcrun xcresulttool get test-results metrics --path "$results/$action.xcresult" > "$results/$action.json" ;;
  esac
done

if [[ "${SCENARIO:-board}" == board ]]; then
  python3 "$scripts/tracking.py" "$results/drag.mov" "$results/DragChecker.log" "$results/tracking.json"
fi
