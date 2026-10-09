#!/bin/bash
# Android Studio 2026 bundles Java 25; the pinned Gradle 8.13 build uses Java 21.
if [ -z "${JAVA_HOME:-}" ]; then
  for candidate in /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/java-21-openjdk-arm64 /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home '/Applications/PyCharm.app/Contents/jbr/Contents/Home'; do
    if [ -x "$candidate/bin/java" ]; then export JAVA_HOME="$candidate"; break; fi
  done
fi
if [ -z "${JAVA_HOME:-}" ]; then
  printf 'Install Java 21 (brew install openjdk@21) or set JAVA_HOME to a Java 21 JDK.\n' >&2
  exit 1
fi
if [ "$(uname -s)" = Darwin ]; then
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
else
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
fi
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
