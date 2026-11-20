"""Build the edge-target declarative games: Sim, Paper Soccer, Hackenbush and Cartographers.

Run from the package parent: python -m game_platform.tools.build_edge_games.
These games offer lines, points and shape placements as explicit scene targets. The
fixture secrets are public examples: replace them before submitting to a live service.
"""
from __future__ import annotations

import copy
import html
import json
import math
from pathlib import Path

from game_platform.game_logic import GameLogic

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'games' / 'declarative'
LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
KINDS = ('sim', 'paper_soccer', 'hackenbush', 'cartographers')
ENGINE_KIND = {'cartographers': 'cartographers'}

GEO = {
    'ground_y': 430,
    'hack_nodes': [
        [60, 430], [190, 430], [330, 430], [480, 430],
        [60, 350], [60, 270], [20, 210], [110, 210], [110, 140],
        [190, 350], [190, 270], [150, 200], [240, 200],
        [330, 350], [300, 280], [370, 280], [370, 200],
        [480, 350], [480, 270], [440, 200], [530, 200],
    ],
    # [from, to, colour]: colour 0 is Blue (player 1), colour 1 is Red (player 2).
    'hack_edges': [
        [0, 4, 0], [4, 5, 1], [5, 6, 0], [5, 7, 1], [7, 8, 0],
        [1, 9, 1], [9, 10, 0], [10, 11, 1], [10, 12, 0],
        [2, 13, 0], [13, 14, 1], [13, 15, 0], [15, 16, 1],
        [3, 17, 1], [17, 18, 0], [18, 19, 1], [18, 20, 0],
    ],
    'mountains': [8, 12, 24, 36, 40],
    'shapes': [
        [[0, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [0, 2]],
        [[0, 0], [1, 0], [2, 0], [2, 1]], [[0, 0], [0, 1], [0, 2], [1, 1]],
        [[0, 1], [0, 2], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 0], [1, 1]],
    ],
    'deck': [[0, 3], [1, 1], [2, 2], [3, 3], [0, 4], [1, 2], [2, 5], [3, 6], [0, 0], [1, 7], [2, 4], [3, 1]],
    'colors': ['#3f9d4f', '#d98c4a', '#e6c65a', '#4f8cff'],
}


def tr(*values):
    assert len(values) == 8, values
    return list(values)


