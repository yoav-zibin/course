"""Request and response bodies of the HTTP API."""

import datetime as dt
from typing import Annotated, Final

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    model_validator,
)

from game_platform.models import (
    MAX_PLAYERS,
    MIN_PLAYERS,
    EndReason,
    Game,
    Match,
    MatchStatus,
    Move,
    Seat,
    SeatKind,
    User,
)
from game_platform.service import AllData

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
PlayerCount = Annotated[int, Field(ge=MIN_PLAYERS, le=MAX_PLAYERS)]


def _check_player_counts(counts: list[int]) -> list[int]:
    if len(set(counts)) != len(counts):
        raise ValueError("must not contain duplicates")
    return sorted(counts)


PlayerCounts = Annotated[
    list[PlayerCount], Field(min_length=1), AfterValidator(_check_player_counts)
]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _example(example: dict[str, JsonValue]) -> ConfigDict:
    """Config adding an example body to the OpenAPI schema, used by the API console."""
    return ConfigDict(json_schema_extra={"examples": [example]})


_TIC_TAC_TOE_BOARD: Final[list[JsonValue]] = [""] * 9


class UserCreate(_Request):
    model_config = _example({"display_name": "alice"})

    display_name: Name


class UserUpdate(_Request):
    model_config = _example({"display_name": "alice the great"})

    display_name: Name


class UserOut(BaseModel):
    id: str
    display_name: str
    created_at: dt.datetime
    updated_at: dt.datetime

    @classmethod
    def of(cls, user: User) -> "UserOut":
        return cls(
            id=user.id,
            display_name=user.display_name,
            created_at=user.created_at,
            updated_at=user.updated_at,
        )


class UserWithPasswordOut(UserOut):
    """Returned by POST /users and the debug tools only."""

    # Send it as the X-User-Password header, along with X-User-Id.
    password: str

    @classmethod
    def of_user(cls, user: User) -> "UserWithPasswordOut":
        return cls(**UserOut.of(user).model_dump(), password=user.password)


class GameCreate(_Request):
    model_config = _example(
        {
            "name": "Tic-tac-toe",
            "description": "Three in a row wins",
            "allowed_player_counts": [2],
            "allows_leave_mid_match": True,
            "allows_join_mid_match": True,
            "code": "<div id='board'></div>",
        }
    )

    name: Name
    description: str = ""
    allowed_player_counts: PlayerCounts
    allows_leave_mid_match: bool = False
    allows_join_mid_match: bool = False
    code: str


class GameUpdate(_Request):
    """Omitted fields are left unchanged."""

    model_config = _example({"description": "Three in a row wins; draws are replayed"})

    name: Name | None = None
    description: str | None = None
    allowed_player_counts: PlayerCounts | None = None
    allows_leave_mid_match: bool | None = None
    allows_join_mid_match: bool | None = None
    code: str | None = None

    @model_validator(mode="after")
    def _reject_explicit_nulls(self) -> "GameUpdate":
        for field in sorted(self.model_fields_set):
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class GameOut(BaseModel):
    id: str
    version: int
    owner_user_id: str
    name: str
    description: str
    allowed_player_counts: list[int]
    allows_leave_mid_match: bool
    allows_join_mid_match: bool
    code: str
    created_at: dt.datetime
    updated_at: dt.datetime
    deleted: bool

    @classmethod
    def of(cls, game: Game) -> "GameOut":
        return cls(
            id=game.id,
            version=game.version,
            owner_user_id=game.owner_user_id,
            name=game.name,
            description=game.description,
            allowed_player_counts=list(game.rules.allowed_player_counts),
            allows_leave_mid_match=game.rules.allows_leave_mid_match,
            allows_join_mid_match=game.rules.allows_join_mid_match,
            code=game.code,
            created_at=game.created_at,
            updated_at=game.updated_at,
            deleted=game.deleted,
        )


class MatchCreate(_Request):
    model_config = _example({"game_id": "", "num_computer_opponents": 1})

    game_id: str
    num_computer_opponents: Annotated[int, Field(ge=0)] = 0


class MatchUpdate(_Request):
    model_config = _example({"num_computer_opponents": 1})

    num_computer_opponents: Annotated[int, Field(ge=0)]


class MatchStart(_Request):
    model_config = _example(
        {"first_turn_player_index": 0, "initial_state": {"board": _TIC_TAC_TOE_BOARD}}
    )

    first_turn_player_index: Annotated[int, Field(ge=0)] = 0
    initial_state: JsonValue = None


class MoveCreate(_Request):
    model_config = _example(
        {
            "new_state": {"board": ["X", *_TIC_TAC_TOE_BOARD[1:]]},
            "next_turn_player_index": 1,
        }
    )

    new_state: JsonValue
    # [None] ends the match.
    next_turn_player_index: int | None
    # If given, the move is rejected unless the match has exactly this many moves.
    expected_move_count: int | None = None


class PlayerOut(BaseModel):
    player_index: int
    kind: SeatKind
    user_id: str | None

    @classmethod
    def of(cls, seat: Seat) -> "PlayerOut":
        return cls(player_index=seat.player_index, kind=seat.kind, user_id=seat.user_id)


class MatchOut(BaseModel):
    id: str
    game_id: str
    game_version: int
    owner_user_id: str
    status: MatchStatus
    end_reason: EndReason | None
    players: list[PlayerOut]
    turn_of_player_index: int | None
    state: JsonValue
    move_count: int
    created_at: dt.datetime
    updated_at: dt.datetime

    @classmethod
    def of(cls, match: Match) -> "MatchOut":
        return cls(
            id=match.id,
            game_id=match.game_id,
            game_version=match.game_version,
            owner_user_id=match.owner_user_id,
            status=match.status,
            end_reason=match.end_reason,
            players=[PlayerOut.of(seat) for seat in match.seats],
            turn_of_player_index=match.turn_of_player_index,
            state=match.state,
            move_count=len(match.moves),
            created_at=match.created_at,
            updated_at=match.updated_at,
        )


class MoveOut(BaseModel):
    move_number: int
    player_index: int
    made_by_user_id: str
    created_at: dt.datetime
    new_state: JsonValue
    next_turn_player_index: int | None

    @classmethod
    def of(cls, move: Move) -> "MoveOut":
        return cls(
            move_number=move.move_number,
            player_index=move.player_index,
            made_by_user_id=move.made_by_user_id,
            created_at=move.created_at,
            new_state=move.new_state,
            next_turn_player_index=move.next_turn_player_index,
        )


class MatchDetailOut(MatchOut):
    moves: list[MoveOut]
    hidden_for_user_ids: list[str]

    @classmethod
    def of(cls, match: Match) -> "MatchDetailOut":
        return cls(
            **MatchOut.of(match).model_dump(),
            moves=[MoveOut.of(move) for move in match.moves],
            hidden_for_user_ids=sorted(match.hidden_for_user_ids),
        )


class AllDataOut(BaseModel):
    users: list[UserWithPasswordOut]
    # Every version of every game, including deleted games.
    game_versions: list[GameOut]
    matches: list[MatchDetailOut]

    @classmethod
    def of(cls, data: AllData) -> "AllDataOut":
        return cls(
            users=[UserWithPasswordOut.of_user(user) for user in data.users],
            game_versions=[GameOut.of(game) for game in data.game_versions],
            matches=[MatchDetailOut.of(match) for match in data.matches],
        )
