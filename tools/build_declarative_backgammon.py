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
    'Each player rolls one opening die; reroll ties. The higher roll starts using both dice. Move all 15 checkers home and bear them off; doubles give four moves. Enter captured checkers from the bar first. Two opposing checkers block a point; a lone checker is hit. Use the maximum possible dice and the higher die if only one is usable. Undo a move only while your turn is unfinished. Choose a match goal of 1, 3, 5, 7, 11 or 15 points. A gammon scores double and a backgammon triple. If enabled, offer the doubling cube before rolling; the opponent may take or drop. The cube changes match points, never the platform token pot. First to the chosen goal wins.',
    'Cada jugador lanza un dado inicial; los empates se repiten. El mayor empieza usando ambos dados. Lleva las 15 fichas a casa y retíralas; los dobles dan cuatro movimientos. Reingresa primero las fichas de la barra. Dos fichas rivales bloquean una punta; una sola se captura. Usa el máximo de dados y el mayor si solo puedes usar uno. Deshaz movimientos solo durante tu turno. Elige una meta de 1, 3, 5, 7, 11 o 15 puntos. Gammon vale doble y backgammon triple. Si está activo, ofrece el cubo antes de lanzar; el rival acepta o abandona. El cubo cambia los puntos, nunca el bote de fichas de la plataforma. Gana quien llegue a la meta.',
    'Chaque joueur lance un dé initial ; recommencez les égalités. Le plus fort commence avec les deux dés. Ramenez les 15 pions puis sortez-les ; un double donne quatre déplacements. Rentrez les pions de la barre en premier. Deux pions adverses bloquent une flèche ; un pion seul est frappé. Utilisez le maximum de dés et le plus fort si un seul est jouable. Annulez uniquement pendant votre tour. Choisissez 1, 3, 5, 7, 11 ou 15 points. Un gammon vaut double et un backgammon triple. Si activé, proposez le videau avant de lancer ; l’adversaire accepte ou abandonne. Le videau change les points, jamais la cagnotte de jetons. Le premier au score choisi gagne.',
    'Jeder würfelt anfangs einen Würfel; bei Gleichstand erneut würfeln. Die höhere Zahl beginnt mit beiden Würfeln. Bringe 15 Steine heim und würfle sie heraus; ein Pasch gibt vier Züge. Steine auf der Bar zuerst einsetzen. Zwei gegnerische Steine sperren einen Punkt, ein einzelner wird geschlagen. Nutze möglichst viele Würfel, bei nur einem möglichen den höheren. Rücknahme nur im laufenden Zug. Wähle 1, 3, 5, 7, 11 oder 15 Punkte. Gammon zählt doppelt, Backgammon dreifach. Falls aktiviert, vor dem Würfeln doppeln; der Gegner nimmt an oder gibt auf. Der Doppler ändert Matchpunkte, nie den Token-Topf. Wer zuerst das Ziel erreicht, gewinnt.',
    'Cada jogador lança um dado inicial; empates são repetidos. O maior começa usando os dois dados. Leve as 15 peças para casa e retire-as; duplas dão quatro movimentos. Entre primeiro com peças da barra. Duas peças rivais bloqueiam; uma sozinha é capturada. Use o máximo de dados e o maior se só um for utilizável. Desfaça apenas durante seu turno. Escolha 1, 3, 5, 7, 11 ou 15 pontos. Gammon vale dobro e backgammon triplo. Se ativado, ofereça o cubo antes de lançar; o rival aceita ou desiste. O cubo muda os pontos, nunca o pote de fichas da plataforma. Vence quem atingir a meta.',
    '双方各掷一枚开局骰，平局重掷，较大者用这两枚骰先走。将15枚棋子全部带回本区后移出；双骰走四步。中栏上的被吃棋子必须先入场。对方两子以上阻挡，单子可吃。必须尽量用完骰子，只能用一枚时用较大点数。仅在本回合结束前可撤回。选择1、3、5、7、11或15分目标。Gammon计双倍，backgammon计三倍。启用倍数骰时可在掷骰前提出加倍，对方可接受或放弃。倍数骰只改变比赛分数，不改变平台代币奖池。先达到目标分数者获胜。',
    'दोनों खिलाड़ी शुरू में एक-एक पासा फेंकते हैं; बराबरी पर फिर फेंकें। बड़ा अंक दोनों पासों से शुरू करता है। सभी 15 गोटियाँ घर लाकर बाहर निकालें; समान अंक पर चार चालें मिलती हैं। पहले बार की गोटियाँ लौटाएँ। दो विरोधी गोटियाँ रास्ता रोकती हैं; अकेली पकड़ी जाती है। अधिकतम पासे चलें और केवल एक हो सके तो बड़ा चलें। चाल केवल अपनी बारी खत्म होने से पहले वापस लें। 1, 3, 5, 7, 11 या 15 अंक चुनें। गैमन दुगुना और बैकगैमोन तिगुना है। सक्षम होने पर पासे से पहले दाँव घन बढ़ाएँ; प्रतिद्वंद्वी स्वीकार या छोड़ सकता है। घन केवल मैच अंक बदलता है, मंच के टोकन नहीं। लक्ष्य तक पहले पहुँचने वाला जीतता है।',
    'يرمي كل لاعب نردًا في البداية؛ عند التعادل يعاد الرمي. يبدأ صاحب الرقم الأعلى مستخدمًا النردين. أوصل الأحجار الـ15 إلى البيت ثم أخرجها؛ المتساويان يمنحان أربع نقلات. أعد أحجار الحاجز أولًا. حجران للخصم يسدان النقطة والمنفرد يُضرب. استخدم أكبر عدد من النرد والأكبر إذا أمكن استعمال واحد فقط. التراجع خلال دورك فقط. اختر هدف 1 أو 3 أو 5 أو 7 أو 11 أو 15 نقطة. الجامون يضاعف النقاط والباكجامون يثلثها. عند تفعيله اعرض مكعب المضاعفة قبل الرمي؛ يقبل الخصم أو ينسحب. المكعب يغير نقاط المباراة ولا يغير رصيد رموز المنصة. أول من يبلغ الهدف يفوز.',
]
UI_RULES = [
    'Press Roll Dice or tap either die. Each player rolls one opening die; the higher roll starts. Select a green highlighted checker, then a highlighted destination, or drag it there. Doubles show four dice; used dice turn gray. Captured checkers must re-enter first. Undo is available during an unfinished turn. Hint highlights a legal move; Help explains the board. Both computer and pass-and-play use smooth checker and dice animations. The fitted board stays fixed without zoom or pan.',
    'Pulsa Lanzar dados o toca un dado. Cada jugador lanza un dado inicial; empieza el mayor. Selecciona una ficha verde y su destino o arrástrala. Los dobles muestran cuatro dados; los usados se vuelven grises. Reingresa primero las capturadas. Puedes deshacer durante el turno. Pista resalta una jugada; Ayuda explica el tablero. Hay animaciones contra el ordenador y en el mismo dispositivo. El tablero permanece fijo, sin zoom ni desplazamiento.',
    'Appuyez sur Lancer les dés ou touchez un dé. Chacun lance un dé initial ; le plus fort commence. Choisissez un pion vert puis sa destination, ou glissez-le. Un double affiche quatre dés ; les dés utilisés grisent. Rentrez les pions frappés en premier. Annulez pendant votre tour. Indice indique un coup ; Aide explique le plateau. Les deux modes animent les pions et les dés. Le plateau reste fixe, sans zoom ni déplacement.',
    'Drücke Würfeln oder tippe auf einen Würfel. Jeder würfelt anfangs einmal; die höhere Zahl beginnt. Wähle einen grün markierten Stein und sein Ziel oder ziehe ihn dorthin. Ein Pasch zeigt vier Würfel; verbrauchte werden grau. Geschlagene Steine zuerst einsetzen. Während des Zuges kannst du zurücknehmen. Tipp markiert einen Zug; Hilfe erklärt das Brett. Beide Modi animieren Steine und Würfel. Das Brett bleibt ohne Zoom und Verschieben fest.',
    'Pressione Lançar dados ou toque em um dado. Cada jogador lança um dado inicial; começa o maior. Selecione uma peça verde e seu destino ou arraste-a. Duplas mostram quatro dados; os usados ficam cinza. Entre primeiro com as capturadas. Desfaça durante o turno. Dica destaca uma jogada; Ajuda explica o tabuleiro. Ambos os modos animam peças e dados. O tabuleiro fica fixo, sem zoom ou deslocamento.',
    '点击掷骰按钮或骰子。双方先各掷一枚，点数较大者先走。选择绿色高亮棋子和目标，或拖动棋子。双骰显示四枚骰子，已用骰子变灰。先让被吃的棋子从中栏回场。未结束的回合可撤销。提示会标出合法走法，帮助介绍棋盘。人机和同屏轮流模式均有棋子和骰子动画。棋盘自动适配，禁止缩放和平移。',
    'पासे फेंकें बटन या पासे पर दबाएँ। शुरुआत में दोनों एक पासा फेंकते हैं; बड़ा अंक पहले चलता है। हरी गोटी और लक्ष्य चुनें या गोटी खींचें। समान अंक पर चार पासे दिखते हैं; इस्तेमाल हुए पासे धूसर होते हैं। पकड़ी गोटियाँ पहले लौटाएँ। अधूरी बारी में चाल वापस लें। संकेत वैध चाल बताता है; मदद नियम समझाती है। दोनों मोड में गोटी और पासे चलते दिखते हैं। बोर्ड स्थिर रहता है, ज़ूम या पैन नहीं होता।',
    'اضغط ارم النرد أو المس نردًا. يرمي كل لاعب نردًا أولًا ويبدأ الأعلى. اختر حجرًا أخضر ثم وجهته أو اسحبه. المتساويان يظهران أربعة نرد، والمستعمل يصير رماديًا. أعد الأحجار المضروبة أولًا. تراجع أثناء الدور غير المكتمل. تلميح يميز نقلة قانونية؛ مساعدة تشرح اللوحة. يتحرك الحجر والنرد في وضعي اللعب. تبقى اللوحة ثابتة دون تكبير أو تحريك.',
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
    'red': ['Red: home at lower right', 'Rojas: casa abajo a la derecha', 'Rouges : maison en bas à droite', 'Rot: Heimfeld unten rechts', 'Vermelhas: casa inferior direita', '红方：右下本区', 'लाल: घर नीचे दाएँ', 'الأحمر: البيت أسفل اليمين'],
    'ivory': ['Ivory: home at upper right', 'Marfil: casa arriba a la derecha', 'Ivoire : maison en haut à droite', 'Elfenbein: Heimfeld oben rechts', 'Marfim: casa superior direita', '象牙白：右上本区', 'हाथीदाँत: घर ऊपर दाएँ', 'العاجي: البيت أعلى اليمين'],
    'pip': ['PIP: {count}', 'PIP: {count}', 'PIP : {count}', 'PIP: {count}', 'PIP: {count}', '步数：{count}', 'पिप: {count}', 'النقاط: {count}'],
    'borne_off': ['Off: {count} / 15', 'Fuera: {count} / 15', 'Sortis : {count} / 15', 'Aus: {count} / 15', 'Fora: {count} / 15', '移出：{count} / 15', 'बाहर: {count} / 15', 'الخارج: {count} / 15'],
    'opening_turn': ['Opening roll · {name}', 'Lanzamiento inicial · {name}', 'Premier lancer · {name}', 'Eröffnungswurf · {name}', 'Lançamento inicial · {name}', '开局掷骰 · {name}', 'शुरुआती पासा · {name}', 'رمية البداية · {name}'],
    'undo': ['Undo', 'Deshacer', 'Annuler', 'Zurück', 'Desfazer', '撤销', 'वापस', 'تراجع'],
    'hint': ['Hint', 'Pista', 'Indice', 'Tipp', 'Dica', '提示', 'संकेत', 'تلميح'],
    'help': ['Help', 'Ayuda', 'Aide', 'Hilfe', 'Ajuda', '帮助', 'मदद', 'مساعدة'],
    'close': ['Close', 'Cerrar', 'Fermer', 'Schließen', 'Fechar', '关闭', 'बंद करें', 'إغلاق'],
    'help_title': ['How to play', 'Cómo jugar', 'Comment jouer', 'Spielanleitung', 'Como jogar', '玩法说明', 'कैसे खेलें', 'طريقة اللعب'],
    'help_select': ['Select a green checker, then a green destination.', 'Elige una ficha verde y después un destino verde.', 'Choisissez un pion vert puis une destination verte.', 'Wähle einen grünen Stein und ein grünes Ziel.', 'Escolha uma peça verde e depois um destino verde.', '选择绿色棋子，再选择绿色目标。', 'हरी गोटी चुनें, फिर हरा लक्ष्य चुनें।', 'اختر حجرًا أخضر ثم وجهة خضراء.'],
    'help_dice': ['Use both dice; doubles give four moves.', 'Usa ambos dados; los dobles dan cuatro movimientos.', 'Jouez les deux dés ; un double donne quatre coups.', 'Nutze beide Würfel; ein Pasch gibt vier Züge.', 'Use os dois dados; duplas dão quatro movimentos.', '使用两枚骰子；双骰可走四步。', 'दोनों पासे चलें; समान अंक पर चार चालें मिलती हैं।', 'استخدم النردين؛ المتساويان يمنحان أربع نقلات.'],
    'help_hit': ['Hit a lone opponent. Two opponents block a point.', 'Captura una rival sola. Dos rivales bloquean.', 'Frappez un pion isolé. Deux adversaires bloquent.', 'Schlage einzelne Gegner. Zwei Gegner sperren.', 'Capture uma rival só. Duas rivais bloqueiam.', '可吃对方单子；两子或更多会阻挡。', 'अकेली विरोधी गोटी पकड़ें। दो गोटियाँ रास्ता रोकती हैं।', 'اضرب الحجر المنفرد؛ حجران للخصم يسدان النقطة.'],
    'help_bar': ['Return captured checkers from the bar first.', 'Reingresa primero las fichas de la barra.', 'Rentrez les pions de la barre en premier.', 'Setze geschlagene Steine von der Bar zuerst ein.', 'Entre primeiro com as peças da barra.', '先让中栏的被吃棋子回场。', 'पहले बार की पकड़ी गोटियाँ लौटाएँ।', 'أعد أحجار الحاجز أولًا.'],
    'help_home': ['Bring all 15 home, then bear off. First off wins.', 'Lleva las 15 a casa y retíralas para ganar.', 'Ramenez les 15 pions puis sortez-les pour gagner.', 'Bringe alle 15 ins Heimfeld, dann würfle sie heraus.', 'Leve as 15 para casa e retire-as para vencer.', '将15子带回本区后移出；先全部移出者胜。', 'सभी 15 गोटियाँ घर लाएँ, फिर निकालें। पहले निकालने वाला जीतेगा।', 'أوصل الأحجار الـ15 للبيت ثم أخرجها لتفوز.'],
    'hint_move': ['Try {from} → {to}', 'Prueba {from} → {to}', 'Essayez {from} → {to}', 'Versuche {from} → {to}', 'Tente {from} → {to}', '建议 {from} → {to}', 'आजमाएँ {from} → {to}', 'جرّب {from} → {to}'],
    'double': ['Double', 'Doblar', 'Doubler', 'Doppeln', 'Dobrar', '加倍', 'दोगुना', 'ضاعف'],
    'take': ['Take', 'Aceptar', 'Accepter', 'Annehmen', 'Aceitar', '接受', 'स्वीकार', 'اقبل'],
    'drop': ['Decline', 'Rechazar', 'Refuser', 'Ablehnen', 'Recusar', '拒绝', 'अस्वीकार', 'ارفض'],
    'double_offer': ['{name}: accept the double?', '{name}: ¿aceptas el doble?', '{name} : accepter le double ?', '{name}: Verdopplung annehmen?', '{name}: aceitar a dobra?', '{name}：接受加倍？', '{name}: दोगुना स्वीकार करें?', '{name}: هل تقبل المضاعفة؟'],
    'no_moves': ['No moves available', 'No hay jugadas', 'Aucun coup possible', 'Kein Zug möglich', 'Sem jogadas', '无合法走法', 'कोई चाल उपलब्ध नहीं', 'لا توجد نقلات'],
    'opening_tie': ['Opening tie · {name}: roll again', 'Empate inicial · {name}: vuelve a lanzar', 'Égalité initiale · {name} : relancez', 'Gleicher Wurf · {name}: erneut würfeln', 'Empate inicial · {name}: lance de novo', '开局同点 · {name}：重掷', 'शुरुआत बराबर · {name}: फिर फेंकें', 'تعادل البداية · {name}: ارم مجددًا'],
    'options': ['Options', 'Opciones', 'Options', 'Optionen', 'Opções', '选项', 'विकल्प', 'خيارات'],
    'pieces': ['Pieces', 'Fichas', 'Pions', 'Steine', 'Peças', '棋子', 'गोटियाँ', 'الأحجار'],
    'play_to': ['Play to', 'Jugar hasta', 'Jouer en', 'Spielziel', 'Jogar até', '目标分数', 'लक्ष्य अंक', 'العب حتى'],
    'doubling_cube': ['Doubling cube', 'Cubo de doblaje', 'Videau', 'Dopplerwürfel', 'Cubo de dobra', '加倍骰', 'दोगुना घन', 'مكعب المضاعفة'],
    'on': ['On', 'Sí', 'Activé', 'An', 'Ligado', '开启', 'चालू', 'تشغيل'],
    'disabled': ['Off', 'No', 'Désactivé', 'Aus', 'Desligado', '关闭', 'बंद', 'إيقاف'],
    'difficulty': ['Computer difficulty', 'Dificultad del ordenador', 'Niveau de l’ordinateur', 'Computerstärke', 'Dificuldade do computador', '电脑难度', 'कंप्यूटर कठिनाई', 'مستوى الكمبيوتر'],
    'easy': ['Easy', 'Fácil', 'Facile', 'Leicht', 'Fácil', '简单', 'आसान', 'سهل'],
    'medium': ['Medium', 'Medio', 'Moyen', 'Mittel', 'Médio', '中等', 'मध्यम', 'متوسط'],
    'hard': ['Hard', 'Difícil', 'Difficile', 'Schwer', 'Difícil', '困难', 'कठिन', 'صعب'],
    'expert': ['Expert', 'Experto', 'Expert', 'Experte', 'Especialista', '专家', 'विशेषज्ञ', 'خبير'],
    'start_game': ['Start game', 'Empezar', 'Commencer', 'Spiel starten', 'Começar', '开始游戏', 'खेल शुरू करें', 'ابدأ اللعب'],
    'next_game': ['Next game', 'Siguiente partida', 'Partie suivante', 'Nächstes Spiel', 'Próximo jogo', '下一局', 'अगला खेल', 'اللعبة التالية'],
    'score': ['S: {score}/{goal}', 'P: {score}/{goal}', 'S : {score}/{goal}', 'S: {score}/{goal}', 'P: {score}/{goal}', '分：{score}/{goal}', 'अंक: {score}/{goal}', 'ن: {score}/{goal}'],
    'red_piece': ['Red', 'Rojas', 'Rouges', 'Rot', 'Vermelhas', '红方', 'लाल', 'الأحمر'],
    'ivory_piece': ['Ivory', 'Marfil', 'Ivoire', 'Elfenbein', 'Marfim', '象牙白', 'हाथीदाँत', 'العاجي'],
    'home_lower': ['{color}: home at lower right', '{color}: casa abajo a la derecha', '{color} : maison en bas à droite', '{color}: Heimfeld unten rechts', '{color}: casa inferior direita', '{color}：右下本区', '{color}: घर नीचे दाएँ', '{color}: البيت أسفل اليمين'],
    'home_upper': ['{color}: home at upper right', '{color}: casa arriba a la derecha', '{color} : maison en haut à droite', '{color}: Heimfeld oben rechts', '{color}: casa superior direita', '{color}：右上本区', '{color}: घर ऊपर दाएँ', '{color}: البيت أعلى اليمين'],
    'swap_colors': ['Swap colors', 'Cambiar colores', 'Échanger les couleurs', 'Farben tauschen', 'Trocar cores', '交换颜色', 'रंग बदलें', 'بدّل الألوان'],
    'opening_winner': ['{name} moves first', '{name} empieza', '{name} commence', '{name} beginnt', '{name} começa', '{name}先走', '{name} पहले चलेंगे', '{name} يبدأ أولًا'],
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
    # Describe the authority's board moves, roll/pass, turn-local undo and cube
    # responses precisely. Clients cannot submit state, dice or cube overrides.
    coordinate = {'type': 'integer', 'minimum': 0, 'maximum': 23}
    schemas['move'] = {'$schema': 'https://json-schema.org/draft/2020-12/schema',
        'oneOf': [
            {'type': 'object', 'required': ['action'], 'additionalProperties': False,
             'properties': {'action': {'enum': ['roll', 'pass', 'undo', 'double', 'take', 'drop', 'next']}}},
            {'type': 'object', 'required': ['action', 'difficulty', 'goal', 'cube_enabled'],
             'additionalProperties': False,
             'properties': {'action': {'const': 'configure'},
                            'difficulty': {'enum': [0, 1, 2, 3]},
                            'goal': {'enum': [1, 3, 5, 7, 11, 15]},
                            'cube_enabled': {'type': 'boolean'}}},
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
        schemas[name]['properties']['opening'] = {'type': 'boolean'}
        schemas[name]['properties']['opening_roll'] = {
            'type': ['array', 'null'], 'minItems': 2, 'maxItems': 2,
            'items': {'type': ['integer', 'null'], 'minimum': 1, 'maximum': 6}}
        schemas[name]['properties']['cube'] = {
            'type': 'object', 'additionalProperties': False,
            'required': ['value', 'owner', 'offer'],
            'properties': {'value': {'enum': [1, 2, 4, 8, 16, 32, 64]},
                           'owner': {'enum': [None, 0, 1]}, 'offer': {'enum': [None, 0, 1]}}}
        schemas[name]['properties'].update({
            'configured': {'type': 'boolean'}, 'difficulty': {'enum': [0, 1, 2, 3]},
            'goal': {'enum': [1, 3, 5, 7, 11, 15]}, 'cube_enabled': {'type': 'boolean'},
            'scores': {'type': 'array', 'minItems': 2, 'maxItems': 2,
                       'items': {'type': 'integer', 'minimum': 0, 'maximum': 256}},
            'round_winner': {'enum': [None, 0, 1]},
        })
    # Four dice are the largest possible turn. Snapshots never contain another
    # snapshot list, bounding both the authority state and history payloads.
    schemas['state']['properties']['undo_stack'] = {
        'type': 'array', 'maxItems': 4,
        'items': {'type': 'string', 'minLength': 1, 'maxLength': 8000}}
    schemas['view']['properties']['can_undo'] = {'type': 'boolean'}
    schemas['view']['properties']['can_double'] = {'type': 'boolean'}
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
    # Original vector artwork: layered wood grain, inlaid points and brass hinges.
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 440">',
        '<defs><linearGradient id="frame" x2=".5" y2="1"><stop stop-color="#6e3213"/><stop offset=".45" stop-color="#351403"/><stop offset="1" stop-color="#723414"/></linearGradient>',
        '<linearGradient id="wood" x2=".25" y2="1"><stop stop-color="#f2bc62"/><stop offset=".46" stop-color="#d99336"/><stop offset="1" stop-color="#efb257"/></linearGradient>',
        '<linearGradient id="brass" x2="1" y2="0"><stop stop-color="#75501e"/><stop offset=".4" stop-color="#e2bd73"/><stop offset="1" stop-color="#80602c"/></linearGradient>',
        '</defs>',
        '<rect x="1" y="1" width="698" height="438" rx="5" fill="url(#frame)" stroke="#301305" stroke-width="2"/>',
        '<path d="M7 7H693V433H7Z" fill="none" stroke="#a05b26" stroke-opacity=".6" stroke-width="2"/>',
        '<rect x="16" y="16" width="640" height="408" fill="url(#wood)" stroke="#301507" stroke-width="5"/>',
        ]
    for y in range(26,420,17):
        parts.append(f'<path d="M18 {y}Q180 {y-7}330 {y}T654 {y+1}" fill="none" stroke="#fff0bf" stroke-opacity=".12" stroke-width="2"/>')
    for point in range(24):
        x = point_x(point)
        y, tip = (18, 179) if point >= 12 else (422, 261)
        color = '#63240e' if point % 2 else '#b56828'
        parts.append(f'<path d="M{x-24},{y}H{x+24}L{x+3},{tip}Q{x},{tip+(-5 if point<12 else 5)} {x-3},{tip}Z" fill="{color}"/>')
    parts += ['<rect x="316" y="10" width="40" height="420" fill="url(#frame)" stroke="#9e602a" stroke-width="2"/>',
        '<path d="M333 12V428M339 12V428" stroke="#2f1206" stroke-width="2"/>']
    for y in (106, 306):
        parts.append(f'<rect x="321" y="{y}" width="30" height="27" rx="2" fill="url(#brass)" stroke="#614321"/><path d="M336 {y}V{y+27}" stroke="#6e4a20"/>')
        for x in (325, 347):
            for d in (5,22):
                parts.append(f'<circle cx="{x}" cy="{y+d}" r="1.4" fill="#f5d99d" stroke="#5c3d18" stroke-width=".7"/>')
    parts.append('<rect x="670" y="22" width="16" height="396" rx="4" fill="#341306" stroke="#995526"/>')
    parts.append('</svg>')
    return ''.join(parts)


def checker_svg(seat, flat=False):
    color, light, edge = ('#d40016', '#ff6a61', '#640008') if seat == 0 else ('#dddcd8', '#ffffff', '#777773')
    if flat:
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 10"><rect x="1" y="1" width="42" height="8" rx="3" fill="'+color+'" stroke="'+edge+'"/><path d="M5 3H39" stroke="'+light+'" stroke-opacity=".65"/></svg>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><defs><radialGradient id="disc' + str(seat) + '" cx=".4" cy=".28" r=".75"><stop stop-color="'+light+'"/><stop offset=".65" stop-color="'+color+'"/><stop offset="1" stop-color="'+edge+'"/></radialGradient></defs><ellipse cx="22" cy="24" rx="20" ry="20" fill="#1e0b05" opacity=".5"/><circle cx="22" cy="21" r="20" fill="url(#disc' + str(seat) + ')" stroke="#210e08" stroke-width="1.5"/><circle cx="22" cy="21" r="17.5" fill="none" stroke="'+light+'" stroke-width="1.1"/><circle cx="22" cy="21" r="15.3" fill="none" stroke="'+edge+'" stroke-width="1"/><path d="M9 16A14 14 0 0 1 30 9" fill="none" stroke="#fff" stroke-opacity=".4" stroke-width="1.2"/></svg>')


def die_svg(value, used=0):
    positions = {1: [(32,32)], 2: [(18,18),(46,46)], 3: [(18,18),(32,32),(46,46)],
        4: [(18,18),(46,18),(18,46),(46,46)], 5: [(18,18),(46,18),(32,32),(18,46),(46,46)],
        6: [(18,17),(46,17),(18,32),(46,32),(18,47),(46,47)]}
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="ivory" x2=".5" y2="1"><stop stop-color="#fff"/><stop offset=".65" stop-color="#f1eee6"/><stop offset="1" stop-color="#b6b2a8"/></linearGradient><clipPath id="face"><rect x="3" y="2" width="58" height="58" rx="10"/></clipPath></defs>',
        '<rect x="4" y="5" width="58" height="58" rx="10" fill="#281a0f" opacity=".35"/><rect x="3" y="2" width="58" height="58" rx="10" fill="url(#ivory)" stroke="#625d55" stroke-width="1.5"/>']
    if value:
        for x,y in positions[value]:
            parts.append(f'<circle cx="{x}" cy="{y}" r="5.4" fill="#262522"/><circle cx="{x-1.3}" cy="{y-1.8}" r="1.2" fill="#8e8c83"/>')
    else:
        parts.append('<path d="M24 23Q24 14 32 14Q43 14 42 24Q41 29 34 31L32 38" fill="none" stroke="#777266" stroke-width="4" stroke-linecap="round"/><circle cx="32" cy="47" r="2.8" fill="#777266"/>')
    if used:
        parts.append(f'<rect x="0" y="0" width="{32 if used==1 else 64}" height="64" fill="#767b79" opacity=".72" clip-path="url(#face)"/>')
    parts.append('</svg>')
    return ''.join(parts)


def target_svg(upper=False):
    triangle = '0,15 48,15 24,176' if upper else '0,205 48,205 24,44'
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 220">',
        f'<defs><clipPath id="triangle"><polygon points="{triangle}"/></clipPath></defs>',
        f'<polygon points="{triangle}" fill="#70ff24" fill-opacity=".15" stroke="#8cff34" stroke-width="1.8"/>',
        '<g clip-path="url(#triangle)" fill="none" stroke="#8cff34" stroke-width="1.6" stroke-opacity=".85">']
    for y in range(-50,260,9):
        parts.append(f'<path d="M-4 {y}L52 {y+56}"/>')
    parts.append('</g></svg>')
    return ''.join(parts)


