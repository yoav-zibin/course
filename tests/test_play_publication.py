"""Play publishing must stay on internal testing and never commit stale content."""

import copy
import importlib.util
from pathlib import Path
import sys

import pytest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location("play_publication", SCRIPTS / "publish-play-aab.py")
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)
SOURCE = "a" * 40
DIGEST = "b" * 64
APP = publication.APP
EDIT = APP + "/edits/123"


class API:
    def __init__(self):
        self.calls = []
        self.tracks = [{"track": "internal", "releases": []}, {"track": "production", "releases": []}]
        self.bundles = [{"versionCode": 2, "sha256": "c" * 64}]
        self.apks = []
        self.production = [{"releaseLifecycleState": "RELEASE_LIFECYCLE_STATE_PUBLISHED"}]
        self.uploaded = {"versionCode": 401, "sha256": DIGEST}
        self.fail_commit = False

    def request(self, method, path, payload=None, **options):
        self.calls.append((method, path, copy.deepcopy(payload), options))
        if method == "DELETE":
            return {}
        if path == APP + "/tracks/production/releases":
            return {"releases": copy.deepcopy(self.production)}
        if path == APP + "/edits":
            return {"id": "123"}
        if path == EDIT + "/tracks":
            return {"tracks": copy.deepcopy(self.tracks)}
        if path == EDIT + "/bundles":
            return {"bundles": copy.deepcopy(self.bundles)}
        if path == EDIT + "/apks":
            return {"apks": copy.deepcopy(self.apks)}
        if path.startswith("/upload/"):
            return copy.deepcopy(self.uploaded)
        if path == EDIT + "/tracks/internal" or path == EDIT + "/tracks/qa":
            return payload
        if path == EDIT + ":validate":
            return {}
        if path == EDIT + ":commit":
            if self.fail_commit:
                raise publication.PlayError("Changes already in review")
            return {"id": "123"}
        raise AssertionError((method, path))


def publish(api, **kwargs):
    defaults = dict(request=api.request, validator=lambda path, code: DIGEST,
                    is_current=lambda source: True, is_ancestor=lambda previous, source: True)
    defaults.update(kwargs)
    return publication.publish(Path("BuildPlay.aab"), SOURCE, "yoav-zibin/course", 401, **defaults)


def committed(api):
    return any(path.endswith(":commit") for _, path, _, _ in api.calls)


def test_upload_checks_server_digest_then_only_updates_internal_track():
    api = API()
    result = publish(api)
    assert result["status"] == "committed"
    writes = [(path, payload) for method, path, payload, _ in api.calls if method == "PUT"]
    assert [path for path, _ in writes] == [EDIT + "/tracks/internal"]
    release = writes[0][1]["releases"][0]
    assert release["status"] == "completed" and release["versionCodes"] == ["401"]
    assert SOURCE in release["releaseNotes"][0]["text"]
    commit = next(options for _, path, _, options in api.calls if path.endswith(":commit"))
    assert commit["params"] == {"changesInReviewBehavior": "ERROR_IF_IN_REVIEW"}
    assert not any(method == "DELETE" for method, *_ in api.calls)


@pytest.mark.parametrize("field,value", [("versionCode", 402), ("sha256", "f" * 64)])
def test_mismatched_upload_never_updates_or_commits_and_removes_edit(field, value):
    api = API()
    api.uploaded[field] = value
    with pytest.raises(publication.PlayError, match="version/digest"):
        publish(api)
    assert not any(method == "PUT" for method, *_ in api.calls)
    assert not committed(api)
    assert api.calls[-1][:2] == ("DELETE", EDIT)


@pytest.mark.parametrize("location", ["bundle", "apk", "track"])
def test_higher_version_anywhere_prevents_rollbacks(location):
    api = API()
    if location == "bundle":
        api.bundles.append({"versionCode": 501})
    elif location == "apk":
        api.apks.append({"versionCode": 501})
    else:
        api.tracks[1]["releases"] = [{"versionCodes": ["501"]}]
    with pytest.raises(publication.PlayError, match="already used or older"):
        publish(api)
    assert not committed(api)
    assert not any(path.startswith("/upload/") for _, path, _, _ in api.calls)


def test_equal_version_is_idempotent_only_for_matching_digest_and_internal_release():
    api = API()
    api.bundles = [api.uploaded]
    api.tracks[0]["releases"] = [{"status": "completed", "versionCodes": ["401"]}]
    assert publish(api)["status"] == "already_committed"
    assert not committed(api)
    api.bundles[0]["sha256"] = "e" * 64
    with pytest.raises(publication.PlayError, match="already used"):
        publish(api)


def test_check_only_reads_and_removes_edit_without_uploading():
    api = API()
    assert publish(api, check_only=True)["status"] == "ready"
    assert not committed(api)
    assert not any(path.startswith("/upload/") for _, path, _, _ in api.calls)
    assert api.calls[-1][:2] == ("DELETE", EDIT)


@pytest.mark.parametrize("at", [0, 1, 2])
def test_new_build_inputs_at_each_boundary_prevent_commit(at):
    api = API()
    checks = iter(index != at for index in range(3))
    assert publish(api, is_current=lambda source: next(checks))["status"] == "superseded"
    assert not committed(api)
    if at:
        assert api.calls[-1][:2] == ("DELETE", EDIT)
    else:
        assert api.calls == []


def test_divergent_release_source_is_not_overwritten():
    api = API()
    api.tracks[0]["releases"] = [{"releaseNotes": [{"text": "Source: https://github.com/yoav-zibin/course/commit/" + "d" * 40}]}]
    with pytest.raises(publication.PlayError, match="newer or divergent"):
        publish(api, is_ancestor=lambda previous, source: False)
    assert not committed(api)


@pytest.mark.parametrize("state", ["RELEASE_LIFECYCLE_STATE_IN_REVIEW", "RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW",
                                   "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED", "UNKNOWN"])
def test_pending_production_changes_block_before_any_edit(state):
    api = API()
    api.production = [{"releaseLifecycleState": state}]
    with pytest.raises(publication.PlayError, match="Production has pending"):
        publish(api)
    assert len(api.calls) == 1


def test_failed_commit_is_not_retried_with_review_cancellation_or_draft_fallback():
    api = API()
    api.fail_commit = True
    with pytest.raises(publication.PlayError, match="already in review"):
        publish(api)
    assert sum(path.endswith(":commit") for _, path, _, _ in api.calls) == 1
    assert api.calls[-1][:2] == ("DELETE", EDIT)


def test_unknown_or_ambiguous_tracks_cannot_fall_back_to_production():
    api = API()
    api.tracks = [{"track": "production", "releases": []}]
    with pytest.raises(publication.PlayError, match="exactly one internal"):
        publish(api)
    assert not committed(api)
    api.tracks.extend([{"track": "qa"}, {"track": "internal"}])
    with pytest.raises(publication.PlayError, match="exactly one internal"):
        publish(api)


def test_qa_identifier_from_google_is_supported_without_arbitrary_track_argument():
    api = API()
    api.tracks[0]["track"] = "qa"
    assert publish(api)["track"] == "qa"
    assert any(path == EDIT + "/tracks/qa" for _, path, _, _ in api.calls)
