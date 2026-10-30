"""Bounded, replayable HTTP fuzz campaigns; failure messages include seed/step.

No external services or live data: each case owns an isolated in-memory platform.
"""
import random
from dataclasses import asdict
from game_platform.invariants import InvariantRequest, check_invariants

import pytest

from game_platform.tests.helpers import Api
from game_platform.store import InMemoryStore


def persistent(response):
    # server_time is response metadata, not persisted match state.
    return {key: value for key, value in response.items() if key != "server_time"}


def assert_store_valid(store, context):
    data = InvariantRequest.model_validate(dict(
        users=[asdict(u) for u in store.list_users()],
        games=[asdict(g) for g in store.list_all_game_versions()],
        matches=[asdict(m) for m in store.list_all_matches()],
    ))
    report = check_invariants(data)
    assert report.valid, (context, report.model_dump())


@pytest.mark.parametrize("seed", range(8))
def test_seeded_move_history_model(seed: int) -> None:
    rng = random.Random(seed)
    store = InMemoryStore()
    api = Api(store=store)
    users = [api.new_user(f"fuzz-{n}") for n in range(3)]
    game = api.new_game(owner=users[0], allowed_player_counts=[3])
    match = api.new_match(owner=users[0], game_id=game, joiners=users[1:])
    turn = set(rng.sample(range(3), rng.randint(1, 3)))
    api.ok("POST", f"/matches/{match}/start", as_user=users[0],
           json={"first_turn_player_indices": sorted(turn), "initial_state": {"step": -1}})
    expected = []
    for step in range(40):
        mover = rng.randrange(3)
        proposed_turn = sorted(rng.sample(range(3), rng.randint(1, 3)))
        count = len(expected) if rng.random() < .75 else len(expected) + 1
        invalid_turn = rng.random() < .2
        payload = {"new_state": {"seed": seed, "step": step},
                   "next_turn_player_indices": [9] if invalid_turn else proposed_turn,
                   "expected_move_count": count}
        before = api.ok("GET", f"/matches/{match}")
        response = api.request("POST", f"/matches/{match}/moves", as_user=users[mover], json=payload)
        context = f"seed={seed}, step={step}, mover={mover}, payload={payload}"
        assert response.status_code < 500, context
        accepted = mover in turn and count == len(expected) and not invalid_turn
        assert response.is_success == accepted, (context, response.status_code, response.text)
        after = api.ok("GET", f"/matches/{match}")
        if accepted:
            expected.append((mover, payload["new_state"], proposed_turn))
            turn = set(proposed_turn)
            assert after["state"] == payload["new_state"], context
        else:
            assert persistent(after) == persistent(before), context
        assert_store_valid(store, context)
        history = api.ok("GET", f"/matches/{match}/moves")
        assert len(history) == len(expected), context
        for number, (actual, model) in enumerate(zip(history, expected), 1):
            assert (actual["move_number"], actual["player_index"], actual["new_state"],
                    actual["next_turn_player_indices"]) == (number, *model), context
    mover = min(turn)
    api.ok("POST", f"/matches/{match}/moves", as_user=users[mover],
           json={"new_state": {"finished": True}, "next_turn_player_indices": None,
                 "expected_move_count": len(expected)})
    finished = api.ok("GET", f"/matches/{match}")
    assert finished["status"] == "over" and finished["turn_of_player_indices"] is None
    response = api.move(match, as_user=users[mover], next_turn=[0], state={"invalid": True})
    assert response.status_code == 409
    assert persistent(api.ok("GET", f"/matches/{match}")) == persistent(finished)


@pytest.mark.parametrize("seed", range(4))
def test_seeded_merge_chains_flatten_and_preserve_ownership(seed: int) -> None:
    rng = random.Random(seed)
    store = InMemoryStore()
    api = Api(store=store)
    users = [api.new_user(f"merge-{n}") for n in range(6)]
    rng.shuffle(users)
    games = [api.new_game(owner=user) for user in users]
    matches = [api.new_match(owner=user, game_id=game) for user, game in zip(users, games)]
    survivor = users[0]
    replaced = []
    for target in users[1:]:
        api.ok("POST", f"/users/{survivor}/merge", as_user=survivor, json={"into_user_id": target})
        replaced.append(survivor)
        survivor = target
        assert_store_valid(store, f"merge seed={seed}")
        user = api.ok("GET", f"/users/{survivor}")
        assert set(user["replaced_user_ids"]) == set(replaced), f"seed={seed}"
        assert user["replaced_by_user_id"] is None
        for alias in replaced:
            assert api.ok("GET", f"/users/{alias}")["id"] == survivor
            old = store.get_user(alias)
            assert old is not None and old.replaced_by_user_id == survivor, f"seed={seed}"
        for old_game in games[:len(replaced) + 1]:
            assert api.ok("GET", f"/games/{old_game}")["owner_user_id"] == survivor
        for old_match in matches[:len(replaced) + 1]:
            match = api.ok("GET", f"/matches/{old_match}")
            assert match["owner_user_id"] == survivor
            assert match["players"][0]["user_id"] == survivor


@pytest.mark.parametrize("seed", range(4))
def test_seeded_malformed_move_payloads_never_crash_or_mutate(seed: int) -> None:
    rng = random.Random(seed)
    store = InMemoryStore()
    api = Api(store=store)
    owner = api.new_user("owner")
    game = api.new_game(owner=owner, allowed_player_counts=[1])
    match = api.new_match(owner=owner, game_id=game, start=True)
    before = api.ok("GET", f"/matches/{match}")
    bad_turns = [[], [-1], [10], [0, 0], [None], ["not-a-seat"], {}, "bad", [[], 0]]
    for step in range(30):
        payload = {"new_state": {"x": rng.randrange(1000)},
                   "next_turn_player_indices": rng.choice(bad_turns), "expected_move_count": 0}
        response = api.request("POST", f"/matches/{match}/moves", as_user=owner, json=payload)
        assert 400 <= response.status_code < 500, (seed, step, payload, response.text)
        assert persistent(api.ok("GET", f"/matches/{match}")) == persistent(before), (seed, step, payload)
        assert_store_valid(store, (seed, step))
