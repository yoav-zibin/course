"""The daily trigger must never acknowledge game bugs on the agent's behalf."""

import importlib.util
import json
from pathlib import Path
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("game_bug_review", ROOT / "ops/game-server-bugs/review.py")
review = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review)


@pytest.fixture
def state(tmp_path):
    password = tmp_path / "password"
    password.write_text("private-test-password\n")
    password.chmod(0o600)
    config = {"repository": "yoav-zibin/course", "branch": "main",
              "thread_id": "01a1ee57-ef6f-7412-9d46-bf2e1c560331",
              "api_base": "https://example.test", "password_file": str(password),
              "repository_path": str(ROOT)}
    (tmp_path / "config.json").write_text(json.dumps(config))
    return tmp_path


def test_watch_no_bugs_does_not_queue_or_write_receipt(state, monkeypatch):
    monkeypatch.setattr(review.BugAPI, "has_pending", lambda self: False)
    monkeypatch.setattr(review.subprocess, "run", lambda *a, **k: pytest.fail("Unexpected queue"))
    assert review.watch(state, day="2026-11-19") == "No unexamined game-server bugs"
    assert not list(state.glob("queued-*"))


def test_successful_queue_is_once_daily_and_does_not_examine_bugs(state, monkeypatch):
    monkeypatch.setattr(review.BugAPI, "has_pending", lambda self: True)
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, stdout="Queued", stderr="")

    monkeypatch.setattr(review.subprocess, "run", run)
    assert "Queued daily" in review.watch(state, day="2026-11-19")
    assert "already queued" in review.watch(state, day="2026-11-19")
    assert len(calls) == 1
    assert calls[0][:3] == ["/usr/bin/codex", "queue", "--thread"]
    assert calls[0][-1] == "--resume"
    receipt = json.loads((state / "queued-2026-11-19.json").read_text())
    assert "examined_at" not in receipt
    assert "private-test-password" not in calls[0][-2]


@pytest.mark.parametrize("returncode,stderr", [(1, "failed"), (0, "WARNING: cannot resume")])
def test_queue_failure_or_resume_warning_leaves_retry_possible(state, monkeypatch, returncode, stderr):
    monkeypatch.setattr(review.BugAPI, "has_pending", lambda self: True)
    monkeypatch.setattr(review.subprocess, "run", lambda args, **k:
                        subprocess.CompletedProcess(args, returncode, stdout="", stderr=stderr))
    with pytest.raises(RuntimeError, match="no success receipt"):
        review.watch(state, day="2026-11-19")
    assert not list(state.glob("queued-*"))


def test_dry_run_has_no_side_effects(state, monkeypatch):
    monkeypatch.setattr(review.BugAPI, "has_pending", lambda self: True)
    monkeypatch.setattr(review.subprocess, "run", lambda *a, **k: pytest.fail("Unexpected queue"))
    assert "Would queue" in review.watch(state, day="2026-11-19", dry_run=True)
    assert not list(state.glob("queued-*"))