TITLES = {
    'sim': tr('Sim', 'Sim', 'Sim', 'Sim', 'Sim', 'Sim 三角棋', 'सिम', 'سيم'),
    'paper_soccer': tr('Paper Soccer', 'Fútbol de papel', 'Football sur papier', 'Papierfußball', 'Futebol de papel',
                       '纸上足球', 'पेपर फुटबॉल', 'كرة القدم الورقية'),
    'hackenbush': tr('Hackenbush', 'Hackenbush', 'Hackenbush', 'Hackenbush', 'Hackenbush',
                     '砍树游戏', 'हैकेनबुश', 'هاكنبوش'),
    'cartographers': tr('Cartographers', 'Cartógrafos', 'Cartographes', 'Kartografen', 'Cartógrafos',
                        '制图师', 'मानचित्रकार', 'رسامو الخرائط'),
}
RULES = {
    'sim': tr(
        'Six dots form a hexagon with fifteen possible lines. Players take turns claiming one unclaimed line in their colour. The first player to complete a triangle entirely in their own colour loses.',
        'Seis puntos forman un hexágono con quince líneas posibles. Por turnos, cada jugador reclama una línea libre de su color. Quien complete primero un triángulo de su propio color pierde.',
        'Six points forment un hexagone avec quinze lignes possibles. À tour de rôle, chacun trace une ligne libre de sa couleur. Le premier qui complète un triangle entièrement de sa couleur perd.',
        'Sechs Punkte bilden ein Sechseck mit fünfzehn möglichen Linien. Abwechselnd beansprucht jede Person eine freie Linie in ihrer Farbe. Wer zuerst ein Dreieck ganz in der eigenen Farbe schließt, verliert.',
        'Seis pontos formam um hexágono com quinze linhas possíveis. Em turnos, cada jogador reivindica uma linha livre da sua cor. Quem completar primeiro um triângulo inteiro da própria cor perde.',
        '六个点组成六边形，共有十五条可能的线。双方轮流用自己的颜色占一条空线。最先连成完全属于自己颜色的三角形的一方落败。',
        'छह बिंदु एक षट्भुज बनाते हैं जिसमें पंद्रह संभावित रेखाएँ होती हैं। खिलाड़ी बारी-बारी से अपने रंग में एक खाली रेखा चुनते हैं। जो सबसे पहले अपने ही रंग का पूरा त्रिभुज बना ले, वह हार जाता है।',
        'تشكّل ست نقاط سداسيًا فيه خمسة عشر خطًا ممكنًا. يتناوب اللاعبان على اختيار خط فارغ بلونه. من يكمل أولًا مثلثًا كاملًا بلونه يخسر.'),
    'paper_soccer': tr(
        'Move the ball one step along any of eight directions on the pitch, drawing a line that cannot be reused or run along the touchline. Landing on a point that already has a line, or the edge of the pitch, gives you another move. Enter the opponent\'s goal to win; a player who cannot move loses. After 120 moves the game is a draw.',
        'Mueve el balón un paso en cualquiera de ocho direcciones, trazando una línea que no se puede repetir ni seguir por la banda. Si caes en un punto que ya tiene línea o en el borde del campo, juegas otra vez. Entra en la portería rival para ganar; quien no pueda mover pierde. Tras 120 jugadas hay empate.',
        'Déplacez le ballon d\'un pas dans l\'une des huit directions en traçant une ligne qui ne peut ni être réutilisée ni longer la touche. Arriver sur un point déjà relié ou sur le bord du terrain donne un nouveau coup. Entrez dans le but adverse pour gagner ; qui ne peut plus jouer perd. Après 120 coups, la partie est nulle.',
        'Bewege den Ball einen Schritt in eine von acht Richtungen und zeichne eine Linie, die nicht wiederholt werden oder an der Seitenlinie entlanglaufen darf. Wer auf einem Punkt mit Linie oder am Spielfeldrand landet, darf noch einmal ziehen. Triff das gegnerische Tor, um zu gewinnen; wer nicht ziehen kann, verliert. Nach 120 Zügen ist es unentschieden.',
        'Mova a bola um passo em uma das oito direções, desenhando uma linha que não pode ser repetida nem seguir a lateral. Cair em um ponto que já tem linha ou na borda do campo dá outra jogada. Entre no gol adversário para vencer; quem não puder jogar perde. Após 120 jogadas, empate.',
        '沿八个方向之一把球移动一步并画线，线不能重复，也不能沿边线。落在已有线的点或场地边缘时可再走一步。把球送入对方球门即获胜；无法移动的一方落败。满 120 步为平局。',
        'गेंद को आठ दिशाओं में से किसी एक में एक कदम चलाएँ और रेखा खींचें; रेखा दोहराई नहीं जा सकती और किनारे की रेखा पर नहीं चल सकती। पहले से रेखा वाले बिंदु या मैदान के किनारे पर पहुँचने पर एक और चाल मिलती है। विरोधी के गोल में पहुँचकर जीतें; जो चल न सके वह हार जाता है। 120 चालों के बाद खेल बराबर रहता है।',
        'حرّك الكرة خطوة واحدة في أحد ثمانية اتجاهات مع رسم خط لا يمكن إعادة استخدامه ولا السير به على خط التماس. الهبوط على نقطة فيها خط أو على حافة الملعب يمنحك حركة أخرى. أدخل مرمى الخصم لتفوز؛ ومن لا يستطيع التحرك يخسر. بعد 120 حركة تنتهي المباراة بالتعادل.'),
    'hackenbush': tr(
        'Blue and Red take turns cutting one branch of their own colour from the picture. Any branches no longer connected to the ground fall away. A player who has no branch of their colour left to cut loses.',
        'Azul y Rojo cortan por turnos una rama de su propio color. Las ramas que dejan de estar conectadas con el suelo caen. Pierde quien no tenga ninguna rama de su color que cortar.',
        'Bleu et Rouge coupent à tour de rôle une branche de leur couleur. Les branches qui ne sont plus reliées au sol tombent. Celui qui n\'a plus de branche de sa couleur à couper perd.',
        'Blau und Rot schneiden abwechselnd einen Ast der eigenen Farbe ab. Äste ohne Verbindung zum Boden fallen weg. Wer keinen Ast der eigenen Farbe mehr abschneiden kann, verliert.',
        'Azul e Vermelho cortam em turnos um galho da própria cor. Os galhos que perdem a ligação com o chão caem. Perde quem não tiver mais galhos da sua cor para cortar.',
        '蓝方和红方轮流剪掉一根自己颜色的树枝。与地面断开的树枝会掉落。没有自己颜色树枝可剪的一方落败。',
        'नीला और लाल बारी-बारी से अपने रंग की एक शाखा काटते हैं। जो शाखाएँ जमीन से जुड़ी नहीं रहतीं, वे गिर जाती हैं। जिसके पास अपने रंग की कोई शाखा काटने को न बचे, वह हार जाता है।',
        'يتناوب الأزرق والأحمر على قطع فرع واحد بلونه. الفروع التي ينقطع اتصالها بالأرض تسقط. من لا يبقى له فرع بلونه ليقطعه يخسر.'),
    'cartographers': tr(
        'A two-player adaptation. Each of twelve cards names a terrain and a shape. You and your opponent place that shape on your own 7 by 7 map, then the next card is drawn. Rotate or flip a shape before placing it; mountains and filled squares block it. After every third card a season is scored, and the player with the most stars after four seasons wins.',
        'Una adaptación para dos jugadores. Cada una de las doce cartas indica un terreno y una forma. Tú y tu rival colocáis esa forma en vuestro propio mapa de 7 por 7 y se roba la siguiente carta. Gira o voltea la forma antes de colocarla; las montañas y las casillas ocupadas la bloquean. Cada tres cartas se puntúa una estación, y gana quien tenga más estrellas tras cuatro estaciones.',
        'Une adaptation à deux joueurs. Chacune des douze cartes indique un terrain et une forme. Vous et votre adversaire placez cette forme sur votre propre carte de 7 sur 7, puis on tire la carte suivante. Tournez ou retournez la forme avant de la poser ; les montagnes et les cases occupées la bloquent. Une saison est comptée toutes les trois cartes, et le plus d\'étoiles après quatre saisons gagne.',
        'Eine Anpassung für zwei Personen. Jede der zwölf Karten nennt ein Gelände und eine Form. Du und dein Gegenüber legt die Form auf die eigene 7-mal-7-Karte, dann wird die nächste Karte gezogen. Drehe oder spiegle die Form vor dem Legen; Berge und belegte Felder blockieren sie. Nach jeder dritten Karte wird eine Jahreszeit gewertet; nach vier Jahreszeiten gewinnt, wer die meisten Sterne hat.',
        'Uma adaptação para dois jogadores. Cada uma das doze cartas indica um terreno e uma forma. Você e o adversário colocam essa forma no próprio mapa 7 por 7 e a próxima carta é virada. Gire ou espelhe a forma antes de colocá-la; montanhas e casas ocupadas a bloqueiam. A cada três cartas, uma estação é pontuada, e vence quem tiver mais estrelas após quatro estações.',
        '双人改编版。十二张牌各自指定一种地形和一个形状。你和对手把该形状放在各自的 7×7 地图上，然后翻开下一张牌。放置前可旋转或翻转形状；山脉和已占格会阻挡它。每三张牌结算一个季节，四个季节后星数最多者获胜。',
        'दो खिलाड़ियों के लिए रूपांतरण। बारह कार्डों में से हर एक एक भूभाग और एक आकार बताता है। आप और प्रतिद्वंद्वी उस आकार को अपने-अपने 7×7 नक्शे पर रखते हैं, फिर अगला कार्ड खुलता है। रखने से पहले आकार को घुमाएँ या पलटें; पहाड़ और भरे हुए खाने उसे रोकते हैं। हर तीन कार्ड के बाद एक मौसम के अंक जुड़ते हैं, और चार मौसमों के बाद सबसे ज्यादा सितारों वाला जीतता है।',
        'تكييف للاعبَين. تحدد كل بطاقة من البطاقات الاثنتي عشرة تضاريس وشكلًا. تضع أنت وخصمك الشكل على خريطتكما الخاصة بحجم 7×7 ثم تُسحب البطاقة التالية. دوّر الشكل أو اقلبه قبل وضعه؛ تمنعه الجبال والمربعات المشغولة. بعد كل ثلاث بطاقات يُحتسب فصل، ويفوز صاحب أكبر عدد من النجوم بعد أربعة فصول.'),
}
UI_RULES = {
    'sim': tr(
        'Tap a highlighted marker on the line you want to claim. Each marker sits partway along its line, so crossing lines never share a marker.',
        'Toca el marcador resaltado de la línea que quieres reclamar. Cada marcador está a un tercio de su línea, así que las líneas que se cruzan nunca comparten marcador.',
        'Touchez le repère surligné de la ligne à prendre. Chaque repère se trouve au tiers de sa ligne : deux lignes qui se croisent ne partagent jamais un repère.',
        'Tippe auf die markierte Stelle der Linie, die du beanspruchen willst. Jede Markierung liegt ein Stück auf ihrer Linie, daher teilen sich kreuzende Linien nie eine Markierung.',
        'Toque no marcador destacado da linha que quer reivindicar. Cada marcador fica a um terço da sua linha, então linhas que se cruzam nunca dividem um marcador.',
        '点击想占据的那条线上高亮的标记。每个标记位于所在线的三分之一处，所以相交的线不会共用标记。',
        'जो रेखा चुननी है उस पर चमकते निशान को दबाएँ। हर निशान अपनी रेखा के एक-तिहाई हिस्से पर है, इसलिए एक-दूसरे को काटने वाली रेखाएँ कभी एक निशान साझा नहीं करतीं।',
        'اضغط العلامة المميزة على الخط الذي تريده. تقع كل علامة على ثلث خطها، لذلك لا تتشارك الخطوط المتقاطعة علامة واحدة.'),
    'paper_soccer': tr(
        'Tap a highlighted point next to the ball to move there. Green lines are Player 1\'s moves and pink lines are Player 2\'s. Player 1 attacks the top goal and Player 2 the bottom goal.',
        'Toca un punto resaltado junto al balón para moverte allí. Las líneas verdes son del jugador 1 y las rosas del jugador 2. El jugador 1 ataca la portería de arriba y el jugador 2 la de abajo.',
        'Touchez un point surligné à côté du ballon pour vous y rendre. Les lignes vertes sont celles du joueur 1 et les roses celles du joueur 2. Le joueur 1 attaque le but du haut et le joueur 2 celui du bas.',
        'Tippe auf einen markierten Punkt neben dem Ball, um dorthin zu ziehen. Grüne Linien gehören Spieler 1, rosa Linien Spieler 2. Spieler 1 greift das obere Tor an, Spieler 2 das untere.',
        'Toque em um ponto destacado ao lado da bola para ir até lá. As linhas verdes são do jogador 1 e as rosas do jogador 2. O jogador 1 ataca o gol de cima e o jogador 2 o de baixo.',
        '点击球旁边高亮的点即可移动到那里。绿线是玩家 1 的走法，粉线是玩家 2 的走法。玩家 1 进攻上方球门，玩家 2 进攻下方球门。',
        'गेंद के पास चमकते बिंदु को दबाकर वहाँ जाएँ। हरी रेखाएँ खिलाड़ी 1 की और गुलाबी रेखाएँ खिलाड़ी 2 की चालें हैं। खिलाड़ी 1 ऊपरी गोल पर और खिलाड़ी 2 निचले गोल पर हमला करता है।',
        'اضغط نقطة مميزة بجوار الكرة للانتقال إليها. الخطوط الخضراء للاعب 1 والوردية للاعب 2. يهاجم اللاعب 1 المرمى العلوي واللاعب 2 المرمى السفلي.'),
    'hackenbush': tr(
        'Tap the marker on one of your own branches to cut it. Blue is Player 1 and Red is Player 2. Only branches of your colour have markers.',
        'Toca el marcador de una de tus ramas para cortarla. Azul es el jugador 1 y Rojo el jugador 2. Solo las ramas de tu color tienen marcador.',
        'Touchez le repère d\'une de vos branches pour la couper. Bleu est le joueur 1 et Rouge le joueur 2. Seules les branches de votre couleur ont un repère.',
        'Tippe auf die Markierung eines eigenen Asts, um ihn abzuschneiden. Blau ist Spieler 1, Rot Spieler 2. Nur Äste deiner Farbe haben Markierungen.',
        'Toque no marcador de um dos seus galhos para cortá-lo. Azul é o jogador 1 e Vermelho o jogador 2. Só os galhos da sua cor têm marcador.',
        '点击自己某根树枝上的标记即可剪断。蓝色是玩家 1，红色是玩家 2。只有你颜色的树枝带有标记。',
        'अपनी किसी शाखा पर निशान दबाकर उसे काटें। नीला खिलाड़ी 1 और लाल खिलाड़ी 2 है। केवल आपके रंग की शाखाओं पर निशान होते हैं।',
        'اضغط علامة على أحد فروعك لقطعه. الأزرق هو اللاعب 1 والأحمر هو اللاعب 2. فقط فروع لونك عليها علامات.'),
    'cartographers': tr(
        'Use Rotate / flip to change the shape, then tap a highlighted square on your map. On a touch screen, tap once to preview the shape and tap again to place it.',
        'Usa Girar / voltear para cambiar la forma y toca una casilla resaltada de tu mapa. En una pantalla táctil, toca una vez para ver la vista previa y otra vez para colocarla.',
        'Utilisez Tourner / retourner pour changer la forme, puis touchez une case surlignée de votre carte. Sur écran tactile, touchez une fois pour l\'aperçu et une seconde fois pour poser.',
        'Mit Drehen / Spiegeln änderst du die Form; tippe dann auf ein markiertes Feld deiner Karte. Auf Touchscreens tippst du einmal für die Vorschau und noch einmal zum Legen.',
        'Use Girar / espelhar para mudar a forma e toque em uma casa destacada do seu mapa. Em telas sensíveis ao toque, toque uma vez para ver a prévia e outra para colocar.',
        '用“旋转/翻转”改变形状，再点击地图上高亮的格子。触屏设备上点一次预览，再点一次放置。',
        'आकार बदलने के लिए घुमाएँ / पलटें दबाएँ, फिर अपने नक्शे पर चमकते खाने को दबाएँ। टच स्क्रीन पर एक बार दबाने से पूर्वावलोकन दिखता है और दोबारा दबाने से आकार रखा जाता है।',
        'استخدم تدوير / قلب لتغيير الشكل ثم اضغط مربعًا مميزًا في خريطتك. على شاشة اللمس اضغط مرة للمعاينة ومرة أخرى للوضع.'),
}
COMMON = {
    'turn': tr('Player {n}', 'Jugador {n}', 'Joueur {n}', 'Spieler {n}', 'Jogador {n}', '玩家{n}', 'खिलाड़ी {n}', 'اللاعب {n}'),
    'finished': tr('Finished', 'Terminado', 'Terminé', 'Beendet', 'Terminado', '已结束', 'समाप्त', 'انتهت'),
    'winner': tr('Player {n} wins', 'Gana el jugador {n}', 'Le joueur {n} gagne', 'Spieler {n} gewinnt', 'O jogador {n} vence', '玩家{n}获胜', 'खिलाड़ी {n} जीता', 'فاز اللاعب {n}'),
    'draw': tr('Draw', 'Empate', 'Match nul', 'Unentschieden', 'Empate', '平局', 'बराबरी', 'تعادل'),
    'server_invalid': tr('Illegal move', 'Jugada ilegal', 'Coup interdit', 'Ungültiger Zug', 'Jogada ilegal', '非法着法', 'अवैध चाल', 'حركة غير قانونية'),
}
HINTS = {
    'sim': tr('Claim lines. Completing a triangle of your colour loses.', 'Reclama líneas. Completar un triángulo de tu color pierde.',
              'Prenez des lignes. Compléter un triangle de votre couleur fait perdre.', 'Beanspruche Linien. Ein Dreieck der eigenen Farbe zu schließen verliert.',
              'Reivindique linhas. Completar um triângulo da sua cor faz perder.', '占线。连成自己颜色的三角形就输。',
              'रेखाएँ चुनें। अपने रंग का त्रिभुज पूरा करने पर हार होती है।', 'اختر الخطوط. إكمال مثلث بلونك يعني الخسارة.'),
    'paper_soccer': tr('Move the ball and score in the opposing goal.', 'Mueve el balón y marca en la portería rival.',
                       'Déplacez le ballon et marquez dans le but adverse.', 'Bewege den Ball und triff ins gegnerische Tor.',
                       'Mova a bola e marque no gol adversário.', '移动球并攻入对方球门。',
                       'गेंद चलाएँ और विरोधी गोल में स्कोर करें।', 'حرّك الكرة وسجّل في مرمى الخصم.'),
    'hackenbush': tr('Cut your own colour. Cut-off branches fall.', 'Corta tu propio color. Las ramas cortadas caen.',
                     'Coupez votre couleur. Les branches coupées tombent.', 'Schneide deine Farbe. Abgetrennte Äste fallen.',
                     'Corte a sua cor. Os galhos soltos caem.', '剪自己颜色的树枝，断开的树枝会掉落。',
                     'अपने रंग की शाखा काटें। कटी हुई शाखाएँ गिर जाती हैं।', 'اقطع لونك. الفروع المنفصلة تسقط.'),
    'cartographers': tr('Place the card\'s shape on your map.', 'Coloca la forma de la carta en tu mapa.',
                        'Placez la forme de la carte sur votre carte.', 'Lege die Form der Karte auf deine Karte.',
                        'Coloque a forma da carta no seu mapa.', '把牌上的形状放到你的地图上。',
                        'कार्ड का आकार अपने नक्शे पर रखें।', 'ضع شكل البطاقة على خريطتك.'),
}
EXTRA = {
    'sim': {
        'edge': tr('Line {a}–{b}', 'Línea {a}–{b}', 'Ligne {a}–{b}', 'Linie {a}–{b}', 'Linha {a}–{b}', '线 {a}–{b}', 'रेखा {a}–{b}', 'الخط {a}–{b}'),
    },
    'paper_soccer': {
        'point': tr('Point {n}', 'Punto {n}', 'Point {n}', 'Punkt {n}', 'Ponto {n}', '点 {n}', 'बिंदु {n}', 'النقطة {n}'),
    },
    'hackenbush': {
        'blue_turn': tr('Blue to cut', 'Corta Azul', 'Bleu coupe', 'Blau schneidet', 'Azul corta', '蓝方剪枝', 'नीला काटे', 'دور الأزرق'),
        'red_turn': tr('Red to cut', 'Corta Rojo', 'Rouge coupe', 'Rot schneidet', 'Vermelho corta', '红方剪枝', 'लाल काटे', 'دور الأحمر'),
        'cut': tr('Cut branch {n}', 'Cortar rama {n}', 'Couper la branche {n}', 'Ast {n} abschneiden', 'Cortar galho {n}', '剪断树枝 {n}', 'शाखा {n} काटें', 'اقطع الفرع {n}'),
    },
    'cartographers': {
        'card': tr('Card {n} of {total}: {terrain}', 'Carta {n} de {total}: {terrain}', 'Carte {n} sur {total} : {terrain}', 'Karte {n} von {total}: {terrain}',
                   'Carta {n} de {total}: {terrain}', '第 {n}/{total} 张牌：{terrain}', 'कार्ड {n}/{total}: {terrain}', 'البطاقة {n} من {total}: {terrain}'),
        'score': tr('Stars {a} : {b}', 'Estrellas {a} : {b}', 'Étoiles {a} : {b}', 'Sterne {a} : {b}', 'Estrelas {a} : {b}', '星数 {a} : {b}', 'सितारे {a} : {b}', 'النجوم {a} : {b}'),
        'opponent_map': tr('Opponent\'s map', 'Mapa del rival', 'Carte de l\'adversaire', 'Karte des Gegenübers', 'Mapa do adversário', '对手的地图', 'प्रतिद्वंद्वी का नक्शा', 'خريطة الخصم'),
        'pass': tr('Pass (no room)', 'Pasar (sin espacio)', 'Passer (pas de place)', 'Passen (kein Platz)', 'Passar (sem espaço)', '跳过（没有空位）', 'पास (जगह नहीं)', 'تمرير (لا مساحة)'),
        'rotate': tr('Rotate / flip shape', 'Girar / voltear forma', 'Tourner / retourner la forme', 'Form drehen / spiegeln', 'Girar / espelhar forma', '旋转 / 翻转形状', 'आकार घुमाएँ / पलटें', 'تدوير / قلب الشكل'),
        'place_at': tr('Place at row {row}, column {col}', 'Colocar en fila {row}, columna {col}', 'Placer ligne {row}, colonne {col}', 'Platzieren in Zeile {row}, Spalte {col}',
                       'Colocar na linha {row}, coluna {col}', '放在第 {row} 行第 {col} 列', 'पंक्ति {row}, स्तंभ {col} पर रखें', 'ضع في الصف {row} والعمود {col}'),
        'forest': tr('forest', 'bosque', 'forêt', 'Wald', 'floresta', '森林', 'जंगल', 'غابة'),
        'village': tr('village', 'aldea', 'village', 'Dorf', 'vila', '村庄', 'गाँव', 'قرية'),
        'farm': tr('farm', 'granja', 'ferme', 'Hof', 'fazenda', '农场', 'खेत', 'مزرعة'),
        'water': tr('water', 'agua', 'eau', 'Wasser', 'água', '水域', 'पानी', 'ماء'),
    },
}


