"""Builds Buraco's POST /games payload from the files in this folder.

    python3 build.py OUT.json

The secret (game_addition_request_id_and_secret) comes from ~/.config/buildplay-games/secrets.json
(see gamekit.py) and never goes in the repo, so write OUT.json outside the repo.
"""

import copy
import sys
from html import escape
from pathlib import Path

import gamekit
import texts

HERE = Path(__file__).parent
BG, INK, ACCENT = "#1e5b3f", "#f5f1e6", "#f2c94c"
RANKS, SUITS, JOKER = "A23456789TJQK", "cdhs", "JK"

# ---------------------------------------------------------------- rules mirror (for views and cases)


def split(s):
    return [s[i:i + 2] for i in range(0, len(s), 2)]


def value(c):
    if c == JOKER:
        return 30
    r = c[0]
    return 20 if r == "2" else 15 if r == "A" else 5 if r in "34567" else 10


def sort_key(c):
    if c == JOKER:
        return 999
    return SUITS.index(c[1]) * 20 + (14 if c[0] == "A" else RANKS.index(c[0]) + 1)


def srt(cards):
    return "".join(sorted(cards, key=sort_key))


def is_wild(c):
    return c == JOKER or c[0] == "2"


def analyze(cards):
    """{kind, clean} for a valid meld, else None (the meld rules in RULES)."""
    if len(cards) < 3:
        return None
    naturals = [c for c in cards if not is_wild(c)]
    wild = len(cards) - len(naturals)
    if naturals and all(c[0] == naturals[0][0] for c in naturals) and naturals[0][0] in "JQKA" and wild <= 1:
        return {"kind": "group", "clean": wild == 0}
    if len(cards) > 14 or not naturals:
        return None
    suit = naturals[0][1]
    if any(c[1] != suit for c in naturals):
        return None
    jokers = cards.count(JOKER)
    deuces = [c for c in cards if c != JOKER and c[0] == "2"]
    own = sum(1 for c in deuces if c[1] == suit)
    best = None
    for nat2 in range(min(1, own), -1, -1):
        wilds = jokers + len(deuces) - nat2
        if wilds > 1:
            continue
        aces = sum(1 for c in naturals if c[0] == "A")
        others = [RANKS.index(c[0]) + 1 for c in naturals if c[0] != "A"] + ([2] if nat2 else [])
        if aces > 2 or len(set(others)) != len(others):
            continue
        for ace_pos in ([[1, 14]] if aces == 2 else [[1], [14]] if aces == 1 else [[]]):
            pos = sorted(others + ace_pos)
            gaps = pos[-1] - pos[0] + 1 - len(pos)
            if gaps > wilds or (gaps == 0 and wilds == 1 and pos[0] == 1 and pos[-1] == 14):
                continue
            if best is None or (wilds == 0 and not best["clean"]):
                best = {"kind": "run", "clean": wilds == 0}
    return best


def has_clean(melds):
    return any(len(split(m["cards"])) >= 7 and analyze(split(m["cards"]))["clean"] for m in melds)


def may_empty(state, seat):
    team = seat % 2
    if not state["took_pot"][team]:
        return len(state["pots"]) > 0
    return has_clean(state["melds"][team])


def make_view(ctx):
    ids = [p["id"] for p in ctx["players"]]

    def view(state, pid):
        seat = ids.index(pid) if pid in ids else -1
        mine = seat >= 0 and seat == state["to_move"] and state["phase"] != "over"
        hand = split(state["hands"][seat]) if seat >= 0 else []
        melds = []
        for team_melds in state["melds"]:
            out = []
            for m in team_melds:
                cards = split(m["cards"])
                out.append({"cards": m["cards"], "kind": m["kind"], "size": len(cards),
                            "clean": analyze(cards)["clean"], "canasta": len(cards) >= 7})
            melds.append(out)
        return {
            "deal_no": state["deal_no"], "max_deals": 3, "target": 2000, "dealer": state["dealer"],
            "to_move": state["to_move"], "phase": state["phase"],
            "hand": state["hands"][seat] if seat >= 0 else "",
            "hand_counts": [len(h) // 2 for h in state["hands"]],
            "melds": melds, "discard": state["discard"], "stock_count": len(state["stock"]) // 2,
            "pots_left": len(state["pots"]), "took_pot": state["took_pot"], "opened": state["opened"],
            "scores": state["scores"], "minimum": [75 if s >= 1500 else 50 for s in state["scores"]],
            "may_go_out": may_empty(state, seat) if seat >= 0 else False,
            "drew": state["drew"], "last_deal": state["last_deal"], "winners": state["winners"],
            "my_seat": seat if seat >= 0 else None, "my_turn": mine, "hand_value": sum(value(c) for c in hand),
        }
    return view


# ---------------------------------------------------------------- pictures

SYM = {"c": "♣", "d": "♦", "h": "♥", "s": "♠"}


def card_svg(x, y, c, w=34, h=48):
    red = c != JOKER and c[1] in "hd"
    label = "★" if c == JOKER else ("10" if c[0] == "T" else c[0])
    sym = "" if c == JOKER else SYM[c[1]]
    color = "#c0392b" if red else "#1d1d1d"
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="#fffdf7" stroke="#c9c2b0"/>'
            f'<text x="{x + w / 2}" y="{y + h * .45}" font-size="{h * .32:.0f}" text-anchor="middle" fill="{color}" font-weight="700">{label}</text>'
            f'<text x="{x + w / 2}" y="{y + h * .85}" font-size="{h * .32:.0f}" text-anchor="middle" fill="{color}">{sym}</text>')


