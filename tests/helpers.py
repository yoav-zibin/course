"""Test helpers: a thin client over the HTTP API that reads like the product terminology."""

import datetime as dt
from collections.abc import Mapping, Sequence
from typing import Any

import httpx
from fastapi.testclient import TestClient

from game_platform.api import create_app
from game_platform.config import AuthConfig, PushConfig
from game_platform.models import GameRules
from game_platform.push import PushNotifier
from game_platform.senders import CodeSender
from game_platform.service import GamePlatform
from game_platform.store import Store
from game_platform.game_logic import GameLogic

TEST_GAME_SCHEMAS = {"state": True, "move": True, "view": True}


class UnrestrictedGameLogic(GameLogic):
    """Test game mechanics with explicit schemas that accept all JSON values."""

    def __init__(self, server_code: str, **kwargs: Any) -> None:
        kwargs.setdefault("game_schemas", TEST_GAME_SCHEMAS)
        super().__init__(server_code, **kwargs)


def run_unrestricted_server_code(*args: Any, **kwargs: Any) -> Any:
    """Run mechanics-focused test games with explicit allow-any-JSON schemas."""
    from game_platform.game_testing import test_server_code

    kwargs.setdefault("game_schemas", TEST_GAME_SCHEMAS)
    return test_server_code(*args, **kwargs)


class FakeClock:
    """Starts at 2026-01-01 UTC and advances one minute per reading."""

    def __init__(self) -> None:
        self._now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)

    def __call__(self) -> dt.datetime:
        self._now += dt.timedelta(minutes=1)
        return self._now


