"""Speed matches: an optional per-move clock, enforced by the server when matches are
read, listed or moved in. The tests set the clock by hand; nothing waits for real."""

import datetime as dt
import json
import threading
from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient

from game_platform.api import create_app
from game_platform.json_file_store import JsonFileStore, read_snapshot
from game_platform.models import GameRules
from game_platform.push import PushMessage
from game_platform.tests.helpers import TEST_GAME_SCHEMAS

# A pass-through server game (see tests.helpers.ECHO_SERVER_CODE) whose
# state counts: newMatch starts at {"n": 0} and a move names the next
# state and turn, so the clock tests can drive any turn pattern.
DUEL_SERVER_CODE = """
const game = {
  newMatch(ctx) { return { state: { n: 0 }, turn: [ctx.players[0].id] }; },
  applyMove(state, playerId, move, ctx) {
    const m = move && typeof move === "object" && !Array.isArray(move) ? move : {};
    let turn = null;
    if (m.turn_indices != null) {
      const bad = !Array.isArray(m.turn_indices)
        || m.turn_indices.length === 0
        || m.turn_indices.some((i) => !Number.isInteger(i) || i < 0 || i >= ctx.players.length)
        || new Set(m.turn_indices).size !== m.turn_indices.length;
      if (bad) throw new InvalidMove();
      turn = m.turn_indices.map((i) => ctx.players[i].id);
    }
    const result = {
      state: "state" in m ? m.state : state,
      turn,
    };
    if (turn === null && ctx.pot) {
      const humans = ctx.players.filter((p) => p.kind === "human" && p.active !== false);
      const split = {};
      const share = Math.floor(ctx.pot / humans.length);
      let rest = ctx.pot - share * humans.length;
      for (const p of humans) split[p.id] = share + (rest-- > 0 ? 1 : 0);
      result.payouts = split;
    }
    return result;
  },
  computerMove(state, playerId, ctx) {
    return { state: state, turn_indices: [0] };
  },
  viewFor(state, playerId, ctx) { return state; },
};
"""
from game_platform.service import ConflictError, GamePlatform, InvalidRequestError

START = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)


class ManualClock:
    """A clock that only moves when the test moves it."""

    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> dt.datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += dt.timedelta(seconds=seconds)


class FakeNotifier:
    def __init__(self) -> None:
        self.messages: list[PushMessage] = []

    def enqueue(self, messages: Sequence[PushMessage]) -> None:
        self.messages.extend(messages)

    def close(self) -> None:
        pass


class World:
    """A platform with a hand-set clock, a few users and a game."""

    def __init__(self, *, leave: bool = True, counts: Sequence[int] = (2, 3), store=None) -> None:
        self.clock = ManualClock()
        self.notifier = FakeNotifier()
        self.platform = GamePlatform(store=store, clock=self.clock, push_notifier=self.notifier)
        self.ann = self.platform.create_user(display_name="ann").id
        self.bob = self.platform.create_user(display_name="bob").id
        self.cy = self.platform.create_user(display_name="cy").id
        self.game = self.platform.create_game(
            caller_id=self.ann,
            name="Duel",
            description="",
            rules=GameRules(
                allowed_player_counts=tuple(counts),
                allows_leave_mid_match=leave,
                allows_join_mid_match=True,
            ),
            code="<div>duel</div>",
            server_code=DUEL_SERVER_CODE,
            game_schemas=TEST_GAME_SCHEMAS,
        ).id

    def match(
        self,
        *,
        turn_seconds: int | None = 60,
        joiners: Sequence[str] = (),
        computers: int = 0,
        first: Sequence[int] = (0,),
        start: bool = True,
    ) -> str:
        match = self.platform.create_match(
            caller_id=self.ann,
            game_id=self.game,
            num_computer_opponents=computers,
            turn_seconds=turn_seconds,
        )
        for user in joiners:
            self.platform.join_match(caller_id=user, match_id=match.id)
        if start:
            self.platform.start_match(caller_id=self.ann, match_id=match.id)
            if tuple(first) != (0,):
                from dataclasses import replace as _replace

                stored = self.platform._store.get_match(match.id)
                self.platform._store.put_match(
                    _replace(
                        stored,
                        turn_of_player_indices=frozenset(first),
                        initial_turn_player_indices=frozenset(first),
                    )
                )
        return match.id

    def move(self, match_id: str, user: str, next_turn: Sequence[int] | None):
        return self.platform.make_move(
            caller_id=user,
            match_id=match_id,
            move={
                "state": {"n": 1},
                "turn_indices": None if next_turn is None else list(next_turn),
            },
            expected_move_count=None,
        )

    def get(self, match_id: str):
        return self.platform.get_match(match_id, caller_id=self.ann)

    def subscribe(self, user: str) -> None:
        self.platform.subscribe_push(
            caller_id=user,
            endpoint=f"https://push.example/{user}",
            p256dh="p" * 87,
            auth="a" * 22,
            expiration_time=None,
        )


