"""Business rules of the game platform, independent of HTTP.

Every public method takes the caller's user id (already authenticated) where identity
matters, and raises a subclass of [PlatformError] when a request can't be honored.
"""

import datetime as dt
import hmac
import secrets
import threading
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace

from pydantic import JsonValue

from game_platform.models import (
    Game,
    GameRules,
    Match,
    MatchStatus,
    Move,
    Seat,
    User,
)
from game_platform.store import InMemoryStore, Store


@dataclass(frozen=True, kw_only=True)
class AllData:
    users: list[User]
    # Every version of every game, including deleted games.
    game_versions: list[Game]
    matches: list[Match]


class PlatformError(Exception):
    pass


class UnauthorizedError(PlatformError):
    """The caller did not identify itself as a known user."""


class ForbiddenError(PlatformError):
    """The caller is known but not allowed to do this."""


class NotFoundError(PlatformError):
    pass


class InvalidRequestError(PlatformError):
    """The request's values don't make sense for the resource it targets."""


class ConflictError(PlatformError):
    """The resource's current state doesn't allow this transition."""


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


def _new_password() -> str:
    return secrets.token_urlsafe(16)


def _waiting_seats(
    *, human_user_ids: Sequence[str], num_computer_opponents: int
) -> tuple[Seat, ...]:
    """Before a match starts, humans sit in join order followed by the computers."""
    humans = [
        Seat(player_index=index, kind="human", user_id=user_id)
        for index, user_id in enumerate(human_user_ids)
    ]
    computers = [
        Seat(player_index=len(humans) + index, kind="computer", user_id=None)
        for index in range(num_computer_opponents)
    ]
    return (*humans, *computers)


def _replace_seat(seats: tuple[Seat, ...], new_seat: Seat) -> tuple[Seat, ...]:
    return tuple(
        new_seat if seat.player_index == new_seat.player_index else seat
        for seat in seats
    )


