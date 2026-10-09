#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/android/scripts/android_env.sh"
mkdir -p "$ROOT/android/.gradle"
printf 'java.home=%s\n' "$JAVA_HOME" > "$ROOT/android/.gradle/config.properties"
cd "$ROOT/android"
exec ./gradlew "$@"
