import json

import pytest

from game_platform import main
from game_platform.config import Config


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
