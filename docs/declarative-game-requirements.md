# Declarative game requirements

These are the acceptance requirements for declarative game packages and the
hosts that display them in native apps and the portal. **Must** is required;
**should** describes the preferred implementation. Existing games and hosts
must be checked against these requirements when updated. This document defines
the target behavior; it does not certify that every current example or host
already implements it.

The [authoring guide](declarative-games.md) explains the current format and
APIs. The [JSON schema](../schemas/declarative-ui.schema.json) defines its
structural contract. Schema validation alone cannot establish usability or
compliance with the requirements below.

## 1. Pure JavaScript and native rendering

- All game-owned logic must be pure JavaScript supported by QuickJS: rules,
  computer-player decisions and presentation logic. Presentation consumes JSON
  messages and produces a complete JSON scene and optional JSON move intent.
- The portable game UI must contain no HTML, CSS, DOM-dependent logic or
  WebView dependency. Native hosts must render the declared building blocks
  directly. Instructions and tutorials must also be available as text or
  declarative content that a native host can display.
- Boards, pieces, positions, permitted interactions and references to assets
  must be declared in JSON. PNG, JPEG and inert SVG artwork are allowed; images
  must not contain executable game logic.
- Game logic must not depend on a browser, device APIs, network requests,
  timers, wall-clock time or persistent JavaScript globals. The platform supplies
  deterministic rule context, randomness and JSON interaction state as defined
  by the existing contracts.
- In online matches, the server remains authoritative for legal moves, dice
  rolls, dealing, private information, scores and results. The UI receives only
  its viewer's filtered information and submits moves through `make_move`.
  Offline practice may run the same tested rules locally in a separate practice
  context; it must never overwrite authoritative online match state or results.

Platform-generated browser compatibility wrappers used by current authoring
tools are adapters outside the portable UI. They must never be required for
native gameplay.

## 2. Model the physical game

The UI must follow the real game's objects and actions as closely as practical.
Players should manipulate the visible pieces, cards and objects they would
handle at a table, using touch or a pointer.

| Physical action | Expected interaction |
| --- | --- |
| Move a checker or chess piece | Pick up/select the piece and drag it to a legal location; also offer tap-select, then tap-destination. |
| Play a card from a hand | Select or drag that card to the appropriate table, pile or recipient zone. |
| Roll dice | Clearly identify the dice and offer an obvious roll action; the authoritative rules determine the result. |
| Rotate a tile or reposition a domino | Manipulate the actual object, showing valid orientations and placements. |
| Take, place or transfer tokens | Act on the visible token or stack and the relevant destination or quantity. |

Hands, decks, piles, stacks, reserves, bars, captured areas and scoring areas
should correspond to their physical roles. Faces, orientation, stacking and
ownership must remain understandable. Object IDs must stay stable as an object
moves, changes zones, is captured or changes appearance.

Avoid requiring players to enter object IDs, coordinates or commands when they
could act directly on an object. Buttons remain appropriate for actions such
as pass, confirm, bid or roll. Rotation and scaling must only be advertised
when they are valid game actions; camera zoom is a separate host operation.

Selecting an object alone must not submit an incomplete choice. A completed
legal action, such as dropping a piece at a legal destination, may commit the
move directly. Do not add an artificial confirmation step unless the rules or
an ambiguous choice require it.

## 3. Always make the next valid action obvious

During an ongoing game, a player who can act must be able to reach a valid
move through obvious visible actions, without guessing or reading source code.

- Always show hints/highlights on currently actionable pieces, cards, dice,
  controls and other objects. Do not depend on hover, which phones lack.
- Distinguish actions such as select/click, drag, rotate and resize. Never
  suggest an operation the current rules or phase do not permit.
- Selecting or starting to drag an object must highlight that object's legal
  drop destinations. Invalid destinations must be clearly unavailable.
- For a move with several steps, show the next required choice after each
  step, through to a valid confirmation or submission.
- Clear obsolete selections and destination hints on cancellation, rejection,
  a state change or completion of the move. Prevent duplicate submissions.
- If the rules require a pass or another phase action, provide that action
  explicitly. Never leave the acting player with an unexplained dead end.
- Waiting players and spectators must see clear turn/phase status. History
  review must show its navigation actions, rather than suggesting that a
  historical piece can make a live move.

Hints must communicate legal possibilities without revealing hidden cards,
secret choices or other players' private information. They explain how to make
a valid move; they do not have to reveal the best strategy.

## 4. Devices, orientation, zoom and readable sizes

- Every game must work on phones, tablets and laptops in both portrait and
  landscape, including small phone screens. Layouts must accommodate safe
  areas, touch input, a pointer and keyboard alternatives.
- Zoom in, zoom out and panning must remain available throughout play and
  history review. Support pinch gestures on touch devices and accessible
  controls on other devices. Rotation of the device must preserve the position
  and a safe, understandable interaction state.
