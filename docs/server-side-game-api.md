# Server-side Game API (v2) — contract

This is the in-repo reference for the new server-side Game API, adapted from the
professor's spec ("Game Platform: server-side Game API (v2)"). **Other teams:
code against this document.** November 6 changes: playerLeft shares the move
result contract; bots are single-player only.

Status: Phase 0/1 (contract + QuickJS runner) landed first; the REST changes
below land phase by phase — each section says when.

## How v2 differs from v1

| Concern | v1 | v2 |
|---|---|---|
| Game code | One HTML page (`code`) | `client_code` (HTML, iframe) + `server_code` (JavaScript, run in QuickJS) |
| Players | Seat indices | Id strings: a human's user id, `computer-1`, `computer-2`, … |
| Initial state | Created by the game, or `initial_state` at start | The server calls `newMatch` at start |
| A move | Client sends the full `new_state` + next turn | Client sends a small game-defined `move`; the server calls `applyMove` |
| Validation | Turn and seat checks only | `applyMove` rejects illegal moves with `InvalidMove` (HTTP 400) |
| Computer opponents | Played by human clients (`acting_for_player_index`) | Played on the server by `computerMove`, with or without humans online |
| What clients see | The whole state | `viewFor(state, playerId)` — hidden information stays on the server |
| Randomness | `Math.random` in whichever client moved | Seeded by the server per call (`ctx.random`), so reproducible |
| Tokens | Pot split by seat on the final move | Each human stakes up to `max_loss`; server code pays out the pot |
| Testing | Manual, in the builder | Random walks + fuzzing whenever `server_code` changes; only passing versions publish |

Games with a `server_code` use the v2 flow. Games without one keep the v1
flow until they are migrated.

## Server code

`server_code` is a plain JavaScript script (no modules, DOM, network or
timers) that defines a global `game` object. All arguments and results are
JSON. Given the same arguments and `ctx.random`, a function must return the
same result: the server may call it again for replays, tests and the emulator,
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
| `payouts` | `{playerId: tokens}`: non-negative integers for active humans only. Terminal results distribute exactly `ctx.pot`; ongoing results may distribute at most `ctx.pot`. Applies to both `applyMove` and `playerLeft`. |
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
- `POST /matches/{id}/maybeLeave` stores the entire validated result. The response
  exposes `pending_leave_payout` and `pending_leave_ends_match`, never the private
  resulting state. `POST /matches/{id}/playerLeft` applies that exact result.
  A move, join, timeout, or another confirmed leave invalidates the preview.
  Successful game-handled leaves appear in history as `{type: "player_left"}`.
- `playerLeft` calls get a 2-second time budget instead of the usual
  100 ms, because `ctx.estimateWinChance`'s walks take about a second.

## Client code (iframe protocol v2)

The client is still an HTML page in an iframe (`sandbox="allow-scripts"`)
exchanging the same two messages, but it no longer computes states:

```jsonc
// state_changed: platform to game
{
  "type": "state_changed",
  "view": { /* viewFor output for this viewer; never null */ },
  "players": [
    {"id": "u1", "kind": "human", "display_name": "user1",
     "picture_url": "<96x96 image>", "max_loss": 100},
    {"id": "computer-1", "kind": "computer", "display_name": "Computer 1",
     "picture_url": "<96x96 image>", "max_loss": 0}
  ],
  "turn": ["u1"],
  "status": "ongoing",
  "end_reason": null,
  "move_count": 2,
  "my_player_id": "u1"        // null for spectators
}

// make_move: game to platform
{"type": "make_move", "move": {"cell": 1}}
```

Removed from v1 for v2 games: `acting_for_player_index`, seat indices,
client-computed `new_state` / `next_turn_player_indices`, and
`initial_state` / `first_turn_player_indices` on start.

## REST API changes

