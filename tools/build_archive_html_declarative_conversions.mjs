#!/usr/bin/env node
// Build declarative presentations from the tracked archived game packages.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'games', 'declarative');
const UI = fs.readFileSync(path.join(OUT, 'archive_conversions_ui.js'), 'utf8').replace(/\r\n?/g, '\n');
const require = createRequire(import.meta.url);
let COMPACT_UI;
function compactUi() {
  if (COMPACT_UI === undefined)
    COMPACT_UI = require('esbuild').transformSync(UI, {minifyWhitespace:true, target:'es2020'}).code;
  return COMPACT_UI;
}
const COPY = JSON.parse(fs.readFileSync(path.join(OUT, 'locales', 'html_conversions.json'), 'utf8'));
const ARCHIVE_SERVER = JSON.parse(fs.readFileSync(path.join(OUT, 'locales', 'archive_server_strings.json'), 'utf8'));
const LOCALES = ['es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar'];
const EXTRA_STRINGS = {
  Spin:['Girar','Tourner','Drehen','Girar','转动','घुमाएँ','تدوير'],
  'Place stone':['Colocar piedra','Placer un pion','Stein setzen','Colocar pedra','放置棋子','पत्थर रखें','ضع حجرًا'],
  'Claim draw':['Reclamar tablas','Réclamer la nulle','Remis beanspruchen','Reivindicar empate','申请和棋','ड्रॉ का दावा करें','المطالبة بالتعادل'],
  Continue:['Continuar','Continuer','Fortsetzen','Continuar','继续','जारी रखें','متابعة'],
  'Take {n}':['Retirar {n}','Prendre {n}','Stein {n} schlagen','Capturar {n}','移除 {n}','{n} को हटाएँ','خذ {n}'],
  'Move to point {n}':['Mover al punto {n}','Déplacer au point {n}','Zu Punkt {n} ziehen','Mover para o ponto {n}','移动到位置 {n}','बिंदु {n} पर जाएँ','انتقل إلى النقطة {n}'],
  'Select stone at point {n}':['Seleccionar ficha en el punto {n}','Sélectionner le pion au point {n}','Stein an Punkt {n} auswählen','Selecionar a peça no ponto {n}','选择位置 {n} 的棋子','बिंदु {n} की गोटी चुनें','اختر القطعة عند النقطة {n}'],
  Knock:['Tocar','Frapper','Klopfen','Bater','敲牌','नॉक करें','اطرق'],
  Stand:['Plantarse','Rester','Stehen bleiben','Parar','停牌','रुकें','توقف'],
  'Take {card}':['Tomar {card}','Prendre {card}','{card} nehmen','Pegar {card}','拿取 {card}','{card} लें','خذ {card}'],
  'Select size {n} · {count} remaining':['Seleccionar tamaño {n} · quedan {count}','Choisir la taille {n} · {count} restantes','Größe {n} wählen · {count} übrig','Selecionar tamanho {n} · restam {count}','选择大小 {n} · 剩余 {count}','आकार {n} चुनें · {count} बाकी','اختر الحجم {n} · المتبقي {count}'],
  'Pit row {r}, column {c} · {n} seeds':['Hoyo fila {r}, columna {c} · {n} semillas','Trou rangée {r}, colonne {c} · {n} graines','Mulde Reihe {r}, Spalte {c} · {n} Samen','Buraco linha {r}, coluna {c} · {n} sementes','第 {r} 行第 {c} 列的坑 · {n} 颗种子','गड्ढा पंक्ति {r}, स्तंभ {c} · {n} बीज','حفرة الصف {r}، العمود {c} · {n} بذور'],
  'Previous cards':['Cartas anteriores','Cartes précédentes','Vorherige Karten','Cartas anteriores','上一组牌','पिछले पत्ते','الأوراق السابقة'],
  'Next cards':['Más cartas','Cartes suivantes','Nächste Karten','Próximas cartas','下一组牌','अगले पत्ते','الأوراق التالية'],
  'Reset guess':['Reiniciar intento','Réinitialiser la proposition','Tipp zurücksetzen','Reiniciar palpite','重置猜测','अनुमान रीसेट करें','إعادة تعيين التخمين'],
  'Select cards, then a center card':['Elige cartas y después una carta central','Choisissez des cartes puis une carte centrale','Handkarten und dann eine Mittelkarte wählen','Escolha cartas e depois uma carta central','选择手牌，再选择中央牌','पत्ते और फिर बीच का पत्ता चुनें','اختر أوراقًا ثم ورقة من الوسط'],
  'Bonus cards':['Cartas extra','Cartes bonus','Bonuskarten','Cartas bônus','奖励牌','बोनस पत्ते','أوراق المكافأة'],
  'Choose number or color':['Elige número o color','Choisissez un nombre ou une couleur','Zahl oder Farbe wählen','Escolha número ou cor','选择数字或颜色','संख्या या रंग चुनें','اختر رقمًا أو لونًا'],
  'Add match':['Añadir combinación','Ajouter la combinaison','Kombination hinzufügen','Adicionar combinação','添加匹配','मिलान जोड़ें','أضف المطابقة'],
  'Undo match':['Deshacer combinación','Annuler la combinaison','Kombination zurücknehmen','Desfazer combinação','撤销匹配','मिलान हटाएँ','تراجع عن المطابقة'],
  'Center card {n}: {card}':['Carta central {n}: {card}','Carte centrale {n} : {card}','Mittelkarte {n}: {card}','Carta central {n}: {card}','中央牌 {n}：{card}','बीच का पत्ता {n}: {card}','ورقة الوسط {n}: {card}'],
  'Previous center cards':['Cartas centrales anteriores','Cartes centrales précédentes','Vorherige Mittelkarten','Cartas centrais anteriores','上一组中央牌','पिछले बीच के पत्ते','أوراق الوسط السابقة'],
  'Next center cards':['Más cartas centrales','Cartes centrales suivantes','Weitere Mittelkarten','Próximas cartas centrais','下一组中央牌','अगले बीच के पत्ते','أوراق الوسط التالية'],
  'Choose a card for the center':['Elige una carta para el centro','Choisissez une carte pour le centre','Karte für die Mitte wählen','Escolha uma carta para o centro','选择一张牌放到中央','बीच के लिए एक पत्ता चुनें','اختر ورقة للوسط'],
  Cancel:['Cancelar','Annuler','Abbrechen','Cancelar','取消','रद्द करें','إلغاء'],
  '{name} · size {n}':['{name} · tamaño {n}','{name} · taille {n}','{name} · Größe {n}','{name} · tamanho {n}','{name} · 大小 {n}','{name} · आकार {n}','{name} · الحجم {n}'],
  Draw:['Empate','Match nul','Unentschieden','Empate','平局','बराबरी','تعادل'],
  'Spin to decide who goes first':['Gira para decidir quién empieza','Tournez pour déterminer qui commence','Drehe, um den Start zu bestimmen','Gire para decidir quem começa','转动以决定谁先开始','पहली बारी तय करने के लिए घुमाएँ','أدر لتحديد من يبدأ'],
  'Choose your piece':['Elige tu ficha','Choisissez votre pion','Wähle deine Figur','Escolha sua peça','选择你的棋子','अपनी गोटी चुनें','اختر قطعتك'],
  'Last spin: {n}':['Último giro: {n}','Dernier tour : {n}','Letzte Drehung: {n}','Último giro: {n}','上次转出：{n}','पिछला स्पिन: {n}','آخر تدوير: {n}'],
  'Red {value}':['Rojo {value}','Rouge {value}','Rot {value}','Vermelho {value}','红色 {value}','लाल {value}','أحمر {value}'],
  'Blue {value}':['Azul {value}','Bleu {value}','Blau {value}','Azul {value}','蓝色 {value}','नीला {value}','أزرق {value}'],
  'Green {value}':['Verde {value}','Vert {value}','Grün {value}','Verde {value}','绿色 {value}','हरा {value}','أخضر {value}'],
  'Yellow {value}':['Amarillo {value}','Jaune {value}','Gelb {value}','Amarelo {value}','黄色 {value}','पीला {value}','أصفر {value}'],
  'Last spin: {n} · {from} → {to}':['Último giro: {n} · {from} → {to}','Dernier tour : {n} · {from} → {to}','Letzte Drehung: {n} · {from} → {to}','Último giro: {n} · {from} → {to}','上次转出：{n} · {from} → {to}','पिछला स्पिन: {n} · {from} → {to}','آخر تدوير: {n} · {from} → {to}']
};
const ALL_STRINGS={...COPY.strings,...EXTRA_STRINGS};
const STRING_KEYS = Object.fromEntries(Object.keys(ALL_STRINGS).map((text,index) => [text,`text_${index}`]));
const ENGLISH = Object.fromEntries(Object.entries(STRING_KEYS).map(([text,key]) => [key,text]));
const ENTRIES = [
  {kind:'mau_mau', title:'Mau-Mau', players:[2], board:'table'},
  {kind:'dos', title:'Dos', players:[2], board:'table'},
  {kind:'kisolo', title:'Kisolo', players:[2], board:'kisolo'},
  {kind:'thirty_one', title:'Thirty-one', players:[2], board:'table'},
  {kind:'gobblet', title:'Gobblet', players:[2], board:'gobblet'},
  {kind:'chutes_ladders', title:'Chutes & Ladders', players:[2,3,4], board:'chutes_ladders'},
  {kind:'six_mens_morris', title:"Six Men's Morris", players:[2], board:'six_mens_morris'}
];

