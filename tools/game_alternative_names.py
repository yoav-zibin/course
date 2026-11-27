"""Publish the reviewed Portal catalog names through the game-content API."""

import argparse
import base64
import json
from functools import cache
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

RETIRED_CONNECT_FOUR = "f243d9c6-f79e-40f3-b868-2d304bd79a22"
KEPT_CONNECT_FOUR = "e299b14e-480d-44f3-8132-74282a46cebc"


@cache
def catalog_review():
    return json.loads(
        (Path(__file__).resolve().parents[1] / "games" / "alternative-names.json").read_text()
    )


def title_key(title):
    return title.removesuffix(" (Declarative)").rstrip("!?").lower()


def reviewed_names(title):
    return catalog_review()[title_key(title)]


def request(base, path, *, method="GET", body=None, authorization=None, allow_missing=False):
    headers = {"Content-Type": "application/json"}
    if authorization is not None:
        headers["Authorization"] = authorization
    req = Request(base + path, method=method, headers=headers,
                  data=json.dumps(body).encode() if body is not None else None)
    try:
        with urlopen(req, timeout=60) as response:
            return None if response.status == 204 else json.load(response)
    except HTTPError as exc:
        if allow_missing and exc.code == 404:
            return None
        # The response may contain private request data.
        raise RuntimeError(f"{method} {path}: HTTP {exc.code}") from None


def catalog(base):
    params = {"limit": 100}
    while True:
        page = request(base, "/v2/games?" + urlencode(params))
        yield from page["items"]
        if page["next_cursor"] is None:
            return
        params["cursor"] = page["next_cursor"]


def retire_duplicate_connect_four(base, secret):
    path = "/games/" + RETIRED_CONNECT_FOUR
    game = request(base, path, allow_missing=True)
    if game is None or game["deleted"]:
        return
    strings = (game.get("declarative_ui") or {}).get("strings", {})
    if game["name"] != "Connect Four" or strings.get("tagline") != "DROP INTO THE GRID":
        raise RuntimeError("The Connect Four listing no longer matches the reviewed board.")
    kept = request(base, "/games/" + KEPT_CONNECT_FOUR)
    if kept["name"] != "Connect Four" or not kept["published"] or kept["deleted"]:
        raise RuntimeError("The Connect Four listing to keep is unavailable.")
    authorization = "Basic " + base64.b64encode(f"game-content:{secret}".encode()).decode()
    request(base, path, method="DELETE", authorization=authorization)
    game = request(base, path, allow_missing=True)
    if game is not None and not game["deleted"]:
        raise RuntimeError("The duplicate Connect Four listing was not deleted.")
    print("Deleted the Connect Four listing with the DROP INTO THE GRID board.", flush=True)


def publish(base, secret):
    games = list(catalog(base))
    if any("alternative_names" not in game for game in games):
        raise RuntimeError("Deploy the alternative-names API before applying the review.")
    retire_duplicate_connect_four(base, secret)
    review = catalog_review()
    updated = 0
    unreviewed = set()
    for game in games:
        if game["id"] == RETIRED_CONNECT_FOUR:
            continue
        key = title_key(game["name"])
        if key not in review:
            unreviewed.add(game["name"])
            continue
        aliases = review[key]
        if not aliases or game["alternative_names"]:
            continue
        path = "/games/" + quote(game["id"], safe="")
        current = request(base, path)
        if title_key(current["name"]) != key or current["alternative_names"]:
            continue
        result = request(base, path, method="PATCH", body={
            "game_addition_request_id_and_secret": secret,
            "alternative_names": aliases,
        })
        if result["alternative_names"] != aliases:
            raise RuntimeError(f"Could not verify alternative names for {game['id']}.")
        updated += 1
    print(f"Checked {len(games)} listings and added alternative names to {updated}.", flush=True)
    if unreviewed:
        print("Listings added since the review: " + ", ".join(sorted(unreviewed)), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--retire-duplicate-only", action="store_true")
    args = parser.parse_args()
    secret = json.loads(args.config.read_text()).get("master_password")
    if not isinstance(secret, str) or not secret:
        parser.error("the private config must contain a master password")
    action = retire_duplicate_connect_four if args.retire_duplicate_only else publish
    action(args.base_url.rstrip("/"), secret)


if __name__ == "__main__":
    main()
