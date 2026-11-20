"""Build the declarative Lantern Trails package (based on Tsuro).

Run from the package parent:
  python -m game_platform.tools.build_declarative_lanterntrails
The checked-in submission secret is only an example; replace it when publishing.
"""
from __future__ import annotations

import base64
import copy
import html
import json
import math
from pathlib import Path

from game_platform.game_logic import GameLogic

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'games' / 'declarative'
KIND = 'lanterntrails'
LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
TITLES = ['Lantern Trails', 'Senderos de Faroles', 'Sentiers de Lanternes', 'Laternenpfade', 'Trilhas de Lanternas',
          '灯笼水道', 'लालटेन की राहें', 'دروب الفوانيس']
RULES = [
    'Based on Tsuro. 2 to 8 players each float a paper lantern on a 6×6 river. First, each player puts a lantern on a free gate at the edge. Then, on your turn, lay one of your 3 tiles on the square in front of your lantern, turned any way you like; every lantern next to the new tile follows its channel to the end, and you draw a tile. A lantern that reaches the edge of the board is out, and two lanterns that meet are both out. You may not send your own lantern off the edge unless every tile and turn would. The last lantern on the river wins; lanterns that go out together, or that remain when all 35 tiles are played, share the win. With 3 or more players the Dragon decides who draws first when tiles come back.',
    'Basado en Tsuro. De 2 a 8 jugadores hacen flotar un farol de papel en un río de 6×6. Primero, cada jugador pone su farol en una entrada libre del borde. Después, en tu turno, coloca una de tus 3 losetas en la casilla frente a tu farol, girada como quieras; cada farol junto a la nueva loseta sigue su canal hasta el final, y robas una loseta. Un farol que llega al borde queda fuera, y dos faroles que se encuentran quedan fuera los dos. No puedes sacar tu propio farol por el borde salvo que todas las losetas y giros lo hagan. Gana el último farol en el río; los faroles que salen a la vez, o los que quedan cuando se juegan las 35 losetas, comparten la victoria. Con 3 o más jugadores, el Dragón decide quién roba primero cuando vuelven losetas.',
    'D’après Tsuro. De 2 à 8 joueurs font flotter une lanterne de papier sur une rivière de 6×6. D’abord, chaque joueur pose sa lanterne sur une entrée libre du bord. Ensuite, à votre tour, posez l’une de vos 3 tuiles sur la case devant votre lanterne, tournée comme vous voulez ; chaque lanterne voisine de la nouvelle tuile suit son canal jusqu’au bout, puis vous piochez une tuile. Une lanterne qui atteint le bord est éliminée, et deux lanternes qui se rencontrent sont éliminées toutes les deux. Vous ne pouvez pas envoyer votre lanterne hors du plateau sauf si toutes les tuiles et orientations le font. La dernière lanterne sur la rivière gagne ; les lanternes éliminées ensemble, ou restantes quand les 35 tuiles sont posées, se partagent la victoire. À 3 joueurs ou plus, le Dragon décide qui pioche en premier quand des tuiles reviennent.',
    'Nach Tsuro. 2 bis 8 Spieler lassen je eine Papierlaterne auf einem 6×6-Fluss treiben. Zuerst setzt jeder seine Laterne an ein freies Tor am Rand. Dann legst du in deinem Zug eines deiner 3 Plättchen beliebig gedreht auf das Feld vor deiner Laterne; jede Laterne am neuen Plättchen folgt ihrem Kanal bis zum Ende, und du ziehst ein Plättchen nach. Eine Laterne, die den Rand erreicht, scheidet aus, und zwei Laternen, die sich treffen, scheiden beide aus. Du darfst deine eigene Laterne nicht über den Rand schicken, außer jedes Plättchen und jede Drehung täte es. Die letzte Laterne auf dem Fluss gewinnt; Laternen, die gemeinsam ausscheiden oder übrig sind, wenn alle 35 Plättchen liegen, teilen sich den Sieg. Ab 3 Spielern bestimmt der Drache, wer zuerst zieht, wenn Plättchen zurückkommen.',
    'Baseado em Tsuro. De 2 a 8 jogadores fazem flutuar uma lanterna de papel num rio de 6×6. Primeiro, cada jogador coloca a lanterna numa entrada livre da borda. Depois, na sua vez, coloque uma das suas 3 peças na casa à frente da sua lanterna, girada como quiser; cada lanterna junto à nova peça segue o seu canal até o fim, e você compra uma peça. Uma lanterna que chega à borda sai do jogo, e duas lanternas que se encontram saem as duas. Você não pode mandar a sua lanterna para fora, a não ser que todas as peças e giros o façam. Vence a última lanterna no rio; lanternas que saem juntas, ou que restam quando as 35 peças são jogadas, dividem a vitória. Com 3 ou mais jogadores, o Dragão decide quem compra primeiro quando peças voltam.',
    '改编自 Tsuro（通路）。2 至 8 名玩家各在 6×6 的河道上放一盏纸灯笼。开始时，每位玩家把灯笼放在边缘一个空闲的入口。之后轮到你时，把手中 3 块水道板之一以任意方向放在灯笼前方的格子里；新板旁的每盏灯笼都沿水道漂到尽头，然后你补抽一块。漂到棋盘边缘的灯笼出局，两盏相遇的灯笼一起出局。除非手中每块板的每个方向都会出局，否则不能让自己的灯笼漂出边缘。河上最后一盏灯笼获胜；同时出局的灯笼，或 35 块板全部放完时仍在的灯笼，共同获胜。3 人及以上时，由龙牌决定水道板回收后谁先抽。',
    'त्सुरो पर आधारित। 2 से 8 खिलाड़ी 6×6 की नदी पर एक-एक काग़ज़ी लालटेन तैराते हैं। पहले, हर खिलाड़ी किनारे के किसी ख़ाली द्वार पर अपनी लालटेन रखता है। फिर अपनी बारी में अपनी 3 टाइलों में से एक को अपनी लालटेन के सामने वाले खाने में किसी भी दिशा में घुमाकर रखें; नई टाइल के पास की हर लालटेन अपनी धारा के अंत तक जाती है, और आप एक टाइल उठाते हैं। किनारे तक पहुँचने वाली लालटेन बाहर हो जाती है, और मिलने वाली दो लालटेनें दोनों बाहर हो जाती हैं। अपनी लालटेन को किनारे से बाहर भेजना मना है, जब तक हर टाइल और हर दिशा ऐसा न करे। नदी पर आख़िरी लालटेन जीतती है; साथ बाहर होने वाली लालटेनें, या सभी 35 टाइलें रखे जाने पर बची लालटेनें, जीत बाँटती हैं। 3 या अधिक खिलाड़ियों में ड्रैगन तय करता है कि टाइलें लौटने पर पहले कौन उठाएगा।',
    'مبنية على لعبة تسورو. من 2 إلى 8 لاعبين، يطفو لكل منهم فانوس ورقي على نهر 6×6. أولًا يضع كل لاعب فانوسه عند بوابة فارغة على الحافة. ثم في دورك ضع إحدى بلاطاتك الثلاث في المربع أمام فانوسك بأي اتجاه؛ كل فانوس بجوار البلاطة الجديدة يتبع قناته حتى نهايتها، ثم تسحب بلاطة. الفانوس الذي يصل إلى حافة اللوح يخرج، والفانوسان اللذان يلتقيان يخرجان معًا. لا يجوز أن ترسل فانوسك خارج الحافة إلا إذا كانت كل البلاطات وكل الاتجاهات تفعل ذلك. آخر فانوس على النهر يفوز؛ والفوانيس التي تخرج معًا، أو التي تبقى بعد لعب البلاطات الـ35 كلها، تتقاسم الفوز. مع 3 لاعبين أو أكثر يحدد التنين من يسحب أولًا عندما تعود البلاطات.',
]
UI_RULES = [
    'Start: tap a glowing square on the edge, then pick one of its numbered gates in the middle of the board. Play: tap a tile in the tray, turn it with the ↺ ↻ buttons (or select it and press R / Shift+R), check the dashed route on the board (gold is safe, red leaves the board), then tap the glowing square, drag the tile there, or press Place tile.',
    'Inicio: toca una casilla iluminada del borde y elige una de sus entradas numeradas en el centro del tablero. Juego: toca una loseta de la bandeja, gírala con ↺ ↻ (o selecciónala y pulsa R / Mayús+R), mira la ruta punteada en el tablero (dorada es segura, roja sale del tablero) y toca la casilla iluminada, arrastra la loseta allí o pulsa Colocar loseta.',
    'Départ : touchez une case lumineuse du bord, puis choisissez une de ses entrées numérotées au milieu du plateau. Jeu : touchez une tuile, tournez-la avec ↺ ↻ (ou sélectionnez-la et appuyez sur R / Maj+R), regardez la route en pointillés (dorée : sûre, rouge : sortie du plateau), puis touchez la case lumineuse, faites-y glisser la tuile ou appuyez sur Poser la tuile.',
    'Start: Tippe auf ein leuchtendes Randfeld und wähle eines seiner nummerierten Tore in der Brettmitte. Spiel: Tippe auf ein Plättchen, drehe es mit ↺ ↻ (oder wähle es und drücke R / Umschalt+R), prüfe die gestrichelte Route (gold ist sicher, rot verlässt das Brett) und tippe dann auf das leuchtende Feld, ziehe das Plättchen dorthin oder drücke Plättchen legen.',
    'Início: toque numa casa iluminada da borda e escolha uma das suas entradas numeradas no centro do tabuleiro. Jogo: toque numa peça da bandeja, gire-a com ↺ ↻ (ou selecione-a e pressione R / Shift+R), confira a rota tracejada no tabuleiro (dourada é segura, vermelha sai do tabuleiro) e toque na casa iluminada, arraste a peça até lá ou pressione Colocar peça.',
    '开始：点击边缘一个发光的格子，然后在棋盘中央选择它的一个带编号的入口。游戏：点击托盘中的水道板，用 ↺ ↻ 旋转（或选中后按 R / Shift+R），查看棋盘上的虚线路线（金色安全，红色会漂出棋盘），然后点击发光的格子、把板拖过去，或按“放置水道板”。',
    'शुरुआत: किनारे का कोई चमकता खाना छुएँ, फिर बोर्ड के बीच में उसका एक क्रमांकित द्वार चुनें। खेल: ट्रे की कोई टाइल छुएँ, उसे ↺ ↻ से घुमाएँ (या चुनकर R / Shift+R दबाएँ), बोर्ड पर बिंदीदार रास्ता देखें (सुनहरा सुरक्षित है, लाल बोर्ड से बाहर जाता है), फिर चमकता खाना छुएँ, टाइल वहाँ खींचें या टाइल रखें दबाएँ।',
    'البداية: المس مربعًا مضيئًا على الحافة، ثم اختر إحدى بواباته المرقمة في وسط اللوح. اللعب: المس بلاطة في الصينية، أدرها بـ ↺ ↻ (أو حددها واضغط R / Shift+R)، وانظر إلى المسار المنقط على اللوح (الذهبي آمن، والأحمر يخرج من اللوح)، ثم المس المربع المضيء أو اسحب البلاطة إليه أو اضغط ضع البلاطة.',
]
COLOR_KEYS = ['amber', 'jade', 'rose', 'sky', 'violet', 'lime', 'coral', 'pearl']
COLOR_HEX = ['#ffb347', '#3fd6a0', '#ff6f91', '#5cc8ff', '#b18cff', '#c6f432', '#ff8a5c', '#efe9dc']
TEXTS = {
    'color_amber': ['Amber', 'Ámbar', 'Ambre', 'Bernstein', 'Âmbar', '琥珀', 'अंबर', 'كهرماني'],
    'color_jade': ['Jade', 'Jade', 'Jade', 'Jade', 'Jade', '翠玉', 'जेड', 'يشمي'],
    'color_rose': ['Rose', 'Rosa', 'Rose', 'Rosa', 'Rosa', '玫瑰', 'गुलाबी', 'وردي'],
    'color_sky': ['Sky', 'Cielo', 'Ciel', 'Himmel', 'Céu', '天蓝', 'आसमानी', 'سماوي'],
    'color_violet': ['Violet', 'Violeta', 'Violet', 'Violett', 'Violeta', '紫罗兰', 'बैंगनी', 'بنفسجي'],
    'color_lime': ['Lime', 'Lima', 'Citron vert', 'Limette', 'Lima', '青柠', 'नींबू', 'ليموني'],
    'color_coral': ['Coral', 'Coral', 'Corail', 'Koralle', 'Coral', '珊瑚', 'मूँगा', 'مرجاني'],
    'color_pearl': ['Pearl', 'Perla', 'Perle', 'Perle', 'Pérola', '珍珠', 'मोती', 'لؤلؤي'],
    'seat_name': ['{color} · {name}'] * 8,
    'player': ['Player {n}', 'Jugador {n}', 'Joueur {n}', 'Spieler {n}', 'Jogador {n}', '玩家{n}', 'खिलाड़ी {n}', 'اللاعب {n}'],
    'board_name': ['Night river', 'Río nocturno', 'Rivière de nuit', 'Nachtfluss', 'Rio noturno', '夜河', 'रात की नदी', 'نهر الليل'],
    'tile_at': ['Tile on {square}', 'Loseta en {square}', 'Tuile en {square}', 'Plättchen auf {square}', 'Peça em {square}', '{square}的水道板', '{square} पर टाइल', 'بلاطة في {square}'],
    'last_tile': ['Last tile: {name} on {square}', 'Última loseta: {name} en {square}', 'Dernière tuile : {name} en {square}', 'Letztes Plättchen: {name} auf {square}', 'Última peça: {name} em {square}', '上一块：{name}放在{square}', 'पिछली टाइल: {name}, {square} पर', 'آخر بلاطة: {name} في {square}'],
    'lantern_at': ['Lantern of {name} at {square}', 'Farol de {name} en {square}', 'Lanterne de {name} en {square}', 'Laterne von {name} bei {square}', 'Lanterna de {name} em {square}', '{name}的灯笼在{square}', '{name} की लालटेन {square} पर', 'فانوس {name} عند {square}'],
    'lantern_out': ['Lantern of {name} is out ({square})', 'El farol de {name} está fuera ({square})', 'La lanterne de {name} est éliminée ({square})', 'Laterne von {name} ist ausgeschieden ({square})', 'A lanterna de {name} saiu ({square})', '{name}的灯笼已出局（{square}）', '{name} की लालटेन बाहर है ({square})', 'فانوس {name} خرج ({square})'],
    'winner_lantern': ['Winning lantern: {name}', 'Farol ganador: {name}', 'Lanterne gagnante : {name}', 'Siegerlaterne: {name}', 'Lanterna vencedora: {name}', '获胜灯笼：{name}', 'जीतने वाली लालटेन: {name}', 'الفانوس الفائز: {name}'],
    'roster': ['{name}: {count} tiles in hand', '{name}: {count} losetas en la mano', '{name} : {count} tuiles en main', '{name}: {count} Plättchen auf der Hand', '{name}: {count} peças na mão', '{name}：手中 {count} 块', '{name}: हाथ में {count} टाइलें', '{name}: {count} بلاطات في اليد'],
    'roster_out': ['{name}: out', '{name}: fuera', '{name} : éliminé', '{name}: ausgeschieden', '{name}: fora', '{name}：已出局', '{name}: बाहर', '{name}: خارج'],
    'dragon': ['holds the Dragon', 'tiene el Dragón', 'a le Dragon', 'hat den Drachen', 'tem o Dragão', '持有龙牌', 'ड्रैगन इनके पास', 'يحمل التنين'],
    'turn_of': ['Turn of {name}', 'Turno de {name}', 'Tour de {name}', '{name} ist dran', 'Vez de {name}', '轮到{name}', '{name} की बारी', 'دور {name}'],
    'start_square': ['Start next to {square}', 'Empezar junto a {square}', 'Partir près de {square}', 'Bei {square} starten', 'Começar junto a {square}', '从{square}旁出发', '{square} के पास से शुरू करें', 'ابدأ بجوار {square}'],
    'gate_label': ['Gate at {square}, {side}', 'Entrada en {square}, {side}', 'Entrée en {square}, {side}', 'Tor bei {square}, {side}', 'Entrada em {square}, {side}', '{square}的入口，{side}', '{square} का द्वार, {side}', 'بوابة عند {square}، {side}'],
    'side_0': ['top, left', 'arriba, izquierda', 'en haut, à gauche', 'oben, links', 'em cima, esquerda', '上边靠左', 'ऊपर, बाएँ', 'أعلى، يسار'],
    'side_1': ['top, right', 'arriba, derecha', 'en haut, à droite', 'oben, rechts', 'em cima, direita', '上边靠右', 'ऊपर, दाएँ', 'أعلى، يمين'],
    'side_2': ['right, upper', 'derecha, arriba', 'à droite, en haut', 'rechts, oben', 'direita, em cima', '右边靠上', 'दाएँ, ऊपर', 'يمين، أعلى'],
    'side_3': ['right, lower', 'derecha, abajo', 'à droite, en bas', 'rechts, unten', 'direita, embaixo', '右边靠下', 'दाएँ, नीचे', 'يمين، أسفل'],
    'side_4': ['bottom, right', 'abajo, derecha', 'en bas, à droite', 'unten, rechts', 'embaixo, direita', '下边靠右', 'नीचे, दाएँ', 'أسفل، يمين'],
    'side_5': ['bottom, left', 'abajo, izquierda', 'en bas, à gauche', 'unten, links', 'embaixo, esquerda', '下边靠左', 'नीचे, बाएँ', 'أسفل، يسار'],
    'side_6': ['left, lower', 'izquierda, abajo', 'à gauche, en bas', 'links, unten', 'esquerda, embaixo', '左边靠下', 'बाएँ, नीचे', 'يسار، أسفل'],
    'side_7': ['left, upper', 'izquierda, arriba', 'à gauche, en haut', 'links, oben', 'esquerda, em cima', '左边靠上', 'बाएँ, ऊपर', 'يسار، أعلى'],
    'hand_tile': ['Tile {n} in your hand', 'Loseta {n} de tu mano', 'Tuile {n} de votre main', 'Plättchen {n} auf deiner Hand', 'Peça {n} da sua mão', '手中第 {n} 块', 'आपके हाथ की टाइल {n}', 'البلاطة {n} في يدك'],
    'ghost': ['Your tile, ready for {square}', 'Tu loseta, lista para {square}', 'Votre tuile, prête pour {square}', 'Dein Plättchen für {square}', 'Sua peça, pronta para {square}', '你的水道板，准备放在{square}', '{square} के लिए आपकी टाइल', 'بلاطتك جاهزة لـ {square}'],
    'rotate_cw': ['Turn tile clockwise', 'Girar loseta en sentido horario', 'Tourner la tuile dans le sens horaire', 'Plättchen im Uhrzeigersinn drehen', 'Girar peça no sentido horário', '顺时针旋转水道板', 'टाइल घड़ी की दिशा में घुमाएँ', 'أدر البلاطة باتجاه عقارب الساعة'],
    'rotate_ccw': ['Turn tile counterclockwise', 'Girar loseta en sentido antihorario', 'Tourner la tuile dans le sens antihoraire', 'Plättchen gegen den Uhrzeigersinn drehen', 'Girar peça no sentido anti-horário', '逆时针旋转水道板', 'टाइल घड़ी की उल्टी दिशा में घुमाएँ', 'أدر البلاطة عكس عقارب الساعة'],
    'place_here': ['Place the tile on {square}', 'Colocar la loseta en {square}', 'Poser la tuile en {square}', 'Plättchen auf {square} legen', 'Colocar a peça em {square}', '把水道板放在{square}', 'टाइल {square} पर रखें', 'ضع البلاطة في {square}'],
    'place_button': ['Place tile', 'Colocar loseta', 'Poser la tuile', 'Plättchen legen', 'Colocar peça', '放置水道板', 'टाइल रखें', 'ضع البلاطة'],
    'wins': ['{name} wins!', '¡Gana {name}!', '{name} gagne !', '{name} gewinnt!', '{name} venceu!', '{name}获胜！', '{name} जीते!', 'فاز {name}!'],
    'tie': ['Shared win: {names}', 'Victoria compartida: {names}', 'Victoire partagée : {names}', 'Geteilter Sieg: {names}', 'Vitória dividida: {names}', '共同获胜：{names}', 'साझा जीत: {names}', 'فوز مشترك: {names}'],
    'start_turn': ['{name}: choose a starting gate', '{name}: elige una entrada', '{name} : choisissez une entrée', '{name}: wähle ein Starttor', '{name}: escolha uma entrada', '{name}：选择出发入口', '{name}: शुरुआती द्वार चुनें', '{name}: اختر بوابة البداية'],
    'waiting_gate': ['Waiting for {name} to choose a gate', 'Esperando a que {name} elija entrada', '{name} choisit son entrée', 'Warten, bis {name} ein Tor wählt', 'Aguardando {name} escolher a entrada', '等待{name}选择入口', '{name} के द्वार चुनने की प्रतीक्षा', 'بانتظار اختيار {name} لبوابته'],
    'play_turn': ['{name}: place a tile', '{name}: coloca una loseta', '{name} : posez une tuile', '{name}: lege ein Plättchen', '{name}: coloque uma peça', '{name}：放置水道板', '{name}: टाइल रखें', '{name}: ضع بلاطة'],
    'waiting': ['Waiting for {name}', 'Esperando a {name}', 'En attente de {name}', 'Warten auf {name}', 'Aguardando {name}', '等待{name}', '{name} की प्रतीक्षा', 'بانتظار {name}'],
    'hint_square': ['Tap a glowing edge square', 'Toca una casilla iluminada del borde', 'Touchez une case lumineuse du bord', 'Tippe auf ein leuchtendes Randfeld', 'Toque numa casa iluminada da borda', '点击边缘发光的格子', 'किनारे का चमकता खाना छुएँ', 'المس مربعًا مضيئًا على الحافة'],
    'hint_gate': ['Pick a gate on the board (or tap another square)', 'Elige una entrada en el tablero (u otra casilla)', 'Choisissez une entrée sur le plateau (ou une autre case)', 'Wähle ein Tor auf dem Brett (oder ein anderes Feld)', 'Escolha uma entrada no tabuleiro (ou outra casa)', '在棋盘上选择入口（或点其他格子）', 'बोर्ड पर द्वार चुनें (या दूसरा खाना छुएँ)', 'اختر بوابة على اللوح (أو مربعًا آخر)'],
    'hint_play': ['Safe route. Turn with ↺ ↻, then tap the glowing square', 'Ruta segura. Gira con ↺ ↻ y toca la casilla iluminada', 'Route sûre. Tournez avec ↺ ↻ puis touchez la case lumineuse', 'Sichere Route. Mit ↺ ↻ drehen, dann aufs leuchtende Feld tippen', 'Rota segura. Gire com ↺ ↻ e toque na casa iluminada', '路线安全。用 ↺ ↻ 旋转，再点发光格子', 'सुरक्षित रास्ता। ↺ ↻ से घुमाएँ, फिर चमकता खाना छुएँ', 'مسار آمن. أدر بـ ↺ ↻ ثم المس المربع المضيء'],
    'hint_bad': ['That route leaves the board: turn the tile or pick another', 'Esa ruta sale del tablero: gira la loseta o elige otra', 'Cette route sort du plateau : tournez la tuile ou changez', 'Diese Route verlässt das Brett: drehen oder anderes wählen', 'Essa rota sai do tabuleiro: gire a peça ou escolha outra', '这条路线会漂出棋盘：请旋转或换一块', 'यह रास्ता बोर्ड से बाहर जाता है: टाइल घुमाएँ या बदलें', 'هذا المسار يخرج من اللوح: أدر البلاطة أو اختر غيرها'],
    'hint_forced': ['Every tile leads off the board: you must place one', 'Todas las losetas salen del tablero: debes colocar una', 'Toutes les tuiles sortent du plateau : posez-en une', 'Jedes Plättchen führt hinaus: du musst eines legen', 'Todas as peças saem do tabuleiro: coloque uma', '每块板都会漂出棋盘：仍须放一块', 'हर टाइल बाहर ले जाती है: एक रखनी होगी', 'كل البلاطات تخرج من اللوح: يجب أن تضع واحدة'],
    'hint_collide': ['Your lantern meets another: both go out', 'Tu farol choca con otro: ambos salen', 'Votre lanterne en rencontre une autre : les deux sortent', 'Deine Laterne trifft eine andere: beide scheiden aus', 'Sua lanterna encontra outra: ambas saem', '你的灯笼会与另一盏相遇：两盏都出局', 'आपकी लालटेन दूसरी से मिलेगी: दोनों बाहर', 'فانوسك يلتقي بآخر: يخرجان معًا'],
    'hint_knock': ['Safe, and it sends out: {names}', 'Segura, y elimina a: {names}', 'Sûre, et elle élimine : {names}', 'Sicher, und es wirft hinaus: {names}', 'Segura, e elimina: {names}', '安全，并让这些出局：{names}', 'सुरक्षित, और बाहर करती है: {names}', 'آمن، ويُخرج: {names}'],
    'hint_wait': ['Your tiles are in the tray', 'Tus losetas están en la bandeja', 'Vos tuiles sont en bas', 'Deine Plättchen liegen unten', 'Suas peças estão na bandeja', '你的水道板在下方托盘', 'आपकी टाइलें ट्रे में हैं', 'بلاطاتك في الصينية'],
    'hint_over': ['The last lantern on the river wins', 'Gana el último farol en el río', 'La dernière lanterne sur la rivière gagne', 'Die letzte Laterne auf dem Fluss gewinnt', 'Vence a última lanterna no rio', '河上最后一盏灯笼获胜', 'नदी पर आख़िरी लालटेन जीतती है', 'آخر فانوس على النهر يفوز'],
    'pile': ['Pile: {count}', 'Mazo: {count}', 'Pioche : {count}', 'Stapel: {count}', 'Monte: {count}', '牌堆：{count}', 'ढेर: {count}', 'الكومة: {count}'],
    'server_player_count': ['two to eight players', 'de dos a ocho jugadores', 'de deux à huit joueurs', 'zwei bis acht Spieler', 'de dois a oito jogadores', '需要二至八名玩家', 'दो से आठ खिलाड़ी', 'من لاعبَين إلى ثمانية'],
    'server_unknown_player': ['unknown player', 'jugador desconocido', 'joueur inconnu', 'unbekannter Spieler', 'jogador desconhecido', '未知玩家', 'अज्ञात खिलाड़ी', 'لاعب غير معروف'],
    'server_game_over': ['game over', 'partida terminada', 'partie terminée', 'Spiel beendet', 'jogo encerrado', '游戏结束', 'खेल समाप्त', 'انتهت اللعبة'],
    'server_not_your_turn': ['not your turn', 'no es tu turno', 'ce n’est pas votre tour', 'du bist nicht dran', 'não é sua vez', '未轮到你', 'आपकी बारी नहीं', 'ليس دورك'],
    'server_choose_gate': ['choose a starting gate', 'elige una entrada', 'choisissez une entrée', 'wähle ein Starttor', 'escolha uma entrada', '请选择出发入口', 'शुरुआती द्वार चुनें', 'اختر بوابة البداية'],
    'server_gate_taken': ['that gate is taken', 'esa entrada está ocupada', 'cette entrée est prise', 'dieses Tor ist besetzt', 'essa entrada está ocupada', '该入口已被占用', 'वह द्वार भरा है', 'هذه البوابة مشغولة'],
    'server_choose_tile': ['choose a tile', 'elige una loseta', 'choisissez une tuile', 'wähle ein Plättchen', 'escolha uma peça', '请选择水道板', 'टाइल चुनें', 'اختر بلاطة'],
    'server_not_in_hand': ['that tile is not in your hand', 'esa loseta no está en tu mano', 'cette tuile n’est pas dans votre main', 'dieses Plättchen hast du nicht', 'essa peça não está na sua mão', '你手中没有这块板', 'वह टाइल आपके हाथ में नहीं', 'هذه البلاطة ليست في يدك'],
    'server_bad_rotation': ['bad rotation', 'giro no válido', 'orientation non valide', 'ungültige Drehung', 'giro inválido', '无效的方向', 'अमान्य घुमाव', 'اتجاه غير صالح'],
    'server_off_board': ['that sends your lantern off the board', 'eso saca tu farol del tablero', 'cela envoie votre lanterne hors du plateau', 'damit verlässt deine Laterne das Brett', 'isso manda sua lanterna para fora', '这样你的灯笼会漂出棋盘', 'इससे आपकी लालटेन बोर्ड से बाहर जाएगी', 'هذا يُخرج فانوسك من اللوح'],
}


