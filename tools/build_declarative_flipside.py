"""Build the declarative Flipside Lords package (based on The Duke).

Run from the package parent:
  python -m game_platform.tools.build_declarative_flipside
The checked-in submission secret is only an example; replace it when publishing.
"""
from __future__ import annotations

import base64
import copy
import html
import json
import re
from pathlib import Path

from game_platform.game_logic import GameLogic

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'games' / 'declarative'
KIND = 'flipside'
LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
TITLES = ['Flipside Lords', 'Señores Reversos', 'Seigneurs Réversibles', 'Wendeherren', 'Senhores do Verso', '翻面领主', 'पलटते सामंत', 'أسياد الوجهين']
RULES = [
    'Based on The Duke. Two lords fight on a 6×6 board with troop tiles. Each tile shows a movement grid, and after it acts it flips to its other side, which has a different grid. On your turn either move one tile using its grid (move, jump, slide, strike from afar, or command a nearby troop), or draw a random troop from your bag and place it beside your Lord. You may never leave your Lord where it could be taken next turn. If your rival cannot make a safe move, you win. Setup: each Lord starts in the middle of its home row with two Footmen beside it.',
    'Basado en The Duke. Dos señores luchan en un tablero de 6×6 con fichas de tropa. Cada ficha muestra una cuadrícula de movimiento y, tras actuar, se voltea a su otra cara, con otra cuadrícula. En tu turno mueve una ficha según su cuadrícula (mover, saltar, deslizar, golpear a distancia o dar una orden a una tropa cercana), o saca una tropa al azar de tu bolsa y colócala junto a tu Señor. Nunca puedes dejar a tu Señor donde pueda ser capturado el turno siguiente. Si tu rival no tiene un movimiento seguro, ganas. Preparación: cada Señor empieza en el centro de su fila con dos Infantes al lado.',
    'D’après The Duke. Deux seigneurs s’affrontent sur un plateau de 6×6 avec des tuiles de troupe. Chaque tuile montre une grille de déplacement et, après avoir agi, se retourne sur son autre face, à la grille différente. À votre tour, déplacez une tuile selon sa grille (avancer, sauter, glisser, frapper à distance ou commander une troupe voisine), ou tirez une troupe au hasard de votre sac et posez-la à côté de votre Seigneur. Vous ne pouvez jamais laisser votre Seigneur là où il serait pris au tour suivant. Si votre rival n’a aucun coup sûr, vous gagnez. Mise en place : chaque Seigneur commence au milieu de sa rangée avec deux Fantassins à côté.',
    'Nach The Duke. Zwei Herren kämpfen auf einem 6×6-Brett mit Truppenplättchen. Jedes Plättchen zeigt ein Bewegungsraster und wird nach seiner Aktion auf die andere Seite mit anderem Raster gewendet. In deinem Zug bewegst du ein Plättchen nach seinem Raster (ziehen, springen, gleiten, aus der Ferne schlagen oder eine Truppe in der Nähe befehligen) oder ziehst eine zufällige Truppe aus deinem Beutel und legst sie neben deinen Herrn. Du darfst deinen Herrn nie so stehen lassen, dass er im nächsten Zug geschlagen werden kann. Hat dein Gegner keinen sicheren Zug, gewinnst du. Aufbau: Jeder Herr beginnt in der Mitte seiner Grundreihe mit zwei Fußsoldaten daneben.',
    'Baseado em The Duke. Dois senhores lutam num tabuleiro de 6×6 com peças de tropa. Cada peça mostra uma grade de movimento e, depois de agir, vira para o outro lado, com outra grade. Na sua vez, mova uma peça pela grade (mover, saltar, deslizar, golpear à distância ou comandar uma tropa vizinha) ou tire uma tropa ao acaso do seu saco e coloque-a ao lado do seu Senhor. Você nunca pode deixar o seu Senhor onde ele possa ser capturado no turno seguinte. Se o rival não tiver um lance seguro, você vence. Preparação: cada Senhor começa no meio da sua fileira com dois Infantes ao lado.',
    '改编自 The Duke（公爵）。两位领主在 6×6 棋盘上用兵牌作战。每块兵牌都印有移动网格，行动后翻到另一面，网格也随之改变。轮到你时，按网格移动一块兵牌（移动、跳跃、滑行、远程打击或指挥附近的部队），或从袋中随机抽一块兵牌放在领主旁边。你绝不能让领主处于下一回合可被吃掉的位置。若对手没有安全的走法，你就获胜。布阵：每位领主从本方底线中间开始，两侧各有一名步兵。',
    'द ड्यूक पर आधारित। दो सामंत 6×6 बोर्ड पर सैनिक टाइलों से लड़ते हैं। हर टाइल पर चाल का जाल होता है और चलने के बाद वह पलटकर दूसरी तरफ़ आ जाती है, जिसका जाल अलग है। अपनी बारी में एक टाइल उसके जाल से चलाएँ (चलना, कूदना, फिसलना, दूर से वार करना या पास की टुकड़ी को आदेश देना), या अपने थैले से कोई टुकड़ी निकालकर अपने सामंत के पास रखें। अपने सामंत को कभी ऐसी जगह न छोड़ें जहाँ अगली बारी में वह पकड़ा जा सके। अगर विरोधी के पास कोई सुरक्षित चाल न बचे, तो आप जीतते हैं। शुरुआत: हर सामंत अपनी पिछली पंक्ति के बीच में, बगल में दो पैदल सैनिकों के साथ।',
    'مبنية على The Duke. سيدان يتقاتلان على لوح 6×6 ببلاطات الجنود. تحمل كل بلاطة شبكة حركة، وبعد أن تتحرك تنقلب إلى وجهها الآخر بشبكة مختلفة. في دورك حرّك بلاطة وفق شبكتها (تحرك، قفز، انزلاق، ضربة من بعيد، أو أمر لجندي قريب)، أو اسحب جنديًا عشوائيًا من كيسك وضعه بجانب سيدك. لا يجوز أن تترك سيدك حيث يمكن أسره في الدور التالي. إذا لم يكن لخصمك أي حركة آمنة فأنت الفائز. البداية: يبدأ كل سيد في وسط صفه الخلفي ومعه جنديا مشاة بجانبه.',
]
UI_RULES = [
    'Setup: tap a glowing square for your Lord, then two squares beside it for your Footmen. Play: tap one of your tiles to see its moves (green ring: move, red ring: capture, red star: strike from afar, blue diamond: command), then tap a highlight. To bring in a troop, press Draw a troop and tap a square beside your Lord. Select a tile and use the flip tool (or press F) to see its other side.',
    'Preparación: toca una casilla iluminada para tu Señor y luego dos casillas a su lado para los Infantes. Juego: toca una de tus fichas para ver sus movimientos (aro verde: mover, aro rojo: capturar, estrella roja: golpe a distancia, rombo azul: orden) y toca un resaltado. Para traer una tropa, pulsa Sacar tropa y toca una casilla junto a tu Señor. Selecciona una ficha y usa la herramienta de voltear (o F) para ver su otra cara.',
    'Mise en place : touchez une case lumineuse pour votre Seigneur, puis deux cases à côté pour les Fantassins. Jeu : touchez une de vos tuiles pour voir ses coups (anneau vert : avancer, anneau rouge : prendre, étoile rouge : frappe à distance, losange bleu : ordre), puis touchez une case en surbrillance. Pour ajouter une troupe, appuyez sur Tirer une troupe et touchez une case à côté de votre Seigneur. Sélectionnez une tuile et utilisez l’outil retourner (ou F) pour voir son autre face.',
    'Aufbau: Tippe auf ein leuchtendes Feld für deinen Herrn, dann auf zwei Felder daneben für die Fußsoldaten. Spiel: Tippe auf eines deiner Plättchen, um seine Züge zu sehen (grüner Ring: ziehen, roter Ring: schlagen, roter Stern: Fernschlag, blaue Raute: Befehl), dann auf eine Markierung. Für eine neue Truppe drücke Truppe ziehen und tippe auf ein Feld neben deinem Herrn. Wähle ein Plättchen und nutze das Wenden-Werkzeug (oder F), um seine andere Seite zu sehen.',
    'Preparação: toque numa casa iluminada para o seu Senhor e depois em duas casas ao lado para os Infantes. Jogo: toque numa das suas peças para ver os lances (anel verde: mover, anel vermelho: capturar, estrela vermelha: golpe à distância, losango azul: comando) e toque num destaque. Para trazer uma tropa, pressione Tirar tropa e toque numa casa ao lado do seu Senhor. Selecione uma peça e use a ferramenta de virar (ou F) para ver o outro lado.',
    '布阵：点击发光的格子放领主，再点它旁边的两个格子放步兵。对局：点击你的兵牌查看走法（绿圈：移动，红圈：吃子，红星：远程打击，蓝菱形：指挥），再点高亮格。要增兵，按“抽取兵牌”，再点领主旁边的格子。选中兵牌后用翻面工具（或按 F）查看它的另一面。',
    'शुरुआत: अपने सामंत के लिए चमकता खाना छुएँ, फिर उसके पास दो खाने पैदल सैनिकों के लिए। खेल: अपनी किसी टाइल को छूकर उसकी चालें देखें (हरा घेरा: चलना, लाल घेरा: पकड़ना, लाल तारा: दूर से वार, नीला हीरा: आदेश), फिर किसी निशान को छुएँ। नई टुकड़ी के लिए टुकड़ी निकालें दबाएँ और सामंत के पास का खाना छुएँ। टाइल चुनकर पलटने का औज़ार (या F) इस्तेमाल करें ताकि दूसरी तरफ़ दिखे।',
    'البداية: المس مربعًا مضيئًا لسيدك، ثم مربعين بجانبه لجنديي المشاة. اللعب: المس إحدى بلاطاتك لترى حركاتها (حلقة خضراء: تحرك، حلقة حمراء: أسر، نجمة حمراء: ضربة من بعيد، معين أزرق: أمر)، ثم المس مربعًا مضيئًا. لإدخال جندي اضغط اسحب جنديًا والمس مربعًا بجانب سيدك. حدد بلاطة واستخدم أداة القلب (أو F) لرؤية وجهها الآخر.',
]
UNITS = {
    'duke': ['Lord', 'Señor', 'Seigneur', 'Herr', 'Senhor', '领主', 'सामंत', 'السيد'],
    'footman': ['Footman', 'Infante', 'Fantassin', 'Fußsoldat', 'Infante', '步兵', 'पैदल सैनिक', 'جندي مشاة'],
    'pikeman': ['Pikeman', 'Piquero', 'Piquier', 'Pikenier', 'Piqueiro', '长枪兵', 'भालाधारी', 'رامح'],
    'knight': ['Knight', 'Caballero', 'Chevalier', 'Ritter', 'Cavaleiro', '骑士', 'शूरवीर', 'فارس'],
    'wizard': ['Wizard', 'Mago', 'Magicien', 'Zauberer', 'Mago', '巫师', 'जादूगर', 'ساحر'],
    'ranger': ['Ranger', 'Explorador', 'Éclaireur', 'Waldläufer', 'Patrulheiro', '游侠', 'वनरक्षक', 'جوّال'],
    'seer': ['Seer', 'Vidente', 'Voyant', 'Seher', 'Vidente', '先知', 'द्रष्टा', 'عرّاف'],
    'general': ['General', 'General', 'Général', 'General', 'General', '将军', 'सेनापति', 'جنرال'],
    'priest': ['Priest', 'Sacerdote', 'Prêtre', 'Priester', 'Sacerdote', '祭司', 'पुजारी', 'كاهن'],
    'champion': ['Champion', 'Campeón', 'Champion', 'Recke', 'Campeão', '勇士', 'योद्धा', 'بطل'],
    'marshall': ['Marshal', 'Mariscal', 'Maréchal', 'Marschall', 'Marechal', '元帅', 'मार्शल', 'مارشال'],
    'bowman': ['Bowman', 'Arquero', 'Archer', 'Bogenschütze', 'Arqueiro', '弓手', 'धनुर्धर', 'رامي سهام'],
}
TEXTS = {
    'light': ['Ivory', 'Marfil', 'Ivoire', 'Elfenbein', 'Marfim', '象牙', 'हाथीदाँत', 'العاجي'],
    'dark': ['Walnut', 'Nogal', 'Noyer', 'Nussbaum', 'Nogueira', '胡桃', 'अखरोट', 'الجوزي'],
    'seat_name': ['{color} · {name}'] * 8,
    'you': ['{name} (you)', '{name} (tú)', '{name} (vous)', '{name} (du)', '{name} (você)', '{name}（你）', '{name} (आप)', '{name} (أنت)'],
    'player': ['Player {n}', 'Jugador {n}', 'Joueur {n}', 'Spieler {n}', 'Jogador {n}', '玩家{n}', 'खिलाड़ी {n}', 'اللاعب {n}'],
    'board_name': ['Battlefield', 'Campo de batalla', 'Champ de bataille', 'Schlachtfeld', 'Campo de batalha', '战场', 'रणभूमि', 'ساحة المعركة'],
    'last_from': ['Last move from {square}', 'Último movimiento desde {square}', 'Dernier coup depuis {square}', 'Letzter Zug von {square}', 'Último lance de {square}', '上一步从{square}', 'पिछली चाल {square} से', 'آخر حركة من {square}'],
    'last_to': ['Last move to {square}', 'Último movimiento a {square}', 'Dernier coup vers {square}', 'Letzter Zug nach {square}', 'Último lance para {square}', '上一步到{square}', 'पिछली चाल {square} तक', 'آخر حركة إلى {square}'],
    'tile_at': ['{unit} of {name} ({side}) on {square}', '{unit} de {name} ({side}) en {square}', '{unit} de {name} ({side}) en {square}', '{unit} von {name} ({side}) auf {square}', '{unit} de {name} ({side}) em {square}', '{name}的{unit}（{side}）在{square}', '{name} का {unit} ({side}) {square} पर', '{unit} لـ{name} ({side}) في {square}'],
    'side_front': ['first side', 'cara inicial', 'face de départ', 'Startseite', 'lado inicial', '初始面', 'पहली तरफ़', 'الوجه الأول'],
    'side_back': ['other side', 'otra cara', 'autre face', 'andere Seite', 'outro lado', '另一面', 'दूसरी तरफ़', 'الوجه الآخر'],
    'lord_here': ['Place your Lord on {square}', 'Colocar tu Señor en {square}', 'Placer votre Seigneur en {square}', 'Herrn auf {square} stellen', 'Colocar o seu Senhor em {square}', '把领主放在{square}', 'सामंत को {square} पर रखें', 'ضع سيدك في {square}'],
    'footman_here': ['Place a Footman on {square}', 'Colocar un Infante en {square}', 'Placer un Fantassin en {square}', 'Fußsoldat auf {square}', 'Colocar um Infante em {square}', '在{square}放步兵', '{square} पर पैदल सैनिक रखें', 'ضع جندي مشاة في {square}'],
    'your_lord': ['Your Lord', 'Tu Señor', 'Votre Seigneur', 'Dein Herr', 'Seu Senhor', '你的领主', 'आपका सामंत', 'سيدك'],
    'your_footman': ['Your Footman', 'Tu Infante', 'Votre Fantassin', 'Dein Fußsoldat', 'Seu Infante', '你的步兵', 'आपका पैदल सैनिक', 'جندي مشاتك'],
    'move_lord': ['Move the Lord', 'Mover el Señor', 'Déplacer le Seigneur', 'Herrn versetzen', 'Mudar o Senhor', '重新放领主', 'सामंत बदलें', 'غيّر مكان السيد'],
    'hint_lord': ['Tap a glowing square for your Lord', 'Toca una casilla iluminada para tu Señor', 'Touchez une case lumineuse pour votre Seigneur', 'Tippe auf ein leuchtendes Feld für deinen Herrn', 'Toque numa casa iluminada para o seu Senhor', '点击发光的格子放领主', 'सामंत के लिए चमकता खाना छुएँ', 'المس مربعًا مضيئًا لسيدك'],
    'hint_footmen': ['Now tap two squares beside it for your Footmen', 'Ahora toca dos casillas a su lado para los Infantes', 'Touchez deux cases à côté pour les Fantassins', 'Jetzt zwei Felder daneben für die Fußsoldaten', 'Agora toque em duas casas ao lado para os Infantes', '再点它旁边的两个格子放步兵', 'अब पास के दो खाने पैदल सैनिकों के लिए छुएँ', 'الآن المس مربعين بجانبه لجنديي المشاة'],
    'place_here': ['Place the new troop on {square}', 'Colocar la nueva tropa en {square}', 'Placer la nouvelle troupe en {square}', 'Neue Truppe auf {square}', 'Colocar a nova tropa em {square}', '把新兵牌放在{square}', 'नई टुकड़ी {square} पर रखें', 'ضع الجندي الجديد في {square}'],
    'hint_place': ['Tap a square beside your Lord for the new troop', 'Toca una casilla junto a tu Señor', 'Touchez une case à côté de votre Seigneur', 'Tippe auf ein Feld neben deinem Herrn', 'Toque numa casa ao lado do seu Senhor', '点领主旁边的格子放新兵牌', 'नई टुकड़ी के लिए सामंत के पास का खाना छुएँ', 'المس مربعًا بجانب سيدك للجندي الجديد'],
    'move_to': ['Move to {square}', 'Mover a {square}', 'Aller en {square}', 'Nach {square} ziehen', 'Mover para {square}', '移动到{square}', '{square} पर जाएँ', 'تحرك إلى {square}'],
    'take_on': ['Capture on {square}', 'Capturar en {square}', 'Prendre en {square}', 'Auf {square} schlagen', 'Capturar em {square}', '在{square}吃子', '{square} पर पकड़ें', 'أسر في {square}'],
    'strike_at': ['Strike {square} from afar', 'Golpear {square} a distancia', 'Frapper {square} à distance', '{square} aus der Ferne schlagen', 'Golpear {square} à distância', '远程打击{square}', '{square} पर दूर से वार', 'اضرب {square} من بعيد'],
    'command_from': ['Command the {unit} on {square}', 'Dar orden al {unit} en {square}', 'Commander le {unit} en {square}', '{unit} auf {square} befehligen', 'Comandar o {unit} em {square}', '指挥{square}的{unit}', '{square} पर {unit} को आदेश दें', 'أصدر أمرًا لـ{unit} في {square}'],
    'command_to': ['Send it to {square}', 'Enviarlo a {square}', 'L’envoyer en {square}', 'Nach {square} schicken', 'Enviar para {square}', '派到{square}', '{square} पर भेजें', 'أرسله إلى {square}'],
    'hint_targets': ['Tap a highlight to act, or another tile', 'Toca un resaltado o elige otra ficha', 'Touchez une case en surbrillance ou une autre tuile', 'Tippe auf eine Markierung oder ein anderes Plättchen', 'Toque num destaque ou noutra peça', '点高亮格行动，或换一块兵牌', 'किसी निशान या दूसरी टाइल को छुएँ', 'المس مربعًا مضيئًا أو بلاطة أخرى'],
    'hint_none': ['This tile has no safe move now', 'Esta ficha no tiene movimiento seguro', 'Cette tuile n’a aucun coup sûr', 'Dieses Plättchen hat keinen sicheren Zug', 'Esta peça não tem lance seguro', '这块兵牌现在没有安全走法', 'इस टाइल की अभी कोई सुरक्षित चाल नहीं', 'لا توجد حركة آمنة لهذه البلاطة'],
    'hint_command': ['Tap where the commanded troop goes', 'Toca adónde va la tropa', 'Touchez où va la troupe commandée', 'Tippe, wohin die Truppe soll', 'Toque para onde a tropa vai', '点被指挥部队的目的地', 'आदेशित टुकड़ी कहाँ जाए, वह छुएँ', 'المس وجهة الجندي المأمور'],
    'cancel': ['Cancel', 'Cancelar', 'Annuler', 'Abbrechen', 'Cancelar', '取消', 'रद्द करें', 'إلغاء'],
    'hint_peek': ['This is its other side: the grid it gets after acting', 'Esta es su otra cara: la cuadrícula tras actuar', 'Voici son autre face : sa grille après avoir agi', 'Das ist die andere Seite: das Raster nach der Aktion', 'Este é o outro lado: a grade depois de agir', '这是它的另一面：行动后的网格', 'यह दूसरी तरफ़ है: चलने के बाद का जाल', 'هذا وجهها الآخر: شبكتها بعد الحركة'],
    'hint_pick': ['Tap one of your tiles, or draw a troop', 'Toca una de tus fichas o saca una tropa', 'Touchez une de vos tuiles ou tirez une troupe', 'Tippe auf ein Plättchen oder ziehe eine Truppe', 'Toque numa das suas peças ou tire uma tropa', '点你的兵牌，或抽取兵牌', 'अपनी कोई टाइल छुएँ, या टुकड़ी निकालें', 'المس إحدى بلاطاتك أو اسحب جنديًا'],
    'draw_label': ['Draw a troop from your bag ({count} left)', 'Sacar una tropa de tu bolsa (quedan {count})', 'Tirer une troupe du sac ({count} restantes)', 'Truppe aus dem Beutel ziehen (noch {count})', 'Tirar uma tropa do saco (restam {count})', '从袋中抽取兵牌（剩{count}）', 'थैले से टुकड़ी निकालें ({count} बचीं)', 'اسحب جنديًا من الكيس (بقي {count})'],
    'draw_button': ['Draw a troop ({count})', 'Sacar tropa ({count})', 'Tirer une troupe ({count})', 'Truppe ziehen ({count})', 'Tirar tropa ({count})', '抽取兵牌（{count}）', 'टुकड़ी निकालें ({count})', 'اسحب جنديًا ({count})'],
    'wins': ['{name} wins!', '¡Gana {name}!', '{name} gagne !', '{name} gewinnt!', '{name} venceu!', '{name}获胜！', '{name} जीते!', 'فاز {name}!'],
    'draw_result': ['Draw', 'Empate', 'Match nul', 'Unentschieden', 'Empate', '平局', 'बराबरी', 'تعادل'],
    'reason_trapped': ['The Lord was trapped: no safe move was left', 'El Señor quedó atrapado: sin movimientos seguros', 'Le Seigneur était pris au piège : plus aucun coup sûr', 'Der Herr war gefangen: kein sicherer Zug mehr', 'O Senhor ficou encurralado: sem lances seguros', '领主被困：已无安全走法', 'सामंत घिर गया: कोई सुरक्षित चाल नहीं बची', 'حوصر السيد: لم تبقَ حركة آمنة'],
    'reason_stuck': ['No safe move was left', 'No quedaban movimientos seguros', 'Plus aucun coup sûr', 'Kein sicherer Zug mehr', 'Não restavam lances seguros', '已无安全走法', 'कोई सुरक्षित चाल नहीं बची', 'لم تبقَ حركة آمنة'],
    'reason_quiet': ['50 turns without a capture or a new troop: draw', '50 turnos sin capturas ni tropas nuevas: empate', '50 tours sans prise ni nouvelle troupe : nul', '50 Züge ohne Schlag oder neue Truppe: Remis', '50 turnos sem captura nem tropa nova: empate', '50 回合无吃子也无新兵牌：平局', '50 बारियाँ बिना पकड़ या नई टुकड़ी: बराबरी', '50 دورًا بلا أسر ولا جنود جدد: تعادل'],
    'setup_turn': ['{name}: set up your Lord and Footmen', '{name}: coloca tu Señor e Infantes', '{name} : placez Seigneur et Fantassins', '{name}: Herrn und Fußsoldaten aufstellen', '{name}: coloque o Senhor e os Infantes', '{name}：布置领主和步兵', '{name}: सामंत और पैदल सैनिक रखें', '{name}: ضع سيدك وجنود المشاة'],
    'waiting_setup': ['{name} is setting up', '{name} está preparando', '{name} se met en place', '{name} stellt auf', '{name} está preparando', '{name}正在布阵', '{name} तैयारी कर रहे हैं', '{name} يجهّز'],
    'your_turn': ['{name}: your move', '{name}: tu turno', '{name} : à vous', '{name}: du bist dran', '{name}: sua vez', '{name}：轮到你', '{name}: आपकी चाल', '{name}: دورك'],
    'waiting': ['Waiting for {name}', 'Esperando a {name}', 'En attente de {name}', 'Warten auf {name}', 'Aguardando {name}', '等待{name}', '{name} की प्रतीक्षा', 'بانتظار {name}'],
    'lord_danger': ['⚠ Your Lord is threatened!', '⚠ ¡Tu Señor está amenazado!', '⚠ Votre Seigneur est menacé !', '⚠ Dein Herr ist bedroht!', '⚠ Seu Senhor está ameaçado!', '⚠ 你的领主受到威胁！', '⚠ आपका सामंत ख़तरे में है!', '⚠ سيدك مهدَّد!'],
    'lord_danger_other': ['⚠ The Lord of {name} is threatened', '⚠ El Señor de {name} está amenazado', '⚠ Le Seigneur de {name} est menacé', '⚠ Der Herr von {name} ist bedroht', '⚠ O Senhor de {name} está ameaçado', '⚠ {name}的领主受到威胁', '⚠ {name} का सामंत ख़तरे में है', '⚠ سيد {name} مهدَّد'],
    'bag_line': ['{name}: {count} in bag · {captured} taken', '{name}: {count} en bolsa · {captured} capturas', '{name} : {count} au sac · {captured} prises', '{name}: {count} im Beutel · {captured} geschlagen', '{name}: {count} no saco · {captured} capturas', '{name}：袋中{count} · 吃子{captured}', '{name}: थैले में {count} · {captured} पकड़े', '{name}: {count} في الكيس · {captured} أسرى'],
    'focus_line': ['{unit} · {side}', '{unit} · {side}', '{unit} · {side}', '{unit} · {side}', '{unit} · {side}', '{unit} · {side}', '{unit} · {side}', '{unit} · {side}'],
    'peeking': ['preview only', 'solo vista previa', 'aperçu seulement', 'nur Vorschau', 'só pré-visualização', '仅预览', 'सिर्फ़ झलक', 'معاينة فقط'],
    'server_two_players': ['two players required', 'se necesitan dos jugadores', 'deux joueurs requis', 'zwei Spieler nötig', 'são necessários dois jogadores', '需要两名玩家', 'दो खिलाड़ी चाहिए', 'يلزم لاعبان'],
    'server_unknown_player': ['unknown player', 'jugador desconocido', 'joueur inconnu', 'unbekannter Spieler', 'jogador desconhecido', '未知玩家', 'अज्ञात खिलाड़ी', 'لاعب غير معروف'],
    'server_game_over': ['game over', 'partida terminada', 'partie terminée', 'Spiel beendet', 'jogo encerrado', '游戏结束', 'खेल समाप्त', 'انتهت اللعبة'],
    'server_not_your_turn': ['not your turn', 'no es tu turno', 'ce n’est pas votre tour', 'du bist nicht dran', 'não é sua vez', '未轮到你', 'आपकी बारी नहीं', 'ليس دورك'],
    'server_lord_square': ['place your Lord on a middle square of your home row', 'coloca tu Señor en una casilla central de tu fila', 'placez votre Seigneur au milieu de votre rangée', 'stelle deinen Herrn in die Mitte deiner Grundreihe', 'coloque o Senhor numa casa central da sua fileira', '把领主放在本方底线中间', 'सामंत को अपनी पंक्ति के बीच में रखें', 'ضع سيدك في وسط صفك الخلفي'],
    'server_footmen': ['place two footmen beside your Lord', 'coloca dos infantes junto a tu Señor', 'placez deux fantassins à côté du Seigneur', 'stelle zwei Fußsoldaten neben den Herrn', 'coloque dois infantes ao lado do Senhor', '在领主旁放两名步兵', 'सामंत के पास दो पैदल सैनिक रखें', 'ضع جنديي مشاة بجانب سيدك'],
    'server_not_allowed': ['that move is not allowed', 'ese movimiento no está permitido', 'ce coup n’est pas permis', 'dieser Zug ist nicht erlaubt', 'esse lance não é permitido', '不允许这样走', 'यह चाल मान्य नहीं', 'هذه الحركة غير مسموحة'],
}
for unit, names in UNITS.items():
    TEXTS['unit_' + unit] = names


