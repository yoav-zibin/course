"""Installer owner pins survive ordinary reinstalls without crossing scopes."""

import importlib.util
from pathlib import Path
import subprocess
import sys
import uuid

import pytest


ROOT = Path(__file__).parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


install = module("player_bug_install", "ops/bug-reports/install.py")
review = module("player_bug_install_review", "ops/bug-reports/review.py")
OWNER = "a1010101-0101-4101-8101-010101010101"
REPLACEMENT = "b2020202-0202-4202-8202-020202020202"
CONFIG = {"repository": "yoav-zibin/course", "api_base": "https://buildplay.fun"}


def configured(previous=None, explicit=None, **changes):
    return install.with_owner_google_user_id(
        {**CONFIG, **changes}, previous,
        owner_google_user_id=explicit,
        validate_owner_id=review.validate_owner_google_user_id,
    )


def test_new_install_can_pin_a_canonical_owner_without_mutating_inputs():
    config = dict(CONFIG)
    result = install.with_owner_google_user_id(
        config, None, owner_google_user_id=OWNER,
        validate_owner_id=review.validate_owner_google_user_id,
    )
    assert result == {**CONFIG, "owner_google_user_id": OWNER}
    assert config == CONFIG


def test_ordinary_reinstall_preserves_the_existing_pin():
    previous = {**CONFIG, "owner_google_user_id": OWNER, "thread_id": "old-thread"}
    assert configured(previous)["owner_google_user_id"] == OWNER
    assert previous["owner_google_user_id"] == OWNER


@pytest.mark.parametrize("origin", [
    "https://buildplay.fun/", "https://BUILDPLAY.fun:443/",
])
def test_equivalent_https_origins_preserve_the_pin(origin):
    previous = {**CONFIG, "api_base": origin, "owner_google_user_id": OWNER}
    assert configured(previous)["owner_google_user_id"] == OWNER


def test_explicit_pin_overrides_or_repairs_the_previous_value():
    for previous_value in (OWNER, "invalid previous ID", [OWNER]):
        previous = {**CONFIG, "owner_google_user_id": previous_value}
        assert configured(previous, REPLACEMENT)["owner_google_user_id"] == REPLACEMENT


@pytest.mark.parametrize("origin", [
    "https://different.test", "https://buildplay.fun:8443",
    "https://buildplay.fun:0", "http://buildplay.fun",
])
def test_changed_origin_drops_the_previous_pin(origin):
    previous = {**CONFIG, "owner_google_user_id": OWNER}
    assert "owner_google_user_id" not in configured(previous, api_base=origin)


def test_changed_repository_drops_the_previous_pin():
    previous = {**CONFIG, "owner_google_user_id": OWNER}
    assert "owner_google_user_id" not in configured(previous, repository="another/repository")


def test_an_unrelated_stale_pin_is_not_selected_or_validated():
    previous = {**CONFIG, "api_base": "https://different.test", "owner_google_user_id": ["invalid"]}
    assert "owner_google_user_id" not in configured(previous)


@pytest.mark.parametrize("value", [
    "", "not-a-uuid", OWNER.replace("-", ""), OWNER.upper(),
    "{" + OWNER + "}", "urn:uuid:" + OWNER, " " + OWNER, OWNER + "\n",
    1, True, [], {}, uuid.UUID(OWNER),
])
@pytest.mark.parametrize("source", ["explicit", "existing"])
def test_invalid_selected_pins_fail_without_echoing_the_value(value, source):
    with pytest.raises(ValueError) as error:
        if source == "explicit":
            configured(explicit=value)
        else:
            configured({**CONFIG, "owner_google_user_id": value})
    assert str(error.value) == "Invalid owner Google user ID"


@pytest.mark.parametrize("previous", [
    None, CONFIG, {**CONFIG, "owner_google_user_id": None},
])
def test_unconfigured_installs_omit_the_owner_field(previous):
    assert "owner_google_user_id" not in configured(previous)


