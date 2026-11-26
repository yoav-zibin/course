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
for action in SelectChecker OpenReport DragChecker; do
  xcrun simctl terminate "$sim" "$bundle" 2>/dev/null || true
  cp "$fixture/$filename" "$store/$filename"
  "${build[@]}" test-without-building "-only-testing:InteractionTests/BoardTests/test$action" \
    -resultBundlePath "$results/$action.xcresult" | tee "$results/$action.log"
  xcrun xcresulttool get test-results metrics --path "$results/$action.xcresult" > "$results/$action.json"
done
python3 - "$fixture/pose.json" "$store/$filename" <<'PY'
import json, sys
pose = json.load(open(sys.argv[1]))
match = json.loads(json.load(open(sys.argv[2]))['value'])['local'][pose['id']]
assert match['move_count'] == pose['moveCount'] + 1
assert match['logicState']['cnt'] == pose['expectedCounts']
assert match['logicState']['owner'] == pose['expectedOwners']
print('Verified the legal Backgammon checker move on the simulator')
PY
