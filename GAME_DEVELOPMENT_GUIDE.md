# Developing games

All playable games use a declarative presentation package and authoritative
JavaScript rules. Start with [Authoring declarative games](docs/declarative-games.md)
and the [interaction requirements](docs/declarative-game-requirements.md).

Read [match kinds, ownership and cloud saves](docs/match-kinds.md) before changing
match logic or Portal flows. Every match is cloud-backed. Private `computer` and
`pass_and_play` matches belong to one account and use deterministic downloaded
rules for unlimited offline turns, with cloud sync on reconnect. Shared
`multiplayer` matches contain humans only and use the authoritative server move,
invite and notification APIs. Game rules must work with stable seat identities
in all supported kinds; pass-and-play does not create additional accounts.

Use the numbered steps to create a new game. For an authorized edit to an existing
game, follow the partial-update instructions below.

1. Write deterministic rules implementing the [server game API](docs/server-side-game-api.md).
2. Define state, move and view schemas and complete initial, intermediate and terminal examples.
3. Build a `declarative_ui` package conforming to [the schema](schemas/declarative-ui.schema.json).
   Keep the last accepted move in authoritative state and its filtered view,
   including the source, intermediate stops and destination needed for replay.
   Implement optional `gameUI.getLastMoveAnimations(view, scene)` to return
   ordered piece paths; see [the move-animation contract](docs/declarative-games.md#describe-the-last-moves-paths).
   The portal animates opponent moves and applies your own moves immediately.
   Games without this function keep the existing default animations.
4. Review scenes in `/static/declarative-test.html`; validate them with
   `POST /games/declarative/validate`. Include phone/tablet, spectators, covered
   pieces, available actions and complete matches in the review.
5. Include rules, UI instructions, tutorial, supporting SVG illustrations and all
   translations. Record the complete REST test flow described in the
   [import guide](docs/agent-game-import.md). The trace endpoints retain their
   `/game-test/*` names; the old HTML submission page is removed.
6. Submit the complete tested package to `POST /games/declarative`. Keep its
   submission secret private and save the returned game ID for future updates.

Update an existing game only through `PATCH /games/{game_id}`, including its
submission secret or the configured master password in
`game_addition_request_id_and_secret`. Send only the content fields that should
change; omit unchanged fields instead of sending `null`. PATCH returns HTTP 200;
the POST routes create new games only (HTTP 201). Server logic, unit-test and
mechanical-rule changes run server checks and random walks;
presentation changes require the recorded test flow for the complete resulting
payload. Name, textual rules, images and other metadata edits need only the
relevant artifact/translation checks. See [partial updates](docs/agent-game-import.md#updating-a-game)
for the authentication, merge and validation contracts.

[Twenty-one complete examples](games/declarative), including ten conversions
of existing HTML games, and
[the standalone import example](examples/agent-game.json) show the payload.
`tools/publish_declarative_games.py` runs the recorded publication flow.
Regenerate the converted packages with
`node tools/build_html_declarative_conversions.mjs`; this writes local examples
only. The [declarative game guide](docs/declarative-games.md) has the exact
portal publication command and game names.

Legacy HTML games remain in the database for [future migration](docs/html-game-retirement.md).
Their source and original artifacts are available from the legacy read API.
The portal, authoring API and match API support declarative games only.
