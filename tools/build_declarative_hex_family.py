"""Build portable declarative packages for the hex-board game family.

Run from the repository parent with ``python -m game_platform.tools.build_declarative_hex_family``.
The generated fixtures are examples only; replace import secrets before publishing.
"""
from __future__ import annotations

import base64
import copy
import html
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "games" / "declarative"
LOCALES = ("en", "es", "fr", "de", "pt", "zh", "hi", "ar")
TITLES = {
    "chinese_checkers": ["Chinese Checkers", "Damas chinas", "Dames chinoises", "Sternhalma", "Damas chinesas", "跳棋", "चीनी चेकर्स", "الداما الصينية"],
    "abalone": ["Abalone", "Abalone", "Abalone", "Abalone", "Abalone", "阿巴隆", "एबालोन", "أبالون"],
    "havannah": ["Havannah", "Havannah", "Havannah", "Havannah", "Havannah", "哈瓦纳", "हवन्ना", "هافانا"],
    "catan": ["Catan: Island Settlers", "Catan: Colonos de la isla", "Catan : Colons de l’île", "Catan: Insel-Siedler", "Catan: Colonos da ilha", "卡坦岛民", "कैटन: द्वीप बसाने वाले", "كاتان: مستوطنو الجزيرة"],
}
EN_RULES = {
    "chinese_checkers": "Move one marble to a neighboring hole or make a chain of hops over occupied holes. Reach all ten holes in the opposite camp to win. A turn moves one marble; other marbles may be jumped. A blocked player passes. After 400 moves, the player whose marbles are closest to their target camp wins; a tie is a draw.",
    "abalone": "Move a line of one, two or three marbles one space. A line may move sideways into empty spaces, or push a shorter opposing line forward. Eject six opposing marbles to win. This version ends after 500 moves and scores remaining marbles.",
    "havannah": "Take turns placing stones on the hexagonal board. Connect two corners for a bridge, three board edges for a fork, or surround an enclosed region for a ring. The first player to make any one of these shapes wins.",
    "catan": "A streamlined, turn-based Catan adaptation for three or four players. Place two starting settlements and roads, roll for resources, then build roads, settlements and cities. The first to ten points wins. Bank trades use 4:1; development cards, ports, player trades and longest-road bonuses are omitted. The game is scored at 600 actions if nobody reaches ten points.",
}
RULES = {
    "chinese_checkers": [EN_RULES["chinese_checkers"], "Mueve una canica a un hoyo vecino o encadena saltos sobre hoyos ocupados. Llega con tus diez canicas al campamento opuesto para ganar. Si no puedes mover, pasa. Tras 400 movimientos gana quien tenga sus canicas más cerca del campamento objetivo; en empate, la partida termina en tablas.", "Déplacez une bille vers un trou voisin ou enchaînez les sauts par-dessus des trous occupés. Placez vos dix billes dans le camp opposé pour gagner. Si aucun coup n’est possible, passez. Après 400 coups, la distance totale la plus faible vers le camp cible gagne ; une égalité est nulle.", "Ziehe eine Kugel auf ein Nachbarloch oder springe über besetzte Löcher. Bringe alle zehn Kugeln ins gegenüberliegende Lager. Wer keinen Zug hat, setzt aus. Nach 400 Zügen gewinnt die geringste Gesamtdistanz zum Ziellager; Gleichstand bedeutet Remis.", "Mova uma bolinha para um buraco vizinho ou encadeie saltos sobre buracos ocupados. Leve as dez bolinhas ao acampamento oposto para vencer. Se não houver jogada, passe. Após 400 jogadas, vence quem tiver a menor distância total do acampamento-alvo; empate termina empatado.", "将一颗棋子移到相邻空位，或连续跳过占用的空位。先将十颗棋子移到对面的营地获胜。无棋可走时跳过回合。400 步后，距离目标营地总和最小者获胜；平局则为和棋。", "एक गोटी को पास के छेद में ले जाएँ या भरे छेदों पर लगातार कूदें। दसों गोटियों को सामने वाले शिविर में पहुँचाकर जीतें। चाल न हो तो पास करें। 400 चालों के बाद लक्ष्य शिविर की सबसे कम कुल दूरी वाला खिलाड़ी जीतता है; बराबरी पर खेल ड्रॉ होगा।", "حرّك كرة إلى حفرة مجاورة أو اقفز على التوالي فوق الحفر المشغولة. انقل الكرات العشر إلى المعسكر المقابل للفوز. إذا لم تتوفر نقلة فتجاوز الدور. بعد 400 نقلة يفوز صاحب أقل مسافة إجمالية إلى المعسكر المستهدف؛ والتعادل ينهي المباراة بالتعادل."],
    "abalone": [EN_RULES["abalone"], "Mueve una fila de una, dos o tres canicas una casilla. Empuja una fila rival más corta hacia delante. Expulsa seis canicas rivales para ganar.", "Déplacez une ligne d’une, deux ou trois billes d’une case. Poussez une ligne adverse plus courte. Éjectez six billes adverses pour gagner.", "Bewege eine Reihe aus einer, zwei oder drei Kugeln um ein Feld. Schiebe eine kürzere gegnerische Reihe. Wirf sechs gegnerische Kugeln hinaus.", "Mova uma linha de uma, duas ou três bolinhas por uma casa. Empurre uma linha adversária menor. Expulse seis bolinhas para vencer.", "每次将一、两或三颗连成一线的棋子移动一格，也可推动更短的对方棋子。推出六颗对方棋子获胜。", "एक, दो या तीन जुड़ी गोटियों की पंक्ति एक स्थान चलाएँ या छोटी विरोधी पंक्ति को धकेलें। छह विरोधी गोटियाँ बाहर करें।", "حرّك صفًا من كرة أو كرتين أو ثلاث مسافات واحدة، أو ادفع صفًا أقصر للخصم. أخرج ست كرات للفوز."],
    "havannah": [EN_RULES["havannah"], "Coloca piedras por turnos. Conecta dos esquinas, toca tres bordes o rodea una zona para ganar.", "Posez des pierres à tour de rôle. Reliez deux coins, touchez trois bords ou entourez une zone pour gagner.", "Setzt abwechselnd Steine. Verbinde zwei Ecken, berühre drei Ränder oder umschließe ein Gebiet, um zu gewinnen.", "Coloque pedras alternadamente. Ligue dois cantos, toque três bordas ou cerque uma área para vencer.", "轮流放置棋子。连接两个角、接触三个边，或围住一片区域即可获胜。", "बारी-बारी से पत्थर रखें। दो कोने जोड़ें, तीन किनारे छुएँ या किसी क्षेत्र को घेरें।", "ضعوا الأحجار بالتناوب. صِل زاويتين أو المس ثلاثة حواف أو أحط بمنطقة للفوز."],
    "catan": [EN_RULES["catan"], "Una adaptación simplificada de Catan para tres o cuatro personas. Construye caminos, poblados y ciudades con recursos del dado. Gana quien alcance diez puntos. Incluye comercio con el banco 4:1; omite cartas de desarrollo, puertos, intercambios entre jugadores y la ruta más larga.", "Une adaptation simplifiée de Catan pour trois ou quatre joueurs. Construisez routes, colonies et villes grâce aux ressources des dés. Dix points font gagner. Échanges avec la banque à 4:1 ; cartes de développement, ports, échanges entre joueurs et route la plus longue sont omis.", "Eine vereinfachte Catan-Variante für drei oder vier Personen. Baue Straßen, Siedlungen und Städte mit gewürfelten Rohstoffen. Zehn Punkte gewinnen. Banktausch 4:1; Entwicklungskarten, Häfen, Spielertausch und längste Handelsstraße entfallen.", "Uma adaptação simplificada de Catan para três ou quatro pessoas. Construa estradas, povoados e cidades com recursos dos dados. Dez pontos vencem. Trocas com o banco são 4:1; cartas de desenvolvimento, portos, trocas entre jogadores e maior estrada foram omitidos.", "适合三至四人的简化版卡坦岛。掷骰获得资源并建造道路、定居点和城市。先得十分获胜。银行按4比1交易；不含发展卡、港口、玩家交易和最长道路奖励。", "तीन या चार खिलाड़ियों के लिए सरल कैटन रूपांतर। पासे से संसाधन पाकर सड़क, बस्ती और शहर बनाएँ। दस अंक पहले पाने वाला जीतेगा। बैंक विनिमय 4:1 है; विकास कार्ड, बंदरगाह, खिलाड़ी व्यापार और सबसे लंबी सड़क शामिल नहीं हैं।", "نسخة مبسطة من كاتان لثلاثة أو أربعة لاعبين. اجمع الموارد بالنرد وابنِ الطرق والمستوطنات والمدن. أول من يبلغ عشر نقاط يفوز. التبادل مع البنك بنسبة 4:1؛ لا توجد بطاقات تطوير أو موانئ أو تجارة بين اللاعبين أو مكافأة أطول طريق."],
}

