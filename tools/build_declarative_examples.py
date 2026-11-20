"""Rebuild twelve complete submission fixtures from shared portable sources.

Run from the package parent: python -m game_platform.tools.build_declarative_examples.
Fixture secrets are public examples: replace them before submitting to a live service.
"""
from __future__ import annotations

import base64
import argparse
import copy
import html
import json
from pathlib import Path

from game_platform.game_logic import GameLogic

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'games' / 'declarative'
LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
TITLES = {
    'tictactoe': ['Tic-tac-toe', 'Tres en raya', 'Morpion', 'Drei gewinnt', 'Jogo da velha', '井字棋', 'टिक टैक टो', 'إكس أو'],
    'connect4': ['Connect Four', 'Cuatro en línea', 'Puissance quatre', 'Vier gewinnt', 'Quatro em linha', '四子棋', 'चार जोड़ें', 'أربعة متصلة'],
    'reversi': ['Reversi', 'Reversi', 'Reversi', 'Reversi', 'Reversi', '黑白棋', 'रिवर्सी', 'ريفيرسي'],
    'nim': ['Take-away Nim', 'Nim', 'Nim', 'Nim', 'Nim', '尼姆', 'निम', 'نيم'],
    'mancala': ['Mancala (Kalah)', 'Mancala (Kalah)', 'Mancala (Kalah)', 'Mancala (Kalah)', 'Mancala (Kalah)', '卡拉棋', 'मंकला', 'منقلة'],
    'gomoku': ['Gomoku', 'Gomoku', 'Gomoku', 'Gomoku', 'Gomoku', '五子棋', 'गोमोकू', 'غوموكو'],
    'connect6': ['Connect6', 'Connect6', 'Connect6', 'Connect6', 'Connect6', '连六棋', 'कनेक्ट6', 'كونكت 6'],
    'ataxx': ['Ataxx']*8,
    'hex': ['Hex', 'Hex', 'Hex', 'Hex', 'Hex', '六角棋', 'हेक्स', 'هكس'],
    'domineering': ['Domineering', 'Domineering', 'Domineering', 'Domineering', 'Domineering', '多米诺占地', 'डॉमिनियरिंग', 'دومينيرينغ'],
    'memory': ['Memory pairs', 'Parejas de memoria', 'Jeu de mémoire', 'Paare finden', 'Jogo da memória', '记忆配对', 'याददाश्त के जोड़े', 'أزواج الذاكرة'],
    'pig': ['Pig (30 points)', 'Pig (30 puntos)', 'Pig (30 points)', 'Pig (30 Punkte)', 'Pig (30 pontos)', '掷骰子（30分）', 'पिग (30 अंक)', 'بيغ (٣٠ نقطة)'],
}
# The variants and finite-turn safeguards are explicit in every language.
RULES = {
    'tictactoe': ['Place X or O in an empty square. Make a line of three to win. A full board without a line is a draw.', 'Coloca X u O en una casilla vacía. Forma una línea de tres para ganar. Un tablero lleno sin línea es empate.', 'Placez X ou O dans une case vide. Alignez trois symboles pour gagner. Une grille pleine sans ligne est nulle.', 'Setze X oder O auf ein freies Feld. Drei in einer Reihe gewinnen. Ein volles Brett ohne Reihe ist unentschieden.', 'Coloque X ou O numa casa vazia. Faça uma linha de três para vencer. Tabuleiro cheio sem linha é empate.', '轮流在空格放置X或O。连成三个获胜。棋盘填满且无人连线则平局。', 'खाली खाने में X या O रखें। तीन की पंक्ति बनाकर जीतें। भरा बोर्ड बिना पंक्ति के बराबरी है।', 'ضع X أو O في خانة فارغة. تفوز بثلاثة على خط واحد. امتلاء اللوحة دون خط يعني التعادل.'],
    'connect4': ['Choose a column to drop a disc. Connect four horizontally, vertically or diagonally. A full board is a draw.', 'Elige una columna para soltar una ficha. Conecta cuatro en horizontal, vertical o diagonal. Si se llena el tablero, hay empate.', 'Choisissez une colonne pour lâcher un jeton. Alignez quatre jetons horizontalement, verticalement ou en diagonale. Grille pleine : match nul.', 'Wähle eine Spalte zum Einwerfen. Verbinde vier waagerecht, senkrecht oder diagonal. Ein volles Brett bedeutet unentschieden.', 'Escolha uma coluna para soltar uma ficha. Ligue quatro na horizontal, vertical ou diagonal. Tabuleiro cheio dá empate.', '选择一列落子。横、竖或斜向连成四子获胜。满盘则平局。', 'गोटी गिराने के लिए स्तंभ चुनें। चार गोटियाँ क्षैतिज, लंबवत या तिरछी जोड़ें। भरा बोर्ड बराबरी है।', 'اختر عمودًا لإسقاط قرص. صِل أربعة أفقيًا أو عموديًا أو قطريًا. امتلاء اللوحة يعني التعادل.'],
    'reversi': ['Place a disc to bracket and flip opposing discs. Turns pass automatically when no move exists. When neither player can move, most discs wins.', 'Coloca una ficha para encerrar y voltear fichas rivales. Sin jugadas se pasa automáticamente. Cuando nadie puede jugar, gana quien tenga más fichas.', 'Posez un pion pour encadrer et retourner ceux de l’adversaire. Sans coup, le tour passe automatiquement. Quand personne ne peut jouer, le plus de pions gagne.', 'Setze einen Stein, um gegnerische Steine einzuschließen und umzudrehen. Ohne Zug wird automatisch gepasst. Kann niemand ziehen, gewinnt die Mehrheit.', 'Coloque uma peça para cercar e virar peças adversárias. Sem jogada, passa automaticamente. Quando ninguém puder jogar, vence quem tiver mais peças.', '落子夹住并翻转对方棋子。无合法着法时自动跳过。双方均无法落子时，棋子多者获胜。', 'विरोधी गोटियों को घेरकर पलटने के लिए गोटी रखें। चाल न होने पर बारी स्वतः छूटती है। दोनों रुकें तो अधिक गोटियों वाला जीतता है।', 'ضع قرصًا لحصر أقراص الخصم وقلبها. يُتجاوز الدور تلقائيًا عند غياب الحركات. عند عجز الطرفين يفوز صاحب الأقراص الأكثر.'],
    'nim': ['Start with 15 stones. Take one, two or three per turn. Whoever takes the last stone wins.', 'Empieza con 15 piedras. Retira una, dos o tres por turno. Gana quien retire la última.', 'Commencez avec 15 pierres. Prenez-en une, deux ou trois par tour. La dernière pierre fait gagner.', 'Beginne mit 15 Steinen. Nimm pro Zug einen, zwei oder drei. Wer den letzten nimmt, gewinnt.', 'Comece com 15 pedras. Retire uma, duas ou três por turno. Quem retirar a última vence.', '从15颗石子开始。每回合拿走一、二或三颗。拿走最后一颗者获胜。', '15 पत्थरों से शुरू करें। हर बारी एक, दो या तीन लें। अंतिम पत्थर लेने वाला जीतता है।', 'ابدأ بـ15 حجرًا. خذ حجرًا أو اثنين أو ثلاثة في كل دور. يفوز من يأخذ الحجر الأخير.'],
    'mancala': ['Sow from your six pits counterclockwise, skipping the opponent’s store. Finish in your store for another turn. Capture from the opposite pit when ending in your empty pit. Sweep remaining seeds when one side empties. Most seeds wins; at 300 turns sweep and score.', 'Siembra desde tus seis hoyos en sentido antihorario, saltando el almacén rival. Terminar en tu almacén da otro turno. Al terminar en un hoyo propio vacío, captura el opuesto. Si un lado queda vacío, recoge las semillas restantes. Gana la mayoría; a los 300 turnos se recoge y puntúa.', 'Semez depuis vos six trous dans le sens inverse des aiguilles, sans le grenier adverse. Finir dans votre grenier donne un tour. Finir dans un trou vide à vous capture le trou opposé. Videz les trous restants quand un côté est vide. La majorité gagne ; après 300 tours, ramassez et comptez.', 'Verteile aus deinen sechs Mulden gegen den Uhrzeigersinn und überspringe den gegnerischen Speicher. Im eigenen Speicher erhältst du einen weiteren Zug. Ende in einer eigenen leeren Mulde: fange die gegenüberliegenden Steine. Ist eine Seite leer, sammle den Rest. Die Mehrheit gewinnt; nach 300 Zügen wird abgerechnet.', 'Semeie dos seus seis buracos no sentido anti-horário, pulando o depósito rival. Terminar no seu depósito dá outra vez. Termine num buraco seu vazio para capturar o oposto. Recolha o resto quando um lado esvaziar. Mais sementes vence; após 300 turnos, recolha e conte.', '从己方六坑逆时针撒子，跳过对方仓库。最后一子落入己仓可再走。落入己方空坑时吃掉对面棋子。一侧空后收取余子。多者获胜；300回合后收子计分。', 'अपने छह गड्ढों से वामावर्त बीज बाँटें, विरोधी भंडार छोड़ें। अपने भंडार में अंत पर फिर खेलें। अपने खाली गड्ढे में अंत पर सामने के बीज लें। एक ओर खाली होने पर शेष बीज समेटें। अधिक बीज जीतते हैं; 300 बारी पर समेटकर गिनें।', 'وزّع من حفرك الست عكس الساعة متجاوزًا مخزن الخصم. النهاية في مخزنك تمنح دورًا آخر. النهاية في حفرة لك فارغة تأسر المقابلة. اجمع الباقي عند فراغ جانب. الأكثر بذورًا يفوز؛ بعد 300 دور تُجمع وتُحسب.'],
    'gomoku': ['Take turns placing stones on a 9 by 9 board. The first line of five or more wins. A full board is a draw.', 'Coloca piedras por turnos en un tablero de 9 por 9. La primera línea de cinco o más gana. Si se llena, hay empate.', 'Posez des pierres à tour de rôle sur une grille de 9 sur 9. Une ligne de cinq ou plus gagne. Une grille pleine est nulle.', 'Setzt abwechselnd Steine auf ein 9-mal-9-Brett. Die erste Reihe aus mindestens fünf gewinnt. Ein volles Brett ist unentschieden.', 'Coloque pedras alternadamente num tabuleiro 9 por 9. A primeira linha de cinco ou mais vence. Tabuleiro cheio dá empate.', '在9乘9棋盘轮流落子。先连成五子或更多者获胜。满盘则平局。', '9 गुणा 9 बोर्ड पर बारी से गोटियाँ रखें। पहले पाँच या अधिक की पंक्ति जीतती है। भरा बोर्ड बराबरी है।', 'تناوبوا وضع الحجارة على لوحة 9 في 9. أول خط من خمسة أو أكثر يفوز. اللوحة الممتلئة تعادل.'],
    'connect6': ['Black places one stone on the empty 19 by 19 board to start. Then players alternate, placing exactly two stones on empty intersections per turn. The two stones may be anywhere. Six or more in a row horizontally, vertically or diagonally wins; a full board is a draw.', 'Negro coloca una piedra para empezar en el tablero vacío de 19 por 19. Después, los jugadores alternan y colocan exactamente dos piedras por turno en intersecciones vacías. Las dos piedras pueden ir en cualquier lugar. Seis o más en línea horizontal, vertical o diagonal ganan; un tablero lleno es empate.', 'Noir pose une pierre pour commencer sur la grille vide de 19 sur 19. Ensuite, les joueurs posent à tour de rôle exactement deux pierres sur des intersections libres, où ils veulent. Six pierres ou plus en ligne horizontale, verticale ou diagonale font gagner ; une grille pleine est nulle.', 'Schwarz setzt den ersten Stein auf das leere 19-mal-19-Brett. Danach setzen die Spieler abwechselnd genau zwei Steine auf beliebige freie Kreuzungen. Sechs oder mehr in einer waagerechten, senkrechten oder diagonalen Reihe gewinnen; ein volles Brett ist unentschieden.', 'As pretas colocam uma pedra para começar no tabuleiro vazio de 19 por 19. Depois, os jogadores alternam e colocam exatamente duas pedras por turno em interseções vazias, em quaisquer posições. Seis ou mais em linha horizontal, vertical ou diagonal vencem; tabuleiro cheio é empate.', '黑方先在空的19×19棋盘放置一枚棋子。之后双方轮流各放置两枚棋子，位置可任意选择空交叉点。横、竖或斜向连成六枚或更多即获胜；棋盘填满则平局。', 'काला खाली 19×19 बोर्ड पर पहली गोटी रखता है। फिर खिलाड़ी बारी-बारी से खाली स्थानों पर ठीक दो गोटियाँ रखते हैं; दोनों कहीं भी रखी जा सकती हैं। क्षैतिज, लंबवत या तिरछी दिशा में छह या अधिक गोटियों की पंक्ति जीतती है; पूरा बोर्ड बराबरी है।', 'يضع الأسود حجرًا واحدًا أولًا على لوحة فارغة 19×19. بعد ذلك، يضع اللاعبان بالتناوب حجرين بالضبط في تقاطعات فارغة من اختيارهما. يفوز من يصنع صفًا من ستة أحجار أو أكثر أفقيًا أو عموديًا أو قطريًا؛ وامتلاء اللوحة تعادل.'],
    'ataxx': ['On a 7 by 7 board, players start with two pieces in opposite corners. Move to an empty square one step away to clone a piece, or two steps away to jump and leave the starting square empty. After landing, convert all opposing pieces next to the destination, including diagonals. A player with no legal move passes. The game ends when the board is full, a player has no pieces, neither player can move, or 300 moves have been made. Most pieces wins.', 'En un tablero de 7 por 7, cada jugador empieza con dos fichas en esquinas opuestas. Muévete a una casilla vacía a un paso para clonar una ficha, o a dos pasos para saltar y dejar vacía la casilla de origen. Al llegar, convierte todas las fichas rivales junto al destino, también en diagonal. Quien no tenga una jugada legal pasa. La partida termina si el tablero se llena, un jugador se queda sin fichas, nadie puede mover o se hacen 300 jugadas. Gana quien tenga más fichas.', 'Sur un plateau de 7 sur 7, chaque joueur commence avec deux pions dans des coins opposés. Déplacez-vous vers une case vide à un pas pour cloner un pion, ou à deux pas pour sauter en laissant la case de départ vide. À l’arrivée, convertissez tous les pions adverses voisins, diagonales comprises. Sans coup légal, un joueur passe. La partie se termine si le plateau est plein, si un joueur n’a plus de pion, si personne ne peut jouer ou après 300 coups. Le plus grand nombre de pions gagne.', 'Auf einem 7-mal-7-Brett beginnt jeder mit zwei Steinen in gegenüberliegenden Ecken. Ziehe auf ein freies Feld in einem Schritt, um einen Stein zu klonen, oder zwei Schritte weit und lasse das Startfeld leer. Wandle nach der Landung alle benachbarten gegnerischen Steine um, auch diagonal. Wer keinen legalen Zug hat, setzt aus. Das Spiel endet bei vollem Brett, ohne Steine eines Spielers, ohne mögliche Züge oder nach 300 Zügen. Die meisten Steine gewinnen.', 'Em um tabuleiro 7 por 7, cada jogador começa com duas peças em cantos opostos. Mova para uma casa vazia a um passo para clonar uma peça, ou a dois passos para saltar e deixar a casa inicial vazia. Ao chegar, converta todas as peças adversárias vizinhas, inclusive na diagonal. Quem não tiver jogada legal passa. A partida termina com o tabuleiro cheio, sem peças de um jogador, sem jogadas para ambos ou após 300 jogadas. Vence quem tiver mais peças.', '在7×7棋盘上，双方从相对的角各放两枚棋子。移到相邻空格可复制棋子，移到两步远的空格则跳跃并腾空起点。落点周围（包括斜向）的所有对方棋子都会变成己方棋子。无合法走法时跳过回合。棋盘填满、一方无棋子、双方都无法移动或走满300步时结束；棋子较多者获胜。', '7×7 बोर्ड पर दोनों खिलाड़ी विपरीत कोनों में दो-दो गोटियों से शुरू करते हैं। पास के खाली खाने में जाने से गोटी की नकल बनती है; दो खाने दूर जाने पर छलाँग लगती है और शुरुआती खाना खाली हो जाता है। पहुँचने पर गंतव्य के पास की सभी विरोधी गोटियाँ, तिरछी गोटियों सहित, आपकी बन जाती हैं। वैध चाल न हो तो बारी छोड़ें। बोर्ड भरने, किसी खिलाड़ी की गोटियाँ खत्म होने, दोनों के न चल पाने या 300 चालों के बाद खेल समाप्त होता है; अधिक गोटियाँ जीतती हैं।', 'على لوحة 7×7، يبدأ كل لاعب بحجرتين في زاويتين متقابلتين. انتقل إلى خانة فارغة مجاورة لنسخ حجرتك، أو إلى خانة تبعد خطوتين للقفز مع إخلاء خانة البداية. عند الوصول، حوّل كل حجر للخصم يجاور الوجهة، بما في ذلك القطري. إذا لم توجد نقلة قانونية يمر الدور. تنتهي اللعبة بامتلاء اللوحة أو نفاد حجارة لاعب أو عجز الطرفين عن الحركة أو بعد 300 نقلة؛ ويفوز صاحب الحجارة الأكثر.'],
    'hex': ['On a 7 by 7 hex board, player one connects top to bottom; player two connects left to right. Adjacent stones join a path. The first connection wins.', 'En un tablero hexagonal de 7 por 7, el jugador uno conecta arriba y abajo; el dos, izquierda y derecha. Las piedras adyacentes forman caminos. La primera conexión gana.', 'Sur un plateau hexagonal de 7 sur 7, le premier relie le haut au bas, le second la gauche à la droite. Les pierres voisines forment un chemin. La première liaison gagne.', 'Auf dem 7-mal-7-Hexbrett verbindet Spieler eins oben mit unten, Spieler zwei links mit rechts. Benachbarte Steine bilden Wege. Die erste Verbindung gewinnt.', 'Num tabuleiro hexagonal 7 por 7, o primeiro liga cima a baixo e o segundo esquerda a direita. Pedras vizinhas formam caminhos. A primeira ligação vence.', '在7乘7六角棋盘上，玩家一连接上下边，玩家二连接左右边。相邻棋子组成路径。先连通者获胜。', '7 गुणा 7 षट्भुज बोर्ड पर पहला खिलाड़ी ऊपर से नीचे, दूसरा बाएँ से दाएँ जोड़ता है। पास की गोटियाँ रास्ता बनाती हैं। पहला जुड़ाव जीतता है।', 'على لوحة سداسية 7 في 7، يصل الأول الأعلى بالأسفل، والثاني اليسار باليمين. الحجارة المتجاورة تكوّن مسارًا. أول اتصال يفوز.'],
    'domineering': ['On a 6 by 6 board, player one places vertical dominoes and player two horizontal dominoes. Each covers two empty cells. A player with no placement loses.', 'En un tablero de 6 por 6, el primero coloca dominós verticales y el segundo horizontales. Cada uno cubre dos casillas vacías. Pierde quien no pueda colocar.', 'Sur une grille de 6 sur 6, le premier place des dominos verticaux, le second horizontaux. Chacun couvre deux cases vides. Sans placement, on perd.', 'Auf einem 6-mal-6-Brett legt Spieler eins senkrechte und Spieler zwei waagerechte Dominosteine. Jeder belegt zwei freie Felder. Wer nicht legen kann, verliert.', 'Num tabuleiro 6 por 6, o primeiro coloca dominós verticais e o segundo horizontais. Cada um cobre duas casas vazias. Quem não puder colocar perde.', '在6乘6棋盘上，玩家一竖放骨牌，玩家二横放。每块覆盖两个空格。无处可放者输。', '6 गुणा 6 बोर्ड पर पहला खिलाड़ी लंबवत और दूसरा क्षैतिज डोमिनो रखता है। हर टुकड़ा दो खाली खाने ढकता है। जगह न मिलने पर हारें।', 'على لوحة 6 في 6، يضع الأول قطعًا عمودية والثاني أفقية. كل قطعة تغطي خانتين فارغتين. من يعجز عن الوضع يخسر.'],
    'memory': ['Reveal two cards. A matching pair scores one and grants another turn. A mismatch passes the turn; the next reveal hides it. Most of eight pairs wins.', 'Descubre dos cartas. Una pareja suma uno y permite repetir. Un fallo pasa el turno; la siguiente carta oculta el fallo. Gana quien tenga más de las ocho parejas.', 'Retournez deux cartes. Une paire marque un point et permet de rejouer. Sinon le tour passe ; la prochaine carte masque les précédentes. Le plus de paires sur huit gagne.', 'Decke zwei Karten auf. Ein Paar zählt einen Punkt und erlaubt einen weiteren Zug. Sonst wechselt der Zug; beim nächsten Aufdecken werden sie verdeckt. Die meisten der acht Paare gewinnen.', 'Revele duas cartas. Um par vale um ponto e outra vez. Um erro passa a vez; a próxima carta esconde o erro. Quem tiver mais dos oito pares vence.', '翻开两张牌。配对得一分并继续，否则换人，下次翻牌时盖住。八对牌中配对最多者获胜。', 'दो पत्ते खोलें। जोड़ा मिले तो एक अंक और फिर बारी। न मिले तो बारी बदले; अगला पत्ता पिछला छिपाए। आठ में अधिक जोड़े जीतते हैं।', 'اكشف بطاقتين. الزوج المتطابق يمنح نقطة ودورًا آخر. عند الاختلاف ينتقل الدور ويُخفى الزوج عند الكشف التالي. الأكثر من الأزواج الثمانية يفوز.'],
    'pig': ['Roll or hold. A one loses the turn total. Other rolls add to it. Hold banks it and passes. First to 30 wins. After 300 actions, the higher banked score wins.', 'Lanza o planta. Un uno pierde lo acumulado del turno. Los demás resultados lo suman. Plantarse lo guarda y pasa. Primero en llegar a 30 gana. Tras 300 acciones gana la puntuación guardada mayor.', 'Lancez ou gardez. Un un perd le total du tour. Les autres dés s’y ajoutent. Garder encaisse et passe. Le premier à 30 gagne. Après 300 actions, le plus grand score encaissé gagne.', 'Würfle oder sichere. Eine Eins verliert die Zugpunkte. Andere Würfe werden addiert. Sichern speichert und gibt ab. Zuerst 30 gewinnt. Nach 300 Aktionen gewinnt der höhere gesicherte Punktestand.', 'Role ou guarde. Um perde o total do turno. Outros resultados somam. Guardar salva e passa. Primeiro a 30 vence. Após 300 ações, vence o maior total guardado.', '选择掷骰或保留。掷出一失去本回合累计，其他点数累加。保留将累计入账并换人。先到30分获胜。300次行动后总分高者胜。', 'पासा फेंकें या बचाएँ। एक आने पर बारी के अंक खोते हैं। अन्य अंक जुड़ते हैं। बचाने पर जमा होकर बारी बदलती है। पहले 30 जीतते हैं। 300 क्रियाओं के बाद अधिक जमा अंक जीतते हैं।', 'ارمِ أو احتفظ. الواحد يخسر مجموع الدور. النتائج الأخرى تُضاف. الاحتفاظ يُودع المجموع وينقل الدور. أول من يبلغ 30 يفوز. بعد 300 حركة يفوز المجموع المودع الأعلى.'],
}
COMMON = {
    'turn': ['Player {n}', 'Jugador {n}', 'Joueur {n}', 'Spieler {n}', 'Jogador {n}', '玩家{n}', 'खिलाड़ी {n}', 'اللاعب {n}'],
    'finished': ['Finished', 'Terminado', 'Terminé', 'Beendet', 'Terminado', '已结束', 'समाप्त', 'انتهت'],
    'roll': ['Roll', 'Lanzar', 'Lancer', 'Würfeln', 'Rolar', '掷骰', 'फेंकें', 'ارمِ'],
    'hold': ['Hold', 'Plantarse', 'Garder', 'Sichern', 'Guardar', '保留', 'बचाएँ', 'احتفظ'],
    'take': ['Take {n}', 'Retirar {n}', 'Prendre {n}', 'Nimm {n}', 'Retirar {n}', '拿走{n}', '{n} लें', 'خذ {n}'],
    'cell': ['Cell {n}', 'Casilla {n}', 'Case {n}', 'Feld {n}', 'Casa {n}', '格{n}', 'खाना {n}', 'الخانة {n}'],
    'sow': ['Sow pit {n}', 'Sembrar hoyo {n}', 'Semer trou {n}', 'Mulde {n} säen', 'Semear buraco {n}', '撒子坑{n}', 'गड्ढा {n} बोएँ', 'وزّع الحفرة {n}'],
    'server_invalid': ['Illegal move', 'Jugada ilegal', 'Coup interdit', 'Ungültiger Zug', 'Jogada ilegal', '非法着法', 'अवैध चाल', 'حركة غير قانونية'],
    'score': ['{a} : {b}']*8,
    'place_second': ['Place one more stone', 'Coloca una piedra más', 'Placez encore une pierre', 'Setze noch einen Stein', 'Coloque mais uma pedra', '再放置一枚棋子', 'एक और गोटी रखें', 'ضع حجرًا آخر'],
}
UI_RULES = ['Tap a highlighted legal target or use an action button. The board scales to the screen. Only your turn is interactive.', 'Toca un destino legal resaltado o usa un botón. El tablero se adapta a la pantalla. Solo tu turno es interactivo.', 'Touchez une cible légale surlignée ou un bouton. Le plateau s’adapte à l’écran. Seul votre tour est interactif.', 'Tippe auf ein markiertes legales Ziel oder eine Aktion. Das Brett passt sich dem Bildschirm an. Nur dein Zug ist interaktiv.', 'Toque num destino legal destacado ou use um botão. O tabuleiro se adapta à tela. Só a sua vez é interativa.', '点击高亮合法目标或操作按钮。棋盘适应屏幕。仅在自己的回合可操作。', 'दिखाए वैध लक्ष्य या बटन दबाएँ। बोर्ड स्क्रीन के अनुसार ढलता है। केवल अपनी बारी में खेलें।', 'اضغط هدفًا قانونيًا مميزًا أو زر إجراء. تتكيف اللوحة مع الشاشة. التفاعل متاح في دورك فقط.']
ATAXX_UI_RULES = ['Select one of your pieces, then tap a highlighted empty square. One step clones; two steps jumps.',
                  'Selecciona una ficha y toca una casilla vacía resaltada. Un paso clona; dos pasos saltan.',
                  'Sélectionnez un pion, puis touchez une case vide surlignée. Un pas clone ; deux pas font sauter.',
                  'Wähle einen Stein und tippe dann auf ein markiertes freies Feld. Ein Schritt klont, zwei Schritte springen.',
                  'Selecione uma peça e toque numa casa vazia destacada. Um passo clona; dois passos saltam.',
                  '先选择己方棋子，再点击高亮的空格。移动一步会复制；移动两步会跳跃。',
                  'अपनी गोटी चुनें, फिर दिखाए गए खाली खाने को दबाएँ। एक खाने की चाल नकल बनाती है; दो खाने की चाल छलाँग है।',
                  'اختر حجرًا لك ثم اضغط خانة فارغة مميزة. خطوة واحدة تنسخ الحجر؛ وخطوتان تقفزان.']


