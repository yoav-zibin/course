"""Business rules of the game platform, independent of HTTP.

Every public method takes the caller's user id (already authenticated) where identity
matters, and raises a subclass of [PlatformError] when a request can't be honored.
"""

import collections
from game_platform.move_history import append_move
import datetime as dt
import hashlib
import hmac
import json
import math
import re
import secrets
import threading
import time
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, replace
from typing import Any, Final

from pydantic import JsonValue

import logging

from game_platform import game_messages, game_text, i18n, observability
from game_platform.avatars import user_avatar, USER_AVATARS, computer_avatar
from game_platform.models import (
    Experiment,
    ExperimentAssignment,
    ExperimentEvent,
    ExperimentEventKind,
    ExperimentKind,
    ExperimentVariant,
    Game,
    GameRules,
    GameTestSeeds,
    GameVersionError,
    Invite,
    InviteAcceptance,
    LinkedAccount,
    LinkedAccountKind,
    Match,
    Feedback,
    MatchStatus,
    Move,
    PayoutOutcome,
    SeatTimeout,
    Seat,
    Translation,
    User,
    WebPushSubscription,
)
from game_platform.game_logic import (
    TIME_LIMIT_SECONDS,
    GameLogic,
    GameLogicError,
    GameLogicTimeout,
    InvalidMoveError,
)
from game_platform.game_testing import (
    GameTestReport,
    TestFailure,
    test_server_code,
)
from game_platform.push import LogPushNotifier, PushMessage, PushNotifier
from game_platform.store import InMemoryStore, Store
from game_platform import translation as translation_module
from game_platform.translation import Translator, TranslationService


@dataclass(frozen=True, kw_only=True)
class InviteView:
    """What an invite link shows to whoever opens it."""

    invite: Invite
    match: Match
    game_name: str
    inviter: User
    # Why the invite can't seat anyone new (an English error message), or None.
    problem: str | None


@dataclass(frozen=True, kw_only=True)
class GameStrings:
    """A game version's texts in one language (see game_text.py and translation.py)."""

    game_id: str
    game_version: int
    locale: str
    # "source" (the language wanted needs no translation), "translated", "partial" or
    # "unavailable" (no translator, or it failed): see translation.Translated.
    status: str
    name: str
    description: str
    # The game's string table with each text in [locale] where there is a translation, and
    # as the game wrote it where there is not. Empty when the game has no table.
    strings: dict[str, str]
    # Whether the game has a string table (a game without one shows only its own texts).
    translatable: bool
    # Why the game may translate badly (game_text.lint), in plain words.
    warnings: list[str]


@dataclass(frozen=True, kw_only=True)
class BundleGame:
    """One published game's texts in a [TranslationBundle]."""

    version: int
    name: str
    description: str
    # "source", "translated", "partial" or "unavailable", for this game's texts alone.
    status: str
    # Whether the game has a string table; [strings] is empty if not.
    translatable: bool
    strings: dict[str, str]


@dataclass(frozen=True, kw_only=True)
class TranslationBundle:
    """Everything a portal needs to show games in one language, in one piece."""

    locale: str
    # "source", "translated", "partial" or "unavailable", for all the texts together.
    status: str
    games: dict[str, BundleGame]


@dataclass(frozen=True, kw_only=True)
class AllData:
    users: list[User]
    # Every version of every game, including deleted games.
    game_versions: list[Game]
    matches: list[Match]
    # Server-code failures recorded on game versions (v2 Game API), admin-only.
    game_version_errors: list[GameVersionError] = ()
    # Failed random-walk test seeds per game (v2 Game API), admin-only.
    game_test_seeds: list[GameTestSeeds] = ()


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


