"""FastAPI routes for the game platform."""

import secrets
from collections.abc import Awaitable, Callable
from http import HTTPStatus
from pathlib import Path
from typing import Annotated, Final

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles

from game_platform.models import GameRules, MatchStatus
from game_platform.schemas import (
    AgentChatRequest,
    AgentChatResponse,
    AllDataOut,
    GameCreate,
    GameOut,
    GameUpdate,
    MatchCreate,
    MatchOut,
    MatchStart,
    MatchUpdate,
    MoveCreate,
    MoveOut,
    UserCreate,
    UserOut,
    UserUpdate,
    UserWithPasswordOut,
)
from game_platform.service import (
    ConflictError,
    ForbiddenError,
    GamePlatform,
    InvalidRequestError,
    NotFoundError,
    PlatformError,
    UnauthorizedError,
)
from game_platform.agent import AgentError, chat_with_agent
from game_platform.config import ModelApiConfig
from game_platform.model_api import ModelApiClient

_STATUS_OF_ERROR: Final[tuple[tuple[type[PlatformError], HTTPStatus], ...]] = (
    (UnauthorizedError, HTTPStatus.UNAUTHORIZED),
    (ForbiddenError, HTTPStatus.FORBIDDEN),
    (NotFoundError, HTTPStatus.NOT_FOUND),
    (InvalidRequestError, HTTPStatus.BAD_REQUEST),
    (ConflictError, HTTPStatus.CONFLICT),
)


def _get_platform(request: Request) -> GamePlatform:
    platform = request.app.state.platform
    assert isinstance(platform, GamePlatform)
    return platform


Platform = Annotated[GamePlatform, Depends(_get_platform)]


def _get_caller_id(
    platform: Platform,
    x_user_id: Annotated[str | None, Header()] = None,
    x_user_password: Annotated[str | None, Header()] = None,
) -> str:
    return platform.authenticate(user_id=x_user_id, password=x_user_password).id


CallerId = Annotated[str, Depends(_get_caller_id)]

router = APIRouter()

# Users


@router.post("/users", status_code=HTTPStatus.CREATED)
def create_user(platform: Platform, body: UserCreate) -> UserWithPasswordOut:
    """Returns the new user's password, which authenticated requests need. Apart from
    the debug tools, this is the only place the API returns it."""
    user = platform.create_user(display_name=body.display_name)
    return UserWithPasswordOut.of_user(user)


@router.get("/users/{user_id}")
def get_user(platform: Platform, user_id: str) -> UserOut:
    return UserOut.of(platform.get_user(user_id))


@router.patch("/users/{user_id}")
def update_user(
    platform: Platform, caller_id: CallerId, user_id: str, body: UserUpdate
) -> UserOut:
    user = platform.update_user(
        caller_id=caller_id, user_id=user_id, display_name=body.display_name
    )
    return UserOut.of(user)


# Games


@router.post("/games", status_code=HTTPStatus.CREATED)
def create_game(platform: Platform, caller_id: CallerId, body: GameCreate) -> GameOut:
    game = platform.create_game(
        caller_id=caller_id,
        name=body.name,
        description=body.description,
        rules=GameRules(
            allowed_player_counts=tuple(body.allowed_player_counts),
            allows_leave_mid_match=body.allows_leave_mid_match,
            allows_join_mid_match=body.allows_join_mid_match,
        ),
        code=body.code,
    )
    return GameOut.of(game)


@router.get("/games")
def list_games(platform: Platform, owner_user_id: str | None = None) -> list[GameOut]:
    return [
        GameOut.of(game) for game in platform.list_games(owner_user_id=owner_user_id)
    ]


@router.get("/games/{game_id}")
def get_game(platform: Platform, game_id: str) -> GameOut:
    return GameOut.of(platform.get_game(game_id))


@router.get("/games/{game_id}/versions/{version}")
def get_game_version(platform: Platform, game_id: str, version: int) -> GameOut:
    return GameOut.of(platform.get_game_version(game_id, version))