def view_svg(v, who):
    p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420">', f'<rect width="640" height="420" fill="{BG}"/>',
         f'<text x="14" y="26" font-size="18" font-weight="700" fill="{INK}">Buraco · {escape(who)} · deal {v["deal_no"]} · '
         f'{v["scores"][0]}–{v["scores"][1]}</text>']
    y = 40
    for team in (0, 1):
        p.append(f'<text x="14" y="{y + 16}" font-size="13" fill="{ACCENT}">Team {team + 1}</text>')
        x = 80
        for m in v["melds"][team]:
            for c in split(m["cards"]):
                p.append(card_svg(x, y, c, 22, 32))
                x += 16
            x += 18
        y += 44
    discards = split(v["discard"])
    p.append(f'<text x="14" y="{y + 20}" font-size="13" fill="{INK}">Stock {v["stock_count"]} · pots {v["pots_left"]} · discard</text>')
    for i, c in enumerate(discards[-12:]):
        p.append(card_svg(230 + i * 20, y + 2, c, 22, 32))
    y += 50
    status = (f"Winners: team {', '.join(str(t + 1) for t in v['winners'])}" if v["winners"] is not None
              else f"To move: seat {v['to_move'] + 1} ({v['phase']})")
    p.append(f'<text x="14" y="{y + 10}" font-size="14" fill="{ACCENT}">{status}</text>')
    for i, c in enumerate(split(v["hand"])):
        p.append(card_svg(14 + (i % 17) * 36, y + 24 + (i // 17) * 54, c))
    p.append("</svg>")
    return "".join(p)


def cover_svg():
    # 16:9 and text-free: a fan of cards with suit shapes, and two face-down pots.
    def suit_shape(kind, cx, cy, color):
        if kind == "diamond":
            return f'<polygon points="{cx},{cy - 50} {cx + 36},{cy} {cx},{cy + 50} {cx - 36},{cy}" fill="{color}"/>'
        if kind == "heart":
            return (f'<path d="M{cx} {cy + 45} C{cx - 70} {cy} {cx - 45} {cy - 52} {cx} {cy - 22} '
                    f'C{cx + 45} {cy - 52} {cx + 70} {cy} {cx} {cy + 45}Z" fill="{color}"/>')
        if kind == "club":
            return (f'<circle cx="{cx}" cy="{cy - 22}" r="22" fill="{color}"/><circle cx="{cx - 24}" cy="{cy + 10}" r="22" fill="{color}"/>'
                    f'<circle cx="{cx + 24}" cy="{cy + 10}" r="22" fill="{color}"/><rect x="{cx - 6}" y="{cy}" width="12" height="44" fill="{color}"/>')
        if kind == "spade":
            return (f'<path d="M{cx} {cy - 50} C{cx + 66} {cy - 8} {cx + 38} {cy + 38} {cx} {cy + 14} '
                    f'C{cx - 38} {cy + 38} {cx - 66} {cy - 8} {cx} {cy - 50}Z" fill="{color}"/><rect x="{cx - 6}" y="{cy + 8}" width="12" height="40" fill="{color}"/>')
        return f'<polygon points="{cx},{cy - 46} {cx + 13},{cy - 14} {cx + 46},{cy - 14} {cx + 19},{cy + 8} {cx + 29},{cy + 42} {cx},{cy + 22} {cx - 29},{cy + 42} {cx - 19},{cy + 8} {cx - 46},{cy - 14} {cx - 13},{cy - 14}" fill="{color}"/>'
    kinds = [("club", "#1d1d1d"), ("diamond", "#c0392b"), ("star", "#d4a017"), ("heart", "#c0392b"), ("spade", "#1d1d1d")]
    p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">',
         '<defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#23704d"/><stop offset="1" stop-color="#0f3524"/></radialGradient></defs>',
         '<rect width="1600" height="900" fill="url(#g)"/>']
    for i, (kind, color) in enumerate(kinds):
        p.append(f'<g transform="rotate({-28 + i * 14} 800 900)"><rect x="710" y="210" width="180" height="260" rx="18" fill="#fffdf7" stroke="#c9c2b0" stroke-width="4"/>'
                 + suit_shape(kind, 800, 340, color) + "</g>")
    p.append('<rect x="120" y="640" width="160" height="230" rx="16" fill="#942634" stroke="#fffdf7" stroke-width="6"/>'
             '<rect x="1320" y="640" width="160" height="230" rx="16" fill="#942634" stroke="#fffdf7" stroke-width="6"/></svg>')
    return "".join(p)


def values_svg():
    rows = [("3 – 7", "5"), ("8 – K", "10"), ("A", "15"), ("2", "20"), ("Joker", "30")]
    body = "".join(f'<text x="80" y="{170 + i * 60}" font-size="34" fill="{INK}">{a}</text>'
                   f'<text x="380" y="{170 + i * 60}" font-size="34" fill="{ACCENT}">{b}</text>' for i, (a, b) in enumerate(rows))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">'
            f'<rect width="1200" height="675" fill="{BG}"/><text x="40" y="90" font-size="46" font-weight="700" fill="{ACCENT}">Card values</text>{body}'
            f'<text x="640" y="170" font-size="30" fill="{INK}">Clean canasta (7+): 200</text>'
            f'<text x="640" y="230" font-size="30" fill="{INK}">Dirty canasta (7+): 100</text>'
            f'<text x="640" y="290" font-size="30" fill="{INK}">Going out: 100</text>'
            f'<text x="640" y="350" font-size="30" fill="{INK}">No pot taken: −100</text></svg>')


# ---------------------------------------------------------------- schemas (strings keep them cheap)

CARDS = {"type": "string", "maxLength": 216}
INT = {"type": "integer"}
PAIR_INT = {"type": "array", "minItems": 2, "maxItems": 2}
MELDS = {"type": "array", "minItems": 2, "maxItems": 2, "items": {"type": "array"}}
COMMON = {"deal_no": {"type": "integer", "minimum": 1, "maximum": 3}, "dealer": {"type": "integer", "minimum": 0, "maximum": 3},
          "to_move": {"type": "integer", "minimum": 0, "maximum": 3}, "phase": {"enum": ["draw", "play", "over"]},
          "discard": CARDS, "took_pot": PAIR_INT, "opened": PAIR_INT, "scores": PAIR_INT, "melds": MELDS,
          "drew": {"enum": [None, "stock", "discard"]},
          "last_deal": {"type": ["null", "object"], "required": ["deal", "points", "went_out"]},
          "winners": {"type": ["null", "array"]}}
# Kept shallow on purpose: the platform checks the state on every call and each view after every
# move, and with four players a fully detailed schema made random play too slow for its 8-second test.
STATE_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object",
                "required": [*COMMON, "hands", "pots", "stock"],
                "properties": {"phase": COMMON["phase"], "to_move": COMMON["to_move"],
                               "hands": {"type": "array", "minItems": 4, "maxItems": 4}}}
