# Flipside Lords (based on The Duke)

A declarative edition of The Duke (Catalyst Game Labs, 2013) for 2 players,
with an original name, emblems, artwork and text. Built by
`tools/build_declarative_flipside.py` from `flipside.server.js` (rules) and
`flipside.ui.js` (presentation).

## Rules

Source: the official rulebook (Catalyst Game Labs, 2013;
<https://cs.uwaterloo.ca/~dtompkin/archive/dtlib/base/The%20Duke.pdf>).

- 6×6 board. Each player has a bag of troop tiles: the Duke (here "Lord"),
  3 Footmen, 3 Pikemen, and one each of Knight, Wizard, Ranger, Seer, General,
  Priest, Champion, Marshall and Bowman.
- Setup: the first player puts the Lord on one of the two middle squares of
  their home row and two Footmen on squares sharing a side with it; then the
  second player. The first player moves first.
- A turn is either: move one tile with an icon of its current side, or draw a
  random tile from your bag and place it, starting side up, on an empty square
  sharing a side with your Lord. No passing.
- Icons: Move (straight path must be clear), Jump (ignores tiles between),
  Slide (any distance in a direction until blocked), Strike (capture without
  moving), Command (move one of your tiles between two command squares). The
  tile that used an icon flips; a commanded tile does not.
- You may never leave your Lord where the opponent could capture it next turn.
- Win: capture the enemy Lord. Because a move that leaves your own Lord
  capturable is illegal, games end when a player has no safe move (their Lord is
  trapped, or rarely when they are stuck without being threatened): that player
  loses.
- Our additions (not in the rulebook, needed so every game ends): 50 turns in a
  row without a capture or a new troop is a draw. Terrain tiles and the
  alternate objectives are optional rules and are not used.
- Tiles always face their owner (the opponent's tiles are drawn turned around);
  all state is public (bags are drawn from at random).

### Tile data

The rulebook shows the movement grids only as pictures (pp. 12–13). The 12
base tiles were taken from the open-source DukeOnline project
(`ReeseLloyd/DukeOnline`, `public/js/tiles.js`) and checked against a second
independent implementation: 11 tiles match `gatoflaco/The-Duke-Board-Game`
(`data/tiles/movements.json`) exactly, and the Ranger (missing there) matches
`zjbthomas/DukeChess` (`Ranger.json`). The tests check key tiles and the bag.

## Computer player

One move ahead with the opponent's best capture as the reply: it takes or
traps the Lord when it can, never leaves pieces hanging needlessly, prefers safe
captures, draws troops early, and presses toward the enemy Lord. About 10 ms a
move; it beats random play in nearly every game.

## Presentation

Reference for look and feel: DukeOnline (the open-source browser version with a
computer opponent and hotseat play; studied from its design notes and tile
renderer, as no hosted copy is public). Ideas taken, in our own design: the
movement grid printed on every tile, highlighted destinations after selecting a
tile, and a clear "draw a troop" action.

- Every tile shows its 5×5 grid with icons (dot: move, ring: jump, triangle:
  slide, red star: strike, blue corners: command), an original emblem for its
  type, and a corner mark on its starting side.
- Tap one of your tiles: green rings show moves, red rings captures, red stars
  strikes, blue diamonds command sources and then destinations. "Draw a troop"
  (a 220×68 button) shows the squares beside your Lord.
- Select a tile and use the host's flip tool (or F) to preview its other side,
  as the physical rules allow; it does not change the game.
- The board is drawn from the viewer's side. The last move is outlined, a
  threatened Lord gets a red frame, and at the end the trapped Lord is framed
  and the status names the winner and why.

## Tests

- `tests/test_declarative_flipside.py`: import validation and size limits, tile
  data, setup, each icon (move path, jump, slide, strike, command), the flip
  rule, the Lord-danger rule, drawing troops, the end, random walks (count
  based), computer strength and speed, the presentation (setup, targets, flip
  preview, draw with a tile selected, waiting player, end screen) and all eight
  languages.
- `frontends/portal/e2e/flipside.spec.ts`: a full game against the computer in
  the real portal on desktop and phone, including a flip preview.
