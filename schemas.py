"""Request and response bodies of the HTTP API."""

import base64
import datetime as dt
from typing import Annotated, Final, Literal
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    StrictBool,
    model_validator,
)
from jsonschema.exceptions import SchemaError
from game_platform.game_schemas import compile_game_schemas

from game_platform.models import (
    MAX_PLAYERS,
    MIN_PLAYERS,
    EndReason,
    Game,
    GameTestSeeds,
    GameVersionError,
    Invite,
    InviteAcceptance,
    LinkedAccount,
    Match,
    Feedback,
    MatchStatus,
    Move,
    Seat,
    SeatKind,
    Translation,
    User,
    WebPushSubscription,
)
from game_platform.i18n import LOCALE_CODES, Locale, get_locale, normalize_locale
from game_platform.service import GameStrings, TranslationBundle

Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)
]
PlayerCount = Annotated[int, Field(ge=MIN_PLAYERS, le=MAX_PLAYERS)]


def _check_locale(tag: str) -> str:
    """A language tag such as "es" or "pt-BR" becomes its supported language code; the
    empty string means no language chosen."""
    if tag == "":
        return ""
    code = normalize_locale(tag)
    if code is None:
        raise ValueError(f"unsupported language; supported: {', '.join(LOCALE_CODES)}")
    return code


LocaleCode = Annotated[str, AfterValidator(_check_locale)]


def _check_player_counts(counts: list[int]) -> list[int]:
    if len(set(counts)) != len(counts):
        raise ValueError("must not contain duplicates")
    return sorted(counts)


PlayerCounts = Annotated[
    list[PlayerCount], Field(min_length=1), AfterValidator(_check_player_counts)
]


def _check_player_indices(indices: list[int]) -> list[int]:
    if len(set(indices)) != len(indices):
        raise ValueError("must not contain duplicates")
    return sorted(indices)


PlayerIndex = Annotated[int, Field(ge=0)]
# The seats that may move next: a non-empty set of player indices, in order.
PlayerIndices = Annotated[
    list[PlayerIndex], Field(min_length=1), AfterValidator(_check_player_indices)
]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GameSchemas(_Request):
    """Draft 2020-12 schemas for game-defined JSON values."""

    state: JsonValue
    move: JsonValue
    view: JsonValue

    @model_validator(mode="after")
    def _check_schemas(self) -> "GameSchemas":
        try:
            compile_game_schemas(self.model_dump())
        except (SchemaError, TypeError, ValueError) as error:
            raise ValueError(f"invalid game JSON Schema: {error}") from error
        return self


def _example(example: dict[str, JsonValue]) -> ConfigDict:
    """Config adding an example body to the OpenAPI schema, used by the API console."""
    return ConfigDict(json_schema_extra={"examples": [example]})


_TIC_TAC_TOE_BOARD: Final[list[JsonValue]] = [""] * 9


class UserCreate(_Request):
    model_config = _example({"display_name": "alice", "locale": "es"})

    display_name: Name
    # The user's preferred language (see GET /i18n/locales); responses to their requests
    # are in it unless a request says otherwise.
    locale: LocaleCode = ""
    # The user whose invite link brought this person here: their 5-digit referral code
    # or their user id (older links). Recorded only when this creates a new account.
    # Unknown codes and ids are ignored.
    invited_by_user_id: str | None = None
    # The match invite (POST /matches/{id}/invites) the person arrived through, if
    # any; its creator is recorded as the inviter when [invited_by_user_id] isn't
    # given. Unknown or unusable tokens are ignored.
    invite_token: str | None = None