UI_TEXT = {
    "en": {"finished":"Game finished","winner":"Player {n} wins","turn":"Turn: {n}","turn_with_score":"Turn: {n} · pushed {score}/6","marble":"Player {n} marble at hole {cell}","stone":"Player {n} stone","roll":"Roll dice","end_turn":"End turn","discard_resource":"Discard 1 {r}","bank_trade":"Trade 4 {give} for 1 {want}","upgrade_city":"Upgrade to city at {n}","build_settlement":"Build settlement at {n}","build_road":"Build road {n}","move":"Move","pass_turn":"Pass turn","phase_setup_settlement":"Setup · place settlement · Player {n}","phase_setup_road":"Setup · place road · Player {n}","phase_roll":"Player {n} · roll the dice","phase_discard":"Player {n} · discard cards","phase_robber":"Player {n} · move the robber","phase_action":"Player {n} · choose an action (roll {roll})","resource_0":"lumber","resource_1":"brick","resource_2":"wool","resource_3":"grain","resource_4":"ore"},
    "es": {"finished":"Partida terminada","winner":"Gana el jugador {n}","turn":"Turno: {n}","turn_with_score":"Turno: {n} · expulsados {score}/6","marble":"Canica del jugador {n}, hueco {cell}","stone":"Piedra del jugador {n}","roll":"Lanzar dados","end_turn":"Terminar turno","discard_resource":"Descartar 1 {r}","bank_trade":"Cambiar 4 {give} por 1 {want}","upgrade_city":"Mejorar a ciudad en {n}","build_settlement":"Construir poblado en {n}","build_road":"Construir camino {n}","move":"Mover","pass_turn":"Pasar turno","phase_setup_settlement":"Preparación · poblado · Jugador {n}","phase_setup_road":"Preparación · camino · Jugador {n}","phase_roll":"Jugador {n} · lanzar dados","phase_discard":"Jugador {n} · descartar cartas","phase_robber":"Jugador {n} · mover ladrón","phase_action":"Jugador {n} · elegir acción (tirada {roll})","resource_0":"madera","resource_1":"ladrillo","resource_2":"lana","resource_3":"grano","resource_4":"mineral"},
    "fr": {"finished":"Partie terminée","winner":"Le joueur {n} gagne","turn":"Tour : {n}","turn_with_score":"Tour : {n} · expulsés {score}/6","marble":"Bille du joueur {n}, trou {cell}","stone":"Pierre du joueur {n}","roll":"Lancer les dés","end_turn":"Terminer le tour","discard_resource":"Défausser 1 {r}","bank_trade":"Échanger 4 {give} contre 1 {want}","upgrade_city":"Améliorer en ville en {n}","build_settlement":"Construire une colonie en {n}","build_road":"Construire la route {n}","move":"Déplacer","pass_turn":"Passer le tour","phase_setup_settlement":"Départ · colonie · Joueur {n}","phase_setup_road":"Départ · route · Joueur {n}","phase_roll":"Joueur {n} · lancer les dés","phase_discard":"Joueur {n} · défausser","phase_robber":"Joueur {n} · déplacer le voleur","phase_action":"Joueur {n} · choisir (lancer {roll})","resource_0":"bois","resource_1":"brique","resource_2":"laine","resource_3":"blé","resource_4":"minerai"},
    "de": {"finished":"Spiel beendet","winner":"Spieler {n} gewinnt","turn":"Zug: {n}","turn_with_score":"Zug: {n} · vertrieben {score}/6","marble":"Kugel von Spieler {n}, Loch {cell}","stone":"Stein von Spieler {n}","roll":"Würfeln","end_turn":"Zug beenden","discard_resource":"1 {r} abwerfen","bank_trade":"4 {give} gegen 1 {want} tauschen","upgrade_city":"Bei {n} zur Stadt ausbauen","build_settlement":"Siedlung bei {n} bauen","build_road":"Straße {n} bauen","move":"Ziehen","pass_turn":"Runde aussetzen","phase_setup_settlement":"Aufbau · Siedlung · Spieler {n}","phase_setup_road":"Aufbau · Straße · Spieler {n}","phase_roll":"Spieler {n} · würfeln","phase_discard":"Spieler {n} · Karten abwerfen","phase_robber":"Spieler {n} · Räuber bewegen","phase_action":"Spieler {n} · Aktion wählen (Wurf {roll})","resource_0":"Holz","resource_1":"Lehm","resource_2":"Wolle","resource_3":"Getreide","resource_4":"Erz"},
    "pt": {"finished":"Partida encerrada","winner":"Jogador {n} venceu","turn":"Vez: {n}","turn_with_score":"Vez: {n} · expulsas {score}/6","marble":"Bolinha do jogador {n}, casa {cell}","stone":"Pedra do jogador {n}","roll":"Rolar dados","end_turn":"Encerrar vez","discard_resource":"Descartar 1 {r}","bank_trade":"Trocar 4 {give} por 1 {want}","upgrade_city":"Melhorar para cidade em {n}","build_settlement":"Construir povoado em {n}","build_road":"Construir estrada {n}","move":"Mover","pass_turn":"Passar a vez","phase_setup_settlement":"Preparação · povoado · Jogador {n}","phase_setup_road":"Preparação · estrada · Jogador {n}","phase_roll":"Jogador {n} · rolar dados","phase_discard":"Jogador {n} · descartar cartas","phase_robber":"Jogador {n} · mover ladrão","phase_action":"Jogador {n} · escolher ação (rolagem {roll})","resource_0":"madeira","resource_1":"tijolo","resource_2":"lã","resource_3":"trigo","resource_4":"minério"},
    "zh": {"finished":"游戏结束","winner":"玩家 {n} 获胜","turn":"回合：{n}","turn_with_score":"回合：{n} · 已推出 {score}/6","marble":"玩家 {n} 的第 {cell} 号棋子","stone":"玩家 {n} 的棋子","roll":"掷骰子","end_turn":"结束回合","discard_resource":"弃掉 1 个{r}","bank_trade":"用 4 个{give}换 1 个{want}","upgrade_city":"将 {n} 号定居点升级为城市","build_settlement":"在 {n} 号建造定居点","build_road":"建造道路 {n}","move":"移动","pass_turn":"跳过回合","phase_setup_settlement":"开局 · 放置定居点 · 玩家 {n}","phase_setup_road":"开局 · 放置道路 · 玩家 {n}","phase_roll":"玩家 {n} · 掷骰子","phase_discard":"玩家 {n} · 弃牌","phase_robber":"玩家 {n} · 移动强盗","phase_action":"玩家 {n} · 选择行动（点数 {roll}）","resource_0":"木材","resource_1":"砖块","resource_2":"羊毛","resource_3":"谷物","resource_4":"矿石"},
    "hi": {"finished":"खेल समाप्त","winner":"खिलाड़ी {n} जीता","turn":"बारी: {n}","turn_with_score":"बारी: {n} · बाहर किए {score}/6","marble":"खिलाड़ी {n} की गोटी, छेद {cell}","stone":"खिलाड़ी {n} का पत्थर","roll":"पासा फेंकें","end_turn":"बारी समाप्त करें","discard_resource":"1 {r} छोड़ें","bank_trade":"4 {give} देकर 1 {want} लें","upgrade_city":"{n} पर शहर में उन्नत करें","build_settlement":"{n} पर बस्ती बनाएँ","build_road":"सड़क {n} बनाएँ","move":"चाल चलें","pass_turn":"बारी छोड़ें","phase_setup_settlement":"शुरुआत · बस्ती · खिलाड़ी {n}","phase_setup_road":"शुरुआत · सड़क · खिलाड़ी {n}","phase_roll":"खिलाड़ी {n} · पासा फेंकें","phase_discard":"खिलाड़ी {n} · कार्ड छोड़ें","phase_robber":"खिलाड़ी {n} · लुटेरा चलाएँ","phase_action":"खिलाड़ी {n} · कार्रवाई चुनें (फेंक {roll})","resource_0":"लकड़ी","resource_1":"ईंट","resource_2":"ऊन","resource_3":"अनाज","resource_4":"अयस्क"},
    "ar": {"finished":"انتهت اللعبة","winner":"فاز اللاعب {n}","turn":"الدور: {n}","turn_with_score":"الدور: {n} · أُخرج {score}/6","marble":"كرة اللاعب {n} في الحفرة {cell}","stone":"حجر اللاعب {n}","roll":"ارمِ النرد","end_turn":"إنهاء الدور","discard_resource":"تخلّص من {r} واحد","bank_trade":"استبدل 4 من {give} بواحد من {want}","upgrade_city":"طوّر إلى مدينة عند {n}","build_settlement":"ابنِ مستوطنة عند {n}","build_road":"ابنِ الطريق {n}","move":"تحريك","pass_turn":"تجاوز الدور","phase_setup_settlement":"البداية · مستوطنة · اللاعب {n}","phase_setup_road":"البداية · طريق · اللاعب {n}","phase_roll":"اللاعب {n} · ارمِ النرد","phase_discard":"اللاعب {n} · تخلّص من البطاقات","phase_robber":"اللاعب {n} · حرّك اللص","phase_action":"اللاعب {n} · اختر إجراءً (الرمي {roll})","resource_0":"خشب","resource_1":"طوب","resource_2":"صوف","resource_3":"حبوب","resource_4":"خام"},
}

