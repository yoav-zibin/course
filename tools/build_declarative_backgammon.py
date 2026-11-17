"""Build the portable Backgammon submission from the ordinary game's authority.

Run from the package parent:
  python -m game_platform.tools.build_declarative_backgammon
The checked-in submission secret is only an example; replace it when publishing.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import html
import json
from pathlib import Path
import re

from game_platform.game_logic import GameLogic

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'games' / 'declarative'
SOURCE_ID = '20a83777-0f59-4105-a09e-0267b9c15e40'
SOURCE_VERSION = 4
SOURCE_SHA256 = '0206fffd96b1447a457f63431d013c6de5d5337dfc40285157304a95204b3c4e'
LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
TITLES = ['Backgammon', 'Backgammon', 'Backgammon', 'Backgammon', 'Gamão', '西洋双陆棋', 'बैकगैमोन', 'الطاولة']
RULES = [
    'Move 15 checkers home and bear them off. Roll two dice; doubles give four moves. Enter captured checkers from the bar first. A point with two opposing checkers is blocked; a lone checker is hit. Use the maximum possible dice, and the higher die if only one can be used. Bear off only when all your checkers are home. This uses the ordinary platform Backgammon rules, including its finite-match safeguard: after 120 turns or 300 actions, the player with more checkers off wins; ties favor player one.',
    'Lleva tus 15 fichas a casa y retíralas. Lanza dos dados; los dobles dan cuatro movimientos. Primero reingresa las fichas de la barra. Dos fichas rivales bloquean; una sola se captura. Usa el máximo de dados y el mayor si solo puedes usar uno. Retira solo con todas tus fichas en casa. Se usan las reglas normales de la plataforma: tras 120 turnos o 300 acciones gana quien haya retirado más; el empate favorece al primer jugador.',
    'Ramenez vos 15 pions et sortez-les. Lancez deux dés ; un double donne quatre déplacements. Rentrez les pions de la barre en premier. Deux pions adverses bloquent ; un pion seul est frappé. Utilisez le maximum de dés, et le plus fort si un seul est jouable. Sortez quand tous vos pions sont dans votre jan intérieur. Règles ordinaires de la plateforme : après 120 tours ou 300 actions, le plus de pions sortis gagne ; égalité au premier joueur.',
    'Bringe 15 Steine ins Heimfeld und würfle sie heraus. Zwei Würfel; ein Pasch gibt vier Züge. Steine von der Bar zuerst einsetzen. Zwei gegnerische Steine sperren, ein einzelner wird geschlagen. Nutze möglichst viele Würfel, bei nur einem möglichen den höheren. Auswürfeln erst mit allen Steinen im Heimfeld. Es gelten die normalen Plattformregeln: Nach 120 Runden oder 300 Aktionen gewinnt die höhere Zahl ausgewürfelter Steine, bei Gleichstand Spieler eins.',
    'Leve 15 peças para casa e retire-as. Lance dois dados; duplas dão quatro movimentos. Entre primeiro com as peças da barra. Duas peças rivais bloqueiam; uma sozinha é capturada. Use o máximo de dados e o maior se só um puder ser usado. Retire apenas com todas em casa. Regras normais da plataforma: após 120 turnos ou 300 ações, vence quem retirou mais; empate favorece o primeiro jogador.',
    '将15枚棋子带回本区并移出。掷两枚骰子，双骰可走四步。被吃的棋子须先从中栏进入。对方两子或更多阻挡，单子可被吃。必须尽量使用更多骰子；只能用一枚时须用较大点数。己方全子回本区后方可移出。使用平台普通双陆棋规则：120回合或300次行动后，移出更多者胜，平局算玩家一胜。',
    '15 गोटियाँ घर लाकर बाहर निकालें। दो पासे फेंकें; समान अंक पर चार चालें मिलती हैं। पहले बार की गोटियाँ लौटाएँ। दो विरोधी गोटियाँ रास्ता रोकती हैं; अकेली गोटी पकड़ी जाती है। अधिकतम पासे चलें और केवल एक चल सके तो बड़ा पासा चलें। सभी गोटियाँ घर हों तभी निकालें। मंच के सामान्य नियम लागू हैं: 120 बारी या 300 क्रियाओं के बाद अधिक गोटियाँ निकालने वाला जीतेगा; बराबरी पर पहला खिलाड़ी जीतेगा।',
    'أوصل 15 حجرًا إلى بيتك ثم أخرجها. ارم نردين؛ المتساويان يمنحان أربع نقلات. أعد أحجار الحاجز أولًا. حجران للخصم يسدان النقطة، والحجر المنفرد يُضرب. استخدم أكبر عدد ممكن من النرد، والأكبر إذا أمكن استعمال واحد فقط. أخرج الأحجار بعد دخولها كلها البيت. قواعد المنصة العادية: بعد 120 دورًا أو 300 حركة يفوز الأكثر إخراجًا؛ التعادل للأول.',
]
UI_RULES = [
    'Tap either highlighted die in the center to roll. Used dice turn gray; doubles gray one half per move. Then select a highlighted checker and a highlighted destination, or drag it there. Only the top movable checker is highlighted. The bar and off tray are shown beside the 24 points. Pinch to zoom in or out. Moves animate in online and computer games; pass-and-play keeps changes immediate.',
    'Toca un dado resaltado del centro para lanzar. Los dados usados se vuelven grises; los dobles atenúan una mitad por movimiento. Después selecciona una ficha resaltada y un destino resaltado, o arrástrala allí. Solo se resalta la ficha superior que puede moverse. La barra y la bandeja están junto a las 24 puntas. Pellizca para ampliar o reducir. Las jugadas se animan en línea y contra el ordenador; en el mismo dispositivo son inmediatas.',
    'Touchez un dé surligné au centre pour lancer. Les dés utilisés deviennent gris ; un double grise une moitié par déplacement. Puis choisissez un pion surligné et une destination surlignée, ou glissez-le. Seul le pion supérieur mobile est surligné. Barre et sortie sont près des 24 flèches. Pincez pour zoomer. Les coups sont animés en ligne et contre l’ordinateur ; le jeu à tour de rôle sur un appareil est immédiat.',
    'Tippe zum Würfeln auf einen markierten Würfel in der Mitte. Verbrauchte Würfel werden grau; beim Pasch wird pro Zug eine Hälfte grau. Wähle dann einen markierten Stein und ein markiertes Ziel oder ziehe ihn dorthin. Nur der oberste bewegliche Stein ist markiert. Bar und Ablage stehen neben den 24 Spitzen. Mit zwei Fingern zoomen. Online- und Computerzüge werden animiert; am selben Gerät erfolgen sie sofort.',
    'Toque em um dado destacado no centro para lançar. Dados usados ficam cinza; duplas ficam meio cinza por movimento. Depois selecione uma peça destacada e um destino destacado, ou arraste-a. Só a peça superior móvel fica destacada. Barra e saída aparecem junto às 24 pontas. Faça pinça para ampliar ou reduzir. Jogadas online e contra computador são animadas; no mesmo aparelho são imediatas.',
    '点击中央高亮骰子来掷骰。已使用的骰子变灰；双骰每走一步将一半变灰。然后选择高亮棋子和高亮目标，或拖动棋子。仅可移动的顶层棋子高亮。24个尖点旁显示中栏和移出盘。双指捏合缩放。在线和电脑对局显示移动动画，同机轮流对局即时更新。',
    'फेंकने के लिए बीच के किसी चमकते पासे को छुएँ। इस्तेमाल हुए पासे धूसर होते हैं; समान अंकों पर हर चाल के बाद आधा पासा धूसर होता है। फिर चमकती गोटी और लक्ष्य चुनें या वहाँ खींचें। केवल ऊपर की चलने योग्य गोटी चमकती है। 24 बिंदुओं के पास बार और निकासी ट्रे हैं। दो उँगलियों से ज़ूम करें। ऑनलाइन और कंप्यूटर चालें चलती दिखेंगी; एक उपकरण पर बारी-बारी खेल तुरंत बदलेगा।',
    'المس أحد النردين المميزين في الوسط للرمي. يصير النرد المستعمل رماديًا؛ وعند التساوي يُظلل نصف نرد لكل نقلة. ثم اختر حجرًا مميزًا ووجهة مميزة أو اسحبه إليها. يُميز الحجر العلوي القابل للنقل فقط. يظهر الحاجز وصينية الخروج بجانب النقاط الـ24. اقرص بإصبعين للتكبير والتصغير. تتحرك الأحجار بصريًا عبر الإنترنت وضد الكمبيوتر؛ اللعب بالتناوب على الجهاز فوري.',
]
TEXTS = {
    'player': ['Player {n}', 'Jugador {n}', 'Joueur {n}', 'Spieler {n}', 'Jogador {n}', '玩家{n}', 'खिलाड़ी {n}', 'اللاعب {n}'],
    'winner': ['{name} wins', 'Gana {name}', '{name} gagne', '{name} gewinnt', '{name} venceu', '{name}获胜', '{name} जीते', 'فاز {name}'],
    'roll_turn': ['{name}: roll the dice', '{name}: lanza los dados', '{name} : lancez les dés', '{name}: würfeln', '{name}: lance os dados', '{name}：掷骰', '{name}: पासे फेंकें', '{name}: ارم النرد'],
    'move_turn': ['{name}: move a highlighted checker', '{name}: mueve una ficha resaltada', '{name} : déplacez un pion surligné', '{name}: markierten Stein bewegen', '{name}: mova uma peça destacada', '{name}：移动高亮棋子', '{name}: चमकती गोटी चलें', '{name}: انقل حجرًا مميزًا'],
    'roll': ['Roll dice', 'Lanzar dados', 'Lancer les dés', 'Würfeln', 'Lançar dados', '掷骰', 'पासे फेंकें', 'ارم النرد'],
    'die_roll': ['Die {n}: roll dice', 'Dado {n}: lanzar dados', 'Dé {n} : lancer les dés', 'Würfel {n}: würfeln', 'Dado {n}: lançar dados', '骰子{n}：掷骰', 'पासा {n}: पासे फेंकें', 'النرد {n}: ارم النرد'],
    'die_ready': ['Die {n}: waiting to roll', 'Dado {n}: esperando lanzamiento', 'Dé {n} : en attente du lancer', 'Würfel {n}: wartet auf Wurf', 'Dado {n}: aguardando lançamento', '骰子{n}：等待掷骰', 'पासा {n}: फेंकने की प्रतीक्षा', 'النرد {n}: بانتظار الرمية'],
    'die_value': ['Die {n}: {value}', 'Dado {n}: {value}', 'Dé {n} : {value}', 'Würfel {n}: {value}', 'Dado {n}: {value}', '骰子{n}：{value}', 'पासा {n}: {value}', 'النرد {n}: {value}'],
    'die_used': ['Die {n}: {value}, used', 'Dado {n}: {value}, usado', 'Dé {n} : {value}, utilisé', 'Würfel {n}: {value}, verbraucht', 'Dado {n}: {value}, usado', '骰子{n}：{value}，已使用', 'पासा {n}: {value}, इस्तेमाल हुआ', 'النرد {n}: {value}، مستعمل'],
    'die_half_used': ['Die {n}: {value}, one of two moves used', 'Dado {n}: {value}, uno de dos movimientos usado', 'Dé {n} : {value}, un déplacement sur deux utilisé', 'Würfel {n}: {value}, einer von zwei Zügen verbraucht', 'Dado {n}: {value}, um de dois movimentos usado', '骰子{n}：{value}，已使用两步中的一步', 'पासा {n}: {value}, दो में से एक चाल इस्तेमाल हुई', 'النرد {n}: {value}، استُعملت نقلة من نقلتين'],
    'die_unknown': ['Die {n}: previous value unknown', 'Dado {n}: valor anterior desconocido', 'Dé {n} : valeur précédente inconnue', 'Würfel {n}: vorheriger Wert unbekannt', 'Dado {n}: valor anterior desconhecido', '骰子{n}：先前点数未知', 'पासा {n}: पिछला अंक अज्ञात', 'النرد {n}: القيمة السابقة غير معروفة'],
    'moves_remaining': ['Moves remaining: {count}', 'Movimientos restantes: {count}', 'Déplacements restants : {count}', 'Verbleibende Züge: {count}', 'Movimentos restantes: {count}', '剩余步数：{count}', 'शेष चालें: {count}', 'النقلات المتبقية: {count}'],
    'pass': ['Pass', 'Pasar', 'Passer', 'Passen', 'Passar', '跳过', 'बारी छोड़ें', 'مرر'],
    'point': ['Point {n}', 'Punta {n}', 'Flèche {n}', 'Spitze {n}', 'Ponta {n}', '点{n}', 'बिंदु {n}', 'النقطة {n}'],
    'bear_off': ['Bear off', 'Retirar', 'Sortir', 'Auswürfeln', 'Retirar', '移出', 'बाहर निकालें', 'أخرج'],
    'bar': ['Bar', 'Barra', 'Barre', 'Bar', 'Barra', '中栏', 'बार', 'الحاجز'],
    'off': ['Off', 'Fuera', 'Sortie', 'Aus', 'Fora', '移出', 'बाहर', 'الخروج'],
    'off_count': ['Borne off: {a} / {b}', 'Retiradas: {a} / {b}', 'Sortis : {a} / {b}', 'Ausgewürfelt: {a} / {b}', 'Retiradas: {a} / {b}', '已移出：{a} / {b}', 'निकली: {a} / {b}', 'الخارج: {a} / {b}'],
    'white': ['White: toward point 1', 'Blancas: hacia la punta 1', 'Blancs : vers la flèche 1', 'Weiß: Richtung Spitze 1', 'Brancas: rumo à ponta 1', '白方：向点1', 'सफेद: बिंदु 1 की ओर', 'الأبيض: نحو النقطة 1'],
    'black': ['Black: toward point 24', 'Negras: hacia la punta 24', 'Noirs : vers la flèche 24', 'Schwarz: Richtung Spitze 24', 'Pretas: rumo à ponta 24', '黑方：向点24', 'काला: बिंदु 24 की ओर', 'الأسود: نحو النقطة 24'],
    'server_unknown_player': ['unknown player', 'jugador desconocido', 'joueur inconnu', 'unbekannter Spieler', 'jogador desconhecido', '未知玩家', 'अज्ञात खिलाड़ी', 'لاعب غير معروف'],
    'server_game_over': ['game over', 'partida terminada', 'partie terminée', 'Spiel beendet', 'jogo encerrado', '游戏结束', 'खेल समाप्त', 'انتهت اللعبة'],
    'server_not_your_turn': ['not your turn', 'no es tu turno', 'ce n’est pas votre tour', 'du bist nicht dran', 'não é sua vez', '未轮到你', 'आपकी बारी नहीं', 'ليس دورك'],
    'server_already_rolled': ['already rolled', 'ya has lanzado', 'déjà lancé', 'bereits gewürfelt', 'já lançou', '已掷骰', 'पासे फेंके जा चुके', 'رميت بالفعل'],
    'server_roll_first': ['roll first', 'lanza primero', 'lancez d’abord', 'zuerst würfeln', 'lance primeiro', '请先掷骰', 'पहले पासे फेंकें', 'ارم أولًا'],
    'server_moves_available': ['moves available', 'hay jugadas disponibles', 'coups disponibles', 'Züge verfügbar', 'há jogadas disponíveis', '仍有可行着法', 'चालें उपलब्ध हैं', 'توجد نقلات'],
    'server_no_moves': ['no moves', 'sin jugadas', 'aucun coup', 'keine Züge', 'sem jogadas', '无着法', 'कोई चाल नहीं', 'لا توجد نقلات'],
    'server_bad_from': ['bad from', 'origen incorrecto', 'départ incorrect', 'ungültiger Start', 'origem inválida', '起点错误', 'गलत स्रोत', 'مصدر غير صالح'],
    'server_bad_to': ['bad to', 'destino incorrecto', 'arrivée incorrecte', 'ungültiges Ziel', 'destino inválido', '终点错误', 'गलत लक्ष्य', 'وجهة غير صالحة'],
    'server_illegal_move': ['illegal move', 'jugada ilegal', 'coup interdit', 'ungültiger Zug', 'jogada ilegal', '非法着法', 'अवैध चाल', 'نقلة غير قانونية'],
    'server_unknown_move': ['unknown move', 'jugada desconocida', 'coup inconnu', 'unbekannter Zug', 'jogada desconhecida', '未知着法', 'अज्ञात चाल', 'نقلة غير معروفة'],
}


def strings(index=0):
    return {'title': TITLES[index] + ' (Declarative)', **{key: values[index] for key, values in TEXTS.items()}}


def source_schemas():
    schemas = json.loads((DEST / 'backgammon.schema.json').read_text())
    # The old inferred contract omitted "off" and admitted arbitrary fields.
    # Describe exactly the authority's three move shapes, including bearing off;
    # clients cannot submit state/dice overrides. The reviewed wrapper below
    # adds public roll metadata without changing the canonical game's rules.
    coordinate = {'type': 'integer', 'minimum': 0, 'maximum': 23}
    schemas['move'] = {'$schema': 'https://json-schema.org/draft/2020-12/schema',
        'oneOf': [
            {'type': 'object', 'required': ['action'], 'additionalProperties': False,
             'properties': {'action': {'enum': ['roll', 'pass']}}},
            {'type': 'object', 'required': ['action', 'from', 'to'], 'additionalProperties': False,
             'properties': {'action': {'const': 'move'},
                            'from': {'anyOf': [coordinate, {'const': 'bar'}]},
                            'to': {'anyOf': [coordinate, {'const': 'off'}]}}}]}
    roll = {'type': ['object', 'null'], 'additionalProperties': False,
            'required': ['seat', 'turn', 'values', 'move_count'],
            'properties': {'seat': {'type': 'integer', 'minimum': 0, 'maximum': 1},
                           'turn': {'type': 'integer', 'minimum': 0},
                           'values': {'type': 'array', 'minItems': 2, 'maxItems': 2,
                                      'items': {'type': 'integer', 'minimum': 1, 'maximum': 6}},
                           'move_count': {'type': 'integer', 'minimum': 1}}}
    for name in ('state', 'view'):
        schemas[name]['properties']['last_roll'] = copy.deepcopy(roll)
    schemas['view']['properties']['combinedMoves'] = {
        'type': 'array', 'maxItems': 100,
        'items': {'type': 'object', 'required': ['from', 'to'], 'additionalProperties': False,
                  'properties': {'from': {'anyOf': [coordinate, {'const': 'bar'}]},
                                 'to': {'anyOf': [coordinate, {'const': 'off'}]}}},
    }
    return schemas


def point_x(point):
    col = 11 - point if point < 12 else point - 12
    return 36 + col * 52 + (28 if col >= 6 else 0)


def board_svg():
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 440">',
             '<rect width="700" height="440" rx="10" fill="#704528"/>',
             '<rect x="12" y="12" width="676" height="416" fill="#d2b17d"/>',
             '<rect x="316" y="12" width="40" height="416" fill="#704528"/>']
    for point in range(24):
        x = point_x(point)
        y, tip = (18, 190) if point >= 12 else (422, 250)
        color = '#853f30' if point % 2 else '#e8d5ab'
        parts.append(f'<path d="M{x-24},{y}L{x+24},{y}L{x},{tip}Z" fill="{color}"/>')
        parts.append(f'<text x="{x}" y="{10 if point>=12 else 437}" text-anchor="middle" font-size="10" fill="#fff4de">{point+1}</text>')
    parts.append('</svg>')
    return ''.join(parts)


def die_svg(value, used=0):
    """A physical die; doubles spend one half for each of their four moves."""
    positions = {
        1: [(32, 32)], 2: [(17, 17), (47, 47)],
        3: [(17, 17), (32, 32), (47, 47)],
        4: [(17, 17), (47, 17), (17, 47), (47, 47)],
        5: [(17, 17), (47, 17), (32, 32), (17, 47), (47, 47)],
        6: [(17, 17), (47, 17), (17, 32), (47, 32), (17, 47), (47, 47)],
    }
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
             '<defs><clipPath id="face"><rect x="1" y="1" width="62" height="62" rx="8"/></clipPath></defs>',
             '<rect x="1" y="1" width="62" height="62" rx="8" fill="#fff9ec" stroke="#6e5135" stroke-width="2"/>']
    if value:
        parts.extend(f'<circle cx="{x}" cy="{y}" r="5" fill="#342924"/>' for x, y in positions[value])
    else:
        parts.append('<text x="32" y="34" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-size="38" font-weight="700" fill="#6e5135">?</text>')
    if used:
        parts.append(f'<rect x="0" y="0" width="{32 if used == 1 else 64}" height="64" fill="#64717b" opacity=".72" clip-path="url(#face)"/>')
    parts.append('</svg>')
    return ''.join(parts)


def specification():
    artwork = board_svg()
    assets = {'board_art': {'uri': 'data:image/svg+xml;base64,' + base64.b64encode(artwork.encode()).decode(), 'media_type': 'image/svg+xml'}}
    for value in range(7):
        for used in range(3):
            assets[f'die_{value}_used_{used}'] = {
                'uri': 'data:image/svg+xml;base64,' + base64.b64encode(die_svg(value, used).encode()).decode(),
                'media_type': 'image/svg+xml',
            }
    return {'format': 'buildplay-ui', 'version': 1, 'viewport': {'width': 800, 'height': 600},
            'assets': assets,
            'boards': [
                {'id': 'main', 'kind': 'graph', 'x': 20, 'y': 105, 'width': 700, 'height': 440,
                 'color': '#704528', 'line_color': '#704528', 'background_asset': 'board_art',
                 'cells': [{'id': str(point), 'x': point_x(point), 'y': 237 if point < 12 else 203,
                            'color': '#d2b17d'} for point in range(24)]},
                {'id': 'off', 'kind': 'zone', 'x': 736, 'y': 105, 'width': 48, 'height': 440,
                 'color': '#46321f', 'line_color': '#d2b17d'}],
            'piece_types': {
                'p0': {'shape': 'circle', 'width': 38, 'height': 38, 'color': '#fff0cf', 'text_color': '#3b291e', 'border_color': '#865f38'},
                'p1': {'shape': 'circle', 'width': 38, 'height': 38, 'color': '#342924', 'text_color': '#fff0cf', 'border_color': '#c49d66'},
                'die': {'shape': 'image', 'width': 64, 'height': 64}},
            'strings': strings(), 'ui_code': 'const SOURCE_STRINGS=' + json.dumps(strings(), ensure_ascii=False) + ';\n' + (DEST / 'backgammon.ui.js').read_text()}


def illustration(view, caption):
    parts = [board_svg().replace('</svg>', '')]
    for point, count in enumerate(view['cnt']):
        for index in range(min(count, 5)):
            y = 32 + index * 31 if point >= 12 else 408 - index * 31
            color = '#fff0cf' if view['owner'][point] == 0 else '#342924'
            parts.append(f'<circle cx="{point_x(point)}" cy="{y}" r="18" fill="{color}" stroke="#865f38"/>')
    for seat in range(2):
        color = '#fff0cf' if seat == 0 else '#342924'
        for i in range(min(view['bar'][seat], 5)):
            parts.append(f'<circle cx="336" cy="{35+i*31 if seat==0 else 405-i*31}" r="18" fill="{color}" stroke="#865f38"/>')
    parts.append('</svg>')
    return {'caption': caption, 'svg': ''.join(parts)}


def package_with_fixtures():
    code = (ROOT / 'games/declarative/backgammon.server.js').read_text()
    if hashlib.sha256(code.encode()).hexdigest() != SOURCE_SHA256:
        raise RuntimeError('Ordinary Backgammon authority changed; audit source identity before rebuilding')
    code += '\n' + (DEST / 'backgammon-roll-history.js').read_text()
    code += '\n' + (DEST / 'backgammon-combined-moves.js').read_text()
    schemas = source_schemas()
    logic = GameLogic(code, game_schemas=schemas)
    ctx = {'players': [{'id': 'u1', 'kind': 'human', 'display_name': 'Alice', 'picture_url': '', 'max_loss': 0, 'active': True},
                       {'id': 'u2', 'kind': 'human', 'display_name': 'Bob', 'picture_url': '', 'max_loss': 0, 'active': True}], 'pot': 0, 'move_count': 0}
    result = logic.call('newMatch', ctx=ctx, seed=7)
    steps = []
    for i in range(320):
        ctx['move_count'] = i
        state, pid, seed = result['state'], result['turn'][0], i + 11
        move = logic.call('computerMove', state, pid, ctx=ctx, seed=seed)
        result = logic.call('applyMove', state, pid, move, ctx=ctx, seed=seed)
        steps.append((copy.deepcopy(ctx), state, pid, move, result, seed))
        if result['turn'] is None:
            break
    else:
        raise RuntimeError('Backgammon did not finish')
    cases = []
    selected = [(kind, kind.title() + ' move', steps[index]) for kind, index in
                [('initial', 0), ('terminal', len(steps) - 1)]]
    for label, own, enemy, dice, bar, move in [
        ('Hit a blot', {6: 1}, {5: 1, 23: 14}, [1], 0, {'action': 'move', 'from': 6, 'to': 5}),
        ('Re-enter from bar', {}, {21: 2, 19: 13}, [1, 2], 1, {'action': 'move', 'from': 'bar', 'to': 22}),
        ('Bear off', {0: 1, 1: 1}, {20: 15}, [1, 2], 0, {'action': 'move', 'from': 0, 'to': 'off'}),
        ('Combined four ones', {9: 1}, {23: 15}, [1, 1, 1, 1], 0, {'action': 'move', 'from': 9, 'to': 5}),
        ('Combined one and four', {9: 1}, {23: 15}, [1, 4], 0, {'action': 'move', 'from': 9, 'to': 4}),
        ('Forced combined hit', {9: 1}, {5: 2, 8: 1, 23: 12}, [1, 4], 0, {'action': 'move', 'from': 9, 'to': 4}),
        ('Ambiguous combined hit stays single', {10: 1}, {9: 1, 6: 1, 23: 13}, [1, 4], 0, {'action': 'move', 'from': 10, 'to': 9}),
    ]:
        case_ctx = {**ctx, 'move_count': 10}
        state = logic.call('newMatch', ctx=case_ctx, seed=7)['state']
        state.update(owner=[-1] * 24, cnt=[0] * 24, bar=[bar, 0],
                     off=[15-sum(own.values())-bar, 15-sum(enemy.values())],
                     cur=0, dice=dice, moves=dice, needRoll=False)
        for seat, counts in enumerate([own, enemy]):
            for point, count in counts.items():
                state['owner'][point], state['cnt'][point] = seat, count
        after = logic.call('applyMove', state, 'u1', move, ctx=case_ctx, seed=7)
        selected.append(('intermediate', label, (case_ctx, state, 'u1', move, after, 7)))
    for kind, label, (case_ctx, state, pid, move, after, seed) in selected:
        before_views = [logic.call('viewFor', state, who, ctx=case_ctx, seed=seed) for who in (pid, None)]
        after_views = [logic.call('viewFor', after['state'], who, ctx={**case_ctx, 'move_count': case_ctx['move_count'] + 1}, seed=seed) for who in (pid, None)]
        case = {'name': label, 'description': RULES[0], 'kind': kind,
                'ctx': {**case_ctx, 'seed': seed}, 'state': state, 'view_of_mover': before_views[0], 'view_of_other': before_views[1],
                'player_id': pid, 'other_player_id': None, 'move': move, 'expected_state': after['state'], 'expected_turn': after['turn'],
                'expected_view_of_mover': after_views[0], 'expected_view_of_other': after_views[1],
                'images': [illustration(view, caption) for view, caption in zip(before_views + after_views,
                           ['Before: mover', 'Before: spectator', 'After: mover', 'After: spectator'])]}
        if 'payouts' in after:
            case['expected_payouts'] = after['payouts']
        cases.append(case)
    cover = re.sub(r'<text\b[^>]*>.*?</text>', '', cases[0]['images'][0]['svg'])
    cover = re.sub(r'^<svg\b[^>]*>', '', cover).removesuffix('</svg>')
    cover = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#342924"/><g transform="translate(50 5)">' + cover + '</g></svg>'
    combined_cases = cases[-4:]
    # Import artifacts allow at most four intermediate cases. Keep canonical
    # hit/bar/off coverage and one combined gesture in the public submission;
    # retain every compound regression in a separately generated test fixture.
    cases = cases[:-3]
    payload = {'name': TITLES[0] + ' (Declarative)', 'description': RULES[0], 'allowed_player_counts': [2],
            'server_code': code, 'declarative_ui': specification(),
            'game_addition_request_id_and_secret': 'example-only-declarative-backgammon-replace-before-publishing',
            'rules': RULES[0], 'ui_instructions': UI_RULES[0],
            'tutorial': {'text': RULES[0], 'html': '<meta name="viewport" content="width=device-width,initial-scale=1"><p>' + html.escape(RULES[0]) + '</p>'},
            'images': [{'caption': 'Cover', 'svg': cover}, *cases[0]['images'][:3]],
            'unit_tests': {**{key + '_schema': value for key, value in schemas.items()}, 'cases': cases},
            'translations': {locale: {'display_name': TITLES[i] + ' (Declarative)', 'short_description': RULES[i],
                                      'game_logic_rules': RULES[i], 'game_ui_rules': UI_RULES[i],
                                      'tutorial_strings': {RULES[0]: RULES[i]}, 'client_strings': strings(i)}
                             for i, locale in enumerate(LOCALES) if i}}
    return payload, combined_cases


def package():
    return package_with_fixtures()[0]


def main():
    payload, combined_cases = package_with_fixtures()
    target = DEST / 'backgammon.json'
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    (ROOT / 'static' / 'backgammon-declarative-ui.json').write_text(
        json.dumps(payload['declarative_ui'], ensure_ascii=False, indent=2) + '\n')
    (ROOT / 'tests/fixtures/declarative/backgammon-combined-cases.json').write_text(
        json.dumps(combined_cases, ensure_ascii=False, indent=2) + '\n')
    authority = hashlib.sha256(payload['server_code'].encode()).hexdigest()
    print(f'{target.name}: {len(json.dumps(payload).encode())} bytes; base authority SHA256 {SOURCE_SHA256}; bundled authority SHA256 {authority}')


if __name__ == '__main__':
    main()