class UserUpdate(_Request):
    """Omitted fields are left unchanged. A [locale] of "" clears the preference."""

    model_config = _example({"display_name": "alice the great", "locale": "fr"})

    display_name: Name | None = None
    locale: LocaleCode | None = None

    @model_validator(mode="after")
    def _require_a_change(self) -> "UserUpdate":
        if not self.model_fields_set:
            raise ValueError("give display_name, locale or both")
        for field in sorted(self.model_fields_set):
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class UserOut(BaseModel):
    id: str
    display_name: str
    picture_url: str = ""
    # The user's preferred language code; empty if they haven't chosen one.
    locale: str = ""
    # Set when this account was merged into another one; every use of it
    # resolves to the surviving user. (get_user/authenticate always return the
    # survivor, so this is None there; debug tools may surface it.)
    replaced_by_user_id: str | None = None
    # Ids of every user this account replaced, oldest first. Empty for replaced
    # users.
    replaced_user_ids: list[str] = []
    created_at: dt.datetime
    updated_at: dt.datetime
    token_balance: int = 0
    last_token_grant_day: str | None = None
    # The user's own short invite code (links look like /r/<code>). Only in responses
    # about the caller's own account; None for other users.
    referral_code: str | None = None

    @classmethod
    def of(cls, user: User, *, own: bool = False) -> "UserOut":
        return cls(
            id=user.id,
            referral_code=user.referral_code if own else None,
            display_name=user.display_name,
            picture_url=user.picture_url,
            locale=user.locale,
            token_balance=user.token_balance,
            last_token_grant_day=user.last_token_grant_day,
            replaced_by_user_id=user.replaced_by_user_id,
            replaced_user_ids=list(user.replaced_user_ids),
            created_at=user.created_at,
            updated_at=user.updated_at,
        )


class UserWithPasswordOut(UserOut):
    """Returned by POST /users and the debug tools only."""

    # Send it as the X-User-Password header, along with X-User-Id.
    password: str
    linked_accounts: list["LinkedAccountOut"] = []

    @classmethod
    def of_user(cls, user: User) -> "UserWithPasswordOut":
        return cls(
            **UserOut.of(user, own=True).model_dump(),
            password=user.password,
            linked_accounts=[LinkedAccountOut.of(a) for a in user.linked_accounts],
        )


class LinkedAccountOut(BaseModel):
    """A login method linked to the caller's own account. Never exposed for other users."""

    kind: str
    identifier: str
    linked_at: dt.datetime

    @classmethod
    def of(cls, account: LinkedAccount) -> "LinkedAccountOut":
        return cls(
            kind=account.kind,
            identifier=account.identifier,
            linked_at=account.linked_at,
        )


class AuthResponse(BaseModel):
    """The credential to use from now on: [user_id] as X-User-Id and [password] as
    X-User-Password. [merged_from_user_id] is set when this login merged another of
    the caller's accounts into this one."""

    user_id: str
    display_name: str
    email: str = ""
    picture_url: str = ""
    password: str
    linked_accounts: list[LinkedAccountOut] = []
    merged_from_user_id: str | None = None
    # The user's short invite code, for invite links (/r/<code>).
    referral_code: str | None = None

    @classmethod
    def of(cls, user: User, merged_from_user_id: str | None = None) -> "AuthResponse":
        return cls(
            referral_code=user.referral_code,
            user_id=user.id,
            display_name=user.display_name,
            email=user.email,
            picture_url=user.picture_url,
            password=user.password,
            linked_accounts=[LinkedAccountOut.of(a) for a in user.linked_accounts],
            merged_from_user_id=merged_from_user_id,
        )


class GoogleLogin(_Request):
    # The ID token from the website's Sign in with Google button.
    id_token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    # The user whose invite link brought this person here: a 5-digit referral code or
    # a user id. Recorded only when this creates a new account; unknown ones are ignored.
    invited_by_user_id: str | None = None


class PhoneStart(_Request):
    model_config = _example({"phone_number": "+15551234567"})

    phone_number: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    delivery_method: Literal["sms", "call"] = "sms"


class EmailStart(_Request):
    model_config = _example({"email": "player@example.com"})

    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class VerificationStarted(BaseModel):
    verification_id: str
    # The code stops working this many seconds after it was sent.
    expires_in_seconds: int


class VerifyCode(_Request):
    model_config = _example({"verification_id": "<id>", "code": "123456"})

    verification_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    # The new account's display name, used only on first login with this credential.
    display_name: Name | None = None
    # The user whose invite link brought this person here: a 5-digit referral code or
    # a user id. Recorded only when this creates a new account; unknown ones are ignored.
    invited_by_user_id: str | None = None


class MergeRequest(_Request):
    model_config = _example(
        {"into_user_id": "<user id>", "into_password": "<that user's password>"}
    )

    # The account that survives. Everything of the URL's user moves into it.
    into_user_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    # The surviving account's password (its X-User-Password), proving the caller
    # controls it too. Without it anyone could merge into any public user id.
    into_password: Annotated[str, StringConstraints(min_length=1)]


class AuthConfigOut(BaseModel):
    """Which login methods the website should offer. Public information."""

    google_client_id: str
    phone_login_enabled: bool
    phone_call_enabled: bool = False
    email_login_enabled: bool


