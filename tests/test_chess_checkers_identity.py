"""Presentation identities survive one move and reset safely after missed boards."""
import copy
import json
from pathlib import Path

import pytest

from game_platform.declarative_ui import DeclarativeLogic

ROOT = Path(__file__).resolve().parents[1]


def reduce(kind, board, last=None, previous=None, spectator=False, move_count=0):
    spec = json.loads((ROOT / "games/declarative" / f"{kind}.json").read_text())["declarative_ui"]
    view = {"board" if kind == "checkers" else "bd": board, "lastMove": last,
            "moves": [], "toMove": 0, "winner": None}
    message = {"type": "state_changed", "view": view, "state": view, "status": "ongoing",
               "my_player_index": None if spectator else 0,
               "acting_for_player_index": None if spectator else 0, "move_count": move_count}
    frame = DeclarativeLogic(spec).reduce(message, previous)
    pieces = {int(piece["position"]["cell"]): piece for piece in frame["scene"]["pieces"]}
    assert len({piece["id"] for piece in pieces.values()}) == len(pieces)
    return frame["local_state"], pieces


def checker_board(entries):
    board = [[None for _ in range(8)] for _ in range(8)]
    for (r, c), color, king in entries:
        board[r][c] = {"c": color, "k": king}
    return board


@pytest.mark.parametrize("kind", ["checkers", "chess"])
def test_missed_opponent_and_own_moves_cannot_reuse_an_active_piece_id(kind):
    if kind == "checkers":
        opening = checker_board([((5, 0), 0, False), ((6, 1), 0, False), ((2, 3), 1, False)])
        one = checker_board([((4, 1), 0, False), ((6, 1), 0, False), ((2, 3), 1, False)])
        gap = checker_board([((4, 1), 0, False), ((5, 0), 0, False), ((3, 2), 1, False)])
        first_move = {"from": {"r": 5, "c": 0}, "to": {"r": 4, "c": 1}}
        last_move = {"from": {"r": 2, "c": 3}, "to": {"r": 3, "c": 2}}
        origin, destination = 40, 33
    else:
        opening = [0] * 64
        opening[10], opening[11], opening[20] = 4, 4, -4
        one = opening[:]
        one[10], one[18] = 0, 4
        gap = one[:]
        gap[11], gap[10], gap[20], gap[28] = 0, 4, 0, -4
        first_move = {"fr": 1, "fc": 2, "tr": 2, "tc": 2}
        last_move = {"fr": 2, "fc": 4, "tr": 3, "tc": 4}
        origin, destination = 10, 18
    initial, pieces = reduce(kind, opening)
    carried, moved = reduce(kind, one, first_move, initial, move_count=1)
    assert moved[destination]["id"] == pieces[origin]["id"]
    reset, skipped = reduce(kind, gap, last_move, carried, move_count=3)
    assert len(skipped) == 3
    _, repeated = reduce(kind, gap, last_move, reset, spectator=True, move_count=3)
    assert {cell: piece["id"] for cell, piece in repeated.items()} == {cell: piece["id"] for cell, piece in skipped.items()}


@pytest.mark.parametrize("scenario", ["move", "capture", "promotion"])
def test_checkers_single_moves_and_crowning_keep_the_moving_identity(scenario):
    start, end = {"move": ((5, 0), (4, 1)), "capture": ((4, 1), (2, 3)),
                  "promotion": ((1, 2), (0, 1))}[scenario]
    entries = [(start, 0, False), ((6, 7), 1, False)]
    if scenario == "capture":
        entries.append(((3, 2), 1, False))
    opening = checker_board(entries)
    after = copy.deepcopy(opening)
    after[start[0]][start[1]] = None
    after[end[0]][end[1]] = {"c": 0, "k": scenario == "promotion"}
    if scenario == "capture":
        after[3][2] = None
    local, before = reduce("checkers", opening)
    _, current = reduce("checkers", after, {"from": dict(zip(("r", "c"), start)), "to": dict(zip(("r", "c"), end))}, local, move_count=1)
    assert current[end[0] * 8 + end[1]]["id"] == before[start[0] * 8 + start[1]]["id"]
    assert current[55]["id"] == before[55]["id"]
    if scenario == "capture":
        assert before[26]["id"] not in {piece["id"] for piece in current.values()}


@pytest.mark.parametrize("scenario", ["move", "capture", "promotion", "castling", "en_passant"])
def test_chess_single_moves_preserve_identity_through_special_moves(scenario):
    opening = [0] * 64
    opening[60], opening[4] = 6, -6
    if scenario == "castling":
        start, end = 60, 62
        opening[63] = 4
    else:
        start, end = {"move": (40, 32), "capture": (24, 16), "promotion": (8, 0), "en_passant": (28, 19)}[scenario]
        opening[start] = 1 if scenario in ("promotion", "en_passant") else 4
        if scenario == "capture":
            opening[end] = -1
        if scenario == "en_passant":
            opening[27] = -1
    after = opening[:]
    after[start], after[end] = 0, 5 if scenario == "promotion" else opening[start]
    if scenario == "castling":
        after[63], after[61] = 0, 4
    if scenario == "en_passant":
        after[27] = 0
    local, before = reduce("chess", opening)
    _, current = reduce("chess", after, {"fr": start // 8, "fc": start % 8, "tr": end // 8, "tc": end % 8}, local, move_count=1)
    assert current[end]["id"] == before[start]["id"]
    assert current[4]["id"] == before[4]["id"]
    if scenario == "castling":
        assert current[61]["id"] == before[63]["id"]
    if scenario in ("capture", "en_passant"):
        captured = end if scenario == "capture" else 27
        assert before[captured]["id"] not in {piece["id"] for piece in current.values()}

