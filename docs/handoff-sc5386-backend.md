# Handoff: backend scaling and verified portal activity

From Chad (sc5386) to Ian (zkamenov) and his agent. Updated October 30, 2026.
This note is the handoff. A coordination comment is also on your code commit
`e45a25a`; Chad has not sent a separate email.

## Current integration point

[PR #32](https://github.com/yoav-zibin/course/pull/32) merged as **3a4bda3**;
[PR #38](https://github.com/yoav-zibin/course/pull/38) merged as **888c52e** and
**production query storage is now activated**, not merely available on a branch.
[PR #39](https://github.com/yoav-zibin/course/pull/39) subsequently merged as
**5a03a78**. It keeps A/B metric counts anchored
to their published snapshot while reading current experiment configuration;
create/delete/toggle/name/spend changes therefore appear immediately in admin.
Both PR and merged-main CI checks passed. The release preserves the recent
catalog/practice/replay UX and experiment deletion panel. Local full backend
validation with emulator: **564 passed**; prior web/browser validations remain
recorded below.

**Latest verified production release: 01b11c8**, including shared navigation
[PR #40](https://github.com/yoav-zibin/course/pull/40), the intervening monitoring
and translation work, and compatibility repair
[PR #43](https://github.com/yoav-zibin/course/pull/43). Portal, Builder and Admin
now share the same navigation initializer, active-page treatment, language
picker and account menu. Page-specific controls remain in place. Production
and the isolated demo passed desktop (1440px) and mobile (390px) live checks:
all three headers, no horizontal overflow and no JavaScript errors. Demo
received only the shared-header static assets; its backend, data, config and
allowance remain separate. Keep main's current asset versions when merging.

The intervening monitoring/translation merges had two missing type imports
that prevented Python 3.12 startup. PR #43 fixes them, adds a production Python
3.12 import check to CI, and implements translation-memory operations in
QueryStore, migration and rollback. No paid translator was called. All merged
main checks, including emulator, browser, runtime import and deployment, passed.
Final live checks at 01b11c8 confirmed health OK, pagination enabled, live A/B
configuration, and published counts of 131 users, 212 matches and 1,780 moves.

Your `e45a25a` integration and `c363675` work are preserved on this branch; this
documentation update does not merge them into main. Your compressed snapshot
adapter still concerns legacy storage, while production uses QueryStore. When
integrating your computer-play UI, reconcile its labels and handler with main's
server-game practice behavior; distinguish local practice from a server
computer-opponent match. Reuse main's query APIs and shared header instead of
recreating them.

Production `buildplay.fun` runs `game_platform.main` with **query mode in the
existing (default) database, namespace production_v1**. Its private external
config has `allow_default_database_query: true`; non-storage settings and all
credentials were preserved. Do not overwrite it with the example config or
switch it back to stale legacy collections. `/storage/capabilities` now returns
`pagination: true`; `/debug/all-data` returns 409 instead of loading/exporting
everything. The ordinary Portal/Builder/admin pages remain the application UI.

During a writer-maintenance window, the existing records were converted and
fully reconciled: **131 users, 167 game versions, 212 matches, 1,780 moves**, plus
drafts, conversations, saved libraries, identities, experiments and subscriptions.
All existing credentials and balances verified; **zero synthetic users were
added**. Public checks passed health, Portal/Builder, a 50-game page plus cursor,
omitted catalog source, and admin authentication, with no page errors. Protected
admin checks verified all user IDs across three pages and every match ID.

The full-data and rollback rehearsals ran in a loopback emulator on the same VM;
private credentials were not downloaded. Original collections and protected
snapshots remain for recovery at `/opt/game-platform/backups/production-query-cutover`.
If rollback is needed after new writes, export current query state into a fresh
legacy prefix; never select the stale pre-cutover source. See main's
`docs/scaling-production-cutover.md` and `scaling_cutover.py`.

The durable worker wakes after commits/deadlines with a 60-second recovery poll;
half-second idle Firestore polling is removed. Ordinary online account merges
and deletion now work through bounded user-filtered queries. Large operations
retain atomic refusal and offline-job fallback (100 legacy records, 250 merge
moves, 450 transaction writes); shared unfinished seats still block merging.

The default database received 13 composites and 65 field overrides for the new
namespace. Conversion used 52,383 of its 100,000 conservative operation units,
with 10.7 MB cumulative write payload; source preflight/migration reads stayed
under their 25,000-unit ceiling. These are local allowance counters, not an
invoice. No VM/database was created and no model or stress generator was called.
Temporary maintenance/conversion/emulator processes are stopped; production is
healthy. The fake-month site's data and its spending allowance were not used by
the production conversion.

The isolated port-8132 test service was also updated to **3a4bda3**, preserving
its config, dataset, persistent allowance, limits and expiry. Portal and the
merged statistics UI passed public browser checks. Its database remains
**game-platform-scaling**, namespace **scaling_v1**, with query mode enabled.
The production conversion was an explicit operation after merging. Isolation
comes from database/namespace/config, not merely separate VMs. Normal startup
never imports the isolated wrapper or runs synthetic seeding.

This commit changes only documentation on your branch. Pull/merge current main
to obtain the implementation; this note does not update your branch's code.

## Action list for Ian and mandate status

The user wants the ordinary website with synthetic data visible through the
existing admin pages. Do not make the fixture presentation the homepage or add
a separate mandatory demo flow. The root and `/demo` now open the usual Portal;
use `/admin`, `/stats`, `/invites` and `/browse` to inspect the fake month.

For your Portal/Builder scope:

1. Merge/rebase current main (including **01b11c8**) into your branch to reuse
   PR #32's capability-negotiating clients, preserving your newer
   UI work and main's experiments/campaign headers. Do not independently recreate
   the storage API. See the endpoint contract below.
2. Verify catalog/search, owned games, drafts, saved games, open/current matches
   and history use bounded pages, follow cursors, and retain snapshot-mode
   fallback. Check desktop/mobile and old cached-client behavior. Existing
   small-fixture checks passed; larger emulator datasets still need validation.
3. Your pre-existing service on the **scaling VM's** port 8000 was last observed
   in snapshot mode; the **primary VM's** production service is now query mode.
   Adopting query mode there is a separate integration step. The working query
   demonstration is the protected port-8132 service; do not mistake the two.
   Coordinate any test-service switch with Chad. Do not reset production's query
   config or point it at the synthetic scaling database.
4. Exercise normal Portal/Builder against the shared fake-month namespace and
   record any client-specific failures. Use the existing VM and database. Do not
   launch cloud load generation or raise/reset the operation allowance.

**Completion assessment:** the user-requested smaller live fake-month demo is
delivered: existing second VM and named Firestore database, query backend,
synthetic month, published dashboards/backoffice and normal entry pages.
The original **10M users / 1B matches / 100K games** scaling mandate is **not
fully demonstrated**. The user explicitly accepted a smaller dataset for this
live demonstration; that does not establish target capacity.

Remaining backend/release work belongs with Chad/shared integration, not all
with Ian: UI for large account maintenance jobs (ordinary online flows work),
remaining bounded legacy representations, per-game analytics/reconciliation,
and stronger target-scale recovery/rollback validation. The small production
conversion, full reconciliation and rollback rehearsal are completed. Larger
emulator and sustained multi-process tests still need acceptance criteria and
evidence. Small two-process/restart correctness rehearsals already passed.
PR #32, #38, #39, #40 and #43 are merged/deployed, and production query mode is active.
Instructor acceptance and target-scale proof remain separate milestones.
Do not label the entire mandate complete.

The extra cloud/test authorization remains **less than $1**, excluding normal
VM operation. Prefer local emulator tests for further volume checks; any new
paid scale run needs explicit authorization. Preserve the current ledger and
its November 2 00:32 UTC expiry; do not extend it automatically.

## Separate live demo deployed after this handoff

Chad deployed a **separate protected hostname** on the existing scaling VM:
https://buildplay-demo.34.26.223.67.sslip.io/ . Both `/` and the old `/demo` path
open the usual Portal. Builder and the existing admin pages stay normal. The
optional fixture presentation is now only at `/admin/demo-fixtures`. It runs
`sc5386-live-demo.service` on loopback **8132**, from the private csccs checkout.
The pre-existing `game-platform-scaling` service on 8000 and IP virtual host are
unchanged and active. The primary VM received the merged code through normal CI;
its routing and non-storage configuration were preserved, and its storage mode
was upgraded as described above. Synthetic
data remains confined to the separate test deployment.

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

## Optional fixture page and address history

The earlier **c317412** change added a simpler demo
sign-in and a nicer landing page. The free BuildPlay Demo hostname above is live;
the old sc5386 hostname redirects there, and the TLS certificate covers both.
No domain was purchased, no VM was created, and production/Ian's service were
not changed. Credentials remain outside Git.

The source is `demo-site/index.html`, now optional at `/admin/demo-fixtures`:
responsive BuildPlay branding, actual
September match bars, dataset totals and direct links to existing features.
`/demo/overview` reads an existing saved snapshot from disk, so the landing page
does not repeatedly scan Firestore. Portal/Builder implementations were not
redesigned in this change. The database operation allowance, expiry and ledger
were preserved. Desktop/mobile public checks passed chart rendering, navigation,
sign-in and the controls-menu layout with no page JavaScript errors. The five
budget/emulator tests also passed. CI for c317412 is green: backend, unit, emulator and UI checks passed; production deployment correctly skipped.

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

Production query activation, full reconciliation and the small-deployment
rollback rehearsal are complete. The following are remaining scaling limits.
The recent experiment-variant delete action retains a 100-record legacy limit
in query mode; an oversized delete returns 409 and rolls back all writes.

Large account jobs require a maintenance window; job-starting UI remains a
client/integration task. Ordinary bounded sign-in merges/deletions work online.
Invite acceptance and
linked identity arrays still have bounded legacy representations. Per-game
analytics, target-scale recovery/rollback validation and sustained multi-instance
load remain follow-ups. Query storage uses private Firestore
transaction methods; upgrades require emulator and cloud verification.

The **10M users / 1B matches / 100K games** figures remain an unproved target.
The user authorized only a small live demo under $1 in additional database/test
usage, not a paid target-scale generation run.
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
