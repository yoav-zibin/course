# Game Builder

Adapted from https://github.com/marcelle-r/gamebuilder at `f23953e`.
The original Firebase demo remains at https://gamebuilder-demo-c9e4e.web.app/.

Open `/builder` on the course server using the existing **Game Builder** tab.
The original course editor is retained at `/static/gamebuilder/code-editor.html`,
linked as **Code editor**; existing games made there remain editable there.
Old `/static/gamebuilder/index.html` bookmarks redirect to `/builder`. Log in using the same course account on both devices. Enter an
OpenAI API key to generate/refine a game, wait for **Saved to cloud**, then load
it on another device using **Refresh cloud games**. Play it in `/portal`.
Google/email logins recover the same account across devices; separately created
guest accounts have separate libraries.

## Integration

- Uses the existing course `Auth` and `apiRequest` helpers.
- Creates games using `POST /games`; edits use `PATCH /games/{id}`; deletion uses
  `DELETE /games/{id}`. There are no backend or API changes.
- `course-package.js` exports playable HTML using the current `state_changed` /
  `make_move` contract, including computer turns and synchronized initialization.
- Rules, tutorials, chat and five recent versions live in a base64 JSON comment
  in the HTML package. The course game schema has no separate draft fields.
  This preserves builder editing without adding fields to the shared API.
- Every successful save makes the game available to the shared portal. This
  backend has no separate private-draft/publish endpoint. Game data is public,
  as in the existing course builder; only the creator can edit/delete.
- Supports 2–10 players, matching the backend. Mid-match join/leave is disabled
  because generated games do not implement dynamic seat changes.
- API keys stay in the current tab and go directly to OpenAI, as in the original
  Firebase build. They are not stored in game data, code or account storage.
- The existing sandbox/worker playtests, pass-and-play, computer mode, refinement
  and version restore are retained. The `extras` branch of the original project
  is not merged: its export API targets a different contract.

Existing Firestore libraries are not migrated automatically. The Firebase login
and course login are separate systems. Keep the Firebase deployment available
while choosing which older games to transfer; avoid copying private drafts into
this public backend without reviewing them.

## Build and verification

Node 24+:

```sh
node static/gamebuilder/scripts/build-course.js
node static/gamebuilder/tests/harness.test.js
node static/gamebuilder/tests/course-package.test.cjs
```

The generated `static/builder.html` is committed, so the server needs no Node build step.
Source lives in `src/`; rebuild after source edits. The intermediate `dist/` is
ignored. The rest of the course project still uses its normal Python setup.

For the end-to-end test, install Playwright and Chrome, start an **isolated local
course backend with empty data** at port 8765, then run:

```sh
node static/gamebuilder/tests/course-browser.test.cjs
```

Do not point this test at the live course server: it creates disposable guest
accounts, games and matches. It tests actual backend storage across independent
browser contexts and uses fake AI responses, without paid calls. Real Google
sign-in and production deployment must be checked separately after release.

## Release

Merge the frontend changes into the shared repository, then update the course VM
using its existing deployment process. The existing tab will open your frontend at `https://buildplay.fun/builder`. Pushing a branch by itself
does not demonstrate deployment. No VM access/configuration was supplied in this
chat, so these changes are prepared and tested locally only.