class Api:
    def __init__(
        self,
        *,
        store: Store | None = None,
        auth_config: AuthConfig | None = None,
        sms_sender: CodeSender | None = None,
        email_sender: CodeSender | None = None,
        push_notifier: PushNotifier | None = None,
        push_config: PushConfig | None = None,
        max_push_subscriptions_per_user: int = 10,
        computer_move_delay_seconds: float = 0,
        require_game_strings: bool = False,
        master_password: str | None = None,
    ) -> None:
        platform = GamePlatform(
            require_game_strings=require_game_strings,
            store=store,
            clock=FakeClock(),
            push_notifier=push_notifier,
            max_push_subscriptions_per_user=max_push_subscriptions_per_user,
            computer_move_delay_seconds=computer_move_delay_seconds,
        )
        self.client = TestClient(
            create_app(
                platform,
                auth_config=auth_config,
                sms_sender=sms_sender,
                email_sender=email_sender,
                push_config=push_config,
                master_password=master_password,
            )
        )
        self.platform = platform
        self._names_by_user_id: dict[str, str] = {}
        self.passwords_by_user_id: dict[str, str] = {}

    def request(
        self,
        method: str,
        path: str,
        *,
        as_user: str | None = None,
        password: str | None = None,
        json: Any = None,
        params: Mapping[str, str] | None = None,
    ) -> httpx.Response:
        """[as_user] is sent with its password from [new_user], unless [password] is
        given."""
        headers = {}
        if as_user is not None:
            headers["X-User-Id"] = as_user
            password = password or self.passwords_by_user_id.get(as_user)
        if password is not None:
            headers["X-User-Password"] = password
        if (
            isinstance(json, dict)
            and path != "/games"  # imports derive schemas from their test contract
            and json.get("server_code")
            and "game_schemas" not in json
        ):
            json = {**json, "game_schemas": TEST_GAME_SCHEMAS}
        return self.client.request(
            method, path, headers=headers, json=json, params=params
        )

    def ok(
        self,
        method: str,
        path: str,
        *,
        as_user: str | None = None,
        json: Any = None,
        params: Mapping[str, str] | None = None,
    ) -> Any:
        """Like [request], but fails the test unless the request succeeds."""
        response = self.request(method, path, as_user=as_user, json=json, params=params)
        assert response.is_success, (response.status_code, response.text)
        return None if response.status_code == 204 else response.json()

    def new_user(self, name: str) -> str:
        user = self.ok("POST", "/users", json={"display_name": name})
        self._names_by_user_id[user["id"]] = name
        self.passwords_by_user_id[user["id"]] = user["password"]
        return user["id"]

    def create_game(self, body: dict, owner: str) -> dict:
        """Creates a published game via the service and returns its GameOut dict.
        POST /games is gone (the agent import is the HTTP creation path), so tests
        that just need a game use this. A v2 game without schemas gets the
        permissive test schemas, as the old HTTP helper injected."""
        from game_platform.schemas import GameOut

        code = body.get("client_code") or body["code"]
        server_code = body.get("server_code")
        game_schemas = body.get("game_schemas")
        if server_code is not None and game_schemas is None:
            game_schemas = TEST_GAME_SCHEMAS
        game = self.platform.create_game(
            caller_id=owner,
            name=body["name"],
            description=body.get("description", ""),
            rules=GameRules(
                allowed_player_counts=tuple(sorted(body["allowed_player_counts"])),
                allows_leave_mid_match=body.get("allows_leave_mid_match", False),
                allows_join_mid_match=body.get("allows_join_mid_match", False),
            ),
            code=code,
            server_code=server_code,
            game_schemas=game_schemas,
        )
        return GameOut.of(game).model_dump(mode="json")

    def new_game(
        self,
        *,
        owner: str,
        allowed_player_counts: Sequence[int] = (2, 3, 4),
        allows_leave_mid_match: bool = False,
        allows_join_mid_match: bool = False,
    ) -> str:
        game = self.platform.create_game(
            caller_id=owner,
            name="Poker",
            description="",
            rules=GameRules(
                allowed_player_counts=tuple(allowed_player_counts),
                allows_leave_mid_match=allows_leave_mid_match,
                allows_join_mid_match=allows_join_mid_match,
            ),
            code="<div>poker</div>",
        )
        return game.id

    def new_match(
        self,
        *,
        owner: str,
        game_id: str,
        num_computer_opponents: int = 0,
        joiners: Sequence[str] = (),
        start: bool = False,
    ) -> str:
        match = self.ok(
            "POST",
            "/matches",
            as_user=owner,
            json={"game_id": game_id, "num_computer_opponents": num_computer_opponents},
        )
        match_id = match["id"]
        for joiner in joiners:
            self.ok("POST", f"/matches/{match_id}/join", as_user=joiner)
        if start:
            self.ok(
                "POST",
                f"/matches/{match_id}/start",
                as_user=owner,
                json={"initial_state": {"pot": 0}},
            )
        return match_id

    def move(
        self,
        match_id: str,
        *,
        as_user: str,
        next_turn: int | list[int] | None,
        state: Any = None,
    ) -> httpx.Response:
        return self.request(
            "POST",
            f"/matches/{match_id}/moves",
            as_user=as_user,
            json={
                "new_state": state,
                "next_turn_player_indices": None
                if next_turn is None
                else [next_turn]
                if isinstance(next_turn, int)
                else next_turn,
            },
        )

    def name(self, user_id: str | None) -> str | None:
        return None if user_id is None else self._names_by_user_id[user_id]

    def summary(self, match: Mapping[str, Any]) -> dict[str, Any]:
        """The interesting parts of a match response, with user ids replaced by names."""
        return {
            "status": match["status"],
            "players": [
                self.name(player["user_id"]) or player["kind"]
                for player in match["players"]
            ],
            "turn": match["turn_of_player_indices"],
            "state": match["state"],
        }

    def match_summary(self, match_id: str) -> dict[str, Any]:
        return self.summary(self.ok("GET", f"/matches/{match_id}"))


def error(response: httpx.Response) -> tuple[int, Any]:
    return response.status_code, response.json()["detail"]


def validation_errors(response: httpx.Response) -> list[str]:
    """FastAPI's 422 details as "field.path: message" lines."""
    assert response.status_code == 422, (response.status_code, response.text)
    lines = []
    for detail in response.json()["detail"]:
        # The first element of [loc] is where the input came from, e.g. "body".
        path = ".".join(str(part) for part in detail["loc"][1:])
        lines.append(f"{path}: {detail['msg']}" if path else detail["msg"])
    return lines
