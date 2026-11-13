"""Builds Ghost's POST /games payload from the files in this folder.

    python3 build.py OUT.json

The secret (game_addition_request_id_and_secret) comes from ~/.config/buildplay-games/secrets.json
(see gamekit.py) and never goes in the repo, so write OUT.json outside the repo.
The word list inside server.js is written by wordlist.py.
"""

import copy
import sys
from html import escape
from pathlib import Path

import gamekit
import texts

HERE = Path(__file__).parent
BG, INK, ACCENT, RED = "#14121f", "#efeaff", "#b9f3ff", "#ff7a8a"
GHOST = "GHOST"


def make_view(ctx):
    ids = [p["id"] for p in ctx["players"]]

    def view(state, pid):
        seat = ids.index(pid) if pid in ids else -1
        return {k: state[k] for k in ("letters", "fragment", "to_move", "last_adder", "challenge", "last", "round", "winner")} | {
            "my_seat": seat if seat >= 0 else None}
    return view


def view_svg(v, who):
    p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320">', f'<rect width="600" height="320" fill="{BG}"/>',
         f'<text x="16" y="30" font-size="18" font-weight="700" fill="{INK}">Ghost · {escape(who)} · round {v["round"]}</text>']
    for s, n in enumerate(v["letters"]):
        y = 64 + s * 30
        p.append(f'<text x="16" y="{y}" font-size="16" fill="{ACCENT if s == v["to_move"] else INK}">Seat {s + 1}</text>')
        for i, ch in enumerate(GHOST):
            p.append(f'<text x="{100 + i * 18}" y="{y}" font-size="16" font-family="monospace" fill="{RED if i < n else "#4b4668"}">{ch}</text>')
    frag = v["fragment"].upper() or "·"
    p.append(f'<text x="300" y="250" font-size="44" text-anchor="middle" font-family="monospace" fill="{ACCENT}">{escape(frag)}</text>')
    if v["challenge"]:
        p.append(f'<text x="300" y="290" font-size="16" text-anchor="middle" fill="{RED}">Seat {v["challenge"]["by"] + 1} challenges seat {v["challenge"]["target"] + 1}</text>')
    if v["winner"] is not None:
        p.append(f'<text x="300" y="290" font-size="18" text-anchor="middle" fill="{ACCENT}">Seat {v["winner"] + 1} wins</text>')
    p.append("</svg>")
    return "".join(p)


def cover_svg():
    # 16:9, text-free: a glowing ghost over floating letter tiles.
    p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">',
         '<defs><radialGradient id="g" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#3a2f63"/><stop offset="1" stop-color="#0d0b16"/></radialGradient></defs>',
         '<rect width="1600" height="900" fill="url(#g)"/>',
         '<path d="M800 150 C640 150 560 270 560 420 L560 700 L620 650 L680 700 L740 650 L800 700 L860 650 L920 700 L980 650 L1040 700 L1040 420 C1040 270 960 150 800 150Z" fill="none" stroke="#b9f3ff" stroke-width="28" opacity=".25"/>',
         '<path d="M800 170 C655 170 580 280 580 420 L580 680 L640 630 L700 680 L760 630 L800 670 L840 630 L900 680 L960 630 L1020 680 L1020 420 C1020 280 945 170 800 170Z" fill="#e8fbff"/>',
         '<ellipse cx="730" cy="400" rx="30" ry="42" fill="#14121f"/><ellipse cx="870" cy="400" rx="30" ry="42" fill="#14121f"/>',
         '<ellipse cx="800" cy="500" rx="34" ry="24" fill="#14121f"/>']
    for i, (x, y, r) in enumerate([(240, 220, -12), (330, 560, 8), (1260, 260, 10), (1340, 600, -8), (190, 700, 4), (1430, 420, -4)]):
        p.append(f'<rect x="{x}" y="{y}" width="110" height="110" rx="14" fill="#2f2b47" stroke="#b9f3ff" stroke-width="4" transform="rotate({r} {x + 55} {y + 55})"/>')
    p.append("</svg>")
    return "".join(p)


# ---------------------------------------------------------------- schemas