| Endpoint | v1 | v2 (phase) |
|---|---|---|
| `POST /games`, `PATCH /games/{id}`, drafts, publishing | `code` | Also `server_code` (as `client_code` + `server_code`). Draft publishing and `PATCH` updates that change the server code (or its rules) run the tests first and are refused if they fail |
| `POST /games/test` | — | Runs the random-walk/fuzz tests on unsaved code, for the builder and the AI fix loop |
| `POST /emulator/reset`, `POST /emulator/act` | — | Play unsaved server code the way a match would (the builder's test play): reset runs `newMatch`, act applies one human move; both advance computer players and return the full state, every player's view, and any game error verbatim |
| `POST /matches` | `{game_id, num_computer_opponents, private?}` | Also `max_loss` (Phase 3) |
| `POST /matches/{id}/join`, `POST /invites/{token}/accept` | Take a seat | Also deduct `max_loss` (409 if the balance is too low); mid-match the server calls `playerJoined` (Phase 3/4) |
| `POST /matches/{id}/leave` | Ends legacy matches and settles outstanding tokens | Before the start, a refund; mid-match, `playerLeft` |
| `POST /matches/{id}/maybeLeave`, `POST /matches/{id}/playerLeft` | — | Leave preview + confirm |
| `POST /matches/{id}/start` | `{first_turn_player_indices, initial_state}` | `{}` — the server calls `newMatch` (Phase 3) |
| `POST /matches/{id}/moves` | `{new_state, next_turn_player_indices, expected_move_count?}` | `{move, expected_move_count?}`, only from a human in `turn` (403 otherwise); 400 for `InvalidMove` (Phase 3) |
| `GET /matches/{id}` | The whole state, to anyone | The caller's `view` and the pot; the full state only in the debug tools (Phase 3) |
| `GET /matches/{id}/moves` | Every `new_state` | Each move's player id, move and time (Phase 3) |
| `GET /auth/me` | Your profile | Also your token balance (already present) |

## Computer opponents: single-player only

Computer matches contain exactly one human. A second human cannot join a bot
match through the API or an invite; remove all computers in the waiting room
first. Multiplayer lobbies and random matchmaking cannot add bots. Bot matches
are excluded from open-match listings. The emulator follows the same rule, and
random walks cover either all humans or one human against computers.

Timeouts end a match and refund its outstanding pot; they never create bots.
Ongoing mixed rosters saved before this change end on their next read, move, or
worker call with `end_reason: "solo_computers_only"`, refunding the remaining
pot to active humans once. Waiting lobbies can remove their bots.

## Game JSON Schemas

Every published v2 game version stores a `game_schemas` object with exactly
three Draft 2020-12 JSON Schemas: `state`, `move`, and `view`. The platform
generates these from successful random-walk samples when a creator omits them.
The builder runs generation as part of server-code testing and keeps the
generated schemas with its autosaved draft; direct API create/update and draft
publication use the same generator. Creators do not need to author JSON Schema.
Explicit schemas remain accepted for integrations that already provide them.
V1 games do not use these schemas.

Generated schemas describe observed JSON value types, leave object properties
optional, and allow additional object properties so unobserved game branches
remain playable. Generation requires successful samples for state, move, and
view, and publication still runs the schema-aware random-walk gate. Generation
or validation errors block publication instead of falling back to an
accept-everything schema. Since inference is sample-based, it is not a proof
that every rare game branch has been observed; games with highly variable
contracts should still be exercised thoroughly before publishing.

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

Every persisted v2 version—including historical versions—must have schemas.
V1 records are excluded. At startup, the server logs missing `game-id@version`
entries and runs in degraded mode so non-game API functionality remains
available. A v2 game version without schemas is still blocked from executing:
there is no permissive runtime fallback. Backfill historical versions with the
exact schemas for those entries before restarting a strict server deployment.
The automatic generator is used for
new versions; the backfill utility intentionally requires an explicit,
complete mapping because old matches may still rely on those versions:

```json
{
  "my-game@1": {
    "state": {"type": "object"},
    "move": {"type": "object"},
    "view": {"type": "object"}
  }
}
```

```powershell
python backfill_game_schemas.py --config C:\path\to\config.json --schemas C:\path\to\game-schema-backfill.json
```

Writing the map by hand for every historical version is rarely practical, so the
utility can also fill the versions the map leaves out. It prints each missing
`game-id@version` with the source of the schema it would get, and writes nothing
at all unless every missing version has one:

| Option | Gives |
|---|---|
| `--schemas FILE` | Exactly the schemas in the map (wins over everything else). |
| `--use-repo-schemas` | `games/<id>.schema.json` for the newest missing version of a built-in game. |
| `--infer-rest` | Schemas inferred by playing the version's server code, like the generator for new games (observed types, nothing required, extra properties allowed). Needs the QuickJS runtime, so run it where the server runs. A version that cannot be played is reported and left to the next option. |
| `--permissive-rest` | A schema that accepts any JSON for what is still left: the behavior before schemas, a stopgap to replace later. |
| `--dry-run` | Only prints the plan (including the inference results); writes nothing. |

On the production server (Firestore query mode; the utility opens the same store the
server does) run a dry run first, then the same command without `--dry-run`, and restart:

```bash
cd /opt/game-platform
sudo .venv/bin/python -m game_platform.backfill_game_schemas --config /opt/game-platform/config.json --use-repo-schemas --infer-rest --permissive-rest --dry-run
```

Inference is sample-based, so a rare branch of a game that no sample reached can be
rejected later: watch `game_function_error` / schema rejections in the log after a backfill.

The utility validates the complete mapping before writing any versions and
supports the configured JSON-file or Firestore store (including query mode). Back up the database
before running it; schemas are versioned with the game and should describe
that version's actual inputs and outputs, not merely allow all JSON values.

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

Whenever `server_code` changes, the server tests it in QuickJS; only a
passing version can be published (draft publishing and `PATCH /games/{id}`
run the gate; `POST /games/test` runs the same tests on unsaved code).
The tests take at most 1 second: up to
1000 random walks of up to 1000 moves each, stopping at whichever limit
comes first. Each walk uses a random player count, either all humans or one human plus
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
stored on the game and replayed first on the next run. The builder's AI
fix loop consumes the same report
(up to `ai_max_fix_attempts`, default 3).

## The builder, the emulator, and the client protocol (Phase 6)

The building agent writes both parts of a game: its reply JSON gains a
`server_code` field next to `code`, and its prompt teaches the contract
above. After a reply with server code, the server runs the random-walk
tests on it; a failure report (function, error, exact arguments, seed) is
fed back and the model regenerates, up to `ai_max_fix_attempts` times
(default 3, in the server config). The response reports
`server_test_passed`; code that still fails is returned with the failure
noted, and publishing refuses it (Phase 5). Replies without `server_code`
still parse, as client-only changes.

The builder's test play runs v2 games through the emulator endpoints
above: the client iframe receives `state_changed` with the viewer's
`view`, and its moves go back as moves only — the same protocol the
portal speaks for v2 matches:

- `state_changed` (platform -> game) gains `view`: the viewer's `viewFor`
  view (`null` for spectators). `players` entries gain `player_id`. A v2
  client renders `view` and keeps no state of its own;
  `acting_for_player_index` is only ever the viewer's own seat — the
  server moves computers, never the client.
- `make_move` (game -> platform) for a v2 game is `{"type": "make_move",
  "move": ...}` — no `new_state`, no next turn; the server validates and
  applies it.

Portal practice (local, offline play) is not offered for v2 games: their
logic runs on the server. v1 games keep the old protocol unchanged.

## Updating the existing games (Phase 7 — landed)

The three games in `games/` are split into client + server code
(`tictactoe.html` + `tictactoe.server.js`, and likewise for poker and
debug); each game's pure `Logic` object became most of its server code,
and the clients now only render their view and send moves. The example
data's matches were re-scripted as real moves played by that server
code. Two things the migration surfaced: the random-walk tester now
models a leave the way the platform does (the seat stays, taken over by
a computer, ids renumbered) — removing the seat broke seat-indexed
games — and tic-tac-toe's minimax is memoized, because unmemoized it
overruns the 100 ms per-call limit on an empty board. With the built-in
games on v2, acting on behalf survives only in the v1 protocol path
(pre-existing client-only games); nothing in the v2 API, the portal's
v2 flow, or the migrated games uses it.

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
state is identical, and that the emulator answers identical requests
identically; and failed test seeds stored for a game are replayed
first on the next `POST /games/test`, so a fix is verified against the
exact walk that found the bug. One platform fix landed with this
phase: when a speed-match timeout hands a seat to a computer, the
takeover now schedules the computer's moves like every other path —
in v1 a human's browser submitted them, so the takeover path never
did, and a v2 match stalled on the computer's turn (found by the
Playwright speed test when the UI suite was migrated to v2 games).

