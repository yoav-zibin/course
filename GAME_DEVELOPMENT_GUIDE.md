# How to Write a Game for BuildPlay

A guide for an agent that writes a game and publishes it on the BuildPlay platform. Read this whole document before writing any code. The platform is at **https://buildplay.fun**. There is exactly one way to create a game: a single `POST /games` call. There is no builder UI, no draft step, and no separate test endpoint. The `POST /games` endpoint itself validates your game thoroughly and tells you exactly what is wrong when it rejects it — that validation is your test harness.

## 1. Core concepts

**A game** is a complete, playable rule set. It has two code parts:

- `client_code`: one HTML page shown in an iframe. It only renders what the platform sends it and sends moves back. It never computes game state.
- `server_code`: plain JavaScript that runs on the platform in QuickJS. It owns all rules, state, hidden information, and computer play.

**A game version.** Every game has versions, numbered from 1. A match pins the version it started in, so updating a game never breaks a match already in progress. When you resubmit a game with changes, the platform creates a new version. A resubmission that changes nothing is a no-op and keeps the current version.

**A match** is one play-through of a game by a set of players. The platform creates the match, calls your server code to start it, and routes every move through your server code.

**Players, seats, and ids.** A player is identified by an id string: a human's user id, or `computer-1`, `computer-2`, and so on for computer opponents. In server code you work with these id strings — `applyMove`, `viewFor`, `turn`, and `payouts` all use ids. In the client, the platform reports seat indices instead: `turn_of_player_indices` and `my_player_index` are indices, not ids. The platform converts the server code's id-based turn into indices before sending the message. A player's seat is their index in the `players` list, in join order. The two worlds meet in that `players` array: it is indexed by seat, and each entry carries both its `player_index` and its `player_id` — the same id string server code sees. So the client reads turns by seat index, and finds a player's id (for example to link a profile) at `players[seat].player_id`. Never use an id where an index is expected, or vice versa.

**Turns are sets.** The turn is the list of player ids (server side) or seat indices (client side) that may move next. Any one of them may move. The turn is `null` when the match is over. It is never an empty list.

**A player only ever acts for themselves.** It is a player's turn when their own seat is in the turn set. There is no acting on another player's behalf. Computers move on the server, never through a client.

**Hidden information.** The server keeps the full match state and never sends it to clients. Each viewer gets only their own `viewFor` output. If a game has hidden cards, hands, or dice, `viewFor` must filter them out. Never put secret state in a view.

**Tokens and the pot.** Each human stakes up to `max_loss` tokens when they join; the platform deducts it and adds it to the pot. Computers stake nothing and take nothing. When a match ends, your server code distributes the whole pot with `payouts`: an object mapping player ids to non-negative integer token amounts, for active humans only, summing to exactly `ctx.pot`. A human playing only against computers gets their stake back.

**Determinism.** Given the same arguments and the same seed, every server function must return the same result. The platform calls functions twice with identical arguments and seed and requires identical results. Use `ctx.random()` for randomness — it is seeded per call. `Math.random` is replaced by the same seeded generator, and `Date` is frozen. Never use wall-clock time, real randomness, or anything else that varies between identical calls.

**Languages.** Every game is published in all 8 languages at once: `en, es, fr, de, pt, zh, hi, ar`. You write the game in one language (usually English) and supply translations for the other seven. The platform synthesizes the source language's entry itself.

## 2. The endpoint: POST /games

```
POST https://buildplay.fun/games
Content-Type: application/json
```

The machine-readable schema is public at `GET https://buildplay.fun/games/schema`. Fetch it and validate your payload against it before submitting.

### Authentication and ownership

Credentials are optional. To own the game, send the headers `X-User-Id` and `X-User-Password` for an existing account (a guest account works). Without credentials the game is published ownerless, with owner id `agent-import`, and no one can edit or unpublish it. Credentials that are sent but invalid return 401 before the body is read. Never put passwords in URLs, payload files, or source control. Use HTTPS.

### Request limits

- Whole request body: at most 900,000 UTF-8 bytes. Content-Length above that returns 413.
- Each code field (`client_code`, `server_code`): at most 200,000 UTF-8 bytes.
- Each SVG: at most 120,000 bytes.
- Combined stored package (translations included): at most 400,000 bytes for the workflow, 900,000 bytes stored.
- Upload deadline: 15 seconds (408 if exceeded).
- At most 2 validations run concurrently per server process. If both slots are busy you get 429 with a `Retry-After: 15` header — wait 15 seconds and retry the exact same request.
- No content encoding (compressed uploads are rejected, 415). Content-Type must be `application/json` (415 otherwise).

### The request body

Every field below is required unless marked optional. Unknown fields are rejected (`extra='forbid'`), so do not invent fields.

