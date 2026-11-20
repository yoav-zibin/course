"""Security regressions for newly imported declarative rules and native hosts."""

import copy
from pathlib import Path

import pytest

from game_platform.agent_import import GameImport
from game_platform.declarative_ui import DeclarativeLogic
from game_platform.game_logic import GameLogic, InvalidMoveError


DIRECTORY = Path(__file__).resolve().parents[1] / "games/declarative"


def runtime(kind):
    body = GameImport.model_validate_json((DIRECTORY / f"{kind}.json").read_text())
    count = min(body.allowed_player_counts)
    ctx = {"players": [{"id": f"p{i}", "kind": "human", "active": True,
                        "display_name": f"Player {i}", "picture_url": "", "max_loss": 10}
                       for i in range(count)], "pot": 10 * count, "move_count": 0}
    return body, GameLogic(body.server_code, game_schemas=body.game_schemas()), ctx


def test_battleship_random_fleet_is_generated_privately_by_rules_not_the_presentation():
    body, logic, ctx = runtime("battleship")
    opening = logic.call("newMatch", ctx=ctx, seed=42)
    view = logic.call("viewFor", opening["state"], "p0", ctx=ctx, seed=44)
    message = {"type": "state_changed", "state": view, "view": view,
               "status": "ongoing", "my_player_index": 0, "acting_for_player_index": 0,
               "move_count": 0}
    ui = DeclarativeLogic(body.declarative_ui)
    frame = ui.reduce(message)
    control = next(item for item in frame["scene"]["controls"]
                   if item["label"] == "Random fleet")
    emitted = ui.reduce({"type": "ui_event", "event": {"type": "tap", "id": control["id"]},
                         "state_changed": message}, frame.get("local_state"))["make_move"]
    assert emitted == {"type": "auto_place"}
    fleets = []
    for seed in (1, 2):
        placed = logic.call("applyMove", opening["state"], "p0", emitted, ctx=ctx, seed=seed)
        fleets.append(placed["state"]["boards"][0]["ships"])
        assert len(fleets[-1]) == 5
        assert sum(len(ship["cells"]) for ship in fleets[-1]) == 17
        for viewer in ("p1", None):
            hidden = logic.call("viewFor", placed["state"], viewer, ctx=ctx, seed=99)
            assert hidden["boards"][0]["ships"] == []
    assert fleets[0] != fleets[1]
    # Computer setup follows the same seeded generator, without a public fixed fleet.
    first = logic.call("computerMove", opening["state"], "p0", ctx=ctx, seed=1)
    second = logic.call("computerMove", opening["state"], "p0", ctx=ctx, seed=2)
    assert first == second == {"type": "auto_place"}
    assert logic.call("randomMove", opening["state"], "p0", ctx=ctx, seed=3) == first


def test_battleship_exhausted_random_search_still_uses_private_randomness_for_a_valid_fleet():
    body, _, ctx = runtime("battleship")
    # Each search round places the first ship at(0,0), then collides60 times
    # for the next.30 rounds consume5490 draws before reaching the fallback.
    forced = body.server_code + """
;(function(){const original=game.genFleet;game.genFleet=function(random){
  let draws=0;
  const result=original.call(this,()=>++draws<=5490?0:random());
  if(draws<=5490)throw new Error('fallback was not exercised');
  return result;
};})();
"""
    logic = GameLogic(forced, game_schemas=body.game_schemas())
    opening = logic.call("newMatch", ctx=ctx, seed=91)
    fleets = []
    for seed in (101, 102, 103, 104):
        # applyMove also runs the unchanged validShips checks for size,
        # straight contiguous cells, bounds, overlap and separation.
        placed = logic.call("applyMove", opening["state"], "p0", {"type": "auto_place"}, ctx=ctx, seed=seed)
        ships = placed["state"]["boards"][0]["ships"]
        fleets.append(ships)
        assert sum(len(ship["cells"]) for ship in ships) == 17
        assert logic.call("viewFor", placed["state"], "p1", ctx=ctx, seed=92)["boards"][0]["ships"] == []
        assert placed == logic.call("applyMove", opening["state"], "p0", {"type": "auto_place"}, ctx=ctx, seed=seed)
    assert all(fleet != fleets[0] for fleet in fleets[1:])


