"""Builds Smugglers' Tide's POST /games payload from the files in this folder.

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
SYMBOLS = "ACLSTW"
SQUARES, CAVE, BOAT = 36, -1, 36
BG, INK, ACCENT = "#0d2b3e", "#f2f7fa", "#ffd166"
COLORS = ["#e5484d", "#3b82f6", "#22a35a", "#f2c94c", "#a259ff"]

# ---------------------------------------------------------------- rules mirror (for views)


def occupants(state, square):
    return sum(list_.count(square) for list_ in state["pieces"])


def forward_target(state, frm, card):
    for q in range(frm + 1, SQUARES):
        if state["track"][q] == card and occupants(state, q) == 0:
            return q
    return BOAT


def back_target(state, frm):
    if frm <= 0 or frm >= BOAT:
        return None
    for q in range(frm - 1, -1, -1):
        if occupants(state, q) in (1, 2):
            return q
    return None


def legal_moves(state):
    if state["winner"] is not None:
        return []
    seat = state["to_move"]
    froms = sorted({p for p in state["pieces"][seat] if p != BOAT})
    moves = []
    if state["actions"] < 3:
        cards = list(dict.fromkeys(state["hands"][seat]))
        for frm in froms:
            for card in cards:
                moves.append({"kind": "forward", "from": frm, "card": card, "to": forward_target(state, frm, card)})
            back = back_target(state, frm)
            if back is not None:
                moves.append({"kind": "back", "from": frm, "to": back, "draw": occupants(state, back)})
    if state["actions"] > 0 or not moves:
        moves.append({"kind": "end"})
    return moves


def make_view(ctx):
    ids = [p["id"] for p in ctx["players"]]

    def view(state, pid):
        seat = ids.index(pid) if pid in ids else -1
        mine = seat >= 0 and seat == state["to_move"] and state["winner"] is None
        return {
            "track": state["track"], "pieces": state["pieces"],
            "hand": state["hands"][seat] if seat >= 0 else [],
            "hand_counts": [len(h) for h in state["hands"]],
            "deck_count": len(state["deck"]), "discard_count": len(state["discard"]),
            "to_move": state["to_move"], "actions": state["actions"], "winner": state["winner"],
            "last": state["last"], "my_seat": seat if seat >= 0 else None,
            "moves": legal_moves(state) if mine else [],
        }
    return view


# ---------------------------------------------------------------- pictures

GLYPH = {"A": "⚓", "C": "✣", "L": "♨", "S": "✿", "T": "★", "W": "≈"}


def view_svg(v, who):
    """A schematic picture of a view: the snake-shaped tunnel, the pieces and the viewer's hand."""
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 560">', f'<rect width="600" height="560" fill="{BG}"/>',
             f'<text x="20" y="32" font-size="22" font-weight="700" fill="{INK}">Smugglers\' Tide · {escape(who)}</text>']

    def dots(square, x, y):
        out, k = [], 0
        for seat, plist in enumerate(v["pieces"]):
            for p in plist:
                if p == square:
                    out.append(f'<circle cx="{x + 10 + (k % 6) * 12}" cy="{y + 10 + (k // 6) * 12}" r="5" fill="{COLORS[seat]}"/>')
                    k += 1
        return "".join(out)

    parts.append(f'<rect x="20" y="46" width="560" height="40" rx="8" fill="#173f57"/>{dots(CAVE, 120, 56)}'
                 f'<text x="30" y="72" font-size="16" fill="{INK}">Cave</text>')
    for i, s in enumerate(v["track"]):
        row, k = divmod(i, 6)
        col = k if row % 2 == 0 else 5 - k
        x, y = 20 + col * 94, 96 + row * 56
        parts.append(f'<rect x="{x}" y="{y}" width="86" height="48" rx="6" fill="#e9d8b4"/>'
                     f'<text x="{x + 70}" y="{y + 40}" font-size="20" text-anchor="middle" fill="#1d2a33">{GLYPH[s]}</text>{dots(i, x, y)}')
    parts.append(f'<rect x="20" y="434" width="560" height="40" rx="8" fill="#173f57"/>{dots(BOAT, 120, 444)}'
                 f'<text x="30" y="460" font-size="16" fill="{INK}">Boat</text>')
    status = (f"Winner: seat {v['winner'] + 1}" if v["winner"] is not None
              else f"To move: seat {v['to_move'] + 1}, moves made {v['actions']}")
    parts.append(f'<text x="20" y="500" font-size="17" fill="{ACCENT}">{status} · draw pile {v["deck_count"]}</text>')
    hand = " ".join(GLYPH[c] for c in v["hand"]) or "-"
    parts.append(f'<text x="20" y="535" font-size="22" fill="{INK}">Hand: {hand}</text></svg>')
    return "".join(parts)


