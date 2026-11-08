"""Every new game must carry its text table (translation.require_strings): the checker and the
server gate on create / save (admin paths exempt)."""

import json

import pytest

from game_platform import game_text, i18n
from game_platform.config import TranslationConfig
from game_platform.service import InvalidRequestError
from game_platform.tests.helpers import Api


# The shape the agent is told to write (PROMPT_RULES): the block first, the helper as given.
GOOD = (
    '<!doctype html><html><body><div id="status"></div><input id="name">\n'
    '<script type="application/json" id="i18n-strings">\n'
    '{"your_turn": "Your turn", "wins": "{name} wins!", "score": "Score: {n}", "name_label": "Your name"}\n'
    "</script>\n<script>\n" + game_text.HELPER_JS + "\n"
    "function render(m) {\n"
    "  applyLocale(m);\n"
    '  document.getElementById("status").textContent = t("your_turn");\n'
    '  document.getElementById("name").setAttribute("aria-label", t("name_label"));\n'
    '  ctx.fillText(t("score", {n: 3}), 10, 20);\n'
    '  status.textContent = t("wins", {name: "A"});\n'
    "}\n</script></body></html>"
)
NO_BLOCK = "<html><body><button>Start</button><script>b.textContent = 'Start';</script></body></html>"


def test_the_example_game_passes_the_checker() -> None:
    assert game_text.lint(GOOD) == []


@pytest.mark.parametrize(
    ("snippet", "expected"),
    [
        ('<input aria-label="Player name">', "aria-label, placeholder, title or alt attribute: 'Player name'"),
        ('<input placeholder="Type here">', "'Type here'"),
        ("el.setAttribute('aria-label', 'Close the dialog');", "'Close the dialog'"),
        ('ctx.fillText("Score: " + n, 1, 2);', "draws text on a canvas without t()"),
        ("alert('Illegal move, try again');", "alert/confirm/prompt"),
        ("status.textContent = name + ' wins';", "joining pieces"),
    ],
)
def test_the_checker_catches_where_real_generations_slip(snippet: str, expected: str) -> None:
    if snippet.startswith("<"):
        code = GOOD.replace("</body>", snippet + "</body>")
    else:
        code = GOOD.replace("</script></body>", snippet + "\n</script></body>")
    assert expected in "\n".join(game_text.lint(code))


def test_attribute_and_canvas_text_from_t_is_fine() -> None:
    extra = '<button aria-label="" title="">x</button><canvas width="3"></canvas>'
    assert game_text.lint(GOOD.replace("</body>", extra + "</body>")) == []


def _body(code: str) -> dict:
    return {"name": "G", "allowed_player_counts": [2], "code": code}


def test_the_default_is_to_require_strings() -> None:
    assert TranslationConfig().require_strings is True
    assert json.loads((game_text.Path(__file__).parents[1] / "config.example.json").read_text(encoding="utf-8"))["translation"]["require_strings"] is True


def test_creating_a_game_without_a_text_table_is_refused_in_plain_words() -> None:
    api = Api(require_game_strings=True)
    owner = api.new_user("owner")
    with pytest.raises(
        InvalidRequestError,
        match="the game's texts cannot be translated: the game has no i18n-strings block",
    ):
        api.create_game(_body(NO_BLOCK), owner)
    api.create_game(_body(GOOD), owner)


def test_the_refusal_is_localized_with_a_stable_code() -> None:
    api = Api(require_game_strings=True)
    owner = api.new_user("owner")
    with pytest.raises(InvalidRequestError) as excinfo:
        api.create_game(_body(NO_BLOCK), owner)
    english = str(excinfo.value)
    text, code, params = i18n.localize_error(english, "es")
    assert code == "game_texts_not_translatable" and "traducir" in text
    assert params["problems"].startswith("the game has no i18n-strings block")


def test_saving_a_new_version_needs_a_passing_table_but_other_edits_do_not() -> None:
    api = Api(require_game_strings=True)
    owner = api.new_user("owner")
    game_id = api.create_game(_body(GOOD), owner)["id"]
    bad = api.request("PATCH", f"/games/{game_id}", as_user=owner, json={"code": NO_BLOCK})
    assert bad.status_code == 400 and "cannot be translated" in bad.json()["detail"]
    assert api.ok("GET", f"/games/{game_id}")["version"] == 1
    assert api.ok("PATCH", f"/games/{game_id}", as_user=owner, json={"code": GOOD + "<!-- v2 -->"})["version"] == 2
    # A game that predates the rule can still change its description.
    api.platform._require_game_strings = False
    old_id = api.create_game(_body(NO_BLOCK), owner)["id"]
    api.platform._require_game_strings = True
    assert api.ok("PATCH", f"/games/{old_id}", as_user=owner, json={"description": "new"})["version"] == 2


def test_games_with_no_client_code_are_exempt() -> None:
    platform = Api(require_game_strings=True).platform
    platform._require_translatable("")  # does not raise
    platform._require_translatable(None)
    with pytest.raises(InvalidRequestError):
        platform._require_translatable("<p>hi there</p>")


def test_example_data_saves_are_exempt() -> None:
    api = Api(require_game_strings=True, master_password="pw")
    owner = api.new_user("owner")
    from game_platform.service import GameRules
    seeded = api.platform.create_game(
        caller_id=owner, name="Seed", description="", rules=GameRules(
            allowed_player_counts=(2,), allows_leave_mid_match=False, allows_join_mid_match=False),
        code=NO_BLOCK, _check_strings=False)
    assert seeded.code == NO_BLOCK


def test_the_switch_off_allows_any_code() -> None:
    api = Api(require_game_strings=False)
    owner = api.new_user("owner")
    api.create_game(_body(NO_BLOCK), owner)