| Field | Type and rules |
|---|---|
| `name` | String, 1–200 characters. The game's display name in the source language. |
| `description` | String, 1–2000 characters. One or two sentences saying what the game is. |
| `allowed_player_counts` | Array of unique integers from 1 to 10, e.g. `[2]`. Every unit-test case roster must have a length in this list. |
| `allows_leave_mid_match` | Optional boolean, default `false`. Set `true` only if you implement `playerLeft`. |
| `allows_join_mid_match` | Optional boolean, default `false`. Set `true` only if you implement `playerJoined`. |
| `client_code` | String, 1–200,000 UTF-8 bytes. Complete HTML page (section 4). |
| `server_code` | String, 1–200,000 UTF-8 bytes. Plain JavaScript defining a global `game` object (section 3). |
| `language` | Optional string, default `"en"`. The language the game is written in; must be one of the 8 locales. |
| `rules` | String, 1–20,000 characters. The full rules of the game, in the source language. |
| `ui_instructions` | String, 1–20,000 characters. How the game should look and behave on screen: layout, controls, what each view shows. |
| `tutorial` | Object `{text, html}`. `text` is a short how-to-play paragraph. `html` is the tutorial page; it must contain the word `viewport` (a responsive `<meta name="viewport" ...>` tag) and be at most 120,000 bytes. If the tutorial page runs scripts, it must also carry its own `i18n-strings` table and a `tutorial_locale` handler, so its changing text can be translated. |
| `images` | Array of 4–6 objects `{caption, svg}`. The first is the cover: a 16:9 `viewBox` (for example `0 0 1600 900`) containing no `text` or `tspan` elements. Every image needs a caption, must contain `<svg`, must parse as XML, must have no `DOCTYPE`/`ENTITY`, and may only use an allowlisted set of SVG elements. The cover is served at `GET /games/{id}/versions/{version}/cover`, and the published game's `cover_url` points to it. |
| `unit_tests` | Object `{state_schema, view_schema, move_schema, cases}` (section 6). The three schemas are Draft 2020-12 JSON Schemas. The runtime `game_schemas` are derived from them — you do not submit a second copy. |
| `translations` | Object with exactly one entry per language other than the source language — 7 entries when the game is written in English (section 5). |
| `game_addition_request_id_and_secret` | Required string, 16–200 characters. A long random secret you pick when creating the game (section 7). |

### Responses

| Status | Meaning and what to do |
|---|---|
| 201 | Published. The body is the published game (`GameOut`): save its `id` and `version`. Version 1 means created; a higher version means an update. |
| 400 | Malformed Content-Length. Fix the request framing and retry. |
| 401 | Credentials were sent and are invalid. Fix them; the body was not read. |
| 408 | Upload took longer than 15 seconds. Retry; send a smaller payload if it keeps happening. |
| 413 | Request too large. Shrink the payload (usually code or images) and retry. |
| 415 | Wrong Content-Type or a content encoding was used. Send plain `application/json` with no encoding. |
| 422 | The payload or the game failed validation. Nothing was inserted. Read the `detail` field — it names the failing checks and gives a full reproduction for each failure (section 8). Fix the problem and resubmit. |
| 429 | Validation capacity is busy. Wait the `Retry-After` seconds (15) and retry the exact same request. |
| 5xx | Platform or storage failure. Do not assume success: check `GET /games` (or `GET /games/{id}`) before deciding whether to retry. |

## 3. Writing server_code

`server_code` is a plain JavaScript script: no modules, no DOM, no network, no timers. It defines one global object, `game`. All arguments and results are JSON.

```js
const game = {
  // Called when the match starts. Return the initial state and who moves first.
  newMatch(ctx) { return { state, turn }; },

  // Called for every move, human or computer. Throw InvalidMove for an illegal move.
  // When the match ends, turn is null and payouts splits the whole pot.
  applyMove(state, playerId, move, ctx) { return { state, turn, payouts }; },

  // A good move for a computer player. applyMove must accept whatever this returns.
  computerMove(state, playerId, ctx) { return move; },

  // A random legal move. The platform's tests use this to explore the game.
  randomMove(state, playerId, ctx) { return move; },

  // What one viewer sees. playerId is null for a spectator.
  viewFor(state, playerId, ctx) { return view; },

  // Required only if allows_join_mid_match is true.
  playerJoined(state, playerId, ctx) { return { state, turn }; },

  // Required only if allows_leave_mid_match is true.
  playerLeft(state, playerId, ctx) { return { state, turn, payouts }; },
};
```

### Arguments

- `state`: the full match state, any JSON. It lives on the server and is never sent to clients.
- `playerId`: a player id string. In `viewFor`, `null` means a spectator.
- `move`: game-defined JSON from the client, for example `{"cell": 4}`.
- `turn`: the ids of the players who may move next, or `null` when the match is over. Never empty.
- `payouts`: `{playerId: tokens}` — non-negative integers, active humans only. A terminal result distributes exactly `ctx.pot`. An ongoing result may distribute at most `ctx.pot`.
- `view`: whatever the client needs for that viewer, including the result once the match is over.
- `ctx.players`: `[{id, kind, display_name, picture_url, max_loss, active}]` in join order. In `playerJoined` it includes the joiner; in `playerLeft` it still includes the leaver (who is still active during that call, so the call can pay them).
- `ctx.pot`: the tokens in the pot.
- `ctx.random()`: a seeded random number in [0, 1).
- `ctx.move_count`: how many moves have been made so far.
- `ctx.estimateWinChance(state, playerId, turn?)`: a platform helper for `playerLeft` payouts. It plays the game out from `state` with `randomMove` (up to 100 walks of up to 200 moves) and returns the fraction of walks the player wins. Deterministic for a given call. `playerLeft` gets a 2-second time budget instead of 100 ms, because this helper takes about a second.

### Rules the server code must follow