def strings(kind, index=0):
    return {'title': TITLES[kind][index], **{k: v[index] for k, v in COMMON.items()}}


def ui_rule(kind, index):
    return ATAXX_UI_RULES[index] if kind == 'ataxx' else UI_RULES[index]


def move_schema(kind):
    if kind == 'ataxx':
        cell={'type':'integer','minimum':0,'maximum':48}
        return {'type':'object','required':['from','to'],'additionalProperties':False,
                'properties':{'from':cell,'to':cell}}
    field, spec = ('cell', {'type':'integer', 'minimum':0, 'maximum':80})
    if kind == 'connect6': field, spec = 'cell', {'type':'integer', 'minimum':0, 'maximum':360}
    if kind == 'connect4': field, spec = 'column', {'type':'integer', 'minimum':0, 'maximum':6}
    if kind == 'nim': field, spec = 'take', {'type':'integer', 'minimum':1, 'maximum':3}
    if kind == 'mancala': field, spec = 'pit', {'type':'integer', 'minimum':0, 'maximum':12, 'not':{'const':6}}
    if kind == 'pig': field, spec = 'action', {'enum':['roll', 'hold']}
    return {'type':'object','required':[field], 'additionalProperties':False,'properties':{field:spec}}


def schemas(kind):
    properties = {
        'board':{'type':'array','maxItems':361 if kind=='connect6' else 81,'items':{'type':'integer','minimum':-1,'maximum':48}},
        'turn':{'enum':[0,1]}, 'scores':{'type':'array','minItems':2,'maxItems':2,'items':{'type':'integer','minimum':0,'maximum':2000}},
        'selected':{'type':'array','maxItems':2,'uniqueItems':True,'items':{'type':'integer','minimum':0,'maximum':15}},
        'matched':{'type':'array','maxItems':16,'uniqueItems':True,'items':{'type':'integer','minimum':0,'maximum':15}},
        'roll':{'type':'integer','minimum':0,'maximum':6}, 'total':{'type':'integer','minimum':0,'maximum':2000},
        'winner':{'enum':[-1,0,1]},'turns':{'type':'integer','minimum':0,'maximum':10000},'over':{'type':'boolean'},
    }
    size={'tictactoe':9,'connect4':42,'reversi':64,'nim':1,'mancala':14,'gomoku':81,'connect6':361,'ataxx':49,'hex':49,'domineering':36,'memory':16,'pig':0}[kind]
    properties['board'].update(minItems=size,maxItems=size)
    if kind=='connect6':
        properties.update({'opening':{'type':'boolean'},'pending':{'enum':[0,1]}})
    state={'type':'object','required':list(properties),'additionalProperties':False,'properties':properties}
    view=copy.deepcopy(state)
    view['properties']['legal']={'type':'array','maxItems':1176 if kind=='ataxx' else 361 if kind=='connect6' else 81,'items':move_schema(kind)}
    view['required'].append('legal')
    return {'state':state,'view':view,'move':move_schema(kind)}