def strings(index=0):
    return {'title': TITLES[index], **{key: values[index] for key, values in TEXTS.items()}}


SCHEMAS = {
    'state': {
        '$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'additionalProperties': False,
        'required': ['phase', 'board', 'hands', 'pile', 'markers', 'gates', 'dragon', 'cur', 'turn_no', 'out_order', 'winners', 'last'],
        'properties': {
            'phase': {'enum': ['start', 'play', 'over']},
            'board': {'type': 'array', 'minItems': 36, 'maxItems': 36, 'items': {'$ref': '#/$defs/placed'}},
            'hands': {'type': 'array', 'minItems': 2, 'maxItems': 8, 'items': {'$ref': '#/$defs/tiles'}},
            'pile': {'$ref': '#/$defs/tiles'},
            'markers': {'type': 'array', 'minItems': 2, 'maxItems': 8, 'items': {'$ref': '#/$defs/marker'}},
            'gates': {'type': 'array', 'minItems': 2, 'maxItems': 8, 'items': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 47}},
            'dragon': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 7},
            'cur': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 7},
            'turn_no': {'type': 'integer', 'minimum': 0},
            'out_order': {'type': 'array', 'items': {'type': ['integer', 'null'], 'minimum': 0}},
            'winners': {'type': ['array', 'null'], 'items': {'type': 'integer', 'minimum': 0, 'maximum': 7}},
            'last': {'$ref': '#/$defs/last'}},
        '$defs': {}},
    'move': {
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        'oneOf': [
            {'type': 'object', 'additionalProperties': False, 'required': ['gate'],
             'properties': {'gate': {'type': 'integer', 'minimum': 0, 'maximum': 47}}},
            {'type': 'object', 'additionalProperties': False, 'required': ['tile', 'rotation'],
             'properties': {'tile': {'type': 'integer', 'minimum': 0, 'maximum': 34},
                            'rotation': {'type': 'integer', 'minimum': 0, 'maximum': 3}}}]},
    'view': {
        '$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'additionalProperties': False,
        'required': ['phase', 'board', 'markers', 'gates', 'hand', 'hand_counts', 'pile', 'dragon', 'cur', 'turn_no',
                     'out_order', 'winners', 'winner', 'last', 'me'],
        'properties': {
            'phase': {'enum': ['start', 'play', 'over']},
            'board': {'type': 'array', 'minItems': 36, 'maxItems': 36, 'items': {'$ref': '#/$defs/placed'}},
            'markers': {'type': 'array', 'minItems': 2, 'maxItems': 8, 'items': {'$ref': '#/$defs/marker'}},
            'gates': {'type': 'array', 'items': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 47}},
            'hand': {'oneOf': [{'type': 'null'}, {'$ref': '#/$defs/tiles'}]},
            'hand_counts': {'type': 'array', 'items': {'type': 'integer', 'minimum': 0, 'maximum': 3}},
            'pile': {'type': 'integer', 'minimum': 0, 'maximum': 35},
            'dragon': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 7},
            'cur': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 7},
            'turn_no': {'type': 'integer', 'minimum': 0},
            'out_order': {'type': 'array', 'items': {'type': ['integer', 'null'], 'minimum': 0}},
            'winners': {'type': ['array', 'null'], 'items': {'type': 'integer', 'minimum': 0, 'maximum': 7}},
            'winner': {'type': ['integer', 'null'], 'minimum': -1, 'maximum': 7},
            'last': {'$ref': '#/$defs/last'},
            'me': {'type': 'integer', 'minimum': -1, 'maximum': 7}},
        '$defs': {}},
}
DEFS = {
    'placed': {'oneOf': [{'type': 'null'}, {'type': 'array', 'minItems': 2, 'maxItems': 2, 'prefixItems': [
        {'type': 'integer', 'minimum': 0, 'maximum': 34}, {'type': 'integer', 'minimum': 0, 'maximum': 3}]}]},
    'tiles': {'type': 'array', 'maxItems': 35, 'items': {'type': 'integer', 'minimum': 0, 'maximum': 34}},
    'marker': {'oneOf': [{'type': 'null'}, {'type': 'object', 'additionalProperties': False, 'required': ['at', 'out'], 'properties': {
        'at': {'type': 'integer', 'minimum': 0, 'maximum': 287}, 'out': {'enum': [None, 'edge', 'collision']}}}]},
    'last': {'oneOf': [
        {'type': 'null'},
        {'type': 'object', 'additionalProperties': False, 'required': ['kind', 'seat', 'gate'],
         'properties': {'kind': {'const': 'gate'}, 'seat': {'type': 'integer'}, 'gate': {'type': 'integer'}}},
        {'type': 'object', 'additionalProperties': False, 'required': ['kind', 'seat', 'square', 'tile', 'rotation', 'moved'],
         'properties': {'kind': {'const': 'tile'}, 'seat': {'type': 'integer'}, 'square': {'type': 'integer', 'minimum': 0, 'maximum': 35},
                        'tile': {'type': 'integer'}, 'rotation': {'type': 'integer'},
                        'moved': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['seat', 'steps'],
                                  'properties': {'seat': {'type': 'integer'}, 'steps': {'type': 'array', 'items': {'type': 'integer'}}}}}}}]},
}