# Web push


def _check_endpoint(url: str) -> str:
    """A push endpoint must be a real https URL (http only for local development)."""
    parsed = urlsplit(url)
    if parsed.scheme == "https" and parsed.hostname:
        return url
    if parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        return url
    raise ValueError("endpoint must be an https URL")


def _decode_b64url(value: str, field: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except ValueError:
        raise ValueError(f"keys.{field} must be base64url") from None


def _check_p256dh(value: str) -> str:
    """The browser's P-256 public key: 65 bytes (uncompressed point), base64url."""
    if len(_decode_b64url(value, "p256dh")) != 65:
        raise ValueError("keys.p256dh must decode to 65 bytes")
    return value


def _check_auth_secret(value: str) -> str:
    """The subscription's auth secret (RFC 8291): at least 16 bytes, base64url."""
    if not 16 <= len(_decode_b64url(value, "auth")) <= 64:
        raise ValueError("keys.auth must decode to 16..64 bytes")
    return value


class PushSubscriptionKeys(_Request):
    model_config = _example(
        {
            "p256dh": "BOr1wEXAMPLEKEY",
            "auth": "k8J6EXAMPLEAUTH",
        }
    )

    p256dh: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=256),
        AfterValidator(_check_p256dh),
    ]
    auth: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=128),
        AfterValidator(_check_auth_secret),
    ]


class PushSubscribe(_Request):
    """The browser's PushSubscription (PushSubscription.toJSON()), keyed by endpoint."""

    model_config = _example(
        {
            "endpoint": "https://push.example.com/subscription/abc",
            "keys": {"p256dh": "BOr1wEXAMPLEKEY", "auth": "k8J6EXAMPLEAUTH"},
            "expiration_time": None,
        }
    )

    endpoint: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=2048),
        AfterValidator(_check_endpoint),
    ]
    keys: PushSubscriptionKeys
    # When the browser says the subscription lapses (PushSubscription.expirationTime);
    # null means it didn't say.
    expiration_time: dt.datetime | None = None


class PushSubscriptionOut(BaseModel):
    """One of the caller's subscriptions. The keys are not returned: the browser that
    owns the subscription already has them, and nobody else should."""

    id: str
    endpoint: str
    expiration_time: dt.datetime | None
    created_at: dt.datetime

    @classmethod
    def of(cls, subscription: WebPushSubscription) -> "PushSubscriptionOut":
        return cls(
            id=subscription.id,
            endpoint=subscription.endpoint,
            expiration_time=subscription.expiration_time,
            created_at=subscription.created_at,
        )


class PushConfigOut(BaseModel):
    """Whether web push is set up, and the VAPID public key browsers subscribe with.
    Public information."""

    enabled: bool
    vapid_public_key: str


class GameUpdate(_Request):
    """Omitted fields are left unchanged."""

    model_config = _example({"description": "Three in a row wins; draws are replayed"})

    name: Name | None = None
    description: str | None = None
    allowed_player_counts: PlayerCounts | None = None
    allows_leave_mid_match: bool | None = None
    allows_join_mid_match: bool | None = None
    code: str | None = None
    # The v2 names for the two parts of a game.
    client_code: str | None = None
    server_code: str | None = None
    game_schemas: GameSchemas | None = None

    @model_validator(mode="after")
    def _reject_explicit_nulls(self) -> "GameUpdate":
        for field in sorted(self.model_fields_set):
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class GameSummaryOut(BaseModel):
    """A game without its code: what a game list needs, at a fraction of the size."""

    id: str
    version: int
    owner_user_id: str
    name: str
    description: str
    allowed_player_counts: list[int]
    allows_leave_mid_match: bool
    allows_join_mid_match: bool
    game_schemas: GameSchemas | None = Field(
        default=None, exclude_if=lambda value: value is None
    )
    created_at: dt.datetime
    updated_at: dt.datetime
    deleted: bool
    published: bool
    supports_local_practice: bool = True
    cover_url: str = ""

    @classmethod
    def of(cls, game: Game) -> "GameSummaryOut":
        return cls(
            id=game.id,
            version=game.version,
            owner_user_id=game.owner_user_id,
            name=game.name,
            description=game.description,
            allowed_player_counts=list(game.rules.allowed_player_counts),
            allows_leave_mid_match=game.rules.allows_leave_mid_match,
            allows_join_mid_match=game.rules.allows_join_mid_match,
            game_schemas=game.game_schemas,
            created_at=game.created_at,
            updated_at=game.updated_at,
            deleted=game.deleted,
            published=game.published,
            supports_local_practice=True,
            cover_url=f"/games/{game.id}/versions/{game.version}/cover" if (game.import_package or {}).get("images") else "",
        )


