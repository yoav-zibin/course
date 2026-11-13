"""Builds Sueca's POST /games payload from the files in this folder.

    python3 build.py OUT.json

The game's secret (game_addition_request_id_and_secret) is read from
~/.config/buildplay-games/secrets.json and never stored in the repo; the first run
creates it. The output contains the secret, so write it outside the repo.
"""

import copy
import json
import secrets
import sys
from html import escape
from pathlib import Path

import texts

HERE = Path(__file__).parent
SECRETS = Path.home() / ".config" / "buildplay-games" / "secrets.json"
LANGS = ["es", "fr", "de", "pt", "zh", "hi", "ar"]


def secret() -> str:
    SECRETS.parent.mkdir(parents=True, exist_ok=True)
    data = json.loads(SECRETS.read_text()) if SECRETS.exists() else {}
    if "sueca" not in data:
        data["sueca"] = "sueca-" + secrets.token_urlsafe(32)
        SECRETS.write_text(json.dumps(data, indent=2))
        SECRETS.chmod(0o600)
    return data["sueca"]


# ---------------------------------------------------------------- tutorial

def tutorial_html() -> str:
    body = "\n".join(f"<{tag}>{escape(text, quote=False)}</{tag}>" for tag, text in texts.TUTORIAL)
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<style>body{margin:0;padding:20px;max-width:640px;font:17px/1.5 system-ui,sans-serif;"
        "background:#0f5132;color:#f4f1e8}h1{font-size:24px}h2{font-size:19px;color:#f2c94c;margin-top:22px}"
        "svg{display:block;margin:12px 0;max-width:100%;height:auto}</style></head><body>\n"
        + TUTORIAL_FIGURE + "\n" + body + "\n</body></html>"
    )


# A text-free picture of four players around a table (two teams).
TUTORIAL_FIGURE = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 160" role="presentation">'
    '<ellipse cx="160" cy="80" rx="110" ry="58" fill="#0a3a24"/>'
    '<circle cx="160" cy="18" r="14" fill="#f2c94c"/><circle cx="160" cy="142" r="14" fill="#f2c94c"/>'
    '<circle cx="34" cy="80" r="14" fill="#7fb3ff"/><circle cx="286" cy="80" r="14" fill="#7fb3ff"/>'
    '<rect x="146" y="56" width="28" height="40" rx="4" fill="#fffdf7"/></svg>'
)


# ---------------------------------------------------------------- images

SYM = {"c": "♣", "d": "♦", "h": "♥", "s": "♠"}


def card_svg(x, y, card, w=44, h=62):
    color = "#b3261e" if card[1] in "hd" else "#1b1b1b"
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="#fffdf7" stroke="#c9c2b0"/>'
        f'<text x="{x + w / 2}" y="{y + h * 0.45}" font-size="{h * 0.3:.0f}" text-anchor="middle" fill="{color}" font-weight="700">{card[0]}</text>'
        f'<text x="{x + w / 2}" y="{y + h * 0.82}" font-size="{h * 0.3:.0f}" text-anchor="middle" fill="{color}">{SYM[card[1]]}</text>'
    )