def test_spades_cannot_restart_a_live_staked_match_or_erase_its_score():
    body, logic, ctx = runtime("spades")
    opening = logic.call("newMatch", ctx=ctx, seed=51)
    state = opening["state"]
    state["tricksWon"] = [0, 4, 2, 3]
    ctx["move_count"] = 40
    before = copy.deepcopy(state)
    for move in ({"newGame": True}, {"newGame": True, "aiMode": "random"}):
        with pytest.raises(InvalidMoveError):
            logic.call("applyMove", state, opening["turn"][0], move, ctx=ctx, seed=52)
        assert state == before
    # Rejection remains in the authority even if a caller has a permissive legacy schema.
    permissive = GameLogic(body.server_code, game_schemas={"state": True, "move": True, "view": True})
    with pytest.raises(InvalidMoveError):
        permissive.call("applyMove", state, opening["turn"][0], {"newGame": True}, ctx=ctx, seed=53)


def test_spades_ai_settings_cannot_replace_a_card_play_in_a_staked_match():
    body, logic, ctx = runtime("spades")
    ctx["pot"] = 40
    opening = logic.call("newMatch", ctx=ctx, seed=57)
    player = opening["turn"][0]
    for mode in ("smart", "random"):
        with pytest.raises(InvalidMoveError):
            logic.call("applyMove", opening["state"], player, {"aiMode": mode}, ctx=ctx, seed=58)
    # Preserve the existing preference control for free practice.
    free = {**ctx, "pot": 0}
    result = logic.call("applyMove", opening["state"], player, {"aiMode": "random"}, ctx=free, seed=58)
    assert result["state"]["aiMode"] == "random"
    assert result["state"]["hands"] == opening["state"]["hands"]


@pytest.mark.parametrize("kind", ["crazy_eights", "go_fish", "hearts", "spades"])
def test_opponent_card_values_and_deck_order_do_not_influence_a_players_view(kind):
    _, logic, ctx = runtime(kind)
    state = logic.call("newMatch", ctx=ctx, seed=61)["state"]
    for viewer in [None, *(player["id"] for player in ctx["players"])]:
        alternate = copy.deepcopy(state)
        hidden = [index for index in range(len(alternate["hands"]))
                  if viewer != ctx["players"][index]["id"]]
        first = hidden[0]
        if alternate.get("deck"):
            alternate["hands"][first][0], alternate["deck"][0] = alternate["deck"][0], alternate["hands"][first][0]
        else:
            second = hidden[1]
            alternate["hands"][first][0], alternate["hands"][second][0] = alternate["hands"][second][0], alternate["hands"][first][0]
        for index, hand in enumerate(alternate["hands"]):
            if viewer != ctx["players"][index]["id"]:
                alternate["hands"][index] = list(reversed(hand))
        if "deck" in alternate:
            alternate["deck"].reverse()
        assert logic.call("viewFor", state, viewer, ctx=ctx, seed=62) == logic.call(
            "viewFor", alternate, viewer, ctx=ctx, seed=62)
    assert not {"seed", "seed_version"} & state.keys()


def test_go_fish_draw_identity_is_visible_only_to_the_drawing_player():
    _, logic, ctx = runtime("go_fish")
    state = logic.call("newMatch", ctx=ctx, seed=71)["state"]
    state["last"] = {"kind": "ask", "from": 0, "to": 1, "rank": "A", "got": 0,
                     "fished": True, "drew": "K\u2660", "extra": False, "newB": [], "msg": "go fish"}
    assert logic.call("viewFor", state, "p0", ctx=ctx, seed=72)["last"]["drew"] == "K\u2660"
    for viewer in ("p1", None):
        assert logic.call("viewFor", state, viewer, ctx=ctx, seed=72)["last"]["drew"] is None


def test_guess_who_hides_the_opponents_identity_until_the_match_ends():
    _, logic, ctx = runtime("guess_who")
    state = logic.call("newMatch", ctx=ctx, seed=81)["state"]
    alternate = copy.deepcopy(state)
    alternate["s"][1] = (state["s"][1] + 1) % 24
    for viewer in ("p0", None):
        assert logic.call("viewFor", state, viewer, ctx=ctx, seed=82) == logic.call(
            "viewFor", alternate, viewer, ctx=ctx, seed=82)
