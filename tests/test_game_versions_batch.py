"""GET /games/versions?refs=... — the portal's batched game-version fetch.

The portal used to fetch the game of every visible match with its own
request (some 250 slow calls on 2026-10-30). The batch endpoint returns
the same full games in one call, with exactly the single-fetch visibility
rules: a version the caller couldn't fetch on its own is skipped, never
leaked.
"""

from game_platform.tests.helpers import Api, TEST_GAME_SECRET


def _two_games(api: Api) -> tuple[str, str, str]:
    """Returns (owner, game_a, game_b); game_a has versions 1 and 2."""
    owner = api.new_user("owner")
    game_a = api.new_game(owner=owner)
    game_b = api.new_game(owner=owner)
    api.ok("PATCH", f"/games/{game_a}", as_user=owner, json={"name": "Poker 2", "game_addition_request_id_and_secret": TEST_GAME_SECRET})
    return owner, game_a, game_b


def test_batch_returns_requested_versions_in_request_order(api: Api) -> None:
    _, game_a, game_b = _two_games(api)
    games = api.ok(
        "GET",
        "/games/versions",
        params={"refs": f"{game_b}@1,{game_a}@2,{game_a}@1"},
    )
    assert [(g["id"], g["version"]) for g in games] == [
        (game_b, 1),
        (game_a, 2),
        (game_a, 1),
    ]
    assert games[1] == api.ok("GET", f"/games/{game_a}/versions/2")
    assert games[1]["code"] == "<div>poker</div>"


def test_batch_skips_unknown_and_malformed_refs_and_collapses_duplicates(
    api: Api,
) -> None:
    _, game_a, _ = _two_games(api)
    games = api.ok(
        "GET",
        "/games/versions",
        params={
            "refs": f"{game_a}@99,no-such-game@1,garbage,{game_a}@x,{game_a}@1,{game_a}@1"
        },
    )
    assert [(g["id"], g["version"]) for g in games] == [(game_a, 1)]


def test_batch_with_no_refs_is_an_empty_list(api: Api) -> None:
    assert api.ok("GET", "/games/versions") == []
    assert api.ok("GET", "/games/versions", params={"refs": ""}) == []


def test_batch_rejects_more_than_200_refs(api: Api) -> None:
    refs = ",".join(f"game-{i}@1" for i in range(201))
    response = api.request("GET", "/games/versions", params={"refs": refs})
    assert response.status_code == 400


def test_batch_only_exposes_unpublished_versions_pinned_to_the_callers_matches(api: Api) -> None:
    creator, stranger, first_player, second_player = [
        api.new_user(name) for name in ("creator", "stranger", "first player", "second player")
    ]
    game_id = api.new_game(owner=creator)
    first_match = api.new_match(owner=first_player, game_id=game_id)
    api.ok("PATCH", f"/games/{game_id}", as_user=creator, json={
        "name": "Poker 2", "game_addition_request_id_and_secret": TEST_GAME_SECRET,
    })
    second_match = api.new_match(owner=second_player, game_id=game_id)
    assert api.ok("GET", f"/matches/{first_match}", as_user=first_player)["game_version"] == 1
    assert api.ok("GET", f"/matches/{second_match}", as_user=second_player)["game_version"] == 2
    api.ok("POST", f"/games/{game_id}/unpublish", as_user=creator)
    refs = {"refs": f"{game_id}@1,{game_id}@2"}
    for caller in (None, stranger, creator):
        response = api.request("GET", "/games/versions", as_user=caller, params=refs)
        assert response.status_code == 200
        assert response.json() == []
        assert response.headers["cache-control"] == "private, no-store"
        for version in (1, 2):
            assert api.request("GET", f"/games/{game_id}/versions/{version}", as_user=caller).status_code == 404
    for player, pinned_version in ((first_player, 1), (second_player, 2)):
        response = api.request("GET", "/games/versions", as_user=player, params=refs)
        assert response.status_code == 200
        assert [game["version"] for game in response.json()] == [pinned_version]
        assert response.headers["cache-control"] == "private, no-store"
        assert response.json()[0] == api.ok("GET", f"/games/{game_id}/versions/{pinned_version}", as_user=player)
        assert api.request("GET", f"/games/{game_id}/versions/{3 - pinned_version}", as_user=player).status_code == 404
