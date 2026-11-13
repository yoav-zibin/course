"""Immutable lazy history: appending a move must not read its predecessors."""

from collections.abc import Callable, Iterator, Sequence
from game_platform.models import Move


class MoveHistory(Sequence[Move]):
    def __init__(
        self,
        count: int,
        read: Callable[[int, int], list[Move]],
        appended: tuple[Move, ...] = (),
        *,
        last_move_player_index: int | None = None,
    ):
        self.persisted_count = count
        self._read = read
        self.appended = appended
        self._last_move_player_index = last_move_player_index

    def __len__(self) -> int:
        return self.persisted_count + len(self.appended)

    def __getitem__(self, key):
        if isinstance(key, slice):
            start, stop, step = key.indices(len(self))
            if step != 1:
                return tuple(self[i] for i in range(start, stop, step))
            persisted = (
                self._read(start, min(stop, self.persisted_count))
                if start < self.persisted_count
                else []
            )
            return (
                tuple(persisted)
                + self.appended[
                    max(0, start - self.persisted_count) : max(
                        0, stop - self.persisted_count
                    )
                ]
            )
        if key < 0:
            key += len(self)
        if not 0 <= key < len(self):
            raise IndexError(key)
        if key >= self.persisted_count:
            return self.appended[key - self.persisted_count]
        return self._read(key, key + 1)[0]

    def __iter__(self) -> Iterator[Move]:
        for start in range(0, self.persisted_count, 100):
            yield from self._read(start, min(start + 100, self.persisted_count))
        yield from self.appended

    def append(self, move: Move) -> "MoveHistory":
        return MoveHistory(self.persisted_count, self._read, (*self.appended, move),
                           last_move_player_index=move.player_index)

    @property
    def last_move_player_index(self) -> int | None:
        if not len(self):
            return None
        if self.appended:
            return self.appended[-1].player_index
        if self._last_move_player_index is None:
            # Matches written before actor metadata need at most one bounded
            # immutable-history read, never a scan of their preceding moves.
            self._last_move_player_index = self[-1].player_index
        return self._last_move_player_index


def last_move_player_index(history: Sequence[Move]) -> int | None:
    if not history:
        return None
    return history.last_move_player_index if isinstance(history, MoveHistory) else history[-1].player_index


def append_move(history: Sequence[Move], move: Move):
    return (
        history.append(move) if isinstance(history, MoveHistory) else (*history, move)
    )


def history_prefix(history: Sequence[Move], count: int) -> MoveHistory:
    """A read-only prefix for historical views, without fetching old moves."""
    if not 0 <= count <= len(history):
        raise ValueError("history prefix is out of bounds")
    return MoveHistory(count, lambda start, stop: list(history[start:stop]))
