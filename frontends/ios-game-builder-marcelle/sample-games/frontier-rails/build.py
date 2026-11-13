"""Builds Frontier Rails' POST /games payload from the files in this folder.

    python3 build.py OUT.json

The secret (game_addition_request_id_and_secret) comes from ~/.config/buildplay-games/secrets.json
(see gamekit.py) and never goes in the repo, so write OUT.json outside the repo.
"""

import copy
import heapq
import sys
from html import escape
from pathlib import Path

import gamekit
import texts

HERE = Path(__file__).parent
BG, INK, ACCENT = "#f3ead7", "#2b2118", "#2f7d4f"

# ---------------------------------------------------------------- the map (same as server.js)

ROWS = [
    "  ....^^....   ",
    " .....^^.~.... ",
    "......^^..~....",
    "......^...~....",
    ".....^^...~....",
    ".....^^..~.....",
    "......^..~.....",
    " .....^..~.... ",
    " ....^^...~... ",
    "  ...^....~..  ",
    "   ......~.    ",
]
REGIONS = "YROBG"
REGION_COLOR = {"Y": "#f2c94c", "R": "#e5574f", "O": "#f08a24", "B": "#4a90d9", "G": "#3fae5b"}
CITY_SPOTS = [
    [(0, 2, 1), (0, 4, 0), (1, 1, 0), (2, 0, 1), (2, 3, 0), (3, 5, 0), (4, 1, 0)],
    [(6, 0, 1), (6, 3, 0), (7, 1, 1), (8, 3, 0), (9, 2, 0), (10, 4, 0), (7, 5, 0)],
    [(1, 8, 1), (3, 8, 0), (4, 7, 0), (5, 8, 0), (7, 8, 0), (9, 7, 0), (10, 6, 1)],
    [(0, 9, 0), (0, 11, 0), (1, 13, 1), (2, 12, 0), (3, 14, 1), (4, 11, 0), (4, 13, 0)],
    [(5, 12, 0), (6, 14, 1), (7, 11, 0), (8, 13, 1), (9, 11, 0), (10, 10, 0), (6, 10, 0)],
]
COLS = 15
SEAT_COLORS = ["#1f3a93", "#b8322a", "#2f7d4f", "#7b3fa0", "#111111", "#c76b00"]


def is_node(r, c):
    return 0 <= r < len(ROWS) and 0 <= c < COLS and ROWS[r][c] != " "


def rough(r, c):
    return ROWS[r][c] in "^~"


EDGES = []
for r in range(len(ROWS)):
    for c in range(COLS):
        if not is_node(r, c):
            continue
        below = [(r + 1, c - 1), (r + 1, c)] if r % 2 == 0 else [(r + 1, c), (r + 1, c + 1)]
        for r2, c2 in [(r, c + 1), *below]:
            if is_node(r2, c2):
                EDGES.append((r * COLS + c, r2 * COLS + c2, 2 if rough(r, c) or rough(r2, c2) else 1))
ADJ = {}
for i, (a, b, _) in enumerate(EDGES):
    ADJ.setdefault(a, []).append((b, i))
    ADJ.setdefault(b, []).append((a, i))
CITY_NODE = [r * COLS + c for spots in CITY_SPOTS for r, c, _ in spots]
NODES = sorted(ADJ)


# ---------------------------------------------------------------- rules mirror (for views and cases)

def network(state, seat):
    start = state["starts"][seat]
    if start is None:
        return set()
    built = {e for e, _ in state["track"]}
    seen, stack = {start}, [start]
    while stack:
        v = stack.pop()
        for w, i in ADJ[v]:
            if i in built and w not in seen:
                seen.add(w)
                stack.append(w)
    return seen


def costs_from(state, sources):
    built = {e for e, _ in state["track"]}
    dist = {s: 0 for s in sources}
    heap = [(0, s) for s in sources]
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist[v]:
            continue
        for w, i in ADJ[v]:
            nd = d + (0 if i in built else EDGES[i][2])
            if nd < dist.get(w, 1e9):
                dist[w] = nd
                heapq.heappush(heap, (nd, w))
    return dist