const MORRIS_UI = [
  'Tap your reserve stone, then an empty point. Later, tap a stone and its destination. If a mill offers a choice, tap a highlighted opposing stone to remove it.',
  'Toca tu ficha de reserva y después un punto vacío. Más adelante, toca una ficha y su destino. Si un molino ofrece varias opciones, toca una ficha rival resaltada para retirarla.',
  'Touchez votre pion en réserve, puis un point libre. Ensuite, touchez un pion et sa destination. Si un moulin offre un choix, touchez un pion adverse surligné pour le retirer.',
  'Tippe auf deinen Vorratsstein und dann auf einen freien Punkt. Später tippe auf einen Stein und sein Ziel. Wenn du nach einer Mühle wählen kannst, tippe auf einen markierten gegnerischen Stein.',
  'Toque na peça da reserva e depois em um ponto vazio. Mais tarde, toque em uma peça e no destino. Se um moinho oferecer uma escolha, toque em uma peça adversária destacada para removê-la.',
  '点击备用棋子，再点击空位。之后点击棋子和目标位置。组成三子连线且可以选择时，点击高亮的对方棋子将其移除。',
  'अपनी आरक्षित गोटी और फिर खाली बिंदु पर टैप करें। बाद में गोटी और उसके गंतव्य पर टैप करें। तीन की पंक्ति में विकल्प मिलने पर विरोधी की चमकती गोटी हटाने के लिए उस पर टैप करें।',
  'اضغط على قطعة الاحتياط ثم على نقطة فارغة. لاحقًا اضغط على قطعة ثم وجهتها. إذا أتاح الصف اختيارًا، فاضغط على قطعة منافسة مضاءة لإزالتها.'
];

const THIRTY_ONE_UI = [
  'Tap the stock or discard pile to draw, then tap a card in your hand to discard it. Knock or stand using the button.',
  'Toca el mazo o la pila de descartes para robar y luego una carta de tu mano para descartarla. Usa el botón para tocar o plantarte.',
  'Touchez la pioche ou la défausse pour prendre une carte, puis une carte de votre main pour la défausser. Utilisez le bouton pour frapper ou rester.',
  'Tippe zum Ziehen auf den Stapel oder Ablagestapel und dann zum Ablegen auf eine Karte in deiner Hand. Klopfe oder bleibe mit der Schaltfläche stehen.',
  'Toque no monte ou no descarte para comprar e depois em uma carta da sua mão para descartá-la. Use o botão para bater ou parar.',
  '点击牌堆或弃牌堆抽牌，然后点击手牌弃牌。使用按钮敲牌或停牌。',
  'पत्ता लेने के लिए ढेर या छोड़े गए पत्तों पर टैप करें, फिर छोड़ने के लिए अपने हाथ के पत्ते पर टैप करें। नॉक करने या रुकने के लिए बटन दबाएँ।',
  'اضغط على رزمة السحب أو كومة الرمي لسحب ورقة، ثم اضغط على ورقة من يدك لرميها. استخدم الزر للطرق أو التوقف.'
];

const GOBBLET_UI = [
  'Tap one of your reserve pieces or a piece on the board, then tap a highlighted square.',
  'Toca una ficha de tu reserva o del tablero y luego una casilla resaltada.',
  'Touchez une pièce de votre réserve ou du plateau, puis une case surlignée.',
  'Tippe auf einen deiner Vorratssteine oder einen Stein auf dem Brett und dann auf ein markiertes Feld.',
  'Toque em uma peça da reserva ou do tabuleiro e depois em uma casa destacada.',
  '点击一枚备用棋子或棋盘上的棋子，再点击高亮方格。',
  'अपनी आरक्षित गोटी या बोर्ड की गोटी पर टैप करें, फिर चमकते खाने पर टैप करें।',
  'اضغط على قطعة من الاحتياط أو على اللوحة، ثم اضغط على مربع مضاء.'
];

const KISOLO_UI = [
  'Tap a highlighted pit to sow or capture.',
  'Toca un hoyo resaltado para sembrar o capturar.',
  'Touchez un trou surligné pour semer ou capturer.',
  'Tippe auf eine markierte Mulde, um zu säen oder zu schlagen.',
  'Toque em um buraco destacado para semear ou capturar.',
  '点击高亮的坑进行播种或吃子。',
  'बीज बाँटने या पकड़ने के लिए चमकते गड्ढे पर टैप करें।',
  'اضغط على حفرة مضاءة لتوزيع البذور أو أسرها.'
];

const MAU_MAU_UI = [
  'Tap a highlighted card to play it, or tap the deck to draw. After playing a Jack, tap the suit you choose.',
  'Toca una carta resaltada para jugarla o el mazo para robar. Después de jugar una jota, toca el palo que elijas.',
  'Touchez une carte surlignée pour la jouer ou la pioche pour tirer. Après un valet, touchez la couleur choisie.',
  'Tippe auf eine markierte Karte zum Spielen oder auf den Stapel zum Ziehen. Tippe nach einem Buben auf die gewünschte Farbe.',
  'Toque em uma carta destacada para jogá-la ou no monte para comprar. Após jogar um valete, toque no naipe escolhido.',
  '点击高亮的牌出牌，或点击牌堆抽牌。打出 J 后点击选择的花色。',
  'चमकता पत्ता खेलने या ढेर से पत्ता लेने के लिए टैप करें। जैक खेलने के बाद चुने हुए सूट पर टैप करें।',
  'اضغط على ورقة مضاءة للعبها أو على الرزمة للسحب. بعد لعب الولد اضغط على النوع الذي تختاره.'
];

