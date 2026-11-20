# Match kinds, ownership and cloud saves

Every match has a persisted `match_kind` field. Use this field for permissions,
sharing, notifications and UI labels; internet availability is not a match kind.

| `match_kind` | People and seats | Access | Sharing and alerts |
| --- | --- | --- | --- |
| `computer` | Exactly one human seat belonging to the owner, plus one or more computer seats | Only the signed-in owner | No invite, join, spectator, turn notification or opponent alert |
| `pass_and_play` | One or more human seats controlled through the owner's account; no computers | Only the signed-in owner | No invite, join, spectator, turn notification or opponent alert |
| `multiplayer` | Human accounts only; no computer opponents or timeout substitution | Shared human multiplayer match | Share the invite to bring players into the lobby; normal multiplayer notifications and alerts apply |

Computer and pass-and-play matches are also called **single player** because
only one account owns and controls the match. Passing a device to another person
does not add another account or turn the match into multiplayer. A one-seat solo
game uses `pass_and_play`. Guest accounts are accounts too; create or select an
account before starting any match.

## Save and reconnect contract

Save every accepted action durably on the device before submitting its cloud
write. A successful local save lets a single-player match continue through any
number of turns, computer replies, device handoffs and restarts without internet,
provided its pinned rules were downloaded. Offline state is pending cloud data,
not a separate permanent device-only match category.

On reconnect and later app starts, automatically upload pending single-player
snapshots, including finished matches and pre-existing local saves. The snapshot
contains the pinned game version, initial position, full rules state, random seed,
player identities and move history so the owner can continue from another device.
The sync endpoint bounds the expanded snapshot to 8 MB and its compressed stored
representation to 600 KB; a rejected upload preserves local work and reports the
error. Device storage is finite too. There is no single-turn
offline restriction for these matches. Retries keep the same match ID and use `cloud_revision` to avoid overwriting a
newer version saved by another device. A conflict preserves the unsynced branch
for review instead of discarding it. Show **Saved locally · waiting to sync** until
the cloud acknowledges the saved revision, then **Saved in the cloud**.

Multiplayer keeps its existing authoritative move protocol: persist the outgoing
move and its idempotency key locally, submit the owner's legal turn, and reconcile
with server history after a missing acknowledgement. A queued multiplayer move
cannot authorize turns for other accounts. Notifications and alerts apply only
to multiplayer.

Downloaded rules and cached cloud matches can be fetched again. Pending actions,
unsynced single-player history and conflict branches must not be evicted to make
room for those recoverable caches. Clearing app or browser data before sync can
lose pending work; acknowledged cloud saves can be downloaded again.

## API fields

`POST /matches` creates multiplayer lobbies. Its `match_kind` is `multiplayer`;
`client_match_id` lets a durable local creation outbox retry without creating a
second lobby. Save that intent before the network call. An offline-created lobby
has no usable invitation until the server acknowledges it and returns its code.

`POST /matches/single-player-sync` accepts an authenticated body
`{match: snapshot, expected_revision: number}`. New snapshots use revision zero;
subsequent writes use the last acknowledged `cloud_revision`. The snapshot's
`id` remains stable through retries. Responses and owner `GET /matches/{id}`
include `single_player_state`, which contains the complete portable snapshot.
Other accounts and anonymous callers cannot read it. List/detail responses expose
`match_kind`; full list responses remain compact rather than embedding histories.

During a rollout, a native app may precede the matching server. A missing sync
route or rejection of newly introduced creation fields keeps the durable outbox
pending and retries after backoff. These compatibility responses must not turn
valid unsent work into a permanent conflict.

The client snapshot includes `game_id`, `game_version`, `owner_user_id`,
`match_kind`, `players`, `status`, `state` (the displayed view), `logicState`
(full rules state), `practiceSeed`, `initialState`, `initialTurn`, `moves`,
`move_count`, `turn_of_player_indices`, `created_at` and the device handoff flag.
Only the owner seat carries the account ID; other pass-and-play seats have stable
local player IDs. These private snapshots have no competitive or token authority.

## Development and migration

- Include `match_kind` in model serialization, API detail and list responses,
  snapshots, client types and admin inspection. Keep `localMode` only as an
  internal compatibility/runtime detail, never as the privacy or save policy.
- Enforce owner-only reads and writes for both single-player kinds on the server,
  including history, rules access through a match, invitations and join routes.
  Hiding a button alone is insufficient.
- Do not mix computers with several human accounts. Do not replace multiplayer
  players with computers on leave or timeout. Test validation walks may still
  construct computer/human combinations to exercise game logic; those are not
  live multiplayer matches.
- Single-player matches have no stake, pot or payout. Their offline snapshots
  cannot create token rewards or be promoted into a multiplayer/token match.
- Run the bounded dry-run/apply/verify commands in [match data cleanup](match-data-cleanup.md).
  Classify existing valid cloud records and persist their kind. Delete invalid
  mixed-account/computer records through the migration's normal deletion/refund
  path. Preserve a private backup and an auditable count of each outcome.
- Device-only saves can only be uploaded when that installation opens with the
  new client and its owning account. A backend migration cannot read another
  device's storage.

Authoritative behavior is implemented by the match API and Portal core. Historical
offline-practice or deployment reports describing permanent device-only matches
refer to behavior before this contract.
