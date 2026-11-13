# Visual game chooser

The shared portal includes a grid/list gallery, name/description search, player-support filters, and accessible native card buttons. The first catalog entry is **Random** (“Join an open match of any game”): it joins a randomly selected joinable match, or creates a lobby for a random published multiplayer game if no match is available. Clicking another game card or search result loads that game's detail view in the same tab; the description and existing online/local match controls appear there, not below the gallery. Query-string routing ensures the detail view initializes immediately after navigation; older `#game=` links remain supported. The detail view reuses the current match-creation flow and can return to the catalog.

After a finished online match, each human participant can request a rematch. The first request creates a public lobby for the same game version; other original participants can join from the completed match, while other users can join through the open-match list. For a match with one human and computer opponents, **Play again** immediately starts a new match with the same game version and number of computer opponents.

## Gallery artwork

Imported games carry package images: the first is the cover, exposed as
`cover_url` on the game and served by `GET /games/{id}/versions/{version}/cover`.
Games without package images (older records) fall back to CSS monogram
placeholders in the gallery.

## Verification

Run `node --test tests/web/*.test.cjs`. The gallery checks cover player filters, description search, empty results, selection through existing solo controls, and preserving card nodes during polling. Browser checks covered grid/list switching and choosing a game. Physical phone validation remains pending.