class GameOut(GameSummaryOut):
    game_logic_rules: str = ""
    game_ui_rules: str = ""
    tutorial_html: str = ""
    translations: dict[str, JsonValue] = {}
    code: str
    # The two parts of a game: [client_code] is the same code as [code];
    # [server_code] runs the game's logic on the server. Every game has both.
    client_code: str
    server_code: str | None = None

    @classmethod
    def of(cls, game: Game) -> "GameOut":
        return cls(
            **GameSummaryOut.of(game).model_dump(),
            game_logic_rules=(game.import_package or {}).get("rules_text", ""),
            game_ui_rules=(game.import_package or {}).get("ui_text", ""),
            tutorial_html=(game.import_package or {}).get("tutorial", {}).get("html", ""),
            translations=(game.import_package or {}).get("translations", {}),
            code=game.code,
            client_code=game.code,
            server_code=game.server_code,
        )


class FeedbackCreate(_Request):
    model_config = _example(
        {"kind": "bug", "target_type": "game", "target_id": "", "text": "The board doesn't show on my phone"}
    )

    # A bug, a suggestion (or feature request), or a problem (problematic content).
    kind: Literal["bug", "suggestion", "problem"]
    # What it's about: a user, a game or a match by id, or the platform itself
    # (with target_id left out or empty).
    target_type: Literal["user", "game", "match", "platform"]
    target_id: str = ""
    # The feedback in the sender's words: 5 to 1000 characters after trimming
    # (checked by the server, which answers 400 otherwise).
    text: str
    # The page it came from (for admins); optional.
    page: str | None = None


class FeedbackOut(BaseModel):
    """Feedback as its own sender sees it."""

    id: str
    kind: str
    target_type: str
    target_id: str
    text: str
    status: str
    created_at: dt.datetime
    updated_at: dt.datetime

    @classmethod
    def of(cls, feedback: "Feedback") -> "FeedbackOut":
        return cls(
            id=feedback.id,
            kind=feedback.kind,
            target_type=feedback.target_type,
            target_id=feedback.target_id,
            text=feedback.text,
            status=feedback.status,
            created_at=feedback.created_at,
            updated_at=feedback.updated_at,
        )


class MatchCreate(_Request):
    model_config = _example({"game_id": "", "num_computer_opponents": 1})

    game_id: str
    num_computer_opponents: Annotated[int, Field(ge=0)] = 0
    # Private matches aren't listed as open and can only be joined with an invite.
    private: bool = False
    bet_per_player: Annotated[int, Field(ge=0, le=1000000)] = 0
    # The v2 name for [bet_per_player]: the most tokens each human can lose in
    # the match, staked into the pot when they join. Wins over bet_per_player
    # when both are sent.
    max_loss: Annotated[int, Field(ge=0, le=1000000)] | None = None

    @property
    def effective_bet_per_player(self) -> int:
        return self.max_loss if self.max_loss is not None else self.bet_per_player
    # A speed match: the seconds each player has to move, 60, 180 or 600. Omit it
    # (or send null) for a regular match with no time limit.
    turn_seconds: int | None = None


class QuickMatchRequest(_Request):
    model_config = _example({"game_id": "", "num_players": 2})

    game_id: str
    # How many humans to wait for; defaults to the game's smallest count above one.
    num_players: PlayerCount | None = None


class MatchUpdate(_Request):
    model_config = _example({"num_computer_opponents": 1})

    num_computer_opponents: Annotated[int, Field(ge=0)]


class MoveCreate(_Request):
    model_config = _example({"move": {"type": "roll"}})

    # The game-defined move; the server computes the new state by running
    # the game's server code. Clients never send a state.
    move: JsonValue
    # If given, the move is rejected unless the match has exactly this many moves.
    expected_move_count: int | None = None


class SeatTimeoutOut(BaseModel):
    """A seat whose time to move ran out in a speed match."""

    player_index: int
    user_id: str
    at: dt.datetime