STATE_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
                "required": ["letters", "fragment", "to_move", "starter", "last_adder", "challenge", "last", "round", "winner"],
                "properties": {
                    "letters": {"type": "array", "minItems": 2, "maxItems": 6, "items": {"type": "integer", "minimum": 0, "maximum": 5}},
                    "fragment": {"type": "string", "pattern": "^[a-z]*$", "maxLength": 200},
                    "to_move": {"type": "integer", "minimum": 0, "maximum": 5}, "starter": {"type": "integer", "minimum": 0, "maximum": 5},
                    "last_adder": {"type": ["null", "integer"], "minimum": 0, "maximum": 5},
                    "challenge": {"type": ["null", "object"], "required": ["by", "target"]},
                    "last": {"type": ["null", "object"], "required": ["loser", "reason", "fragment", "word"]},
                    "round": {"type": "integer", "minimum": 1}, "winner": {"type": ["null", "integer"], "minimum": 0, "maximum": 5}}}
VIEW_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
               "required": ["letters", "fragment", "to_move", "last_adder", "challenge", "last", "round", "winner", "my_seat"],
               "properties": {k: v for k, v in STATE_SCHEMA["properties"].items() if k != "starter"} | {
                   "my_seat": {"type": ["null", "integer"], "minimum": 0, "maximum": 5}}}
MOVE_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "minProperties": 1, "maxProperties": 1,
               "additionalProperties": False,
               "properties": {"letter": {"type": "string", "pattern": "^[a-zA-Z]$"}, "word": {"type": "string", "pattern": "^[a-zA-Z]{1,30}$"},
                              "challenge": {"const": True}, "give_up": {"const": True}}}

# ---------------------------------------------------------------- test cases (written by hand from the rules)

PLAYERS = [{"id": f"u{i}", "kind": "human", "display_name": n, "picture_url": "", "max_loss": 10}
           for i, n in enumerate(["Ana", "Bruno", "Carla"])]
CTX = {"players": PLAYERS, "pot": 30, "move_count": 0, "seed": 4}
VIEW = make_view(CTX)


def st(**kw):
    s = {"letters": [0, 0, 0], "fragment": "", "to_move": 0, "starter": 0, "last_adder": None, "challenge": None,
         "last": None, "round": 1, "winner": None}
    s.update(copy.deepcopy(kw))
    return s


def case(name, desc, kind, state, mover, other, move, **kw):
    return gamekit.case(name, desc, kind, {**CTX, "move_count": kw.pop("move_count", 0)}, state, mover, other, move, VIEW, view_svg, **kw)


def cases():
    out = []
    # 1. Ana starts the round with "c"; Bruno is next.
    out.append(case("Starting a round", "The first player adds any letter; the turn passes to the next player.",
                    "initial", st(), "u0", "u1", {"letter": "c"},
                    expected_state=st(fragment="c", to_move=1, last_adder=0), expected_turn=["u1"]))
    # 2. Fragment "car", Carla adds "t": "cart" is a word of 4 letters, so Carla loses the round and
    # takes a G. The next round starts with the player left of this round's starter (Ana -> Bruno).
    s2 = st(fragment="car", to_move=2, last_adder=1)
    a2 = st(letters=[0, 0, 1], fragment="", to_move=1, starter=1, last_adder=None, round=2,
            last={"loser": 2, "reason": "completed", "fragment": "cart", "word": "cart"})
    out.append(case("Completing a word", "Adding a letter that completes a word of 4+ letters loses the round.",
                    "intermediate", s2, "u2", "u0", {"letter": "t"}, expected_state=a2, expected_turn=["u1"], move_count=3))
    # 3. Fragment "zq" (Bruno added the q). Carla challenges: Bruno must answer.
    s3 = st(fragment="zq", to_move=2, last_adder=1)
    a3 = st(fragment="zq", to_move=1, last_adder=1, challenge={"by": 2, "target": 1})
    out.append(case("Challenging", "Instead of a letter, a player challenges the one who added the last letter.",
                    "intermediate", s3, "u2", "u1", {"challenge": True}, expected_state=a3, expected_turn=["u1"], move_count=2))
    # 4. Fragment "plan", Bruno challenged by Carla answers "planet": a real word longer than the
    # letters, so Carla (the challenger) loses the round and takes a G.
    s4 = st(fragment="plan", to_move=1, last_adder=1, challenge={"by": 2, "target": 1})
    a4 = st(letters=[0, 0, 1], to_move=1, starter=1, round=2, last={"loser": 2, "reason": "challenge_failed", "fragment": "plan", "word": "planet"})
    out.append(case("Answering a challenge", "A real word that starts with the letters makes the challenger lose the round.",
                    "intermediate", s4, "u1", "u2", {"word": "planet"}, expected_state=a4, expected_turn=["u1"], move_count=6))
    # 5. Nothing to challenge at the start of a round.
    out.append(case("Nothing to challenge", "A challenge before any letter is refused.",
                    "intermediate", st(), "u0", "u1", {"challenge": True}, error="InvalidMove", expected_turn=["u0"]))
    # 6. Ana and Bruno each have G-H-O-S (4 letters), Carla is out. Bruno, challenged on "xq", gives
    # up: he takes his fifth letter and is out, so Ana is the last player left and wins the pot.
    s6 = st(letters=[4, 4, 5], fragment="xq", to_move=1, starter=0, last_adder=1, challenge={"by": 0, "target": 1}, round=13)
    a6 = st(letters=[4, 5, 5], fragment="", to_move=0, starter=0, last_adder=1, challenge=None, round=13, winner=0,
            last={"loser": 1, "reason": "gave_up", "fragment": "xq", "word": None})
    out.append(case("Last player left wins", "A player who takes the fifth letter is out; the last player left wins.",
                    "terminal", s6, "u1", "u0", {"give_up": True}, expected_state=a6, expected_turn=None,
                    expected_payouts={"u0": 30, "u1": 0, "u2": 0}, move_count=90))
    return out


