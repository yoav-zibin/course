# Authoring declarative games

Read the [declarative game requirements](declarative-game-requirements.md)
for the mandatory interaction, layout, sizing, shared-element and animation
acceptance criteria. This guide describes the current format and host behavior;
the requirements also identify targets that remain to implement.

A declarative game has authoritative pure JavaScript rules, a JSON UI package,
pure JavaScript presentation logic, and optional PNG, JPEG or SVG assets. The
same presentation code can run in QuickJS inside an iOS or Android app. The
native host renders ordinary boards, pieces and controls from its JSON output;
the game supplies no HTML, DOM operations or WebView UI.

The shared React Native client in `frontends/portal` renders this contract on
web, Android and iOS. It uses the same SVG scene components and an isolated,
bounded QuickJS module on native platforms. Existing HTML games remain only in
the read-only [legacy archive](html-game-retirement.md).

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

Declarative games are the portal's playable `Game` records. They appear in the
`/games` catalog, paginated lists, search, invitations and version-pinned matches.
`renderer_type: "declarative"` identifies their presentation package. The portal
shows the stored localized name. Their create/join/start/move/history APIs retain
server validation. Sending a forged scene, local state, dice or illegal move
cannot replace authoritative multiplayer state. Private computer/pass-and-play
matches run the same deterministic rules locally, persist actions before input
continues and synchronize complete snapshots to their owner’s cloud account.
Multiplayer remains server authoritative and contains human accounts only.
See [match kinds and cloud saves](match-kinds.md).

Ten existing HTML games also have declarative editions: Battleship, Checkers,
Chess, Four-player Chess, Quoridor, Crazy Eights, Go Fish, Hearts, Spades and
Guess Who. These packages retain their existing server rules and present only
the legal actions and viewer-filtered state through the shared scene renderer.
After publication, each is searchable in the portal by its name with the
“(Declarative)” suffix.

Connect6 is a separate 19-by-19 declarative game. Its publication selection is
`--kinds connect6`; the publisher creates a unique game submission secret and
stores it in the private state file outside the checkout. Creating a new game
does not require the administrator/master password.