class PlayerOut(BaseModel):
    player_index: int
    kind: SeatKind
    user_id: str | None
    # The player id: the human's user id, or "computer-N" (see
    # [Match.player_id_of]). Empty only for a seat-less construction.
    id: str = ""
    active: bool = True

    @classmethod
    def of(cls, seat: Seat, player_id: str = "") -> "PlayerOut":
        return cls(
            player_index=seat.player_index, kind=seat.kind,
            user_id=seat.user_id, id=player_id, active=seat.active,
        )


class MatchOut(BaseModel):
    id: str
    game_id: str
    game_version: int
    owner_user_id: str
    status: MatchStatus
    end_reason: EndReason | None
    players: list[PlayerOut]
    turn_of_player_indices: list[int] | None
    state: JsonValue
    move_count: int
    bet_per_player: int = 0
    # The v2 name for [bet_per_player]: the stake each human put in the pot.
    max_loss: int = 0
    token_pot: int = 0
    token_payouts: dict[int, int] | None = None
    # The pending leave preview's public parts — who would leave and what
    # they would be paid. The preview's resulting state is
    # server-only and is never in a response. The match's seed is likewise
    # server-only and is never in a response: it keys every random draw in
    # the match, so exposing it would let anyone predict future rolls.
    pending_leave_player_id: str | None = None
    pending_leave_payout: int | None = None
    pending_leave_ends_match: bool | None = None
    rematch_match_id: str | None
    created_at: dt.datetime
    updated_at: dt.datetime
    private: bool = False
    # Set on quick matches: how many players it waits for before starting itself.
    matchmaking_player_count: int | None = None
    # Speed matches: seconds per move (None for a regular match); when the human
    # seats with the turn run out of time (None when there's no running clock); and
    # seats that ran out of time.
    turn_seconds: int | None = None
    turn_deadline: dt.datetime | None = None
    timeouts: list[SeatTimeoutOut] = []
    # The server's time when this response was made, so clients can show a
    # countdown to [turn_deadline] even if the device's clock is off. (Left out of
    # data dumps, which describe stored data rather than a moment.)
    server_time: dt.datetime | None = None

    @classmethod
    def of(cls, match: Match, now: dt.datetime | None = None) -> "MatchOut":
        return cls(
            turn_seconds=match.turn_seconds,
            turn_deadline=match.turn_deadline,
            timeouts=[
                SeatTimeoutOut(player_index=t.player_index, user_id=t.user_id, at=t.at)
                for t in match.timeouts
            ],
            server_time=now,
            id=match.id,
            game_id=match.game_id,
            game_version=match.game_version,
            owner_user_id=match.owner_user_id,
            status=match.status,
            end_reason=match.end_reason,
            players=[
                PlayerOut.of(seat, player_id=match.player_id_of(seat))
                for seat in match.seats
            ],
            turn_of_player_indices=None
            if match.turn_of_player_indices is None
            else sorted(match.turn_of_player_indices),
            state=match.state,
            move_count=len(match.moves),
            bet_per_player=match.bet_per_player,
            max_loss=match.bet_per_player,
            pending_leave_player_id=(
                match.pending_leave.get("player_id")
                if isinstance(match.pending_leave, dict)
                else None
            ),
            pending_leave_payout=(
                match.pending_leave.get("payout")
                if isinstance(match.pending_leave, dict)
                else None
            ),
            pending_leave_ends_match=(
                bool(match.pending_leave.get("end") or match.pending_leave.get("turn") is None)
                if isinstance(match.pending_leave, dict) else None
            ),
            token_pot=match.token_pot,
            token_payouts=match.token_payouts,
            rematch_match_id=match.rematch_match_id,
            created_at=match.created_at,
            updated_at=match.updated_at,
            private=match.private,
            matchmaking_player_count=match.matchmaking_player_count,
        )


class MatchResultOut(BaseModel):
    """The outcome of a finished match, as the game reports it in its
    state: the winning seat, or a draw. Small enough for list responses,
    which show "you won / you lost / draw" badges without the state."""

    winner: int | None = None
    draw: bool = False
    done: bool = False

    @classmethod
    def of(cls, match: Match) -> "MatchResultOut | None":
        if match.status != "over":
            return None
        state = match.state
        if not isinstance(state, dict):
            return None
        winner = state.get("winner")
        if not isinstance(winner, int) or isinstance(winner, bool):
            winner = None
        result = cls(
            winner=winner,
            draw=state.get("draw") is True,
            done=state.get("done") is True,
        )
        return result if winner is not None or result.draw or result.done else None