def payload():
    client = (HERE / "client.html").read_text()
    return {
        "name": texts.NAME, "description": texts.DESCRIPTION,
        "allowed_player_counts": [2, 3, 4, 5, 6], "allows_leave_mid_match": False, "allows_join_mid_match": False,
        "language": "en", "client_code": client, "server_code": (HERE / "server.js").read_text(),
        "rules": texts.RULES, "ui_instructions": texts.UI,
        "tutorial": {"text": texts.TUTORIAL_TEXT, "html": gamekit.tutorial_html(texts.TUTORIAL, TUTORIAL_FIGURE, BG, INK, ACCENT)},
        "images": [
            {"caption": "Cover", "svg": cover_svg()},
            {"caption": "Adding letters", "svg": gamekit.text_svg("Adding letters", [
                "C → CA → CAR → ...", "Keep it the start of a word.", "Complete a word of 4+ letters: you lose."], BG, INK, ACCENT)},
            {"caption": "Challenging", "svg": gamekit.text_svg("Challenging", [
                "Think it is a bluff? Challenge.", "Name a real word: the challenger loses.", "Cannot: you lose the round."], BG, INK, ACCENT)},
            {"caption": "G-H-O-S-T", "svg": gamekit.text_svg("G-H-O-S-T", [
                "Each lost round: one more letter.", "Five letters and you are out.", "The last player left wins."], BG, INK, ACCENT)},
        ],
        "unit_tests": {"state_schema": STATE_SCHEMA, "view_schema": VIEW_SCHEMA, "move_schema": MOVE_SCHEMA, "cases": cases()},
        "translations": gamekit.translations(texts, client),
        "game_addition_request_id_and_secret": gamekit.secret("ghost"),
    }


# A text-free figure: a little ghost and three letter tiles.
TUTORIAL_FIGURE = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 110" role="presentation"><rect width="320" height="110" fill="#14121f"/>'
    '<path d="M60 20 C38 20 28 36 28 56 L28 92 L37 85 L46 92 L55 85 L64 92 L73 85 L82 92 L92 85 L92 56 C92 36 82 20 60 20Z" fill="#e8fbff"/>'
    '<circle cx="50" cy="52" r="5" fill="#14121f"/><circle cx="70" cy="52" r="5" fill="#14121f"/>'
    + "".join(f'<rect x="{130 + i * 60}" y="35" width="44" height="44" rx="8" fill="#2f2b47" stroke="#b9f3ff" stroke-width="2"/>' for i in range(3))
    + "</svg>"
)

if __name__ == "__main__":
    gamekit.write_payload(sys.argv[1], payload())