def schemas():
    out = copy.deepcopy(SCHEMAS)
    for name in ('state', 'view'):
        out[name]['$defs'] = copy.deepcopy(DEFS)
    return out


# ---- geometry (mirrors the server) -----------------------------------------
POINT_XY = [(30, 0), (60, 0), (90, 30), (90, 60), (60, 90), (30, 90), (0, 60), (0, 30)]
INWARD = [(0, 1), (0, 1), (-1, 0), (-1, 0), (0, -1), (0, -1), (1, 0), (1, 0)]
STEP = [(-1, 0), (-1, 0), (0, 1), (0, 1), (1, 0), (1, 0), (0, -1), (0, -1)]


def tiles():
    found = []

    def build(conn):
        if -1 not in conn:
            found.append(conn[:])
            return
        i = conn.index(-1)
        for j in range(i + 1, 8):
            if conn[j] < 0:
                conn[i], conn[j] = j, i
                build(conn)
                conn[i] = conn[j] = -1
    build([-1] * 8)

    def rotate(conn, k):
        out = [0] * 8
        for p in range(8):
            out[(p + 2 * k) % 8] = (conn[p] + 2 * k) % 8
        return out
    keys = sorted({min(''.join(map(str, rotate(c, k))) for k in range(4)) for c in found})
    return [[int(ch) for ch in key] for key in keys]