def strings(kind, index=0):
    out = {'title': TITLES[kind][index], kind + '_hint': HINTS[kind][index]}
    out.update({key: value[index] for key, value in COMMON.items()})
    out.update({key: value[index] for key, value in EXTRA.get(kind, {}).items()})
    return out


def schemas(kind):
    base = {'turn': {'enum': [0, 1]}, 'winner': {'enum': [-1, 0, 1]}, 'over': {'type': 'boolean'},
            'turns': {'type': 'integer', 'minimum': 0, 'maximum': 10000}}
    if kind == 'sim':
        props = {'edges': {'type': 'array', 'minItems': 15, 'maxItems': 15, 'items': {'enum': [-1, 0, 1]}}, **base}
        move = {'type': 'object', 'required': ['edge'], 'additionalProperties': False,
                'properties': {'edge': {'type': 'integer', 'minimum': 0, 'maximum': 14}}}
    elif kind == 'paper_soccer':
        point = {'type': 'integer', 'minimum': 0, 'maximum': 100}
        props = {'ball': point, 'used': {'type': 'array', 'maxItems': 400, 'items': {'type': 'integer', 'minimum': 0, 'maximum': 13000}},
                 'trail': {'type': 'array', 'minItems': 1, 'maxItems': 500, 'items': point},
                 'mover': {'type': 'array', 'maxItems': 500, 'items': {'enum': [0, 1]}}, **base}
        move = {'type': 'object', 'required': ['to'], 'additionalProperties': False, 'properties': {'to': point}}
    elif kind == 'hackenbush':
        props = {'alive': {'type': 'array', 'minItems': 17, 'maxItems': 17, 'items': {'enum': [0, 1]}}, **base}
        move = {'type': 'object', 'required': ['edge'], 'additionalProperties': False,
                'properties': {'edge': {'type': 'integer', 'minimum': 0, 'maximum': 16}}}
    else:
        grid = {'type': 'array', 'minItems': 49, 'maxItems': 49, 'items': {'type': 'integer', 'minimum': -1, 'maximum': 4}}
        props = {'maps': {'type': 'array', 'minItems': 2, 'maxItems': 2, 'items': grid},
                 'deck': {'type': 'array', 'minItems': 12, 'maxItems': 12, 'items': {'type': 'array', 'minItems': 2, 'maxItems': 2, 'items': {'type': 'integer', 'minimum': 0, 'maximum': 7}}},
                 'round': {'type': 'integer', 'minimum': 0, 'maximum': 12},
                 'seasons': {'type': 'array', 'minItems': 2, 'maxItems': 2, 'items': {'type': 'array', 'maxItems': 4, 'items': {'type': 'integer', 'minimum': 0, 'maximum': 200}}},
                 'scores': {'type': 'array', 'minItems': 2, 'maxItems': 2, 'items': {'type': 'integer', 'minimum': 0, 'maximum': 800}}, **base}
        move = {'type': 'object', 'required': ['cell', 'rot'], 'additionalProperties': False,
                'properties': {'cell': {'type': 'integer', 'minimum': -1, 'maximum': 48}, 'rot': {'type': 'integer', 'minimum': 0, 'maximum': 7}}}
    state = {'type': 'object', 'required': list(props), 'additionalProperties': False, 'properties': props}
    view = copy.deepcopy(state)
    view['properties']['legal'] = {'type': 'array', 'maxItems': 450, 'items': move}
    view['required'].append('legal')
    return {'state': state, 'view': view, 'move': move}