TILE_RESOURCES = ["lumber","lumber","lumber","lumber","brick","brick","brick","wool","wool","wool","wool","grain","grain","grain","grain","ore","ore","ore","desert"]
TILE_NUMBERS = [5,2,6,3,8,10,9,12,11,4,8,10,9,4,5,6,3,11]
TILE_COLORS = {"lumber":"#477354","brick":"#ad6651","wool":"#7997aa","grain":"#b39143","ore":"#717984","desert":"#d5c28a"}
PLAYER_COLORS = ["#38bdf8", "#fb7185", "#a3e635", "#c084fc"]
SERVER_TEXTS = {
    "server_illegal_move": {
        "en": "Illegal move", "es": "Movimiento ilegal", "fr": "Coup illégal",
        "de": "Ungültiger Zug", "pt": "Jogada inválida", "zh": "非法着法",
        "hi": "अमान्य चाल", "ar": "نقلة غير قانونية",
    },
}


def hex_cells(radius: int):
    return [(q, r) for r in range(-radius, radius + 1) for q in range(-radius, radius + 1)
            if max(abs(q), abs(r), abs(q + r)) <= radius]


def star_geometry():
    directions = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
    center = hex_cells(4)
    coords = list(center)
    camps = []
    for i, (dq, dr) in enumerate(directions):
        sq, sr = directions[(i + 1) % 6]
        camp = [((4 + layer) * dq + offset * sq, (4 + layer) * dr + offset * sr)
                for layer in range(1, 5) for offset in range(5 - layer)]
        camps.append(camp)
        coords.extend(camp)
    if len(set(coords)) != 121:
        raise RuntimeError("Chinese Checkers star geometry must contain 121 distinct holes")
    return coords, camps