def cover_svg():
    # 16:9 and text-free: a lantern-lit tunnel of sand squares winding from a cave to a boat.
    p = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">',
         '<defs><radialGradient id="g" cx="50%" cy="20%" r="80%"><stop offset="0" stop-color="#1d5778"/>'
         '<stop offset="1" stop-color="#081c29"/></radialGradient></defs>',
         '<rect width="1600" height="900" fill="url(#g)"/>',
         '<path d="M0 760 Q400 700 800 760 T1600 760 V900 H0Z" fill="#0b3550"/>',
         '<ellipse cx="190" cy="250" rx="170" ry="140" fill="#04121b"/>']
    for i in range(12):
        x, y = 340 + i * 90, 230 + (i % 2) * 40 + i * 32
        p.append(f'<rect x="{x}" y="{y}" width="78" height="78" rx="12" fill="#e9d8b4" stroke="#c9b88f" stroke-width="4"/>')
        p.append(f'<circle cx="{x + 39}" cy="{y + 39}" r="16" fill="{COLORS[i % 5]}"/>')
    p.append('<path d="M1340 650 h220 l-40 70 h-140z" fill="#7a4b2a"/><rect x="1445" y="520" width="8" height="130" fill="#d9c7a0"/>'
             '<path d="M1453 525 l70 90 h-70z" fill="#f2f7fa"/>')
    p.append('<circle cx="1180" cy="160" r="46" fill="#ffd166" opacity=".9"/></svg>')
    return "".join(p)


def tunnel_svg():
    track = "ACLSTWWTSLCA"
    cells = "".join(f'<rect x="{40 + i * 92}" y="200" width="84" height="84" rx="10" fill="#e9d8b4"/>'
                    f'<text x="{82 + i * 92}" y="258" font-size="40" text-anchor="middle" fill="#1d2a33">{GLYPH[s]}</text>'
                    for i, s in enumerate(track))
    names = "anchor, compass, lantern, shell, star, wave"
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">'
            f'<rect width="1200" height="675" fill="{BG}"/><text x="40" y="90" font-size="46" font-weight="700" fill="{ACCENT}">The tunnel</text>'
            f'{cells}<text x="40" y="380" font-size="32" fill="{INK}">6 sections of the same 6 symbols:</text>'
            f'<text x="40" y="430" font-size="32" fill="{INK}">{names}.</text>'
            f'<text x="40" y="500" font-size="32" fill="{INK}">Each section is shuffled at the start.</text></svg>')


# ---------------------------------------------------------------- schemas

SYM = {"enum": list(SYMBOLS)}
SQ = {"type": "integer", "minimum": CAVE, "maximum": BOAT}
SEAT = {"type": "integer", "minimum": 0, "maximum": 4}
NULL_SEAT = {"type": ["null", "integer"], "minimum": 0, "maximum": 4}
PIECES = {"type": "array", "minItems": 2, "maxItems": 5,
          "items": {"type": "array", "minItems": 6, "maxItems": 6, "items": SQ}}
LAST = {"type": "array", "maxItems": 3, "items": {
    "type": "object", "required": ["seat", "kind", "from", "to", "card"], "additionalProperties": False,
    "properties": {"seat": SEAT, "kind": {"enum": ["forward", "back"]}, "from": SQ, "to": SQ,
                   "card": {"type": ["null", "string"], "enum": [None, *SYMBOLS]}}}}
