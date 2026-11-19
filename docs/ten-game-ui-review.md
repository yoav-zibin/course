# Ten-game UI polish and local review

This work follows `HANDOFF-DECLARATIVE-GAME-UI.md`. At the original preview
handoff, nothing had been committed, pushed, published or written to production.
The active branch was fast-forwarded
to upstream main `170a6b0` at the user's request. The previous checkout at
`course-main/game_platform` remains intact, including its uncommitted changes.

The ten handoff editions live in `games/declarative/card-table/`. This is an
artifact/source directory, not a second public catalog. It avoids replacing
main's existing game packages while the user reviews the work. Rebuild with
`python3 tools/build_polished_card_tables.py`. The six related card UIs share
`card-games.ui.template.js`; the remaining four have individual portable reducers.
Hearts, Crazy Eights and Quoridor use main's current rules, tests and schemas;
their presentation is the part that changed. The other seven retain the handoff's
rules. No other game's package was edited.

A baseline of the inherited files and their SHA-256 hashes is retained at
`/private/tmp/ten-games-polish-baseline/`. The manifest in
`reports/card-table-review/manifest.json` records this review's package hashes,
private links and read-only catalog candidates.

## References and changes

References inform the layout and interaction hierarchy; no external source code
or artwork was copied. Published variants can have different rules. Timing below
is this project's chosen timing, not a measured claim about the reference sites.

