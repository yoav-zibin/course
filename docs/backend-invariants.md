# Backend data invariants and bug-finding

This change adds a **pure, read-only** checker and two account-merge fixes. It is an API-change proposal for review, not a production data migration. No live cloud data was queried or fuzzed.

## API

`POST /validation/invariants` checks the lists in the request; it does not fetch records by ID, authenticate as those users, run game code, or change the live store. Since it only processes supplied data, this endpoint requires no authentication. Existing endpoints are unchanged.

```json
{
  "users": [{"id": "alice"}],
  "games": [{
    "id": "puzzle", "version": 1, "owner_user_id": "alice",
    "rules": {"allowed_player_counts": [1]}
  }],
  "matches": [{
    "id": "match-1", "game_id": "puzzle", "game_version": 1,
    "owner_user_id": "alice", "status": "ongoing",
    "seats": [{"player_index": 0, "kind": "human", "user_id": "alice"}],
    "initial_turn_player_indices": [0], "turn_of_player_indices": [0],
    "moves": []
  }]
}
```

Successful validation returns HTTP 200:

```json
{"valid": true, "violations": [], "warnings": [], "truncated": false}
```

Semantic violations also return 200, with `valid: false` and stable `code`, `path`, and `message` entries. For example, a missing owner yields `missing_user` at `matches[0].owner_user_id`. Malformed request shapes/types return 422. Seat and move numbers reject booleans instead of treating `true` as seat 1.

Use **snapshot-shaped records**, not the public catalog/MatchOut responses: games contain nested `rules`, matches contain `seats` and full `moves`. Raw snapshot records can include extra fields; they are ignored. Passwords, email addresses, display names, code (except the optional server-game marker described below), and opaque states are not needed and should be omitted. Supply all referenced users and every pinned game version, including retained deleted versions. A missing reference in a partial export is an error about that input, not evidence that production is corrupt.

Limits: 10,000 users, 10,000 game versions, 1,000 matches, 10 seats per match, 10,000 moves per match, 50,000 total moves. Reports stop at 1,000 findings and set `truncated: true`; a truncated report is never valid. These model limits do not replace a deployment's HTTP request-body size limit.

## Checks

- Unique user IDs, game/version keys, and match IDs.
- Replacement points directly to a different surviving user; forward/back links agree and replacement lists have no duplicates.
- Replaced accounts have no linked accounts, replacement ownership, inaccessible token balance, game ownership, match ownership, seats, move authorship, hidden-match references, or timeout participation.
- Nonnegative token balances; valid game versions and unique allowed player counts in 1–10.
- Referenced users and pinned game versions exist; ordered seat indices are contiguous; human seats have active owners and computers have no account owner.
- Active matches do not seat the same human twice; completed matches may, after a legitimate account merge.
- Ongoing matches have a nonempty current turn; other statuses have none. Waiting matches have no moves; finished matches have an end reason.
- Move numbers are consecutive; move seats and turn sets are valid; terminal moves cannot be followed by another move.
- Each mover belongs to the **preceding** move's next-turn set, or to the initial turn for the first move. A move is not required to hand the next turn back to its author.
- Ongoing current turn agrees with the last recorded next turn.

## Explicit coverage limits

`valid` means no violations among the checks that could be performed; inspect warnings too. Old histories without `initial_turn_player_indices` produce `initial_turn_unavailable` and skip first-move authorization. Server games with join/leave callbacks can change turns outside move history: set `server_code` to a nonempty string (a marker suffices; source code need not be transmitted) and supply the rule flags. These get `membership_history_unavailable`; cross-move turn authorization/current-turn agreement is skipped. Server-generated computer moves may have an empty `made_by_user_id`.

The checker does not compare historical authors to current seat owners, since joining, leaving, timeouts, and merges can change ownership. Game-facing `logic_player_id` and historical `player_id` may intentionally retain old identities. It does not execute opaque game rules, prove outcomes/payouts, check all other resource types (drafts/invites/experiments), or provide a transactionally consistent live-database snapshot. Those are separate extensions.

## Confirmed defects and fixes

1. **Timeout viewer access lost after account merge.** A timed-out player remains a viewer through `Match.timeouts`. Merging their account previously left the old user in those entries. The survivor did not inherit that participation. Merge now rewrites timeout ownership together with seats and move authors.
2. **Tokens stranded on a replaced account.** A source with 23 tokens merged into a target with 17 previously left the target with 17 and the inaccessible source with 23. Merge now transfers all 40 to the survivor and zeroes the source. It retains the latest daily-grant date, so merging cannot reset today's grant eligibility; merging through an alias does not duplicate balances.

These repairs apply to new merges, not historical corrupted records. Existing data needs a separately reviewed migration after a validation report.

## Reproducible validation

```sh
.venv/bin/python -m pytest -q tests/test_invariants.py tests/test_invariant_regressions.py tests/test_invariant_fuzz.py
.venv/bin/python -m pytest -q
```

Techniques: independent AI code audit, deliberately corrupted snapshot tests, HTTP contract tests, and deterministic seeded model-based fuzzing. The fuzz campaigns cover eight seeds × 40 move attempts, four seeds × 30 malformed move payloads, and four seeds × five account merges. Every transition checks stored invariants. Rejected requests must not mutate persisted match data (response-only `server_time` is excluded). Failure messages include seed/step for replay. A separate baseline run loads the original service code in memory and demonstrates that all three merge regressions fail before the fix.

Validation on 2026-10-30: 35 focused tests passed, plus 103 related account/match/storage tests. Full discovery contained 693 tests: the sandbox run had 637 passes, 54 skips, and two localhost-bind failures. Both localhost tests subsequently passed with port access (one required retry after a cold-start timeout): 639 passed and 54 skipped across the run and targeted reruns. The three regression tests failed against the original service loaded in memory, confirming the defects independently of the fixes. No existing failures were suppressed or marked expected-failure.
