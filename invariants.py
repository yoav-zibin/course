"""Pure validation of caller-supplied data. Never reads or changes the live store."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, StrictInt, model_validator


class Record(BaseModel):
    # Full exported records may contain unrelated fields. Only this projection is used.
    model_config = ConfigDict(extra="ignore")


class UserRecord(Record):
    id: str
    replaced_by_user_id: str | None = None
    replaced_user_ids: list[str] = Field(default_factory=list)
    token_balance: StrictInt = 0
    linked_accounts: list[dict[str, JsonValue]] = Field(default_factory=list)


class RulesRecord(Record):
    allowed_player_counts: list[StrictInt]
    allows_join_mid_match: bool = False
    allows_leave_mid_match: bool = False


class GameRecord(Record):
    id: str
    version: StrictInt
    owner_user_id: str
    rules: RulesRecord
    server_code: str | None = None


class SeatRecord(Record):
    player_index: StrictInt
    kind: Literal["human", "computer"]
    user_id: str | None = None


class MoveRecord(Record):
    move_number: StrictInt
    player_index: StrictInt
    made_by_user_id: str
    next_turn_player_indices: list[StrictInt] | None


class TimeoutRecord(Record):
    player_index: StrictInt
    user_id: str


class MatchRecord(Record):
    id: str
    game_id: str
    game_version: StrictInt
    owner_user_id: str
    status: Literal["waiting_for_players", "ongoing", "over"]
    seats: list[SeatRecord] = Field(max_length=10)
    moves: list[MoveRecord] = Field(max_length=10000)
    turn_of_player_indices: list[StrictInt] | None
    initial_turn_player_indices: list[StrictInt] | None = None
    end_reason: str | None = None
    timeouts: list[TimeoutRecord] = Field(default_factory=list)
    hidden_for_user_ids: list[str] = Field(default_factory=list)


class InvariantRequest(Record):
    users: list[UserRecord] = Field(max_length=10000)
    games: list[GameRecord] = Field(max_length=10000)
    matches: list[MatchRecord] = Field(max_length=1000)

    @model_validator(mode="after")
    def total_history_limit(self):
        if sum(len(match.moves) for match in self.matches) > 50000:
            raise ValueError("At most 50000 moves may be validated per request")
        return self



class Violation(BaseModel):
    code: str
    path: str
    message: str


class InvariantReport(BaseModel):
    valid: bool
    violations: list[Violation]
    warnings: list[Violation]
    truncated: bool = False


def check_invariants(data: InvariantRequest) -> InvariantReport:
    """References are checked against the supplied closed dataset, not production.

    Move authorization uses the PREVIOUS turn set (or recorded initial turn).
    Current seat ownership is deliberately not used to authorize historical moves.
    """
    errors: list[Violation] = []
    warnings: list[Violation] = []
    truncated = False

    def add(code, path, message, *, warning=False):
        nonlocal truncated
        if len(errors) + len(warnings) >= 1000:
            truncated = True
            return
        (warnings if warning else errors).append(Violation(code=code, path=path, message=message))

    def index(records, key, label):
        result = {}
        for i, record in enumerate(records):
            k = key(record)
            if k in result:
                add("duplicate_record", f"{label}[{i}]", "Record key occurs more than once.")
            else:
                result[k] = record
        return result

    users = index(data.users, lambda u: u.id, "users")
    games = index(data.games, lambda g: (g.id, g.version), "games")
    index(data.matches, lambda m: m.id, "matches")

    def user_ref(uid, path):
        user = users.get(uid)
        if user is None:
            add("missing_user", path, "Referenced user is absent from the supplied dataset.")
        elif user.replaced_by_user_id is not None:
            add("replaced_user_reference", path, "Ownership or participation still references a replaced user.")

    for i, u in enumerate(data.users):
        p = f"users[{i}]"
        if u.token_balance < 0:
            add("negative_balance", p, "Token balance cannot be negative.")
        if u.replaced_by_user_id is not None and u.token_balance:
            add("replaced_user_balance", p, "Replaced account retains inaccessible tokens.")
        target = users.get(u.replaced_by_user_id)
        if u.replaced_by_user_id is not None:
            if target is None:
                add("missing_replacement", p, "Replacement target is absent.")
            elif target.id == u.id or target.replaced_by_user_id is not None:
                add("replacement_not_terminal", p, "Replacement must point directly to a different surviving user.")
            elif u.id not in target.replaced_user_ids:
                add("replacement_backlink", p, "Survivor does not list this replaced user.")
            if u.linked_accounts or u.replaced_user_ids:
                add("replaced_user_assets", p, "Replaced user retains linked accounts or replacement ownership.")
        if len(set(u.replaced_user_ids)) != len(u.replaced_user_ids):
            add("duplicate_replacement", p, "Replacement list has duplicates.")
        for uid in u.replaced_user_ids:
            if uid not in users or users[uid].replaced_by_user_id != u.id:
                add("replacement_backlink", p, "Listed replaced user does not point back to this survivor.")

    for i, g in enumerate(data.games):
        p = f"games[{i}]"
        user_ref(g.owner_user_id, p + ".owner_user_id")
        counts = g.rules.allowed_player_counts
        if g.version < 1:
            add("game_version", p, "Game version must be positive.")
        if not counts or len(set(counts)) != len(counts) or any(n < 1 or n > 10 for n in counts):
            add("player_counts", p + ".rules", "Allowed counts must be unique integers between 1 and 10.")

    for i, m in enumerate(data.matches):
        p = f"matches[{i}]"
        user_ref(m.owner_user_id, p + ".owner_user_id")
        game = games.get((m.game_id, m.game_version))
        if game is None:
            add("missing_game_version", p, "Pinned game version is absent from the supplied dataset.")
        indices = [s.player_index for s in m.seats]
        if indices != list(range(len(indices))):
            add("seat_indices", p + ".seats", "Seats must have contiguous ordered indices starting at zero.")
        humans = [s.user_id for s in m.seats if s.kind == "human"]
        # Merging two former players in a completed match intentionally duplicates ownership.
        if m.status != "over" and len(set(humans)) != len(humans):
            add("duplicate_human", p + ".seats", "An active user occupies multiple human seats.")
        for j, seat in enumerate(m.seats):
            sp = f"{p}.seats[{j}]"
            if seat.kind == "human":
                user_ref(seat.user_id, sp + ".user_id")
            elif seat.user_id is not None:
                add("computer_user", sp, "Computer seats cannot have an account owner.")
        for j, timeout in enumerate(m.timeouts):
            user_ref(timeout.user_id, f"{p}.timeouts[{j}].user_id")
        for uid in m.hidden_for_user_ids:
            user_ref(uid, p + ".hidden_for_user_ids")

        def turns(value, path):
            if value is not None and (not value or len(set(value)) != len(value) or not set(value) <= set(indices)):
                add("invalid_turn_set", path, "Turn must contain unique existing seats, or be null.")

        turns(m.turn_of_player_indices, p + ".turn_of_player_indices")
        turns(m.initial_turn_player_indices, p + ".initial_turn_player_indices")
        if (m.status == "ongoing") != (m.turn_of_player_indices is not None):
            add("status_turn", p, "Only ongoing matches may have a current turn, and they must have one.")
        if m.status == "waiting_for_players" and m.moves:
            add("waiting_history", p, "A waiting match cannot contain moves.")
        if m.status == "over" and m.end_reason is None:
            add("end_reason", p, "A completed match must have an end reason.")
        if m.status != "over" and m.end_reason is not None:
            add("end_reason", p, "An unfinished match cannot have an end reason.")
        if game and game.rules.allowed_player_counts and len(m.seats) > max(game.rules.allowed_player_counts):
            add("too_many_seats", p, "Seat count exceeds the pinned game's maximum.")
        dynamic_history = bool(game and game.server_code and (game.rules.allows_join_mid_match or game.rules.allows_leave_mid_match))
        if dynamic_history:
            add("membership_history_unavailable", p, "Server game membership callbacks can change turns outside move history; cross-move authorization checks are skipped.", warning=True)
        previous = m.initial_turn_player_indices
        if m.moves and previous is None:
            add("initial_turn_unavailable", p, "Legacy history has no initial turn; first-move authorization cannot be checked.", warning=True)
        for j, move in enumerate(m.moves):
            mp = f"{p}.moves[{j}]"
            if move.move_number != j + 1:
                add("move_number", mp, "Move numbers must be consecutive, starting at one.")
            if move.player_index not in indices:
                add("move_seat", mp, "Move names a nonexistent seat.")
            # Server-generated v2 computer moves deliberately use an empty author.
            if move.made_by_user_id or not (game and game.server_code):
                user_ref(move.made_by_user_id, mp + ".made_by_user_id")
            if j > 0 and previous is None:
                add("move_after_terminal", mp, "Move follows a terminal move.")
            elif not dynamic_history and previous is not None and move.player_index not in previous:
                add("out_of_turn_move", mp, "Mover was not in the preceding turn set.")
            turns(move.next_turn_player_indices, mp + ".next_turn_player_indices")
            previous = move.next_turn_player_indices
        if m.moves and previous is None and m.status != "over":
            add("terminal_status", p, "A terminal move must end the match.")
        if not dynamic_history and m.moves and m.status == "ongoing" and previous != m.turn_of_player_indices:
            # Sets are unordered on the wire.
            if previous is None or set(previous) != set(m.turn_of_player_indices or []):
                add("history_current_turn", p, "Current turn differs from the last move's next turn.")
    return InvariantReport(valid=not errors and not truncated, violations=errors, warnings=warnings, truncated=truncated)
