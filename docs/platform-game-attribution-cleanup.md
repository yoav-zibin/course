# Removing legacy game attribution

Games belong to BuildPlay. Current models, APIs, indexes and writers have no
creator account. The explicit `platform_game_cleanup` maintenance command also
removes the former `owner_user_id` from already-stored records. It never runs
at application startup.

The bounded scan covers exactly `games`, `game_versions`, and the retired
`game_drafts` / `game_test_sessions` collections in the configured namespace.
Only the top-level Firestore field and the top-level field inside `json` are
removed. Unknown legacy payload, nested game data, code body chunks, game IDs,
version numbers, revisions, publication settings, counters and timestamps are
preserved. Match ownership, invite authors, saved/recent games, conversation
text and account identities serve different purposes and remain intact.
Historical rollback/recovery namespaces and existing backups remain recovery
artifacts; this command does not rewrite them.

Run on the existing VM using its private external configuration and identity.
Do not copy credentials, evidence or preimages into Git. Explicit source
expectations prevent accidentally selecting another database or namespace:

```sh
python -m game_platform.platform_game_cleanup \
  --config <existing-private-config> \
  --expected-project <configured-project> \
  --expected-database '<configured-database>' \
  --expected-namespace <configured-namespace> \
  --state-dir <private-audit-directory>
```

The default is a read-only audit. To apply, use `--apply` and a different private
state directory. The state directory must have mode 700; files have mode 600.
`--page-size` is bounded to 1–100 and `--max-documents` to 1–100,000 per invocation.
An incomplete pass exits 2; rerun with the same directory to resume its cursor.
Do not reuse a completed audit directory for verification: use a **new** directory
to scan every collection again and confirm `legacy: 0`.

Every document is reread in a Firestore transaction, so a concurrent content
edit is preserved or causes a conflict rather than being overwritten. Before
each write, an individually atomic preimage under `preimages/*.json` is fsynced
along with its directory. It contains Firestore-typed fields and before/after
SHA-256 values. A conflict or interruption can leave an unused preimage; recovery
must check the current document's digest against `after_sha256` before considering
restoration. Never blindly restore a full old row over later game edits. Decode
typed fields using Firestore's `Document` protobuf / `decode_dict`, and restore
only after a transactional version check and a concrete recovery review.

A crash after a database commit but before the local checkpoint can cause an
idempotent replay and conservative counters. A fresh full audit plus preimage
digest verification, rather than checkpoint counts alone, establishes the final
result. Aggregate summaries contain counts only; private record contents and
parsing/configuration errors are never echoed by the CLI.
