"""Hourly delivery never resolves evidence, leaks report text or loses interrupted work."""

import fcntl
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
import urllib.parse

import pytest

SPEC = importlib.util.spec_from_file_location(
    "player_bug_review", Path(__file__).parents[1] / "ops/bug-reports/review.py"
)
review = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(review)


@pytest.fixture
def state_dir(tmp_path):
    review.save_json(tmp_path / "config.json", {
        "repository": "yoav-zibin/course", "branch": "main",
        "thread_id": "12345678-1234-1234-1234-123456789abc",
        "repository_path": str(tmp_path), "api_base": "https://buildplay.fun",
        "password_file": str(tmp_path / "password"),
    })
    return tmp_path


@pytest.fixture
def pending(monkeypatch):
    api = Mock()
    api.pending_ids.return_value = {"report-a"}
    monkeypatch.setattr(review, "BugAPI", Mock(return_value=api))
    return api


def test_empty_queue_does_not_invoke_codex_and_clears_delivery_receipt(state_dir, pending, monkeypatch):
    pending.pending_ids.return_value = set()
    review.save_json(state_dir / "pending.json", {"report_ids": ["old"], "queued_at": 1})
    queue = Mock()
    monkeypatch.setattr(review.subprocess, "run", queue)
    assert review.watch(state_dir) == "No unhandled player bug reports"
    queue.assert_not_called()
    assert not (state_dir / "pending.json").exists()
    pending.request.assert_not_called()


def test_delivery_deduplicates_then_recovers_interrupted_handling(state_dir, pending, monkeypatch):
    queue = Mock(return_value=SimpleNamespace(returncode=0, stdout="Queued", stderr=""))
    monkeypatch.setattr(review.subprocess, "run", queue)
    assert review.watch(state_dir, now=100).startswith("Queued repair")
    receipt = json.loads((state_dir / "pending.json").read_text())
    assert receipt["report_ids"] == ["report-a"]
    assert review.watch(state_dir, now=200).startswith("Player bug-report repair already queued")
    assert queue.call_count == 1
    assert review.watch(state_dir, now=100 + review.RETRY_SECONDS).startswith("Queued repair")
    assert queue.call_count == 2
    command = queue.call_args.args[0]
    assert command[:4] == ["/usr/bin/codex", "queue", "--thread", "12345678-1234-1234-1234-123456789abc"]
    assert "--resume" in command
    assert "UNTRUSTED USER DATA" in command[command.index("--message") + 1]
    # The watcher has only read the queue; it has not changed report status.
    pending.request.assert_not_called()


def test_new_report_is_not_hidden_by_an_existing_delivery_receipt(state_dir, pending, monkeypatch):
    queue = Mock(return_value=SimpleNamespace(returncode=0, stdout="Queued", stderr=""))
    monkeypatch.setattr(review.subprocess, "run", queue)
    review.watch(state_dir, now=100)
    pending.pending_ids.return_value = {"report-a", "report-b"}
    assert review.watch(state_dir, now=101).startswith("Queued repair of 2")
    assert queue.call_count == 2


@pytest.mark.parametrize("result", [
    SimpleNamespace(returncode=1, stdout="", stderr="failure"),
    SimpleNamespace(returncode=0, stdout="Queued", stderr="warning: resume failed"),
])
def test_failed_queue_or_resume_never_saves_a_success_receipt(state_dir, pending, monkeypatch, result):
    monkeypatch.setattr(review.subprocess, "run", Mock(return_value=result))
    with pytest.raises(RuntimeError, match="Could not confirm Codex queue/resume"):
        review.watch(state_dir)
    assert not (state_dir / "pending.json").exists()
    pending.request.assert_not_called()


