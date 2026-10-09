#!/bin/bash
set -euo pipefail
ANDROID_SDK_PATH="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
exec "$ANDROID_SDK_PATH/emulator/emulator" -avd Playroom_API_36 -no-snapshot-load -gpu auto
