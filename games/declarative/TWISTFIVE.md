# Twist Five (based on Pentago)

A declarative edition of Pentago, the 6×6 game of four turning 3×3 plates,
with original name, artwork and text. Built by `tools/build_declarative_twistfive.py`
from `twistfive.server.js` (rules), `twistfive.ui.js` (presentation) and
the state, move and view contracts kept in the builder.

## Rules

Source: the Pentago rules as summarized on
[Wikipedia](https://en.wikipedia.org/wiki/Pentago), matching the official rules.

- Players alternate; Gold (seat 1) moves first. A turn places one marble in an
  empty hole, then turns any one plate 90° clockwise or counterclockwise.
- Five of a player's marbles in a row, column or diagonal win. A five made by
  the placement wins at once and the turn has no twist (`{cell}` move);
  otherwise the twist is required (`{cell, quadrant, direction}` move).
- If a twist completes five for both players, the game is a draw. A full board
  without five is a draw. A twist that completes only the opponent's five makes
  the opponent win.
- The official rules let a player skip the twist only while some plate is
  rotationally symmetric. Turning such a plate changes nothing, so requiring a
  twist on every non-winning turn gives exactly the same set of positions.

The server rejects every other move: out of turn, taken or invalid holes,
invalid plates or directions, a twist after a placement five, a missing twist,
and any move after the end.

## Computer player

`computerMove` takes an immediate win, then scores every move by line
potential. For the best 48 it counts threats with a fast exact test: placing
then turning equals turning then placing on the matching empty hole, so a
player can win next turn exactly when, on the board as it is or after one of the
eight turns, a line holds four of their marbles and one empty hole. It never
leaves the opponent such a win when it can avoid it, prefers moves that create
two or more threats, and blocks open threes. Worst case about 20 ms (limit
100 ms). It beats random play in every test game.

## Presentation

Reference for look and feel: [perfect-pentago.net](https://perfect-pentago.net/),
Geoffrey Irving's interactive Pentago solver. Ideas taken, in our own design:
one-tap turn arrows around the board's outer corners, and plates that turn as
rigid units with their marbles. (The other sites found were offline or bare.)

- Place: every empty hole is a highlighted target. A winning hole submits at once.
- Turn: eight arrow targets (↻ beyond the top/bottom edge, ↺ beside it), 76
  logical units wide so they stay at least 44 px on an iPhone in portrait. Each
  carries a `preview` of where the plate's marbles land. While turning, a clear
  handle above each plate also offers the host rotate tools (↺ ↻, R / Shift+R);
  every arrow stays a legal destination while a plate is selected.
- Rigid turns: each marble is drawn as a transparent plate-sized picture with
  the marble at its unturned slot, centred on its plate and carrying the
  plate's accumulated angle. A turn changes only that angle, so the renderer
  animates the plate and its marbles as one piece.
- A dashed ring marks the last marble placed; at the end the five winning
  marbles get bright rings (paths draw below pieces) and the status names the
  winner.
- Every SVG gradient id is unique across the pictures: the host inlines them
  into one page, where a repeated id makes the first definition win.
- No object is smaller than the holes: the host enlarges the canvas until its
  smallest object reaches 32 px, so a tiny decoration would force scrolling.

## Tests

- `tests/test_declarative_twistfive.py`: full import validation, 200 seeded
  random walks with fuzzed inputs, rule cases, rejected moves, computer
  strength and speed, presentation (targets, previews, tools, rigid-turn
  mapping, spectators, end screen) and all eight languages.
- `tests/test_publish_declarative_games.py`: a full match through offered UI
  events and authoritative replay.
- `frontends/portal/e2e/twistfive.spec.ts`: a full practice match against the
  computer in the real portal, on desktop and phone, including a plate turned
  with the rotate tool and the turn arrows.
