#!/usr/bin/env python3
"""Translates every published game's texts for every language ahead of the first visitor.

The first request for a language's bundle (GET /i18n/bundle/<language>) is what translates the
texts of games that nobody has asked for in that language yet, with Google Translate, and it only
waits a few seconds for it: a person who switches language right after games were published gets
the slow, partly translated answer. Run this after publishing games, and the people who come
afterwards get the finished bundle from memory.

    python3 tools/prewarm_translations.py --target https://buildplay.fun
    python3 tools/prewarm_translations.py --target https://buildplay.fun es fr

It only sends the same public GET requests a browser sends, so it needs no password. It does make
the server translate, which counts against the day's character limit (translation.daily_character_limit):
when the limit is reached the rest stays in English until tomorrow and this tool says so.
Standard library only.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from typing import Any

DEFAULT_LANGUAGE = "en"


def fetch(url: str) -> tuple[int, dict[str, Any], float]:
    """(HTTP status, JSON body or {}, seconds it took)."""
    started = time.monotonic()
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=90) as response:
            return response.status, json.loads(response.read().decode("utf-8")), time.monotonic() - started
    except urllib.error.HTTPError as error:
        return error.code, {}, time.monotonic() - started
    except (urllib.error.URLError, TimeoutError, ValueError):
        return 0, {}, time.monotonic() - started


def pending(bundle: dict[str, Any]) -> list[str]:
    """The ids of the games whose texts are not all translated yet."""
    return sorted(
        game_id for game_id, game in (bundle.get("games") or {}).items() if game.get("status") != "translated"
    )


def prewarm(
    target: str,
    languages: list[str],
    *,
    rounds: int = 6,
    pause: float = 1.0,
    get: Callable[[str], tuple[int, dict[str, Any], float]] = fetch,
    say: Callable[[str], None] = print,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, str]:
    """Asks for each language's bundle until it is fully translated (or [rounds] asks).
    Returns language -> "done", "partial" or "failed"."""
    target = target.rstrip("/")
    if not languages:
        status, body, _ = get(f"{target}/i18n/locales")
        if status != 200:
            say(f"could not read {target}/i18n/locales ({status})")
            return {}
        languages = [item["code"] for item in body.get("locales", []) if item["code"] != DEFAULT_LANGUAGE]
    outcome: dict[str, str] = {}
    for language in languages:
        outcome[language] = "failed"
        previous: list[str] | None = None
        for attempt in range(1, rounds + 1):
            status, bundle, took = get(f"{target}/i18n/bundle/{language}")
            if status != 200:
                say(f"{language}: attempt {attempt}: HTTP {status}")
                break
            left = pending(bundle)
            say(f"{language}: attempt {attempt}: {bundle.get('status')}, {len(left)} game(s) not fully translated, {took:.1f}s")
            if bundle.get("status") == "translated" and not left:
                outcome[language] = "done"
                break
            outcome[language] = "partial"
            if previous is not None and left == previous and attempt >= 3:
                say(f"{language}: nothing more was translated in the last attempts: the daily character limit may be reached "
                    "(see translation.daily_character_limit); try again tomorrow")
                break
            previous = left
            sleep(pause)
    return outcome


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("languages", nargs="*", help="language codes (default: every language the server offers)")
    parser.add_argument("--target", required=True, help="the server's address")
    parser.add_argument("--rounds", type=int, default=6, help="requests to try for each language")
    args = parser.parse_args()
    outcome = prewarm(args.target, args.languages, rounds=args.rounds)
    print("summary:", ", ".join(f"{language} {state}" for language, state in outcome.items()) or "nothing to do")
    sys.exit(0 if outcome and all(state == "done" for state in outcome.values()) else 1)


if __name__ == "__main__":
    main()
