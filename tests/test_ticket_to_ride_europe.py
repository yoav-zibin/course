"""The route claim controls must agree with authoritative card payments."""

from pathlib import Path

import pytest

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_logic import GameLogic
from game_platform.tools.publish_declarative_games import offered_events, ui_message


PACKAGE = Path(__file__).resolve().parents[1] / "games/declarative/ticket_to_ride_europe.json"


@pytest.mark.parametrize("player_count", [2, 3, 4])
def test_route_options_follow_card_and_train_costs(player_count):
    body = GameImport.model_validate_json(PACKAGE.read_text())
    logic = GameLogic(body.server_code, game_schemas=body.game_schemas())
    ui = DeclarativeLogic(body.declarative_ui)
    ctx = {
        "players": [
            {"id": f"seat-{i}", "kind": "human", "display_name": f"Seat {i + 1}",
             "picture_url": "", "max_loss": 0}
            for i in range(player_count)
        ],
        "pot": 0,
        "move_count": 0,
    }
    opened = logic.call("newMatch", ctx=ctx, seed=101)
    mover = opened["turn"][0]
    seat = next(i for i, player in enumerate(ctx["players"]) if player["id"] == mover)

    def position(hand):
        opened["state"]["hands"][seat] = hand
        return ui_message(logic, opened, ctx, seat, 101)

    def actions(frame):
        return {event["id"] for event in offered_events(frame["scene"])}

    def tap(message, frame, key):
        event = {"type": "tap", "id": key}
        return ui.reduce({"type": "ui_event", "event": event, "state_changed": message},
                         frame["local_state"])

    def verify_claim(message, frame, expected):
        assert "claim" in actions(frame)
        claim = tap(message, frame, "claim")["make_move"]
        assert claim == expected
        accepted = logic.call("applyMove", opened["state"], mover, claim, ctx=ctx, seed=101)
        assert accepted["state"]["claimed"][claim["route"]] == seat

    message = position([1, 8])
    frame = ui.reduce(message)
    assert "route_10" not in actions(frame)
    assert "make_move" not in tap(message, tap(message, frame, "route_10"), "claim")
    verify_claim(message, tap(message, frame, "route_0"), {"action": "claim", "route": 0, "color": 1})

    grey = tap(message, frame, "route_12")
    assert {key for key in actions(grey) if key.startswith("color_")} == {"color_1"}
    assert "claim" not in actions(tap(message, grey, "color_5"))
    verify_claim(message, tap(message, grey, "color_1"), {"action": "claim", "route": 12, "color": 1})

    message = position([3, 3, 3, 8])
    assert "route_11" not in actions(ui.reduce(message))
    message = position([3, 3, 3, 8, 5])
    tunnel = tap(message, ui.reduce(message), "route_11")
    assert {key for key in actions(tunnel) if key.startswith("extra_")} == {"extra_5"}
    assert "claim" not in actions(tap(message, tunnel, "extra_8"))
    verify_claim(message, tap(message, tunnel, "extra_5"),
                 {"action": "claim", "route": 11, "color": 3, "extra": 5})

    opened["state"]["trains"][seat] = 1
    message = position([1, 1, 1, 1])
    assert not any(key.startswith("route_") for key in actions(ui.reduce(message)))