VIEW_KEYS = ["max_deals", "target", "hand", "hand_counts", "stock_count", "pots_left", "minimum", "may_go_out", "my_seat", "my_turn", "hand_value"]
VIEW_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object",
               "required": [*COMMON, *VIEW_KEYS],
               "properties": {"phase": COMMON["phase"], "hand": CARDS, "my_seat": {"type": ["null", "integer"]}}}
CARD = {"type": "string", "pattern": "^([A2-9TJQK][cdhs]|JK)$"}
MOVE_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "minProperties": 1, "maxProperties": 1,
               "additionalProperties": False,
               "properties": {"draw": {"enum": ["stock", "discard"]}, "discard": CARD,
                              "lay": {"type": "object", "additionalProperties": False,
                                      "properties": {"new": {"type": "array", "items": {"type": "array", "items": CARD}},
                                                     "add": {"type": "array", "items": {"type": "array", "minItems": 2, "maxItems": 2}}}}}}

# ---------------------------------------------------------------- test cases (written by hand from the rules)

PLAYERS = [{"id": f"u{i}", "kind": "human", "display_name": n, "picture_url": "", "max_loss": 10}
           for i, n in enumerate(["Ana", "Bruno", "Carla", "Duda"])]
CTX = {"players": PLAYERS, "pot": 40, "move_count": 0, "seed": 5}
VIEW = make_view(CTX)