def strings(index=0):
    return {'title': TITLES[index], **{key: values[index] for key, values in TEXTS.items()}}


TILE = {'oneOf': [{'type': 'null'}, {'type': 'object', 'additionalProperties': False, 'required': ['o', 't', 's', 'id'],
                                      'properties': {'o': {'enum': [0, 1]}, 't': {'enum': list(UNITS)}, 's': {'enum': [0, 1]}, 'id': {'type': 'integer'}}}]}
COMMON = {
    'phase': {'enum': ['setup', 'play', 'over']},
    'board': {'type': 'array', 'minItems': 36, 'maxItems': 36, 'items': TILE},
    'bags': {'type': 'array', 'minItems': 2, 'maxItems': 2, 'items': {'type': 'array', 'items': {'enum': list(UNITS)}}},
    'cur': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 1},
    'next_id': {'type': 'integer', 'minimum': 0},
    'winner': {'type': ['integer', 'null'], 'minimum': -1, 'maximum': 1},
    'reason': {'enum': [None, 'captured', 'trapped', 'stuck', 'quiet']},
    'quiet': {'type': 'integer', 'minimum': 0},
    'turn_no': {'type': 'integer', 'minimum': 0},
    'captured': {'type': 'array', 'items': {'type': 'array', 'items': {'enum': list(UNITS)}}},
    'last': {'type': ['object', 'null']},
}
SCHEMAS = {
    'state': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'additionalProperties': False,
              'required': list(COMMON), 'properties': COMMON},
    'move': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'oneOf': [
        {'type': 'object', 'additionalProperties': False, 'required': ['duke', 'footmen'],
         'properties': {'duke': {'type': 'integer'}, 'footmen': {'type': 'array', 'items': {'type': 'integer'}, 'maxItems': 2}}},
        {'type': 'object', 'additionalProperties': False, 'required': ['action', 'to'],
         'properties': {'action': {'enum': ['move', 'strike', 'command', 'place']}, 'to': {'type': 'integer', 'minimum': 0, 'maximum': 35},
                        'from': {'type': 'integer', 'minimum': 0, 'maximum': 35}, 'via': {'type': 'integer', 'minimum': 0, 'maximum': 35}}}]},
    'view': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'additionalProperties': False,
             'required': list(COMMON) + ['me'], 'properties': {**COMMON, 'me': {'type': 'integer', 'minimum': -1, 'maximum': 1}}},
}


