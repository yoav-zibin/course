"""Where "couldn't move" happens: rows in "Last errors" (with the game, the match and a
screenshot), and the per-game table."""

import asyncio

from fastapi.testclient import TestClient

from fake_users.app import create_app
from fake_users.config import Config, Settings
from fake_users.generator import Generator
from fake_users.stats import Stats

TICTACTOE = {"id": "m1", "game_id": "tictactoe", "game_version": 1, "game_name": "Tic-tac-toe"}
POKER = {"id": "m2", "game_id": "poker", "game_version": 2, "game_name": "Poker"}


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        self.now += 1
        return self.now


def test_couldnt_move_is_listed_with_the_errors_but_not_counted_as_one():
    stats = Stats(clock=Clock())
    stats.error("Ava", "boom")
    stats.couldnt_move("Ben", TICTACTOE, "http://127.0.0.1:8000/portal#match=m1", "1-couldnt-move.png")
    snap = stats.snapshot()
    assert snap["errors"] == 1 and snap["couldnt_move"] == 1
    newest, oldest = snap["last_errors"]
    assert newest == {
        "at": newest["at"], "kind": "couldnt_move", "user": "Ben", "game": "Tic-tac-toe v1",
        "message": "couldn't move: no random click made a move",
        "match_url": "http://127.0.0.1:8000/portal#match=m1", "screenshot": "1-couldnt-move.png",
    }
    assert oldest["kind"] == "error" and oldest["message"] == "boom" and oldest["game"] is None


def test_many_couldnt_move_rows_dont_push_real_errors_out():
    stats = Stats(clock=Clock())
    stats.error("Ava", "a real error")
    for _ in range(50):
        stats.couldnt_move("Ben", POKER, None, None)
    rows = stats.snapshot()["last_errors"]
    assert sum(r["kind"] == "couldnt_move" for r in rows) == 20
    assert [r["message"] for r in rows if r["kind"] == "error"] == ["a real error"]
    assert stats.snapshot()["couldnt_move"] == 50


def test_per_game_numbers():
    stats = Stats()
    for name, match in [("matches_created", TICTACTOE), ("moves", TICTACTOE), ("moves", TICTACTOE),
                        ("matches_finished", TICTACTOE), ("matches_created", POKER), ("moves", POKER)]:
        stats.game_count(name, match)
    stats.couldnt_move("Ben", POKER, None, None)
    stats.game_count("moves", None)  # the portal hasn't shown the match yet: not counted
    stats.game_count("moves", {"id": "m3"})
    assert stats.snapshot()["games"] == [
        {"game_id": "poker", "name": "Poker", "versions": [2],
         "matches_created": 1, "matches_finished": 0, "moves": 1, "couldnt_move": 1},
        {"game_id": "tictactoe", "name": "Tic-tac-toe", "versions": [1],
         "matches_created": 1, "matches_finished": 1, "moves": 2, "couldnt_move": 0},
    ]
    # The overall counters are counted where they always were, not by game_count.
    assert stats.snapshot()["moves"] == 0


class FakeLocator:
    def __init__(self, page, what):
        self.page, self.what = page, what

    @property
    def first(self):
        return self

    async def count(self):
        return 1 if self.page.has_game else 0

    async def screenshot(self, path):
        self.page.shots.append((self.what, path))
        open(path, "wb").write(b"png")


class FakePage:
    def __init__(self, has_game=True):
        self.has_game = has_game
        self.shots = []

    def locator(self, selector):
        return FakeLocator(self, "game")

    async def screenshot(self, path):
        self.shots.append(("page", path))
        open(path, "wb").write(b"png")


class FakeUser:
    def __init__(self, page):
        self.page, self.name = page, "Chloe"


def generator(tmp_path):
    config = Config(control_password="s3cret", accounts_file=str(tmp_path / "a.jsonl"),
                    runs_dir=str(tmp_path / "runs"), settings=Settings())
    return Generator(config, total_memory=16 * 1024**3)


def test_the_generator_screenshots_the_game_and_links_the_match(tmp_path):
    g = generator(tmp_path)
    page = FakePage()
    asyncio.run(g.couldnt_move(FakeUser(page), TICTACTOE))
    (what, path), = page.shots
    assert what == "game"  # the game's frame, not the whole page
    row, = g.stats.snapshot()["last_errors"]
    assert row["kind"] == "couldnt_move" and row["user"] == "Chloe" and row["game"] == "Tic-tac-toe v1"
    assert row["match_url"] == "http://127.0.0.1:8000/portal#match=m1"
    assert g.screenshot_path(row["screenshot"]) is not None and path.endswith(row["screenshot"])
    assert g.stats.snapshot()["games"][0]["couldnt_move"] == 1


def test_without_a_game_frame_the_whole_page_is_shot(tmp_path):
    g = generator(tmp_path)
    page = FakePage(has_game=False)
    asyncio.run(g.couldnt_move(FakeUser(page), POKER))
    assert [what for what, _ in page.shots] == ["page"]


def test_the_health_page_shows_both(tmp_path):
    g = generator(tmp_path)
    g.stats.game_count("matches_created", POKER)
    asyncio.run(g.couldnt_move(FakeUser(FakePage()), POKER))
    client = TestClient(create_app(g.config, g))
    stats = client.get("/status.json", auth=("", "s3cret")).json()["stats"]
    assert stats["games"][0]["name"] == "Poker" and stats["games"][0]["matches_created"] == 1
    assert stats["last_errors"][0]["kind"] == "couldnt_move"
    shot = client.get("/screens/" + stats["last_errors"][0]["screenshot"], auth=("", "s3cret"))
    assert shot.status_code == 200
    html = client.get("/health", auth=("", "s3cret")).text
    assert 'id="games"' in html and "couldn't move" in html and "open match" in html
