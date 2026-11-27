#!/usr/bin/env bash
# Reproduce one failed CI check on the shared Linux host. The lock is shared by
# all checkouts for this user, and the CPU quota covers every child process.
set -euo pipefail
if (( $# == 0 )); then
  echo "Usage: $0 command [args...]" >&2
  exit 2
fi
runtime_dir=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
exec flock --close "$runtime_dir/buildplay-local-check.lock" \
  systemd-run --user --scope --quiet --property=CPUQuota=50% --property=CPUWeight=10 \
  nice -n 15 ionice -c 3 "$@"
