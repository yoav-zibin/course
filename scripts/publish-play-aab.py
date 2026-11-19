#!/usr/bin/env python3
"""Upload a verified BuildPlay bundle to Google Play internal testing only."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from play_bundle import validate_bundle


PACKAGE = "fun.buildplay"
BASE = "https://androidpublisher.googleapis.com"
APP = f"/androidpublisher/v3/applications/{PACKAGE}"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"
BUILD_INPUTS = ("frontends/portal", ".github/workflows/play-aab.yml",
                "scripts/publish-play-aab.py", "scripts/play_bundle.py")


class PlayError(RuntimeError):
    pass


class PlayAPI:
    def __init__(self, credential_json):
        try:
            from google.auth.transport.requests import AuthorizedSession
            from google.oauth2 import service_account
            info = json.loads(credential_json)
            credentials = service_account.Credentials.from_service_account_info(info, scopes=[SCOPE])
            self.session = AuthorizedSession(credentials)
        except Exception:
            raise PlayError("Google Play service-account credentials are missing or invalid.") from None

    def request(self, method, path, payload=None, *, bundle=None, params=None):
        options = {"timeout": (30, 300), "params": params, "allow_redirects": False}
        try:
            if bundle is not None:
                with bundle.open("rb") as stream:
                    response = self.session.request(method, BASE + path, data=stream,
                                                    headers={"Content-Type": "application/octet-stream"}, **options)
            else:
                response = self.session.request(method, BASE + path, json=payload, **options)
        except Exception:
            # Authentication libraries may include credential material in errors.
            raise PlayError("Google Play request failed; check credentials and network access.") from None
        if not 200 <= response.status_code < 300:
            try:
                detail = response.json().get("error", {}).get("message", "Request rejected")
            except (ValueError, AttributeError):
                detail = "Request rejected"
            raise PlayError(f"Google Play HTTP {response.status_code}: {str(detail)[:800]}")
        return response.json() if response.content else {}


def git(*arguments):
    return subprocess.run(["git", *arguments], capture_output=True, text=True, timeout=30)


def ancestor(previous, source):
    result = git("merge-base", "--is-ancestor", previous, source)
    if result.returncode not in (0, 1):
        raise PlayError("Cannot verify Play release source ancestry; fetch complete main history.")
    return result.returncode == 0


def current_source(source):
    if git("fetch", "--no-tags", "origin", "main").returncode:
        raise PlayError("Cannot refresh main before Play publication.")
    if not ancestor(source, "origin/main"):
        return False
    result = git("diff", "--quiet", source, "origin/main", "--", *BUILD_INPUTS)
    if result.returncode not in (0, 1):
        raise PlayError("Cannot verify current Play build inputs.")
    return result.returncode == 0


def internal_track(tracks):
    # Google's guide calls this qa; existing apps commonly return internal.
    # Resolve only these known identifiers and never fall back to production.
    candidates = [track for track in tracks if track.get("track") in ("internal", "qa")]
    if len(candidates) != 1:
        raise PlayError("Cannot identify exactly one internal testing track in Play Console.")
    return candidates[0]


def production_clear(request):
    state = request("GET", APP + "/tracks/production/releases")
    if any(release.get("releaseLifecycleState") not in
           ("RELEASE_LIFECYCLE_STATE_PUBLISHED", "RELEASE_LIFECYCLE_STATE_DRAFT")
           for release in state.get("releases", [])):
        raise PlayError("Production has pending review/publication changes; finish them in Play Console before retrying.")


def publish(bundle, source, repo, version, *, request, validator=validate_bundle,
            is_current=current_source, is_ancestor=ancestor, check_only=False):
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Source must be a full commit SHA.")
    if repo != "yoav-zibin/course":
        raise ValueError("Play releases must come from yoav-zibin/course.")
    if not 2 < version <= 2_100_000_000:
        raise ValueError("Play version code must exceed the initial version and fit Android's supported range.")
    digest = validator(bundle, version)
    if not is_current(source):
        return {"status": "superseded", "source": source, "versionCode": version}
    production_clear(request)
    edit = request("POST", APP + "/edits", {})["id"]
    if not re.fullmatch(r"[A-Za-z0-9_-]+", edit):
        raise PlayError("Google Play returned an invalid edit identifier.")
    endpoint = APP + "/edits/" + edit
    committed = False
    try:
        tracks = request("GET", endpoint + "/tracks").get("tracks", [])
        target = internal_track(tracks)
        bundles = request("GET", endpoint + "/bundles").get("bundles", [])
        apks = request("GET", endpoint + "/apks").get("apks", [])
        versions = [int(item["versionCode"]) for item in bundles + apks]
        versions += [int(code) for track in tracks for release in track.get("releases", [])
                     for code in release.get("versionCodes", [])]
        previous_sources = re.compile(r"Source: https://github\.com/yoav-zibin/course/commit/([0-9a-f]{40})")
        for release in target.get("releases", []):
            for note in release.get("releaseNotes", []):
                for previous in previous_sources.findall(note.get("text", "")):
                    if previous != source and not is_ancestor(previous, source):
                        raise PlayError("Refusing to replace a newer or divergent internal release source.")
        existing = next((item for item in bundles if int(item["versionCode"]) == version), None)
        released = any(release.get("status") == "completed" and
                       [str(code) for code in release.get("versionCodes", [])] == [str(version)]
                       for release in target.get("releases", []))
        if versions and max(versions) >= version:
            if max(versions) == version and existing and existing.get("sha256", "").lower() == digest and released:
                return {"status": "already_committed", "track": target["track"], "versionCode": version,
                        "source": source, "sha256": digest}
            raise PlayError(f"Version code {version} is already used or older than a Play artifact; start a new workflow run.")
        if check_only:
            return {"status": "ready", "track": target["track"], "versionCode": version,
                    "source": source, "sha256": digest}
        if not is_current(source):
            return {"status": "superseded", "source": source, "versionCode": version}
        uploaded = request("POST", f"/upload/androidpublisher/v3/applications/{PACKAGE}/edits/{edit}/bundles",
                           bundle=bundle, params={"uploadType": "media"})
        if int(uploaded.get("versionCode", -1)) != version or uploaded.get("sha256", "").lower() != digest:
            raise PlayError("Google Play uploaded bundle version/digest does not match the verified artifact.")
        release = {"name": f"BuildPlay {version} ({source[:12]})", "status": "completed",
                   "versionCodes": [str(version)], "releaseNotes": [{"language": "en-US",
                   "text": f"BuildPlay update.\nSource: https://github.com/{repo}/commit/{source}"}]}
        request("PUT", endpoint + "/tracks/" + target["track"],
                {"track": target["track"], "releases": [release]})
        request("POST", endpoint + ":validate")
        # Recheck immediately before committing; never cancel a Console review.
        production_clear(request)
        if not is_current(source):
            return {"status": "superseded", "source": source, "versionCode": version}
        request("POST", endpoint + ":commit", params={"changesInReviewBehavior": "ERROR_IF_IN_REVIEW"})
        committed = True
        return {"status": "committed", "track": target["track"], "versionCode": version,
                "source": source, "sha256": digest,
                "note": "Internal release committed. Play Console review and tester eligibility still apply."}
    finally:
        if not committed:
            try:
                request("DELETE", endpoint)
            except PlayError:
                print("Could not remove abandoned Play edit; it will expire automatically.", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--source", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--version-code", type=int, required=True)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    try:
        api = PlayAPI(os.environ.get("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", ""))
        result = publish(args.bundle, args.source, args.repo, args.version_code,
                         request=api.request, check_only=args.check_only)
        print(json.dumps(result))
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a") as output:
                output.write(f"Google Play internal testing: **{result['status']}**, version code {args.version_code}.\n")
                if result.get("note"):
                    output.write(result["note"] + "\n")
        return 0
    except (OSError, ValueError, KeyError, PlayError, subprocess.SubprocessError) as error:
        print(f"Play publication failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