class MatchSummaryOut(BaseModel):
    """A match without its state: what match lists need, at a fraction of
    the size — and building one never runs the game's view code, which a
    full [MatchOut] needs once per match for server-side games. The one
    thing lists did read from the state, who won, travels as [result]."""

    id: str
    game_id: str
    game_version: int
    owner_user_id: str
    status: MatchStatus
    end_reason: EndReason | None
    players: list[PlayerOut]
    turn_of_player_indices: list[int] | None
    move_count: int
    bet_per_player: int = 0
    max_loss: int = 0
    token_pot: int = 0
    token_payouts: dict[int, int] | None = None
    pending_leave_player_id: str | None = None
    pending_leave_payout: int | None = None
    rematch_match_id: str | None
    created_at: dt.datetime
    updated_at: dt.datetime
    private: bool = False
    matchmaking_player_count: int | None = None
    turn_seconds: int | None = None
    turn_deadline: dt.datetime | None = None
    timeouts: list[SeatTimeoutOut] = []
    server_time: dt.datetime | None = None
    result: MatchResultOut | None = None

    @classmethod
    def of(cls, match: Match, now: dt.datetime | None = None) -> "MatchSummaryOut":
        full = MatchOut.of(match, now=now).model_dump(exclude={"state"})
        return cls(**full, result=MatchResultOut.of(match))


class MoveOut(BaseModel):
    move_number: int
    player_index: int
    made_by_user_id: str
    created_at: dt.datetime
    # The state after the move, as the requesting player may see it: their
    # own view of it, never the full state (the handlers substitute the
    # view; [of] alone carries the recorded state and is only used where a
    # view was already computed or no state leaves the server).
    new_state: JsonValue
    next_turn_player_indices: list[int] | None
    # The submitting human's own move only; null for other viewers. The
    # public resulting action belongs in the game's projected view.
    move: JsonValue = None
    player_id: str | None = None

    @classmethod
    def of(cls, move: Move, *, caller_id: str | None = None) -> "MoveOut":
        return cls(
            move_number=move.move_number,
            player_index=move.player_index,
            made_by_user_id=move.made_by_user_id,
            created_at=move.created_at,
            new_state=move.new_state,
            # A move can contain a sealed bid or the identities of face-down
            # cards. Only its author may recover it (e.g. offline deduplication).
            move=move.move if caller_id and move.made_by_user_id == caller_id else None,
            player_id=move.player_id,
            next_turn_player_indices=None
            if move.next_turn_player_indices is None
            else sorted(move.next_turn_player_indices),
        )


class MatchHistoryOut(BaseModel):
    # Every state here is the requester's own view of it — a seated
    # player's viewFor, or the game's spectator view for anyone else
    # (see [GamePlatform.view_history]): a full state is never in a
    # response.
    initial_state: JsonValue
    initial_turn_player_indices: list[int] | None
    moves: list[MoveOut]

    @classmethod
    def of(
        cls, match: Match, initial_view: JsonValue, move_views: list[JsonValue],
        *, caller_id: str | None = None,
    ) -> "MatchHistoryOut":
        return cls(
            initial_state=initial_view,
            initial_turn_player_indices=None if match.initial_turn_player_indices is None else sorted(match.initial_turn_player_indices),
            moves=[
                MoveOut.of(move, caller_id=caller_id).model_copy(update={"new_state": view})
                for move, view in zip(match.moves, move_views)
            ],
        )


class GameVersionErrorOut(BaseModel):
    """A server-code failure recorded on a game version (Game API)."""

    id: str
    game_id: str
    game_version: int
    function: str
    message: str
    created_at: dt.datetime

    @classmethod
    def of(cls, error: GameVersionError) -> "GameVersionErrorOut":
        return cls(
            id=error.id, game_id=error.game_id, game_version=error.game_version,
            function=error.function, message=error.message,
            created_at=error.created_at,
        )


class GameTestSeedsOut(BaseModel):
    """The failed random-walk test seeds stored on a game (v2 Game API)."""

    game_id: str
    seeds: list[int] = []

    @classmethod
    def of(cls, record: GameTestSeeds) -> "GameTestSeedsOut":
        return cls(game_id=record.game_id, seeds=list(record.seeds))


class LocaleOut(BaseModel):
    code: str
    # The language's own name, for a language picker.
    name: str
    english_name: str
    # "rtl" languages (Arabic) need a mirrored layout.
    direction: Literal["ltr", "rtl"]

    @classmethod
    def of(cls, locale: Locale) -> "LocaleOut":
        return cls(
            code=locale.code,
            name=locale.name,
            english_name=locale.english_name,
            direction=locale.direction,
        )


