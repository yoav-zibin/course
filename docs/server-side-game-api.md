# Server-side Game API — contract

This is the in-repo reference for the server-side Game API, adapted from the
professor's spec ("Game Platform: server-side Game API"). **Other teams:
code against this document.** November 6 changes: playerLeft shares the move
result contract; bots are single-player only.

## How it works

| Concern | The contract |
|---|---|
| Game code | `client_code` (HTML, iframe) + `server_code` (JavaScript, run in QuickJS) — every game has both |
| Players | Id strings: a human's user id, `computer-1`, `computer-2`, … |
| Initial state | The server calls `newMatch` at start |
| A move | Client sends a small game-defined `move`; the server calls `applyMove` |
| Validation | `applyMove` rejects illegal moves with `InvalidMove` (HTTP 400) |
| Computer opponents | Played on the server by `computerMove`, with or without humans online |
| What clients see | `viewFor(state, playerId)` — hidden information stays on the server |
| Randomness | Seeded by the server per call (`ctx.random`), so reproducible |
| Tokens | Each human stakes up to `max_loss`; server code pays out the pot |
| Testing | Random walks + fuzzing whenever `server_code` changes; only passing versions publish |

Every game has `server_code`: it is required when a game is created, and it
cannot be removed by an update.

## Server code

`server_code` is a plain JavaScript script (no modules, DOM, network or
timers) that defines a global `game` object. All arguments and results are
JSON. Given the same arguments and `ctx.random`, a function must return the
same result: the server may call it again for replays and tests,
and tests verify this by calling each function twice and requiring identical
results.

```js
const game = {
  // When the owner starts the match.
  newMatch(ctx) { return { state, turn }; },

  // For every move, human or computer. Throws InvalidMove for an illegal move.
  // When the match ends, turn is null and payouts splits the whole pot.
  applyMove(state, playerId, move, ctx) { return { state, turn, payouts }; },

  // A good move for a computer player. applyMove must accept it.
  computerMove(state, playerId, ctx) { return move; },

  // A random legal move, used by the tests to explore more states.
  randomMove(state, playerId, ctx) { return move; },

  // What a player (or a spectator, playerId = null) sees, after every change.
  viewFor(state, playerId, ctx) { return view; },

  // A human joined mid-match. Required if the game allows joining.
  playerJoined(state, playerId, ctx) { return { state, turn }; },

  // A player left mid-match. Required if the game allows leaving.
  playerLeft(state, playerId, ctx) { return { state, turn, payouts }; },
};
```

### Arguments and results

| Name | Meaning |
|---|---|
| `state` | The full match state: any JSON. Kept on the server, never sent to clients |
| `playerId` | A player's id string. In `viewFor`, `null` means a spectator |
| `move` | Game-defined JSON from the client, e.g. `{"cell": 4}` |
| `turn` | The ids of the players who may move next (any one of them), or `null` when the match is over. Never empty |
| `payouts` | `{playerId: tokens}`: non-negative integers for active humans only. Terminal results distribute exactly `ctx.pot`; ongoing results may distribute at most `ctx.pot`. Applies to `newMatch`, `applyMove`, `playerJoined`, and `playerLeft`. |
| `view` | Whatever the client needs for that player, including the result once the match is over |
| `ctx.players` | `[{id, kind, display_name, picture_url, max_loss, active}]` in join order. In `playerJoined` it includes the joiner; in `playerLeft` it still includes the leaver |
| `ctx.pot` | The tokens in the pot |
| `ctx.random()` | A seeded random number in [0, 1). `Math.random` is replaced by the same generator |
| `ctx.move_count` | How many moves were made so far |
| `ctx.estimateWinChance(state, playerId, turn?)` | Platform helper: Monte-Carlo estimate of a player's chance of winning, for `playerLeft` payouts. Plays the game out from `state` with `randomMove` (up to 100 walks of up to 200 moves) and returns the fraction of walks the player wins — a walk is won when the player's final payout is the largest (ties share the win). `turn` says who may move first; without it, the first mover is discovered by trying each player. Like everything else, the estimate is deterministic for a given call |

