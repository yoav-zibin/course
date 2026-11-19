# BuildPlay web, Android and iOS development

The application source is [frontends/portal](../frontends/portal). Expo and React
Native render the same screens, navigation, game scenes and match behavior on
Android, iOS and web. Platform adapters provide secure storage, file persistence,
the native JavaScript game runtime, sharing and migration from older installations.
The Python backend remains authoritative for online play.

Use a separate checkout on the course VM. Do not develop in the running backend
checkout (`/opt/game-platform`) or the automated auditor's checkout. Read
`AGENTS.md`, integrate current upstream, perform checks relevant to the change,
and push directly to `main`; this repository does not require new PRs. CI provides
broad validation. Native builds are not a pre-push requirement for unrelated work.

## Install and run

Use Node 22.13 or newer. From the repository root:

```bash
npm --prefix frontends/portal ci
npm --prefix frontends/portal run typecheck
npm --prefix frontends/portal test
npm --prefix frontends/portal run web
```

`EXPO_PUBLIC_API_URL` selects the backend when bundling. The default is
`https://buildplay.fun`; use a disposable local/test backend for tests that create
accounts or matches. `npm --prefix frontends/portal run build:web` exports the
production browser application into `static/app`. Build that asset directory
before packaging or deploying the Python server.

Generated `frontends/portal/android`, `frontends/portal/ios`, `.expo` and native
build outputs are local artifacts. Change `app.config.ts`, config plugins, local
modules or TypeScript source, then regenerate; do not maintain another app in
those generated directories. The local modules under `modules/` are source.

Expo Go does not include the custom native game-runtime or legacy-migration
modules. Use a native build for gameplay and account-upgrade testing.

## Android on the VM

The existing toolchain is available under the `yoav_zibin` account:

| Path | Purpose |
| --- | --- |
| `/home/yoav_zibin/.local/share/buildplay-mobile/android-env.sh` | Selects installed SDK and Java; no credentials. |
| `/home/yoav_zibin/.local/share/buildplay-mobile/android-sdk` | Android SDK. Gradle installs its pinned NDK/build tools as needed. |
| `/home/yoav_zibin/.local/share/buildplay-mobile/jdk` | Java 21 JDK. |
| `/home/yoav_zibin/.local/share/buildplay-mobile/gradle-cache` | Existing download/dependency cache. |
| `/home/yoav_zibin/.local/share/buildplay-mobile/artifacts/<run-id>/` | Downloaded cloud artifacts. |

These are aliases to an existing installation. Reuse the tools; do not delete
their installation or edit its owning checkout. From `frontends/portal`:

```bash
source /home/yoav_zibin/.local/share/buildplay-mobile/android-env.sh
export BUILDPLAY_VARIANT=debug
npx expo prebuild --platform android --no-install --no-clean
DD_INSTRUMENT_SERVICE_WITH_APM=false DD_INJECT_NATIVE=never \
  bash android/gradlew --project-dir android --no-daemon --max-workers=2 \
  -Pandroid.enableMinifyInReleaseBuilds=false :app:assembleRelease
```

The per-command Datadog flags prevent this VM's automatic instrumentation from
inserting JVM diagnostics into Android Gradle's prefab protocol.

`android/app/build/outputs/apk/release/app-release.apk` is standalone: its
JavaScript and assets are embedded. `npx expo run:android` builds a development
app connected to Metro instead. Do not publish an ordinary development APK as
a standalone download.

For disposable local API tests, prebuild and bundle with `BUILDPLAY_LOCAL_TEST=1`
and `EXPO_PUBLIC_API_URL=http://127.0.0.1:PORT`, then run
`adb reverse tcp:PORT tcp:PORT` before launching. The native config permits HTTP
only with that explicit test flag and localhost, loopback IPs or Android's
`10.0.2.2` host alias. Production bundles use HTTPS.

The downloadable development application retains package
`com.dapillah.gameportal.debug`; `BUILDPLAY_VARIANT=debug` selects it. The
unsuffixed `com.dapillah.gameportal` remains the release identity. Never change
an installed app's package merely to work around a signing error.

The Expo template contains a public development signing key, providing stable
future CI development downloads. It is not a private store-distribution key.
Previous workflows generated Android debug keys on ephemeral machines, so an
arbitrary old APK may have a different signer. **An update preserves the old
app's private data only when the package and signer match.** Do not uninstall an
existing guest installation to resolve a signature mismatch without preserving
its account first. The upgrade reader cannot access an uninstalled app's data.