def cover_svg():
    # 16:9, no text: fanned cards on a green table.
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">',
             '<defs><radialGradient id="g" cx="50%" cy="45%" r="70%"><stop offset="0" stop-color="#16774a"/>'
             '<stop offset="1" stop-color="#0a3a24"/></radialGradient></defs>',
             '<rect width="1600" height="900" fill="url(#g)"/>',
             '<ellipse cx="800" cy="470" rx="560" ry="300" fill="#0d4a2e" stroke="#f2c94c" stroke-width="6"/>']
    suits = [("#1b1b1b", "club"), ("#b3261e", "diamond"), ("#b3261e", "heart"), ("#1b1b1b", "spade")]
    for i, (color, kind) in enumerate(suits):
        angle = -27 + i * 18
        parts.append(f'<g transform="rotate({angle} 800 820)">')
        parts.append('<rect x="700" y="230" width="200" height="290" rx="22" fill="#fffdf7" stroke="#c9c2b0" stroke-width="4"/>')
        cx, cy = 800, 375
        if kind == "diamond":
            parts.append(f'<polygon points="{cx},{cy-70} {cx+50},{cy} {cx},{cy+70} {cx-50},{cy}" fill="{color}"/>')
        elif kind == "heart":
            parts.append(f'<path d="M{cx} {cy+60} C{cx-90} {cy} {cx-60} {cy-70} {cx} {cy-30} C{cx+60} {cy-70} {cx+90} {cy} {cx} {cy+60}Z" fill="{color}"/>')
        elif kind == "club":
            parts.append(f'<circle cx="{cx}" cy="{cy-30}" r="30" fill="{color}"/><circle cx="{cx-32}" cy="{cy+12}" r="30" fill="{color}"/>'
                         f'<circle cx="{cx+32}" cy="{cy+12}" r="30" fill="{color}"/><rect x="{cx-8}" y="{cy}" width="16" height="60" fill="{color}"/>')
        else:
            parts.append(f'<path d="M{cx} {cy-70} C{cx+90} {cy-10} {cx+50} {cy+50} {cx} {cy+20} C{cx-50} {cy+50} {cx-90} {cy-10} {cx} {cy-70}Z" fill="{color}"/>'
                         f'<rect x="{cx-8}" y="{cy+10}" width="16" height="55" fill="{color}"/>')
        parts.append("</g>")
    parts.append("</svg>")
    return "".join(parts)


def text_svg(title, lines):
    rows = "".join(
        f'<text x="40" y="{150 + i * 60}" font-size="34" fill="#f4f1e8">{escape(line)}</text>' for i, line in enumerate(lines))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">'
            '<rect width="1200" height="675" fill="#0f5132"/>'
            f'<text x="40" y="80" font-size="46" font-weight="700" fill="#f2c94c">{escape(title)}</text>{rows}</svg>')


def ranking_svg():
    order = ["As", "7s", "Ks", "Js", "Qs", "6s", "5s", "4s", "3s", "2s"]
    points = ["11", "10", "4", "3", "2", "0", "0", "0", "0", "0"]
    cards = "".join(card_svg(40 + i * 112, 170, c, 96, 136) for i, c in enumerate(order))
    labels = "".join(f'<text x="{88 + i * 112}" y="350" font-size="30" text-anchor="middle" fill="#f2c94c">{p}</text>'
                     for i, p in enumerate(points))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#0f5132"/>'
            '<text x="40" y="90" font-size="46" font-weight="700" fill="#f4f1e8">Card order and points</text>'
            f'{cards}{labels}<text x="40" y="460" font-size="32" fill="#f4f1e8">Highest card first. 120 points in every deal.</text></svg>')


# ---------------------------------------------------------------- rules (for views)

RANKS = ["2", "3", "4", "5", "6", "Q", "J", "K", "7", "A"]


def to_play(state):
    return None if state["winner_team"] is not None else (state["leader"] + len(state["trick"])) % 4


def legal(state, seat):
    hand = state["hands"][seat]
    if not state["trick"]:
        return hand
    led = state["trick"][0]["card"][1]
    follow = [c for c in hand if c[1] == led]
    return follow or hand


def view(state, seat):
    """What [seat] (None for a spectator) sees: a projection of the state that hides other hands."""
    tp = to_play(state)
    return {
        "my_seat": seat,
        "hand": state["hands"][seat] if seat is not None else [],
        "playable": legal(state, seat) if seat is not None and seat == tp else [],
        "hand_counts": [len(h) for h in state["hands"]],
        "dealer": state["dealer"], "deal_number": state["deal_number"],
        "trump_suit": state["trump_suit"], "trump_card": state["trump_card"], "trump_shown": state["trump_shown"],
        "trick": state["trick"], "to_play": tp, "last_trick": state["last_trick"],
        "tricks_won": state["tricks_won"], "deal_points": state["deal_points"], "game_points": state["game_points"],
        "target": 4, "last_deal": state["last_deal"], "winner_team": state["winner_team"],
    }