### Errors

- The platform defines a global class `InvalidMove extends Error`.
  `applyMove` throws it for a move that breaks the rules or is malformed; the
  server answers 400 with its message.
  The 400 body is `{"detail", "code": "game_message"}`; when the game's string table has a `server_`
  template for the message it also has `message_key` and `params`, and `detail` is translated for the viewer
  (see docs/game-translation.md, "Texts the server writes"). A new game lists every `InvalidMove` text there.
- Any other exception, a timeout (100 ms per call), a memory error (64 MB per
  context), or an invalid result (empty/unknown turn, payouts that don't add
  up or pay a computer, non-JSON result, oversized state) is a **bug in the
  game**: the call fails with 500, the error and its inputs are recorded on
  the game version, and the match is left unchanged.

### Tokens

- The match creator sets `max_loss`, the most tokens each human can lose.
  The platform deducts it when a human joins and adds it to the pot; a human
  who can't afford it can't join (409). Computers never bring or take tokens
  (`max_loss` 0), so a human playing only against computers gets their stake
  back.
- Leaving before the match starts refunds `max_loss`. Deleting a waiting
  match refunds everyone.
- `playerLeft` returns the same `{state, turn, payouts?}` result as `applyMove`.
  With `turn: null`, its complete payout distribution is credited exactly once
  and the match ends with `end_reason: "player_left"`. With an ongoing turn,
  optional payouts are deducted from the pot and recorded cumulatively.
- A leaving human is never replaced by a bot. Their seat retains its original
  index and id, with `active: false` in `ctx.players` and REST `players`. The
  game must ignore inactive seats in future turns and payouts. The departing
  player is still active during `playerLeft`, so that call can pay them. End
  the match if fewer than two active humans remain after a leave. Fixed-roster
  games should end on departure; games supporting elimination may continue.
- A game without `playerLeft` ends on departure and the platform divides its
  remaining pot among active humans. Existing published handlers returning the
  old scalar `payout` are adapted by the runner: the match ends, the quoted
  amount goes to the leaver, and the rest goes to the other active humans. If
  the last human leaves, they receive the full pot. This applies to old pinned
  game versions as well; it does not rewrite stored code or history.
- All three cases (native result, adapted scalar payout, and no leave handler)
  commit through the same result application as `applyMove`. They record the
  departure and mark the seat inactive consistently. No game-specific API path
  or republication of existing games is needed.
- `POST /matches/{id}/maybeLeave` stores the entire validated result. The response
  exposes `pending_leave_payout` and `pending_leave_ends_match`, never the private
  resulting state. `POST /matches/{id}/playerLeft` applies that exact result.
  A move, join, timeout, or another confirmed leave invalidates the preview.
  Every successful v2 leave appears in history as `{type: "player_left"}`.
- `playerLeft` calls get a 2-second time budget instead of the usual
  100 ms, because `ctx.estimateWinChance`'s walks take about a second.
  The estimator also has a deterministic 2,000 simulated-move-attempt budget
  across its maximum 100 walks. Long games use fewer walks instead of timing out;
  estimates are divided by the walks actually attempted, including unfinished
  walks as losses. The budget does not depend on machine speed or elapsed time.

## Client code (iframe protocol v2)

The client is still an HTML page in an iframe (`sandbox="allow-scripts"`)
exchanging the same two messages, but it no longer computes states:

