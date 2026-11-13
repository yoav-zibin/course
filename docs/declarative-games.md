# Authoring declarative games

A declarative game has authoritative pure JavaScript rules, a JSON UI package,
pure JavaScript presentation logic, and optional PNG, JPEG or SVG assets. The
same presentation code can run in QuickJS inside an iOS or Android app. The
native host renders ordinary boards, pieces and controls from its JSON output;
the game supplies no HTML, DOM operations or WebView UI.

The portal includes the browser renderer for this contract. A native client
still needs to implement the renderer and host bridge described below; this
format alone is not a shipped SwiftUI/UIKit renderer. Existing HTML games keep
their existing interface.

The authoritative contract is
[`schemas/declarative-ui.schema.json`](../schemas/declarative-ui.schema.json),
also served by `GET /games/declarative/schema`. It is Draft 2020-12 JSON Schema.
The root validates the package; `$defs.scene` validates each scene and
`$defs.response` validates each reducer response. `$defs.message` describes
the `state_changed` and `ui_event` inputs; `$defs.event` defines local event
payloads. The server also checks IDs,
references, image data, topology and byte limits that JSON Schema cannot fully
express. See [the spreadsheet requirements review](declarative-game-coverage.md)
for the supported families and limits of this version.

## Separate rules from presentation

`server_code` keeps the existing
[server-side Game API](server-side-game-api.md): `game.newMatch`,
`game.applyMove`, `game.viewFor`, `game.computerMove`, `game.randomMove`, and
optional join/leave handlers. It validates moves, produces state, filters each
viewer's information, decides whose turn it is, and settles the game. Its
schemas, tests and deterministic execution requirements still apply.

Declarative games are ordinary published `Game` records. They appear in the
same `/games` catalog, paginated lists, search, invitations and version-pinned
matches as HTML games. `renderer_type: "declarative"` selects the presentation
host, and the portal appends **(Declarative)** to the localized name. They use
the same create/join/start/move/history/computer-opponent endpoints and server
validation. Sending a forged scene, local state, dice or illegal move cannot
replace server state. Offline practice runs locally, just like HTML practice;
multiplayer and online computer matches remain server authoritative.

