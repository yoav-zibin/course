"""Scheduling never mistakes a queued review for a completed security audit."""

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

SPEC = importlib.util.spec_from_file_location(
    "security_watch", Path(__file__).parents[1] / "ops/security-audit/watch.py"
)
watch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watch)


@pytest.fixture
def state_dir(tmp_path):
    watch.save_json(tmp_path / "state.json", {
        "repository": "yoav-zibin/course", "branch": "main",
        "last_audited_commit": "a" * 40, "thread_id": "test-thread",
    })
    (tmp_path / "instructions.txt").write_text("Review all unaudited security changes.")
    return tmp_path


def test_no_new_commits_does_not_queue_a_review(state_dir, monkeypatch):
    run = Mock(return_value=SimpleNamespace(stdout="a" * 40 + "\trefs/heads/main\n"))
    monkeypatch.setattr(watch.subprocess, "run", run)
    assert watch.check(state_dir) == "No unaudited security commits"
    assert run.call_count == 1


def test_successful_queue_preserves_checkpoint_and_deduplicates(state_dir, monkeypatch):
    original = (state_dir / "state.json").read_bytes()
    remote = SimpleNamespace(stdout="b" * 40 + "\trefs/heads/main\n")
    queued = SimpleNamespace(stdout="queued", stderr="", check_returncode=lambda: None)
    run = Mock(side_effect=[remote, queued, remote])
    monkeypatch.setattr(watch.subprocess, "run", run)
    assert watch.check(state_dir).startswith("Queued daily security audit")
    assert (state_dir / "state.json").read_bytes() == original
    assert json.loads((state_dir / "pending.json").read_text())["head"] == "b" * 40
    assert watch.check(state_dir).startswith("Security audit already queued")
    assert run.call_count == 3


def test_failed_queue_does_not_mark_audit_complete_or_pending(state_dir, monkeypatch):
    original = (state_dir / "state.json").read_bytes()
    remote = SimpleNamespace(stdout="b" * 40 + "\trefs/heads/main\n")
    failure = Mock()
    failure.check_returncode.side_effect = RuntimeError("queue failed")
    monkeypatch.setattr(watch.subprocess, "run", Mock(side_effect=[remote, failure]))
    with pytest.raises(RuntimeError, match="queue failed"):
        watch.check(state_dir)
    assert (state_dir / "state.json").read_bytes() == original
    assert not (state_dir / "pending.json").exists()


def test_invalid_checkpoint_refuses_to_skip_unreviewed_history(state_dir, monkeypatch):
    state = json.loads((state_dir / "state.json").read_text())
    state["last_audited_commit"] = "main"
    watch.save_json(state_dir / "state.json", state)
    run = Mock()
    monkeypatch.setattr(watch.subprocess, "run", run)
    with pytest.raises(ValueError, match="Invalid security checkpoint"):
        watch.check(state_dir)
    run.assert_not_called()
