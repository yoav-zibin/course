# Complete game imports for agents

For writing a game, start with [GAME_DEVELOPMENT_GUIDE.md](../GAME_DEVELOPMENT_GUIDE.md);
this document is the endpoint reference.

`POST /games` accepts a complete game and publishes it in one request:
the game is live for every player, in every language, as soon as the call
returns. `POST /games/declarative` is an alias for creating the same kind of game.
Both POST routes create games only. Use `PATCH /games/{game_id}` to update an
existing game; reusing an existing submission secret in a POST is rejected with
guidance to use PATCH. The API does not call a paid model or claim human approval.
Imported source is checked but not visually reviewed by this API. Retain the
original payload for comparison.

For [declarative games](declarative-games.md), supply `declarative_ui` instead
of `client_code`. `POST /games/declarative` is the same publication path with
the declarative package required. It keeps all existing artifact, translation,
server-rule and recorded-test checks. The schema is at
`GET /games/declarative/schema`; `POST /games/declarative/validate` is a
non-persisting QuickJS presentation probe, not a publication/test-flow bypass.

## Platform games and authorization

All games belong to the platform. Creating a game requires no user ID or account
credentials, and no creator or owner user ID is stored or returned. Each new
game requires a private submission secret. Keep that secret to authorize future
updates. Deletion and unpublishing require `X-Game-Secret` with that secret, or
HTTP Basic authentication with the configured master password. Game-content
updates require the game secret or master password in the PATCH JSON body, as
described below. User account credentials do not authorize game changes.

This game-content capability is separate from administration. Admin pages use
Google sign-in with the fixed `admin_google_emails` list in private VM config;
unattended admin APIs use the configured master password through HTTP Basic.
Neither admin sign-in nor that API key replaces the game secret or master
password required for game-content writes.

Use HTTPS except on loopback. Never put passwords in URLs, payload files or
source control. Unknown fields, including `id`, owner, publication and approval
flags, are rejected. Updates name their target in the PATCH URL.

## Request

Content-Type: `application/json`. The machine-readable schema is available through
an unauthenticated `GET /games/schema`.

Required fields:

- `name`, `description`, `allowed_player_counts` (unique integers 1–10).
- `alternative_names` is a required array of up to 16 distinct names, each
  1–80 characters. Include established alternate titles, spellings and
  names in other languages for the same game. For example, Chess can include
  `["Ajedrez", "Échecs", "Schach"]`. Supply `[]` when there are no known
  alternatives. Portal search uses these names alongside the display title.
- `declarative_ui`: a portable package following
  `schemas/declarative-ui.schema.json`. Omit `client_code`; the platform generates
  its compatibility host. HTML game submissions are rejected.
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
  declarative `strings` map mapped to its translation). Translations must keep every
  `{placeholder}`. The source language's entry is synthesized server-side, so the
  published game carries translations for all 8 languages. The supplied
  translations are also stored as the portal bundle's translations, so the game's
  name, description and in-game strings show translated from the first request
  instead of waiting for a machine translation.

Runtime `game_schemas` are derived from the three unit-test schemas and persisted
with the game; agents do not submit a second potentially inconsistent copy.

Optional: `language` (default `en`), `allows_join_mid_match` and
`allows_leave_mid_match` (both default false). Do not enable unsupported handlers.
`all_state_public` is a Boolean, default false. Set it to true only when every
player can see all game state, as in chess or backgammon. Games with private
hands, boards or identities must keep it false. Public-state games skip the
device handoff between turns in local pass-and-play. The flag is versioned and
included in catalog summaries and game details.
`game_addition_request_id_and_secret` (required, 16–200 characters) is a long
random secret the agent picks when creating the game. Keep it for future PATCH
updates. Only its SHA-256 hash is stored on the game; API responses never return
the secret. Reusing a secret in either POST route is rejected, so a retry cannot
silently create a duplicate or change an existing game. The configured master
password authorizes updates only; it cannot be used to create a game. Do not
send `game_id` in a creation request.

See [the server API](server-side-game-api.md), [translation contract](game-translation.md)
and `game_artifacts.validate_artifact` for the authoritative detailed contracts.
`examples/agent-game.json` is a runnable counter-game request example.
Its test images are schematic illustrations, not captured gameplay screenshots.

## Updating a game

`PATCH /games/{game_id}` is the single API for changing game content. The URL
must identify an existing game. The JSON body must include
`game_addition_request_id_and_secret`, containing either that game's original
submission secret or the configured master password. A different game's
secret is rejected. An optional body `game_id` must match the URL; it is useful
when sending an already tested complete payload. User account credentials do
not authorize a patch; use the game secret or master password.
A master-password update preserves the game's original secret.

