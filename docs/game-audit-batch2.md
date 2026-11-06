# Audited game patches: batch 2

This release repairs Guandan, Quoridor, Blokus, 3 Minute Chess, Mini Golf Duels,
and 4 player chess. The exact reviewed client/server originals, IDs and versions
are recorded by SHA-256 in `games/audit-batch2/manifest.json`.

The new batch uses the existing guarded game publication path. Server startup
runs batch 1 idempotently, then batch 2. A game is updated only when its current
version and both original hashes still match; newer author edits are skipped.
The normal server-code publication gate runs before a new version is saved.
Existing matches remain pinned to their original game version.

The fixes cover:

- Guandan wildcard pair recognition and natural level-rank sequences; client
  combination detection and suggestions must agree with server validation.
- Blokus illegal UI placement and premature computer/random permanent passing.
- Quoridor illegal wall placement in the client and recovery after a rejected
  move without losing duplicate-send protection.
- 3 Minute Chess fractional-coordinate validation, long elapsed time accounting,
  repetition keys and timeout adjudication when the opponent cannot mate.
- Mini Golf client/server physics agreement, using authoritative shot results.
- 4 player chess check highlighting and elimination of stalemated armies under
  the game's own displayed rules.

Previously noted non-minimal chess notation is excluded: longer algebraic
forms alone do not establish a substantive defect. The existing automatic
threefold feature is preserved; the fix concerns position equality/counting,
not a new claim-based tournament UI.

Focused regression files accompany these game pairs. Deployment acceptance
requires successful CI/CD plus reading every published game back and comparing
both code fields with this release. Uploading files without the startup update
would not change these database-backed game versions.

## Release validation

- Full backend suite: 839 passed, 54 skipped.
- Node web regressions: 193 passed.
- All six exact published originals were updated locally through the real
  publication gate, preserving original versions and metadata.
- Repeating that publication simulation produced six `unchanged` results.
- Mini Golf, Blokus, Guandan and 3 Minute Chess were also checked against the
  normal one-second gate and 100 ms per-call QuickJS limit.

Production follow-up: the VM rejected Golf, 3 Minute Chess and Guandan because
no complete random walk fit within one second (confirmed in migration logs).
Batch 2 now uses a five-second total publication-test budget through an internal
admin-only option. All test logic, stored regression seeds, hash/version guards
and the 100 ms per-function runtime limit remain in force. Normal builder
publication and the public test API retain their one-second defaults. CI reports
only the six audit migration result lines to make partial publication visible.