const DOS_UI = [
  'Tap one or two hand cards, then a matching center card. Adjust wild cards if needed, add more matches or bonus cards, and tap Continue. Tap the deck to draw.',
  'Toca una o dos cartas de tu mano y después una carta central que coincida. Ajusta los comodines si hace falta, añade combinaciones o cartas extra y toca Continuar. Toca el mazo para robar.',
  'Touchez une ou deux cartes en main, puis une carte centrale correspondante. Réglez les jokers si nécessaire, ajoutez des combinaisons ou des cartes bonus et touchez Continuer. Touchez la pioche pour tirer.',
  'Tippe auf eine oder zwei Handkarten und dann eine passende Mittelkarte. Stelle Joker ein, ergänze Kombinationen oder Bonuskarten und tippe auf Fortsetzen. Tippe auf den Stapel zum Ziehen.',
  'Toque em uma ou duas cartas da mão e depois em uma carta central correspondente. Ajuste os curingas se necessário, adicione combinações ou cartas bônus e toque em Continuar. Toque no monte para comprar.',
  '点击一张或两张手牌，再点击匹配的中央牌。如有需要调整万能牌，添加其他匹配或奖励牌，然后点击继续。点击牌堆摸牌。',
  'एक या दो हाथ के पत्ते और फिर मेल खाने वाला बीच का पत्ता दबाएँ। जरूरत पर वाइल्ड बदलें, और मिलान या बोनस पत्ते जोड़ें, फिर जारी रखें दबाएँ। पत्ता उठाने के लिए ढेर दबाएँ।',
  'اضغط ورقة أو ورقتين من يدك ثم ورقة وسط مطابقة. عدّل الأوراق البرية عند الحاجة وأضف مطابقات أو أوراق مكافأة ثم اضغط متابعة. اضغط الرزمة للسحب.'
];

const CUSTOM = {
  chutes_ladders: {
    description:"A turn-based race for 2 to 4 players. Spin to move along the numbered board, climb ladders, and slide down chutes.",
    rules:"Move your token from the start toward square 100. Spin to move the indicated number of spaces; climb a ladder when you land at its base and slide down a chute when you land at its top. The first player to reach square 100 wins.",
    ui:"Choose a token during setup, then tap Spin on your turn. The board shows each player's position and the ladders and chutes.",
    locales:{
      es:["Serpientes y escaleras","Carrera por turnos de 2 a 4 jugadores. Gira la ruleta, sube por las escaleras y baja por las serpientes.","Mueve tu ficha hacia la casilla 100. Gira la ruleta para avanzar; sube si caes al pie de una escalera y baja si caes en una serpiente. Gana quien llegue primero a la casilla 100.","Elige una ficha durante la preparación y toca Girar en tu turno. El tablero muestra las posiciones, escaleras y serpientes.","Cómo jugar"],
      fr:["Serpents et échelles","Course au tour par tour pour 2 à 4 joueurs. Faites tourner la roue, montez les échelles et glissez dans les goulottes.","Déplacez votre pion vers la case 100. Faites tourner la roue pour avancer ; montez si vous arrivez au pied d’une échelle et descendez si vous arrivez en haut d’une goulotte. Le premier à atteindre la case 100 gagne.","Choisissez un pion pendant la préparation, puis touchez Tourner à votre tour. Le plateau montre les positions, les échelles et les goulottes.","Comment jouer"],
      de:["Leitern und Rutschen","Ein rundenbasiertes Wettrennen für 2 bis 4 Personen. Drehe den Zeiger, steige Leitern hinauf und rutsche hinunter.","Bewege deine Figur bis Feld 100. Drehe den Zeiger und ziehe entsprechend vor; auf einer Leiter steigst du hinauf, auf einer Rutsche hinunter. Wer Feld 100 zuerst erreicht, gewinnt.","Wähle zu Beginn eine Figur und tippe in deinem Zug auf Drehen. Das Brett zeigt alle Positionen, Leitern und Rutschen.","Spielanleitung"],
      pt:["Escadas e escorregadores","Corrida por turnos para 2 a 4 jogadores. Gire a roleta, suba escadas e desça escorregadores.","Leve sua peça até a casa 100. Gire a roleta para avançar; suba ao cair no início de uma escada e desça ao cair no topo de um escorregador. Vence quem chegar primeiro à casa 100.","Escolha uma peça na preparação e toque em Girar na sua vez. O tabuleiro mostra posições, escadas e escorregadores.","Como jogar"],
      zh:["蛇梯棋","适合 2 至 4 人的轮流竞赛。转动转盘前进，沿梯子上升并沿滑道下降。","将棋子从起点移动到第 100 格。转动转盘并按点数前进；落在梯子底部时上升，落在滑道顶部时下降。最先到达第 100 格者获胜。","准备时选择棋子，轮到你时点击转动。棋盘显示所有玩家的位置、梯子和滑道。","玩法"],
      hi:["साँप-सीढ़ी","2 से 4 खिलाड़ियों के लिए बारी-बारी से खेली जाने वाली दौड़। स्पिनर घुमाएँ, सीढ़ियों से ऊपर जाएँ और साँपों से नीचे फिसलें।","अपनी गोटी को शुरुआती स्थान से 100वें खाने तक ले जाएँ। स्पिनर घुमाकर उतने खाने चलें; सीढ़ी के नीचे पहुँचने पर ऊपर जाएँ और साँप के सिर पर पहुँचने पर नीचे फिसलें। 100वें खाने पर पहले पहुँचने वाला जीतता है।","शुरुआत में गोटी चुनें, फिर अपनी बारी पर घुमाएँ दबाएँ। बोर्ड खिलाड़ियों की स्थिति, सीढ़ियाँ और साँप दिखाता है।","कैसे खेलें"],
      ar:["السلم والثعبان","سباق بالأدوار من لاعبين إلى أربعة. أدر المؤشر، واصعد السلالم وانزل عبر المزالق.","حرّك قطعتك من البداية نحو المربع 100. أدر المؤشر للتحرك؛ اصعد إذا وصلت إلى أسفل سلم، وانزل إذا وصلت إلى أعلى منزلق. يفوز أول من يصل إلى المربع 100.","اختر قطعة أثناء الإعداد ثم اضغط على التدوير في دورك. يعرض اللوح المواقع والسلالم والمزالق.","طريقة اللعب"]
    }
  },
  dots_boxes: {
    description:"A two-player pencil-and-paper game played by claiming edges and completing boxes.",
    rules:"Take turns claiming one unclaimed edge between adjacent dots. Complete a box to claim it and take another turn. The player who claims the most boxes wins.",
    ui:"Tap any unclaimed edge to draw it. Completed boxes and both players' scores stay visible.",
    locales:{
      es:["Puntos y cajas","Juego para dos personas: traza líneas entre puntos para formar y reclamar cajas.","Por turnos, reclama un lado libre entre dos puntos vecinos. Al cerrar una caja, la reclamas y vuelves a jugar. Gana quien reclame más cajas.","Toca un lado libre para dibujarlo. Las cajas completas y las puntuaciones permanecen visibles.","Cómo jugar"],
      fr:["Points et carrés","Jeu à deux : tracez des lignes entre les points pour former et réclamer des carrés.","À tour de rôle, prenez un côté libre entre deux points voisins. En fermant un carré, vous le réclamez et rejouez. Le joueur qui réclame le plus de carrés gagne.","Touchez un côté libre pour le tracer. Les carrés terminés et les scores restent visibles.","Comment jouer"],
      de:["Kästchen","Spiel für zwei: Verbinde Punkte, vervollständige Kästchen und sichere sie dir.","Nehmt abwechselnd eine freie Kante zwischen benachbarten Punkten. Wer ein Kästchen schließt, erhält es und ist erneut am Zug. Wer die meisten Kästchen sammelt, gewinnt.","Tippe auf eine freie Kante, um sie zu zeichnen. Fertige Kästchen und Punktestände bleiben sichtbar.","Spielanleitung"],
      pt:["Pontos e quadrados","Jogo para duas pessoas: ligue pontos para completar e conquistar quadrados.","Em turnos, escolha uma aresta livre entre pontos vizinhos. Ao fechar um quadrado, você o conquista e joga novamente. Vence quem conquistar mais quadrados.","Toque em uma aresta livre para desenhá-la. Os quadrados completos e as pontuações ficam visíveis.","Como jogar"],
      zh:["点格棋","双人游戏：连接点并完成方格以获得分数。","轮流连接相邻点之间的一条空边。完成一个方格即可获得该方格并再走一回合。获得方格最多者获胜。","点击任意空边画线。已完成的方格和双方分数都会显示。","玩法"],
      hi:["डॉट्स और बॉक्स","दो खिलाड़ियों का खेल: बिंदुओं को जोड़कर बॉक्स पूरा करें और अंक पाएँ।","बारी-बारी से पास-पास के बिंदुओं के बीच एक खाली किनारा चुनें। बॉक्स पूरा करने पर वह आपका होता है और आपको एक और चाल मिलती है। सबसे अधिक बॉक्स पाने वाला जीतता है।","रेखा बनाने के लिए किसी खाली किनारे पर टैप करें। पूरे बॉक्स और दोनों के अंक दिखते रहते हैं।","कैसे खेलें"],
      ar:["النقاط والمربعات","لعبة لشخصين: صِل النقاط لتكوين المربعات والاستحواذ عليها.","يتناوب اللاعبان على اختيار ضلع فارغ بين نقطتين متجاورتين. من يُكمل مربعًا يستحوذ عليه ويلعب مرة أخرى. يفوز من يستحوذ على أكبر عدد من المربعات.","اضغط على أي ضلع فارغ لرسمه. تبقى المربعات المكتملة والنتائج ظاهرة.","طريقة اللعب"]
    }
  }
};

