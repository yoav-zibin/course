"""What the health page shows: counters, actions per minute, response times, errors
(and the turns where a fake user couldn't move), and numbers per game."""

from __future__ import annotations

import collections
import time
from dataclasses import dataclass


def percentile(values: list[float], share: float) -> float | None:
    """The value below which [share] (0 to 1) of [values] fall (nearest rank)."""
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(share * len(ordered) + 0.5) - 1))
    return ordered[index]


@dataclass
class ErrorRecord:
    at: float
    user: str
    message: str
    screenshot: str | None
    # "error", or "couldnt_move" for a turn where no random click made a move.
    kind: str = "error"
    game: str | None = None  # the game's name and version, e.g. "Tic-tac-toe v1"
    match_url: str | None = None  # the match on the target server


# The numbers kept for each game (the health page's per-game table).
GAME_COUNTERS = ("matches_created", "matches_finished", "moves", "couldnt_move")


def game_label(match: dict | None) -> str | None:
    """A match's game as "<name> v<version>", from the portal's view of the match."""
    if not match or not match.get("game_id"):
        return None
    name = match.get("game_name") or match["game_id"]
    return f"{name} v{match['game_version']}" if match.get("game_version") is not None else name


class Stats:
    COUNTERS = (
        "sessions_started",
        "sessions_finished",
        "accounts_created",
        "referral_signups",
        "matches_created",
        "matches_joined",
        "matches_finished",
        "moves",
        "leaves",
        "couldnt_move",
        "speed_matches",
        "skipped_games",
        "errors",
    )

    def __init__(self, clock=time.time) -> None:
        self.clock = clock
        self.counts = dict.fromkeys(self.COUNTERS, 0)
        self.active_users = 0
        self._actions: collections.deque[float] = collections.deque()
        self._response_ms: collections.deque[float] = collections.deque(maxlen=2000)
        self.errors: collections.deque[ErrorRecord] = collections.deque(maxlen=20)
        # Kept apart from the errors, so many stuck games can't push real errors out.
        self.couldnt_moves: collections.deque[ErrorRecord] = collections.deque(maxlen=20)
        self.games: dict[str, dict] = {}  # game id -> {"name", "versions", GAME_COUNTERS...}
        self.started_at = clock()

    def count(self, name: str, n: int = 1) -> None:
        self.counts[name] += n

    def action(self) -> None:
        self._actions.append(self.clock())

    def response(self, milliseconds: float) -> None:
        self._response_ms.append(milliseconds)

    def error(self, user: str, message: str, screenshot: str | None = None) -> None:
        self.counts["errors"] += 1
        self.errors.append(ErrorRecord(self.clock(), user, message[:500], screenshot))

    def game_count(self, name: str, match: dict | None) -> None:
        """Counts [name] (one of GAME_COUNTERS) for the match's game; nothing if the game
        isn't known (the portal hasn't shown the match yet)."""
        if not match or not match.get("game_id"):
            return
        game = self.games.setdefault(
            match["game_id"], {"name": match["game_id"], "versions": [], **dict.fromkeys(GAME_COUNTERS, 0)})
        if match.get("game_name"):
            game["name"] = match["game_name"]
        if match.get("game_version") is not None and match["game_version"] not in game["versions"]:
            game["versions"].append(match["game_version"])
        game[name] += 1

    def couldnt_move(self, user: str, match: dict | None, match_url: str | None, screenshot: str | None) -> None:
        """A turn where no random click made a move: counted (overall and for the game) and
        listed with the errors, marked "couldn't move". It isn't counted as an error."""
        self.counts["couldnt_move"] += 1
        self.game_count("couldnt_move", match)
        self.couldnt_moves.append(ErrorRecord(
            self.clock(), user, "couldn't move: no random click made a move", screenshot,
            kind="couldnt_move", game=game_label(match), match_url=match_url))

    def actions_per_minute(self) -> int:
        cutoff = self.clock() - 60
        while self._actions and self._actions[0] < cutoff:
            self._actions.popleft()
        return len(self._actions)

    def snapshot(self) -> dict:
        times = list(self._response_ms)
        median, p95 = percentile(times, 0.5), percentile(times, 0.95)
        return {
            "active_users": self.active_users,
            **self.counts,
            "actions_per_minute": self.actions_per_minute(),
            "response_ms": {
                "median": None if median is None else round(median),
                "p95": None if p95 is None else round(p95),
                "samples": len(times),
            },
            # The last 20 errors and the last 20 "couldn't move", newest first.
            "last_errors": [
                {"at": e.at, "kind": e.kind, "user": e.user, "game": e.game, "message": e.message,
                 "match_url": e.match_url, "screenshot": e.screenshot}
                for e in sorted([*self.errors, *self.couldnt_moves], key=lambda e: e.at, reverse=True)
            ],
            "games": sorted(
                ({"game_id": game_id, **game, "versions": sorted(game["versions"])} for game_id, game in self.games.items()),
                key=lambda g: g["name"].lower()),
            "uptime_seconds": round(self.clock() - self.started_at),
        }
