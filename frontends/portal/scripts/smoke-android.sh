#!/usr/bin/env bash
set -euo pipefail
apk_path=${1:?Provide the standalone APK path}
results_path=${2:?Provide the results directory}
package_name=${3:-com.dapillah.gameportal.debug}
mkdir -p "$results_path"
adb wait-for-device
adb install --no-streaming -r "$apk_path" > "$results_path/install.log"
adb logcat -c
component=$(adb shell cmd package resolve-activity --brief "$package_name" | tail -n 1 | tr -d '\r')
test -n "$component"
adb shell am start -W -n "$component" --ez buildplayLocalUiTest true > "$results_path/launch.log"
sleep 8
adb exec-out screencap -p > "$results_path/portal-launch.png"
adb logcat -d -s ReactNativeJS:E AndroidRuntime:E > "$results_path/runtime-errors.log"
adb shell pidof "$package_name" > "$results_path/pid.log"
python3 - "$results_path/runtime-errors.log" <<'PY'
from pathlib import Path
import sys
errors = Path(sys.argv[1]).read_text()
if 'FATAL EXCEPTION' in errors or 'ReactNativeJS' in errors:
    raise SystemExit('BuildPlay reported a native/JavaScript error; inspect runtime-errors.log and portal-launch.png')
PY