def board_cells(coords, *, spacing=44, board_center=(260, 205), Chinese=False):
    cx, cy = board_center
    out = []
    for i, (q, r) in enumerate(coords):
        scale = spacing
        x = cx + (q + r / 2) * scale
        y = cy + r * scale * math.sqrt(3) / 2
        out.append({"id": str(i), "x": round(x, 2), "y": round(y, 2), "color": "#2a415c" if i % 2 else "#334d69"})
    return out


def catan_geometry():
    coords = hex_cells(2)
    tile_numbers = iter(TILE_NUMBERS)
    tiles = []
    resources = TILE_RESOURCES[:]
    center = coords.index((0, 0))
    desert = resources.index("desert")
    resources[center], resources[desert] = resources[desert], resources[center]
    for i, (q, r) in enumerate(coords):
        resource = resources[i]
        number = 0 if resource == "desert" else next(tile_numbers)
        x, y = 310 + (q + r / 2) * 76, 240 + r * 76 * math.sqrt(3) / 2
        marker = {"lumber": "W", "brick": "B", "wool": "S", "grain": "G", "ore": "O", "desert": "D"}[resource]
        label = marker if resource == "desert" else f"{marker}{number}"
        tiles.append({"id": str(i), "q": q, "r": r, "x": round(x, 2), "y": round(y, 2),
                      "resource": resource, "number": number, "label": label,
                      "color": TILE_COLORS[resource], "text_color": "#20252b" if resource == "desert" else "#fffdf6"})

    side = 76 / math.sqrt(3)
    node_map = {}
    tile_node_keys = []
    for tile in tiles:
        corners = []
        for corner in range(6):
            angle = math.radians(30 + 60 * corner)
            px = round(tile["x"] + side * math.cos(angle), 2)
            py = round(tile["y"] + side * math.sin(angle), 2)
            key = f"{px:.2f},{py:.2f}"
            node_map.setdefault(key, (px, py))
            corners.append(key)
        tile_node_keys.append(corners)
    sorted_keys = sorted(node_map, key=lambda k: (node_map[k][1], node_map[k][0]))
    node_index = {k: i for i, k in enumerate(sorted_keys)}
    nodes = [{"id": str(i), "x": node_map[k][0], "y": node_map[k][1]} for i, k in enumerate(sorted_keys)]
    edges_set = set()
    for corners in tile_node_keys:
        for i in range(6):
            a, b = node_index[corners[i]], node_index[corners[(i + 1) % 6]]
            edges_set.add(tuple(sorted((a, b))))
    edges = sorted(edges_set)
    node_edges = [[] for _ in nodes]
    node_tiles = [[] for _ in nodes]
    tile_nodes = []
    for tile_index, keys in enumerate(tile_node_keys):
        indices = [node_index[k] for k in keys]
        tile_nodes.append(indices)
        for node in indices:
            node_tiles[node].append(tile_index)
    for edge_index, (a, b) in enumerate(edges):
        node_edges[a].append(edge_index)
        node_edges[b].append(edge_index)
    return {"tiles": tiles, "nodes": nodes, "edges": edges, "nodeEdges": node_edges,
            "nodeTiles": node_tiles, "tileNodes": tile_nodes,
            "board": {"x": 15, "y": 76}, "player_colors": PLAYER_COLORS}