- **Validate every move.** `applyMove` must throw `new InvalidMove("reason")` for any illegal or malformed move. The platform defines the global `InvalidMove` class. An illegal move returns HTTP 400 with your message. The message text must have a matching `server_...` template in the client string table (section 4), so it can be shown translated.
- **Anything else that goes wrong is a bug in the game.** Any other exception, a call taking over 100 ms, a call using over 64 MB, or an invalid result (empty turn, turn naming a non-player, payouts not summing to the pot, payouts paying a computer, a non-JSON result, an oversized state) fails validation and fails the match at runtime. Keep every call fast: no unbounded search. Tic-tac-toe's minimax is memoized for exactly this reason — an unmemoized search of an empty board overruns 100 ms.
- **Be deterministic.** Same arguments and seed, same result. Do not read the clock, do not use unseeded randomness, do not keep mutable state outside the `state` argument. Module-scope caches are allowed only if they cannot change results (for example a memo of exact search scores keyed by position and seat).
- **Keep `newMatch` free of `ctx.random()`.** The platform checks every unit-test case by calling `newMatch` and comparing the result with the case's expected initial state — but if `newMatch` draws from `ctx.random()`, the case is recorded as passed with "illustrated random outcome skipped" and its expected state, views, and move are never checked. So a game that rolls its opening dice in `newMatch` gets no verification of its initial case. If your game needs a random opening (dice, a shuffled deck, a random first player), derive it deterministically from the context instead of drawing it: hash the player ids and the pot into the opening roll, for example. The same players and pot always give the same opening, the result is exactly reproducible, and the initial case is fully verified. The same applies to `applyMove`: a move that draws randomness voids that case's illustration check.
- **End the match cleanly.** When the game ends, return `turn: null` and `payouts` distributing exactly `ctx.pot` among active humans. A draw splits the pot among the humans; if a computer won, the pot goes back to the humans.
- **One seat at a time in the turn set, unless every seat acts on its own screen.** Pass-and-play seats the shared screen as the first player in your turn set (`acting_for_player_index`), and only that seat can move there. If a phase keeps two or more seats in the turn set at once — simultaneous setup is the classic case — every later seat can never act on that screen and the match soft-locks. The server checks and online play (each player on their own device) will not catch it; the recorded pass-and-play step will. Make independent setup phases sequential — one seat in the turn set, passing to the next seat when that player finishes — whenever the setup is hidden information, which makes the order immaterial.
- **Leaving.** If `allows_leave_mid_match` is true, implement `playerLeft` and return the same `{state, turn, payouts}` shape. The platform's settlement probes check the exact contract, so implement it literally:
  - The leaver is still active during the call, so the call can pay them. A leave by someone without a seat is rejected by the platform before your code runs.
  - If fewer than two active humans remain after the leave, the match must end (`turn: null`) and the payouts must sum to exactly `ctx.pot`. At pot 0 the payouts are `{}`.
  - When the only human leaves a human-vs-computer match, the payouts must be exactly `{leaver: pot}` — the computer seat is never payable. A solo player who leaves likewise receives the whole pot.
  - With three or more humans and leaving allowed mid-match, the match may continue: the returned turn must exclude the leaver, and a duplicate leave by the now-inactive leaver must be a no-op (same state, same turn, no payouts).
  - A leave after the match has already ended must return the recorded state and payouts unchanged — settlement is computed once and never recomputed. If the recorded payouts paid the departed player, a later leave re-reporting them must not reduce any still-active player's recorded amount (that share may be folded into the remaining players' reported amounts, never reduced).
  - A good shape for the forfeit: a `settle` helper that returns `{}` at pot 0, pays the whole pot to a human winner, and otherwise splits the pot equally among the eligible humans (remainder to the earliest). If you do not implement `playerLeft`, leaving ends the match and the platform divides the remaining pot among active humans.
- **Joining.** If `allows_join_mid_match` is true, implement `playerJoined`. A game that does not allow joining simply leaves the flag `false`.
- **Computer play.** `computerMove` must return a move `applyMove` accepts, for every difficulty the platform asks for. Difficulty is not in `ctx`: if the game has difficulties, carry them in `state.difficulty` and declare the levels in the state schema's `difficulty` enum (the platform sweeps each declared level; with no enum it tries `easy`, `medium`, `hard`). With no difficulty in the state, `computerMove` takes no difficulty. `randomMove` must return a legal move on any live position, and never `null`. Computer matches contain exactly one human; a second human cannot join a bot match.
- **A player with no legal move still needs a move.** Some positions leave the player to move with nothing to play (blocked dice, no playable checker). Define an explicit pass move — for example `{"pass": true}` — that `applyMove` accepts and that advances the turn (or ends the game if nobody can move). Make `randomMove` and `computerMove` return it in that situation. The platform's move-agreement probe fails a game whose generator returns no move on a live position.
- **Never leak hidden information.** `viewFor` is the only thing a viewer ever sees. Filter hidden cards, hands, dice, and anything else a player must not know. A spectator (`playerId === null`) gets the public view only.

### A minimal example (tic-tac-toe)

```js
"use strict";
const game = {
  newMatch(ctx) {
    return { state: { board: ["","","","","","","","",""], winner: null, draw: false },
             turn: [ctx.players[0].id] };
  },
  applyMove(state, playerId, move, ctx) {
    if (!move || typeof move !== "object" || !Number.isInteger(move.cell) || move.cell < 0 || move.cell > 8) {
      throw new InvalidMove("send {cell: 0..8}");
    }
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    if (state.winner !== null || state.draw) throw new InvalidMove("the game is over");
    if (state.board[move.cell] !== "") throw new InvalidMove("that cell is taken");
    const board = [...state.board];
    board[move.cell] = ["X", "O"][seat];
    const line = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]
      .find(([a,b,c]) => board[a] && board[a] === board[b] && board[a] === board[c]) ?? null;
    const draw = !line && board.every((m) => m !== "");
    const next = { board, winner: line ? seat : null, draw };
    const over = line !== null || draw;
    return { state: next,
             turn: over ? null : [ctx.players[1 - seat].id],
             ...(over ? { payouts: endPayouts(next, ctx) } : {}) };
  },
  computerMove(state, playerId, ctx) { /* return a good {cell} */ },
  randomMove(state, playerId, ctx) {
    const empty = state.board.flatMap((m, cell) => (m === "" ? [cell] : []));
    return { cell: empty[Math.floor(ctx.random() * empty.length)] };
  },
  viewFor(state, playerId, ctx) { return { ...state }; },
};
```