def panel_svg(active=False, button=False):
    width,height=(180,54) if button else (252,54)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}"><defs><linearGradient id="panel" x2="0" y2="1"><stop stop-color="#383936"/><stop offset=".49" stop-color="#252623"/><stop offset=".51" stop-color="#11130f"/><stop offset="1" stop-color="#080b07"/></linearGradient></defs><rect x="1.5" y="1.5" width="{width-3}" height="{height-3}" rx="7" fill="url(#panel)" stroke="{"#47ef21" if active else "#171d12"}" stroke-width="3"/><path d="M8 4H{width-8}" stroke="#ffffff" stroke-opacity=".25"/></svg>'


def specification():
    def asset(svg):
        return {'uri':'data:image/svg+xml;base64,'+base64.b64encode(svg.encode()).decode(), 'media_type':'image/svg+xml'}
    assets = {'board_art':asset(board_svg()), 'checker_red':asset(checker_svg(0)), 'checker_ivory':asset(checker_svg(1)),
        'off_red':asset(checker_svg(0,True)), 'off_ivory':asset(checker_svg(1,True)),
        'target_upper':asset(target_svg(True)), 'target_lower':asset(target_svg(False)),
        'status':asset(panel_svg()), 'status_active':asset(panel_svg(True)), 'button':asset(panel_svg(button=True)),
        'tray':asset('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 440"><defs><linearGradient id="wood" x2="1" y2=".3"><stop stop-color="#6e3213"/><stop offset=".5" stop-color="#381504"/><stop offset="1" stop-color="#773b17"/></linearGradient></defs><rect x="1" y="1" width="62" height="438" rx="4" fill="url(#wood)" stroke="#3e1908" stroke-width="2"/><rect x="9" y="23" width="46" height="162" rx="5" fill="#341508" stroke="#995325" stroke-width="2"/><rect x="9" y="255" width="46" height="162" rx="5" fill="#341508" stroke="#995325" stroke-width="2"/></svg>'),
        'help_panel':asset('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 340"><rect x="2" y="2" width="616" height="336" rx="12" fill="#10250e" stroke="#b98a4a" stroke-width="3"/><rect x="9" y="9" width="602" height="322" rx="8" fill="none" stroke="#ffffff" stroke-opacity=".15"/></svg>'),
        'options_panel':asset('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 740 540"><rect x="2" y="2" width="736" height="536" rx="12" fill="#10250e" stroke="#b98a4a" stroke-width="3"/><rect x="9" y="9" width="722" height="522" rx="8" fill="none" stroke="#ffffff" stroke-opacity=".15"/></svg>'),
        'cube':asset('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 54 54"><defs><linearGradient id="red" x2=".5" y2="1"><stop stop-color="#ec2720"/><stop offset="1" stop-color="#900707"/></linearGradient></defs><rect x="3" y="3" width="48" height="48" rx="7" fill="url(#red)" stroke="#680b06" stroke-width="3"/><path d="M9 8H45" stroke="#ff8f72" stroke-opacity=".6"/></svg>')}
    for value in range(7):
        for used in range(3):
            assets[f'die_{value}_used_{used}'] = asset(die_svg(value,used))
    return {'format':'buildplay-ui','version':1,'viewport':{'width':800,'height':600,'camera_enabled':False},
        'motion':{'move_ms':800,'roll_ms':500,'roll_settle_ms':1000,'turn_pause_ms':500,'animate_own':True,'easing':'ease-in-out-quad'},
        'assets':assets,
        'boards':[
            {'id':'felt','kind':'zone','x':0,'y':0,'width':800,'height':600,'color':'#075b05','line_color':'#075b05'},
            {'id':'main','kind':'graph','x':20,'y':105,'width':700,'height':440,
             'color':'#00000000','line_color':'#00000000','background_asset':'board_art',
             'cells':[{'id':str(point),'x':point_x(point),'y':237 if point<12 else 203,'color':'#00000000'} for point in range(24)]},
            {'id':'off','kind':'zone','x':720,'y':105,'width':64,'height':440,'color':'#57260e','line_color':'#57260e','background_asset':'tray'}],
        'piece_types':{
            'p0':{'action_outline':'ellipse','shape':'image','width':42,'height':42,'asset':'checker_red','text_color':'#ffffff'},
            'p1':{'action_outline':'ellipse','shape':'image','width':42,'height':42,'asset':'checker_ivory','text_color':'#301f0e'},
            'p0_off':{'action_outline':'none','shape':'image','width':44,'height':10,'asset':'off_red'},
            'p1_off':{'action_outline':'none','shape':'image','width':44,'height':10,'asset':'off_ivory'},
            'die':{'action_outline':'none','shape':'image','width':56,'height':56},
            'status':{'action_outline':'none','shape':'image','width':252,'height':54,'asset':'status'},
            'swatch_red':{'action_outline':'none','shape':'image','width':28,'height':28,'asset':'checker_red'},
            'swatch_ivory':{'action_outline':'none','shape':'image','width':28,'height':28,'asset':'checker_ivory'},
            'roll_button':{'font_size':24,'action_outline':'none','shape':'image','width':180,'height':54,'asset':'button','text_color':'#ffffff'},
            'tool_button':{'font_size':14,'action_outline':'none','shape':'image','width':78,'height':30,'asset':'button','text_color':'#ffffff'},
            'help_panel':{'action_outline':'none','shape':'image','width':620,'height':340,'asset':'help_panel'},
            'options_panel':{'action_outline':'none','shape':'image','width':740,'height':540,'asset':'options_panel'},
            'option_button':{'font_size':28,'action_outline':'none','shape':'image','width':62,'height':54,'asset':'button','text_color':'#ffffff'},
            'option_toggle':{'font_size':20,'action_outline':'none','shape':'image','width':90,'height':44,'asset':'button','text_color':'#ffffff'},
            'option_level':{'font_size':17,'action_outline':'none','shape':'image','width':95,'height':44,'asset':'button','text_color':'#ffffff'},
            'notice':{'font_size':20,'action_outline':'none','shape':'image','width':380,'height':60,'asset':'button','text_color':'#ffffff'},
            'cube':{'font_size':27,'action_outline':'none','shape':'image','width':46,'height':46,'asset':'cube','text_color':'#ffffff'}},
        'strings':strings(),'ui_code':'const SOURCE_STRINGS='+json.dumps(strings(),ensure_ascii=False)+';\n'+(DEST/'backgammon.ui.js').read_text()}


