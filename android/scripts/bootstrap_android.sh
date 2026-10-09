#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
CACHE="$ROOT/.local/tooling"
mkdir -p "$CACHE" "$ANDROID_HOME/cmdline-tools"
if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  curl -fsSL https://dl.google.com/android/repository/commandlinetools-mac_arm64-16111833_latest.zip -o "$CACHE/commandline.zip"
  printf '%s  %s\n' ad03dc49bfacfd52c110b14104ea548b8a07e830 "$CACHE/commandline.zip" | shasum -a 1 -c -
  unzip -q -o "$CACHE/commandline.zip" -d "$CACHE/commandline"
  mv "$CACHE/commandline/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi
SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
# sdkmanager displays the Android SDK licenses before accepting them.
set +o pipefail
yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses
set -o pipefail
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0' 'emulator' 'system-images;android-36;google_apis;arm64-v8a'
if ! "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" list avd -c | /usr/bin/grep -qx 'Playroom_API_36'; then
  printf 'no\n' | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd -n Playroom_API_36 -k 'system-images;android-36;google_apis;arm64-v8a' -d pixel_6
fi
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$ROOT/android/local.properties"
printf '\nAndroid setup complete. Start with android/scripts/start_emulator.sh\n'
