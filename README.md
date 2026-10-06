# game-platform

An in-memory REST backend for a multiplayer turn-based games platform, built with FastAPI.

- **Game**: a game built in the game builder. Its `code` runs in a sandboxed iframe on the
  client; the server never executes it.
- **Match**: playing a game with a set of players (humans and computer opponents).
- **Move**: a turn that replaces the match's opaque JSON state and either passes the turn
  to a set of players (any of whom may move next) or ends the match.

All data lives in process memory behind the `Store` interface (`store.py`), so it can later
be swapped for a database. The server binary uses `JsonFileStore`
(`json_file_store.py`), which also saves everything to a JSON file; see
[Data file](#data-file).

## Layout

| File         | Contents                                                        |
|--------------|-----------------------------------------------------------------|
| `models.py`  | Immutable domain records                                        |
| `store.py`   | `Store` protocol and `InMemoryStore`                            |
| `json_file_store.py` | `JsonFileStore`: `InMemoryStore` saved to a JSON file   |
| `config.py`  | Server config, read from a JSON file                            |
| `config.example.json` | Example config with every field at its default         |
| `requirements.txt` | pip packages needed to run the server                      |
| `requirements-dev.txt` | pip packages also needed to run the tests              |
| `service.py` | `GamePlatform`: all business rules, independent of HTTP         |
| `schemas.py` | Pydantic request/response bodies                                |
| `api.py`     | FastAPI routes and `create_app`                                 |
| `main.py`    | Server binary (`game_platform_server`)                          |
| `static/`    | Web pages: portal, builder, API console and data browser        |
| `games/`     | The example games' code: tic-tac-toe, poker and a debug game    |
| `data.example.json` | Example data: 8 users, the 3 games and 23 matches        |
| `example_data.py`, `example_data/` | How `data.example.json` is generated     |
| `test_*.py`  | Pytest tests, using the helpers in `testing.py`                 |

## Architecture

The server is built from three public libraries, one per layer:

- **uvicorn** is the web server. It's an ASGI server (the async successor of WSGI, which
  Flask and Django use): it listens on a port, parses HTTP, and hands each request to the
  app as a Python call. It knows nothing about routes or JSON. Only `main.py` uses it, via
  `uvicorn.run(create_app(), host=..., port=...)`.
- **FastAPI** is the web framework, used in `api.py`. Decorators like
  `@router.post("/matches/{match_id}/join")` map methods and paths to functions, and the
  functions' type hints say where each argument comes from: the path (`match_id: str`),
  the query (`status: MatchStatus | None = None`), a header (`x_user_id`), or the JSON
  body (`body: MoveCreate`). `Depends(...)` injects shared pieces: the `GamePlatform`, and
  the caller's id once `X-User-Id` and `X-User-Password` check out (or a 401). The same type hints generate
  `/openapi.json` and `/docs`, which the API console reads. `TestClient` lets tests call
  the app in-process. FastAPI is built on Starlette, which provides `StaticFiles`,
  `FileResponse` and the exception handlers.
- **pydantic** validates data, used in `schemas.py`. Request and response bodies are
  classes with typed fields, and pydantic parses untrusted JSON into them, checking
  constraints such as `Field(ge=2, le=10)`, `min_length=1`, custom validators (no duplicate
  player counts, no explicit nulls in a PATCH) and `extra="forbid"`. FastAPI turns
  validation failures into 422 responses. `JsonValue` types the opaque match state, and
  each request model's example goes into its JSON Schema, which FastAPI copies into
  `/openapi.json`.

For example, a move goes through the layers like this:

```
HTTP request
  -> uvicorn: parses HTTP, calls the ASGI app
  -> FastAPI: matches POST /matches/{match_id}/moves, resolves X-User-Id via Depends
  -> pydantic: validates the JSON body into MoveCreate (or FastAPI returns 422)
  -> GamePlatform.make_move: business rules, plain Python
  -> Store: reads and writes the match
  -> pydantic: MatchOut serializes the result
  -> FastAPI builds the JSON response; uvicorn sends it
```

