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
  Native account indexes, selected accounts and secure password slots are scoped
  to the canonical API origin. Only production adopts the former unscoped native
  credentials, copying them into new slots while retaining the originals.
- Read-only native modules recover the old Android Keystore and iOS Keychain,
  local Tic-tac-toe saves and cached branches. Old encrypted files are retained.
  Retired HTML pending branches are archived rather than submitted as new moves.
  Legacy browser saves belong to their serving origin; native unscoped saves
  default to production. A retained `game-platform.portal.origin.v1` value can
  explicitly identify a different legacy origin for recovery. Other API origins
  never adopt those private views or pending actions merely by sharing a user ID.
- Existing bookmarks, invite links, installed PWA identity and old generated game
  documents retain narrow compatibility bridges. Those documents render through
  the shared React Native web renderer; there is no second board implementation.
- Google sign-in on native uses the system browser and a short-lived proof-bound
  handoff. Credentials and verifier values never enter callback URLs or games.
- Web push uses the backend Web Push subscription API. Android and iOS use
  `expo-notifications` and the Expo Push Service when the build has the platform
  credentials described below. The notification inbox and active-app updates
  also work in builds without those credentials.

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

## Native push setup

The app includes native enrollment, token refresh, foreground alerts and tap/cold
start routing. A new standalone build is required after configuring native push.
Unconfigured builds continue to run and show that device notifications are
unavailable; they do not request permission. Enabling notifications explicitly
requests permission, while startup/resume reconciliation only registers an
already permitted device. Account changes remove the previous account's device
registration before registering the selected account.

There is no existing Expo project configured for this repository. Complete the
following setup with the account that should own BuildPlay:

1. Run `npx --yes eas-cli login`, then `npx --yes eas-cli init` from
   `frontends/portal`. Create/link the project and retain its project UUID.
   Add that UUID as the GitHub Actions variable `EXPO_PROJECT_ID`. For local
   builds, export `EXPO_PUBLIC_EAS_PROJECT_ID` with the same UUID; the dynamic
   app config places it in `extra.eas.projectId`.
2. For Android, create Firebase Android clients for the app identifiers you
   distribute: `com.dapillah.gameportal.debug` for the rolling APK and
   `com.dapillah.gameportal` for production. Download their `google-services.json`.
   Add the JSON containing the debug client as the GitHub Actions secret
   `ANDROID_GOOGLE_SERVICES_JSON`. CI validates the application identifier and
   writes the file to its temporary directory before prebuild. Local builds use
   `BUILDPLAY_GOOGLE_SERVICES_FILE=/absolute/path/google-services.json`.
3. Configure the Firebase FCM v1 service account in the Expo project using
   `npx --yes eas-cli credentials --platform android`, with
   `EXPO_PUBLIC_EAS_PROJECT_ID` exported. The client `google-services.json` and
   the FCM service-account credential serve different purposes; keep private
   service-account keys outside source.
4. For iOS, use `npx --yes eas-cli credentials --platform ios` to configure an
   APNs key for the Apple team and existing `IOS_PORTAL_BUNDLE_ID`. Enable the
   Push Notifications capability and ensure the distribution provisioning
   profile includes it. After the Expo APNs credentials are ready, set the
   GitHub variable `IOS_PUSH_ENABLED=true`. The existing TestFlight job will
   include the production `aps-environment` entitlement. A local physical-device
   build uses `BUILDPLAY_IOS_PUSH_ENABLED=1`; for a development APNs environment
   also set `BUILDPLAY_APNS_ENVIRONMENT=development`.
5. Rebuild and install on physical Android/iOS devices, sign in, and enable
   notifications in the account profile. With that account, `POST /push/test` verifies the
   configured delivery path. Check an incoming notification while the app is
   active, while backgrounded, and after closing it; tapping should open the
   referenced match/invite. Simulator builds remain useful for the inbox and
   ordinary app smoke tests, but do not establish remote delivery readiness.

The backend must advertise `native_enabled` in `GET /push/config` and deliver
Expo subscriptions. Web push keeps its separate VAPID configuration. See the
[Expo setup guide](https://docs.expo.dev/push-notifications/push-notifications-setup/)
for account/platform credential provisioning and the
[Expo notification API](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/)
for the SDK 58 enrollment and listener APIs. Android's `matches` channel is
created before requesting permission or acquiring a device token.

Android's counterpart to TestFlight is
[Google Play internal or closed testing](https://support.google.com/googleplay/android-developer/answer/9845334),
which installs and updates tester builds through the Play Store.
[Firebase App Distribution](https://firebase.google.com/docs/app-distribution/) can
also distribute test APKs. This repository currently publishes its rolling APK
through GitHub Releases; Play/Firebase distribution is not configured by this change.

The historical rolling Android debug APK used ephemeral CI signing keys. An
installation signed with a different old key cannot be upgraded in place by a
new key; do not uninstall an existing guest installation to work around that
without preserving its data. The new generated debug signing identity is stable
for future CI builds. iOS updates retain the configured bundle identifier/team.
