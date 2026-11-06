"""Texts the game's server writes: templates in the page's table, translated for the viewer
(game_messages.py, docs/game-translation.md "Texts the server writes")."""

import json
import sys
from pathlib import Path
from typing import Any

import pytest

from game_platform import game_messages, game_server_texts, game_text
from game_platform.service import GameMessageError
from game_platform.tests.helpers import Api
from game_platform.translation import FakeTranslator, TranslationError, TranslationService

GAMES_DIR = Path(__file__).parent.parent / "games"

TABLE = {
    "your_turn": "Your turn",
    "server_not_your_turn": "not your turn",
    "server_need_cards": "need {count} more cards",
    "server_need_cards_of": "need {count} more cards of {rank}",
    "server_cannot_beat": "{what} cannot beat {other}",
    "server_calls": "{who} calls {amount}.",
    "server_calls_all_in": "{who} calls {amount} (all in).",
    "server_dots": "wait... (really?) [1+1] $5 ^up | down \\ end",
    "server_any": "{anything}",
}


def templates(table: dict[str, str] | None = None) -> tuple[game_messages.Template, ...]:
    return game_messages.compile_templates(TABLE if table is None else table)


# Matching


def test_a_text_matches_its_template_and_the_values_are_captured() -> None:
    found = game_messages.match(templates(), "need 3 more cards")
    assert found is not None
    assert (found.key, found.params, found.template) == ("server_need_cards", {"count": "3"}, "need {count} more cards")
    assert game_messages.match(templates(), "not your turn").key == "server_not_your_turn"  # type: ignore[union-attr]


def test_the_most_specific_template_wins() -> None:
    # "{anything}" fits every text; so does "need {count} more cards" fit the longer text
    # below, but the template that says more is the right one.
    assert game_messages.match(templates(), "need 2 more cards of kings").key == "server_need_cards_of"  # type: ignore[union-attr]
    assert game_messages.match(templates(), "Ana calls 40 (all in).").key == "server_calls_all_in"  # type: ignore[union-attr]
    assert game_messages.match(templates(), "Ana calls 40.").key == "server_calls"  # type: ignore[union-attr]
    # the catch-all is only the last resort
    assert game_messages.match(templates(), "something else entirely").key == "server_any"  # type: ignore[union-attr]


def test_ambiguity_is_settled_by_literal_text_then_placeholders_then_key() -> None:
    table = {"server_b": "{x} wins", "server_a": "{x} wins", "server_c": "{x} {y}", "server_d": "ab {x}"}
    ordered = [t.key for t in game_messages.compile_templates(table)]
    assert ordered[:2] == ["server_a", "server_b"]  # same shape: key order, so the answer never changes
    assert ordered[2:] == ["server_d", "server_c"] or ordered[0] == "server_d"
    assert game_messages.match(game_messages.compile_templates(table), "Ana wins").key == "server_a"  # type: ignore[union-attr]


def test_regular_expression_characters_in_a_template_are_plain_text() -> None:
    text = "wait... (really?) [1+1] $5 ^up | down \\ end"
    found = game_messages.match(templates({"server_dots": text}), text)
    assert found is not None and found.key == "server_dots"
    assert game_messages.match(templates({"server_dots": text}), "wait!!! (really?) [1+1] $5 ^up | down \\ end") is None


def test_a_repeated_placeholder_keeps_its_first_value_and_only_server_keys_count() -> None:
    table = {"server_same": "{a} and {a}", "plain": "not a server text"}
    found = game_messages.match(game_messages.compile_templates(table), "x and y")
    assert found is not None and found.params == {"a": "x"}
    assert game_messages.match(game_messages.compile_templates(table), "not a server text") is None


def test_a_text_with_no_template_is_not_matched() -> None:
    assert game_messages.match(templates({"server_not_your_turn": "not your turn"}), "your turn not") is None
    assert game_messages.match(templates({}), "anything") is None
    assert game_messages.match(game_messages.compile_templates(None), "anything") is None


def test_values_are_put_back_as_written() -> None:
    assert game_messages.fill("[es] faltan {count} cartas", {"count": "3"}) == "[es] faltan 3 cartas"
    assert game_messages.fill("{unknown} stays", {}) == "{unknown} stays"


