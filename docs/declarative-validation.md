# Declarative games validation

## Persistent action hints

The November 13 action-hint update was verified separately in
[declarative-hints-validation.json](../reports/declarative-hints-validation.json).
All ten updated packages passed the normal submission validator and completed
two-player portal matches again. Tests check the first turn's actual actionable
piece/control counts and absence of hints on the other player's screen.

The focused run passed 162 backend/example tests, all 381 JavaScript tests,
53 localization/audit tests, 15 portal/play regressions and two dedicated
desktop/touch hint tests. The latter check always-visible action outlines and
badges, only the selected piece's legal destinations, rotation/resize requests,
and immediate cleanup on cancellation, state changes, replay or a pending move.
They also cover off-canvas drops, native drag, multiple pointers and keyboard
selection. Existing recorded submissions retain their exact trusted legacy host.

Captured screens show [legal drop hints](images/declarative-drop-hints.png) and
[Memory's actionable cards](images/declarative-memory-hints.png). The ten games
declare only actions their rules support; fixed Domineering orientations do not
advertise rotation. Rotation and resize controls are exercised by the shared
cross-renderer fixture instead.

## Initial release

Validated the declarative UI implementation locally on November 13, 2026.
Ten complete game packages were accepted through `POST /games/declarative`,
then played to completion through the actual portal's rendered controls in
two separate player browser sessions. This exercises the JSON presentation
reducer, renderer, portal move bridge and authoritative server together.

## Submission and playthrough evidence

[`reports/declarative-submissions-local.json`](../reports/declarative-submissions-local.json)
records successful HTTP 201 submissions for Tic-tac-toe, Connect Four, Reversi,
Nim, Mancala, Gomoku, Hex, Domineering, Memory and Pig. Their complete request
packages are in [`games/declarative`](../games/declarative).

After the explicit card-back artwork and text-contrast fixes, all ten final
packages were submitted again successfully. The
[final package validation report](../reports/declarative-final-packages-validation.json)
records their content hashes, excluding only each private submission secret.

The browser test source is
[`e2e/declarative.spec.ts`](../e2e/declarative.spec.ts). For each game it creates
two users, creates/joins/starts a match through HTTP, opens that match in two
browser contexts, and clicks the visible legal target or control for the
current player. It waits for each real `POST /matches/{id}/moves` response,
requires successful submission, and checks that the match reaches `over`.
It does not replace moves with mocked responses or call the reducer in place
of clicking the portal UI.

The ten-game Chromium run passed in approximately 2.8 minutes. Games alternate
between 1280×900 and 390×844 browser viewports. The tests require a visible
declarative scene, no visible game HTML iframe, no presentation error, and no
uncaught page error. Each test attaches start/finished screenshots and a JSON
record identifying the game version, match, move count and viewport.

[`reports/declarative-portal-validation.json`](../reports/declarative-portal-validation.json)
retains the run command, environment, assertions and per-game result, using
the same disposable game IDs/versions as the submission record.

The browser host has an invisible sandbox/worker for executing untrusted
presentation code. The visible board, pieces and controls are platform-owned
scene elements; the test's “no visible iframe” check does not claim the browser
implementation has no internal sandbox.

Additional browser checks passed for the existing authoring test page, filtered
Memory views, practice reload, replay, offline moves, and face-down artwork and
accessibility labels. A visual review also confirmed readable game titles and
player-colored marks against the portal's dark game surface.

Representative captured browser screens:
[offline practice](images/declarative-practice.png) and
[explicit card-back artwork](images/declarative-covered-card.png).

## Contract and regression checks

The final frozen-source backend run passed **1,689 tests**, with 56
environment-dependent tests skipped, in 7 minutes 25 seconds. It ran from the
package parent as `python -m pytest game_platform/tests -q`. The complete web
unit run passed **380 tests** with `node --test tests/web/*.test.cjs`.
All ten portal matches, five focused declarative browser checks, and seven
existing HTML play/practice browser checks passed across the recorded runs.

The focused Python tests cover the schema and ID/topology references, image
data validation, bounded QuickJS execution, JSON interaction state, rejected
out-of-turn/autonomous moves, import serialization, immutable version pinning,
player/spectator presentation and all ten complete rule-engine/reducer
playthroughs. Malformed moves are rejected by their server logic. Tests also
check that partial code/rules/schema updates cannot leave a declarative package
paired with a different game; metadata edits and unchanged values remain valid.

The web tests cover the platform renderer's coordinates, scene validation,
asset URLs and generated compatibility host, alongside the existing portal,
offline/practice and service-worker regressions. Browser probes check that
presentation has no `document`, `localStorage`, `fetch` or `XMLHttpRequest`,
that an infinite loop is terminated, and that text resembling HTML renders
as inert text. Face-down image handling uses only the declared `back_asset`
or a generic back and excludes front-derived accessibility text.

A separate local-practice browser check played through the portal, reloaded
the page, entered and left replay, disconnected the browser and successfully
made another move. The pinned local game package and match survived those
transitions. The covered-card browser check exercised a declared back asset
and confirmed front artwork/text was absent from the rendered card and its
accessible name.

Localization verification passed all 53 tests in `tests/test_i18n.py` and
`tests/test_i18n_audit.py`. The new renderer/authoring labels, accessible names,
diagnostics and complete-package update error have 98 shared catalog entries
in all eight supported languages, with identical placeholder sets. The
untranslated-text audit passes without increasing existing ratchets or
excluding the new files. The standalone compatibility host retains English
framework fallbacks when the platform language library is unavailable; game
text continues to use the translated table in `state_changed`.

The authoring guide's standalone Count to three UI example was separately
executed through the actual Python `DeclarativeLogic`: its state message
renders the counter, and its button event emits `{add:1}`. The spreadsheet
inventory was regenerated and checked for 1,311 catalog entries plus 44
top-five mentions, with no student-assignment columns.

## Reproduction

With the checkout importable as `game_platform`, run the focused checks from
the repository:

```sh
python -m pytest tests/test_declarative_ui.py tests/test_declarative_examples.py tests/test_declarative_updates.py
node --test tests/web/*.test.cjs
python -m game_platform.tools.declarative_demo --port 8134 --report reports/declarative-submissions-local.json
```

The demo starts after it validates and submits all ten games. In another shell:

```sh
E2E_PORT=8134 npx playwright test e2e/declarative.spec.ts --project=chromium --workers=1
```

Open the Playwright HTML report to inspect its screenshot and JSON attachments.
The test can also use the repository's ordinary disposable E2E server; when
the catalog has no matching example, it submits that package first. Package
changes should regenerate examples and repeat the affected validation.

## Practical limits of this evidence

The submission/demo environment is a disposable loopback **in-memory store**.
It runs the normal import schema, artifacts, translations, rule tests and
presentation validators. The platform's existing non-Firestore policy omits
Firestore-backed five-stage trace recording there. This local playthrough
does not certify the production Firestore recorded-publication workflow,
change production settings or add games to the production catalog. A real
publication must complete the required recorded flow for its exact final
payload and private submission secret.

Chromium desktop/phone-sized layouts are browser evidence. They do not prove
Safari behavior, physical iOS device behavior, native rendering parity, or a
SwiftUI/UIKit implementation. No new Swift renderer is included: native
applications can implement the documented scene contract and run the shared
pure presentation source in QuickJS. The spreadsheet review is a requirements
triage, not validation of every listed game's full rulebook or faithful
physics, drawing, audio or real-time interaction.

See [the authoring guide](declarative-games.md) for native host behavior and
[the coverage review](declarative-game-coverage.md) for format boundaries.

## Backgammon, catalog, camera and movement release — 2026-11-13

The eleven packages now include Backgammon, using byte-identical rules source
from regular Backgammon version 4 (SHA-256
`0206fffd96b1447a457f63431d013c6de5d5337dfc40285157304a95204b3c4e`).
Its six examples include captures, bar entry and bearing off. Tests compare
complete declarative playthroughs against the ordinary rules and check the
normal import/catalog/pinned-version/move APIs, including rejected forged
dice/state/payouts and out-of-turn/illegal moves without state advancement.

`e2e/declarative.spec.ts` completes all original ten games through normal
two-player portal matches on desktop and phone viewports, including local
offline practice and replay. `e2e/declarative-backgammon.spec.ts` adds full
Backgammon portal matches, pass-and-play and online computer opponents.
`e2e/declarative-zoom.spec.ts` exercises actual Chrome two-touch input on phone
and tablet, legal drops after zoom, gesture cancellation, pan/reset, replay
camera preservation, opponent movement at 125% zoom, captures, bar re-entry,
bearing off, and reduced motion. All 30 checker identities are preserved.
These are Chromium checks, with the native/iOS limitations described above.

The release publisher uses real server and QuickJS presentation playthroughs
followed by authoritative replay in the ordinary production authoring APIs.
It completes all five recorded stages for each exact payload and private
secret before the regular import creates a persistent catalog game. This
publication is distinct from the earlier disposable demo evidence: no startup
catalog fallback or validation bypass is used. Browser verification of the
deployed catalog and device-only practice uses real published packages and
blocks production account/match writes; online match tests use the disposable
local server.
