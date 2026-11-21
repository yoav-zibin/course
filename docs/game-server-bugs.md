# Game server bugs and daily repair

The game runtime records failures that can require a change to a game's
server-side JavaScript in the persistent `game_server_bugs` collection. Ordinary
illegal moves (`InvalidMove`) and invalid caller input are not game bugs. The
private records retain the exact call, deterministic seed/time, source/schema
revision, rules and failure evidence; they can contain hidden state and must not
be exposed to players, public logs or source control.

The private evidence API accepts an authorized course Google session. Unattended
tools use the separate private admin API key as the HTTP Basic password, with
any username. The game-content master password does not grant admin API access:

- `GET /game-server-bugs?examined=false&limit=50&cursor=...` returns
  `{items,next_cursor}`. Follow all cursors, including after an empty page.
- `GET /game-server-bugs/{id}` returns one complete evidence record.
- `POST /game-server-bugs/{id}/examine` records an actual review, with
  `{outcome,notes,fix_game_version?,fix_commit?}`. Outcomes are `fixed`,
  `escalated` or `obsolete`. Records and examination notes remain stored;
  examined rows are excluded from the daily queue.

## Daily Codex task

The scheduler follows the existing user systemd/Codex queue pattern. Each day at
**07:00 UTC**, it checks for unexamined bugs and resumes the user's existing Codex
thread when work exists. `Persistent=true` runs a missed check after the user
service manager returns. Codex and this machine must be available, signed in and
able to reach the server; scheduler state and evidence are private local files.
A queue receipt prevents duplicate successful triggers on the same UTC date. A
failed queue or resume saves no success receipt, so a manual retry is possible.
Queueing or retrieving evidence never marks a row examined.

Install from a durable checkout as the signed-in Codex user:

```bash
python3 ops/game-server-bugs/install.py \
  --thread-id <existing-user-Codex-thread-id> \
  --password-file <mode-600-admin-api-key-file>
```

This creates `buildplay-game-server-bugs.service` and `.timer` in the user's
systemd directory and a private
`~/.local/share/buildplay-game-server-bugs/config.json`. It references the existing
credential file; the key is not copied into the unit, config or prompt. The
`--password-file` option name remains for compatibility; its contents must be
the admin API key, separate from any game-content master capability. Keep the
checkout and credential file at those locations. Inspect or retry with:

```bash
systemctl --user list-timers buildplay-game-server-bugs.timer
journalctl --user -u buildplay-game-server-bugs.service
python3 ops/game-server-bugs/review.py watch --dry-run
systemctl --user start buildplay-game-server-bugs.service
```

Use `systemctl --user disable --now buildplay-game-server-bugs.timer` to stop
future checks. The timer's queued task is defined in
[`instructions.txt`](../ops/game-server-bugs/instructions.txt).

## Review and publication

The agent takes a fresh private snapshot of every pending page:

```bash
python3 ops/game-server-bugs/review.py snapshot
```

The command follows the summary pages, fetches each full evidence record, and
skips rows another reviewer has already examined. It returns a private JSONL
path and count. The agent reads the exact
failure and textual rules, reproduces it, changes game server logic, and adds a
regression that verifies the rules as well as the repair. Existing resource
limits and JSON schemas remain requirements. Unknown peak memory measurements
must stay identified as unknown; they are not reconstructed exact peaks.

A fix must reach the same stored game through
[`PATCH /games/{game_id}`](agent-game-import.md#updating-a-game). Put the game's
secret or privately read master password in `game_addition_request_id_and_secret`
and send only changed fields; omit unchanged fields rather than sending `null`.
For a server-only repair, send `server_code` and the credential. Include
`unit_tests` or mechanical-rule fields only when they also change. Schemas come
from `unit_tests`; do not send a separate `game_schemas` field. The bug-evidence
API's HTTP Basic authentication does not replace the PATCH body credential.

Run the corresponding logic/example/schema checks and random walks for server,
test or mechanical-rule changes. Record the full test flow for the merged payload
when changing declarative presentation; metadata-only edits need lightweight
artifact/translation checks. Keep any additional audit coverage the task requires.
POST game routes create new games only; PATCH returns HTTP 200. Changing a
repository example alone does not update an imported game. Verify the returned
published game ID/version and replay the failing call before recording `fixed`:

```bash
python3 ops/game-server-bugs/review.py examine <bug-id> \
  --outcome fixed --notes-file <private-review-notes> \
  --fix-game-version <verified-published-version> \
  --fix-commit <verified-repository-commit-if-applicable>
```

Notes include the root cause, rules compliance, exact reproduction, tests and
publication evidence. Existing matches remain pinned to their old version;
remaining affected live matches must be disclosed and escalated, not silently
rewritten. A no-longer-applicable bug may be marked `obsolete` only with evidence
that its source/game is retired or a verified published version already fixes it.
An unfixable bug or a required platform/limit change is marked `escalated` with
the evidence and decision needed, and reported directly to Yoav in the resumed
Codex thread. Starting a fix, losing access, or incomplete verification does not
justify an examination mark. Interrupted work remains private and pending.

Repository fixes follow `AGENTS.md`: integrate upstream first, choose local checks
that exercise the changes, then push directly to `main`. Focused checks are sufficient
when appropriate; use CI for broad validation and address failures when they appear.
Running every suite locally, including native iOS and Android, is not required.
The daily task uses the existing CI/deployment path and preserves production
configuration and test/spending allowances.