Only `api.py`, `schemas.py` and `main.py` know about the web. `service.py` raises
`PlatformError` subclasses that `api.py` maps to HTTP status codes, and `service.py`,
`store.py` and `models.py` are plain Python (they use only pydantic's `JsonValue` type
hint). So the rules can be tested or reused without HTTP, and a database-backed `Store` can
replace `InMemoryStore` without changing the service or the API.

## API

### Authentication

There is no login or session: every authenticated request carries the user's
credentials. `POST /users` returns the new user's `id` and a server-generated
`password`, and endpoints marked Auth need both, in headers:

```
X-User-Id: <id>
X-User-Password: <password>
```

For example:

```
$ curl -X POST localhost:8000/users -H 'Content-Type: application/json' \
    -d '{"display_name": "alice"}'
{"id": "34ae6a77-...", "display_name": "alice", "password": "zIRhbMKQDDdEjC_IR_6LQg", ...}

$ curl -X PATCH localhost:8000/users/34ae6a77-... \
    -H 'X-User-Id: 34ae6a77-...' -H 'X-User-Password: zIRhbMKQDDdEjC_IR_6LQg' \
    -H 'Content-Type: application/json' -d '{"display_name": "Alice"}'
```

#### How passwords are generated

Users don't choose passwords. The server generates each one with Python's
`secrets.token_urlsafe(16)`: 16 bytes (128 bits) from the operating system's
cryptographically secure random generator, encoded as a 22-character URL-safe string.
With 2^128 possible values, guessing one is hopeless, and every user's password is
different.