## Refactoring all games (admin — landed 2026-10-27)

`POST /admin/refactor_all_games` (super admin: the master password, as
HTTP Basic auth) starts a background job that applies one prompt to the
published games: for each game it sends the prompt plus the game's data
(name, description, rules, client code, server code) to the building
agent — the same agent, system prompt, and test-fix loop as the builder —
and saves the code it returns as a new version of the game. The save
goes through `update_game`'s admin path, so the publish gate re-tests
any new server code and a refusal leaves the game untouched; only the
two code fields are taken from the reply, so a refactor never renames a
game or changes who can play it. `game_ids` in the body restricts the
run to those games; without it every published game is refactored. One
job runs at a time (a second POST is a 409). `GET
/admin/refactor_all_games/{job_id}` reports progress and the per-game
outcome (`updated` / `unchanged` / `failed` with the reason — a failed
game keeps its previous code, and the run continues). The agent exchange
is recorded against each game, like a builder conversation. First use:
converting the remaining client-only games to this API with a
conversion prompt; the same endpoint serves later fleet-wide refactors
(adding unit tests, checking hidden information, checking determinism).

The hand-written counterpart is `PUT /admin/games/{game_id}/code`
(same master-password auth): the body carries explicit `code` and/or
`server_code` and the save goes through the same admin path and
publish gate — for conversions a person writes by hand when the
agent's attempts keep failing a game's tests (the last few complex
games: chess, a second backgammon, Rummy 500, ERS, Guandan).
