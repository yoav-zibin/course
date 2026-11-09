# Reviewed catalog deduplication

> **Completed one-off cleanup.** The draft/working-copy mechanism described
> below no longer exists — there are no drafts anymore; unpublishing is a pure
> flag flip (`service.py`). Kept as the record of the reviewed pairs.

The user requested one entry per duplicate game. This release reversibly
unpublishes three reviewed entries, preserving versions, schemas, private
working copies and old matches. It does not physically delete games or drafts.

| Keep | Retire from public catalog | Basis |
|---|---|---|
| Backgammon20a83777…v4 | Backgammon(copy)8d523bfd…v3 | Identical client/server code; keep original. |
| Gomoku b59b79d7…v3 | Gomoku39a5e1f5…v3 | Both15x15 unrestricted five-in-a-row; keep original catalog entry. Different UI/AI implementation does not create different human rules. |
| Built-in Tic-tac-toe v3 | Tic Tac Toe3acab71b…v3 | Both classic3x3; keep built-in with perfect computer play and prior replay/accessibility work. |

Nine Stars(Demo) is a take1-or2 star game; Nine Stars is a scored3x3 claim
game. They are different games and remain published.4x5 Tic-tac-toe, timed
Chess and four-player Chess are rule variants and are also retained.

`games/catalog-deduplication.json` freezes IDs, current versions, both source
hashes, player counts and join/leave rules on both sides of each reviewed pair.
This is not name-based automatic deletion. A changed/missing/hidden keeper or
an intervening source/version/rule edit skips the pair. The entire bounded
manifest is validated before the first effect.

Each operation uses the normal platform lock/QueryStore transaction, including
both source guards, draft preservation, unpublication and an existing internal
`migration` collection completion marker. An existing newer private draft is
untouched; otherwise normal unpublish creates a recoverable working copy with
the source's schemas and workflow. The schema argument omission in that normal
unpublish path is fixed so server-code games can be retired without a500.

The marker makes this a one-time release cleanup. Normal author republishing,
even without a version/code change, survives later server restarts. Concurrent
author changes abort the transaction instead of leaving a partial draft/hide
or marker. InMemoryStore tests keep in-memory markers; unknown persistent
adapters without a transactional journal are skipped. Both production Firestore modes are supported through the real metrics wrapper.
Query mode uses the atomic migration journal above. Legacy snapshot mode uses a
receipt in its existing prefixed meta collection, claimed before any visibility
change, then flushes the snapshot and marks completion. A crash or failed save
leaves a claim for operator review and never automatically re-hides a later
restoration. It cannot claim atomic rollback across the snapshot and receipt.
Snapshot restart, restored publication, failed claim and crash-after-claim are
covered explicitly. Other unknown persistent adapters still skip safely.
No snapshot format, configuration or access changes are introduced.

31 focused tests cover both-side guards, whole-manifest prevalidation,
idempotence, working-copy/history/balance preservation, real seated history
source/view/legal move after hiding, normal same-source republishing and a
fresh QueryStore instance observing durable completion. A transaction-aware
fake independently changes the keeper before commit and verifies complete
rollback of hide/draft/marker. Unsupported persistent adapters are refused.

```sh
PYTHONPATH=.. python -m pytest game_platform/tests/test_unpublish.py
```

Release is direct to yoav-zibin/course main, no branch merge. Foundation, data,
tests and this explanation precede startup activation. Final acceptance reads
the live catalog and confirms all three keepers remain, all three retired IDs
are absent, the two different Nine Stars games and rule variants remain, and
no remaining published server-code game lacks its schema.
