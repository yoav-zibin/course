# Repository audit — November 12, 2026

Baseline: `320594e`. Review and tests used the development checkout, local
in-process API clients, disposable browser servers, and a separate Firestore
emulator. No real accounts, matches, tokens, or push services were exercised.
Production is updated only through the normal green-main deployment.

## Findings and fixes

1. **Private moves escaped the view boundary.** `/matches/{id}/moves`,
   `/matches/{id}/history`, and `/v2/matches/{id}/history` projected resulting
   states through `viewFor` but returned the original move payload. A move may
   include face-down cards or a sealed bid. Only its authenticated human author
   now receives that payload; everyone else receives `null`, including after
   completion. Public actions belong in the game view. The author's own payload
   remains available for offline acknowledgement matching.
2. **Views shared gameplay randomness.** `viewFor` was reseeded with the same
   derived seed as the next gameplay call. A randomized view could reveal that
   call's random stream. Views now use a separate hash domain, viewer identity,
   and move number. Initialization and lifecycle functions also have distinct
   streams. Online matches now use version 3: 256-bit secrets and ChaCha20
   instead of truncating keys into a 32-bit Mulberry32 generator. Tests cover
   the RFC vector, nonzero keys, multiple blocks, and high key bits. Numeric
   seeds preserve fixture compatibility. Historical views reproduce their
   corresponding view stream.
3. **Runtime errors could echo private inputs.** Game runtime/schema failures
   could include hidden state in their exception text. Player responses now
   identify the failed function without the diagnostic text; details remain in
   server logs and protected admin records. Intentional `InvalidMove` messages
   remain game-authored player feedback.
4. **Lifecycle payouts were dropped.** `newMatch` and mid-match `playerJoined`
   could return valid distributions that the service ignored. The shared payout
   validator/credit path now applies them, records the remaining pot, and ends
   terminal join results. Terminal lifecycle calls must distribute the whole
   pot. Regression tests verify that retries cannot award the payout twice,
   including against the Firestore backend.
5. **General game schemas could retrieve external resources.** The import
   contract checked local references, but the general runtime compiler did not.
   Runtime schemas now reject non-fragment references, including nested/dynamic
   references, and use a registry without implicit network/file retrieval.
6. **Push delivery accepted arbitrary destinations.** Real delivery could POST
   to a user-selected local/private HTTPS URL (or local HTTP in development).
   Real subscriptions and previously stored deliveries now require known browser
   push-service hosts over HTTPS/443. HTTP redirects are disabled and network
   calls have a 30-second timeout. Fake/log-only development delivery remains
   available. New push providers require an explicit allowlist review.
7. **Heavy test endpoints bypassed concurrency limits.** The test-page server
   checks and full-match verification now share the two-slot import budget,
   returning 429 with Retry-After when exhausted and releasing slots on errors.
8. **Public admin startup was too easy.** The launcher now refuses a
   non-loopback bind with debug tools enabled and no master password. A loopback
   process behind a public proxy still needs a password; this is documented.
   Production already has one configured; no configuration or credential changed.
9. **Paginated history performed unbounded prefix reads.** Each page rebuilt
   earlier move prefixes to supply a historical move count. Views now use lazy
   prefixes, so requesting a late page does not fetch all preceding moves.
   The full-history endpoint also avoids quadratic tuple copying.
10. **Live summaries could disclose a hidden result.** Summary extraction now
    reads winner/draw/done only after a match is over.
11. **Stake UI contradicted the implementation.** The daily allowance is awarded
    on first paid entry each day; stakes are collected on creation/joining, not
    on starting. The help text and wallet tooltip now say this in all eight
    locales. Portal and service-worker cache versions were advanced.
12. **Portal navigation could discard user interactions.** `/portal` first
    rendered the interactive page, then reloaded into service-worker scope
    asynchronously. This could close an already-open catalog and abort actions.
    It now immediately redirects over HTTP to `/static/portal.html`, preserving
    the query. Removed the delayed JS navigation. Logged-in welcome redirect
    tests now wait for navigation commit and then assert the final account/URL.
13. **Documentation and dead imports had drifted.** Corrected workflow names,
    triggers, JS test command, production-runtime/emulator gates, loopback admin
    guidance, history privacy, lifecycle payouts, view randomness, and iframe
    network claims. Removed duplicate/unused imports and duplicate dependencies;
    declared direct HTTP/reference-registry dependencies. Kept compatibility
    adapters, archived game originals, and import probes that have known uses.