class GameMessageError(InvalidRequestError):
    """A text the game's own server code wrote (the reason of an InvalidMove): answered 400
    like InvalidRequestError, and translated for the viewer through the game version's string
    table (see game_messages.py). [key] and [params] are set when a template of the table
    matches the text; [template] is that template in English."""

    def __init__(
        self,
        message: str,
        *,
        game_id: str,
        game_version: int,
        key: str | None = None,
        template: str | None = None,
        params: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.game_id = game_id
        self.game_version = game_version
        self.key = key
        self.template = template
        self.params = params or {}


class ConflictError(PlatformError):
    """The resource's current state doesn't allow this transition."""


class TooManyRequestsError(PlatformError):
    """The caller did this too often; trying again later works."""


# Feedback: the text's length after trimming, and how many messages one person can
# send in a rolling 24 hours (sending the same kind of feedback on the same target
# again within 24 hours updates it instead), and how many the admin listing shows.
# Computer-move chains hold the platform lock while they run. A chain may
# spend at most this long per run (after a minimum burst of actions, so
# short chains still finish synchronously) before it continues on a timer.
_CHAIN_TIME_BUDGET_SECONDS: Final = 0.25
_CHAIN_MIN_ACTIONS_PER_RUN: Final = 64
# A chain killed by a game-call timeout is re-armed this many times (with
# this delay) before the platform gives up on it until the next trigger.
_CHAIN_TIMEOUT_RETRY_LIMIT: Final = 3
_CHAIN_TIMEOUT_RETRY_DELAY_SECONDS: Final = 5.0

FEEDBACK_TEXT_MIN: Final = 5
FEEDBACK_TEXT_MAX: Final = 1000
FEEDBACK_PER_DAY: Final = 20
FEEDBACK_WINDOW: Final = dt.timedelta(hours=24)
FEEDBACK_ADMIN_LIMIT: Final = 200
FEEDBACK_KINDS: Final = ("bug", "suggestion", "problem")
FEEDBACK_TARGET_TYPES: Final = ("user", "game", "match", "platform")


@dataclass(frozen=True, kw_only=True)
class RecentFeedback:
    """One of a person's feedback messages in the last 24 hours: enough to apply the
    daily limit and to find a repeat, without loading the message itself."""

    id: str
    target_type: str
    target_id: str
    kind: str
    created_at: dt.datetime


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _new_id() -> str:
    return str(uuid.uuid4())


def _new_password() -> str:
    return secrets.token_urlsafe(16)


def _new_invite_token() -> str:
    # 96 random bits: short enough for a QR code, impossible to guess.
    return secrets.token_urlsafe(12)


def _new_verification_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


# Speed matches: the allowed seconds per move (1, 3 or 10 minutes). None is a regular
# match with no clock. Kept as a list so more choices can be added later.
SPEED_TURN_SECONDS: Final = (60, 180, 600)
# How long the other humans in a v1 paid match have to agree to the pot split the
# final move proposed. Without every agreement by then, every stake is refunded.
PAYOUT_AGREEMENT_SECONDS: Final = 3600

# playerLeft calls get a longer time budget than other game functions:
# a playerLeft may price its payout with ctx.estimateWinChance, whose
# Monte-Carlo walks take about a second.
PLAYER_LEFT_TIME_LIMIT_SECONDS: Final = 2.0

# How many failed random-walk test seeds are kept per game and replayed
# first on the next test run (regression seeds, Phase 5).
MAX_STORED_TEST_SEEDS: Final = 20
SKIN_EXPERIMENT_ID: Final = "ui-skins"
CAMPAIGN_EXPERIMENT_ID: Final = "ad-campaigns"
RETURNING_WINDOW: Final = dt.timedelta(days=7)
PILOT_SKINS: Final = (
    ExperimentVariant(id="skin-classic", name="Classic", key="classic"),
    ExperimentVariant(id="skin-aurora", name="Aurora", key="aurora"),
    ExperimentVariant(id="skin-sunset", name="Sunset", key="sunset"),
)
PILOT_CAMPAIGNS: Final = (
    ExperimentVariant(
        id="campaign-students-a",
        name="Student campaign A",
        key="students-a",
        budget_usd=100,
    ),
    ExperimentVariant(
        id="campaign-students-b",
        name="Student campaign B",
        key="students-b",
        budget_usd=100,
    ),
    ExperimentVariant(
        id="campaign-students-c",
        name="Student campaign C",
        key="students-c",
        budget_usd=100,
    ),
)


# Referral codes: 5-digit numbers with no leading zero, so always 5 characters.
REFERRAL_CODE_MIN: Final = 10_000
REFERRAL_CODE_MAX: Final = 99_999
# What an invite's "ref" looks like when it's a code rather than a user id.
_REFERRAL_CODE_RE: Final = re.compile(r"\d{5}")


# Sentinel for "argument not passed" in update_game: server_code/game_schemas
# may be explicitly set to None (removing them), so None cannot mean "unchanged".
UNSET: Final = object()


def _new_referral_code() -> str:
    return str(REFERRAL_CODE_MIN + secrets.randbelow(REFERRAL_CODE_MAX - REFERRAL_CODE_MIN + 1))


# Login codes sent by text/email live this long, survive this many wrong guesses, and
# can be re-requested this often per identifier (sliding window of one hour).
VERIFICATION_TTL_SECONDS: Final = 600
VERIFICATION_MAX_ATTEMPTS: Final = 5
VERIFICATION_MAX_STARTS_PER_HOUR: Final = 5

# Survivor precedence when two accounts merge: the user with the strongest
# login method survives, so a Google account is never merged away into a guest
# account. Guests have no linked accounts.
_ACCOUNT_KIND_RANK: Final = {"google": 3, "phone": 2, "email": 1}


def _account_rank(user: User) -> int:
    """The strength of a user's best linked login method (0 for guests)."""
    return max(
        (_ACCOUNT_KIND_RANK.get(account.kind, 0) for account in user.linked_accounts),
        default=0,
    )


def _dedupe(ids: tuple[str, ...]) -> tuple[str, ...]:
    """Removes duplicates, keeping the first occurrence of each id."""
    seen: set[str] = set()
    out: list[str] = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return tuple(out)


def _normalize_identifier(*, kind: str, identifier: str) -> str:
    """Validates and canonicalizes a phone number or email address."""
    if kind == "phone":
        normalized = re.sub(r"[\s\-().]", "", identifier)
        if not re.fullmatch(r"\+\d{7,15}", normalized):
            raise InvalidRequestError(
                "phone_number must be in E.164 format, e.g. +15551234567"
            )
        return normalized
    if kind == "email":
        normalized = identifier.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            raise InvalidRequestError("email doesn't look like an email address")
        return normalized
    raise InvalidRequestError(f"unknown verification kind: {kind!r}")


def _clean_display_name(name: str) -> str:
    """A provider-supplied name, made safe for a new account."""
    name = name.strip()
    if len(name) > 200:
        name = name[:200].rstrip()
    return name or "Player"


def _refresh_profile_from_provider(
    user: User, *, display_name: str, email: str, picture_url: str
) -> User:
    """Refreshes provider name/email while retaining the account's animal avatar."""
    updates: dict = {}
    if display_name and display_name != user.display_name:
        updates["display_name"] = display_name
    if email and email != user.email:
        updates["email"] = email
    if user.picture_url not in USER_AVATARS:
        updates["picture_url"] = user_avatar(user.picture_url)
    return replace(user, **updates) if updates else user


@dataclass(kw_only=True)
class _Verification:
    """A pending login-code check. Kept in memory only: a restart invalidates codes,
    and the owner just requests a new one."""

    id: str
    kind: LinkedAccountKind
    identifier: str
    code: str
    created_at: dt.datetime
    attempts: int = 0


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
    RECENT_GAME_LIMIT = 8

    def __init__(
        self,
        *,
        store: Store | None = None,
        clock: Callable[[], dt.datetime] = _utc_now,
        new_id: Callable[[], str] = _new_id,
        new_password: Callable[[], str] = _new_password,
        new_verification_code: Callable[[], str] = _new_verification_code,
        new_invite_token: Callable[[], str] = _new_invite_token,
        new_referral_code: Callable[[], str] = _new_referral_code,
        push_notifier: PushNotifier | None = None,
        max_push_subscriptions_per_user: int = 10,
        computer_move_delay_seconds: float = 0.6,
        translator: Translator | None = None,
        translation_daily_character_limit: int = 200_000,
        bundle_wait_seconds: float = 3.0,
        bundle_games_ttl_seconds: float = 10.0,
        require_game_strings: bool = False,
    ) -> None:
        self._store: Store = store if store is not None else InMemoryStore()
        missing_game_schemas = sorted(
            (game.id, game.version)
            for game in self._store.list_all_game_versions()
            if game.server_code is not None and game.game_schemas is None
        )
        if missing_game_schemas:
            sample = ", ".join(
                f"{game_id}@{version}"
                for game_id, version in missing_game_schemas[:20]
            )
            remaining = len(missing_game_schemas) - 20
            details = f"{sample}, and {remaining} more" if remaining > 0 else sample
            logging.getLogger(__name__).error(
                "%d server-side game versions are missing required game_schemas: %s. "
                "Starting in degraded mode: schema-less game logic remains blocked; "
                "add game_schemas to these versions before re-enabling those games.",
                len(missing_game_schemas),
                details,
            )
        self._clock = clock
        self._translation = TranslationService(
            self._store,
            translator,
            clock=clock,
            daily_character_limit=translation_daily_character_limit,
        )
        # Translation bundles (see translation_bundle): how long a request waits for the
        # translator, and how long the list of games is reused between requests.
        self._bundle_wait_seconds = bundle_wait_seconds
        # translation.require_strings: refuse client code without a passing string table.
        self._require_game_strings = require_game_strings
        self._bundle_games_ttl_seconds = bundle_games_ttl_seconds
        self._bundle_games: tuple[float, list[Game]] | None = None
        self._bundle_tables: dict[tuple[str, int], tuple[dict[str, str] | None]] = {}
        # The compiled server-text templates of each game version (game_messages.py), kept
        # in memory: a version's code never changes.
        self._server_templates: dict[tuple[str, int], tuple[game_messages.Template, ...]] = {}
        self._bundle_jobs: dict[str, threading.Event] = {}
        self._bundle_jobs_lock = threading.Lock()
        self._new_id = new_id
        self._new_password = new_password
        self._new_verification_code = new_verification_code
        self._new_invite_token = new_invite_token
        self._new_referral_code = new_referral_code
        self._push_notifier = (
            push_notifier if push_notifier is not None else LogPushNotifier()
        )
        self._max_push_subscriptions_per_user = max_push_subscriptions_per_user
        # How long the server waits before a computer opponent moves in a v2
        # match, so humans can watch the game unfold. Zero moves immediately
        # (tests use zero: no timers, fully deterministic).
        self._computer_move_delay_seconds = computer_move_delay_seconds
        # One QuickJS runner per game version; versions are immutable, so a
        # cached runner's code can never go stale.
        self._logic_cache: dict[tuple[str, int], GameLogic] = {}
        # viewFor results by (match id, caller): match records are immutable
        # and replaced wholesale on every change, so a cached view stays
        # valid exactly while the same Match object is current. The entry
        # holds the object itself, both as the validity check and to keep
        # its identity from being recycled while the entry lives.
        self._view_cache: dict[tuple[str, str | None], tuple[Match, JsonValue]] = {}
        # Consecutive computer-chain timeouts per match, so a stalled chain
        # is re-armed a bounded number of times instead of dying silently.
        self._chain_timeout_retries: dict[str, int] = {}
        self._verifications: dict[str, _Verification] = {}
        self._verification_starts: dict[str, list[dt.datetime]] = {}
        # Each public method is a read-modify-write on the store; the server handles
        # requests on a thread pool, so serialize them. Reentrant, because verifying a
        # code and merging accounts compose smaller locked operations.
        self._lock = getattr(self._store, "operation_lock", None) or threading.RLock()
        # User id -> (when it was read, the language they saved), so the language of a
        # response doesn't cost a database read on every request.
        self._saved_locales: dict[str, tuple[float, str]] = {}
        # Referral code -> the user id it was given to (possibly merged away since,
        # which resolves to the survivor like any old id).
        self._user_ids_by_code: dict[str, str] = {}
        self._give_missing_referral_codes()

    def _ensure_pilot_experiments(
        self, *, created_at: dt.datetime | None = None
    ) -> None:
        with self._lock:
            existing = {experiment.id for experiment in self._store.list_experiments()}
            if SKIN_EXPERIMENT_ID not in existing:
                now = created_at or self._clock()
                self._store.put_experiment(
                    Experiment(
                        id=SKIN_EXPERIMENT_ID,
                        name="UI skin pilot",
                        kind="skin",
                        active=True,
                        variants=PILOT_SKINS,
                        created_at=now,
                        updated_at=now,
                    )
                )
            if CAMPAIGN_EXPERIMENT_ID not in existing:
                now = created_at or self._clock()
                self._store.put_experiment(
                    Experiment(
                        id=CAMPAIGN_EXPERIMENT_ID,
                        name="Advertisement campaign pilot",
                        kind="campaign",
                        active=True,
                        variants=PILOT_CAMPAIGNS,
                        created_at=now,
                        updated_at=now,
                    )
                )

    def _active_experiment(self, experiment_id: str) -> Experiment:
        self._ensure_pilot_experiments()
        experiment = next(
            (
                experiment
                for experiment in self._store.list_experiments()
                if experiment.id == experiment_id
            ),
            None,
        )
        if experiment is None:
            raise NotFoundError("experiment not found")
        return experiment

    def list_experiments(self) -> list[Experiment]:
        self._ensure_pilot_experiments()
        with self._lock:
            return self._store.list_experiments()

    def set_experiment_active(self, *, experiment_id: str, active: bool) -> Experiment:
        with self._lock:
            experiment = self._active_experiment(experiment_id)
            updated = replace(
                experiment, active=active, updated_at=self._clock()
            )
            self._store.put_experiment(updated)
            return updated

    def add_experiment_variant(
        self,
        *,
        experiment_id: str,
        name: str,
        key: str,
        budget_usd: float | None = None,
    ) -> tuple[Experiment, ExperimentVariant]:
        with self._lock:
            experiment = self._active_experiment(experiment_id)
            if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,49}", key):
                raise InvalidRequestError(
                    "variant key must be 1-50 lowercase letters, digits or hyphens"
                )
            if any(variant.key == key for variant in experiment.variants):
                raise ConflictError("a variant with that key already exists")
            if experiment.kind == "campaign" and (
                budget_usd is None
                or not isinstance(budget_usd, (int, float))
                or isinstance(budget_usd, bool)
                or not math.isfinite(budget_usd)
                or budget_usd < 0
                or budget_usd > 100
            ):
                raise InvalidRequestError("campaign budget must be between $0 and $100")
            variant = ExperimentVariant(
                id=self._new_id(),
                name=name.strip(),
                key=key,
                budget_usd=budget_usd,
            )
            updated = replace(
                experiment,
                variants=(*experiment.variants, variant),
                updated_at=self._clock(),
            )
            self._store.put_experiment(updated)
            return updated, variant

    def set_campaign_spend(self, *, variant_id: str, spend_usd: float) -> ExperimentVariant:
        with self._lock:
            experiment = self._active_experiment(CAMPAIGN_EXPERIMENT_ID)
            variant = next(
                (item for item in experiment.variants if item.id == variant_id), None
            )
            if variant is None:
                raise NotFoundError("campaign link not found")
            if (
                not isinstance(spend_usd, (int, float))
                or isinstance(spend_usd, bool)
                or not math.isfinite(spend_usd)
                or spend_usd < 0
                or (variant.budget_usd is not None and spend_usd > variant.budget_usd)
            ):
                raise InvalidRequestError("spend must be between $0 and the campaign budget")
            updated_variant = replace(variant, spend_usd=float(spend_usd))
            updated_experiment = replace(
                experiment,
                variants=tuple(
                    updated_variant if item.id == variant_id else item
                    for item in experiment.variants
                ),
                updated_at=self._clock(),
            )
            self._store.put_experiment(updated_experiment)
            return updated_variant

    def delete_experiment_variant(
        self, *, experiment_id: str, variant_id: str
    ) -> None:
        with self._lock:
            experiment = self._active_experiment(experiment_id)
            variant = next(
                (item for item in experiment.variants if item.id == variant_id), None
            )
            if variant is None:
                raise NotFoundError("experiment not found")

            self._store.put_experiment(
                replace(
                    experiment,
                    variants=tuple(
                        item for item in experiment.variants if item.id != variant_id
                    ),
                    updated_at=self._clock(),
                )
            )
            for assignment in self._store.list_experiment_assignments():
                if (
                    assignment.experiment_id == experiment_id
                    and assignment.variant_id == variant_id
                ):
                    self._store.delete_experiment_assignment(
                        user_id=assignment.user_id,
                        experiment_id=experiment_id,
                    )
            for event in self._store.list_experiment_events():
                if (
                    event.experiment_id == experiment_id
                    and event.variant_id == variant_id
                ):
                    self._store.delete_experiment_event(event.id)

    def assign_skin(
        self, *, user_id: str, assigned_at: dt.datetime | None = None
    ) -> ExperimentVariant | None:
        with self._lock:
            self._ensure_pilot_experiments(created_at=assigned_at)
            experiment = self._active_experiment(SKIN_EXPERIMENT_ID)
            if not experiment.active or not experiment.variants:
                return None
            assignment = self._store.get_experiment_assignment(
                user_id=user_id, experiment_id=experiment.id
            )
            by_id = {variant.id: variant for variant in experiment.variants}
            if assignment is not None and assignment.variant_id in by_id:
                return by_id[assignment.variant_id]
            digest = hashlib.sha256(user_id.encode("utf-8")).digest()
            variant = experiment.variants[
                int.from_bytes(digest[:8], "big") % len(experiment.variants)
            ]
            self._store.put_experiment_assignment(
                ExperimentAssignment(
                    user_id=user_id,
                    experiment_id=experiment.id,
                    variant_id=variant.id,
                    assigned_at=assigned_at or self._clock(),
                )
            )
            return variant

    def _record_experiment_event(
        self,
        *,
        experiment_id: str,
        variant_id: str,
        kind: ExperimentEventKind,
        user_id: str | None,
        match_id: str | None = None,
        occurred_at: dt.datetime | None = None,
    ) -> ExperimentEvent:
        events = [] if getattr(self._store, "scalable", False) else self._store.list_experiment_events()
        duplicate = next(
            (
                event
                for event in events
                if event.experiment_id == experiment_id
                and event.variant_id == variant_id
                and event.kind == kind
                and event.user_id == user_id
                and event.match_id == match_id
            ),
            None,
        )
        if duplicate is not None:
            return duplicate
        event_identity = json.dumps(
            [experiment_id, variant_id, kind, user_id, match_id],
            separators=(",", ":"),
        )
        event_id = hashlib.sha256(event_identity.encode()).hexdigest()
        if getattr(self._store, "scalable", False):
            existing = self._store._get("experiment_events", f"experiment-event:{event_id}")
            if existing is not None:
                return existing
        event = ExperimentEvent(
            id=f"experiment-event:{event_id}",
            experiment_id=experiment_id,
            variant_id=variant_id,
            kind=kind,
            user_id=user_id,
            occurred_at=occurred_at or self._clock(),
            match_id=match_id,
        )
        self._store.put_experiment_event(event)
        return event

    def record_campaign_click(self, *, campaign_code: str) -> None:
        with self._lock:
            experiment = self._active_experiment(CAMPAIGN_EXPERIMENT_ID)
            if not experiment.active:
                raise NotFoundError("campaign link not found")
            variant = next(
                (v for v in experiment.variants if v.key == campaign_code), None
            )
            if variant is None:
                raise NotFoundError("campaign link not found")
            now = self._clock()
            event_id = f"click:{experiment.id}:{variant.id}:{now.date().isoformat()}"
            existing = self._store._get("experiment_events", event_id) if getattr(self._store, "scalable", False) else next(
                (
                    event
                    for event in self._store.list_experiment_events()
                    if event.id == event_id
                ),
                None,
            )
            if existing is None:
                self._store.put_experiment_event(
                    ExperimentEvent(
                        id=event_id,
                        experiment_id=experiment.id,
                        variant_id=variant.id,
                        kind="click",
                        user_id=None,
                        occurred_at=now,
                    )
                )
            else:
                self._store.put_experiment_event(
                    replace(existing, count=existing.count + 1)
                )

    def record_new_user(
        self,
        *,
        user_id: str,
        campaign_code: str | None,
        occurred_at: dt.datetime | None = None,
    ) -> None:
        with self._lock:
            self._ensure_pilot_experiments(created_at=occurred_at)
            variant = self.assign_skin(user_id=user_id, assigned_at=occurred_at)
            experiment = self._active_experiment(SKIN_EXPERIMENT_ID)
            if variant is not None:
                self._record_experiment_event(
                    experiment_id=experiment.id,
                    variant_id=variant.id,
                    kind="signup",
                    user_id=user_id,
                    occurred_at=occurred_at,
                )
            if campaign_code:
                campaign = next(
                    (
                        item
                        for item in self._store.list_experiments()
                        if item.id == CAMPAIGN_EXPERIMENT_ID and item.active
                    ),
                    None,
                )
                campaign_variant = (
                    next(
                        (v for v in campaign.variants if v.key == campaign_code),
                        None,
                    )
                    if campaign is not None
                    else None
                )
                if campaign is not None and campaign_variant is not None:
                    self._record_experiment_event(
                        experiment_id=campaign.id,
                        variant_id=campaign_variant.id,
                        kind="signup",
                        user_id=user_id,
                        occurred_at=occurred_at,
                    )

    def record_match_start(
        self, *, user_id: str, match_id: str, occurred_at: dt.datetime
    ) -> None:
        self._ensure_pilot_experiments(created_at=occurred_at)
        with self._lock:
            experiments = self._store.list_experiments()
            skin = next(
                (experiment for experiment in experiments if experiment.id == SKIN_EXPERIMENT_ID),
                None,
            )
            if skin is not None and skin.active:
                assignment = self._store.get_experiment_assignment(
                    user_id=user_id, experiment_id=skin.id
                )
                skin_variant = (
                    next(
                        (variant for variant in skin.variants if assignment.variant_id == variant.id),
                        None,
                    )
                    if assignment is not None
                    else self.assign_skin(
                        user_id=user_id, assigned_at=occurred_at
                    )
                )
                if skin_variant is not None:
                    self._record_experiment_event(
                        experiment_id=skin.id,
                        variant_id=skin_variant.id,
                        kind="match_start",
                        user_id=user_id,
                        match_id=match_id,
                        occurred_at=occurred_at,
                    )
            campaign = next(
                (experiment for experiment in experiments if experiment.id == CAMPAIGN_EXPERIMENT_ID),
                None,
            )
            account = self._store.get_user(user_id)
            survivor_ids = {
                user_id,
                *(account.replaced_user_ids if account is not None else ()),
            }
            events = (self._store.experiment_signups(survivor_ids, CAMPAIGN_EXPERIMENT_ID)
                      if getattr(self._store, "scalable", False) else self._store.list_experiment_events())
            campaign_signups = (
                [
                    event
                    for event in events
                    if campaign is not None
                    and event.experiment_id == campaign.id
                    and event.kind == "signup"
                    and event.user_id in survivor_ids
                ]
                if campaign is not None
                else []
            )
            campaign_signup = max(
                campaign_signups, key=lambda event: event.occurred_at, default=None
            )
            if campaign_signup is not None:
                self._record_experiment_event(
                    experiment_id=campaign.id,
                    variant_id=campaign_signup.variant_id,
                    kind="match_start",
                    user_id=user_id,
                    match_id=match_id,
                    occurred_at=occurred_at,
                )
            signup_experiments = [
                experiment
                for experiment in (skin, campaign)
                if experiment is not None
            ]
            for experiment in signup_experiments:
                if not experiment.active:
                    continue
                signup_events = [
                    event
                    for event in events
                    if event.experiment_id == experiment.id
                    and event.kind == "signup"
                    and event.user_id in survivor_ids
                    and event.occurred_at + RETURNING_WINDOW <= occurred_at
                    and event.occurred_at + RETURNING_WINDOW * 2 > occurred_at
                ]
                if signup_events:
                    assignment = self._store.get_experiment_assignment(
                        user_id=user_id, experiment_id=experiment.id
                    )
                    if experiment.id == CAMPAIGN_EXPERIMENT_ID:
                        variant_id = (
                            campaign_signup.variant_id
                            if campaign_signup is not None
                            else signup_events[0].variant_id
                        )
                    else:
                        variant_id = (
                            assignment.variant_id
                            if assignment is not None
                            else signup_events[0].variant_id
                        )
                    self._record_experiment_event(
                        experiment_id=experiment.id,
                        variant_id=variant_id,
                        kind="returning_active",
                        user_id=user_id,
                        occurred_at=occurred_at,
                    )

    def experiment_stats(self) -> dict[str, JsonValue]:
        self._ensure_pilot_experiments()
        with self._lock:
            experiments = self._store.list_experiments()
            assignments = self._store.list_experiment_assignments()
            events = self._store.list_experiment_events()
            users = self._store.list_users()
            now = self._clock()
        user_by_id = {user.id: user for user in users}

        def canonical(user_id: str | None) -> str | None:
            user = user_by_id.get(user_id or "")
            return (
                user.replaced_by_user_id
                if user is not None and user.replaced_by_user_id
                else user_id
            )

        def report(experiment_id: str) -> list[JsonValue]:
            experiment = next(
                (item for item in experiments if item.id == experiment_id), None
            )
            if experiment is None:
                return []
            rows: list[JsonValue] = []
            for variant in experiment.variants:
                variant_assignments = [
                    item
                    for item in assignments
                    if item.experiment_id == experiment.id
                    and item.variant_id == variant.id
                    and item.user_id in user_by_id
                    and user_by_id[item.user_id].replaced_by_user_id is None
                ]
                variant_events = [
                    item
                    for item in events
                    if item.experiment_id == experiment.id
                    and item.variant_id == variant.id
                ]
                clicks = sum(
                    item.count for item in variant_events if item.kind == "click"
                )
                signups = {
                    canonical(item.user_id)
                    for item in variant_events
                    if item.kind == "signup"
                } - {None}
                started = {
                    canonical(item.user_id)
                    for item in variant_events
                    if item.kind == "match_start"
                } - {None}
                returns = {
                    canonical(item.user_id)
                    for item in variant_events
                    if item.kind == "returning_active"
                } - {None}
                rows.append(
                    {
                        "variant_id": variant.id,
                        "name": variant.name,
                        "key": variant.key,
                        "link": f"/c/{variant.key}"
                        if experiment.kind == "campaign"
                        else None,
                        "budget_usd": variant.budget_usd,
                        "spend_usd": variant.spend_usd,
                        "assigned": len(variant_assignments),
                        "clicks": clicks,
                        "signups": len(signups),
                        "match_starts": sum(
                            item.kind == "match_start" for item in variant_events
                        ),
                        "users_started_match": len(started),
                        "returning_active_users": len(returns),
                        "signup_rate": round(len(signups) * 100 / clicks, 1)
                        if clicks
                        else 0,
                        "match_start_rate": round(len(started) * 100 / len(signups), 1)
                        if signups
                        else 0,
                        "return_rate": round(len(returns) * 100 / len(signups), 1)
                        if signups
                        else 0,
                        "cost_per_signup_usd": round(
                            variant.spend_usd / len(signups), 2
                        )
                        if signups and variant.spend_usd
                        else None,
                        "cost_per_match_user_usd": round(
                            variant.spend_usd / len(started), 2
                        )
                        if started and variant.spend_usd
                        else None,
                        "cost_per_returning_user_usd": round(
                            variant.spend_usd / len(returns), 2
                        )
                        if returns and variant.spend_usd
                        else None,
                    }
                )
            return rows

        return {
            "generated_at": now.isoformat(),
            "skin_experiment": {
                "id": SKIN_EXPERIMENT_ID,
                "name": next(
                    (item.name for item in experiments if item.id == SKIN_EXPERIMENT_ID),
                    "UI skin pilot",
                ),
                "active": next(
                    (item.active for item in experiments if item.id == SKIN_EXPERIMENT_ID),
                    False,
                ),
                "variants": report(SKIN_EXPERIMENT_ID),
            },
            "campaign_experiment": {
                "id": CAMPAIGN_EXPERIMENT_ID,
                "name": next(
                    (item.name for item in experiments if item.id == CAMPAIGN_EXPERIMENT_ID),
                    "Advertisement campaign pilot",
                ),
                "active": next(
                    (item.active for item in experiments if item.id == CAMPAIGN_EXPERIMENT_ID),
                    False,
                ),
                "variants": report(CAMPAIGN_EXPERIMENT_ID),
            },
        }

    # Users

    def create_user(
        self,
        *,
        display_name: str,
        email: str = "",
        picture_url: str = "",
        linked_accounts: tuple[LinkedAccount, ...] = (),
        locale: str = "",
        invited_by_user_id: str | None = None,
        invite_token: str | None = None,
        campaign_code: str | None = None,
    ) -> User:
        """[invited_by_user_id] is the user whose invite link brought this one here:
        their 5-digit referral code, or their user id (older links). Each new user
        gets a referral code of their own. An unknown code or id is ignored rather than rejected, so a stale or mistyped invite
        link never stops anyone from signing up; a merged-away id is recorded as the
        account it was merged into. [invite_token] is the match invite the user
        arrived through, if any: when [invited_by_user_id] names nobody, the invite's
        creator is recorded as the inviter. Unknown or unusable tokens are ignored
        for the same reason."""
        with self._lock:
            inviter_id = self._referrer_id(invited_by_user_id)
            via_token = None
            invite = self._store.get_invite(invite_token) if invite_token else None
            if invite is not None:
                try:
                    self._check_invite_usable(invite)
                    via_token = invite.token
                    inviter_id = inviter_id or self._existing_user_id(
                        invite.created_by_user_id
                    )
                except PlatformError:
                    pass
            now = self._clock()
            user_id = self._new_id()
            user = User(
                id=user_id,
                referral_code=self._take_referral_code(user_id),
                display_name=display_name,
                email=email,
                picture_url=user_avatar(picture_url.strip()),
                locale=locale,
                password=self._new_password(),
                linked_accounts=linked_accounts,
                invited_by_user_id=inviter_id,
                invited_via_invite_token=via_token,
                created_at=now,
                updated_at=now,
            )
            self._store.put_user(user)
            observability.current().note_signup(user.id)
            self.record_new_user(
                user_id=user.id,
                campaign_code=campaign_code,
                occurred_at=user.created_at,
            )
            return user

    def update_user(
        self,
        *,
        caller_id: str,
        user_id: str,
        display_name: str | None = None,
        locale: str | None = None,
    ) -> User:
        """Changes the given fields of a user; [None] leaves a field as it is."""
        with self._lock:
            user = self._store.get_user(user_id)
            if user is None:
                raise NotFoundError("user not found")
            if user.id != caller_id:
                raise ForbiddenError("users can only change themselves")
            changes: dict[str, str] = {}
            if display_name is not None and display_name != user.display_name:
                changes["display_name"] = display_name
            if locale is not None and locale != user.locale:
                changes["locale"] = locale
            if not changes:
                return user
            user = replace(user, updated_at=self._clock(), **changes)
            self._store.put_user(user)
            self._saved_locales.pop(user.id, None)
            return user

    SAVED_LOCALE_SECONDS = 60.0
    _SAVED_LOCALES_MAX = 10_000

    def cached_saved_locale(self, user_id: str | None) -> str | None:
        """What [saved_locale] would answer, from memory only (no database read), or None
        when it isn't remembered or is older than a minute. Safe to call from the event
        loop; [saved_locale] is not."""
        if not user_id:
            return ""
        entry = self._saved_locales.get(user_id)
        if entry is not None and time.monotonic() - entry[0] < self.SAVED_LOCALE_SECONDS:
            return entry[1]
        return None

    def saved_locale(self, user_id: str | None) -> str:
        """The language [user_id] chose, or empty if they chose none or don't exist.
        Not authenticated: it only picks the language of a response. One plain read, no
        lock or transaction (a stale answer for a minute is harmless), and it blocks on
        the database, so call it off the event loop."""
        if not user_id:
            return ""
        user = self._store.get_user(user_id)
        locale = user.locale if user is not None else ""
        if len(self._saved_locales) >= self._SAVED_LOCALES_MAX:
            self._saved_locales.clear()
        self._saved_locales[user_id] = (time.monotonic(), locale)
        return locale

    def get_user(self, user_id: str) -> User:
        # Reads only, so no lock: on Firestore the lock is a transaction (a round trip to
        # begin it, one to roll it back, and a lock on every document read), which is
        # costly for the most frequent call there is.
        user = self._store.get_user(user_id)
        if user is None:
            raise NotFoundError("user not found")
        return self._resolve_replaced(user)

    def get_users(self, user_ids: list[str]) -> list[User]:
        """The users for [user_ids], in request order, skipping unknown ids.

        Backs the portal's batched profile fetch: one API call instead of one
        request per visible player. Reads only, so no lock (see get_user); in
        snapshot mode the store is in memory, so the whole batch costs no
        Firestore fetches.
        """
        users = []
        for user_id in user_ids:
            user = self._store.get_user(user_id)
            if user is not None:
                users.append(self._resolve_replaced(user))
        return users

    def authenticate(self, *, user_id: str | None, password: str | None) -> User:
        """Checks the caller's credentials. The error doesn't say which part was wrong,
        so it can't be used to find out which user ids exist.

        A replaced user still authenticates with its old credentials; the
        returned user is the surviving account it was merged into.

        Reads only, so no lock (see [get_user]); nearly every request calls this.
        """
        user = None if user_id is None else self._store.get_user(user_id)
        if (
            user is None
            or password is None
            or not hmac.compare_digest(password.encode(), user.password.encode())
        ):
            raise UnauthorizedError(
                "missing or invalid X-User-Id / X-User-Password headers"
            )
        return self._resolve_replaced(user)

    # Third-party login and account merging

    def _require_user(self, user_id: str) -> User:
        user = self._store.get_user(user_id)
        if user is None:
            raise NotFoundError("user not found")
        return user

    def _find_by_linked_account(
        self, kind: LinkedAccountKind, identifier: str
    ) -> User | None:
        if getattr(self._store, "scalable", False):
            return self._store.find_linked_account(kind, identifier)
        return self._store.get_user_by_linked_account(kind, identifier)

    def _resolve_replaced(self, user: User) -> User:
        """Returns the surviving user for a replaced account.

        Merges always flatten, so a replaced user points directly at the final
        survivor: this is a single lookup. The extra hop below is purely
        defensive (it should never trigger) so a corrupt record can never make
        this return a replaced user. Reads only: callers may or may not hold the lock.
        """
        if user.replaced_by_user_id is None:
            return user
        survivor = self._store.get_user(user.replaced_by_user_id)
        if survivor is None:
            return user
        if survivor.replaced_by_user_id is not None:
            final = self._store.get_user(survivor.replaced_by_user_id)
            if final is not None:
                return final
        return survivor

    def _give_missing_referral_codes(self) -> None:
        """At startup: indexes the codes accounts have, and gives one to every account
        from before referral codes."""
        if getattr(self._store, "scalable", False):
            return  # Migration assigns old codes; new accounts reserve codes atomically.
        with self._lock:
            users = self._store.list_users()
            for user in users:
                if user.referral_code:
                    self._user_ids_by_code[user.referral_code] = user.id
            for user in users:
                if not user.referral_code or user.picture_url not in USER_AVATARS:
                    self._store.put_user(replace(
                        user,
                        referral_code=user.referral_code or self._take_referral_code(user.id),
                        picture_url=user_avatar(user.picture_url),
                    ))

    def _take_referral_code(self, user_id: str) -> str:
        """A random code no account has yet, now reserved for [user_id]. The caller
        holds the lock."""
        # TODO: free the codes of long-inactive accounts once there's a policy for it;
        # until then a code is never reused (except a deleted account's, see
        # admin_delete_user).
        if getattr(self._store, "scalable", False):
            return self._store.reserve_referral(user_id)
        if len(self._user_ids_by_code) > REFERRAL_CODE_MAX - REFERRAL_CODE_MIN:
            raise RuntimeError(
                f"all {REFERRAL_CODE_MAX - REFERRAL_CODE_MIN + 1} referral codes are taken"
            )
        while (code := self._new_referral_code()) in self._user_ids_by_code:
            pass  # a collision: pick another random number
        self._user_ids_by_code[code] = user_id
        return code

    def _referrer_id(self, ref: str | None) -> str | None:
        """The surviving account an invite link's "ref" names: a 5-digit referral code
        or (older links) a user id. None when it names nobody. The caller holds the
        lock."""
        if ref and getattr(self._store, "scalable", False):
            ref = self._store.user_for_referral(ref) or ref
        elif ref and _REFERRAL_CODE_RE.fullmatch(ref):
            ref = self._user_ids_by_code.get(ref)
        return self._existing_user_id(ref)

    def _existing_user_id(self, user_id: str | None) -> str | None:
        """[user_id] resolved to its surviving account, or None when there is no such
        user. The caller holds the lock."""
        if not user_id:
            return None
        user = self._store.get_user(user_id)
        return None if user is None else self._resolve_replaced(user).id

    def _inviter_of(self, user: User) -> str | None:
        """Who invited [user], resolved through merges; None if nobody did (or the
        inviter resolves to [user] itself). The caller holds the lock."""
        inviter = self._existing_user_id(user.invited_by_user_id)
        return None if inviter == user.id else inviter

    def _invited_by_descendant(self, *, inviter_id: str, user_id: str) -> bool:
        """Whether [inviter_id] is [user_id] or someone [user_id] brought in, directly
        or through others; making [inviter_id] the inviter of [user_id] would then
        create a cycle. The caller holds the lock."""
        seen: set[str] = set()
        current: str | None = inviter_id
        while current is not None and current not in seen:
            if current == user_id:
                return True
            seen.add(current)
            user = self._store.get_user(current)
            current = None if user is None else self._inviter_of(user)
        return False

    def start_verification(
        self, *, kind: LinkedAccountKind, identifier: str
    ) -> tuple[str, str, str]:
        """Starts a login-code check for a phone number or email address. Returns
        (verification_id, code, normalized_identifier); the API layer sends the code
        through the configured sender."""
        with self._lock:
            normalized = _normalize_identifier(kind=kind, identifier=identifier)
            now = self._clock()
            starts = [
                when
                for when in self._verification_starts.get(normalized, [])
                if (now - when).total_seconds() < 3600
            ]
            if len(starts) >= VERIFICATION_MAX_STARTS_PER_HOUR:
                raise ConflictError("too many codes requested; try again later")
            for verification_id, verification in list(self._verifications.items()):
                if verification.identifier == normalized:
                    del self._verifications[verification_id]
            verification_id = self._new_id()
            code = self._new_verification_code()
            self._verifications[verification_id] = _Verification(
                id=verification_id,
                kind=kind,
                identifier=normalized,
                code=code,
                created_at=now,
            )
            self._verification_starts[normalized] = [*starts, now]
            return verification_id, code, normalized

    def _external_phone_pending(self, verification_id: str) -> _Verification:
        entry = self._verifications.get(verification_id)
        if entry is None or entry.kind != "phone":
            raise NotFoundError("verification not found or expired")
        if (self._clock() - entry.created_at).total_seconds() > VERIFICATION_TTL_SECONDS:
            del self._verifications[verification_id]
            raise NotFoundError("verification not found or expired")
        if entry.attempts >= VERIFICATION_MAX_ATTEMPTS:
            raise ConflictError("too many wrong codes; request a new one")
        return entry

    def pending_external_phone(self, verification_id: str) -> str:
        with self._lock:
            return self._external_phone_pending(verification_id).identifier

    def finish_external_phone(
        self, verification_id: str, *, approved: bool,
        display_name: str | None = None,
        as_user_id: str | None = None,
        invited_by_user_id: str | None = None,
        campaign_code: str | None = None,
    ) -> tuple[User, str | None]:
        with self._lock:
            entry = self._external_phone_pending(verification_id)
            if not approved:
                entry.attempts += 1
                raise InvalidRequestError("wrong code")
            del self._verifications[verification_id]
            return self.login_with_linked_account(
                kind="phone",
                identifier=entry.identifier,
                display_name=display_name or entry.identifier,
                as_user_id=as_user_id,
                invited_by_user_id=invited_by_user_id,
                campaign_code=campaign_code,
            )

    def verify_code(
        self,
        *,
        verification_id: str,
        code: str,
        display_name: str | None = None,
        as_user_id: str | None = None,
        invited_by_user_id: str | None = None,
        campaign_code: str | None = None,
    ) -> tuple[User, str | None]:
        """Checks a login code, then logs the owner in (see
        [login_with_linked_account]). Returns (user, merged_from_user_id)."""
        with self._lock:
            verification = self._verifications.get(verification_id)
            if verification is None:
                raise NotFoundError("verification not found or expired")
            if (
                self._clock() - verification.created_at
            ).total_seconds() > VERIFICATION_TTL_SECONDS:
                del self._verifications[verification_id]
                raise NotFoundError("verification not found or expired")
            if verification.attempts >= VERIFICATION_MAX_ATTEMPTS:
                del self._verifications[verification_id]
                raise ConflictError("too many wrong codes; request a new one")
            if not hmac.compare_digest(code.strip(), verification.code):
                verification.attempts += 1
                raise InvalidRequestError("wrong code")
            del self._verifications[verification_id]
            name = (
                display_name
                if display_name
                else (
                    verification.identifier.split("@")[0]
                    if verification.kind == "email"
                    else verification.identifier
                )
            )
            return self.login_with_linked_account(
                kind=verification.kind,
                identifier=verification.identifier,
                display_name=name,
                as_user_id=as_user_id,
                invited_by_user_id=invited_by_user_id,
                campaign_code=campaign_code,
            )

    def login_with_linked_account(
        self,
        *,
        kind: LinkedAccountKind,
        identifier: str,
        display_name: str,
        email: str = "",
        picture_url: str = "",
        as_user_id: str | None = None,
        invited_by_user_id: str | None = None,
        campaign_code: str | None = None,
    ) -> tuple[User, str | None]:
        """Logs in with a verified Google subject, phone number or email.

        With [as_user_id] None this is a plain login: a new user is created on first
        use. With [as_user_id] set (the caller is logged in as that user) the
        credential is linked to that account instead; if it already belongs to a
        different user, the two accounts merge, and the one with the stronger
        login method survives (google > phone > email > guest). The provider's
        name and email are refreshed on login; the assigned animal avatar persists. [invited_by_user_id] is recorded only when this creates a new user.
        Returns (user, merged_from_user_id).
        """
        with self._lock:
            user = self._find_by_linked_account(kind, identifier)
            if user is not None:
                user = self._resolve_replaced(user)
            if user is None:
                linked = LinkedAccount(
                    kind=kind, identifier=identifier, linked_at=self._clock()
                )
                if as_user_id is None:
                    return (
                        self.create_user(
                            display_name=_clean_display_name(display_name),
                            email=email.strip(),
                            picture_url=picture_url.strip(),
                            linked_accounts=(linked,),
                            invited_by_user_id=invited_by_user_id,
                            campaign_code=campaign_code,
                        ),
                        None,
                    )
                owner = self._require_user(as_user_id)
                owner = replace(
                    owner,
                    linked_accounts=(*owner.linked_accounts, linked),
                    updated_at=self._clock(),
                )
                self._store.put_user(owner)
                return owner, None
            if as_user_id is None or as_user_id == user.id:
                refreshed = _refresh_profile_from_provider(
                    user,
                    display_name=_clean_display_name(display_name),
                    email=email.strip(),
                    picture_url=picture_url.strip(),
                )
                if refreshed is not user:
                    refreshed = replace(refreshed, updated_at=self._clock())
                    self._store.put_user(refreshed)
                return refreshed, None
            target = self._require_user(as_user_id)
            source, into = self._merge_pair(
                user, target, prefer_first_as_source=True
            )
            merged_from = source.id
            return self._merge_locked(source=source, into=into), merged_from

    def merge_users(
        self,
        *,
        caller_id: str,
        from_user_id: str,
        into_user_id: str,
        into_password: str,
    ) -> User:
        """Merges [from_user_id] into [into_user_id]: games (all versions), matches
        (owner, seats, hidden flags and move authors), and linked accounts move over,
        then the source user is marked as replaced by the surviving user instead of
        being deleted, so its old credentials keep working as an alias of the
        survivor. The stronger login method always survives (google > phone >
        email > guest); on ties the requested direction is kept.

        The caller must prove control of BOTH accounts: they authenticate as the
        merged-away (replaced) user, and [into_password] must be the target's
        password. Otherwise anyone could merge their own account into a victim's
        public user id and, since the replaced account's credentials then resolve
        to the survivor, act as the victim. Returns the surviving user.
        """
        with self._lock:
            if from_user_id == into_user_id:
                raise InvalidRequestError("cannot merge a user into itself")
            source = self._require_user(from_user_id)
            target = self._require_user(into_user_id)
            if not hmac.compare_digest(
                into_password.encode(), target.password.encode()
            ):
                raise ForbiddenError(
                    "into_password is not the target account's password"
                )
            source, target = self._merge_pair(
                source, target, prefer_first_as_source=True
            )
            if source.id != caller_id:
                raise ForbiddenError(
                    "only the merged-away user can request the merge"
                )
            return self._merge_locked(source=source, into=target)

    def _merge_pair(
        self, first: User, second: User, *, prefer_first_as_source: bool
    ) -> tuple[User, User]:
        """Resolves replaced users to their survivor and applies the survivor-rank rule.

        Returns (source, target): [source] is the user that will be marked as
        replaced by [target]. The higher-ranked login method survives; on ties
        the requested direction is kept. Raises InvalidRequestError when both
        resolve to the same user. The caller holds the lock.
        """
        first = self._resolve_replaced(first)
        second = self._resolve_replaced(second)
        if first.id == second.id:
            raise InvalidRequestError("cannot merge a user into itself")
        if _account_rank(second) > _account_rank(first):
            return first, second  # first is replaced by the stronger second
        if _account_rank(first) > _account_rank(second):
            return second, first  # second is replaced by the stronger first
        return (first, second) if prefer_first_as_source else (second, first)

    def _merge_locked(self, *, source: User, into: User) -> User:
        """Moves everything of [source] into [into], then marks [source] as replaced
        by [into] instead of deleting it. The source keeps its password and display
        name (so old credentials still authenticate and resolve to the survivor)
        but holds no games, matches, seats, moves, or linked accounts afterwards.
        Everyone [source] had replaced is repointed directly at [into] too, so
        there are never replacement chains. The caller holds the lock.
        """
        into = self._resolve_replaced(into)
        source = self._resolve_replaced(source)
        if source.id == into.id:
            raise InvalidRequestError("cannot merge a user into itself")
        from_user_id, into_user_id = source.id, into.id
        for match in self._store.list_matches_involving(from_user_id):
            if match.status != "over" and match.seat_of(from_user_id) is not None and match.seat_of(into_user_id) is not None:
                raise ConflictError("wait until shared matches end before merging these accounts")
        for assignment in self._store.list_experiment_assignments():
            if assignment.user_id != from_user_id:
                continue
            if self._store.get_experiment_assignment(
                user_id=into_user_id, experiment_id=assignment.experiment_id
            ) is None:
                self._store.put_experiment_assignment(
                    replace(assignment, user_id=into_user_id)
                )
            self._store.delete_experiment_assignment(
                user_id=from_user_id, experiment_id=assignment.experiment_id
            )
        for game in self._store.list_all_game_versions():
            if game.owner_user_id == from_user_id:
                self._store.put_game_version(
                    replace(game, owner_user_id=into_user_id)
                )
        for match in self._store.list_all_matches():
            updated = match
            if match.owner_user_id == from_user_id:
                updated = replace(updated, owner_user_id=into_user_id)
            if any(seat.user_id == from_user_id for seat in updated.seats):
                updated = replace(
                    updated,
                    seats=tuple(
                        replace(seat, user_id=into_user_id,
                                logic_player_id=match.player_id_of(seat))
                        if seat.user_id == from_user_id
                        else seat
                        for seat in updated.seats
                    ),
                )
            if from_user_id in updated.hidden_for_user_ids:
                updated = replace(
                    updated,
                    hidden_for_user_ids=(updated.hidden_for_user_ids - {from_user_id})
                    | {into_user_id},
                )
            if any(
                move.made_by_user_id == from_user_id for move in updated.moves
            ):
                updated = replace(
                    updated,
                    moves=tuple(
                        replace(move, made_by_user_id=into_user_id)
                        if move.made_by_user_id == from_user_id
                        else move
                        for move in updated.moves
                    ),
                )
            if any(timeout.user_id == from_user_id for timeout in updated.timeouts):
                updated = replace(updated, timeouts=tuple(
                    replace(timeout, user_id=into_user_id)
                    if timeout.user_id == from_user_id else timeout
                    for timeout in updated.timeouts
                ))
            if updated is not match:
                self._save(updated)
        for subscription in self._store.list_push_subscriptions(user_id=from_user_id):
            self._store.put_push_subscription(
                replace(subscription, user_id=into_user_id)
            )
        for invite in self._store.list_invites():
            updated_invite = invite
            if invite.created_by_user_id == from_user_id:
                updated_invite = replace(updated_invite, created_by_user_id=into_user_id)
            if any(a.user_id == from_user_id for a in invite.acceptances):
                updated_invite = replace(
                    updated_invite,
                    acceptances=tuple(
                        replace(a, user_id=into_user_id) if a.user_id == from_user_id else a
                        for a in invite.acceptances
                    ),
                )
            if updated_invite is not invite:
                self._store.put_invite(updated_invite)
        have = {
            (account.kind, account.identifier) for account in into.linked_accounts
        }
        moved = tuple(
            account
            for account in source.linked_accounts
            if (account.kind, account.identifier) not in have
        )
        # Flatten: everyone the source had replaced, plus the source itself, now
        # points directly at the survivor. There are never replacement chains.
        absorbed = (from_user_id, *source.replaced_user_ids)
        replaced_ids = _dedupe((*into.replaced_user_ids, *absorbed))
        # Invites: whoever the source invited now counts for the survivor (invite
        # stats resolve merged-away inviters). If only the source was invited, the
        # survivor inherits that inviter, unless it would make a cycle.
        invited_by = into.invited_by_user_id
        if self._inviter_of(into) is None:
            source_inviter = self._inviter_of(source)
            if source_inviter is not None and not self._invited_by_descendant(
                inviter_id=source_inviter, user_id=into_user_id
            ):
                invited_by = source_inviter
        into = replace(
            into,
            linked_accounts=(*into.linked_accounts, *moved),
            token_balance=into.token_balance + source.token_balance,
            # Neither account may claim today's grant a second time after merging.
            last_token_grant_day=max(
                (day for day in (into.last_token_grant_day, source.last_token_grant_day) if day),
                default=None,
            ),
            replaced_user_ids=replaced_ids,
            saved_game_ids=_dedupe((*into.saved_game_ids, *source.saved_game_ids)),
            recent_game_ids=_dedupe(
                (*into.recent_game_ids, *source.recent_game_ids)
            )[: self.RECENT_GAME_LIMIT],
            invited_by_user_id=invited_by,
            invited_via_invite_token=into.invited_via_invite_token
            or source.invited_via_invite_token,
            updated_at=self._clock(),
        )
        self._store.put_user(into)
        # Never delete the source: mark it as replaced so its old credentials
        # keep authenticating, resolving to the survivor on every use. It keeps
        # its password and display name but holds nothing else.
        for uid in absorbed:
            old = self._store.get_user(uid)
            if old is None or old.id == into_user_id:
                continue
            if uid == from_user_id:
                old = replace(
                    old,
                    replaced_by_user_id=into_user_id,
                    token_balance=0,
                    linked_accounts=(),
                    replaced_user_ids=(),
                    updated_at=self._clock(),
                )
            else:
                old = replace(
                    old,
                    replaced_by_user_id=into_user_id,
                    updated_at=self._clock(),
                )
            self._store.put_user(old)
        return into

    def list_open_matches(self) -> list[Match]:
        """Matches anyone may join: waiting for players, or ongoing with mid-match
        joins allowed. Match details are public by URL anyway, so listing them is
        consistent."""
        with self._lock:
            matches = (
                *self._store.list_matches_by_status("waiting_for_players"),
                *self._store.list_matches_by_status("ongoing"),
            )
            return [
                match
                for match in map(
                    self._enforce_clock,
                    sorted(matches, key=lambda item: (item.created_at, item.id)),
                )
                if not match.private
                and not match.num_computer_opponents
                # A rematch whose free seats are all held for its original players
                # has nothing to offer anyone else.
                and not (
                    match.held_seats()
                    and len(match.seats) + match.held_seats()
                    >= self._rules_of(match).max_players
                )
                and (game := self._store.get_game(match.game_id)) is not None
                and game.published and not game.deleted
                and (match.status == "waiting_for_players" or (
                    match.status == "ongoing"
                    and self._rules_of(match).allows_join_mid_match
                ))
            ]

    def _require_translatable(self, code: str | None, server_code: str | None = None) -> None:
        """translation.require_strings: client code that fails game_text.lint is refused,
        with the checker's problems in plain words. Games with no client code are exempt;
        the admin and migration paths and example data never call this."""
        if not self._require_game_strings or not code or not code.strip():
            return
        problems = game_text.lint(code, server_code)
        if problems:
            shown = "; ".join(problems[:5])
            if len(problems) > 5:
                shown += f"; and {len(problems) - 5} more"
            raise InvalidRequestError(f"the game's texts cannot be translated: {shown}")

    # Games (public versions; existing clients continue to publish with POST/PATCH).

    def create_game(
        self,
        *,
        caller_id: str,
        name: str,
        description: str,
        rules: GameRules,
        code: str,
        server_code: str | None = None,
        game_schemas: dict[str, JsonValue] | None = None,
        import_package: dict[str, JsonValue] | None = None,
        _check_strings: bool = True,
    ) -> Game:
        server_code = server_code or None
        if _check_strings:
            self._require_translatable(code, server_code)
        if server_code is None and game_schemas is not None:
            raise InvalidRequestError("game_schemas requires server_code")
        with self._lock:
            if server_code is not None and game_schemas is None:
                raise InvalidRequestError(
                    "a game with server code needs its game_schemas; give them when creating the game"
                )
            now = self._clock()
            game = Game(
                id=self._new_id(),
                version=1,
                owner_user_id=caller_id,
                name=name,
                description=description,
                rules=rules,
                code=code,
                server_code=server_code,
                import_package=import_package,
                game_schemas=game_schemas,
                created_at=now,
                updated_at=now,
            )
            self._store.add_game_version(game)
            return game

    def import_agent_game(
        self,
        *,
        caller_id: str,
        name: str,
        description: str,
        rules: GameRules,
        code: str,
        server_code: str | None = None,
        game_schemas: dict[str, JsonValue] | None = None,
        import_package: dict[str, JsonValue] | None = None,
        request_id: str | None = None,
    ) -> Game:
        """Creates a published game, or updates the one imported with [request_id]
        (see agent_import). The find and the create/update happen under one lock, so
        two concurrent resubmissions with the same id — a retry while the first is
        still running, say — cannot create a duplicate. An update runs as the game's
        owner: possession of the request id is the authorization, so the caller need
        not be the owner. A resubmission that changes nothing returns the game as is.
        A resubmission of an unpublished game re-publishes it: the import publishes.
        """
        # The stored package is the record of the request id: a resubmission is
        # found by the secret in the package, so the id passed here is what is
        # stored, whatever the package itself carried.
        if request_id is not None and import_package is not None:
            import_package = {**import_package, "game_addition_request_id_and_secret": request_id}
        with self._lock:
            existing = (
                self.find_game_by_addition_request_id(request_id)
                if request_id is not None
                else None
            )
            if existing is not None:
                game = self.update_game(
                    caller_id=existing.owner_user_id,
                    game_id=existing.id,
                    name=name,
                    description=description,
                    allowed_player_counts=rules.allowed_player_counts,
                    allows_leave_mid_match=rules.allows_leave_mid_match,
                    allows_join_mid_match=rules.allows_join_mid_match,
                    code=code,
                    server_code=server_code,
                    game_schemas=game_schemas,
                    _publishing=True,
                    _import_package=import_package,
                )
                if not game.published:
                    self._store.set_game_published(game.id, True)
                    game = replace(game, published=True)
                return game
            return self.create_game(
                caller_id=caller_id,
                name=name,
                description=description,
                rules=rules,
                code=code,
                server_code=server_code,
                game_schemas=game_schemas,
                import_package=import_package,
            )

    def find_game_by_addition_request_id(self, request_id: str) -> Game | None:
        """The published game imported with [request_id] (see agent_import: the
        agent's `game_addition_request_id_and_secret`), or None. The id is stored on
        the game's import package; the lookup scans the published games, which is cheap
        (imports are rare and the list is small). Unpublished games are included:
        a resubmission of one re-publishes it (see import_agent_game)."""
        with self._lock:
            for game in self._store.list_games(owner_user_id=None, include_unpublished=True):
                if (game.import_package or {}).get('game_addition_request_id_and_secret') == request_id:
                    return game
        return None

    def get_game(self, game_id: str, *, caller_id: str | None = None) -> Game:
        with self._lock:
            game = self._get_game(game_id)
            if not game.published and caller_id != game.owner_user_id:
                raise NotFoundError("game not found")
            return game

    def get_game_version(self, game_id: str, version: int, *, caller_id: str | None = None) -> Game:
        """Old versions stay available, even after the game is deleted, because matches
        created with them still need their code."""
        with self._lock:
            game = self._store.get_game_version(game_id, version)
            if game is None:
                raise NotFoundError("game version not found")
            if not game.published and caller_id != game.owner_user_id:
                if caller_id is None or not (self._store.has_game_membership(caller_id, game_id, version)
                    if getattr(self._store, "scalable", False) else any(
                    match.game_id == game_id and match.game_version == version
                    for match in self._store.list_matches_involving(caller_id)
                )):
                    raise NotFoundError("game version not found")
            return game

    def get_game_versions(
        self, refs: list[tuple[str, int]], *, caller_id: str | None = None
    ) -> list[Game]:
        """The game versions for [refs] ((game_id, version) pairs), in request
        order, skipping any that don't exist or aren't visible to the caller.

        Backs the portal's batched version fetch: one API call instead of one
        request per game on screen. Every ref goes through [get_game_version],
        so the visibility rules are exactly the single-fetch ones.
        """
        games = []
        for game_id, version in refs:
            try:
                games.append(
                    self.get_game_version(game_id, version, caller_id=caller_id)
                )
            except NotFoundError:
                continue
        return games

    def game_strings(
        self, game_id: str, version: int, locale: str, *, caller_id: str | None = None
    ) -> GameStrings:
        """The texts of one game version in [locale]: its name, its description and its
        string table. Texts are translated the first time they are asked for and
        remembered. Anything that cannot be translated is returned as the game wrote it, so
        this never fails because of the translator."""
        game = self.get_game_version(game_id, version, caller_id=caller_id)
        try:
            table = game_text.extract_strings(game.code)
        except game_text.StringsError:
            table = None
        warnings = game_text.lint(game.code)
        prepared = (game.import_package or {}).get('translations', {}).get(i18n.normalize_locale(locale) or i18n.DEFAULT_LOCALE)
        if prepared and isinstance(prepared.get('client_strings'), dict) and set(prepared['client_strings']) == set(table or {}):
            return GameStrings(game_id=game.id, game_version=game.version,
                locale=i18n.normalize_locale(locale) or i18n.DEFAULT_LOCALE, status='translated',
                name=prepared['display_name'], description=prepared['short_description'],
                strings=prepared['client_strings'], translatable=table is not None, warnings=warnings)
        # Not under the platform's lock: translating may wait for Google.
        translated = self._translation.translate(
            [game.name, game.description, *(table or {}).values()], locale
        )
        shown = lambda text: translated.texts.get(text, text)  # noqa: E731
        return GameStrings(
            game_id=game.id,
            game_version=game.version,
            locale=i18n.normalize_locale(locale) or i18n.DEFAULT_LOCALE,
            status=translated.status,
            name=shown(game.name),
            description=shown(game.description),
            strings={key: shown(text) for key, text in (table or {}).items()},
            translatable=table is not None,
            warnings=warnings,
        )

    def _game_message_error(self, game: Game, message: str) -> GameMessageError:
        """The 400 for a move the game's server rejected with [message]."""
        found = None
        try:
            found = game_messages.match(self._templates_of(game), message)
        except Exception:  # noqa: BLE001 - a text we cannot match is shown as written
            logging.getLogger(__name__).exception("matching a game message failed")
        return GameMessageError(
            message,
            game_id=game.id,
            game_version=game.version,
            key=found.key if found else None,
            template=found.template if found else None,
            params=found.params if found else None,
        )

    def _templates_of(self, game: Game) -> tuple[game_messages.Template, ...]:
        cache_key = (game.id, game.version)
        templates = self._server_templates.get(cache_key)
        if templates is None:
            try:
                table = game_text.extract_strings(game.code or "")
            except game_text.StringsError:
                table = None
            templates = game_messages.compile_templates(table)
            if game.code:
                self._server_templates[cache_key] = templates
        return templates

    def translate_game_message(self, error: GameMessageError, locale: str) -> str | None:
        """The text of [error] in [locale] (the matching template translated, the captured
        values put back as written), or None when it stays as the game wrote it: English, no
        matching template, no translator, a translation that failed. Never raises."""
        try:
            if error.template is None or i18n.normalize_locale(locale) in (None, i18n.DEFAULT_LOCALE):
                return None
            translated = self._translation.translate([error.template], locale)
            text = translated.texts.get(error.template)
            if not text:
                return None
            return game_messages.fill(text, error.params)
        except Exception:  # noqa: BLE001 - translation must never fail a request
            logging.getLogger(__name__).exception("translating a game message failed")
            return None

    def translation_bundle(self, locale: str) -> TranslationBundle:
        """The names, descriptions and string tables of the published games in [locale],
        all at once. Reads only memory once the games are known (the translations are in
        memory, and so are the tables of versions seen before). Texts without a translation
        are asked from the translator in the background; this waits for it only for a
        short while, and returns the originals for what is still missing, with a status."""
        code = i18n.normalize_locale(locale)
        if code is None:
            raise NotFoundError(f"language not supported: {locale}")
        games = self._bundle_published_games()
        tables = {game.id: self._bundle_table(game) for game in games}
        wanted = [
            text
            for game in games
            for text in (game.name, game.description, *(tables[game.id] or {}).values())
        ]
        translated = self._translate_for_bundle(wanted, code)
        shown = lambda text: translated.texts.get(text, text)  # noqa: E731

        def status_of(texts: list[str]) -> str:
            if translated.status == "source":
                return "source"
            known = [text for text in texts if text.strip() and text in translated.texts]
            wanted_here = [text for text in texts if text.strip()]
            if len(known) == len(wanted_here):
                return "translated"
            return "partial" if known else "unavailable"

        entries = {}
        for game in games:
            table = tables[game.id]
            texts = [game.name, game.description, *(table or {}).values()]
            entries[game.id] = BundleGame(
                version=game.version,
                name=shown(game.name),
                description=shown(game.description),
                status=status_of(texts),
                translatable=table is not None,
                strings={key: shown(text) for key, text in (table or {}).items()},
            )
        return TranslationBundle(locale=code, status=translated.status, games=entries)

    def _bundle_published_games(self) -> list[Game]:
        now = time.monotonic()
        cached = self._bundle_games
        if cached is not None and now < cached[0]:
            return cached[1]
        # Games without their code where the store can: the code is only needed for the
        # string table, which is remembered per version.
        lister = getattr(self._store, "list_games_without_code", None) or self._store.list_games
        games = self._plain_read(lambda: lister(owner_user_id=None))
        self._bundle_games = (now + self._bundle_games_ttl_seconds, games)
        return games

    def _plain_read(self, read: Callable[[], Any]) -> Any:
        """Runs a read of the store. A scalable store (Firestore queries) reads without a
        transaction, so the platform lock, which would open one, is not taken for it."""
        if getattr(self._store, "scalable", False):
            return read()
        with self._lock:
            return read()

    def _bundle_table(self, game: Game) -> dict[str, str] | None:
        key = (game.id, game.version)
        if key not in self._bundle_tables:
            # A version's code never changes, so its table is read once.
            code = game.code
            if not code:
                full = self._plain_read(lambda: self._store.get_game_version(game.id, game.version))
                code = full.code if full is not None else ""
            try:
                table = game_text.extract_strings(code)
            except game_text.StringsError:
                table = None
            self._bundle_tables[key] = (table,)
        return self._bundle_tables[key][0]

    def _translate_for_bundle(self, texts: list[str], code: str) -> Any:
        """Translations of [texts], waiting at most [bundle_wait_seconds] for the
        translator. What it translates after that is there for the next request."""
        found = self._translation.translate(texts, code, remote=False)
        if found.status in ("translated", "source") or not self._translation.enabled:
            return found
        with self._bundle_jobs_lock:
            job = self._bundle_jobs.get(code)
            if job is None or job.is_set():
                job = self._bundle_jobs[code] = threading.Event()

                def run(done: threading.Event = job) -> None:
                    try:
                        self._translation.translate(texts, code)
                    except Exception:  # noqa: BLE001 - a background job must not die loudly
                        logging.getLogger(__name__).exception("bundle translation failed")
                    finally:
                        done.set()

                threading.Thread(target=run, name=f"bundle-translate-{code}", daemon=True).start()
        job.wait(self._bundle_wait_seconds)
        return self._translation.translate(texts, code, remote=False)

    def list_translations(self, locale: str | None = None) -> list[Translation]:
        """Every remembered translation (of one language), for the backoffice."""
        return sorted(self._store.list_translations(locale), key=lambda item: (item.locale, item.source))

    def set_translation(self, *, locale: str, source: str, text: str) -> Translation:
        """An administrator's translation of [source], which replaces a machine one and is
        never replaced by one again."""
        code = i18n.normalize_locale(locale)
        if code is None or code == i18n.DEFAULT_LOCALE:
            raise InvalidRequestError(f"{locale!r} is not a language that texts are translated into")
        if not source.strip() or not text.strip():
            raise InvalidRequestError("both the text and its translation are needed")
        if translation_module.placeholders_of(text) != translation_module.placeholders_of(source):
            raise InvalidRequestError("the translation must keep the text's placeholders (the words in curly braces)")
        translation = Translation(
            locale=code,
            source_hash=translation_module.text_hash(source),
            source=source,
            text=text,
            provider="manual",
            created_at=self._clock(),
            reviewed=True,
        )
        self._store.put_translations([translation])
        return translation

    def set_translations(self, *, translations: Sequence[tuple[str, str, str]]) -> list[Translation]:
        """Stores manual translations of (locale, source, text) triples in one write, for
        a game imported with its translations supplied: the portal bundle serves these
        instead of asking Google. Every triple is checked the way [set_translation]
        checks one: the locale must be a language texts are translated into, both texts
        must be non-empty, and the translation must keep the source's placeholders.
        English is the source language, so it is never a target here."""
        records: list[Translation] = []
        for locale, source, text in translations:
            code = i18n.normalize_locale(locale)
            if code is None or code == i18n.DEFAULT_LOCALE:
                raise InvalidRequestError(f"{locale!r} is not a language that texts are translated into")
            if not source.strip() or not text.strip():
                raise InvalidRequestError("both the text and its translation are needed")
            if translation_module.placeholders_of(text) != translation_module.placeholders_of(source):
                raise InvalidRequestError("the translation must keep the text's placeholders (the words in curly braces)")
            records.append(Translation(
                locale=code,
                source_hash=translation_module.text_hash(source),
                source=source,
                text=text,
                provider="manual",
                created_at=self._clock(),
                reviewed=True,
            ))
        if records:
            self._store.put_translations(records)
        return records

    def delete_translation(self, locale: str, source_hash: str) -> None:
        """Forgets a translation: the text is translated again next time it is asked for."""
        self._store.delete_translation(locale, source_hash)

    def games_text(self, locale: str) -> tuple[str, dict[str, dict[str, str]]]:
        """(status, {game id: {"name", "description"}}) for the published games, in [locale]:
        what a portal shows on its game cards. Like [game_strings], it never fails because
        of the translator."""
        games = self.list_games(owner_user_id=None)
        translated = self._translation.translate(
            [text for game in games for text in (game.name, game.description)], locale
        )
        shown = lambda text: translated.texts.get(text, text)  # noqa: E731
        return translated.status, {
            game.id: {"name": shown(game.name), "description": shown(game.description)}
            for game in games
        }

    def unpublish_game(self, *, caller_id: str, game_id: str) -> Game:
        # No drafts anymore: unpublishing is a pure flag flip. Re-publishing
        # happens by submitting the game again through POST /games.
        with self._lock:
            game = self._get_owned_game(caller_id=caller_id, game_id=game_id)
            if game.deleted:
                raise NotFoundError("game not found")
            self._store.set_game_published(game_id, False)
            return self._get_game(game_id)

    def list_games(self, *, owner_user_id: str | None, query: str = "") -> list[Game]:
        """Published games, optionally one owner's. A [query] keeps the games whose
        name or description contains every one of its words, ignoring case."""
        words = query.casefold().split()
        with self._lock:
            return [
                game
                for game in self._store.list_games(owner_user_id=owner_user_id)
                if all(
                    word in f"{game.name} {game.description}".casefold()
                    for word in words
                )
            ]

    def list_popular_games(self, *, limit: int = 8) -> list[Game]:
        """Returns the highest player-match totals from the persistent ranking."""
        if type(limit) is not int or not 1 <= limit <= 20:
            raise InvalidRequestError("limit must be between 1 and 20")
        with self._lock:
            list_rankings = getattr(self._store, "list_popular_game_ids", None)
            if list_rankings is None:
                return []
            rankings = list_rankings(limit)
            games = []
            for game_id, _score in rankings:
                game = self._store.get_game(game_id)
                if game is not None and game.published and not game.deleted:
                    games.append(game)
            return games

    def game_popularity_score(
        self, *, game_id: str, caller_id: str | None = None
    ) -> int:
        """Returns a visible game's cumulative player count in started matches."""
        game = self.get_game(game_id, caller_id=caller_id)
        reader = getattr(self._store, "game_popularity_score", None)
        return int(reader(game.id)) if reader is not None else 0

    def _record_game_match_start(self, match: Match) -> None:
        """Adds this start once, in the same storage unit of work as the match."""
        recorder = getattr(self._store, "record_game_match_start", None)
        if recorder is not None:
            recorder(match.game_id, len(match.seats))
        for user_id in match.human_user_ids:
            self._record_recent_game_for_user(user_id, match.game_id, occurred_at=match.updated_at)

    def _record_recent_game_for_user(
        self, user_id: str, game_id: str, *, occurred_at: dt.datetime | None = None
    ) -> None:
        """Moves [game_id] to the front of a user's bounded recent-game list."""
        user = self._store.get_user(user_id)
        if user is None:
            return
        user = self._resolve_replaced(user)
        recent = _dedupe((game_id, *user.recent_game_ids))[: self.RECENT_GAME_LIMIT]
        if recent != user.recent_game_ids:
            self._store.put_user(
                replace(user, recent_game_ids=recent, updated_at=occurred_at or self._clock())
            )

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
        server_code: str | None | object = UNSET,
        game_schemas: dict[str, JsonValue] | None | object = UNSET,
        _publishing: bool = False,
        _import_package: Any = UNSET,
    ) -> Game:
        """Creates a new version of the game, unless nothing changes.

        Fields left as [None] are unchanged, except [server_code]: it is
        unchanged unless a value (including None, which removes the game's
        server code) is passed explicitly.
        """
        with self._lock:
            game = self._get_owned_game(caller_id=caller_id, game_id=game_id)
            if not game.published and not _publishing:
                raise ConflictError("game is unpublished; submit it again through POST /games to publish it")
            server_code_value = (
                game.server_code
                if server_code is UNSET
                else server_code or None
            )
            game_schemas_value = (
                (
                    None
                    if server_code is not UNSET
                    and (
                        server_code_value is None
                        or server_code_value != game.server_code
                    )
                    else game.game_schemas
                )
                if game_schemas is UNSET
                else game_schemas
            )
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
                import_package=game.import_package if _import_package is UNSET else _import_package,
                code=code if code is not None else game.code,
                server_code=server_code_value,
                game_schemas=game_schemas_value,
            )
            if updated.server_code is None and updated.game_schemas is not None:
                raise InvalidRequestError("game_schemas requires server_code")
            if updated.server_code is not None and updated.game_schemas is None:
                raise InvalidRequestError(
                    "a game with server code needs its game_schemas; give them when updating the game"
                )
            if updated == game:
                return game
            if updated.code != game.code:
                self._require_translatable(updated.code, updated.server_code)
            if updated.server_code and (
                updated.server_code != game.server_code
                or updated.game_schemas != game.game_schemas
                or updated.rules != game.rules
            ):
                # New or re-ruled server code must pass its tests before
                # the new version is published (Phase 5 gate).
                self._gate_server_code(
                    game_id,
                    updated.server_code,
                    updated.rules,
                    updated.game_schemas,
                )
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
        self,
        *,
        caller_id: str,
        game_id: str,
        num_computer_opponents: int,
        private: bool = False,
        bet_per_player: int = 0,
        turn_seconds: int | None = None,
    ) -> Match:
        """[turn_seconds] makes a speed match (see SPEED_TURN_SECONDS); None is a
        regular match with no time limit."""
        with self._lock:
            if turn_seconds is not None and (
                type(turn_seconds) is not int or turn_seconds not in SPEED_TURN_SECONDS
            ):
                raise InvalidRequestError(
                    "turn_seconds must be 60, 180 or 600 (or null for a regular match)"
                )
            game = self._get_live_game(game_id)
            if not game.published:
                raise NotFoundError("game not found")
            self._check_fits(game.rules, num_players=1 + num_computer_opponents)
            if type(bet_per_player) is not int or not 0 <= bet_per_player <= 1000000:
                raise InvalidRequestError("invalid token stake")
            if bet_per_player and num_computer_opponents:
                raise InvalidRequestError("paid matches with computer opponents are not supported")
            return self._new_match(
                game,
                caller_id=caller_id,
                num_computer_opponents=num_computer_opponents,
                private=private,
                bet_per_player=bet_per_player,
                turn_seconds=turn_seconds,
            )

    def _new_match(
        self,
        game: Game,
        *,
        caller_id: str,
        num_computer_opponents: int = 0,
        private: bool = False,
        matchmaking_player_count: int | None = None,
        bet_per_player: int = 0,
        turn_seconds: int | None = None,
    ) -> Match:
        """Stores a new waiting match of [game] owned (and first seated) by [caller_id].
        The caller holds the lock and has checked the game."""
        now = self._clock()
        match_id = self._new_id()
        match = Match(
            id=match_id,
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
            private=private,
            matchmaking_player_count=matchmaking_player_count,
            bet_per_player=bet_per_player,
            turn_seconds=turn_seconds,
            # Derived from the match id, so the seed is stable for a given
            # match (replays reproduce it exactly) and unrelated across
            # matches (ids are random).
            seed=int.from_bytes(
                hashlib.sha256(match_id.encode()).digest()[:4], "big"
            ),
        )
        if game.server_code and bet_per_player:
            # A v2 match takes each human's stake as they join — the
            # creator now, everyone else in _join — so the pot is real
            # from the start, leaving the waiting room refunds it, and
            # deleting a waiting match refunds everyone (Phase 4).
            self._deduct_stake(caller_id, bet_per_player)
            match = replace(match, token_pot=bet_per_player)
        self._store.put_match(match)
        return match

    def get_match(self, match_id: str, *, caller_id: str | None = None) -> Match:
        with self._lock:
            match = self._get_match(match_id)
            game = self._get_game(match.game_id)
            if not game.published and caller_id != game.owner_user_id and (
                caller_id is None or not match.involves(caller_id)
            ):
                raise NotFoundError("match not found")
            # Private matches are invisible to outsiders, who see them through an
            # invite (GET /invites/{token}) instead.
            if match.private and (caller_id is None or not match.involves(caller_id)):
                raise NotFoundError("match not found")
            return match

    def list_matches(
        self, *, caller_id: str, status: MatchStatus | None, game_id: str | None
    ) -> list[Match]:
        with self._lock:
            return [
                match
                for match in map(
                    self._enforce_clock, self._store.list_matches_involving(caller_id)
                )
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
            if num_computer_opponents and (len(humans) != 1 or match.matchmaking_player_count is not None):
                raise ConflictError("computer opponents are only supported in single-player matches")
            if num_computer_opponents and match.bet_per_player:
                raise InvalidRequestError("paid matches with computer opponents are not supported")
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
            if match.private and match.seat_of(caller_id) is None:
                raise ForbiddenError(
                    "this match is private; join it with an invite link"
                )
            return self._join(match, caller_id=caller_id)

    def _join(self, match: Match, *, caller_id: str) -> Match:
        """Seats [caller_id] in [match], whatever its privacy; quick matches start
        once they have all their players. The caller holds the lock."""
        if match.seat_of(caller_id) is not None:
            raise ConflictError("you are already a player in this match")
        if caller_id in match.removed_user_ids:
            raise ForbiddenError("you were removed from this match")
        if (
            caller_id not in match.reserved_for_user_ids
            and match.held_seats()
            and len(match.seats) + match.held_seats() >= self._rules_of(match).max_players
        ):
            # A rematch holds a seat for each original player who hasn't come back.
            raise ConflictError("the remaining seats are held for the original players")
        if not self._get_game(match.game_id).published:
            raise ConflictError("this game is no longer published")
        if match.status == "over":
            raise ConflictError("the match is over")
        if match.num_computer_opponents:
            raise ConflictError("computer opponents are only supported in single-player matches; remove them before inviting players")
        clock_restart = None
        if match.status == "ongoing":
            seats = self._take_seat_mid_match(match, user_id=caller_id)
            # Taking a seat that has the turn gives its new player a full turn.
            joined = next(seat for seat in seats if seat.user_id == caller_id)
            if match.turn_seconds and joined.player_index in (match.turn_of_player_indices or ()):
                clock_restart = self._clock()
        else:
            if len(match.seats) >= self._rules_of(match).max_players:
                raise ConflictError("the match is full")
            seats = _waiting_seats(
                human_user_ids=[*match.human_user_ids, caller_id],
                num_computer_opponents=match.num_computer_opponents,
            )
        game = self._store.get_game_version(match.game_id, match.game_version)
        # A v2 match takes the joiner's stake as they join, in the waiting room
        # and mid-match alike. A v1 match takes its players' stakes at the start
        # (_fund_match_tokens), so only a mid-match joiner pays here. Either way
        # the pot grows by the stake, so nobody holds a seat in a paid match (and
        # a share of its pot, or of its refund) without having paid in.
        stake = (
            match.bet_per_player
            if (game is not None and game.server_code) or match.status == "ongoing"
            else 0
        )
        if stake:
            # Raises (before anything is saved) when the joiner can't afford it.
            self._deduct_stake(caller_id, stake)
        elif match.bet_per_player:
            # A waiting v1 match takes stakes only at the start, so check now that
            # the joiner could pay: otherwise one short player would make the
            # owner's Start fail for everyone ("a player has insufficient tokens").
            self._check_can_stake(caller_id, match.bet_per_player)
        saved = self._save(
            replace(
                match,
                seats=seats,
                turn_started_at=clock_restart or match.turn_started_at,
                token_pot=match.token_pot + stake,
                # A join changes the match any leave preview was computed
                # on, so the preview no longer stands.
                pending_leave=None,
            )
        )
        if match.status == "ongoing":
            game = self._store.get_game_version(saved.game_id, saved.game_version)
            if (
                game is not None
                and game.server_code
                and self._logic_for(game).has("playerJoined")
            ):
                # The game decides what a mid-match join does to its state
                # (deal the new player in, spectate until the next round...).
                result = self._call_logic(
                    game, saved, "playerJoined", saved.state, caller_id
                )
                saved = self._save(
                    replace(
                        saved,
                        state=result.get("state"),
                        turn_of_player_indices=self._turn_indices(saved, result),
                    )
                )
            self._record_recent_game_for_user(caller_id, saved.game_id, occurred_at=saved.updated_at)
        joiner = self._store.get_user(caller_id)
        self._notify_match_event(
            "notify.player_joined",
            match=saved,
            recipient_ids=[
                user_id for user_id in saved.human_user_ids if user_id != caller_id
            ],
            actor_name=joiner.display_name if joiner is not None else "",
            tag_suffix="join",
        )
        target = saved.matchmaking_player_count
        if (
            target is not None
            and saved.status == "waiting_for_players"
            and len(saved.seats) >= target
        ):
            game = self._store.get_game_version(saved.game_id, saved.game_version)
            if game is not None and game.server_code:
                # A v2 quick match starts by running the game's newMatch.
                return self._begin_v2_match(saved, game)
            # Like the portal's Start button: seat 0 moves first, and the game
            # creates its own initial state.
            humans = self._fund_match_tokens(saved)
            saved = self._save(
                replace(
                    saved,
                    status="ongoing",
                    state=None,
                    turn_of_player_indices=frozenset({0}),
                    token_pot=saved.bet_per_player * len(humans),
                )
            )
            self._record_game_match_start(saved)
            self._notify_match_event(
                "notify.turn",
                match=saved,
                recipient_ids=[
                    seat.user_id
                    for seat in saved.seats[:1]
                    if seat.user_id is not None and seat.user_id != caller_id
                ],
                tag_suffix="turn",
            )
        return saved

    def request_rematch(self, *, caller_id: str, match_id: str) -> Match:
        with self._lock:
            match = self._get_match(match_id)
            self._get_seat(match, caller_id)
            if match.status != "over":
                raise ConflictError(
                    "a rematch can only be requested after the match ends"
                )

            if match.rematch_match_id:
                rematch = self._store.get_match(match.rematch_match_id)
                if rematch is not None and rematch.status != "over":
                    if rematch.seat_of(caller_id) is not None:
                        return rematch
                    # An original player rejoins directly: a private match's
                    # rematch is private too, and they need no invite for it.
                    return self._join(rematch, caller_id=caller_id)

            game = self._get_game(match.game_id)
            game_version = self._store.get_game_version(
                match.game_id, match.game_version
            )
            if game.deleted or not game.published or game_version is None:
                raise ConflictError("this game is no longer available for rematches")

            solo_bot_rematch = (
                len(match.human_user_ids) == 1 and match.num_computer_opponents > 0
            )
            now = self._clock()
            rematch = Match(
                id=self._new_id(),
                game_id=match.game_id,
                owner_user_id=caller_id,
                game_version=match.game_version,
                status="waiting_for_players",
                seats=_waiting_seats(
                    human_user_ids=[caller_id],
                    num_computer_opponents=match.num_computer_opponents
                    if solo_bot_rematch
                    else 0,
                ),
                state=None,
                turn_of_player_indices=None,
                end_reason=None,
                moves=(),
                hidden_for_user_ids=frozenset(),
                created_at=now,
                updated_at=now,
                turn_seconds=match.turn_seconds,
                # Same audience as the original: a private match's rematch stays
                # private. The stake is not carried over: nobody's tokens are
                # committed by someone else asking for a rematch.
                private=match.private,
                # Hold a seat for every original player, so a stranger can't take
                # the last one before the opponent comes back.
                reserved_for_user_ids=frozenset(match.human_user_ids),
            )
            self._store.put_match(rematch)
            if solo_bot_rematch:
                rematch = self.start_match(
                    caller_id=caller_id,
                    match_id=rematch.id,
                    first_turn_player_indices=frozenset({0}),
                    initial_state=None,
                )
            self._save(replace(match, rematch_match_id=rematch.id))
            return rematch

    def _check_can_stake(self, user_id: str, amount: int) -> None:
        """Raises unless [user_id] can stake [amount] tokens, counting the
        daily grant they would receive (see [_deduct_stake])."""
        user = self._store.get_user(user_id)
        if user is None:
            raise NotFoundError("player not found")
        day = self._clock().astimezone(dt.timezone.utc).date().isoformat()
        grant = 10 if user.last_token_grant_day != day else 0
        if user.token_balance + grant < amount:
            raise ConflictError("a player has insufficient tokens")

    def _deduct_stake(self, user_id: str, amount: int) -> None:
        """Takes [amount] tokens from a player entering a paid match: the
        daily grant is applied first, then the stake is deducted."""
        user = self._store.get_user(user_id)
        if user is None:
            raise NotFoundError("player not found")
        day = self._clock().astimezone(dt.timezone.utc).date().isoformat()
        grant = 10 if user.last_token_grant_day != day else 0
        if user.token_balance + grant < amount:
            raise ConflictError("a player has insufficient tokens")
        self._store.put_user(
            replace(
                user,
                token_balance=user.token_balance + grant - amount,
                last_token_grant_day=day if grant else user.last_token_grant_day,
            )
        )

    def _credit_tokens(self, user_id: str, amount: int) -> None:
        """Gives [amount] tokens back to a player (a payout, a settlement
        share, a refund). A missing user is skipped: their account is gone,
        and a payout must not fail the match over it."""
        if not amount:
            return
        user = self._store.get_user(user_id)
        if user is not None:
            self._store.put_user(
                replace(user, token_balance=user.token_balance + amount)
            )

    def _fund_match_tokens(self, match: Match) -> list[str]:
        humans = [seat.user_id for seat in match.seats if seat.kind == "human"]
        if match.bet_per_player and len(humans) != len(match.seats):
            raise InvalidRequestError("computer opponents cannot enter paid matches")
        if len(set(humans)) != len(humans):
            raise InvalidRequestError("duplicate accounts cannot wager against themselves")
        for uid in humans:
            self._check_can_stake(uid, match.bet_per_player)
        for uid in humans:
            self._deduct_stake(uid, match.bet_per_player)
        return humans

    # Server-side game logic (v2 Game API, docs/server-side-game-api.md).
    # Everything in this section runs with the platform lock held.

    def _run_game_tests(
        self,
        *,
        server_code: str,
        game_schemas: dict[str, JsonValue],
        rules: GameRules,
        game_id: str | None,
        budget_seconds: float = 1.0,
    ) -> GameTestReport:
        stored = (
            self._store.get_game_test_seeds(game_id) if game_id else None
        )
        source = self._store.get_game(game_id) if game_id else None
        contract = (getattr(source, 'import_package', None) or {}).get('unit_tests')
        if contract:
            from game_platform.game_contract import verify_examples
            from game_platform.game_testing import TestFailure
            failures = [result for result in verify_examples(server_code, contract) if not result['passed']]
            if failures:
                return GameTestReport(passed=False, walks_completed=0, moves_made=0, too_slow=False,
                    failures=tuple(TestFailure(function='approved_example', message=result['name'] + ': ' + result['error'],
                        seed=0, player_count=0, move_number=0) for result in failures))
        report = test_server_code(
            server_code,
            game_schemas=game_schemas,
            game_id=game_id or "unsaved",
            rules=rules,
            regression_seeds=stored.seeds if stored else (),
            contract=contract,
            budget_seconds=budget_seconds,
        )
        if game_id:
            self._store.put_game_test_seeds(
                GameTestSeeds(
                    game_id=game_id,
                    seeds=report.failed_seeds[:MAX_STORED_TEST_SEEDS],
                )
            )
        return report

    def _gate_server_code(
        self,
        game_id: str,
        server_code: str,
        rules: GameRules,
        game_schemas: dict[str, JsonValue] | None,
        *,
        budget_seconds: float = 1.0,
    ) -> None:
        """The publish gate (Phase 5): server code about to be published
        must pass the random-walk tests, or publishing is refused. The schemas are
        given, never generated here."""
        if game_schemas is None:
            raise InvalidRequestError(
                "a game with server code needs its game_schemas; give them when creating the game"
            )
        report = self._run_game_tests(
            server_code=server_code,
            game_schemas=game_schemas,
            rules=rules,
            game_id=game_id,
            budget_seconds=budget_seconds,
        )
        if report.passed:
            return
        first = report.failures[0]
        summary = f"{first.function}: {first.message.splitlines()[0][:160]}"
        raise InvalidRequestError(
            f"the game's server code failed its tests: {summary} "
            f"(seed {first.seed})"
        )

    def _logic_for(self, game: Game) -> GameLogic:
        key = (game.id, game.version)
        logic = self._logic_cache.get(key)
        if logic is None:
            if game.game_schemas is None:
                raise GameLogicError(
                    f"game {game.id} version {game.version} has no game_schemas; "
                    "add game_schemas to it before enabling this game"
                )
            contract = (game.import_package or {}).get('unit_tests')
            if contract:
                from game_platform.game_contract import ContractLogic
                logic = ContractLogic(
                    game.server_code or "",
                    contract,
                    game_schemas=game.game_schemas,
                    game_id=game.id,
                    game_version=game.version,
                )
            else:
                logic = GameLogic(
                    game.server_code or "",
                    game_schemas=game.game_schemas,
                    game_id=game.id,
                    game_version=game.version,
                )
            self._logic_cache[key] = logic
        return logic

    def _game_ctx(self, match: Match, *, pot: int | None = None) -> dict[str, Any]:
        """The ctx every game function receives: who is playing (by player
        id), the pot, and how many moves have been made."""
        players: list[dict[str, Any]] = []
        for seat in match.seats:
            player_id = match.player_id_of(seat)
            if seat.kind == "human":
                user = self._store.get_user(seat.user_id or "")
                players.append(
                    {
                        "id": player_id,
                        "kind": "human",
                        "display_name": user.display_name if user else "",
                        "picture_url": user.picture_url if user else "",
                        "max_loss": match.bet_per_player,
                        "active": seat.active,
                    }
                )
            else:
                number = player_id.rsplit("-", 1)[-1]
                players.append(
                    {
                        "id": player_id,
                        "kind": "computer",
                        "display_name": f"Computer {number}",
                        "picture_url": computer_avatar(player_id),
                        "max_loss": 0,
                        "active": seat.active,
                    }
                )
        return {
            "players": players,
            "pot": match.token_pot if pot is None else pot,
            "move_count": len(match.moves),
        }

    def _call_seed(self, match: Match) -> int:
        """The seed for the next logic call: the match's seed advanced by the
        move number, so calls differ within a match but a replay of the match
        reproduces every call exactly."""
        return (match.seed + len(match.moves)) % (2**32)

    def _call_logic(
        self,
        game: Game,
        match: Match,
        function: str,
        *args: Any,
        time_limit_seconds: float | None = None,
    ) -> Any:
        """Runs one game function; records bug-level failures on the game
        version and raises a PlatformError for them. InvalidMove passes
        through: it is the player's fault, not a bug."""
        started = time.perf_counter()
        try:
            result = self._logic_for(game).call(
                function,
                *args,
                ctx=self._game_ctx(match),
                seed=self._call_seed(match),
                now=self._clock(),
                time_limit_seconds=time_limit_seconds,
            )
        except InvalidMoveError as error:
            self._log_illegal_move(game, match, function, args, error)
            raise
        except GameLogicError as error:
            self._record_logic_error(game, function, error, match=match, args=args)
            raise PlatformError(
                f"the game's server code failed in {function}: {error}"
            ) from error
        self._log_if_slow(
            game, match, function, args,
            (time.perf_counter() - started) * 1000, time_limit_seconds,
        )
        return result

    def _record_logic_error(
        self,
        game: Game,
        function: str,
        error: Exception,
        *,
        match: Match | None = None,
        args: Sequence[Any] | None = None,
    ) -> None:
        self._store.add_game_version_error(
            GameVersionError(
                id=self._new_id(),
                game_id=game.id,
                game_version=game.version,
                function=function,
                message=str(error)[:2000],
                created_at=self._clock(),
            )
        )
        self._log_logic_error(game, function, error, match, args)

    def _game_log_fields(self, game: Game, match: Match | None, function: str) -> dict[str, Any]:
        """Who and what a game-function log line is about, to find it again."""
        fields: dict[str, Any] = {
            "game_id": game.id,
            "game_version": game.version,
            "game_name": game.name,
            "owner_user_id": game.owner_user_id,
            "function": function,
        }
        if match is not None:
            fields.update(
                match_id=match.id,
                move_count=len(match.moves),
                # With the state and the seed, a call can be repeated exactly.
                seed=self._call_seed(match),
            )
        return fields

    def _log_logic_error(
        self,
        game: Game,
        function: str,
        error: Exception,
        match: Match | None,
        args: Sequence[Any] | None,
    ) -> None:
        """A bug in a game's server code: a timeout, too much memory, an exception, a
        bad result, or a computer's move that the game itself rejects. Logged with the
        function's inputs, so it can be reproduced."""
        monitor = observability.current()
        limit = monitor.config.max_logged_game_input_bytes
        text = str(error).lower()
        if isinstance(error, InvalidMoveError):
            event = "computer_illegal_move"
        elif isinstance(error, GameLogicTimeout):
            event = "game_function_timeout"
        elif "memory" in text:
            event = "game_function_memory"
        else:
            event = "game_function_error"
        monitor.count("game_errors")
        fields = self._game_log_fields(game, match, function)
        if match is not None:
            fields["ctx"] = observability.capture(self._game_ctx(match), limit)
        if args is not None:
            fields["inputs"] = observability.capture(list(args), limit, keep_long_strings=True)
        observability.log_event(
            event,
            f"{function} failed in {game.name} v{game.version}: {str(error)[:300]}",
            level=logging.ERROR,
            alert="minor",
            error=str(error)[:2000],
            error_type=type(error).__name__,
            **fields,
        )

    def _log_illegal_move(
        self,
        game: Game,
        match: Match,
        function: str,
        args: Sequence[Any],
        error: InvalidMoveError,
    ) -> None:
        """The game rejected a move. That is usually a player's mistake, so it is only
        counted and logged (a computer's rejected move is a bug: see above)."""
        player_id = args[1] if len(args) > 1 else None
        if isinstance(player_id, str) and player_id.startswith("computer-"):
            return
        monitor = observability.current()
        monitor.count("illegal_moves")
        observability.log_event(
            "illegal_move",
            f"{function} rejected a move in {game.name}: {error.message[:200]}",
            level=logging.INFO,
            reason=error.message[:500],
            player_id=player_id,
            move=observability.capture(args[2] if len(args) > 2 else None, 2048),
            inputs=observability.capture(list(args), monitor.config.max_logged_body_bytes),
            **self._game_log_fields(game, match, function),
        )

    def _log_if_slow(
        self,
        game: Game,
        match: Match,
        function: str,
        args: Sequence[Any],
        elapsed_ms: float,
        time_limit_seconds: float | None,
    ) -> None:
        """A game function that ran, but took a worrying share of its time limit."""
        monitor = observability.current()
        limit_ms = (time_limit_seconds or TIME_LIMIT_SECONDS) * 1000
        # "Slow" scales with the limit: playerLeft is allowed 2 s, other calls 100 ms.
        slow_ms = monitor.config.game_function_slow_ms * limit_ms / (TIME_LIMIT_SECONDS * 1000)
        if elapsed_ms < slow_ms:
            return
        monitor.count("game_slow_calls")
        observability.log_event(
            "game_function_slow",
            f"{function} took {elapsed_ms:.0f} ms in {game.name} (limit {limit_ms:.0f} ms)",
            level=logging.WARNING,
            elapsed_ms=round(elapsed_ms, 1),
            limit_ms=round(limit_ms),
            inputs=observability.capture(
                list(args), monitor.config.max_logged_game_input_bytes, keep_long_strings=True
            ),
            **self._game_log_fields(game, match, function),
        )

    def _turn_indices(
        self, match: Match, result: Any
    ) -> frozenset[int] | None:
        """A logic result's turn (player ids) as seat indices; None ends the
        match. The runner has already checked the ids are players."""
        turn = result.get("turn")
        if turn is None:
            return None
        return frozenset(
            match.seat_of_player_id(player_id).player_index for player_id in turn
        )

    def _apply_logic_result(
        self,
        match: Match,
        *,
        result: Any,
        mover_seat: Seat,
        move: JsonValue,
        made_by_user_id: str,
        leaving: bool = False,
    ) -> Match:
        """Saves the match a logic result describes: the new state, the move
        that produced it, the next turn, and — when the match ends — the
        token payouts the game returned, credited to the human players."""
        turn_indices = self._turn_indices(match, result)
        pot, payouts_by_index = self._pay_logic_result(match, result)
        now = self._clock()
        record = Move(
            move_number=len(match.moves) + 1,
            player_index=mover_seat.player_index,
            made_by_user_id=made_by_user_id,
            created_at=now,
            new_state=result.get("state"),
            next_turn_player_indices=turn_indices,
            move=move,
            player_id=match.player_id_of(mover_seat),
        )
        return self._save(
            replace(
                match,
                state=result.get("state"),
                seats=(
                    _replace_seat(match.seats, replace(mover_seat, active=False))
                    if leaving else match.seats
                ),
                moves=append_move(match.moves, record),
                turn_of_player_indices=turn_indices,
                status="ongoing" if turn_indices is not None else "over",
                end_reason=(
                    None if turn_indices is not None
                    else "player_left" if leaving else "finished"
                ),
                token_pot=pot,
                token_payouts=payouts_by_index,
                pending_leave=None,
                turn_started_at=now if turn_indices is not None and match.turn_seconds else None,
            )
        )

    def _pay_logic_result(self, match: Match, result: dict[str, Any]) -> tuple[int, dict[int, int] | None]:
        """Validate the entire distribution before transferring any tokens."""
        GameLogic._validate_result("applyMove", result, self._game_ctx(match))
        payouts = dict(match.token_payouts or {})
        raw = result.get("payouts") or {}
        for player_id, amount in raw.items():
            seat = match.seat_of_player_id(player_id)
            self._credit_tokens(seat.user_id or "", amount)
            payouts[seat.player_index] = payouts.get(seat.player_index, 0) + amount
        return match.token_pot - sum(raw.values()), payouts if raw else match.token_payouts

    def _notify_after_move(
        self, *, before: Match, saved: Match, mover_user_id: str
    ) -> None:
        """The notifications a move causes (the same ones a v1 move causes)."""
        if saved.status == "over":
            self._notify_match_event(
                "notify.match_over",
                match=saved,
                recipient_ids=[
                    user_id
                    for user_id in saved.human_user_ids
                    if user_id != mover_user_id
                ],
                tag_suffix="over",
            )
        else:
            gained = (saved.turn_of_player_indices or frozenset()) - (
                before.turn_of_player_indices or frozenset()
            )
            self._notify_match_event(
                "notify.turn",
                match=saved,
                recipient_ids=[
                    seat.user_id
                    for seat in saved.seats
                    if seat.player_index in gained
                    and seat.user_id is not None
                    and seat.user_id != mover_user_id
                ],
                tag_suffix="turn",
            )

    def _begin_v2_match(self, match: Match, game: Game) -> Match:
        """Starts a v2 match: runs newMatch, saves the result, and lets any
        computer with the first turn move. The pot is already staked —
        v2 matches take each human's stake as they join (see [_new_match]
        and [_join]) — except matches created before that, which are
        funded here, all at once."""
        humans = [seat for seat in match.seats if seat.kind == "human"]
        pot = match.token_pot
        if match.bet_per_player and not pot:
            self._fund_match_tokens(match)
            pot = match.bet_per_player * len(humans)
        funded_view = replace(match, token_pot=pot)
        try:
            result = self._logic_for(game).call(
                "newMatch",
                ctx=self._game_ctx(funded_view),
                seed=self._call_seed(match),
                now=self._clock(),
            )
        except GameLogicError as error:
            self._record_logic_error(game, "newMatch", error, match=funded_view, args=())
            raise PlatformError(
                f"the game's server code failed in newMatch: {error}"
            ) from error
        turn_indices = self._turn_indices(match, result)
        saved = self._save(
            replace(
                match,
                status="ongoing" if turn_indices is not None else "over",
                end_reason=None if turn_indices is not None else "finished",
                state=result.get("state"),
                initial_state=result.get("state"),
                initial_turn_player_indices=turn_indices,
                turn_of_player_indices=turn_indices,
                token_pot=pot,
                turn_started_at=self._clock() if match.turn_seconds else None,
            )
        )
        self._record_game_match_start(saved)
        self._schedule_computer_moves(saved)
        return self._store.get_match(match.id) or saved

    def _schedule_computer_moves(self, match: Match) -> None:
        """Arranges for the computer seats holding the turn of a v2 match to
        move: immediately when the configured delay is zero, otherwise on a
        timer, so the moves happen even if no human is online to watch."""
        game = self._store.get_game_version(match.game_id, match.game_version)
        if (
            game is None
            or not game.server_code
            or match.status != "ongoing"
            or len(match.active_human_user_ids) != 1
            or not match.turn_of_player_indices
            or not any(
                match.seats[index].kind == "computer"
                for index in match.turn_of_player_indices
            )
        ):
            return
        if self._computer_move_delay_seconds <= 0:
            self._run_computer_moves(match.id)
            return
        timer = threading.Timer(
            self._computer_move_delay_seconds,
            self._run_computer_moves,
            args=(match.id,),
        )
        timer.daemon = True
        timer.start()

    def resume_computer_moves(self) -> None:
        """Schedules computer moves for every ongoing match that is
        waiting on a computer seat. Moves are arranged on timers as play
        advances, and a server restart loses those timers, which would
        leave such a match stuck on the computer's turn forever; called
        once at startup so those matches pick up where they left off."""
        for match in self._store.list_all_matches():
            if match.status == "ongoing":
                self._schedule_computer_moves(match)

    def _run_computer_moves(self, match_id: str) -> None:
        """Moves every computer seat that holds the turn, one after another,
        until a human is to move or the match ends. A game whose computer
        logic fails is recorded and the match is left as it was."""
        with self._lock:
            match = self._store.get_match(match_id)
            if match is not None:
                match = self._enforce_clock(match)
            if match is None or match.status != "ongoing" or len(match.active_human_user_ids) != 1:
                return
            game = self._store.get_game_version(match.game_id, match.game_version)
            if game is None or not game.server_code:
                return
            current = match
            # Games could in principle pass the turn between computers
            # forever; the cap keeps a broken game from wedging the server.
            # The chain also holds the platform lock the whole time, so it
            # is bounded by time as well: past a minimum burst of actions, a
            # chain that has held the lock longer than the budget continues
            # on a timer instead of starving every other request.
            started = time.perf_counter()
            actions = 0
            for _ in range(1 if getattr(self._store, "scalable", False) else 1000):
                if (
                    current.status != "ongoing"
                    or not current.turn_of_player_indices
                ):
                    return
                computer_seats = [
                    seat
                    for seat in current.seats
                    if seat.player_index in current.turn_of_player_indices
                    and seat.kind == "computer"
                ]
                if not computer_seats:
                    return
                if (
                    actions >= _CHAIN_MIN_ACTIONS_PER_RUN
                    and time.perf_counter() - started > _CHAIN_TIME_BUDGET_SECONDS
                ):
                    break
                seat = computer_seats[0]
                player_id = current.player_id_of(seat)
                try:
                    move = self._call_logic(
                        game, current, "computerMove", current.state, player_id
                    )
                    result = self._call_logic(
                        game,
                        current,
                        "applyMove",
                        current.state,
                        player_id,
                        move,
                    )
                except InvalidMoveError as error:
                    # A computer move the game itself rejects is a game bug.
                    self._record_logic_error(
                        game, "applyMove", error,
                        match=current, args=(current.state, player_id, move),
                    )
                    return
                except PlatformError as error:
                    # Already recorded by _call_logic; leave the match as is.
                    # A timeout can be transient load, though: re-arm the
                    # chain a bounded number of times instead of leaving the
                    # match stuck on the computer's turn until a restart.
                    if isinstance(error.__cause__, GameLogicTimeout):
                        retries = self._chain_timeout_retries.get(match_id, 0) + 1
                        if retries <= _CHAIN_TIMEOUT_RETRY_LIMIT:
                            self._chain_timeout_retries[match_id] = retries
                            self._schedule_chain_continuation(
                                match_id,
                                delay_seconds=_CHAIN_TIMEOUT_RETRY_DELAY_SECONDS,
                            )
                    return
                before = current
                current = self._apply_logic_result(
                    current,
                    result=result,
                    mover_seat=seat,
                    move=move,
                    made_by_user_id="",
                )
                self._notify_after_move(
                    before=before, saved=current, mover_user_id=""
                )
                actions += 1
                self._chain_timeout_retries.pop(match_id, None)
            # The loop stopped (time budget or action cap) while a computer
            # may still hold the turn: continue on a timer, with the lock
            # released in between.
            if (
                current.status == "ongoing"
                and current.turn_of_player_indices
                and any(
                    current.seats[index].kind == "computer"
                    for index in current.turn_of_player_indices
                )
            ):
                self._schedule_chain_continuation(match_id)

    def _schedule_chain_continuation(
        self, match_id: str, *, delay_seconds: float | None = None
    ) -> None:
        """Runs the next slice of a computer-move chain on a timer. Always a
        timer, even when the configured move delay is zero: the point is to
        release the platform lock between slices, not to pace the game."""
        delay = (
            self._computer_move_delay_seconds
            if delay_seconds is None
            else delay_seconds
        )
        timer = threading.Timer(
            max(delay, 0.02), self._run_computer_moves, args=(match_id,)
        )
        timer.daemon = True
        timer.start()

    def view_state(self, match: Match, caller_id: str | None) -> JsonValue:
        """The state a caller may see of a match: for a v2 game, the game's
        own viewFor for that caller, so private information (another
        player's cards) never leaves the server. The game owner sees the
        full state (it is their game to debug); anyone without a seat in an
        ongoing v2 match sees no state. A failing viewFor is recorded and
        shows no state rather than leaking the full one."""
        game = self._store.get_game_version(match.game_id, match.game_version)
        if game is None or not game.server_code or match.state is None:
            return match.state
        seat = match.seat_of(caller_id) if caller_id else None
        if seat is None or (not seat.active and match.status == "ongoing"):
            # The game owner (when not playing) sees the full state: it is
            # their game to debug. Anyone else without a seat sees nothing.
            return match.state if caller_id == game.owner_user_id else None
        # viewFor is deterministic for a given match record (its seed is
        # derived from the record, and game code must not depend on the
        # wall clock), and every poll of every player used to pay a full
        # QuickJS call for the same result. Serve repeats from the cache
        # while this exact record is current; any change replaces the
        # record and misses.
        key = (match.id, caller_id)
        cached = self._view_cache.get(key)
        if cached is not None and cached[0] is match:
            return cached[1]
        try:
            view = self._logic_for(game).call(
                "viewFor",
                match.state,
                match.player_id_of(seat),
                ctx=self._game_ctx(match),
                seed=self._call_seed(match),
                now=self._clock(),
            )
        except GameLogicError as error:
            self._record_logic_error(
                game, "viewFor", error,
                match=match, args=(match.state, match.player_id_of(seat)),
            )
            return None
        if len(self._view_cache) > 1024:
            self._view_cache.clear()
        self._view_cache[key] = (match, view)
        return view

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
            if match.num_computer_opponents and len(match.human_user_ids) != 1:
                raise ConflictError("computer opponents are only supported in single-player matches")
            num_players = len(match.seats)
            allowed_player_counts = self._rules_of(match).allowed_player_counts
            if num_players not in allowed_player_counts:
                raise ConflictError(
                    f"the match has {num_players} players but the game allows "
                    f"{list(allowed_player_counts)}"
                )
            game = self._store.get_game_version(match.game_id, match.game_version)
            if game is not None and game.server_code:
                # A v2 match starts itself: the game's newMatch decides the
                # state and the first turn; the client's start values (kept
                # for v1 games) are ignored.
                started = self._begin_v2_match(match, game)
                self.record_match_start(
                    user_id=caller_id,
                    match_id=started.id,
                    occurred_at=started.updated_at,
                )
                return started
            if not first_turn_player_indices:
                raise InvalidRequestError(
                    "the first turn must name at least one player"
                )
            self._check_player_indices(match, first_turn_player_indices)
            humans = self._fund_match_tokens(match)
            started = self._save(
                replace(
                    match,
                    status="ongoing",
                    state=initial_state,
                    initial_state=initial_state,
                    initial_turn_player_indices=first_turn_player_indices,
                    turn_of_player_indices=first_turn_player_indices,
                    token_pot=match.bet_per_player * len(humans),
                    turn_started_at=self._clock() if match.turn_seconds else None,
                )
            )
            self._record_game_match_start(started)
            self.record_match_start(
                user_id=caller_id,
                match_id=started.id,
                occurred_at=started.updated_at,
            )
            return started

    def remove_player(self, *, caller_id: str, match_id: str, user_id: str) -> Match:
        """The owner removes [user_id] from the waiting room, exactly as if they
        had left it (their seat is freed, and a v2 stake taken on joining is
        refunded), and bars them from joining this match again. This is how an
        owner gets rid of a player who can't, or won't, let the match start."""
        with self._lock:
            match = self._get_owned_match(caller_id=caller_id, match_id=match_id)
            if match.status != "waiting_for_players":
                raise ConflictError("players can only be removed before the match starts")
            if match.matchmaking_player_count is not None:
                raise ConflictError("players can't be removed from a quick match")
            if user_id == caller_id:
                raise ConflictError(
                    "the owner cannot remove themselves; delete the match instead"
                )
            if match.seat_of(user_id) is None:
                raise NotFoundError("that user is not a player in this match")
            left = self.leave_match(caller_id=user_id, match_id=match_id)
            return self._save(
                replace(left, removed_user_ids=left.removed_user_ids | {user_id})
            )

    def leave_match(self, *, caller_id: str, match_id: str) -> Match:
        with self._lock:
            match = self._get_match(match_id)
            seat = self._get_seat(match, caller_id)
            if match.status == "over":
                raise ConflictError("the match is over")
            game = self._store.get_game_version(match.game_id, match.game_version)
            if game is not None and game.server_code:
                # A v2 leave is settled by the game's own playerLeft (or
                # the platform's equal split when the game does not decide
                # payouts): see the leave section below.
                return self._leave_match_v2(
                    match, game, seat=seat, caller_id=caller_id
                )
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
            else:
                return self._end_match_by_leave(match, caller_id=caller_id)
            saved = self._save(updated)
            others = [
                user_id for user_id in saved.human_user_ids if user_id != caller_id
            ]
            if saved.status == "over":
                self._notify_match_event(
                    "notify.match_over",
                    match=saved,
                    recipient_ids=others,
                    tag_suffix="over",
                )
            elif saved.status == "ongoing":
                leaver = self._store.get_user(caller_id)
                self._notify_match_event(
                    "notify.player_left",
                    match=saved,
                    recipient_ids=others,
                    actor_name=leaver.display_name if leaver is not None else "",
                    tag_suffix="left",
                )
            # A leave from the waiting room (still waiting_for_players) tells nobody.
            return saved

    # Leaving a v2 match (Phase 4): the game's playerLeft decides what a
    # leaver is paid, the pot is settled when too few humans remain, and
    # the maybeLeave/playerLeft endpoints let the portal confirm the
    # payout with the player before anything changes.

    def _leave_match_v2(
        self, match: Match, game: Game, *, seat: Seat, caller_id: str
    ) -> Match:
        """Leaving a v2 match. In the waiting room the leaver's stake is
        refunded and their seat freed. Mid-match, the game's playerLeft
        decides the complete result; without that handler the match ends
        and the pot is split equally."""
        if match.status == "waiting_for_players":
            if caller_id == match.owner_user_id:
                raise ConflictError(
                    "the owner cannot leave a match that has not started; "
                    "delete it instead"
                )
            # The stake was taken when the player joined; a match created
            # before stakes were taken at join time has an empty pot and
            # nothing to refund.
            staked = (
                match.bet_per_player
                if match.token_pot >= match.bet_per_player
                else 0
            )
            self._credit_tokens(caller_id, staked)
            remaining_humans = [
                user_id
                for user_id in match.human_user_ids
                if user_id != caller_id
            ]
            return self._save(
                replace(
                    match,
                    seats=_waiting_seats(
                        human_user_ids=remaining_humans,
                        num_computer_opponents=match.num_computer_opponents,
                    ),
                    token_pot=match.token_pot - staked,
                    pending_leave=None,
                )
            )
        preview = self._compute_leave_preview(match, game, caller_id)
        return self._apply_leave_preview(
            match, seat=seat, caller_id=caller_id, preview=preview
        )

    def _compute_leave_preview(
        self, match: Match, game: Game, caller_id: str
    ) -> dict[str, Any]:
        """Computes the game's playerLeft (or default split) for [caller_id]
        without changing the match: their payout, and the state and
        turn it would produce. This is what maybeLeave stores on the
        match and what leaving applies, so a confirmed leave pays exactly
        what was previewed. A game bug is recorded and answered 500; a
        game refusing the leave with InvalidMove is answered 400."""
        if self._logic_for(game).has("playerLeft"):
            try:
                result = self._call_logic(
                    game,
                    match,
                    "playerLeft",
                    match.state,
                    match.player_id_of(self._get_seat(match, caller_id)),
                    time_limit_seconds=PLAYER_LEFT_TIME_LIMIT_SECONDS,
                )
            except InvalidMoveError as error:
                raise self._game_message_error(game, error.message) from error
        else:
            # Games without a leave hook use the same result and commit path.
            # Quote the complete split, including remainder tokens, up front.
            humans = [s for s in match.seats if s.kind == "human" and s.active]
            share, extra = divmod(match.token_pot, len(humans))
            result = {"state": match.state, "turn": None, "payouts": {
                match.player_id_of(s): share + (i < extra)
                for i, s in enumerate(humans)
            }}
        return {
            "player_id": caller_id,
            "payout": (result.get("payouts") or {}).get(match.player_id_of(self._get_seat(match, caller_id)), 0),
            "payouts": result.get("payouts") or {},
            "state": result.get("state"),
            "turn": result.get("turn"),
            "move_count": len(match.moves),
        }

    def _apply_leave_preview(
        self, match: Match, *, seat: Seat, caller_id: str, preview: dict[str, Any]
    ) -> Match:
        """Apply the complete quoted result once, without creating a bot."""
        if preview.get("move_count", len(match.moves)) != len(match.moves):
            raise ConflictError("the match changed since this leave was previewed")
        result = {"state": match.state if preview.get("end") else preview.get("state"),
                  "turn": preview.get("turn"),
                  "payouts": preview.get("payouts", {})}
        if "payouts" not in preview:
            # A preview persisted before this release used the legacy contract.
            GameLogic._validate_result("legacyPlayerLeft", {"payout": preview.get("payout", 0)}, self._game_ctx(match))
            result = GameLogic._legacy_leave_result(
                {**result, "payout": preview.get("payout", 0)},
                match.player_id_of(seat), self._game_ctx(match))
        try:
            GameLogic._validate_result("playerLeft", result, self._game_ctx(match))
        except GameLogicError as error:
            raise PlatformError(str(error)) from error
        turn = self._turn_indices(match, result)
        if turn is not None and (seat.player_index in turn or len(match.active_human_user_ids) < 3):
            raise PlatformError("playerLeft must exclude the leaver and end when fewer than two humans remain")
        saved = self._apply_logic_result(
            match, result=result, mover_seat=seat, made_by_user_id=caller_id,
            move={"type": "player_left"}, leaving=True,
        )
        self._notify_leave(saved, caller_id=caller_id)
        return saved

    def _settle_pot(
        self,
        pot: int,
        payouts: dict[int, int],
        *,
        recipients: list[Seat],
        fixed: dict[int, int] | None = None,
        fallback: tuple[str, int] | None = None,
    ) -> dict[int, int]:
        """Pays out everything left in a pot of [pot] tokens and returns
        the updated per-seat payouts record. [fixed] amounts (by seat
        index) are paid exactly — a preview promised them; what remains
        is split equally among the other [recipients] (in seat order, the
        first seats get the remainder tokens). When there is nobody to
        split among, [fallback] — a (user id, seat index) pair — receives
        what is left, so a match never ends still holding tokens."""
        if pot <= 0:
            return payouts
        remaining = pot
        fixed = fixed or {}
        by_index = {seat.player_index: seat for seat in recipients}
        for index, amount in fixed.items():
            fixed_seat = by_index.get(index)
            if fixed_seat is None or not amount:
                continue
            self._credit_tokens(fixed_seat.user_id or "", amount)
            payouts[index] = payouts.get(index, 0) + amount
            remaining -= amount
        others = [seat for seat in recipients if seat.player_index not in fixed]
        if remaining > 0 and others:
            share, extra = divmod(remaining, len(others))
            for position, other in enumerate(others):
                amount = share + (1 if position < extra else 0)
                if amount:
                    self._credit_tokens(other.user_id or "", amount)
                    payouts[other.player_index] = (
                        payouts.get(other.player_index, 0) + amount
                    )
            remaining = 0
        if remaining > 0 and fallback is not None:
            user_id, index = fallback
            self._credit_tokens(user_id, remaining)
            payouts[index] = payouts.get(index, 0) + remaining
        return payouts

    def _end_match_by_leave(
        self, match: Match, *, caller_id: str, leaver_share: int | None = None
    ) -> Match:
        """Ends a client-side (v1) match because a player left.
        The pot is split equally among the
        humans in the match, the leaver included, so no stake is
        stranded. [leaver_share] pays the leaver exactly that amount (a
        preview promised it) and splits the rest among the others."""
        payouts = dict(match.token_payouts or {})
        if match.token_pot:
            humans = [s for s in match.seats if s.kind == "human" and s.active]
            leaver_seat = match.seat_of(caller_id)
            fixed = (
                {leaver_seat.player_index: leaver_share}
                if leaver_share is not None and leaver_seat is not None
                else None
            )
            payouts = self._settle_pot(
                match.token_pot, payouts, recipients=humans, fixed=fixed
            )
        saved = self._save(
            replace(
                self._ended_by_leaving(match),
                token_pot=0 if match.token_pot else match.token_pot,
                token_payouts=payouts if match.token_pot else match.token_payouts,
                pending_leave=None,
            )
        )
        self._notify_leave(saved, caller_id=caller_id)
        return saved

    def _notify_leave(self, saved: Match, *, caller_id: str) -> None:
        """The notifications a v2 leave causes (the same ones a v1 leave
        causes)."""
        others = [
            user_id for user_id in saved.human_user_ids if user_id != caller_id
        ]
        if saved.status == "over":
            self._notify_match_event(
                "notify.match_over",
                match=saved,
                recipient_ids=others,
                tag_suffix="over",
            )
        elif saved.status == "ongoing":
            leaver = self._store.get_user(caller_id)
            self._notify_match_event(
                "notify.player_left",
                match=saved,
                recipient_ids=others,
                actor_name=leaver.display_name if leaver is not None else "",
                tag_suffix="left",
            )

    def maybe_leave(self, *, caller_id: str, match_id: str) -> Match:
        """Previews leaving an ongoing v2 match (POST
        /matches/{id}/maybeLeave): computes what leaving would pay the
        caller — the game's playerLeft, or the platform's equal split
        when the game does not decide payouts — and stores it on the
        match as its pending leave. Nothing else changes; any move or
        join clears the preview, and [confirm_leave] applies it exactly."""
        with self._lock:
            match = self._get_match(match_id)
            self._get_seat(match, caller_id)
            if match.status == "over":
                raise ConflictError("the match is over")
            if match.status != "ongoing":
                raise ConflictError("the match has not started")
            game = self._store.get_game_version(match.game_id, match.game_version)
            if game is None or not game.server_code:
                raise ConflictError(
                    "only a server-side (v2) game has a leave preview"
                )
            preview = self._compute_leave_preview(match, game, caller_id)
            return self._save(replace(match, pending_leave=preview))

    def confirm_leave(self, *, caller_id: str, match_id: str) -> Match:
        """Applies the caller's stored leave preview (POST
        /matches/{id}/playerLeft), exactly as previewed. A preview only
        stands until the next move or join, so what is applied here is
        never stale."""
        with self._lock:
            match = self._get_match(match_id)
            seat = self._get_seat(match, caller_id)
            if match.status == "over":
                raise ConflictError("the match is over")
            if match.status != "ongoing":
                raise ConflictError("the match has not started")
            preview = match.pending_leave
            if not isinstance(preview, dict) or preview.get("player_id") != caller_id:
                raise ConflictError(
                    "you have no leave to confirm; preview it with maybeLeave first"
                )
            return self._apply_leave_preview(
                match, seat=seat, caller_id=caller_id, preview=preview
            )

    def make_move(
        self,
        *,
        caller_id: str,
        match_id: str,
        new_state: JsonValue,
        next_turn_player_indices: frozenset[int] | None,
        expected_move_count: int | None,
        payout_player_indices: dict[int, int] | None = None,
        move: JsonValue = None,
    ) -> Match:
        """Records a move by one of the players whose turn it is.

        Any player in the turn set may move; the move is recorded for that player's
        seat. In a v2 game (server code) [move] is all that is sent and only the
        seat's own player may move — the server moves computer seats itself. The
        on-behalf path below (a human submitting a computer seat's move in a v1
        game, whose client computes the move) remains only for games without
        server code. [next_turn_player_indices = None] ends the match.
        [expected_move_count], if given, guards against two clients submitting the
        same move.
        """
        with self._lock:
            # Reading the match applies any timeout first (see _enforce_clock).
            match = self._get_match(match_id)
            if any(t.user_id == caller_id for t in match.timeouts) and (
                match.seat_of(caller_id) is None or match.end_reason == "timed_out"
            ):
                raise ConflictError("your time to move ran out")
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
            game = self._store.get_game_version(match.game_id, match.game_version)
            if game is not None and game.server_code:
                return self._make_move_v2(
                    match, game, seat=seat, caller_id=caller_id, move=move
                )
            mover_seat = self._mover_seat(match, seat)
            if next_turn_player_indices is not None:
                if not next_turn_player_indices:
                    raise InvalidRequestError(
                        "the next turn must name at least one player"
                    )
                self._check_player_indices(match, next_turn_player_indices)
            # On a paid terminal move the server checks the complete pot distribution.
            if next_turn_player_indices is not None and payout_player_indices is not None:
                raise InvalidRequestError("payouts only allowed on the final move")
            if next_turn_player_indices is None:
                if match.token_pot and payout_player_indices is not None:
                    human_seats = {s.player_index for s in match.seats if s.kind == "human"}
                    if set(payout_player_indices) != human_seats:
                        raise InvalidRequestError("payouts must include every human seat")
                    if any(type(v) is not int or v < 0 for v in payout_player_indices.values()):
                        raise InvalidRequestError("payouts must be nonnegative integer tokens")
                    if sum(payout_player_indices.values()) != match.token_pot:
                        raise InvalidRequestError("payouts must total the token pot")
                elif payout_player_indices is not None and any(payout_player_indices.values()):
                    raise InvalidRequestError("no tokens available for payout")
            # A v1 client's claimed result can't be checked (the server runs no
            # game code), so a paid final move only proposes the split: no tokens
            # move until every other human agrees (agree_to_payouts).
            proposal = (
                dict(payout_player_indices)
                if next_turn_player_indices is None
                and match.token_pot
                and payout_player_indices is not None
                else None
            )
            if (
                next_turn_player_indices is None
                and match.token_pot
                and payout_player_indices is None
            ):
                # A game that knows nothing about tokens ended a paid match: there
                # is no result to pay out, so every human gets their stake back
                # (an equal split of the pot) instead of the match never ending.
                payout_player_indices = self._settle_pot(
                    match.token_pot,
                    {},
                    recipients=[s for s in match.seats if s.kind == "human"],
                )
            now = self._clock()
            move = Move(
                move_number=len(match.moves) + 1,
                player_index=mover_seat.player_index,
                made_by_user_id=caller_id,
                created_at=now,
                new_state=new_state,
                next_turn_player_indices=next_turn_player_indices,
            )
            saved = self._save(
                replace(
                    match,
                    state=new_state,
                    moves=append_move(match.moves, move),
                    turn_of_player_indices=next_turn_player_indices,
                    status="ongoing"
                    if next_turn_player_indices is not None
                    else "over",
                    end_reason=None
                    if next_turn_player_indices is not None
                    else "finished",
                    token_payouts=payout_player_indices
                    if next_turn_player_indices is None and proposal is None
                    else None,
                    proposed_payouts=proposal,
                    payout_agreed_indices=frozenset({seat.player_index})
                    if proposal is not None
                    else frozenset(),
                    payout_deadline=now
                    + dt.timedelta(seconds=PAYOUT_AGREEMENT_SECONDS)
                    if proposal is not None
                    else None,
                    payout_outcome=None,
                    # Every accepted move restarts the clock, also when the same
                    # player moves again (a raise and its answer, chained jumps).
                    turn_started_at=now if match.turn_seconds else None,
                )
            )
            if proposal is not None and self._payout_agreed_by_all(saved):
                # Only one human seat: nobody else has to agree.
                saved = self._settle_proposed_payouts(saved, outcome="agreed")
            if saved.status == "over":
                self._notify_match_event(
                    "notify.match_over",
                    match=saved,
                    recipient_ids=[
                        user_id
                        for user_id in saved.human_user_ids
                        if user_id != caller_id
                    ],
                    tag_suffix="over",
                )
            else:
                # Only seats that gained the turn are told: seats that already held
                # it (simultaneous turns) know, and the mover just played.
                gained = (saved.turn_of_player_indices or frozenset()) - (
                    match.turn_of_player_indices or frozenset()
                )
                self._notify_match_event(
                    "notify.turn",
                    match=saved,
                    recipient_ids=[
                        seat.user_id
                        for seat in saved.seats
                        if seat.player_index in gained
                        and seat.user_id is not None
                        and seat.user_id != caller_id
                    ],
                    tag_suffix="turn",
                )
            return saved

    def agree_to_payouts(
        self, *, caller_id: str, match_id: str, agree: bool
    ) -> Match:
        """A human in a finished v1 paid match answers the pot split its final
        move proposed. Agreeing records the caller's seat, and once every human
        seat has agreed the pot is paid as proposed. Disputing refunds every
        stake at once. Either answer is final for that seat."""
        with self._lock:
            # Reading the match applies an expired agreement deadline first.
            match = self._get_match(match_id)
            seat = match.seat_of(caller_id)
            if seat is None or seat.kind != "human":
                raise ForbiddenError("you are not a player in this match")
            if not match.payout_pending:
                raise ConflictError("this match has no payouts waiting for agreement")
            if seat.player_index in match.payout_agreed_indices:
                raise ConflictError("you already agreed to these payouts")
            if not agree:
                return self._settle_proposed_payouts(match, outcome="disputed")
            saved = self._save(
                replace(
                    match,
                    payout_agreed_indices=match.payout_agreed_indices
                    | {seat.player_index},
                )
            )
            if self._payout_agreed_by_all(saved):
                saved = self._settle_proposed_payouts(saved, outcome="agreed")
            return saved

    @staticmethod
    def _payout_human_indices(match: Match) -> frozenset[int]:
        """The seats that must agree to a proposed split: every human seat, the
        same seats the proposal has to pay (see make_move)."""
        return frozenset(s.player_index for s in match.seats if s.kind == "human")

    def _payout_agreed_by_all(self, match: Match) -> bool:
        return self._payout_human_indices(match) <= match.payout_agreed_indices

    def _settle_proposed_payouts(self, match: Match, *, outcome: PayoutOutcome) -> Match:
        """Ends a pending v1 pot split: "agreed" pays it as proposed; "disputed"
        or "expired" refunds every human's stake (an equal split of the pot).
        Clears the pending state, so it can never pay twice. The caller holds
        the lock."""
        assert match.proposed_payouts is not None and match.payout_outcome is None
        if outcome == "agreed":
            payouts = dict(match.proposed_payouts)
            for index, amount in payouts.items():
                self._credit_tokens(match.seats[index].user_id or "", amount)
        else:
            payouts = self._settle_pot(
                match.token_pot,
                {},
                recipients=[s for s in match.seats if s.kind == "human"],
            )
        return self._save(
            replace(match, token_payouts=payouts, payout_outcome=outcome)
        )

    def _make_move_v2(
        self,
        match: Match,
        game: Game,
        *,
        seat: Seat,
        caller_id: str,
        move: JsonValue,
    ) -> Match:
        """A move in a v2 match: the server runs the game's applyMove and
        stores the state it computes. The caller holds the lock; the match
        is ongoing and [seat] is the caller's seat. A player may only move
        on their own turn — nobody acts on behalf of another seat, because
        computer opponents move on the server."""
        if seat.player_index not in (match.turn_of_player_indices or frozenset()):
            raise ForbiddenError("it is not your turn")
        try:
            result = self._call_logic(
                game, match, "applyMove", match.state, match.player_id_of(seat), move
            )
        except InvalidMoveError as error:
            raise self._game_message_error(game, error.message) from error
        saved = self._apply_logic_result(
            match,
            result=result,
            mover_seat=seat,
            move=move,
            made_by_user_id=caller_id,
        )
        self._notify_after_move(before=match, saved=saved, mover_user_id=caller_id)
        self._schedule_computer_moves(saved)
        return self._store.get_match(match.id) or saved

    def delete_match(self, *, caller_id: str, match_id: str) -> None:
        """A player in the match deletes it while it is not over; once it is
        over, deleting only hides it from the caller's own list. Creating a
        match gives no delete rights on its own: the caller must be one of
        its players."""
        with self._lock:
            match = self._get_match(match_id)
            if match.status != "over" and caller_id in match.active_human_user_ids:
                # Deleting refunds every stake the match holds (a waiting v2
                # match's, taken as players joined, or an ongoing match's pot).
                self._delete_match_and_invites(match_id)
                return
            if match.status != "over":
                raise ForbiddenError(
                    "only a player in the match can delete it"
                )
            self._get_seat(match, caller_id)
            self._save(
                replace(
                    match,
                    hidden_for_user_ids=match.hidden_for_user_ids | {caller_id},
                )
            )

    # Matchmaking: random opponents

    def quick_match(
        self, *, caller_id: str, game_id: str, num_players: int | None = None
    ) -> Match:
        """Finds random opponents. Seats the caller in the oldest public quick match
        of the game that is waiting for players, or creates one for others to find.
        A quick match waits for [num_players] humans (default: the game's smallest
        count above one) and starts by itself when the last one joins. Asking again
        while already waiting returns the same match."""
        with self._lock:
            game = self._get_live_game(game_id)
            if not game.published:
                raise NotFoundError("game not found")
            multiplayer = sorted(c for c in game.rules.allowed_player_counts if c >= 2)
            if not multiplayer:
                raise ConflictError("this game is single-player only")
            target = num_players if num_players is not None else multiplayer[0]
            if target not in multiplayer:
                raise InvalidRequestError(
                    f"this game can't be played by {target} players; "
                    f"choose one of {multiplayer}"
                )
            waiting = [
                match
                for match in self._store.list_matches_by_status("waiting_for_players")
                if match.game_id == game.id
                and match.matchmaking_player_count == target
                and match.status == "waiting_for_players"
                and not match.private
                and not match.num_computer_opponents
            ]
            already_waiting = next(
                (match for match in waiting if match.seat_of(caller_id) is not None),
                None,
            )
            if already_waiting is not None:
                return already_waiting
            # Same version only, so every player in a quick match agrees on rules.
            oldest = next(
                (match for match in waiting if match.game_version == game.version),
                None,
            )
            if oldest is not None:
                return self._join(oldest, caller_id=caller_id)
            return self._new_match(
                game, caller_id=caller_id, matchmaking_player_count=target
            )

    # Invites: links (and QR codes) to a match, which also track referrals

    def create_invite(
        self,
        *,
        caller_id: str,
        match_id: str,
        expires_in_seconds: int | None = None,
        max_uses: int | None = None,
    ) -> Invite:
        """Any player in the match (or its owner) can create invites to it."""
        with self._lock:
            match = self._get_match(match_id)
            if not match.involves(caller_id):
                raise ForbiddenError("you are not a player in this match")
            if match.status == "over":
                raise ConflictError("the match is over")
            now = self._clock()
            invite = Invite(
                token=self._new_invite_token(),
                match_id=match.id,
                created_by_user_id=caller_id,
                created_at=now,
                expires_at=None
                if expires_in_seconds is None
                else now + dt.timedelta(seconds=expires_in_seconds),
                max_uses=max_uses,
            )
            self._store.put_invite(invite)
            return invite

    def view_invite(self, token: str) -> InviteView:
        """What an invite link shows: its match (even a private one, since the token
        is the secret), who sent it, and why it can't be used, if it can't. Public,
        and counted as a view in the creator's referral stats."""
        with self._lock:
            invite = self._get_invite(token)
            invite = replace(invite, views=invite.views + 1)
            self._store.put_invite(invite)
            match = self._get_match(invite.match_id)
            game = self._store.get_game_version(match.game_id, match.game_version)
            try:
                self._check_invite_usable(invite)
                problem = None
            except PlatformError as error:
                problem = str(error)
            return InviteView(
                invite=invite,
                match=match,
                game_name=game.name if game is not None else "",
                inviter=self._resolve_replaced(
                    self._require_user(invite.created_by_user_id)
                ),
                problem=problem,
            )

    def check_invite_exists(self, token: str) -> None:
        """Raises NotFoundError unless [token] names an invite. Doesn't count a view."""
        with self._lock:
            self._get_invite(token)

    def accept_invite(self, *, caller_id: str, token: str) -> Match:
        """Takes a seat through an invite, even in a private match. Players already
        in the match just get it back, so opening your own link is harmless."""
        with self._lock:
            invite = self._get_invite(token)
            match = self._get_match(invite.match_id)
            if match.seat_of(caller_id) is not None:
                return match
            self._check_invite_usable(invite)
            joined = self._join(match, caller_id=caller_id)
            user = self._store.get_user(caller_id)
            acceptance = InviteAcceptance(
                user_id=caller_id,
                accepted_at=self._clock(),
                signed_up=user is not None and user.invited_via_invite_token == token,
            )
            self._store.put_invite(
                replace(invite, acceptances=(*invite.acceptances, acceptance))
            )
            return joined

    def revoke_invite(self, *, caller_id: str, token: str) -> Invite:
        with self._lock:
            invite = self._get_invite(token)
            match = self._store.get_match(invite.match_id)
            if caller_id != invite.created_by_user_id and (
                match is None or caller_id != match.owner_user_id
            ):
                raise ForbiddenError(
                    "only the invite's creator or the match's owner can revoke it"
                )
            revoked = replace(invite, revoked=True)
            self._store.put_invite(revoked)
            return revoked

    def list_invites(
        self, *, caller_id: str, match_id: str | None = None
    ) -> list[Invite]:
        """The invites the caller created, oldest first, optionally for one match."""
        with self._lock:
            return self._store.list_invites(
                created_by_user_id=caller_id, match_id=match_id
            )

    def referrals(self, *, caller_id: str) -> tuple[list[Invite], list[User]]:
        """The caller's match invites, and the users the caller invited: through a
        match invite or a personal invite link (GET /admin/invites has the tree)."""
        with self._lock:
            invites = self._store.list_invites(created_by_user_id=caller_id)
            referred = [
                user
                for user in self._store.list_users()
                if user.replaced_by_user_id is None
                and self._inviter_of(user) == caller_id
            ]
            return invites, referred

    def _get_invite(self, token: str) -> Invite:
        invite = self._store.get_invite(token)
        if invite is None:
            raise NotFoundError("invite not found")
        return invite

    def _check_invite_usable(self, invite: Invite) -> None:
        """Raises unless someone new could take a seat with [invite] now."""
        if invite.revoked:
            raise ConflictError("this invite link was revoked")
        if invite.expires_at is not None and self._clock() >= invite.expires_at:
            raise ConflictError("this invite link has expired")
        if invite.max_uses is not None and len(invite.acceptances) >= invite.max_uses:
            raise ConflictError("this invite link has been used up")
        match = self._get_match(invite.match_id)
        if match.status == "over":
            raise ConflictError("the match is over")

    def _delete_match_and_invites(self, match_id: str) -> None:
        """Deletes a match and its invites, first giving back any tokens it still
        holds, so no deletion path (a player's, an admin's, deleting the owner's
        account) can make a stake disappear. The caller holds the lock."""
        match = self._store.get_match(match_id)
        if match is not None:
            self._refund_held_pot(match)
        for invite in self._store.list_invites(match_id=match_id):
            self._store.delete_invite(invite.token)
        self._store.delete_match(match_id)

    @staticmethod
    def _held_pot(match: Match) -> int:
        """Tokens the match holds that nobody has been paid yet: the pot of a
        waiting (v2 stakes are taken on joining) or ongoing match, or of a
        finished v1 match whose split still waits for agreement. A settled
        match holds nothing, even where [token_pot] still records its size."""
        if match.status == "over" and not match.payout_pending:
            return 0
        return match.token_pot

    def _refund_held_pot(self, match: Match) -> None:
        """Splits what [match] still holds equally among its humans (each gets
        their stake back), like a timeout does. The caller holds the lock and is
        about to delete the match."""
        held = self._held_pot(match)
        if held <= 0:
            return
        humans = [s for s in match.seats if s.kind == "human"]
        self._settle_pot(
            held, {}, recipients=[s for s in humans if s.active] or humans
        )

    # Saved games: each user's library of games to come back to

    def save_game(self, *, caller_id: str, game_id: str) -> list[Game]:
        """Adds a game to the caller's library (idempotent); returns the library."""
        with self._lock:
            game = self._get_live_game(game_id)
            if not game.published and game.owner_user_id != caller_id:
                raise NotFoundError("game not found")
            user = self._require_user(caller_id)
            if game_id not in user.saved_game_ids:
                user = replace(
                    user,
                    saved_game_ids=(*user.saved_game_ids, game_id),
                    updated_at=self._clock(),
                )
                self._store.put_user(user)
            return self._saved_games(user)

    def unsave_game(self, *, caller_id: str, game_id: str) -> list[Game]:
        """Removes a game from the caller's library (idempotent)."""
        with self._lock:
            user = self._require_user(caller_id)
            if game_id in user.saved_game_ids:
                user = replace(
                    user,
                    saved_game_ids=tuple(
                        saved for saved in user.saved_game_ids if saved != game_id
                    ),
                    updated_at=self._clock(),
                )
                self._store.put_user(user)
            return self._saved_games(user)

    def list_saved_games(self, *, caller_id: str) -> list[Game]:
        with self._lock:
            return self._saved_games(self._require_user(caller_id))

    def list_recent_games(self, *, caller_id: str) -> list[Game]:
        """Returns the user's recently played, currently published games."""
        with self._lock:
            user = self._resolve_replaced(self._require_user(caller_id))
            games = (
                self._store.get_game(game_id)
                for game_id in user.recent_game_ids[: self.RECENT_GAME_LIMIT]
            )
            return [
                game
                for game in games
                if game is not None and game.published and not game.deleted
            ]

    def record_recent_game(self, *, caller_id: str, game_id: str) -> list[Game]:
        """Records a local practice game in the user's server-side history."""
        with self._lock:
            game = self._get_live_game(game_id)
            if not game.published and game.owner_user_id != caller_id:
                raise NotFoundError("game not found")
            self._require_user(caller_id)
            self._record_recent_game_for_user(caller_id, game.id)
            return self.list_recent_games(caller_id=caller_id)

    def _saved_games(self, user: User) -> list[Game]:
        """The user's saved games that can still be played, most recently saved
        first. Deleted or unpublished games are skipped but stay saved, so they
        reappear if republished."""
        games = (self._store.get_game(game_id) for game_id in reversed(user.saved_game_ids))
        return [
            game
            for game in games
            if game is not None
            and not game.deleted
            and (game.published or game.owner_user_id == user.id)
        ]

    # Web push notifications

    def subscribe_push(
        self,
        *,
        caller_id: str,
        endpoint: str,
        p256dh: str,
        auth: str,
        expiration_time: dt.datetime | None,
    ) -> tuple[WebPushSubscription, bool]:
        """Registers or refreshes the caller's browser push subscription.

        The endpoint identifies the browser: re-subscribing with a known endpoint
        updates keys and owner in place (a browser profile is shared by every account
        logged into it) and keeps the subscription's id. Returns (subscription,
        created).
        """
        with self._lock:
            now = self._clock()
            existing = self._store.get_push_subscription_by_endpoint(endpoint)
            if existing is not None:
                subscription = replace(
                    existing,
                    user_id=caller_id,
                    p256dh=p256dh,
                    auth=auth,
                    expiration_time=expiration_time,
                    updated_at=now,
                )
                self._store.put_push_subscription(subscription)
                return subscription, False
            subscription = WebPushSubscription(
                id=self._new_id(),
                user_id=caller_id,
                endpoint=endpoint,
                p256dh=p256dh,
                auth=auth,
                expiration_time=expiration_time,
                created_at=now,
                updated_at=now,
            )
            self._store.put_push_subscription(subscription)
            # Bound the data file: past the cap, the caller's oldest ones go.
            mine = self._store.list_push_subscriptions(user_id=caller_id)
            excess = len(mine) - self._max_push_subscriptions_per_user
            if excess > 0:
                for old in sorted(mine, key=lambda s: s.created_at)[:excess]:
                    self._store.delete_push_subscription(old.id)
            return subscription, True

    def list_push_subscriptions(self, *, caller_id: str) -> list[WebPushSubscription]:
        with self._lock:
            return self._store.list_push_subscriptions(user_id=caller_id)

    def delete_push_subscription(self, *, caller_id: str, subscription_id: str) -> None:
        with self._lock:
            subscription = self._store.get_push_subscription(subscription_id)
            if subscription is None:
                raise NotFoundError("push subscription not found")
            if subscription.user_id != caller_id:
                raise ForbiddenError(
                    "you can only delete your own push subscriptions"
                )
            self._store.delete_push_subscription(subscription_id)

    def delete_push_subscription_by_endpoint(
        self, *, caller_id: str, endpoint: str
    ) -> None:
        """Unsubscribes a browser, which knows its endpoint but not the server's id.
        Idempotent: deleting an unknown endpoint is a no-op."""
        with self._lock:
            subscription = self._store.get_push_subscription_by_endpoint(endpoint)
            if subscription is None:
                return
            if subscription.user_id != caller_id:
                raise ForbiddenError(
                    "you can only delete your own push subscriptions"
                )
            self._store.delete_push_subscription_by_endpoint(endpoint)

    def send_test_push(self, *, caller_id: str) -> None:
        """Queues a test notification to all of the caller's subscriptions."""
        with self._lock:
            user = self._require_user(caller_id)
            subscriptions = self._store.list_push_subscriptions(user_id=caller_id)
            if not subscriptions:
                raise NotFoundError("push subscription not found")
            locale = i18n.normalize_locale(user.locale) or i18n.DEFAULT_LOCALE
            self._push_notifier.enqueue(
                [
                    PushMessage(
                        subscription=subscription,
                        title="Game platform",
                        body=i18n.translate("notify.test", locale),
                        url="/static/portal.html",
                        tag="test",
                    )
                    for subscription in subscriptions
                ]
            )

    def _notify_match_event(
        self,
        key: str,
        *,
        match: Match,
        recipient_ids: Iterable[str],
        actor_name: str = "",
        tag_suffix: str,
    ) -> None:
        """Queues a localized notification to every push subscription of every
        recipient. [key] is an i18n catalog key whose {game}/{name} placeholders are
        filled with the match's game name and [actor_name]. The caller holds the
        lock; delivery itself is the notifier's background work, off the request path.
        """
        subscriptions: list[tuple[str, WebPushSubscription]] = []
        for user_id in dict.fromkeys(recipient_ids):
            user = self._store.get_user(user_id)
            if user is None:
                continue
            locale = i18n.normalize_locale(user.locale) or i18n.DEFAULT_LOCALE
            for subscription in self._store.list_push_subscriptions(user_id=user_id):
                subscriptions.append((locale, subscription))
        if not subscriptions:
            return
        game = self._store.get_game_version(match.game_id, match.game_version)
        game_name = game.name if game is not None else ""
        self._push_notifier.enqueue(
            [
                PushMessage(
                    subscription=subscription,
                    title=game_name,
                    body=i18n.translate(key, locale, game=game_name, name=actor_name),
                    url=f"/static/portal.html#match={match.id}",
                    tag=f"match-{match.id}-{tag_suffix}",
                )
                for locale, subscription in subscriptions
            ]
        )

    # Debugging

    def storage_error(self) -> str | None:
        """Why the data isn't being saved, or None when it is (or the store has no
        file). Taking the lock also proves requests aren't stuck behind it."""
        if getattr(self._store, "scalable", False):
            return self._store.health()
        with self._lock:
            return getattr(self._store, "last_write_error", None)

    def all_data(self) -> AllData:
        """A consistent snapshot of everything in the store, for debugging tools."""
        with self._lock:
            return AllData(
                users=self._store.list_users(),
                game_versions=self._store.list_all_game_versions(),
                matches=self._store.list_all_matches(),
                game_version_errors=[
                    error
                    for game in self._store.list_all_game_versions()
                    for error in self._store.list_game_version_errors(
                        game_id=game.id, version=game.version
                    )
                ],
                game_test_seeds=self._store.list_game_test_seeds(),
            )

    def stats(self) -> dict[str, JsonValue]:
        """Aggregate numbers about users, games and matches, for the backoffice."""
        with self._lock:
            now = self._clock()
            users = self._store.list_users()
            versions = self._store.list_all_game_versions()
            matches = self._store.list_all_matches()

        def last_days(timestamps: Sequence[dt.datetime], days: int = 14) -> list[JsonValue]:
            today = now.date()
            counts = {today - dt.timedelta(days=d): 0 for d in range(days - 1, -1, -1)}
            for timestamp in timestamps:
                if timestamp.date() in counts:
                    counts[timestamp.date()] += 1
            return [{"date": day.isoformat(), "count": n} for day, n in counts.items()]

        latest = {game.id: game for game in versions}  # later versions overwrite
        live = [game for game in latest.values() if not game.deleted]
        builders = {game.owner_user_id for game in latest.values()}
        players = {uid for match in matches for uid in match.human_user_ids}
        owners = {match.owner_user_id for match in matches}
        by_status = {"waiting_for_players": 0, "ongoing": 0, "over": 0}
        matches_per_game: dict[str, int] = {}
        for match in matches:
            by_status[match.status] += 1
            matches_per_game[match.game_id] = matches_per_game.get(match.game_id, 0) + 1
        games_per_builder: dict[str, int] = {}
        for game in live:
            games_per_builder[game.owner_user_id] = (
                games_per_builder.get(game.owner_user_id, 0) + 1
            )
        names = {user.id: user.display_name for user in users}
        total_moves = sum(len(match.moves) for match in matches)
        finished = [m for m in matches if m.status == "over"]
        return {
            "generated_at": now.isoformat(),
            "users": {
                "total": len(users),
                "guests_only": sum(1 for u in users if not u.linked_accounts),
                "with_google": sum(
                    1 for u in users if any(a.kind == "google" for a in u.linked_accounts)
                ),
                "with_email": sum(
                    1 for u in users if any(a.kind == "email" for a in u.linked_accounts)
                ),
                "with_phone": sum(
                    1 for u in users if any(a.kind == "phone" for a in u.linked_accounts)
                ),
                "by_locale": {
                    (code or "unset"): count
                    for code, count in sorted(
                        collections.Counter(u.locale for u in users).items()
                    )
                },
                "who_built_a_game": len(builders),
                "who_played_a_match": len(players | owners),
                "new_per_day": last_days([u.created_at for u in users]),
            },
            "games": {
                "total": len(latest),
                "live": len(live),
                "deleted": len(latest) - len(live),
                "versions": len(versions),
                "builders": len(builders),
                "new_per_day": last_days(
                    [g.created_at for g in versions if g.version == 1]
                ),
                "per_game": [
                    {
                        "game_id": game.id,
                        "name": game.name,
                        "owner": names.get(game.owner_user_id, game.owner_user_id),
                        "versions": game.version,
                        "matches": matches_per_game.get(game.id, 0),
                        "deleted": game.deleted,
                    }
                    for game in sorted(
                        latest.values(),
                        key=lambda g: -matches_per_game.get(g.id, 0),
                    )
                ],
                "top_builders": [
                    {"user": names.get(uid, uid), "games": n}
                    for uid, n in sorted(
                        games_per_builder.items(), key=lambda kv: -kv[1]
                    )[:10]
                ],
            },
            "matches": {
                "total": len(matches),
                "by_status": dict(by_status),
                "computer_seats": sum(m.num_computer_opponents for m in matches),
                "human_seats": sum(len(m.human_user_ids) for m in matches),
                "total_moves": total_moves,
                "avg_moves_per_match": round(total_moves / len(matches), 1)
                if matches
                else 0,
                "ended_because_a_player_left": sum(
                    1 for m in finished if m.end_reason == "player_left"
                ),
                "new_per_day": last_days([m.created_at for m in matches]),
            },
        }

    def invite_stats(self) -> dict[str, JsonValue]:
        """The invite tree, for the backoffice: who brought whom to the platform.

        Each live (not merged-away) user appears once, with the inviter recorded when
        their account was created (resolved through merges), how many users they
        invited directly, and how many in total: the people they invited, the people
        those people invited, and so on. [depth] is how many invites separate the user
        from someone who came without one. Users are sorted by total invites, most
        first.
        """
        with self._lock:
            now = self._clock()
            users = [u for u in self._store.list_users() if u.replaced_by_user_id is None]
            parent = {user.id: self._inviter_of(user) for user in users}
        live = {user.id for user in users}
        for user_id, inviter in parent.items():
            if inviter not in live:
                parent[user_id] = None
        # Merges can in principle make someone their own (indirect) inviter. Cut any
        # such loop at the user who was created last, so every chain ends.
        order = sorted(users, key=lambda u: (u.created_at, u.id))
        for user in order:
            seen = {user.id}
            current = parent[user.id]
            while current is not None:
                if current in seen:
                    parent[user.id] = None
                    break
                seen.add(current)
                current = parent[current]
        children: dict[str, list[str]] = {user.id: [] for user in users}
        for user_id, inviter in parent.items():
            if inviter is not None:
                children[inviter].append(user_id)
        # Total invites: everyone below a user. Children are always counted before
        # their inviter (reverse breadth-first order), so no recursion is needed.
        roots = [user.id for user in order if parent[user.id] is None]
        depth: dict[str, int] = {}
        queue = collections.deque((root, 0) for root in roots)
        visit_order: list[str] = []
        while queue:
            user_id, level = queue.popleft()
            depth[user_id] = level
            visit_order.append(user_id)
            queue.extend((child, level + 1) for child in children[user_id])
        total: dict[str, int] = {}
        for user_id in reversed(visit_order):
            total[user_id] = sum(1 + total[child] for child in children[user_id])
        names = {user.id: user.display_name for user in users}
        rows = sorted(
            users,
            key=lambda u: (-total[u.id], -len(children[u.id]), u.display_name.lower(), u.id),
        )
        return {
            "generated_at": now.isoformat(),
            "summary": {
                "users": len(users),
                "invited_users": sum(1 for u in users if parent[u.id] is not None),
                "inviters": sum(1 for u in users if children[u.id]),
                "biggest_tree": max((1 + total[root] for root in roots), default=0),
                "longest_chain": max(depth.values(), default=0),
            },
            "users": [
                {
                    "id": user.id,
                    "display_name": user.display_name,
                    "picture_url": user.picture_url,
                    "invited_by_user_id": parent[user.id],
                    "invited_by_name": names.get(parent[user.id] or "", ""),
                    "referral_code": user.referral_code,
                    "direct_invites": len(children[user.id]),
                    "total_invites": total[user.id],
                    "depth": depth[user.id],
                    "created_at": user.created_at.isoformat(),
                }
                for user in rows
            ],
        }

    # Administration (the caller has the master password, not a user's credentials)

    # Feedback: users' bugs, suggestions and reports of problems, about users, games,
    # matches or the platform

    def send_feedback(
        self,
        *,
        caller_id: str,
        kind: str,
        target_type: str,
        target_id: str,
        text: str,
        page: str | None = None,
    ) -> tuple[Feedback, bool]:
        """Records [caller_id]'s feedback; returns it and whether it's new. Sending the
        same kind of feedback on the same target again within 24 hours replaces the
        earlier text instead. Feedback is private: only admins list it."""
        text = self._feedback_text(kind, text)
        with self._lock:
            caller = self._resolve_replaced(self._require_user(caller_id))
            record = self._feedback_target_record(target_type, target_id)
            target_id, target_name, context = self._feedback_target(caller, target_type, target_id, record)
            now = self._clock()
            recent = [
                RecentFeedback(
                    id=f.id, target_type=f.target_type, target_id=f.target_id, kind=f.kind, created_at=f.created_at
                )
                for f in self._store.list_recent_feedback(caller.id, since=now - FEEDBACK_WINDOW, until=now)
            ]
            feedback, repeat = self._new_feedback(
                caller, kind, target_type, target_id, target_name, text, context, page, recent, now
            )
            self._store.put_feedback(feedback)
            return feedback, repeat is None

    @staticmethod
    def _feedback_text(kind: str, text: str) -> str:
        """The trimmed text; raises InvalidRequestError for a wrong kind or length."""
        if kind not in FEEDBACK_KINDS:
            raise InvalidRequestError("kind must be bug, suggestion or problem")
        text = (text or "").strip()
        if len(text) < FEEDBACK_TEXT_MIN:
            raise InvalidRequestError("the feedback is too short: write at least 5 characters")
        if len(text) > FEEDBACK_TEXT_MAX:
            raise InvalidRequestError("the feedback is too long: use at most 1000 characters")
        return text

    def _feedback_target_record(self, target_type: str, target_id: str) -> User | Game | Match | None:
        """The stored user, game or match that feedback is about (None for the platform
        or when it doesn't exist). The caller holds the lock."""
        if not target_id:
            return None
        if target_type == "user":
            return self._store.get_user(target_id)
        if target_type == "game":
            return self._store.get_game(target_id)
        if target_type == "match":
            return self._store.get_match(target_id)
        return None

    def _feedback_target(
        self, caller: User, target_type: str, target_id: str, record: User | Game | Match | None
    ) -> tuple[str, str, dict]:
        """The target's id (a merged-away user resolves to the survivor), its name and
        the context to save; raises InvalidRequestError when it doesn't exist (for this
        caller) or is the caller's own. [record] is what [_feedback_target_record] read."""
        missing = InvalidRequestError("there is no such user, game or match")
        if target_type == "platform":
            return "", "Platform", {}
        if target_type == "user":
            if not isinstance(record, User):
                raise missing
            user = self._resolve_replaced(record)
            if user.id == caller.id:
                raise InvalidRequestError("you can't send feedback about yourself")
            return user.id, user.display_name, {}
        if target_type == "game":
            if not isinstance(record, Game) or record.deleted or (
                not record.published and record.owner_user_id != caller.id
            ):
                raise missing
            if record.owner_user_id == caller.id:
                raise InvalidRequestError("you can't send feedback about your own game")
            return record.id, record.name, {"game_version": record.version}
        if target_type == "match":
            if not isinstance(record, Match) or (record.private and not record.involves(caller.id)):
                raise missing
            # A match's name needs its game: the admin page looks the games up, so
            # sending feedback doesn't need another read.
            return record.id, "", {
                "game_id": record.game_id,
                "game_version": record.game_version,
                "move_count": len(record.moves),
            }
        raise InvalidRequestError("target_type must be user, game, match or platform")

    def _new_feedback(
        self,
        caller: User,
        kind: str,
        target_type: str,
        target_id: str,
        target_name: str,
        text: str,
        context: dict,
        page: str | None,
        recent: list[RecentFeedback],
        now: dt.datetime,
    ) -> tuple[Feedback, RecentFeedback | None]:
        """The feedback to save and the earlier message it replaces (None when it's new);
        raises TooManyRequestsError past the daily limit. [recent] is the caller's
        feedback from the last 24 hours."""
        recent = [r for r in recent if now - r.created_at < FEEDBACK_WINDOW]
        repeat = next(
            (r for r in recent if (r.target_type, r.target_id, r.kind) == (target_type, target_id, kind)),
            None,
        )
        if repeat is None and len(recent) >= FEEDBACK_PER_DAY:
            raise TooManyRequestsError("you can send at most 20 feedback messages a day; try again tomorrow")
        if page and page.strip():
            context = {**context, "page": page.strip()[:300]}
        feedback = Feedback(
            id=repeat.id if repeat else self._new_id(),
            reporter_user_id=caller.id,
            target_type=target_type,
            target_id=target_id,
            kind=kind,
            text=text,
            created_at=repeat.created_at if repeat else now,
            updated_at=now,
            target_name=target_name,
            reporter_name=caller.display_name,
            context=context,
        )
        return feedback, repeat

    def admin_feedback(
        self,
        *,
        kind: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        status: str | None = None,
    ) -> dict:
        """The newest feedback (up to 200) matching the filters (kind, target_type and
        target_id, status), and the 20 targets with the most "problem" reports."""
        with self._lock:
            matching = sorted(
                (
                    f
                    for f in self._store.list_feedback()
                    if (kind is None or f.kind == kind)
                    and (target_type is None or f.target_type == target_type)
                    and (target_id is None or f.target_id == target_id)
                    and (status is None or f.status == status)
                ),
                key=lambda f: (f.updated_at, f.id),
                reverse=True,
            )
            stats: dict[tuple[str, str], dict] = {}
            for f in sorted(self._store.list_feedback(), key=lambda f: f.created_at):
                if f.kind != "problem":
                    continue
                entry = stats.setdefault(
                    (f.target_type, f.target_id),
                    {"target_type": f.target_type, "target_id": f.target_id, "reports": 0},
                )
                entry.update(reports=entry["reports"] + 1, target_name=f.target_name, last_reported_at=f.created_at)
            return self._feedback_listing(
                matching[:FEEDBACK_ADMIN_LIMIT], len(matching) > FEEDBACK_ADMIN_LIMIT, list(stats.values())
            )

    @staticmethod
    def _feedback_listing(rows: list[Feedback], more: bool, stats: list[dict]) -> dict:
        """The admin listing: [rows] newest first, whether there are [more], and the 20
        most reported of [stats] (one {target_type, target_id, target_name, reports,
        last_reported_at} per target)."""
        most = sorted(
            (s for s in stats if s["reports"] > 0),
            key=lambda s: (-s["reports"], -s["last_reported_at"].timestamp()),
        )[:20]
        return {
            "count": len(rows),
            "more": more,
            "most_reported": [
                {**s, "last_reported_at": s["last_reported_at"].isoformat()} for s in most
            ],
            "feedback": [
                {
                    "id": f.id,
                    "kind": f.kind,
                    "target_type": f.target_type,
                    "target_id": f.target_id,
                    "target_name": f.target_name,
                    "reporter_user_id": f.reporter_user_id,
                    "reporter_name": f.reporter_name,
                    "text": f.text,
                    "status": f.status,
                    "context": f.context,
                    "created_at": f.created_at.isoformat(),
                    "updated_at": f.updated_at.isoformat(),
                }
                for f in rows
            ],
        }

    def admin_delete_user(self, user_id: str) -> None:
        """Deletes a user, the matches they own and the games they own (soft-deleted,
        like a creator's delete). Elsewhere, they leave the matches they're seated in."""
        with self._lock:
            self._require_user(user_id)
            for game in self._store.list_games(owner_user_id=user_id, include_unpublished=True):
                self._store.delete_game(game.id)
            for match in self._store.list_matches_involving(user_id):
                if match.owner_user_id == user_id:
                    self._delete_match_and_invites(match.id)
                elif match.status != "over" and match.seat_of(user_id) is not None:
                    self.leave_match(caller_id=user_id, match_id=match.id)
            for subscription in self._store.list_push_subscriptions(user_id=user_id):
                self._store.delete_push_subscription(subscription.id)
            for invite in self._store.list_invites(created_by_user_id=user_id):
                self._store.delete_invite(invite.token)
            # The people this user invited now count as invited by this user's own
            # inviter (or nobody), so everyone above keeps the credit.
            deleted = self._require_user(user_id)
            deleted_ids = {user_id, *deleted.replaced_user_ids}
            for account_id in deleted_ids:
                for assignment in self._store.list_experiment_assignments():
                    if assignment.user_id == account_id:
                        self._store.delete_experiment_assignment(
                            user_id=account_id,
                            experiment_id=assignment.experiment_id,
                        )
                for event in self._store.list_experiment_events():
                    if event.user_id == account_id:
                        self._store.delete_experiment_event(event.id)
            new_inviter = self._inviter_of(deleted)
            for user in self._store.list_users():
                if user.id != user_id and self._inviter_of(user) == user_id:
                    self._store.put_user(
                        replace(
                            user,
                            invited_by_user_id=new_inviter,
                            updated_at=self._clock(),
                        )
                    )
            self._store.delete_user(user_id)
            # The account is gone, so its code is free again (as after a restart).
            if deleted.referral_code:
                self._user_ids_by_code.pop(deleted.referral_code, None)

    def admin_delete_game(self, game_id: str) -> None:
        with self._lock:
            self._get_live_game(game_id)
            self._store.delete_game(game_id)

    def admin_delete_match(self, match_id: str) -> None:
        with self._lock:
            self._get_match(match_id)
            self._delete_match_and_invites(match_id)

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
        """The match, with any speed-match timeout applied. The caller holds the lock."""
        match = self._store.get_match(match_id)
        if match is None:
            raise NotFoundError("match not found")
        return self._enforce_clock(match)

    def now(self) -> dt.datetime:
        """The platform's current time (what speed-match deadlines are measured
        against)."""
        return self._clock()

    def _enforce_clock(self, match: Match) -> Match:
        """End unsupported legacy rosters or expired speed matches once.

        Checked on reads and moves under the lock (a transaction in query mode).
        Neither leaving nor timing out can introduce a computer opponent.
        """
        if (match.status == "ongoing" and match.num_computer_opponents
                and len(match.active_human_user_ids) != 1):
            payouts = self._settle_pot(
                match.token_pot, dict(match.token_payouts or {}),
                recipients=[s for s in match.seats if s.kind == "human" and s.active])
            return self._save(replace(
                match, status="over", turn_of_player_indices=None,
                end_reason="solo_computers_only", token_pot=0,
                token_payouts=payouts or match.token_payouts, pending_leave=None))
        if (
            match.payout_pending
            and match.payout_deadline is not None
            and self._clock() >= match.payout_deadline
        ):
            # Not everyone agreed to the v1 pot split in time: refund the stakes.
            return self._settle_proposed_payouts(match, outcome="expired")
        deadline = match.turn_deadline
        if deadline is None:
            return match
        now = self._clock()
        if now < deadline:
            return match
        turn = match.turn_of_player_indices or frozenset()
        late = [seat for seat in match.seats if seat.player_index in turn and seat.kind == "human"]
        timeouts = tuple(
            SeatTimeout(player_index=seat.player_index, user_id=seat.user_id, at=deadline)
            for seat in late
            if seat.user_id is not None
        )
        updated = replace(match, timeouts=(*match.timeouts, *timeouts))
        # Timeouts never turn a multiplayer seat into a bot. Refund any
        # outstanding stake before ending; repeated reads cannot pay twice.
        payouts = self._settle_pot(
            updated.token_pot, dict(updated.token_payouts or {}),
            recipients=[s for s in updated.seats if s.kind == "human" and s.active])
        updated = replace(self._ended_by_timeout(updated), token_pot=0,
                          token_payouts=payouts if updated.token_pot else updated.token_payouts,
                          pending_leave=None)
        saved = self._save(updated)
        self._notify_match_event(
            "notify.timed_out_over", match=saved,
            recipient_ids=[*saved.human_user_ids, *(t.user_id for t in saved.timeouts)],
            tag_suffix="timeout",
        )
        return saved

    def _ended_by_timeout(self, match: Match) -> Match:
        return replace(
            match, status="over", turn_of_player_indices=None, end_reason="timed_out"
        )

    def _get_owned_match(self, *, caller_id: str, match_id: str) -> Match:
        match = self._get_match(match_id)
        if match.owner_user_id != caller_id:
            raise ForbiddenError("only the match's owner can do this")
        return match

    def _get_seat(self, match: Match, user_id: str) -> Seat:
        seat = match.seat_of(user_id)
        if seat is None or not seat.active:
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
