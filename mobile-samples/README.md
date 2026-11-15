# BuildPlay mobile samples

Two tiny native sample apps for the BuildPlay gaming platform
([buildplay.fun](https://buildplay.fun)), built entirely in the cloud —
no Mac or local development machine is required.

| Sample | Folder | Language | What it does |
| --- | --- | --- | --- |
| Android | `mobile-samples/android/` | Kotlin (single Activity, no libraries) | Shows platform status and can ping `https://buildplay.fun/health` |
| iOS | `mobile-samples/ios/` | Swift / SwiftUI (no packages) | Same screen and health check as the Android sample |

These are deliberately minimal "pipeline proof" apps: they exist so every
step — source in GitHub → CI build → install on a real phone — works end to
end. The full class portal apps already in this repository
(`android/` and `frontends/ios-game-portal/`) can adopt the same CI setup
when they are ready to ship.

## How the builds work

GitHub Actions workflow **Mobile samples**
(`.github/workflows/mobile-samples.yml`) runs when files under
`mobile-samples/` change, and can also be started manually from the
repo's **Actions** tab ("Run workflow").

- **Android** builds on a free Ubuntu runner (`ubuntu-latest`) with
  Java 17 and Gradle 8.9. No Android Studio, no signing key and no paid
  account are needed for testing: the debug APK is signed with the
  standard Android debug key, which any Android phone accepts for
  sideloading.
- **iOS** builds on a GitHub-hosted Mac (`macos-15`, latest stable
  Xcode). This repository is public, so the standard macOS runners are
  included with GitHub Actions at no extra cost — there is no separate
  "GitHub macOS subscription" to buy. The Linux cloud VM that hosts the
  website cannot build iOS apps (Xcode only runs on macOS), which is
  why the Mac work happens in CI.

## Install the Android sample on a phone

Every successful build on `main` updates the rolling GitHub release
**mobile-samples**, so the newest APK is always at this stable link:

<https://github.com/yoav-zibin/course/releases/download/mobile-samples/BuildPlaySample.apk>

1. Open the link in the browser on the Android phone and download the APK.
2. Tap the downloaded file and allow "Install unknown apps" for the
   browser when Android asks (this is expected for direct APK installs
   outside Google Play).
3. Open **BuildPlay Sample**, tap **Check server**, and confirm it
   reports the live `buildplay.fun` health response.

Builds are also kept as workflow artifacts (`BuildPlaySample-android-apk`)
on each run's Actions page for 90 days.

Publishing to Google Play later is optional and separate: a Google Play
Console developer account costs a one-time $25, and a signed release
(AAB) build can be added to this same workflow when that day comes.

## Install the iOS sample on an iPhone — TestFlight

Apple only lets a real iPhone install apps that are signed under an
**Apple Developer Program** membership ($99 per year, paid to Apple;
TestFlight itself is included at no extra charge). There is no way
around this with CI settings alone, so the pipeline is split in two:

- **Today, without a membership:** CI compiles the app and uploads a
  simulator build as the `BuildPlaySample-ios-simulator` artifact. That
  proves the code and project build cleanly on a Mac, but a simulator
  build cannot be installed on a physical iPhone.
- **After enrolling:** the workflow's `ios-testflight` job is already
  written. It archives a signed build and uploads it to TestFlight
  using an App Store Connect API key. You then install Apple's free
  **TestFlight** app on the iPhone, accept the invite, and every new
  build appears there automatically.

### One-time setup after enrolling (about 15 minutes)

Enrollment itself must be done by the account holder personally —
Apple verifies your identity. Enroll on the iPhone with the
**Apple Developer** app (or at developer.apple.com) using your Apple
Account; approval is usually quick for individuals.

Then:

1. In [App Store Connect](https://appstoreconnect.apple.com), create an
   app record named **BuildPlay Sample** with bundle ID
   `fun.buildplay.sample` (register the bundle ID under Certificates,
   Identifiers & Profiles if prompted).
2. In App Store Connect → Users and Access → Integrations, create an
   **App Store Connect API key** (role: App Manager is enough) and
   download the `.p8` file — Apple only lets you download it once.
3. In this repo → Settings → Secrets and variables → Actions, add:
   - Secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`
     (the raw `.p8` file content, including its BEGIN/END lines), `APPLE_TEAM_ID`
   - Variable: `TESTFLIGHT_ENABLED` = `true`
4. Run the **Mobile samples** workflow on **main**. The build appears in
   TestFlight (App Store Connect → your app → TestFlight) after Apple
   finishes processing it, typically within ~15 minutes. Add yourself
   as an internal tester, install via the TestFlight app, done.

Once enabled, TestFlight uploads run only for pushes to **main** and manual
runs on **main**. Pull requests still build the unsigned simulator sample.
Each archive uses the workflow run number and attempt as its build string
(for example, `12.1`), so new runs and retries get distinct build numbers.

Keep the `.p8` key and passwords in a password manager / secure vault —
never commit them to this repository.

## Building without GitHub Actions (optional)

- Android can also be built on the Linux cloud VM: install Java 17 and
  the Android SDK command-line tools, then run
  `gradle :app:assembleDebug` in `mobile-samples/android/` (the same
  pattern as `android/VM_BUILD.md`). Useful as a fallback; CI is the
  primary path so the production VM stays untouched.
- iOS has no Linux option: use GitHub's macOS runners, or any Mac with
  Xcode 16+ by opening `mobile-samples/ios/BuildPlaySample.xcodeproj`.

## Growing these into the real app

Replace `MainActivity.kt` / `ContentView.swift` screen by screen, keep
the bundle IDs (`fun.buildplay.sample` → e.g. `fun.buildplay.app` for
production, registered the same way), and the CI + release plumbing
keeps working unchanged.
