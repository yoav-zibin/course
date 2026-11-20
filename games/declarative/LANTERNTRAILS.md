# Lantern Trails (based on Tsuro)

A declarative edition of Tsuro, the path-tile game for 2 to 8 players, with an
original name, theme (paper lanterns on a night river), artwork and text. Built
by `tools/build_declarative_lanterntrails.py` from `lanterntrails.server.js`
(rules) and `lanterntrails.ui.js` (presentation); the state, move and view
contracts are kept in the builder.

## Rules

Sources: the 2009 Calliope Games rulebook (Compound Fun, LLC), including its
FAQ, as distributed with the official digital edition
(<https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1397470/manuals/Tsuro_Rulebook.pdf>),
cross-checked with [Wikipedia](https://en.wikipedia.org/wiki/Tsuro) and
[UltraBoardGames](https://www.ultraboardgames.com/tsuro/game-rules.php).

- 6×6 board, 35 tiles, a Dragon tile. Each tile joins its 8 edge points (two
  per side) in 4 pairs, and the 35 tiles are every such pairing up to rotation,
  each once ("each tile is unique"; 105 pairings / rotations = 35, OEIS A132100).
  The server derives the set and the tests check it.
- Setup: 3 tiles each, the rest is the face-down pile. In seat order, each
  player puts a lantern on a free gate (start mark) at the edge: 48 gates.
- Turn: lay a tile from your hand, in any of the four turns, on the square in
  front of your lantern. Your lantern, then every other lantern next to the new
  tile, follows its channel to the end, across earlier tiles. Then draw.
- A lantern reaching the edge is out. Two lanterns whose paths meet are both
  out (FAQ). Out players' hands are shuffled into the pile.
- You may not send your own lantern to the edge unless every tile and turn in
  your hand would. (The rulebook bans "connecting your own path to the edge";
  meeting another lantern is not banned, so a collision stays legal.)
- Drawing: in a 2-player game only the active player draws. With 3 or more,
  starting with the active player and going clockwise, everyone below 3 tiles
  draws until all have 3 or the pile is empty. A player who must draw from an
  empty pile takes the Dragon; when tiles come back, the Dragon holder draws
  first and sets it aside. An out Dragon holder passes it clockwise to the next
  player below 3 tiles.
- End: the last lantern on the board wins. If the remaining lanterns go out on
  the same move, they share the win (FAQ). If every tile has been played (no
  one still in holds a tile) the remaining lanterns share the win (FAQ).
- Choices: seat 1 starts (the rulebook says the oldest player). The optional
  "elimination bonus" and "pass the pile" advanced rules are not used. A player
  with no tiles while others still hold some (possible only after the pile runs
  dry with 3 or more players) passes; the rulebook does not cover it.

The server rejects everything else: gates out of range or taken, tiles before
every lantern is placed, tiles not in the hand, bad turns, a self-elimination
that could be avoided, out-of-turn moves, and any move after the end. Hands and
the pile order are private (`all_state_public: false`): a view shows only the
viewer's own hand plus everyone's tile counts.

## Computer player

`computerMove` picks gates far from other lanterns and away from corners. For
tiles it tries every tile and turn in hand and scores: survival (huge), rivals
sent out, whether its next tiles still have a safe turn from the new square,
how many unseen tiles would be safe there (the chance of surviving the next
draw), distance from the edge, sharing a square with a rival (that rival would
decide its fate), and, in small games, how few safe tiles the rivals keep. It
only uses its own hand and the tiles it can see. About 5 ms per move with 8
lanterns (limit 100 ms); it outlasts random play in two thirds or more of games.

## Presentation

Reference for look and feel: the official digital edition, *Tsuro – The Game
of the Path* (Thunderbox Entertainment, App Store / Steam), studied from its
store pages and screenshots; no free web version with a computer opponent
exists. Ideas taken, in our own design: a calm night board, each player's path
glowing in their colour, the tile in hand previewed on the board before it is
placed, and lanterns gliding along their paths.

- Start: every edge square with a free gate is a target. Tap one, then pick one
  of its gates on the empty board (112-unit pickers, about 73 px on an iPhone);
  ghost lanterns numbered 1–4 show where each gate is.
- Play: the hand sits in a tray under the board. The selected tile is shown as
  a ghost on the square in front of your lantern, with your route dashed in
  gold. Turn it with the big ↺ ↻ buttons, the host's rotate tools, or R /
  Shift+R; drag a tile to the square or tap the square or "Place tile". A turn
  that would leave the board shows a faded route and a red ✕, offers no
  destination, and the hint says why (or that every choice is fatal).
- Every lantern's trail is drawn in its colour; lanterns animate to their new
  spot; the last tile laid is outlined. Out lanterns fade with ✕; winners get a
  ring and the status names them. A roster shows each player's lantern, tiles in
  hand and the Dragon.
- Platform limits shape the art: at most 128 pictures (trail pictures are 8
  shape classes rotated into place, 126 in all), 400 KB for package metadata,
  and unique SVG ids (the host inlines every picture into one page).

## Tests

- `tests/test_declarative_lanterntrails.py`: import validation and size limits,
  the 35-tile set, seeded random walks with fuzzed input for 2, 3, 5 and 8
  players, walk invariants (tile conservation, hands, Dragon), each rule above
  (gates, refused moves, self-elimination ban and forced case, collisions,
  pushing rivals out, chained moves, Dragon draw order, all tiles played),
  payouts, private views, the computer's strength and speed, and the
  presentation (start pickers, rotation, preview, place, drag, waiting players,
  end screen) in all eight languages.
- `frontends/portal/e2e/lanterntrails.spec.ts`: a full practice game against the
  computer in the real portal on desktop and phone, turning tiles with the
  host's rotate tool and the tray buttons.
