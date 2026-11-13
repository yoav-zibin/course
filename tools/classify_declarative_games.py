"""Rebuild the sanitized declarative-UI catalog inventory from a sheet CSV.

This is a requirements triage, not a rules audit or proof of implementation.
Only public game descriptions/rules links are retained, never student columns.
"""

import argparse
import collections
import csv
import hashlib
import io
import json
import pathlib
import re


SHEET = "https://docs.google.com/spreadsheets/d/1-_GPw7Sd_ZOmv21VgsVshiH-Q2GpeVeZiBP6UB2ovH4/edit#gid=740849951"

# Exact-name exceptions are intentionally readable and conservative. Descriptions
# are short and often omit important requirements; unclassified rows stay open.
PHYSICAL = {
    "operation", "carrom", "tiddlywinks", "subbuteo", "crokinole", "kubb",
    "mölkky", "chapaev", "ddakji", "menko", "ohajiki", "lagori",
    "tumbang preso", "don't break the ice", "don't wake daddy", "perfection",
    "kerplunk", "jenga", "buckaroo!", "barrel of monkeys", "pick-up sticks",
    "marbles", "crocodile dentist", "pop-up pirate", "gator golf",
    "loopin' louie", "villa paletti", "fireball island", "throw throw burrito",
    "pin the tail on the donkey", "hunt the thimble", "couch of power",
    "twister", "spinderella · digital physics", "connect 4 spin", "minigolf",
    "mini golf", "mini golf duels", "pass the pigs", "diceland",
}
PERFORMANCE = {
    "charades", "monikers", "time's up!", "celebrity", "truth or dare",
    "never have i ever", "simon says", "spin the bottle", "assassin",
    "wink murder", "pass the parcel", "utter nonsense!", "the farmer in the dell",
    "squeak piggy squeak", "telephone game", "scissors", "white elephant gift exchange",
}
DRAWING = {
    "pictionary", "telestrations", "a fake artist goes to new york", "win, lose or draw",
    "exquisite corpse", "the quiet year", "cartographers", "sprouts", "brussels sprouts",
    "empire builder (board game)", "iron dragon (board game)", "eurorails",
}
REALTIME = {
    "xcom: the board game", "space alert", "captain sonar", "speed", "spit",
    "slapjack", "snap", "egyptian ratscrew", "ers", "jungle speed", "dobble",
    "anomia", "taco cat goat cheese pizza", "spoons", "pit", "the mind",
    "karuta", "quizup", "tamsk", "scrabble slam", "anagrams",
}
AUDIO = {"name that tune", "scene it?"}
THREED = {"rumis", "qubic", "score four", "zendo", "pictures"}
DISCRETE_GEOMETRY = {"dots and boxes", "paper soccer", "join five", "dots", "sim", "bridg-it", "hackenbush", "cartographers", "kayles", "spellbinder"}


def matches(pattern, value):
    return re.search(pattern, value, re.I) is not None