def illustration(view, caption):
    # Preview artifacts share gradients instead of embedding a complete checker
    # SVG thirty times. The playable package retains the detailed authored assets.
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 440">',
             '<rect width="700" height="440" rx="5" fill="#51230c"/>',
             '<rect x="16" y="16" width="640" height="408" fill="#dc9e47"/>',
             '<rect x="316" y="10" width="40" height="420" fill="#51230c"/>']
    for point in range(24):
        x = point_x(point)
        y, tip = (18, 179) if point >= 12 else (422, 261)
        color = '#63240e' if point % 2 else '#b56828'
        parts.append(f'<path d="M{x-24} {y}H{x+24}L{x} {tip}Z" fill="{color}"/>')
    parts.append('<defs>')
    for seat, light, color, edge in ((0, '#f35b41', '#bc1d0e', '#6c0d04'),
                                     (1, '#ffffff', '#eee8d5', '#b6a98c')):
        parts.append(f'<radialGradient id="preview_checker_{seat}" cx=".4" cy=".28" r=".75"><stop stop-color="{light}"/><stop offset=".65" stop-color="{color}"/><stop offset="1" stop-color="{edge}"/></radialGradient>')
    parts.append('</defs>')

    def disc(x, y, seat):
        parts.append(f'<circle cx="{x}" cy="{y}" r="19" fill="url(#preview_checker_{seat})" stroke="#301507"/><circle cx="{x}" cy="{y}" r="16" fill="none" stroke="{"#fb9a75" if seat == 0 else "#ffffff"}"/>')

    for point, count in enumerate(view['cnt']):
        for index in range(min(count, 5)):
            y = 32 + index * 31 if point >= 12 else 408 - index * 31
            disc(point_x(point), y, view['owner'][point])
    for seat in range(2):
        for i in range(min(view['bar'][seat], 5)):
            disc(336, 35 + i * 31 if seat == 0 else 405 - i * 31, seat)
    parts.append('</svg>')
    return {'caption': caption, 'svg': ''.join(parts)}


