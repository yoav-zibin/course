"""The shared leave API against all 50 published games read on 2026-11-06.

No production writes or model calls: real published code and schemas run in a
fresh in-memory platform, including Poker's old pinned scalar-payout version.
"""

import datetime as dt
import json
from dataclasses import replace
from pathlib import Path

import pytest

from game_platform.models import Game, GameRules

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "tests/fixtures/leave_contract/catalog.json").read_text(encoding="utf-8"))
NOW = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)


@pytest.mark.parametrize("entry", CATALOG, ids=[g["name"] for g in CATALOG])
@pytest.mark.parametrize("mode", ["direct", "preview", "solo"])
def test_every_published_game_leaves_through_the_shared_api(api, entry, mode):
    count = (min if mode == "direct" else max)(entry["allowed_player_counts"])
    human_count = 1 if mode == "solo" else count
    users = [api.new_user(f"player-{i}") for i in range(human_count)]
    game = Game(
        id=entry["id"], version=entry["version"], name=entry["name"],
        owner_user_id=users[0], description="Published leave regression fixture",
        rules=GameRules(**{k: tuple(entry[k]) if k == "allowed_player_counts" else entry[k]
                           for k in ("allowed_player_counts", "allows_leave_mid_match", "allows_join_mid_match")}),
        code="<div></div>", server_code=(ROOT / entry["server"]).read_text(encoding="utf-8"),
        game_schemas=entry["game_schemas"], created_at=NOW, updated_at=NOW,
    )
    # Seed a published version without rewriting it or re-running its publish gate.
    for version in range(1, game.version + 1):
        api.platform._store.add_game_version(replace(game, version=version))
    # Keep computers idle so the last human can leave even a one-move game.
    api.platform._computer_move_delay_seconds = 3600
    match = api.ok("POST", "/matches", as_user=users[0], json={
        "game_id": game.id, "max_loss": 0 if mode == "solo" else 7,
        "num_computer_opponents": count - human_count,
    })
    mid = match["id"]
    for user in users[1:]:
        api.ok("POST", f"/matches/{mid}/join", as_user=user)
    started = api.ok("POST", f"/matches/{mid}/start", as_user=users[0], json={})
    assert started["status"] == "ongoing"
    original = api.platform._store.get_match(mid)
    total_tokens = original.token_pot + sum(api.platform._store.get_user(u).token_balance for u in users)
    leaver = users[-1]
    if mode == "direct":
        ended = api.ok("POST", f"/matches/{mid}/leave", as_user=leaver)
    else:
        quote = api.ok("POST", f"/matches/{mid}/maybeLeave", as_user=leaver)
        assert quote["pending_leave_ends_match"] is True
        pending = api.platform._store.get_match(mid)
        assert pending.token_pot == original.token_pot
        assert pending.state == original.state and pending.moves == original.moves
        assert all(s.active for s in pending.seats)
        assert sum(pending.pending_leave["payouts"].values()) == original.token_pot
        api.ok("POST", f"/matches/{mid}/maybeLeave", as_user=leaver)
        assert api.platform._store.get_match(mid).pending_leave == pending.pending_leave
        ended = api.ok("POST", f"/matches/{mid}/playerLeft", as_user=leaver)
        assert ended["token_payouts"][str(human_count - 1)] == quote["pending_leave_payout"]
    assert ended["status"] == "over" and ended["end_reason"] == "player_left"
    assert ended["token_pot"] == 0 and ended["turn_of_player_indices"] is None
    assert sum(ended["token_payouts"].values()) == original.token_pot
    saved = api.platform._store.get_match(mid)
    assert saved.seats[human_count - 1].active is False
    assert [(s.player_index, s.kind, s.user_id) for s in saved.seats] == [
        (s.player_index, s.kind, s.user_id) for s in original.seats]
    assert len(saved.moves) == len(original.moves) + 1
    assert saved.moves[-1].move == {"type": "player_left"}
    balances = [api.platform._store.get_user(u).token_balance for u in users]
    assert sum(balances) == total_tokens
    assert api.request("POST", f"/matches/{mid}/leave", as_user=leaver).status_code in (403, 409)
    assert api.request("POST", f"/matches/{mid}/playerLeft", as_user=leaver).status_code in (403, 409)
    assert [api.platform._store.get_user(u).token_balance for u in users] == balances
    assert api.platform._store.get_game_version(game.id, game.version) == game


@pytest.mark.parametrize("old_preview", [False, True])
def test_fallback_quotes_remainder_and_accepts_pre_release_previews(api, old_preview):
    from game_platform.tests.test_server_leaving import NO_PLAYER_LEFT_GAME, _create_game, _paid_match

    alice, bob = api.new_user("alice"), api.new_user("bob")
    mid = _paid_match(api, alice, _create_game(api, alice, NO_PLAYER_LEFT_GAME), bob)
    store = api.platform._store
    # An ongoing move can pay part of the pot, leaving an odd remainder.
    original = store.get_match(mid)
    api.platform._credit_tokens(bob, 1)
    store.put_match(replace(original, token_pot=19, token_payouts={1: 1}))
    quote = api.ok("POST", f"/matches/{mid}/maybeLeave", as_user=alice)
    assert quote["pending_leave_payout"] == 10
    if old_preview:
        # The previous release quoted floor(pot / humans), without full payouts.
        store.put_match(replace(store.get_match(mid), pending_leave={
            "player_id": alice, "payout": 9, "end": True,
        }))
    ended = api.ok("POST", f"/matches/{mid}/playerLeft", as_user=alice)
    assert ended["token_payouts"] == ({"0": 9, "1": 11} if old_preview else {"0": 10, "1": 10})
    assert store.get_match(mid).state == original.state
    assert store.get_match(mid).seats[0].active is False
    assert store.get_match(mid).moves[-1].move == {"type": "player_left"}
