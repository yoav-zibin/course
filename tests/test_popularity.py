import time
from pathlib import Path

from game_platform.json_file_store import JsonFileStore
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
    source = Path(__file__).resolve().parent.parent / "games" / "tictactoe.server.js"
    game = api.create_game({
        "name": "Computer popularity", "code": "<main>game</main>",
        "allowed_player_counts": [2], "server_code": source.read_text(),
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
        assert read_paths == [store.ref("games", game_id).path]

        store.set_game_published(game_id, False)
        assert api.ok("GET", "/games/popular") == []
    finally:
        store.close()