TILES = tiles()
PAIRS = [(a, b) for a in range(8) for b in range(a + 1, 8)]


def canonical(a, b):
    """The pair's shape class and quarter turns: rotating the class pair k
    quarter turns clockwise gives (a, b). Seven classes cover all 28 pairs."""
    best = None
    for k in range(4):
        x, y = sorted(((a - 2 * k) % 8, (b - 2 * k) % 8))
        if best is None or (x, y) < best[0]:
            best = ((x, y), k)
    return best


CLASSES = sorted({canonical(a, b)[0] for a, b in PAIRS})


def curve(a, b):
    (ax, ay), (bx, by) = POINT_XY[a], POINT_XY[b]
    same_side = a // 2 == b // 2
    d = 22 if same_side else 34
    (nax, nay), (nbx, nby) = INWARD[a], INWARD[b]
    return f'M{ax} {ay}C{ax + nax * d} {ay + nay * d} {bx + nbx * d} {by + nby * d} {bx} {by}'


def uri(svg):
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="{0}">'


def tile_svg(conn):
    """A tile: dark water slab with four channels (bank, then water, so
    crossings read as bridges). Flat colours, no ids: the host inlines every
    picture into one page."""
    parts = [SVG.format('0 0 90 90'), '<rect x="1" y="1" width="88" height="88" rx="7" fill="#1a4253" stroke="#0a1d28" stroke-width="2"/>']
    done = set()
    for a in range(8):
        b = conn[a]
        key = (min(a, b), max(a, b))
        if key in done:
            continue
        done.add(key)
        d = curve(a, b)
        parts.append(f'<path d="{d}" fill="none" stroke="#0b1d29" stroke-width="13"/><path d="{d}" fill="none" stroke="#7fdcd3" stroke-width="6"/>')
    parts.append('</svg>')
    return ''.join(parts)