When an existing VM-built app used the VM's own default debug key, reuse it:

```bash
BUILDPLAY_ANDROID_DEBUG_KEYSTORE=/home/yoav_zibin/.android/debug.keystore \
  bash android/gradlew --project-dir android :app:assembleRelease
```

This selects the existing file without copying it into source control. Do not
print keys/passwords or commit private signing files. Google Play distribution
requires the original release signing configuration and is separate from the
development APK workflow.

## iOS on a Mac and in CI

The default bundle identifier is preserved as
`edu.columbia.gameportal.starter`. `IOS_PORTAL_BUNDLE_ID` overrides it for the
existing App Store Connect record. On a Mac, from `frontends/portal`:

```bash
npx expo prebuild --platform ios --no-install --no-clean
cd ios
pod install
open BuildPlay.xcworkspace
```

Choose the BuildPlay scheme. Use local ad-hoc signing for a simulator or the
existing Apple team for a phone build. Upgrading with the same bundle ID and
team preserves access to the old sandbox and Keychain. Switching identity/team
creates a different app or loses access to its account. The Linux VM cannot
compile iOS or run an iPhone Simulator; GitHub Actions uses a hosted Mac.

## Upgrade data

`modules/legacy-portal` reads the previous native applications' data without
modifying it. Android decrypts the existing `portal-session` account using its
original Android Keystore key and restores the selected match. iOS reads the
existing `edu.columbia.gameportal.online` Keychain item, `Documents/portal.json`
and `Application Support/OnlineSnapshots/account-*.json`.

The new native cache stores atomic JSON envelopes in Android's
`filesDir/BuildPlayShared` or iOS Application Support's `BuildPlayShared`.
SHA-256 key filenames allow large packages and archives without SQLite's row
and database limits. Existing AsyncStorage values are copied only after a
successful atomic write; their originals remain available for recovery.
Credentials stay in SecureStore rather than these cache files.

The shared importer persists the recovered identity and archives old snapshots,
local matches and pending branches before recording migration completion.
Retired HTML packages and their pending state-based moves are retained for
inspection; they are never executed or sent to the current move API. Corrupt
JSON originals are retained as base64 in the archive. A read/storage failure
leaves original files intact. Migration data and account exports are private;
keep them out of logs, screenshots, CI artifacts and Git.

## Cloud builds and downloads

The [Portal apps workflow](../.github/workflows/portal-apps.yml) runs shared
TypeScript checks and tests, builds the standalone Android APK, checks real
Keystore migration, corrupt-data preservation and large atomic cache values in
an Android emulator, and
builds and launches both native apps. It captures launch screenshots and checks
that the apps remain running. Android also drives bundled pass-and-play through
the native SVG scene, handoffs, restart restoration, completion and replay with
network access disabled. These checks do not replace offline recovery and
migration testing on real devices.

```bash
gh workflow run portal-apps.yml --repo yoav-zibin/course --ref main
gh run list --repo yoav-zibin/course --workflow portal-apps.yml --limit 5
gh run watch RUN_ID --repo yoav-zibin/course --exit-status
gh run download RUN_ID --repo yoav-zibin/course \
  --name BuildPlay-android-apk --dir ./mobile-build-downloads
```

