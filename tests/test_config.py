import json
from pathlib import Path
import uuid

import pytest
from pydantic import ValidationError

from game_platform.config import Config, load_config

EXAMPLE = Path(__file__).resolve().parents[1] / "config.example.json"


def _write_config(directory: Path, config: object) -> Path:
    path = directory / "config.json"
    path.write_text(json.dumps(config))
    return path


def test_the_example_config_lists_every_field_with_its_default() -> None:
    example = json.loads(EXAMPLE.read_text())
    assert Config.model_validate(example) == Config()
    defaults = json.loads(Config().model_dump_json())
    defaults["data_file"]["path"] = Path(defaults["data_file"]["path"]).as_posix()
    assert example == defaults


def test_omitted_fields_take_their_defaults(tmp_path: Path) -> None:
    config = load_config(_write_config(tmp_path, {"server": {"port": 9000}}))
    assert (config.server.host, config.server.port, config.debug_tools) == (
        "127.0.0.1",
        9000,
        True,
    )


def test_bug_report_quota_exemptions_are_private_canonical_account_ids(tmp_path: Path) -> None:
    identity = str(uuid.uuid4())
    config = load_config(_write_config(tmp_path, {"bug_reports": {"unlimited_user_ids": [identity, identity]}}))
    assert config.bug_reports.unlimited_user_ids == (identity,)
    assert Config().bug_reports.unlimited_user_ids == ()


@pytest.mark.parametrize("value", ["not-a-user-id", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa", 123, None])
def test_bug_report_exemptions_reject_noncanonical_ids(value) -> None:
    with pytest.raises(ValidationError):
        Config.model_validate({"bug_reports": {"unlimited_user_ids": [value]}})


def test_retired_model_api_does_not_block_restart_or_change_active_settings(tmp_path: Path) -> None:
    active = {
        "server": {"port": 9123},
        "master_password": "existing-master-password",
        "auth": {"google": {"client_id": "existing-oauth-client"}},
        "firestore": {"enabled": True, "project_id": "test-project",
                      "namespace": "production_v3", "allow_default_database_query": True},
    }
    original = {**active, "model_api": {"enabled": True, "api_key": "retired-private-key"}}
    before = json.loads(json.dumps(original))
    parsed = Config.model_validate(original)
    assert parsed == Config.model_validate(active)
    assert original == before
    assert "model_api" not in parsed.model_dump()
    assert "retired-private-key" not in parsed.model_dump_json()
    expected = load_config(_write_config(tmp_path, active))
    assert load_config(_write_config(tmp_path, original)) == expected


@pytest.mark.parametrize("extra", [{"model_apix": {}}, {"server": {"porrt": 9123}}])
def test_retired_model_api_does_not_relax_other_config_validation(extra: dict) -> None:
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        Config.model_validate({"model_api": {"api_key": "retired-private-key"}, **extra})


def test_data_file_path_is_relative_to_the_config_file(tmp_path: Path) -> None:
    config_dir = tmp_path / "conf"
    config_dir.mkdir()

    def data_file(path: str) -> Path:
        config = {"data_file": {"path": path}}
        return load_config(_write_config(config_dir, config)).data_file.path

    assert data_file("data/game.json") == config_dir / "data" / "game.json"
    absolute_path = tmp_path / "absolute" / "game.json"
    assert data_file(str(absolute_path)) == absolute_path
    assert data_file("~/game.json") == Path.home() / "game.json"


def test_invalid_configs_are_rejected(tmp_path: Path) -> None:
    def errors(config: object) -> list[str]:
        with pytest.raises(ValidationError) as error:
            load_config(_write_config(tmp_path, config))
        return [
            ".".join(str(part) for part in detail["loc"]) + ": " + detail["msg"]
            for detail in error.value.errors()
        ]

    assert errors({"data_file": {"save_interval": 5}}) == [
        "data_file.save_interval: Extra inputs are not permitted"
    ]
    assert errors(
        {"server": {"port": 0}, "data_file": {"save_interval_seconds": -1}}
    ) == [
        "server.port: Input should be greater than or equal to 1",
        "data_file.save_interval_seconds: Input should be greater than or equal to 0",
    ]
    assert errors({"log_level": "LOUD"}) == [
        "log_level: Input should be 'DEBUG', 'INFO', 'WARNING' or 'ERROR'"
    ]


@pytest.mark.parametrize("host", ["127.0.0.1", "::1", "localhost", "0.0.0.0", "::", "10.0.0.5", "example.com"])
def test_admin_google_configuration_does_not_require_a_shared_game_master_on_any_bind_host(tmp_path, host):
    config = load_config(_write_config(tmp_path, {
        "server": {"host": host},
        "auth": {"google": {"client_id": "fixture-client"}},
        "admin_google_emails": ["teacher@example.test"],
    }))
    assert config.master_password == ""
    assert config.admin_google_emails == ("teacher@example.test",)
    assert config.server.host == host