def kinds(match) -> list[str]:
    return [seat.kind for seat in match.seats]


# Choosing


def test_only_60_180_or_600_seconds_are_accepted() -> None:
    world = World()
    for seconds in (60, 180, 600, None):
        world.platform.create_match(
            caller_id=world.ann, game_id=world.game, num_computer_opponents=0, turn_seconds=seconds
        )
    for seconds in (0, 30, 61, 300, -60, 3600):
        with pytest.raises(InvalidRequestError, match="turn_seconds must be 60, 180 or 600"):
            world.platform.create_match(
                caller_id=world.ann, game_id=world.game, num_computer_opponents=0, turn_seconds=seconds
            )


def test_the_api_rejects_other_values_with_a_400() -> None:
    world = World()
    client = TestClient(create_app(world.platform))
    password = world.platform._store.get_user(world.ann).password
    headers = {"X-User-Id": world.ann, "X-User-Password": password}
    bad = client.post("/matches", headers=headers, json={"game_id": world.game, "turn_seconds": 120})
    assert bad.status_code == 400
    assert "60, 180 or 600" in bad.json()["detail"]
    ok = client.post("/matches", headers=headers, json={"game_id": world.game, "turn_seconds": 180})
    assert ok.status_code == 201
    assert ok.json()["turn_seconds"] == 180


# The clock


def test_a_regular_match_never_times_out() -> None:
    world = World()
    match_id = world.match(turn_seconds=None, joiners=[world.bob])
    world.clock.advance(365 * 24 * 3600)
    match = world.get(match_id)
    assert match.status == "ongoing" and kinds(match) == ["human", "human"]
    assert match.turn_started_at is None and match.turn_deadline is None and match.timeouts == ()


def test_no_clock_while_waiting_or_after_the_end() -> None:
    world = World()
    waiting = world.match(joiners=[world.bob], start=False)
    assert world.get(waiting).turn_deadline is None
    world.clock.advance(3600)
    assert world.get(waiting).status == "waiting_for_players"
    over = world.match(joiners=[world.bob])
    world.move(over, world.ann, None)
    assert world.get(over).turn_deadline is None


def test_one_second_early_is_fine_and_one_second_late_times_out() -> None:
    world = World()
    match_id = world.match(joiners=[world.bob])
    assert world.get(match_id).turn_deadline == START + dt.timedelta(seconds=60)
    world.clock.advance(59)
    assert kinds(world.get(match_id)) == ["human", "human"]
    world.clock.advance(2)  # 61 s
    match = world.get(match_id)
    assert kinds(match) == ["human", "human"]
    assert [(t.player_index, t.user_id, t.at) for t in match.timeouts] == [
        (0, world.ann, START + dt.timedelta(seconds=60))
    ]


def test_the_clock_restarts_after_every_move_even_by_the_same_player() -> None:
    world = World()
    match_id = world.match(joiners=[world.bob])
    world.clock.advance(50)
    world.move(match_id, world.ann, [0])  # Ann moves again (e.g. a raise she then plays)
    world.clock.advance(50)  # 100 s since the start, 50 s since her last move
    world.move(match_id, world.ann, [1])
    world.clock.advance(50)
    match = world.get(match_id)
    assert match.status == "ongoing" and kinds(match) == ["human", "human"]
    assert match.turn_deadline == world.clock.now + dt.timedelta(seconds=10)


def test_a_late_move_is_rejected() -> None:
    world = World()
    match_id = world.match(joiners=[world.bob])
    world.clock.advance(61)
    with pytest.raises(ConflictError, match="your time to move ran out"):
        world.move(match_id, world.ann, [1])
    assert len(world.get(match_id).moves) == 0


