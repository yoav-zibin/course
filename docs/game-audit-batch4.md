# Audited game repairs: batch 4

Six fresh published details and their original code hashes are recorded in
`games/audit-batch4/manifest.json`. These pairs repair the fourth audit's
confirmed issues; uncertain observations were not converted into rule changes.

| Game | Original → target | Repair |
|---|---|---|
| Hearts | 2 → 3 | Name every tied lowest scorer in both end-of-game displays, matching the server's shared payouts. Server code unchanged. |
| Rummy 500 | 3 → 4 | Reject an impossible mandatory deep-discard pickup before changing cards. Use the existing meld validator with an exact bounded rank/suit/wildcard search; preserve valid sets, ace-low runs and layoffs. Validate UI deep draws/layoffs and recover after authoritative rejection. |
| Blackjack Table | 3 → 4 | A solvent solo player continues up to the advertised ten rounds. Zero-chip solo endings and the existing multiplayer last-solvent-player condition remain. Offer the legal remaining-chip bet at balances1–9; guard pending submissions and spectator actions. |
| Cheat (BS) | 2 → 3 | Disable spectator BS/OK controls instead of treating null actor and null viewer as the same eligible seat. Server code and the rule-dependent pass-window variation unchanged. |
| Checkers | 3 → 4 | Reset the quiet counter on capture or any uncrowned-man advance, including promotion. Check wins before the existing automatic80-quiet-action draw. Guard duplicate UI moves and recover after authoritative refresh. |
| Mancala | 2 → 3 | Guard duplicate UI submissions and support authoritative same-count retry; ignore foreign-window responses. Server code unchanged. |

## Evidence and regression cases

The original fourth-round audit is preserved separately as
`Game_Bug_Audit_Round4.zip`. Regressions here are self-contained and depend only
on these shipped game pairs, not on an agent's temporary files.

- Rummy seed2, two players, after two legal moves: the old deep pickup of KS
  creates an unresolvable pending obligation. The repair rejects it and permits
  a legal stock draw. Valid deep set/run/layoff/wildcard cases remain accepted.
  Differential tests compare the new bounded search to every subset of180
  required-card/small-hand cases from20 deals. Eighteen complete matches cover
  every supported count2–7 and check exact card-ID conservation at every move.
- Actual Rummy client handlers no longer emit the incompatible layoff, still
  permit a subsequent legal discard, prevent duplicate sends, ignore a foreign
  rejection message and unlock after an authoritative same-count response.
- Blackjack seed123 solo now reaches rounds1–10; a bankrupt solo game still
  terminates early. The actual seed5 forty-move path reaches round9 with
  chips[2,750], then accepts a bet of2 and renders a remaining-chip button.
  All supported player counts and every player/spectator dealer-hole view are
  checked; changing the hidden card/deck does not change those views.
- Hearts seed14 ends scores[0,3,23,0]. The tie status and center display name
  both lowest scorers; unique-winner rendering is retained.
- Checkers includes the full opening seed86 quiet-counter regression and the
  constructed immobilization win at noCap79. Mandatory captures, promotion and
  actual UI duplicate/retry cases remain covered. The WCDF1.30/1.32.2 rule
  basis is https://wcdf.net/rules/rules_of_checkers_english.pdf . The existing
  automatic draw feature is retained; no tournament claim workflow was added.
- Cheat actual-script tests cover eligible opponents, the claimant and
  spectators, including zero unauthorized emitted moves. Mancala conserves all
  stones and retains capture, extra-turn and terminal sweep behavior.

All server regression calls use the production QuickJS100ms default limit.
The publication gate retains its existing checks and the reviewed five-second
batch budget. No runtime limit, validation check, hash guard or stored seed
replay was disabled to publish these games.

## Techniques and repeatability

Four agents owned nonoverlapping pairs/files: Rummy, board games, Blackjack,
and Hearts/Cheat views. Prompt: reproduce the exact saved counterexample in
actual QuickJS; repair only the cause under the game's own validator; execute
real client handlers and validate emitted moves; verify legal alternatives,
rejection recovery, private views, every advertised count, whole matches and
conservation; keep100ms calls and five-second publication checks; do not publish
independently. The primary integrates the guarded manifest and startup call,
runs whole-repository tests and locally rehearses the real update path.

```sh
PYTHONPATH=.. python -m pytest game_platform/tests/test_audit_batch4_*.py
node --test game_platform/tests/web/audit-batch4-*.test.cjs
PYTHONPATH=.. python game_platform/scripts/audit-game-batch.py \
  game_platform/games/audit-batch4/manifest.json replay-results.json
```

Random play may reach a harness step limit in Rummy; that alone is not a bug.
UI tests execute actual scripts in minimal DOM fixtures, not full browser
playthroughs. The isolated near100ms Rummy timing observation was not presented
as a stable crash, and Cheat's pass-window candidate was not changed.

## Publication and validation

Updates are new versions, guarded by exact original version and both original
code hashes. Authors, rules, visibility, metadata and old match versions are
preserved; intervening author changes are skipped. Rerunning the migration is
idempotent. Live acceptance requires successful CI/CD and individual reads
matching both code fields, not merely uploaded assets or a restarted service.

Submission order is dependency-first: compatible migration support, complete
game pairs, their tests, then startup activation. This avoids the prior batch's
intermediate missing-BATCH3_DIRECTORY failures. No branch merge is required.

- Full backend suite:1125 passed,61 skipped,3 warnings.
- Node web regressions:233 passed.
- Focused Python regressions: Rummy25, Blackjack11, board15, views3.
- Actual-client Node regressions: Rummy4, Blackjack4, board6, views3.
- Real local publication of all six exact snapshots succeeded at target
  versions3/4/4/3/4/3; metadata and original versions were preserved.
  A second run returned six unchanged results.