@router.patch("/games/{game_id}")
def update_game(
    platform: Platform, caller_id: CallerId, game_id: str, body: GameUpdate
) -> GameOut:
    game = platform.update_game(
        caller_id=caller_id,
        game_id=game_id,
        name=body.name,
        description=body.description,
        allowed_player_counts=None
        if body.allowed_player_counts is None
        else tuple(body.allowed_player_counts),
        allows_leave_mid_match=body.allows_leave_mid_match,
        allows_join_mid_match=body.allows_join_mid_match,
        code=body.code,
    )
    return GameOut.of(game)


@router.delete("/games/{game_id}", status_code=HTTPStatus.NO_CONTENT)
def delete_game(platform: Platform, caller_id: CallerId, game_id: str) -> None:
    platform.delete_game(caller_id=caller_id, game_id=game_id)


# Matches


@router.post("/matches", status_code=HTTPStatus.CREATED)
def create_match(
    platform: Platform, caller_id: CallerId, body: MatchCreate
) -> MatchOut:
    match = platform.create_match(
        caller_id=caller_id,
        game_id=body.game_id,
        num_computer_opponents=body.num_computer_opponents,
    )
    return MatchOut.of(match)


@router.get("/matches")
def list_matches(
    platform: Platform,
    caller_id: CallerId,
    status: MatchStatus | None = None,
    game_id: str | None = None,
) -> list[MatchOut]:
    matches = platform.list_matches(caller_id=caller_id, status=status, game_id=game_id)
    return [MatchOut.of(match) for match in matches]


@router.get("/matches/{match_id}")
def get_match(platform: Platform, match_id: str) -> MatchOut:
    return MatchOut.of(platform.get_match(match_id))


@router.patch("/matches/{match_id}")
def update_match(
    platform: Platform, caller_id: CallerId, match_id: str, body: MatchUpdate
) -> MatchOut:
    match = platform.set_num_computer_opponents(
        caller_id=caller_id,
        match_id=match_id,
        num_computer_opponents=body.num_computer_opponents,
    )
    return MatchOut.of(match)


@router.delete("/matches/{match_id}", status_code=HTTPStatus.NO_CONTENT)
def delete_match(platform: Platform, caller_id: CallerId, match_id: str) -> None:
    platform.delete_match(caller_id=caller_id, match_id=match_id)


@router.post("/matches/{match_id}/join")
def join_match(platform: Platform, caller_id: CallerId, match_id: str) -> MatchOut:
    return MatchOut.of(platform.join_match(caller_id=caller_id, match_id=match_id))


@router.post("/matches/{match_id}/start")
def start_match(
    platform: Platform,
    caller_id: CallerId,
    match_id: str,
    body: MatchStart | None = None,
) -> MatchOut:
    body = body if body is not None else MatchStart()
    match = platform.start_match(
        caller_id=caller_id,
        match_id=match_id,
        first_turn_player_index=body.first_turn_player_index,
        initial_state=body.initial_state,
    )
    return MatchOut.of(match)


@router.post("/matches/{match_id}/leave")
def leave_match(platform: Platform, caller_id: CallerId, match_id: str) -> MatchOut:
    return MatchOut.of(platform.leave_match(caller_id=caller_id, match_id=match_id))


@router.post("/matches/{match_id}/moves", status_code=HTTPStatus.CREATED)
def make_move(
    platform: Platform, caller_id: CallerId, match_id: str, body: MoveCreate
) -> MatchOut:
    match = platform.make_move(
        caller_id=caller_id,
        match_id=match_id,
        new_state=body.new_state,
        next_turn_player_index=body.next_turn_player_index,
        expected_move_count=body.expected_move_count,
    )
    return MatchOut.of(match)


@router.get("/matches/{match_id}/moves")
def list_moves(platform: Platform, match_id: str) -> list[MoveOut]:
    return [MoveOut.of(move) for move in platform.get_match(match_id).moves]


# Debugging tools: an API console and a browser of all data. They're hidden from the
# OpenAPI schema because they're not part of the product API.

_STATIC_DIR: Final = Path(__file__).parent / "static"

debug_router = APIRouter(include_in_schema=False)

_MASTER_PASSWORD_REALM: Final = "Game platform debug tools"
_basic_auth = HTTPBasic(auto_error=False, realm=_MASTER_PASSWORD_REALM)


