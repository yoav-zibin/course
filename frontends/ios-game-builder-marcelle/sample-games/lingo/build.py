"""Builds Lingo's POST /games payload from the files in this folder.

    python3 build.py OUT.json

The secret (game_addition_request_id_and_secret) comes from ~/.config/buildplay-games/secrets.json
(see gamekit.py) and never goes in the repo, so write OUT.json outside the repo.
The word lists inside server.js are written by wordlist.py.
"""

import copy
import sys
from html import escape
from pathlib import Path

import gamekit
import texts

HERE = Path(__file__).parent
BG, INK, GOLD, RED, YELLOW = "#0b1c3a", "#f4f6ff", "#ffd66b", "#e2353b", "#f6c945"


def make_view(ctx):
    ids = [p["id"] for p in ctx["players"]]

    def view(state, pid):
        seat = ids.index(pid) if pid in ids else -1
        over = state["phase"] == "over"
        return {
            "seats": state["seats"], "round": state["round"], "word_no": state["word_no"], "words_per_round": 5,
            "phase": state["phase"], "control": state["control"], "to_move": state["to_move"], "tries": state["tries"],
            "scores": state["scores"], "lingos": state["lingos"],
            "letters": [state["word"][i] if (r or over) else None for i, r in enumerate(state["revealed"])],
            "guesses": state["guesses"], "cards": state["cards"], "hopper_counts": [len(h) for h in state["hoppers"]],
            "draws_left": state["draws_left"], "draw_log": state["draw_log"], "last_word": state["last_word"],
            "discarded": state["discarded"], "winners": state["winners"], "my_seat": seat if seat >= 0 else None,
        }
    return view


def view_svg(v, who):
    p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420">', f'<rect width="600" height="420" fill="{BG}"/>',
         f'<text x="16" y="30" font-size="18" font-weight="700" fill="{GOLD}">Lingo · {escape(who)} · {v["scores"][0]}–{v["scores"][1]}</text>']
    y = 50
    for g in v["guesses"]:
        for i, ch in enumerate(g["word"][:5].ljust(5)):
            m = g["marks"][i] if g["marks"] else None
            fill = RED if m == 2 else "#3b3f52" if m is None else "#1d3a6e"
            p.append(f'<rect x="{16 + i * 46}" y="{y}" width="42" height="42" rx="5" fill="{fill}"/>')
            if m == 1:
                p.append(f'<circle cx="{37 + i * 46}" cy="{y + 21}" r="18" fill="{YELLOW}"/>')
            p.append(f'<text x="{37 + i * 46}" y="{y + 29}" font-size="22" text-anchor="middle" font-family="monospace" fill="{INK}">{escape(ch.upper())}</text>')
        y += 48
    if v["phase"] not in ("draw", "over"):
        for i, ch in enumerate(v["letters"]):
            p.append(f'<rect x="{16 + i * 46}" y="{y}" width="42" height="42" rx="5" fill="#234887" stroke="#6f8fd0" stroke-dasharray="4 3"/>')
            if ch:
                p.append(f'<text x="{37 + i * 46}" y="{y + 29}" font-size="22" text-anchor="middle" font-family="monospace" fill="{INK}">{ch.upper()}</text>')
    status = ("Winners: team " + ", ".join(str(t + 1) for t in v["winners"])) if v["winners"] is not None else f"{v['phase']}: seat {v['to_move'] + 1}"
    p.append(f'<text x="300" y="400" font-size="16" fill="{GOLD}">{escape(status)}</text>')
    for team, card in enumerate(v["cards"]):
        for i, n in enumerate(card["numbers"]):
            x, yy = 300 + team * 150 + (i % 5) * 28, 60 + (i // 5) * 28
            p.append(f'<circle cx="{x + 12}" cy="{yy + 12}" r="12" fill="{GOLD if card["covered"][i] else "#e8ecff"}"/>'
                     f'<text x="{x + 12}" y="{yy + 16}" font-size="10" text-anchor="middle" fill="#0b1c3a">{n}</text>')
    p.append("</svg>")
    return "".join(p)


def cover_svg():
    # 16:9, text-free: a row of five tiles (red squares and a yellow circle) and a card of balls.
    p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">',
         '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a3a74"/><stop offset="1" stop-color="#081530"/></linearGradient></defs>',
         '<rect width="1600" height="900" fill="url(#g)"/>']
    for i, kind in enumerate(["red", "blue", "yellow", "red", "blue"]):
        x = 200 + i * 170
        p.append(f'<rect x="{x}" y="260" width="150" height="150" rx="16" fill="{RED if kind == "red" else "#1d3a6e"}"/>')
        if kind == "yellow":
            p.append(f'<circle cx="{x + 75}" cy="335" r="62" fill="{YELLOW}"/>')
    for r in range(5):
        for c in range(5):
            on = (r + c) % 3 == 0 or r == 2
            p.append(f'<circle cx="{1130 + c * 70}" cy="{230 + r * 70}" r="28" fill="{GOLD if on else "#e8ecff"}"/>')
    p.append('<circle cx="420" cy="640" r="70" fill="#e8ecff"/><circle cx="600" cy="660" r="55" fill="#e2353b"/><circle cx="760" cy="640" r="62" fill="#ffd66b"/></svg>')
    return "".join(p)


