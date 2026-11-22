# Retired personal referral cleanup

The application now credits recruitment through shared multiplayer match links.
Personal referral codes, `/r/<code>` links, and inbound `invited_by_user_id`
parameters are retired. The persistent `invited_by_user_id` relationship remains
the source for direct and transitive recruitment reports.

`game_platform.personal_referral_cleanup` removes personal codes from raw user
documents and their serialized JSON, deletes the retired namespace's `referrals`
reservation documents, and deletes obsolete referral report nodes and their
identifiable parent jobs so personal relationships and derived counts disappear
from those snapshots. Unrelated dashboard jobs are preserved. It clears an account's inviter only when **both**
`invited_via_invite_token` and `invited_via_match_id` are absent or empty. Historical
match recruitment therefore survives expired or recycled short codes; the cleanup
does not try to resolve those codes to their current allocations. Existing data
with both a personal referral and a match token keeps its recorded inviter,
because the original attribution cannot be separated reliably.

Apply also backfills permanent ID-only recruitment nodes, one bounded user page
at a time, after the personal-only links have been removed. Durable historical
nodes, invitation allocations, and funnel events are preserved. A dry-run creates
none of these records.

Before backfilling nodes, another bounded stage archives every retained legacy
match invitation, including its existing view count and acceptance records. A
missing `invite_created` event is reconstructed using the allocation's recorded
creation time. Reconstructed archives/events are labeled accordingly. The worker
does not invent per-view events or visitor identities from aggregate view counts.
Dry-run reports the invitations that would receive archives/events without writes.

Run with application writers and background workers stopped. Back up the
namespace first using the existing export/Firestore backup procedure. The script
uses the existing private configuration without changing database selection or
credentials. Select an owner-only directory outside the checkout for its
checkpoint and preimages.

Preview the exact deployment target with dry-run, which is the default:

```bash
python -m game_platform.personal_referral_cleanup \
  --config /private/path/config.json \
  --expected-project PROJECT \
  --expected-database DATABASE \
  --expected-namespace NAMESPACE \
  --state-dir /private/path/personal-referral-preview \
  --page-size 50 --max-documents 10000
```

Apply with the same target arguments, `--apply`, and a **different** state
directory, for example `/private/path/personal-referral-apply`. A pass processes
at most the requested document budget in pages of at most 100. Exit status 2 means
the bounded pass is unfinished; repeat the exact command to resume. Exit status
0 means complete, and 1 means an error. Resuming a completed apply is a no-op.
Checkpoints reject a different source or dry-run/apply mode. The script prints
aggregate counts and error classes only.

Each changed document is re-read transactionally and has a private, fsynced,
Firestore-typed preimage before mutation. User passwords, linked accounts,
balances, unknown fields, revisions, game records, matches, and invites are
preserved. Preimages contain private account data; retain them with the existing
protected backups. Recovery must compare the current document with the journal's
`after_sha256` before restoring its `fields`; a deletion entry has `deleted: true`
and `after_sha256: null`, and must still be absent before restoration. Recovery
must also run with writers stopped.

The cleanup invalidates the published referral-report pointer, because its counts
may contain removed personal-only relationships. Rebuild with a **new run ID**
using the existing `scaling_tools referral-dashboard` command before reopening the admin
report. Restart the application and workers to clear their caches, then verify
the leaderboard and referral report. A fresh dry-run directory can verify that
user code fields, reservation documents, and obsolete referral snapshots are gone; invalidating an
existing report pointer remains a planned change in such a fresh preview.

For a stopped legacy JSON-file deployment, the module also provides
`cleanup_json_file(path, private_backup_directory, apply=False)`. It preserves the
version-one snapshot's other data, previews by default, saves an owner-only
preimage before apply, and performs the same per-user code and relationship
cleanup. Production uses the bounded QueryStore CLI above.
