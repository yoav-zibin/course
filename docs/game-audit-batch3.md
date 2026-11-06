# Audited games: batch 3

Six fresh published game details were read on November 5, 2026 (New York).
IDs, original versions, both SHA-256 hashes and rules are in
`games/audit-batch3/manifest.json`. The current list endpoint returns summaries;
source snapshots must come from `GET /games/{id}` or the historical
`GET /games/{id}/versions/{version}` endpoint.

## Findings and changes

| Game | Original → target | Confirmed behavior and repair |
|---|---|---|
| Backgammon | 3 → 4 | A move could discard a playable die, or use the lower die when only one of two could be used. Search remaining dice for maximum playable count, then enforce the higher die. Reject coerced noninteger coordinates. Server, generators and client use the same legal choices; guard the off-tray click too. |
| Backgammon (copy) | 2 → 3 | Same code and root causes; apply the same repair to its separate published ID. |
| ERS | 3 → 4 | Ordinary challenge cards incorrectly advanced to the next player before the payer exhausted their chances. A false slap could also burn the current player's last card and leave an impossible flip on turn. Retain the payer while cards/chances remain and advance past empty stacks after penalties. |
| 6-Card Golf | 2 → 3 | Public discard and own drawn cards had no `up` flag and rendered as backs. Draw/phase handlers could send duplicate or stale actions, and tied scores named an exclusive winner. Fix the client predicates, pending/phase/ownership guards and tie label; server code is unchanged. |
| Reversi | 2 → 2 | No new confirmed defect in this bounded campaign; both assets unchanged. |
| Brazilian Truco | 3 → 3 | No new confirmed defect in this bounded campaign; both assets unchanged. |

The former terminal `view.turn: []` failures are already repaired upstream by
`d025587`, which validates transition envelopes only for transition functions.
They are verified on the current runtime and are not counted as new defects or
used to force another version of Reversi/Truco.

## Reproduction and evidence

- Backgammon constructed endgames cover mandatory high-die bar entry, bearing
  off that would waste another playable die, mirrored players, doubles and
  ambiguous die consumption. Actual client handlers are executed against legal
  view fixtures, including clicking an unhighlighted off tray. Full opening
  runs may end at the game's existing 300-action cap; separate bearing-off
  races finish naturally. The cap is not presented as a new bug.
- ERS original seven-player seed 29 `randomMove` walk fails at step 59 with
  `InvalidMove: no cards to flip`. Each call uses seed `29 + move_count`, all
  humans with stake 10, and frozen UTC time November 5, 2026. The repaired walk
  completes at 144 moves. The challenge case is reachable from newMatch seed 1.
  A generated illegal flip/deadlock is not a claim of a backend process crash.
- Golf real rendered inline handlers reproduce hidden public card faces,
  duplicate draw submissions and phase bypasses. A seed 7 real-engine match
  ends with scores `[32,32]` and equal payouts while the old UI names P0 winner;
  the patched UI displays the tied low scorers. Face-down hand values remain
  redacted, including spectators' unknown drawn cards.

Primary original campaign: 48 runs across every allowed player count, seeds
11/29 and random/computer modes: 47 terminal, one ERS failure, 5,756 moves.
Repaired campaign: 48 terminal, 6,089 moves, 40,720 calls, 651 structured Move
mutations, 924 identical-input/seed/time comparisons; no runtime/fuzz errors or
replay mismatch. These are local QuickJS games and actual client handlers in
Node, not six manual browser playthroughs. Several games have deliberate move
caps, so engine-terminal does not always mean a natural rules terminal.

Independent private-state checks used minimum player counts and three seeds:
1,807 reachable states, 1,974 view comparisons and 10,833 replay checks,
including an intervening newMatch perturbation. Golf stock/unrevealed cards and
other players' draws, Truco opponent hand order/values, and ERS hidden stack
order were changed while public information stayed fixed. No new leak or
nondeterminism was confirmed. Coverage is bounded and not proof of absence;
counts from agents overlap primary coverage and should not be added together.

## Repeatable method and prompts

Partition IDs between agents: two Backgammon IDs; ERS/Truco; Golf/Reversi; and
an independent hidden-information/determinism review. Prompt: "Use the fresh
published ID/version/hash and actual GameLogic/QuickJS. Complete games, fuzz
nested Move leaves, test legal ownership and client emissions, compare views
while varying only secrets, and repeat identical calls with fixed seed/time.
Separate new findings from old ones and constructed states from reachable
traces. Save exact inputs and turn/score/pot evidence. Patch only confirmed
causes; don't force a change where no issue is found."

Runnable replay from the shipped pairs (no production mutations):

```sh
PYTHONPATH=.. python game_platform/scripts/audit-game-batch.py \
  game_platform/games/audit-batch3/manifest.json report.json
PYTHONPATH=.. python -m pytest game_platform/tests/test_audit_batch3_*.py
node --test game_platform/tests/web/audit-batch3-*.test.cjs
```

The same replay accepts a downloaded JSON list of game detail records, so a
25-game assignment needs a new ID roster/snapshot rather than a new harness.
Only the first five reachable states are structurally fuzzed; arbitrary
accepted malformed values are not automatically treated as bugs. The script
separately reports `terminal`, `step_limit` and errors, and reads all final
player/spectator views.

Rules cross-check: U.S. Backgammon Federation's Backgammon Basics requires
maximum playable dice and the larger die when either but not both can be used
(https://usbgf.org/backgammon-basics-how-to-play/). Bicycle's Egyptian Rat Screw
rules give the next player their allotted response chances
(https://bicyclecards.com/how-to-play/egyptian-rat-screw/).

## Publication

Batch 3 reuses the guarded startup migration. Exact original version/hash
preconditions prevent overwriting intervening author edits; all original
metadata, rules and historical versions are preserved. Both code parts publish
atomically through the real gate. Batch 3 retains the reviewed five-second
total test budget and 100ms per-call limit from batch 2; ordinary builder/test
API budgets are unchanged. Identical Reversi/Truco pairs report `unchanged`.
A second local migration must report all six unchanged. Production acceptance
requires green CI/CD and individual detail reads matching both shipped code
fields, not merely a successful Git upload or service restart.

## Validation

- Full backend suite: 1,068 passed, 61 skipped (3 warnings).
- All Node web regressions: 216 passed.
- Focused owned Python cases: Backgammon 48, ERS/Truco 29, Golf/Reversi 35.
- Actual-client Node cases: Backgammon 6, Golf/Reversi 7.
- Real guarded migration from exact snapshots: four `updated`, two `unchanged`;
  the second run returned six `unchanged`, with all metadata/old versions intact.
- Same migrated game pairs also passed seeded publication checks with the
  original advertised player counts and join/leave flags.