TRACK = {"type": "array", "minItems": 36, "maxItems": 36, "items": SYM}
CARDS = {"type": "array", "maxItems": 102, "items": SYM}
STATE_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
    "required": ["track", "pieces", "hands", "deck", "discard", "to_move", "actions", "winner", "last"],
    "properties": {"track": TRACK, "pieces": PIECES,
                   "hands": {"type": "array", "minItems": 2, "maxItems": 5, "items": CARDS},
                   "deck": CARDS, "discard": CARDS, "to_move": SEAT,
                   "actions": {"type": "integer", "minimum": 0, "maximum": 3}, "winner": NULL_SEAT, "last": LAST},
}
MOVE_ITEM = {"type": "object", "required": ["kind"], "properties": {
    "kind": {"enum": ["forward", "back", "end"]}, "from": SQ, "to": SQ, "card": SYM,
    "draw": {"type": "integer", "minimum": 1, "maximum": 2}}, "additionalProperties": False}
VIEW_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
    "required": ["track", "pieces", "hand", "hand_counts", "deck_count", "discard_count", "to_move", "actions",
                 "winner", "last", "my_seat", "moves"],
    "properties": {"track": TRACK, "pieces": PIECES, "hand": CARDS,
                   "hand_counts": {"type": "array", "minItems": 2, "maxItems": 5, "items": {"type": "integer", "minimum": 0}},
                   "deck_count": {"type": "integer", "minimum": 0}, "discard_count": {"type": "integer", "minimum": 0},
                   "to_move": SEAT, "actions": {"type": "integer", "minimum": 0, "maximum": 3}, "winner": NULL_SEAT,
                   "last": LAST, "my_seat": NULL_SEAT, "moves": {"type": "array", "items": MOVE_ITEM}},
}
MOVE_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "required": ["kind"],
    "additionalProperties": False,
    "properties": {"kind": {"enum": ["forward", "back", "end"]}, "from": SQ, "card": SYM},
}

# ---------------------------------------------------------------- test cases (written by hand from the rules)

PLAYERS = [{"id": f"u{i}", "kind": "human", "display_name": n, "picture_url": "", "max_loss": 10}
           for i, n in enumerate(["Ana", "Bruno", "Carla"])]
CTX2 = {"players": PLAYERS[:2], "pot": 20, "move_count": 0, "seed": 11}
CTX3 = {"players": PLAYERS, "pot": 30, "move_count": 0, "seed": 11}
# Six sections, each the six symbols in its own order.
TRACK_FIXED = list("ACLSTW" "WTSLCA" "CAWTLS" "STACWL" "LWCSAT" "TSLWAC")
assert all(sorted(TRACK_FIXED[i:i + 6]) == list(SYMBOLS) for i in range(0, 36, 6))
DECK = list("ACLSTWTSWLCA")  # the top of the draw pile (cases only draw from the top)


def st(**kw):
    base = {"track": TRACK_FIXED, "pieces": [[CAVE] * 6, [CAVE] * 6], "hands": [list("AACLST"), list("CLSTWW")],
            "deck": DECK, "discard": [], "to_move": 0, "actions": 0, "winner": None, "last": []}
    base.update(copy.deepcopy(kw))
    return base


def case(name, desc, kind, ctx, state, mover, other, move, **kw):
    return gamekit.case(name, desc, kind, {**ctx, "move_count": kw.pop("move_count", 0)}, state, mover, other, move,
                        make_view(ctx), view_svg, **kw)