def view_svg(v, who):
    """A schematic picture of a view: scores, trump, the trick and the viewer's hand."""
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420"><rect width="600" height="420" fill="#0f5132"/>',
             f'<text x="20" y="34" font-size="22" font-weight="700" fill="#f4f1e8">Sueca · {escape(who)}</text>',
             f'<text x="20" y="64" font-size="18" fill="#cfe3d6">Game points {v["game_points"][0]}–{v["game_points"][1]} · trump {SYM[v["trump_suit"]]}</text>',
             '<ellipse cx="300" cy="200" rx="200" ry="90" fill="#0a3a24"/>']
    shown = v["trick"] or (v["last_trick"]["cards"] if v["last_trick"] else [])
    for i, play in enumerate(shown):
        parts.append(card_svg(190 + i * 56, 166, play["card"]))
    if v["winner_team"] is not None:
        parts.append(f'<text x="300" y="305" font-size="22" text-anchor="middle" fill="#f2c94c">Team {v["winner_team"] + 1} wins</text>')
    for i, card in enumerate(v["hand"]):
        parts.append(card_svg(20 + i * 56, 330, card, 50, 70))
    parts.append("</svg>")
    return "".join(parts)


# ---------------------------------------------------------------- schemas

CARD = {"type": "string", "pattern": "^[234567QJKA][cdhs]$"}
SEAT = {"type": "integer", "minimum": 0, "maximum": 3}
PLAY = {"type": "object", "required": ["seat", "card"], "additionalProperties": False,
        "properties": {"seat": SEAT, "card": CARD}}
PAIR = {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "integer", "minimum": 0}}
# "null or ..." as a type list, not oneOf: the object/number keywords simply do not apply to null,
# and the platform validates every state and view, so a cheap schema keeps its checks fast.
LAST_TRICK = {"type": ["null", "object"], "required": ["cards", "winner"], "additionalProperties": False,
              "properties": {"cards": {"type": "array", "minItems": 4, "maxItems": 4, "items": PLAY}, "winner": SEAT}}
LAST_DEAL = {"type": ["null", "object"], "required": ["points", "awarded"], "additionalProperties": False,
             "properties": {"points": PAIR, "awarded": PAIR}}
TEAM = {"type": ["null", "integer"], "minimum": 0, "maximum": 1}
NULL_OR_SEAT = {"type": ["null", "integer"], "minimum": 0, "maximum": 3}
COMMON = {
    "dealer": SEAT, "deal_number": {"type": "integer", "minimum": 1},
    "trump_suit": {"enum": ["c", "d", "h", "s"]}, "trump_card": CARD, "trump_shown": {"type": "boolean"},
    "trick": {"type": "array", "maxItems": 3, "items": PLAY}, "last_trick": LAST_TRICK,
    "tricks_won": PAIR, "deal_points": PAIR, "game_points": PAIR, "last_deal": LAST_DEAL, "winner_team": TEAM,
}
STATE_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
    "required": ["dealer", "deal_number", "hands", "trump_card", "trump_suit", "trump_shown", "leader", "trick",
                 "tricks_won", "deal_points", "last_trick", "game_points", "last_deal", "winner_team"],
    "properties": {**COMMON, "leader": SEAT,
                   "hands": {"type": "array", "minItems": 4, "maxItems": 4,
                             "items": {"type": "array", "maxItems": 10, "items": CARD}}},
}
VIEW_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
    "required": ["my_seat", "hand", "playable", "hand_counts", "dealer", "deal_number", "trump_suit", "trump_card",
                 "trump_shown", "trick", "to_play", "last_trick", "tricks_won", "deal_points", "game_points", "target",
                 "last_deal", "winner_team"],
    "properties": {**COMMON,
                   "my_seat": NULL_OR_SEAT,
                   "hand": {"type": "array", "maxItems": 10, "items": CARD},
                   "playable": {"type": "array", "maxItems": 10, "items": CARD},
                   "hand_counts": {"type": "array", "minItems": 4, "maxItems": 4, "items": {"type": "integer", "minimum": 0, "maximum": 10}},
                   "to_play": NULL_OR_SEAT,
                   "target": {"const": 4}},
}
MOVE_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object",
               "required": ["card"], "additionalProperties": False, "properties": {"card": CARD}}