def test_a_late_move_from_the_offline_queue_gets_a_clear_409() -> None:
    world = World(leave=False)
    match_id = world.match(joiners=[world.bob])
    client = TestClient(create_app(world.platform))
    password = world.platform._store.get_user(world.ann).password
    world.clock.advance(61)
    response = client.post(
        f"/matches/{match_id}/moves",
        headers={"X-User-Id": world.ann, "X-User-Password": password},
        json={"move": {"state": {"n": 1}, "turn_indices": [1]}, "expected_move_count": 0},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "your time to move ran out"
    assert response.json()["code"] == "turn_time_ran_out"


# Time's up


def test_timeout_ends_multiplayer_without_creating_computers() -> None:
    world = World()
    mid = world.match(joiners=[world.bob, world.cy])
    world.clock.advance(61)
    match = world.get(mid)
    assert match.status == "over" and match.end_reason == "timed_out"
    assert kinds(match) == ["human", "human", "human"]
    assert match.turn_deadline is None
    with pytest.raises(ConflictError):
        world.move(mid, world.bob, [1])


def test_a_v2_timeout_ends_without_running_a_computer() -> None:
    """Regression (Phase 8): when a timed-out seat is taken over in a v2
    match, the server must move the computer — in v1 a human's browser
    did it, so the takeover path never scheduled a move and the match
    stalled on the computer's turn (found by e2e/speed.spec.ts)."""
    from pathlib import Path

    from game_platform.store import InMemoryStore

    games = Path(__file__).parent.parent / "games"
    clock = ManualClock()
    platform = GamePlatform(
        store=InMemoryStore(), clock=clock, computer_move_delay_seconds=0
    )
    ann = platform.create_user(display_name="ann").id
    bob = platform.create_user(display_name="bob").id
    # The debug game, whose computer move (a pass) is instant: this test
    # is about the scheduling, not about any game's thinking time.
    game = platform.create_game(
        caller_id=ann,
        name="Debug",
        description="",
        rules=GameRules(
            allowed_player_counts=(2, 3),
            allows_leave_mid_match=True,
            allows_join_mid_match=True,
        ),
        code=(games / "debug.html").read_text(),
        server_code=(games / "debug.server.js").read_text(),
        game_schemas=json.loads((games / "debug.schema.json").read_text()),
    )
    match = platform.create_match(
        caller_id=ann, game_id=game.id, num_computer_opponents=0, turn_seconds=60
    )
    platform.join_match(caller_id=bob, match_id=match.id)
    platform.start_match(caller_id=ann, match_id=match.id)
    clock.advance(61)
    after = platform.get_match(match.id, caller_id=ann)
    assert kinds(after) == ["human", "human"]
    assert after.status == "over" and after.end_reason == "timed_out"
    assert after.turn_of_player_indices is None
    assert len(after.moves) == 0
    assert after.state == {"counter": 0, "note": ""}


def test_every_human_with_the_turn_times_out() -> None:
    world = World()
    match_id = world.match(joiners=[world.bob, world.cy], first=[0, 1])
    world.clock.advance(61)
    match = world.get(match_id)
    assert kinds(match) == ["human", "human", "human"]
    assert sorted(t.user_id for t in match.timeouts) == sorted([world.ann, world.bob])


def test_the_match_ends_when_leaving_is_not_allowed() -> None:
    world = World(leave=False)
    match_id = world.match(joiners=[world.bob])
    world.clock.advance(61)
    match = world.get(match_id)
    assert (match.status, match.end_reason, match.turn_of_player_indices) == ("over", "timed_out", None)
    assert kinds(match) == ["human", "human"] and match.timeouts[0].user_id == world.ann


def test_the_match_ends_in_a_paid_match() -> None:
    world = World()
    match = world.platform.create_match(
        caller_id=world.ann, game_id=world.game, num_computer_opponents=0, bet_per_player=1, turn_seconds=60
    )
    world.platform.join_match(caller_id=world.bob, match_id=match.id)
    world.platform.start_match(caller_id=world.ann, match_id=match.id)
    world.clock.advance(61)
    assert world.get(match.id).end_reason == "timed_out"


def test_the_match_ends_when_no_humans_are_left() -> None:
    world = World()
    match_id = world.match(computers=1)
    world.clock.advance(61)
    match = world.get(match_id)
    assert (match.status, match.end_reason) == ("over", "timed_out")


def test_computer_seats_never_time_out() -> None:
    world = World()
    match_id = world.match(computers=1, first=[1])
    world.clock.advance(3600)
    match = world.get(match_id)
    assert match.status == "ongoing" and kinds(match) == ["human", "computer"]
    assert match.turn_deadline is None


def test_two_simultaneous_checks_time_out_only_once() -> None:
    world = World()
    world.subscribe(world.ann)
    match_id = world.match(joiners=[world.bob, world.cy])
    world.clock.advance(61)
    barrier = threading.Barrier(8)
    results = []

    def check() -> None:
        barrier.wait()
        results.append(world.platform.get_match(match_id, caller_id=world.bob))

    threads = [threading.Thread(target=check) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    match = world.get(match_id)
    assert len(match.timeouts) == 1
    assert {len(r.timeouts) for r in results} == {1}
    assert [m.body for m in world.notifier.messages].count(
        "Duel ended: time ran out"
    ) == 1


def test_listing_applies_the_timeout_too() -> None:
    world = World()
    match_id = world.match(joiners=[world.bob])
    world.clock.advance(61)
    listed = world.platform.list_matches(caller_id=world.bob, status=None, game_id=None)
    assert kinds(next(m for m in listed if m.id == match_id)) == ["human", "human"]


def test_the_timed_out_player_can_still_watch() -> None:
    world = World()
    mid = world.match(joiners=[world.bob], first=[1])
    world.clock.advance(61)
    match = world.platform.get_match(mid, caller_id=world.bob)
    assert match.status == "over" and match.involves(world.bob)
    assert mid in [m.id for m in world.platform.list_matches(caller_id=world.bob, status=None, game_id=None)]


def test_ended_timeout_cannot_be_joined() -> None:
    world = World()
    mid = world.match(joiners=[world.bob])
    world.clock.advance(61)
    assert world.get(mid).status == "over"
    with pytest.raises(ConflictError, match="the match is over"):
        world.platform.join_match(caller_id=world.cy, match_id=mid)


def test_joining_a_seat_without_the_turn_leaves_the_clock_alone() -> None:
    world = World(counts=(2, 3))
    match_id = world.match(joiners=[world.bob], first=[0])
    started = world.get(match_id).turn_deadline
    world.clock.advance(30)
    world.platform.join_match(caller_id=world.cy, match_id=match_id)
    match = world.get(match_id)
    assert match.seat_of(world.cy).player_index == 2  # the computer's seat, not Ann's turn
    assert match.turn_deadline == started


# Rematches and quick matches


def test_rematches_keep_the_setting_and_quick_matches_stay_regular() -> None:
    world = World(leave=False)
    match_id = world.match(turn_seconds=180, joiners=[world.bob])
    world.move(match_id, world.ann, None)
    rematch = world.platform.request_rematch(caller_id=world.bob, match_id=match_id)
    assert rematch.turn_seconds == 180
    quick = world.platform.quick_match(caller_id=world.cy, game_id=world.game)
    assert quick.turn_seconds is None


# Notifications


def test_the_timed_out_player_is_notified_about_the_takeover() -> None:
    world = World()
    for user in (world.ann, world.bob, world.cy):
        world.subscribe(user)
    match_id = world.match(joiners=[world.bob, world.cy])
    world.notifier.messages.clear()
    world.clock.advance(61)
    world.get(match_id)
    sent = [(m.subscription.user_id, m.body) for m in world.notifier.messages]
    assert sorted(sent) == sorted((u, "Duel ended: time ran out") for u in (world.ann, world.bob, world.cy))


def test_everyone_is_notified_when_the_match_ends_on_time() -> None:
    world = World(leave=False)
    for user in (world.ann, world.bob):
        world.subscribe(user)
    match_id = world.match(joiners=[world.bob])
    world.notifier.messages.clear()
    world.clock.advance(61)
    world.get(match_id)
    sent = sorted((m.subscription.user_id, m.body) for m in world.notifier.messages)
    assert sent == sorted([(world.ann, "Duel ended: time ran out"), (world.bob, "Duel ended: time ran out")])


def test_repeated_timeout_reads_do_not_notify_twice() -> None:
    world = World()
    for user in (world.ann, world.bob):
        world.subscribe(user)
    mid = world.match(joiners=[world.bob])
    world.notifier.messages.clear()
    world.clock.advance(61)
    world.get(mid)
    count = len(world.notifier.messages)
    assert count == 2
    world.clock.advance(61)
    assert world.get(mid).status == "over"
    assert len(world.notifier.messages) == count


# The API


def test_the_api_returns_the_clock_and_the_servers_time() -> None:
    world = World()
    match_id = world.match(joiners=[world.bob])
    world.clock.advance(20)
    client = TestClient(create_app(world.platform))
    body = client.get(f"/matches/{match_id}").json()
    assert body["turn_seconds"] == 60
    assert body["turn_deadline"] == "2026-01-01T00:01:00Z"
    assert body["server_time"] == "2026-01-01T00:00:20Z"
    world.clock.advance(41)
    body = client.get(f"/matches/{match_id}").json()
    assert body["timeouts"] == [{"player_index": 0, "user_id": world.ann, "at": "2026-01-01T00:01:00Z"}]
    assert body["players"][0]["kind"] == "human"


# The data file


def test_the_new_fields_survive_a_restart(tmp_path) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path, min_write_interval_seconds=0)
    world = World(store=store)
    match_id = world.match(joiners=[world.bob, world.cy])
    world.clock.advance(61)
    before = world.get(match_id)
    store.close()
    reloaded = read_snapshot(path)
    match = next(m for m in reloaded.matches if m.id == match_id)
    assert (match.turn_seconds, match.turn_started_at, match.timeouts) == (
        before.turn_seconds,
        before.turn_started_at,
        before.timeouts,
    )