The full tic-tac-toe server code is in the repository at `games/tictactoe.server.js`, and its client at `games/tictactoe.html`. Read both before writing a game: they are the canonical example of the whole contract.

## 4. Writing client_code

`client_code` is one complete HTML page in an iframe (`sandbox="allow-scripts"`). It renders views and sends moves. It keeps no game state of its own.

### The messages

As soon as your page has installed its `message` listener, post the ready handshake:

```json
{"type": "game_ready"}
```

The platform holds back the first `state_changed` until your `game_ready` arrives, so no state can be lost in the gap between the page loading and your listener installing. Post it once, immediately after `addEventListener("message", ...)`. A game that never posts it still works — the platform sends the state anyway after a 2-second wait — but posting it starts the game instantly, and it is part of the contract. (A few older games post `{"type": "ready"}` instead; the platform accepts that spelling too.)

The platform sends `state_changed` whenever the match changes:

```jsonc
{
  "type": "state_changed",
  "state": { /* the viewer's view, for portal matches */ },
  "view": { /* the viewer's viewFor output; render this */ },
  "players": [
    {"player_index": 0, "player_id": "u1", "kind": "human", "name": "Alice", "picture_url": "…"},
    {"player_index": 1, "player_id": "computer-1", "kind": "computer", "name": "Computer 1", "picture_url": "…"}
  ],
  "turn_of_player_indices": [0],
  "status": "ongoing",        // "ongoing" or "over"
  "end_reason": null,
  "move_count": 2,
  "my_player_index": 0,      // null for spectators
  "acting_for_player_index": 0,  // the seat this screen should move for, or null when it must wait
  "token_pot": 0,
  "strings": { /* the viewer's translations for your string table */ },
  "locale": "es",
  "direction": "ltr"
}
```

Turns and your seat are seat indices, not player ids: the platform converts the server code's id-based turn into indices before sending the message (server code returning `turn: ["u1"]` arrives as `turn_of_player_indices: [0]`). The player ids are still in the message — each `players` entry has a `player_id` — but the turn and your seat are always indices. When the viewer is looking at a past move, the message also carries `replay: {index, total}`; render it read-only and never send a move.

Your page sends moves back:

```json
{"type": "make_move", "move": {"cell": 4}}
```

Rules:

- Render `view` if present, otherwise `state`. Never assume the full state is available — it is not.
- It is your turn when `status` is `"ongoing"`, `my_player_index` is not `null`, and `my_player_index` is in `turn_of_player_indices`. Disable input otherwise. A spectator (`my_player_index === null`) never moves.
- `acting_for_player_index` says the same thing in one field: the seat this screen should accept a move for right now, or `null` when it must wait. This is the signal single-device play runs on — in pass-and-play the viewer's seat rotates to the player to move, so `my_player_index` follows the turn and `acting_for_player_index` names the seat to move for on this device; against the computer it is your seat on your turn and `null` while the computer is to move. Checking either signal is fine; never send a move when `acting_for_player_index` is `null`.
- Post `game_ready` once, right after installing your `message` listener (see above).
- Send at most one `make_move` per `state_changed`. Do not send a move for a computer's turn — the server moves computers.
- If the player sends an illegal move, the server rejects it and the portal shows the error message — but the game iframe gets no callback. Design the client to only offer legal moves (disable illegal inputs) so a rejection is rare; after a rejection the game simply receives the next `state_changed` for the unchanged match.
- Call `applyLocale(message)` first in your `state_changed` handler, before drawing anything. It installs `message.strings`, `message.locale`, and `message.direction`.

### The translation string table

Every display string in the client must come from an `i18n-strings` JSON block. Put it in the page before your script:

```html
<script type="application/json" id="i18n-strings">
{
  "title": "Tic-tac-toe",
  "your_move": "Your move, {name}.",
  "waiting_for": "Waiting for {names}.",
  "wins": "{name} wins!",
  "server_the_game_is_over": "the game is over",
  "server_that_cell_is_taken": "that cell is taken",
  "server_send_cell_0_8": "send {cell: 0..8}"
}
</script>
```

Rules:

- At most 400 keys. Placeholders use `{name}` syntax; every placeholder in a translation must match the source exactly.
- Every key you use with `t("key")` must exist in the table, and every non-`server_` key must be used somewhere. No hard-coded display text in the page, no building sentences by concatenating strings, no markup inside strings.
- Every text your server writes — every `InvalidMove` reason, every log line, every state label the client shows — must have a matching `server_...` template key. The client translates server-written text back into the viewer's language by matching it against those templates, so the template text must match the server's message exactly, with `{placeholder}` standing for any varying part.
- The client must call `applyLocale(`. Use a `t(key, params)` helper that looks a key up in the installed translations (falling back to the source table) and fills `{placeholders}`.
- Keep the page accessible and responsive: readable on phones, tablets, and laptops, in portrait and landscape. Clickable targets at least 30 by 30 CSS pixels. Text contrast at least 4.5:1 (3:1 for large text and essential control boundaries).