class LocalesOut(BaseModel):
    default: str
    locales: list[LocaleOut]


class CatalogOut(BaseModel):
    """Every text a frontend can ask for in one language."""

    locale: str
    direction: Literal["ltr", "rtl"]
    # Changes exactly when a text does; also the ETag, so clients can cache the catalog.
    version: str
    messages: dict[str, str]


# Invites and referrals

_MAX_INVITE_LIFETIME_SECONDS: Final = 30 * 24 * 3600


class InviteCreate(_Request):
    model_config = _example({"expires_in_seconds": 86400, "max_uses": 1})

    # Omit for a link that never expires (it still stops working when the match ends).
    expires_in_seconds: Annotated[
        int, Field(ge=60, le=_MAX_INVITE_LIFETIME_SECONDS)
    ] | None = None
    # Omit for unlimited uses.
    max_uses: Annotated[int, Field(ge=1, le=MAX_PLAYERS)] | None = None


class InviteAcceptanceOut(BaseModel):
    user_id: str
    accepted_at: dt.datetime
    # True when this user created their account through the invite link.
    signed_up: bool

    @classmethod
    def of(cls, acceptance: InviteAcceptance) -> "InviteAcceptanceOut":
        return cls(
            user_id=acceptance.user_id,
            accepted_at=acceptance.accepted_at,
            signed_up=acceptance.signed_up,
        )


class InviteLinks(BaseModel):
    """Where an invite leads: [url] opens the portal at the invite; [qr_code_url] is an
    SVG QR code of [url], for showing on a screen or printing."""

    url: str
    qr_code_url: str

    @classmethod
    def of(cls, token: str, base_url: str) -> "InviteLinks":
        base_url = base_url.rstrip("/")
        return cls(
            url=f"{base_url}/portal#invite={token}",
            qr_code_url=f"{base_url}/invites/{token}/qr.svg",
        )


class InviteOut(InviteLinks):
    """An invite as its creator sees it, with its referral stats."""

    token: str
    match_id: str
    created_by_user_id: str
    created_at: dt.datetime
    expires_at: dt.datetime | None
    max_uses: int | None
    revoked: bool
    # How many times the link was opened, and who took a seat with it.
    views: int
    acceptances: list[InviteAcceptanceOut]

    @classmethod
    def of_invite(cls, invite: Invite, *, base_url: str) -> "InviteOut":
        return cls(
            **InviteLinks.of(invite.token, base_url).model_dump(),
            token=invite.token,
            match_id=invite.match_id,
            created_by_user_id=invite.created_by_user_id,
            created_at=invite.created_at,
            expires_at=invite.expires_at,
            max_uses=invite.max_uses,
            revoked=invite.revoked,
            views=invite.views,
            acceptances=[InviteAcceptanceOut.of(a) for a in invite.acceptances],
        )


class InviteViewOut(BaseModel):
    """What anyone holding an invite link sees: enough to decide whether to join,
    without the creator's referral stats."""

    token: str
    match: MatchOut
    game_name: str
    created_by_user_id: str
    created_by_display_name: str
    expires_at: dt.datetime | None
    # False when the link can't seat anyone new; [unusable_reason] says why (in the
    # request's language) and [unusable_code] names the reason in every language.
    usable: bool
    unusable_reason: str | None = None
    unusable_code: str | None = None


class ReferralsOut(BaseModel):
    """The caller's invite links and who came through them."""

    invites_created: int
    # Totals over every invite: link opens, seats taken, and accounts created.
    views: int
    acceptances: int
    sign_ups: int
    referred_users: list[UserOut]
    invites: list[InviteOut]


class ExperimentVariantCreate(_Request):
    name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    key: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            min_length=1,
            max_length=50,
            pattern=r"^[a-z0-9][a-z0-9-]*$",
        ),
    ]


class CampaignLinkCreate(ExperimentVariantCreate):
    budget_usd: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)] = 100


class CampaignSpendUpdate(_Request):
    spend_usd: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]


class ExperimentActiveUpdate(_Request):
    active: StrictBool


class ExperimentVariantOut(BaseModel):
    variant_id: str
    name: str
    key: str


class SkinAssignmentOut(BaseModel):
    variant_id: str
    name: str
    key: str