const CUSTOM_SERVER = {
  chutes_ladders:{
    english:{
      server_not_seated:'not seated',server_game_over:'game over',
      server_spin_to_roll_off:'spin to roll off',server_not_your_roll_off_turn:'not your roll-off turn',
      server_already_rolled:'already rolled',server_pick_a_piece:'pick a piece',
      server_selection_order_error:'selection order error',server_not_your_pick:'not your pick',
      server_bad_piece:'bad piece',server_piece_taken:'piece taken',
      server_spin_on_your_turn:'spin on your turn',server_not_your_turn:'not your turn',
      server_unknown_phase:'unknown phase',
      server_rolloff_log:'{p1} rolled {p2} for first turn',
      server_exact_finish_log:'{p1} {p2} spun {p3} but needs exact to reach 100 - stays on {p4}',
      server_ladder_log:'{p1} {p2} spun {p3}: {p4} climbs to {p5} ({p6})',
      server_chute_log:'{p1} {p2} spun {p3}: {p4} slides to {p5} ({p6})',
      server_move_log:'{p1} {p2} spun {p3}: {p4} -> {p5}'
    },
    locales:{
      es:{
        server_not_seated:'No estás en la partida',server_game_over:'La partida ha terminado',
        server_spin_to_roll_off:'Gira la ruleta para decidir el orden',server_not_your_roll_off_turn:'No es tu turno para decidir el orden',
        server_already_rolled:'Ya has girado',server_pick_a_piece:'Elige una ficha',
        server_selection_order_error:'Error en el orden de selección',server_not_your_pick:'No te toca elegir',
        server_bad_piece:'Ficha no válida',server_piece_taken:'Esa ficha ya está elegida',
        server_spin_on_your_turn:'Gira la ruleta en tu turno',server_not_your_turn:'No es tu turno',
        server_unknown_phase:'Fase desconocida',server_rolloff_log:'{p1} sacó {p2} para decidir quién empieza',
        server_exact_finish_log:'{p1} {p2} sacó {p3}, pero necesita el número exacto para llegar a 100; se queda en {p4}',
        server_ladder_log:'{p1} {p2} sacó {p3}: sube de {p4} a {p5} ({p6})',
        server_chute_log:'{p1} {p2} sacó {p3}: baja de {p4} a {p5} ({p6})',
        server_move_log:'{p1} {p2} sacó {p3}: {p4} -> {p5}'
      },
      fr:{
        server_not_seated:'Vous ne participez pas à la partie',server_game_over:'La partie est terminée',
        server_spin_to_roll_off:'Tournez la roue pour déterminer l’ordre',server_not_your_roll_off_turn:'Ce n’est pas votre tour pour déterminer l’ordre',
        server_already_rolled:'Vous avez déjà tourné',server_pick_a_piece:'Choisissez un pion',
        server_selection_order_error:'Erreur dans l’ordre de sélection',server_not_your_pick:'Ce n’est pas à vous de choisir',
        server_bad_piece:'Pion invalide',server_piece_taken:'Ce pion est déjà pris',
        server_spin_on_your_turn:'Tournez la roue à votre tour',server_not_your_turn:'Ce n’est pas votre tour',
        server_unknown_phase:'Phase inconnue',server_rolloff_log:'{p1} a obtenu {p2} pour déterminer le premier tour',
        server_exact_finish_log:'{p1} {p2} a obtenu {p3}, mais doit faire le nombre exact pour atteindre 100 ; reste en {p4}',
        server_ladder_log:'{p1} {p2} a obtenu {p3} : monte de {p4} à {p5} ({p6})',
        server_chute_log:'{p1} {p2} a obtenu {p3} : glisse de {p4} à {p5} ({p6})',
        server_move_log:'{p1} {p2} a obtenu {p3} : {p4} -> {p5}'
      },
      de:{
        server_not_seated:'Du nimmst nicht teil',server_game_over:'Das Spiel ist beendet',
        server_spin_to_roll_off:'Drehe den Zeiger, um die Reihenfolge festzulegen',server_not_your_roll_off_turn:'Du bist nicht mit dem Auswürfeln an der Reihe',
        server_already_rolled:'Du hast bereits gedreht',server_pick_a_piece:'Wähle eine Figur',
        server_selection_order_error:'Fehler bei der Auswahlreihenfolge',server_not_your_pick:'Du bist nicht mit der Auswahl an der Reihe',
        server_bad_piece:'Ungültige Figur',server_piece_taken:'Diese Figur ist bereits vergeben',
        server_spin_on_your_turn:'Drehe den Zeiger in deinem Zug',server_not_your_turn:'Du bist nicht an der Reihe',
        server_unknown_phase:'Unbekannte Phase',server_rolloff_log:'{p1} drehte eine {p2}, um den Start zu bestimmen',
        server_exact_finish_log:'{p1} {p2} drehte eine {p3}, braucht aber genau die passende Zahl für Feld 100 und bleibt auf {p4}',
        server_ladder_log:'{p1} {p2} drehte eine {p3}: steigt von {p4} auf {p5} ({p6})',
        server_chute_log:'{p1} {p2} drehte eine {p3}: rutscht von {p4} auf {p5} ({p6})',
        server_move_log:'{p1} {p2} drehte eine {p3}: {p4} -> {p5}'
      },
      pt:{
        server_not_seated:'Você não está na partida',server_game_over:'A partida terminou',
        server_spin_to_roll_off:'Gire a roleta para definir a ordem',server_not_your_roll_off_turn:'Não é sua vez de definir a ordem',
        server_already_rolled:'Você já girou',server_pick_a_piece:'Escolha uma peça',
        server_selection_order_error:'Erro na ordem de escolha',server_not_your_pick:'Não é sua vez de escolher',
        server_bad_piece:'Peça inválida',server_piece_taken:'Essa peça já foi escolhida',
        server_spin_on_your_turn:'Gire a roleta na sua vez',server_not_your_turn:'Não é sua vez',
        server_unknown_phase:'Fase desconhecida',server_rolloff_log:'{p1} girou {p2} para definir quem começa',
        server_exact_finish_log:'{p1} {p2} girou {p3}, mas precisa do número exato para chegar a 100; fica em {p4}',
        server_ladder_log:'{p1} {p2} girou {p3}: sobe de {p4} para {p5} ({p6})',
        server_chute_log:'{p1} {p2} girou {p3}: desce de {p4} para {p5} ({p6})',
        server_move_log:'{p1} {p2} girou {p3}: {p4} -> {p5}'
      },
      zh:{
        server_not_seated:'你未加入此对局',server_game_over:'游戏已结束',
        server_spin_to_roll_off:'转动转盘决定先后顺序',server_not_your_roll_off_turn:'现在不是你决定顺序的回合',
        server_already_rolled:'你已经转过转盘',server_pick_a_piece:'选择一枚棋子',
        server_selection_order_error:'选择顺序错误',server_not_your_pick:'现在不是你的选择回合',
        server_bad_piece:'棋子无效',server_piece_taken:'该棋子已被选走',
        server_spin_on_your_turn:'轮到你时转动转盘',server_not_your_turn:'还没轮到你',
        server_unknown_phase:'未知阶段',server_rolloff_log:'{p1}转出{p2}以决定先手',
        server_exact_finish_log:'{p1} {p2}转出{p3}，但需要正好到达100，停在{p4}',
        server_ladder_log:'{p1} {p2}转出{p3}：从{p4}沿梯子上升到{p5}（{p6}）',
        server_chute_log:'{p1} {p2}转出{p3}：从{p4}沿滑道下降到{p5}（{p6}）',
        server_move_log:'{p1} {p2}转出{p3}：{p4} -> {p5}'
      },
      hi:{
        server_not_seated:'आप इस खेल में शामिल नहीं हैं',server_game_over:'खेल समाप्त हो गया है',
        server_spin_to_roll_off:'पहले खेलने का क्रम तय करने के लिए स्पिनर घुमाएँ',server_not_your_roll_off_turn:'क्रम तय करने की बारी आपकी नहीं है',
        server_already_rolled:'आप पहले ही घुमा चुके हैं',server_pick_a_piece:'एक गोटी चुनें',
        server_selection_order_error:'चुनने के क्रम में त्रुटि',server_not_your_pick:'चुनने की बारी आपकी नहीं है',
        server_bad_piece:'अमान्य गोटी',server_piece_taken:'यह गोटी पहले ही चुनी जा चुकी है',
        server_spin_on_your_turn:'अपनी बारी में स्पिनर घुमाएँ',server_not_your_turn:'अभी आपकी बारी नहीं है',
        server_unknown_phase:'अज्ञात चरण',server_rolloff_log:'पहली बारी तय करने के लिए {p1} ने {p2} घुमाया',
        server_exact_finish_log:'{p1} {p2} ने {p3} घुमाया, लेकिन 100 तक पहुँचने के लिए सही संख्या चाहिए; {p4} पर ही रहेगा',
        server_ladder_log:'{p1} {p2} ने {p3} घुमाया: {p4} से सीढ़ी चढ़कर {p5} पर पहुँचा ({p6})',
        server_chute_log:'{p1} {p2} ने {p3} घुमाया: {p4} से फिसलकर {p5} पर पहुँचा ({p6})',
        server_move_log:'{p1} {p2} ने {p3} घुमाया: {p4} -> {p5}'
      },
      ar:{
        server_not_seated:'أنت لست مشاركًا في اللعبة',server_game_over:'انتهت اللعبة',
        server_spin_to_roll_off:'أدر المؤشر لتحديد ترتيب اللعب',server_not_your_roll_off_turn:'ليس دورك لتحديد الترتيب',
        server_already_rolled:'لقد أدرت المؤشر بالفعل',server_pick_a_piece:'اختر قطعة',
        server_selection_order_error:'خطأ في ترتيب الاختيار',server_not_your_pick:'ليس دورك للاختيار',
        server_bad_piece:'قطعة غير صالحة',server_piece_taken:'تم اختيار هذه القطعة بالفعل',
        server_spin_on_your_turn:'أدر المؤشر في دورك',server_not_your_turn:'ليس دورك',
        server_unknown_phase:'مرحلة غير معروفة',server_rolloff_log:'أدار {p1} المؤشر وظهرت {p2} لتحديد البداية',
        server_exact_finish_log:'أدار {p1} {p2} وظهرت {p3}، لكن يلزم الرقم الدقيق للوصول إلى 100؛ يبقى في {p4}',
        server_ladder_log:'أدار {p1} {p2} وظهرت {p3}: يصعد من {p4} إلى {p5} عبر السلم ({p6})',
        server_chute_log:'أدار {p1} {p2} وظهرت {p3}: ينزلق من {p4} إلى {p5} ({p6})',
        server_move_log:'أدار {p1} {p2} وظهرت {p3}: {p4} -> {p5}'
      }
    }
  },
  dots_boxes:{
    english:{server_unknown_player:'unknown player',server_pick_edge:'pick an edge 0-23',server_edge_taken:'edge taken'},
    locales:{
      es:{server_unknown_player:'Jugador desconocido',server_pick_edge:'Elige un lado del 0 al 23',server_edge_taken:'Ese lado ya está ocupado'},
      fr:{server_unknown_player:'Joueur inconnu',server_pick_edge:'Choisissez un côté de 0 à 23',server_edge_taken:'Ce côté est déjà pris'},
      de:{server_unknown_player:'Unbekannter Spieler',server_pick_edge:'Wähle eine Kante von 0 bis 23',server_edge_taken:'Diese Kante ist bereits belegt'},
      pt:{server_unknown_player:'Jogador desconhecido',server_pick_edge:'Escolha uma aresta de 0 a 23',server_edge_taken:'Essa aresta já foi escolhida'},
      zh:{server_unknown_player:'未知玩家',server_pick_edge:'选择一条编号为0到23的边',server_edge_taken:'该边已被占用'},
      hi:{server_unknown_player:'अज्ञात खिलाड़ी',server_pick_edge:'0 से 23 तक का किनारा चुनें',server_edge_taken:'यह किनारा पहले ही लिया जा चुका है'},
      ar:{server_unknown_player:'لاعب غير معروف',server_pick_edge:'اختر ضلعًا من 0 إلى 23',server_edge_taken:'هذا الضلع مأخوذ بالفعل'}
    }
  }
};

