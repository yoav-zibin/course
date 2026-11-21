"""Animation painter order is bounded presentation data; omitted keys stay omitted."""

import pytest

from game_platform.declarative_ui import DeclarativeUIError, validate_response
from game_platform.tests.test_declarative_ui import spec


def response(kind, z):
    piece = {"id": "token", "type": "token", "board": "board", "position": {"cell": "0"}}
    result = {"scene": {"pieces": [piece]}}
    if kind == "piece":
        piece["animation"] = {"kind": "roll", "key": "roll:1", "z": z}
    elif kind == "move":
        result["last_move_animations"] = [{"piece_id": "token", "z": z, "path": [
            {"board": "board", "position": {"cell": "0"}},
            {"board": "board", "position": {"cell": "0"}}]}]
    else:
        result["animations"] = [{"piece_id": "token", "key": "turn:1", "from": {"rotation": 0}, "z": z}]
    return result


@pytest.mark.parametrize("kind", ["piece", "move", "scene"])
@pytest.mark.parametrize("z", [-1000000, 0, 1000000])
def test_animation_layers_accept_bounds_and_keep_legacy_shape(kind, z):
    value = response(kind, z)
    assert validate_response(spec(), value) is value
    if kind == "piece":
        animation = value["scene"]["pieces"][0]["animation"]
    else:
        animation = value["last_move_animations" if kind == "move" else "animations"][0]
    del animation["z"]
    assert validate_response(spec(), value) is value
    assert "z" not in animation


@pytest.mark.parametrize("kind", ["piece", "move", "scene"])
@pytest.mark.parametrize("z", [-1000001, 1000001, True, None, "5", float("nan"), float("inf")])
def test_animation_layers_reject_invalid_geometry(kind, z):
    with pytest.raises(DeclarativeUIError):
        validate_response(spec(), response(kind, z))
