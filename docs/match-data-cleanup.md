# Match data cleanup

All matches are public, including older matches and rematches. There is no
invite-only mode. Invitations are sharing and joining links; they do not grant
viewing permissions. The game continues to project hidden cards and other
player-specific information through `viewFor`.

After deploying this behavior, remove the obsolete `private` field from both
Firestore match headers and their embedded JSON with the bounded maintenance
command below. It preserves match state, move children, unknown metadata and
per-user hidden-list settings. Each update rechecks the document in a transaction
and saves a private typed preimage before writing, so gameplay can continue.

Run from `/opt/game-platform` on the production VM using its existing virtual
environment and private configuration:

```bash
sudo .venv/bin/python -m game_platform.match_privacy_cleanup \
  --config /opt/game-platform/config.json \
  --state-dir /opt/game-platform/backups/match-privacy-20261120/audit \
  --expected-project project-c9ca4f0b-4e47-43ff-847 \
  --expected-database '(default)' \
  --expected-namespace production_v3
```

The default is a dry run. Repeat with `--apply` and a distinct `apply` state
directory to remove the fields. Then run a fresh dry run with a distinct
`verify` directory and check that `counts.matches.legacy` is zero and `complete`
is true. Output contains aggregate counts only.

Each invocation scans at most 10,000 records, with pages of 50. Exit code 2 means
the sweep is incomplete: rerun the same command and state directory to resume.
Exit code 0 means complete; exit code 1 means an error. Checkpoints are bound to
the exact project, database, namespace, policy and dry-run/apply mode. Preserve
the owner-only state directories and preimages outside the repository.
