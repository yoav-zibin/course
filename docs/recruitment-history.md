# Recruitment and conversion history

Opening a shared multiplayer match or invitation assigns its owner as the
authenticated viewer's inviter when that account has none. Signup and login
retain the shared match context. Spectators count too; taking a seat is a
separate conversion step. Later links never replace the first valid inviter,
and self-attribution and cycles are excluded. Personal referral links and codes
are retired.

Three database collections retain the primary historical evidence:

- `recruitment_nodes`: account ID, immediate inviter ID, source match ID,
  account creation and attribution times, deletion time, and surviving account
  ID after a merge.
- `invite_history`: each invitation allocation and its match/owner IDs, creation
  and expiry times, views, seat acceptances, and eventual release. A recycled
  four-letter code receives a separate allocation identity.
- `funnel_events`: immutable conversion/lifecycle events with internal IDs and
  times. Account deletion and merge events use stable identities so retries do
  not duplicate them.

The separate `funnel_totals` collection maintains transactional aggregate counters
and distinct-account/visitor markers so summary reads stay bounded. Start and
completion account counts include the match participants; `player_played` counts
only accounts that actually made a move.

These records survive account and match deletion. They contain no display names,
email addresses, login identifiers, credentials, network addresses or request
headers. Deletion removes the live profile, account credentials and match data;
the minimal history remains. History cannot reconstruct events or ancestors
that were deleted before tracking and migration were introduced.

`GET /users/me/recruitment` returns the authenticated account's historical node
and `inviter_chain`, ordered from immediate inviter to terminal root. Protected
`GET /admin/recruitment/{user_id}` supports inspecting deleted account IDs too.
The chain resolves merged aliases and retains deleted ancestors. It is computed
from current graph edges: if a root is recruited later, every descendant's chain
extends automatically. Missing historical ancestors terminate the known path;
malformed cycles stop without repeating an ID.

Protected `GET /admin/conversion-funnel` summarizes conversion evidence, and
`GET /admin/conversion-funnel/events` pages through the underlying events, and
`GET /admin/conversion-funnel/invites` pages through archived invitation
allocations. Tracked stages include invitation creation, successful device copy/share actions, link opening, account
creation, recruitment, joining, match start, first played move, each player's first move, completion and
account merge/deletion and invitation revocation. A device share action does not prove
recipient delivery; no recipient or message content is collected. This history is independent of expiring invitation reservations and live match/account
records. A link view, an account attribution, and a seat acceptance are distinct
events; repeated views do not represent additional recruited accounts. Internal
authentication restoration reads use `X-Link-Open: 0` and still apply recruitment,
without adding another funnel navigation. Raw invitation `views` remain request
counts and can increase during such a read.

The student leaderboard uses historical recruitment nodes, falling back to live
inviter fields for accounts that have not been backfilled. A retained node always
wins over later cleanup changes to the live inviter field. Deleted recruits and
intermediate inviters remain in direct/transitive recruitment counts. Merged
accounts count once, and the student's own matched accounts are excluded.
Recruited-match activity still counts only retained started matches; permanent
funnel history is available through the separate conversion report.

Run the [personal-referral cleanup](personal-referral-cleanup.md) before backfill
so obsolete personal attribution is never restored. Live account deletion does
not reassign the retained original inviter relationship. The migration backfills
retained accounts in bounded, resumable pages and copies inviter edges only when
match/invitation provenance exists. Reconstructed account-created and recruitment
events are marked `reconstructed: true`; old invitation tokens can establish
recruitment at signup, while unprovable signup/visitor context remains absent.
Backfill does not invent missing historical views or visitors and does not scan
the database at application startup.