def trail_svg(a, b, color, dashed=False, glow=True):
    path = curve(a, b)
    dash = ' stroke-dasharray="9 6"' if dashed else ''
    halo = f'<path d="{path}" fill="none" stroke="{color}" stroke-opacity=".3" stroke-width="14"/>' if glow else ''
    return (SVG.format('0 0 90 90') + halo +
            f'<path d="{path}" fill="none" stroke="{color}" stroke-width="6.5" stroke-linecap="round"{dash}/></svg>')


def shade(hex_color, factor):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(v * factor))) for v in (r, g, b))


def lantern_svg(color):
    dark = shade(color, 0.55)
    return (SVG.format('0 0 46 46') +
            f'<circle cx="23" cy="24" r="21" fill="{color}" fill-opacity="0.22"/>'
            f'<rect x="17" y="6" width="12" height="5" rx="2" fill="#3b2a1c"/>'
            f'<ellipse cx="23" cy="24" rx="13" ry="14" fill="{color}" stroke="{dark}" stroke-width="2"/>'
            f'<path d="M17 12q-5 12 0 24M29 12q5 12 0 24M23 10v28" stroke="{dark}" stroke-width="1.5" fill="none"/>'
            '<ellipse cx="20" cy="20" rx="4" ry="6" fill="#fff8e0" fill-opacity="0.55"/>'
            '<rect x="18" y="37" width="10" height="4" rx="2" fill="#3b2a1c"/></svg>')


