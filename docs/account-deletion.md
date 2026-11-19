# Scheduled account deletion

Players log in, open their profile, select **Request account deletion**, and then
confirm. Dismissing the confirmation does nothing. The public `/delete-account`
page explains this flow.

The server records a deadline exactly 24 hours after confirmation. The player can
keep using the account and choose **Undo account deletion** before that deadline.
The profile and a persistent portal banner show the deadline. Requests, status
and undo are shared by web, Android and iOS and survive refresh/account switching.
An internet connection is required to request or cancel deletion.

Deletion never starts early. Cancellation is refused at or after the deadline.
The hourly worker starts permanent removal on its next run, normally 24–25 hours
after confirmation; large cleanups can resume over multiple bounded passes.
Once a purge starts, authentication and writes for the account and its merged
aliases are blocked. Pending accounts cannot be merged or bypass this flow with
the legacy administrator-delete operation.

## API

- Authenticated `POST /users/me/deletion-request` with JSON `{"confirmed":true}`
  schedules the caller's own account. Repeating it preserves the original deadline.
- Authenticated `DELETE /users/me/deletion-request` cancels before the deadline.
  After cancellation, a new confirmed request gets a fresh 24-hour window.
- Both return the own-user profile. The nullable `deletion_requested_at`,
  `deletion_scheduled_at` and `deletion_started_at` fields are private; public
  profile responses do not expose their values.

There is no user-ID parameter and no deletion-through-email or GET operation.
Confirmation is checked strictly on the server, including rejection of numeric
or string values that resemble `true`.

## Cleanup

The durable query-mode queue is selected by its indexed `due_at` field. Claim and
cancellation read the same user/request inside transactions. Each purge step
commits its mutation and progress together; process failure does not reset the
deadline, repeat refunds, or resurrect removed data.

Cleanup removes the account and merged aliases, login/referral reservations,
online matches the account owned or participated in (including completed/shared
matches), move history and private match evidence, related invitations and queued
work, libraries, push registrations/deliveries, account-linked experiment and
token records, submitted bug reports/feedback, and structured cached account
references. Shared matches disappear for the other players too. Held match pots
use the existing refund behavior.

Published platform games and anonymous numeric aggregates remain. Device-only
offline saves/caches cannot be remotely erased. Tiny, unindexed hash-keyed boolean
fences remain to prevent already-running requests from recreating deleted users
or matches; they contain no names, credentials, account IDs or match payloads.

Before claims, a bounded, resumable compatibility pass fills association metadata
for older match histories and queued notifications. It does not scan all users or
rewrite gameplay JSON, revisions or counters. New writes maintain these fields.

## Hourly VM job

`deploy/game-platform-account-deletions.timer` runs the matching oneshot service
hourly, catches missed runs after reboot, and prevents overlapping service runs.
The job reads the existing `/opt/game-platform/config.json`, using its Firestore
project/database/namespace and existing production opt-in. It never copies the
private config, starts HTTP/gameplay/push workers, or opens a parallel JSON writer.

Deployment installs the timer through `deploy/install-account-deletion-timer.sh`.
The installer first checks storage without claiming/deleting any account. Required
single-field indexes are declared in `scaling_indexes.py`; deploy them with the
existing index deployment command and explicit production opt-in before running
the new worker against production.

The entrypoint is `python -m game_platform.account_deletion_worker --config PATH`.
`--check-config` checks connectivity only. Default limits are 25 due accounts per
pass, 50,000 total processing steps and 30 minutes per invocation. Progress stays
durable if the budget is exhausted; the next run resumes it. Job output contains
counts rather than private configuration or user records.

Operational checks on the VM:

```sh
sudo systemctl status game-platform-account-deletions.timer --no-pager
sudo systemctl list-timers game-platform-account-deletions.timer --no-pager
sudo journalctl -u game-platform-account-deletions.service --since today --no-pager
```

Focused tests cover strict confirmation/auth/privacy, the 24-hour boundary,
restart/cancellation races, large-account resumption and physical child deletion,
refunds, late-write fencing, legacy metadata, and desktop/phone portal undo flows.
The Firestore CI workflow also runs the actual emulator transaction tests.