```jsonc
// state_changed: platform to game
{
  "type": "state_changed",
  "state": { /* the viewer's view (portal matches) */ },
  "view": { /* viewFor output for this viewer; never null */ },
  "players": [
    {"player_index": 0, "player_id": "u1", "kind": "human", "name": "user1",
     "picture_url": "<96x96 image>"},
    {"player_index": 1, "player_id": "computer-1", "kind": "computer",
     "name": "Computer 1", "picture_url": "<96x96 image>"}
  ],
  "turn_of_player_indices": [0],
  "status": "ongoing",
  "end_reason": null,
  "move_count": 2,
  "my_player_index": 0,        // null for spectators
  "acting_for_player_index": 0, // the seat this screen should move for, or null
  "token_pot": 0,
  "strings": { /* the viewer's translations of the game's string table */ },
  "locale": "en",
  "direction": "ltr"
}

// make_move: game to platform
{"type": "make_move", "move": {"cell": 1}}
```

The protocol has no client-computed `new_state` /
`next_turn_player_indices` and no `initial_state` / `first_turn_player_indices`
on start, and no id-based turn reporting — the message reports the turn and the
viewer's seat as seat indices (`turn_of_player_indices`, `my_player_index`,
`acting_for_player_index`).

## REST API changes

| Endpoint | Behavior |
|---|---|
| `POST /games` | Creates and publishes a complete game in one call (the agent import): `client_code`, `server_code`, `game_schemas` (in `unit_tests`), translations and images are all supplied in the body; the server runs the tests first and inserts nothing if they fail. `PATCH /games/{id}` updates a game and re-tests any new server code (or its rules) first, refusing the update if the tests fail |
| `POST /matches` | `{game_id, num_computer_opponents, private?, max_loss}` |
| `POST /matches/{id}/join`, `POST /invites/{token}/accept` | Take a seat and deduct the stake (409 if the balance is too low); mid-match the server calls `playerJoined` |
| `POST /matches/{id}/leave` | Before the start, a refund; mid-match, `playerLeft` |
| `POST /matches/{id}/maybeLeave`, `POST /matches/{id}/playerLeft` | Leave preview + confirm |
| `POST /matches/{id}/start` | `{}` — the server calls `newMatch` |
| `POST /matches/{id}/moves` | `{move, expected_move_count?}`, only from a human in `turn` (403 otherwise); 400 for `InvalidMove` |
| `GET /matches/{id}` | The caller's `view` and the pot — never the state; the full state only in the debug tools. A caller without a seat gets the spectator view (`viewFor` with a null player), in history and move reads too, so a shared match link shows the game's public view |
| `GET /matches/{id}/moves` | Each move's player id, move and time, with the caller's view of the resulting state (the spectator view for a caller without a seat) |
| `GET /auth/me` | Your profile, including your token balance |

## Computer opponents: single-player only

Computer matches contain exactly one human. A second human cannot join a bot
match through the API or an invite; remove all computers in the waiting room
first. Multiplayer lobbies and random matchmaking cannot add bots. Bot matches
are excluded from open-match listings. Random walks cover either all humans or one human against computers.

Timeouts end a match — a server timer fires at the deadline, and reads and
moves check too — and pay its outstanding pot to the players who did not hold
the turn, split evenly (refunded evenly to everyone only when every player
held the turn); they never create bots.
Ongoing mixed rosters saved before this change end on their next read, move, or
worker call with `end_reason: "solo_computers_only"`, refunding the remaining
pot to active humans once. Waiting lobbies can remove their bots.

## Game JSON Schemas

