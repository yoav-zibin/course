# Backgammon (Declarative)

`backgammon.json` is a complete ordinary game-import submission. It preserves
the canonical JavaScript from the original Backgammon game
`20a83777-0f59-4105-a09e-0267b9c15e40`, version 4. The `server_code` begins with
the byte-for-byte `backgammon.server.js`; SHA-256:
`0206fffd96b1447a457f63431d013c6de5d5337dfc40285157304a95204b3c4e`.
It then appends `backgammon-roll-history.js`, a small metadata wrapper. The
wrapper records the same two random draws the accepted roll already consumed;
it never draws again or changes move legality, turns, winners or payouts.
`backgammon-combined-moves.js` then adds server-checked gestures that use two
to four remaining dice with the same checker. It executes only canonical legal
steps and accepts a destination only when every legal route to it has the same
complete board, remaining dice and turn result. A destination already offered
by a single die keeps its existing single-step behavior, including bearing off.
Each combined gesture counts as one action. It cannot switch checkers, bypass
bar priority or continue beyond bearing off, a winner or the end of the turn.
Computer and random opponents continue to choose the original single moves.

The move schema describes the existing server's `roll`, `pass`, and
`move` actions precisely, including `"bar"` as a source and `"off"` as a
destination. Unknown properties, such as submitted dice, state or payouts,
are rejected. The server rolls the dice, checks turns and moves, handles
captures and bearing off, and settles the match. Editing the UI's legal-move
list cannot authorize a move.

The ordinary platform variant has a finite-match safeguard after 120 turns
or 300 actions: more borne-off checkers wins, with ties favoring player one.
The declarative presentation preserves this existing behavior.

`backgammon.ui.js` only projects the server-filtered view into a scene. The
scene has 24 board points, embedded SVG board and dice assets, a bar, an off tray,
30 checker pieces and two physical dice in the center of the board. Tap either
highlighted die to roll; the server still chooses the result. Before the first
roll, the dice show neutral faces. A used ordinary die turns gray. Doubles keep two
dice and gray one half per move, showing all four uses without adding dice.
The completed pair stays fully gray until the next roll, including the fourth
doubles move. The next player can click those highlighted dice to roll again.
The remaining-move count is also shown as text and each die has a translated
accessible label. Spectators, replay and finished games cannot roll.

The top checker of a legal source
has `actions: ["move"]`; its `move_targets` contains only destinations
offered for that source by `view.legalMoves` or the optional server-provided
`view.combinedMoves`. The latter contains `{from,to}` destinations; ordinary
`legalMoves` retains its canonical dice metadata. The client does not submit
a route. Earlier pinned authorities omit `combinedMoves`
and retain single-step gestures. All other pieces explicitly
have `actions: []`, except the two dice have `actions: ["tap"]` when rolling
is legal. Spectators, replay and finished games are passive.

After selecting or beginning to drag a checker, the host highlights that
checker's permitted drop destinations. A drop event looks like:

```json
{"type":"drop","id":"checker_0_12","piece_id":"checker_0_12","target_id":"to_5"}
```

The reducer emits a normal server move:

```json
{"action":"move","from":6,"to":5}
```

Checker IDs remain stable across normal moves, hits, bar re-entry and bearing
off. The reducer stores display identities in `local_state.stacks`,
reconciling them against new server counts; it does not compute legality.
The current package retains a public `last_roll` record in state and view:
`{seat,turn,values:[first,second],move_count}`. This preserves exact faces even
when a computer completes its turn between polls, a roll has no legal moves,
or the host reloads. It survives moves and turn completion until a new accepted
roll replaces it. New matches start with `last_roll:null`.

For earlier pinned packages, `local_state.roll` and optional viewer-filtered
`state_changed.presentation_history` preserve or recover the original pair.
History contains at most 12 `{view,move_count,last_move_player_index}` records;
the reducer ignores entries beyond the displayed move and never borrows future
faces during replay. If the old authority discarded an unobserved blocked
roll, the last known pair remains visible rather than inventing its result.
A partial mid-turn view without any original roll history shows only known
values and a neutral face for an unknown die, together with moves remaining.

Known rolls declare `animation:{kind:"roll",key:"roll:<seat>:<turn>"}` on both
dice. The stable key requests one roll animation when a new result arrives,
without replaying the effect for spent halves or repeated polling. Hosts
respect reduced motion and read-only replay.
Native hosts retain this local presentation state between reducer calls.
This lets the portal animate a checker between positions in multiplayer
and computer games. Pass-and-play updates immediately. Pinch zoom belongs
to the host camera and never changes a piece's move or scale.

Rebuild from the package parent:

```sh
python -m game_platform.tools.build_declarative_backgammon
python -m pytest game_platform/tests/test_declarative_backgammon.py
```

The builder also writes `static/backgammon-declarative-ui.json`, the same
portable presentation used to repair the original published Backgammon UI
without editing its pinned server rules or match state.

The import includes eight-language text, a cover, tutorials, and six actual
QuickJS examples: initial roll, terminal move, hitting a blot, bar re-entry,
bearing off, and a four-move doubles gesture. The builder also writes
`tests/fixtures/declarative/backgammon-combined-cases.json` with four deterministic
compound scenarios, including a forced hit and an ambiguous hit that must remain
a single move. Replace the public example submission secret
before publishing a new game. Submit through `POST /games` or the equivalent
`POST /games/declarative`; the game appears in the normal catalog and uses
ordinary server matches, computer opponents, local practice and replay.
