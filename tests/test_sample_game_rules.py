"""Rules regressions in the standalone sample game sources."""
from pathlib import Path

import pytest

from game_platform.game_logic import GameLogic, InvalidMoveError


def smugglers():
    source = Path(__file__).resolve().parents[1] / "frontends/ios-game-builder-marcelle/sample-games/smugglers-tide/server.js"
    logic = GameLogic(source.read_text(), game_schemas={"state": True, "move": True, "view": True})
    ctx = {"players": [{"id": "a", "kind": "human"}, {"id": "b", "kind": "human"}],
           "pot": 0, "move_count": 0}
    return logic, ctx


@pytest.mark.parametrize("seed", [1, 7, 42])
def test_smugglers_cannot_pass_and_draw_when_exactly_one_move_is_available(seed):
    logic, ctx = smugglers()
    state = logic.call("newMatch", ctx=ctx, seed=seed)["state"]
    # A possible initial deal: six copies of one symbol. Swapping from the
    # stock preserves every card count while leaving one distinct action.
    symbol = state["hands"][0][0]
    for index, card in enumerate(state["hands"][0]):
        if card != symbol:
            position = state["deck"].index(symbol)
            state["deck"][position] = card
            state["hands"][0][index] = symbol
    legal = logic.call("viewFor", state, "a", ctx=ctx, seed=seed)["moves"]
    assert len(legal) == 1 and legal[0]["kind"] == "forward"
    with pytest.raises(InvalidMoveError, match="make at least one move"):
        logic.call("applyMove", state, "a", {"kind": "end"}, ctx=ctx, seed=seed)


def test_smugglers_can_pass_when_stuck_and_can_end_after_a_move():
    logic, ctx = smugglers()
    state = logic.call("newMatch", ctx=ctx, seed=7)["state"]
    state["deck"].extend(state["hands"][0])
    state["hands"][0] = []
    passed = logic.call("applyMove", state, "a", {"kind": "end"}, ctx=ctx, seed=7)
    assert passed["turn"] == ["b"]
    assert len(passed["state"]["hands"][0]) == 1
    state["actions"] = 1
    ended = logic.call("applyMove", state, "a", {"kind": "end"}, ctx=ctx, seed=7)
    assert ended["turn"] == ["b"]
    assert ended["state"]["hands"][0] == []
