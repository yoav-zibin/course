"""Security boundaries exercised through the public API, with isolated data."""
from unittest.mock import patch

import pytest

from game_platform.tests.test_server_matches import COUNTER_GAME, _create_game, _start


def test_history_redacts_private_move_payloads(api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = _create_game(api, alice)
    match = _start(api, alice, game, joiner=bob)
    payload = {"add": 1, "sealed_bid": "private-card-choice"}
    api.ok("POST", f"/matches/{match}/moves", as_user=alice, json={"move": payload})
    for caller in [alice, bob, None]:
        for suffix in ["moves", "history"]:
            result = api.ok("GET", f"/matches/{match}/{suffix}", as_user=caller)
            items = result if suffix == "moves" else result["moves"]
            assert items[0]["move"] == (payload if caller == alice else None)
            assert "secrets" not in items[0]["new_state"]
        if getattr(api.platform._store, "scalable", False):
            result = api.ok("GET", f"/v2/matches/{match}/history", as_user=caller)
            assert result["items"][0]["move"] == (payload if caller == alice else None)


def test_views_cannot_reveal_the_next_gameplay_random_stream(api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    code = COUNTER_GAME.replace("count: 0, secrets: secrets", "count: 0, roll: ctx.random(), secrets: secrets")
    code = code.replace("count: count, secrets: state.secrets", "count: count, roll: ctx.random(), secrets: state.secrets")
    code = code.replace("count: state.count, your_secret:", "count: state.count, noise: ctx.random(), roll: state.roll, your_secret:")
    game = _create_game(api, alice, code)
    match = _start(api, alice, game, joiner=bob)
    before = api.ok("GET", f"/matches/{match}", as_user=alice)
    spectator = api.ok("GET", f"/matches/{match}")
    assert before["state"]["noise"] != before["state"]["roll"]
    assert before["state"]["noise"] != spectator["state"]["noise"]
    after = api.ok("POST", f"/matches/{match}/moves", as_user=alice, json={"move": {"add": 1}})
    assert after["state"]["roll"] != before["state"]["roll"]
    assert before["state"]["noise"] != after["state"]["roll"]
    history = api.ok("GET", f"/matches/{match}/history", as_user=alice)
    assert history["initial_state"]["noise"] == before["state"]["noise"]
    assert not {"seed", "seed_version", "initial_state", "pending_leave"} & before.keys()


def test_runtime_game_errors_do_not_echo_private_state(api):
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = _create_game(api, alice)
    match = _start(api, alice, game, joiner=bob)
    from game_platform.game_logic import GameLogicError
    platform = api.platform
    with patch.object(platform._logic_for(platform._store.get_game(game)), "call", side_effect=GameLogicError("hidden-hand-and-seed")):
        response = api.request("POST", f"/matches/{match}/moves", as_user=alice, json={"move": {"add": 1}})
    assert response.status_code == 500
    assert "hidden-hand-and-seed" not in response.text


@pytest.mark.parametrize("phase", ["start", "join"])
def test_game_lifecycle_payouts_are_applied_exactly_once(api, phase):
    alice, bob, carol = [api.new_user(n) for n in ["alice", "bob", "carol"]]
    code = COUNTER_GAME
    if phase == "start":
        code = code.replace('turn: [ctx.players[0].id]', 'turn: null, payouts: {[ctx.players[0].id]: ctx.pot}')
    else:
        code = code.replace('const game = {', 'const game = { playerJoined(state, id, ctx) { return {state, turn:null, payouts:{[ctx.players[0].id]:ctx.pot}}; },')
    game = api.create_game({"name":"settlement", "code":"<div></div>", "server_code":code,
        "allowed_player_counts":[2,3], "allows_join_mid_match":True}, alice)["id"]
    match = api.ok("POST", "/matches", as_user=alice, json={"game_id":game, "bet_per_player":2})["id"]
    api.ok("POST", f"/matches/{match}/join", as_user=bob)
    result = api.ok("POST", f"/matches/{match}/start", as_user=alice)
    if phase == "join": result = api.ok("POST", f"/matches/{match}/join", as_user=carol)
    assert result["status"] == "over"
    assert result["token_pot"] == 0
    assert result["token_payouts"] == {"0": 4 if phase == "start" else 6}
    balance = api.platform.get_user(alice).token_balance
    assert api.request("POST", f"/matches/{match}/start", as_user=alice).status_code == 409
    assert api.request("POST", f"/matches/{match}/join", as_user=carol).status_code == 409
    assert api.platform.get_user(alice).token_balance == balance


def test_non_loopback_debug_server_requires_a_master_password(tmp_path):
    import json
    from game_platform import main
    path = tmp_path / "config.json"
    path.write_text(json.dumps({"server":{"host":"0.0.0.0"}}))
    with patch("sys.argv", ["server", "--config", str(path)]), pytest.raises(ValueError, match="master_password"):
        main.main()

@pytest.mark.parametrize("endpoint", [
    "http://localhost:8000/admin/users", "https://127.0.0.1/push",
    "https://169.254.169.254/computeMetadata/v1", "https://push.example.com/",
    "https://fcm.googleapis.com.attacker.example/", "https://fcm.googleapis.com:8443/",
    "https://attacker@fcm.googleapis.com/", "https://fcm.googleapis.com/#secret",
])
def test_real_push_rejects_arbitrary_endpoints(endpoint):
    from game_platform.push import validate_push_endpoint
    with pytest.raises(ValueError): validate_push_endpoint(endpoint)


@pytest.mark.parametrize("endpoint", [
    "https://fcm.googleapis.com/fcm/send/token",
    "https://updates.push.services.mozilla.com/wpush/v2/token",
    "https://web.push.apple.com/token", "https://bn1.notify.windows.com/token",
])
def test_real_push_accepts_browser_services(endpoint):
    from game_platform.push import validate_push_endpoint
    validate_push_endpoint(endpoint)


def test_push_http_transport_never_follows_redirects():
    import requests
    from game_platform.push import _PushSession
    with _PushSession() as session, patch.object(requests.Session, "post") as post:
        session.post("https://fcm.googleapis.com/fcm/send/token", allow_redirects=True, timeout=30)
        assert post.call_args.kwargs["allow_redirects"] is False


def test_real_push_api_rejects_local_endpoint(api):
    from game_platform.config import PushConfig
    from game_platform.push import generate_vapid_keys
    from game_platform.tests.test_push import _body
    key, _ = generate_vapid_keys()
    api.client.app.state.push_config = PushConfig(provider="webpush", vapid_private_key=key, vapid_subject="mailto:test@example.com")
    user = api.new_user("push-user")
    assert api.request("POST", "/push/subscriptions", as_user=user, json=_body("https://127.0.0.1/internal")).status_code == 422

@pytest.mark.parametrize("keyword", ["$ref", "$dynamicRef", "$recursiveRef"])
@pytest.mark.parametrize("target", ["https://127.0.0.1/internal", "file:///etc/passwd"])
def test_game_schemas_never_retrieve_remote_resources(keyword, target):
    from game_platform.game_schemas import compile_game_schemas
    with patch("urllib.request.urlopen", side_effect=AssertionError("network forbidden")), pytest.raises(ValueError, match="local fragment"):
        compile_game_schemas({"state":{"$defs":{"hidden":{keyword:target}}}, "move":True, "view":True})


def test_local_game_schema_references_still_work():
    from game_platform.game_schemas import compile_game_schemas
    schema = {"$defs":{"cell":{"type":"integer"}}, "$ref":"#/$defs/cell"}
    validator = compile_game_schemas({"state":schema, "move":True, "view":True})["state"]
    assert validator.is_valid(3)
    assert not validator.is_valid("hidden")

@pytest.mark.parametrize("path", ["/game-test/server-check", "/game-test/verify-match"])
def test_expensive_test_endpoints_share_the_import_concurrency_budget(api, path):
    slots = api.client.app.state.import_slots
    assert slots.acquire(blocking=False)
    assert slots.acquire(blocking=False)
    try:
        response = api.request("POST", path, json={"secret":"isolated-test-secret", "submission_id":"test"})
        assert response.status_code == 429
        assert response.headers["Retry-After"] == "15"
    finally:
        slots.release()
        slots.release()


def test_paginated_history_prefix_does_not_fetch_earlier_moves():
    from game_platform.move_history import MoveHistory, history_prefix
    reads = []
    history = MoveHistory(1_000_000, lambda a, b: reads.append((a, b)) or [None] * (b-a))
    prefix = history_prefix(history, 900_001)
    assert len(prefix) == 900_001
    assert reads == []
    assert prefix[-1] is None
    assert reads == [(900_000, 900_001)]


def test_live_match_summary_does_not_reveal_a_hidden_result(api):
    from dataclasses import replace
    from game_platform.schemas import MatchSummaryOut
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game = _create_game(api, alice)
    match_id = _start(api, alice, game, joiner=bob)
    stored = api.platform._store.get_match(match_id)
    hidden = replace(stored, state={**stored.state, "winner": 1, "done": True})
    assert MatchSummaryOut.of(hidden).result is None


def test_online_random_stream_matches_the_chacha20_standard_vector():
    from game_platform.tests.helpers import UnrestrictedGameLogic
    logic = UnrestrictedGameLogic('const game={viewFor(state,id,ctx){return Array.from({length:16},()=>ctx.random()*4294967296);}};')
    # RFC 8439 Appendix A.1: zero key, counter zero, zero nonce.
    expected = bytes.fromhex(
        '76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7'
        'da41597c5157488d7724e03fb8d84a376a43b8f41518a11cc387b669b2ee6586')
    words = logic.call('viewFor', {}, None, ctx={'players':[{'id':'p','kind':'human','max_loss':0}], 'pot':0, 'move_count':0}, seed='00'*32)
    assert b''.join(int(x).to_bytes(4,'little') for x in words) == expected


def test_online_random_stream_uses_high_seed_bits():
    from game_platform.tests.helpers import UnrestrictedGameLogic
    logic = UnrestrictedGameLogic('const game={viewFor(state,id,ctx){return ctx.random();}};')
    first = logic.call('viewFor', {}, None, ctx={'players':[{'id':'p','kind':'human','max_loss':0}], 'pot':0, 'move_count':0}, seed=(1 << 128) + 123)
    second = logic.call('viewFor', {}, None, ctx={'players':[{'id':'p','kind':'human','max_loss':0}], 'pot':0, 'move_count':0}, seed=(2 << 128) + 123)
    assert first != second
    assert first == logic.call('viewFor', {}, None, ctx={'players':[{'id':'p','kind':'human','max_loss':0}], 'pot':0, 'move_count':0}, seed=(1 << 128) + 123)


def test_online_random_stream_matches_cryptography_across_blocks():
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms
    from game_platform.tests.helpers import UnrestrictedGameLogic
    key = bytes(range(32))
    expected = Cipher(algorithms.ChaCha20(key, b'\0'*16), mode=None).encryptor().update(b'\0'*256)
    logic = UnrestrictedGameLogic('const game={viewFor(state,id,ctx){return Array.from({length:64},()=>ctx.random()*4294967296);}};')
    words = logic.call('viewFor', {}, None, ctx={'players':[], 'pot':0, 'move_count':0}, seed=key.hex())
    assert b''.join(int(x).to_bytes(4,'little') for x in words) == expected


def test_portal_canonicalizes_before_rendering_and_preserves_query(api):
    response = api.client.get('/portal?skin=classic&game=example', follow_redirects=False)
    assert response.status_code == 307
    assert response.headers['location'] == '/static/portal.html?skin=classic&game=example'