# Reading the server code


SERVER = r"""
const game = {
  applyMove(state, playerId, move) {
    if (state.over) throw new InvalidMove("game over");
    if (!move) throw new InvalidMove('send a move');
    if (state.n < 3) throw new InvalidMove(`need ${3 - state.n} more cards`);
    if (move.k) throw new InvalidMove("must beat " + state.top + " or pass");
    throw new InvalidMove(state.n > 5 ? "too many" : 'too few');
  },
  describe(s, names) {
    log(s, `${names[0]} calls ${s.bet}${s.chips === 0 ? " (all in)" : ""}.`);
    s.last = { msg: 'refill', text: names[1] + ' passes', label: 'Pair' };
    return s;
  },
  other(err, e) { throw new InvalidMove(err); },
};
"""


def test_the_reader_finds_literals_templates_concatenations_and_conditionals() -> None:
    result = game_server_texts.extract(SERVER)
    invalid = {f.template for f in result.found if f.kind == "InvalidMove"}
    assert invalid == {
        "game over",
        "send a move",
        "need {p1} more cards",
        "must beat {p1} or pass",
        "too many",
        "too few",
    }
    state = {f.template for f in result.found if f.kind == "state"}
    assert state == {"{p1} calls {p2}.", "{p1} calls {p2} (all in).", "{p1} passes", "Pair"}  # 'refill' is a code
    # what it cannot read is listed, not guessed
    assert [(source, "variable" in reason) for _, source, reason in result.unreadable] == [("err", True)]


def test_the_tool_adds_templates_once_and_leaves_the_rest_of_the_page_alone(tmp_path: Path) -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location("extract_server_texts", GAMES_DIR.parent / "tools" / "extract_server_texts.py")
    assert spec and spec.loader
    tool = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = tool
    spec.loader.exec_module(tool)
    page = (
        '<html><script type="application/json" id="i18n-strings">\n{\n  "title": "Cards",\n  "wins": "{name} wins!"\n}\n</script>'
        "<script>t('title')</script></html>"
    )
    (tmp_path / "cards.html").write_text(page, encoding="utf-8")
    (tmp_path / "cards.server.js").write_text(SERVER, encoding="utf-8")
    game = tool.Game("cards.html", tmp_path / "cards.html", tmp_path / "cards.server.js")
    review, skipped = tool.process([game], write=True)
    assert skipped == {}
    assert any("NOT READ" in line and "`err`" in line for line in review)
    written = (tmp_path / "cards.html").read_text(encoding="utf-8")
    table = game_text.extract_strings(written)
    assert table is not None and table["title"] == "Cards" and table["wins"] == "{name} wins!"
    assert table["server_game_over"] == "game over"
    assert table["server_need_more_cards"] == "need {p1} more cards"
    assert written.endswith("<script>t('title')</script></html>")
    # a second run adds nothing
    tool.process([game], write=True)
    assert (tmp_path / "cards.html").read_text(encoding="utf-8") == written
    # and the table now covers the server code, which the checker confirms
    assert game_text.server_text_problems(table, SERVER) == []


# The checker for new games


def test_the_checker_asks_for_a_template_of_every_text_the_server_writes() -> None:
    page = (
        '<script type="application/json" id="i18n-strings">{"your_turn": "Your turn"}</script>'
        "<script>const SOURCE_STRINGS = JSON.parse(document.getElementById('i18n-strings').textContent);"
        "function t(k){return k;} document.title = t('your_turn');</script>"
    )
    assert game_text.lint(page) == []
    problems = game_text.lint(page, 'throw new InvalidMove("not your turn");')
    assert len(problems) == 1 and "'not your turn'" in problems[0] and "server_" in problems[0]
    covered = page.replace('{"your_turn": "Your turn"}', '{"your_turn": "Your turn", "server_not_your_turn": "not your turn"}')
    assert game_text.lint(covered, 'throw new InvalidMove("not your turn");') == []
    # a template with a placeholder covers the texts built from values
    covered = page.replace('{"your_turn": "Your turn"}', '{"your_turn": "Your turn", "server_need": "need {count} more"}')
    assert game_text.lint(covered, 'throw new InvalidMove("need " + n + " more");') == []
    assert game_text.lint(covered, 'throw new InvalidMove(`need ${n} more`);') == []
    # server keys are not shown by t(), so the "never shown" rule does not apply to them
    assert not any("never shows" in p for p in game_text.lint(covered))
    # no server code: nothing more to check
    assert game_text.lint(covered, None) == game_text.lint(covered, "")


