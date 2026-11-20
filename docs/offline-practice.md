# Offline single-player play and cloud saves

The Portal runs the pinned game's `server_code` locally for private single-player
matches (`computer` and `pass_and_play`). Both are owned by one logged-in account,
saved locally first and synchronized to the cloud. Read [the current match
contract](match-kinds.md) for permissions, fields, conflicts and migration rules.

Download the pinned rules once. A match can then continue across any number of
human turns, computer replies, handoffs and app restarts without internet.
Reconnection automatically saves the complete pending history and state in the
cloud so the owner can resume from another device. Finished matches sync too.
The UI distinguishes a durable local save waiting for sync from a cloud save.

- `newMatch`, `applyMove`, `computerMove` and `viewFor` use the deterministic
  prelude shared with `game_logic.py`, including seeded randomness and frozen time.
- Rules run in the existing isolated executor with no account password or network
  access. The trusted renderer receives only the appropriate `viewFor` output.
- Persist the full rules state, seed, seat identities, pinned game version,
  initial position and move history before accepting another local turn.
- Computer matches have exactly one human seat plus computers. Pass-and-play has
  one or more human seats controlled by the owner and no computers. Neither kind
  offers invitations, spectators, account joining or multiplayer alerts.
- All private single-player matches have a zero token pot. A local result cannot
  create rewards or become a token multiplayer match.
- Upload through the owner-authenticated single-player sync endpoint with the
  same match ID and expected cloud revision. Preserve unsynced branches on a
  conflict; never overwrite another device's newer saved revision silently.
- Protect pending snapshots, histories and dependencies from cache eviction.
  Recoverable downloads may be evicted and fetched again. Clearing app/browser
  data before cloud acknowledgement can lose pending progress.
- Existing device saves upload when the updated app opens with their owning
  account. A backend migration alone cannot retrieve another device's files.

Multiplayer uses the existing local outgoing-move queue and server validation.
An offline move is limited to the logged-in player's legal turn and does not
let that account control other human players. Its idempotency key survives retries.

Relevant checks cover offline multi-turn completion/reload, reconnect uploads,
lost acknowledgements, cross-device continuation, revision conflicts, owner-only
access, no sharing/notifications for private kinds, and human-only multiplayer.