## 5. Translations

`translations` has exactly one entry for each language other than the game's own language. If the game is written in English, the keys are exactly `es, fr, de, pt, zh, hi, ar`. Missing or extra languages are rejected. Each entry has:

```json
{
  "display_name": "…",
  "short_description": "…",
  "game_logic_rules": "…",
  "game_ui_rules": "…",
  "tutorial_strings": { "<tutorial string>": "<translation>" },
  "client_strings": { "<string-table key>": "<translation>" }
}
```

- `display_name`, `short_description`, `game_logic_rules`, `game_ui_rules` are the translations of `name`, `description`, `rules`, and `ui_instructions`.
- `tutorial_strings` maps every string in the tutorial vocabulary to its translation. The vocabulary is the distinct display strings in `tutorial.html`.
- `client_strings` maps every key of the `i18n-strings` table to its translation. Exact key coverage is required: no missing keys, no extra keys.
- Every `{placeholder}` must be preserved exactly: the set of placeholders in each translation must equal the set in the source text.
- Values must be non-empty.
- The source language's entry is synthesized by the platform from your own texts, so the published game carries all 8 languages. Your supplied translations are also seeded into the portal's translation bundle, so the game's name, description, and in-game strings show translated from the first request instead of waiting for a machine translation.

## 6. Unit tests

`unit_tests` is `{state_schema, view_schema, move_schema, cases}`. The three schemas are Draft 2020-12 JSON Schemas describing your state, view, and move shapes. The platform validates every state, move, and view against them at runtime, so write them to describe the real shapes — not `{"type": "object"}` for everything.

`cases` is an array of 3–10 test cases: 1–2 `initial`, 1–4 `intermediate`, 1–4 `terminal`. Each case has:

