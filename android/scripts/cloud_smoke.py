#!/usr/bin/env python3
"""Exercise the course API with two private test guests and disposable matches.

Never logs passwords. Only deletes matches created by this run. Accounts are reused.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="https://buildplay.fun")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    def request(method, path, body=None, user=None, expected=200):
        headers = {"Content-Type": "application/json"}
        if user:
            headers.update({"X-User-Id": user["id"], "X-User-Password": user["password"]})
        req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try:
            response = urllib.request.urlopen(req, timeout=20)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            payload = response.read()
            assert response.status == expected, f"{method} {path}: expected {expected}, got {response.status}: {payload[:300]}"
            return json.loads(payload) if payload else None

    games = request("GET", "/games")
    game = next(g for g in games if g["id"] == "tictactoe")
    contract = request("GET", "/openapi.json")
    assert "expected_move_count" in contract["components"]["schemas"]["MoveCreate"]["properties"]
    local = ROOT / ".local"
    local.mkdir(exist_ok=True)
    users_file = local / ("smoke-users-" + hashlib.sha256(base.encode()).hexdigest()[:12] + ".json")
    if users_file.exists():
        users = json.loads(users_file.read_text())
    else:
        users = [request("POST", "/users", {"display_name": f"Android integration {letter}"}, expected=201) for letter in "AB"]
        descriptor = os.open(users_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as output:
            json.dump(users, output)

    results = []
    for label, cells in [("win", [0, 3, 1, 4, 2]), ("draw", [0, 1, 2, 4, 3, 5, 7, 6, 8])]:
        match = request("POST", "/matches", {"game_id": game["id"], "num_computer_opponents": 0}, users[0], 201)
        path = "/matches/" + match["id"]
        try:
            request("POST", path + "/join", user=users[1])
            current = request("POST", path + "/start", {}, users[0])
            assert current["game_version"] == game["version"]
            request("POST", path + "/moves", {"new_state": {}, "next_turn_player_indices": [0], "expected_move_count": 0}, users[1], 409)
            board = [""] * 9
            for number, cell in enumerate(cells):
                seat = number % 2
                board[cell] = "XO"[seat]
                finished = number == len(cells) - 1
                state = {"board": board.copy(), "winner": 0 if finished and label == "win" else None, "draw": finished and label == "draw"}
                body = {"new_state": state, "next_turn_player_indices": None if finished else [1 - seat], "expected_move_count": number}
                request("POST", path + "/moves", body, users[seat], 201)
                # A new HTTP connection, with the other identity, sees the same data.
                observed = request("GET", path, user=users[1 - seat])
                assert observed["state"] == state and observed["move_count"] == number + 1
                if number == 0:
                    request("POST", path + "/moves", body, users[0], 409)
                    request("POST", path + "/moves", body, users[1], 409)
                    assert request("GET", path)["move_count"] == 1
            assert observed["status"] == "over" and observed["turn_of_player_indices"] is None
            assert len(request("GET", path + "/moves")) == len(cells)
            assert any(m["id"] == match["id"] for m in request("GET", "/matches", user=users[1]))
            results.append({"scenario": label, "moves": len(cells), "cross_client_reads": "passed", "conflict_checks": "passed"})
        finally:
            request("DELETE", path, user=users[0], expected=204)
    report = {"backend": base, "scenarios": results, "test_matches_cleaned_up": True,
              "server_restart_tested": False}
    (local / "cloud-smoke-result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