def specification(kind):
    dimensions={'tictactoe':(3,3),'connect4':(6,7),'reversi':(8,8),'gomoku':(9,9),'connect6':(19,19),'ataxx':(7,7),'hex':(7,7),'domineering':(6,6),'memory':(4,4)}
    rows, cols=dimensions.get(kind,(1,1)); unit=min(480/cols,400/rows)
    board={'id':'main','kind':'grid','x':24,'y':100,'width':cols*unit,'height':rows*unit,'rows':rows,'columns':cols,'color':'#172743','alternate_color':'#1e3352','line_color':'#5c7190'}
    if kind=='ataxx':
        board['x']=(600-board['width'])/2
    if kind=='connect6':
        unit=40
        board.update(width=760,height=760,color='#d8b36b',alternate_color='#d8b36b',line_color='#d8b36b')
    if kind in ('nim','pig'):board.update(kind='free',width=480,height=360);board.pop('rows');board.pop('columns')
    if kind=='hex':
        board.update(kind='hex',width=520,height=380,cells=[{'id':str(r*7+c),'x':28+c*54+r*22,'y':28+r*48}for r in range(7)for c in range(7)])
    if kind=='mancala':
        board={'id':'main','kind':'graph','x':24,'y':150,'width':530,'height':230,'color':'#302318','line_color':'#ae8c54','cells':[
            *[{'id':str(i),'x':95+i*65,'y':160}for i in range(6)],{'id':'6','x':505,'y':110},
            *[{'id':str(7+i),'x':420-i*65,'y':55}for i in range(6)],{'id':'13','x':25,'y':110}],
            'links':[{'from':str(i),'to':str((i+1)%14)}for i in range(14)]}
        unit=60
    shapes={'shape':'circle','width':unit*.76,'height':unit*.76,'text_color':'#102039'}
    types={'p0':{**shapes,'color':'#a7f070'},'p1':{**shapes,'color':'#ff9dca'}}
    if kind=='tictactoe':types={key:{**value,'shape':'text','text_color':value['color']}for key,value in types.items()}
    if kind=='connect6':
        types['p0'].update(width=34,height=34,color='#171717',text_color='#ffffff')
        types['p1'].update(width=34,height=34,color='#fffdf5',text_color='#171717')
    if kind=='domineering':types.update({key:{**value,'shape':'rect'}for key,value in types.items()})
    if kind=='nim':types['p0'].update(width=64,height=64)
    types.update({'card':{'shape':'card','width':unit*.7,'height':unit*.85,'color':'#fff7df','text_color':'#172743'},'back':{'shape':'image','width':unit*.7,'height':unit*.85,'back_asset':'card_back'},'die':{'shape':'dice','width':100,'height':100,'color':'#fff7df','text_color':'#172743'},'total':{'shape':'text','width':160,'height':100,'text_color':'#a7f070'},'store':{'shape':'rect','width':42,'height':150,'color':'#ad7a3d','text_color':'#ffffff'},'domino':{'shape':'rect','width':44,'height':95,'color':'#a7f070'}})
    svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 100"><rect width="80" height="100" rx="8" fill="#334d88"/><path d="M10 50L40 10L70 50L40 90Z" fill="#a7f070"/></svg>'
    viewport={'width':600,'height':560}
    if kind=='connect6':viewport={'width':808,'height':880,'camera_enabled':True}
    spec={'format':'buildplay-ui','version':1,'viewport':viewport,'boards':[board],
          'piece_types':types,'assets':{'card_back':{'uri':'data:image/svg+xml;base64,'+base64.b64encode(svg.encode()).decode(),'media_type':'image/svg+xml'}},
          'strings':strings(kind),'ui_code':f'const KIND={json.dumps(kind)};\nconst SOURCE_STRINGS={json.dumps(strings(kind),ensure_ascii=False)};\n'+(DEST/'presentation.js').read_text()}
    if kind=='connect6':
        tile='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#d8b36b"/><path d="M0 20H40 M20 0V40" stroke="#624825" stroke-width="1.5"/></svg>'
        spec['assets']['connect6_cell']={'uri':'data:image/svg+xml;base64,'+base64.b64encode(tile.encode()).decode(),'media_type':'image/svg+xml'}
    if kind=='domineering':spec['boards'].append({'id':'tray','kind':'zone','x':470,'y':400,'width':120,'height':140,'color':'#172743'})
    return spec


