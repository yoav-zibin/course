# Backgammon reference and playback verification

Reference: [247 Backgammon](https://www.247backgammon.org/), inspected in Chromium
on 2026-11-17 at a 1440×1000 viewport. Its home screen offers computer play and
same-device **Pass & Play**. The comparison covers those modes. Proprietary
source and artwork are not included in this repository.

## Reference interactions

Computer play opens an Easy/Medium/Hard/Expert difficulty selector, then game
options. Pass & Play opens options directly. Options include exchanging
red/ivory colors, a match target of 1/3/5/7/11/15 points, and a doubling-cube
switch. The defaults are five points and an enabled cube.

Each player rolls one opening die; the higher value starts with both values.
Ties reroll. Computers roll automatically; local humans use **Roll Dice**.
Both players use the same board orientation in Pass & Play. The active status
card changes between Player 1 and Player 2; there is no handoff overlay.

A player selects a green-highlighted checker and then a highlighted destination.
Selecting a different checker changes the source. A blank-board click cancels
selection. A destination may use multiple dice. After the available dice have
been used, play advances automatically. Doubles show four dice and consumed dice
fade. The toolbar provides Home, Undo, Hint, Help and Settings.

The board uses a green surrounding surface, golden wood field, dark brown frame,
contrasting chocolate/caramel points and red/ivory discs. Player status cards
show pip counts and match scores above and below the board. Bear-off trays and
the doubling cube sit on the right. A fixed board keeps both sides visible.

## Timing comparison

The reference's [public game runtime](https://www.247backgammon.org/game/js/main.js?v=1789057346279)
provides these nominal timings. Ordinary checker movement was also measured
during live browser play; the remaining source timings were inspected in the
runtime rather than independently timed from frames.

| Interaction | Reference timing | Implementation contract |
| --- | --- | --- |
| Ordinary checker slide | 800 ms, quadratic ease-in-out | `motion.move_ms: 800`, quadratic movement keyframes |
| Bear off | 400 ms | Per-piece move duration of 400 ms |
| Captured checker to bar | 400 ms, starting 400 ms after the hit begins | Per-piece duration of 400 ms and delay of 400 ms |
| Remaining stack adjustment | Final 400 ms of the main slide | Reference behavior observed; stack positions retain stable checker identities |
| Dice artwork | 500 ms | `motion.roll_ms: 500` |
| Used-die shading | 200 ms | Previous accepted face fades into its gray artwork in 200 ms |
| Roll before checker selection | 1,000 ms | `motion.roll_settle_ms: 1000` |
| Pause after completing a turn | 500 ms | `motion.turn_pause_ms: 500` |
| No-moves announcement | 2,000 ms | No-moves state is visible before automatic pass |
| Opening winner announcement | 2,000 ms after the 1,000 ms roll; 3,000 ms total | Notice duration of 2,000 ms with 1,000 ms delay |
| Opening tie reroll gap | 500 ms after the 1,000 ms roll; 1,500 ms total | Notice duration of 500 ms with 1,000 ms delay |

The live reference measurement used real clicks on a movable checker and a
highlighted destination in Pass & Play. Logging observed the existing tween's
per-frame values without changing its game state, time, easing or move code.
Canvas screenshots confirmed the selected and settled positions. This is runtime
frame observation, not pixel tracking.

The destination pointer-up occurred at performance-clock time 20,404.300 ms;
the final moving-checker frame occurred at 21,207.900 ms: **803.600 ms wall
playback**, across 49 updates. At internal time 195/800 ms the checker had
travelled 11.8828%; at 595/800 ms it had travelled 86.8672%. Both samples match
quadratic ease-in-out. The same move also adjusted the remaining stack during
its final 400 ms.

A run with ads and concurrent browser tests took about 908 ms for the nominal
800 ms slide. The reference caps long per-frame deltas, so browser load affects
its wall playback. The implementation targets the nominal 800 ms timing.

## Repeatable local checks

[e2e/backgammon-reference.spec.ts](../e2e/backgammon-reference.spec.ts) exercises
actual browser animations and records configured duration/delay, start and finish
wall times, keyframes and sampled rendered transforms. It checks:

- Ordinary own-player slides in computer and Pass & Play presentations.
- Quadratic motion at approximately one quarter and three quarters of playback.
- Delayed captures, bearing off and preservation of all thirty checker IDs.
- Identical server polls during a slide, to catch cancellation or restarting.
- The 500 ms dice effect and blocked checker selection until the 1,000 ms roll
  interval completes.
- Opening-winner and tie announcements following the 1,000 ms roll, with
  respective durations of 2,000 ms and 500 ms. Repeated polls preserve the
  original effect without restarting.
- Options for match target, computer difficulty and piece color, followed by
  separate opening rolls, a within-turn undo, and cube offer/take/drop decisions.
  These use real UI clicks and the package's authoritative rules behind every
  accepted action.

The broader Backgammon browser suites cover real portal matches, local practice,
computer responses and combined moves.
The camera suite verifies that Backgammon remains fitted after pinch gestures
and that ordinary checker drops still work. Other declarative games retain
camera controls unless they opt out with `viewport.camera_enabled: false`.

The source investigation played setup, opening rolls and a legal checker move
in Pass & Play. In computer mode it also observed the computer win the opening,
make two distinct checker slides in sequence and return control to the human.
The next computer slide began about 15 ms after the preceding one finished; the
500 ms pause applies after the turn, not between same-turn checker moves. The
investigation did not play a complete source match.
Reference observations and implementation tests are separate evidence: successful
local tests do not establish parity for every possible source-game position.
