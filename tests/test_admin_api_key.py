import json
from pathlib import Path
from unittest.mock import patch

import pytest

from game_platform import main
from game_platform.config import Config


def test_machine_key_is_private_optional_and_independent_of_shared_master(tmp_path, monkeypatch):
    monkeypatch.delenv("GAME_PLATFORM_ADMIN_API_KEY", raising=False)
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"master_password": "old-shared-game-secret"}))
    assert main.load_admin_api_key(config) == ""
    assert main.load_admin_api_key(None) == ""
    secret = tmp_path / "admin-api-key"
    secret.write_text("new-private-machine-fixture\n")
    secret.chmod(0o600)
    assert main.load_admin_api_key(config) == "new-private-machine-fixture"
    monkeypatch.setenv("GAME_PLATFORM_ADMIN_API_KEY", "environment-machine-fixture")
    assert main.load_admin_api_key(config) == "environment-machine-fixture"


@pytest.mark.parametrize("mode", [0o644, 0o640, 0o606])
def test_machine_key_rejects_shared_file_permissions_without_logging_values(tmp_path, monkeypatch, mode):
    monkeypatch.delenv("GAME_PLATFORM_ADMIN_API_KEY", raising=False)
    secret = tmp_path / "admin-api-key"
    secret.write_text("private-fixture-never-in-errors")
    secret.chmod(mode)
    with pytest.raises(ValueError) as failure:
        main.load_admin_api_key(tmp_path / "config.json")
    assert "private-fixture" not in str(failure.value)
    assert "0600" in str(failure.value)


def test_machine_key_rejects_symlink_and_empty_file(tmp_path, monkeypatch):
    monkeypatch.delenv("GAME_PLATFORM_ADMIN_API_KEY", raising=False)
    target = tmp_path / "source-key"
    target.write_text("private-fixture")
    target.chmod(0o600)
    key = tmp_path / "admin-api-key"
    key.symlink_to(target)
    with pytest.raises(ValueError):
        main.load_admin_api_key(tmp_path / "config.json")
    key.unlink()
    key.touch(mode=0o600)
    with pytest.raises(ValueError):
        main.load_admin_api_key(tmp_path / "config.json")


def test_print_config_never_loads_or_prints_machine_credential(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("GAME_PLATFORM_ADMIN_API_KEY", "private-machine-value-never-print")
    config = tmp_path / "config.json"
    config.write_text("{}")
    with patch("sys.argv", ["server", "--config", str(config), "--print-config"]), \
            patch.object(main, "load_admin_api_key", side_effect=AssertionError("read a private key for config output")):
        main.main()
    output = capsys.readouterr().out
    assert "private-machine-value" not in output
    assert "admin_api_key" not in output


def test_pending_fixed_allowlist_is_private_validated_and_only_used_when_field_absent(tmp_path):
    path = tmp_path / "admin-access.pending.json"
    path.write_text(json.dumps({"admin_google_emails": [" Teacher@Example.Test "]}))
    path.chmod(0o600)
    config_path = tmp_path / "config.json"
    assert main.configured_admin_emails(Config(), config_path) == ("teacher@example.test",)
    assert main.configured_admin_emails(Config(admin_google_emails=()), config_path) == ()
    assert main.configured_admin_emails(Config(admin_google_emails=("other@example.test",)), config_path) == ("other@example.test",)
    assert main.configured_admin_emails(Config(), None) == ()
    path.unlink()
    assert main.configured_admin_emails(Config(), config_path) == ()


@pytest.mark.parametrize("data", ["not json", "{}", '{"admin_google_emails":["not-an-email"]}',
                                    '{"admin_google_emails":[],"other":"private-value"}'])
def test_invalid_pending_allowlist_fails_closed_without_private_values(tmp_path, data):
    path = tmp_path / "admin-access.pending.json"
    path.write_text(data)
    path.chmod(0o600)
    with pytest.raises(ValueError) as failure:
        main.configured_admin_emails(Config(), tmp_path / "config.json")
    assert "private-value" not in str(failure.value)
    assert "not-an-email" not in str(failure.value)


def test_pending_allowlist_rejects_public_permissions_and_symlinks(tmp_path):
    path = tmp_path / "admin-access.pending.json"
    path.write_text('{"admin_google_emails":[]}')
    path.chmod(0o644)
    with pytest.raises(ValueError):
        main.configured_admin_emails(Config(), tmp_path / "config.json")
    target = tmp_path / "private-source"
    target.write_text(path.read_text())
    target.chmod(0o600)
    path.unlink()
    path.symlink_to(target)
    with pytest.raises(ValueError):
        main.configured_admin_emails(Config(), tmp_path / "config.json")
