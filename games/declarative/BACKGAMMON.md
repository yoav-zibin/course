# Backgammon (Declarative)

`backgammon.json` is a complete ordinary game-import submission. It uses the
same authoritative JavaScript as the published HTML Backgammon game
`20a83777-0f59-4105-a09e-0267b9c15e40`, version 4. Its `server_code` is copied
byte-for-byte from `../audit-batch3/backgammon.server.js`; SHA-256:
`0206fffd96b1447a457f63431d013c6de5d5337dfc40285157304a95204b3c4e`.

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
scene has 24 board points, an embedded SVG board asset, a bar, an off tray,
30 checker pieces and the remaining dice. The top checker of a legal source
has `actions: ["move"]`; its `move_targets` contains only destinations
offered for that source by `view.legalMoves`. All other pieces explicitly
have `actions: []`. Spectators, replay and finished games are passive.

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
off. The reducer stores only display identities in `local_state.stacks`,
reconciling them against new server counts; it does not compute legality.
Native hosts retain this local presentation state between reducer calls.
This lets the portal animate a checker between positions in multiplayer
and computer games. Pass-and-play updates immediately. Pinch zoom belongs
to the host camera and never changes a piece's move or scale.

Rebuild from the package parent:

```sh
python -m game_platform.tools.build_declarative_backgammon
python -m pytest game_platform/tests/test_declarative_backgammon.py
```

The import includes eight-language text, a cover, tutorials, and six actual
QuickJS examples: initial, intermediate, terminal, hitting a blot, bar
re-entry, and bearing off. Replace the public example submission secret
before publishing a new game. Submit through `POST /games` or the equivalent
`POST /games/declarative`; the game appears in the normal catalog and uses
ordinary server matches, computer opponents, local practice and replay.
