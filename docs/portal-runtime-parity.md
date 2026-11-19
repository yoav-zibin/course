# Portal runtime comparison — November 19, 2026

The checked pages and games are mostly equivalent across Chromium, the actual
Android APK in an emulator, and the actual iOS app in Simulator. All 45 complete
saved-game positions matched the common expected positions, including rule state,
move history, player turns, game version and seed. Actual screenshots were also
reviewed side by side.

This is a comparison of application source
`600e8e35ab3d7338055e4f28eaa3d165be4bdba2`, the revision selected when the audit
started. It does not establish parity for later commits or physical devices.

## Coverage

- Games, Matches, On this device, Preferences, and the signed-out account dialog.
- Tic-tac-toe, Connect Four, and Checkers against the local computer.
- Each game: initial position, three human turns with computer replies, and the
  saved position after an actual app restart or browser reload. This produces
  15 captured positions per platform.
- A matched 402 × 874 logical viewport, plus an additional 1440 × 1000 web run.
- On web and Android, creating another practice game as Player 2, checking the
  computer's opening move, then making a human move and checking its reply.

The clients start offline with public game packages and synthetic visitor saves,
using the same game versions, legally initialized positions, computer seed and
clock. Subsequent moves use actual UI clicks and native taps. No account
credentials or production game writes are involved.

iOS evidence combines completed pages and Tic-tac-toe from
[audit 44520104228](https://github.com/yoav-zibin/course/actions/runs/44520104228)
with Connect Four and Checkers from
[audit 44524588261](https://github.com/yoav-zibin/course/actions/runs/44524588261).
The first run stopped at a test locator that did not account for iOS grouping a
saved card's title and metadata. Its original failed manifest is retained inside
the explicit combined manifest. The remaining-game run passed. Both used the
identical application binary, JavaScript bundle and fixture.

## Visual results

Screenshot color-component analysis detected all 42 rack holes and six placed
Connect Four discs on each platform. The iOS discs were within 0.5 logical pixels
of their holes and within 0.24 logical pixels of the corresponding web/Android
disc centers, within roughly one logical pixel of raster measurement uncertainty.
The reported iOS piece-offset defect was not reproduced in this snapshot.

Four minor issues remain in the audited snapshot:

- Browser SVG text uses a serif default; native SVG text uses a sans-serif default.
- Connect Four's long instruction clips at the phone canvas's right and bottom
  edges. The desktop version still clips its bottom.
- Checkers' bottom instruction sits too close to the canvas edge and clips slightly.
- Navigation to Preferences can retain the previous page's vertical scroll offset.
  The audit records this and scrolls normally to the top for comparable captures.

System bars, safe areas, system fonts, web install/notification options and the
responsive desktop navigation are expected differences. The scope is English,
signed-out pages and local computer play; authenticated multiplayer, notifications
and physical-device delivery were not covered. This audit changes diagnostic
tooling and documentation only.

## Evidence and reproduction

The VM's evidence is under `/tmp/buildplay-parity-600`. The final side-by-side
report is `report/index.html`; `BuildPlay-three-platform-comparison.zip` includes
screenshots, captured match objects, provenance, measurements and findings.

The common fixture is `tests/fixtures/portal-parity/common.json`, SHA-256
`fbd617434c939ae69795cb635c06f68f111a5e6a8336851a55e36af928b93625`.
`scripts/build-portal-parity-fixture.ts` generates legal expected states and
scenes. Regenerating it from another revision creates a different comparison.

`scripts/portal-parity-web.cjs` drives the matching export with Playwright.
`PORTAL_PARITY_VIEWPORT=1440x1000` runs the wider layout;
`PORTAL_PARITY_PAGES_ONLY=1` refreshes Preferences/account captures while retaining
game proof. The manual `Portal runtime parity audit` workflow reuses the pinned
simulator artifact on a fresh owned simulator. Its scope is recorded explicitly;
it does not rebuild or publish an application.

`scripts/portal-parity-report.py --evidence /path/to/evidence --output /path/to/report`
checks the captured positions independently and creates the HTML report and zip.
Available source metadata must agree. Visual review is recorded separately from
saved-state equality. Board images are exact crops of captured pixels.
