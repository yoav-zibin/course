# Published game repair source

The catalog stores complete versioned packages. These diffs preserve the
changed source for games whose full packages are maintained in the catalog.

| Game | Base version | Game ID |
| --- | --- | --- |
| Senet | 4 | `5292ce7b-b39c-4a1c-a652-473a1e5a5881` |
| Sittuyin | 4 | `05029c9d-c266-426e-b96c-b6dac311d90c` |
| Uno | 5 | `b167b753-0bde-4ce8-960b-063b658bcce4` |
| Checkers | 3 | `04aad4ba-8cf6-4dd5-8d65-9dead4dab5ee` |
| Tic-Tac-Toe | 4 | `3a3c1981-77a3-4fc4-83c5-a37ff604c240` |

To reproduce a repair, export the base package and write
`declarative_ui.ui_code` to `ui.js`. For Senet, also write `server_code` to
`server.js` and serialize `unit_tests` to `unit_tests.json` as UTF-8 JSON with
two-space indentation and a trailing newline. For Checkers, write the first
image’s SVG to `cover.svg`. For Tic-Tac-Toe, serialize
`declarative_ui.piece_types` to `piece_types.json` and the
`all_state_public` field to `metadata.json`.
Normalize each source file to
one final newline before applying the corresponding diff with
`git apply --unidiff-zero`. Put the amended fields back into the package and
follow the [game update workflow](../../GAME_DEVELOPMENT_GUIDE.md).