def missing_cost(state, seat):
    """The rule from RULES: join the nearest missing city, then the next nearest from there."""
    if state["starts"][seat] is None:
        return 0
    built = {e for e, _ in state["track"]}
    reached = set(network(state, seat))
    missing = [CITY_NODE[c] for c in state["cities"][seat] if CITY_NODE[c] not in reached]
    total = 0
    while missing:
        dist = costs_from(state, reached)
        best = min(missing, key=lambda v: dist[v])
        total += dist[best]
        v = best
        while v not in reached:
            reached.add(v)
            step = None
            for w, i in ADJ[v]:
                cost = 0 if i in built else EDGES[i][2]
                if w in dist and dist[w] + cost == dist[v] and (step is None or w in reached):
                    step = w
            if step is None:
                break
            v = step
        missing.remove(best)
    return total


def legal_edges(state, seat):
    if state["phase"] != "build" or seat != state["to_move"] or len(state["track"]) >= 84:
        return []
    built = {e for e, _ in state["track"]}
    out = set()
    for v in network(state, seat):
        for _, i in ADJ[v]:
            if i not in built and EDGES[i][2] <= state["points_left"]:
                out.add(i)
    return sorted(out)


def make_view(ctx):
    ids = [p["id"] for p in ctx["players"]]

    def view(state, pid):
        seat = ids.index(pid) if pid in ids else -1
        mine = seat >= 0 and seat == state["to_move"] and state["phase"] != "over"
        net = network(state, seat) if seat >= 0 else set()
        return {
            "phase": state["phase"], "round": state["round"], "scores": state["scores"], "threshold": state["threshold"],
            "leader": state["leader"], "to_move": state["to_move"], "points_left": state["points_left"], "built": state["built"],
            "starts": state["starts"], "track": state["track"], "track_left": 84 - len(state["track"]),
            "my_cities": state["cities"][seat] if seat >= 0 else [],
            "connected": [c for c in state["cities"][seat] if CITY_NODE[c] in net] if seat >= 0 else [],
            "legal": legal_edges(state, seat) if mine else [],
            "last_round": state["last_round"], "winners": state["winners"], "my_seat": seat if seat >= 0 else None,
        }
    return view


# ---------------------------------------------------------------- pictures

def pos(node):
    r, c = divmod(node, COLS)
    return round(30 + (c + (r % 2) * 0.5) * 40), round(30 + r * 34.6)


def map_svg(track=(), starts=(), mine=(), grid=True):
    """The map as compact SVG (one path per layer), without the outer <svg> element."""
    mountains, rivers, dots, lines = [], [], [], []
    for node in NODES:
        x, y = pos(node)
        ch = ROWS[node // COLS][node % COLS]
        if ch == "^":
            mountains.append(f"M{x - 13} {y + 9}l13-21 13 21z")
        elif ch == "~":
            rivers.append(f"M{x - 13} {y}a13 13 0 1 0 26 0a13 13 0 1 0-26 0")
        dots.append(f"M{x} {y}h0")
    owner = dict(track)
    by_seat = {}
    for i, (a, b, cost) in enumerate(EDGES):
        (x1, y1), (x2, y2) = pos(a), pos(b)
        if i in owner:
            by_seat.setdefault(owner[i], []).append(f"M{x1} {y1}L{x2} {y2}")
        elif grid:
            lines.append(f"M{x1} {y1}L{x2} {y2}")
    p = ['<rect width="640" height="410" fill="#e9dcc0"/>',
         f'<path d="{"".join(mountains)}" fill="#a58a6a"/>', f'<path d="{"".join(rivers)}" fill="#8cc3e8"/>']
    if lines:
        p.append(f'<path d="{"".join(lines)}" stroke="#cdbb98" stroke-width="1"/>')
    for seat, segs in by_seat.items():
        p.append(f'<path d="{"".join(segs)}" stroke="{SEAT_COLORS[seat]}" stroke-width="5" stroke-linecap="round"/>')
    p.append(f'<path d="{"".join(dots)}" stroke="#6f6253" stroke-width="4.4" stroke-linecap="round"/>')
    for cid, node in enumerate(CITY_NODE):
        x, y = pos(node)
        ring = cid in mine
        p.append(f'<circle cx="{x}" cy="{y}" r="{12 if ring else 10}" fill="{REGION_COLOR[REGIONS[cid // 7]]}"'
                 + (' stroke="#2b2118" stroke-width="3"' if ring else "") + "/>")
    for seat, node in enumerate(starts):
        if node is not None:
            x, y = pos(node)
            p.append(f'<rect x="{x - 6}" y="{y - 6}" width="12" height="12" fill="{SEAT_COLORS[seat]}" stroke="#fff" stroke-width="2"/>')
    return "".join(p)


def view_svg(v, who):
    city = lambda c: f"{'Yellow Red Orange Blue Green'.split()[c // 7]} {c % 7 + 1}"
    lines = [f"Frontier Rails · {who}", f"Round {v['round']} · {v['phase']} · points {', '.join(map(str, v['scores']))}",
             "Cities: " + (", ".join(city(c) for c in v["my_cities"]) or "-")]
    if v["winners"] is not None:
        lines.append("Winners: seats " + ", ".join(str(s + 1) for s in v["winners"]))
    else:
        lines.append(f"To move: seat {v['to_move'] + 1}, points left {v['points_left']}")
    text = "".join(f'<text x="12" y="{430 + i * 22}" font-size="17" fill="{INK}">{escape(t)}</text>' for i, t in enumerate(lines))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 520">' f'<rect width="640" height="520" fill="{BG}"/>'
            + map_svg(v["track"], v["starts"], v["my_cities"], grid=False) + text + "</svg>")