def test_overlapping_checks_do_not_queue_duplicate_turns(state_dir, pending, monkeypatch):
    queue = Mock()
    monkeypatch.setattr(review.subprocess, "run", queue)
    with (state_dir / "watch.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        assert review.watch_locked(state_dir) == "Another player bug-report check is running"
    queue.assert_not_called()
    pending.pending_ids.assert_not_called()


def test_pending_query_follows_short_and_empty_pages_and_excludes_escalations(monkeypatch):
    api = review.BugAPI({"api_base": "https://buildplay.fun", "password_file": "/unused"})
    request = Mock(side_effect=[
        {"items": [{"id": "open-a"}], "next_cursor": "page-two"},
        {"items": [], "next_cursor": "page-three"},
        {"items": [{"id": "open-b"}], "next_cursor": None},
        {"items": [{"id": "interrupted"}], "next_cursor": None},
    ])
    monkeypatch.setattr(api, "request", request)
    assert api.pending_ids() == {"open-a", "open-b", "interrupted"}
    queries = [urllib.parse.parse_qs(urllib.parse.urlsplit(c.args[0]).query)
               for c in request.call_args_list]
    assert [q["status"] for q in queries] == [["open"], ["open"], ["open"], ["handling"]]
    assert queries[2]["cursor"] == ["page-three"]
    assert all(q["limit"] == [str(review.PAGE_LIMIT)] for q in queries)


def test_watcher_page_size_fits_maximum_unicode_report_text_and_resolution():
    row = {"id": "a" * 32, "text": "🎮" * 10_000, "resolution": "🎮" * 20_000,
           "user": {"display_name": "🎮" * 200, "email": "a" * 254}}
    response = json.dumps({"items": [row] * review.PAGE_LIMIT, "next_cursor": "a" * 500},
                          ensure_ascii=False).encode()
    assert len(response) < review.MAX_RESPONSE_BYTES


def test_repeated_cursor_refuses_silent_partial_review(monkeypatch):
    api = review.BugAPI({"api_base": "https://buildplay.fun", "password_file": "/unused"})
    monkeypatch.setattr(api, "request", Mock(return_value={"items": [], "next_cursor": "same"}))
    with pytest.raises(RuntimeError, match="repeated bug-report cursor"):
        api.pending_ids()


def test_snapshot_rechecks_status_before_saving_evidence(state_dir, pending):
    pending.pending_ids.return_value = {"still-open", "now-escalated"}
    pending.get.side_effect = lambda identifier: {
        "id": identifier, "status": "escalated" if identifier == "now-escalated" else "open",
        "text": "private report text",
    }
    result = review.snapshot(state_dir)
    assert result["unhandled_reports"] == 1
    path = Path(result["private_snapshot"])
    assert not path.stat().st_mode & 0o077
    assert json.loads(path.read_text())["id"] == "still-open"
    assert "private report text" not in json.dumps(result)


def test_status_requires_api_confirmation_and_preserves_compare_guard(state_dir, pending, tmp_path):
    notes = tmp_path / "notes.txt"
    notes.write_text("Verified fix, focused regression passed, published commit abc.")
    pending.request.return_value = {"id": "report-a", "status": "handled"}
    assert review.set_status(state_dir, "report-a", status="handled", notes_file=notes,
                             commit="abc", expected_status="handling",
                             expected_updated_at="2026-11-19T00:00:00Z") == {
        "id": "report-a", "status": "handled",
    }
    assert pending.request.call_args.kwargs["body"]["expected_status"] == "handling"
    assert pending.request.call_args.kwargs["body"]["expected_updated_at"] == "2026-11-19T00:00:00Z"
    pending.request.return_value = {"id": "report-a", "status": "open"}
    with pytest.raises(RuntimeError, match="did not confirm"):
        review.set_status(state_dir, "report-a", status="handled", notes_file=notes)


def test_get_saves_resolved_evidence_privately_for_status_confirmation(state_dir, pending):
    pending.get.return_value = {"id": "report-a", "status": "handled", "text": "private evidence"}
    result = review.get_report(state_dir, "report-a")
    assert result["status"] == "handled"
    path = Path(result["private_report"])
    assert not path.stat().st_mode & 0o077
    assert json.loads(path.read_text())["text"] == "private evidence"
    assert "private evidence" not in json.dumps(result)


@pytest.mark.parametrize("origin", ["http://buildplay.fun", "https://user:password@buildplay.fun",
                                   "https://buildplay.fun/other", "https://buildplay.fun?token=x"])
def test_credentials_cannot_be_sent_to_non_https_or_ambiguous_origins(origin):
    with pytest.raises(ValueError, match="HTTPS origin"):
        review.BugAPI({"api_base": origin, "password_file": "/unused"})