def classify(name, description):
    key = name.casefold().strip()
    text = f"{name} {description}".casefold()
    tags = []
    rules = [
        ("cards_hands_piles", r"card|deck|trick|rummy|poker|whist|canasta|tarock|tarot|skat|bridge|blackjack|mahjong|shogi|spades|hearts|belote|cribbage|rummikub|hanafuda|hwatu"),
        ("dice_score_choices", r"dic[ee]|roll|cowrie|throw sticks|throw four sticks|spinn|spinner|spin to|dreidel"),
        ("grid_cells_pieces", r"grid|board|chess|draught|checkers|shogi|gomoku|reversi|tic.?tac.?toe|morris|tafl|hex|territor|stone|pawn|peg|marble|piece|\bunits?\b|markers?"),
        ("map_graph_anchors", r"map|route|network|rail|track|region|province|city|cities|island|planet|road|path|territor|sail|dungeon|location"),
        ("tile_placement_rotation", r"tile|polyomino|rotate|rotating|quilt|mosaic|tetri|blokus|patchwork|carcassonne|bar.enpark"),
        ("stacks_counts_layers", r"stack|tower|nest|\bpits?\b|sow|seed|mancala|gobblet|\blayers?\b|height|\blevels?\b|bamboo|\bheaps?\b|\bobjects?\b"),
        ("text_choices_scores", r"word|letter|trivia|question|answer|clue|guess|code|story|stories|deduc|vote|bid|bet|auction|negotia|role|contract|score|point|wealth|money|gold|coin|resource|goods|worker|farm|build|buy|trade|income|prestige|culture|glory|win"),
        ("viewer_specific_information", r"hidden|secret|face.down|blind|bluff|hand|spy|spies|traitor|deduc|battleship|stratego|hanabi|coup|werewolf|mafia|resistance"),
        ("timers_or_simultaneous_intents", r"real.time|timed|timer|buzzer|clock|same time|simultaneous|race to|racing to|fastest|slap|reaction"),
    ]
    for tag, pattern in rules:
        if matches(pattern, text):
            tags.append(tag)

    if key in DISCRETE_GEOMETRY:
        return "direct", "This game uses discrete vertices, edges, cells or shape placements; each can be a predefined JSON target rather than freehand input.", tags + ["predefined_geometry_targets"]
    if key in PHYSICAL or matches(r"flick|dexterity|physic|tweezers|throwing game|blindfold|knock down|foam burrito|topples? the tower|collapsing the tower", text):
        return "adaptation", "Physical skill, toy geometry or dexterity needs an explicitly different digital rule or physics simulation.", tags + ["physical_skill"]
    if key in PERFORMANCE or matches(r"miming|silently acting|hand gestures|whisper|singing|performing it|speaking in it|tell.*tall tale", text):
        return "adaptation", "Bodily, spoken or social performance needs an agreed text/choice adaptation or an external activity.", tags + ["external_performance"]
    if key in AUDIO:
        return "extension", "Audio/video clue playback and its interaction are outside the image-and-JSON core.", tags + ["audio_video"]
    if key in DRAWING or matches(r"draw.*(line|picture|map)|drawing clues|crayon", text):
        return "extension", "Freehand/variable geometry drawing needs a path editor or a constrained predefined-edge adaptation.", tags + ["drawing_input"]
    if key in REALTIME or matches(r"real.time|fastest answers|race to slap|race to grab", text):
        return "extension", "Precise reaction/simultaneous timing needs trusted clocks and server arbitration beyond ordinary turn selection.", tags + ["reaction_arbitration"]
    if key in THREED or matches(r"3d|three.dimensional|4x4x4", text):
        return "extension", "True 3D/physical arrangement needs extra primitives; multiple labeled 2D layers are a possible adaptation.", tags + ["three_dimensional_arrangement"]

    substantive = [t for t in tags if t not in ("text_choices_scores", "viewer_specific_information", "timers_or_simultaneous_intents")]
    if substantive or matches(r"word|letter|trivia|question|answer|clue|guess|code|story|stories|deduc|vote|bid|bet|auction|negotia|role|contract|worker|resource|goods|farm|buy|trade", text):
        return "direct", "The described discrete UI can be represented by boards, pieces, labels and JSON actions; detailed rules and layout still need verification.", tags
    return "ambiguous", "The short description does not identify enough UI requirements to assert a direct fit; inspect its full rules before conversion.", tags


def inventory(raw):
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    header = next(i for i, row in enumerate(rows) if row[:2] == ["Game name", "Short game description"])
    result = []
    for i, row in enumerate(rows):
        if i <= header:
            continue
        if not row or not row[0].strip():
            continue
        name, description, url = (row + ["", "", ""])[:3]
        status, reason, tags = classify(name, description)
        result.append(dict(section="catalog", sheet_row=i + 1, name=name, description=description, rules_url=url, coverage=status, requirements=";".join(tags), basis=reason))
    # The sheet starts with students' top-five picks. Preserve game labels only.
    by_name = {entry["name"].casefold().strip(): entry for entry in result}
    aliases = {
        "doudizhu": "dou dizhu", "4-player chess": "four-handed chess",
        "chutes & ladders": "chutes and ladders",
        "rummy 500": "500 rum", "ers": "egyptian ratscrew",
        "6 card golf": "golf", "guess who": "guess who?",
        "brazilian truco": "truco",
    }
    for i, row in enumerate(rows[:header]):
        if len(row) < 3 or "@" not in row[0]:
            continue
        for name in row[2:7]:
            if name.strip():
                target = by_name.get(aliases.get(name.casefold().strip(), name.casefold().strip()))
                description = target["description"] if target else ""
                status, reason, tags = classify(name, description)
                basis = f"Catalog description at row {target['sheet_row']}; {reason}" if target and description else reason
                result.append(dict(section="top_five", sheet_row=i + 1, name=name, description=description, rules_url="", coverage=status, requirements=";".join(tags), basis=basis))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path("reports/declarative-game-coverage.csv"))
    args = parser.parse_args()
    raw = args.csv_path.read_bytes()
    entries = inventory(raw)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(entries[0]))
        writer.writeheader()
        writer.writerows(entries)
    catalog = [entry for entry in entries if entry["section"] == "catalog"]
    print(json.dumps({"source": SHEET, "source_sha256": hashlib.sha256(raw).hexdigest(), "catalog_rows": len(catalog), "unique_catalog_names": len({entry["name"].casefold().strip() for entry in catalog}), "top_five_mentions": len(entries) - len(catalog), "catalog_coverage": dict(collections.Counter(entry["coverage"] for entry in catalog)), "requirement_counts": dict(collections.Counter(tag for entry in catalog for tag in entry["requirements"].split(";") if tag))}, indent=2))


if __name__ == "__main__":
    main()