Artifacts include `BuildPlay-android-apk`,
`BuildPlay-ios-simulator`, `BuildPlay-ios-build-results`, `BuildPlay-ios-test-results`,
`BuildPlay-ios-screenshots`, and `BuildPlay-gradle-logs`. Android migration and
launch diagnostics are in `BuildPlay-android-test-results`. Successful pushes to
`main` update [BuildPlay.apk](https://github.com/yoav-zibin/course/releases/download/portal-apps/BuildPlay.apk).
Manual runs provide artifacts without replacing that download. The ad-hoc-signed
simulator ZIP needs a Mac with Xcode; it cannot be installed on an iPhone.

CI prepares simulated entitlements for the generated BuildPlay application
target, using linker flags qualified to `iphonesimulator` SDKs. Following Xcode's
simulator convention, its `TESTTEAM00.<bundle-identifier>` application identifier
and private Keychain group are embedded in `__TEXT,__entitlements` (XML) and
`__TEXT,__ents_der` (DER). They are not permissions in the macOS host signature:
AMFI rejects ad-hoc host signatures that claim these restricted iOS entitlements.

Before packaging, `frontends/portal/scripts/sign-ios-simulator.py` refuses
device-platform bundles, verifies both embedded sections in arm64 and x86_64,
signs nested libraries before the app with empty host entitlements, and verifies
the signatures and unchanged sections. Simulator Keychain migration fixtures
must use the same embedded synthetic group for the old and new app.
**These simulator-only flags and synthetic entitlements never apply to
real-device or TestFlight archives.** Real upgrades must retain their original
App ID prefix, bundle identifier and team.

Simulator builds and launch checks use the validated `macos-26-intel` image
with Xcode 26.6. The TestFlight job uses the Apple Silicon `xcode-27` image and
pins Xcode 27.1, matching [Expo SDK 58's recommended build image](https://docs.expo.dev/build-reference/infrastructure/).
Its iOS 27.1 SDK satisfies Apple's April 2027 minimum SDK requirement and avoids
the ITMS-90725 warning emitted for iOS 26.5 builds. This changes the build SDK;
it does not raise the app's minimum supported iOS version. The bundle identifier,
Apple team, Keychain access and existing distribution signing remain the same.

Before export, [scripts/verify-ios-distribution-sdk.py](../scripts/verify-ios-distribution-sdk.py)
reads the compiled archive's `Info.plist` and requires device-platform metadata,
iPhoneOS SDK 27 or later, Xcode 27 or later, and resolved application scene
delegates. Expo SDK 58's generated project already adopts the scene lifecycle
required by iOS 27. The
check rejects an old archive even if the runner selected a newer Xcode. The
macOS 15 image's Xcode 26.3 failed Swift concurrency checks in Expo's dependencies
and remains excluded.
The simulator build and startup checks run in separate jobs. The startup job
downloads the compiled app, prepares Xcode's runtime caches, and uses a fresh
Mac with bounded boot, install and launch phases. Retrying a failed startup job
reuses the successful build. Build logs are in `BuildPlay-ios-build-results`;
phase logs, timing summaries and failure diagnostics are in
`BuildPlay-ios-test-results`. Successful startup remains required for TestFlight.

On a fresh GitHub simulator, the launch check seeds a local Connect Four match
from the public version-pinned SVG package in
`tests/fixtures/declarative/connect4-native-package.json`. Its screenshot covers
disc alignment against the rack holes. The seed helper refuses existing app
data and runs only for an explicit local-only CI launch; it creates no account
and makes no backend requests.

## Existing Apple signing setup

The optional TestFlight job remains gated by repository variables
`TESTFLIGHT_ENABLED=true` and `IOS_PORTAL_BUNDLE_ID`. It reuses the existing
Actions secrets `ASC_KEY_P8`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `APPLE_TEAM_ID`.
Routine app builds need no new secrets. The distribution archive uses ad hoc
signing and then exports with the existing App Store Connect API key and cloud
distribution signing. A simulator build does not establish TestFlight signing
or upload success. Apple must process the uploaded build and grant tester access.

Maintainer credentials remain outside all checkouts:

| Path | Use |
| --- | --- |
| `/home/yoav_zibin/.config/buildplay-mobile-ci-handoff/AuthKey.p8` | Existing App Store Connect team key. |
| `/home/yoav_zibin/.config/buildplay-mobile-ci-handoff/credentials.json` | Matching key, issuer and team identifiers. |
| `/home/yoav_zibin/.config/buildplay-mobile-ci-handoff/configure-github-secrets.py` | Validates and uploads existing Actions secrets without displaying them. |
| `/home/yoav_zibin/.config/gh/` | Owner-only GitHub CLI login configuration. |

Check login with `gh auth status --hostname github.com`; do not print tokens or
credential files. The owner-only handoff directory must remain private. When
the maintainer replaces a key, use the existing helper with `--check-only`, then
without that flag to sync secrets. Preserve the `.p8` PEM lines and actual
newlines. Issuer ID differs from Apple Developer team ID. The existing app
record and API key need cloud-managed distribution certificate permission.
Do not revoke shared certificates to repair ephemeral CI development signing.

See [Apple cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/),
[team API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api),
and [GitHub CLI login](https://cli.github.com/manual/gh_auth_login).
