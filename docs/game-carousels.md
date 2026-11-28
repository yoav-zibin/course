# Portal game carousels

[game_carousels.json](../game_carousels.json) is the display order for the public
Portal carousels. The order of the rows and of the entries within each row
matters. Use IDs as the keys and current catalog names as the labels for
reviewers. A game belongs in one row. The last row is always Miscellaneous.
Published playable games missing from the file appear alphabetically at the
end of Miscellaneous until the next review.

Rank new titles against their neighbors using online play where available.
Prefer comparable plays, active players, or tournaments on the same platform
and in the same time window. For titles with limited data, use public releases
of the same game or gaming family and documented reach as rough signals. Keep
close calls stable. The initial ordering used online reach and editorial
estimates for smaller titles, using sources such as these:

- [Chess.com 2025 year in review](https://www.chess.com/article/view/year-in-review-2025)
- [Board Game Arena 2025 plays and tournaments](https://en.boardgamearena.com/news?id=1025)
- [CardGames.io catalog](https://cardgames.io/)
- [Dominos Online Jogatina game modes and install range](https://play.google.com/store/apps/details/?id=air.com.jogatina.domino.android)
- [Codenames Online audience](https://www.codenamesgame.com/play-online)

Keep Chess, Backgammon, and Connect Four in the first three Board & Strategy
Games positions. When several games serve a recognizable audience and would
be hard to discover in the existing rows, consider adding a category before
Miscellaneous. Compare the full published catalog with the manifest before
pushing an update. The BuildPlay VM runs the weekly review every Monday at
09:00 UTC. It compares the live catalog with the manifest on `main` and writes
the review prompt and uncategorized titles to a single GitHub issue. The
scheduled command is `python3 catalog-carousel-review.py --publish`.

The Portal loads each public category from `/v2/games/carousels/{category}`. Its
VM keeps playable game summaries and ordered carousel IDs in memory. Writes
that change live game records invalidate the local snapshot. The VM warms the
catalog at startup and refreshes it in the background after 15 minutes on the
next request. Recently played uses the same summaries and pages the signed-in
player's own game IDs.