def cases():
    out = []
    # 1. First move: Ana plays a lantern; the first lantern square is square 2 (index 2), empty.
    s1 = st()
    a1 = st(pieces=[[CAVE] * 5 + [2], [CAVE] * 6], hands=[list("AACST"), list("CLSTWW")], discard=["L"], actions=1,
            last=[{"seat": 0, "kind": "forward", "from": CAVE, "to": 2, "card": "L"}])
    a1["pieces"][0].sort()
    out.append(case("First move from the cave", "A lantern card moves a smuggler from the cave to the first lantern square.",
                    "initial", CTX2, s1, "u0", "u1", {"kind": "forward", "from": CAVE, "card": "L"},
                    expected_state=a1, expected_turn=["u0"]))
    # 2. Skipping occupied squares: Ana plays an anchor from the cave. The first anchor square
    # (index 0) is taken by Bruno, so she goes on to the next anchor square, index 11.
    s2 = st(pieces=[[CAVE] * 6, [CAVE] * 5 + [0]], hands=[list("AACLST"), list("CLSTW")], actions=0)
    a2 = st(pieces=[[CAVE] * 5 + [11], [CAVE] * 5 + [0]], hands=[list("ACLST"), list("CLSTW")], discard=["A"], actions=1,
            last=[{"seat": 0, "kind": "forward", "from": CAVE, "to": 11, "card": "A"}])
    out.append(case("Jumping over a taken square", "The next square with the symbol is taken, so the smuggler goes on to the following one.",
                    "intermediate", CTX2, s2, "u0", "u1", {"kind": "forward", "from": CAVE, "card": "A"},
                    expected_state=a2, expected_turn=["u0"], move_count=4))
    # 3. Moving back: behind Ana's smuggler on 20, squares 19-10 are empty and square 9 holds one
    # of Bruno's smugglers, so she moves to 9 and draws 1 card (the A on top of the pile).
    s3 = st(pieces=[[CAVE, CAVE, CAVE, CAVE, 5, 20], [CAVE, CAVE, CAVE, CAVE, 5, 9]], hands=[list("T"), list("CLSW")],
            actions=1, last=[{"seat": 0, "kind": "forward", "from": 13, "to": 20, "card": "A"}])
    a3 = st(pieces=[[CAVE, CAVE, CAVE, CAVE, 5, 9], [CAVE, CAVE, CAVE, CAVE, 5, 9]], hands=[list("AT"), list("CLSW")],
            deck=DECK[1:], actions=2,
            last=[{"seat": 0, "kind": "forward", "from": 13, "to": 20, "card": "A"},
                  {"seat": 0, "kind": "back", "from": 20, "to": 9, "card": None}])
    out.append(case("Moving back to draw", "A smuggler moves back to the closest square holding 1 or 2 smugglers and draws that many cards.",
                    "intermediate", CTX2, s3, "u0", "u1", {"kind": "back", "from": 20},
                    expected_state=a3, expected_turn=["u0"], move_count=9))
    # 4. Ending a turn with no move made is refused when a move is possible.
    out.append(case("Must move before ending", "A player who can move must make at least one move before ending the turn.",
                    "intermediate", CTX2, st(), "u0", "u1", {"kind": "end"}, error="InvalidMove", expected_turn=["u0"]))
    # 5. A pass: Bruno has no cards and his only smuggler outside the boat has nobody behind it,
    # so ending the turn is his only move; he draws 1 card (the A on top) and Carla is next.
    s6 = {"track": TRACK_FIXED, "pieces": [[30, BOAT, BOAT, BOAT, BOAT, BOAT], [3, BOAT, BOAT, BOAT, BOAT, BOAT], [3, 31, BOAT, BOAT, BOAT, BOAT]],
          "hands": [list("C"), [], list("W")], "deck": DECK, "discard": [], "to_move": 1, "actions": 0, "winner": None, "last": []}
    s6["pieces"] = [sorted(p) for p in s6["pieces"]]
    # Bruno's smuggler on 3: squares 0-2 are empty, so it cannot move back.
    a6 = copy.deepcopy(s6)
    a6.update(hands=[list("C"), list("A"), list("W")], deck=DECK[1:], to_move=2)
    out.append(case("Passing when stuck", "With no cards and no square to move back to, the player passes and draws 1 card.",
                    "intermediate", CTX3, s6, "u1", "u2", {"kind": "end"},
                    expected_state=a6, expected_turn=["u2"], move_count=301))
    # 6. Winning: Ana's last smuggler is on 34; her wave card finds no wave square ahead (35 is a
    # compass), so it boards the boat and she wins the pot.
    s7 = st(pieces=[[34, BOAT, BOAT, BOAT, BOAT, BOAT], [20, 25, BOAT, BOAT, BOAT, BOAT]], hands=[list("W"), list("SS")],
            actions=1, last=[{"seat": 0, "kind": "forward", "from": 28, "to": 34, "card": "A"}])
    a7 = st(pieces=[[BOAT] * 6, [20, 25, BOAT, BOAT, BOAT, BOAT]], hands=[[], list("SS")], discard=["W"], actions=2, winner=0,
            last=[{"seat": 0, "kind": "forward", "from": 28, "to": 34, "card": "A"},
                  {"seat": 0, "kind": "forward", "from": 34, "to": BOAT, "card": "W"}])
    out.append(case("Last smuggler boards the boat", "No free square with the symbol is ahead, so the smuggler boards the boat and its owner wins.",
                    "terminal", CTX2, s7, "u0", "u1", {"kind": "forward", "from": 34, "card": "W"},
                    expected_state=a7, expected_turn=None, expected_payouts={"u0": 20, "u1": 0}, move_count=180))
    return out