Every content field accepted by the complete import is optional in PATCH:
`name`, `description`, `allowed_player_counts`, `allows_leave_mid_match`,
`allows_join_mid_match`, `all_state_public`, `declarative_ui`, `client_code`, `server_code`,
`language`, `rules`, `ui_instructions`, `tutorial`, `images`, `unit_tests`,
and `translations`. Omitted fields retain their current values. Supplied
objects and lists replace that field, so send a complete replacement object
for `declarative_ui`, `unit_tests`, `tutorial`, or `translations`. Explicit
`null` and unknown fields are rejected. Runtime state/move/view schemas are
derived from `unit_tests`; change those schemas through that field.
The PATCH request schema is in `/openapi.json` and `/docs`.

The server combines the supplied fields with the current version, compares
actual values, and validates the fields and dependencies that changed:

| Actual change | Validation |
|---|---|
| `server_code`, `unit_tests`, allowed player counts or join/leave behavior | Validate test artifacts, schemas and rosters; run approved examples, settlement and move checks, and random walks against the resulting server logic. A fresh recorded presentation test flow is not required when the presentation is unchanged. |
| `declarative_ui` or its generated `client_code` | Validate the resulting presentation and localization, including its examples, and require the complete recorded `/game-test/*` flow for the resulting full payload. Review the changed scenes and interactions in the scene playground. |
| Name, description, textual `rules`, `ui_instructions`, tutorial, images, language or translations | Validate the relevant text, translation, tutorial or image contracts and size limits. Do not run random walks or require a recorded presentation test flow for these edits alone. |
| `all_state_public` | Validate the Boolean and size limits; no server-logic checks or recorded presentation test flow are required for this metadata edit. |
| Supplied values equal the current values | No new game version or heavy validation. |

Changing textual `rules` documents the game; changing `allowed_player_counts`
or join/leave flags changes runtime behavior and requires server verification.
If several categories change, their validations all apply. Existing fields
remain available to validate dependencies: for example, changed unit tests run
against the retained server code, and changed server code uses retained tests.
A patch cannot remove required code or leave the stored package and runtime
schemas inconsistent. Versions already used by matches retain their original
code, presentation and metadata.

For a presentation update, construct the complete resulting import payload,
record the full test flow for it under the credential used by PATCH, and then
send the changed fields to PATCH. Trace matching uses that merged payload,
not the small patch body. When using the master password, record the flow under
the master password; the target game ID is excluded from trace identity.

For example, renaming a game requires no gameplay validation:

```python
response = httpx.patch(
    base + '/games/' + published['id'],
    json={
        'game_addition_request_id_and_secret': os.environ['BUILDPLAY_GAME_SECRET'],
        'name': 'A clearer game name',
    },
    timeout=35,
)
response.raise_for_status()
updated = response.json()
```

A successful PATCH returns 200 with `GameOut`; an actual content change creates
a new version. Before this change, both POST routes could update by secret and
PATCH accepted owner credentials. Migrate existing update clients to PATCH,
retain the published game ID, and include the game secret or master password
in every update.

To edit search names, send `alternative_names` with the complete replacement
array. Send `[]` to clear it or omit the field to keep the current names.

## What creation validates

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
   REST flow under this secret: the endpoint looks up
   the traces recorded for `game_addition_request_id_and_secret`, takes the
   last step 1 submission, matches the payload with search names excluded, and
   requires steps 2–5 complete for it (server code tests passed; one verified
   pass-and-play match and one verified multiplayer match per allowed player
   count; every screen size and both orientations covered at least once
   across steps 3–5 together; recorded against-the-computer matches for the
   required seat pairs — the smallest player count from its first and last
   seat, plus the largest count from its last seat).
   A shortfall returns 422 naming the missing steps. Any code change after
   step 1 therefore needs a fresh run before resubmitting. Step 1 itself is
   the `POST /game-test/submissions` call, which runs this endpoint's full
   verification (checks 2–8) on the payload before storing it. Retrieve the stored
   inputs with `GET /game-test/submission?secret=`.
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
6. **Declarative localization.** The package declares its finite `strings` map
   (≤ 400 keys); translations must cover those keys and preserve placeholders.
   Every text the server writes (including `InvalidMove` reasons, log lines and
   state labels) must match a `server_…` template. Render UI text from the
   viewer's `message.strings`, using whole translated templates rather than
   building sentences from fragments. The host supplies locale and direction.
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
   - **Localization.** The declared strings and server-text checks from (6).
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

