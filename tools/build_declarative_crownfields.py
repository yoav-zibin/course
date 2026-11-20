"""Build the declarative Crownfields package (based on Kingdomino).

Run from the package parent:
  python -m game_platform.tools.build_declarative_crownfields
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
KIND = 'crownfields'
LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
TITLES = ['Crownfields', 'Campos de Coronas', 'Champs Couronnés', 'Kronenfelder', 'Campos de Coroas', '王冠领地', 'मुकुट क्षेत्र', 'حقول التيجان']
RULES = [
    'Based on Kingdomino. 2 to 4 players each build a realm of two-square tiles around their keep. Each round, in the order of the "Now" row, you lay the tile your king stands on, then move your king to a tile in the "Next" row: the lower its number, the earlier you act next round. A tile must touch your keep or the same terrain with at least one half (side by side), and the realm, keep included, must fit in a 5×5 square. A tile that fits nowhere is discarded. With 2 players each has two kings and 24 tiles are used; with 3, 36; with 4, all 48. At the end, every group of joined squares of one terrain scores its size times its crowns. Highest total wins; ties go to the largest group, then the most crowns, then are shared.',
    'Basado en Kingdomino. De 2 a 4 jugadores construyen un reino de losetas de dos casillas alrededor de su torre. En cada ronda, en el orden de la fila «Ahora», colocas la loseta donde está tu rey y luego mueves tu rey a una loseta de la fila «Siguiente»: cuanto menor su número, antes actúas en la próxima ronda. Una loseta debe tocar tu torre o el mismo terreno con al menos una mitad (de lado), y el reino, torre incluida, debe caber en un cuadrado de 5×5. Una loseta que no cabe se descarta. Con 2 jugadores cada uno tiene dos reyes y se usan 24 losetas; con 3, 36; con 4, las 48. Al final, cada grupo de casillas unidas de un terreno puntúa su tamaño por sus coronas. Gana el total más alto; los empates los gana el grupo más grande, luego más coronas, y si no, se comparten.',
    'D’après Kingdomino. De 2 à 4 joueurs bâtissent un royaume de tuiles de deux cases autour de leur donjon. À chaque manche, dans l’ordre de la rangée « Maintenant », posez la tuile où se trouve votre roi, puis placez votre roi sur une tuile de la rangée « Suivante » : plus son numéro est bas, plus vous jouez tôt à la manche suivante. Une tuile doit toucher votre donjon ou le même terrain par au moins une moitié (côte à côte), et le royaume, donjon compris, doit tenir dans un carré de 5×5. Une tuile qui ne rentre nulle part est défaussée. À 2 joueurs, chacun a deux rois et on utilise 24 tuiles ; à 3, 36 ; à 4, les 48. À la fin, chaque groupe de cases reliées d’un même terrain rapporte sa taille fois ses couronnes. Le plus haut total gagne ; en cas d’égalité, le plus grand groupe, puis le plus de couronnes, sinon victoire partagée.',
    'Nach Kingdomino. 2 bis 4 Spieler bauen um ihren Bergfried ein Reich aus Plättchen mit zwei Feldern. In jeder Runde legst du in der Reihenfolge der Reihe „Jetzt“ das Plättchen, auf dem dein König steht, und setzt ihn dann auf ein Plättchen der Reihe „Nächste“: Je niedriger dessen Zahl, desto früher bist du in der nächsten Runde dran. Ein Plättchen muss mit mindestens einer Hälfte (seitlich) deinen Bergfried oder dasselbe Gelände berühren, und das Reich samt Bergfried muss in ein 5×5-Quadrat passen. Ein Plättchen, das nirgends passt, wird abgelegt. Zu zweit hat jeder zwei Könige und es gibt 24 Plättchen; zu dritt 36; zu viert alle 48. Am Ende zählt jede zusammenhängende Gruppe eines Geländes Größe mal Kronen. Die höchste Summe gewinnt; bei Gleichstand die größte Gruppe, dann die meisten Kronen, sonst geteilter Sieg.',
    'Baseado em Kingdomino. De 2 a 4 jogadores constroem um reino de peças de duas casas ao redor da sua torre. Em cada rodada, na ordem da fileira «Agora», coloque a peça onde está o seu rei e depois mova o seu rei para uma peça da fileira «Próxima»: quanto menor o número, mais cedo você joga na rodada seguinte. Uma peça deve tocar a sua torre ou o mesmo terreno com pelo menos uma metade (lado a lado), e o reino, com a torre, deve caber num quadrado de 5×5. Uma peça que não cabe em lugar nenhum é descartada. Com 2 jogadores cada um tem dois reis e usam-se 24 peças; com 3, 36; com 4, todas as 48. No fim, cada grupo de casas ligadas de um terreno vale o seu tamanho vezes as suas coroas. Vence o maior total; empates vão para o maior grupo, depois mais coroas, senão vitória dividida.',
    '改编自 Kingdomino（国王多米诺）。2 至 4 名玩家围绕自己的城堡用两格地块建造领地。每一轮按“本轮”一行的顺序，先放下你的国王所在的地块，再把国王移到“下一轮”一行的某块地块上：编号越小，下一轮越早行动。地块至少有一半必须（边对边）接触你的城堡或相同地形，整个领地（含城堡）必须放得进 5×5 的正方形。放不下的地块要弃掉。2 人时每人两个国王，使用 24 块；3 人用 36 块；4 人用全部 48 块。结束时，每个相连的同地形区域得分为格数乘以王冠数。总分最高者获胜；平分时比最大区域，再比王冠数，仍相同则共同获胜。',
    'किंगडोमिनो पर आधारित। 2 से 4 खिलाड़ी अपने क़िले के चारों ओर दो खानों वाली टाइलों से राज्य बनाते हैं। हर दौर में "अभी" पंक्ति के क्रम से, जिस टाइल पर आपका राजा है उसे रखें, फिर राजा को "अगली" पंक्ति की किसी टाइल पर ले जाएँ: जितनी छोटी संख्या, अगले दौर में उतनी जल्दी बारी। टाइल का कम से कम एक आधा भाग (बग़ल से) आपके क़िले या उसी भूभाग को छूना चाहिए, और क़िले सहित राज्य 5×5 के वर्ग में समाना चाहिए। जो टाइल कहीं न समाए, वह हटा दी जाती है। 2 खिलाड़ियों में हर एक के दो राजा और 24 टाइलें; 3 में 36; 4 में सभी 48। अंत में, एक भूभाग के जुड़े खानों का हर समूह आकार गुणा मुकुट अंक देता है। सबसे अधिक कुल जीतता है; बराबरी में सबसे बड़ा समूह, फिर सबसे ज़्यादा मुकुट, नहीं तो जीत साझा।',
    'مبنية على Kingdomino. من 2 إلى 4 لاعبين يبني كل منهم مملكة من بلاطات ذات مربعين حول حصنه. في كل جولة، وبترتيب صف «الآن»، تضع البلاطة التي يقف عليها ملكك، ثم تنقل ملكك إلى بلاطة في صف «التالي»: كلما صغر رقمها لعبت أبكر في الجولة التالية. يجب أن يلمس نصف واحد على الأقل من البلاطة (جانبًا لجانب) حصنك أو التضاريس نفسها، ويجب أن تتسع المملكة مع الحصن في مربع 5×5. البلاطة التي لا مكان لها تُستبعد. مع لاعبَين لكل منهما ملكان وتُستخدم 24 بلاطة؛ مع 3 تُستخدم 36؛ ومع 4 كل الـ48. في النهاية تسجل كل مجموعة متصلة من تضاريس واحدة حجمها مضروبًا في تيجانها. أعلى مجموع يفوز؛ وعند التعادل أكبر مجموعة ثم أكثر تيجانًا وإلا يُتقاسم الفوز.',
]
UI_RULES = [
    'Pick: tap a tile in the Next row, then tap it again or press Take tile. Lay: tap a glowing square for the tile’s first half, turn it with the ↺ ↻ buttons (or select it and press R / Shift+R) until its frame turns green, then press ✓ or Lay tile. Tap a name at the top to see that player’s realm.',
    'Elegir: toca una loseta de la fila Siguiente y tócala otra vez o pulsa Tomar loseta. Colocar: toca una casilla iluminada para la primera mitad, gírala con ↺ ↻ (o selecciónala y pulsa R / Mayús+R) hasta que su marco sea verde y toca la loseta o pulsa Colocar loseta. Toca un nombre arriba para ver ese reino.',
    'Choisir : touchez une tuile de la rangée Suivante, puis encore une fois ou Prendre la tuile. Poser : touchez une case lumineuse pour la première moitié, tournez avec ↺ ↻ (ou sélectionnez et appuyez sur R / Maj+R) jusqu’à ce que le cadre soit vert, puis touchez la tuile ou Poser la tuile. Touchez un nom en haut pour voir ce royaume.',
    'Wählen: Tippe auf ein Plättchen der Reihe Nächste und noch einmal oder auf Plättchen nehmen. Legen: Tippe auf ein leuchtendes Feld für die erste Hälfte, drehe mit ↺ ↻ (oder auswählen und R / Umschalt+R), bis der Rahmen grün ist, dann tippe auf das Plättchen oder Plättchen legen. Tippe oben auf einen Namen, um dieses Reich zu sehen.',
    'Escolher: toque numa peça da fileira Próxima e toque de novo ou pressione Pegar peça. Colocar: toque numa casa iluminada para a primeira metade, gire com ↺ ↻ (ou selecione e pressione R / Shift+R) até a moldura ficar verde e toque na peça ou pressione Colocar peça. Toque num nome no topo para ver esse reino.',
    '选择：点击“下一轮”一行的地块，再点一次或按“拿取地块”。放置：点击发光的格子放第一半，用 ↺ ↻ 旋转（或选中后按 R / Shift+R）直到边框变绿，再点地块或按“放置地块”。点击顶部的名字可查看该玩家的领地。',
    'चुनें: अगली पंक्ति की टाइल छुएँ, फिर दोबारा छुएँ या टाइल लें दबाएँ। रखें: पहले आधे के लिए चमकता खाना छुएँ, ↺ ↻ से घुमाएँ (या चुनकर R / Shift+R) जब तक फ़्रेम हरा न हो, फिर टाइल छुएँ या टाइल रखें दबाएँ। किसी का राज्य देखने के लिए ऊपर उसका नाम छुएँ।',
    'الاختيار: المس بلاطة في صف التالي ثم المسها مجددًا أو اضغط خذ البلاطة. الوضع: المس مربعًا مضيئًا للنصف الأول، وأدرها بـ ↺ ↻ (أو حددها واضغط R / Shift+R) حتى يصبح إطارها أخضر، ثم المس البلاطة أو اضغط ضع البلاطة. المس اسمًا في الأعلى لرؤية مملكة ذلك اللاعب.',
]
COLOR_KEYS = ['amber', 'jade', 'rose', 'sky']
COLOR_HEX = ['#ffb347', '#3fd6a0', '#ff6f91', '#5cc8ff']
TERRAINS = ['wheat', 'forest', 'lake', 'meadow', 'marsh', 'mine']
TEXTS = {
    'color_amber': ['Amber', 'Ámbar', 'Ambre', 'Bernstein', 'Âmbar', '琥珀', 'अंबर', 'كهرماني'],
    'color_jade': ['Jade', 'Jade', 'Jade', 'Jade', 'Jade', '翠玉', 'जेड', 'يشمي'],
    'color_rose': ['Rose', 'Rosa', 'Rose', 'Rosa', 'Rosa', '玫瑰', 'गुलाबी', 'وردي'],
    'color_sky': ['Sky', 'Cielo', 'Ciel', 'Himmel', 'Céu', '天蓝', 'आसमानी', 'سماوي'],
    'seat_name': ['{color} · {name}'] * 8,
    'player': ['Player {n}', 'Jugador {n}', 'Joueur {n}', 'Spieler {n}', 'Jogador {n}', '玩家{n}', 'खिलाड़ी {n}', 'اللاعب {n}'],
    'terrain_wheat': ['wheat', 'trigo', 'blé', 'Weizen', 'trigo', '麦田', 'गेहूँ', 'قمح'],
    'terrain_forest': ['forest', 'bosque', 'forêt', 'Wald', 'floresta', '森林', 'जंगल', 'غابة'],
    'terrain_lake': ['lake', 'lago', 'lac', 'See', 'lago', '湖泊', 'झील', 'بحيرة'],
    'terrain_meadow': ['meadow', 'pradera', 'prairie', 'Wiese', 'pradaria', '草地', 'घास', 'مرج'],
    'terrain_marsh': ['marsh', 'pantano', 'marais', 'Sumpf', 'pântano', '沼泽', 'दलदल', 'مستنقع'],
    'terrain_mine': ['mine', 'mina', 'mine', 'Mine', 'mina', '矿山', 'खान', 'منجم'],
    'row_now': ['Now', 'Ahora', 'Maintenant', 'Jetzt', 'Agora', '本轮', 'अभी', 'الآن'],
    'row_next': ['Next', 'Siguiente', 'Suivante', 'Nächste', 'Próxima', '下一轮', 'अगली', 'التالي'],
    'king_of': ['King of {name}', 'Rey de {name}', 'Roi de {name}', 'König von {name}', 'Rei de {name}', '{name}的国王', '{name} का राजा', 'ملك {name}'],
    'tile_label': ['Tile {n}: {a} and {b}', 'Loseta {n}: {a} y {b}', 'Tuile {n} : {a} et {b}', 'Plättchen {n}: {a} und {b}', 'Peça {n}: {a} e {b}', '地块{n}：{a}和{b}', 'टाइल {n}: {a} और {b}', 'البلاطة {n}: {a} و{b}'],
    'take_label': ['Choose tile {n}', 'Elegir la loseta {n}', 'Choisir la tuile {n}', 'Plättchen {n} wählen', 'Escolher a peça {n}', '选择地块{n}', 'टाइल {n} चुनें', 'اختر البلاطة {n}'],
    'your_choice': ['Your choice', 'Tu elección', 'Votre choix', 'Deine Wahl', 'Sua escolha', '你的选择', 'आपकी पसंद', 'اختيارك'],
    'take_button': ['Take tile {n}', 'Tomar loseta {n}', 'Prendre la tuile {n}', 'Plättchen {n} nehmen', 'Pegar peça {n}', '拿取地块{n}', 'टाइल {n} लें', 'خذ البلاطة {n}'],
    'keep_of': ['Keep of {name}', 'Torre de {name}', 'Donjon de {name}', 'Bergfried von {name}', 'Torre de {name}', '{name}的城堡', '{name} का क़िला', 'حصن {name}'],
    'laid_label': ['Tile {n}', 'Loseta {n}', 'Tuile {n}', 'Plättchen {n}', 'Peça {n}', '地块{n}', 'टाइल {n}', 'البلاطة {n}'],
    'square_label': ['Start the tile here ({where} from the keep)', 'Empezar la loseta aquí ({where} de la torre)', 'Commencer la tuile ici ({where} du donjon)', 'Plättchen hier beginnen ({where} vom Bergfried)', 'Começar a peça aqui ({where} da torre)', '从这里开始放（距城堡 {where}）', 'टाइल यहाँ से शुरू करें (क़िले से {where})', 'ابدأ البلاطة هنا ({where} من الحصن)'],
    'ghost_label': ['Tile {n}, being placed', 'Loseta {n}, colocándose', 'Tuile {n}, en cours de pose', 'Plättchen {n}, wird gelegt', 'Peça {n}, sendo colocada', '正在放置地块{n}', 'टाइल {n} रखी जा रही है', 'البلاطة {n} قيد الوضع'],
    'ghost_ok': ['Tile {n} fits here', 'La loseta {n} cabe aquí', 'La tuile {n} va ici', 'Plättchen {n} passt hier', 'A peça {n} cabe aqui', '地块{n}可以放这里', 'टाइल {n} यहाँ फ़िट है', 'البلاطة {n} تناسب هنا'],
    'ghost_bad': ['Tile {n} does not fit this way', 'La loseta {n} no cabe así', 'La tuile {n} ne va pas ainsi', 'Plättchen {n} passt so nicht', 'A peça {n} não cabe assim', '地块{n}这样放不下', 'टाइल {n} ऐसे फ़िट नहीं', 'البلاطة {n} لا تناسب هكذا'],
    'lay_here': ['Lay tile {n} here', 'Colocar la loseta {n} aquí', 'Poser la tuile {n} ici', 'Plättchen {n} hier legen', 'Colocar a peça {n} aqui', '把地块{n}放在这里', 'टाइल {n} यहाँ रखें', 'ضع البلاطة {n} هنا'],
    'lay_button': ['Lay tile', 'Colocar loseta', 'Poser la tuile', 'Plättchen legen', 'Colocar peça', '放置地块', 'टाइल रखें', 'ضع البلاطة'],
    'discard_button': ['Discard tile', 'Descartar loseta', 'Défausser la tuile', 'Plättchen ablegen', 'Descartar peça', '弃掉地块', 'टाइल हटाएँ', 'استبعد البلاطة'],
    'rotate_cw': ['Turn tile clockwise', 'Girar loseta en sentido horario', 'Tourner la tuile dans le sens horaire', 'Plättchen im Uhrzeigersinn drehen', 'Girar peça no sentido horário', '顺时针旋转地块', 'टाइल घड़ी की दिशा में घुमाएँ', 'أدر البلاطة باتجاه عقارب الساعة'],
    'rotate_ccw': ['Turn tile counterclockwise', 'Girar loseta en sentido antihorario', 'Tourner la tuile dans le sens antihoraire', 'Plättchen gegen den Uhrzeigersinn drehen', 'Girar peça no sentido anti-horário', '逆时针旋转地块', 'टाइल घड़ी की उल्टी दिशा में घुमाएँ', 'أدر البلاطة عكس عقارب الساعة'],
    'show_realm': ['Show the realm of {name}', 'Ver el reino de {name}', 'Voir le royaume de {name}', 'Reich von {name} zeigen', 'Ver o reino de {name}', '查看{name}的领地', '{name} का राज्य देखें', 'اعرض مملكة {name}'],
    'wins': ['{name} wins with {score}!', '¡Gana {name} con {score}!', '{name} gagne avec {score} !', '{name} gewinnt mit {score}!', '{name} venceu com {score}!', '{name}以{score}分获胜！', '{name} {score} अंकों से जीते!', 'فاز {name} بـ{score}!'],
    'tie': ['Shared win: {names}', 'Victoria compartida: {names}', 'Victoire partagée : {names}', 'Geteilter Sieg: {names}', 'Vitória dividida: {names}', '共同获胜：{names}', 'साझा जीत: {names}', 'فوز مشترك: {names}'],
    'pick_turn': ['{name}: choose a tile', '{name}: elige una loseta', '{name} : choisissez une tuile', '{name}: wähle ein Plättchen', '{name}: escolha uma peça', '{name}：选择地块', '{name}: टाइल चुनें', '{name}: اختر بلاطة'],
    'lay_turn': ['{name}: lay your tile', '{name}: coloca tu loseta', '{name} : posez votre tuile', '{name}: lege dein Plättchen', '{name}: coloque sua peça', '{name}：放置你的地块', '{name}: अपनी टाइल रखें', '{name}: ضع بلاطتك'],
    'waiting_pick': ['{name} is choosing a tile', '{name} está eligiendo', '{name} choisit une tuile', '{name} wählt ein Plättchen', '{name} está escolhendo', '{name}正在选择地块', '{name} टाइल चुन रहे हैं', '{name} يختار بلاطة'],
    'waiting_lay': ['{name} is laying a tile', '{name} está colocando', '{name} pose une tuile', '{name} legt ein Plättchen', '{name} está colocando', '{name}正在放置地块', '{name} टाइल रख रहे हैं', '{name} يضع بلاطة'],
    'hint_pick': ['Tap a tile in the Next row: lower numbers play earlier', 'Toca una loseta de Siguiente: los números bajos juegan antes', 'Touchez une tuile Suivante : les petits numéros jouent avant', 'Tippe auf ein Plättchen bei Nächste: kleine Zahlen sind früher dran', 'Toque numa peça da Próxima: números baixos jogam antes', '点击“下一轮”的地块：编号小的先行动', 'अगली पंक्ति की टाइल छुएँ: छोटी संख्या पहले खेलती है', 'المس بلاطة في التالي: الأرقام الصغيرة تلعب أولًا'],
    'hint_take': ['Tap it again, or Take tile', 'Tócala otra vez, o Tomar loseta', 'Touchez-la encore, ou Prendre la tuile', 'Noch einmal tippen oder Plättchen nehmen', 'Toque de novo, ou Pegar peça', '再点一次，或按“拿取地块”', 'दोबारा छुएँ, या टाइल लें', 'المسها مجددًا أو خذ البلاطة'],
    'hint_square': ['Tap a glowing square for the first half', 'Toca una casilla iluminada para la primera mitad', 'Touchez une case lumineuse pour la première moitié', 'Tippe auf ein leuchtendes Feld für die erste Hälfte', 'Toque numa casa iluminada para a primeira metade', '点击发光的格子放第一半', 'पहले आधे के लिए चमकता खाना छुएँ', 'المس مربعًا مضيئًا للنصف الأول'],
    'hint_lay': ['Green frame: press ✓ or Lay tile', 'Marco verde: pulsa ✓ o Colocar loseta', 'Cadre vert : appuyez sur ✓ ou Poser la tuile', 'Grüner Rahmen: ✓ oder Plättchen legen', 'Moldura verde: pressione ✓ ou Colocar peça', '绿框：按 ✓ 或“放置地块”', 'हरा फ़्रेम: ✓ या टाइल रखें दबाएँ', 'إطار أخضر: اضغط ✓ أو ضع البلاطة'],
    'hint_turn': ['Red frame: turn it with ↺ ↻ or pick another square', 'Marco rojo: gírala con ↺ ↻ o elige otra casilla', 'Cadre rouge : tournez avec ↺ ↻ ou changez de case', 'Roter Rahmen: mit ↺ ↻ drehen oder anderes Feld', 'Moldura vermelha: gire com ↺ ↻ ou escolha outra casa', '红框：用 ↺ ↻ 旋转或换个格子', 'लाल फ़्रेम: ↺ ↻ से घुमाएँ या दूसरा खाना चुनें', 'إطار أحمر: أدرها بـ ↺ ↻ أو اختر مربعًا آخر'],
    'hint_discard': ['This tile fits nowhere: discard it', 'Esta loseta no cabe: descártala', 'Cette tuile ne va nulle part : défaussez-la', 'Dieses Plättchen passt nirgends: ablegen', 'Esta peça não cabe: descarte-a', '这块地块无处可放：弃掉它', 'यह टाइल कहीं फ़िट नहीं: हटाएँ', 'هذه البلاطة لا تناسب أي مكان: استبعدها'],
    'hint_over': ['Each group scores its size × its crowns', 'Cada grupo puntúa tamaño × coronas', 'Chaque groupe vaut taille × couronnes', 'Jede Gruppe zählt Größe × Kronen', 'Cada grupo vale tamanho × coroas', '每个区域得分为格数×王冠', 'हर समूह: आकार × मुकुट', 'كل مجموعة: الحجم × التيجان'],
    'pile': ['Round {round} · {count} tiles left', 'Ronda {round} · quedan {count}', 'Manche {round} · {count} tuiles', 'Runde {round} · noch {count}', 'Rodada {round} · restam {count}', '第{round}轮 · 剩余{count}块', 'दौर {round} · {count} टाइलें बचीं', 'الجولة {round} · بقي {count}'],
    'square_of': ['{terrain} square, {crowns} crowns', 'Casilla de {terrain}, {crowns} coronas', 'Case {terrain}, {crowns} couronnes', '{terrain}-Feld, {crowns} Kronen', 'Casa de {terrain}, {crowns} coroas', '{terrain}格，{crowns}顶王冠', '{terrain} खाना, {crowns} मुकुट', 'مربع {terrain}، {crowns} تيجان'],
    'realm_of': ['Realm of {name}', 'Reino de {name}', 'Royaume de {name}', 'Reich von {name}', 'Reino de {name}', '{name}的领地', '{name} का राज्य', 'مملكة {name}'],
    'more_groups': ['+{count} more groups', '+{count} grupos más', '+{count} autres groupes', '+{count} weitere Gruppen', '+{count} grupos a mais', '另有{count}个区域', '+{count} और समूह', '+{count} مجموعات أخرى'],
    'total': ['Total {score}', 'Total {score}', 'Total {score}', 'Summe {score}', 'Total {score}', '总分 {score}', 'कुल {score}', 'المجموع {score}'],
    'discarded': ['{count} discarded', '{count} descartadas', '{count} défaussées', '{count} abgelegt', '{count} descartadas', '弃掉{count}块', '{count} हटाई गईं', '{count} مستبعدة'],
    'server_player_count': ['two to four players', 'de dos a cuatro jugadores', 'de deux à quatre joueurs', 'zwei bis vier Spieler', 'de dois a quatro jogadores', '需要二至四名玩家', 'दो से चार खिलाड़ी', 'من لاعبَين إلى أربعة'],
    'server_unknown_player': ['unknown player', 'jugador desconocido', 'joueur inconnu', 'unbekannter Spieler', 'jogador desconhecido', '未知玩家', 'अज्ञात खिलाड़ी', 'لاعب غير معروف'],
    'server_game_over': ['game over', 'partida terminada', 'partie terminée', 'Spiel beendet', 'jogo encerrado', '游戏结束', 'खेल समाप्त', 'انتهت اللعبة'],
    'server_not_your_turn': ['not your turn', 'no es tu turno', 'ce n’est pas votre tour', 'du bist nicht dran', 'não é sua vez', '未轮到你', 'आपकी बारी नहीं', 'ليس دورك'],
    'server_choose_new': ['choose a tile from the new row', 'elige una loseta de la fila nueva', 'choisissez une tuile de la nouvelle rangée', 'wähle ein Plättchen aus der neuen Reihe', 'escolha uma peça da nova fileira', '请从新一行选择地块', 'नई पंक्ति से टाइल चुनें', 'اختر بلاطة من الصف الجديد'],
    'server_chosen': ['that tile is already chosen', 'esa loseta ya está elegida', 'cette tuile est déjà prise', 'dieses Plättchen ist schon gewählt', 'essa peça já foi escolhida', '该地块已被选择', 'वह टाइल पहले से चुनी गई है', 'هذه البلاطة مختارة بالفعل'],
    'server_must_lay': ['this tile fits: you must lay it', 'esta loseta cabe: debes colocarla', 'cette tuile rentre : vous devez la poser', 'dieses Plättchen passt: du musst es legen', 'esta peça cabe: você deve colocá-la', '这块地块放得下：必须放置', 'यह टाइल फ़िट है: इसे रखना होगा', 'هذه البلاطة تناسب: يجب وضعها'],
    'server_where': ['choose where to lay the tile', 'elige dónde colocar la loseta', 'choisissez où poser la tuile', 'wähle, wo das Plättchen hin soll', 'escolha onde colocar a peça', '请选择放置位置', 'टाइल कहाँ रखनी है चुनें', 'اختر مكان البلاطة'],
    'server_cannot': ['the tile cannot go there', 'la loseta no puede ir ahí', 'la tuile ne peut pas aller là', 'das Plättchen passt dort nicht', 'a peça não pode ir aí', '地块不能放在那里', 'टाइल वहाँ नहीं जा सकती', 'لا يمكن وضع البلاطة هناك'],
}


def strings(index=0):
    return {'title': TITLES[index], **{key: values[index] for key, values in TEXTS.items()}}


TILE = {'type': 'object', 'additionalProperties': False, 'required': ['n', 'king'],
        'properties': {'n': {'type': 'integer', 'minimum': 1, 'maximum': 48}, 'king': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 3}}}
# Realm squares are not checked one by one: 81 per realm on every call made
# the checks dominate test time. The rules keep squares valid.
LAID = {'type': 'object', 'additionalProperties': False, 'required': ['n', 'cell', 'dir'],
        'properties': {'n': {'type': 'integer', 'minimum': 1, 'maximum': 48}, 'cell': {'type': 'integer', 'minimum': 0, 'maximum': 80},
                       'dir': {'type': 'integer', 'minimum': 0, 'maximum': 3}}}
COMMON = {
    'phase': {'enum': ['setup', 'play', 'over']},
    'kings': {'type': 'array', 'minItems': 3, 'maxItems': 4, 'items': {'type': 'integer', 'minimum': 0, 'maximum': 3}},
    'grids': {'type': 'array', 'minItems': 2, 'maxItems': 4, 'items': {'type': 'array', 'minItems': 81, 'maxItems': 81}},
    'laid': {'type': 'array', 'minItems': 2, 'maxItems': 4, 'items': {'type': 'array', 'maxItems': 24, 'items': LAID}},
    'discards': {'type': 'array', 'items': {'type': 'integer', 'minimum': 0}},
    'row': {'type': 'array', 'maxItems': 4, 'items': TILE},
    'next': {'type': 'array', 'maxItems': 4, 'items': TILE},
    'setup_index': {'type': 'integer', 'minimum': 0},
    'pos': {'type': 'integer', 'minimum': 0},
    'king': {'type': 'integer', 'minimum': 0, 'maximum': 3},
    'stage': {'enum': ['pick', 'place', None]},
    'round': {'type': 'integer', 'minimum': 0},
    'scores': {'type': ['array', 'null'], 'items': {'type': 'integer'}},
    'winners': {'type': ['array', 'null'], 'items': {'type': 'integer', 'minimum': 0, 'maximum': 3}},
    'last': {'type': ['object', 'null']},
}
SCHEMAS = {
    'state': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'additionalProperties': False,
              'required': list(COMMON) + ['pile', 'setup_order'],
              'properties': {**COMMON, 'pile': {'type': 'array', 'maxItems': 48, 'items': {'type': 'integer', 'minimum': 1, 'maximum': 48}},
                             'setup_order': {'type': 'array', 'items': {'type': 'integer', 'minimum': 0, 'maximum': 3}}}},
    'move': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'oneOf': [
        {'type': 'object', 'additionalProperties': False, 'required': ['pick'], 'properties': {'pick': {'type': 'integer', 'minimum': 0, 'maximum': 3}}},
        {'type': 'object', 'additionalProperties': False, 'required': ['cell', 'dir'],
         'properties': {'cell': {'type': 'integer', 'minimum': 0, 'maximum': 80}, 'dir': {'type': 'integer', 'minimum': 0, 'maximum': 3}}},
        {'type': 'object', 'additionalProperties': False, 'required': ['discard'], 'properties': {'discard': {'const': True}}}]},
    'view': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'additionalProperties': False,
             'required': list(COMMON) + ['pile', 'me', 'live_scores', 'winner'],
             'properties': {**COMMON, 'pile': {'type': 'integer', 'minimum': 0, 'maximum': 48}, 'me': {'type': 'integer', 'minimum': -1, 'maximum': 3},
                            'live_scores': {'type': 'array', 'items': {'type': 'integer', 'minimum': 0}},
                            'winner': {'type': ['integer', 'null'], 'minimum': -1, 'maximum': 3}}},
}


def schemas():
    return copy.deepcopy(SCHEMAS)


# ---- tiles (the same table as the server, read from it) ---------------------
def tiles():
    code = (DEST / f'{KIND}.server.js').read_text()
    table = code[code.index('var CF_TILES = [') + len('var CF_TILES = '):code.index('];', code.index('var CF_TILES')) + 1]
    return json.loads(table)


SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="{0}">'
TERRAIN_FILL = ['#e9c46a', '#2f6f50', '#3a86c8', '#8fd694', '#7f8c5a', '#7a7f87']


def terrain_art(t, x0):
    """One 60×60 square of terrain, drawn at x offset x0, without ids."""
    base = f'<rect x="{x0 + 1}" y="1" width="58" height="58" rx="5" fill="{TERRAIN_FILL[t]}"/>'
    X = lambda v: x0 + v
    if t == 0:    # wheat: stalks
        art = ''.join(f'<path d="M{X(12 + 9 * i)} 52v-24m0 0l-4-6m4 6l4-6m-4 2l-3-5m3 5l3-5" stroke="#b6862c" stroke-width="2" fill="none" stroke-linecap="round"/>' for i in range(5))
    elif t == 1:  # forest: pines
        art = ''.join(f'<path d="M{X(cx)} {cy - 16}l9 16h-5l7 12h-22l7-12h-5z" fill="{c}"/><rect x="{X(cx) - 2}" y="{cy + 12}" width="4" height="5" fill="#5a3a1e"/>'
                      for cx, cy, c in [(18, 26, '#1b4332'), (40, 22, '#52b788'), (30, 38, '#245c40')])
    elif t == 2:  # lake: waves
        art = ''.join(f'<path d="M{X(8)} {y}q6-5 11 0t11 0t11 0t11 0" stroke="#d6efff" stroke-width="2.4" fill="none" stroke-linecap="round"/>' for y in (22, 34, 46))
    elif t == 3:  # meadow: tufts and a flower
        art = ''.join(f'<path d="M{X(x)} {y}l-4-9m4 9l0-11m0 11l4-9" stroke="#3f8f52" stroke-width="2" fill="none" stroke-linecap="round"/>'
                      for x, y in [(14, 50), (32, 40), (48, 52), (22, 28)]) + f'<circle cx="{X(44)}" cy="26" r="3.5" fill="#fff3b0"/>'
    elif t == 4:  # marsh: reeds and a pool
        art = (f'<ellipse cx="{X(32)}" cy="44" rx="20" ry="7" fill="#56663b"/>' +
               ''.join(f'<path d="M{X(x)} 46v-26" stroke="#3e4a28" stroke-width="2.4"/><ellipse cx="{X(x)}" cy="22" rx="2.6" ry="6" fill="#6b4a2b"/>' for x in (18, 30, 44)))
    else:         # mine: peak with a lantern-lit entrance
        art = (f'<path d="M{X(6)} 54l20-36l9 14l6-8l13 30z" fill="#4a4e55"/><path d="M{X(26)} 18l5 9l-3 3l-4-4z" fill="#e8ecef"/>'
               f'<path d="M{X(22)} 54v-9a6 6 0 0 1 12 0v9z" fill="#1d1f23"/><circle cx="{X(28)}" cy="47" r="2.4" fill="#ffcf5a"/>')
    return base + art


def crowns_art(count, x0):
    out = ''
    for i in range(count):
        x = x0 + 6 + i * 16
        out += (f'<path d="M{x} 15l2-9l4 5l3-7l3 7l4-5l2 9z" fill="#ffd23f" stroke="#5c4300" stroke-width="1.4" stroke-linejoin="round"/>')
    return out


def tile_svg(number, halves):
    parts = [SVG.format('0 0 120 60'), '<rect width="120" height="60" rx="6" fill="#2b2118"/>']
    for h, (terrain, crowns) in enumerate(halves):
        parts.append(terrain_art(terrain, h * 60))
        parts.append(crowns_art(crowns, h * 60))
    parts.append(f'<text x="114" y="56" font-size="10" font-family="sans-serif" text-anchor="end" fill="#1d1d1d" fill-opacity=".55">{number}</text></svg>')
    return ''.join(parts)


def square_svg(terrain, crowns):
    """One upright square of terrain with its crowns (crowns never turn)."""
    return SVG.format('0 0 60 60') + terrain_art(terrain, 0) + crowns_art(crowns, 0) + '</svg>'


GRID = (SVG.format('0 0 450 450') + '<rect width="450" height="450" rx="6" fill="#24331f"/>' +
        ''.join(f'<rect x="{c * 50 + 1}" y="{r * 50 + 1}" width="48" height="48" rx="4" fill="{"#283823" if (r + c) % 2 else "#2c3d26"}"/>'
                for r in range(9) for c in range(9)) + '</svg>')
END_FRAME = (SVG.format('0 0 256 256') + '<rect x="1" y="1" width="254" height="254" rx="10" fill="#24331f" stroke="#3b5574" stroke-width="2"/></svg>')
LAY_OK = (SVG.format('0 0 72 72') + '<circle cx="36" cy="36" r="33" fill="#2f6b3a" stroke="#9dff9f" stroke-width="3"/>'
          '<path d="M21 37l10 10l20-22" fill="none" stroke="#eaffea" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>')


def keep_svg(color):
    return (SVG.format('0 0 60 60') + '<rect x="1" y="1" width="58" height="58" rx="5" fill="#d9cdb4"/>'
            f'<path d="M14 50v-26h6v-6h6v6h8v-6h6v6h6v26z" fill="#8c7b62" stroke="#5c4f3d" stroke-width="2"/>'
            f'<path d="M26 50v-10a4 4 0 0 1 8 0v10z" fill="#3b3226"/><path d="M30 18v-12l10 4l-10 4" fill="{color}" stroke="#3b3226" stroke-width="1.2"/></svg>')


def king_svg(color):
    return (SVG.format('0 0 40 40') + f'<circle cx="20" cy="22" r="17" fill="#000" fill-opacity=".25"/>'
            f'<path d="M8 30l2-16l6 6l4-10l4 10l6-6l2 16z" fill="{color}" stroke="#2b2118" stroke-width="2" stroke-linejoin="round"/>'
            '<rect x="8" y="29" width="24" height="5" rx="2" fill="#2b2118"/></svg>')


def arrow_svg(clockwise):
    cx = cy = 32
    r = 15
    m = 1 if clockwise else -1
    start = (cx - m * r, cy)
    theta = math.radians(45)
    end = (cx + m * r * math.cos(theta), cy + r * math.sin(theta))
    direction = (-m * math.sin(theta), math.cos(theta))
    perp = (direction[1], -direction[0])
    tip = (end[0] + direction[0] * 8, end[1] + direction[1] * 8)
    left = (end[0] + perp[0] * 7, end[1] + perp[1] * 7)
    right = (end[0] - perp[0] * 7, end[1] - perp[1] * 7)
    f = lambda pt: f'{pt[0]:.1f} {pt[1]:.1f}'
    return (SVG.format('0 0 64 64') + '<circle cx="32" cy="32" r="29" fill="#2c3e57" stroke="#ffd98a" stroke-width="3"/>'
            f'<path d="M{f(start)}A{r} {r} 0 1 {1 if clockwise else 0} {f(end)}" fill="none" stroke="#ffe9b0" stroke-width="5" stroke-linecap="round"/>'
            f'<path d="M{f(tip)}L{f(left)}L{f(right)}Z" fill="#ffe9b0"/></svg>')


def frame_svg(color, width=4, dash=''):
    return (SVG.format('0 0 120 60') + f'<rect x="2" y="2" width="116" height="56" rx="7" fill="none" stroke="{color}" stroke-width="{width}"{dash}/></svg>')


PICK = (SVG.format('0 0 116 62') + '<rect x="2" y="2" width="112" height="58" rx="8" fill="#ffd98a" fill-opacity=".12" stroke="#ffd98a" stroke-width="3" stroke-dasharray="9 6"/></svg>')
PICK_ON = (SVG.format('0 0 116 62') + '<rect x="2" y="2" width="112" height="58" rx="8" fill="#ffd98a" fill-opacity=".28" stroke="#fff1c4" stroke-width="5"/></svg>')
SPOT = (SVG.format('0 0 60 60') + '<rect x="6" y="6" width="48" height="48" rx="8" fill="#ffd98a" fill-opacity=".18" stroke="#ffd98a" stroke-width="3" stroke-dasharray="7 5"/></svg>')
CLEAR = SVG.format('0 0 10 10') + '<rect width="10" height="10" fill="#ffffff" fill-opacity=".01"/></svg>'
TAB = (SVG.format('0 0 124 44') + '<rect x="2" y="2" width="120" height="40" rx="10" fill="#1d2a3d" stroke="#3b5574" stroke-width="2"/></svg>')
TAB_ON = (SVG.format('0 0 124 44') + '<rect x="2" y="2" width="120" height="40" rx="10" fill="#2a3d58" stroke="#ffd98a" stroke-width="3"/></svg>')


def uri(svg):
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


def asset(svg):
    return {'uri': uri(svg), 'media_type': 'image/svg+xml'}


def specification():
    table = tiles()
    assets = {f'tile_{i + 1}': asset(tile_svg(i + 1, halves)) for i, halves in enumerate(table)}
    for key, color in zip(COLOR_KEYS, COLOR_HEX):
        assets[f'keep_{key}'] = asset(keep_svg(color))
        assets[f'king_{key}'] = asset(king_svg(color))
    for terrain, top in enumerate([1, 1, 1, 2, 2, 3]):
        for crowns in range(top + 1):
            assets[f'sq_{terrain}_{crowns}'] = asset(square_svg(terrain, crowns))
    assets.update({'grid': asset(GRID), 'endframe': asset(END_FRAME), 'lay_ok': asset(LAY_OK)})
    assets.update({'pick': asset(PICK), 'pick_on': asset(PICK_ON), 'spot': asset(SPOT),
                   'fit_ok': asset(frame_svg('#7dff8a', 5)), 'fit_bad': asset(frame_svg('#ff5d5d', 5, ' stroke-dasharray="10 6"')),
                   'rot_cw': asset(arrow_svg(True)), 'rot_ccw': asset(arrow_svg(False)), 'tab': asset(TAB), 'tab_on': asset(TAB_ON)})
    server = (DEST / f'{KIND}.server.js').read_text()
    shared = server[server.index('// ---- shared geometry'):server.index('// ---- end shared geometry ----')]
    return {'format': 'buildplay-ui', 'version': 1, 'viewport': {'width': 600, 'height': 790},
            'motion': {'move_ms': 700, 'turn_pause_ms': 450},
            'assets': assets,
            # Two areas only: the header and one stage; the presentation lays
            # out the draft, realm and toolbar (or the end screen) without overlap.
            'boards': [
                {'id': 'hud', 'kind': 'zone', 'x': 0, 'y': 0, 'width': 600, 'height': 112, 'color': '#16202e', 'line_color': '#16202e'},
                {'id': 'stage', 'kind': 'zone', 'x': 0, 'y': 112, 'width': 600, 'height': 678, 'color': '#1b2619', 'line_color': '#1b2619'}],
            'piece_types': {
                'tile': {'shape': 'image', 'width': 98, 'height': 48, 'asset': 'tile_1', 'action_outline': 'rect'},
                'square': {'shape': 'image', 'width': 48, 'height': 48, 'asset': 'keep_amber'},
                'frame': {'shape': 'image', 'width': 100, 'height': 50, 'asset': 'fit_ok'},
                'grid': {'shape': 'image', 'width': 450, 'height': 450, 'asset': 'grid'},
                'endframe': {'shape': 'image', 'width': 256, 'height': 256, 'asset': 'endframe'},
                'king': {'shape': 'image', 'width': 34, 'height': 34, 'asset': 'king_amber'}},
            'strings': strings(),
            'ui_code': 'const SOURCE_STRINGS=' + json.dumps(strings(), ensure_ascii=False) + ';\n' + shared + '\n' +
                       (DEST / f'{KIND}.ui.js').read_text()}


# ---- unit test cases ----------------------------------------------------------
def illustration(view, caption):
    """A small static picture of every realm: terrain squares and crowns."""
    n = len(view['grids'])
    width = 20 + n * 200
    parts = [SVG.format(f'0 0 {width} 220'), f'<rect width="{width}" height="220" fill="#16202e"/>']
    for seat, grid in enumerate(view['grids']):
        ox = 20 + seat * 200
        parts.append(f'<rect x="{ox - 4}" y="16" width="188" height="188" rx="6" fill="#24331f"/>')
        for cell, square in enumerate(grid):
            if not square:
                continue
            x, y = ox + (cell % 9) * 20, 20 + (cell // 9) * 20
            color = '#d9cdb4' if square[0] == 6 else TERRAIN_FILL[square[0]]
            parts.append(f'<rect x="{x}" y="{y}" width="19" height="19" fill="{color}"/>')
            for i in range(square[1]):
                parts.append(f'<circle cx="{x + 4 + i * 5}" cy="{y + 4}" r="2" fill="#ffd23f"/>')
        parts.append(f'<rect x="{ox - 4}" y="6" width="22" height="8" rx="3" fill="{COLOR_HEX[seat]}"/>')
    parts.append('</svg>')
    return {'caption': caption, 'svg': ''.join(parts)}


def players(n):
    return [{'id': f'u{i + 1}', 'kind': 'human', 'display_name': name, 'picture_url': '', 'max_loss': 0, 'active': True}
            for i, name in enumerate(['Alice', 'Bob', 'Chen', 'Dara'][:n])]


def play(logic, n, seed, chooser='computerMove'):
    ctx = {'players': players(n), 'pot': 0, 'move_count': 0}
    result = logic.call('newMatch', ctx=ctx, seed=seed)
    steps = []
    for i in range(200):
        ctx['move_count'] = i
        state, pid, s = result['state'], result['turn'][0], seed * 1000 + i
        move = logic.call(chooser, state, pid, ctx=ctx, seed=s)
        result = logic.call('applyMove', state, pid, move, ctx=ctx, seed=s)
        steps.append((copy.deepcopy(ctx), state, pid, move, result, s))
        if result['turn'] is None:
            return steps
    raise RuntimeError('Crownfields did not finish')


def package():
    code = (DEST / f'{KIND}.server.js').read_text()
    game_schemas = schemas()
    logic = GameLogic(code, game_schemas=game_schemas)
    steps = play(logic, 2, 7)
    lay = next(step for step in steps[len(steps) // 2:] if 'cell' in step[3])
    selected = [('initial', 'Kings choose from the first row', steps[0]),
                ('intermediate', 'Laying a tile next to the same terrain', lay),
                ('terminal', 'Final scores: size times crowns', steps[-1])]
    discard = None
    for seed in range(1, 200):
        for step in play(logic, 3, seed, 'randomMove'):
            if step[3].get('discard'):
                discard = step
                break
        if discard:
            break
    if not discard:
        raise RuntimeError('no discard found')
    selected.append(('intermediate', 'A tile that fits nowhere is discarded', discard))
    cases = []
    for kind, label, (cctx, state, pid, move, after, seed) in selected:
        other = next(p['id'] for p in cctx['players'] if p['id'] != pid)
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
    final = cases[2]['images'][2]['svg'].removeprefix(SVG.format('0 0 420 220')).removesuffix('</svg>')
    cover = (SVG.format('0 0 800 450') + '<rect width="800" height="450" fill="#16202e"/>'
             f'<g transform="translate(85 15) scale(1.5)">{final}</g></svg>')
    return {'name': TITLES[0], 'description': RULES[0], 'allowed_player_counts': [2, 3, 4], 'all_state_public': False,
            'server_code': code, 'declarative_ui': specification(),
            'game_addition_request_id_and_secret': f'example-only-declarative-{KIND}-replace-before-publishing',
            'rules': RULES[0], 'ui_instructions': UI_RULES[0],
            'tutorial': {'text': RULES[0], 'html': '<meta name="viewport" content="width=device-width,initial-scale=1"><p>' + html.escape(RULES[0]) + '</p>'},
            'images': [{'caption': 'Cover', 'svg': cover}, cases[1]['images'][0], cases[1]['images'][2], {**cases[2]['images'][2], 'caption': 'Final realms'}],
            'unit_tests': {**{key + '_schema': value for key, value in game_schemas.items()}, 'cases': cases},
            'translations': {locale: {'display_name': TITLES[i], 'short_description': RULES[i],
                                      'game_logic_rules': RULES[i], 'game_ui_rules': UI_RULES[i],
                                      'tutorial_strings': {RULES[0]: RULES[i]}, 'client_strings': strings(i)}
                             for i, locale in enumerate(LOCALES) if i}}


def main(target=None):
    payload = package()
    target = Path(target) if target else DEST / f'{KIND}.json'
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    print(f'{target.name}: {len(json.dumps(payload).encode())} bytes')


if __name__ == '__main__':
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else None)