Every published game version stores a `game_schemas` object with exactly
three Draft 2020-12 JSON Schemas: `state`, `move`, and `view`. The schemas are
supplied with the game when it is created (in the import's `unit_tests`) and
are required: a game with `server_code` but no `game_schemas` is refused. The
platform never infers schemas.

The platform validates state arguments before calling game functions that
receive state, and validates a human's `move` against the `move` schema before
`applyMove` runs. `computerMove` and `randomMove` results use the same move
schema; returned states and `viewFor` results use their respective schemas.
An invalid human move is rejected with HTTP 400 without changing the match.
Invalid game-generated values or results are game bugs: the call fails and
the random-walk test report identifies the failing function and seed.

Invalid game-defined inputs emit a warning log with the game id/version,
function, input name, and validation message. Process-local counters are
available at `GET /admin/game-input-metrics` (protected by the master
password when configured); counters are grouped by game version, function,
and input and reset when the process restarts. They are not aggregated across
workers.

Every persisted version — including historical versions — must have schemas.
At startup, the server logs missing `game-id@version`
entries and runs in degraded mode so non-game API functionality remains
available. A game version without schemas is still blocked from executing:
there is no permissive runtime fallback. Historical versions must carry the
exact schemas for those entries before restarting a strict server deployment,
because old matches may still rely on those versions. (The
`backfill_game_schemas` utility described in earlier drafts of this contract
was never built; schemas are supplied at import time, and the built-in games
ship theirs in `games/<id>.schema.json`.)

To gather exact code and rules for affected versions without exporting user
records, run `export_game_schema_inventory.py` with the production config and
the server's read-only Firestore credentials. By default, it finds every
server-side version missing schemas and writes only each version's name, rules,
server code, and existing schemas:

```powershell
python export_game_schema_inventory.py --config C:\path\to\config.json --output C:\path\to\game-schema-inventory.json
```

Use the optional `--refs` text file only when exporting a specific subset.

## Computer opponents on the server (Phase 3)

After every change (start, a move, a player joining or leaving), while
`turn` includes a computer and no human, the server calls `computerMove`
(first computer in join order) and applies it with `applyMove`, waiting
`computer_move_delay_seconds` (default 0.6) between moves in a background
task. Computers move whether or not any human is online. If `computerMove`
throws or its move is rejected, the match pauses and the error is recorded
on the game version.

## Running QuickJS (Phase 1 — `game_platform/game_logic.py`)

- One QuickJS context per game version, created on first use and cached; it
  evaluates a small prelude (`InvalidMove`, the seeded `Math.random`, the
  frozen `Date`, a call helper), then `server_code`. The context can be
  discarded and rebuilt at any time (e.g. after an error) because no state
  lives in it.
- Calls pass JSON strings in and get a JSON string back, so nothing is
  shared between calls and results are always JSON. The prelude reseeds the
  RNG from the call's seed (derived from the match seed and move number) and
  freezes `Date` to the move's time on every call, so a match can be
  replayed exactly.
- Limits per call: 100 ms and 64 MB. Exceeding one counts as a game bug.
- QuickJS has no file, network or process access unless the host adds it;
  we add none.

## Testing before publishing (Phase 5 — `game_platform/game_testing.py`)

Whenever a game is submitted or its `server_code` changes, the server tests it
in QuickJS; only a passing version can be published (`POST /games` runs the
gate before inserting anything; `PATCH /games/{id}` runs it on update).
On import the checks run inside a 20-second validator
subprocess, and the random walks inside it have a 3-second budget: up to
1000 walks of up to 1000 moves each, stopping at whichever limit comes first.
The `PATCH /games/{id}` update path runs the same tester with a 1-second
walk budget. Each walk uses a random player count, either all humans or one human plus
computers, random `max_loss` values and a random seed; moves come from
`computerMove`/`randomMove`; `viewFor` is called for every player and a
spectator after each move; joins/leaves happen occasionally if allowed
(full and partial payout distributions are checked, and departed seats remain
inactive at their original indices); malformed
moves are fuzzed into `applyMove`. Every result is validated
(turn, pot, payouts), and selected calls are run twice with identical
arguments and seed to verify determinism. If not even one walk finishes in
the budget, the game is reported as too slow. A failure report records the
error and stack, the function and its exact arguments, the walk's seed,
player count and move number, and the last few moves; failed seeds are
stored on the game and replayed first on the next run. The failure report is
returned in the 422 response, so the submitting agent can fix the game and
retry.

## The client protocol (Phase 6)

A game is submitted complete through `POST /games` (see
[agent-game-import.md](agent-game-import.md)): the server runs the
random-walk tests on the submitted code before publishing it. The client
protocol for a published game is the same one the portal speaks:

- `state_changed` (platform -> game) gains `view`: the viewer's `viewFor`
  view (`null` for spectators). `players` entries gain `player_id`. A
  client renders `view` and keeps no state of its own;
  a player only ever acts for themselves: it is their turn when
  `my_player_index` is in `turn_of_player_indices`. The server moves
  computers, never the client.
- `make_move` (game -> platform) is `{"type": "make_move",
  "move": ...}` — no `new_state`, no next turn; the server validates and
  applies it.

Portal practice (local, offline play) is not offered for online matches:
game logic runs on the server.

## Updating the existing games (Phase 7 — landed)

The three games in `games/` are split into client + server code
(`tictactoe.html` + `tictactoe.server.js`, and likewise for poker and
debug); each game's pure `Logic` object became most of its server code,
and the clients now only render their view and send moves. The example
data's matches were re-scripted as real moves played by that server
code. Two things the migration surfaced: the random-walk tester now
models a leave the way the platform does (the seat stays at its
original index, marked inactive, never taken over by a computer) — removing
the seat broke seat-indexed games — and tic-tac-toe's minimax is memoized, because unmemoized it
overruns the 100 ms per-call limit on an empty board. Acting on behalf
does not exist anywhere in the API: a player only ever moves for their
own seat, and the server moves the computers.

- **Tic-tac-toe:** `newMatch` empty board; move `{cell}`; `computerMove`
  minimax (memoized, ties broken by `ctx.random`); payouts: pot to a human
  winner, split among humans on a draw or if a computer won. No join/leave.
- **Poker:** `newMatch` 1000 chips each, blinds, first deal shuffled with
  `ctx.random`; `viewFor` hides the deck and other players' hole cards until
  showdown (it does publish `dealt_in` — which seats were dealt into the
  hand is public, and the client labels seats from it, never from the
  hidden cards); `playerJoined` plays from the next hand. `playerLeft` closes
  the table and pays all active humans in proportion to chip share, including
  committed chips, with integer remainder tokens assigned in seat order.
- **Debug:** applies any move `{new_state, next_turn, payouts?}` as-is with
  validation; `computerMove`/`randomMove` pass the turn, and the passes
  are counted in `state.passes` — at 20 the match ends, so all-computer
  walks terminate.

## Determinism, verified end to end (Phase 8 — landed)

Determinism is checked at three levels: per call, the QuickJS runner
and the random-walk tester run selected calls twice with identical
arguments and seed and compare the JSON; per match,
`tests/test_determinism.py` plays scripted matches (tic-tac-toe
against a server computer, a poker hand) on a fresh platform with the
same ids — hence the same match seed — and asserts every intermediate
state is identical, and failed test seeds stored for a game are replayed
first when the game is next submitted, so a fix is verified against the
exact walk that found the bug. One platform fix landed with this
phase: when a speed-match timeout hands a seat to a computer, the
takeover now schedules the computer's moves like every other path —
the takeover path originally never scheduled them (a human's browser
used to submit computer moves), so a match stalled on the computer's
turn (found by the Playwright speed test).

### Privacy of history and randomness

Every history state is projected through the caller's `viewFor`. Raw move
payloads can contain private bids or card choices, so history only returns
`move` to the authenticated human who submitted it; all other callers receive
`null`. This applies to `/moves`, `/history`, and paginated v2 history, including
finished matches. Public actions should be represented in the public game view.
The player's own move remains available for offline acknowledgement matching.

The match seed stays server-only. `viewFor` uses a separate deterministic random
stream for each viewer and move count, so visible random values cannot reveal
the next gameplay call's random stream. Game-runtime failures return a generic
error; private inputs and diagnostic details remain in server/admin records.

New online matches use a 256-bit secret and ChaCha20 streams (seed version 3).
Initialization, moves, lifecycle callbacks, and per-player views are separated.
The runner retains the numeric-seed generator for historical unit-test vectors;
online keys are passed without truncation. Older live matches upgrade on their
next gameplay move or start; an already dealt legacy hand is not silently reshuffled.