def payload():
    client = (HERE / "client.html").read_text()
    return {
        "name": texts.NAME, "description": texts.DESCRIPTION,
        "allowed_player_counts": [2, 3, 4, 5], "allows_leave_mid_match": False, "allows_join_mid_match": False,
        "language": "en", "client_code": client, "server_code": (HERE / "server.js").read_text(),
        "rules": texts.RULES, "ui_instructions": texts.UI,
        "tutorial": {"text": texts.TUTORIAL_TEXT,
                     "html": gamekit.tutorial_html(texts.TUTORIAL, TUTORIAL_FIGURE, BG, INK, ACCENT)},
        "images": [
            {"caption": "Cover", "svg": cover_svg()},
            {"caption": "The tunnel", "svg": tunnel_svg()},
            {"caption": "Moving forward", "svg": gamekit.text_svg("Moving forward", [
                "Play a card with a symbol.", "Jump to the next free square with it.", "None left ahead? Board the boat."], BG, INK, ACCENT)},
            {"caption": "Moving back", "svg": gamekit.text_svg("Moving back", [
                "Go back to the closest square", "holding 1 or 2 smugglers.", "Draw 1 or 2 cards."], BG, INK, ACCENT)},
            {"caption": "Winning", "svg": gamekit.text_svg("Winning", [
                "Up to 3 moves per turn.", "First to get all 6 smugglers", "into the boat wins."], BG, INK, ACCENT)},
        ],
        "unit_tests": {"state_schema": STATE_SCHEMA, "view_schema": VIEW_SCHEMA, "move_schema": MOVE_SCHEMA, "cases": cases()},
        "translations": gamekit.translations(texts, client),
        "game_addition_request_id_and_secret": gamekit.secret("smugglers-tide"),
    }


# A text-free figure: a smuggler hopping over a taken square to the next matching one.
TUTORIAL_FIGURE = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 110" role="presentation">'
    '<rect x="10" y="40" width="60" height="60" rx="8" fill="#e9d8b4"/><rect x="90" y="40" width="60" height="60" rx="8" fill="#e9d8b4"/>'
    '<rect x="170" y="40" width="60" height="60" rx="8" fill="#e9d8b4"/><rect x="250" y="40" width="60" height="60" rx="8" fill="#e9d8b4"/>'
    '<circle cx="40" cy="70" r="14" fill="#e5484d"/><circle cx="120" cy="70" r="14" fill="#3b82f6"/>'
    '<path d="M40 40 Q160 -10 280 40" fill="none" stroke="#ffd166" stroke-width="4" stroke-dasharray="8 6"/>'
    '<circle cx="280" cy="70" r="14" fill="none" stroke="#e5484d" stroke-width="4"/></svg>'
)

if __name__ == "__main__":
    gamekit.write_payload(sys.argv[1], payload())
