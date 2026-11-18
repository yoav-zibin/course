#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/buildplay-model-tests.XXXXXX")
trap 'rm -rf "$test_build_dir"' EXIT

echo 'Testing local rules, handoff, and persistence'
swiftc -module-cache-path "$test_build_dir/modules" \
  GamePortal/Match.swift GamePortalTests/main.swift -o "$test_build_dir/rule-tests"
"$test_build_dir/rule-tests"

echo 'Testing cache, version pinning, account isolation, and storage failures'
swiftc -module-cache-path "$test_build_dir/modules" \
  GamePortal/OnlineCache.swift GamePortalTests/OnlineCache/main.swift \
  -o "$test_build_dir/cache-tests"
"$test_build_dir/cache-tests"

echo 'Testing mocked online store, offline moves, restart, and conflicts'
bash GamePortalTests/OnlineStore/run.sh
