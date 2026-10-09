# Playroom · native Android portal

Kotlin, Jetpack Compose and Material 3 frontend for the **shared course repository**.
The default server is [buildplay.fun](https://buildplay.fun/); Google Cloud console
login is not required to play. Android and the existing [web portal](https://buildplay.fun/portal)
use the same accounts, games, matches and protocol.

## Local development

Use Java 21, Android SDK 36 and build tools 36.0.0. Android Studio's Java 25 runtime
is too new for this project's pinned Gradle 8.13. On Apple silicon:

```bash
brew install --cask android-studio
brew install openjdk@21
./android/scripts/bootstrap_android.sh
./android/scripts/start_emulator.sh
./android/scripts/build_android.sh testDebugUnitTest lintDebug assembleDebug
./android/scripts/build_android.sh connectedDebugAndroidTest
"$HOME/Library/Android/sdk/platform-tools/adb" install -r android/artifacts/app-debug.apk
```

Open `android/` in Android Studio and select Java 21 as **Gradle JDK** if needed.
The build helper also sets `.gradle/config.properties` to the detected local JDK.
On macOS, generated build outputs go under the system temporary directory to avoid
iCloud duplicating compiler files. `assembleDebug` exports the APK to ignored
`android/artifacts/app-debug.apk`; `PORTAL_BUILD_DIR` can override the build directory.
Launch **Playroom** on the emulator. Android 8/API 26 or newer is supported.
The debug APK is signed with the Android development key and connects to the
public HTTPS backend even when the local Python server is stopped.

## Demo with the web portal

1. In Playroom, enter a guest name. Create a Tic-tac-toe match.
2. Copy the match link. Open it on a second computer/phone in the web portal.
3. The second player logs in with a different guest account and joins.
4. The Android host presses **Start game**. Alternate moves to complete a win or draw.
   For the currently deployed TicTacToe version, let Android make the final move;
   the web portal has a legacy end-message bug described in [VALIDATION.md](VALIDATION.md).
5. Reopen Playroom or rotate the device: the account and selected match are retained.
6. Turn off the emulator's network, then restore it. The app shows a connection
   failure and reloads the server's state; **Retry** requests an immediate refresh.
7. Leave the local development server stopped throughout this demonstration.

For a borrowed Android phone, copy the APK by USB/file transfer, open it, and allow
installation from that transfer app when prompted. Only internet access and a
current Android System WebView are needed; Android Studio is not needed on the phone.
Create a new guest there, or paste a match link. Guest identities are local to each
installation; clearing app data/uninstalling loses that guest's credentials.
Physical-device testing is still required for the professor's real-device demo.

## Release builds on the class VM

See [VM_BUILD.md](VM_BUILD.md). Signing keys and private build configuration belong
on the VM outside the checkout. `PORTAL_BUILD_CONFIG` points to a private JSON file;
there are no checked-in signing credentials. A release build refuses to proceed
without that file. Debug builds do not require it.

The shared backend already exists. These scripts do not deploy, reconfigure, seed,
or restart it. The VM administrator must confirm that its existing data file lives
on persistent storage and perform any authorized restart test.

## Implementation boundaries

- Native guest entry, catalog, open/my matches, waiting room, match actions, link sharing.
- Retrofit with the course's `X-User-Id`/`X-User-Password` headers; no API changes.
- Credentials encrypted with Android Keystore AES-GCM. Backup/device transfer of
  this session storage is excluded. A selected match is restored on startup.
- Visible screens poll every two seconds and refresh on resume/actions. A mutex
  serializes refresh and mutation, with one in-flight move and `expected_move_count`.
  Uncertain/rejected moves are followed by an authoritative fetch. There is no offline queue.
- Exact match game version and opaque JSON state. Unchanged HTML runs in an
  `allow-scripts` sandboxed iframe. A bundled host verifies the iframe source and
  uses an origin-restricted, main-frame-only `addWebMessageListener`; credentials
  never enter JavaScript. See [Android's bridge guidance](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge).
- Turn sets and legacy single-turn fields are supported. Tic-tac-toe is the required
  acceptance target; other catalog games share the generic renderer.

## Verification and publication

The bridge instrumentation test exercises real WebView origin isolation, nested-frame
spoofing, duplicate messages and state resending. JVM tests cover protocol serialization,
auth headers, conflict handling and link parsing. The optional live API smoke test
creates two reusable test guests and disposable matches, stored only in ignored `.local/`:

```bash
python3 android/scripts/cloud_smoke.py --url https://buildplay.fun
```

Only run it against a server where you are authorized to create test data.
It deletes only its own test matches; it does not test a server restart.

To opt into Android UI gameplay against a second cloud API client:

```bash
./android/scripts/build_android.sh connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.liveBackend=true
```

This test creates/reuses demo guests, plays a win and draw through the real Android
game view, recreates the activity mid-match, and deletes its own temporary matches.
The regular instrumentation suite also tests a committed move whose response is
lost, confirming that offline retries cannot duplicate it and reconnection fetches
the authoritative result. Live tests are skipped by default.

For a paired test against the actual browser portal, run:

```bash
./android/scripts/build_android.sh connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.dapillah.gameportal.BrowserInteropTest \
  -Pandroid.testInstrumentationRunnerArguments.browserPartner=true
```

Read the `PortalBrowserTest` logcat tag for each match link. Join from the browser
as a separate guest. Android starts automatically and plays X. Using zero-based
cells from top-left, play O at `3,4` for the first match and `1,4,5,6` for the second.
The test checks a win, draw and portrait/landscape restoration. Each browser action
has a three-minute timeout. It retains these demonstration matches for inspection.

Work on a branch in `yoav-zibin/course`. Before committing, inspect staged paths and
the diff. The intended additions live under `android/`, plus local/secret exclusions
in the root `.gitignore`. Do not include server data, account files, keys, APKs, or
local IDE settings. Backend endpoints, schemas and portal/game messages remain unchanged.

The upstream backend suite currently has a pre-existing stale example fixture failure
at `test_example_data.py::test_the_example_data_file_is_up_to_date` (146 passed, 1 failed).
Regenerating the fixture locally makes all 147 pass, but that unrelated generated-data
change is deliberately excluded from the Android frontend contribution.
