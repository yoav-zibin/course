"""Rotation in both directions, flipping and target placement previews."""

import pytest

from game_platform.declarative_ui import (
    SCHEMA, DeclarativeLogic, DeclarativeUIError, validate_response,
)
from game_platform.tests.test_declarative_ui import spec, state_changed


def tile(**updates):
    return {"id": "tile", "type": "token", "board": "board",
            "position": {"cell": "0"}, **updates}


def target(**updates):
    return {"id": "place", "board": "board", "position": {"cell": "4"}, **updates}


@pytest.mark.parametrize("actions", [["flip"], ["rotate", "flip"],
                                     ["tap", "move", "rotate", "flip", "scale"]])
def test_flip_is_a_portable_piece_action(actions):
    properties = {"actions": actions}
    if "move" in actions:
        properties["move_targets"] = ["place"]
    result = {"scene": {"pieces": [tile(**properties)], "targets": [target()]}}
    assert validate_response(spec(), result) == result


def test_flip_cannot_repeat_or_be_misspelled():
    for actions in (["flip", "flip"], ["mirror"]):
        with pytest.raises(DeclarativeUIError):
            validate_response(spec(), {"scene": {"pieces": [tile(actions=actions)]}})


REDUCER = """
const gameUI={reduce(message,localState){
  const m=message.type==='ui_event'?message.state_changed:message;
  const state=Object.assign({rotation:0,flipped:false},localState||{});
  if(message.type==='ui_event'){
    if(message.event.type==='rotate')state.rotation=((state.rotation+message.event.delta)%360+360)%360;
    if(message.event.type==='flip')state.flipped=!state.flipped;
  }
  const cells=state.rotation%180===0?['3','4']:['1','4'];
  return {scene:{pieces:[{id:'tile',type:'token',board:'board',position:{cell:'0'},
    rotation:state.rotation,actions:['rotate','flip'],move_targets:['place']}],
    targets:[{id:'place',board:'board',position:{cell:'4'},
      preview:cells.map(cell=>({position:{cell},color:state.flipped?'#ff0000':'#00ff00'}))}]},
    local_state:state};
}};
"""


@pytest.mark.parametrize("events,expected", [
    ([{"type": "rotate", "id": "tile", "delta": -90}], {"rotation": 270, "flipped": False}),
    ([{"type": "rotate", "id": "tile", "delta": 90}], {"rotation": 90, "flipped": False}),
    ([{"type": "flip", "id": "tile"}], {"rotation": 0, "flipped": True}),
    ([{"type": "flip", "id": "tile"}, {"type": "flip", "id": "tile"}], {"rotation": 0, "flipped": False}),
])
def test_counterclockwise_rotation_and_flip_reach_the_reducer_as_json(events, expected):
    logic = DeclarativeLogic(spec(REDUCER))
    local = logic.reduce(state_changed())["local_state"]
    for event in events:
        result = logic.reduce({"type": "ui_event", "state_changed": state_changed(),
                               "event": event}, local)
        local = result["local_state"]
        assert "make_move" not in result
    assert local == expected
    preview = result["scene"]["targets"][0]["preview"]
    assert len(preview) == 2 and preview[1]["position"] == {"cell": "4"}


@pytest.mark.parametrize("event", [
    {"type": "flip", "id": "tile", "delta": 90},
    {"type": "flip", "id": "tile", "factor": 1.1},
    {"type": "flip"},
])
def test_flip_events_take_no_parameters(event):
    with pytest.raises(DeclarativeUIError):
        DeclarativeLogic(spec(REDUCER)).reduce({"type": "ui_event", "event": event,
                                              "state_changed": state_changed()})


def test_target_previews_accept_cells_points_colors_rotation_and_text():
    preview = [{"position": {"cell": "4"}, "color": "#4f8cff", "rotation": 90, "text": "2"},
               {"position": {"x": 300, "y": 500}}]
    result = {"scene": {"targets": [target(preview=preview)]}}
    assert validate_response(spec(), result) == result
    assert "preview" in SCHEMA["$defs"]["target"]["properties"]


@pytest.mark.parametrize("preview", [
    [],
    [{"position": {"cell": "9"}}],
    [{"position": {"cell": "1"}, "asset": "missing"}],
    [{"position": {"cell": "1"}, "color": "blue"}],
    [{"position": {"cell": "1"}, "opacity": 0.5}],
    [{"position": {"cell": "1"}, "text": "x" * 41}],
    [{"color": "#4f8cff"}],
    [{"position": {"cell": "1"}}] * 65,
])
def test_invalid_target_previews_are_rejected(preview):
    with pytest.raises(DeclarativeUIError):
        validate_response(spec(), {"scene": {"targets": [target(preview=preview)]}})


PLACING = REDUCER.replace(
    "    local_state:state};",
    "    local_state:state,...(message.type==='ui_event'&&message.event.type==='drop'?"
    "{make_move:{place:message.event.target_id,rotation:state.rotation,flipped:state.flipped}}:{})};")


@pytest.mark.parametrize("move", [
    {"place": "place", "rotation": 0, "flipped": False},
    {"place": "place", "rotation": 270, "flipped": False},
    {"place": "place", "rotation": 180, "flipped": True},
])
def test_publisher_reaches_moves_that_need_rotation_and_flip_through_offered_tools(move):
    from game_platform.tools.publish_declarative_games import scene_event
    logic = DeclarativeLogic(spec(PLACING))
    frame = logic.reduce(state_changed())
    answer = scene_event(logic, state_changed(), frame, move)
    assert answer["make_move"] == move


def test_publisher_search_is_bounded_when_no_offered_action_matches():
    from game_platform.tools.publish_declarative_games import scene_event
    logic = DeclarativeLogic(spec(PLACING))
    with pytest.raises(ValueError, match="no offered UI action"):
        scene_event(logic, state_changed(), logic.reduce(state_changed()),
                    {"place": "elsewhere", "rotation": 0, "flipped": False}, budget=60)
