"""Rule-specific checks for the declarative hex-board game packages."""
import json
import re
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_logic import GameLogic
from game_platform.game_text import server_text_problems

PACKAGES = Path(__file__).resolve().parents[1] / "games" / "declarative"


def package(kind):
    return GameImport.model_validate(json.loads((PACKAGES / f"{kind}.json").read_text()))


def constants(source, name):
    match = re.search(rf"const {name}=(.*?);\n", source)
    assert match, name
    return json.loads(match.group(1))


@pytest.mark.parametrize("kind", ["chinese_checkers", "abalone", "havannah"])
def test_server_output_has_a_localized_template(kind):
    body = package(kind)
    assert server_text_problems(body.declarative_ui["strings"], body.server_code) == []


def context(count):
    return {"players": [{"id": f"p{i}", "kind": "human", "display_name": f"P{i+1}",
                         "picture_url": "", "max_loss": 0, "active": True} for i in range(count)],
            "pot": 0, "move_count": 0}


@pytest.mark.parametrize("kind", ["chinese_checkers", "abalone", "havannah"])
def test_newly_occupied_hex_cells_use_a_stable_host_pulse(kind):
    body = package(kind)
    case = body.unit_tests["cases"][0]
    before, after = case["view_of_mover"], case["expected_view_of_mover"]
    ui = DeclarativeLogic(body.declarative_ui)

    def message(view, move_count):
        return {"type": "state_changed", "state": view, "view": view,
                "status": "ongoing", "my_player_index": 0,
                "acting_for_player_index": 0, "move_count": move_count,
                "strings": body.declarative_ui["strings"]}

    first = ui.reduce(message(before, 0))
    placed = ui.reduce(message(after, 1), first["local_state"])
    added = [cell for cell, value in enumerate(after["board"])
             if value >= 0 and before["board"][cell] == -1]
    assert added
    for cell in added:
        piece = next(piece for piece in placed["scene"]["pieces"]
                     if piece["position"].get("cell") == str(cell))
        assert piece["animation"]["kind"] == "pulse"
        repeated = ui.reduce(message(after, 1), placed["local_state"])
        same_piece = next(item for item in repeated["scene"]["pieces"] if item["id"] == piece["id"])
        assert same_piece["animation"]["key"] == piece["animation"]["key"]


@pytest.mark.parametrize("kind", ["chinese_checkers", "abalone"])
def test_piece_selection_is_kept_until_a_legal_move_is_chosen(kind):
    body = package(kind)
    message = {
        "type": "state_changed", "view": body.unit_tests["cases"][0]["view_of_mover"],
        "status": "ongoing", "my_player_index": 0, "acting_for_player_index": 0,
        "move_count": 0, "strings": body.declarative_ui["strings"],
    }
    ui = DeclarativeLogic(body.declarative_ui)
    move = message["view"]["legal"][0]
    origins = move["from"] if isinstance(move["from"], list) else [move["from"]]
    frame = ui.reduce(message)
    for cell in origins:
        frame = ui.reduce({"type": "ui_event", "event": {"type": "tap", "id": f"piece_{cell}"},
                           "state_changed": message}, frame["local_state"])
    assert frame["local_state"]["selected"] == origins

    move_key = "move_" + "_".join(
        f"{key}_{'.'.join(map(str, value)) if isinstance(value, list) else value}"
        for key, value in move.items())
    assert move_key in {target["id"] for target in frame["scene"]["targets"]}
    result = ui.reduce({"type": "ui_event", "event": {"type": "tap", "id": move_key},
                        "state_changed": message}, frame["local_state"])
    assert result["make_move"] == move


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
