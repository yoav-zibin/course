# Build Playroom on the course VM

Use a separate build checkout on the existing class VM, so building does not change
the backend's running checkout or data. This recipe targets Linux x86_64 (Ubuntu
24.04 or equivalent), Java 21, SDK 36 and build tools 36.0.0. No emulator is needed
on the VM. Allow roughly 6 GB of disk space; Gradle is limited to two workers and a
2 GB heap. Use a larger build VM or administrator-managed swap if memory is insufficient.

The VM administrator supplies SSH access and the checkout branch/commit. Source is
the shared `yoav-zibin/course` repository. Do not paste VM passwords or private keys
into GitHub issues, source files or this document.

## One-time VM setup

Install `openjdk-21-jdk`, `python3`, `curl`, `unzip` and `git` using the VM's package
manager. Clone the shared repository into a separate build directory, named
`game_platform` if running the existing Python tests as well.

Create a private directory **outside the checkout**, owned by the build user, mode
700. For example, an administrator can provision `/var/lib/playroom-build/private`.
Create a signing key there interactively (keytool prompts for passwords):

```bash
umask 077
keytool -genkeypair -keystore /var/lib/playroom-build/private/playroom.jks \
  -alias playroom -keyalg RSA -keysize 3072 -validity 3650 \
  -dname 'CN=Playroom Course App'
```

Using a private editor on the VM, create
`/var/lib/playroom-build/private/android-build.json` with mode 600:

```json
{
  "base_url": "https://buildplay.fun",
  "signing": {
    "store_file": "/var/lib/playroom-build/private/playroom.jks",
    "store_password": "",
    "key_alias": "playroom",
    "key_password": ""
  }
}
```

Fill the empty password values on the VM. Keep the keystore and passwords in the
administrator's private backup; future app updates require the same key. This is a
separate Android JSON configuration: **do not add these fields to the backend's
existing config**, whose schema is intentionally unchanged.

## Build

From the reviewed shared-repository checkout:

```bash
./android/scripts/build_on_vm.sh /var/lib/playroom-build/private/android-build.json
```

The script downloads a pinned Google command-line SDK archive and verifies its
published checksum if the SDK tools are absent. It prompts the administrator to
review/accept SDK licenses, installs the required packages, runs JVM tests/lint,
builds a signed release, and verifies the APK signature. Secrets are read directly
from the private JSON file rather than put into Gradle command-line arguments.

Output: `android/artifacts/app-release.apk`.
Copy that APK to a device with `scp`/USB or publish it at a VM-admin-approved HTTPS
download path. APKs are excluded from Git. The debug and release app IDs differ,
so they can coexist and have separate guest accounts.

## Remaining operator checks

- Run `connectedDebugAndroidTest` on the development emulator; this needs a device
  and is intentionally separate from the headless VM build.
- Confirm the deployed backend's JSON data path is on retained persistent storage.
- With the class administrator's approval, create a test match, cleanly restart
  the existing backend service, and verify the same users/match/moves after restart.
  Do not delete/reseed the data file or launch a second server writing to it.
- Check the shutdown signal. In local validation, an immediate SIGTERM after a move
  lost pending writes, while SIGINT (Ctrl-C) flushed them successfully. The installed
  uvicorn re-raises SIGTERM before `main.py` reaches `store.close()`. Existing store
  unit tests do not cover this server-process shutdown path. Verify the VM's installed
  version and service stop behavior with the backend owner before claiming this check passes.
- Install the VM-built release on a real Android phone and play against the web portal.

VM execution and restart persistence verification remain pending until access is granted.