class GamePlatform:
    def __init__(
        self,
        *,
        store: Store | None = None,
        clock: Callable[[], dt.datetime] = _utc_now,
        new_id: Callable[[], str] = _new_id,
        new_password: Callable[[], str] = _new_password,
    ) -> None:
        self._store: Store = store if store is not None else InMemoryStore()
        self._clock = clock
        self._new_id = new_id
        self._new_password = new_password
        # Each public method is a read-modify-write on the store; the server handles
        # requests on a thread pool, so serialize them.
        self._lock = threading.Lock()

    # Users

    def create_user(self, *, display_name: str) -> User:
        with self._lock:
            now = self._clock()
            user = User(
                id=self._new_id(),
                display_name=display_name,
                password=self._new_password(),
                created_at=now,
                updated_at=now,
            )
            self._store.put_user(user)
            return user

    def update_user(self, *, caller_id: str, user_id: str, display_name: str) -> User:
        with self._lock:
            user = self._store.get_user(user_id)
            if user is None:
                raise NotFoundError("user not found")
            if user.id != caller_id:
                raise ForbiddenError("users can only change themselves")
            if user.display_name == display_name:
                return user
            user = replace(user, display_name=display_name, updated_at=self._clock())
            self._store.put_user(user)
            return user

    def get_user(self, user_id: str) -> User:
        with self._lock:
            user = self._store.get_user(user_id)
            if user is None:
                raise NotFoundError("user not found")
            return user

    def authenticate(self, *, user_id: str | None, password: str | None) -> User:
        """Checks the caller's credentials. The error doesn't say which part was wrong,
        so it can't be used to find out which user ids exist."""
        with self._lock:
            user = None if user_id is None else self._store.get_user(user_id)
            if (
                user is None
                or password is None
                or not hmac.compare_digest(password.encode(), user.password.encode())
            ):
                raise UnauthorizedError(
                    "missing or invalid X-User-Id / X-User-Password headers"
                )
            return user

    # Games

    def create_game(
        self,
        *,
        caller_id: str,
        name: str,
        description: str,
        rules: GameRules,
        code: str,
    ) -> Game:
        with self._lock:
            now = self._clock()
            game = Game(
                id=self._new_id(),
                version=1,
                owner_user_id=caller_id,
                name=name,
                description=description,
                rules=rules,
                code=code,
                created_at=now,
                updated_at=now,
            )
            self._store.add_game_version(game)
            return game

    def get_game(self, game_id: str) -> Game:
        with self._lock:
            return self._get_game(game_id)

    def get_game_version(self, game_id: str, version: int) -> Game:
        """Old versions stay available, even after the game is deleted, because matches
        created with them still need their code."""
        with self._lock:
            game = self._store.get_game_version(game_id, version)
            if game is None:
                raise NotFoundError("game version not found")
            return game

    def list_games(self, *, owner_user_id: str | None) -> list[Game]:
        with self._lock:
            return self._store.list_games(owner_user_id=owner_user_id)

    def update_game(
        self,
        *,
        caller_id: str,
        game_id: str,
        name: str | None = None,
        description: str | None = None,
        allowed_player_counts: tuple[int, ...] | None = None,
        allows_leave_mid_match: bool | None = None,
        allows_join_mid_match: bool | None = None,
        code: str | None = None,
    ) -> Game:
        """Creates a new version of the game, unless nothing changes.

        Fields left as [None] are unchanged.
        """
        with self._lock:
            game = self._get_owned_game(caller_id=caller_id, game_id=game_id)
            rules = game.rules
            updated = replace(
                game,
                name=name if name is not None else game.name,
                description=description
                if description is not None
                else game.description,
                rules=GameRules(
                    allowed_player_counts=allowed_player_counts
                    if allowed_player_counts is not None
                    else rules.allowed_player_counts,
                    allows_leave_mid_match=allows_leave_mid_match
                    if allows_leave_mid_match is not None
                    else rules.allows_leave_mid_match,
                    allows_join_mid_match=allows_join_mid_match
                    if allows_join_mid_match is not None
                    else rules.allows_join_mid_match,
                ),
                code=code if code is not None else game.code,
            )
            if updated == game:
                return game
            updated = replace(
                updated, version=game.version + 1, updated_at=self._clock()
            )
            self._store.add_game_version(updated)
            return updated

    def delete_game(self, *, caller_id: str, game_id: str) -> None:
        with self._lock:
            self._get_owned_game(caller_id=caller_id, game_id=game_id)
            self._store.delete_game(game_id)

    # Matches

    def create_match(
        self, *, caller_id: str, game_id: str, num_computer_opponents: int
    ) -> Match:
        with self._lock:
            game = self._get_live_game(game_id)
            self._check_fits(game.rules, num_players=1 + num_computer_opponents)
            now = self._clock()
            match = Match(
                id=self._new_id(),
                game_id=game.id,
                owner_user_id=caller_id,
                game_version=game.version,
                status="waiting_for_players",
                seats=_waiting_seats(
                    human_user_ids=[caller_id],
                    num_computer_opponents=num_computer_opponents,
                ),
                state=None,
                turn_of_player_indices=None,
                end_reason=None,
                moves=(),
                hidden_for_user_ids=frozenset(),
                created_at=now,
                updated_at=now,
            )
            self._store.put_match(match)
            return match

    def get_match(self, match_id: str) -> Match:
        with self._lock:
            return self._get_match(match_id)

    def list_matches(
        self, *, caller_id: str, status: MatchStatus | None, game_id: str | None
    ) -> list[Match]:
        with self._lock:
            return [
                match
                for match in self._store.list_matches_involving(caller_id)
                if caller_id not in match.hidden_for_user_ids
                and (status is None or match.status == status)
                and (game_id is None or match.game_id == game_id)
            ]

    def set_num_computer_opponents(
        self, *, caller_id: str, match_id: str, num_computer_opponents: int
    ) -> Match:
        with self._lock:
            match = self._get_owned_match(caller_id=caller_id, match_id=match_id)
            if match.status != "waiting_for_players":
                raise ConflictError(
                    "computer opponents can only be changed before the match starts"
                )
            humans = match.human_user_ids
            self._check_fits(
                self._rules_of(match),
                num_players=len(humans) + num_computer_opponents,
            )
            return self._save(
                replace(
                    match,
                    seats=_waiting_seats(
                        human_user_ids=humans,
                        num_computer_opponents=num_computer_opponents,
                    ),
                )
            )

    def join_match(self, *, caller_id: str, match_id: str) -> Match:
        with self._lock:
            match = self._get_match(match_id)
            if match.seat_of(caller_id) is not None:
                raise ConflictError("you are already a player in this match")
            if match.status == "over":
                raise ConflictError("the match is over")
            if match.status == "ongoing":
                seats = self._take_seat_mid_match(match, user_id=caller_id)
            else:
                if len(match.seats) >= self._rules_of(match).max_players:
                    raise ConflictError("the match is full")
                seats = _waiting_seats(
                    human_user_ids=[*match.human_user_ids, caller_id],
                    num_computer_opponents=match.num_computer_opponents,
                )
            return self._save(replace(match, seats=seats))

    def start_match(
        self,
        *,
        caller_id: str,
        match_id: str,
        first_turn_player_indices: frozenset[int],
        initial_state: JsonValue,
    ) -> Match:
        with self._lock:
            match = self._get_owned_match(caller_id=caller_id, match_id=match_id)
            if match.status != "waiting_for_players":
                raise ConflictError("the match has already started")
            num_players = len(match.seats)
            allowed_player_counts = self._rules_of(match).allowed_player_counts
            if num_players not in allowed_player_counts:
                raise ConflictError(
                    f"the match has {num_players} players but the game allows "
                    f"{list(allowed_player_counts)}"
                )
            if not first_turn_player_indices:
                raise InvalidRequestError(
                    "the first turn must name at least one player"
                )
            self._check_player_indices(match, first_turn_player_indices)
            return self._save(
                replace(
                    match,
                    status="ongoing",
                    state=initial_state,
                    turn_of_player_indices=first_turn_player_indices,
                )
            )

    def leave_match(self, *, caller_id: str, match_id: str) -> Match:
        with self._lock:
            match = self._get_match(match_id)
            seat = self._get_seat(match, caller_id)
            if match.status == "over":
                raise ConflictError("the match is over")
            if match.status == "waiting_for_players":
                if caller_id == match.owner_user_id:
                    raise ConflictError(
                        "the owner cannot leave a match that has not started; "
                        "delete it instead"
                    )
                remaining_humans = [
                    user_id for user_id in match.human_user_ids if user_id != caller_id
                ]
                updated = replace(
                    match,
                    seats=_waiting_seats(
                        human_user_ids=remaining_humans,
                        num_computer_opponents=match.num_computer_opponents,
                    ),
                )
            elif self._rules_of(match).allows_leave_mid_match:
                # A computer takes over the seat, including its turn if it had it.
                computer = Seat(
                    player_index=seat.player_index, kind="computer", user_id=None
                )
                updated = replace(match, seats=_replace_seat(match.seats, computer))
                if not updated.human_user_ids:
                    # Nobody is left to submit moves.
                    updated = self._ended_by_leaving(updated)
            else:
                updated = self._ended_by_leaving(match)
            return self._save(updated)

    def make_move(
        self,
        *,
        caller_id: str,
        match_id: str,
        new_state: JsonValue,
        next_turn_player_indices: frozenset[int] | None,
        expected_move_count: int | None,
    ) -> Match:
        """Records a move by one of the players whose turn it is.

        Any player in the turn set may move; the move is recorded for that player's
        seat. When a computer seat has the turn, any human player may submit the move
        on its behalf. [next_turn_player_indices = None] ends the match.
        [expected_move_count], if given, guards against two clients submitting the
        same move.
        """
        with self._lock:
            match = self._get_match(match_id)
            seat = self._get_seat(match, caller_id)
            if match.status != "ongoing" or match.turn_of_player_indices is None:
                raise ConflictError("the match is not ongoing")
            if expected_move_count is not None and expected_move_count != len(
                match.moves
            ):
                raise ConflictError(
                    f"expected {expected_move_count} moves but the match has "
                    f"{len(match.moves)}"
                )
            mover_seat = self._mover_seat(match, seat)
            if next_turn_player_indices is not None:
                if not next_turn_player_indices:
                    raise InvalidRequestError(
                        "the next turn must name at least one player"
                    )
                self._check_player_indices(match, next_turn_player_indices)
            now = self._clock()
            move = Move(
                move_number=len(match.moves) + 1,
                player_index=mover_seat.player_index,
                made_by_user_id=caller_id,
                created_at=now,
                new_state=new_state,
                next_turn_player_indices=next_turn_player_indices,
            )
            return self._save(
                replace(
                    match,
                    state=new_state,
                    moves=(*match.moves, move),
                    turn_of_player_indices=next_turn_player_indices,
                    status="ongoing"
                    if next_turn_player_indices is not None
                    else "over",
                    end_reason=None
                    if next_turn_player_indices is not None
                    else "finished",
                )
            )

    def delete_match(self, *, caller_id: str, match_id: str) -> None:
        """The owner deletes the match; other players can only hide an ended match."""
        with self._lock:
            match = self._get_match(match_id)
            if caller_id == match.owner_user_id:
                self._store.delete_match(match_id)
                return
            if match.status != "over":
                raise ForbiddenError(
                    "only the owner can delete a match that is not over"
                )
            self._get_seat(match, caller_id)
            self._save(
                replace(
                    match,
                    hidden_for_user_ids=match.hidden_for_user_ids | {caller_id},
                )
            )

    # Debugging

    def all_data(self) -> AllData:
        """A consistent snapshot of everything in the store, for debugging tools."""
        with self._lock:
            return AllData(
                users=self._store.list_users(),
                game_versions=self._store.list_all_game_versions(),
                matches=self._store.list_all_matches(),
            )

    # Helpers; callers must hold [_lock].

    def _get_game(self, game_id: str) -> Game:
        game = self._store.get_game(game_id)
        if game is None:
            raise NotFoundError("game not found")
        return game

    def _rules_of(self, match: Match) -> GameRules:
        game = self._store.get_game_version(match.game_id, match.game_version)
        if game is None:
            raise RuntimeError(
                f"match {match.id} refers to missing game version "
                f"{match.game_id} v{match.game_version}"
            )
        return game.rules

    def _get_live_game(self, game_id: str) -> Game:
        game = self._get_game(game_id)
        if game.deleted:
            raise ConflictError("the game has been deleted")
        return game

    def _get_owned_game(self, *, caller_id: str, game_id: str) -> Game:
        game = self._get_game(game_id)
        if game.owner_user_id != caller_id:
            raise ForbiddenError("only the game's creator can change it")
        return self._get_live_game(game_id)

    def _get_match(self, match_id: str) -> Match:
        match = self._store.get_match(match_id)
        if match is None:
            raise NotFoundError("match not found")
        return match

    def _get_owned_match(self, *, caller_id: str, match_id: str) -> Match:
        match = self._get_match(match_id)
        if match.owner_user_id != caller_id:
            raise ForbiddenError("only the match's owner can do this")
        return match

    def _get_seat(self, match: Match, user_id: str) -> Seat:
        seat = match.seat_of(user_id)
        if seat is None:
            raise ForbiddenError("you are not a player in this match")
        return seat

    def _check_fits(self, rules: GameRules, *, num_players: int) -> None:
        if num_players > rules.max_players:
            raise InvalidRequestError(
                f"{num_players} players is more than the game's maximum of "
                f"{rules.max_players}"
            )

    def _check_player_indices(
        self, match: Match, player_indices: frozenset[int]
    ) -> None:
        for player_index in sorted(player_indices):
            if not 0 <= player_index < len(match.seats):
                raise InvalidRequestError(
                    f"player index {player_index} is not a seat in this match"
                )

    def _mover_seat(self, match: Match, seat: Seat) -> Seat:
        """The seat the move is recorded for: the caller's own seat when it's their
        turn, or a computer's seat when a human moves on its behalf."""
        turn = match.turn_of_player_indices
        assert turn is not None
        if seat.player_index in turn:
            return seat
        if seat.kind == "human":
            computer_index = min(
                (index for index in turn if match.seats[index].kind == "computer"),
                default=None,
            )
            if computer_index is not None:
                return match.seats[computer_index]
        raise ConflictError("it is not your turn")

    def _take_seat_mid_match(self, match: Match, *, user_id: str) -> tuple[Seat, ...]:
        rules = self._rules_of(match)
        if not rules.allows_join_mid_match:
            raise ConflictError("this game does not allow joining a match in progress")
        computer_seat = next(
            (seat for seat in match.seats if seat.kind == "computer"), None
        )
        if computer_seat is not None:
            return _replace_seat(
                match.seats, replace(computer_seat, kind="human", user_id=user_id)
            )
        if len(match.seats) < rules.max_players:
            new_seat = Seat(
                player_index=len(match.seats), kind="human", user_id=user_id
            )
            return (*match.seats, new_seat)
        raise ConflictError("the match is full")

    def _ended_by_leaving(self, match: Match) -> Match:
        return replace(
            match, status="over", turn_of_player_indices=None, end_reason="player_left"
        )

    def _save(self, match: Match) -> Match:
        match = replace(match, updated_at=self._clock())
        self._store.put_match(match)
        return match