- 201: complete `GameOut` for the newly published game, version 1; save its `id`.
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
published game with its import package (including translations), and seeds the
portal bundle with the supplied translations.

If a creation response is lost, inspect the published games and compare name
and source before retrying. Reusing the same submission secret will be rejected
if the first request succeeded. Save the game ID and use PATCH for subsequent
changes. Validation concurrency is bounded per server process; there are no
distributed user quotas.

## Example agent client

After recording steps 1–5 for the exact payload, publish it with:

```python
import json, os
import httpx

base = os.environ['BUILDPLAY_BASE_URL'].rstrip('/')
with open('examples/agent-game.json') as f:
    game = json.load(f)
response = httpx.post(base + '/games', json=game, timeout=35)
response.raise_for_status()
published = response.json()
print(published['id'], published['version'])
```

## Instructions for a game-writing agent

Use steps 1–6 below for an authorized new-game task. For an explicitly authorized
edit to an existing game, use the update workflow afterward. Keep unrelated games
and production settings outside the task's scope.

1. Read the agreed spreadsheet row and instruction document, if supplied. State
   variants and supported player counts. Do not copy or edit an existing game.
2. Read the contracts linked above. Design rules, legal moves, hidden-information
   filtering, deterministic randomness, terminal conditions and exact pot payouts.
3. Implement server rules and a declarative presentation; provide tutorial, cover and
   supporting illustrations. Use translation tables, accessible controls and
   player/spectator views. Never expose secret state through `viewFor`.
4. Write independent rule assertions and illegal-move/privacy tests, plus the
   required initial/intermediate/terminal examples. Generated replay snapshots
   alone do not establish rule correctness. Run random walks to completion.
   Inspect scenes, layout and gestures in `/static/declarative-test.html` on
   phone, tablet and laptop sizes in both orientations. This playground emits
   UI events and previews scenes; it does not apply the game's rules or play
   complete matches. Exercise actual gameplay in browser integration tests and
   record steps 1–5 through the `/game-test/*` REST endpoints. The
   `tools/publish_declarative_games.py` example records rules and presentation
   traces for server replay; browser checks provide the layout and gesture
   evidence separately. Cover every supported player count and the required
   pass-and-play, multiplayer and computer-seat scenarios. Keep fixed controls
   usable, and verify pieces and targets reach at least 32×32 CSS pixels when
   magnified for precise play. Require contrast of 4.5:1 for normal text and
   3:1 for large text and essential control boundaries. Repeat logic calls with
   identical inputs, context and random seed to check determinism; applying a
   move twice to successive states is not an equivalent idempotence test. Report
   what was actually tested, including any untested modes or viewports. Save the
   traces, wait for server verification, then retrieve the stored submission
   and replay traces to verify persistence. Browser access must be provided to
   the agent separately; the text-only generation API cannot operate the page.
5. Submit only to the agreed isolated test instance with your assigned account.
   Record the response ID and validation results. A 201 means the game is
   published; never claim otherwise.
6. Obtain deployment/publication authorization where needed before submitting to
   production. Do not alter production settings, existing games or other users' games.

For an authorized existing-game edit:

1. Read the current game and identify its exact game ID. Read its submission secret
   or the configured master password privately; never paste it into prompts, logs,
   source control or saved payload artifacts.
2. Prepare only the changed content fields for `PATCH /games/{game_id}`. Inject
   `game_addition_request_id_and_secret` when sending the request. Omit unchanged
   fields instead of sending `null`; schemas are part of `unit_tests`, not a
   separate `game_schemas` field. Account credentials or HTTP Basic alone do not
   authorize this endpoint.
3. For server code, unit tests or mechanical rules, run their relevant correctness,
   schema, example, determinism and random-walk checks. For declarative presentation
   changes, test the complete merged package and record the required REST flow
   with the same update credential. For names, descriptions, textual rules, images
   and other metadata, use the relevant artifact/translation checks. Keep any
   broader audit coverage explicitly required by the task; the API does not require
   random walks or test-page evidence for every metadata patch.
4. Send the PATCH, expect HTTP 200, and verify the returned game ID/version and
   requested changes. Preserve its original secret and historical versions. If the
   response is lost, inspect that same game before retrying. Both POST game routes
   create new games only and must not be used to update an existing game.

For a batch, assign one game per agent only when delegation is explicitly
requested. Keep credentials out of agent prompts and payload artifacts. Track
successes and failures individually; do not silently substitute duplicate games.
