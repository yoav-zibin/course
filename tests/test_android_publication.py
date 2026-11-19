"""Serialized APK publication must remain monotonic across old and failed runs."""

import copy
import importlib.util
import json
from pathlib import Path
import zipfile

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/publish-android-apk.py"
spec = importlib.util.spec_from_file_location("android_publication", SCRIPT)
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)
A, B, C = (character * 40 for character in "abc")


def apk(tmp_path):
    path = tmp_path / "BuildPlay.apk"
    with zipfile.ZipFile(path, "w") as bundle:
        bundle.writestr("assets/app.config", json.dumps({"android": {"package": "com.dapillah.gameportal.debug"}, "extra": {"apiUrl": "https://buildplay.fun"}}))
        bundle.writestr("assets/index.android.bundle", b"embedded tested JavaScript")
        for abi in ["arm64-v8a", "armeabi-v7a", "x86", "x86_64"]:
            bundle.writestr(f"lib/{abi}/libbuildplay-runtime.so", b"library fixture")
    return path


def ancestors(previous, current):
    return previous in (A, B, C) and current in (A, B, C) and (A, B, C).index(previous) <= (A, B, C).index(current)


class Release:
    def __init__(self):
        self.value = {"id": 1, "body": publication.NOTES.format(source=A, repo="owner/repo"), "assets": []}
        self.writes = []

    def request(self, method, endpoint, payload=None):
        if method == "PATCH":
            self.writes.append(copy.deepcopy(payload))
            self.value.update(payload)
        return copy.deepcopy(self.value)


def test_older_run_finishing_after_newer_cannot_overwrite_its_apk(tmp_path):
    path, release = apk(tmp_path), Release()

    def upload(candidate):
        assert f"Source: [{A}]" in release.value["body"]
        assert B in publication.MARKER.findall(release.value["body"])
        release.value["assets"] = [{"name": "BuildPlay.apk", "digest": publication.apk_digest(candidate)}]

    result = publication.publish(path, B, "owner/repo", request=release.request, ancestor=ancestors, upload=upload)
    assert result["status"] == "published"
    assert f"Source: [{B}]" in release.value["body"]
    assert "do not uninstall the old app" in release.value["body"]
    before = len(release.writes)
    stale = publication.publish(path, A, "owner/repo", request=release.request, ancestor=ancestors, upload=lambda _: pytest.fail("stale upload"))
    assert stale["status"] == "superseded"
    assert len(release.writes) == before


def test_interrupted_newer_attempt_blocks_old_runs_without_mislabeling_current_download(tmp_path):
    path, release = apk(tmp_path), Release()

    def failed_upload(_):
        raise RuntimeError("upload interrupted")

    with pytest.raises(RuntimeError, match="interrupted"):
        publication.publish(path, B, "owner/repo", request=release.request, ancestor=ancestors, upload=failed_upload)
    assert f"Source: [{A}]" in release.value["body"]
    assert publication.publication_allowed(release.value["body"], A, ancestors) is False
    assert publication.publication_allowed(release.value["body"], B, ancestors) is True
    assert publication.publication_allowed(release.value["body"], C, ancestors) is True


def test_digest_failure_does_not_claim_successful_download_source(tmp_path):
    path, release = apk(tmp_path), Release()
    with pytest.raises(RuntimeError, match="digest"):
        publication.publish(path, B, "owner/repo", request=release.request, ancestor=ancestors, upload=lambda _: None)
    assert f"Source: [{A}]" in release.value["body"]
    assert publication.MARKER.findall(release.value["body"]) == [B]


def test_equal_source_retry_allowed_but_divergent_or_unidentified_source_is_not():
    body = publication.watermark(publication.NOTES.format(source=B, repo="owner/repo"), B)
    assert publication.publication_allowed(body, B, ancestors)
    assert not publication.publication_allowed(body, "d" * 40, ancestors)
    with pytest.raises(ValueError, match="source revision"):
        publication.publication_allowed("Unversioned legacy release", B, ancestors)


def test_check_only_cannot_mutate_release_or_upload(tmp_path):
    release = Release()
    result = publication.publish(apk(tmp_path), B, "owner/repo", check_only=True, request=release.request,
                                 ancestor=ancestors, upload=lambda _: pytest.fail("dry-run upload"))
    assert result["status"] == "ready"
    assert release.writes == []
