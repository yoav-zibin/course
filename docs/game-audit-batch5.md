# Audited game repairs: batch 5

Three published games from Game_Bug_Audit_Round5.zip are repaired. The other
three audited games had no confirmed new issue and are not republished.

| Game | Original → target | Repair |
|---|---|---|
| Guess Who? | 4 → 5 | Disable the viewer's previously asked questions, select the next available question, keep guessing available when questions run out. Prevent duplicate moves and unlock on an authoritative response, including unchanged-count rejection. |
| Spades | 2 → 3 | Replace the impossible terminal reset move with guidance to create a new Portal match. Guard terminal/spectator controls, duplicate moves and collect timers. Keep the existing advertised free-play rules and legal mid-match redeal. |
| Chess | 5 → 6 | Count repetition using legally capturable en-passant rights, including pin checks. Draw with any number of bishops confined to one square colour. On resignation award a draw when the opponent cannot possibly mate with its material. |

This Chess ID 076f078a-56cd-44b3-8930-81abc488508a is separate from the earlier
3 Minute Chess repair. It uses its own flat board and has no timer.

## Evidence

The nine-ply reachable repetition is e2e4 g8f6 g1f3 f6g8 f3g1 g8f6 g1f3
f6g8 f3g1. Positions after plies 1/5/9 have identical legal moves; e3 is not
capturable and must not split their counts. A capturable EP right is kept;
a pinned pawn's EP right is excluded. The existing automatic repetition
feature is retained, without adding a tournament claim workflow.

Dead-position predecessor FEN: 7k/8/8/5n2/4B3/8/2B3B1/K7 w - - 0 1.
Legal e4f5 captures the knight and leaves three same-colour bishops and kings:
now a draw. Opposite-colour bishops and bishop/knight controls remain active.
Constructed legal-position fixtures are explicitly distinguished from opening
playthroughs. White rook versus bare black king, then White resigns, pays a
draw; two knights, opposite-colour bishop help, pawns and rooks retain their
possible-mate controls. Rules basis: FIDE 5.1.2, 5.2.2, 9.2.3,
https://handbook.fide.com/chapter/E012023 .

Guess Who's own asked question 0 is disabled after each player asks 0;
the opponent's question alone does not disable it for the viewer. Actual
handlers are exercised with fourteen exhausted questions, legal guesses,
double clicks, spectators, terminal states and authoritative rejection retry.
Spades seed20261106 ends in65 actions; its old terminal newGame:true move
is no longer emitted. Normal cards, collect and acting-player redeal remain.

## Validation and reproduction

18 focused Python Chess tests and7 actual-script Node tests pass. The complete
Node web suite has259 passing tests. The first full Python run from inside
the package had1229 passing/62 skipped and one module-name-sensitive metrics
fixture failure; using the documented CI invocation from the parent directory
passes all11 metrics tests. Full CI remains the release gate. The exact saved three-game snapshots
passed the real guarded update_game publication gate locally with its five
second batch budget and normal100ms call limits: target versions3/5/6, then
three unchanged results on a second run. Original versions, metadata and
schemas were preserved. Mechanics fixtures explicitly use permissive schemas
in tests; production schemas are retained and checked by the normal gate.

Twelve seeded random/computer walks reach engine termination:1202 moves,
7068 calls, 245 typed Move mutations and 202 repeatability checks,
with no runtime/fuzz/replay error. Intrinsic game caps are not natural wins.
UI fixtures run real scripts in a minimal DOM, not a manual browser game.

```sh
PYTHONPATH=.. python -m pytest game_platform/tests/test_audit_batch5_chess.py game_platform/tests/test_game_patch_migrations.py
node --test tests/web/audit-batch5-ui.test.cjs
```

## Technique and prompt

Two agents own the Chess pair/tests and the two card UI pairs/tests. Prompt:
reproduce the saved counterexample in the real game implementation; repair
the cause, preserve ordinary/legal alternatives, secret views and payouts;
execute actual handlers, check pending/retry/spectators and whole matches;
keep normal runtime/publish limits; do not publish independently. The primary
reviews, checks all tests, rehearses guarded publication and integrates.

## Release

Direct commits to yoav-zibin/course main; no branch merge. Dependency-first:
compatible migration support, complete pairs, regressions, documentation,
then startup activation. Exact original versions and both hashes guard updates;
author edits are skipped. Old matches stay on old game versions. Deployment
and individual live-code verification are separate acceptance steps.
Deployment now checks public health after restart and emits only narrow startup
error diagnostics on failure. Before this batch's first commit, buildplay.fun returned502; do not confuse
GitHub commit success with a verified live game update.
