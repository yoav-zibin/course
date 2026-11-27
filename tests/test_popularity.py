import json
import time
from dataclasses import replace
from pathlib import Path

import pytest

from game_platform.json_file_store import JsonFileStore
from game_platform.service import FEATURED_GAME_IDS
from game_platform.tests.helpers import Api


def _await_popular(api: Api, expected: list[str], path: str = "/games/popular",
                   timeout: float = 10.0) -> None:
    """Wait until the ranked list matches the in-memory scores.

    The ranking is a native query over the persisted popularity records,
    which the background writer flushes on its interval, so it may lag the
    scores by up to that interval. Stores that answer from memory match
    on the first poll.
    """
    deadline = time.monotonic() + timeout
    while True:
        ids = [row["id"] for row in api.ok("GET", path)]
        if ids == expected:
            return
        if time.monotonic() >= deadline:
            assert ids == expected, f"popular games {ids} != {expected}"
        time.sleep(0.1)


def exercise_popularity(api: Api) -> tuple[str, str]:
    owner = api.new_user("popularity owner")
    first = api.new_game(owner=owner, allowed_player_counts=[2])
    second = api.new_game(owner=owner, allowed_player_counts=[3])
    lobby = api.new_match(owner=owner, game_id=first, num_computer_opponents=1)
    assert api.ok("GET", f"/games/{first}/popularity")["score"] == 0
    assert api.ok("GET", "/games/popular") == []

    api.ok("POST", f"/matches/{lobby}/start", as_user=owner, json={"initial_state": {}})
    assert api.ok("GET", f"/games/{first}/popularity")["score"] == 2
    api.new_match(owner=owner, game_id=second, num_computer_opponents=2, start=True)
    _await_popular(api, [second, first])

    replay = api.new_match(owner=owner, game_id=first, num_computer_opponents=1, start=True)
    assert api.request("POST", f"/matches/{replay}/start", as_user=owner, json={}).status_code == 409
    assert api.ok("GET", f"/games/{first}/popularity")["score"] == 4
    _await_popular(api, [first], path="/games/popular?limit=1")
    api.ok("DELETE", f"/matches/{replay}", as_user=owner)
    assert api.ok("GET", f"/games/{first}/popularity")["score"] == 4
    return first, second


def test_started_player_totals_reorder_games_and_never_count_lobbies_or_retries(api):
    exercise_popularity(api)


def test_featured_games_lead_the_popular_list_even_before_they_are_played(api):
    owner = api.new_user("popularity owner")
    ranked_id = api.new_game(owner=owner, allowed_player_counts=[2])
    store = api.platform._store
    ranked = store.get_game(ranked_id)
    for game_id, name in zip(FEATURED_GAME_IDS, ("Chess", "Backgammon", "Connect Four")):
        store.add_game_version(replace(ranked, id=game_id, name=name))
    store.record_game_match_start(ranked_id, 2)
    store.record_game_match_start(FEATURED_GAME_IDS[1], 3)
    _await_popular(api, [*FEATURED_GAME_IDS, ranked_id])
    _await_popular(api, list(FEATURED_GAME_IDS[:2]), path="/games/popular?limit=2")


def test_popularity_survives_a_snapshot_restart_and_match_deletion(tmp_path):
    path = tmp_path / "data.json"
    store = JsonFileStore(path)
    first, second = exercise_popularity(Api(store=store))
    store.close()
    restored = JsonFileStore(path)
    try:
        api = Api(store=restored)
        assert api.ok("GET", f"/games/{first}/popularity")["score"] == 4
        assert api.ok("GET", f"/games/{second}/popularity")["score"] == 3
        assert [row["id"] for row in api.ok("GET", "/games/popular")] == [first, second]
    finally:
        restored.close()


def test_server_computer_match_adds_all_players_exactly_once(api):
    owner = api.new_user("computer player")
    from game_platform.declarative_ui import client_document

    source = Path(__file__).resolve().parent.parent / "games" / "declarative" / "tictactoe.json"
    body = json.loads(source.read_text())
    game = api.create_game({
        "name": "Computer popularity", "code": client_document(body["declarative_ui"]),
        "declarative_ui": body["declarative_ui"],
        "allowed_player_counts": [2], "server_code": body["server_code"],
        "game_schemas": {key: body["unit_tests"][key + "_schema"] for key in ("state", "move", "view")},
    }, owner)["id"]
    match = api.new_match(owner=owner, game_id=game, num_computer_opponents=1, start=True)
    assert api.ok("GET", f"/games/{game}/popularity")["score"] == 2
    assert api.request("POST", f"/matches/{match}/start", as_user=owner, json={}).status_code == 409
    assert api.ok("GET", f"/games/{game}/popularity")["score"] == 2


def test_popular_summaries_skip_code_reads_and_respect_unpublishing(monkeypatch):
    from game_platform.tests.fake_firestore import query_store

    store = query_store()
    try:
        api = Api(store=store)
        owner = api.new_user("popular metadata owner")
        game_id = api.new_game(owner=owner)
        store.record_game_match_start(game_id, 2)
        store.clear_cache()
        read_doc = store._read_doc
        read_paths = []

        def metadata_only(ref):
            assert "/body/" not in ref.path, "summary fetched game code"
            read_paths.append(ref.path)
            return read_doc(ref)

        with monkeypatch.context() as patch:
            patch.setattr(store, "_read_doc", metadata_only)
            patch.setattr(store.client, "transaction", lambda: (_ for _ in ()).throw(
                AssertionError("popular listing opened a write transaction")))
            games = api.ok("GET", "/games/popular")
            cold_reads = store.client.reads
            cold_queries = store.client.queries
            assert api.ok("GET", "/games/popular") == games
            assert store.client.reads == cold_reads
            assert store.client.queries == cold_queries
        assert [game["id"] for game in games] == [game_id]
        assert "code" not in games[0]
        assert read_paths == [store.ref("games", game).path for game in (*FEATURED_GAME_IDS, game_id)]

        store.set_game_published(game_id, False)
        assert api.ok("GET", "/games/popular") == []
    finally:
        store.close()


@pytest.mark.parametrize("query_backend", [False, True])
def test_popular_pages_include_featured_ranked_and_unplayed_games(query_backend):
    from game_platform.tests.fake_firestore import query_store

    api = Api(store=query_store() if query_backend else None)
    store = api.platform._store
    try:
        owner = api.new_user("catalog owner")
        unplayed = api.new_game(owner=owner)
        template = store.get_game(unplayed)
        for game_id in (*FEATURED_GAME_IDS, "rank-a", "rank-b", "rank-c", "hidden", "zero"):
            store.add_game_version(replace(template, id=game_id))
        store.set_game_published("hidden", False)
        for game_id, score in [("rank-b", 3), ("rank-c", 3), ("rank-a", 6),
                               ("hidden", 8), (FEATURED_GAME_IDS[2], 2)]:
            store.record_game_match_start(game_id, score)

        ids, cursor = [], None
        for _ in range(20):
            params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
            result = api.ok("GET", "/v2/games/popular", params=params)
            ids.extend(item["id"] for item in result["items"])
            cursor = result["next_cursor"]
            if cursor is None:
                break
        assert cursor is None
        assert ids == [*FEATURED_GAME_IDS, "rank-a", "rank-c", "rank-b", *sorted([unplayed, "zero"])]
    finally:
        api.client.close()
        if query_backend:
            store.close()