The Backgammon package uses the exact rules JavaScript of the regular audited
Backgammon game. Its strict move schema describes roll, pass and moves from a
point or bar to a point or off tray. Only the server rolls dice and computes
`view.legalMoves`, including forced bar entry, maximum dice use and bearing off.
The presentation only displays those legal choices and sends the selected move.
See [Backgammon's package notes](../games/declarative/BACKGAMMON.md) for the
source hash, preserved variant rules and native event examples.

`declarative_ui.ui_code` defines a separate global object:

```js
var gameUI = {
  reduce: function (message, localState) {
    // Return { scene, local_state?, make_move? } using only JSON data.
  }
};
```

There are two inputs. A platform `state_changed` contains the viewer's filtered
`view`, players, turn, status, move count, translation strings, locale and
direction, just as the existing Game API does. `state` is the compatibility
alias for that filtered view. A local interaction wraps the latest message:

```json
{
  "type": "ui_event",
  "event": {"type": "tap", "id": "play-card-7"},
  "state_changed": {
    "type": "state_changed",
    "view": {"hand": [7, 12], "discard": 3},
    "status": "ongoing",
    "move_count": 4,
    "my_player_index": 0,
    "acting_for_player_index": 0,
    "turn_of_player_indices": [0]
  }
}
```

The reducer always returns a **complete scene snapshot**. Optional
`local_state` is JSON interaction state, such as a selected piece ID or an
unfinished bid. It is passed back on the next call; if omitted, the browser
resets it to `null`. This state is not authoritative match state. Clear stale
selections when a new move count or state makes them invalid.

Only a current player's `ui_event` may return `make_move`. Its value is the
move object itself, for example `{"make_move":{"card":7}}`. The host sends the
existing `{"type":"make_move","move":{"card":7}}` message through the
platform's normal move flow. It includes the expected move count when calling
`POST /matches/{id}/moves`; the server validates and applies the move, then a
fresh `state_changed` drives the display. Do not return new match state or
optimistically commit a move in presentation. Emit at most one move until the
next state message. Spectators, replay and waiting/out-of-turn viewers cannot
submit moves.

Each reduction runs in a fresh execution context. Globals are not persistent
state. Use ordinary synchronous ES2020 JavaScript supported by QuickJS, with
no imports, DOM, network, timers, promises, clock reads or randomness.
`Math.random` throws and `Date` is unavailable. All inputs and outputs must be
finite JSON data. The server presentation probe limits each call to 50 ms,
16 MiB of memory and a 256 KiB stack; the response and local state each fit
within 256,000 UTF-8 bytes. The package fits within 350,000 bytes and messages
within 900,000 bytes. Keep the presentation comfortably below those limits.

## Describe the board and piece vocabulary

The package has these top-level fields:

| Field | Purpose |
| --- | --- |
| `format`, `version` | Exactly `"buildplay-ui"` and `1`. Reject unsupported versions rather than guessing. |
| `viewport` | Positive logical `width` and `height`; renderers scale this coordinate system to available space. |
| `boards` | One or more positioned surfaces: `grid`, `hex`, `graph`, `track`, `free` or `zone`. |
| `piece_types` | Named reusable appearances: `circle`, `rect`, `card`, `dice`, `image` or `text`; dimensions, colors and optional front/back artwork. |
| `assets` | Optional map of asset IDs to image descriptors. |
| `strings` | Source-language string table; use translated `state_changed.strings` when rendering labels. |
| `ui_code` | The source defining `gameUI.reduce`. |

Coordinates have x increasing rightward and y increasing downward. Board x/y
locate its top-left corner in the viewport. Piece and target positions are
relative to their board and specify their center. Labels use viewport x/y at
their top-left; paths use viewport coordinates. Rotation is clockwise degrees
around the piece center. Uniform `scale` multiplies its dimensions.

Keep the same piece ID when that physical piece moves. For multiplayer and
computer matches, the portal animates opponent and computer moves over 1,440 ms.
The viewer's own moves update immediately, including pieces captured by that
move. The host uses `state_changed.last_move_player_index`, rather than the next
turn, to identify the actor. Unknown actors update immediately. If a snapshot
combines an own move with computer replies, the portal first applies the last
own position immediately using viewer-filtered history, then animates the
opponent changes. Missing history or large gaps update immediately. Initial
rendering, replay,
pass-and-play and reduced-motion preferences use immediate updates. A scene is
still a complete snapshot; no animation commands or delays belong in game
logic. For games whose server stores counts rather than individual pieces,
presentation `local_state` can reconcile identities, as Backgammon does for
moves, captures, bar entry and bearing off.

The portal camera supports two-finger pinch/spread zoom from 1× to 4× and
panning the enlarged board by dragging its background. Zoom buttons and Fit
board provide keyboard alternatives. Camera state survives scene changes and
replay, and resets when the host opens a new match. Camera gestures stay in
the host and never emit `make_move`; two fingers cancel an unfinished piece
gesture. Native renderers can provide equivalent camera controls independently
of the game spec.

A grid supplies `rows` and `columns`. Its implicit cell IDs are row-major
decimal strings, starting at `"0"`; an 8-by-8 grid ends at `"63"`. Pieces and
targets use `"position":{"cell":"17"}`. Hex, graph and track boards supply
explicit `cells` of `{id,x,y,label?,color?}` and optional `links` of
`{from,to}`; the reducer chooses which graph edges and destinations are legal.
Free surfaces and zones support `"position":{"x":80,"y":120}`. A position
uses either a cell or an x/y pair. IDs use letters, numbers, `_`, `.`, `:` and
`-` and must resolve to their declared objects.

Use several boards/zones for a player's hand, shared market, draw pile,
discard pile, score area or separate playing boards. A board can reference an
image `background_asset`, allowing a map or illustrated playmat beneath its
explicit interaction anchors. Multiple pieces can share an anchor; offsets and
z-order can expose a stack. There is no assumption that each cell holds only
one object.

## Return scenes and handle interactions

Every scene can contain `pieces`, `targets`, `labels`, `controls` and `paths`;
omitted arrays are empty. All element IDs must be unique across the scene.

| Desired operation | Snapshot representation |
| --- | --- |
| Create or remove a piece | Add its stable ID to, or omit it from, `scene.pieces`. |
| Move a piece | Change its board/position. |
| Rotate, resize, fade or reorder | Change `rotation`, positive `scale`, `opacity` or `z`. Larger z values render later. |
| Select or turn over | Set `selected`, or `face` to `front`/`back`. |
| Offer movement | Emit destination `targets`, then reference their IDs in that piece's `move_targets`. |
| Offer a click, rotation or resize | Set the piece's `actions` to the currently available operations; the host supplies persistent hints and action controls. |
| Change a die, score or card text | Change the piece's `text` or the relevant label. A `dice` appearance does not generate random results. |
| Group a polyomino or composite token | Compute positions/rotations for several stable pieces in the reducer. V1 has no implicit group transform. |

Each piece requires `id`, `type`, `board` and `position`. It can override its
type's front artwork with an `asset` ID. A piece type can declare `back_asset`
for its reverse side. With `face:"back"`, the renderer shows only that back
asset or a generic back when none is supplied; it suppresses front artwork,
front text and front-derived accessibility labels. Destinations require `id`, `board` and
`position`, and can have a visible label. `move_targets` is a UI affordance,
not server permission; `applyMove` must independently reject illegal moves.

### Always show available actions

Hosts must keep the next available actions visible. An active piece is
highlighted and its action indicators identify whether it can be tapped,
moved, rotated or scaled; enabled scene controls and placement targets remain
visibly actionable. A cursor that changes only on hover is insufficient for
touch devices. Selection or the start of a drag adds a stronger source hint
and highlights that piece's legal destination IDs. Unrelated destinations
must not appear as legal drop locations for the selected piece. Clear these
gesture hints after a drop, cancellation, a new state message or a turn change.

Declare these capabilities on each piece:

```json
{
  "id": "tile-4",
  "type": "tile",
  "board": "rack",
  "position": {"x": 80, "y": 120},
  "actions": ["tap", "move", "rotate", "scale"],
  "move_targets": ["square-7", "square-8"]
}
```

`actions` is a unique subset of `tap`, `move`, `rotate` and `scale`. Declaring
`move` requires at least one `move_targets` destination, and every referenced
destination must exist in the scene. Nonempty `move_targets` always implies
movement, even when the action list does not explicitly name `move`.
`actions:[]` disables tap/rotate/scale; combine it with no movement targets for
a fully passive piece. Omitted `actions` preserves the original renderer's
legacy tap behavior. New games should declare the field explicitly, including
`[]` on decorative pieces, so hints cannot suggest a click that does nothing.

Static `rotation`, `scale`, shape, artwork or `draggable` fields do not grant
rotation or scaling actions. Emit those capabilities only when the current
view and phase permit them. Hosts show the affordances only while the viewer
can act, and suppress them for spectators, replay, ended matches and a pending
move. Hidden pieces stay hidden, including their action indicators. The hint
metadata is part of the viewer-specific scene and must not reveal another
player's secret pieces or available private decisions.

The renderer sends these JSON events:

```json
{"type":"tap","id":"piece-or-target-or-button-id"}
{"type":"drop","id":"piece-id","piece_id":"piece-id","target_id":"destination-id"}
{"type":"change","id":"control-id","value":"new value"}
{"type":"rotate","id":"piece-id","delta":90}
{"type":"scale","id":"piece-id","factor":1.1}
```

Movement supports drag/drop and tap-a-piece, then tap a destination. Handle
`drop` to translate the selected piece and destination into the game's move
shape. Handle `tap` for placements, selection and buttons. Targets are explicit
so touch and keyboard clients can offer equivalent actions.

For `rotate`, `delta` requests a relative clockwise angle in degrees; it must
be nonzero and between -360 and 360. The standard rotate control requests 90
degrees. For `scale`, `factor` is a relative multiplier greater than zero and
at most 100; standard grow/shrink controls request `1.1` and `1/1.1`.
These parameters belong only to their corresponding event types. A rotation
or scale control sends a request to the reducer, and never edits match state
or the rendered piece optimistically. The reducer can keep a preview in
`local_state`, emit a new scene, or submit the game's own move shape. Server
rules remain authoritative when the operation affects gameplay. A game that
does not support an operation must omit its action rather than show an inert
control.

Controls have `id`, `label`, `kind` and optional `disabled`/`value`. Kinds are
`button`, `number`, `choice` and `text`. Numbers can set `min`, `max`, `step`;
choices supply `options` of `{value,label}`. Prefer string choice values for
portable controls when possible; a choice event preserves the selected
option's original string, number or Boolean type. Number controls emit
numbers and text controls emit strings. Parse/validate those values in the
reducer, and validate the final move again on the server. Text inputs send
their value on change rather than on every keystroke.

`paths` draw polylines from their `points` array, with optional `color` and
`width`. They can show routes, winning lines or laser rays. V1 has no freehand
stroke-input event, trusted reaction clock, 3D scene or physics engine. Explicit
cells/targets can implement discrete line-drawing games; a faithful freehand or
physical game needs an extension or a documented adaptation.

## Assets and hidden information

An asset descriptor looks like:

```json
{
  "pawn": {
    "uri": "https://example.com/assets/pawn.png",
    "media_type": "image/png",
    "width": 80,
    "height": 80,
    "alt": "Blue pawn"
  }
}
```

PNG uses `image/png`; JPG/JPEG uses `image/jpeg`; SVG uses `image/svg+xml`.
Inline assets use a matching base64 data URI, such as
`data:image/png;base64,...`. Each decoded inline image is at most 120,000
bytes; SVG must meet the platform's inert SVG image rules. HTTPS asset URLs
must have no embedded credentials. The reducer refers to asset IDs, never
loads a URL itself. Hosts load/decode images and can cache them for native or
offline play. Asset dimensions are metadata; piece dimensions control display.
Keep externally hosted artwork version-stable and available to the intended
players. Inline assets are useful for a self-contained package.

For an illustrated card, reference both asset IDs from its piece type:

```json
{"shape":"card","width":70,"height":100,"asset":"card-front","back_asset":"card-back"}
```

`viewFor` is the secrecy boundary. Do not include an opponent's hand, identity
or hidden board arrangement in their state message, local state, labels or
asset names. `hidden` and `face:"back"` only control appearance; they cannot
protect information already sent to the device. Render only the viewer's
filtered state, including when building spectator scenes and replay.

## A small presentation example

This package displays the Count to three example's `{n}` view and submits its
`{add:1}` move. It is a **UI package**, not a complete publish request:

```json
{
  "format": "buildplay-ui",
  "version": 1,
  "viewport": {"width": 320, "height": 240},
  "boards": [
    {"id":"table","kind":"zone","x":10,"y":10,"width":300,"height":200}
  ],
  "piece_types": {"counter":{"shape":"circle","width":80,"height":80}},
  "strings": {"add":"Add one"},
  "ui_code": "var gameUI={reduce:function(m,l){var s=m.type==='ui_event'?m.state_changed:m;var v=s.view||{n:0};var r={scene:{pieces:[{id:'count',type:'counter',board:'table',position:{x:150,y:90},text:String(v.n)}],controls:[{id:'add',kind:'button',label:(s.strings||{}).add||'Add one',disabled:s.acting_for_player_index==null||s.status!=='ongoing'}]}};if(m.type==='ui_event'&&m.event.type==='tap'&&m.event.id==='add'&&s.status==='ongoing'&&s.acting_for_player_index!=null)r.make_move={add:1};return r;}};"
}
```

The package deliberately contains no authoritative state and performs no
random operation. A state update reconstructs the counter; a button event
requests a move; only the rules server increments n.

For real games, keep readable JavaScript in a `.ui.js` file and insert its
contents as `ui_code` when assembling the JSON request. The same applies to
`server_code`; authors do not need to maintain escaped JavaScript manually.

## Validate, playtest and publish

Use the scene playground at `/static/declarative-test.html` to enter a package
and a state message, render the scene and inspect JSON responses. The server
probe is also available directly:

```text
POST /games/declarative/validate
Content-Type: application/json

{"declarative_ui": <package>, "message": <state_changed-or-ui_event>, "local_state": null}
```

It returns `{scene,local_state?,make_move?}` after bounded QuickJS execution and
schema/reference checks. It persists nothing, creates no match and does not
count as the recorded publication test flow. Invalid packages or reducer
responses return 422; a full validation queue returns 429 with `Retry-After`.
`POST /games/declarative/client` accepts the package itself and returns a
platform-generated `client_code` compatibility host for existing test tools.
Native clients use the package directly and do not need this HTML.

Complete the normal five-step `/game-test` workflow for the exact final
payload. Its input form has a **Declarative UI package** field; paste the
`declarative_ui` object there. The platform supplies the client host, while the
existing server tests, allowed player counts, pass-and-play, multiplayer,
computer opponents, screen sizes and orientation evidence still apply.
Step 1 records and validates the full submission; changing the package or
code afterwards requires a fresh test flow. Test the actual UI, hidden-player
views, spectator/out-of-turn behavior, legal destinations, replay and error
recovery as well as the server's rules.

Submit the complete request to `POST /games/declarative` or `POST /games`:

```text
{
  "name": "...",
  "description": "...",
  "allowed_player_counts": [2],
  "declarative_ui": <package>,
  "server_code": "...",
  "rules": "...",
  "ui_instructions": "...",
  "tutorial": {"text":"...", "html":"..."},
  "images": [...],
  "unit_tests": {...},
  "translations": {...},
  "game_addition_request_id_and_secret": "<your private submission secret>"
}
```

Omit `client_code`: the platform derives it. `/games/declarative` requires the
declarative package; `/games` also accepts the existing HTML form. Authentication,
ownership, idempotent updates, translations in all supported languages,
tutorials, cover/supporting images, JSON schemas, approved examples,
determinism/random-walk checks and recorded test gates are the same as for
other imported games. See [the import API reference](agent-game-import.md) for
every required field and limit. Tutorial HTML remains a platform artifact;
game detail also returns its accompanying plain text as `tutorial_text` so a
native client can present instructions without an HTML viewer.

Use `strings` for source-language UI vocabulary and the incoming translated
table for scene text. Preserve placeholders, provide the required translations,
and keep the usual `server_...` templates for server-generated text. The
generated compatibility host exposes the string table to the existing
localization/test machinery. A native host should pass `strings`, `locale`
and `direction` from the same pinned game version and language bundle.

Successful publication returns the ordinary game detail with
`renderer_type:"declarative"` and `declarative_ui`. The catalog returns the
renderer type without the large package; obtain detail from `GET /games/{id}`.
Matches pin a game version, so load
`GET /games/{id}/versions/{version}` when opening an existing match. Do not
substitute the latest presentation for a match pinned to older rules. The
portal selects its declarative renderer automatically when the full game
contains the package; ordinary online play and the existing move APIs are
shared with other games.

Update declarative code, schemas or player/turn rules by resubmitting the full
tested package through `POST /games/declarative` (or `POST /games`). Partial
`PATCH /games/{id}` behavior changes are rejected so the native scene cannot
be left paired with different rules. Metadata edits and unchanged values
remain supported.

## Native host checklist

1. Fetch the pinned game detail and reject unsupported format/version. Validate
   the package, image types, IDs, scene references and resource limits.
2. Load the UI source into a bounded QuickJS context without platform bindings.
   Recreate the context for each reduction and pass only message/local-state
   JSON. Keep match rules on the authoritative server for online play.
3. On `state_changed`, call `gameUI.reduce(message, localState)` and render its
   complete scene with native views/layers. Save only the returned local state.
4. Translate taps, destination selections, drags and control changes to the
   event shapes above. Call the reducer with the current filtered state message.
5. Accept a move only from a current-seat UI event, at most once per state
   update; submit it through the existing move API with its expected move count.
   Render the server's next view after success or rejection.
6. Clear pending gestures when the match/revision changes; block spectator and
   replay moves; honor locale/direction, accessible labels and touch targets.
7. Keep available action hints visible and expose the same operations for
   touch, pointer and keyboard users. During movement, emphasize only the
   selected piece's declared legal destinations; do not infer permissions from
   the piece's displayed rotation or scale.

Use the server probe and the checked-in examples as cross-renderer fixtures.
Native rendering should preserve cell positions, piece centers, rotation,
scale, ordering, face state and event payloads even if its animation style
differs. Local practice may additionally run the existing server-side Game API
in a separate QuickJS rules context; it must retain its deterministic random,
clock and view-filtering semantics.

## Ten complete examples

[`games/declarative`](../games/declarative) contains complete import requests:

| File | Interaction exercised |
| --- | --- |
| `tictactoe.json` | Grid placement and the terminal board/state. |
| `connect4.json` | Column targets and pieces dropping into board cells. |
| `reversi.json` | Legal placement targets and multiple pieces changing color. |
| `nim.json` | Removing one, two or three counters from a shared heap. |
| `mancala.json` | Pit destinations, sowing counts and stores. |
| `gomoku.json` | A larger grid and five-in-a-row play. |
| `hex.json` | Explicit hex geometry and connection play. |
| `domineering.json` | Composite two-cell placement with different orientations. |
| `memory.json` | Concentration (the sheet's name): card faces and viewer-filtered hidden values. |
| `pig.json` | Dice display, roll/hold controls and score labels. |

Their rules document the particular variant, size and any finite-play limits;
they are examples rather than a claim to implement every published edition.
Each example declares only actions its current rules and phase support. Memory
marks legal card taps, Mancala marks playable pits, Domineering marks its movable
preview, and placement targets or enabled buttons guide the other games. Their
pieces that merely display state explicitly use `actions:[]`. Domineering's
orientation is fixed by the player's role, so it does not advertise an illegal
rotation. Rotation/resize controls are exercised separately by the shared
[protocol tests](../tests/test_declarative_actions.py) and browser fixtures;
games should not enable them as decorative gestures when their rules do not
support them.
`engine.js` and `presentation.js` are readable sources; the build tool embeds
them into each request together with deterministic test cases, source strings,
translations and schematic SVG illustrations. Those illustrations are not
captured gameplay screenshots.

With the checkout importable as `game_platform` and dependencies installed:

```sh
python -m game_platform.tools.build_declarative_examples
python -m game_platform.tools.build_declarative_backgammon
python -m game_platform.tools.declarative_demo --port 8134
```

Open `http://127.0.0.1:8134/portal` to play all eleven games in an isolated,
ephemeral local platform. This runner uses no production data. Its fixtures
support local development and do not substitute for the publication gate.
The scene playground can load the same examples from
`GET /games/declarative/examples` and
`GET /games/declarative/examples/{kind}`.

The checked-in examples contain **public example submission secrets**. Replace
the secret with a new private value before beginning a real publication test
flow, then keep that value for resubmissions of the same game.

For reviewed packages, `tools/publish_declarative_games.py` runs the ordinary
authoring APIs, server checks and verified rules/UI protocol playthroughs,
then submits through `POST /games/declarative`. It does not bypass the five-step
gate or create player accounts/matches. Its private state file must be outside
the checkout; keep it to update the same records instead of creating duplicates.
Protocol playthroughs complement browser tests; they do not verify pixel layout
or touch gestures. Run `e2e/declarative*.spec.ts` as well.

```sh
python -m game_platform.tools.publish_declarative_games \
  --base-url https://your-platform.example \
  --state-file /private/declarative-publication.json \
  --report /private/declarative-publication-report.json
```

See [the validation record](declarative-validation.md) for the portal playthrough
and test environment's limits.