def test_help_exposes_the_optional_owner_argument_without_installing():
    result = subprocess.run(
        [sys.executable, str(ROOT / "ops/bug-reports/install.py"), "--help"],
        check=False, capture_output=True, text=True,
    )
    assert result.returncode == 0
    assert "--owner-google-user-id" in result.stdout
    assert "--student-user-ids-file" in result.stdout


def test_reinstall_writes_hourly_units_restarts_active_timer_and_preserves_identity_pins(tmp_path, monkeypatch):
    state = tmp_path / "private-state"
    state.mkdir(mode=0o700)
    credential = tmp_path / "admin-api-credential"
    credential.write_text("fixture-only-private-credential")
    credential.chmod(0o600)
    thread = "12345678-1234-1234-1234-123456789abc"
    review.save_json(state / "config.json", {
        **CONFIG, "branch": "main", "thread_id": thread,
        "repository_path": str(install.REPOSITORY), "password_file": str(credential),
        "owner_google_user_id": OWNER, "student_user_ids": [REPLACEMENT],
    })
    commands = []
    monkeypatch.setattr(install.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(review, "BugAPI", lambda config: None)
    monkeypatch.setitem(sys.modules, "review", review)
    monkeypatch.setattr(install.subprocess, "run", lambda command, **kwargs: commands.append(command))
    monkeypatch.setattr(sys, "argv", ["install.py", "--thread-id", thread,
                                     "--password-file", str(credential), "--state-dir", str(state)])
    install.main()
    timer = (tmp_path / ".config/systemd/user/buildplay-bug-reports.timer").read_text()
    assert "OnCalendar=*-*-* *:00:00 UTC\n" in timer
    assert "Persistent=true\n" in timer and "Unit=buildplay-bug-reports.service\n" in timer
    assert "every hour" in timer
    assert ["systemctl", "--user", "daemon-reload"] in commands
    assert ["systemctl", "--user", "restart", "buildplay-bug-reports.timer"] in commands
    config = review.configuration(state)
    assert config["owner_google_user_id"] == OWNER
    assert config["student_user_ids"] == [REPLACEMENT]
    assert config["thread_id"] == thread and config["password_file"] == str(credential)
    assert not (state / "authorizations.json").exists()


def configured_students(previous=None, explicit=None, **changes):
    return install.with_student_user_ids(
        {**CONFIG, **changes}, previous, student_user_ids=explicit,
        validate_student_ids=review.validate_student_user_ids,
    )


def test_student_pins_are_optional_preserved_and_explicitly_replaceable():
    assert configured_students() == CONFIG
    previous = {**CONFIG, "student_user_ids": [OWNER]}
    assert configured_students(previous)["student_user_ids"] == [OWNER]
    assert configured_students(previous, [REPLACEMENT])["student_user_ids"] == [REPLACEMENT]
    assert "student_user_ids" not in configured_students(previous, [])
    assert previous["student_user_ids"] == [OWNER]


@pytest.mark.parametrize("origin", ["https://buildplay.fun/", "https://BUILDPLAY.fun:443/"])
def test_equivalent_origin_keeps_student_pins(origin):
    assert configured_students({**CONFIG, "api_base": origin, "student_user_ids": [OWNER]})["student_user_ids"] == [OWNER]


@pytest.mark.parametrize("changes", [
    {"api_base": "https://another.test"}, {"api_base": "https://buildplay.fun:8443"},
    {"repository": "another/repository"},
])
def test_scope_changes_drop_student_pins_without_validating_unrelated_data(changes):
    previous = {**CONFIG, "student_user_ids": "malformed old roster"}
    assert "student_user_ids" not in configured_students(previous, **changes)


@pytest.mark.parametrize("value", ["not a list", [OWNER, OWNER], [OWNER.upper()], [True], list(range(13))])
def test_invalid_student_rosters_fail_without_echoing_identifiers(value):
    with pytest.raises(ValueError, match="Invalid student user IDs"):
        configured_students(explicit=value)
