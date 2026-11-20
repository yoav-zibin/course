# Match invite code maintenance

Each four-letter code reserves one of 456,976 URLs. The match lifecycle releases
its reservation when play starts, ends, or the match is deleted. Codes also
expire after seven days.

The production deployment installs `game-platform-invite-codes.timer`. It runs
daily, catches up after a reboot, and invokes `game_platform.invite_code_cleanup`
with the existing private configuration and production query namespace. No
configuration or credential values are copied into the repository.

The worker reads invitations in pages of at most 100 records and rechecks each
candidate transactionally before deleting it. Expired, revoked, orphaned and
inactive reservations are removed, and the matching lobby's code is cleared.
A reused code is checked against its current allocation. The worker reads only
the matches referenced by invitations. A persisted cursor resumes interrupted
sweeps; unfinished sweeps raise `invite_code_cleanup_incomplete`.

After reclamation, the existing 64 counter shards report current short-code
reservations. More than 228,488 reserved codes raises
`invite_code_capacity_high` with `alert="minor"`. The dedicated enabled Cloud
Monitoring policy `BuildPlay: invite code capacity and cleanup` sends capacity,
incomplete-sweep and worker-failure alerts to the configured admin channel. It
operates independently of the broader server policies, which may be disabled.
Review shorter retention or longer codes if the capacity alert fires. Structured
logs contain totals, never invite codes, credentials, or player data.

Install or reconcile only this alert policy, reusing the existing minor-policy
channels, from an authenticated Monitoring editor account:

```bash
python3 ops/monitoring/install_invite_alert.py --project PROJECT
```

The installer is idempotent and preserves the broader policies and notification
channels. `--channels` can select existing channel resource names explicitly.
The production Ops Agent is configured to collect JSON records from
`/var/log/game-platform/server.log`, the same file used by the cleanup worker.

Inspect the schedule and the last pass on the production VM:

```bash
sudo systemctl list-timers game-platform-invite-codes.timer
sudo journalctl -u game-platform-invite-codes.service -n 50
```

To resume a bounded sweep immediately, run
`sudo systemctl start game-platform-invite-codes.service`. The hard runtime limit
is 35 minutes; the worker normally stops after 30 minutes with a saved cursor.
