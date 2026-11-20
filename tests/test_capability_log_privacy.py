"""Opaque invite and app-login route capabilities never enter server logs."""
import json
import logging
from dataclasses import replace

import pytest

from game_platform.config import MonitoringConfig
from game_platform.observability import Monitor, RequestLogMiddleware, redact, redact_query, scrub_text
from game_platform.tests.helpers import Api


@pytest.mark.parametrize("prefix", ["/auth/app-sessions", "/invites", "/invite", "/i"])
@pytest.mark.parametrize("result", ["ok", "slow", "error"])
def test_capability_paths_are_hidden_in_pending_slow_error_and_api_logs(prefix, result, caplog):
    import asyncio
    token = "private-route-capability"
    path = f"{prefix}/{token}/exchange"
    monitor = Monitor(MonitoringConfig(slow_request_ms=1, very_slow_request_ms=2), memory=lambda: None)
    pending = []

    async def app(scope, receive, send):
        pending.append(monitor.snapshot()["oldest_in_flight"])
        if result == "error":
            raise RuntimeError("test failure")
        if result == "slow":
            await asyncio.sleep(.01)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    async def receive():
        return {"type": "http.request", "body": b""}

    async def send(message):
        pass

    scope = {"type": "http", "method": "POST", "path": path,
             "headers": [], "query_string": b"", "state": {}}
    middleware = RequestLogMiddleware(app, monitor=lambda: monitor)
    caplog.set_level(logging.INFO, logger="game_platform.events")
    if result == "error" and prefix != "/auth/app-sessions":
        with pytest.raises(RuntimeError):
            asyncio.run(middleware(scope, receive, send))
    else:
        asyncio.run(middleware(scope, receive, send))
    records = [record for record in caplog.records if record.name == "game_platform.events"]
    logged = "\n".join(record.getMessage() + json.dumps(getattr(record, "_fields", {}), default=str)
                       for record in records)
    assert token not in json.dumps(pending, default=str)
    assert f"{prefix}/<redacted>/exchange" in logged
    assert token not in logged
    if result == "slow":
        assert any(getattr(record, "_event", "") == "request_very_slow" for record in records)


def test_private_invite_urls_and_batch_paths_are_redacted_but_regular_ids_remain(caplog):
    api = Api()
    # A random four-letter code can also be an ordinary log word, such as
    # "game". Pin an uncommon test capability without changing live minting.
    api.platform._new_invite_token = lambda: "qzvx"
    caplog.set_level(logging.INFO, logger="game_platform.events")
    alice = api.new_user("Alice")
    match_id = api.new_match(owner=alice, game_id=api.new_game(owner=alice))
    store = api.platform._store
    store.put_match(replace(store.get_match(match_id), private=True))
    invite = api.ok("POST", f"/matches/{match_id}/invites", as_user=alice)
    token = invite["token"]
    api.ok("GET", f"/invites/{token}")
    paths = [f"/invites/{token}", f"/matches/{match_id}"]
    api.ok("GET", "/batch", params={"requests": json.dumps(paths)})
    logs = "\n".join(record.getMessage() for record in caplog.records if record.name == "game_platform.events")
    assert token not in logs
    assert match_id in logs
    assert "/invites/<redacted>" in logs
    assert redact({"url": f"https://example.invalid/i/{token}"}) == {"url": "https://example.invalid/i/<redacted>"}
    assert redact({"url": f"https://example.invalid/portal#invite={token}"}) == {"url": "https://example.invalid/portal#invite=<redacted>"}
    assert token not in redact_query("requests=" + json.dumps(paths))["requests"]
    assert redact_query(f"invite={token}&code={token}") == {"invite": "<redacted>", "code": "<redacted>"}
    assert token not in scrub_text(f"Failed to open /i/{token}", 200)


def test_short_invite_fields_canonical_urls_and_validation_inputs_are_redacted():
    token = "qzvx"
    value = {
        "match": {"id": "ordinary-match-id", "game_id": "ordinary-game-id", "invite_code": token},
        "url": f"https://example.invalid/invite/{token}?lang=fr",
        "legacy_url": f"https://example.invalid/portal#invite={token}",
        "query_url": f"https://example.invalid/portal?invite_code={token}&lang=fr",
        "validation": {"loc": ["body", "invite_code"], "input": token, "msg": "invalid invite"},
    }
    assert redact(value) == {
        "match": {"id": "ordinary-match-id", "game_id": "ordinary-game-id", "invite_code": "<redacted>"},
        "url": "https://example.invalid/invite/<redacted>?lang=fr",
        "legacy_url": "https://example.invalid/portal#invite=<redacted>",
        "query_url": "https://example.invalid/portal?invite_code=<redacted>&lang=fr",
        "validation": {"loc": ["body", "invite_code"], "input": "<redacted>", "msg": "invalid invite"},
    }
    paths = [f"/invite/{token}", {"path": f"/invites/{token}"}, "/matches/ordinary-match-id"]
    assert token not in redact_query("requests=" + json.dumps(paths))["requests"]
    assert redact_query(f"invite_code={token}&game_id=ordinary-game-id") == {
        "invite_code": "<redacted>", "game_id": "ordinary-game-id",
    }
    ordinary = {"game_id": "game", "match_id": "move", "name": "A game with four turns"}
    assert redact(ordinary) == ordinary