def base(**kw):
    s = {"deal_no": 1, "scores": [0, 0], "last_deal": None, "winners": None, "dealer": 3, "to_move": 0, "phase": "draw",
         "hands": [srt(split("3c4c5cKhKdKs9h9dTs2cJK")), srt(split("4d5d6d7d8d9dTdJdQdKdAd")),
                   srt(split("2h3h4h5h6h7h8h9hThJhQh")), srt(split("2s3s4s5s6s7s8s9sTsJsQs"))],
         "pots": [srt(split("AcAcAdAdAhAhAsAs7h7h7c")), srt(split("8c8c8d8d8h8h8s8s9c9c9s"))],
         "stock": "5h6hJcQd", "discard": "7s", "melds": [[], []], "took_pot": [False, False], "opened": [False, False], "drew": None}
    s.update(copy.deepcopy(kw))
    return s


def case(name, desc, kind, state, mover, other, move, **kw):
    return gamekit.case(name, desc, kind, {**CTX, "move_count": kw.pop("move_count", 0)}, state, mover, other, move, VIEW, view_svg, **kw)


def cases():
    out = []
    s1 = base()
    # 1. Ana draws the top stock card (5h); she now lays melds or discards.
    a1 = base(hands=[srt(split(s1["hands"][0]) + ["5h"]), *s1["hands"][1:]], stock="6hJcQd", phase="play", drew="stock")
    out.append(case("Drawing from the stock", "The first player takes the top stock card and goes on to meld or discard.",
                    "initial", s1, "u0", "u1", {"draw": "stock"}, expected_state=a1, expected_turn=["u0"]))
    # 2. Opening: Ana lays three kings (10 + 10 + 10 = 30) and 3-4-5 of clubs with the joker as a
    # fourth card (5 + 5 + 5 + 30 = 45): 75 points, at least the 50 needed, so her team is open.
    s2 = a1
    hand2 = split(s2["hands"][0])
    new = [["Kd", "Kh", "Ks"], ["3c", "4c", "5c", "JK"]]
    rest = list(hand2)
    for c in new[0] + new[1]:
        rest.remove(c)
    a2 = copy.deepcopy(s2)
    a2["hands"][0] = srt(rest)
    a2["melds"][0] = [{"cards": srt(new[0]), "kind": "group"}, {"cards": srt(new[1]), "kind": "run"}]
    a2["opened"] = [True, False]
    out.append(case("Opening melds", "A group of kings and a run with the joker, worth 75 together, open the team's melds.",
                    "intermediate", s2, "u0", "u1", {"lay": {"new": new}}, expected_state=a2, expected_turn=["u0"], move_count=1))
    # 3. Opening below the minimum: the three kings alone are worth only 30, less than 50.
    out.append(case("Opening below the minimum", "A team's first melds worth less than 50 points are refused.",
                    "intermediate", s2, "u0", "u1", {"lay": {"new": [new[0]]}}, error="InvalidMove", expected_turn=["u0"], move_count=1))
    # 4. Ana discards the 9 of diamonds: it goes on the discard pile and Bruno draws next.
    a4 = copy.deepcopy(a2)
    h4 = split(a4["hands"][0])
    h4.remove("9d")
    a4.update(discard="7s9d", to_move=1, phase="draw", drew=None)
    a4["hands"][0] = srt(h4)
    out.append(case("Discarding ends the turn", "The discarded card tops the pile and the next player draws.",
                    "intermediate", a2, "u0", "u1", {"discard": "9d"}, expected_state=a4, expected_turn=["u1"], move_count=2))
    # 5. Bruno has one card left and discards it: his team takes the first pot, which becomes his
    # hand for his next turn, and Carla plays.
    s5 = base(to_move=1, phase="play", drew="stock", hands=["3c4c5c", "6s", base()["hands"][2], base()["hands"][3]],
              opened=[True, True])
    a5 = copy.deepcopy(s5)
    a5.update(discard="7s6s", to_move=2, phase="draw", drew=None, pots=[s5["pots"][1]], took_pot=[False, True])
    a5["hands"][1] = srt(split(s5["pots"][0]))
    out.append(case("Taking the pot", "A player who empties the hand for the first time takes the team's pot.",
                    "intermediate", s5, "u1", "u2", {"discard": "6s"}, expected_state=a5, expected_turn=["u2"], move_count=40))
    # 6. Going out in the last deal: Ana's team has its pot and a clean run of 7 hearts (2h-8h). Ana
    # adds her last two cards, 9h and Th (a clean run of 9), emptying her hand: the deal ends. Team 1 (Ana, Carla): melds 2h(20)+3h..7h(5x5=25)+8h,9h,Th(30) = 75, clean canasta 200,
    # going out 100, Carla's hand Jc+Qc = 20 -> 75 + 200 + 100 - 20 = 355. Team 2 (Bruno, Duda): group
    # A-A-A (45), no canasta, hands Kc (10) and 4d (5), never took a pot (-100): 45 - 15 - 100 = -70.
    # Totals: 1800 + 355 = 2155 and 1700 - 70 = 1630; team 1 passes 2000 and wins the pot (40),
    # shared by Ana and Carla.
    s6 = base(deal_no=3, dealer=2, scores=[1800, 1700], to_move=0, phase="play", drew="stock",
              hands=["9hTh", "Kc", "JcQc", "4d"], pots=[], stock="5h6hJcQd", discard="7s",
              melds=[[{"cards": "2h3h4h5h6h7h8h", "kind": "run"}], [{"cards": "AcAdAs", "kind": "group"}]],
              took_pot=[True, False], opened=[True, True])
    a6 = copy.deepcopy(s6)
    a6["hands"][0] = ""
    a6["melds"][0] = [{"cards": "2h3h4h5h6h7h8h9hTh", "kind": "run"}]
    a6.update(scores=[2155, 1630], phase="over", winners=[0], last_deal={"deal": 3, "points": [355, -70], "went_out": 0})
    out.append(case("Going out wins the match", "With its pot and a clean canasta, a team goes out; after the third deal the higher total wins.",
                    "terminal", s6, "u0", "u1", {"lay": {"add": [[0, ["9h", "Th"]]]}}, expected_state=a6, expected_turn=None,
                    expected_payouts={"u0": 20, "u1": 0, "u2": 20, "u3": 0}, move_count=420))
    return out