def schemas():
    return copy.deepcopy(SCHEMAS)


def tiles():
    """The tile table, read from the server file (the single source)."""
    code = (DEST / f'{KIND}.server.js').read_text()
    body = code[code.index('var FL_TILES = {'):code.index('};', code.index('var FL_TILES')) + 1]
    out = {}
    for name, sides in re.findall(r"(\w+): \{count: \d+, sides: (\[.*\])\},", body):
        out[name] = json.loads(sides.replace("'", '"'))
    return out


# ---- art ---------------------------------------------------------------------
SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="{0}">'
PALETTE = {'light': ('#f1e4c8', '#c9b48c', '#2a1d10'), 'dark': ('#5a4330', '#3a2a1c', '#f3e3c2')}


def cell_center(dc, dr):
    return 13 + (2 + dc) * 16, 13 + (2 - dr) * 16


def emblem(unit, ink):
    """A small original emblem for each troop type, in the middle cell."""
    x, y = 45, 45
    shapes = {
        'duke': f'<path d="M37 50l1-9l4 4l3-6l3 6l4-4l1 9z" fill="{ink}"/>',
        'footman': f'<path d="M39 39h12v6c0 5-3 8-6 9c-3-1-6-4-6-9z" fill="{ink}"/>',
        'pikeman': f'<path d="M45 36l3 5h-2v13h-2v-13h-2z" fill="{ink}"/>',
        'knight': f'<path d="M40 53v-7c0-5 3-9 9-10l-1 4l3 3l-3 2l-2-1v9z" fill="{ink}"/>',
        'wizard': f'<path d="M45 36l2.4 5.5l6 .5l-4.6 4l1.4 6l-5.2-3.2l-5.2 3.2l1.4-6l-4.6-4l6-.5z" fill="{ink}"/>',
        'ranger': f'<path d="M38 52l12-12m0 0v6m0-6h-6" stroke="{ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
        'seer': f'<path d="M37 45c4-6 12-6 16 0c-4 6-12 6-16 0z" fill="none" stroke="{ink}" stroke-width="2"/><circle cx="45" cy="45" r="2.6" fill="{ink}"/>',
        'general': f'<path d="M40 54v-18m0 1h11l-3 4l3 4h-11" fill="{ink}" stroke="{ink}" stroke-width="2"/>',
        'priest': f'<path d="M43.5 36h3v6h5v3h-5v9h-3v-9h-5v-3h5z" fill="{ink}"/>',
        'champion': f'<path d="M44 36h2v12h-2zM40 48h10v2h-10zM44 50h2v4h-2z" fill="{ink}"/>',
        'marshall': f'<path d="M39 52l12-12" stroke="{ink}" stroke-width="3" stroke-linecap="round"/><circle cx="51" cy="40" r="2.4" fill="{ink}"/><circle cx="39" cy="52" r="2.4" fill="{ink}"/>',
        'bowman': f'<path d="M42 37c7 4 7 12 0 16" fill="none" stroke="{ink}" stroke-width="2.2"/><path d="M42 37v16" stroke="{ink}" stroke-width="1"/>',
    }
    return shapes[unit]


