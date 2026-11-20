"""Install just the requested invite alert without enabling broad server alerts."""

import copy
import importlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def installer(monkeypatch):
    folder = Path(__file__).resolve().parents[1] / "ops" / "monitoring"
    monkeypatch.syspath_prepend(str(folder))
    return importlib.import_module("install_invite_alert")


def test_invite_policy_is_enabled_and_matches_only_maintenance_events(installer):
    policy = installer.invite_code_policy(["projects/test/notificationChannels/admin"])
    assert policy["enabled"] is True
    event_filter = policy["conditions"][0]["conditionMatchedLog"]["filter"]
    assert 'log_id("game_platform")' in event_filter
    for event in ("invite_code_capacity_high", "invite_code_cleanup_incomplete", "invite_code_cleanup_failed"):
        assert f'jsonPayload.event="{event}"' in event_filter
    assert "jsonPayload.alert" not in event_filter


def test_install_reuses_existing_channels_without_enabling_generic_policy(installer):
    generic = {"displayName": "Game platform: minor alert from the server's log",
               "enabled": False, "name": "projects/test/alertPolicies/general",
               "notificationChannels": ["projects/test/notificationChannels/admin"]}
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        if "list" in args:
            return SimpleNamespace(stdout=json.dumps([generic]))
        assert "create" in args
        path = next(arg.split("=", 1)[1] for arg in args if arg.startswith("--policy-from-file="))
        desired = json.loads(Path(path).read_text())
        assert desired["enabled"] and desired["notificationChannels"] == generic["notificationChannels"]
        assert desired["displayName"] == installer.INVITE_POLICY_NAME
        return SimpleNamespace(stdout=json.dumps({"name": "projects/test/alertPolicies/invite"}))

    assert installer.install("test", run=run) == "projects/test/alertPolicies/invite"
    assert len(calls) == 2 and generic["enabled"] is False


def test_install_is_idempotent_despite_server_added_condition_names(installer):
    existing = installer.invite_code_policy(["projects/test/notificationChannels/admin"])
    existing["name"] = "projects/test/alertPolicies/invite"
    existing["conditions"][0]["name"] = existing["name"] + "/conditions/one"
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        assert "list" in args
        return SimpleNamespace(stdout=json.dumps([existing]))

    assert installer.install("test", channels=existing["notificationChannels"], run=run) == existing["name"]
    assert len(calls) == 1


def test_install_reconciles_only_the_named_invite_policy(installer):
    existing = installer.invite_code_policy(["projects/test/notificationChannels/admin"])
    existing.update(name="projects/test/alertPolicies/invite", enabled=False)
    original = copy.deepcopy(existing)

    def run(args, **kwargs):
        if "list" in args:
            return SimpleNamespace(stdout=json.dumps([existing]))
        assert "update" in args and existing["name"] in args
        return SimpleNamespace(stdout=json.dumps({"name": existing["name"]}))

    assert installer.install("test", channels=existing["notificationChannels"], run=run) == existing["name"]
    assert existing == original


def test_install_refuses_unconfigured_or_cross_project_channels(installer):
    run = lambda *a, **kw: SimpleNamespace(stdout="[]")
    with pytest.raises(ValueError, match="No configured"):
        installer.install("test", run=run)
    with pytest.raises(ValueError, match="selected project"):
        installer.install("test", channels=["projects/other/notificationChannels/admin"], run=run)