def test_snapshot_follows_empty_cursor_pages_and_fetches_full_private_evidence(state, monkeypatch):
    pages = iter([{"items": [], "next_cursor": "next"},
                  {"items": [{"id": "bug-1"}, {"id": "already-reviewed"}], "next_cursor": "last"},
                  {"items": [{"id": "bug-2"}], "next_cursor": None}])
    details = {
        "bug-1": {"id": "bug-1", "examined": False, "examined_at": None,
                  "evidence": {"arguments": {"hidden": "cards"}, "server_code": "exact source"}},
        "bug-2": {"id": "bug-2", "examined": False, "examined_at": None,
                  "evidence": {"arguments": [1, 2], "seed": "123456"}},
        "already-reviewed": {"id": "already-reviewed", "examined": True,
                             "examined_at": "2026-11-19T07:00:00Z", "evidence": {}},
    }
    paths = []

    def request(self, path, **kwargs):
        paths.append(path)
        assert not kwargs  # Retrieval must not mutate examination state.
        if "?" in path:
            return next(pages)
        return details[path.rsplit("/", 1)[1]]

    monkeypatch.setattr(review.BugAPI, "request", request)
    result = review.snapshot(state)
    assert result["unexamined_bugs"] == 2
    assert result["skipped_examined"] == 1
    assert "hidden" not in json.dumps(result)
    assert any("cursor=next" in path for path in paths)
    assert any("cursor=last" in path for path in paths)
    assert [path for path in paths if "?" not in path] == [
        "/game-server-bugs/bug-1", "/game-server-bugs/already-reviewed", "/game-server-bugs/bug-2"]
    path = Path(result["private_snapshot"])
    assert not path.stat().st_mode & 0o077
    assert [json.loads(row) for row in path.read_text().splitlines()] == [details["bug-1"], details["bug-2"]]


@pytest.mark.parametrize("detail", [
    {"id": "bug-1", "examined": False},
    {"id": "wrong-id", "examined": False, "evidence": {}},
    {"id": "bug-1", "evidence": {}},
])
def test_snapshot_rejects_incomplete_or_mismatched_detail(state, monkeypatch, detail):
    def request(self, path, **kwargs):
        if "?" in path:
            return {"items": [{"id": "bug-1"}], "next_cursor": None}
        return detail

    monkeypatch.setattr(review.BugAPI, "request", request)
    with pytest.raises(RuntimeError, match="detail response"):
        review.snapshot(state)
    assert not list((state / "snapshots").iterdir())


def test_snapshot_does_not_leave_partial_evidence_on_failure(state, monkeypatch):
    def request(self, path, **kwargs):
        raise RuntimeError("network failed")

    monkeypatch.setattr(review.BugAPI, "request", request)
    with pytest.raises(RuntimeError, match="network failed"):
        review.snapshot(state)
    assert not list((state / "snapshots").iterdir())


def test_repeated_cursor_is_rejected(state, monkeypatch):
    monkeypatch.setattr(review.BugAPI, "request", lambda *a, **k:
                        {"items": [], "next_cursor": "same"})
    with pytest.raises(RuntimeError, match="repeated"):
        list(review.BugAPI(review.configuration(state)).pages())


@pytest.mark.parametrize("base", ["http://example.test", "https://user:pass@example.test",
                                  "https://example.test/path", "https://example.test?token=x"])
def test_api_refuses_unsafe_origins(state, base):
    config = review.configuration(state)
    config["api_base"] = base
    with pytest.raises(ValueError, match="HTTPS origin"):
        review.BugAPI(config)


def test_api_refuses_public_password_file_before_network(state):
    config = review.configuration(state)
    Path(config["password_file"]).chmod(0o644)
    with pytest.raises(RuntimeError, match="private"):
        review.BugAPI(config).request("/game-server-bugs")


def test_redirects_are_not_followed():
    assert review.NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://other.test") is None


def test_fixed_review_requires_publication_evidence_and_confirmation(state, monkeypatch):
    notes = state / "notes.txt"
    notes.write_text("Replayed exact bug arguments and verified published fix.")
    with pytest.raises(ValueError, match="published game version"):
        review.examine(state, "bug-1", outcome="fixed", notes_file=notes)
    calls = []

    def request(self, path, **kwargs):
        calls.append((path, kwargs))
        return {"id": "bug-1", "examined_at": "2026-11-19T07:00:00Z", "outcome": "fixed"}

    monkeypatch.setattr(review.BugAPI, "request", request)
    result = review.examine(state, "bug-1", outcome="fixed", notes_file=notes, fix_game_version=2)
    assert result["outcome"] == "fixed"
    assert calls[0][1]["method"] == "POST"
    assert calls[0][1]["body"]["fix_game_version"] == 2
    assert notes.read_text() not in json.dumps(result)