def icon(kind, dc, dr, ink, warm):
    x, y = cell_center(dc, dr)
    if kind == 'move':
        return f'<circle cx="{x}" cy="{y}" r="4.3" fill="{ink}"/>'
    if kind == 'jump':
        return f'<circle cx="{x}" cy="{y}" r="4.4" fill="none" stroke="{ink}" stroke-width="1.9"/>'
    if kind == 'strike':
        return (f'<path d="M{x} {y - 6}l1.6 4.4l4.4 1.6l-4.4 1.6l-1.6 4.4l-1.6-4.4l-4.4-1.6l4.4-1.6z" fill="#b8322a"/>')
    if kind == 'command':
        return (f'<path d="M{x - 7} {y - 7}h5l-5 5z" fill="{warm}"/><path d="M{x + 7} {y + 7}h-5l5-5z" fill="{warm}"/>')
    # slide: a triangle pointing outward from the middle, in the next cell
    cx, cy = cell_center(dc, dr)
    ux, uy = dc, -dr
    px, py = -uy, ux
    tip = (cx + ux * 6, cy + uy * 6)
    a = (cx - ux * 3 + px * 5, cy - uy * 3 + py * 5)
    b = (cx - ux * 3 - px * 5, cy - uy * 3 - py * 5)
    return f'<path d="M{tip[0]} {tip[1]}L{a[0]} {a[1]}L{b[0]} {b[1]}Z" fill="{ink}"/>'


