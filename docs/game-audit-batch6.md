# Game repairs: schema recovery and Stack Duel

The mandatory-schema change left50 of53 published latest games, plus their
historical versions, without contracts. Online starts failed and old matches
could have null views/rejected legal moves. This release fills99 exact missing
historical contracts and repairs Stack Duel's two confirmed game/UI issues.
The smaller Bulls and Cows and Chopsticks UI issues are outside this release.

## Schema recovery

`games/schema-recovery/manifest.json` freezes exact game IDs, versions and both
source SHA256 values. `contracts.json` holds explicit Draft2020-12 legacy
compatibility envelopes: root JSON types and typed optional top-level fields.
These are deliberately conservative structural contracts, not complete formal
game-rule specifications. Original server Move validation, private view logic,
actor checks, payout checks, execution limits and schema validation remain on.
Unknown/phase-specific optional fields remain allowed. Existing author schemas
are never replaced. New games with no schema remain blocked: this is a bounded
recovery of the reviewed99 versions, not a global runtime fallback.

Three independent shards replayed every advertised count, fixed seed11,
random/computer modes, up to200 actions per walk:440 walks,41854 actions and
308643 calls.220 independent seed29 count walks then used the typed contracts.
Unobserved terminal/promotion fields were reviewed against source rather than
mistakenly constrained to null: winning lines are nullable arrays, winners and
teams are nullable numbers, promotions are nullable strings. Debug is a JSON
editor by design; its specific contract preserves arbitrary JSON state/view,
with explicit move/turn/payout shape checks and eight regression shapes.

This finite sampling cannot prove every historical rule branch. The structural
contracts keep original authoritative validators responsible for legal actions.
Existing President5/6 seven-player `out` and ERS3 seven-player `no cards to flip`
failures were reproduced with the original test baseline too; they are old
engine behavior, not failures introduced by these schemas. Current President7
and ERS4 remain their already repaired code. Historical game code is not
silently replaced with a different rules version.

`legacy_schema_migrations.py` prevalidates the complete bundle before writing.
Only a missing schema on an exact hash-matching existing version is updated;
all other fields, version number, metadata, visibility and code are retained.
Each QueryStore comparison/write uses its normal operation transaction. An
optimistic concurrent-author conflict aborts without stale retries. Unknown,
changed and existing-schema records are skipped. Running again writes nothing.
Recovery runs before GamePlatform constructs/caches logic or resumes old turns;
completed snapshot-store writes are flushed. No users/matches/balances are
scanned or rewritten by the migration and production configuration is retained.

## Stack Duel7 to8

The old game checked only the unrotated piece at the center spawn. Its actual
client lets a player rotate and choose any column. The new terminal check uses
all legal placements, consistent with the published no-room-for-next-piece
rule. Exact seed29 six-move `(rot,col)` replay:
`(0,5),(3,3),(0,4),(1,4),(1,0),(2,2)`.
The resulting24/80-occupied board now continues with the five valid S drops;
a genuinely blocked next piece still ends and pays out correctly.

The platform's normal leave settlement can end a match while the game's
`winners` remains null. The actual client now renders a neutral player-left
or game-ended message for that envelope instead of calling null.map. Genuine
winner/tie messages are retained. Player-left settlements are unchanged.
The new code pair ships a detailed state/move/view schema. Its publication
can replace only the exact just-recovered legacy contract hash, retaining an
intervening author's different schema. The normal code/version guards and
publication gate still apply. Existing matches retain their own source version.

## Regression and release checks

- 23 schema recovery tests: all guards, idempotence, schema prevalidation before
  writes, author preservation, real QueryStore transaction/conflict path,
  actual historical-match view and legal-move restoration, and Debug JSON shapes.
- 19 production QuickJS Stack tests: exact counterexample and all five follow-ups,
  genuine terminal board, row clearing, scores,2/3/4-player full random/computer
  matches, payouts, leave and explicit schema boundaries. Normal100ms calls;
  playerLeft retains the platform's existing2s limit.
- 5 actual-script Node Stack tests; all264 web script tests pass.
- Isolated full-data rehearsal:99 contracts updated, then99 unchanged results.
  All historical source/version/metadata fields and the three existing strict
  contracts were preserved. Real guarded Stack publication produced8 and was
  idempotent. All53 latest games passed actual HTTP create/join/start and a legal
  first move against the recovered store; these tests use only local users/data.

```sh
PYTHONPATH=.. python -m pytest game_platform/tests/test_legacy_schema_migrations.py game_platform/tests/test_game_patch_migrations.py game_platform/tests/test_audit_batch6_stack.py
node --test tests/web/audit-batch6-stack.test.cjs
```

The full repository CI remains the deployment gate. The health wait is bounded
at180s for the initial99-version Firestore recovery; game execution limits and
publish checks were not increased or disabled. Publication/recovery logs are
collected after health succeeds. Final acceptance separately reads live latest
schemas, reviewed historical hashes and Stack8 code/schema, not just /health.

## Repeatable technique/prompt

Owners: one transaction/migration agent, one Stack rules/UI/schema agent and
three version-contract review shards. Prompt: repair only confirmed major
issues; preserve smaller excluded UI issues; freeze version+both source hashes;
keep author contracts, code, balances and old match versions; use real QueryStore
transactions; prevalidate all contracts before writes; execute real QuickJS and
client handlers; replay all player counts with fixed time/seeds; distinguish old
engine failures from schema false positives using the same baseline trace;
review unseen terminal types explicitly; test idempotence/concurrent edits and
real HTTP starts/old-match moves; do not publish independently.

Direct dependency-first commits to yoav-zibin/course main, no branch merge.
Startup activation follows complete data, code, tests and deployment checks.