| Game | Reference and idea | Concrete changes and checks |
| --- | --- | --- |
| Six-Card Golf | [Pagat's illustrated Golf guide](https://www.pagat.com/draw/golf.html): two separate 2×3 tableaux, stock and discard between them. | Larger centered solo cards; separate vertical bands for names, known score, stock and the player's tableau. Retained two different opening taps and direct stock-discard/reveal on a hidden card. Per-piece face changes animate. Checked opening, stock/reveal regression, replacement and final scoring. |
| War | [CardGames.io War](https://cardgames.io/war/): separate player columns and persistent battle result. | Separate decks and face-up cards; round/depth/card identity keys; 360 ms animation plus 650 ms result pause policy. The inherited solo computer continuation remains automatic. Ace displays A. Checked physical deck tap, solo progression and the final capture. |
| Crazy Eights | [CardGames.io Crazy Eights](https://cardgames.io/crazyeights/): clearly separated draw/discard and an explicit suit chooser. | Portrait table with prominent discard, matching-suit prompt, readable hand rows and stable play/draw identities. Eight selection remains a distinct decision followed by suit choice, with cancel and stale-selection clearing. Checked legal plays, separate suit regression and an empty-hand finish. |
| Hearts | [CardGames.io Hearts](https://cardgames.io/hearts/): scores above a central trick, private hand below. | Recognizable red ♥/♦ and black ♣/♠, compact score grid, labeled trick positions, multirow hand with clearance for legal-action badges and winner text. Uses current main's rules. Checked follow-suit play and the final trick/result. |
| Michigan | [Pagat Michigan/Newmarket layout](https://www.pagat.com/stops/michigan.html): suits form distinct sequences with the hand separated from the table. | Preserved this project's existing seven-outward variant. Added suit rows, rank guide, consistent suit/color mapping in table, hand and accessibility names, spaced hand rows and legal pass. Checked a seven opening, extension and final card. |
| Quoridor | [QuoridorOnline](https://quoridoronline.com/) and [Gigamic's illustrated board](https://export.gigamic.com/wp-content/uploads/2021/01/GIGAMIC_PRODUCT_SHEET_QUORIDOR-CLASSIC_02-2017.pdf): the board dominates, controls describe move/wall modes. | Short instructions; main's authoritative legal-wall list; square-centered pawn destinations, larger wall hit areas, correct goal labels and passive opponent/wall pieces. Explicit mode/orientation choices remain. Checked pawn destination, physical wall placement and goal completion. |
| Concentration | [Helpful Games Memory](https://www.helpfulgames.com/subjects/brain-training/memory.html): fixed grid, independently revealed cards and visible pair progress. | Per-card value keys retained; player name, pair count and score; more clearance between instruction, action badges and first row. Matched cards remain dimmed. Checked two distinct flips, unchanged-card regression and final pair. |
| Casino War | [Wizard of Odds Casino War](https://wizardofodds.com/play/casino-war/): paired player/dealer reveal positions, separate score/result. | Centered two-column card table, persistent hand score and result, stable player identity during the dealer reveal and phase-validated controls. Checked full hand, tie/result, next hand and explicit dealer-only flip/reduced-motion browser assertions. |
| Old Maid | [CardGames.io Old Maid](https://cardgames.io/old-maid/): opponent names stay outside hands, draw from an opponent fan. | Opponent-count grid and one centered drawable fan instead of overlapping opponent fans; stable own-card IDs, multirow hand, explicit losing-player result. Checked one chosen hidden-card draw, automatic pairs and final result. |
| Blackjack | [Wizard of Odds Blackjack](https://wizardofodds.com/play/blackjack/): dealer above player, visible total/bet and phase-specific controls. | Centered dealer/hand rows, chip/bet/value labels, per-card identities, individually displayed split-hand result lines. Double/Split only appear when affordable and legal under the existing rules. Checked start/bet/play phases, stable existing-card regression and final round. |

## Private play links

The disposable preview binds only to `127.0.0.1:8173`. It uses the real game
server logic, filtered views, pure UI reducers and current shared React Native
web renderer, with an in-memory match store. It has no production configuration,
account login, publishing endpoint or external game API connection. Refresh or
Restart creates a new disposable match. Computers advance about every 2.4 seconds;
Pause computers is available for inspection. The scenario picker opens reviewed
intermediate/final fixtures so special and end states can be tested directly.

1. [Six-Card Golf](http://127.0.0.1:8173/?game=six-card-golf)
2. [War](http://127.0.0.1:8173/?game=war)
3. [Crazy Eights](http://127.0.0.1:8173/?game=crazy-eights)
4. [Hearts](http://127.0.0.1:8173/?game=hearts)
5. [Michigan](http://127.0.0.1:8173/?game=michigan)
6. [Quoridor](http://127.0.0.1:8173/?game=quoridor)
7. [Concentration](http://127.0.0.1:8173/?game=concentration)
8. [Casino War](http://127.0.0.1:8173/?game=casino-war)
9. [Old Maid](http://127.0.0.1:8173/?game=old-maid)
10. [Blackjack](http://127.0.0.1:8173/?game=blackjack)

To restart after closing the process, install the Python project dependencies,
build the shared client (`npm ci --prefix frontends/portal` followed by
`EXPO_NO_TELEMETRY=1 npm run build:portal`), then run
`python tools/preview_card_tables.py --port 8173`. This review used
`/opt/anaconda3/bin/python`, which already has the required dependencies.

## Verification and limits

The shared renderer now animates only a changed card's face, with the old face
visible during the first half of the turn. Legal outlines remain outside that
transform. New cards enter independently; removed animated cards fade as noninteractive ghosts, so Old Maid pairs clear without flashing or leaving stale tap targets. Reduced motion bypasses these effects.
The JSON contract did not need a new animation kind or schema version.

Browser checks use real mouse/touch coordinates because the shared canvas
intentionally receives pointer events and hit-tests its SVG geometry. They assert
one accepted submission per ordinary action, browser error absence and no outer
horizontal overflow. Desktop (1280×900) and phone (390×844) screenshots cover
initial, intermediate, final-decision and completed-result scenes. The separate
Casino War check observes the dealer transform changing while the player remains
still, then verifies the reduced-motion path.

Verified results: 25 focused package/action tests passed; the earlier UI/action boundary run passed 134 tests; all 178 shared-client tests passed; TypeScript checking and the shared web build passed. The final desktop/phone suite passed all 44 cases, including ten completed results on each viewport, clean browser console/error checks, reduced motion and noninteractive pair-removal fades. Screenshots were inspected after a 2.3-second animation settle.

Run checks:

```sh
python3 tools/build_polished_card_tables.py
python -m pytest tests/test_polished_card_tables.py tests/test_declarative_ui.py tests/test_declarative_actions.py -q
npm run typecheck:portal
npm run test:portal
CARD_TABLE_PYTHON=/opt/anaconda3/bin/python npx playwright test -c tools/card-table-review.config.cjs
```

The browser suite is opt-in under `tools/`, so ordinary CI does not accidentally
expect the private server. Native iOS/Android devices, all localization variants,
every allowed roster size and every possible random deal were not exhaustively
reviewed. Large Michigan hands scroll vertically. Golf's denser multi-seat
layouts retain the inherited arrangement; the focused visual pass targets solo
play and the provided fixture rosters. This is tested local UI work, not a claim
of perfection or completed production release validation.

## Later publication, only after authorization

Use `PATCH /games/{existing_id}` for an existing game's content, with its proper
secret/master credential, omitted unchanged fields and a complete replacement
`declarative_ui`. Do not use this source folder as a reason to create duplicates.
Main's Hearts, Crazy Eights and Quoridor rules are deliberately retained so their
UI updates can be prepared without replacing current gameplay fixes.

The read-only catalog lookup found three current declarative editions plus
archived HTML candidates for several others, including two War records. It did
not uniquely establish all ten publication targets. Resolve those exact targets
and migration requirements before any eventual release; no archive was changed.
The manifest records candidates without credentials. Local preview identifiers
must never be substituted for production game IDs.

A presentation publication also requires the current API's complete recorded
`/game-test/*` flow against the exact merged payload under the publishing
credential. These local browser tests do not claim to replace that gate. Any
renderer deployment, final recorded release flow, production PATCH or new-game
migration remains unperformed pending the user's publication instruction.

## Follow-up revision: arrows, speed, scoring and covers

The user's second review requested removal of the action badges while retaining
legal highlights. The shared renderer now omits the arrow boxes entirely;
accessibility action names, keyboard input, drag moves and steady outlines remain.
Concentration's explicit outline setting was restored so removing its badges does
not remove its legal-move indication.

War now uses 360 ms card movement/reveal timing and a 650 ms result pause, half
the prior values. Its local computer cadence is 1,200 ms instead of 2,400 ms.
Quoridor's placed walls no longer enter the minimum tap-size calculation: a
90×10 passive wall had enlarged the whole canvas. Desktop and phone checks now
assert identical canvas dimensions and SVG framing before and after a wall.

Two scoring-display errors were repaired: Golf's known score now cancels a
revealed matching column, and Casino War's text now ranks aces high, matching its
server, and identifies tied matches. Hearts correctly awards one per heart and
13 for Q♠, assigns points to the highest card of the led suit, and applies its
shoot-the-moon adjustment. Tied lowest scores are shown as ties. Its existing
one-round variant is now stated in the table hint. See the
[Hearts rules reference](https://www.pagat.com/reverse/hearts.html).

Blackjack received affordable 10/25/50/100 bet choices, correct pending-bet text,
valid viewer-hand selection while another player uses split hands, separate
split-hand values/bets/results, and tied-final-chip text. Its original server
payout rules passed independent tests: aces, multiple aces, dealer soft 17,
player/dealer busts, pushes, natural 3:2 wins, doubling, split stakes and ordinary
split-21 payouts. The guides now state those rules precisely. A **Blackjack ·
split eights** review scenario is playable in the scenario picker. See the
[Blackjack rules reference](https://wizardofodds.com/games/blackjack/basics/).
Casino War's guide was corrected to describe its existing ten-hand comparison
variant rather than promise an unimplemented tie/war betting phase.

`tests/test_card_table_scoring.py` independently checks scores/winners and exact
pot conservation in two complete seeded playthroughs per game, at minimum and
maximum roster sizes. There are 38 scoring/cover/fixture checks, including
constructed Hearts moon/tie cases and Blackjack settlement cases. This supplements
the package examples; it does not merely compare the game with its own move
reducer. The project-specific Golf face values and Michigan seven-outward variant
were preserved rather than silently changed to another rule set.

All ten games now have distinct, original, text-free 16:9 SVG cover artwork in
`games/declarative/card-table/covers/`. The builder installs each as `images[0]`,
the actual Portal `cover_url` contract. The production Portal was not edited or
populated. `python tools/preview_card_catalog.py --port 8174` serves the real Portal
with only these ten disposable in-memory fixtures, allowing the covers to be
reviewed at [the local catalog](http://127.0.0.1:8174/portal#games). This process
uses no production configuration, database, credentials or network submission.

Verification for this follow-up: the 61-case Python run passed, the final affected
metadata recheck passed 54 cases, all 38 scoring/cover/fixture checks passed, and
all 178 shared-client tests passed. The complete desktop/phone browser run passed
50 cases, followed by 8 targeted rechecks including a real 25-chip bet and a
complete two-hand Blackjack split/push round. Both viewports verified all ten
real Portal cover images and the removal of badges with highlights preserved.
TypeScript, the shared web build and whitespace checks passed. Production release
and native-device verification remain unperformed as described above.

## Live catalog style alignment

Compared the current live https://buildplay.fun/portal#games catalog, especially
Boggle, Mu Torere, Zamma and the existing Spades local-practice table. The catalog
uses simple, text-free flat illustrations, solid game-specific backgrounds,
cream pieces and dark outlines. All ten covers now follow that treatment: no
decorative inset frame or gold card edging; simpler card backs and flat red/yellow
chips; a tan wooden Quoridor board. Game-specific layouts remain distinct. The
existing green play tables already match the live card-game palette. Only the
ten staged covers and the disposable preview revision changed in this pass.

All ten refreshed cover images loaded in the actual local Portal on desktop and
phone. The 38 scoring/cover/fixture tests passed again. Local catalog revision 3
refreshes older cached review art. No game mechanics, live catalog, production
settings, publication or deployment changed.

## Authorized publication preparation

The user subsequently authorized publishing all ten games on November 19.
Current main was fetched and integrated through `3d31ce1` before release. The
shared renderer was committed as `6558bff`; the standard CI/deployment path is
used. Release target mapping is in `reports/card-table-review/release-plan.json`:
nine existing IDs (including the archived 6-Card Golf entry and War v3), plus
a new Concentration record. Other games, including Memory pairs and the older
archived War record, are retained.

All 100 required configurations were completed locally through authoritative
rules and offered human UI actions: 9,258 moves. Computer seats use the rules'
computer policy; their automatic actions are not presented as human UI taps.
All 63 package/scoring tests, 182 current shared-client tests, typechecking and
the shared web build passed.

The first live authoring server-check returned HTTP 500 before any game write.
The deployed index inventory disables every field in game_test_traces but omits
its queried metadata fields. The release adds indexes only for kind, secret_hash
and submission_id, without indexing source/state/chunk data or changing private
runtime configuration. An idempotent deployment repair is limited to those three
fields and preserves already-ready indexes. The API's complete recorded test
gate remains enforced. Credential-bearing requests use POST/PATCH JSON.

Android Play run 44632578504 failed resolving three Maven artifacts before
signing/upload. All three exact artifact URLs subsequently returned HTTP 200.
The build now retries dependency-download failures up to three attempts with
--refresh-dependencies; ordinary compilation failures still stop immediately.
The GitHub connector lacked Actions rerun permission, and automatic review
rejected extracting a token from the Git credential helper. No token was read.
The normal tested push-to-main workflow is used for the corrected build.

Publication remains incomplete until the live API responses and readback are
recorded in `reports/card-table-review/publication.json`.

The initial renderer CI run passed 151 browser tests but timed out on 12 direct
SVG-piece interactions. Its new inner animation group had pointer-events=none,
which left the parent canvas receiving the click instead of the accessible
piece. The group now retains normal artwork hit testing. A local browser
semantic card click completes and keeps focus; shared-client tests (182),
typecheck and rebuilt web assets passed after the repair. The next full CI run
must pass before deployment/publication. The user's explicit release-and-repairs
approval authorizes the staged CI/index changes; no credential-helper token was
accessed.