In the product API, the password appears in exactly one place: the `POST /users`
response. `GET /users/{id}` never returns it and it can't be reset, so clients must keep
it; a lost password means a lost account. The debug tools (`/browse` and
`/debug/all-data`, protected by the [master password](#master-password)) do show every
user's password, so the API console can fill it in for whichever user you act as.

#### How passwords are stored

The server keeps each password as is (field `password` of the user), in memory and in
the data file, so it survives restarts. On every authenticated request it compares the
`X-User-Password` header with the stored password using `hmac.compare_digest`, which
takes the same time however many leading characters match, so response times don't
leak how close a guess was.

Because passwords are stored in plain text, anyone who can read the data file (or a
backup or copy of it) can act as any user. Keep the file readable only by the server's
account. Storing a one-way hash instead (for example SHA-256, which suits random
server-generated passwords like these) would make a leaked file useless for
authenticating, at the cost of no longer being able to read passwords back from the file.

#### Failures and transport

- A missing `X-User-Id`, an unknown id, a missing password and a wrong password all get
  the same 401 (`missing or invalid X-User-Id / X-User-Password headers`), so the API
  can't be used to find out which user ids exist.
- Changing another user (`PATCH /users/{id}` with someone else's id) is a 403.
- Headers are sent in plain text over HTTP, so anyone who can see the traffic can copy
  the password. That's fine for local development; anywhere else, serve the API over
  HTTPS (for example behind a reverse proxy).
- Anyone can call `POST /users`, so this is guest access rather than real login: it
  proves a request comes from whoever created the account, not who that person is.

### Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /users` |  | Create a guest user `{display_name}`; returns its `password` |
| `GET /users/{id}` |  | Get a user |
| `PATCH /users/{id}` | yes | Change your own `display_name` (403 for other users) |
| `POST /games` | yes | Create a game |
| `GET /games?owner_user_id=` |  | List games that aren't deleted, optionally by owner |
| `GET /games/{id}` |  | Get the latest version of a game |
| `GET /games/{id}/versions/{version}` |  | Get a specific version of a game |
| `PATCH /games/{id}` | yes | Update some fields of a game, creating a new version (creator only) |
| `DELETE /games/{id}` | yes | Delete a game (creator only) |
| `POST /matches` | yes | Create a match `{game_id, num_computer_opponents}`; the caller is player 0 |
| `GET /matches?status=&game_id=` | yes | List the caller's matches (owned or seated, minus hidden ones) |
| `GET /matches/{id}` |  | Get a match; anyone can view it, so it can be shared by URL |
| `PATCH /matches/{id}` | yes | Set `num_computer_opponents` before the match starts (owner only) |
| `POST /matches/{id}/join` | yes | Take a seat |
| `POST /matches/{id}/start` | yes | Start `{first_turn_player_indices, initial_state}`, both optional (owner only) |
| `POST /matches/{id}/leave` | yes | Leave the match |
| `POST /matches/{id}/moves` | yes | Make a move `{new_state, next_turn_player_indices, expected_move_count?}` |
| `GET /matches/{id}/moves` |  | Full move history |
| `DELETE /matches/{id}` | yes | Owner: delete the match. Other players: hide an ended match from their list |

Game fields: `name`, `description`, `allowed_player_counts` (non-empty, distinct, each in
2..10), `allows_leave_mid_match`, `allows_join_mid_match`, `code`.

### Game versions and deletion

- A game starts at `version` 1, and every update that changes something increments it.
  All versions are kept.
- Deleting a game sets `deleted: true` and removes it from `GET /games`, but keeps it and
  all its versions in memory because matches may use them. A deleted game can't be updated
  or used for new matches (409).

### Match rules

- Status goes `waiting_for_players` -> `ongoing` -> `over`. A match records the
  `game_version` it was created with, and that version's rules apply for the whole match,
  even if the game is later updated or deleted. Clients load that version's `code` from
  `GET /games/{game_id}/versions/{game_version}`.
- Before the start, humans sit in join order followed by the computers. Starting requires
  the total number of seats to be in the game's `allowed_player_counts`.
- A move is accepted from any player whose turn it is: `next_turn_player_indices` names
  the set of seats that may make the next move, and `null` ends the match
  (`end_reason: "finished"`). When a computer seat has the turn, any human player in
  the match computes and submits the computer's move.
  `expected_move_count` optionally guards against two clients submitting the same move.
- Leaving a waiting match frees the seat (the owner must delete the match instead). Leaving
  an ongoing match replaces the leaver with a computer (which keeps the turn) if the game
  `allows_leave_mid_match`, and otherwise ends it (`end_reason: "player_left"`). The match
  also ends if its last human leaves.
- Joining an ongoing match requires `allows_join_mid_match`; the joiner takes over the
  first computer seat, or adds a seat if the game's maximum player count allows it.

### Errors

Errors have a JSON body `{"detail": ...}`:

| Status | Meaning                                                                 |
|--------|-------------------------------------------------------------------------|
| 400    | The values don't fit the target (e.g. a player index that isn't a seat) |
| 401    | Missing or invalid `X-User-Id` / `X-User-Password`                      |
| 403    | Not allowed (e.g. not the owner, not a player)                          |
| 404    | No such user, game or match                                             |
| 409    | Invalid state transition (e.g. not your turn, match full or over)       |
| 422    | Malformed request body or query                                         |

## Running

### Requirements

- **Python 3.10 or newer.** The code uses 3.10 features (`X | Y` type unions evaluated at
  runtime, `dataclass(kw_only=True)`), so 3.9 and older won't work. It is tested with
  3.10.
- **Three pip packages** for the server, listed in `requirements.txt`: `fastapi`,
  `pydantic` (v2) and `uvicorn`. They pull in their own dependencies (such as
  `starlette`) automatically.
- **Two more for the tests**, in `requirements-dev.txt`: `pytest`, and `httpx`, which
  FastAPI's `TestClient` needs.
- Nothing else: no database (data is kept in a JSON file), no build step, and no
  JavaScript toolchain (the web pages are plain HTML/JS files that the server serves).

### Install

The code is a single Python package that imports itself as `game_platform`, so the
directory holding it must be named `game_platform`, and you run commands from the
directory *above* it. For example:

```bash
mkdir games && cd games
git clone <repository-url> game_platform    # the directory name matters

python3 --version                           # must be 3.10 or newer
python3 -m venv .venv                       # an isolated environment for the packages
source .venv/bin/activate                   # on Windows: .venv\Scripts\activate
pip install -r game_platform/requirements.txt
```

The virtual environment (`.venv`) keeps these packages separate from the rest of your
system; activate it again in each new shell before running the server.

### Run

Still in the directory above `game_platform`, with the virtual environment active:

```bash
cp game_platform/config.example.json config.json   # then edit config.json as needed
python -m game_platform.main --config config.json
```

The server logs `Uvicorn running on http://127.0.0.1:8000`; open
<http://127.0.0.1:8000/portal> to play (see [Pages](#pages)). Stop it with Ctrl+C,
which also saves any pending changes to the data file.

The server starts with no data. To start with the [example data](#example-data)
instead (8 users, 3 games and 23 matches), copy it to the data file before starting:

```bash
cp game_platform/data.example.json ~/.local/share/game-platform/data.json
```

- Without `--config`, every setting takes its default (see [Config file](#config-file)).
- `--print-config` prints the effective config, with the data file path resolved, and
  exits; use it to check what a config file means.
- `python -m game_platform.main --help` lists the options.

### Config file

The config file is JSON. Start from `config.example.json`, which lists every field at its
default; any field can be left out to keep its default. Unknown fields and invalid values
stop the server at startup with an error naming the field.

| Field                             | Default                                  | Meaning |
|-----------------------------------|------------------------------------------|---------|
| `server.host`                     | `"127.0.0.1"`                            | Interface to listen on; use `"0.0.0.0"` to accept connections from other machines |
| `server.port`                     | `8000`                                   | Port to listen on |
| `server.keep_alive_timeout_seconds` | `3600`                                 | How long an idle connection is kept open; see below |
| `data_file.path`                  | `"~/.local/share/game-platform/data.json"` | Where all data is saved. `~` is expanded, and a relative path is relative to the config file's directory |
| `data_file.save_interval_seconds` | `1.0`                                    | After a change, the data file is rewritten at most once per this many seconds. `0` writes after every change |
| `debug_tools`                     | `true`                                   | Serve `/console`, `/browse` and `/debug/all-data` (see [Pages](#pages)) |
| `master_password`                 | `""`                                     | Password for `/browse` and `/debug/all-data` (see [Master password](#master-password)). Empty means none, which is only allowed when `server.host` is a numeric IP address |
| `log_level`                       | `"INFO"`                                 | `"DEBUG"`, `"INFO"`, `"WARNING"` or `"ERROR"` |

For example, to serve other machines on port 45123 and keep the data next to the config:

```json
{
  "server": {"host": "0.0.0.0", "port": 45123},
  "data_file": {"path": "data.json"}
}
```

`server.keep_alive_timeout_seconds` matters behind proxies. A browser or proxy keeps a
connection open between requests and reuses it. uvicorn's own default closes idle
connections after 5 seconds, which is shorter than a person's pause between clicks, and a
proxy that doesn't notice the close and doesn't retry then fails the next request, often
with an error like `Connection closed by remote host`. The default of an hour outlives
any idle connection a browser keeps.

### Data file

The data file holds everything: users (including their passwords), every
version of every game, which games are deleted, and all matches with their moves. Its
layout is
`{"format_version": 1, "data": {"users": [...], "game_versions": [...], "deleted_game_ids": [...], "matches": [...]}}`.
`format_version` is for incompatible layout changes after launch.

- At startup the server reads the whole file into memory. If the file doesn't exist, the
  server starts empty and creates it (and its directory) on the first change. If the file
  exists but can't be parsed or has another `format_version`, the server refuses to start
  rather than overwrite it.
- While running, requests are served from memory. After a change, a background thread
  rewrites the whole file, at most once per `data_file.save_interval_seconds`, so a burst
  of changes costs one write. Reads never write.
- Each write goes to `<path>.tmp`, which is then renamed over the file, so the file is
  never left half-written. A failed write is logged and retried.
- A clean shutdown (Ctrl+C or SIGTERM) writes any pending changes. A crash or `kill -9`
  can lose the changes from the last `save_interval_seconds`.
- To start from scratch, stop the server and delete the file. Don't edit the file while
  the server is running: it will be overwritten on the next change.

### Pages

Once the server is running, open these pages in a browser:

- `/portal` (also `/`): play games with others. Choose who you are with "Act as" at the
  top (every user is listed, and their password is filled in for you). The left side
  lists your matches (your move, ongoing, waiting for players, over), a form to create a
  match for any game with some computer opponents, and open matches you can join. The
  selected match shows its players and the actions you can take (join, add or remove
  computers and start if you own it, leave, delete or hide), and runs the game in an
  iframe. The page checks the server every 2 seconds, so other players' moves show up
  on their own. Links like `/portal#match=<id>` open a match directly, also for people
  who aren't playing in it.
- `/builder`: create, edit and delete your games (those owned by the user you act as).
  New games start from a small template that shows the [game API](#game-api). The Test
  tab runs the editor's code (saved or not) in pass-and-play mode: pick the number of
  players and which seats are computers, and play every human seat yourself, in turn.
  Test moves stay in the page; a log shows every message, and you can undo moves.
- `/console`: API console. Pick an operation, fill in its parameters and JSON
  body (prefilled with an example and the most recent ids), choose who to act as
  (`X-User-Id` and `X-User-Password`) at the top, and send (Ctrl+Enter). Picking a user
  fills in their password (from `/debug/all-data`, or remembered in the browser's
  localStorage for users created from the console). It shows the response, keeps a
  history you can click to restore, and can copy a request as curl. The operations come
  from `/openapi.json`, so new endpoints show up automatically.
- `/browse`: every user (including their password), game (expand a row for all versions
  and their code) and match (expand for its state and moves), including deleted games
  and hidden matches. It has a filter box and optional auto-refresh.
- `/docs`: FastAPI's generated OpenAPI docs.

All these pages read `/debug/all-data`, which returns everything, including every user's
password (that's how "Act as" knows them). Set `"debug_tools": false` in the config to
turn off the pages and that endpoint; the API itself keeps working.

### Master password

`master_password` in the config protects `/browse` and `/debug/all-data` with HTTP basic
auth: the browser asks for a username and password once, and then sends them with every
request, including the other pages' fetches of `/debug/all-data` (so opening the portal,
builder or console asks for it too). The username is ignored; only the password is
checked. The product API and `/docs` don't need it.

It defaults to empty, which means no password. That is only allowed when `server.host`
is a numeric IP address (such as the default `127.0.0.1`, or `0.0.0.0`). If `server.host`
is a hostname (such as `localhost` or `games.example.com`) while debug tools are on, the
server refuses to start until `master_password` is set. Like users' passwords, it travels
in plain text over HTTP.

## Game API

A game's `code` is a complete HTML document. The portal and the builder run it in an
iframe with `sandbox="allow-scripts"`: its scripts run, but in an isolated origin, so a
game can't read the platform's cookies or storage or call the API. The page and the game
talk only through `postMessage`, with two messages. The server never runs game code; it
only stores each move's state and checks whose turn it is.

### `state_changed`: platform to game

Sent when the game loads and whenever the match changes (a move by anyone, a player
joining or leaving, the match ending), and again if a move the game sent was rejected.

```json
{
  "type": "state_changed",
  "state": {"board": ["X", "", "", "", "O", "", "", "", ""]},
  "players": [
    {"player_index": 0, "kind": "human", "name": "user1"},
    {"player_index": 1, "kind": "computer", "name": "Computer 2"}
  ],
  "turn_of_player_indices": [0],
  "status": "ongoing",
  "end_reason": null,
  "move_count": 2,
  "my_player_index": 0,
  "acting_for_player_index": 0
}
```

| Field | Meaning |
|-------|---------|
| `state` | The match state from the last move: any JSON the game chose. `null` before the first move, so the game must create its own initial state |
| `players` | Every seat, in order. `kind` is `"human"` or `"computer"`; seats can change kind when players leave or join, and seats can be added mid-match |
| `turn_of_player_indices` | The seats that may move next; `null` once the match is over |
| `status` | `"ongoing"` or `"over"` (games aren't loaded while a match waits for players) |
| `end_reason` | When over: `"finished"` (a move ended it) or `"player_left"` |
| `move_count` | How many moves were made |
| `my_player_index` | The viewer's seat, to decide what to show (e.g. whose cards). `null` for spectators |
| `acting_for_player_index` | The seat this game should make the next move for, or `null` if it must wait. It is the viewer's seat on their turn, and a computer's seat on a computer's turn if the viewer plays in the match |

### `make_move`: game to platform

Sent by the game to make the move for `acting_for_player_index`:

```json
{"type": "make_move", "new_state": {"board": ["X", "X", "", "", "O", "", "", "", ""]}, "next_turn_player_indices": [1]}
```

`new_state` replaces the match's state. `next_turn_player_indices` lists the seats that
may move next (more than one when several players move at once), or `null` to end the
match. The portal submits it with
`POST /matches/{id}/moves` (with `expected_move_count`, so a stale move is rejected) and
then sends a fresh `state_changed`. Moves the server rejects (not your turn, a seat that
doesn't exist) are shown to the player and followed by `state_changed` with the
unchanged match. Send at most one `make_move` per `state_changed`.

For compatibility, games written before turn sets may still send `next_turn_player_index`
(a single seat); the portal wraps it into a one-element set. `state_changed` likewise
still carries the legacy `turn_of_player_index` (the first seat in the turn), which new
games should ignore.

### Rules for games

- **Computers are played by the game.** On a computer's turn, every human player's game
  gets `acting_for_player_index` set to that seat and should compute and send the
  computer's move (after a short delay, so people can follow). The first one to arrive
  wins; the others are rejected as stale and ignored. With no human player online,
  computers wait.
- **Randomness happens in moves.** For example, poker's first move deals, and the move
  that ends a hand deals the next one, so every player sees the same cards.
- **The state is public.** Every player's game, and anyone with the debug tools, can
  read the whole state, so hidden information (like poker hands) is hidden by the game's
  UI only. That's fine for friendly games, not for real stakes.
- **Handle seat changes.** A player leaving becomes a computer seat in games that allow
  it, and players joining mid-match take over a computer seat or add one at the end.

### Example games

The `games/` directory holds the example data's games. Each is a single HTML file whose
script starts with a pure `Logic` object (no DOM access), followed by the UI:

- `tictactoe.html`: 2 players; the computer plays perfectly (minimax).
- `poker.html`: no-limit Texas hold'em for 2 to 8 players: 1000 chips each, blinds
  10/20 doubling every 10 hands, side pots, and a simple computer strategy. Cards are
  drawn with Unicode suits. The last player with chips wins.
- `debug.html`: for testing the platform. It shows the last `state_changed` message and
  a log of messages, and lets you send any `make_move`.

## Example data

`data.example.json` is a data file with:

- 8 users, `user1` to `user8`, whose passwords are their names;
- 3 games by `user1`: Tic-tac-toe (2 players; no leaving or joining), Poker (2 to 8
  players; leaving and joining allowed; version 2 after a description change) and the
  Debug game (2 to 10 players);
- 23 matches covering: waiting for players (alone, or ready to start with computers),
  ongoing (between humans, against computers, a computer's turn, poker heads-up, with 4
  players on the flop, a full table of 8), players who left (replaced by a computer, or
  ending the match), players who joined mid-match (a new seat, or taking over a
  computer), matches on the old version of a game, and over (won, drawn, lost to the
  computer, hidden by a player).

The matches are listed in `test_example_data.py`. To change them, edit
`example_data/make_operations.js` and regenerate both files from the directory above
`game_platform`:

```bash
node game_platform/example_data/make_operations.js   # needs Node.js 18+; writes operations.json
python -m game_platform.example_data                  # applies them; writes data.example.json
```

The JavaScript step plays the games with their own `Logic`, so every state is one the
game can continue from. The Python step performs every operation through `GamePlatform`,
so the data only contains states the platform allows; ids, passwords and timestamps
are fixed, so the output is the same on every run.

## Testing

After [installing](#install), add the test packages and run pytest from the directory
above `game_platform`:

```bash
pip install -r game_platform/requirements-dev.txt
python -m pytest game_platform
```

The tests start the app in-process (no server or network needed) and use temporary
directories for data files, so they don't touch your data.