## Review coverage and validation

- Enumerated API routes and reviewed authentication/ownership, optional callers,
  private-match visibility, replay/history, state projection, import secrets,
  seed handling, turn enforcement, payout validation, stake/refund flows, account
  merges, admin surfaces, push transport, schema loading, iframe messaging,
  publication/test gates, configuration, and deployment workflows.
- Examined `viewFor` definitions across all 52 bundled server-game source files,
  including archived originals. Open-information games returning their full
  public state are not privacy violations. Existing card-game view regressions
  remain part of the full suite. Published community code lives in Firestore;
  repository fixtures are not a complete inventory of production game versions.
- Ran Ruff name/import checks, Vulture high-confidence unused-code detection,
  Bandit static analysis, dependency resolution/audit, and targeted API tests.
  No known vulnerabilities were reported for the runtime packages resolved by
  pip-audit at review time. This does not certify every version permitted by
  broad lower bounds. MD5 uses are compatibility checksums, not authentication;
  import identity uses SHA-256. SVG parsing already rejects declarations,
  executable elements, event handlers, and external-resource attributes.
- New regressions cover move privacy (all three history routes), isolated view
  random streams, generic errors, exactly-once lifecycle payout application,
  known push destinations/no redirects, external schema references, bounded
  validation concurrency, secure launcher binding, lazy prefixes, and live
  summary redaction. Existing authorization, pot conservation, idempotency,
  random-walk, offline/UI, and emulator regressions remain enabled.
- Before pushing: run full pytest, JS regressions, Firestore emulator suite,
  desktop/mobile Playwright, standalone layout browser checks, and Python 3.12
  import sequentially. GitHub additionally validates Python 3.14. Record exact
  results in the commit's CI and the delivery summary.

## Limits and remaining trust assumptions

This is a code/security review with regression testing, not a proof that every
path or published game is bug-free. No production penetration/load testing,
paid simulations, native iOS builds, or infrastructure/credential rotation was
performed. External frontend submodules retain their independent build systems.

A game author's `viewFor`, legality checks, payout policy, and player-facing
`InvalidMove` text remain trusted game rules. The platform enforces identity,
turns, payout recipients, non-negative integer amounts, total pot limits, and
pinned versions; it cannot infer whether arbitrary game rules represent a fair
win. Publication testing is not formal verification. Published game versions
and author accounts still require operational review.

Guest accounts and the per-account daily token allowance are intentional.
There is no strong one-person-one-account/Sybil guarantee, and these virtual
tokens must not be treated as monetary balances. Per-request execution budgets
and import concurrency do not replace edge rate limits or a dedicated sandbox
worker for fully adversarial game authors. Repository tests do not establish
the historical 10M-user/1B-match capacity target.

Push host references: [Mozilla service endpoints](https://mozilla-services.github.io/autopush-rs/http.html),
[Chrome/FCM Web Push](https://developer.chrome.google.cn/blog/push-notifications-on-the-open-web?hl=en).

### Legacy randomness migration

New online matches use seed version 3. Starting or making a move in an older match upgrades
its secret and future draws. An already dealt legacy deck cannot be made
retrospectively unpredictable without changing that deal; this release does
not silently reshuffle or cancel live matches. Previously disclosed values
cannot be revoked. Historical numeric test seeds remain deliberately public.

ChaCha20 reference: [RFC 8439](https://www.rfc-editor.org/rfc/rfc8439.html),
with an independent cross-check against Python cryptography across blocks.

## Final local validation

All checks ran sequentially against the final implementation:

- Python 3.12 full suite: **1,572 passed, 54 skipped** (emulator cases skipped here).
- JavaScript regression suite: **358 passed**.
- Dedicated Firestore emulator suite: **58 passed**.
- Playwright desktop/mobile: **98 passed, 1 skipped**.
- Standalone layout browser acceptance: all seven screen sizes and the lobby,
  moves, offline recovery, rotation, rematch and return-navigation checks passed.
- Production-runtime import and changed-file Ruff name/import checks passed.
- Canonical portal/welcome/pagination scenarios additionally passed 30 repeated
  desktop/mobile checks after the navigation correction.

GitHub Actions is the final Python 3.14 and deployment gate.
