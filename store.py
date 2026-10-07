"""Persistence for the game platform.

[Store] is the interface the service depends on; [InMemoryStore] keeps everything in
Python memory. A database-backed implementation can replace it later without touching
the service or the HTTP layer.
"""

from dataclasses import dataclass, replace
from typing import Protocol

from game_platform.models import Game, Match, User


class Store(Protocol):
    def put_user(self, user: User) -> None: ...

    def get_user(self, user_id: str) -> User | None: ...

    def list_users(self) -> list[User]: ...

    def delete_user(self, user_id: str) -> None:
        """Removes a user. Callers move the user's data elsewhere first."""
        ...

    def add_game_version(self, game: Game) -> None:
        """Stores a new version of a game, which becomes its latest version."""
        ...

    def put_game_version(self, game: Game) -> None:
        """Replaces an existing game version in place, keeping its version number
        (for ownership changes; new content goes through [add_game_version])."""
        ...

    def get_game(self, game_id: str) -> Game | None:
        """The latest version of a game, including deleted games."""
        ...

    def get_game_version(self, game_id: str, version: int) -> Game | None:
        """A specific version of a game, including deleted games."""
        ...

    def list_games(self, *, owner_user_id: str | None) -> list[Game]:
        """Latest versions of games that weren't deleted, oldest game first."""
        ...

    def delete_game(self, game_id: str) -> None:
        """Marks the game deleted and hides it from [list_games]. Its versions are kept,
        since matches may still use them."""
        ...

    def put_match(self, match: Match) -> None: ...

    def get_match(self, match_id: str) -> Match | None: ...

    def list_matches_involving(self, user_id: str) -> list[Match]:
        """Matches that [user_id] owns or holds a seat in, oldest first."""
        ...

    def delete_match(self, match_id: str) -> None: ...

    def list_all_game_versions(self) -> list[Game]:
        """Every version of every game, including deleted games."""
        ...

    def list_all_matches(self) -> list[Match]: ...


@dataclass(frozen=True, kw_only=True)
class Snapshot:
    """Everything in an [InMemoryStore], e.g. to save it to a file."""

    users: tuple[User, ...]
    # Every version of every game, oldest first, without the [deleted] flag.
    game_versions: tuple[Game, ...]
    deleted_game_ids: tuple[str, ...]
    matches: tuple[Match, ...]


class InMemoryStore:
    """A [Store] backed by dicts. Not thread-safe on its own; callers serialize access."""

    def __init__(self) -> None:
        # Dicts preserve insertion order, so listings come out oldest first.
        self._users: dict[str, User] = {}
        # All versions of each game, oldest first.
        self._game_versions: dict[str, list[Game]] = {}
        self._deleted_game_ids: set[str] = set()
        self._matches: dict[str, Match] = {}

    @classmethod
    def of_snapshot(cls, snapshot: Snapshot) -> "InMemoryStore":
        store = cls()
        for user in snapshot.users:
            store.put_user(user)
        for game in snapshot.game_versions:
            store.add_game_version(replace(game, deleted=False))
        store._deleted_game_ids.update(snapshot.deleted_game_ids)
        for match in snapshot.matches:
            store.put_match(match)
        return store

    def snapshot(self) -> Snapshot:
        # Records are immutable, so a shallow copy is a consistent snapshot.
        return Snapshot(
            users=tuple(self._users.values()),
            game_versions=tuple(
                game for versions in self._game_versions.values() for game in versions
            ),
            deleted_game_ids=tuple(sorted(self._deleted_game_ids)),
            matches=tuple(self._matches.values()),
        )

    def put_user(self, user: User) -> None:
        self._users[user.id] = user

    def get_user(self, user_id: str) -> User | None:
        return self._users.get(user_id)

    def list_users(self) -> list[User]:
        return list(self._users.values())

    def delete_user(self, user_id: str) -> None:
        self._users.pop(user_id, None)

    def add_game_version(self, game: Game) -> None:
        versions = self._game_versions.setdefault(game.id, [])
        assert game.version == len(versions) + 1, (game.id, game.version)
        versions.append(game)

    def put_game_version(self, game: Game) -> None:
        versions = self._game_versions.get(game.id)
        assert versions is not None and 1 <= game.version <= len(versions), (
            game.id,
            game.version,
        )
        versions[game.version - 1] = game

    def get_game(self, game_id: str) -> Game | None:
        versions = self._game_versions.get(game_id)
        return self._with_deleted_flag(versions[-1]) if versions else None

    def get_game_version(self, game_id: str, version: int) -> Game | None:
        versions = self._game_versions.get(game_id, [])
        if not 1 <= version <= len(versions):
            return None
        return self._with_deleted_flag(versions[version - 1])

    def _with_deleted_flag(self, game: Game) -> Game:
        return replace(game, deleted=game.id in self._deleted_game_ids)

    def list_games(self, *, owner_user_id: str | None) -> list[Game]:
        return [
            versions[-1]
            for game_id, versions in self._game_versions.items()
            if game_id not in self._deleted_game_ids
            and (owner_user_id is None or versions[-1].owner_user_id == owner_user_id)
        ]

    def delete_game(self, game_id: str) -> None:
        self._deleted_game_ids.add(game_id)

    def put_match(self, match: Match) -> None:
        self._matches[match.id] = match

    def get_match(self, match_id: str) -> Match | None:
        return self._matches.get(match_id)

    def list_matches_involving(self, user_id: str) -> list[Match]:
        return [match for match in self._matches.values() if match.involves(user_id)]

    def delete_match(self, match_id: str) -> None:
        self._matches.pop(match_id, None)

    def list_all_game_versions(self) -> list[Game]:
        return [
            self._with_deleted_flag(game)
            for versions in self._game_versions.values()
            for game in versions
        ]

    def list_all_matches(self) -> list[Match]:
        return list(self._matches.values())
