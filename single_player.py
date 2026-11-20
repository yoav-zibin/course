"""Portable, private saves for matches controlled by one account.

These saves have no stakes, public ranking, join capability or notifications.
The owner controls the local rules runner; validation protects storage and
account boundaries rather than treating a private practice as a competition.
"""

import datetime as dt
import base64
import gzip
import json
import re
import zlib

from game_platform.models import Move, Seat

MAX_SAVE_BYTES = 8_000_000
MAX_COMPRESSED_SAVE_BYTES = 600_000


def encode_save(value):
    """Compress portable histories without changing the HTTP/save contract.

    Repeated board snapshots compress well. The bounded expanded size also
    prevents a malformed stored compressed record from exhausting a reader.
    """
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    if len(raw) > MAX_SAVE_BYTES:
        raise ValueError("single-player save exceeds 8 MB")
    if len(raw) < 32_000:
        return None
    encoded = base64.b64encode(gzip.compress(raw, mtime=0)).decode("ascii")
    if len(encoded) > MAX_COMPRESSED_SAVE_BYTES:
        raise ValueError("compressed single-player save exceeds 600 KB")
    return encoded


def decode_save(packed):
    if not isinstance(packed, str) or len(packed) > MAX_COMPRESSED_SAVE_BYTES:
        raise ValueError("invalid compressed single-player save")
    inflater = zlib.decompressobj(31)
    raw = inflater.decompress(base64.b64decode(packed, validate=True), MAX_SAVE_BYTES + 1)
    if len(raw) > MAX_SAVE_BYTES or not inflater.eof or inflater.unused_data:
        raise ValueError("invalid expanded single-player save")
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("invalid single-player save")
    return result


def validate_save(value, owner, game):
    """Return a detached normalized snapshot; raise ValueError on invalid data."""
    encode_save(value)
    value = json.loads(json.dumps(value, allow_nan=False))
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", str(value.get("id", ""))):
        raise ValueError("invalid match id")
    kind = value.get("match_kind")
    if kind not in ("computer", "pass_and_play"):
        raise ValueError("single-player match_kind must be computer or pass_and_play")
    if value.get("owner_user_id", owner) != owner:
        raise ValueError("single-player saves belong to the authenticated owner")
    if value.get("game_id") != game.id or value.get("game_version") != game.version:
        raise ValueError("save must use its pinned game version")
    players = value.get("players")
    if not isinstance(players, list) or len(players) not in game.rules.allowed_player_counts:
        raise ValueError("invalid player count for this game")
    ids = set()
    human_accounts = 0
    humans = 0
    computers = 0
    for index, player in enumerate(players):
        if (not isinstance(player, dict) or type(player.get("player_index")) is not int
                or player["player_index"] != index):
            raise ValueError("players must have consecutive seat indices")
        identity = player.get("id")
        if not isinstance(identity, str) or not identity or len(identity) > 128 or identity in ids:
            raise ValueError("player ids must be unique")
        ids.add(identity)
        if "active" in player and type(player["active"]) is not bool:
            raise ValueError("seat active must be a boolean")
        if player.get("kind") == "human":
            humans += 1
            if player.get("user_id") is not None:
                if player["user_id"] != owner:
                    raise ValueError("other accounts cannot occupy a single-player match")
                human_accounts += 1
        elif player.get("kind") == "computer" and player.get("user_id") is None:
            computers += 1
        else:
            raise ValueError("invalid single-player seat")
        if len(str(player.get("name", ""))) > 200:
            raise ValueError("player names exceed 200 characters")
    if human_accounts != 1:
        raise ValueError("exactly one seat must belong to the owner")
    if kind == "computer" and (humans != 1 or computers < 1):
        raise ValueError("computer matches need exactly one human and computer opponents")
    if kind == "pass_and_play" and (humans < 1 or computers):
        raise ValueError("pass-and-play matches contain human seats only")
    if any(value.get(field, 0) not in (0, None) for field in ("bet_per_player", "max_loss", "token_pot")):
        raise ValueError("single-player matches cannot have stakes")
    if value.get("turn_seconds") is not None:
        raise ValueError("single-player matches have no server clock")

    def turn(indices, *, nullable=True):
        if indices is None and nullable:
            return
        if (not isinstance(indices, list) or not indices
                or any(type(i) is not int or not 0 <= i < len(players) for i in indices)
                or len(set(indices)) != len(indices)):
            raise ValueError("invalid turn indices")

    status = value.get("status")
    if status not in ("ongoing", "over"):
        raise ValueError("single-player saves must be ongoing or over")
    turn(value.get("turn_of_player_indices"))
    if (status == "over") != (value.get("turn_of_player_indices") is None):
        raise ValueError("match status and current turn disagree")
    turn(value.get("initialTurn"))
    history = value.get("moves")
    if (not isinstance(history, list) or len(history) > 10_000
            or type(value.get("move_count")) is not int or value["move_count"] != len(history)):
        raise ValueError("save move_count must match its complete move history")
    for number, move in enumerate(history, 1):
        if (not isinstance(move, dict) or type(move.get("move_number")) is not int
                or move["move_number"] != number
                or type(move.get("player_index")) is not int
                or not 0 <= move["player_index"] < len(players)):
            raise ValueError("invalid move history")
        turn(move.get("next_turn_player_indices"))
    if history and history[-1].get("next_turn_player_indices") != value.get("turn_of_player_indices"):
        raise ValueError("last recorded move and current turn disagree")
    seed = value.get("practiceSeed")
    if type(seed) is not int or not 0 <= seed <= 0xffffffff:
        raise ValueError("practiceSeed must be an unsigned 32-bit integer")
    created = value.get("created_at")
    if not isinstance(created, str):
        raise ValueError("created_at is required")
    stamp = dt.datetime.fromisoformat(created.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        raise ValueError("created_at must have a timezone")
    for field in ("logicState", "state", "initialState"):
        if field not in value:
            raise ValueError(f"{field} is required")
    # Authentication is authoritative, including after account merge.
    value["owner_user_id"] = owner
    value["localMode"] = "computer" if kind == "computer" else "pass"
    return value


def save_seats(snapshot):
    return tuple(Seat(
        player_index=player["player_index"], kind=player["kind"],
        user_id=player.get("user_id"), logic_player_id=player["id"],
        active=player.get("active", True),
    ) for player in snapshot["players"])


def save_moves(snapshot, owner, created_at):
    return tuple(Move(
        move_number=move["move_number"], player_index=move["player_index"],
        made_by_user_id=owner, created_at=created_at,
        new_state=move.get("new_state"), move=move.get("move"),
        next_turn_player_indices=(None if move.get("next_turn_player_indices") is None
                                  else frozenset(move["next_turn_player_indices"])),
        player_id=snapshot["players"][move["player_index"]]["id"],
    ) for move in snapshot["moves"])


def transfer_save(snapshot, source, target):
    """Transfer account ownership without changing any game-defined player id."""
    if snapshot is None:
        return None
    result = {**snapshot}
    if result.get("owner_user_id") == source:
        result["owner_user_id"] = target
    result["players"] = [({**player, "user_id": target} if player.get("user_id") == source else player)
                         for player in result["players"]]
    return result
