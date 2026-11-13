"""Declarative presentation uses normal game records, lists and match authority."""

import pytest

from game_platform.agent_import import GameImport
from game_platform.models import GameRules
from game_platform.scaling_service import ScalablePlatform
from game_platform.tests.fake_firestore import query_store
from game_platform.tests.helpers import Api
from game_platform.tests.test_agent_import import payload
from game_platform.tests.test_declarative_ui import declarative_payload


@pytest.mark.parametrize("query_mode", [False, True])
def test_published_declarative_games_share_regular_catalog_and_match_apis(query_mode):
    api = Api(store=query_store("declarative-catalog") if query_mode else None)
    if query_mode:
        api.platform = ScalablePlatform(store=api.platform._store, computer_move_delay_seconds=0)
        api.client.app.state.platform = api.platform
    owner = api.new_user("Author and player")
    normal = GameImport.model_validate(payload())
    native = GameImport.model_validate(declarative_payload())
    games = []
    # Exercise the normal persistent game-record boundary. The full submission
    # verifier and query-store publication evidence are covered by import tests.
    for body in (normal, native):
        games.append(api.platform.import_agent_game(
            caller_id=owner,
            name=body.name + (" (Declarative)" if body.declarative_ui else ""),
            description=body.description,
            rules=GameRules(allowed_player_counts=tuple(body.allowed_player_counts),
                            allows_leave_mid_match=False, allows_join_mid_match=False),
            code=body.client_code,
            server_code=body.server_code,
            game_schemas={key: body.unit_tests[key + "_schema"] for key in ("state", "move", "view")},
            import_package={"declarative_ui": body.declarative_ui} if body.declarative_ui else {},
        ))
    html, declarative = games
    assert html.server_code == declarative.server_code
    assert html.game_schemas == declarative.game_schemas
    listed = api.ok("GET", "/games")
    assert {item["id"] for item in listed} == {game.id for game in games}
    for item in listed:
        assert item["published"] is True
        assert item["renderer_type"] == ("declarative" if item["id"] == declarative.id else "html")
        assert "code" not in item and "declarative_ui" not in item
    assert [item["id"] for item in api.ok("GET", "/games", params={"q": "declarative"})] == [declarative.id]
    if query_mode:
        first = api.ok("GET", "/v2/games", params={"limit": "1"})
        second = api.ok("GET", "/v2/games", params={"limit": "1", "cursor": first["next_cursor"]})
        rows = first["items"] + second["items"]
        assert {row["id"] for row in rows} == {game.id for game in games}
        assert {row["renderer_type"] for row in rows} == {"html", "declarative"}
        assert all("code" not in row and "declarative_ui" not in row for row in rows)
        assert api.ok("GET", "/v2/games", params={"q": "declarative"})["items"][0]["id"] == declarative.id
    pinned = api.ok("GET", f"/games/{declarative.id}/versions/1")
    assert pinned["declarative_ui"] == native.declarative_ui
    assert pinned["server_code"] == normal.server_code

    # Both renderers submit exactly the same JSON intent to the ordinary move
    # API. Neither can send a replacement state or bypass the server's schemas.
    for game in games:
        match_id = api.new_match(owner=owner, game_id=game.id, start=True)
        before = api.ok("GET", f"/matches/{match_id}", as_user=owner)
        forged = api.request("POST", f"/matches/{match_id}/moves", as_user=owner,
                             json={"move": {"add": 99, "state": {"n": 3}}, "expected_move_count": 0})
        assert forged.status_code == 400, forged.text
        unchanged = api.ok("GET", f"/matches/{match_id}", as_user=owner)
        assert unchanged["state"] == before["state"] == {"n": 0}
        assert unchanged["move_count"] == 0
        move = api.ok("POST", f"/matches/{match_id}/moves", as_user=owner,
                      json={"move": {"add": 1}, "expected_move_count": 0})
        assert move["state"] == {"n": 1}