# ---------------------------------------------------------------- test cases (written from the rules)

PLAYERS = [{"id": f"u{i}", "kind": "human", "display_name": n, "picture_url": "", "max_loss": 10}
           for i, n in enumerate(["Ana", "Bruno", "Carla", "Duda"])]
CTX = {"players": PLAYERS, "pot": 40, "move_count": 0, "seed": 7}
NAMES = {f"u{i}": p["display_name"] for i, p in enumerate(PLAYERS)}

# A full, legal deal (each of the 40 cards once). Hearts are trump: Duda (dealer) holds Kh.
HANDS = [
    ["2c", "6c", "Ac", "3d", "Kd", "Qh", "7h", "4s", "5s", "Js"],
    ["3c", "Qc", "2d", "6d", "7d", "4h", "Jh", "Ah", "6s", "Ks"],
    ["4c", "Jc", "7c", "4d", "Qd", "Ad", "2h", "5h", "2s", "7s"],
    ["5c", "Kc", "5d", "Jd", "3h", "6h", "Kh", "3s", "Qs", "As"],
]
FRESH = {"dealer": 3, "deal_number": 1, "hands": HANDS, "trump_card": "Kh", "trump_suit": "h", "trump_shown": True,
         "leader": 0, "trick": [], "tricks_won": [0, 0], "deal_points": [0, 0], "last_trick": None,
         "game_points": [0, 0], "last_deal": None, "winner_team": None}


def without(hand, card):
    return [c for c in hand if c != card]


def with_(state, **changes):
    out = copy.deepcopy(state)
    out.update(changes)
    return out


def seat(pid):
    return int(pid[1:])


def case(name, description, kind, state, mover, other, move, expected_state=None, expected_turn=None,
         expected_payouts=None, error=None, move_count=0):
    ctx = {**CTX, "move_count": move_count}
    entry = {
        "name": name, "description": description, "kind": kind, "ctx": ctx, "state": state,
        "player_id": mover, "other_player_id": other, "move": move,
        "view_of_mover": view(state, seat(mover)), "view_of_other": view(state, seat(other)),
    }
    after = state if error else expected_state
    entry["expected_state"] = after
    entry["expected_turn"] = expected_turn
    entry["expected_view_of_mover"] = view(after, seat(mover))
    entry["expected_view_of_other"] = view(after, seat(other))
    if error:
        entry["expected_error"] = error
        entry["turn"] = expected_turn
    if expected_payouts is not None:
        entry["expected_payouts"] = expected_payouts
    entry["images"] = [
        {"caption": f"Before: {NAMES[mover]}", "svg": view_svg(entry["view_of_mover"], NAMES[mover])},
        {"caption": f"Before: {NAMES[other]}", "svg": view_svg(entry["view_of_other"], NAMES[other])},
        {"caption": f"After: {NAMES[mover]}", "svg": view_svg(entry["expected_view_of_mover"], NAMES[mover])},
        {"caption": f"After: {NAMES[other]}", "svg": view_svg(entry["expected_view_of_other"], NAMES[other])},
    ]
    return entry


