"""The manual diagnostic cannot substitute artifacts or mutate canonical input."""

import copy
import importlib.util
from pathlib import Path
import stat
import zipfile

import pytest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/diagnose-ios-simulator.py"
spec = importlib.util.spec_from_file_location("ios_diagnostics", SCRIPT)
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)


def provenance():
    return {"run": {"id": diagnostics.RUN_ID, "head_sha": diagnostics.SOURCE_SHA,
                    "repository": {"full_name": diagnostics.REPOSITORY},
                    "head_repository": {"full_name": diagnostics.REPOSITORY},
                    "event": "push", "head_branch": "main"},
            "artifact": {"id": diagnostics.ARTIFACT_ID, "name": "BuildPlay-ios-simulator",
                         "expired": False, "digest": diagnostics.ARTIFACT_DIGEST,
                         "workflow_run": {"id": diagnostics.RUN_ID, "head_sha": diagnostics.SOURCE_SHA}}}


@pytest.mark.parametrize("mutation", ["source", "fork", "artifact", "digest", "expired"])
def test_only_exact_trusted_d1_artifact_is_accepted(mutation):
    data = provenance()
    diagnostics.validate_provenance(data)
    if mutation == "source":
        data["run"]["head_sha"] = "another-commit"
    elif mutation == "fork":
        data["run"]["head_repository"]["full_name"] = "someone/course"
    elif mutation == "artifact":
        data["artifact"]["id"] += 1
    elif mutation == "digest":
        data["artifact"]["digest"] = "sha256:substituted"
    else:
        data["artifact"]["expired"] = True
    with pytest.raises(ValueError, match="pinned trusted"):
        diagnostics.validate_provenance(data)


def test_signature_variants_preserve_default_private_appid_without_mutating_original():
    original = {"application-identifier": "TESTTEAM00.edu.columbia.gameportal.starter",
                "keychain-access-groups": ["TESTTEAM00.edu.columbia.gameportal.starter"]}
    before = copy.deepcopy(original)
    assert diagnostics.variant_entitlements("original", original) is None
    assert diagnostics.variant_entitlements("original-recheck", original) is None
    assert diagnostics.variant_entitlements("app-id-only", original) == {"application-identifier": original["application-identifier"]}
    assert diagnostics.variant_entitlements("empty-control", original) == {}
    assert original == before


def test_metadata_cannot_authorize_substituted_download_bytes(tmp_path):
    archive = tmp_path / "BuildPlay-simulator.zip"
    archive.write_bytes(b"different simulator payload despite matching API metadata")
    with pytest.raises(ValueError, match="trusted payload"):
        diagnostics.trusted_archive_hash(archive)


def test_resigning_a_copy_cannot_change_the_canonical_binary(tmp_path):
    canonical = tmp_path / "canonical/BuildPlay.app"
    canonical.mkdir(parents=True)
    (canonical / "BuildPlay").write_bytes(b"trusted canonical Mach-O")
    variant = tmp_path / "variant/BuildPlay.app"
    diagnostics.copy_variant(canonical, variant)
    (variant / "BuildPlay").write_bytes(b"modified diagnostic signature")
    assert (canonical / "BuildPlay").read_bytes() == b"trusted canonical Mach-O"
    with pytest.raises(ValueError, match="fresh"):
        diagnostics.copy_variant(canonical, variant)


@pytest.mark.parametrize("symlink", [False, True])
def test_archive_cannot_escape_its_temporary_extraction_directory(tmp_path, symlink):
    archive = tmp_path / "bad.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        if symlink:
            item = zipfile.ZipInfo("BuildPlay.app/external")
            item.external_attr = (stat.S_IFLNK | 0o777) << 16
            bundle.writestr(item, "../../outside")
        else:
            bundle.writestr("../outside", "must not escape")
    with pytest.raises(ValueError, match="escap"):
        diagnostics.validate_archive(archive)
    assert not (tmp_path / "outside").exists()
