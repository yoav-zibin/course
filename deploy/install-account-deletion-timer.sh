#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo 'Run this installer as root on the production VM.' >&2
  exit 1
fi
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
test "$repo_root" = /opt/game-platform/game_platform
test -f /opt/game-platform/config.json
test -x /opt/game-platform/.venv/bin/python
test -f "$repo_root/account_deletion_worker.py"

# Read the existing private configuration; do not copy or rewrite it. This mode
# checks the exact namespace's schema marker without scheduling/deleting anyone.
cd /opt/game-platform
/opt/game-platform/.venv/bin/python -m game_platform.account_deletion_worker \
  --config /opt/game-platform/config.json --check-config
systemd-analyze verify "$repo_root/deploy/game-platform-account-deletions.service" \
  "$repo_root/deploy/game-platform-account-deletions.timer"
install -m 644 "$repo_root/deploy/game-platform-account-deletions.service" /etc/systemd/system/
install -m 644 "$repo_root/deploy/game-platform-account-deletions.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now game-platform-account-deletions.timer
systemctl is-active --quiet game-platform-account-deletions.timer
