# Crownfields (based on Kingdomino)

A declarative edition of Kingdomino for 2 to 4 players, with an original name,
terrain names, artwork and text. Built by `tools/build_declarative_crownfields.py`
from `crownfields.server.js` (rules) and `crownfields.ui.js` (presentation); the
state, move and view contracts are kept in the builder.

## Rules

Source: the official 2016 Blue Orange rulebook
(<https://cs.uwaterloo.ca/~dtompkin/archive/dtlib/base/Kingdomino.pdf>), checked
against the 2024 edition (<https://blueorangegames.eu/wp-content/uploads/2025/01/Kingdomino-V2-rules-UK.pdf>).

- 48 two-square tiles, numbered; each player has a keep (start tile).
  2 players: two kings each, 24 tiles (24 removed at random). 3 players: 36.
  4 players: 48.
- Setup: a row of as many tiles as kings is drawn and shown in ascending order.
  Kings choose in a random order.
- Each round, kings act in row order (lowest number first): lay the tile your
  king stands on, then put the king on a tile of the new row. The last round
  only lays. 12 rounds (6 with 2 players, who act twice per round).
- A tile must touch the keep (any terrain) or the same terrain with at least
  one half, side by side; the realm, keep included, must fit in a 5×5 square.
  A tile that fits nowhere is discarded; one that fits must be laid.
- Score: each group of same-terrain squares joined side by side scores its
  size × its crowns. Highest total wins; ties go to the largest group, then the
  most crowns, then the win is shared.
- Not used: the optional Dynasty, Middle Kingdom, Harmony and Mighty Duel rules.

### Tile data

The 48 tiles (terrain and crowns of each half, by number) are in
`crownfields.server.js`. Two independent open-source implementations agree on
every tile: `weinJustin/KingDomino-WEB` (`Dominos.json`) and
`YuheBAI/KingDomino` (`dominos.csv`), and the totals match the published
counts: 26 wheat, 22 forest, 18 lake, 14 meadow, 10 marsh and 6 mine squares,
with 5, 6, 6, 6, 6 and 10 crowns. The tests check these totals.

## Computer player

It lays each tile where it maximizes a realm value: the current score, plus
room to grow next to crowned or large groups, minus squares that can never be
filled. It picks the tile with the best gain for its realm, slightly preferring
low numbers (earlier turns next round). About 15 ms a move; it beats random play
in nearly every game.

## Presentation

Reference for look and feel: the official Kingdomino app (Blue Orange, App
Store / Google Play), which offers bots; no free web version with a computer
exists. Ideas taken, in our own design: the "now" and "next" rows with kings on
them, a big realm board with the 5×5 limit visible, and live scores.

- Layout (600 × 730 units, one layout for every screen, since the portal does
  not tell a game the screen size): the status line; a compact draft (Now /
  Next rows); your kingdom (46-unit squares) with its title, colour and score;
  every other kingdom beside it, smaller (34 units, 21 with three opponents),
  with name, colour and score, drawn with flat squares and large crowns so it
  reads on a phone; a toolbar with your tile and big ↺ ✓ ↻ buttons (72 units).
  On an iPhone in portrait and on desktop, everything fits on screen at once.
- Your seat says "(you)" everywhere a player is named (status, kingdom title,
  king markers, end screen), e.g. "Jade · Marcelle (you)".
- Pick: tap a tile in the Next row (a ghost king marks it), then tap again or
  press Take tile, so a stray tap never commits.
- Lay: every square where the tile's first half can go glows. Tap one: the tile
  appears there with a green (fits) or red (does not fit) frame. Turn it with
  ↺ ↻, or select your tile in the toolbar and use the host's rotate tools or R /
  Shift+R; then ✓ or Lay tile. If nothing fits, Discard tile is offered. The
  tile you are laying shows faded in the Now row: it lives on the realm.
- Squares are drawn upright, one picture per terrain and crown count, so crowns
  and numbers never turn; turning only moves the two squares.
- The yellow outline shows the 5×5 window still reachable. Each opponent's
  most recent tile has a white outline on their small kingdom until they lay
  their next one (the portal cannot fade a highlight on a timer).
- End: the draft disappears; every kingdom is cropped to its used 5×5 area and
  shown side by side (2×2 for 3–4 players), each with its full score
  breakdown (every crowned group, "lake 3×3 = 9", then total and discards)
  below it, so nothing covers the art; the block is centred in the board. The portal's own Play
  again button starts a new game.
- SVG pictures use no ids (the host inlines every picture into one page).

## Tests

- `tests/test_declarative_crownfields.py`: import validation and size limits,
  tile data totals, setup counts, row order, 12 tiles per player, the touch
  and 5×5 rules, must-lay and discard, scoring and every tie-break (checked
  against an independent scorer), private pile, refused moves, payouts,
  computer strength and speed, random walks for 2, 3 and 4 players, and the
  presentation (pick confirm, lay preview, turning, discard, roster, end
  screen) in all eight languages.
- `frontends/portal/e2e/crownfields.spec.ts`: a full practice game against the
  computer in the real portal on desktop and phone, turning tiles with the
  host's rotate tool and the ↺ ↻ buttons.
