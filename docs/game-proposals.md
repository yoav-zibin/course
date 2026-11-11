# Game proposals

The Portal's game-selection page ("Find your next game") ends with a
**"Missing a game? Propose it"** form. It tells visitors that AI agents
review proposals and create the game within 24 hours.

## Dataset

Proposals live in their own Firestore collection, `game_proposals`
(one document per proposal, in the same namespace as everything else).
A proposal is `{game_name, description, rules_url, proposer_name,
created_at}` plus its generated `proposal_id`. Proposals are not games,
drafts or matches; submitting one never touches those stores.

## API

- `POST /game-proposals` — public, this is the Portal form. Body:
  `game_name` (required, 1–120 chars), `description` (optional,
  ≤2000), `rules_url` (optional, ≤500, must start with `http://` or
  `https://`), `proposer_name` (optional, ≤120). Returns `201` with the
  stored proposal, including its `id`.
- `GET /game-proposals` — master password (HTTP Basic, any username —
  the same check as the debug tools). Returns
  `{"proposals": [...]}` oldest first.
- `DELETE /game-proposals/{id}` — master password. `204` on success,
  `404` for an unknown id.

## Review loop

A scheduled agent checks the proposals every 12 hours:

- A proposal whose game already exists on the platform, or that does
  not fit (not a turn-based board/card-style game the platform can
  host, no usable rules, etc.), is deleted without bothering the owner.
- A good proposal for a game that does not exist yet is built and
  submitted through the normal game-test flow (see
  GAME_DEVELOPMENT_GUIDE.md §9), at most 5 in parallel. Once the game
  is published, its proposal is deleted.
- If more than 5 good proposals are waiting, the owner is alerted with
  the extras, which stay in the dataset for the next run.
