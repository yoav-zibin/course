# Complete game imports for agents

For writing a game, start with [GAME_DEVELOPMENT_GUIDE.md](../GAME_DEVELOPMENT_GUIDE.md);
this document is the endpoint reference.

`POST /games` accepts a complete game and publishes it in one request:
the game is live for every player, in every language, as soon as the call
returns. It does not overwrite other games, call a paid model, or claim human approval:
resubmitting with the same `game_addition_request_id_and_secret` updates the game
it created (a new version if anything changed).
Imported source is checked but not visually reviewed by this API. Retain the
original payload for comparison.

## Authentication and ownership

Credentials are optional. Send the existing account credentials in
`X-User-Id` and `X-User-Password` to own the published game; without them the
game is published ownerless (owner `agent-import`), and no one can edit or
unpublish it. Credentials that are sent but invalid return 401. Use HTTPS
except on loopback. Never put passwords in URLs, payload files or source
control. All authenticated platform users (including guest accounts)
can publish their own game. Ownership comes exclusively from
authentication. Unknown fields, including IDs, owners, publication and approval
flags, are rejected. Missing credentials no longer return 401; invalid ones do,
before reading the body. This does not introduce an admin-only policy or an
independent API-key system.

## Request

Content-Type: `application/json`. The machine-readable schema is available through
an unauthenticated `GET /games/schema`.

Required fields:

- `name`, `description`, `allowed_player_counts` (unique integers 1–10).
- `client_code`: complete iframe HTML following the v2 message and translation contracts.
- `server_code`: deterministic QuickJS JavaScript implementing the platform game API.
- `rules`, `ui_instructions`: substantive specifications.
- `tutorial`: `{text, html}`, with a responsive viewport; interactive tutorials
  must meet the existing localization contract.
- `images`: 4–6 `{caption, svg}` entries: a 16:9 text-free cover, then 3–5 supporting images.
- `unit_tests`: `state_schema`, `view_schema`, `move_schema`, and 3–10 `cases`.
  Include initial, intermediate and terminal examples, complete expected player
  and spectator views, fixed context/seed and terminal payouts. Each case includes
  four `{caption, svg}` view illustrations.
- `translations`: the game's texts translated into every language but the one it
  is written in (7 entries when the game is written in English: `es`, `fr`, `de`,
  `pt`, `zh`, `hi`, `ar`). Each entry has `display_name`, `short_description`,
  `game_logic_rules`, `game_ui_rules`, `tutorial_strings` (every tutorial string
  mapped to its translation) and `client_strings` (every key of the game's
  `i18n-strings` table mapped to its translation). Translations must keep every
  `{placeholder}`. The source language's entry is synthesized server-side, so the
  published game carries translations for all 8 languages. The supplied
  translations are also stored as the portal bundle's translations, so the game's
  name, description and in-game strings show translated from the first request
  instead of waiting for a machine translation.

Runtime `game_schemas` are derived from the three unit-test schemas and persisted
with the game; agents do not submit a second potentially inconsistent copy.

Optional: `language` (default `en`), `allows_join_mid_match` and
`allows_leave_mid_match` (both default false). Do not enable unsupported handlers.
`game_addition_request_id_and_secret` (required, 16–200 characters) is a string
the agent picks when creating the game — a long random secret. Sending the same
string again updates the game created with it instead of creating a duplicate:
the name, description, rules, code, server code, schemas and translations are
replaced and the game becomes a new version (a resubmission that changes nothing
returns the game as is). Anyone holding the string can update the game, so keep
it secret; a request without it is rejected.
See [the server API](server-side-game-api.md), [translation contract](game-translation.md)
and `game_artifacts.validate_artifact` for the authoritative detailed contracts.
`examples/agent-game.json` is a runnable counter-game request example.
Its test images are schematic illustrations, not captured gameplay screenshots.

## What the endpoint validates

Every check below runs before any write: a failure returns 422 and nothing
is inserted. The checks, in order:

1. **Request shape.** `Content-Type: application/json`, no content encoding,
   `Content-Length` ≤ 900,000 bytes, 15 s upload deadline, at most 2
   concurrent validations (429 + `Retry-After: 15` when busy).
2. **Payload schema.** Strict pydantic model (`extra='forbid'`): `name`
   1–200 chars, `description` 1–2000, `rules`/`ui_instructions` 1–20000,
   `language` one of the 8 supported locales, `allowed_player_counts`
   unique integers 1–10, each code field 1–200,000 chars, 4–6 images,
   `game_addition_request_id_and_secret` 16–200 chars, required.
