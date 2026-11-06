# Complete game imports for agents

`POST /agent/games` accepts a complete game and creates one **private Builder draft**.
It does not publish, overwrite games, call a paid model, or claim human approval.
Review the imported artifacts in Builder, then use its existing verification,
translation, final-approval and publication flow. Imported source is checked but
not visually reviewed by this API. The existing Builder may regenerate code during
its build step; retain the original payload for comparison.

## Authentication and ownership

Send the existing account credentials in `X-User-Id` and `X-User-Password`.
Use HTTPS except on loopback. Never put passwords in URLs, payload files or source
control. All authenticated platform users (including guest accounts, as in Builder)
can create their own draft. Ownership comes exclusively from authentication.
Unknown fields, including IDs, owners, publication and approval flags, are rejected.
Other users cannot read or modify the resulting draft. Missing/invalid credentials
return 401 before reading the body. This does not introduce an admin-only policy or
an independent API-key system.

## Request

Content-Type: `application/json`. The machine-readable schema is available through
an authenticated `GET /agent/games/schema`.

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

Runtime `game_schemas` are derived from the three unit-test schemas and persisted
with the draft; agents do not submit a second potentially inconsistent copy.

Optional: `language` (default `en`), `allows_join_mid_match` and
`allows_leave_mid_match` (both default false). Do not enable unsupported handlers.
See [the server API](server-side-game-api.md), [translation contract](game-translation.md)
and `builder_flow.validate_artifact` for the authoritative detailed contracts.
`examples/agent-game.json` is a runnable counter-game request example.
Its test images are schematic illustrations, not captured gameplay screenshots.

## Limits and responses

Limits count UTF-8 bytes: entire request 900,000; each code field 200,000; each
SVG 120,000; combined saved workflow 400,000. Existing tutorial/artifact limits
also apply. The smaller combined limit leaves room under Firestore's document
limit for both code fields and draft metadata. The complete stored package,
including the derived runtime-schema copy, is also capped at 900,000 serialized bytes. Compressed uploads are rejected.
Chunked requests have the same cumulative limit. Uploads have a 15-second deadline.

- 201: complete `GameDraftOut`; save `id` and `revision`.
- 401: missing or invalid credentials.
- 400: malformed Content-Length.
- 408: upload deadline exceeded.
- 413: request too large.
- 415: unsupported media type or content encoding.
- 422: malformed payload, artifact validation or code checks failed/timed out.
- 429: both per-process Builder/validation slots occupied; retry after 15 seconds.
- 5xx: infrastructure/storage failure; do not assume success.

Validation runs before any storage write, reusing Builder artifact validators,
example tests, localization checks, random walks and the existing QuickJS limits.
An isolated validator process has a 20-second wall deadline, including schema
validation. Errors never echo the full submitted source. Persistence uses the
existing draft store once, with the initial workflow included in that write.

The endpoint is not idempotent: do not blindly retry a request whose response was
lost. First inspect your private drafts and compare name and source. This version
has bounded concurrent validation per server process, not distributed user quotas.

## Example agent client

```python
import json, os
import httpx

base = os.environ['BUILDPLAY_BASE_URL'].rstrip('/')
headers = {'X-User-Id': os.environ['BUILDPLAY_USER_ID'],
           'X-User-Password': os.environ['BUILDPLAY_USER_PASSWORD']}
with open('examples/agent-game.json') as f:
    game = json.load(f)
response = httpx.post(base + '/agent/games', headers=headers, json=game, timeout=35)
response.raise_for_status()
draft = response.json()
print(draft['id'], draft['revision'])
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
   alone do not establish rule correctness. Run random walks and local UI checks.
5. Submit only to the agreed isolated test instance with your assigned account.
   Record response ID/revision and validation results. Never claim publication
   based on a 201 draft response.
6. Review in Builder and obtain deployment/publication authorization where needed.
   Do not alter production settings, existing games or other users' drafts.

For a batch, assign one game per agent only when delegation is explicitly
requested. Keep credentials out of agent prompts and payload artifacts. Track
successes and failures individually; do not silently substitute duplicate games.