def troop_svg(unit, side, icons, key):
    face, edge, ink = PALETTE[key]
    warm = '#2c5d9e' if key == 'light' else '#8cc0ff'
    parts = [SVG.format('0 0 90 90'), f'<rect x="1" y="1" width="88" height="88" rx="8" fill="{face}" stroke="{edge}" stroke-width="2"/>']
    grid = ''.join(f'M{5 + i * 16} 5v80M5 {5 + i * 16}h80' for i in range(6))
    parts.append(f'<path d="{grid}" stroke="{ink}" stroke-opacity=".16" stroke-width="1"/>')
    parts.append(f'<rect x="37" y="37" width="16" height="16" fill="{ink}" fill-opacity=".08"/>')
    for kind, dc, dr in icons:
        parts.append(icon(kind, dc, dr, ink, warm))
    parts.append(emblem(unit, ink))
    if side == 0:  # the starting side carries a small corner mark
        parts.append(f'<path d="M5 5h9l-9 9z" fill="{ink}" fill-opacity=".55"/>')
    parts.append('</svg>')
    return ''.join(parts)


def field_svg():
    parts = [SVG.format('0 0 540 540'), '<rect width="540" height="540" rx="6" fill="#3b2a1a"/>']
    for r in range(6):
        for c in range(6):
            fill = '#8a6a44' if (r + c) % 2 else '#9a7a50'
            parts.append(f'<rect x="{c * 90 + 2}" y="{r * 90 + 2}" width="86" height="86" rx="4" fill="{fill}"/>')
    parts.append('</svg>')
    return ''.join(parts)


