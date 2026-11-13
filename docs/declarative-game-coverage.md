# Declarative UI: spreadsheet requirements review

The common interface is a two-dimensional scene of boards, independently
identified pieces, labeled destinations and ordinary form controls. Pure
JavaScript translates the viewer's state into that scene and user intents into
`make_move` JSON. This covers much more of the catalog than a chess-board-only
or card-table-only format.

## Evidence and scope

Reviewed the names and short descriptions in the live
[2026 games spreadsheet](https://docs.google.com/spreadsheets/d/1-_GPw7Sd_ZOmv21VgsVshiH-Q2GpeVeZiBP6UB2ovH4/edit#gid=740849951)
on November 13, 2026. Its public CSV export contained 1,332 sheet rows. The
catalog starts after its header at row 21 and has **1,311 nonempty game rows,
1,310 distinct case-insensitive names**. Monopoly Junior appears twice, at
rows 449 and 1327; both descriptions are retained. The separate top-five
section contains **44 game mentions**, including aliases and names absent from
the main catalog.

The [complete sanitized inventory](../reports/declarative-game-coverage.csv)
addresses every catalog row and every top-five game mention. It retains game
names, descriptions, rules links, sheet row numbers, requirement tags and a
triage reason. Student names, email addresses and assignment columns are
excluded. No spreadsheet cells or existing published games were changed.

This review concerns **UI requirements inferred from the spreadsheet**, not an
audit of 1,311 complete rulebooks or a claim that all listed games have been
implemented. A short description can omit hidden information, negotiations,
special phases, precise timing or unusual piece geometry. The ten executable
examples demonstrate their own rules and interactions; they do not prove the
remaining catalog's rules or native-client conformance.

The reproducible, conservative triage in
[`tools/classify_declarative_games.py`](../tools/classify_declarative_games.py)
uses keyword requirement tags, explicit physical/performance/reaction/drawing
exceptions, and an ambiguous bucket. Its statuses mean:

| Status | Main-catalog rows | Meaning |
| --- | ---: | --- |
| `direct` | 1,117 | The described discrete interface is a candidate for the common scene and JSON-action model. Layout and full rules still need per-game verification. |
| `adaptation` | 55 | Physical skill, toy mechanisms or external performance requires an explicitly described digital adaptation or external activity. |
| `extension` | 37 | Faithful interaction needs capabilities beyond v1, such as freehand drawing input, audiovisual playback, trusted reaction arbitration or true 3D arrangement. |
| `ambiguous` | 102 | The short description does not reveal enough concrete UI requirements to assert a direct fit. Read its complete rules before conversion. |

These counts are requirements triage, not measured compatibility percentages.
For example, an ambiguous classification for Pandemic or Fox and Geese means
the conservative classifier lacks a concrete shape/layout signal in that row;
it does not mean the games are impossible to express. Requirement tags overlap
and are hints rather than exhaustive rules analysis. Top-five aliases borrow a
matching catalog family's description when available; the CSV names its source
row, and the match does not assert identical variant rules.

## Requirements that shaped v1

| Family and spreadsheet examples | Required representation |
| --- | --- |
| Chess, checkers, Go, Gomoku, tic-tac-toe, Battleship, Scrabble | Rectangular grids; cells as stable addresses; pieces independent of cells; text/image artwork; per-viewer filtered state. Intersections can use explicit graph anchors. |
| Hex, Chinese Checkers, Abalone, Catan, Havannah | Explicit hex/graph anchors and optional links. Board coordinates carry geometry; movement rules stay in game logic. Catan roads and vertices can be separate anchors rather than forcing everything into hex centers. |
| Risk, Ticket to Ride, Pandemic, Diplomacy, route and railway games | Image-backed maps; named graph nodes/edges; arbitrary coordinates; resource labels and choices. A visually adjacent territory need not be a legal destination. |
| Ludo, backgammon, Senet, Monopoly, Snakes and Ladders | Ordered track anchors, multiple pieces at one destination, stack offsets and dice/turn controls. A track need not be a rectangular board. |
| Poker, bridge, rummy, Uno, Dominion, Hanafuda, Mahjong | Multiple zones for hands, deck, discard, table and player tableaux; cards/tiles with front/back; arbitrary asset IDs; layering and selection; number/choice controls for bidding. |
| Mancala, Kalah, Oware, Nim, TZAAR, Gobblet, Bashni, Tak | Explicit count/stack state; several independently identified pieces at one anchor; z-order, scaling and labels; moving or removing objects without treating occupancy as a single Boolean. |
| Carcassonne, Blokus, Patchwork, Kingdomino, Tsuro, Pentago, The Duke | Rotation and face changes; piece groups can be emitted as several stable pieces sharing a transform computed by the reducer; legal placement targets are emitted explicitly. |
| Yahtzee, Pig, Farkle, dice drafting and worker-placement games | Dice appearance plus arbitrary score labels, buttons, numbers and choices. Random outcomes come from authoritative server logic, not decorative animation. |
| Bulls and Cows, Mastermind, trivia, bidding, word and deduction games | Native text, number and choice inputs; labels, clue histories and action buttons. A board image is optional beyond a minimal containing zone. |
| Stratego, Battleship, Hanabi, Coup, hidden-role games | `viewFor` filters information on the server. The reducer receives only that viewer's view; hiding a piece in rendering is not a secrecy boundary. |
| Dots and Boxes, Sim, Paper Soccer, Hackenbush, Cartographers | Predefined selectable edge/cell/shape targets and rendered paths. These discrete games can use explicit JSON targets without a freehand gesture API. |

V1 uses complete scene snapshots rather than imperative UI commands. Removing a
piece from the next snapshot deletes it; changing its position moves it;
changing `rotation`, `scale`, `face`, `opacity` or `z` updates its presentation.
This makes reconnect/replay deterministic and lets native renderers choose their
own animation implementation. Legal destination IDs describe available intents;
the server still validates the corresponding move and decides the outcome.

## Boundaries and future extensions

Pictionary, Telestrations, Sprouts and the Quiet Year need a real drawing editor
for their unconstrained input. V1 can display authored paths but does not
capture arbitrary pointer strokes. A constrained edge-selection variant must
be labeled as such. Audio clues and film clips in Name That Tune and Scene It?
need media support and suitable assets.

Dobble, Speed, Snap, Jungle Speed, Captain Sonar, Space Alert and XCOM need
reaction timing or simultaneous real-time arbitration to retain their original
interaction. Ordinary JSON intents can be transported, but v1 supplies neither
trusted clocks nor a real-time simulation loop. A turn-based conversion should
document that change. Likewise, clocks shown as text are presentation; server
deadlines remain authoritative.

Operation, Jenga, Crokinole, Subbuteo, physical throwing games, and the sheet's
explicit digital-physics adaptations cannot be made faithful by merely rotating
an image. Physics/geometry can be simulated in pure logic, but its model and
rule differences need separate validation. Qubic and Score Four can be
displayed as multiple labeled 2D layers, while true 3D manipulation needs a
renderer extension. Acting, singing, whispering and room-scale social games
need either external performance or a documented text/choice adaptation.

An SVG/image asset can depict an unusual board or figure; it does not silently
add hit-testing, motion rules, drawing, physics or audio capabilities. New
capabilities should use a new negotiated schema version rather than hidden
HTML, arbitrary native code, or ad hoc platform-specific callbacks.

## Reproducing this inventory

Download the spreadsheet's CSV export outside the repository, then run:

```sh
python3 tools/classify_declarative_games.py /path/to/2026-games.csv
```

The snapshot reviewed here has SHA-256
`be18b1d30aefbb2db8f8a9c36a0dd209a25c239b9b8cedb08a45d16a94248fda`.
The command writes only sanitized game information to
`reports/declarative-game-coverage.csv` and prints counts and the source hash.
Later sheet edits can change the counts. Keep the source CSV out of commits
because its other sections contain student information.

See [the authoring guide](declarative-games.md) and
[the JSON schema](../schemas/declarative-ui.schema.json) for the implemented
contract.
