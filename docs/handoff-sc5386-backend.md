# Handoff: backend scaling is ready for the portal/builder work

From: Chad (sc5386) — for Ian (zkamenov) and his agent. Left on
`origin/feature/scaling` on 2026-10-29 so it can be picked up right away.
Chad has not messaged Ian separately; this note is the notification.

## Yoav's directives (email Oct 29, 7:05am ET, to Ian, Marcelle and Chad)

Answering Ian's API-key question, Yoav wrote:

> "Same API key is fine. You won't make API calls to the agent, you'll just
> duplicate the existing games. We don't want to get charge a lot of tokens.
> Similarly for scaling activity: we only care about the portal activity."

Concretely, for both sides:

1. **Reuse the production Meta API key** on the scaling VM's builder. Do
   NOT create a new API key for the scaling instance.
2. **No agent calls to create fake games.** Fake games must be duplicates
   of the existing games, not fresh AI-agent generations — the point is to
   avoid token charges. (Chad's backend seeders comply on cost: they are
   purely programmatic fixtures and make zero agent/API calls. For the
   demo dataset itself, duplicate the real catalog — `scaling_tools
   migrate` already copies the existing games into the scaling namespace.)
3. **Scaling activity = portal activity only.** Simulated users playing
   games through the portal (matches, moves, joins/leaves) — not builder
   or agent activity.

## Division of labour (per the class sheet, "2026 main")

- Chad / sc5386: "Scale data and fix the rest" — the backend.
- Ian / zkamenov: "Scale data and fix portal and builder" — the portal and
  builder UIs on the same fake dataset.

## What is done on the backend (PR #32, branch `sc5386/backend-scaling`)

PR: https://github.com/yoav-zibin/course/pull/32 — draft, based on main at
10902cb. It is opt-in and isolated: snapshot mode is still the default and
production (`buildplay.fun`, the `(default)` database) is untouched.

- `QueryStore`: on-demand Firestore reads in a named database
  (`game-platform-scaling`, namespace `scaling_v1`). Startup reads one schema
  marker; it never loads the dataset into memory.
- Paginated v2 list APIs return `{items, next_cursor}` (default page 50, max
  100): `/v2/games` (published catalog, word-prefix `q` of 2–24 chars),
  `/v2/builder/games`, `/v2/game-drafts`, `/v2/matches`,
  `/v2/matches/open`, `/v2/matches/{id}/history` (`start`/`limit`,
  `next_start`, `total`), `/v2/users/me/referred-users`,
  `/v2/users/me/invites`, `/v2/admin/{kind}`. `GET /storage/capabilities`
  advertises the mode. Legacy list endpoints fail explicitly above 100
  records in query mode; game source is omitted from catalog responses and
  fetched per game when needed.
- Transactional, idempotent moves (`Idempotency-Key`), durable
  revision-fenced jobs for computer turns/deadlines, push via a transactional
  outbox, stats from 64 counter shards.
- Resumable offline jobs (`scaling_tools`): `dashboard` (totals + daily
  charts for the last 30 days, with build timestamps), `activity` (a fake
  September 2026 month played through the real service and QuickJS rules),
  `seed`, `export`, `validate`, `cleanup` — and, added in the latest push,
  `merge` and `delete-user` (resumable account merge/deletion for the query
  store; see `docs/scaling-storage.md`). The merge/delete jobs landed on
  Oct 29 in commits `2a0de81` (code) and `fc62b7b` (tests + docs) — the
  last previously unfinished backend item. Their emulator tests run in the
  PR's `Firestore query storage` CI workflow.
- Validation so far (see `docs/scaling-validation.md` on PR #32): emulator
  suite, two independent HTTP processes against the named test database, and
  a 1,000-match cloud milestone: 1,104 matches / 2,211 moves / 114 users /
  69 games; 20 page reads of 50 items: median 40.7 ms, p95 51.79 ms; store
  construction ~10 ms. This is a rehearsal, not a billion-match load test.

## What Ian's agent should do next (portal + builder)

1. Point the portal and builder at the paginated APIs above: follow
   `next_cursor` even after a short/empty page (tombstones and unpublished
   games are filtered after the query). Cursors are opaque and bound to the
   query + caller; they are not snapshots, so pages can shift under
   concurrent writes. PR #32 already adapts `static/portal.js`,
   `static/browse.js`, `static/builder.js` and `static/stats.js` to
   negotiate pagination — start from those changes, check them against your
   branch, and finish whatever is missing rather than starting over.
2. Fetch game source/detail on demand (per game), never from the catalog
   list. Catalog prefix search and client-side filtering apply to the
   current page only — there is no global substring search.
3. History views must page (`start`/`limit` ≤ 100 moves), not load a whole
   match history.
4. Benchmark: your `scale_benchmark.py` can now run against query mode with
   the read-only paginated mix in `benchmark.query-requests.example.json`
   on PR #32. First confirm `/storage/capabilities` reports pagination
   enabled. Your branch's current example routes are the legacy unbounded
   ones your plan flags as needing pagination. Keep dataset, mix and stages
   identical when comparing one VM vs two, and record write budgets.
5. Deployment: your `config.scaling.example.json` /
   `deploy/game-platform-scaling.service` should set Firestore mode
   `query`, the named database `game-platform-scaling` and namespace
   `scaling_v1`, with the service account restricted to that database
   (it must get PermissionDenied on `(default)` — that isolation was
   verified in the cloud rehearsal).

## Known limits (documented on PR #32, not surprises)

- No production cutover, migration reconciliation, or sustained load test
  yet; the headline 10M users / 1B matches / 100K games is a design target,
  not a measured result.
- Account merge/deletion are offline resumable jobs, not in-request
  operations; UI flows for them do not exist yet.
- Stats are near-real-time counter shards, not a consistent snapshot; the
  dashboard report is an offline snapshot with a build timestamp.
- The query store uses the Firestore SDK's private transaction
  begin/commit methods; emulator + cloud tests must pass before any SDK
  upgrade.

## Coordination

- Do not merge PR #32 into production config or point anything at the
  `(default)` database. Demo target is tomorrow, Oct 30.
- If a portal/builder need conflicts with an API shape above, note it on
  PR #32 rather than forking the contract silently.