def ring(color, dashed=False, width=5, inner='', fill=True):
    dash = ' stroke-dasharray="10 6"' if dashed else ''
    body = f'fill="{color}" fill-opacity=".14"' if fill else 'fill="none"'
    return (SVG.format('0 0 90 90') + f'<rect x="3" y="3" width="84" height="84" rx="10" {body} stroke="{color}" stroke-width="{width}"{dash}/>' + inner + '</svg>')


TARGETS = {
    'pick': ring('#ffd98a', dashed=True),
    'place': ring('#7ee0d0', dashed=True, inner='<path d="M45 33v24M33 45h24" stroke="#7ee0d0" stroke-width="5" stroke-linecap="round"/>'),
    'go': SVG.format('0 0 90 90') + '<circle cx="45" cy="45" r="20" fill="#55d16b" fill-opacity=".35" stroke="#55d16b" stroke-width="5"/></svg>',
    'take': SVG.format('0 0 90 90') + '<circle cx="45" cy="45" r="36" fill="none" stroke="#ff4d4d" stroke-width="6"/></svg>',
    'strike': SVG.format('0 0 90 90') + '<path d="M45 14l7 24l24 7l-24 7l-7 24l-7-24l-24-7l24-7z" fill="#ff4d4d" fill-opacity=".55" stroke="#ff4d4d" stroke-width="3"/></svg>',
    'cmd': SVG.format('0 0 90 90') + '<path d="M45 10l35 35l-35 35l-35-35z" fill="#5aa0ff" fill-opacity=".3" stroke="#5aa0ff" stroke-width="5"/></svg>',
    'last_light': ring('#fff4cf', width=4, fill=False),
    'last_dark': ring('#e0a868', width=4, fill=False),
    'danger': SVG.format('0 0 90 90') + '<rect x="3" y="3" width="84" height="84" rx="10" fill="none" stroke="#ff3b3b" stroke-width="6" stroke-dasharray="8 5"/></svg>',
}