2a. **Recorded test flow.** The game must have completed the five-step test
   flow under this secret (guide §9): the endpoint looks up
   the traces recorded for `game_addition_request_id_and_secret`, takes the
   last step 1 submission, requires this payload to be identical to it, and
   requires steps 2–5 complete for it (server code tests passed; one verified
   pass-and-play match and one verified multiplayer match per allowed player
   count; every screen size and both orientations covered at least once
   across steps 3–5 together; recorded against-the-computer matches for the
   required seat pairs — the smallest player count from its first and last
   seat, plus the largest count from its last seat).
   A shortfall returns 422 naming the missing steps. Any code change after
   step 1 therefore needs a fresh run before resubmitting. Step 1 itself is
   the `POST /game-test/submissions` call, which runs this endpoint's full
   verification (checks 2–8) on the payload before storing it; the test page
   fetches the stored inputs back with `GET /game-test/submission?secret=`.
3. **Translations — all 8 languages.** `translations` must cover exactly the
   7 languages other than the game's own language. Each entry is checked for
   exact key coverage of the client string table and the tutorial vocabulary,
   non-empty values, and exact `{placeholder}` preservation for
   `display_name`, `short_description`, `game_logic_rules`,
   `game_ui_rules`, tutorial strings and client strings. The source
   language's entry is synthesized server-side, so the published game
   carries translations for all 8 languages (en, es, fr, de, pt, zh, hi,
   ar). The supplied translations are seeded into the portal bundle, so the
   game shows translated from the first request.
4. **Artifact validation (all 7 steps).** The understanding, identity, logic,
   UI, tutorial, images and tests artifacts are validated against the game
   artifact contract: schemas are real Draft 2020-12 JSON Schemas, unit tests
   have 3–10 cases with initial/intermediate/terminal coverage, images meet
   the size/format rules.
5. **Test-case rosters.** Every unit test's `ctx.players` length must be one
   of `allowed_player_counts` (a human plus a computer is two seats).
6. **Localization lint.** The client code must have a valid `i18n-strings`
   table (≤ 400 keys), every `t("key")` used must exist, every non-`server_`
   key must be used, no hard-coded display text, no sentence-building by
   concatenation, no markup in strings, and every text the server writes
   (every `InvalidMove` reason, log line, state label) must match a
   `server_…` template. The client must call `applyLocale(`.
7. **Size caps.** Each SVG ≤ 120,000 bytes, combined workflow ≤ 400,000
   bytes, stored package ≤ 900,000 bytes.
8. **Deterministic verification suite** (`run_checks`, all five checks):
   - **Approved examples.** Every unit test case runs `newMatch`, `viewFor`
     (mover and other/spectator, before and after), `applyMove` (or
     `playerLeft`) and checks the exact expected state, turn, payouts and
     views; every call runs twice for determinism.
   - **Settlement probes.** Non-seat leave rejected; forfeit with 2 humans /
     solo / human-vs-computer (pot to the departing human only, never a
     computer); post-end leaves return recorded state/payouts unchanged;
     continuing leave excludes the leaver from the turn; duplicate leave is
     a no-op.
   - **Move agreement.** `randomMove` (24 samples) and `computerMove`
     (every difficulty) on every approved before-state plus a played-out
     mid-game position: every returned move must be accepted by `applyMove`;
     generators deterministic, ≤ 100 ms, never null on a live position.
   - **Localization.** The lint from (6), plus the client must call
     `applyLocale(message)`.
   - **Random walks.** The server code is loaded in QuickJS (a load error
     fails the import) and played: up to 1000 walks of up to 1000 moves,
     each from a fresh random seed, a random player count from
     `allowed_player_counts`, each player randomly human or computer with a
     random stake. Each step picks a player from the turn, gets a move from
     `computerMove` or `randomMove` (each half the time), applies it with
     `applyMove`, and calls `viewFor` for every player and for a spectator.
     On ~2% of steps a player joins (`playerJoined`) or leaves
     (`playerLeft`). Malformed moves are fuzzed at every step (they must be
     rejected with `InvalidMove` or return a valid result, never crash).
     Every result is checked against its JSON Schema (state, move, view),
     and every function is called twice with identical arguments and seed —
     the results must be identical (determinism). Each call is limited to
     100 ms and 64 MB (`playerLeft` gets 2 s, for `ctx.estimateWinChance`).
     Exceeding a limit, throwing anything other than `InvalidMove`, or
     returning an invalid result (empty turn, turn naming a non-player,
     payouts not summing to the pot or paying a computer, a leaver's payout
     outside 0..pot) is a game bug and fails the import. Reaching 1000
     moves without the game ending is not an error. The whole suite runs
     in a 200 s subprocess; if no walk finishes in the budget the game is
     reported too slow.