def river_svg():
    parts = [SVG.format('0 0 600 600'),
             '<defs><radialGradient id="ltriver" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#173353"/>'
             '<stop offset="1" stop-color="#0b1626"/></radialGradient></defs>',
             '<rect width="600" height="600" rx="18" fill="url(#ltriver)"/>']
    for i in range(7):
        y = 8 + i * 98
        parts.append(f'<path d="M6 {y}q18-7 36 0t36 0" stroke="#24476a" stroke-width="2" fill="none" stroke-opacity="0.6"/>'
                     f'<path d="M520 {y + 40}q18-7 36 0t36 0" stroke="#24476a" stroke-width="2" fill="none" stroke-opacity="0.6"/>')
    parts.append('<rect x="27" y="27" width="546" height="546" rx="8" fill="#0d1a2a" stroke="#2f557a" stroke-width="2"/>')
    for r in range(6):
        for c in range(6):
            parts.append(f'<rect x="{32 + c * 90}" y="{32 + r * 90}" width="86" height="86" rx="6" fill="#132a40" stroke="#1d3b58" stroke-width="1.5"/>')
    for side in range(4):
        for k in range(12):
            n, half = k >> 1, k & 1
            if side == 0:
                x, y = 30 + n * 90 + (30 if half == 0 else 60), 30 - 14
            elif side == 1:
                x, y = 570 + 14, 30 + n * 90 + (30 if half == 0 else 60)
            elif side == 2:
                x, y = 570 - n * 90 - (30 if half == 0 else 60), 570 + 14
            else:
                x, y = 30 - 14, 570 - n * 90 - (30 if half == 0 else 60)
            parts.append(f'<circle cx="{x}" cy="{y}" r="5" fill="#ffd98a" fill-opacity="0.75"/>'
                         f'<circle cx="{x}" cy="{y}" r="9" fill="#ffd98a" fill-opacity="0.15"/>')
    parts.append('</svg>')
    return ''.join(parts)


def arrow_svg(clockwise):
    """A round turn button: a 270° arc with an arrowhead along its direction."""
    cx = cy = 46
    r = 22
    m = 1 if clockwise else -1          # mirror x for counterclockwise
    start = (cx - m * r, cy)             # left (or right) of centre
    theta = math.radians(45)             # ends below, to the right (or left)
    end = (cx + m * r * math.cos(theta), cy + r * math.sin(theta))
    direction = (-m * math.sin(theta), math.cos(theta))
    perp = (direction[1], -direction[0])
    tip = (end[0] + direction[0] * 11, end[1] + direction[1] * 11)
    left = (end[0] + perp[0] * 9 - direction[0] * 2, end[1] + perp[1] * 9 - direction[1] * 2)
    right = (end[0] - perp[0] * 9 - direction[0] * 2, end[1] - perp[1] * 9 - direction[1] * 2)
    f = lambda pt: f'{pt[0]:.1f} {pt[1]:.1f}'
    return (SVG.format('0 0 92 92') +
            '<circle cx="46" cy="46" r="42" fill="#1e3d5c" stroke="#ffd98a" stroke-width="3"/>'
            f'<path d="M{f(start)}A{r} {r} 0 1 {1 if clockwise else 0} {f(end)}" fill="none" stroke="#ffe9b0" stroke-width="7" stroke-linecap="round"/>'
            f'<path d="M{f(tip)}L{f(left)}L{f(right)}Z" fill="#ffe9b0"/></svg>')


