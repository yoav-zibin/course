"""Firestore storage selection: enabling Firestore requires an explicit
project and namespace (there is no other Firestore mode), and the data-file
server must not grow the isolated scaling demo's routes."""

import json
from unittest.mock import patch
import pytest

from fastapi.testclient import TestClient

from game_platform import main
from game_platform.json_file_store import JsonFileStore


def test_enabled_firestore_config_requires_project_and_namespace(tmp_path):
    config = tmp_path / "production.json"
    config.write_text(json.dumps({"firestore": {"enabled": True}}))
    with (
        patch("sys.argv", ["game_platform.main", "--config", str(config)]),
        pytest.raises(ValueError, match="namespace"),
    ):
        main.main()


def test_data_file_server_has_no_demo_routes(tmp_path):
    config = tmp_path / "local.json"
    config.write_text(
        json.dumps({"data_file": {"path": str(tmp_path / "data.json")}})
    )
    apps = []
    with (
        patch("sys.argv", ["game_platform.main", "--config", str(config)]),
        patch.object(
            main.uvicorn, "run", side_effect=lambda app, **kwargs: apps.append(app)
        ),
    ):
        main.main()

    with TestClient(apps[0]) as client:
        assert client.get("/storage/capabilities").json()["pagination"] is False
        root = client.get("/", follow_redirects=False)
        assert root.status_code == 200
        assert "Game platform · Welcome" in root.text
        for path in ("/demo", "/demo/accounts", "/demo/budget", "/admin/demo-fixtures"):
            assert client.get(path).status_code == 404


@pytest.mark.parametrize("allow_production", [False, True])
def test_firestore_in_default_database_needs_deliberate_opt_in(
    tmp_path, monkeypatch, allow_production
):
    monkeypatch.delenv("FIRESTORE_EMULATOR_HOST", raising=False)
    config = tmp_path / "query.json"
    config.write_text(
        json.dumps(
            {
                "firestore": {
                    "enabled": True,
                    "project_id": "production-project",
                    "namespace": "production_v1",
                    "allow_default_database_query": allow_production,
                }
            }
        )
    )
    store = JsonFileStore(tmp_path / "isolated.json")
    with (
        patch("sys.argv", ["game_platform.main", "--config", str(config)]),
        patch("google.cloud.firestore.Client") as client,
        patch("game_platform.query_store.QueryStore", return_value=store) as query,
        patch.object(main.uvicorn, "run"),
    ):
        if allow_production:
            main.main()
            assert query.call_args.kwargs["namespace"] == "production_v1"
            assert client.call_args.kwargs["database"] == "(default)"
        else:
            with pytest.raises(ValueError, match="opt-in"):
                main.main()
            query.assert_not_called()
            client.assert_not_called()