def payload():
    client = (HERE / "client.html").read_text()
    return {
        "name": texts.NAME, "description": texts.DESCRIPTION,
        "allowed_player_counts": [4], "allows_leave_mid_match": False, "allows_join_mid_match": False,
        "language": "en", "client_code": client, "server_code": (HERE / "server.js").read_text(),
        "rules": texts.RULES, "ui_instructions": texts.UI,
        "tutorial": {"text": texts.TUTORIAL_TEXT, "html": gamekit.tutorial_html(texts.TUTORIAL, TUTORIAL_FIGURE, BG, INK, ACCENT)},
        "images": [
            {"caption": "Cover", "svg": cover_svg()},
            {"caption": "Card values", "svg": values_svg()},
            {"caption": "Melds", "svg": gamekit.text_svg("Melds", [
                "Sequence: 3+ cards of one suit in order.", "Group: 3+ jacks, queens, kings or aces.",
                "At most one wild (deuce or joker) per meld."], BG, INK, ACCENT)},
            {"caption": "The pot", "svg": gamekit.text_svg("The pot", [
                "Empty your hand once: take your pot.", "With a clean canasta of 7,", "empty it again to go out."], BG, INK, ACCENT)},
        ],
        "unit_tests": {"state_schema": STATE_SCHEMA, "view_schema": VIEW_SCHEMA, "move_schema": MOVE_SCHEMA, "cases": cases()},
        "translations": gamekit.translations(texts, client),
        "game_addition_request_id_and_secret": gamekit.secret("buraco"),
    }


# A text-free figure: a clean run of seven hearts and a pot.
TUTORIAL_FIGURE = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 110" role="presentation"><rect width="320" height="110" fill="#1e5b3f"/>'
    + "".join(f'<rect x="{10 + i * 26}" y="20" width="30" height="44" rx="4" fill="#fffdf7" stroke="#c9c2b0"/>'
              f'<path d="M{25 + i * 26} 52 l-8 -9 a4.5 4.5 0 0 1 8 -5 a4.5 4.5 0 0 1 8 5z" fill="#c0392b"/>' for i in range(7))
    + '<rect x="230" y="20" width="34" height="48" rx="4" fill="#942634" stroke="#fffdf7"/><rect x="236" y="26" width="34" height="48" rx="4" fill="#942634" stroke="#fffdf7"/></svg>'
)

if __name__ == "__main__":
    gamekit.write_payload(sys.argv[1], payload())