def gatepick_svg(point):
    """Drawn for the top side; pieces turn it to the gate's side."""
    x, y = POINT_XY[point]
    gx, gy = 26 + x * 0.66, 26 + y * 0.66
    side = point // 2
    edge = {0: (26, 26, 85.4, 26), 1: (85.4, 26, 85.4, 85.4), 2: (26, 85.4, 85.4, 85.4), 3: (26, 26, 26, 85.4)}[side]
    return (SVG.format('0 0 112 112') +
            '<rect x="3" y="3" width="106" height="106" rx="14" fill="#1b3652"/>'
            '<rect x="26" y="26" width="59.4" height="59.4" rx="5" fill="#132a40" stroke="#3c6a94" stroke-width="2"/>'
            f'<line x1="{edge[0]}" y1="{edge[1]}" x2="{edge[2]}" y2="{edge[3]}" stroke="#ffd98a" stroke-width="4" stroke-linecap="round"/>'
            f'<circle cx="{gx}" cy="{gy}" r="13" fill="#ffd98a" fill-opacity="0.35"/><circle cx="{gx}" cy="{gy}" r="8" fill="#fff1c4"/></svg>')


FRAME = (SVG.format('0 0 112 112') + '<rect x="3" y="3" width="106" height="106" rx="14" fill="none" stroke="#ffd98a" stroke-width="3"/></svg>')
PICK = (SVG.format('0 0 90 90') + '<rect x="5" y="5" width="80" height="80" rx="8" fill="#ffd98a" fill-opacity="0.14" '
        'stroke="#ffd98a" stroke-width="3" stroke-dasharray="10 6"/></svg>')
PICK_ON = (SVG.format('0 0 90 90') + '<rect x="4" y="4" width="82" height="82" rx="8" fill="#ffd98a" fill-opacity="0.32" '
           'stroke="#fff1c4" stroke-width="5"/></svg>')
PLACE_FRAME = (SVG.format('0 0 90 90') + '<rect x="3" y="3" width="84" height="84" rx="8" fill="none" '
               'stroke="#fff1c4" stroke-width="4" stroke-dasharray="12 7"/></svg>')
RING = (SVG.format('0 0 60 60') + '<circle cx="30" cy="30" r="27" fill="none" stroke="#ffffff" stroke-width="3"/></svg>')


def glow_svg(color):
    return (SVG.format('0 0 96 96') + f'<rect x="3" y="3" width="90" height="90" rx="9" fill="none" stroke="{color}" '
            'stroke-width="4"/>' f'<rect x="0.5" y="0.5" width="95" height="95" rx="11" fill="none" stroke="{color}" '
            'stroke-opacity="0.35" stroke-width="3"/></svg>')


def asset(svg):
    return {'uri': uri(svg), 'media_type': 'image/svg+xml'}


def specification():
    assets = {'river': asset(river_svg()), 'pick': asset(PICK), 'pick_on': asset(PICK_ON), 'place_frame': asset(PLACE_FRAME),
              'frame': asset(FRAME), 'glow': asset(glow_svg('#fff1c4')), 'ring': asset(RING), 'rot_cw': asset(arrow_svg(True)), 'rot_ccw': asset(arrow_svg(False))}
    for i, conn in enumerate(TILES):
        assets[f'tile_{i}'] = asset(tile_svg(conn))
    # (The host allows at most 128 pictures; this set uses 126.)
    for p in (0, 1):
        assets[f'gatepick_{p}'] = asset(gatepick_svg(p))
    for key, color in zip(COLOR_KEYS, COLOR_HEX):
        assets[f'lantern_{key}'] = asset(lantern_svg(color))
        for a, b in CLASSES:
            assets[f'trail_{key}_{a}{b}'] = asset(trail_svg(a, b, color))
    for a, b in CLASSES:
        assets[f'route_ok_{a}{b}'] = asset(trail_svg(a, b, '#fff4c2', dashed=True, glow=False))
    server = (DEST / f'{KIND}.server.js').read_text()
    shared = server[server.index('// ---- shared geometry'):server.index('// ---- end shared geometry ----')]
    return {'format': 'buildplay-ui', 'version': 1, 'viewport': {'width': 600, 'height': 870},
            'motion': {'move_ms': 900, 'turn_pause_ms': 500},
            'assets': assets,
            'boards': [
                {'id': 'hud', 'kind': 'zone', 'x': 0, 'y': 0, 'width': 600, 'height': 120, 'color': '#101e30', 'line_color': '#101e30'},
                {'id': 'frame', 'kind': 'zone', 'x': 0, 'y': 120, 'width': 600, 'height': 600, 'color': '#0b1626', 'line_color': '#0b1626'},
                {'id': 'board', 'kind': 'grid', 'x': 30, 'y': 150, 'width': 540, 'height': 540, 'rows': 6, 'columns': 6,
                 'color': '#132a40', 'alternate_color': '#132a40', 'line_color': '#1d3b58'},
                {'id': 'tray', 'kind': 'zone', 'x': 0, 'y': 720, 'width': 600, 'height': 150, 'color': '#101e30', 'line_color': '#101e30'}],
            'piece_types': {
                'river': {'shape': 'image', 'width': 600, 'height': 600, 'asset': 'river'},
                'tile': {'shape': 'image', 'width': 90, 'height': 90, 'asset': 'tile_0', 'font_size': 54, 'text_color': '#ff4d5e'},
                'hand_tile': {'shape': 'image', 'width': 112, 'height': 112, 'asset': 'tile_0'},
                'trail': {'shape': 'image', 'width': 90, 'height': 90, 'asset': 'route_ok_01'},
                'glow': {'shape': 'image', 'width': 96, 'height': 96, 'asset': 'glow'},
                'gatepick': {'shape': 'image', 'width': 112, 'height': 112, 'asset': 'gatepick_0'},
                'lantern': {'shape': 'image', 'width': 46, 'height': 46, 'asset': 'lantern_amber', 'font_size': 18, 'text_color': '#1a1208'},
                'badge': {'shape': 'image', 'width': 46, 'height': 46, 'asset': 'lantern_amber'},
                'ring': {'shape': 'image', 'width': 60, 'height': 60, 'asset': 'ring'}},
            'strings': strings(),
            'ui_code': 'const SOURCE_STRINGS=' + json.dumps(strings(), ensure_ascii=False) + ';\n' + shared + '\n' +
                       (DEST / f'{KIND}.ui.js').read_text()}


