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
test -f "$repo_root/invite_code_cleanup.py"

# Check the existing namespace without rewriting configuration or releasing codes.
cd /opt/game-platform
/opt/game-platform/.venv/bin/python -m game_platform.invite_code_cleanup \
  --config /opt/game-platform/config.json --check-config
systemd-analyze verify "$repo_root/deploy/game-platform-invite-codes.service" \
  "$repo_root/deploy/game-platform-invite-codes.timer"
install -d -m 750 /var/log/game-platform
install -m 644 "$repo_root/deploy/game-platform-invite-codes.service" /etc/systemd/system/
install -m 644 "$repo_root/deploy/game-platform-invite-codes.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now game-platform-invite-codes.timer
systemctl is-active --quiet game-platform-invite-codes.timer