HEX_ENGINE = (ROOT / "games" / "declarative" / "hex_family_engine.js").read_text()
HEX_UI = (ROOT / "games" / "declarative" / "hex_family_ui.js").read_text()


def geometry_for(kind):
    if kind == "chinese_checkers":
        coords, camps = star_geometry()
    else:
        coords, camps = hex_cells(4), []
    cells = [{"q": q, "r": r} for q, r in coords]
    index = {f"{q},{r}": i for i, (q, r) in enumerate(coords)}
    camp_ids = [[index[f"{q},{r}"] for q, r in camp] for camp in camps]
    return cells, index, camp_ids


def translated_strings(kind, locale):
    common = dict(UI_TEXT[locale])
    common.update({key: values[locale] for key, values in SERVER_TEXTS.items()})
    common["cards_hidden"] = {"en": "{n} hidden cards", "es": "{n} cartas ocultas", "fr": "{n} cartes cachées", "de": "{n} verdeckte Karten", "pt": "{n} cartas ocultas", "zh": "{n} 张隐藏卡牌", "hi": "{n} छिपे कार्ड", "ar": "{n} بطاقات مخفية"}[locale]
    title = TITLES[kind][LOCALES.index(locale)]
    common["title"] = title
    if kind == "abalone":
        common["turn_with_score"] = common["turn_with_score"]
    return common


