This catalog contains the public rules and schemas for all 50 published games
read from https://buildplay.fun/games on November 6, 2026. Source paths reuse the
matching game code already checked into this repository. The only extra source
copies are the published Poker v7 and Dots & Boxes v2, which had no matching
local file. These are test fixtures, not publication inputs.

`test_published_game_leaving.py` runs these versions in isolated in-memory
matches through the ordinary HTTP API: direct departure, preview/confirmation,
and solo play. It checks complete settlement, stable previews, inactive seats,
history, no bot substitution, and rejection of repeated payouts. Real game
schemas remain enabled. None of the tests contact or modify production.
