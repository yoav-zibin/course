#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  printf 'This build script targets the class Linux x86_64 VM.\n' >&2
  exit 1
fi
source "$ROOT/android/scripts/android_env.sh"
export PORTAL_BUILD_CONFIG="${1:?Pass the absolute path of the private Android build JSON on the VM}"
test -r "$PORTAL_BUILD_CONFIG"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/playroom-sdk"
mkdir -p "$CACHE" "$ANDROID_HOME/cmdline-tools"
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip -o "$CACHE/commandline.zip"
  printf '%s  %s\n' e025545c62a8e64c7559119566a569fb1dec5f60 "$CACHE/commandline.zip" | sha1sum -c -
  unzip -q -o "$CACHE/commandline.zip" -d "$CACHE/commandline"
  mv "$CACHE/commandline/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
# The VM administrator reviews and accepts the SDK licenses interactively.
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$ROOT/android/local.properties"
"$ROOT/android/scripts/build_android.sh" --no-daemon --max-workers=2 testDebugUnitTest lintDebug assembleRelease
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify "$ROOT/android/artifacts/app-release.apk"
printf 'Verified APK: %s\n' "$ROOT/android/artifacts/app-release.apk"