def uri(svg):
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


def asset(svg):
    return {'uri': uri(svg), 'media_type': 'image/svg+xml'}


def specification():
    table = tiles()
    assets = {'field': asset(field_svg())}
    for unit, sides in table.items():
        for side in (0, 1):
            for key in ('light', 'dark'):
                assets[f'{unit}_{side}_{key}'] = asset(troop_svg(unit, side, sides[side], key))
    for name, svg in TARGETS.items():
        assets[name] = asset(svg)
    server = (DEST / f'{KIND}.server.js').read_text()
    shared = server[server.index('// ---- shared rules'):server.index('// ---- end shared rules ----')]
    return {'format': 'buildplay-ui', 'version': 1, 'viewport': {'width': 600, 'height': 810},
            'motion': {'move_ms': 650, 'turn_pause_ms': 450},
            'assets': assets,
            'boards': [
                {'id': 'hud', 'kind': 'zone', 'x': 0, 'y': 0, 'width': 600, 'height': 100, 'color': '#1c1510', 'line_color': '#1c1510'},
                {'id': 'frame', 'kind': 'zone', 'x': 0, 'y': 100, 'width': 600, 'height': 600, 'color': '#2a1e14', 'line_color': '#2a1e14'},
                {'id': 'board', 'kind': 'zone', 'x': 30, 'y': 130, 'width': 540, 'height': 540, 'color': '#3b2a1a', 'line_color': '#3b2a1a'},
                {'id': 'tray', 'kind': 'zone', 'x': 0, 'y': 700, 'width': 600, 'height': 110, 'color': '#1c1510', 'line_color': '#1c1510'}],
            'piece_types': {
                'field': {'shape': 'image', 'width': 540, 'height': 540, 'asset': 'field'},
                'troop': {'shape': 'image', 'width': 86, 'height': 86, 'asset': 'duke_0_light', 'action_outline': 'rect'},
                'mark': {'shape': 'image', 'width': 90, 'height': 90, 'asset': 'danger'}},
            'strings': strings(),
            'ui_code': 'const SOURCE_STRINGS=' + json.dumps(strings(), ensure_ascii=False) + ';\n' + shared + '\n' +
                       (DEST / f'{KIND}.ui.js').read_text()}