Ataxx is a 7-by-7 clone-and-jump game with corner starts and automatic conversion
of adjacent opposing pieces. A player without a legal move passes; the game ends
when the board fills, a side is eliminated, neither side can move, or after 300
moves, with the piece majority winning. Select it for publication with
`--kinds ataxx`. See the [Ataxx rules reference](https://playabstractgames.com/en/ataxx/rules/).

Catan is a three- to four-player game on a 19-hex island: settlements and
cities sit on vertex anchors, roads on edge anchors, and the hex board carries
the terrain and number tokens. Players roll dice, collect resources, trade
with the bank, ports or each other, move the robber and play development
cards. First to 10 points wins by default; the first player may set the
target (3–15) before placing settlements. Resource and
development-card hands are hidden information — only hand counts are public —
so the package declares `all_state_public: false`. Select it for publication
with `--kinds catan`.

Codenames is a four- to eight-player team word game: Red and Blue each have a
spymaster and operatives racing to find their words on a 5-by-5 grid of 25
words (the key is 9 Red, 8 Blue, 7 bystanders and 1 assassin). Spymasters give
one-word clues — legality is checked for form only (one token, letters only,
not a board word or its singular/plural variant), since the server cannot
judge semantic relatedness — and the designated guesser rotates among a team's
operatives after each guess and after a pass, so exactly one seat is in the
turn set at all times. Guessing the assassin loses at once for the guessing
team; the winning team's active humans split the pot, with any remainder to
the earliest seat. The key card is spymaster-only information, filtered by
`viewFor` — operative and spectator views never contain the key for
unrevealed words — so the package declares `all_state_public: false`. Select
it for publication with `--kinds codenames`.

Oware is a two-player mancala game in the Abapa rules, distinct from the
existing Kalah game: twelve pits in a ring, four seeds each, sown
counterclockwise with the starting pit skipped on a lapping sow. A last seed
that makes an opponent pit hold exactly two or three captures it, chaining
backwards through matching pits — but a capture that would take every seed
the opponent has left is a grand slam and captures nothing, and a player
whose opponent's side is empty must sow into it if possible. The game ends
when a captured store passes 24, when the player to move cannot feed an
empty opponent side, or when at most six seeds remain on the board; in the
last two endings the remaining seeds go to neither store. All state is
public, so the package declares `all_state_public: true`. Select it for
publication with `--kinds oware`.

Pentago is a two-player game on a 6×6 board made of four 3×3 quadrants.
Each turn is one move: place a marble on an empty cell, then rotate one
quadrant a quarter turn clockwise or counterclockwise — the rotation is
mandatory. Five marbles in a row (across, down or diagonally) wins, checked
after the placement and again after the rotation: a placement five wins for
the mover regardless of the rotation, and after the rotation the mover wins
when both players have five. A full board with no five is a draw. Select it
for publication with `--kinds pentago`.

Onitama is a two-player duel on a 5-by-5 board, Red against Blue, each side
leading one master and four students from its back rank, the master on its
own central temple square. Five of the sixteen real movement cards (each
with its printed offsets and red or blue stamp) are drawn deterministically:
two per player and one neutral card, whose stamp colour decides who moves
first. A turn moves one piece by an offset on one of the mover's two cards,
read from the mover's own side of the board, capturing on landing, after
which the used card swaps with the neutral card; a player whose cards give
no legal move must instead pass one card in the same swap. Capturing the
opponent's master, or moving your own master onto the opponent's temple
square, wins the pot; 500 moves without a win is a draw with the pot split.
All state is public, so the package declares `all_state_public: true`.
Select it for publication with `--kinds onitama`.

Trivial Pursuit is a two- to four-player trivia game on a loop of 24
squares (the full game allows up to six players; this package caps at
four): roll the die, answer a question in the category of the square you
land on, and earn that category's wedge by answering correctly on one of
the six wedge (headquarters) squares 0, 4, 8, 12, 16 and 20, which carry
the six categories in order — Geography, Entertainment, History, Arts and
Literature, Science and Nature, Sports and Leisure. A correct answer rolls
again and a wrong answer passes the turn; every second correct answer in a
row also earns the wedge of that question's category, even on a plain
square. A player holding all six wedges wins by answering one more question
correctly, and after 300 questions with no winner the player with the most
wedges (then most correct answers, then earliest seat) wins. Its bank holds
60 original questions, ten per category. Select it for publication with
`--kinds trivial_pursuit`.

Love Letter is a two- to four-player game of deduction over a 16-card deck
(Guard ×5, Priest ×2, Baron ×2, Handmaid ×2, Prince ×2, King, Countess,
Princess). Each round one card is set aside face down (plus three face up in
two-player rounds), every player is dealt one card, and the player to move
draws a second card and plays one: the Guard guesses at a rival's card, the
Priest peeks, the Baron compares, the Handmaid protects, the Prince forces a
discard (fatal if it is the Princess), the King swaps hands, the Countess
must be played when held with the King or a Prince, and playing the Princess
eliminates the player who plays her. A round ends when one player remains or
the deck runs out, when the highest remaining card wins (ties broken by
discarded-card totals, then shared). Round winners take a token of affection
and start the next round; first to 7 tokens (2 players), 5 (3 players) or 4
(4 players) wins the match and the pot. Hands, the deck order and the
face-down card are hidden information — views show only the viewer's own
hand, public discards and token counts — so the package declares
`all_state_public: false`. Select it for publication with
`--kinds love_letter`.

Mastermind is a two-player, single-round code-breaking game: seat 0 is the
codemaker, who sets a secret code of four pegs chosen from six colors (repeats
allowed), and seat 1 is the codebreaker, who has up to ten guesses to crack
it. After each guess the server returns public feedback — black pegs for the
right color in the right place, then white pegs for the right color in the
wrong place, counted from the remaining color multisets so duplicates never
score twice. The codebreaker wins by scoring four blacks within ten guesses;
if the guesses run out, the codemaker wins, and the winner takes the pot.
There is no role swap or multi-round scoring in this edition. The secret code
is hidden information — only hand-filtered views that omit it reach the
codebreaker and spectators until the match ends and it is revealed — so the
package declares `all_state_public: false`. Select it for publication with
`--kinds mastermind`.

Scattergories is a two- to six-player turn-based adaptation of the word
game: a match is three rounds, each with one letter and six categories
drawn without repeats from a bank of 30. Players answer in seat order,
submitting all six answers as one move; answers stay hidden until the round
is scored, then become public. A normalized answer scores one point when
its first word — after stripping one leading article (the, an or a), a rule
applied only to the letter test — starts with the round letter and no other
player gave the same normalized answer. The highest total after three
rounds wins and splits the pot among tied top scorers. Answers are hidden
information, so the package declares `all_state_public: false`. Select it
for publication with `--kinds scattergories`.

Quarto is a two-player game on a 4-by-4 board with sixteen unique pieces:
every combination of tall/short, light/dark, round/square and solid/hollow
(piece id 0–15 is the 4-bit attribute vector: bit0 tall, bit1 dark, bit2
square, bit3 hollow). Its signature rule is that you never choose your own
piece: seat 0 opens by handing a pool piece to seat 1, and each turn is one
combined move that places the piece in hand on an empty cell and then hands
an unplayed pool piece to the opponent. Any row, column or main diagonal
whose four pieces share at least one attribute value wins immediately for
the player who placed; a full board with no winning line is a draw with the
pot split. All state is public, so the package declares
`all_state_public: true`. Select it for publication with `--kinds quarto`.

Whist is a four-player partnership game played as one thirteen-trick hand.
Scopa is a two-player, single-deal variant using a 40-card deck; the final
score includes sweeps, cards, diamonds, the seven of diamonds and primiera.
Build their packages with `python -m game_platform.tools.build_whist` and
`python -m game_platform.tools.build_scopa`, respectively. They can be selected
for publication as `--kinds whist` and `--kinds scopa`.

The Backgammon package keeps the regular audited game's rules as its base,
with reviewed wrappers for retained rolls and unambiguous moves that use several
dice with one checker. Its strict move schema describes roll, pass and moves
from a point or bar to a point or off tray. Only the server rolls dice and
computes `view.legalMoves` and optional `view.combinedMoves`, including forced
bar entry, maximum dice use and bearing off.
The presentation only displays those legal choices and sends the selected move.
See [Backgammon's package notes](../games/declarative/BACKGAMMON.md) for the
source hash, preserved variant rules and native event examples.

`declarative_ui.ui_code` defines a separate global object:

```js
var gameUI = {
  reduce: function (message, localState) {
    // Return { scene, local_state?, make_move? } using only JSON data.
  },
  getLastMoveAnimations: function (view, scene) {
    // Optional: return ordered paths for the last accepted move, or null.
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

An optional `state_changed.presentation_history` supplies up to 12 recent
viewer-filtered snapshots for rebuilding presentation memory after a reload or
missed update. Each entry is exactly `{view, move_count, last_move_player_index?}`:
`view` is filtered JSON, `move_count` is a nonnegative integer, and the optional
actor is an index from 0 through 9 or `null`. Entries never include authoritative
hidden state or acting permissions. Hosts and reducers must use ordered entries
at or before the current message's move count; the schema checks their shape and
size, while consumers enforce this temporal relationship. Fold them only into
presentation memory, such as the original dice pair, without emitting moves or
changing the current message's permissions. Omitting history remains valid.

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
| `viewport` | Positive logical `width` and `height`; renderers scale this coordinate system to available space. Optional boolean `camera_enabled` defaults to `true`. Set it to `false` to keep the fitted board fixed. Set `camera_controls` to `true` to show zoom and reset buttons for dense boards; it defaults to `false` and has no effect when the camera is disabled. |
| `motion` | Optional bounded opponent movement/roll/announcement timing policy. |
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

Keep the same piece ID when that physical piece moves. Without an explicit
`motion` policy, for multiplayer and computer matches, the portal animates opponent and computer moves over 1,440 ms.
The viewer's own moves update immediately, including pieces captured by that
move. The host uses `state_changed.last_move_player_index`, rather than the next
turn, to identify the actor. Unknown actors update immediately. If a snapshot
combines an own move with computer replies, the portal first applies the last
own position immediately using viewer-filtered history, then animates the
opponent changes. Missing history or large gaps update immediately. Initial
rendering and reduced-motion preferences use immediate updates. Pass-and-play
also updates immediately. `motion.animate_own` is accepted for compatibility
and ignored during live play. Coalesced accepted updates play individually in order
instead of combining checker movement into one scene.
Adjacent history snapshots animate read-only changes, including recorded own
moves. Nonadjacent jumps settle immediately. A scene is
still a complete snapshot; animation timing and transforms belong to the host.
For games whose server stores counts rather than individual pieces,
presentation `local_state` can reconcile identities, as Backgammon does for
moves, captures, bar entry and bearing off.

### Describe the last move's paths

For game-specific movement, implement the optional pure function
`gameUI.getLastMoveAnimations(view, scene)`. Store the last accepted move in
authoritative state and include its safe, viewer-visible details in
`game.viewFor`'s returned view. Keep enough information to reconstruct the
source, intermediate stops and destination from that view alone, including
captures and stack positions when relevant. Replace or clear this record on
every accepted action, including rolls, undo and round resets, so an old move
cannot play again. Filter any private details using the same rules as the rest
of the view. Presentation `local_state` alone is insufficient after a reload.

The host calls the function after `reduce` for a `state_changed`, passing only
the filtered view and the complete final scene. It attaches the returned JSON
as `last_move_animations` in the presentation response. Local UI events do not
call this function. Do not update match state or emit `make_move` from it.

Return an array of entries `{piece_id, path, duration_ms?}`. Entries run in
order; each path visits its waypoints in order. Each waypoint is
`{board, position}`, using the same board-relative `{x,y}` or `{cell}` positions
as pieces. A duration applies to the whole entry, divided equally among its
path segments. It defaults to `motion.move_ms` or 1,440 ms. For example:

```js
getLastMoveAnimations(view, scene) {
  if (!Object.prototype.hasOwnProperty.call(view, 'last_move')) return null;
  const move = view.last_move;
  if (!move || move.kind !== 'checker') return [];
  return [
    {piece_id: move.first_piece, duration_ms: 800,
      path: [move.first_source, move.first_destination]},
    {piece_id: move.second_piece, duration_ms: 1200,
      path: [move.second_source, move.via_a, move.via_b, move.second_destination]}
  ];
}
```

Connect Four records the dropped column and landing cell, then returns a path
from above that column straight down to the final piece. Backgammon records the
authority's chosen checker hops and captures, then translates those into ordered
paths. The host draws the final scene and temporarily places each animated
piece at its declared source until its path runs. This also supports a newly
placed piece absent from the previous scene.

Each referenced piece must exist and be visible in the final scene. Paths have
2–64 waypoints, the array has at most 128 entries, each duration is an integer
from 0–5,000 ms, and the complete sequence must finish within 30,000 ms. Paths
for the same piece must join, and its last path must end at its final scene
position. All boards and cells must exist.

Omit the function or return `null`/`undefined` to keep the host's existing
position-difference animations, including for older pinned rules that do not
retain last-move data. Return `[]` to explicitly request no positional motion
for an action. With declared paths the host animates only a known opponent's
forward, adjacent move. Your own moves update immediately, even with
`motion.animate_own:true`; initial/reconnect snapshots, skipped history,
backward history and reduced-motion settings also settle immediately. Legacy
games retain the behavior described above.

The shared React Native host fits the complete declared viewport, boards,
visible piece bodies and legal destinations at **100%**. Its canvas uses the
available width and normally caps its height for short screens. When that cap
would make piece bodies or destinations smaller than 32 CSS pixels, the canvas
grows vertically and its native containing scroll view reaches the full board.
A package that cannot meet the minimum at the available width still needs a
responsive layout repair; this host adjustment does not certify a package.
Scene coordinates and label left edges stay independent of the account's text
direction. Full player names wrap without truncating identity.

The host provides zoom/reset controls, two-finger pinch/spread and **25%–600%**
camera zoom. On the web, ordinary wheel scrolling reaches the page's board and
controls; hold Ctrl or Meta while using the wheel to zoom. At the fitted view,
dragging empty space scrolls the page. After zooming, background dragging pans
the bounded camera. Keyboard users can focus the board and use `+`/`-` to zoom,
`0` or Home to restore the fitted view, and arrow keys to pan.
Camera state survives scene changes, replay, viewport resizing and language
changes, and resets when the host opens a different match or viewer.
Camera gestures stay in the host and never emit `make_move`; two fingers cancel
an unfinished piece gesture. Audit actual object sizes, clipping, complete reach
and input guards at every required viewport and zoom level.

For compact boards that already fit well, declare
`"viewport": {"width": 800, "height": 600, "camera_enabled": false}`.
This disables pinch/spread, mouse-wheel zoom, background pan and keyboard
camera shortcuts. Automatic fitting and responsive resizing still apply, and
ordinary piece taps and drags continue to work. Multiple fingers cancel an
unfinished piece gesture without zooming, panning or submitting a move.

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
| Offer a click, rotation, flip or resize | Set the piece's `actions` to the currently available operations; the host supplies persistent hints and action controls. |
| Change a die, score or card text | Change the piece's `text` or the relevant label. A `dice` appearance does not generate random results. |
| Group a polyomino or composite token | Compute positions/rotations for several stable pieces in the reducer. V1 has no implicit group transform; see [Rotation, flipping and placement previews](#rotation-flipping-and-placement-previews). |

Each piece requires `id`, `type`, `board` and `position`. It can override its
type's front artwork with an `asset` ID. A piece type can declare `back_asset`
for its reverse side. With `face:"back"`, the renderer shows only that back
asset or a generic back when none is supplied; it suppresses front artwork,
front text and front-derived accessibility labels. Destinations require `id`, `board` and
`position`, and can have a visible label. `move_targets` is a UI affordance,
not server permission; `applyMove` must independently reject illegal moves.

Piece types can declare `action_outline:"ellipse"` for round counters or
`action_outline:"none"` for artwork already styled as a button. The default is
`rect`; accessible roles and declared actions stay available in every case.

Targets may declare an `asset` for an inert destination marker. Hosts fit it
inside `hit_area` when supplied, otherwise the ordinary marker bounds. The
plain-text label remains the accessible name. Missing asset references are rejected.

Targets may declare `hit_area:{x,y,width,height}` in logical units relative to
their center. Both offsets and positive dimensions are required; coordinates
use the same ±100000 bounds as positions and dimensions are at most 100000.
The rectangle changes tap and legal-drop hit testing while the target's visible
marker stays at its declared position. This lets a Backgammon point accept a
checker anywhere along its triangle. It does not make an unavailable target
legal or change a piece's movement permissions. Omit it for the default marker
hit area; it is not a piece property.

Pieces can attach `animation:{kind:"roll",key:"turn-12"}` to identify a visual
roll event. Both fields are required when the object is present. Optional
`duration_ms` and `delay_ms` are integer milliseconds from 0 to 5000.
`kind:"move"` can provide those timings for a physical position transition.
`kind:"notice"` shows a temporary text or artwork announcement for its duration
after its delay; it blocks the next action until it finishes. Notices stay hidden
on initial mounting and when reduced motion is enabled. The key uses the same 1–80 character identifier alphabet
as piece IDs. Keep it stable while showing the same roll, including subsequent
spent-die shading, so polling does not restart the effect. A new accepted roll
gets a new key. The host chooses the brief visual effect and can suppress it
for initial mounting, history or reduced-motion settings. This metadata neither
changes the final die value nor grants an action, changes the board camera, or
controls authoritative randomness. It carries no executable code.

Packages may set `motion:{move_ms,roll_ms,roll_settle_ms,turn_pause_ms,animate_own,easing}`.
Each timing is an integer from 0 to 5000 milliseconds; `easing` is `ease-out` or
`ease-in-out-quad`. Omitted timings retain host defaults. `animate_own` remains
accepted for compatibility and is ignored during live play: moves made on this
device, including pass and play, update immediately. `roll_settle_ms` keeps an opponent's roll
readable before accepting another action. `turn_pause_ms` adds a pause after a
turn change. Reduced motion and initial/reconnect snapshots bypass these delays.
Hosts preserve each viewer-filtered accepted action when a computer finishes
several steps between updates, and wait for its animations before drawing the
next. Per-piece `kind:"move"` duration/delay can stagger a capture or shorten
bearing off. These options never change server move legality or randomness.

Pieces and destinations can supply `aria_label` independently of their visible
`text` or `label`. Use a descriptive localized name containing the owner and
location where appropriate, such as “Alice’s counter at A1”, while keeping the
drawn counter text short. The field is plain text of 1–4000 Unicode characters;
it never draws text into the scene or changes an event ID. Render it from the
current `state_changed.strings` just like other translated content. Without it,
the host keeps the existing visible-text/ID fallback. A face-down piece always
uses the host's generic covered-piece name, ignoring both front text and
`aria_label`; omit hidden pieces and never put private facts into public scenes.
Accessible names remain available in waiting, spectator and history views even
when gameplay inputs are disabled. They also name host-owned manipulation tools.

### Always show available actions

Hosts must keep the next available actions visible. An active piece is
highlighted and its action indicators identify whether it can be tapped,
moved, rotated, flipped or scaled; enabled scene controls and placement targets remain
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

`actions` is a unique subset of `tap`, `move`, `rotate`, `flip` and `scale`. Declaring
`move` requires at least one `move_targets` destination, and every referenced
destination must exist in the scene. Nonempty `move_targets` always implies
movement, even when the action list does not explicitly name `move`.
`actions:[]` disables tap/rotate/flip/scale; combine it with no movement targets for
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
{"type":"flip","id":"piece-id"}
{"type":"scale","id":"piece-id","factor":1.1}
```

Movement supports drag/drop and tap-a-piece, then tap a destination. Handle
`drop` to translate the selected piece and destination into the game's move
shape. Handle `tap` for placements, selection and buttons. Targets are explicit
so touch and keyboard clients can offer equivalent actions.

For `rotate`, `delta` requests a relative clockwise angle in degrees; it must
be nonzero and between -360 and 360. The standard rotate controls request 90
(clockwise) and -90 (counterclockwise) degrees. `flip` requests a mirror image
of the piece and has no parameters; the reducer decides the mirror axis. For `scale`, `factor` is a relative multiplier greater than zero and
at most 100; standard grow/shrink controls request `1.1` and `1/1.1`.
These parameters belong only to their corresponding event types. A rotation,
flip or scale control sends a request to the reducer, and never edits match state
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

### Rotation, flipping and placement previews

Tiles, dominoes and polyominoes use the same building blocks:

- **Rotate and flip.** Add `rotate` and/or `flip` to the piece's `actions`.
  When the viewer selects the piece, the host shows ↺ (counterclockwise, -90),
  ↻ (clockwise, 90) and ⇋ (flip) buttons of at least 44×44 pixels. Keyboard
  users press R, Shift+R and F on the selected piece. Each sends the event
  above; the reducer keeps the orientation in `local_state` and redraws.
- **Composite pieces.** Draw each cell of a polyomino or domino as its own
  stable piece. Give every cell the same `actions` and `move_targets`, mark all
  of them `selected` together, and map any cell ID back to its shape in the
  reducer. Rotating or flipping only changes the cells' computed positions.
- **Legal placements.** For the current orientation, emit one target per legal
  placement, usually at the cell under the shape's anchor, and list those IDs
  in the pieces' `move_targets`. Illegal placements are simply absent.
- **Placement previews.** A target may carry `preview`: up to 64 ghost cells on
  the target's board, each with a `position` and optional `color`, `asset`,
  `rotation` and short `text`. The host draws them translucently while the
  destination is hovered, keyboard-focused or dragged over. On touch screens,
  which have no hover, the first tap on a destination with a preview shows the
  ghost and the second tap on the same spot places the piece; a drag places it
  on release. Previews are presentation only; `applyMove` still validates.

```json
{
  "id": "place-r3-c4",
  "board": "board",
  "position": {"cell": "28"},
  "preview": [{"position": {"cell": "28"}, "color": "#4f8cff"},
              {"position": {"cell": "29"}, "color": "#4f8cff"},
              {"position": {"cell": "36"}, "color": "#4f8cff"}]
}
```

A move that needs several choices, such as placing a marble and then twisting
a board quadrant, uses ordinary targets for each step and keeps the earlier
choices in `local_state` until the final event emits `make_move`.

## Assets and hidden information

An asset descriptor looks like:

```json
{
  "pawn": {
    "uri": "data:image/png;base64,...",
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
bytes; SVG must meet the platform's inert SVG image rules. External image URLs
are rejected: selecting remote artwork based on a private hand would disclose
that hand through image requests. Existing external artwork is not loaded by
the renderer; embed the image bytes in the package to restore it. The reducer
refers to asset IDs, never loads a URL itself. Hosts decode the included images
for native and offline play. Asset dimensions are metadata; piece dimensions
control display.

For an illustrated card, reference both asset IDs from its piece type:

```json
{"shape":"card","width":70,"height":100,"asset":"card-front","back_asset":"card-back"}
```

`viewFor` is the secrecy boundary. Do not include an opponent's hand, identity
or hidden board arrangement in their state message, local state, labels or
asset names. `hidden` and `face:"back"` only control appearance; they cannot
protect information already sent to the device. Render only the viewer's
filtered state, including when building spectator scenes and replay.

## Lines, points and shapes as flexible targets

A target is any destination the reducer offers, so it need not be a grid
square. Five packages use targets for geometry that is not a cell, and show the
patterns to copy:

| Game | Target is | Pattern |
| --- | --- | --- |
| `sim` | one of fifteen lines between six dots | Lines cross at the hexagon's centre, so each marker sits at its own spot along its line (`sim_t`, found by search so markers stay at least 60 units apart) and crossing lines never share a hit box. Claimed lines are `paths`. |
| `paper_soccer` | a reachable point on a graph board | Legal destinations are the free neighbours of the ball; the move adds a drawn line, so repeated lines and the pitch's walls are simply absent. The ball's trail is drawn as `paths`. |
| `hackenbush` | one branch of your own colour | Each marker sits at the branch midpoint. A cut removes everything no longer attached to the ground, so the next scene omits those branches. |
| `dots_boxes` | one of forty sides between a five by five grid of dots | A marker sits at each side's midpoint, and closing a box fills it with a piece and keeps the turn. Drawn sides are `paths`. |
| `cartographers` | the anchor cell of a shape placement | Rotate/flip is a button that keeps the orientation in `local_state`; every legal anchor for that orientation is a target carrying a `preview` of the covered cells. |

Keep target IDs distinct from path and piece IDs (a line's path and its target
cannot both be `edge_3`). Give crowded markers an explicit `hit_area` no larger
than the spacing between them. A turn-based adaptation of a drawing game is a
documented change: these packages offer only predefined lines, points and
placements, never freehand strokes.

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

Complete the recorded test flow for the exact final payload through the
`/game-test/*` REST endpoints. The removed HTML authoring page is no longer
available. `tools/publish_declarative_games.py` records and verifies complete
traces before submission; the scene playground supports visual review.
Submit the resulting complete package to `POST /games/declarative`:

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
declarative package; `/games` accepts the same declarative form; HTML submissions
are rejected. Platform ownership, secret authorization, translations in all
supported languages,
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

The portal also has a narrowly reviewed visual repair for the original
Backgammon presentation. It requires the exact published game ID, original
package fingerprint and authoritative rules fingerprint before loading the
corrected dice presentation. The stored game/version, rules, move schemas,
history and cached game package stay unchanged. A missing or invalid repair
asset leaves the original presentation in place. New publications use the
complete updated package through the ordinary import flow below.

Update game content only through `PATCH /games/{id}`. Include the game secret
or configured master password in `game_addition_request_id_and_secret`; user
account credentials do not authorize game changes. All content fields are
optional, and omitted fields retain their current values. Presentation changes require recorded tests
for the complete resulting package; server-code, unit-test and mechanical-rule
changes run server checks and random walks. Text, images and other metadata
edits use the relevant lightweight checks. The resulting presentation, tests
and runtime schemas are stored together as a new version when content changes.
The two POST publication routes create games only and reject existing secrets.
See [the partial-update contract](agent-game-import.md#updating-a-game).

## Native host checklist

1. Fetch the pinned game detail and reject unsupported format/version. Validate
   the package, image types, IDs, scene references and resource limits.
2. Load the UI source into a bounded QuickJS context without platform bindings.
   Recreate the context for each reduction and pass only message/local-state
   JSON. Keep match rules on the authoritative server for online play.
3. On `state_changed`, call `gameUI.reduce(message, localState)` and render its
   complete scene with native views/layers. Save only the returned local state.
   If present, call `gameUI.getLastMoveAnimations(view, scene)` in the same
   bounded context and validate its ordered paths against the final scene.
   Animate declared paths only for known opponent moves, as described above.
4. Translate taps, destination selections, drags, control changes and the
   rotate/flip tools (R, Shift+R and F on the keyboard) to the event shapes
   above. Draw target `preview` cells while a destination is hovered, focused
   or dragged over; on touch, arm a previewed destination on the first tap and
   place on the second. Call the reducer with the current filtered state message.
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

## Twenty-one complete examples

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
| `battleship.json` | Hidden fleets, setup and legal shot targets. |
| `checkers.json` | Mandatory captures, king movement, and multi-jump turns. |
| `chess.json` | Legal moves, promotion, and resignation. |
| `four_player_chess.json` | A cross-shaped board, four seat colors, and legal moves. |
| `quoridor.json` | Switching between pawn movement and legal wall placement. |
| `crazy_eights.json` | Playable hand cards, drawing, and choosing a suit for an eight. |
| `go_fish.json` | Hidden hands, rank requests, drawing, and completed books. |
| `hearts.json` | Legal card choices, trick display, and score totals. |
| `spades.json` | Card play, follow-suit choices, and collecting completed tricks. |
| `guess_who.json` | Private character, yes/no question choices, and identity guesses. |

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

The ten HTML conversions use `html_conversions_ui.js` and
`locales/html_conversions.json` for presentation and all seven translations.
Their checked-in packages retain the authoritative rules and schemas, so
regeneration needs no private legacy export. The generator records opening,
intermediate and finishing moves from real matches. Checkers and both chess
variants select a source piece before a destination, keeping moves to the same
square individually reachable. Guess Who portraits and accessible descriptions
show the public character features used by its questions. Spades retains this
edition's original rule allowing any card, without a follow-suit restriction.

With the checkout importable as `game_platform` and dependencies installed:

```sh
python -m game_platform.tools.build_declarative_examples
python -m game_platform.tools.build_declarative_backgammon
python -m game_platform.tools.build_edge_games
node tools/build_html_declarative_conversions.mjs
python -m game_platform.tools.declarative_demo --port 8134
```

Open `http://127.0.0.1:8134/portal` to play the included games in an isolated,
ephemeral local platform. This runner uses no production data. Its fixtures
support local development and do not substitute for the publication gate.
The scene playground can load the same examples from
`GET /games/declarative/examples` and
`GET /games/declarative/examples/{kind}`.

The checked-in examples contain **public example submission secrets**. Replace
the secret with a new private value before beginning a real publication test
flow, then keep that value and the returned game ID for PATCH updates.

For reviewed packages, `tools/publish_declarative_games.py` runs the ordinary
authoring APIs, server checks and verified rules/UI protocol playthroughs,
then creates through `POST /games/declarative` or updates the saved game ID
through `PATCH /games/{id}`. It does not bypass the five-step
gate or create player accounts/matches. Its private state file must be outside
the checkout; keep it to update the same records instead of creating duplicates.
Protocol playthroughs do not verify pixel layout or touch gestures. Review the
live portal after publication for visual and touch behavior.

```sh
python -m game_platform.tools.publish_declarative_games \
  --base-url https://buildplay.fun \
  --state-file ~/.local/state/buildplay/html-conversion-publication.json \
  --report ~/.local/state/buildplay/html-conversion-report.json \
  --kinds battleship checkers chess four_player_chess quoridor crazy_eights go_fish hearts spades guess_who
```

See [the validation record](declarative-validation.md) for the portal playthrough
and test environment's limits.
