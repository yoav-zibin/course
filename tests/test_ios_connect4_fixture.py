"""The screenshot seed restores a real local game without credentials or network."""

import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import uuid

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "frontends/portal/scripts/seed-ios-connect4-fixture.py"
spec = importlib.util.spec_from_file_location("ios_connect4_fixture", SCRIPT)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
BUNDLE = "edu.columbia.gameportal.starter"
DEVICE = "12D05335-2DAB-4D98-A71C-659058530A53"
CI = {"GITHUB_ACTIONS": "true", "RUNNER_OS": "macOS"}


def container_at(home, bundle=BUNDLE):
    path = (home / "Library/Developer/CoreSimulator/Devices" / DEVICE
            / "data/Containers/Data/Application" / str(uuid.uuid4()).upper())
    path.mkdir(parents=True)
    (path / ".com.apple.mobile_container_manager.metadata.plist").write_bytes(
        plistlib.dumps({"MCMMetadataIdentifier": bundle}))
    return path


def seed(home, proof, **options):
    return fixture.seed_fixture(DEVICE, BUNDLE, proof, home=home, environment=CI,
                                local_only=True, **options)


def test_public_rules_derive_six_distinct_svg_discs_centered_on_rack_holes():
    data, proof = fixture.fixture_snapshot()
    game = next(iter(data["responses"].values()))
    package = json.loads(fixture.PUBLIC_PACKAGE.read_text())
    assert game == package["game"]  # Exact pinned rules, schemas and rich UI.
    assert game["version"] == 3
    match = data["local"][data["selectedId"]]
    assert match["logicState"]["disc_ids"][28] == 4
    assert match["logicState"]["disc_ids"][41] == 1
    assert match["move_count"] == 6 and len(match["moves"]) == 6
    assert match["turn_of_player_indices"] == [0] and not match["awaitingHandoff"]
    assert {tuple(disc["center"]) for disc in proof["placed_svg_discs"]} == {
        (49, 324), (349, 324), (49, 374), (199, 374), (249, 374), (349, 374),
    }
    assert {disc["asset"] for disc in proof["placed_svg_discs"]} == {"disc0", "disc1"}
    assert all(disc["width"] == disc["height"] == 44 for disc in proof["placed_svg_discs"])
    assert not data["queues"] and not data["conflicts"]
    assert "password" not in match


def test_native_file_envelope_matches_swift_store_and_never_creates_account_credentials(tmp_path):
    app = container_at(tmp_path)
    proof = seed(tmp_path, tmp_path / "proof.json")
    directory = app / "Library/Application Support/BuildPlayShared"
    files = list(directory.iterdir())
    assert len(files) == 1
    assert files[0].name == hashlib.sha256(fixture.STORAGE_KEY.encode()).hexdigest() + ".json"
    envelope = json.loads(files[0].read_text())
    assert envelope["key"] == fixture.STORAGE_KEY and isinstance(envelope["value"], str)
    assert json.loads(envelope["value"])["selectedId"] == fixture.MATCH_ID
    assert proof["storage_sha256"] == hashlib.sha256(files[0].read_bytes()).hexdigest()
    assert json.loads((tmp_path / "proof.json").read_text()) == proof
    assert "game-platform.accounts.v1" not in files[0].read_text()
    assert not (app / "Documents").exists()


@pytest.mark.parametrize(("environment", "local_only"), [
    ({}, True), ({"GITHUB_ACTIONS": "true", "RUNNER_OS": "Linux"}, True),
    (CI, False),
])
def test_restricted_to_explicit_isolated_macos_ci_launch(tmp_path, environment, local_only):
    app = container_at(tmp_path)
    with pytest.raises(ValueError, match="restricted"):
        fixture.seed_fixture(DEVICE, BUNDLE, tmp_path / "proof.json", home=tmp_path,
                             environment=environment, local_only=local_only)
    assert not (app / "Library").exists()


def test_existing_private_documents_refuse_fixture_without_modifying_original(tmp_path):
    app = container_at(tmp_path)
    original = app / "Documents/portal.json"
    original.parent.mkdir()
    original.write_text("private saved match remains untouched")
    with pytest.raises(ValueError, match="existing app data"):
        seed(tmp_path, tmp_path / "proof.json")
    assert original.read_text() == "private saved match remains untouched"
    assert not (app / "Library").exists()


def test_second_seed_cannot_replace_first_saved_game(tmp_path):
    app = container_at(tmp_path)
    seed(tmp_path, tmp_path / "proof.json")
    directory = app / "Library/Application Support/BuildPlayShared"
    original = {path.name: path.read_bytes() for path in directory.iterdir()}
    with pytest.raises(ValueError, match="existing app data"):
        seed(tmp_path, tmp_path / "different-proof.json")
    assert {path.name: path.read_bytes() for path in directory.iterdir()} == original
    assert not (tmp_path / "different-proof.json").exists()


@pytest.mark.parametrize("ambiguous", [False, True])
def test_missing_or_duplicate_bundle_metadata_cannot_select_an_arbitrary_container(tmp_path, ambiguous):
    first = container_at(tmp_path, BUNDLE if ambiguous else "example.other")
    if ambiguous:
        container_at(tmp_path)
    with pytest.raises(ValueError, match="exactly one"):
        seed(tmp_path, tmp_path / "proof.json")
    assert not (first / "Library").exists()


def test_symlink_cannot_redirect_writes_outside_installed_app(tmp_path):
    app = container_at(tmp_path)
    outside = tmp_path / "unrelated-data"
    outside.mkdir()
    (app / "Library").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic links"):
        seed(tmp_path, tmp_path / "proof.json")
    assert not list(outside.iterdir())


def test_plain_circle_package_would_not_cover_the_native_svg_viewport_regression(tmp_path):
    package = json.loads(fixture.PUBLIC_PACKAGE.read_text())
    package["game"]["declarative_ui"]["piece_types"]["p0"]["shape"] = "circle"
    changed = tmp_path / "plain-circles.json"
    changed.write_text(json.dumps(package))
    with pytest.raises(ValueError, match="SVG image discs"):
        fixture.fixture_snapshot(changed)
