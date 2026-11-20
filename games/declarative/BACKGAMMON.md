# Backgammon (Declarative)

The interface and game flow follow [247 Backgammon](https://www.247backgammon.org/)
for computer and same-device Pass & Play. [Reference observations and timing
verification](../../docs/backgammon-reference.md) distinguish live measurements,
inspected runtime timings and local regression checks. All included artwork is
authored SVG, and rules and presentation run as pure JavaScript in QuickJS.

The base checker authority, `backgammon.server.js`, remains byte-for-byte the
original platform Backgammon version 4, SHA-256
`0206fffd96b1447a457f63431d013c6de5d5337dfc40285157304a95204b3c4e`.
The package appends three reviewed layers:

- `backgammon-roll-history.js` records the accepted dice without extra draws.
- `backgammon-combined-moves.js` offers server-checked multi-die destinations
  only when all permitted routes have the same complete result. Ambiguous
  intermediate hits remain separate moves.
- `backgammon-opening-undo.js` adds match options, one opening die per player,
  ties, reversible moves within the unfinished turn, cube offers/responses,
  four computer levels, gammon/backgammon scores and subsequent games until
  the selected match goal. The cube changes match points; token-pot payouts
  occur once at the match end.

Modern matches end by bearing off or dropping a cube. They do not inherit the
old casual authority's arbitrary action/turn cutoff. Legacy states without the
modern metadata preserve their original rules, computer behavior and cutoff.
All dice, legal moves, undo snapshots, scores and settlement remain authoritative;
changing presentation data cannot grant an illegal move or choose a die result.
Undo snapshots are bounded to four and cannot recursively contain undo history.

`backgammon.ui.js` projects the filtered state into the wood board, bar, bear-off
trays, thirty stable checker identities, pip/score cards and interactive controls.
Options support color exchange, match goal 1/3/5/7/11/15, cube enablement and
computer difficulty. Selecting a checker reveals hatched legal destinations;
tapping or dragging emits the same accepted source/destination command.
Doubles show four physical dice, and each spent die turns gray. The opening
has one die per seat. Undo never changes or rerolls accepted dice. Hint selects
a legal source and destination without making a move. Help captures interaction
until closed. Spectators, historical snapshots and completed matches stay passive.

The package sets `viewport.camera_enabled:false`; the host fits the complete
board on resize while ignoring pinch, wheel, keyboard zoom and background pan.
Multitouch cancels an unfinished checker gesture. Other declarative games retain
the default camera behavior.

`motion` declares 800ms quadratic checker slides, 500ms dice effects, 1000ms roll
readability and 500ms between turns. The authority retains the last accepted
command's exact single-die stops and starting public board in `last_move`.
`gameUI.getLastMoveAnimations(view, scene)` returns sequential checker paths,
interleaving each hit to the bar before continuing the moving checker. Bearing
off crosses to the off tray, and compressed stacks settle to their final
positions. The host plays these paths only for opponents; own moves update
immediately. Older pinned rules without this metadata retain the previous
per-piece animation behavior. Opening/no-moves announcements remain readable
before the next action. Reduced-motion preferences and
initial/reconnect snapshots bypass animation. Polls retain running animation
clocks, and coalesced computer updates play accepted states in order.

The portal's exact-fingerprint presentation adapter upgrades known older
Backgammon visuals while leaving their pinned authority and version intact.
Newly published matches use the full modern package. Fingerprints reject edited
packages rather than silently replacing their author's changes.

Regenerate the submission, static adapter asset and compound fixtures with:

```bash
python -m game_platform.tools.build_declarative_backgammon
```

Python tests cover strict schemas, legal moves, complete games, options, opening,
undo, cube ownership, scoring, deterministic computer choices and UI projection.
Browser suites exercise real portal computer/pass matches, source/destination
and drag interaction, keyboard input, fixed camera and measured playback.