# ---------------------------------------------------------------- schemas (kept light: the state is checked on every call)

INT = {"type": "integer"}
TEAMS2 = {"type": "array", "minItems": 2, "maxItems": 2}
COMMON = {"seats": {"enum": [2, 4]}, "round": {"enum": [1, 2]}, "word_no": {"type": "integer", "minimum": 0, "maximum": 10},
          "phase": {"enum": ["guess", "steal", "draw", "over"]}, "control": {"enum": [0, 1]}, "to_move": {"type": "integer", "minimum": 0, "maximum": 3},
          "tries": {"type": "integer", "minimum": 0, "maximum": 5}, "scores": TEAMS2, "lingos": TEAMS2, "cards": TEAMS2,
          "guesses": {"type": "array", "maxItems": 6}, "draws_left": {"type": "integer", "minimum": 0, "maximum": 2},
          "draw_log": {"type": "array", "maxItems": 2}, "last_word": {"type": ["null", "string"]}, "discarded": {"type": "boolean"},
          "winners": {"type": ["null", "array"]}}
STATE_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
                "required": [*COMMON, "hoppers", "used", "word", "revealed"],
                "properties": {**COMMON, "hoppers": TEAMS2, "used": {"type": "array"}, "word": {"type": "string", "pattern": "^[a-z]{5}$"},
                               "revealed": {"type": "array", "minItems": 5, "maxItems": 5}}}
VIEW_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
               "required": [*COMMON, "words_per_round", "letters", "hopper_counts", "my_seat"],
               "properties": {**COMMON, "words_per_round": {"const": 5}, "letters": {"type": "array", "minItems": 5, "maxItems": 5},
                              "hopper_counts": TEAMS2, "my_seat": {"type": ["null", "integer"]}}}
MOVE_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "minProperties": 1, "maxProperties": 1,
               "additionalProperties": False,
               "properties": {"guess": {"type": "string", "pattern": "^[a-zA-Z]{1,12}$"}, "draw": {"const": True}}}

# ---------------------------------------------------------------- test cases (written by hand from the rules)

PLAYERS = [{"id": f"u{i}", "kind": "human", "display_name": n, "picture_url": "", "max_loss": 10} for i, n in enumerate(["Ana", "Bruno"])]
CTX = {"players": PLAYERS, "pot": 20, "move_count": 0, "seed": 9}
VIEW = make_view(CTX)
# Fixed cards: team 1 (Ana) odd numbers, team 2 (Bruno) even; ten covered, no line complete.
CARD0 = {"numbers": [1, 13, 25, 37, 49, 3, 15, 27, 39, 41, 5, 17, 29, 31, 43, 7, 19, 21, 33, 45, 9, 11, 23, 35, 47],
         "covered": [True, False, True, False, False, False, True, False, True, False, True, False, False, False, True,
                     False, True, False, True, False, False, False, True, False, True]}
CARD1 = {"numbers": [n + 1 for n in CARD0["numbers"]], "covered": list(reversed(CARD0["covered"]))}


def hopper(card):
    return [str(n) for n, c in zip(card["numbers"], card["covered"]) if not c] + ["R", "R", "R"]


def st(**kw):
    s = {"seats": 2, "round": 1, "word_no": 0, "scores": [0, 0], "lingos": [0, 0], "cards": [CARD0, CARD1],
         "hoppers": [hopper(CARD0), hopper(CARD1)], "used": [42], "draw_log": [], "last_word": None, "discarded": False,
         "winners": None, "word": "bagel", "revealed": [True, False, False, False, False], "guesses": [], "control": 0,
         "phase": "guess", "tries": 0, "to_move": 0, "draws_left": 0}
    s.update(copy.deepcopy(kw))
    return s


def case(name, desc, kind, state, mover, other, move, **kw):
    return gamekit.case(name, desc, kind, {**CTX, "move_count": kw.pop("move_count", 0)}, state, mover, other, move, VIEW, view_svg, **kw)