- Camera movement must never submit a move or change authoritative piece
  positions, rotation or scale. Starting a camera gesture must safely cancel
  an unfinished piece gesture.
- Playable pieces, cards, dice, tokens, counters, drop targets and interactive controls
  must be **at least 32×32 rendered pixels in both dimensions**—strictly above
  30×30. Use CSS pixels in the browser and equivalent logical screen units
  such as native points/dp. Prefer **44×44 or larger** for touch targets.
- Measure after viewport fitting and display scaling, not just the dimensions
  written in the JSON spec. Visible objects must be recognizable as well as
  touchable; an oversized invisible hitbox alone does not make tiny artwork
  readable. Text, numbers, suits and ownership indicators must also be legible.
- A dense board must use panning, reflow, separate hand/tray areas or a focused
  view rather than shrinking every object below the minimum to fit the board.
  The default playable view must meet the size requirement. Zooming out must
  preserve usable interaction targets or disable interaction with undersized
  objects and provide an obvious return to a readable view before playing them.
- Zoom, replay, rotation/resize and confirmation controls must meet the same
  size requirement. Avoid overlapping or ambiguous hit areas. Hints and object
  identity must remain visible and distinguishable across supported themes.

## 5. Show what happened with animations

| Context | Required behavior |
| --- | --- |
| Your move during live play | Apply it immediately, including every object affected by your action. |
| Another human's or a computer's move during live play | Animate the affected objects so you can see what that player did. This includes your piece being captured or displaced by their action. |
| Match history review | Animate each recorded move when stepping or playing through history, including the reviewer's own recorded moves. Backward steps should visibly reverse the recorded changes. |

Use the recorded actor and move history, not whose turn comes next, to decide
what happened. A combined update containing your move and computer replies
must place your move immediately before animating the computer changes.

Animations must make the source, destination and effects understandable.
Preserve object identity through moves, captures, dealing, stacking, rotation
and scaling. Changes such as dice results and counters must also be clear.
Playback controls must make the current history step and direction obvious;
history is read-only and must never emit `make_move` or alter the live match.

Animations must last long enough to notice the movement. The current live
opponent-move reference is **1.44 seconds**; choose pacing that keeps the actual
action legible. Do not let routine polling, redraws or fast computer turns
truncate animations or silently skip the meaningful steps of history playback.
Provide pause and step controls for replay. Respect reduced-motion preferences
with clear immediate state changes or a gentler transition and readable cues.

## 6. Provide reusable game elements

The platform must offer a documented, reusable collection of common elements
so authors can compose a game instead of rebuilding standard objects and
interactions for every game.

| Element | Shared capabilities |
| --- | --- |
| Dice | Standard six-sided dice, configurable faces/counts, readable results and a clear roll interaction. |
| Playing cards | A standard deck's ranks and suits, optional jokers, front/back artwork, face-down handling, selection, hands, decks and discard piles. |
| Tokens, stones and checkers | Distinguishable colors/patterns, ownership, selection, movement, stacking, capture and reserve areas. |
| Counters | Readable scores, quantities and resources; increment/decrement actions when permitted by the rules. |
| Boards, zones and markers | Grids, tracks and explicit locations; hands/trays, piles and player areas; turn, selection and legal-destination indicators. |

Shared elements must include sensible sizes, accessible labels, consistent
interaction hints and animation behavior. Authors must be able to customize
artwork and extend the collection without losing these behaviors. Hidden faces
and accessible names must obey the same information-visibility rules as the UI.

In the existing schema, these are composed from `boards`, `piece_types`,
`assets` and scene objects. For example, tokens can use a named `circle` piece
type and counters can use `text` or `rect` types. The table is a component-library
requirement, not a declaration of additional schema enums or already-shipped
component IDs.

## Acceptance checks

Before accepting a game or host update, verify:

- Rules and presentation execute in QuickJS using JSON messages, with no game
  HTML or WebView dependency; invalid and out-of-turn moves remain rejected by
  the server.
- Representative turns, including multi-step choices and forced passes, can
  be completed using visible hints and familiar physical interactions.
- Phone, tablet and laptop layouts work in both orientations; rendered object
  and control sizes meet the minimum. Zoom, pan and orientation changes retain
  a usable view and never accidentally make a move.
- Live own moves are immediate; human/computer opponent moves remain visible
  long enough to follow, including captures and combined updates.
- Read-only history steps and playback animate all actors, explain what
  changed, and respect reduced motion. Live state and results remain intact.
- Reused cards, dice, tokens and counters behave consistently, including
  face-down privacy, labels, hints and artwork.

## Current implementation notes

The current portal provides the JSON renderer, action hints, zoom/pan and
actor-based live animations. History navigation currently changes scenes
immediately: **animated history review is a requirement still to implement**.
The schema exposes reusable primitives and per-game piece types, rather than
the complete shared component collection described above. Rendered minimum
sizes and the full acceptance checklist require device-level verification;
passing the JSON schema does not guarantee them. Native clients still need
their own renderer and host bridge.
