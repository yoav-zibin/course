"""Reviewed release tooling exercises the public authoring protocol only."""

import io
import json
import stat
import urllib.error

import pytest

from game_platform.agent_import import GameImport
from game_platform.game_contract import ContractLogic
from game_platform.game_traces import replay_match
from game_platform.tools import publish_declarative_games as release


@pytest.mark.parametrize("kind", release.DEMO_KINDS)
def test_every_packaged_ui_trace_agrees_with_authoring_replay(kind):
    body = GameImport.model_validate(json.loads((release.PACKAGES / f"{kind}.json").read_text()))
    index = release.DEMO_KINDS.index(kind) % 5
    mode, human_seat = [("pass_and_play", None), ("multiplayer", None),
                        ("against_computers", 0), ("against_computers", 1),
                        ("multiplayer", None)][index]
    trace, observations = release.play_trace(body, seed=903 + index, mode=mode, human_seat=human_seat)
    assert trace["moves"] and len(observations) == len(trace["moves"])
    assert len(trace["states"]) == len(trace["moves"]) + 1
    initial = ContractLogic(body.server_code, body.unit_tests).call(
        "newMatch", ctx={"players": trace["players"], "pot": 0, "move_count": 0}, seed=trace["match_seed"])
    assert initial["state"] == trace["states"][0]
    verified, failure = replay_match(body, **trace, strict_single_turn=mode != "multiplayer")
    assert verified, failure
    if human_seat is not None:
        assert trace["players"][human_seat]["kind"] == "human"
        assert any(row["player_index"] == human_seat for row in observations)


def test_private_state_is_atomic_and_mode_0600(tmp_path, monkeypatch):
    path = tmp_path / "private-state.json"
    release.save_private(path, {"secret": "first"})
    assert stat.S_IMODE(path.stat().st_mode) == 0o600

    def interrupted(data, stream, **kwargs):
        stream.write('{"partially_written":')
        raise OSError("interrupted write")

    monkeypatch.setattr(release.json, "dump", interrupted)
    with pytest.raises(OSError, match="interrupted"):
        release.save_private(path, {"secret": "replacement"})
    assert json.loads(path.read_text()) == {"secret": "first"}
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize("in_query", [False, True])
def test_publication_http_errors_redact_private_secrets(monkeypatch, in_query):
    secret = "private-release-secret-0123456789"
    path = "/game-test/status?secret=" + secret if in_query else "/games/declarative"
    body = None if in_query else {"game_addition_request_id_and_secret": secret}

    def failure(request, **kwargs):
        raise urllib.error.HTTPError(request.full_url, 422, "rejected", {}, io.BytesIO(secret.encode()))

    monkeypatch.setattr(release.urllib.request, "urlopen", failure)
    with pytest.raises(RuntimeError) as error:
        release.request("https://example.test", path, body)
    assert secret not in str(error.value)
    assert "private secret" in str(error.value)


def test_resume_checks_actual_published_source_and_skips_unchanged_import(tmp_path, monkeypatch):
    calls = []
    tested_body = None
    game = {"id": "published-game", "version": 1, "name": "Tic-tac-toe (Declarative)",
            "renderer_type": "declarative", "server_code": "reviewed rules"}

    def request(base, path, body=None):
        nonlocal tested_body
        calls.append((path, body))
        if path == "/game-test/submissions":
            # Simulate step 1 on a server with the prior platform-owned host.
            from game_platform.declarative_ui import _client_document
            tested_body = GameImport.model_validate(body["body"]).model_dump()
            tested_body["client_code"] = _client_document(tested_body["declarative_ui"], asset_query="?v=2")
            return {"submission_id": "submission"}
        if path.startswith("/game-test/submission?"):
            return {"submission_id": "submission", "body": tested_body}
        if path == "/game-test/server-check":
            return {"passed": True}
        if path == "/game-test/verify-match":
            return {"verified": True}
        if path == "/game-test/moves":
            return {"md5": "verified observation"}
        if path.startswith("/game-test/status?"):
            return {"steps": {"complete": True}}
        if path in ("/games/declarative", "/games/published-game"):
            if path == "/games/declarative":
                assert body["client_code"] == tested_body["client_code"]
            return dict(game)
        raise AssertionError(path)

    monkeypatch.setattr(release, "request", request)
    path = tmp_path / "private-state.json"
    first = release.publish("https://example.test", path, ["tictactoe"])
    assert sum(route == "/game-test/verify-match" for route, _ in calls) == 5
    assert sum(route == "/game-test/moves" for route, _ in calls) == 2
    calls.clear()
    again = release.publish("https://example.test", path, ["tictactoe"])
    assert again == first
    assert calls == [("/games/published-game", None)]
    # A changed remote record cannot be skipped merely because the local
    # private file says it was once published. The existing import secret
    # restores the reviewed package through the ordinary publication API.
    game["server_code"] = "different rules"
    calls.clear()
    release.publish("https://example.test", path, ["tictactoe"])
    assert any(route == "/games/declarative" for route, _ in calls)