def ui_spec(kind, source, geometry, catangeom, coords):
    if kind == "catan":
        board = {"id": "island", "kind": "hex", "x": 15, "y": 76, "width": 620, "height": 480,
                 "rows": 6, "columns": 8, "color": "#c1ae7d", "line_color": "#e7d6ae",
                 "cells": [{k: tile[k] for k in ("id", "x", "y", "label", "color", "text_color")} for tile in catangeom["tiles"]]}
        viewport = {"width": 650, "height": 620}
        types = {"settlement": {"shape": "circle", "width": 28, "height": 28, "color": PLAYER_COLORS[0], "text_color": "#ffffff"},
                 "city": {"shape": "rect", "width": 34, "height": 30, "color": PLAYER_COLORS[0], "text_color": "#ffffff"},
                 "robber": {"shape": "circle", "width": 28, "height": 28, "color": "#272727", "text_color": "#ffffff"}}
        for i, color in enumerate(PLAYER_COLORS):
            types[f"p{i}"] = {"shape": "circle", "width": 34, "height": 34, "color": color, "text_color": "#ffffff"}
        boards = [board]
    else:
        cells = board_cells(coords, spacing=30 if kind == "chinese_checkers" else 50,
                            board_center=(260, 205 if kind == "chinese_checkers" else 195))
        board = {"id": "main", "kind": "hex", "x": 30, "y": 86, "width": 520, "height": 430,
                 "rows": 17 if kind == "chinese_checkers" else 9,
                 "columns": 17 if kind == "chinese_checkers" else 9,
                 "color": "#1b2e45", "line_color": "#61778f", "cells": cells}
        viewport = {"width": 580, "height": 560}
        boards = [board]
        types = {"p0": {"shape": "circle", "width": 32, "height": 32, "color": PLAYER_COLORS[0], "text_color": "#ffffff"},
                 "p1": {"shape": "circle", "width": 32, "height": 32, "color": PLAYER_COLORS[1], "text_color": "#ffffff"}}
        if kind == "chinese_checkers":
            for i, color in enumerate(PLAYER_COLORS):
                types[f"p{i}"] = {"shape": "circle", "width": 23, "height": 23, "color": color, "text_color": "#ffffff"}
    spec = {"format": "buildplay-ui", "version": 1, "viewport": viewport,
            "boards": boards, "piece_types": types, "strings": source,
            "ui_code": "const KIND=" + json.dumps(kind) + ";\nconst SOURCE_STRINGS=" + json.dumps(source, ensure_ascii=False) + ";\nconst GEOMETRY=" + json.dumps(catangeom, separators=(",", ":")) + ";\nconst RESOURCE_MARKS=" + json.dumps(["W", "B", "S", "G", "O"]) + ";\n" + HEX_UI}
    return spec


