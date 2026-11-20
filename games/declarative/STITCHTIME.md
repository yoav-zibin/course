# Stitch & Time (based on Patchwork)

A declarative edition of Patchwork (Uwe Rosenberg, Lookout Games, 2014) for 2
players, with an original name, fabrics, artwork and text. Built by
`tools/build_declarative_stitchtime.py` from `stitchtime.server.js` (rules)
and `stitchtime.ui.js` (presentation).

## Rules

Source: the official rulebook (Lookout Games; English copy at
<https://lot.ahml.info/Patchwork.pdf>, checked against the 10th-anniversary
English rules at <https://www.lookout-spiele.de/upload/en_patchworkanniversary.html_PW10_Rules_EN_web.pdf>).

- Each player has a 9×9 quilt, a time token and 5 buttons. The 33 patches lie
  in a circle in random order; the neutral token sits after the 1×2 patch.
- The player whose time token is furthest behind moves (so turns may repeat);
  on the same space the token on top (the last to arrive) moves first.
- A turn: (A) advance to the space just past the rival and take 1 button per
  space moved; or (B) buy one of the next three patches after the neutral
  token: the token moves to its place, pay its buttons, place it on the quilt
  (any rotation or mirror, no overlap) and move ahead by its time.
- Moving onto or past an income space pays the buttons shown on your patches;
  the first to move onto or past a leather space takes a 1×1 patch and places
  it at once. The first to fill a 7×7 square gets the 7-point special tile.
- The game ends when both tokens reach the last space (53); a token never
  moves past it. Score: buttons + 7 (special tile) − 2 per empty square. On a
  tie, the player who reached the last space first wins.

### Patch and track data

The rulebook shows patches only as pictures. The 33 patches (shape, button
cost, time, income) are identical in two independent open-source
implementations: `danzel/PatchworkSim` (`PieceDefinition.cs`) and
`mVilayvanh/Patchwork` (`patches.data`); `PineappleZero/patchwork-online`
agrees as well (plus the 1×1 leather patch). Totals: 133 buttons, 107 time,
38 income, 166 squares. The time track (53 spaces, income at 5, 11, 17, 23, 29,
35, 41, 47, 53, leather at 20, 26, 32, 44, 50) agrees in `PatchworkSim` and
`patchwork-online`. The tests check these totals.

## Computer player

It values each affordable patch by squares covered (each worth 2 at the end),
future income, price and time, plus how snugly its best placement fits
(touching walls and patches, avoiding single holes), and compares that with
advancing for buttons. About 40 ms a move at most; it beats random play in
nearly every game.

## Presentation

Reference for look and feel: patchwork-online (`PineappleZero/patchwork-online`,
the open-source browser version with a computer opponent; studied from its
code and README, as no hosted copy is public). Ideas taken, in our own design:
the next three patches as large cards with price, time and income, the time
track with income and leather marks, and placing with a ghost preview.

- Patches are drawn square by square in original fabrics, with buttons on
  their income squares, so any turn or mirror needs no extra pictures (the
  platform limits the number and size of pictures).
- Tap a card: a ghost appears on your quilt in a good spot. Tap a square to
  move it, ↺ ↻ to turn and ⇋ to mirror (72-unit buttons); if a turn makes it
  not fit, it hops to the nearest spot that does. Or select the spool and use
  the host's rotate and flip tools (R, Shift+R, F). ✓ places it.
- "Advance (+N buttons)" is one big button with its words inside. Leather
  patches: every empty square is offered. "Rival's quilt" shows the other quilt.
- The end shows the winner and each player's score breakdown.

## Tests

- `tests/test_declarative_stitchtime.py`: import validation and size limits,
  patch data totals, setup, turn order, advancing, buying (only the next three,
  price, fit, circle), income and leather, the 7×7 bonus, scoring and the
  tie-break, random walks, computer strength and speed, the presentation
  (ghost, turning, mirroring, advancing, leather, waiting, end screen) and all
  eight languages.
- `frontends/portal/e2e/stitchtime.spec.ts`: a full game against the computer
  in the real portal on desktop and phone, turning patches with the host's
  rotate tool and the ↺ ⇋ buttons.
