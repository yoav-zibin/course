# HTML game archive

The playable Portal and its ordinary game, library, popularity, match and
translation APIs expose declarative games only. New HTML imports and matches
are rejected. HTML source and import artifacts stay in storage for conversion.

`GET /legacy/games` returns a read-only archive page as `{items,next_cursor}`.
Listing follows public catalog visibility; unpublished detail requires its owner.
Follow the cursor even after an empty page: archive and Portal listings filter
the same bounded metadata pages. `GET /legacy/games/{id}` returns the HTML
versions and their complete source and import artifacts, with submission secrets
removed. An ID whose current version has already migrated still supports the
legacy detail endpoint while it retains older HTML versions. Portal code never
calls either archive endpoint.

Before starting the HTTP server or computer-move workers, normal server startup
runs `legacy_games.retire_html_matches`. It deletes matches according to their
pinned version, including matches of a game whose latest version has migrated.
Unsettled stakes are refunded through the existing pot settlement logic without
executing old game rules; settled matches receive no further payout.

For JSON storage, cleanup is flushed before startup continues. For Firestore,
the `retire-html-game-matches-v1` migration checkpoint makes each bounded
transaction resumable. Refund and match tombstone commit together, followed by
physical removal of all recorded moves and the match document. Subsequent
stages remove the retired matches' invites, durable jobs, failed jobs, matchmaking
slots, move idempotency records and queued notifications. Temporary per-match
markers scope that cleanup and are removed when it finishes. A restart resumes the job,
and a completed checkpoint avoids rescanning on subsequent startups. The game
and game-version documents are preserved. No configuration, namespace, account
credential or paid-test allowance changes are needed.
