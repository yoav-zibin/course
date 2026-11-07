# Complete game imports for agents

`POST /agent/games` accepts a complete game and publishes it in one request:
the game is live for every player, in every language, as soon as the call
returns. It does not overwrite games, call a paid model, or claim human approval.
Imported source is checked but not visually reviewed by this API. The existing
Builder may regenerate code during its build step; retain the original payload
for comparison.

## Authentication and ownership

Credentials are optional. Send the existing account credentials in
`X-User-Id` and `X-User-Password` to own the published game; without them the
game is published ownerless (owner `agent-import`), and no one can edit or
unpublish it. Credentials that are sent but invalid return 401. Use HTTPS
except on loopback. Never put passwords in URLs, payload files or source
control. All authenticated platform users (including guest accounts, as in
Builder) can publish their own game. Ownership comes exclusively from
authentication. Unknown fields, including IDs, owners, publication and approval
flags, are rejected. Missing credentials no longer return 401; invalid ones do,
before reading the body. This does not introduce an admin-only policy or an
independent API-key system.

## Request

Content-Type: `application/json`. The machine-readable schema is available through
an unauthenticated `GET /agent/games/schema`.

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
  four `{caption, svg}` view illustrations, matching the existing Builder format.
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
`game_addition_request_id_and_secret` (optional, 16–200 characters) is a string
the agent picks when creating the game — a long random secret. Sending the same
string again updates the game created with it instead of creating a duplicate:
the name, description, rules, code, server code, schemas and translations are
replaced and the game becomes a new version (a resubmission that changes nothing
returns the game as is). Anyone holding the string can update the game, so keep
it secret; without it, every POST creates a new game.
See [the server API](server-side-game-api.md), [translation contract](game-translation.md)
and `builder_flow.validate_artifact` for the authoritative detailed contracts.
`examples/agent-game.json` is a runnable counter-game request example.
Its test images are schematic illustrations, not captured gameplay screenshots.

## Limits and responses

Limits count UTF-8 bytes: entire request 900,000; each code field 200,000; each
SVG 120,000; combined saved workflow 400,000 (the translations count toward it).
Existing tutorial/artifact limits also apply. The smaller combined limit leaves
room under Firestore's document limit for both code fields and draft metadata.
The complete stored package, including the derived runtime-schema copy, is also
capped at 900,000 serialized bytes. Compressed uploads are rejected.
Chunked requests have the same cumulative limit. Uploads have a 15-second deadline.

- 201: complete `GameOut` for the published game (version 1); save its `id`.
- 401: invalid credentials that were sent.
- 400: malformed Content-Length.
- 408: upload deadline exceeded.
- 413: request too large.
- 415: unsupported media type or content encoding.
- 422: malformed payload, missing or incomplete translations, artifact validation or code checks failed/timed out.
- 429: both per-process Builder/validation slots occupied; retry after 15 seconds.
- 5xx: infrastructure/storage failure; do not assume success.

Validation runs before any storage write, reusing Builder artifact validators,
example tests, localization checks, random walks and the existing QuickJS limits.
An isolated validator process has a 20-second wall deadline, including schema
validation. Errors never echo the full submitted source. Persistence creates the
published game once, with the initial workflow (including translations) stored
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
response = httpx.post(base + '/agent/games', headers=headers, json=game, timeout=35)
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
   production. Do not alter production settings, existing games or other users' drafts.

For a batch, assign one game per agent only when delegation is explicitly
requested. Keep credentials out of agent prompts and payload artifacts. Track
successes and failures individually; do not silently substitute duplicate games.