def cases():
    out = []
    # 1. The word is BAGEL. Ana guesses BRAVE: B is right (red); A and E are in the word elsewhere (yellow).
    brave = {"team": 0, "seat": 0, "word": "brave", "marks": [2, 0, 1, 0, 1]}
    a1 = st(guesses=[brave], tries=1)
    out.append(case("A first guess", "Each letter of a guess is marked: right place, elsewhere in the word, or not in it.",
                    "initial", st(), "u0", "u1", {"guess": "brave"}, expected_state=a1, expected_turn=["u0"]))
    # 2. Ana then guesses BAGEL: 25 points, all letters shown, and her team draws two balls.
    a2 = st(guesses=[brave, {"team": 0, "seat": 0, "word": "bagel", "marks": [2, 2, 2, 2, 2]}], tries=1, scores=[25, 0],
            phase="draw", draws_left=2, revealed=[True] * 5)
    out.append(case("Solving the word", "A correct word scores 25 points and the team draws two balls for its card.",
                    "intermediate", a1, "u0", "u1", {"guess": "bagel"}, expected_state=a2, expected_turn=["u0"], move_count=1))
    # 3. An invalid guess (QZXJV is not a word): control passes to Bruno, who sees one more letter (the A).
    a3 = st(guesses=[brave, {"team": 0, "seat": 0, "word": "qzxjv", "marks": None}], tries=2, control=1, phase="steal",
            to_move=1, revealed=[True, True, False, False, False])
    out.append(case("An invalid guess passes control", "A guess that is not a five-letter word passes the word to the other team, with one more letter.",
                    "intermediate", a1, "u0", "u1", {"guess": "qzxjv"}, expected_state=a3, expected_turn=["u1"], move_count=1))
    # 4. Drawing a ball is refused while a word is being guessed.
    out.append(case("No drawing while guessing", "Balls can only be drawn after a team solves a word.",
                    "intermediate", st(), "u0", "u1", {"draw": True}, error="InvalidMove", expected_turn=["u0"]))
    # 5. Last word of round 2 (word 10): Bruno's steal guess TABLE misses, so the word is discarded and
    # the game ends. Ana's team leads 175 to 150 and wins the pot.
    s5 = st(round=2, word_no=9, scores=[175, 150], control=1, phase="steal", to_move=1, tries=5,
            revealed=[True, True, False, False, False],
            guesses=[{"team": 0, "seat": 0, "word": "brave", "marks": [2, 0, 1, 0, 1]}])
    a5 = copy.deepcopy(s5)
    a5["guesses"].append({"team": 1, "seat": 1, "word": "table", "marks": [0, 2, 1, 1, 1]})
    a5.update(discarded=True, word_no=10, phase="over", winners=[0], last_word="bagel")
    out.append(case("The last word ends the game", "After the tenth word the team with the most points wins.",
                    "terminal", s5, "u1", "u0", {"guess": "table"}, expected_state=a5, expected_turn=None,
                    expected_payouts={"u0": 20, "u1": 0}, move_count=80))
    return out


def payload():
    client = (HERE / "client.html").read_text()
    return {
        "name": texts.NAME, "description": texts.DESCRIPTION,
        "allowed_player_counts": [2, 4], "allows_leave_mid_match": False, "allows_join_mid_match": False,
        "language": "en", "client_code": client, "server_code": (HERE / "server.js").read_text(),
        "rules": texts.RULES, "ui_instructions": texts.UI,
        "tutorial": {"text": texts.TUTORIAL_TEXT, "html": gamekit.tutorial_html(texts.TUTORIAL, TUTORIAL_FIGURE, BG, INK, GOLD)},
        "images": [
            {"caption": "Cover", "svg": cover_svg()},
            {"caption": "The clues", "svg": gamekit.text_svg("The clues", [
                "Red square: right letter, right place.", "Yellow circle: in the word, elsewhere.", "Five guesses per word."], BG, INK, GOLD)},
            {"caption": "The Lingo card", "svg": gamekit.text_svg("The Lingo card", [
                "Solve a word: 25 points, draw two balls.", "Five in a line: Lingo, 50 points.", "Red stopper ends the draw."], BG, INK, GOLD)},
            {"caption": "Rounds", "svg": gamekit.text_svg("Two rounds", [
                "Five words per round.", "Round 2 doubles every score.", "Most points wins."], BG, INK, GOLD)},
        ],
        "unit_tests": {"state_schema": STATE_SCHEMA, "view_schema": VIEW_SCHEMA, "move_schema": MOVE_SCHEMA, "cases": cases()},
        "translations": gamekit.translations(texts, client),
        "game_addition_request_id_and_secret": gamekit.secret("lingo"),
    }


# A text-free figure: one guess row with red squares and a yellow circle.
TUTORIAL_FIGURE = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 90" role="presentation"><rect width="320" height="90" fill="#0b1c3a"/>'
    '<rect x="20" y="20" width="50" height="50" rx="6" fill="#e2353b"/><rect x="80" y="20" width="50" height="50" rx="6" fill="#1d3a6e"/>'
    '<rect x="140" y="20" width="50" height="50" rx="6" fill="#1d3a6e"/><circle cx="165" cy="45" r="21" fill="#f6c945"/>'
    '<rect x="200" y="20" width="50" height="50" rx="6" fill="#e2353b"/><rect x="260" y="20" width="50" height="50" rx="6" fill="#1d3a6e"/></svg>'
)

if __name__ == "__main__":
    gamekit.write_payload(sys.argv[1], payload())