9. **Failure reporting.** When verification fails, the 422 response names
   the failing checks and, for each failure, gives the exact reproduction:
   the function and error message (with the JavaScript stack), the walk's
   seed (replaying it reproduces the walk), the player count and move
   number, the `ctx` (players, pot, move count), the exact arguments passed
   to the function, the result it returned (when it returned one), how long
   the call took and how much memory it used against their limits, and the
   last few moves before the failure. The game is not inserted.

## Limits and responses

Limits count UTF-8 bytes: entire request 900,000; each code field 200,000; each
SVG 120,000; combined import package 400,000 (the translations count toward it).
Existing tutorial/artifact limits also apply. The smaller combined limit leaves
room under Firestore's document limit for both code fields and package metadata.
The complete stored package, including the derived runtime-schema copy, is also
capped at 900,000 serialized bytes. Compressed uploads are rejected.
Chunked requests have the same cumulative limit. Uploads have a 15-second deadline.

- 201: complete `GameOut` for the published game (version 1 on create, higher on an update); save its `id`.
- 401: invalid credentials that were sent.
- 400: malformed Content-Length.
- 408: upload deadline exceeded.
- 413: request too large.
- 415: unsupported media type or content encoding.
- 422: malformed payload, missing or incomplete translations, artifact validation or code checks failed/timed out.
- 429: both per-process import/validation slots occupied; retry after 15 seconds.
- 5xx: infrastructure/storage failure; do not assume success.

Validation runs before any storage write, reusing the game artifact validators,
example tests, localization checks, random walks and the existing QuickJS limits.
An isolated validator process has a 200-second wall deadline, including schema
validation. Errors never echo the full submitted source. Persistence creates the
published game (or updates the one carrying the same request secret), with the import package (including translations) stored
with it, and seeds the portal bundle with the supplied translations.

The endpoint is not idempotent without a request id: do not blindly retry a
request whose response was lost. First inspect the published games and compare
name and source — or send the same `game_addition_request_id_and_secret` again,
which updates the game instead of duplicating it. This version
has bounded concurrent validation per server process, not distributed user quotas.

## Example agent client

```python
import json, os
import httpx

base = os.environ['BUILDPLAY_BASE_URL'].rstrip('/')
headers = {}
if os.environ.get('BUILDPLAY_USER_ID'):
    headers = {'X-User-Id': os.environ['BUILDPLAY_USER_ID'],
               'X-User-Password': os.environ['BUILDPLAY_USER_PASSWORD']}
with open('examples/agent-game.json') as f:
    game = json.load(f)
response = httpx.post(base + '/games', headers=headers, json=game, timeout=35)
response.raise_for_status()
published = response.json()
print(published['id'], published['version'])
```

## Instructions for a game-writing agent

1. Read the agreed spreadsheet row and instruction document, if supplied. State
   variants and supported player counts. Do not copy or edit an existing game.
2. Read the contracts linked above. Design rules, legal moves, hidden-information
   filtering, deterministic randomness, terminal conditions and exact pot payouts.
3. Implement server code and responsive client code; provide tutorial, cover and
   supporting illustrations. Use translation tables, accessible controls and
   player/spectator views. Never expose secret state through `viewFor`.
4. Write independent rule assertions and illegal-move/privacy tests, plus the
   required initial/intermediate/terminal examples. Generated replay snapshots
   alone do not establish rule correctness. Run random walks to completion and
   local UI checks using `/game-test` across supported player modes, phone, tablet
   and laptop sizes, in portrait and landscape. Enter both game files, select
   each supported player count in turn, and play several randomly chosen matches
   to completion in each scenario. Check clickable targets are at least
   30 by 30 CSS pixels and contrast is at least 4.5:1 for normal text and 3:1
   for large text and essential control boundaries. Repeat logic calls with
   identical inputs, context and random seed to check determinism; applying a
   move twice to successive states is not an equivalent idempotence test. Report
   what was actually tested, including any untested modes or viewports. Save the
   recording, wait for the server confirmation, then reload and replay the
   recording by ID to verify persistence. The matrix's sticky replay bar can
   follow the active scenario or focus one at a time. Browser access must be
   provided to the agent separately; the text-only generation API cannot itself
   operate the page.
5. Submit only to the agreed isolated test instance with your assigned account.
   Record the response ID and validation results. A 201 means the game is
   published; never claim otherwise.
6. Obtain deployment/publication authorization where needed before submitting to
   production. Do not alter production settings, existing games or other users' games.

For a batch, assign one game per agent only when delegation is explicitly
requested. Keep credentials out of agent prompts and payload artifacts. Track
successes and failures individually; do not silently substitute duplicate games.