def _check_master_password(
    request: Request,
    credentials: Annotated[HTTPBasicCredentials | None, Depends(_basic_auth)],
) -> None:
    """Uses HTTP basic auth so the browser asks for the password once and then sends
    it with every request, including the pages' fetches of /debug/all-data."""
    master_password: str = request.app.state.master_password
    if not master_password:
        return
    if credentials is None or not secrets.compare_digest(
        credentials.password.encode(), master_password.encode()
    ):
        raise HTTPException(
            status_code=HTTPStatus.UNAUTHORIZED,
            detail="the master password is required (any username)",
            headers={"WWW-Authenticate": f'Basic realm="{_MASTER_PASSWORD_REALM}"'},
        )


MasterPassword = Depends(_check_master_password)


@debug_router.get("/")
def index() -> RedirectResponse:
    return RedirectResponse("/portal")


@debug_router.get("/console")
def console() -> FileResponse:
    return FileResponse(_STATIC_DIR / "console.html")


@debug_router.get("/builder")
def builder() -> FileResponse:
    return FileResponse(_STATIC_DIR / "builder.html")


@debug_router.get("/portal")
def portal() -> FileResponse:
    return FileResponse(_STATIC_DIR / "portal.html")


@debug_router.get("/browse", dependencies=[MasterPassword])
def browse() -> FileResponse:
    return FileResponse(_STATIC_DIR / "browse.html")


@debug_router.get("/debug/all-data", dependencies=[MasterPassword])
def all_data(platform: Platform) -> AllDataOut:
    """Everything, including users' passwords."""
    return AllDataOut.of(platform.all_data())


@debug_router.post("/agent/chat")
def agent_chat(
    request: Request, caller_id: CallerId, body: AgentChatRequest
) -> AgentChatResponse:
    """One turn of conversation with the game-building agent (backs the builder's
    Agent tab). Requires the acting user because every turn calls the paid model
    API. Returns 503 when no Model API key is configured."""
    config: ModelApiConfig = request.app.state.model_api_config
    client = ModelApiClient(
        api_key=config.api_key, model=config.model, base_url=config.base_url
    )
    if not client.enabled:
        raise HTTPException(
            status_code=HTTPStatus.SERVICE_UNAVAILABLE,
            detail="The game-building agent is not set up: no Model API key is "
            "configured on the server.",
        )
    try:
        return chat_with_agent(client, body)
    except AgentError as exc:
        raise HTTPException(
            status_code=HTTPStatus.BAD_GATEWAY, detail=str(exc)
        ) from exc


async def _handle_platform_error(_request: Request, exc: Exception) -> JSONResponse:
    status = next(
        (status for kind, status in _STATUS_OF_ERROR if isinstance(exc, kind)),
        HTTPStatus.INTERNAL_SERVER_ERROR,
    )
    return JSONResponse(status_code=status, content={"detail": str(exc)})


async def _revalidate_pages(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Makes browsers check for newer pages and scripts on every load. Otherwise they
    may keep using a cached old script with a new page, which breaks it."""
    response = await call_next(request)
    if request.method == "GET" and not response.headers.get(
        "content-type", ""
    ).startswith("application/json"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def create_app(
    platform: GamePlatform | None = None,
    *,
    debug_tools: bool = True,
    master_password: str = "",
    model_api_config: ModelApiConfig | None = None,
) -> FastAPI:
    """[debug_tools] adds the web pages (/portal, /builder, /console, /browse) and
    /debug/all-data, which exposes everything (including users' passwords). /browse and
    /debug/all-data need [master_password], unless it is empty."""
    app = FastAPI(title="Game platform")
    # Allow REST API requests from any domain (browser cross-origin requests).
    # Auth uses per-request Authorization headers (HTTP Basic), not cookies,
    # so a wildcard origin is safe here.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.platform = platform if platform is not None else GamePlatform()
    app.state.master_password = master_password
    app.state.model_api_config = (
        model_api_config if model_api_config is not None else ModelApiConfig()
    )
    app.include_router(router)
    if debug_tools:
        app.include_router(debug_router)
        # Build environments may symlink the packaged files.
        static_files = StaticFiles(directory=_STATIC_DIR, follow_symlink=True)
        app.mount("/static", static_files, name="static")
        app.middleware("http")(_revalidate_pages)
    app.add_exception_handler(PlatformError, _handle_platform_error)
    return app
