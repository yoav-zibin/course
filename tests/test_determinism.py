"""Declarative matches replay deterministically, including secret random state."""
from game_platform.tests.helpers import legacy_computer_match

import json
import random
from pathlib import Path
import pytest
from game_platform.agent_import import GameImport
from game_platform.service import GamePlatform
from game_platform.tests.helpers import Api


def play(kind):
    ids = iter(["owner", "game", "match"])
    platform = GamePlatform(new_id=lambda: next(ids), new_seed=lambda: 0x5EED, computer_move_delay_seconds=0)
    choices = random.Random(0)
    body = GameImport.model_validate_json((Path(__file__).parents[1] / "games/declarative" / f"{kind}.json").read_text())
    owner = platform.create_user(display_name="owner")
    game = platform.create_game( name=body.name, description=body.description,
        rules=body.game_rules(), code=body.client_code, server_code=body.server_code,
        game_schemas=body.game_schemas(), import_package={"declarative_ui":body.declarative_ui})
    match = platform.create_match(caller_id=owner.id, game_id=game.id)
    match = legacy_computer_match(platform, match, 1)
    platform.start_match(caller_id=owner.id, match_id=match.id)
    snapshots=[]
    for _ in range(500):
        current=platform._store.get_match(match.id)
        snapshots.append((len(current.moves), current.state))
        if current.status == "over": return snapshots
        view=platform.view_state(current,owner.id)
        platform.make_move(caller_id=owner.id,match_id=match.id,expected_move_count=None,move=choices.choice(view['legal']))
    raise AssertionError("match did not finish")


@pytest.mark.parametrize("kind", ["tictactoe", "memory"])
def test_a_match_replays_move_for_move_to_the_same_state(kind):
    first,second=play(kind),play(kind)
    assert len(first)>2
    assert first==second


def test_failed_seeds_are_replayed_first_on_the_next_run(api: Api) -> None:
    owner = api.new_user("owner")
    game = api.create_game(
        {
            "name": "Crashy",
            "allowed_player_counts": [2],
            "code": "<div>crashy</div>",
            "server_code": "const game = { newMatch(ctx) { return {state: {count: 0}, turn: [ctx.players[0].id]}; }, applyMove(state, playerId, move, ctx) { return {state, turn: null}; }, viewFor(state, playerId, ctx) { return state; } };",
        },
        owner,
    )
    broken = """
    const game = {
      newMatch(ctx) { return {state: {count: 0}, turn: [ctx.players[0].id]}; },
      applyMove(state, playerId, move, ctx) { throw new Error("kaboom"); },
      computerMove(state, playerId, ctx) { return {}; },
      randomMove(state, playerId, ctx) { return {}; },
      viewFor(state, playerId, ctx) { return state; },
    };
    """
    rules = api.platform._store.get_game(game["id"]).rules
    schemas = {"state": True, "move": True, "view": True}
    first = api.platform._run_game_tests(
        server_code=broken, game_schemas=schemas, rules=rules, game_id=game["id"]
    )
    assert first.passed is False
    assert first.failures
    stored = api.platform._store.get_game_test_seeds(game["id"])
    assert stored is not None
    assert stored.seeds[0] == first.failures[0].seed
    # The next run replays the stored seeds first: its first failure is
    # the same walk failing the same way.
    second = api.platform._run_game_tests(
        server_code=broken, game_schemas=schemas, rules=rules, game_id=game["id"]
    )
    assert second.failures[0].seed == stored.seeds[0]
    assert second.failures[0].message == first.failures[0].message