const COLORS = {
  p0:'#4aa3ff', p1:'#fb7185', card:'#fffdf6', played:'#f8fafc',
  pit:'#b77936', square:'#e8edf4', dot:'#26354a', box_0:'#4aa3ff',
  box_1:'#fb7185', stone_0:'#c66b4e', stone_1:'#34465e'
};

function board(kind) {
  const free = {kind:'free',x:0,y:0,width:640,height:740,color:'#145b4e',line_color:'#6ee7b7'};
  if (kind === 'mau_mau') return {viewport:{width:640,height:600},boards:[
    {id:'table',kind:'free',x:0,y:0,width:640,height:600,color:'#316f68',line_color:'#e9dcb7'}]};
  if (kind === 'dos') return {viewport:{width:640,height:720},boards:[
    {id:'table',kind:'free',x:0,y:0,width:640,height:720,color:'#316f68',line_color:'#e9dcb7'}]};
  if (kind === 'thirty_one') return {viewport:{width:640,height:590},boards:[
    {id:'table',kind:'free',x:0,y:0,width:640,height:590,color:'#316f68',line_color:'#e9dcb7'}]};
  if (kind === 'table') return {viewport:{width:640,height:720},boards:[{id:'table',...free}]};
  if (kind === 'kisolo') return {viewport:{width:620,height:530},boards:[
    {id:'main',kind:'grid',x:30,y:110,width:560,height:280,rows:4,columns:7,color:'#e6c6a1',alternate_color:'#e6c6a1',line_color:'#c79b79'}]};
  if (kind === 'gobblet') return {viewport:{width:600,height:785},boards:[
    {id:'main',kind:'grid',x:40,y:100,width:520,height:520,rows:4,columns:4,color:'#f3dfc5',alternate_color:'#e8c9ae',line_color:'#b68b73'},
    {id:'tray',kind:'free',x:40,y:650,width:520,height:110,color:'#936d60',line_color:'#725246'}]};
  if (kind === 'chutes_ladders') return {viewport:{width:620,height:720,camera_controls:true},boards:[
    {id:'main',kind:'grid',x:30,y:112,width:560,height:560,rows:10,columns:10,color:'#fff1df',alternate_color:'#dceee4',line_color:'#adc7b7'}]};
  if (kind === 'dots_boxes') return {viewport:{width:620,height:710},boards:[{id:'main',...free}]};
  if (kind === 'mastermind') return {viewport:{width:620,height:780},boards:[{id:'main',...free}]};
  if (kind === 'six_mens_morris') return {viewport:{width:620,height:680},boards:[
    {id:'main',kind:'free',x:0,y:0,width:620,height:680,color:'#f4dfc4',line_color:'#60452e'}]};
  return {viewport:{width:640,height:720},boards:[{id:'table',...free}]};
}