def illustration(kind, view, caption):
    board=view['board']; elements=[]
    if kind=='connect6':
        for i in range(19):
            point=52+i*16
            elements.append(f'<path d="M52 {point}H340 M{point} 52V340" stroke="#624825" stroke-width="1"/>')
        for i,value in enumerate(board):
            if value >= 0:
                x=52+(i%19)*16;y=52+(i//19)*16
                fill='#171717' if value==0 else '#fffdf5'
                elements.append(f'<circle cx="{x}" cy="{y}" r="5" fill="{fill}" stroke="#3b2b18"/>')
        svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#d8b36b"/><text x="25" y="30" fill="#102039">'+html.escape(TITLES[kind][0])+'</text>'+''.join(elements)+'</svg>'
        return {'caption':caption,'svg':svg}
    cols={'tictactoe':3,'connect4':7,'reversi':8,'gomoku':9,'connect6':19,'hex':7,'domineering':6,'memory':4}.get(kind,7)
    step_x,step_y,cell_w,cell_h=(18,18,15,15) if kind=='connect6' else (38,34,32,28)
    for i,v in enumerate(board):
        x=30+(i%cols)*step_x;y=60+(i//cols)*step_y
        color='#213858' if v<0 else '#a7f070' if v==0 else '#ff9dca'
        elements.append(f'<rect x="{x}" y="{y}" width="{cell_w}" height="{cell_h}" rx="5" fill="{color}"/>')
        if kind in ('nim','memory','mancala') and v>=0:elements.append(f'<text x="{x+12}" y="{y+20}" fill="#102039">{v}</text>')
    if kind=='pig':elements.append(f'<text x="30" y="100" fill="#ffffff">{view["scores"][0]} : {view["scores"][1]} / {view["total"]}</text>')
    return {'caption':caption,'svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#102039"/><text x="25" y="30" fill="#ffffff">'+html.escape(TITLES[kind][0])+'</text>'+''.join(elements)+'</svg>'}


def package(kind):
    game_schemas=schemas(kind)
    code=f'const KIND={json.dumps(kind)};\n'+(DEST/'engine.js').read_text()
    logic=GameLogic(code,game_schemas=game_schemas)
    ctx={'players':[{'id':'u1','kind':'human','display_name':'Alice','picture_url':'','max_loss':0,'active':True},{'id':'u2','kind':'human','display_name':'Bob','picture_url':'','max_loss':0,'active':True}], 'pot':0,'move_count':0}
    result=logic.call('newMatch',ctx=ctx,seed=7); steps=[]
    for i in range(1000):
        state=result['state'];pid=result['turn'][0];seed=i+11;ctx['move_count']=i
        move=logic.call('computerMove',state,pid,ctx=ctx,seed=seed)
        result=logic.call('applyMove',state,pid,move,ctx=ctx,seed=seed)
        steps.append((copy.deepcopy(ctx),state,pid,move,result,seed))
        if result['turn'] is None:break
    else:raise RuntimeError(f'{kind} did not finish')
    cases=[]
    intermediate=2 if kind=='connect6' else 1
    for label,index in [('initial',0),('intermediate',intermediate),('terminal',len(steps)-1)]:
        case_ctx,state,pid,move,result,seed=steps[index]
        before=[logic.call('viewFor',state,who,ctx=case_ctx,seed=seed)for who in (pid,None)]
        after=[logic.call('viewFor',result['state'],who,ctx={**case_ctx,'move_count':index+1},seed=seed)for who in (pid,None)]
        case={'name':label.title()+' move','description':RULES[kind][0], 'kind':label,'ctx':{**case_ctx,'seed':seed},'state':state,'view_of_mover':before[0],'view_of_other':before[1],'player_id':pid,'other_player_id':None,'move':move,'expected_state':result['state'],'expected_turn':result['turn'],'expected_view_of_mover':after[0],'expected_view_of_other':after[1],
              'images':[illustration(kind,v,c)for v,c in zip(before+after,['Before: mover','Before: spectator','After: mover','After: spectator'])]}
        if 'payouts' in result:case['expected_payouts']=result['payouts']
        cases.append(case)
    source=strings(kind)
    return {'all_state_public':kind!='memory',
            'name':TITLES[kind][0]+' (Declarative)','description':RULES[kind][0],
            'game_addition_request_id_and_secret':'example-only-declarative-'+kind+'-replace-before-publishing',
            'allowed_player_counts':[2],
            'server_code':code,'declarative_ui':specification(kind),
            'rules':RULES[kind][0],'ui_instructions':ui_rule(kind,0),
            'tutorial':{'text':RULES[kind][0],'html':'<meta name="viewport" content="width=device-width,initial-scale=1"><p>'+html.escape(RULES[kind][0])+'</p>'},
            'images':[{'caption':'Cover','svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#102039"/><circle cx="55" cy="45" r="25" fill="#a7f070"/><circle cx="105" cy="45" r="25" fill="#ff9dca"/></svg>'},*cases[0]['images'][:3]],
            'unit_tests':{**{k+'_schema':v for k,v in game_schemas.items()},'cases':cases},
            'translations':{locale:{'display_name':TITLES[kind][i]+' (Declarative)','short_description':RULES[kind][i], 'game_logic_rules':RULES[kind][i],'game_ui_rules':ui_rule(kind,i), 'tutorial_strings':{RULES[kind][0]:RULES[kind][i]},'client_strings':strings(kind,i)}for i,locale in enumerate(LOCALES)if i}}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('kinds', nargs='*', choices=list(TITLES))
    parser.add_argument('--presentation-only', action='store_true',
                        help='Update only the portable presentation in existing packages')
    args=parser.parse_args()
    for kind in args.kinds or TITLES:
        filename=DEST/(kind+'.json')
        if args.presentation_only:
            payload=json.loads(filename.read_text(encoding='utf-8'))
            payload['declarative_ui']=specification(kind)
        else:
            payload=package(kind)
        filename.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(kind, len(json.dumps(payload).encode()), 'bytes')


if __name__=='__main__': main()