def schemas(kind):
    length = {"chinese_checkers": 121, "abalone": 61, "havannah": 61, "catan": 19}[kind]
    properties = {"turn": {"type": "integer", "minimum": 0, "maximum": 5},
                  "over": {"type": "boolean"}, "winner": {"type": "integer", "minimum": -1, "maximum": 5},
                  "scores": {"type": "array", "items": {"type": "integer", "minimum": 0}, "maxItems": 6}}
    if kind != "catan":
        properties["board"] = {"type": "array", "minItems": length, "maxItems": length,
                               "items": {"type": "integer", "minimum": -1, "maximum": 5}}
    move_props = {"action": {"type": "string", "enum": ["roll", "end_turn", "discard", "trade", "road", "settle", "city", "robber", "pass"]},
                  "cell": {"type": "integer", "minimum": 0, "maximum": 120},
                  "from": {"oneOf": [{"type": "integer", "minimum": 0, "maximum": 120},
                                      {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 120}, "minItems": 1, "maxItems": 3}]},
                  "to": {"oneOf": [{"type": "integer", "minimum": 0, "maximum": 120},
                                    {"type": "array", "items": {"type": "integer", "minimum": 0, "maximum": 120}, "minItems": 1, "maxItems": 3}]},
                  "dir": {"type": "integer", "minimum": 0, "maximum": 5}, "node": {"type": "integer", "minimum": 0, "maximum": 53},
                  "edge": {"type": "integer", "minimum": 0, "maximum": 71}, "tile": {"type": "integer", "minimum": 0, "maximum": 18},
                  "victim": {"type": "integer", "minimum": -1, "maximum": 3}, "resource": {"type": "integer", "minimum": 0, "maximum": 4},
                  "give": {"type": "integer", "minimum": 0, "maximum": 4}, "want": {"type": "integer", "minimum": 0, "maximum": 4}}
    move = {"type": "object", "required": [], "properties": move_props, "additionalProperties": False,
            "anyOf": [{"required": [key]} for key in ("cell", "from", "action")]}
    state_required = ["turn", "over", "winner", "scores"] + ([] if kind == "catan" else ["board"])
    state = {"type": "object", "required": state_required, "properties": properties, "additionalProperties": True}
    view = copy.deepcopy(state)
    view["properties"]["legal"] = {"type": "array", "maxItems": 2000, "items": move}
    view["required"].append("legal")
    return {"state": state, "view": view, "move": move}


