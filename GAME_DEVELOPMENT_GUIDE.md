# Developing games

All playable games use a declarative presentation package and authoritative
JavaScript rules. Start with [Authoring declarative games](docs/declarative-games.md)
and the [interaction requirements](docs/declarative-game-requirements.md).

1. Write deterministic rules implementing the [server game API](docs/server-side-game-api.md).
2. Define state, move and view schemas and complete initial, intermediate and terminal examples.
3. Build a `declarative_ui` package conforming to [the schema](schemas/declarative-ui.schema.json).
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
change. Server logic and unit-test changes run server checks and random walks;
presentation changes require the recorded test flow for the complete resulting
payload. Name, textual rules, images and other metadata edits need only the
relevant artifact/translation checks. See [partial updates](docs/agent-game-import.md#updating-a-game)
for the authentication, merge and validation contracts.

[Eleven complete examples](games/declarative) and
[the standalone import example](examples/agent-game.json) show the payload.
`tools/publish_declarative_games.py` runs the recorded publication flow.

Legacy HTML games remain in the database for [future migration](docs/html-game-retirement.md).
Their source and original artifacts are available from the legacy read API.
The portal, authoring API and match API support declarative games only.