# ---- unit test cases and pictures ------------------------------------------
def illustration(view, caption):
    """A small static picture of a position: channels on placed tiles, lanterns as dots."""
    parts = [SVG.format('0 0 380 380'), '<rect width="380" height="380" fill="#0b1626"/>',
             '<path d="' + ''.join(f'M{10 + c * 60} {10 + r * 60}h58v58h-58z' for r in range(6) for c in range(6)) + '" fill="#132a40"/>']
    channels = []
    for sq, placed in enumerate(view['board']):
        if not placed:
            continue
        x, y = 10 + (sq % 6) * 60, 10 + (sq // 6) * 60
        tile, rot = placed
        conn = TILES[tile]
        turned = [0] * 8
        for p in range(8):
            turned[(p + 2 * rot) % 8] = (conn[p] + 2 * rot) % 8
        for a in range(8):
            b = turned[a]
            if a < b:
                (ax, ay), (bx, by) = POINT_XY[a], POINT_XY[b]
                k = 2 / 3
                mx, my = (ax + bx) / 2 * k + 45 * (1 - k), (ay + by) / 2 * k + 45 * (1 - k)
                channels.append(f'M{x + ax * k:.0f} {y + ay * k:.0f}Q{x + mx * k:.0f} {y + my * k:.0f} {x + bx * k:.0f} {y + by * k:.0f}')
    if channels:
        parts.append(f'<path d="{"".join(channels)}" fill="none" stroke="#7fdcd3" stroke-width="4"/>')
    for seat, marker in enumerate(view['markers']):
        if not marker:
            continue
        sq, p = divmod(marker['at'], 8)
        px, py = POINT_XY[p]
        cx, cy = 10 + (sq % 6) * 60 + px * 2 / 3, 10 + (sq // 6) * 60 + py * 2 / 3
        parts.append(f'<circle cx="{cx:.0f}" cy="{cy:.0f}" r="9" fill="{COLOR_HEX[seat]}" fill-opacity="{".4" if marker["out"] else "1"}" stroke="#1a1208" stroke-width="2"/>')
    parts.append('</svg>')
    return {'caption': caption, 'svg': ''.join(parts)}


def players(n):
    return [{'id': f'u{i + 1}', 'kind': 'human', 'display_name': name, 'picture_url': '', 'max_loss': 0, 'active': True}
            for i, name in enumerate(['Alice', 'Bob', 'Chen', 'Dara', 'Eli', 'Femi', 'Gus', 'Hana'][:n])]


def find_cases(logic, ctx):
    """Scan seeded random games for the rule situations worth pinning down."""
    wanted = {}
    for game_seed in range(1, 400):
        cctx = copy.deepcopy(ctx)
        result = logic.call('newMatch', ctx=cctx, seed=game_seed)
        for step in range(120):
            cctx['move_count'] = step
            state, pid, seed = result['state'], result['turn'][0], game_seed * 1000 + step
            move = logic.call('randomMove', state, pid, ctx=cctx, seed=seed)
            after = logic.call('applyMove', state, pid, move, ctx=cctx, seed=seed)
            if 'tile' in move:
                seat = state['cur']
                before_out = [m['out'] for m in state['markers']]
                new_out = {i: m['out'] for i, m in enumerate(after['state']['markers']) if m['out'] and not before_out[i]}
                if new_out.get(seat) == 'collision' and after['turn'] is None and 'collision' not in wanted:
                    wanted['collision'] = (copy.deepcopy(cctx), state, pid, move, after, seed)
                if new_out.get(seat) == 'edge' and 'forced' not in wanted:
                    wanted['forced'] = (copy.deepcopy(cctx), state, pid, move, after, seed)
                if seat not in new_out and any(v == 'edge' for v in new_out.values()) and 'push' not in wanted:
                    wanted['push'] = (copy.deepcopy(cctx), state, pid, move, after, seed)
            result = after
            if after['turn'] is None:
                break
        if len(wanted) == 3:
            return wanted
    raise RuntimeError(f'rule situations not found: {sorted(set(["collision", "forced", "push"]) - set(wanted))}')


def package():
    code = (DEST / f'{KIND}.server.js').read_text()
    game_schemas = schemas()
    logic = GameLogic(code, game_schemas=game_schemas)
    ctx = {'players': players(2), 'pot': 0, 'move_count': 0}
    result = logic.call('newMatch', ctx=ctx, seed=7)
    steps = []
    for i in range(80):
        ctx['move_count'] = i
        state, pid, seed = result['state'], result['turn'][0], i + 11
        move = logic.call('computerMove', state, pid, ctx=ctx, seed=seed)
        result = logic.call('applyMove', state, pid, move, ctx=ctx, seed=seed)
        steps.append((copy.deepcopy(ctx), state, pid, move, result, seed))
        if result['turn'] is None:
            break
    else:
        raise RuntimeError('Lantern Trails did not finish')
    selected = [('initial', 'Choosing a starting gate', steps[0]),
                ('intermediate', 'Placing a tile moves the lantern along its channel', steps[len(steps) // 2]),
                ('terminal', 'Terminal move', steps[-1])]
    found = find_cases(logic, {'players': players(2), 'pot': 0, 'move_count': 0})
    selected.append(('terminal', 'Two lanterns meet: both are out and share the win', found['collision']))
    selected.append(('intermediate', 'Laying a tile can send a rival lantern off the edge', found['push']))
    selected.append(('intermediate', 'When every tile and turn leads off the edge, one must still be played', found['forced']))
    cases = []
    for kind, label, (cctx, state, pid, move, after, seed) in selected:
        ids = [p['id'] for p in cctx['players']]
        other = next(i for i in ids if i != pid)
        before_views = [logic.call('viewFor', state, who, ctx=cctx, seed=seed) for who in (pid, other)]
        next_ctx = {**cctx, 'move_count': cctx['move_count'] + 1}
        after_views = [logic.call('viewFor', after['state'], who, ctx=next_ctx, seed=seed) for who in (pid, other)]
        case = {'name': label, 'description': RULES[0], 'kind': kind,
                'ctx': {**cctx, 'seed': seed}, 'state': state, 'view_of_mover': before_views[0], 'view_of_other': before_views[1],
                'player_id': pid, 'other_player_id': other, 'move': move,
                'expected_state': after['state'], 'expected_turn': after['turn'],
                'expected_view_of_mover': after_views[0], 'expected_view_of_other': after_views[1],
                'images': [illustration(view, caption) for view, caption in zip(
                    before_views + after_views, ['Before: mover', 'Before: other player', 'After: mover', 'After: other player'])]}
        if 'payouts' in after:
            case['expected_payouts'] = after['payouts']
        cases.append(case)
    middle = cases[1]['images'][2]['svg'].removeprefix(SVG.format('0 0 380 380')).removesuffix('</svg>')
    cover = (SVG.format('0 0 800 450') + '<rect width="800" height="450" fill="#101e30"/>'
             f'<g transform="translate(206 12) scale(1.1)">{middle}</g></svg>')
    return {'name': TITLES[0], 'description': RULES[0], 'allowed_player_counts': list(range(2, 9)), 'all_state_public': False,
            'server_code': code, 'declarative_ui': specification(),
            'game_addition_request_id_and_secret': f'example-only-declarative-{KIND}-replace-before-publishing',
            'rules': RULES[0], 'ui_instructions': UI_RULES[0],
            'tutorial': {'text': RULES[0], 'html': '<meta name="viewport" content="width=device-width,initial-scale=1"><p>' + html.escape(RULES[0]) + '</p>'},
            'images': [{'caption': 'Cover', 'svg': cover}, *cases[1]['images'][:3]],
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
