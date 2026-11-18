"""Private reproduction evidence never becomes an HTTP request/response log."""

import asyncio
import itertools
import json
import logging
from types import SimpleNamespace

import pytest
from fastapi import Body, HTTPException
from fastapi.testclient import TestClient

from game_platform import observability
from game_platform.config import MonitoringConfig
from game_platform.tests.helpers import Api
from game_platform.tests.test_game_bug_storage import bug


AUTH = ("reviewer", "private-test-master")
HIDDEN = "private-hand-do-not-log"
NOTES = "private-review-including-hidden-state"
SEED = str(2**255 + 743)


def captured(caplog):
    return "\n".join(record.getMessage() + json.dumps(
        getattr(record, "_fields", {}), default=str
    ) for record in caplog.records)


def api_calls(caplog):
    return [json.loads(record.getMessage().split("API_CALL ", 1)[1])
            for record in caplog.records if "API_CALL " in record.getMessage()]


def test_bug_reads_and_review_keep_bodies_out_of_normal_and_slow_logs(caplog, monkeypatch):
    caplog.set_level(logging.INFO)
    # Force the slow-request reporting path without a scheduler-dependent sleep.
    clock = SimpleNamespace(**vars(observability.time))
    clock.perf_counter = lambda: float(next(ticks))
    ticks = itertools.count()
    monkeypatch.setattr(observability, "time", clock)
    api = Api(master_password=AUTH[1])
    api.client.app.state.platform._store.put_game_server_bug(bug(
        evidence={"seed": SEED, "arguments": [{"hand": HIDDEN}],
                  "input_json": json.dumps({"private": HIDDEN})},
    ))
    caplog.clear()
    responses = [
        api.client.get("/game-server-bugs", auth=AUTH),
        api.client.get("/game-server-bugs/failure-1", auth=AUTH),
        api.client.post("/game-server-bugs/failure-1/examine", auth=AUTH,
                        json={"outcome": "escalated", "notes": NOTES}),
    ]
    assert [response.status_code for response in responses] == [200, 200, 200]
    assert HIDDEN in responses[1].text and SEED in responses[1].text
    assert NOTES in responses[2].text
    assert all(response.headers["cache-control"] == "private, no-store" for response in responses)
    calls = api_calls(caplog)
    assert len(calls) == 3
    assert all("request_body" not in call and "response_body" not in call for call in calls)
    assert all(call["response_bytes"] > 0 and call["duration_ms"] >= 0 for call in calls)
    assert calls[2]["request_bytes"] > 0
    slow = [record for record in caplog.records
            if getattr(record, "_event", "") in ("request_slow", "request_very_slow")]
    assert slow
    assert all("body" not in record._fields for record in slow)
    for private in (HIDDEN, SEED, NOTES):
        assert private not in captured(caplog)


@pytest.mark.parametrize("unexpected", [False, True])
def test_bug_body_is_omitted_on_http_and_unexpected_errors(caplog, unexpected):
    caplog.set_level(logging.INFO)
    api = Api(master_password=AUTH[1])

    def failure(payload: dict = Body()):
        if unexpected:
            raise RuntimeError(f"private probe failed: {HIDDEN} {SEED} {NOTES}")
        raise HTTPException(503, {"hand": HIDDEN, "seed": SEED})

    api.client.app.add_api_route("/game-server-bugs/log-failure", failure, methods=["POST"])
    # The private exception must not escape to an outer ASGI server logger.
    client = TestClient(api.client.app, raise_server_exceptions=True)
    caplog.clear()
    response = client.post("/game-server-bugs/log-failure", auth=AUTH,
                           json={"notes": NOTES, "seed": SEED})
    assert response.status_code == (500 if unexpected else 503)
    assert response.headers["cache-control"] == "private, no-store"
    events = [record for record in caplog.records if getattr(record, "_event", "") == (
        "unexpected_exception" if unexpected else "http_5xx"
    )]
    assert events
    if unexpected:
        event, = events
        assert event.exc_info is None
        assert event._fields["exception_type"] == "RuntimeError"
        assert event._fields["stack_frames"]
        assert "exception" not in json.loads(observability.JsonFormatter().format(event))
    call, = api_calls(caplog)
    assert call["request_bytes"] > 0
    assert call["response_bytes"] > 0
    if unexpected:
        assert response.json()["request_id"] == response.headers["x-request-id"]
    assert "request_body" not in call and "response_body" not in call
    for private in (HIDDEN, SEED, NOTES):
        assert private not in captured(caplog)
        assert private not in caplog.text
        if unexpected:
            assert private not in response.text


@pytest.mark.parametrize("path", ["/game-server-bugs", "/game-server-bugs/missing"])
def test_bug_authentication_errors_are_not_cached(path):
    api = Api(master_password=AUTH[1])
    response = api.client.get(path)
    assert response.status_code == 401
    assert response.headers["cache-control"] == "private, no-store"


def test_body_policy_covers_mounted_api_paths_and_has_exact_boundaries():
    assert observability._omit_request_bodies({"path": "/api/game-server-bugs/id", "root_path": "/api"})
    assert not observability._omit_request_bodies({"path": "/game-server-bugs-other", "root_path": ""})


def test_private_failure_after_response_start_does_not_restart_or_escape(caplog):
    caplog.set_level(logging.INFO)
    messages = []

    async def partial_response(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": HIDDEN.encode(), "more_body": True})
        raise RuntimeError(f"partial private response: {SEED} {NOTES}")

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(message):
        messages.append(message)

    monitor = observability.Monitor(MonitoringConfig())
    app = observability.RequestLogMiddleware(partial_response, monitor=lambda: monitor)
    asyncio.run(app({"type": "http", "method": "GET", "path": "/game-server-bugs/probe",
                     "query_string": b"", "headers": [], "client": ("127.0.0.1", 1234)},
                    receive, send))
    assert [message["status"] for message in messages if message["type"] == "http.response.start"] == [200]
    # An incomplete response tells the server to close it, rather than turning
    # partially sent private evidence into a successful complete response.
    assert not any(message["type"] == "http.response.body" and not message.get("more_body", False)
                   for message in messages)
    for private in (HIDDEN, SEED, NOTES):
        assert private not in captured(caplog)
        assert private not in caplog.text
