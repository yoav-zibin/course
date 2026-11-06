"""tools/prewarm_translations.py: asks for each language's bundle until it is translated."""

import importlib.util
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "prewarm_translations", Path(__file__).parent.parent / "tools" / "prewarm_translations.py"
)
prewarm_translations = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prewarm_translations)


def bundle(status, *pending_games):
    games = {"done": {"status": "translated"}}
    games.update({game_id: {"status": "partial"} for game_id in pending_games})
    return {"status": status, "games": games}


def server(answers):
    """A fake get(): the list of languages, then each language's answers in turn."""
    calls = []

    def get(url):
        calls.append(url)
        if url.endswith("/i18n/locales"):
            return 200, {"locales": [{"code": "en"}, {"code": "es"}, {"code": "ar"}]}, 0.0
        language = url.rsplit("/", 1)[1]
        queue = answers[language]
        return 200, queue.pop(0) if len(queue) > 1 else queue[0], 0.4

    return get, calls


def test_it_asks_until_every_language_is_fully_translated():
    get, calls = server({"es": [bundle("translated")], "ar": [bundle("partial", "g1", "g2"), bundle("partial", "g2"), bundle("translated")]})
    said = []
    outcome = prewarm_translations.prewarm("https://example.test/", [], get=get, say=said.append, sleep=lambda _: None)
    assert outcome == {"es": "done", "ar": "done"}
    assert [url for url in calls if "/bundle/" in url] == [
        "https://example.test/i18n/bundle/es",
        "https://example.test/i18n/bundle/ar",
        "https://example.test/i18n/bundle/ar",
        "https://example.test/i18n/bundle/ar",
    ]
    assert any("2 game(s) not fully translated" in line for line in said)


def test_it_stops_and_says_so_when_nothing_more_gets_translated():
    get, calls = server({"es": [bundle("partial", "g1")]})
    said = []
    outcome = prewarm_translations.prewarm("https://example.test", ["es"], rounds=6, get=get, say=said.append, sleep=lambda _: None)
    assert outcome == {"es": "partial"}
    assert len(calls) == 3  # stopped after the third identical answer, not the sixth
    assert any("daily character limit" in line for line in said)


def test_a_failing_server_is_reported_not_retried_forever():
    outcome = prewarm_translations.prewarm(
        "https://example.test", ["es"], get=lambda url: (503, {}, 0.1), say=lambda line: None, sleep=lambda _: None
    )
    assert outcome == {"es": "failed"}
