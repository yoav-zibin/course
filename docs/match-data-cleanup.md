# Match kind migration and cleanup

[The match contract](match-kinds.md) defines the current policy. Every match has
`match_kind`: `computer`, `pass_and_play` or `multiplayer`. Computer/pass-and-play
matches are private to one owner account and saved to the cloud. Multiplayer has
human accounts only and supports shared invites and notifications.

The former all-public policy and `match_privacy_cleanup` command are historical;
do not use that policy to authorize access to private single-player records.

## Bounded migration

Deploy the match-kind release, then run the maintenance command using production's
existing virtual environment, configuration and database namespace:

```bash
sudo .venv/bin/python -m game_platform.match_kind_migration \
  --config /opt/game-platform/config.json \
  --state-dir /opt/game-platform/backups/match-kinds-20261120/audit \
  --expected-project project-c9ca4f0b-4e47-43ff-847 \
  --expected-database '(default)' \
  --expected-namespace production_v3
```

The default is a dry run. Inspect `counts.computer`, `counts.pass_and_play`,
`counts.multiplayer`, `counts.invalid` and `counts.backfill`. Valid legacy matches
are classified from their seats/account ownership; a waiting human lobby remains
multiplayer. Invalid mixed computer/multiple-human-account rosters are retired.
Rows with incompatible explicit kinds, or single-player records with stakes or
a recorded token pot, are invalid too. Held stakes use the usual refund path.

Repeat with `--apply` and a distinct `apply` state directory. Each transaction
rereads the current row, records private typed recovery data, then persists the
kind or removes an invalid match through the ordinary deletion path. That path
handles stake refunds, invitations, counters and child cleanup. Valid matches keep
their state, pinned version, move history and unknown metadata. Private kinds lose
obsolete invite records/codes and the retired `private` flag.

Run a new dry run with a distinct `verify` state directory afterward. Require
`complete: true`, `counts.backfill: 0` and `counts.invalid: 0`. Output contains
aggregate counts only; keep all checkpoint/preimage files outside source control.

Each invocation scans at most 10,000 records with pages of 50. Exit code 2 means
the bounded sweep is incomplete: rerun the same command and state directory to
resume. Exit 0 means complete; exit 1 means an error. Checkpoints bind to project,
database, namespace, policy and apply/dry-run mode. Preserve owner-only directories
and private recovery records outside the repository.

## Existing device saves

Backend migration cannot read browser/native local storage. The updated client
uploads each existing single-player save when that installation opens with its
owning account and a connection. Preserve unsynced snapshots until cloud
acknowledgement, including finished matches. Keep an anonymous legacy save until
an account is selected rather than silently deleting it.
