"""Private shuffles and views for the November20 incremental game audit."""
import copy
import json
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_logic import GameLogic
from game_platform.tools.publish_declarative_games import scene_event

PACKAGES = Path(__file__).resolve().parents[1] / "games/declarative"
PRIVATE_SHUFFLES = ("big_two", "catch_the_ten", "conquian", "court_piece", "mille_bornes",
                    "pedro", "sergeant_major", "slapjack", "snap", "mau_mau", "dos", "thirty_one", "card-table/war")


def runtime(kind):
    payload = json.loads((PACKAGES / (kind + ".json")).read_text())
    payload["game_addition_request_id_and_secret"] = "security-audit-disposable-test-secret"
    body = GameImport.model_validate(payload)
    ctx = {"players": [{"id": f"public-seat-{i}", "kind": "human", "active": True,
                         "display_name": f"Seat {i}", "picture_url": "", "max_loss": 100}
                        for i in range(min(body.allowed_player_counts))],
           "pot": 100 * min(body.allowed_player_counts), "move_count": 0}
    return body, GameLogic(body.server_code, game_schemas=body.game_schemas()), ctx


@pytest.mark.parametrize("kind", PRIVATE_SHUFFLES)
def test_hidden_deals_depend_on_private_randomness_and_replay_with_the_same_seed(kind):
    _, logic, ctx = runtime(kind)
    first = logic.call("newMatch", ctx=ctx, seed="11" * 32)
    second = logic.call("newMatch", ctx=ctx, seed="22" * 32)
    assert first == logic.call("newMatch", ctx=ctx, seed="11" * 32)
    assert first["state"] != second["state"], "public roster and pot must not determine the deal"
    for viewer in [None, *(p["id"] for p in ctx["players"])]:
        view = logic.call("viewFor", first["state"], viewer, ctx=ctx, seed="33" * 32)
        assert not {"seed", "stock", "deck", "decks"} & view.keys()


def test_cartographers_does_not_disclose_future_exploration_cards():
    body, logic, ctx = runtime("cartographers")
    state = logic.call("newMatch", ctx=ctx, seed=41)["state"]
    alternate = copy.deepcopy(state)
    alternate["deck"][1:] = reversed(alternate["deck"][1:])
    assert alternate["deck"] != state["deck"]
    assert body.all_state_public is False
    for viewer in [None, *(p["id"] for p in ctx["players"])]:
        before = logic.call("viewFor", state, viewer, ctx=ctx, seed=42)
        assert before == logic.call("viewFor", alternate, viewer, ctx=ctx, seed=42)
        assert before["deck"][0] == state["deck"][0]


def test_golf_recycled_stock_cannot_be_identified_using_previously_public_card_ids():
    _, logic, ctx = runtime("card-table/six-card-golf")
    state = logic.call("newMatch", ctx=ctx, seed=51)["state"]
    # A consistent deck state after all stock cards have been publicly discarded.
    state["discard"] = state["stock"] + state["discard"]
    state["stock"] = []
    state["phase"] = "play"
    state["turn"] = 0
    for hand in state["hands"]:
        hand[0]["up"] = hand[1]["up"] = True
    known = {card["uid"]: (card["r"], card["s"]) for card in state["discard"]}
    result = logic.call("applyMove", state, ctx["players"][0]["id"],
                        {"kind": "draw", "from": "stock"}, ctx=ctx, seed=52)
    alternate = logic.call("applyMove", state, ctx["players"][0]["id"],
                           {"kind": "draw", "from": "stock"}, ctx=ctx, seed=53)
    assert result["state"]["stock"] != alternate["state"]["stock"]
    for viewer in [None, *(p["id"] for p in ctx["players"])]:
        view = logic.call("viewFor", result["state"], viewer, ctx=ctx, seed=53)
        assert view["stockTopUid"] not in known
        assert view["drew"]["uid"] not in known
        if viewer != ctx["players"][0]["id"]:
            assert view["drew"]["hidden"] is True
            assert view["drew"]["r"] == view["drew"]["s"] == 0
            assert view == logic.call("viewFor", alternate["state"], viewer, ctx=ctx, seed=53)


@pytest.mark.parametrize("kind", ["catch_the_ten", "pedro"])
def test_later_deals_also_use_fresh_private_randomness(kind):
    _, logic, ctx = runtime(kind)
    state = logic.call("newMatch", ctx=ctx, seed=61)["state"]
    state.update(hands=[[], [], [], [9]], seat=3,
                 trick=[{"seat": i, "card": i + 6} for i in range(3)],
                 round=0, dealer=3, trump=0)
    if kind == "catch_the_ten":
        state["scores"] = [0, 0]
    else:
        state.update(stock=[], phase=2, bidder=0, bid=7, bids=4,
                     captured=[0, 0], totals=[0, 0])
    ctx["move_count"] = 40
    first = logic.call("applyMove", state, ctx["players"][3]["id"], {"card": 9}, ctx=ctx, seed="41" * 32)
    second = logic.call("applyMove", state, ctx["players"][3]["id"], {"card": 9}, ctx=ctx, seed="42" * 32)
    assert first["state"]["round"] == second["state"]["round"] == 1
    assert first["state"]["hands"] != second["state"]["hands"]
    assert "seed" not in first["state"]


@pytest.mark.parametrize("kind", ["mau_mau", "dos"])
def test_recycled_deck_is_not_derived_from_public_discard_or_move_counts(kind):
    _, logic, ctx = runtime(kind)
    state = logic.call("newMatch", ctx=ctx, seed=71)["state"]
    deck = "stock" if kind == "mau_mau" else "deck"
    state["discard"] = state[deck] + state["discard"]
    state[deck] = []
    ctx["move_count"] = 50
    first = logic.call("applyMove", state, ctx["players"][0]["id"], {"type": "draw"}, ctx=ctx, seed="51" * 32)
    second = logic.call("applyMove", state, ctx["players"][0]["id"], {"type": "draw"}, ctx=ctx, seed="52" * 32)
    if kind == "mau_mau":
        assert first["state"]["reshuffles"] == second["state"]["reshuffles"] == 1
    assert first["state"][deck] != second["state"][deck]


def test_dos_trace_generation_rejects_a_real_reducer_with_nonadvancing_pagination():
    body, _, _ = runtime("dos")
    spec = copy.deepcopy(body.declarative_ui)
    spec["ui_code"] = """const gameUI={reduce(){return {
      scene:{controls:[{id:'dos_hand_next',kind:'button',label:'Next'}]},
      local_state:{handPage:0,centerPage:0}
    }}};"""
    ui = DeclarativeLogic(spec)
    message = {"type": "state_changed", "view": {}, "status": "ongoing",
               "my_player_index": 0, "acting_for_player_index": 0, "move_count": 0}
    with pytest.raises(ValueError, match="pagination did not advance"):
        scene_event(ui, message, ui.reduce(message),
                    {"type": "match", "placements": [{"pile": 0, "cards": [{"i": 15}]}]})