function typesFor(kind) {
  const types = {
    card:{shape:'card',width:60,height:82,color:COLORS.card,text_color:'#172033',border_color:'#667085'},
    played:{shape:'card',width:58,height:78,color:COLORS.played,text_color:'#172033',border_color:'#667085'}
  };
  if (kind === 'thirty_one' || kind === 'mau_mau') {
    const [width,height] = kind === 'thirty_one' ? [92,126] : [70,96];
    types.red_card = {shape:'image',asset:'card_face_soft',width,height,text_color:'#b02e35'};
    types.black_card = {shape:'image',asset:'card_face_soft',width,height,text_color:'#1c2b31'};
    types.deck = {shape:'image',asset:'card_back_soft',width,height,text_color:'#fff1d9'};
    if (kind === 'thirty_one') types.knock_button = {shape:'card',width:150,height:52,
      color:'#f8d994',text_color:'#533b35',border_color:'#fff1c8',font_size:22};
    if (kind === 'mau_mau') {
      types.suit_red = {shape:'circle',width:56,height:56,color:'#fffdf6',text_color:'#b02e35',border_color:'#d5c6a9'};
      types.suit_black = {shape:'circle',width:56,height:56,color:'#fffdf6',text_color:'#1c2b31',border_color:'#d5c6a9'};
    }
  }
  if (kind === 'dos') {
    for (const [key,text] of [['R','#ffffff'],['B','#ffffff'],['G','#ffffff'],
      ['Y','#26313a'],['W','#26313a']])
      types[`dos_${key}`] = {shape:'image',asset:`dos_${key}`,width:76,height:96,text_color:text};
    types.deck = {shape:'image',asset:'dos_deck',width:76,height:96,text_color:'#ffffff'};
  }
  if (kind === 'kisolo') types.pit = {shape:'circle',width:66,height:54,color:'#70452b',text_color:'#fff3d4',border_color:'#4d2e1d'};
  if (kind === 'gobblet') for (let size=1;size<=4;size++) for (let owner=0;owner<2;owner++)
    types[`goblet_${size}_${owner}`] = {shape:'image',asset:`goblet_${owner}`,
      width:38 + size * 13,height:38 + size * 13};
  if (kind === 'chutes_ladders') {
    for (let i=0;i<4;i++) types[`token_${i}`] = {shape:'circle',width:20,height:20,
      color:['#dc2626','#2563eb','#16a34a','#9333ea'][i],text_color:'#ffffff'};
  }
  if (kind === 'dots_boxes') {
    types.dot = {shape:'circle',width:20,height:20,color:COLORS.dot,text_color:'#ffffff'};
    types.box_0 = {shape:'rect',width:96,height:96,color:COLORS.box_0,text_color:'#10243d'};
    types.box_1 = {shape:'rect',width:96,height:96,color:COLORS.box_1,text_color:'#39101c'};
  }
  if (kind === 'mastermind') for (let i=0;i<6;i++) types[`peg_${i}`] = {
    shape:'circle',width:38,height:38,color:['#e53935','#1e88e5','#43a047','#fdd835','#fb8c00','#8e24aa'][i],
    text_color:'#ffffff',border_color:'#334155'};
  if (kind === 'six_mens_morris') {
    types.point = {shape:'circle',width:14,height:14,color:'#60452e'};
    types.stone_0 = {shape:'circle',width:48,height:48,color:'#ad4e39',text_color:'#ffffff',border_color:'#653123'};
    types.stone_1 = {shape:'circle',width:48,height:48,color:'#263b4a',text_color:'#ffffff',border_color:'#10232f'};
  }
  return types;
}

function softCardAssets() {
  return Object.fromEntries(['card_face_soft','card_back_soft'].map(key => [key, {
    media_type:'image/svg+xml',
    uri:`data:image/svg+xml;base64,${fs.readFileSync(path.join(OUT,`${key}.svg`)).toString('base64')}`
  }]));
}