def package_with_fixtures():
    code = (ROOT / 'games/declarative/backgammon.server.js').read_text()
    if hashlib.sha256(code.encode()).hexdigest() != SOURCE_SHA256:
        raise RuntimeError('Ordinary Backgammon authority changed; audit source identity before rebuilding')
    code += '\n' + (DEST / 'backgammon-roll-history.js').read_text()
    code += '\n' + (DEST / 'backgammon-combined-moves.js').read_text()
    code += '\n' + (DEST / 'backgammon-opening-undo.js').read_text()
    schemas = source_schemas()
    logic = GameLogic(code, game_schemas=schemas)
    ctx = {'players': [{'id': 'u1', 'kind': 'human', 'display_name': 'Alice', 'picture_url': '', 'max_loss': 0, 'active': True},
                       {'id': 'u2', 'kind': 'human', 'display_name': 'Bob', 'picture_url': '', 'max_loss': 0, 'active': True}], 'pot': 0, 'move_count': 0}
    result = logic.call('newMatch', ctx=ctx, seed=7)
    steps = []
    for i in range(2000):
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
                     cur=0, dice=dice, moves=dice, needRoll=False, opening=False, configured=True,
                     opening_roll=None, undo_stack=[])
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
    payload = {'all_state_public': True,
            'name': TITLES[0] + ' (Declarative)', 'description': RULES[0], 'allowed_player_counts': [2],
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
