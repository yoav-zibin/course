# Develop Android and iOS apps with an agent

Use the course VM to edit, review and push code. GitHub Actions builds Android
APKs on Linux and iOS apps on a hosted Mac. Students do not need a local Mac
for cloud builds. The Linux VM itself cannot run Xcode or the iOS Simulator.

## Start here

1. Give your agent SSH access to the course VM and access to
   `https://github.com/yoav-zibin/course`.
2. Use a separate student checkout on `main`. Do not develop in the running
   backend checkout (`/opt/game-platform`) or the automated auditor's checkout.
3. Ask the agent to read `AGENTS.md`, this guide and the app's README, implement
   the change, run appropriate checks, fetch current upstream and push directly
   to `main`. This repository does not use new branches or pull requests.
4. Open [GitHub Actions](https://github.com/yoav-zibin/course/actions), select
   the workflow below, choose **Run workflow**, and select **main**. Pushes
   that change the relevant app or workflow also start builds automatically.

| App source | Workflow | Downloadable artifact |
| --- | --- | --- |
| `android/` — Playroom Android portal | Portal apps | `Playroom-android-apk` |
| `frontends/ios-game-portal/` — GamePortal iOS portal | Portal apps | `GamePortal-ios-simulator` |

These are the repository's only two native applications. The temporary Android
and iOS samples and the paused legacy iOS Builder app have been removed. The
legacy Builder folder retains standalone game examples, without an app project.

GamePortal also has an opt-in TestFlight job in the same workflow. It requires
an owned App Store Connect bundle ID in `IOS_PORTAL_BUNDLE_ID`, valid team
credentials and Apple cloud-signing access. Its default development bundle ID
is preserved; the distribution job overrides it explicitly when configured.

## Build and get the result

With an authenticated GitHub CLI and repository Actions write access:

```bash
gh workflow run portal-apps.yml --repo yoav-zibin/course --ref main
gh run list --repo yoav-zibin/course --workflow portal-apps.yml --limit 5
```

Open the resulting run, wait for success and download its **Artifacts**. In
the CLI, replace `RUN_ID` with that run's numeric ID:

```bash
gh run watch RUN_ID --repo yoav-zibin/course --exit-status
gh run download RUN_ID --repo yoav-zibin/course \
  --name Playroom-android-apk --dir ./mobile-build-downloads
```

Install an Android APK on a test phone after allowing installation from your
browser/file manager. Successful **push** builds on `main` also update stable
download for [Playroom](https://github.com/yoav-zibin/course/releases/download/portal-apps/Playroom.apk).
Manual builds provide artifacts; they do not update those rolling releases.

An iOS simulator ZIP runs on a Mac with Xcode and an installed simulator
runtime. It cannot be installed on a physical iPhone. For a configured signed GamePortal
build, use Apple's TestFlight app after the CI upload and Apple's processing
finish and a maintainer grants tester access. Existing tester membership is
not automatically created by the build workflow.

Routine student builds reuse repository Actions secrets automatically. They
do not require copying private keys into a checkout or resetting secrets.

## Existing Android tools on the course VM

These stable paths are already available under the `yoav_zibin` VM account:

| Path | Purpose |
| --- | --- |
| `/home/yoav_zibin/.local/share/buildplay-mobile/android-env.sh` | Source this to select the installed Android tools; contains no credentials. |
| `/home/yoav_zibin/.local/share/buildplay-mobile/android-sdk` | Android SDK; platforms/build tools 35 and 36 are installed. |
| `/home/yoav_zibin/.local/share/buildplay-mobile/jdk` | Complete Java 21 JDK, including `javac`. |
| `/home/yoav_zibin/.local/share/buildplay-mobile/gradle-cache` | Existing Gradle download/dependency cache. |
| `/home/yoav_zibin/.local/share/buildplay-mobile/artifacts/<run-id>/` | Downloaded cloud APKs and iOS simulator ZIPs, grouped by CI run. |

The tool directories are aliases to the existing installation in the audit
workspace. Reuse them; do not delete the installation or edit that checkout.
A maintainer can relocate the tools and update the aliases without changing
student commands. Build output stays in each student's own checkout.

From your checkout's root, build and test the Android portal locally:

```bash
source /home/yoav_zibin/.local/share/buildplay-mobile/android-env.sh
bash android/gradlew --project-dir android --no-daemon --max-workers=2 \
  :app:testDebugUnitTest :app:assembleDebug
```

The APK is exported to `android/artifacts/app-debug.apk`. The wrapper selects
the project's pinned Gradle version; a system-wide Gradle install is not
needed. This headless command runs JVM tests and builds the APK; it does not
run an Android emulator or exercise live student accounts.

## Private VM handoff: exact file locations

The maintainer's existing credentials are outside every checkout:

| Path | Contents / use |
| --- | --- |
| `/home/yoav_zibin/.config/buildplay-mobile-ci-handoff/AuthKey.p8` | Original App Store Connect **team API** private key; becomes Actions secret `ASC_KEY_P8`. |
| `/home/yoav_zibin/.config/buildplay-mobile-ci-handoff/credentials.json` | Matching `ASC_KEY_ID`, `ASC_ISSUER_ID` and `APPLE_TEAM_ID`. |
| `/home/yoav_zibin/.config/buildplay-mobile-ci-handoff/configure-github-secrets.py` | Maintainer helper that validates the files and uploads the four Actions secrets through `gh`, without displaying their values. |
| `/home/yoav_zibin/.config/gh/` | GitHub CLI configuration/login for this Linux account. `hosts.yml` may contain its login token when no system keyring is available. |

The handoff directory and GitHub CLI directory are owner-only (`700`);
credential files and the helper are owner-only (`600`), owned by `yoav_zibin`.
An agent using another Linux account should use its own GitHub login and the
cloud workflows, or ask the maintainer for intended access. Do not make the
private directory world-readable. Agents sharing the `yoav_zibin` Linux
account also share its file access and GitHub CLI login.

Keep the `.p8`, JSON values, GitHub token and signed credential exports out of
Git, chat, build artifacts and logs. Document paths and secret names only.
Do not run `gh auth token` or print `hosts.yml` to discover whether login works;
`gh auth status` is the appropriate check.

## Maintainer setup and recovery

The connector in an agent's chat and `gh` on the VM have separate logins. SSH
push access also does not authenticate the GitHub REST API. Check the CLI with:

```bash
gh auth status --hostname github.com
```

If needed, start the official browser login flow on the VM:

```bash
gh auth login --hostname github.com --git-protocol ssh --web --skip-ssh-key
```

Open `https://github.com/login` in a regular browser and sign in, then open
`https://github.com/login/device` and enter the one-time code printed by the
CLI. Approve GitHub CLI using the intended account. Codes expire; restart the
command to obtain a fresh code rather than putting an old code in this guide.
`--skip-ssh-key` preserves the existing SSH identity without uploading another.
The CLI uses a credential store when available and can fall back to its
owner-only configuration file on a headless VM.

After replacing the handoff files, the maintainer can validate them and sync
GitHub's repository Actions secrets:

```bash
python3 /home/yoav_zibin/.config/buildplay-mobile-ci-handoff/configure-github-secrets.py --check-only
python3 /home/yoav_zibin/.config/buildplay-mobile-ci-handoff/configure-github-secrets.py
```

The GitHub account/token needs repository **Secrets write** permission to
update secrets and **Actions write** permission to request workflow runs.
These are maintainer operations, separate from routine app development.
The helper accepts `--rerun-failed RUN_ID` to rerun a specific failed run
after uploading the credentials; without that option it only updates secrets.

The workflow expects all four secrets: `ASC_KEY_P8`, `ASC_KEY_ID`,
`ASC_ISSUER_ID`, and `APPLE_TEAM_ID`. The `.p8` must retain its original PEM
BEGIN/END lines and actual newlines, rather than base64 text, a filename or
literal `\n` sequences. Issuer ID and Apple Developer Team ID are different
identifiers. The matching team must have active Apple Developer membership
and an App Store Connect app record matching `IOS_PORTAL_BUNDLE_ID`.
The existing `fun.buildplay.sample` record can be reused for the real portal
if the maintainer chooses it; the temporary sample source project is removed.

Repository variables `TESTFLIGHT_ENABLED=true` and a nonempty
`IOS_PORTAL_BUNDLE_ID` enable the portal upload after the unsigned iOS build
and metadata check succeed. Uploads are restricted to
pushes to `main` and manual runs on `main`. Leave this shared setting to the
maintainer. A new run/attempt receives a distinct archive build number.
`invalidPEMDocument` means the key could not be parsed; resolve the key format
before investigating certificates or provisioning. Simulator success alone
does not prove TestFlight signing or upload succeeded. A signed archive can
also succeed while IPA export fails with **Cloud signing permission error**:
the Account Holder/Admin must check access to cloud-managed distribution
certificates and distribution provisioning for the CI team/key. Active
membership and an app record alone do not establish that permission. See
[Apple cloud-managed certificates](https://developer.apple.com/help/account/certificates/cloud-managed-certificates/).

For Android's current debug APK workflows, no Apple key, Google Play service
account or private release keystore is required. A signed Android release uses
the separate configuration described in [android/VM_BUILD.md](../android/VM_BUILD.md);
the example `/var/lib/playroom-build/private` paths there are a provisioning
recipe, not a claim that a release keystore is installed on this VM.

## Prompt for a student agent

```text
Work in my separate checkout of yoav-zibin/course on the course VM.
Read AGENTS.md, docs/mobile-development-on-vm.md and the app's README.
Implement my requested Android/iOS change, run appropriate local checks,
integrate current upstream main, and push directly to main without a PR.
Use the existing Portal apps GitHub Actions workflow for both platforms.
Verify its result and give me the run/artifact link and installation steps.
Reuse the documented toolchain and existing CI secrets. Keep credentials
outside Git and logs. Use disposable local test data; do not change the
production backend, real student accounts or shared signing configuration.
```

See also the [Android portal](../android/README.md), [Android VM release build](../android/VM_BUILD.md),
and [iOS portal](../frontends/ios-game-portal/README.md) guides. Official references:
[GitHub CLI login](https://cli.github.com/manual/gh_auth_login),
[setting Actions secrets](https://cli.github.com/manual/gh_secret_set),
and [Apple team API keys](https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api).
