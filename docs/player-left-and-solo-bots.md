# November 6: leaving matches and single-player bots

Implementation plan (directly on `main`):

1. Share the state/turn/payouts result contract between `applyMove` and
   `playerLeft`. Validate before any token transfers, preserve the complete
   preview, invalidate it on intervening changes, and apply it once.
2. Keep a departed seat's identity and index for game state and history, but mark
   it inactive. Never replace a departing or timed-out human with a computer.
   A continuing game must exclude inactive players from its turns and payouts.
3. Allow computers only with exactly one human. Enforce this in lobby changes,
   joins/invites, matchmaking, start, emulator, and browser/native clients.
4. Update built-in games and authoring instructions. Adapt legacy published
   `playerLeft` results at the runner boundary so pinned versions also settle
   safely without introducing bots. Legacy handlers end the match, preserve the
   leaver's quoted payout, and split the remainder among the other humans.
5. Exercise money conservation, stale/repeated confirmations, continuing leaves,
   solo bots, and multiplayer restrictions; run backend, web, and browser checks.
   Commit and push to `main`, then inspect the existing CI/deployment pipeline.

The persistent seat flag defaults to active for old records. Existing game
versions and match history are retained. No bulk Firestore rewrite is needed.
An ongoing legacy match with a mixed human/computer roster ends on its next
read, move, or worker call, splitting the remaining pot among its active humans
once. Its end reason is `solo_computers_only`. Waiting lobbies can remove their
computers before starting or inviting other humans.

Compatibility audit: on November 4, all 53 published games were inspected.
Nine have custom `playerLeft` handlers. Their supported player counts and every
leaving seat produced 112 successful runner calls with conserved terminal pots.
The other games use the platform's end-and-refund fallback.

Validation on November 4:

- Backend: 854 passed, 57 skipped (emulator-dependent checks run separately).
- Firestore emulator: 53 passed, including restart and refund idempotency.
- Browser JavaScript: 195 passed.
- Playwright: 90 passed plus one platform skip in the full run; both new leave
  cases initially needed the collapsed Controls panel opened. After correcting
  that test setup, all four new desktop/mobile cases passed.
- Native client changes were reviewed, but native builds/UI tests were not run
  in this Windows environment.