| Key | Meaning |
|---|---|
| `name`, `description` | What the case covers. Names must be unique. |
| `kind` | `"initial"`, `"intermediate"`, or `"terminal"`. |
| `ctx` | Fixed context: `{players: [{id, kind, display_name, picture_url, max_loss}], pot, move_count, seed}`. `move_count` is an integer ≥ 0, `seed` an integer, `players` a non-empty list of players with non-empty string ids. The number of players must be one of `allowed_player_counts` — a human plus a computer is two seats. |
| `state` | The state before the move. |
| `player_id`, `other_player_id` | Who moves, and another player (used for the other player's view). |
| `move` | The move to apply. |
| `expected_state` | The exact state after the move. |
| `expected_turn` | The exact turn after the move, or `null` for a terminal case. |
| `expected_payouts` | Required when `expected_turn` is `null`: the exact terminal payouts dict. |
| `view_of_mover`, `view_of_other` | The expected `viewFor` outputs before the move, for the mover and the other player. |
| `expected_view_of_mover`, `expected_view_of_other` | The expected `viewFor` outputs after the move. |
| `images` | Exactly 4 `{caption, svg}` view illustrations for the case. |

The platform runs every case (`newMatch`, `viewFor` for the mover and the other player before and after, `applyMove` or `playerLeft`) and checks the exact expected state, turn, payouts, and views — and runs every call twice to check determinism. Spectator views are exercised by the random walks (section 8), not by cases. Write cases from the rules, not from a recorded play-through: a wrong expected value that you copied from a buggy run proves nothing.

Two extra case forms are supported:

- **Negative cases:** set `expected_error: "InvalidMove"` (and omit the after-state expectations). The case passes only if `applyMove` rejects the move with `InvalidMove` — not if it throws anything else, and not if it accepts the move. The views must still be the before-state views, since a rejected move does not advance the match: `expected_state` must equal `state`, the expected views must equal the before views, and the case must carry `turn` — the turn before the move, equal to `expected_turn`.
- **Leave cases:** set `move` to `null` or to `{"type": "leave"}`. The case is executed through `playerLeft` instead of `applyMove`, and requires `playerLeft` to be implemented. Use these to pin down forfeit payouts and post-end leave behavior.

## 7. Updating a game, and the request secret

`game_addition_request_id_and_secret` is a string you pick when creating the game — a long random secret, 16–200 characters. It is required on every request: without it, the request is rejected with a 422 and nothing is inserted. Keep it secret: anyone holding it can update the game.

- Send the same string again to update the game created with it instead of creating a duplicate. The name, description, rules, code, server code, schemas, and translations are replaced, and the game becomes a new version — but only if something actually changed. A resubmission that changes nothing returns the game as is, same version.
- If you lose the secret, you cannot update the game — you can only create a new one (with a new secret).
- A resubmission updates the game in place — and republishes it if it had been unpublished: the import always publishes.
- Always pick a fresh secret per game, and store it with the game's id. Never reuse one secret for two games.

## 8. What the platform validates

Every check below runs before anything is written. A failure returns 422 and nothing is inserted. The checks run in this order:

1. **Request shape.** Content-Type, no content encoding, Content-Length ≤ 900,000 bytes, 15 s upload deadline, at most 2 concurrent validations (429 + `Retry-After: 15` when busy).
2. **Payload schema.** Strict model validation: field lengths, `language` one of the 8 locales, `allowed_player_counts` unique integers 1–10, each code field 1–200,000 bytes, 4–6 images, the required secret (16–200 characters).
3. **Artifact validation.** The understanding, identity, logic, UI, tutorial, images, and tests artifacts are validated: schemas are real Draft 2020-12 JSON Schemas, unit tests have 3–10 cases with initial/intermediate/terminal coverage, images meet the size and format rules, the tutorial HTML contains a viewport.
4. **Translations — all 8 languages.** Exactly the 7 non-source languages; exact key coverage of the client string table and the tutorial vocabulary; non-empty values; exact `{placeholder}` preservation for every translated field.
5. **Size caps.** Each SVG ≤ 120,000 bytes, combined package ≤ 400,000 bytes, stored package ≤ 900,000 bytes.
6. **Test-case rosters.** Every unit test's `ctx.players` length must be one of `allowed_player_counts`.
7. **Deterministic verification suite** — five checks, all run in QuickJS:
   - **Approved examples.** Every unit test case runs `newMatch`, `viewFor` (mover and other/spectator, before and after), `applyMove` (or `playerLeft`) and checks the exact expected state, turn, payouts, and views; every call runs twice for determinism.
   - **Settlement probes.** Non-seat leave rejected; forfeit with 2 humans, solo, and human-vs-computer (the pot goes to the departing human only, never a computer); post-end leaves return recorded state and payouts unchanged; a continuing leave excludes the leaver from the turn; a duplicate leave is a no-op.
   - **Move agreement.** `randomMove` (24 samples) and `computerMove` (at every difficulty the game's state declares — see section 3; difficulty lives in `state.difficulty`, not in `ctx`) on every approved before-state plus a played-out mid-game position: every returned move must be accepted by `applyMove`. Generators must be deterministic, take ≤ 100 ms, and never return `null` on a live position — return an explicit pass move instead (section 3).
   - **Localization.** The string-table lint: a valid `i18n-strings` table (at most 400 keys), every `t("key")` used must exist, every non-`server_` key must be used, no hard-coded display text, no sentence-building by concatenation, no markup in strings, and every text the server writes must match a `server_...` template. The client must call `applyLocale(message)`.
   - **Random walks.** The server code is loaded in QuickJS (a load error fails the import) and played: up to 1000 walks of up to 1000 moves, each from a fresh random seed, a random player count from `allowed_player_counts`, each player randomly human or computer with a random stake. Each step picks a player from the turn, gets a move from `computerMove` or `randomMove` (each half the time), applies it with `applyMove`, and calls `viewFor` for every player and for a spectator. On about 2% of steps a player joins (`playerJoined`) or leaves (`playerLeft`). Malformed moves are fuzzed at every step — they must be rejected with `InvalidMove` or return a valid result, never crash. Every result is checked against its JSON Schema (state, move, view), and every function is called twice with identical arguments and seed — the results must be identical. Each call is limited to 100 ms and 64 MB (`playerLeft` gets 2 s, for `ctx.estimateWinChance`). Exceeding a limit, throwing anything other than `InvalidMove`, or returning an invalid result (empty turn, turn naming a non-player, payouts not summing to the pot or paying a computer, a leaver's payout outside 0..pot) is a game bug and fails the import. Reaching 1000 moves without the game ending is not an error. The whole suite runs in a 200-second subprocess; if no walk finishes in the budget the game is reported too slow.
8. **Failure reporting.** When verification fails, the 422 response names the failing checks and, for each failure, gives the exact reproduction: the function and error message (with the JavaScript stack), the walk's seed (replaying it reproduces the walk), the player count and move number, the `ctx` (players, pot, move count), the exact arguments passed to the function, the result it returned (when it returned one), how long the call took and how much memory it used against their limits, and the last few moves before the failure. The game is not inserted.

## 9. How to test before you submit

Testing is a **linear, five-step flow**, and it is not optional: the server records every step under your secret string, and `POST /games` refuses the game until it finds a complete run whose step 1 inputs are **identical** to the payload you submit. Step 1 is an API call you make **before** opening the test page at **https://buildplay.fun/game-test** — you store the inputs on the server, the page then pulls them by secret, and you play steps 2–5 there. Follow the steps in order, do not change any input mid-run — if a step fails, fix the code and start again from step 1.

**What the server remembers, and reopening the page.** Every trace — the step 2 run, each recorded move, each verified match — is stored on the server under the latest submission for your secret, and the `POST /games` gate counts all of them, including traces recorded by earlier page sessions. Reopening the page restarts its own walkthrough at step 2 (load the stored inputs by secret again), but nothing recorded is lost, so a long run can be finished across several page sessions. Two consequences. First, store step 1 exactly once: storing again — including pressing the page's **Submit the inputs** when a submission already exists — creates a new latest submission and orphans every trace recorded under the previous one. Second, submit the exact payload the traces belong to: fetch it back with `GET /game-test/submission?secret=<redacted> and post that body to `/games`, rather than a local file that may have drifted from what was stored. `GET /game-test/status?secret=<redacted> reports, per step, what is already recorded and exactly which configurations are still missing.

**What the page holds.** The page has a field for everything the submission carries (loading by secret fills them all from the stored payload):

- **Game name and secret string** — the name, and the same `game_addition_request_id_and_secret` you will submit with. The traces are recorded under this secret; it is how the server matches the run to the submission.
- **Short description**, **source language**, **rules text**, **UI instructions**, **tutorial** (text and HTML), **images** (the JSON array), and **translations** (the JSON object for the 7 non-source locales).
- **Server code** — the `game` object. **Client code** — the game page, including its `i18n-strings` block.
- **State, view, and move schemas** — the three JSON schemas.
- **Unit test cases** — a JSON list of cases, or the whole `unit_tests` object. Needed for the approved-examples check and the move-agreement check.
- **Allowed player counts** — e.g. `2`, or `1, 2, 4` — and the **leave / join** boxes if a player may leave or join mid-match.

**Step 1 — Store the inputs (API call).** POST the exact payload you will later submit to `https://buildplay.fun/game-test/submissions`:

```bash
curl -X POST https://buildplay.fun/game-test/submissions \
  -H 'Content-Type: application/json' \
  -d '{"secret": "<the payload's game_addition_request_id_and_secret>", "game_name": "<the game's name>", "body": <the payload itself>}'
```

Before storing anything, the server runs **the same verification as a final submission** on the payload — translations, images, and all the code checks of §8 — so a **422** here carries the full failure report; fix the payload and call again (nothing was stored). A **201** returns the `submission_id` and stores the inputs with the time of the call. Then open the test page, type the secret into the **Secret string** field, and press **Load stored inputs by secret**: the page fetches the stored payload (a `GET /game-test/submission` call with the secret as the query parameter), fills every field, and marks step 1 recorded — there is nothing to paste. (Storing again replaces the stored inputs and restarts the run; filling the fields by hand and pressing **Submit the inputs** makes the same call from the page.) From here on, the inputs are frozen: editing any field restarts the run.

You can check a run's progress at any time without the page: `GET https://buildplay.fun/game-test/status?secret=...` reports each step as complete or names exactly what is still missing.

**Step 2 — Server code tests.** Press **Run the server tests**. The server runs its tests on the submitted server code — the unit test cases (approved examples), the settlement probes, the move-agreement probes, and the random walks, calling each function twice to prove it is deterministic and idempotent — and records the run's metadata: how long it took, how many walks and moves it made, how many states were visited, and how many terminal states were reached. (The page's optional **local pre-checks** run the same checks instantly in the browser first, with the page's own limits — 5 s per call instead of the platform's 100 ms — so use them to iterate, but step 2 on the server is the run that counts.)

**Step 3 — Pass-and-play.** Press **Start step 3**, then play each pass-and-play match the page sets up **to the very end** — until there is no next turn. The page sets up **one match per allowed number of players**: player counts are the axis that matters here, because hands, turn rotation and per-player state all change with the count. Every move is recorded on the server as it happens, and when a match ends the page sends all its states and moves to the server, which replays them with the step 1 server code and verifies every transition and that the match ended in a terminal state. A match the server cannot verify fails the run. The submission check names the exact player counts no verified match has covered yet (e.g. "a match with 6 players"). Screen sizes and orientations are **not** step 3's axis: they are covered once across steps 3–5 together (see step 5), because a transition verifies identically at every size — each size only needs one recorded match somewhere in the run.

**Step 4 — Play against the computer.** Press **Start step 4** and play the matches the page sets up, up to 100 moves each: the smallest player count from its first and last seat, plus the largest player count from its last seat when the game allows more than one count — two matches for a single-count game, three otherwise. The seat is the axis that matters (a roster that mis-seats the human stalls the match); the computer's moves are computed on the server, so screen size and orientation add nothing here. Every move is recorded the same way.

**Step 5 — Multiplayer.** Press **Start step 5**. Like step 3 — one match per allowed player count — but the page opens **one frame per player**, each showing only that player's view, the way real multiplayer works. Play every seat from its own frame until the match is over; each finished match is sent to the server and verified exactly as in step 3. This step also carries the flow's shared screen coverage: across steps 3–5 together, each of the 5 screen sizes (two phones, two tablets, the laptop) and both orientations must come up at least once, and step 5's list adds a match for any size or orientation the earlier steps have not shown yet. The submission check names what is missing and charges it to step 5 (e.g. "a match at iPad Air 11-inch (tablet)").

**Submit.** When all five steps pass, the page shows the exact submission payload. POST it, unchanged, to `/games` with the same secret. The server finds the traces for the secret, takes the last step 1 submission, checks the payload is identical to it, and validates that steps 2–5 were completed for it. Then the usual submit-time verification runs, and a 201 publishes the game. A 422 that says the testing is incomplete names the missing steps — go back to the page and finish them (if the code changed at all, that means starting again from step 1).

While you play, watch the read-only state, view, and last-move panels: the view must show each player only what they may see, the turn must pass to the right seats, and a move must never be rejected that the game itself offered. Watch the log too: every `make_move` the client sends and every `state_changed` the page sends back is logged there and to the browser console. Like the portal, the page holds the first `state_changed` until the client posts `game_ready` (with the same 2-second fallback) and logs a note when the fallback fires — if you see that note, your client is missing the handshake. If the client posts anything else, or a `make_move` carrying a client-computed `new_state` instead of a `move`, the page says so — fix the client before submitting.

The manual checklist behind the page — do these even if the flow is green, because the page cannot check them all:

1. **Write the unit tests first, from the rules.** Pick the initial, intermediate, and terminal positions, compute the expected states, turns, payouts, and views by hand, and write them down before writing server code. A test written from a run of your own code cannot catch your own misunderstanding.
2. **Check the limits.** Time your slowest call (usually `computerMove` on an empty board, and `playerLeft` with `estimateWinChance`). If a call can exceed 100 ms, memoize or prune the search. If a state can grow without bound, cap it.
3. **Check the sizes.** Whole request ≤ 900,000 bytes; each code field ≤ 200,000 bytes; each SVG ≤ 120,000 bytes. Keep code tight and SVGs simple — schematic illustrations, not screenshots.
4. **Validate against the schema.** Fetch `GET https://buildplay.fun/games/schema` and check your payload against it (field names, types, lengths, the exact 7 translation locales).

A complete, minimal, working request — a counter game, "Count to three" — is in the repository at `examples/agent-game.json` (raw: `https://raw.githubusercontent.com/yoav-zibin/course/main/examples/agent-game.json`). Read it end to end before writing your own payload, and press **Load the counter example** on the test page to see the page working with it. It is the smallest payload that passes every check, and the fastest way to learn the exact shapes.

## 10. When the call fails: the fix-and-retry loop

A 422 is not a dead end — it is the platform telling you exactly what to fix. Work the loop:

1. **Read the `detail` field of the 422 response in full.** It names the failing checks. For verification failures it contains, per failure: the function and error message with the JavaScript stack, the walk's seed, the player count and move number, the `ctx`, the exact arguments, the result returned, how long the call took and how much memory it used against their limits, and the last few moves. Do not guess — the reproduction is in the response.
2. **Reproduce it locally if you can.** Replay the walk with the given seed, or call the named function with the exact arguments and `ctx` from the report. The seed is the key: the same seed reproduces the same walk.
3. **Fix the one thing the failure names.** Common fixes:
   - *Turn names a non-player / turn is empty:* the turn must list current player ids, or be `null` when over — never `[]`, never an id that left.
   - *Payouts do not sum to the pot / pay a computer:* terminal payouts must sum to exactly `ctx.pot` and go only to active humans.
   - *`InvalidMove` not thrown for a bad move:* validate the move shape and legality first in `applyMove`, before touching state.
   - *A function throws something other than `InvalidMove`:* that is a game bug — guard the input, handle the edge case (empty board, no legal moves, a player who already left).
   - *Call over 100 ms / 64 MB:* memoize the search, prune, or cap the state. `playerLeft` gets 2 s because of `estimateWinChance`; everything else gets 100 ms.
   - *Non-deterministic results:* find the unseeded `Math.random`, the `Date` read, or the module-level mutable state, and remove it.
   - *Translation incomplete / placeholder changed:* the `client_strings` keys must match the string table exactly, and every `{placeholder}` must be identical in source and translation.
   - *Missing `server_` template:* every `InvalidMove` message needs a `server_...` key whose text matches the message exactly.
   - *Unit-test expectation wrong:* recompute the expected state, turn, payouts, and views from the rules by hand. Do not copy them from a run.
   - *Roster outside `allowed_player_counts`:* a case's `ctx.players` length must be one of the allowed counts.
4. **Resubmit with the same `game_addition_request_id_and_secret`.** The resubmission updates the same game instead of creating a duplicate, and becomes a new version when something changed. Keep the secret safe and reuse it for every retry of the same game.
5. **Repeat until you get a 201.** Each 422 makes the next attempt more likely to pass, because the report points at the next real bug. If the same failure repeats, you have not fixed what it names — re-read the reproduction block, arguments and all.
6. **Never blindly retry a request whose response was lost.** If you do not know whether a POST went through, first check `GET /games` (or `GET /games/{id}` if you have an id) and compare name and source — or resubmit with the same secret, which updates instead of duplicating. Do not submit the same game twice without the secret.
7. **Do not work around a validation failure.** Do not weaken a schema to accept an invalid value, do not drop a failing unit test, and do not remove a check by changing the game to avoid the tested path. Fix the game.

## 11. After it is published

- A 201 means the game is live for every player, in every language. Verify it: `GET https://buildplay.fun/games/{id}` returns the game, published, with the right version; `GET https://buildplay.fun/games/{id}/versions/{version}/strings?lang=es` returns `status: "translated"`; the game appears in the portal at `https://buildplay.fun/portal`.
- Play it. Start a match, make moves, and check the views show what each player should see and nothing they should not. If you find a bug, fix it and resubmit with the same secret — the fix becomes a new version, and matches already in progress keep the old version.
- Keep the request secret with the game id. Without it you cannot update the game.

## 12. Common pitfalls

- Writing the game in a language and translating only some of the 7 other locales, or adding the source language to `translations` (it is synthesized — do not send it).
- A `{placeholder}` that differs between source and translation, or a translated string that drops one.
- An `InvalidMove` message with no `server_...` template, or a template whose text does not match the message exactly.
- Hard-coded English in the client, or a string built by concatenation.
- `turn: []` instead of `turn: null` when the match ends.
- Payouts that do not sum to `ctx.pot`, or that pay a computer or an inactive player.
- `computerMove` or `randomMove` returning a move `applyMove` rejects, or `null` on a live position.
- `viewFor` leaking hidden state (opponents' hands, the deck, unrevealed dice).
- Non-determinism: unseeded randomness, `Date.now()`, module-level mutable state.
- A search that exceeds 100 ms on the worst position (empty board, opening move).
- Unit-test cases whose expected values were copied from a run instead of computed from the rules.
- Forgetting that a human plus a computer is two seats: case rosters must match `allowed_player_counts`.
- Submitting without the secret, then submitting again and creating a duplicate game.
- Claiming a game is published without a 201 and a saved game id.
- Assuming a failed random-walk verification means the game is wrong: the walks run until 1,000 walks complete or the walk budget (8 seconds of game-logic time) runs out, so a correct game whose matches run very long can occasionally fail on an unlucky draw. Resubmitting draws fresh walks and usually passes; keeping typical match length modest where the rules allow keeps every check fast.