# ---- unit test cases ----------------------------------------------------------
def illustration(view, caption):
    parts = [SVG.format('0 0 380 380'), '<rect width="380" height="380" fill="#2a1e14"/>']
    for sq in range(36):
        c, r = sq % 6, sq // 6
        parts.append(f'<rect x="{10 + c * 60}" y="{10 + r * 60}" width="58" height="58" fill="{"#8a6a44" if (r + c) % 2 else "#9a7a50"}"/>')
    for sq, t in enumerate(view['board']):
        if not t:
            continue
        c, r = sq % 6, sq // 6
        face, edge, ink = PALETTE['light' if t['o'] == 0 else 'dark']
        # No text (the cover must not contain any): the Lord gets a crown
        # mark, other troops a dot; the other side shows a ring.
        mark = (f'<path d="M{28 + c * 60} {46 + r * 60}l2-12l6 6l3-8l3 8l6-6l2 12z" fill="{ink}"/>' if t['t'] == 'duke'
                else f'<circle cx="{39 + c * 60}" cy="{39 + r * 60}" r="8" fill="{ink if t["s"] == 0 else "none"}" stroke="{ink}" stroke-width="3"/>')
        parts.append(f'<rect x="{14 + c * 60}" y="{14 + r * 60}" width="50" height="50" rx="5" fill="{face}" stroke="{edge}"/>' + mark)
    parts.append('</svg>')
    return {'caption': caption, 'svg': ''.join(parts)}


def players():
    return [{'id': f'u{i + 1}', 'kind': 'human', 'display_name': n, 'picture_url': '', 'max_loss': 0, 'active': True}
            for i, n in enumerate(['Alice', 'Bob'])]


def play(logic, seed, chooser='computerMove', limit=500):
    ctx = {'players': players(), 'pot': 0, 'move_count': 0}
    result = logic.call('newMatch', ctx=ctx, seed=seed)
    steps = []
    for i in range(limit):
        ctx['move_count'] = i
        state, pid, s = result['state'], result['turn'][0], seed * 1000 + i
        move = logic.call(chooser, state, pid, ctx=ctx, seed=s)
        result = logic.call('applyMove', state, pid, move, ctx=ctx, seed=s)
        steps.append((copy.deepcopy(ctx), state, pid, move, result, s))
        if result['turn'] is None:
            return steps
    raise RuntimeError('Flipside Lords did not finish')


def package():
    code = (DEST / f'{KIND}.server.js').read_text()
    game_schemas = schemas()
    logic = GameLogic(code, game_schemas=game_schemas)
    steps = play(logic, 5)
    def first(pred, pool):
        return next(step for step in pool if pred(step))
    random_steps = [step for seed in range(1, 40) for step in play(logic, seed, 'randomMove')]
    selected = [('initial', 'Setting up the Lord and two Footmen', steps[0]),
                ('intermediate', 'Moving a tile flips it to its other side', first(lambda s: s[3].get('action') == 'move', steps)),
                ('intermediate', 'Drawing a troop places it beside the Lord', first(lambda s: s[3].get('action') == 'place', steps)),
                ('intermediate', 'A strike captures from afar without moving', first(lambda s: s[3].get('action') == 'strike', random_steps)),
                ('intermediate', 'A command moves another troop; only the commander flips', first(lambda s: s[3].get('action') == 'command', random_steps)),
                ('terminal', 'Trapping the Lord wins', steps[-1])]
    cases = []
    for kind, label, (cctx, state, pid, move, after, seed) in selected:
        other = next(p['id'] for p in cctx['players'] if p['id'] != pid)
        before = [logic.call('viewFor', state, who, ctx=cctx, seed=seed) for who in (pid, other)]
        nctx = {**cctx, 'move_count': cctx['move_count'] + 1}
        after_views = [logic.call('viewFor', after['state'], who, ctx=nctx, seed=seed) for who in (pid, other)]
        case = {'name': label, 'description': RULES[0], 'kind': kind, 'ctx': {**cctx, 'seed': seed}, 'state': state,
                'view_of_mover': before[0], 'view_of_other': before[1], 'player_id': pid, 'other_player_id': other, 'move': move,
                'expected_state': after['state'], 'expected_turn': after['turn'],
                'expected_view_of_mover': after_views[0], 'expected_view_of_other': after_views[1],
                'images': [illustration(v, c) for v, c in zip(before + after_views, ['Before: mover', 'Before: other player', 'After: mover', 'After: other player'])]}
        if 'payouts' in after:
            case['expected_payouts'] = after['payouts']
        cases.append(case)
    mid = cases[1]['images'][2]['svg'].removeprefix(SVG.format('0 0 380 380')).removesuffix('</svg>')
    cover = (SVG.format('0 0 800 450') + '<rect width="800" height="450" fill="#1c1510"/>'
             f'<g transform="translate(206 12) scale(1.1)">{mid}</g></svg>')
    return {'name': TITLES[0], 'description': RULES[0], 'allowed_player_counts': [2], 'all_state_public': True,
            'server_code': code, 'declarative_ui': specification(),
            'game_addition_request_id_and_secret': f'example-only-declarative-{KIND}-replace-before-publishing',
            'rules': RULES[0], 'ui_instructions': UI_RULES[0],
            'tutorial': {'text': RULES[0], 'html': '<meta name="viewport" content="width=device-width,initial-scale=1"><p>' + html.escape(RULES[0]) + '</p>'},
            'images': [{'caption': 'Cover', 'svg': cover}, cases[1]['images'][0], cases[1]['images'][2], {**cases[-1]['images'][2], 'caption': 'The end'}],
            'unit_tests': {**{key + '_schema': value for key, value in game_schemas.items()}, 'cases': cases},
            'translations': {locale: {'display_name': TITLES[i], 'short_description': RULES[i],
                                      'game_logic_rules': RULES[i], 'game_ui_rules': UI_RULES[i],
                                      'tutorial_strings': {RULES[0]: RULES[i]}, 'client_strings': strings(i)}
                             for i, locale in enumerate(LOCALES) if i}}


def main():
    payload = package()
    target = DEST / f'{KIND}.json'
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(f'{target.name}: {len(json.dumps(payload).encode())} bytes')


if __name__ == '__main__':
    main()
