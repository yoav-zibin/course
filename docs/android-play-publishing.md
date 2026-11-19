# Android publishing to Google Play internal testing

The [Play AAB workflow](../.github/workflows/play-aab.yml) builds the production
Android package `fun.buildplay` and uploads it to Google Play's internal testing
track. Relevant pushes to `main` run this workflow automatically. It can also be
started manually from GitHub Actions. Production publishing remains a separate
Play Console operation.

## Current setup and remaining access

As of November 19, 2026, the production AAB has been built with the existing
Android upload key; the initial manually started build used version code `2`.
The Google Play Developer API is enabled in Cloud project `buildplay-101e9`.
The dedicated publishing service account is:

```text
buildplay-play-ci@buildplay-101e9.iam.gserviceaccount.com
```

The real publishing-access probe returned HTTP `403`: the credential can
authenticate, but its required Play Console access has not been verified. A
successful upload or internal tester rollout is therefore still pending.

An owner or administrator must invite this service account through **Play
Console → Users and permissions** and grant it access to `fun.buildplay` with:

- **View app information (read-only)**.
- **Release apps to testing tracks**.

These are Play Console permissions. Enabling the Cloud API or granting Firebase
Cloud Messaging access does not grant Play publishing access. This workflow does
not need the permission to release to production. Tester lists and tester opt-in
are configured separately in Play Console.

The app record, upload signing configuration and any Console-only first-release
requirements must also be complete. If Google rejects API publishing while the
app is a draft, finish the indicated app setup or first release in Play Console.
Do not interpret a built AAB or a saved draft as an available internal release.

## Credentials

CI reads the publishing service-account JSON from the repository Actions secret
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`. The dedicated account above is separate from
the Firebase service account used for push delivery.

The maintainer's private source file is
`/home/yoav_zibin/.config/buildplay-mobile-ci-handoff/google-play-service-account.json`.
It must remain outside the repository, private, and absent from logs and uploaded
artifacts. Store the JSON only in the protected Actions secret; do not paste it
into workflow source or issue comments.

The signed build continues to use `ANDROID_UPLOAD_KEYSTORE_BASE64` and
`ANDROID_UPLOAD_KEYSTORE_PASSWORD`. Preserve the existing upload key and the
separate signing identity for rolling development APKs (`fun.buildplay.debug`).

## Automatic build and upload

Relevant changes under `frontends/portal`, the Play workflow, publishing helpers
or their focused tests trigger the workflow on `main`. Backend-only and
documentation-only pushes do not require another Android build.

1. Shared portal TypeScript checks and tests must pass.
2. The Android job selects the production variant and `https://buildplay.fun`,
   prepares the existing optional Firebase configuration, and builds a signed
   release AAB. Signature verification must pass before publication.
3. CI assigns the version code as `GITHUB_RUN_NUMBER * 100 + GITHUB_RUN_ATTEMPT`.
   Attempts `1` through `99` are supported. This avoids reusing the initial
   version code `2` and gives a rebuilt run a distinct version code.
4. `BuildPlay-android-aab` preserves the signed `BuildPlay.aab` artifact. The
   upload job downloads that artifact and serializes publication through the
   `buildplay-play-internal` concurrency group.
5. The publisher checks current source inputs, package, version, signing and
   artifact contents. It rejects stale releases and version codes already used
   by a different artifact. It verifies Google's returned artifact hash and
   version before committing the internal release.

The publisher resolves the actual internal track identifier returned by Google
and never falls back to a production track. Its release requests use
`status: completed`; it does not silently change a rejected release to `draft`.
Pending production review or publication can block the commit. The commit uses
`changesInReviewBehavior=ERROR_IF_IN_REVIEW` to avoid canceling an existing review.

A successful commit means Google accepted the internal release change. Google
review, processing, tester eligibility and opt-in still determine when a tester
can install it. Check the workflow summary and Play Console rather than assuming
that a green build alone establishes availability.

## Manual runs and retries

After the Play Console grant or app setup is complete, start a fresh run on
`main` from **Actions → Play AAB → Run workflow**, or use:

```sh
gh workflow run play-aab.yml --repo yoav-zibin/course --ref main
```

An upload-only failure can be retried using GitHub's **Re-run failed jobs** while
the successful build artifact remains available. A full workflow rerun rebuilds
with the incremented run-attempt version code. If a newer workflow has already
published a higher code, start a new workflow run instead of rerunning an older
run. The publisher deliberately refuses to roll back the internal track.

For HTTP `403`, check the dedicated service account's app permissions in Play
Console. For a missing app or a draft-app error, complete the relevant Console
setup. If Google requires changes to remain unsent for review, handle the
indicated review action in Play Console; the publisher does not claim a tester
rollout by silently saving a draft or suppressing review submission.

## Google references

- [API setup and service-account invitations](https://developers.google.com/android-publisher/getting_started).
- [Play Console permissions](https://support.google.com/googleplay/android-developer/answer/9844686?hl=en).
- [Transactional edits and Console-only setup](https://developers.google.com/android-publisher/edits).
- [Bundle upload](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles/upload)
  and [returned bundle hashes](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles).
- [Release statuses](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.tracks)
  and [commit review behavior](https://developers.google.com/android-publisher/api-ref/rest/v3/edits/commit).
- [Internal tests and tester access](https://support.google.com/googleplay/android-developer/answer/9845334?hl=en).