def points(kind):
    return {'sim': 15, 'paper_soccer': 101, 'hackenbush': 17, 'cartographers': 49}[kind]


def specification(kind):
    flat = lambda color: {'shape': 'circle', 'color': color, 'text_color': '#102039'}
    if kind == 'sim':
        boards = [{'id': 'main', 'kind': 'free', 'x': 20, 'y': 100, 'width': 420, 'height': 420, 'color': '#172743', 'line_color': '#5c7190'}]
        types = {'dot': {**flat('#e8f0ff'), 'width': 34, 'height': 34}}
        viewport = {'width': 460, 'height': 540, 'camera_enabled': False}
    elif kind == 'paper_soccer':
        cells = [{'id': str(y * 9 + x), 'x': 20 + x * 40, 'y': 20 + (y + 1) * 40} for y in range(11) for x in range(9)]
        cells += [{'id': '99', 'x': 20 + 4 * 40, 'y': 20}, {'id': '100', 'x': 20 + 4 * 40, 'y': 20 + 12 * 40}]
        boards = [{'id': 'pitch', 'kind': 'graph', 'x': 20, 'y': 90, 'width': 360, 'height': 520, 'color': '#1d5a37', 'line_color': '#2d7a4e', 'cells': cells}]
        types = {'ball': {**flat('#ffffff'), 'width': 30, 'height': 30}}
        viewport = {'width': 400, 'height': 630}
    elif kind == 'hackenbush':
        boards = [{'id': 'main', 'kind': 'free', 'x': 0, 'y': 90, 'width': 560, 'height': 480, 'color': '#172743', 'line_color': '#5c7190'}]
        types = {'knot': {**flat('#7d5a3a'), 'width': 26, 'height': 26}}
        viewport = {'width': 560, 'height': 580, 'camera_enabled': False}
    else:
        grid = lambda x, y, size: {'kind': 'grid', 'x': x, 'y': y, 'width': size, 'height': size, 'rows': 7, 'columns': 7,
                                   'color': '#1b2c4a', 'alternate_color': '#22375c', 'line_color': '#5c7190'}
        boards = [{'id': 'mine', **grid(36, 150, 308)}, {'id': 'theirs', **grid(36, 490, 154)},
                  {'id': 'card', 'kind': 'zone', 'x': 220, 'y': 490, 'width': 130, 'height': 110, 'color': '#172743'}]
        types = {}
        for name, color in zip(('forest', 'village', 'farm', 'water'), GEO['colors']):
            types['t_' + name] = {'shape': 'rect', 'color': color}
            types['s_' + name] = {'shape': 'rect', 'color': color}
            types['c_' + name] = {'shape': 'rect', 'color': color, 'width': 22, 'height': 22}
        types['t_mountain'] = {'shape': 'rect', 'color': '#7a7f8c'}
        types['s_mountain'] = {'shape': 'rect', 'color': '#7a7f8c'}
        viewport = {'width': 380, 'height': 620}
    ui_code = (f'const KIND={json.dumps(kind)};\nconst SOURCE_STRINGS={json.dumps(strings(kind), ensure_ascii=False)};\n'
               f'const GEO={json.dumps(GEO)};\n' + (DEST / 'edge_games_ui.js').read_text(encoding='utf-8'))
    return {'format': 'buildplay-ui', 'version': 1, 'viewport': viewport, 'boards': boards, 'piece_types': types,
            'strings': strings(kind), 'ui_code': ui_code}


