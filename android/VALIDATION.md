# Validation notes

Environment: Apple silicon, Java 21, SDK 36, Pixel 6 ARM64 Android 16 emulator.
Service: `https://buildplay.fun/`. No local development backend is needed for gameplay.

## Results (October 8–9, 2026)

- Debug APK built, signature verified and installed on the emulator.
- Eight JVM tests passed. Android lint passed with zero errors; 15 advisory warnings
  concern newer dependency versions and optional Kotlin extensions.
- Final emulator suite: five passed, zero failed, one paired-browser test skipped
  because it is run separately with an interactive browser partner.
- The separate paired-browser test passed a five-move Android win and nine-move draw
  against the real `buildplay.fun/portal` UI. Both games survived landscape/portrait
  rotation with the same account and match.
- Android versus a second cloud API client passed a win and draw, including activity
  recreation mid-match. Fresh vault/ViewModel instances restored credentials and selection.
- Instrumented WebView tests passed iframe isolation, forged/nested messages,
  duplicate filtering, rejected-move state resend and nonzero Compose viewport checks.
- A simulated committed move with a lost acknowledgement passed recovery: submissions
  stayed blocked offline and reconnect fetched the saved result without replaying it.
- A separate live lifecycle test passed a full activity close/relaunch with a new
  ViewModel, preserving the account and selected match. Disabling the emulator's
  Wi-Fi and mobile data produced the connection error; restoring their prior settings
  recovered the same authoritative match. This test passed on October 9.
- Live API checks rejected wrong-turn, duplicate and stale submissions; fresh clients
  observed the saved users, matches and moves. No local backend served these games.

Debug APK SHA-256:
`c38dbe491311b0980f6b8161bf67bfe6d1d4e186efa2524c49db21521b9fc9ef`.

An OS process-kill test is not separately claimed. The checks cover full activity
destruction/relaunch, rotation, new session-store/ViewModel instances and real network loss.

## Known shared-service issues

The deployed TicTacToe version sends the legacy `next_turn_player_index: null`
when a game ends. The existing web portal rejects that final move as malformed.
Reproduced with a browser X winning the top row after Android O replied twice:
the web page displayed `ignored a malformed make_move` and the cloud stayed at four moves.

The compatibility code in `static/common.js` (around line 226) wraps integer legacy
turns but does not map a legacy null to a null turn set. Android handles both forms,
including legacy null, with a regression assertion in `GameProtocolTest`.
Until the shared web frontend is fixed and deployed, use Android X to make the
winning fifth move or drawing ninth move. This is a web frontend compatibility fix,
not a proposed API change; the Android contribution does not modify shared web files.

After integrating shared main `dab47ed`, the backend suite has 160 passing tests
and one stale example-data fixture failure. Every backend source and test file is
identical to that upstream commit. The same fixture failure existed before this
integration; the unrelated generated-data change is excluded from this contribution.

Local process persistence passed with SIGINT. An immediate SIGTERM after a move
lost pending data; see VM_BUILD.md. Cloud restart behavior and retained storage
must be checked with the VM administrator.

## Delivery boundaries

- Shared repository write access is confirmed by a successful push dry run.
  The Android branch has not been published or merged into shared main.
- Google Cloud project access is confirmed. The existing VM is an e2-micro with
  1 GB RAM and a 10 GB boot Persistent Disk configured to delete with the VM.
  CLI/SSH authentication, build-resource inspection, VM release signing/build,
  data-path verification and cloud restart tests remain pending.
- Physical-device testing is pending; emulator testing does not replace the class requirement.

## Pre-submission scope review

- Integrated upstream main `dab47ed` without conflicts, preserving the iOS portal
  and backend changes already merged by classmates.
- The final diff adds only 38 files under `android/`. Existing shared files,
  including the root ignore file, backend APIs, web portal and iOS frontend,
  are byte-for-byte identical to upstream main.
- Android build, JVM test task and lint passed after integration. Unchanged
  Gradle tasks reused their previously successful outputs.
- No APKs, local account data, signing keys, private build configuration or IDE
  files are tracked in the contribution. A targeted credential-pattern scan
  found no matches; this is not a guarantee against every possible secret format.
- Android build scripts run explicitly; they add no shared deployment hook or
  server restart. Live cloud tests are opt-in.