def cases():
    out = []
    # 1. Opening lead: Ana (after the dealer) leads the ace of clubs; Bruno is next.
    after1 = with_(FRESH, hands=[without(HANDS[0], "Ac"), HANDS[1], HANDS[2], HANDS[3]],
                   trick=[{"seat": 0, "card": "Ac"}])
    out.append(case("Opening lead", "The player after the dealer leads any card; the next seat plays.",
                    "initial", FRESH, "u0", "u1", {"card": "Ac"}, after1, ["u1"]))
    # 2. Following suit: clubs were led; Carla holds clubs and plays the seven; Duda is next.
    s2 = with_(after1, hands=[after1["hands"][0], without(HANDS[1], "Qc"), HANDS[2], HANDS[3]],
               trick=[{"seat": 0, "card": "Ac"}, {"seat": 1, "card": "Qc"}])
    after2 = with_(s2, hands=[s2["hands"][0], s2["hands"][1], without(HANDS[2], "7c"), HANDS[3]],
                   trick=s2["trick"] + [{"seat": 2, "card": "7c"}])
    out.append(case("Following suit", "A player holding the led suit plays one of its cards.",
                    "intermediate", s2, "u2", "u3", {"card": "7c"}, after2, ["u3"], move_count=2))
    # 3. Refused: Carla holds clubs, so she may not play the ace of diamonds.
    out.append(case("Must follow suit", "Playing another suit while holding the led suit is refused.",
                    "intermediate", s2, "u2", "u1", {"card": "Ad"}, error="InvalidMove", expected_turn=["u2"],
                    move_count=2))
    # 4. A trump wins: deal 2 (dealer Ana, hearts trump, her Kh already played). Diamonds led
    # (Qd, 6d, Ad); Duda has no diamonds and trumps with 3h. Duda's team (seats 1 and 3) takes
    # Q 2 + 6 0 + A 11 + 3 0 = 13 points: 40 + 13 = 53. Duda leads next.
    s4 = {"dealer": 0, "deal_number": 2, "hands": [["2c", "Js"], ["Jh", "Ks"], ["4c", "2s"], ["3h", "6h", "Qs"]],
          "trump_card": "Kh", "trump_suit": "h", "trump_shown": False, "leader": 0,
          "trick": [{"seat": 0, "card": "Qd"}, {"seat": 1, "card": "6d"}, {"seat": 2, "card": "Ad"}],
          "tricks_won": [4, 3], "deal_points": [55, 40], "last_trick": None,
          "game_points": [1, 0], "last_deal": {"points": [70, 50], "awarded": [1, 0]}, "winner_team": None}
    after4 = with_(s4, hands=[["2c", "Js"], ["Jh", "Ks"], ["4c", "2s"], ["6h", "Qs"]], trick=[], leader=3,
                   tricks_won=[4, 4], deal_points=[55, 53],
                   last_trick={"cards": s4["trick"] + [{"seat": 3, "card": "3h"}], "winner": 3})
    out.append(case("A trump takes the trick", "A player without the led suit trumps; the trump beats the ace.",
                    "intermediate", s4, "u3", "u0", {"card": "3h"}, after4, ["u3"], move_count=47))
    # 5. Match point: deal 5, spades trump, last trick. Clubs led (Kc, Ac, 2c); Ana has only 5d.
    # Carla's ace wins: Ana and Carla take K 4 + A 11 = 15, so 50 + 15 = 65 points (61-90 = 1 game
    # point): 3 + 1 = 4 game points, the match. The pot of 40 goes to Ana and Carla, 20 each.
    s5 = {"dealer": 0, "deal_number": 5, "hands": [["5d"], [], [], []], "trump_card": "7s", "trump_suit": "s",
          "trump_shown": False, "leader": 1,
          "trick": [{"seat": 1, "card": "Kc"}, {"seat": 2, "card": "Ac"}, {"seat": 3, "card": "2c"}],
          "tricks_won": [5, 4], "deal_points": [50, 55], "last_trick": None,
          "game_points": [3, 2], "last_deal": {"points": [40, 80], "awarded": [0, 1]}, "winner_team": None}
    after5 = with_(s5, hands=[[], [], [], []], trick=[], leader=2, tricks_won=[6, 4], deal_points=[65, 55],
                   last_trick={"cards": s5["trick"] + [{"seat": 0, "card": "5d"}], "winner": 2},
                   game_points=[4, 2], last_deal={"points": [65, 55], "awarded": [1, 0]}, winner_team=0)
    out.append(case("Winning the match", "The last trick gives a team 65 points and its fourth game point.",
                    "terminal", s5, "u0", "u1", {"card": "5d"}, after5, None,
                    expected_payouts={"u0": 20, "u1": 0, "u2": 20, "u3": 0}, move_count=199))
    # 6. A sweep ("bandeira"): deal 2, clubs trump. Bruno and Duda (seats 1 and 3) have won all
    # 9 tricks so far; Bruno's ace of hearts takes the 10th (Ana has no hearts and throws 4s).
    # All 10 tricks win the match at once: they go from 1 to 4 game points (120 card points
    # alone would be 2). The pot goes to Bruno and Duda, 20 each.
    s6 = {"dealer": 0, "deal_number": 2, "hands": [["4s"], [], [], []], "trump_card": "Kc", "trump_suit": "c",
          "trump_shown": False, "leader": 1,
          "trick": [{"seat": 1, "card": "Ah"}, {"seat": 2, "card": "2h"}, {"seat": 3, "card": "3h"}],
          "tricks_won": [0, 9], "deal_points": [0, 109], "last_trick": None,
          "game_points": [0, 1], "last_deal": {"points": [50, 70], "awarded": [0, 1]}, "winner_team": None}
    after6 = with_(s6, hands=[[], [], [], []], trick=[], leader=1, tricks_won=[0, 10], deal_points=[0, 120],
                   last_trick={"cards": s6["trick"] + [{"seat": 0, "card": "4s"}], "winner": 1},
                   game_points=[0, 4], last_deal={"points": [0, 120], "awarded": [0, 3]}, winner_team=1)
    out.append(case("All ten tricks", "A team that wins every trick of a deal wins the match at once.",
                    "terminal", s6, "u0", "u1", {"card": "4s"}, after6, None,
                    expected_payouts={"u0": 0, "u1": 20, "u2": 0, "u3": 20}, move_count=79))
    return out