def server_code(kind):
    return f'const KIND={json.dumps(kind)};\nconst GEO={json.dumps(GEO)};\n' + (DEST / 'edge_games.js').read_text(encoding='utf-8')


def illustration(kind, view, caption):
    parts = []
    if kind == 'sim':
        pos = [(200 + 150 * math.cos(math.radians(-90 + 60 * i)), 200 + 150 * math.sin(math.radians(-90 + 60 * i))) for i in range(6)]
        pairs = [(a, b) for a in range(6) for b in range(a + 1, 6)]
        for (a, b), owner in zip(pairs, view['edges']):
            color = '#51607a' if owner < 0 else ('#a7f070', '#ff9dca')[owner]
            parts.append(f'<path d="M{pos[a][0]:.0f} {pos[a][1]:.0f}L{pos[b][0]:.0f} {pos[b][1]:.0f}" stroke="{color}" stroke-width="{2 if owner < 0 else 6}"/>')
        parts += [f'<circle cx="{x:.0f}" cy="{y:.0f}" r="9" fill="#e8f0ff"/>' for x, y in pos]
    elif kind == 'paper_soccer':
        parts.append('<rect x="60" y="60" width="280" height="300" fill="none" stroke="#e8f0ff" stroke-width="3"/>')
        trail = []
        for p in view['trail']:
            x, y = (4, -1) if p == 99 else (4, 11) if p == 100 else (p % 9, p // 9)
            trail.append(f'{60 + x * 35:.0f} {70 + y * 26:.0f}')
        parts.append('<path d="M' + 'L'.join(trail) + '" fill="none" stroke="#a7f070" stroke-width="3"/>')
    elif kind == 'hackenbush':
        for (a, b, colour), alive in zip(GEO['hack_edges'], view['alive']):
            if alive:
                (x1, y1), (x2, y2) = GEO['hack_nodes'][a], GEO['hack_nodes'][b]
                parts.append(f'<path d="M{x1 * .7 + 10:.0f} {y1 * .7 - 100 + 100:.0f}L{x2 * .7 + 10:.0f} {y2 * .7:.0f}" stroke="{"#ff5d5d" if colour else "#4f8cff"}" stroke-width="6"/>')
    else:
        for r in range(7):
            for c in range(7):
                value = view['maps'][0][r * 7 + c]
                color = '#7a7f8c' if value == 4 else GEO['colors'][value] if value >= 0 else '#213858'
                parts.append(f'<rect x="{40 + c * 40}" y="{60 + r * 40}" width="36" height="36" rx="4" fill="{color}"/>')
    return {'caption': caption, 'svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#102039"/><text x="25" y="30" fill="#ffffff">'
            + html.escape(TITLES[kind][0]) + '</text>' + ''.join(parts) + '</svg>'}


def package(kind):
    game_schemas = schemas(kind)
    code = server_code(kind)
    logic = GameLogic(code, game_schemas=game_schemas)
    ctx = {'players': [{'id': 'u1', 'kind': 'human', 'display_name': 'Alice', 'picture_url': '', 'max_loss': 0, 'active': True},
                       {'id': 'u2', 'kind': 'human', 'display_name': 'Bob', 'picture_url': '', 'max_loss': 0, 'active': True}],
           'pot': 0, 'move_count': 0}
    result = logic.call('newMatch', ctx=ctx, seed=7)
    steps = []
    for i in range(1000):
        state = result['state']
        pid = result['turn'][0]
        seed = i + 11
        ctx['move_count'] = i
        move = logic.call('computerMove', state, pid, ctx=ctx, seed=seed)
        result = logic.call('applyMove', state, pid, move, ctx=ctx, seed=seed)
        steps.append((copy.deepcopy(ctx), state, pid, move, result, seed))
        if result['turn'] is None:
            break
    else:
        raise RuntimeError(f'{kind} did not finish')
    cases = []
    for label, index in [('initial', 0), ('intermediate', min(2, len(steps) - 1)), ('terminal', len(steps) - 1)]:
        case_ctx, state, pid, move, result, seed = steps[index]
        before = [logic.call('viewFor', state, who, ctx=case_ctx, seed=seed) for who in (pid, None)]
        after = [logic.call('viewFor', result['state'], who, ctx={**case_ctx, 'move_count': index + 1}, seed=seed) for who in (pid, None)]
        case = {'name': label.title() + ' move', 'description': RULES[kind][0], 'kind': label, 'ctx': {**case_ctx, 'seed': seed},
                'state': state, 'view_of_mover': before[0], 'view_of_other': before[1], 'player_id': pid, 'other_player_id': None,
                'move': move, 'expected_state': result['state'], 'expected_turn': result['turn'],
                'expected_view_of_mover': after[0], 'expected_view_of_other': after[1],
                'images': [illustration(kind, v, c) for v, c in zip(before + after, ['Before: mover', 'Before: spectator', 'After: mover', 'After: spectator'])]}
        if 'payouts' in result:
            case['expected_payouts'] = result['payouts']
        cases.append(case)
    return {'all_state_public': True, 'name': TITLES[kind][0] + ' (Declarative)', 'description': RULES[kind][0],
            'game_addition_request_id_and_secret': 'example-only-declarative-' + kind + '-replace-before-publishing',
            'allowed_player_counts': [2], 'server_code': code, 'declarative_ui': specification(kind),
            'rules': RULES[kind][0], 'ui_instructions': UI_RULES[kind][0],
            'tutorial': {'text': RULES[kind][0], 'html': '<meta name="viewport" content="width=device-width,initial-scale=1"><p>' + html.escape(RULES[kind][0]) + '</p>'},
            'images': [{'caption': 'Cover', 'svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#102039"/><path d="M30 70L80 20L130 70" stroke="#a7f070" stroke-width="6" fill="none"/><circle cx="80" cy="20" r="9" fill="#ff9dca"/></svg>'},
                       *cases[0]['images'][:3]],
            'unit_tests': {**{k + '_schema': v for k, v in game_schemas.items()}, 'cases': cases},
            'translations': {locale: {'display_name': TITLES[kind][i] + ' (Declarative)', 'short_description': RULES[kind][i],
                                      'game_logic_rules': RULES[kind][i], 'game_ui_rules': UI_RULES[kind][i],
                                      'tutorial_strings': {RULES[kind][0]: RULES[kind][i]}, 'client_strings': strings(kind, i)}
                             for i, locale in enumerate(LOCALES) if i}}


def main():
    for kind in KINDS:
        payload = package(kind)
        (DEST / (kind + '.json')).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(kind, len(json.dumps(payload).encode()), 'bytes')


if __name__ == '__main__':
    main()
