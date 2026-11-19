# Security, privacy and token audit — November 18, 2026

Initial reviewed baseline: `874f1e55797fad5a26b504d35dda643cf88b64a0` on
`yoav-zibin/course` main. This audit covers the repository's portal, native
clients, HTTP APIs, match execution and persistence. Production data and game
packages stored only in Firestore were not downloaded or penetration tested.

## Findings addressed

- **Global game writes bypassed game capabilities.** PATCH, DELETE and
  unpublish accepted the owner's ordinary user password. PATCH now requires
  the game's secret or configured master password in the JSON body field
  `game_addition_request_id_and_secret`. DELETE and unpublish require
  `X-Game-Secret` or the configured HTTP Basic master password. Account
  ownership by itself does not authorize global game changes. Creation and
  partial updates enforce the game capability and the validation required
  for the supplied content changes.
- **An unset master password opened protected operations.** Admin data,
  account-management tools and protected proposals now fail closed with 503
  if no master is configured. Local tests explicitly configure a test master;
  they do not depend on anonymous administrator access.
- **Cached browser master credentials could authorize cross-site writes.**
  Mutations authenticated by HTTP Basic master credentials now reject cross-site
  Fetch Metadata and
  mismatched/null Origin or Referer metadata, while retaining same-origin
  browser and explicit command-line access. This covers bodyless unpublish
  and admin POST requests as well as other protected mutations. Basic auth's
  ambient credential behavior is documented by [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Authentication);
  origin and Fetch Metadata checks follow the [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- **Shared JavaScript heaps could disclose another match's state.** Server
  calls now receive fresh QuickJS contexts, preventing globals or closures
  from carrying private state between invocations. Schema validators remain
  cached. Offline publication probes deliberately retain a context so they
  can still detect forbidden stateful game code.
- **A view exception could disclose hidden data.** `InvalidMove` thrown from
  `viewFor` now follows the same safe error path as runtime/schema failures,
  rather than returning the game's diagnostic as player feedback.
- **Some legacy lifecycle calls retained weak randomness.** Mid-game joins,
  direct leaving and leave previews now upgrade legacy match secrets before
  invoking game logic, preserving the upgraded secret with the result.
- **Private API responses lacked HTTP cache controls.** Credentials, private
  profile/match/admin data, batches and authenticated requests now receive
  `Cache-Control: private, no-store`, including error responses.
- **Oversized logs could expose a password prefix.** A truncated body is now
  represented by size metadata, without copying unparseable raw prefixes.
  Parsed bodies continue to use structured secret redaction.
- **Browser error reports could transmit account passwords.** The client
  redacts exact credentials from current and remembered accounts and password
  fields before truncating or sending telemetry; labeled credentials and
  bearer strings are also redacted. Shared asset versions were advanced.
- **Android game content could contact external hosts.** The native game
  host now inherits a network-denying CSP and its WebView interceptor denies
  requests outside the exact bundled host asset. The browser regression
  exercises attempted exfiltration and frame/bridge isolation.
- **External declarative images were a privacy channel.** Image selection
  can encode private state even when image URLs are static package assets.
  Declarative images are therefore restricted to inline assets at import and
  rendering boundaries. Bundled packages use inline assets already.
- **File snapshots and backups inherited permissive file modes.** They now
  use owner-only temporary files and atomic replacement. New backup
  directories are owner-only. Snapshot writes no longer follow predictable
  temporary-file symlinks. Existing copies/backups outside these write paths
  still require normal operator access controls.
- **Players could cancel held paid stakes after play began.** Public match
  deletion now rejects ongoing matches with a remaining token pot. Players
  use normal leave settlement instead. Waiting-room refunds and privileged
  administrator recovery remain available.
- **The file writer could persist a partial payout.** File-backed stores now
  share one operation lock with the service and use consistent flush lock
  ordering. A snapshot cannot capture a credited wallet before the matching
  pot update, including when a process stops and later restarts. This is
  single-process consistency; production Firestore continues to use its
  existing transactional coordination.
- **An import could overwrite another game's translations.** Package
  translations now stay scoped to their game; an unrelated new-game secret
  cannot change the global reviewed translation map. Rendering resolves the
  relevant package before shared translation fallback.
- **Submission verification bypassed the heavy-validation limit.** The
  submission endpoint now shares the bounded validation slots with imports
  and other expensive game checks.
- **Revoked private invites still exposed match details.** Private match
  invite views now return 404 when the bearer link is revoked, expired or
  fully consumed. Public match invitation diagnostics remain available.
- **Private bug evidence could be copied into HTTP logs.** The new protected
  game-bug API contains exact arguments, hidden state and random seeds. Its
  request and response bodies are now excluded from HTTP log capture,
  including review notes and error paths; status, timing and byte counts
  remain available. The entire route family also receives no-store headers.

## Authorization and privacy coverage

Reviewed legacy and paginated API routes, batch subrequests, debug/admin
routers, user profile updates, saved libraries, feedback, invites, push
subscriptions, private match visibility, turns, move authorship and account
linking/merging. Public user responses omit other users' wallets and linked
identities. Mutations authenticate their caller and enforce the relevant
ownership or capability. Firestore rules deny direct client reads/writes;
server-side account/match operations use transactions.

Match states and history are projected through `viewFor` for the requesting
player or spectator. Other players' private move payloads are redacted.
Master-protected debugging data is privileged and must never be treated as
player-visible API data. Seed fields are absent from ordinary responses.

New online matches use 256-bit secrets and ChaCha20 streams. Hash derivation
separates lifecycle, moves and views, including viewer identity and move
number. Tests include independent standard vectors and cross-block checks.
Rekeying protects future legacy calls; it cannot revoke previously disclosed
draws or make an already dealt legacy deck secret again.

Reviewed all eleven bundled declarative server packages. Ten use the shared
engine with a different game kind; memory masks unrevealed cards. Backgammon
and its combined-move, roll-history and undo extensions expose current/public
state and obtain future dice from authoritative server randomness. Published
community versions outside Git remain a separate operational inventory.

Browser review includes sandbox origins, worker messaging and execution
limits, renderer DOM writes, account-scoped offline state, service-worker
caching, authentication headers and telemetry. Native review includes game
host network isolation, bridge origin checks and credential storage. Android
uses Keystore and iOS uses Keychain. Host/device account compromise is outside
the guarantees of application-level ownership checks.

## Token economy

The intended sources of tokens are a **one-time 1,000-token verified-login
bonus** and settlement of tokens already staked in matches. A guest starts
at zero. Guest login, match entry and match completion grant no extra tokens.
Public request schemas do not allow setting wallet balances or bonus markers.

The bonus is issued only after successful Google/provider verification or a
successful email/phone code. Its marker and balance commit together. Repeated
login, spending, another linked method, restart, transaction retry and account
merge do not reset eligibility. Account merges require control of both
identities, sum balances once and zero the merged-away balance. The marker
survives both online and offline account maintenance.

Payouts must be nonnegative integers for active human seats. Ongoing payouts
cannot exceed the remaining pot; terminal payouts must distribute that pot
exactly. Computer seats cannot receive virtual wallet payouts. Stakes are
debited before a seat receives pot/refund rights. Refunds and leave settlement
distribute only remaining held tokens. Match status, expected move counts,
transactional ledgers and request idempotency prevent repeated credits.
Regressions cover partial payouts, deletion attempts, retries, concurrent
instances, transaction failure and restart against the local Firestore emulator.

Pot conservation does not prove arbitrary game rules are fair. Published
rules and `viewFor` remain trusted code: the platform cannot infer the fair
winner of an arbitrary author-supplied game. User-authored moves cannot name
their own payout outside those pinned server rules. Multiple genuinely
verified accounts can each receive their first-login bonus; this system does
not prove one human owns only one account. Tokens are virtual game currency.

## Validation and practical limits

Before publishing this change, integrate latest upstream and choose checks
that exercise the changes. Local validation covers focused authentication,
match privacy, token settlement and Firestore regressions, JavaScript tests,
desktop/mobile security and admin workflows, and Python 3.12 production import.
Broader local runs were diagnostic; interrupted runs are not counted as passes.
CI provides broad validation, and its failures must be addressed. Full local
suites and native Android/iOS tests are not pre-push requirements under the
user's current policy. Exact results and the final
audited revision are recorded in the local security audit history; the
delivery message reports their outcome. iOS SwiftUI/Security/Xcode tests need
a Mac and cannot run on this Linux host. Existing iOS CSP already denies
external image/network loads and was reviewed directly; no iOS files changed.
This audit does not claim a local iOS build passed.

The native clients still use the older HTML game/move adapter. Before this
audit, generated declarative compatibility hosts already lacked a working
native asset/move path; the sandbox changes do not implement native
declarative gameplay. Browser security regressions exercise the bundled
Android host, not an end-to-end native declarative match.

Dependency resolution plus pip-audit reported no known vulnerabilities for
the runtime versions resolved during this review. Broad dependency ranges
are not a guarantee for every older permitted installation. Bandit findings
were triaged: no high-severity findings; XML sites reject declarations and
use inert SVG restrictions, URL-opening findings are operator CLI tools,
and lower findings include assertions and fixed-input subprocess helpers.

Fresh runtime isolation has a measurable cost: a local 100-view Backgammon
sample took about 1.74 seconds versus 0.11 seconds with a shared context,
roughly 16 ms extra per uncached call. Repeated identical views retain the
platform's existing result cache. This review prioritizes state isolation;
it does not establish production load capacity or a formal security proof.

## Platform-owned games follow-up

Games no longer store or return a creator/owner user ID. Both creation APIs and
creation schemas require no player account, and unrelated stale account headers
do not block game capabilities. Secret/master authorization, publication gates,
version checks and master-origin protection remain in place.

User merges and deletion preserve every platform game version, including in
resumable maintenance jobs. Unpublished games have no creator-only visibility;
existing match participants retain access to their pinned game version. Creator
statistics, owner catalog filters and game-owner feedback restrictions are removed.
Legacy game owner fields are ignored when records are loaded and omitted on
rewrite. This release does not bulk rewrite historical production documents or
backups. No production data or configuration was modified during verification.

The subsequently authorized [explicit attribution cleanup](platform-game-attribution-cleanup.md)
removes those obsolete fields from live game/version records and retained Builder
artifacts with private preimages and a fresh verification scan. Historical
recovery namespaces and backups remain separate recovery artifacts.

Checks covered account-free creation and stale-header capability mutations,
legacy snapshot/query records, account merge/deletion preservation, HTML migration,
Firestore emulator operations, generated examples and browser behavior. Final
post-integration backend checks passed (56 tests), as did 158 Portal/feedback/PWA
unit checks. The separate real Firestore query suite passed 73 tests plus the
new account-deletion regression; two real Chromium checks also passed.

The broad CI run for `32bf614` found stale test assumptions about unpublished
game creator access and a translation allowance left above its reduced count.
The follow-up keeps all users without matching game-version participation denied,
checks private cover revalidation, and reduces the statistics allowance. Upstream
`a64403c` supplies the renderer-version assertion fixes. These corrections change
tests and audit limits; they do not grant any player additional access. All 127
focused checks passed after integrating upstream. Broad CI must run again.

## Daily incremental audit

The user service `buildplay-security-audit.timer` runs every day at **08:00
UTC**, with persistent catch-up when this machine is available. It queues
work in the originating Codex thread through the existing local daemon;
it is separate from the hourly general code reviewer.

The versioned runner is `ops/security-audit/watch.py`. Owner-only operational
state lives at `/home/yoav_zibin/.local/share/buildplay-security-audit/`:

- `state.json`: repository, branch, thread and last successfully audited SHA.
- `instructions.txt`: review scope, token rules, focused-check/direct-push policy.
- `pending.json`: queue receipt, never evidence of completed review.
- `history/`: dated audit coverage, reviewed commits, findings and checks.

The initial full audit establishes the baseline. Later runs enumerate every
new reachable commit, including merge integration effects, and inspect
affected code beyond the diff where needed. A missing/non-ancestor checkpoint
requires a fresh full review. The checkpoint advances only after successful
review, necessary fixes and verification; failed or queued work cannot mark
commits audited. The machine and Codex daemon must be available to execute
scheduled work.
