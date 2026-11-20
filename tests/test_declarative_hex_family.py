"""Rule-specific checks for the declarative hex-board game packages."""
import json
import re
from pathlib import Path

from game_platform.agent_import import GameImport
from game_platform.game_logic import GameLogic

PACKAGES = Path(__file__).resolve().parents[1] / "games" / "declarative"


def package(kind):
    return GameImport.model_validate(json.loads((PACKAGES / f"{kind}.json").read_text()))


def constants(source, name):
    match = re.search(rf"const {name}=(.*?);\n", source)
    assert match, name
    return json.loads(match.group(1))


def context(count):
    return {"players": [{"id": f"p{i}", "kind": "human", "display_name": f"P{i+1}",
                         "picture_url": "", "max_loss": 0, "active": True} for i in range(count)],
            "pot": 0, "move_count": 0}


def test_chinese_checkers_has_full_star_and_supports_a_chain_hop():
    body = package("chinese_checkers")
    cells = constants(body.server_code, "HEX_CELLS")
    camps = constants(body.server_code, "HEX_CAMP_IDS")
    index = constants(body.server_code, "HEX_INDEX")
    assert len(cells) == 121 and [len(camp) for camp in camps] == [10] * 6
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = context(2)
    result = logic.call("newMatch", ctx=ctx, seed=1)
    state = result["state"]
    state["board"] = [-1] * 121
    start, middle1, landing1, middle2, landing2 = [index[f"{q},{r}"] for q, r in [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0)]]
    state["board"][start] = 0
    state["board"][middle1] = 1
    state["board"][middle2] = 1
    view = logic.call("viewFor", state, "p0", ctx=ctx, seed=2)
    move = {"from": start, "to": landing2}
    assert move in view["legal"]
    moved = logic.call("applyMove", state, "p0", move, ctx=ctx, seed=3)["state"]
    assert moved["board"][landing2] == 0 and moved["board"][start] == -1


def test_abalone_pushes_a_smaller_group_off_the_edge():
    body = package("abalone")
    index = constants(body.server_code, "HEX_INDEX")
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = context(2)
    state = logic.call("newMatch", ctx=ctx, seed=1)["state"]
    state["board"] = [-1] * 61
    a, b, opponent = [index[f"{q},{r}"] for q, r in [(2, 0), (3, 0), (4, 0)]]
    state["board"][a] = state["board"][b] = 0
    state["board"][opponent] = 1
    move = {"from": [a, b], "to": [b, opponent], "dir": 0}
    view = logic.call("viewFor", state, "p0", ctx=ctx, seed=2)
    assert move in view["legal"]
    result = logic.call("applyMove", state, "p0", move, ctx=ctx, seed=3)["state"]
    assert result["ejected"] == [1, 0]
    assert result["board"][opponent] == 0
    assert result["board"].count(1) == 0


def test_havannah_detects_a_closed_ring():
    body = package("havannah")
    index = constants(body.server_code, "HEX_INDEX")
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ctx = context(2)
    state = logic.call("newMatch", ctx=ctx, seed=1)["state"]
    state["board"] = [-1] * 61
    ring = [index[f"{q},{r}"] for q, r in [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]]
    for cell in ring[:-1]:
        state["board"][cell] = 0
    result = logic.call("applyMove", state, "p0", {"cell": ring[-1]}, ctx=ctx, seed=2)
    assert result["turn"] is None
    assert result["state"]["winner"] == 0