def cover_svg():
    # 16:9 and text-free: the map with three colored rail networks.
    track = []
    for seat, (a, b) in enumerate([(CITY_NODE[1], CITY_NODE[16]), (CITY_NODE[8], CITY_NODE[33]), (CITY_NODE[21], CITY_NODE[30])]):
        dist = costs_from({"track": []}, [a])
        v = b
        while v != a:
            for w, i in ADJ[v]:
                if dist.get(w, 1e9) + EDGES[i][2] == dist[v]:
                    track.append((i, seat))
                    v = w
                    break
    inner = map_svg(track, [CITY_NODE[1], CITY_NODE[8], CITY_NODE[21]])
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#3b2a1c"/>'
            f'<g transform="translate(160 40) scale(2)">{inner}</g></svg>')


def cost_svg():
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675">'
            f'<rect width="1200" height="675" fill="{BG}"/><text x="40" y="90" font-size="46" font-weight="700" fill="{ACCENT}">Track costs</text>'
            '<line x1="80" y1="220" x2="300" y2="220" stroke="#1f3a93" stroke-width="10"/><text x="340" y="232" font-size="34" fill="#2b2118">Plains: 1 point</text>'
            '<path d="M150 380 L190 320 L230 380Z" fill="#a58a6a"/><line x1="80" y1="400" x2="300" y2="400" stroke="#1f3a93" stroke-width="10"/>'
            '<text x="340" y="412" font-size="34" fill="#2b2118">Mountains: 2 points</text>'
            '<circle cx="190" cy="540" r="30" fill="#8cc3e8"/><line x1="80" y1="540" x2="300" y2="540" stroke="#1f3a93" stroke-width="10"/>'
            '<text x="340" y="552" font-size="34" fill="#2b2118">Rivers: 2 points</text></svg>')


# ---------------------------------------------------------------- schemas

INT = {"type": "integer"}
SEAT = {"type": "integer", "minimum": 0, "maximum": 5}
NODE = {"type": "integer", "minimum": 0, "maximum": len(ROWS) * COLS - 1}
HAND = {"type": "array", "minItems": 5, "maxItems": 5}  # 5 city ids (0-34); shallow, see TRACK
# [edge id, builder seat] pairs. Kept shallow on purpose: the platform validates the state and every
# view after each move, and per-item checks on up to 84 pairs make random play too slow.
TRACK = {"type": "array", "maxItems": 84}
STARTS = {"type": "array", "minItems": 2, "maxItems": 6}  # a junction or null per seat
SCORES = {"type": "array", "minItems": 2, "maxItems": 6}
LAST = {"type": ["null", "object"], "required": ["round", "cities", "starts", "lost", "scores"], "additionalProperties": False,
        "properties": {"round": INT, "cities": {"type": "array"}, "starts": STARTS, "lost": SCORES, "scores": SCORES}}
