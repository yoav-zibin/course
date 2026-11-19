# BuildPlay shared player app

One React Native application runs on Android, iOS and the web. Screens, accounts,
match controls, synchronization, local practice and the declarative SVG renderer
live in `src/`. Platform files provide storage, browser login, gestures and
isolated execution. The Python backend remains authoritative for online games.

## Local development

Use Node 22.13 or newer and the repository's Python dependencies:

```sh
npm ci
npm --prefix frontends/portal ci
npm run build:portal
E2E_PORT=8128 .venv/bin/python e2e/start-server.py
```

Open `http://127.0.0.1:8128/portal`. The test server uses a temporary database;
it never seeds or changes production. Web export publishes hashed assets before
atomically replacing entry files, so a rebuild does not remove a running preview.
For interactive development, run `npm --prefix frontends/portal run web` and use
`preview.py` only when deliberately testing against its configured remote backend.

```sh
npm run typecheck:portal
npm run test:portal
npx playwright test -c frontends/portal/playwright.config.ts
```

The shared tests compile the same bounded QuickJS C runtime as native apps and
exercise real game packages, storage migration, lost responses, retry keys,
account changes and offline practice. Browser acceptance covers shared player
flows and actual board gestures. See `docs/mobile-development-on-vm.md` for native
builds and CI artifacts. Generated `android/`, `ios/` and web bundles are ignored.

## Behavior and data

- Online actions send `{move, expected_move_count}`. Each saved action keeps its
  original `Idempotency-Key`. A missing reply is reconciled with filtered history
  before retrying. One pending online action pauses further input for that match.
- Local pass-and-play and computer practice use downloaded pinned rules and a
  separate local state/seed. They work offline. Bundled Tic-tac-toe is available
  on a fresh installation. A handoff hides the next player's board until confirmed.
  Game details let computer practice use any supported player count and human
  seat. The selected seat keeps its own view and controls after restart, history
  review and Play again; saved matches retain their original player positions.
- Credentials use SecureStore on native platforms and the established account
  storage keys on web, keeping the admin pages and player app compatible.
- Read-only native modules recover the old Android Keystore and iOS Keychain,
  local Tic-tac-toe saves and cached branches. Old encrypted files are retained.
  Retired HTML pending branches are archived rather than submitted as new moves.
- Existing bookmarks, invite links, installed PWA identity and old generated game
  documents retain narrow compatibility bridges. Those documents render through
  the shared React Native web renderer; there is no second board implementation.
- Google sign-in on native uses the system browser and a short-lived proof-bound
  handoff. Credentials and verifier values never enter callback URLs or games.
- Web push uses the existing backend Web Push subscription API. Native apps have
  the same in-app turn updates while active; background native push requires a
  separately configured native push delivery service.

The QuickJS module has no application I/O bindings. Each execution gets a fresh
context with time, memory, stack, input and output limits. Browser execution uses
an opaque-origin frame and a terminable worker. The native game board uses SVG
components directly, without a game WebView.

Interface copy uses the existing server catalog plus the bundled eight-language
fallback in `src/platform/ui-copy.json`. Use `copyText` for authored interface
literals and `t` for existing catalog keys; update all seven translations when
changing copy. Keep names and other user content as parameters. The bundled
starter game includes translations from `games/declarative/tictactoe.json` so it
also works in every language offline. Dictionary tests check locale/parameter
coverage; browser tests switch all eight languages without changing saved games.

## Delivery

CI builds the web artifact, backend tests and browser acceptance before deploying
the tested web bundle to the existing VM. `Portal apps` generates both native
projects from this source, publishes a standalone Android APK, builds an iOS
simulator app, and retains the existing opt-in TestFlight configuration. Keep
production credentials, database namespace and signing settings outside source.

The historical rolling Android debug APK used ephemeral CI signing keys. An
installation signed with a different old key cannot be upgraded in place by a
new key; do not uninstall an existing guest installation to work around that
without preserving its data. The new generated debug signing identity is stable
for future CI builds. iOS updates retain the configured bundle identifier/team.
