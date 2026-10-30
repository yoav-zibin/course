# Handoff: backend scaling and verified portal activity

From Chad (sc5386) to Ian (zkamenov) and his agent. Updated October 29, 2026.
This note is the handoff; Chad has not sent a separate message or email.

## Current integration point

Use [PR #32](https://github.com/yoav-zibin/course/pull/32), branch
`sc5386/backend-scaling`, head **0b5b199**. It integrates main through
**ee2890c**, including Marcelle's live fake-user generator. This note changes
only documentation on your branch; it does not install or deploy the backend.

GitHub CI on **0b5b199** is green: backend, unit-tests, Firestore emulator
and desktop/mobile UI tests all passed. The production deploy job correctly
skipped this PR run. GitHub reports the PR conflict-free. The PR remains an
opt-in draft test release, with the limits below.

## Separate live demo deployed after this handoff

Chad deployed a **separate protected hostname** on the existing scaling VM:
https://sc5386.34.26.223.67.sslip.io/demo . It runs
`sc5386-live-demo.service` on loopback **8132**, from the private csccs checkout.
Your original `game-platform-scaling` service on 8000 and IP virtual host are
unchanged and active. The primary VM, buildplay.fun routing and default database
were not modified. PR #32 is still unmerged/draft; this is a separate test release.

The live namespace contains a prepared September dataset: **233 synthetic users,
133 games, 1,257 matches, 2,949 moves, 60 drafts and 60 library entries**. Public
browser checks may add a few test matches/moves afterward. New playable catalog
entries are unchanged shipped game copies; old counter capacity fixtures remain
available to the backoffice but are unpublished from the playable catalog.
Daily, A/B and referral snapshots were rebuilt before publishing.

The user explicitly approved **less than $1 additional database/test usage**,
excluding ordinary VM cost. Do not run a load generator or bulk seed against
this site, raise its allowance, or change its ledger. `scaling_live_budget.py`
reserves SDK RPC units before dispatch in a persistent SQLite allowance shared
by preparation and the live server. Limits are 250,000 conservative operation
units, 32 MiB written payload, 128 MiB served response bodies, and a three-day
period ending 2026-11-02 00:32 UTC. The deliberately conservative operation
reservation is $0.50, with margin under $1 for small storage/transfer usage.
This is **not** a project-wide Cloud Billing cap or a verified invoice.

The wrapper blocks AI/refactor/external-auth actions, uses its own HTTPS/Basic
sign-in, rate limits requests, caps CPU/RAM, and wakes workers for jobs rather
than constantly polling an idle database. Scoped GET caching reduces repeated
unchanged reads; mutations and worker passes invalidate it, and live match
detail stays uncached for fresh clocks. This is a single demo process, not a
general distributed cache. Credentials/config/fixture accounts/ledger stay out
of Git; get access details from Chad rather than publishing them in this note.

Validation for the wrapper: full local backend **553 passed**; five dedicated
budget/real-SDK/emulator/worker/cache tests passed. Public HTTPS checks passed
Portal/Builder pagination, stats/referrals/backoffice, saved-library pages and
history, with zero page JavaScript errors. Actual UI human moves, server computer
replies and leaving the match also passed. Final CI for 0b5b199 is green: backend, unit, emulator and UI checks all passed; production deployment correctly skipped.
See PR docs/scaling-live-demo.md and docs/scaling-live-verification.json.

Rollback stops only sc5386-live-demo and disables only its nginx virtual host;
it does not touch your original service or delete data. Preserve the allowance
ledger across restarts. The site returns 503 when its allowance or period ends.

## What Chad completed

- Query storage reads records on demand, rather than loading the database into
  each process. Moves, token ledgers, counters, idempotency records and durable
  jobs commit atomically. Two independent API processes and restart/retry
  behavior were previously rehearsed on the named cloud database.
- Repaired the merge/delete emulator failures from fc62b7b: move-history stage
  dispatch and omitted resume parameters. Merges transfer balances and daily
  grant dates, preserve game player IDs and wait if both accounts occupy seats
  in the same unfinished match. Jobs remain offline with writers stopped.
- Preserved main's experiment/campaign integration, added query storage and
  migration for experiment records, and removed global scans from signup and
  match-start attribution. The new A/B report uses persistent distinct-user
  markers and atomically publishes an offline aggregate snapshot.
- Saved libraries now use separate records, with paginated reads, idempotent
  saves/removals, resumable legacy normalization and merge/delete handling.
- Daily creation reports can anchor their 30-day window to a historical date.
  Transitive referral reports use a persistent leaf queue with bounded memory;
  admin pages page through leaders, roots, children and search results.
- Fixed the account menu rebuilding during polling, which could interrupt guest
  signup. Browser regression covers typing/focus and repeated menu dismissal.
- Changed CI triggers to avoid duplicate feature push and PR workflow runs.

## Required activity: actually executed

On `game-platform-scaling`, named database `game-platform-scaling`, namespace
`scaling_v1`, the deterministic browser fixture played September 1–30:

- 44 guest accounts created through the portal, 30 completed matches.
- 14 two-human and 16 human-versus-computer matches, 7 early departures.
- 372 UI actions, 192 committed moves (136 human, 56 computer).
- Zero page errors, failed actions or server 5xx responses.
- Exact copies of shipped client/server game sources; zero model API calls.

A separate referral-link scenario produced a three-level chain. Offline reports
completed for the entire namespace: **170 users, 73 games, 1,137 matches and
2,413 moves**. Every match history was reconciled across all 12 pages against
move counters. Referral summary: 3 inviters, 3 invited users, longest chain 3,
biggest tree 4. These totals include earlier synthetic correctness fixtures.

See these files on the backend branch:

- `docs/portal-activity.md`: reproducible private harness/runner instructions.
- `docs/portal-activity-cloud.json`: successful month and per-match evidence.
- `docs/portal-friends-cloud.json`: referred signup scenario.
- `docs/portal-cloud-dashboards.json`: aggregate cloud report snapshots.
- `docs/portal-cloud-history-validation.json`: full history reconciliation.
- `docs/portal-http-benchmark.json`: your actual benchmark's output.
- `docs/portal-live-generator-emulator.json`: Marcelle tool compatibility run.

The month fixture currently plays tic-tac-toe; poker was copied but not played.
It is a deterministic backend fixture, not a replacement for Marcelle's
`tools/fake_users` control/health tool. Her merged generator passed 24 tests;
a two-minute browser rehearsal recorded 4 accounts, 6 created matches, 23 moves,
3 departures, 2 speed matches and 1 referral signup with zero errors. Its generic
click adapter gave up on 3 turns and left; that limitation is recorded.

## Benchmark and deployment state

Your `scale_benchmark.py` ran the read-only paginated mix on the same cloud
query-store deployment through an authenticated SSH tunnel. Ten-second stages:

| Clients | Requests/second | p95 ms | Errors |
|---:|---:|---:|---:|
| 1 | 6.7 | 187.70 | 0 |
| 2 | 13.4 | 205.23 | 0 |
| 4 | 19.4 | 263.81 | 0 |

Measured private harness peak cgroup memory: 85,880,832 bytes. This short read
test is not sustained capacity proof or a one-versus-two-VM comparison.
All **13 composite indexes and 60 field overrides are ready** in the named test
database. Its service account was verified denied access to `(default)`.

Your existing shared `game-platform-scaling` demo on port 8000 remained active.
Chad's private temporary harness/API processes were stopped after testing.
Your demo still uses its existing configuration/schema until you integrate and
explicitly select query mode. Production `buildplay.fun` and `(default)` were
not changed. Do not stop the shared VM merely to stop a private test process.

## Portal/Builder integration contract

`GET /storage/capabilities` advertises pagination. v2 lists return
`{items,next_cursor}`, default 50 and maximum 100. Follow the cursor even after
a short/empty page; publication checks and tombstones can remove returned items.
Cursors bind to namespace, filters and caller; concurrent writes may shift pages.

- Catalog: `/v2/games`, optional one word-prefix `q` (2–24 characters). Source is
  omitted; fetch one game's detail/source when needed.
- Builder: `/v2/builder/games`, `/v2/game-drafts`.
- Matches: `/v2/matches`, `/v2/matches/open`; history uses
  `/v2/matches/{id}/history?start=...&limit=...`, with `next_start` and `total`.
- Saved library: `GET /v2/users/me/saved-games`; `PUT`/`DELETE`
  `/v2/users/me/saved-games/{game_id}` return 204. Normalize legacy arrays first
  with the offline `libraries` command. The old response-returning save API
  retains a 100-record guard; clients should use the new commands plus page read.
- Referrals/invites: `/v2/users/me/referred-users`, `/v2/users/me/invites`.
- Protected admin referral report: `/v2/admin/referrals/summary` and
  `/v2/admin/referrals/users`, with `parent_id`, `q`, `cursor`, `limit`.
- Admin record lists: `/v2/admin/{kind}`.

Reuse the existing capability-negotiating portal/builder changes from PR #32;
preserve main's experiment scripts and campaign headers when merging. Check
saved-library client flows against the new API rather than retaining arrays.
Set Firestore mode `query`, database `game-platform-scaling`, namespace
`scaling_v1`; do not point the test configuration at `(default)`.

## Validation and remaining release gates

Backend with emulator: **548 passed**. Final query/index tests: **39 passed**.
Web unit suite: **152 passed**. Full desktop/mobile browser suite with two
workers: **76 passed, 1 skipped**. A preceding default-concurrency run timed out
once on pagination; ten repetitions and the full bounded rerun then passed.

Implemented account jobs require a maintenance window; live sign-in merge and
job-starting UI flows remain a client/integration task. Invite acceptance and
linked identity arrays still have bounded legacy representations. Per-game
analytics, full production migration/recovery/rollback rehearsal and sustained
multi-instance load remain release gates. Query storage uses private Firestore
transaction methods; upgrades require emulator and cloud verification.

The **10M users / 1B matches / 100K games** figures remain an unproved target.
The user has been asked for a cloud spending cap before larger paid generation.
Do not represent this small functional workload as target-scale proof or merge
production configuration changes on that assumption.

## Course direction and ownership

The class sheet assigns Chad/sc5386 "Scale data and fix the rest" and
Ian/zkamenov "Scale data and fix portal and builder". Marcelle owns the live
portal activity generator; use that tool for autoscaling/monitoring demos.

Yoav's October 29 direction was to duplicate existing games, avoid AI-agent
calls for fake games, and focus scaling activity on portal users. The same API
key is acceptable; no new key is needed for the demonstration. None of Chad's
activity runs called a model API.