WINNERS = {"type": ["null", "array"], "items": SEAT}
COMMON = {"phase": {"enum": ["start", "build", "over"]}, "round": {"type": "integer", "minimum": 1}, "scores": SCORES,
          "threshold": INT, "leader": SEAT, "to_move": SEAT, "points_left": {"type": "integer", "minimum": 0, "maximum": 2},
          "built": {"type": "integer", "minimum": 0}, "starts": STARTS, "track": TRACK, "last_round": LAST, "winners": WINNERS}
STATE_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
                "required": [*COMMON, "cities"],
                "properties": {**COMMON, "cities": {"type": "array", "minItems": 2, "maxItems": 6}}}
VIEW_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "additionalProperties": False,
               "required": [*COMMON, "track_left", "my_cities", "connected", "legal", "my_seat"],
               "properties": {**COMMON, "track_left": {"type": "integer", "minimum": 0, "maximum": 84},
                              "my_cities": {"type": "array", "maxItems": 5},
                              "connected": {"type": "array", "maxItems": 5},
                              "legal": {"type": "array"}, "my_seat": {"type": ["null", "integer"], "minimum": 0}}}
MOVE_SCHEMA = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object", "minProperties": 1, "maxProperties": 1,
               "additionalProperties": False,
               "properties": {"start": NODE, "edge": {"type": "integer", "minimum": 0, "maximum": len(EDGES) - 1}, "end": {"const": True}}}

# ---------------------------------------------------------------- test cases (written by hand from the rules)

PLAYERS = [{"id": f"u{i}", "kind": "human", "display_name": n, "picture_url": "", "max_loss": 10}
           for i, n in enumerate(["Ana", "Bruno"])]
CTX = {"players": PLAYERS, "pot": 20, "move_count": 0, "seed": 3}
# Ana: Yellow 2, Red 2, Orange 3, Blue 1, Green 7. Bruno: Yellow 5, Red 4, Orange 4, Blue 6, Green 1.
CITIES = [[1, 8, 16, 21, 34], [4, 10, 17, 26, 28]]
N = lambda r, c: r * COLS + c


def edge(a, b):
    return next(i for w, i in ADJ[a] if w == b)


def fresh(**kw):
    s = {"phase": "start", "round": 1, "scores": [13, 13], "threshold": 0, "leader": 0, "to_move": 0, "points_left": 2,
         "built": 0, "starts": [None, None], "track": [], "last_round": None, "winners": None, "cities": CITIES}
    s.update(copy.deepcopy(kw))
    return s


def path_edges(state, a, b):
    """The cheapest unbuilt path from node a to node b, as edge ids (used to lay out test boards)."""
    dist = costs_from(state, [a])
    out, v = [], b
    while v != a:
        for w, i in ADJ[v]:
            if w in dist and dist[w] + EDGES[i][2] == dist[v]:
                out.append(i)
                v = w
                break
    return out[::-1]


def case(name, desc, kind, state, mover, other, move, **kw):
    return gamekit.case(name, desc, kind, {**CTX, "move_count": kw.pop("move_count", 0)}, state, mover, other, move,
                        make_view(CTX), view_svg, **kw)