def small_svg(kind, caption, frame=0):
    colors = ["#38bdf8", "#fb7185", "#a3e635", "#c084fc"]
    shapes = "".join(f'<circle cx="{45+frame*17+i*28}" cy="{70+(i%2)*14}" r="13" fill="{colors[i%4]}"/>' for i in range(5))
    return {"caption": caption, "svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 120"><rect width="220" height="120" rx="12" fill="#142238"/><text x="16" y="28" fill="#fff" font-size="15">' + html.escape(TITLES[kind][0]) + '</text>' + shapes + '</svg>'}


def package(kind):
    cells, index, camps = geometry_for(kind)
    catangeom = catan_geometry() if kind == "catan" else {
        "tiles": [], "nodes": [], "edges": [], "nodeEdges": [], "nodeTiles": [],
        "tileNodes": [], "board": {"x": 0, "y": 0}, "player_colors": PLAYER_COLORS,
    }
    strings = translated_strings(kind, "en")
    geom_prefix = "const KIND=" + json.dumps(kind) + ";\nconst HEX_CELLS=" + json.dumps(cells, separators=(",", ":")) + ";\nconst HEX_INDEX=" + json.dumps(index, separators=(",", ":")) + ";\nconst HEX_CAMP_IDS=" + json.dumps(camps, separators=(",", ":")) + ";\nconst CATAN_GEOMETRY=" + json.dumps(catangeom, separators=(",", ":")) + ";\nconst CATAN_TILES=" + json.dumps(catangeom["tiles"], separators=(",", ":")) + ";\n"
    server_code = geom_prefix + HEX_ENGINE
    ui = ui_spec(kind, strings, catangeom, catangeom, [(cell["q"], cell["r"]) for cell in cells])
    return server_code, ui, cells, catangeom


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    for kind in ("chinese_checkers", "abalone", "havannah"):
        # The Node fixture builder executes the exact package rules without
        # substituting a second rules implementation.
        server_code, ui, _, catangeom = package(kind)
        fixture_input = {"server_code": server_code, "players": min([2] if kind != "catan" else [3, 4]), "kind": kind}
        # Initial/intermediate/terminal traces are emitted by the companion JS tool.
        import subprocess
        traces = json.loads(subprocess.check_output(["node", str(ROOT / "tools" / "build_hex_family_cases.mjs")],
                                                     input=json.dumps(fixture_input).encode(), cwd=ROOT))
        for case in traces:
            case["images"] = [small_svg(kind, f"{case['name']} · {label}", frame)
                              for frame, label in enumerate(("Before · mover", "Before · other", "After · mover", "After · other"))]
        source_rules = RULES[kind][0]
        title = TITLES[kind][0]
        rules = schemas(kind)
        translations = {}
        for locale_index, locale in enumerate(LOCALES[1:], start=1):
            translated = translated_strings(kind, locale)
            translations[locale] = {
                "display_name": TITLES[kind][locale_index],
                "short_description": RULES[kind][locale_index],
                "game_logic_rules": RULES[kind][locale_index],
                "game_ui_rules": RULES[kind][locale_index],
                "tutorial_strings": {title: TITLES[kind][locale_index], source_rules: RULES[kind][locale_index]},
                "client_strings": translated,
            }
        cover = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" rx="10" fill="#142238"/><path d="M30 45h100M50 25l60 40M50 65l60-40" stroke="#94a3b8" stroke-width="3"/><circle cx="50" cy="45" r="13" fill="#38bdf8"/><circle cx="110" cy="45" r="13" fill="#fb7185"/></svg>'
        payload = {
            "name": title + " (Declarative)", "description": source_rules,
            "game_addition_request_id_and_secret": "example-only-hex-family-" + kind + "-replace-before-publishing",
            "allowed_player_counts": [3, 4] if kind == "catan" else [2] if kind != "chinese_checkers" else [2, 3, 4, 5, 6],
            "server_code": server_code, "declarative_ui": ui, "rules": source_rules,
            "ui_instructions": "Select your marble or stones, then choose a highlighted legal destination. Catan offers its current legal build or action choices. All game rules and move validation are authoritative on the server.",
            "tutorial": {"text": source_rules, "html": '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main><h1>' + html.escape(title) + '</h1><p>' + html.escape(source_rules) + '</p></main>'},
            "images": [{"caption": "Cover", "svg": cover}, *[small_svg(kind, label, frame) for frame, label in enumerate(("Starting position", "A legal turn", "Board overview"))]],
            "unit_tests": {"state_schema": rules["state"], "view_schema": rules["view"], "move_schema": rules["move"], "cases": traces},
            "translations": translations,
        }
        target = DEST / f"{kind}.json"
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Built {target.name}: {target.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