class HealthOut(BaseModel):
    """For uptime checks and load balancers: 200 with "ok", or 503 with "degraded"."""

    status: Literal["ok", "degraded"]
    uptime_seconds: int
    # "ok", or the kind of error that stops the data file from being saved.
    storage: str


class BatchSubRequest(_Request):
    """One GET request inside a /batch call: the method (always GET) and the path,
    including any query string. A bare path string is also accepted."""

    method: str = "GET"
    path: str


class BatchSubResponse(BaseModel):
    """One sub-request's result, in the same order as the request: its HTTP status
    and its JSON body (null when the response had no body)."""

    status: int
    body: JsonValue | None = None


class GameStringsOut(BaseModel):
    """A game version's texts in one language. A game shows its own texts where there is
    no translation, so every text is always present."""

    game_id: str
    game_version: int
    locale: str
    direction: Literal["ltr", "rtl"]
    # "source": the language needs no translation (English); "translated": every text;
    # "partial": some; "unavailable": none (no translator is set up, or it failed).
    status: Literal["source", "translated", "partial", "unavailable"]
    name: str
    description: str
    # Whether the game has a string table (a block `id="i18n-strings"` in its code).
    translatable: bool
    # key -> text, from the game's string table.
    strings: dict[str, str]
    # Why the game may translate badly.
    warnings: list[str]

    @classmethod
    def of(cls, strings: GameStrings) -> "GameStringsOut":
        return cls(
            game_id=strings.game_id,
            game_version=strings.game_version,
            locale=strings.locale,
            direction=get_locale(strings.locale).direction,
            status=strings.status,  # type: ignore[arg-type]
            name=strings.name,
            description=strings.description,
            translatable=strings.translatable,
            strings=strings.strings,
            warnings=strings.warnings,
        )


class GameTextOut(BaseModel):
    name: str
    description: str


class GamesTextOut(BaseModel):
    """The names and descriptions of the published games in one language."""

    locale: str
    direction: Literal["ltr", "rtl"]
    status: Literal["source", "translated", "partial", "unavailable"]
    games: dict[str, GameTextOut]


class BundleGameOut(BaseModel):
    """One published game's texts inside a [BundleOut]."""

    # The version these texts belong to (the game's latest).
    version: int
    name: str
    description: str
    # "source", "translated", "partial" or "unavailable", for this game's texts alone.
    status: Literal["source", "translated", "partial", "unavailable"]
    # Whether the game has a string table (a game without one has empty `strings`).
    translatable: bool
    # key -> text; every key of the game's table, as the game wrote it where untranslated.
    strings: dict[str, str]


class BundleOut(BaseModel):
    """Everything a frontend needs to show the platform and its games in one language."""

    locale: str
    direction: Literal["ltr", "rtl"]
    # "source", "translated", "partial" or "unavailable" for all the games' texts together.
    status: Literal["source", "translated", "partial", "unavailable"]
    # The interface catalog, as GET /i18n/{locale} answers it.
    catalog: CatalogOut
    # Published games by id.
    games: dict[str, BundleGameOut]

    @classmethod
    def of(cls, bundle: TranslationBundle, catalog: "CatalogOut") -> "BundleOut":
        return cls(
            locale=bundle.locale,
            direction=get_locale(bundle.locale).direction,
            status=bundle.status,  # type: ignore[arg-type]
            catalog=catalog,
            games={
                game_id: BundleGameOut(
                    version=game.version,
                    name=game.name,
                    description=game.description,
                    status=game.status,  # type: ignore[arg-type]
                    translatable=game.translatable,
                    strings=game.strings,
                )
                for game_id, game in bundle.games.items()
            },
        )


class TranslationOut(BaseModel):
    locale: str
    source_hash: str
    source: str
    text: str
    # "google" (machine) or "manual" (an administrator's).
    provider: str
    reviewed: bool
    created_at: dt.datetime

    @classmethod
    def of(cls, translation: Translation) -> "TranslationOut":
        return cls(
            locale=translation.locale,
            source_hash=translation.source_hash,
            source=translation.source,
            text=translation.text,
            provider=translation.provider,
            reviewed=translation.reviewed,
            created_at=translation.created_at,
        )


class TranslationSet(_Request):
    model_config = _example({"locale": "es", "source": "{name} wins!", "text": "¡{name} gana!"})

    locale: LocaleCode
    source: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
    text: Annotated[str, StringConstraints(min_length=1, max_length=1000)]