# ---------------------------------------------------------------- translations

def client_strings():
    html = (HERE / "client.html").read_text()
    start = html.index('id="i18n-strings">') + len('id="i18n-strings">')
    return json.loads(html[start:html.index("</script>", start)])


def translations():
    source = client_strings()
    out = {}
    for lang in LANGS:
        tr = texts.T[lang]
        assert set(tr["client"]) == set(source), (lang, set(source) ^ set(tr["client"]))
        assert len(tr["tutorial"]) == len(texts.TUTORIAL), lang
        out[lang] = {
            "display_name": tr["name"], "short_description": tr["description"],
            "game_logic_rules": tr["rules"], "game_ui_rules": tr["ui"],
            "tutorial_strings": {text: tr["tutorial"][i] for i, (_, text) in enumerate(texts.TUTORIAL)},
            "client_strings": tr["client"],
        }
    return out


def payload():
    return {
        "name": texts.NAME,
        "description": texts.DESCRIPTION,
        "allowed_player_counts": [4],
        "allows_leave_mid_match": False,
        "allows_join_mid_match": False,
        "language": "en",
        "client_code": (HERE / "client.html").read_text(),
        "server_code": (HERE / "server.js").read_text(),
        "rules": texts.RULES,
        "ui_instructions": texts.UI,
        "tutorial": {"text": texts.TUTORIAL_TEXT, "html": tutorial_html()},
        "images": [
            {"caption": "Cover", "svg": cover_svg()},
            {"caption": "Card order and points", "svg": ranking_svg()},
            {"caption": "Two teams", "svg": text_svg("Two teams", ["Partners sit across the table.", "1st and 3rd seats against 2nd and 4th."])},
            {"caption": "Scoring", "svg": text_svg("Scoring a deal", ["61 to 90 points: 1 game point", "91 or more points: 2 game points", "All 10 tricks: the match at once", "First team to 4 game points wins"])},
        ],
        "unit_tests": {"state_schema": STATE_SCHEMA, "view_schema": VIEW_SCHEMA, "move_schema": MOVE_SCHEMA,
                       "cases": cases()},
        "translations": translations(),
        "game_addition_request_id_and_secret": secret(),
    }


if __name__ == "__main__":
    out = Path(sys.argv[1])
    data = payload()
    out.write_text(json.dumps(data, ensure_ascii=False))
    out.chmod(0o600)
    size = len(json.dumps(data, ensure_ascii=False).encode())
    print(f"wrote {out} ({size:,} bytes)")