def cases():
    out = []
    orange3 = CITY_NODE[16]  # (4, 7)
    # 1. Ana places her start marker on her Orange 3 city; Bruno places his next.
    out.append(case("Placing a start marker", "The first player puts a start marker on any junction; the next player places one.",
                    "initial", fresh(), "u0", "u1", {"start": orange3},
                    expected_state=fresh(starts=[orange3, None], to_move=1), expected_turn=["u1"]))
    # 2. Bruno places the last marker, so building starts with the round's first player, Ana.
    s2 = fresh(starts=[orange3, None], to_move=1)
    a2 = fresh(phase="build", starts=[orange3, N(7, 11)], to_move=0)
    out.append(case("Last marker starts the building", "When every marker is placed, the round's first player builds.",
                    "intermediate", s2, "u1", "u0", {"start": N(7, 11)}, expected_state=a2, expected_turn=["u0"], move_count=1))
    # 3. Ana builds a plains line from (4,7) to (4,8): it costs 1, so she has 1 point left and keeps the turn.
    e3 = edge(orange3, N(4, 8))
    a3 = fresh(phase="build", starts=[orange3, N(7, 11)], track=[[e3, 0]], points_left=1, built=1)
    out.append(case("Building plains track", "A plains line costs 1 point; the builder keeps the turn with 1 point left.",
                    "intermediate", a2, "u0", "u1", {"edge": e3}, expected_state=a3, expected_turn=["u0"], move_count=2))
    # 4. Track far from Ana's network is refused.
    far = edge(N(0, 2), N(0, 3))
    out.append(case("Track must join your network", "A line that does not touch the builder's network is refused.",
                    "intermediate", a2, "u0", "u1", {"edge": far}, error="InvalidMove", expected_turn=["u0"], move_count=2))
    # 5. Ending the turn with 1 point unused: the point is lost and Bruno builds with 2.
    a5 = fresh(phase="build", starts=[orange3, N(7, 11)], track=[[e3, 0]], to_move=1)
    out.append(case("Ending a turn early", "After building 1 point a player may end the turn; the unused point is lost.",
                    "intermediate", a3, "u0", "u1", {"end": True}, expected_state=a5, expected_turn=["u1"], move_count=3))
    # 6. Game end: Ana has 4 points, Bruno 2. Ana's track already joins four of her cities; the last
    # line reaches her fifth city, so the round ends. Ana loses 0. Bruno's marker is on Green 1
    # (5,12) with no track: he loses the cost of his 4 missing cities and falls below 0, so the game
    # ends and Ana, with the most points left, wins the pot.
    s6 = fresh(phase="build", round=4, scores=[4, 2], leader=1, starts=[orange3, CITY_NODE[28]])
    track = []
    for target in [CITY_NODE[c] for c in CITIES[0] if CITY_NODE[c] != orange3]:
        for i in path_edges({"track": []}, orange3, target):
            if i not in track:
                track.append(i)
    last = track.pop()  # the line that reaches the last city
    s6["track"] = [[i, i % 2] for i in track]
    assert len(s6["track"]) < 84
    after = copy.deepcopy(s6)
    after["track"].append([last, 0])
    lost = [missing_cost(after, 0), missing_cost(after, 1)]
    assert lost[0] == 0 and 2 - lost[1] <= 0, lost
    scores = [4 - lost[0], 2 - lost[1]]
    a6 = copy.deepcopy(after)
    a6.update(points_left=2 - EDGES[last][2], built=1, scores=scores, phase="over", winners=[0],
              last_round={"round": 4, "cities": CITIES, "starts": s6["starts"], "lost": lost, "scores": scores})
    out.append(case("Connecting the last city", "Joining the last city ends the round; a player falls to 0 or below and the most points wins.",
                    "terminal", s6, "u0", "u1", {"edge": last}, expected_state=a6, expected_turn=None,
                    expected_payouts={"u0": 20, "u1": 0}, move_count=140))
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
            {"caption": "Track costs", "svg": cost_svg()},
            {"caption": "Your cities", "svg": gamekit.text_svg("Your cities", [
                "One secret city of each color.", "Connect all five to your start marker.", "Anyone's track counts."], BG, INK, ACCENT)},
            {"caption": "Scoring", "svg": gamekit.text_svg("Scoring a round", [
                "Lose the points still needed", "to reach your missing cities.", "Start at 13; most points left wins."], BG, INK, ACCENT)},
        ],
        "unit_tests": {"state_schema": STATE_SCHEMA, "view_schema": VIEW_SCHEMA, "move_schema": MOVE_SCHEMA, "cases": cases()},
        "translations": gamekit.translations(texts, client),
        "game_addition_request_id_and_secret": gamekit.secret("frontier-rails"),
    }


# A text-free figure: a start marker with track reaching two cities.
TUTORIAL_FIGURE = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 120" role="presentation"><rect width="320" height="120" fill="#e9dcc0"/>'
    '<line x1="40" y1="60" x2="160" y2="60" stroke="#1f3a93" stroke-width="5"/><line x1="160" y1="60" x2="280" y2="30" stroke="#1f3a93" stroke-width="5"/>'
    '<path d="M205 60 L220 36 L235 60Z" fill="#a58a6a"/><rect x="34" y="54" width="12" height="12" fill="#1f3a93" stroke="#fff" stroke-width="2"/>'
    '<circle cx="160" cy="60" r="11" fill="#f2c94c"/><circle cx="280" cy="30" r="11" fill="#4a90d9"/></svg>'
)

if __name__ == "__main__":
    gamekit.write_payload(sys.argv[1], payload())