function gobbletAssets() {
  return Object.fromEntries([
    ['goblet_0', ['#caeee4','#66b0a5','#33786f']],
    ['goblet_1', ['#ffd4d7','#dc8594','#a94e65']]
  ].map(([key,[light,mid,dark]]) => {
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <ellipse cx="64" cy="113" rx="43" ry="9" fill="#573e3a" opacity=".22"/>
      <path d="M25 35 C25 25 103 25 103 35 L95 98 Q92 113 64 114 Q36 113 33 98 Z"
        fill="${mid}" stroke="${dark}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M36 49 Q39 90 43 99 Q48 106 54 107" fill="none" stroke="${light}" stroke-width="8" stroke-linecap="round" opacity=".7"/>
      ${key === 'goblet_0'
        ? `<circle cx="69" cy="76" r="8" fill="none" stroke="${light}" stroke-width="4"/>`
        : `<path d="M69 64 L78 76 L69 88 L60 76 Z" fill="none" stroke="${light}" stroke-width="4" stroke-linejoin="round"/>`}
      <ellipse cx="64" cy="35" rx="39" ry="17" fill="${light}" stroke="${dark}" stroke-width="4"/>
      <ellipse cx="64" cy="34" rx="29" ry="10" fill="${dark}" opacity=".72"/>
      <ellipse cx="55" cy="29" rx="15" ry="3" fill="#ffffff" opacity=".5"/>
    </svg>`;
    return [key,{media_type:'image/svg+xml',width:128,height:128,
      uri:`data:image/svg+xml;base64,${Buffer.from(body).toString('base64')}`}];
  }));
}

function dosAssets() {
  const colors = {R:'#bd3846',B:'#2863a6',G:'#23825f',Y:'#f0c84d',W:'#f9f4e8',deck:'#253b59'};
  const marks = {
    R:'<circle cx="13" cy="13" r="4"/>',
    B:'<rect x="9" y="9" width="8" height="8" rx="1"/>',
    G:'<path d="M13 8L18 13L13 18L8 13Z"/>',
    Y:'<path d="M13 8L18 17H8Z"/>'
  };
  return Object.fromEntries(Object.entries(colors).map(([key,color]) => {
    const body = `<svg xmlns="http://www.w3.org/2000/svg" width="76" height="96" viewBox="0 0 76 96">
      <rect x="2" y="3" width="72" height="91" rx="9" fill="#061c22" opacity=".32"/>
      <rect x="1" y="1" width="72" height="91" rx="9" fill="${color}" stroke="#f4e3b2" stroke-width="2"/>
      <path d="M7 17Q21 5 38 7T67 17M7 76Q21 88 38 86T67 76" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
      <ellipse cx="37" cy="47" rx="27" ry="33" fill="#fff" fill-opacity=".12" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>
      <g fill="${key === 'Y' ? '#26313a' : '#fff'}">${marks[key] || ''}</g>
    </svg>`;
    return [`dos_${key}`,{media_type:'image/svg+xml',width:76,height:96,
      uri:`data:image/svg+xml;base64,${Buffer.from(body).toString('base64')}`}];
  }));
}

const HINT_CODE = {
  mau_mau:`const __archiveView=game.viewFor;game.viewFor=function(state,id,ctx){const v=__archiveView.call(this,state,id,ctx);const seat=id==null?-1:ctx.players.findIndex(p=>p.id===id);v.legal_plays=seat===state.to_move?legalPlays(state,seat):[];if(seat===state.to_move&&state.pending_draw>0){for(const card of state.hands[seat])if(/^7[SHDC]$/.test(card)&&!v.legal_plays.includes(card))v.legal_plays.push(card);}return v;};`,
  dos:`const __archiveView=game.viewFor;game.viewFor=function(state,id,ctx){const v=__archiveView.call(this,state,id,ctx);const seat=id==null?-1:ctx.players.findIndex(p=>p.id===id);v.legal_placements=(seat===state.turn&&(state.phase==="play"||state.phase==="after_draw"))?allPlacements(state,seat).map(p=>({pile:p.pile,cards:p.cards,centerNum:p.centerDecl.centerNum,centerColor:p.centerDecl.centerColor,colorMatch:p.colorMatch,doubleColor:p.doubleColor})):[];return v;};`,
  kisolo:`const __archiveView=game.viewFor;game.viewFor=function(state,id,ctx){const v=__archiveView.call(this,state,id,ctx);const seat=id==null?-1:ctx.players.findIndex(p=>p.id===id);v.legal_pits=seat===state.to_move?legalPits(state,seat):[];return v;};`,
  gobblet:`const __archiveView=game.viewFor;game.viewFor=function(state,id,ctx){const v=__archiveView.call(this,state,id,ctx);const seat=id==null?-1:ctx.players.findIndex(p=>p.id===id);v.legal_moves=seat===state.to_move?legalMoves(state,seat):[];return v;};`,
  dots_boxes:`const __archiveView=game.viewFor;game.viewFor=function(state,id,ctx){const v=__archiveView.call(this,state,id,ctx);v.legal_edges=this.legal(state);return v;};`
};

function addHints(kind, source) {
  let code = source.server_code;
  const marker = '\n// declarative-archive-view-hints';
  const existingHint = code.indexOf(marker);
  if (HINT_CODE[kind]) {
    if (existingHint >= 0) code = code.slice(0, existingHint);
    code += `\n// declarative-archive-view-hints\n;(()=>{${HINT_CODE[kind]}})();\n`;
  }
  const tests = structuredClone(source.unit_tests);
  const schema = tests.view_schema;
  const property = {
    mau_mau:{legal_plays:{type:'array',items:{type:'string'}}},
    dos:{legal_placements:{type:'array',items:{type:'object',additionalProperties:true}}},
    kisolo:{legal_pits:{type:'array',items:{type:'integer',minimum:0,maximum:27}}},
    gobblet:{legal_moves:{type:'array',items:{type:'object',additionalProperties:true}}},
    dots_boxes:{legal_edges:{type:'array',items:{type:'integer',minimum:0,maximum:23}}}
  }[kind];
  if (property) {
    Object.assign(schema.properties,property);
    schema.required = [...new Set([...(schema.required || []),...Object.keys(property)])];
  }
  const math = Object.create(Math);
  const sandbox = {InvalidMove:class InvalidMove extends Error{},Math:math,
    Date:class extends Date { static now(){return 0;} }};
  vm.createContext(sandbox);
  vm.runInContext(code+'\nglobalThis.__archiveGame=game;',sandbox,{timeout:1000});
  const game = sandbox.__archiveGame;
  const clone = value => JSON.parse(JSON.stringify(value));
  const randomFor = seed => {
    let value = seed >>> 0;
    return () => {
      value = (value + 0x6D2B79F5) | 0;
      let t=value;
      t=Math.imul(t^(t>>>15),t|1);
      t=(t+Math.imul(t^(t>>>7),t|61))^t;
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  };
  const call = (ctx,name,args,seed) => {
    ctx.random=randomFor(seed); math.random=ctx.random;
    return clone(game[name](...args,ctx));
  };
  const updateViews = test => {
    const ctx=clone(test.ctx), seed=Number.isInteger(ctx.seed)?ctx.seed:11;
    test.view_of_mover=call(ctx,'viewFor',[clone(test.state),test.player_id],seed);
    test.view_of_other=call(ctx,'viewFor',[clone(test.state),test.other_player_id],seed);
    test.expected_view_of_mover=call(ctx,'viewFor',[clone(test.expected_state),test.player_id],seed);
    test.expected_view_of_other=call(ctx,'viewFor',[clone(test.expected_state),test.other_player_id],seed);
  };
  if (tests.cases.length) tests.cases.forEach(updateViews);
  else tests.cases = makeSamples(kind,source,game,call,clone);
  return {code,tests};
}

function miniImage(caption,color) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" rx="8" fill="${color}"/><circle cx="80" cy="45" r="20" fill="#ffffff"/><path d="M58 45h44M80 23v44" stroke="#17324f" stroke-width="5"/></svg>`;
  return {caption,svg};
}

function makeSamples(kind,source,game,call,clone) {
  const count=Math.min(...source.allowed_player_counts);
  const players=Array.from({length:count},(_,i)=>({id:`archive_${i}`,kind:'human',
    display_name:['Ari','Bea','Cam','Dee'][i],picture_url:'',max_loss:0,active:true}));
  const ctx={players,pot:0,move_count:0,seed:11};
  const cases=[];
  let current=call(ctx,'newMatch',[],11);
  for(let step=0;step<1000;step++) {
    ctx.move_count=step;
    const mover=current.turn?.[0];
    if(!mover) throw new Error(`${kind}: no mover while deriving examples`);
    const move=call(ctx,game.computerMove?'computerMove':'randomMove',[clone(current.state),mover],17+step);
    const before=clone(current.state);
    const viewMover=call(ctx,'viewFor',[clone(before),mover],11+step);
    const viewOther=call(ctx,'viewFor',[clone(before),null],11+step);
    const result=call(ctx,'applyMove',[clone(before),mover,move],11+step);
    const category=step===0?'initial':result.turn===null?'terminal':step===1?'intermediate':null;
    if(category) {
      const caseCtx={players,pot:0,move_count:step,seed:11+step};
      const expectedCtx=clone(caseCtx);
      cases.push({name:{initial:'Opening move',intermediate:'Continuing match',terminal:'Finishing move'}[category],
        description:source.rules,kind:category,ctx:caseCtx,state:before,view_of_mover:viewMover,
        view_of_other:viewOther,player_id:mover,other_player_id:null,move,
        expected_state:result.state,expected_turn:result.turn,
        expected_view_of_mover:call(expectedCtx,'viewFor',[clone(result.state),mover],11+step),
        expected_view_of_other:call(expectedCtx,'viewFor',[clone(result.state),null],11+step),
        images:['Before: player','Before: spectator','After: player','After: spectator'].map((caption,i)=>
          miniImage(caption,['#17324f','#2770a8','#56c9b4','#ffbf66'][i])),
        ...(result.payouts?{expected_payouts:result.payouts}:{})});
    }
    if(result.turn===null) {
      if(cases.length!==3) throw new Error(`${kind}: expected initial, intermediate and terminal examples`);
      return cases;
    }
    current=result;
  }
  throw new Error(`${kind}: no terminal example within 1000 moves`);
}

function fallbackImages(kind) {
  const colors=['#17324f','#2770a8','#56c9b4','#ffbf66'];
  return colors.map((color,i)=>miniImage(['Cover','Initial position','Legal choices','Game in progress'][i],color));
}

function serverStrings(kind) {
  return ARCHIVE_SERVER[kind] || CUSTOM_SERVER[kind];
}

function translatedStrings(locale,title,kind) {
  const index=LOCALES.indexOf(locale);
  const strings=Object.fromEntries(Object.entries(ALL_STRINGS).map(([text,values])=>[STRING_KEYS[text],values[index]]));
  strings.title=title;
  Object.assign(strings,serverStrings(kind).locales[locale]);
  return strings;
}

function makeMissingTranslation(entry,locale) {
  const index=LOCALES.indexOf(locale);
  const values=CUSTOM[entry.kind].locales[locale];
  const [name,description,rules,ui,how] = values;
  const displayName=`${name} (${COPY.strings.Declarative[index]})`;
  const client=translatedStrings(locale,displayName,entry.kind);
  return {display_name:displayName,short_description:description,game_logic_rules:rules,game_ui_rules:ui,
    tutorial_strings:{'How to play':how,[CUSTOM[entry.kind].rules]:rules,[CUSTOM[entry.kind].ui]:ui},
    client_strings:client};
}

function build(entry) {
  const filename=path.join(OUT,`${entry.kind}.json`);
  const source=JSON.parse(fs.readFileSync(filename,'utf8'));
  const {code,tests}=addHints(entry.kind,source);
  const sourceTranslation=source.translations || {};
  const custom=CUSTOM[entry.kind];
  const rules=custom?.rules || source.rules;
  const ui=entry.kind === 'six_mens_morris' ? MORRIS_UI[0] :
    entry.kind === 'thirty_one' ? THIRTY_ONE_UI[0] :
      entry.kind === 'gobblet' ? GOBBLET_UI[0] :
        entry.kind === 'kisolo' ? KISOLO_UI[0] :
          entry.kind === 'mau_mau' ? MAU_MAU_UI[0] :
            entry.kind === 'dos' ? DOS_UI[0] : custom?.ui || source.ui_instructions;
  const description=custom?.description || source.description;
  const title=`${entry.title} (Declarative)`;
  const translations={};
  for(const locale of LOCALES) {
    const old=sourceTranslation[locale];
    if(custom && !old) {
      translations[locale]=makeMissingTranslation(entry,locale);
      continue;
    }
    if(!old) throw new Error(`${entry.kind}: missing ${locale} source translation`);
    const declarative=COPY.strings.Declarative[LOCALES.indexOf(locale)];
    const suffix=` (${declarative})`;
    const baseName=old.display_name.endsWith(suffix)
      ? old.display_name.slice(0,-suffix.length) : old.display_name;
    const displayName=`${baseName}${suffix}`;
    translations[locale]={...old,display_name:displayName,
      ...(entry.kind === 'six_mens_morris' ? {game_ui_rules:MORRIS_UI[LOCALES.indexOf(locale)+1]} : {}),
      ...(entry.kind === 'thirty_one' ? {game_ui_rules:THIRTY_ONE_UI[LOCALES.indexOf(locale)+1]} : {}),
      ...(entry.kind === 'gobblet' ? {game_ui_rules:GOBBLET_UI[LOCALES.indexOf(locale)+1]} : {}),
      ...(entry.kind === 'kisolo' ? {game_ui_rules:KISOLO_UI[LOCALES.indexOf(locale)+1]} : {}),
      ...(entry.kind === 'mau_mau' ? {game_ui_rules:MAU_MAU_UI[LOCALES.indexOf(locale)+1]} : {}),
      ...(entry.kind === 'dos' ? {game_ui_rules:DOS_UI[LOCALES.indexOf(locale)+1]} : {}),
      client_strings:translatedStrings(locale,displayName,entry.kind)};
  }
  const strings={...ENGLISH,title,...serverStrings(entry.kind).english};
  const layout=board(['thirty_one','mau_mau','dos'].includes(entry.kind) ? entry.kind : entry.board);
  const spec={format:'buildplay-ui',version:1,viewport:layout.viewport,boards:layout.boards,
    piece_types:typesFor(entry.kind),strings,
    ...(entry.kind === 'dos' ? {assets:dosAssets()} :
      entry.kind === 'gobblet' ? {assets:gobbletAssets()} :
        ['thirty_one','mau_mau'].includes(entry.kind) ? {assets:softCardAssets()} : {}),
    ui_code:`const KIND=${JSON.stringify(entry.kind)};\nconst SOURCE_STRINGS=${JSON.stringify({title})};\nconst SOURCE_KEYS=${JSON.stringify(STRING_KEYS)};\n`+(entry.kind === 'kisolo' ? compactUi() : UI)};
  const tutorial=custom ? {text:rules,html:`<meta name="viewport" content="width=device-width,initial-scale=1"><main><h1>How to play</h1><p>${rules}</p><p>${ui}</p></main>`} : source.tutorial;
  if(custom) {
    for(const locale of LOCALES) {
      const t=translations[locale];
      t.tutorial_strings={'How to play':CUSTOM[entry.kind].locales[locale][4],
        [rules]:CUSTOM[entry.kind].locales[locale][2],[ui]:CUSTOM[entry.kind].locales[locale][3]};
    }
  }
  const payload={
    all_state_public:['kisolo','gobblet','chutes_ladders','dots_boxes','six_mens_morris'].includes(entry.kind),
    name:title,description,allowed_player_counts:source.allowed_player_counts,
    allows_leave_mid_match:source.allows_leave_mid_match,allows_join_mid_match:source.allows_join_mid_match,
    server_code:code,rules,ui_instructions:ui,tutorial,
    images:!custom && source.images?.length>=4?source.images:fallbackImages(entry.kind),
    unit_tests:tests,translations,game_addition_request_id_and_secret:source.game_addition_request_id_and_secret,
    declarative_ui:spec
  };
  fs.writeFileSync(filename,JSON.stringify(payload,null,2)+'\n');
  console.log(`${entry.kind}: ${Buffer.byteLength(JSON.stringify(payload))} bytes; ${tests.cases.length} examples`);
}

const requested = process.argv.slice(2);
if (requested.some(kind => !ENTRIES.some(entry => entry.kind === kind)))
  throw new Error(`Unknown game kind: ${requested.join(', ')}`);
for(const entry of ENTRIES)
  if (!requested.length || requested.includes(entry.kind)) build(entry);