def test_the_instructions_to_the_agent_explain_server_texts_with_an_example() -> None:
    rules = game_text.PROMPT_RULES
    assert "server_not_your_turn" in rules and "server_need_cards" in rules and "tx(" in rules
    assert "InvalidMove" in rules


def test_every_repository_game_covers_the_texts_its_server_writes() -> None:
    """The tables were filled by tools/extract_server_texts.py: a text the reader finds in a
    server file has a template (a new text in the code without one shows here)."""
    checked = 0
    for page in [*GAMES_DIR.glob("*.html"), *GAMES_DIR.glob("*/*.html")]:
        if page.name.endswith(".original.html"):
            continue
        server = page.with_name(page.stem + ".server.js")
        if not server.exists():
            server = page.with_name(page.stem + ".original.server.js")
        table = game_text.extract_strings(page.read_text(encoding="utf-8"))
        if not server.exists() or table is None:
            continue
        checked += 1
        assert game_text.server_text_problems(table, server.read_text(encoding="utf-8")) == [], page.name
    assert checked >= 50


# The platform: the response of a rejected move


class TranslatingApi(Api):
    def __init__(self, translator: Any = None) -> None:
        super().__init__()
        self.platform._translation = TranslationService(self.platform._store, translator, clock=self.platform._clock)


GAME_PAGE = (
    '<script type="application/json" id="i18n-strings">'
    + json.dumps({"your_turn": "Your turn", **{k: v for k, v in TABLE.items() if k.startswith("server_") and k != "server_any"}})
    + "</script><script>t('your_turn')</script>"
)


def make_game(api: TranslatingApi) -> Any:
    if getattr(api, "game", None) is not None:
        return api.game
    owner = api.new_user("owner")
    game = api.ok("POST", "/games", as_user=owner, json={
        "name": "Cards", "description": "d", "allowed_player_counts": [2],
        "allows_leave_mid_match": False, "allows_join_mid_match": False, "code": GAME_PAGE,
    })
    api.game = api.platform.get_game_version(game["id"], 1, caller_id=owner)  # type: ignore[attr-defined]
    return api.game  # type: ignore[attr-defined]


def rejection(api: TranslatingApi, message: str) -> GameMessageError:
    return api.platform._game_message_error(make_game(api), message)


def test_a_rejected_text_is_matched_against_the_game_versions_table() -> None:
    api = TranslatingApi(FakeTranslator())
    error = rejection(api, "need 4 more cards")
    assert (error.key, error.params, str(error)) == ("server_need_cards", {"count": "4"}, "need 4 more cards")
    assert error.game_version == 1
    # the compiled templates are kept for the version: no second parse
    game = make_game(api)
    assert (game.id, 1) in api.platform._server_templates


def test_the_detail_is_translated_through_the_table_and_the_values_come_back() -> None:
    fake = FakeTranslator()
    api = TranslatingApi(fake)
    error = rejection(api, "need 4 more cards")
    assert api.platform.translate_game_message(error, "es") == "[es] need 4 more cards"
    assert fake.calls == [(["need {count} more cards"], "es")]  # the template went to the translator, not the text
    # remembered: the same template for another number is not translated again
    other = rejection(api, "need 9 more cards")
    assert api.platform.translate_game_message(other, "es") == "[es] need 9 more cards"
    assert len(fake.calls) == 1


def test_values_are_not_translated_and_may_look_like_placeholders() -> None:
    api = TranslatingApi(FakeTranslator())
    error = rejection(api, "Ana {x} calls 5.")
    assert error.key == "server_calls"
    assert api.platform.translate_game_message(error, "fr") == "[fr] Ana {x} calls 5."


