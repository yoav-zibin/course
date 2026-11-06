# Game popularity

A game's score is the sum of player seats at each successful match start,
including computer opponents. Waiting lobbies, moves and repeated Start requests
do not add points. Deleting a match does not remove its contribution.

Both Firestore storage modes now retain one small aggregate per game, containing
`game_id`, `matches_started` and `score`. The browse row uses an indexed descending
query with a limit; its leftmost game has the highest returned score. Query mode
commits the aggregate in the match transaction. Snapshot mode saves the aggregate
with the rest of its changes and flushes accepted starts before reading the ranking.
It retains that adapter's existing asynchronous persistence behavior.

For an older snapshot deployment with no aggregates, the first startup seeds them
from its already loaded retained matches. Historical scores use those matches'
retained rosters; deleted matches and original rosters before mid-game joins cannot
be reconstructed. Future starts capture the actual seat count at the start. Seeding
is not repeated after aggregates exist. This does not scan query-mode history.

The selected-game menu reads `/games/{id}/popularity`. Its displayed score refreshes
at most once per minute and is invalidated immediately after a start in that browser.
The popular row follows the same refresh interval. Neither path calls a model API.
