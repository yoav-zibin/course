import json
import time
from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import ValidationError

from game_platform.json_file_store import JsonFileStore
from game_platform.testing import Api


def _wait_until(condition: Callable[[], bool]) -> None:
    deadline = time.monotonic() + 10
    while not condition():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.01)


def _user_names_in(path: Path) -> list[str]:
    return [
        user["display_name"] for user in json.loads(path.read_text())["data"]["users"]
    ]


def test_all_data_survives_a_restart(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path)
    api = Api(store=store)
    alice, bob = api.new_user("alice"), api.new_user("bob")
    game_id = api.new_game(owner=alice)
    api.ok("PATCH", f"/games/{game_id}", as_user=alice, json={"name": "Poker 2"})
    match_id = api.new_match(owner=alice, game_id=game_id, joiners=[bob], start=True)
    api.move(match_id, as_user=alice, next_turn=None, state={"winner": [0, "alice"]})
    api.ok("DELETE", f"/matches/{match_id}", as_user=bob)
    api.ok("DELETE", f"/games/{game_id}", as_user=alice)
    before = api.ok("GET", "/debug/all-data")
    store.close()

    restarted = JsonFileStore(path)
    after = Api(store=restarted).ok("GET", "/debug/all-data")
    restarted.close()
    assert after == before


def test_a_missing_file_starts_empty_and_is_created_on_the_first_change(
    tmp_path: Path,
) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path)
    api = Api(store=store)
    assert api.ok("GET", "/debug/all-data") == {
        "users": [],
        "game_versions": [],
        "matches": [],
    }
    assert not path.exists()

    api.new_user("alice")
    _wait_until(path.exists)
    store.close()
    assert _user_names_in(path) == ["alice"]
    assert sorted(file.name for file in tmp_path.iterdir()) == ["data.json"]


def test_writes_are_rate_limited_and_close_writes_pending_changes(
    tmp_path: Path,
) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path, min_write_interval_seconds=60)
    api = Api(store=store)
    api.new_user("alice")
    _wait_until(path.exists)

    # Within the interval, later changes stay in memory only...
    api.new_user("bob")
    api.new_user("carol")
    time.sleep(0.2)
    assert _user_names_in(path) == ["alice"]

    # ...until the next write, here forced by closing.
    store.close()
    assert _user_names_in(path) == ["alice", "bob", "carol"]


def test_reads_do_not_rewrite_the_file(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    store = JsonFileStore(path, min_write_interval_seconds=0)
    api = Api(store=store)
    user_id = api.new_user("alice")
    _wait_until(path.exists)
    store.flush()
    written_at = path.stat().st_mtime_ns

    api.ok("GET", f"/users/{user_id}")
    api.ok("GET", "/debug/all-data")
    store.close()
    assert path.stat().st_mtime_ns == written_at


def test_an_unreadable_file_is_rejected_rather_than_overwritten(tmp_path: Path) -> None:
    path = tmp_path / "data.json"
    path.write_text('{"format_version": 1, "data": {"users": "oops"}}')
    with pytest.raises(ValidationError):
        JsonFileStore(path)

    path.write_text(
        '{"format_version": 2, "data": {"users": [], "game_versions": [], '
        '"deleted_game_ids": [], "matches": []}}'
    )
    with pytest.raises(ValueError) as error:
        JsonFileStore(path)
    assert str(error.value) == f"{path} has format version 2, expected 1"
