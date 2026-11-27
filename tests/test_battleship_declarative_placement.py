"""Manual setup and sunk-ship rendering for declarative Battleship."""

from pathlib import Path

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_logic import GameLogic


PACKAGE = Path(__file__).resolve().parents[1] / "games" / "declarative" / "battleship.json"
FLEET = [
    {"name": "Carrier", "cells": [[x, 0] for x in range(5)]},
    {"name": "Battleship", "cells": [[x, 2] for x in range(4)]},
    {"name": "Cruiser", "cells": [[x, 4] for x in range(3)]},
    {"name": "Submarine", "cells": [[x, 6] for x in range(3)]},
    {"name": "Destroyer", "cells": [[9, y] for y in range(4, 6)]},
]
OPPONENT_FLEET = [
    {"name": "Carrier", "cells": [[1, y] for y in range(5)]},
    {"name": "Battleship", "cells": [[3, y] for y in range(4)]},
    {"name": "Cruiser", "cells": [[5, y] for y in range(3)]},
    {"name": "Submarine", "cells": [[7, y] for y in range(3)]},
    {"name": "Destroyer", "cells": [[9, y] for y in range(2)]},
]


def game():
    body = GameImport.model_validate_json(PACKAGE.read_text())
    rules = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = {
        "players": [{"id": f"p{i}", "kind": "human", "active": True,
                     "display_name": f"Player {i + 1}", "picture_url": "", "max_loss": 0}
                    for i in range(2)],
        "pot": 0,
        "move_count": 0,
    }
    return body, rules, ui, ctx


def message_for(rules, state, ctx, seat, move_count=0):
    player = ctx["players"][seat]["id"]
    view = rules.call("viewFor", state, player, ctx=ctx, seed=101)
    return {"type": "state_changed", "view": view, "state": view, "status": "ongoing",
            "my_player_index": seat, "acting_for_player_index": seat,
            "move_count": move_count}


def tap(ui, message, frame, event_id):
    return ui.reduce({"type": "ui_event", "event": {"type": "tap", "id": event_id},
                      "state_changed": message}, frame.get("local_state"))


def test_player_can_build_and_submit_a_complete_fleet_with_valid_preview_targets():
    _, rules, ui, ctx = game()
    opened = rules.call("newMatch", ctx=ctx, seed=42)
    message = message_for(rules, opened["state"], ctx, 0)
    frame = ui.reduce(message)

    assert any(control["id"] == "fleet_ship_carrier" for control in frame["scene"]["controls"])
    assert any(control["id"] == "fleet_direction_horizontal" for control in frame["scene"]["controls"])
    assert any(control["id"] == "fleet_direction_vertical" for control in frame["scene"]["controls"])
    assert "fleet_place_0_0" in {target["id"] for target in frame["scene"]["targets"]}

    # Selecting a ship/direction and undoing a partial placement are local UI
    # interactions. Only the completed fleet is sent to the authoritative rules.
    frame = tap(ui, message, frame, "fleet_ship_carrier")
    assert "make_move" not in frame
    frame = tap(ui, message, frame, "fleet_place_0_0")
    assert "make_move" not in frame
    own_ships = [piece for piece in frame["scene"]["pieces"] if piece["board"] == "own" and piece["type"] == "mark_ship"]
    assert len(own_ships) == 5
    assert "fleet_place_1_0" not in {target["id"] for target in frame["scene"]["targets"]}
    frame = tap(ui, message, frame, "fleet_undo")
    assert "make_move" not in frame
    assert not any(piece["board"] == "own" and piece["type"] == "mark_ship"
                   for piece in frame["scene"]["pieces"])

    placements = [
        ("carrier", "fleet_place_0_0"),
        ("battleship", "fleet_place_2_0"),
        ("cruiser", "fleet_place_4_0"),
        ("submarine", "fleet_place_6_0"),
    ]
    for ship, target in placements:
        frame = tap(ui, message, frame, f"fleet_ship_{ship}")
        assert "make_move" not in frame
        assert target in {cell["id"] for cell in frame["scene"]["targets"]}
        frame = tap(ui, message, frame, target)
        assert "make_move" not in frame

    frame = tap(ui, message, frame, "fleet_ship_destroyer")
    frame = tap(ui, message, frame, "fleet_direction_vertical")
    final = tap(ui, message, frame, "fleet_place_4_9")
    assert final["make_move"] == {"type": "place", "ships": FLEET}

    placed = rules.call("applyMove", opened["state"], "p0", final["make_move"], ctx=ctx, seed=43)
    assert placed["state"]["boards"][0]["ready"] is True
    expected_state_fleet = [{**ship, "size": len(ship["cells"])} for ship in FLEET]
    assert placed["state"]["boards"][0]["ships"] == expected_state_fleet
    assert rules.call("viewFor", placed["state"], "p1", ctx=ctx, seed=44)["boards"][0]["ships"] == []


def test_sunk_opponent_ship_renders_every_revealed_segment_without_exposing_other_ships():
    _, rules, ui, ctx = game()
    state = rules.call("newMatch", ctx=ctx, seed=51)["state"]
    first = rules.call("applyMove", state, "p0", {"type": "place", "ships": FLEET}, ctx=ctx, seed=52)
    second = rules.call("applyMove", first["state"], "p1", {"type": "place", "ships": OPPONENT_FLEET},
                        ctx=ctx, seed=53)
    state = second["state"]

    for y in range(5):
        result = rules.call("applyMove", state, "p0", {"type": "fire", "x": 1, "y": y}, ctx=ctx, seed=54 + y)
        state = result["state"]

    own_view = rules.call("viewFor", state, "p0", ctx=ctx, seed=60)
    other_view = rules.call("viewFor", state, "p1", ctx=ctx, seed=61)
    assert [ship["name"] for ship in own_view["boards"][1]["ships"]] == ["Carrier"]
    assert other_view["boards"][0]["ships"] == []

    message = {"type": "state_changed", "view": own_view, "state": own_view,
               "status": "ongoing", "my_player_index": 0,
               "acting_for_player_index": 0, "move_count": 6}
    scene = ui.reduce(message)["scene"]
    revealed = {piece["id"] for piece in scene["pieces"]
                if piece["board"] == "target" and piece["type"] == "mark_revealed_ship"}
    assert revealed == {f"target_{row}_1" for row in range(5)}


def test_random_fleet_remains_available_as_a_server_generated_option():
    _, rules, ui, ctx = game()
    opened = rules.call("newMatch", ctx=ctx, seed=71)
    message = message_for(rules, opened["state"], ctx, 0)
    frame = ui.reduce(message)
    random_button = next(item for item in frame["scene"]["controls"] if item["label"] == "Random fleet")
    result = tap(ui, message, frame, random_button["id"])
    assert result["make_move"] == {"type": "auto_place"}
    placed = rules.call("applyMove", opened["state"], "p0", result["make_move"], ctx=ctx, seed=72)
    ships = placed["state"]["boards"][0]["ships"]
    assert len(ships) == 5
    assert sum(len(ship["cells"]) for ship in ships) == 17
    next_player = rules.call("applyMove", placed["state"], "p1", {"type": "auto_place"}, ctx=ctx, seed=73)
    assert next_player["state"]["boards"][1]["ships"] != ships
    assert rules.call("viewFor", next_player["state"], "p0", ctx=ctx, seed=74)["boards"][1]["ships"] == []