def test_english_unmatched_and_untranslatable_texts_stay_as_written() -> None:
    fake = FakeTranslator()
    api = TranslatingApi(fake)
    assert api.platform.translate_game_message(rejection(api, "need 4 more cards"), "en") is None
    assert api.platform.translate_game_message(rejection(api, "need 4 more cards"), "xx") is None
    assert fake.calls == []
    # a table whose catch-all key would match is not used by a text that matches nothing else
    unmatched = GameMessageError("whatever", game_id="g", game_version=1)
    assert unmatched.key is None and api.platform.translate_game_message(unmatched, "es") is None


def test_without_a_translator_or_with_a_failing_one_the_detail_is_unchanged() -> None:
    assert TranslatingApi(None).platform.translate_game_message(rejection(TranslatingApi(None), "not your turn"), "es") is None
    failing = TranslatingApi(FakeTranslator(fail=TranslationError("down")))
    assert failing.platform.translate_game_message(rejection(failing, "not your turn"), "es") is None


def raising_route(api: TranslatingApi, error: Exception) -> None:
    def boom() -> None:
        raise error

    api.client.app.add_api_route("/_boom", boom)  # type: ignore[attr-defined]


def test_the_400_carries_the_translated_detail_a_code_the_template_key_and_the_values() -> None:
    api = TranslatingApi(FakeTranslator())
    raising_route(api, rejection(api, "need 4 more cards"))
    response = api.client.get("/_boom", headers={"Accept-Language": "es"})
    assert response.status_code == 400
    assert response.json() == {
        "detail": "[es] need 4 more cards",
        "code": "game_message",
        "message_key": "server_need_cards",
        "params": {"count": "4"},
    }
    english = api.client.get("/_boom").json()
    assert english == {"detail": "need 4 more cards", "code": "game_message", "message_key": "server_need_cards", "params": {"count": "4"}}


def test_an_unmatched_game_error_keeps_its_text_and_gets_the_code_only() -> None:
    api = TranslatingApi(FakeTranslator())
    raising_route(api, rejection(api, "a text with no template"))
    body = api.client.get("/_boom", headers={"Accept-Language": "de"}).json()
    assert body == {"detail": "a text with no template", "code": "game_message"}


def test_a_failing_translator_still_answers_400_with_the_english_text() -> None:
    api = TranslatingApi(FakeTranslator(fail=TranslationError("down")))
    raising_route(api, rejection(api, "not your turn"))
    response = api.client.get("/_boom", headers={"Accept-Language": "ar"})
    assert response.status_code == 400
    assert response.json()["detail"] == "not your turn" and response.json()["code"] == "game_message"


# End to end through QuickJS (runs where QuickJS is installed: CI and production)


def test_a_rejected_move_of_tictactoe_is_answered_in_the_viewers_language() -> None:
    api = TranslatingApi(FakeTranslator())
    owner, guest = api.new_user("owner"), api.new_user("guest")
    game = api.ok("POST", "/games", as_user=owner, json={
        "name": "Tic-tac-toe", "allowed_player_counts": [2],
        "code": (GAMES_DIR / "tictactoe.html").read_text(encoding="utf-8"),
        "server_code": (GAMES_DIR / "tictactoe.server.js").read_text(encoding="utf-8"),
        "game_schemas": json.loads((GAMES_DIR / "tictactoe.schema.json").read_text(encoding="utf-8")),
    })
    match = api.ok("POST", "/matches", as_user=owner, json={"game_id": game["id"], "num_computer_opponents": 0})
    api.ok("POST", f"/matches/{match['id']}/join", as_user=guest)
    current = api.ok("POST", f"/matches/{match['id']}/start", as_user=owner, json={})
    current = api.ok("POST", f"/matches/{match['id']}/moves", as_user=owner,
                     json={"move": {"cell": 0}, "expected_move_count": current["move_count"]})
    response = api.request("POST", f"/matches/{match['id']}/moves", as_user=guest, headers={"Accept-Language": "es"},
                           json={"move": {"cell": 0}, "expected_move_count": current["move_count"]})
    assert response.status_code == 400
    assert response.json()["detail"] == "[es] that cell is taken"
    assert response.json()["code"] == "game_message"
    assert response.json()["message_key"] == "server_that_cell_is_taken"
    in_english = api.request("POST", f"/matches/{match['id']}/moves", as_user=guest,
                             json={"move": {"cell": 0}, "expected_move_count": current["move_count"]})
    assert in_english.json()["detail"] == "that cell is taken"
