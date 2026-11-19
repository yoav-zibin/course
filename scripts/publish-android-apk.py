#!/usr/bin/env python3
"""Publish only monotonic APK source revisions inside the artifact's CI lock."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import zipfile


TAG = "portal-apps"
MARKER = re.compile(r"<!-- buildplay-apk-watermark: ([0-9a-f]{40}) -->")
SOURCE = re.compile(r"Source: \[([0-9a-f]{40})\]")
NOTES = """BuildPlay uses one React Native application for Android, iOS and web.
Source: [{source}](https://github.com/{repo}/commit/{source}).
Download BuildPlay.apk to install the standalone Android app with embedded JavaScript.
It connects to https://buildplay.fun and supports arm64-v8a, armeabi-v7a, x86 and x86_64.

**Existing APK users: preserve your current installation and saved data.**
Previous rolling APKs used unavailable ephemeral signing keys, so Android cannot
install this APK as an in-place update. If you have guest-only credentials or saved
games, **do not uninstall the old app to try this update**. Keep the old installation
and preserve access to that account and its data. This APK uses the deterministic
Expo development signer; it is a development distribution, not a Play Store release.

BuildPlayFun.apk, if shown below, is an older legacy build.
"""


def release_sources(body):
    sources = set(MARKER.findall(body or "")) | set(SOURCE.findall(body or ""))
    if not sources:
        raise ValueError("Rolling release has no trustworthy source revision; seed its Source metadata first")
    return sources


def publication_allowed(body, source, ancestor):
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Candidate source must be a full commit SHA")
    return all(previous == source or ancestor(previous, source) for previous in release_sources(body))


def watermark(body, source):
    # An attempted newer revision remains a barrier even if its upload fails.
    # Keep the visible Source/download notes unchanged until upload is verified.
    return MARKER.sub("", body or "").rstrip() + f"\n\n<!-- buildplay-apk-watermark: {source} -->\n"


def apk_digest(apk):
    if apk.name != "BuildPlay.apk":
        raise ValueError("The rolling asset must be named BuildPlay.apk")
    with zipfile.ZipFile(apk) as bundle:
        config = json.loads(bundle.read("assets/app.config"))
        if config["android"]["package"] != "com.dapillah.gameportal.debug" or config["extra"]["apiUrl"] != "https://buildplay.fun":
            raise ValueError("APK package/backend does not match the rolling development distribution")
        if not bundle.read("assets/index.android.bundle"):
            raise ValueError("APK has no embedded JavaScript")
        abis = {name.split("/")[1] for name in bundle.namelist() if name.startswith("lib/") and name.endswith("/libbuildplay-runtime.so")}
        if abis != {"arm64-v8a", "armeabi-v7a", "x86", "x86_64"}:
            raise ValueError("Rolling APK must include all four supported architectures")
    return "sha256:" + hashlib.sha256(apk.read_bytes()).hexdigest()


def is_ancestor(previous, source):
    result = subprocess.run(["git", "merge-base", "--is-ancestor", previous, source], capture_output=True, text=True, timeout=30)
    if result.returncode not in (0, 1):
        raise RuntimeError("Cannot establish release ancestry from the complete checkout history")
    return result.returncode == 0


def api(method, path, payload=None):
    command = ["gh", "api", "--method", method, path]
    if payload is not None:
        command.extend(["--input", "-"])
    result = subprocess.run(command, input=json.dumps(payload) if payload is not None else None,
                            check=True, capture_output=True, text=True, timeout=60)
    return json.loads(result.stdout)


def publish(apk, source, repo, *, check_only=False, request=api, ancestor=is_ancestor, upload=None):
    expected_digest = apk_digest(apk)
    release = request("GET", f"repos/{repo}/releases/tags/{TAG}")
    if not publication_allowed(release.get("body"), source, ancestor):
        return {"status": "superseded", "source": source}
    if check_only:
        return {"status": "ready", "source": source, "digest": expected_digest}
    endpoint = f"repos/{repo}/releases/{release['id']}"
    request("PATCH", endpoint, {"body": watermark(release.get("body"), source)})
    if upload is None:
        subprocess.run(["gh", "release", "upload", TAG, str(apk), "--repo", repo, "--clobber"], check=True, timeout=300)
    else:
        upload(apk)
    uploaded = request("GET", f"repos/{repo}/releases/tags/{TAG}")
    asset = next((asset for asset in uploaded["assets"] if asset["name"] == "BuildPlay.apk"), None)
    if not asset or asset.get("digest") != expected_digest:
        raise RuntimeError("Uploaded rolling APK digest does not match the tested artifact")
    request("PATCH", endpoint, {"body": watermark(NOTES.format(source=source, repo=repo), source)})
    return {"status": "published", "source": source, "digest": expected_digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--source", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    try:
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
            raise ValueError("Invalid GitHub repository")
        print(json.dumps(publish(args.apk, args.source, args.repo, check_only=args.check_only)))
        return 0
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Android publication failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
