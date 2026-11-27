"""Build the declarative Stitch & Time package (based on Patchwork).

Run from the package parent:
  python -m game_platform.tools.build_declarative_stitchtime
The checked-in submission secret is only an example; replace it when publishing.
"""
from __future__ import annotations

import base64
import colorsys
import copy
import html
import json
import math
import re
from pathlib import Path

from game_platform.game_logic import GameLogic
from game_platform.tools.game_alternative_names import reviewed_names

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'games' / 'declarative'
KIND = 'stitchtime'
CELL = 46
LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
TITLES = ['Stitch & Time', 'Puntada y Tiempo', 'Point & Temps', 'Stich & Zeit', 'Ponto & Tempo', '针线与时光', 'टाँका और समय', 'غرزة ووقت']
RULES = [
    'Based on Patchwork. Two players sew patches onto a 9×9 quilt. Whoever is behind on the time track takes the next turn (so a player may move several times in a row). On your turn either advance your token just past your rival and take 1 button per space, or buy one of the next three patches in the circle: pay its buttons, place it anywhere it fits (turned or mirrored), and move ahead by its time. Passing an income space pays you the buttons shown on your patches; passing a leather space gives you a 1×1 patch to place at once. The first to fill a 7×7 square earns 7 bonus points. When both reach the end, score buttons plus bonus minus 2 per empty square; on a tie the player who reached the end first wins.',
    'Basado en Patchwork. Dos jugadores cosen parches en una colcha de 9×9. Quien va detrás en el marcador de tiempo juega el siguiente turno (puede jugar varias veces seguidas). En tu turno avanza tu ficha justo delante de tu rival y toma 1 botón por casilla, o compra uno de los tres parches siguientes del círculo: paga sus botones, colócalo donde quepa (girado o volteado) y avanza su tiempo. Al pasar una casilla de ingresos cobras los botones de tus parches; al pasar una de cuero recibes un parche de 1×1 para colocar enseguida. El primero que llena un cuadrado de 7×7 gana 7 puntos extra. Cuando ambos llegan al final, se cuentan botones más bonificación menos 2 por casilla vacía; en caso de empate gana quien llegó antes al final.',
    'D’après Patchwork. Deux joueurs cousent des pièces sur un patchwork de 9×9. Celui qui est en retard sur la piste du temps joue le tour suivant (on peut jouer plusieurs fois de suite). À votre tour, avancez votre pion juste devant votre rival et prenez 1 bouton par case, ou achetez l’une des trois pièces suivantes du cercle : payez ses boutons, posez-la où elle tient (tournée ou retournée) et avancez de son temps. Passer une case de revenu vous rapporte les boutons de vos pièces ; passer une case de cuir vous donne une pièce 1×1 à poser aussitôt. Le premier à remplir un carré de 7×7 gagne 7 points bonus. Quand les deux sont arrivés, on compte boutons plus bonus moins 2 par case vide ; en cas d’égalité, celui arrivé le premier gagne.',
    'Nach Patchwork. Zwei Spieler nähen Flicken auf eine 9×9-Decke. Wer auf der Zeitleiste hinten liegt, ist als Nächstes dran (auch mehrmals hintereinander). In deinem Zug ziehst du deinen Stein direkt vor den Gegner und nimmst 1 Knopf pro Feld, oder du kaufst einen der nächsten drei Flicken im Kreis: Knöpfe zahlen, irgendwo passend legen (gedreht oder gespiegelt) und um seine Zeit vorrücken. Überquerst du ein Einkommensfeld, bekommst du die Knöpfe auf deinen Flicken; ein Lederfeld gibt dir sofort einen 1×1-Flicken. Wer zuerst ein 7×7-Quadrat füllt, erhält 7 Bonuspunkte. Am Ende zählen Knöpfe plus Bonus minus 2 pro leerem Feld; bei Gleichstand gewinnt, wer zuerst am Ziel war.',
    'Baseado em Patchwork. Dois jogadores costuram retalhos numa colcha de 9×9. Quem está atrás na trilha do tempo joga o turno seguinte (pode jogar várias vezes seguidas). Na sua vez, avance o seu marcador logo à frente do rival e pegue 1 botão por casa, ou compre um dos três retalhos seguintes do círculo: pague os botões, coloque-o onde couber (girado ou espelhado) e avance o seu tempo. Ao passar uma casa de renda recebe os botões dos seus retalhos; ao passar uma de couro recebe um retalho 1×1 para colocar logo. O primeiro a preencher um quadrado 7×7 ganha 7 pontos extras. Quando ambos chegam ao fim, conta-se botões mais bónus menos 2 por casa vazia; em empate vence quem chegou primeiro.',
    '改编自 Patchwork（拼布对决）。两位玩家在 9×9 的拼布板上缝补丁。时间轨上落后的玩家进行下一回合（可能连续行动多次）。轮到你时，要么把时间标记移到对手前一格，每前进一格拿 1 颗纽扣；要么从圆圈中接下来的三块补丁里买一块：支付纽扣，放在任意放得下的位置（可旋转或翻面），并按其时间前进。经过收入格时，按补丁上的纽扣数获得收入；经过皮革格时立即获得一块 1×1 补丁放上。最先填满 7×7 正方形的玩家得 7 分奖励。双方都到终点后，得分为纽扣加奖励减去每个空格 2 分；平分时先到终点者获胜。',
    'पैचवर्क पर आधारित। दो खिलाड़ी 9×9 रज़ाई पर पैबंद सिलते हैं। समय-पथ पर जो पीछे है, अगली बारी उसी की (कई बार लगातार भी)। अपनी बारी में या तो अपना मोहरा विरोधी से ठीक आगे बढ़ाएँ और हर खाने के लिए 1 बटन लें, या घेरे में अगले तीन पैबंदों में से एक ख़रीदें: बटन चुकाएँ, जहाँ समाए वहाँ रखें (घुमाकर या उलटकर), और उसके समय जितना आगे बढ़ें। आय-खाने से गुज़रने पर अपने पैबंदों के बटन मिलते हैं; चमड़े के खाने से गुज़रने पर तुरंत रखने के लिए 1×1 पैबंद मिलता है। जो पहले 7×7 वर्ग भरे उसे 7 बोनस अंक। दोनों अंत तक पहुँचें तो अंक = बटन + बोनस − हर ख़ाली खाने के 2; बराबरी में पहले पहुँचने वाला जीतता है।',
    'مبنية على Patchwork. لاعبان يخيطان رقعًا على لحاف 9×9. من يتأخر على مسار الوقت يلعب الدور التالي (وقد يلعب عدة مرات متتالية). في دورك إما أن تقدم علامتك إلى ما بعد خصمك مباشرة وتأخذ زرًا عن كل خانة، أو تشتري إحدى الرقع الثلاث التالية في الدائرة: تدفع أزرارها وتضعها حيث تتسع (مدوّرة أو مقلوبة) وتتقدم بقدر وقتها. عند تجاوز خانة الدخل تأخذ أزرار رقعك؛ وعند تجاوز خانة الجلد تأخذ رقعة 1×1 تضعها فورًا. أول من يملأ مربعًا 7×7 ينال 7 نقاط إضافية. عند وصول الاثنين للنهاية تُحسب الأزرار مع المكافأة ناقص 2 عن كل خانة فارغة؛ وعند التعادل يفوز من وصل أولًا.',
]
UI_RULES = [
    'Tap one of the three patch cards: a ghost of it appears on your quilt in a good spot. Tap a square to move it there, turn it with ↺ ↻ and mirror it with ⇋ (or select your patch in the toolbar and press R, Shift+R or F), then press ✓. Or press Advance to move just past your rival for buttons. Use “Rival’s quilt” to look at the other quilt.',
    'Toca una de las tres cartas de parche: aparece una sombra en tu colcha en un buen sitio. Toca una casilla para moverla, gírala con ↺ ↻ y voltéala con ⇋ (o selecciona tu parche en la barra y pulsa R, Mayús+R o F), y pulsa ✓. O pulsa Avanzar para pasar a tu rival y ganar botones. Usa «Colcha rival» para ver la otra colcha.',
    'Touchez l’une des trois cartes de pièce : son ombre apparaît sur votre patchwork à un bon endroit. Touchez une case pour la déplacer, tournez-la avec ↺ ↻ et retournez-la avec ⇋ (ou sélectionnez votre pièce dans la barre et appuyez sur R, Maj+R ou F), puis ✓. Ou appuyez sur Avancer pour dépasser votre rival contre des boutons. « Patchwork rival » montre l’autre patchwork.',
    'Tippe auf eine der drei Flickenkarten: Ein Schatten erscheint an einer guten Stelle deiner Decke. Tippe auf ein Feld, um ihn dorthin zu schieben, drehe mit ↺ ↻ und spiegle mit ⇋ (oder wähle deinen Flicken in der Leiste und drücke R, Umschalt+R oder F), dann ✓. Oder drücke Vorrücken, um für Knöpfe am Gegner vorbeizuziehen. „Decke des Gegners“ zeigt die andere Decke.',
    'Toque numa das três cartas de retalho: aparece uma sombra na sua colcha num bom lugar. Toque numa casa para movê-la, gire com ↺ ↻ e espelhe com ⇋ (ou selecione o retalho na barra e pressione R, Shift+R ou F) e pressione ✓. Ou pressione Avançar para passar o rival e ganhar botões. Use «Colcha rival» para ver a outra colcha.',
    '点击三张补丁卡之一：它的虚影会出现在你拼布板的合适位置。点击格子移动它，用 ↺ ↻ 旋转、⇋ 翻面（或在工具栏选中补丁后按 R、Shift+R 或 F），然后按 ✓。也可以按“前进”越过对手换取纽扣。用“对手的拼布”查看另一块拼布。',
    'तीन पैबंद-कार्डों में से किसी को छुएँ: रज़ाई पर अच्छी जगह उसकी छाया दिखेगी। खाना छूकर उसे खिसकाएँ, ↺ ↻ से घुमाएँ और ⇋ से उलटें (या टूलबार में पैबंद चुनकर R, Shift+R या F दबाएँ), फिर ✓ दबाएँ। या बटनों के लिए विरोधी से आगे जाने को आगे बढ़ें दबाएँ। “विरोधी की रज़ाई” से दूसरी रज़ाई देखें।',
    'المس إحدى بطاقات الرقع الثلاث: يظهر ظلها على لحافك في مكان مناسب. المس خانة لتحريكها، وأدرها بـ ↺ ↻ واقلبها بـ ⇋ (أو حدد رقعتك في الشريط واضغط R أو Shift+R أو F)، ثم اضغط ✓. أو اضغط تقدّم لتتجاوز خصمك مقابل أزرار. استخدم «لحاف الخصم» لرؤية اللحاف الآخر.',
]
TEXTS = {
    'amber': ['Amber', 'Ámbar', 'Ambre', 'Bernstein', 'Âmbar', '琥珀', 'अंबर', 'كهرماني'],
    'jade': ['Jade', 'Jade', 'Jade', 'Jade', 'Jade', '翠玉', 'जेड', 'يشمي'],
    'seat_name': ['{color} · {name}'] * 8,
    'you': ['{name} (you)', '{name} (tú)', '{name} (vous)', '{name} (du)', '{name} (você)', '{name}（你）', '{name} (आप)', '{name} (أنت)'],
    'player': ['Player {n}', 'Jugador {n}', 'Joueur {n}', 'Spieler {n}', 'Jogador {n}', '玩家{n}', 'खिलाड़ी {n}', 'اللاعب {n}'],
    'leather': ['Leather patch', 'Parche de cuero', 'Pièce de cuir', 'Lederflicken', 'Retalho de couro', '皮革补丁', 'चमड़े का पैबंद', 'رقعة جلد'],
    'patch_name': ['Patch of {n} squares', 'Parche de {n} casillas', 'Pièce de {n} cases', 'Flicken mit {n} Feldern', 'Retalho de {n} casas', '{n} 格补丁', '{n} खानों का पैबंद', 'رقعة من {n} خانات'],
    'quilt_of': ['Quilt of {name}', 'Colcha de {name}', 'Patchwork de {name}', 'Decke von {name}', 'Colcha de {name}', '{name}的拼布', '{name} की रज़ाई', 'لحاف {name}'],
    'buy_label': ['Choose this patch: {cost} buttons, {time} time, +{income} income', 'Elegir este parche: {cost} botones, {time} de tiempo, +{income} de ingresos', 'Choisir cette pièce : {cost} boutons, {time} de temps, +{income} de revenu', 'Diesen Flicken wählen: {cost} Knöpfe, {time} Zeit, +{income} Einkommen', 'Escolher este retalho: {cost} botões, {time} de tempo, +{income} de renda', '选择这块补丁：{cost} 纽扣，时间 {time}，收入 +{income}', 'यह पैबंद चुनें: {cost} बटन, {time} समय, +{income} आय', 'اختر هذه الرقعة: {cost} أزرار، وقت {time}، دخل +{income}'],
    'cannot_afford': ['Too expensive: {cost} buttons, {time} time, +{income} income', 'Demasiado caro: {cost} botones, {time} de tiempo, +{income}', 'Trop cher : {cost} boutons, {time} de temps, +{income}', 'Zu teuer: {cost} Knöpfe, {time} Zeit, +{income}', 'Caro demais: {cost} botões, {time} de tempo, +{income}', '买不起：{cost} 纽扣，时间 {time}，收入 +{income}', 'बहुत महँगा: {cost} बटन, {time} समय, +{income}', 'باهظة: {cost} أزرار، وقت {time}، +{income}'],
    'price_line': ['◉ {cost}   ⧗ {time}   +{income}', '◉ {cost}   ⧗ {time}   +{income}', '◉ {cost}   ⧗ {time}   +{income}', '◉ {cost}   ⧗ {time}   +{income}', '◉ {cost}   ⧗ {time}   +{income}', '◉ {cost}   ⧗ {time}   +{income}', '◉ {cost}   ⧗ {time}   +{income}', '◉ {cost}   ⧗ {time}   +{income}'],
    'circle_left': ['{count} more in the circle', '{count} más en el círculo', 'encore {count} dans le cercle', 'noch {count} im Kreis', 'mais {count} no círculo', '圆圈中还有 {count} 块', 'घेरे में {count} और', '{count} أخرى في الدائرة'],
    'leather_here': ['Place the leather patch on square {square}', 'Colocar el cuero en la casilla {square}', 'Poser le cuir sur la case {square}', 'Lederflicken auf Feld {square}', 'Colocar o couro na casa {square}', '把皮革补丁放在第 {square} 格', 'चमड़ा खाना {square} पर रखें', 'ضع الجلد على الخانة {square}'],
    'hint_leather': ['Tap an empty square for your leather patch', 'Toca una casilla vacía para tu parche de cuero', 'Touchez une case vide pour votre pièce de cuir', 'Tippe auf ein leeres Feld für deinen Lederflicken', 'Toque numa casa vazia para o retalho de couro', '点击空格放皮革补丁', 'चमड़े के पैबंद के लिए ख़ाली खाना छुएँ', 'المس خانة فارغة لرقعة الجلد'],
    'ghost_ok': ['Your patch of {n} squares fits here', 'Tu parche de {n} casillas cabe aquí', 'Votre pièce de {n} cases tient ici', 'Dein Flicken mit {n} Feldern passt hier', 'Seu retalho de {n} casas cabe aqui', '你的 {n} 格补丁可以放这里', 'आपका {n} खानों का पैबंद यहाँ समाता है', 'رقعتك من {n} خانات تتسع هنا'],
    'ghost_bad': ['Your patch of {n} squares does not fit here', 'Tu parche de {n} casillas no cabe aquí', 'Votre pièce de {n} cases ne tient pas ici', 'Dein Flicken mit {n} Feldern passt hier nicht', 'Seu retalho de {n} casas não cabe aqui', '你的 {n} 格补丁放不下', 'आपका {n} खानों का पैबंद यहाँ नहीं समाता', 'رقعتك من {n} خانات لا تتسع هنا'],
    'move_here': ['Move the patch to square {square}', 'Mover el parche a la casilla {square}', 'Déplacer la pièce en case {square}', 'Flicken auf Feld {square} schieben', 'Mover o retalho para a casa {square}', '把补丁移到第 {square} 格', 'पैबंद खाना {square} पर ले जाएँ', 'انقل الرقعة إلى الخانة {square}'],
    'your_patch': ['Your patch of {n} squares', 'Tu parche de {n} casillas', 'Votre pièce de {n} cases', 'Dein Flicken mit {n} Feldern', 'Seu retalho de {n} casas', '你的 {n} 格补丁', 'आपका {n} खानों का पैबंद', 'رقعتك من {n} خانات'],
    'rotate_cw': ['Turn patch clockwise', 'Girar parche en sentido horario', 'Tourner la pièce dans le sens horaire', 'Flicken im Uhrzeigersinn drehen', 'Girar retalho no sentido horário', '顺时针旋转补丁', 'पैबंद घड़ी की दिशा में घुमाएँ', 'أدر الرقعة باتجاه عقارب الساعة'],
    'rotate_ccw': ['Turn patch counterclockwise', 'Girar parche en sentido antihorario', 'Tourner la pièce dans le sens antihoraire', 'Flicken gegen den Uhrzeigersinn drehen', 'Girar retalho no sentido anti-horário', '逆时针旋转补丁', 'पैबंद घड़ी की उल्टी दिशा में घुमाएँ', 'أدر الرقعة عكس عقارب الساعة'],
    'mirror': ['Mirror patch', 'Voltear parche', 'Retourner la pièce', 'Flicken spiegeln', 'Espelhar retalho', '翻转补丁', 'पैबंद उलटें', 'اقلب الرقعة'],
    'place_label': ['Place patch', 'Colocar parche', 'Poser la pièce', 'Flicken legen', 'Colocar retalho', '放置补丁', 'पैबंद रखें', 'ضع الرقعة'],
    'cancel': ['Cancel', 'Cancelar', 'Annuler', 'Abbrechen', 'Cancelar', '取消', 'रद्द करें', 'إلغاء'],
    'hint_place': ['Tap a square to move it, ↺ ⇋ ↻ to turn or mirror, then ✓', 'Toca una casilla para moverlo, ↺ ⇋ ↻ para girar o voltear, y ✓', 'Touchez une case pour la déplacer, ↺ ⇋ ↻ pour tourner, puis ✓', 'Feld antippen zum Schieben, ↺ ⇋ ↻ zum Drehen, dann ✓', 'Toque numa casa para mover, ↺ ⇋ ↻ para girar, depois ✓', '点格子移动，↺ ⇋ ↻ 旋转或翻面，再按 ✓', 'खिसकाने को खाना छुएँ, ↺ ⇋ ↻ घुमाने को, फिर ✓', 'المس خانة لتحريكها، ↺ ⇋ ↻ للتدوير، ثم ✓'],
    'hint_blocked': ['It does not fit there: move, turn or mirror it', 'No cabe ahí: muévelo, gíralo o voltéalo', 'Elle ne tient pas : déplacez, tournez ou retournez', 'Passt dort nicht: schieben, drehen oder spiegeln', 'Não cabe aí: mova, gire ou espelhe', '这里放不下：移动、旋转或翻面', 'यहाँ नहीं समाता: खिसकाएँ, घुमाएँ या उलटें', 'لا تتسع هنا: حرّكها أو أدرها أو اقلبها'],
    'advance_button': ['Advance (+{count} buttons)', 'Avanzar (+{count} botones)', 'Avancer (+{count} boutons)', 'Vorrücken (+{count} Knöpfe)', 'Avançar (+{count} botões)', '前进（+{count} 纽扣）', 'आगे बढ़ें (+{count} बटन)', 'تقدّم (+{count} أزرار)'],
    'advance_label': ['Advance past your rival for {count} buttons', 'Avanzar más allá de tu rival por {count} botones', 'Avancer devant votre rival pour {count} boutons', 'Am Gegner vorbei für {count} Knöpfe', 'Avançar além do rival por {count} botões', '越过对手，获得 {count} 颗纽扣', 'विरोधी से आगे बढ़ें, {count} बटन लें', 'تقدّم بعد خصمك مقابل {count} أزرار'],
    'hint_pick': ['Tap a patch card, or advance for buttons', 'Toca una carta de parche o avanza por botones', 'Touchez une carte de pièce ou avancez pour des boutons', 'Tippe auf eine Flickenkarte oder rücke für Knöpfe vor', 'Toque numa carta de retalho ou avance por botões', '点补丁卡，或前进换纽扣', 'पैबंद कार्ड छुएँ, या बटनों के लिए आगे बढ़ें', 'المس بطاقة رقعة أو تقدّم مقابل أزرار'],
    'my_quilt': ['My quilt', 'Mi colcha', 'Mon patchwork', 'Meine Decke', 'Minha colcha', '我的拼布', 'मेरी रज़ाई', 'لحافي'],
    'rival_quilt': ['Rival’s quilt', 'Colcha rival', 'Patchwork rival', 'Decke des Gegners', 'Colcha rival', '对手的拼布', 'विरोधी की रज़ाई', 'لحاف الخصم'],
    'leather_turn': ['{name}: place your leather patch', '{name}: coloca tu cuero', '{name} : posez votre cuir', '{name}: Lederflicken legen', '{name}: coloque o couro', '{name}：放置皮革补丁', '{name}: चमड़े का पैबंद रखें', '{name}: ضع رقعة الجلد'],
    'your_turn': ['{name}: your turn', '{name}: tu turno', '{name} : à vous', '{name}: du bist dran', '{name}: sua vez', '{name}：轮到你', '{name}: आपकी बारी', '{name}: دورك'],
    'waiting': ['Waiting for {name}', 'Esperando a {name}', 'En attente de {name}', 'Warten auf {name}', 'Aguardando {name}', '等待{name}', '{name} की प्रतीक्षा', 'بانتظار {name}'],
    'viewing_rival': ['Looking at the quilt of {name}', 'Viendo la colcha de {name}', 'Patchwork de {name}', 'Decke von {name}', 'Vendo a colcha de {name}', '正在看{name}的拼布', '{name} की रज़ाई देख रहे हैं', 'تشاهد لحاف {name}'],
    'wins': ['{name} wins with {score}!', '¡Gana {name} con {score}!', '{name} gagne avec {score} !', '{name} gewinnt mit {score}!', '{name} venceu com {score}!', '{name}以{score}分获胜！', '{name} {score} अंकों से जीते!', 'فاز {name} بـ{score}!'],
    'score_line': ['{name}: {buttons} buttons + {bonus} bonus − {empty} = {total}', '{name}: {buttons} botones + {bonus} − {empty} = {total}', '{name} : {buttons} boutons + {bonus} − {empty} = {total}', '{name}: {buttons} Knöpfe + {bonus} − {empty} = {total}', '{name}: {buttons} botões + {bonus} − {empty} = {total}', '{name}：{buttons} 纽扣 + {bonus} − {empty} = {total}', '{name}: {buttons} बटन + {bonus} − {empty} = {total}', '{name}: {buttons} أزرار + {bonus} − {empty} = {total}'],
    'tie_break': ['Tie: the first to reach the end wins', 'Empate: gana quien llegó antes al final', 'Égalité : le premier arrivé gagne', 'Gleichstand: wer zuerst am Ziel war, gewinnt', 'Empate: vence quem chegou primeiro', '平分：先到终点者获胜', 'बराबरी: पहले पहुँचने वाला जीता', 'تعادل: يفوز من وصل أولًا'],
    'hint_over': ['Score: buttons + 7 for a full 7×7 − 2 per empty square', 'Puntos: botones + 7 por un 7×7 − 2 por casilla vacía', 'Score : boutons + 7 pour un 7×7 − 2 par case vide', 'Punkte: Knöpfe + 7 für 7×7 − 2 pro leerem Feld', 'Pontos: botões + 7 por um 7×7 − 2 por casa vazia', '得分：纽扣 + 7×7 奖励 7 − 每空格 2', 'अंक: बटन + 7×7 के 7 − हर ख़ाली खाने के 2', 'النقاط: الأزرار + 7 لمربع 7×7 − 2 لكل خانة فارغة'],
    'info_line': ['{name}: {buttons}◉ · +{income} · {pos}/53', '{name}: {buttons}◉ · +{income} · {pos}/53', '{name} : {buttons}◉ · +{income} · {pos}/53', '{name}: {buttons}◉ · +{income} · {pos}/53', '{name}: {buttons}◉ · +{income} · {pos}/53', '{name}：{buttons}◉ · +{income} · {pos}/53', '{name}: {buttons}◉ · +{income} · {pos}/53', '{name}: {buttons}◉ · +{income} · {pos}/53'],
    'server_two_players': ['two players required', 'se necesitan dos jugadores', 'deux joueurs requis', 'zwei Spieler nötig', 'são necessários dois jogadores', '需要两名玩家', 'दो खिलाड़ी चाहिए', 'يلزم لاعبان'],
    'server_unknown_player': ['unknown player', 'jugador desconocido', 'joueur inconnu', 'unbekannter Spieler', 'jogador desconhecido', '未知玩家', 'अज्ञात खिलाड़ी', 'لاعب غير معروف'],
    'server_game_over': ['game over', 'partida terminada', 'partie terminée', 'Spiel beendet', 'jogo encerrado', '游戏结束', 'खेल समाप्त', 'انتهت اللعبة'],
    'server_not_your_turn': ['not your turn', 'no es tu turno', 'ce n’est pas votre tour', 'du bist nicht dran', 'não é sua vez', '未轮到你', 'आपकी बारी नहीं', 'ليس دورك'],
    'server_leather': ['place your leather patch on an empty square', 'coloca tu cuero en una casilla vacía', 'posez votre cuir sur une case vide', 'lege deinen Lederflicken auf ein leeres Feld', 'coloque o couro numa casa vazia', '把皮革补丁放在空格上', 'चमड़े का पैबंद ख़ाली खाने पर रखें', 'ضع الجلد على خانة فارغة'],
    'server_patched': ['that square is already patched', 'esa casilla ya tiene parche', 'cette case est déjà couverte', 'dieses Feld ist schon belegt', 'essa casa já tem retalho', '该格已有补丁', 'उस खाने पर पहले से पैबंद है', 'هذه الخانة مرقّعة بالفعل'],
    'server_next_three': ['choose one of the next three patches', 'elige uno de los tres parches siguientes', 'choisissez l’une des trois pièces suivantes', 'wähle einen der nächsten drei Flicken', 'escolha um dos três retalhos seguintes', '请从接下来的三块补丁中选择', 'अगले तीन पैबंदों में से चुनें', 'اختر إحدى الرقع الثلاث التالية'],
    'server_buttons': ['not enough buttons', 'no tienes suficientes botones', 'pas assez de boutons', 'nicht genug Knöpfe', 'botões insuficientes', '纽扣不够', 'बटन काफ़ी नहीं', 'الأزرار غير كافية'],
    'server_fit': ['the patch does not fit there', 'el parche no cabe ahí', 'la pièce ne tient pas là', 'der Flicken passt dort nicht', 'o retalho não cabe aí', '补丁放不下', 'पैबंद वहाँ नहीं समाता', 'الرقعة لا تتسع هناك'],
}


def strings(index=0):
    return {'title': TITLES[index], **{key: values[index] for key, values in TEXTS.items()}}


def patches():
    code = (DEST / f'{KIND}.server.js').read_text()
    body = code[code.index('var ST_PATCHES = ['):code.index('];', code.index('var ST_PATCHES'))]
    return [{'cost': int(a), 'time': int(b), 'income': int(c), 'rows': json.loads(r.replace("'", '"'))}
            for a, b, c, r in re.findall(r"\{cost: (\d+), time: (\d+), income: (\d+), rows: (\[.*?\])\}", body)]


PLACED = {'type': 'object', 'additionalProperties': False, 'required': ['p', 'o', 'x', 'y'],
          'properties': {'p': {'type': 'integer', 'minimum': 0, 'maximum': 33}, 'o': {'type': 'integer', 'minimum': 0, 'maximum': 7},
                         'x': {'type': 'integer', 'minimum': 0, 'maximum': 8}, 'y': {'type': 'integer', 'minimum': 0, 'maximum': 8}}}
PAIR = {'type': 'array', 'minItems': 2, 'maxItems': 2, 'items': {'type': 'integer'}}
COMMON = {
    'phase': {'enum': ['play', 'over']},
    'circle': {'type': 'array', 'maxItems': 33, 'items': {'type': 'integer', 'minimum': 0, 'maximum': 32}},
    'pos': PAIR, 'top': {'type': 'integer', 'minimum': 0, 'maximum': 1}, 'buttons': PAIR, 'income': PAIR,
    # Quilt squares are not checked one by one (81 per quilt on every call).
    'quilts': {'type': 'array', 'minItems': 2, 'maxItems': 2, 'items': {'type': 'array', 'minItems': 81, 'maxItems': 81}},
    'placed': {'type': 'array', 'minItems': 2, 'maxItems': 2, 'items': {'type': 'array', 'items': PLACED}},
    'leather': {'type': 'array', 'items': {'type': 'integer'}}, 'pending': PAIR,
    'bonus': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 1},
    'first_end': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 1},
    'winner': {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 1},
    'scores': {'type': ['array', 'null'], 'items': {'type': 'integer'}},
    'turn_no': {'type': 'integer', 'minimum': 0}, 'last': {'type': ['object', 'null']},
}
SCHEMAS = {
    'state': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'additionalProperties': False,
              'required': list(COMMON), 'properties': COMMON},
    'move': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'oneOf': [
        {'type': 'object', 'additionalProperties': False, 'required': ['advance'], 'properties': {'advance': {'const': True}}},
        {'type': 'object', 'additionalProperties': False, 'required': ['leather'], 'properties': {'leather': {'type': 'integer'}}},
        {'type': 'object', 'additionalProperties': False, 'required': ['buy', 'o', 'x', 'y'],
         'properties': {'buy': {'type': 'integer', 'minimum': 0, 'maximum': 2}, 'o': {'type': 'integer', 'minimum': 0, 'maximum': 7},
                        'x': {'type': 'integer', 'minimum': 0, 'maximum': 8}, 'y': {'type': 'integer', 'minimum': 0, 'maximum': 8}}}]},
    'view': {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'type': 'object', 'additionalProperties': False,
             'required': list(COMMON) + ['me', 'turn'],
             'properties': {**COMMON, 'me': {'type': 'integer', 'minimum': -1, 'maximum': 1}, 'turn': {'type': ['integer', 'null'], 'minimum': -1, 'maximum': 1}}},
}


def schemas():
    return copy.deepcopy(SCHEMAS)


# ---- art ---------------------------------------------------------------------
SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="{0}">'


def fabric(index):
    """An original fabric colour and pattern for each patch."""
    hue = (index * 0.618034) % 1
    r, g, b = colorsys.hls_to_rgb(hue, 0.55, 0.5)
    base = '#%02x%02x%02x' % (int(r * 255), int(g * 255), int(b * 255))
    r2, g2, b2 = colorsys.hls_to_rgb(hue, 0.4, 0.5)
    dark = '#%02x%02x%02x' % (int(r2 * 255), int(g2 * 255), int(b2 * 255))
    return base, dark, index % 3


def cell_svg(index, button):
    """One square of a patch's fabric (patches are drawn square by square, so
    any turn or mirror needs no extra pictures), optionally with a button."""
    if index == 33:
        base, dark, kind = '#8a5a36', '#5e3a20', 3
    else:
        base, dark, kind = fabric(index)
    c = CELL
    body = [f'<rect x="1" y="1" width="{c - 2}" height="{c - 2}" rx="5" fill="{base}"/>']
    if kind == 0:
        body.append(f'<path d="M6 14h{c - 12}M6 23h{c - 12}M6 32h{c - 12}" stroke="{dark}" stroke-width="3" stroke-opacity=".55"/>')
    elif kind == 1:
        body.append(''.join(f'<circle cx="{cx}" cy="{cy}" r="3" fill="{dark}" fill-opacity=".6"/>' for cx in (13, 33) for cy in (13, 33)))
    elif kind == 2:
        body.append(f'<path d="M8 8l{c - 16} {c - 16}M{c - 8} 8l-{c - 16} {c - 16}" stroke="{dark}" stroke-width="3" stroke-opacity=".5"/>')
    else:
        body.append(f'<rect x="7" y="7" width="{c - 14}" height="{c - 14}" rx="4" fill="none" stroke="#d9b48a" stroke-width="2" stroke-dasharray="4 3"/>')
    body.append(f'<rect x="3.5" y="3.5" width="{c - 7}" height="{c - 7}" rx="4" fill="none" stroke="#fff6e0" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="4 3"/>')
    if button:
        h = c / 2
        body.append(f'<circle cx="{h}" cy="{h}" r="9" fill="#3b6fd6" stroke="#1d3f86" stroke-width="2"/>'
                    + ''.join(f'<circle cx="{h + dx}" cy="{h + dy}" r="1.6" fill="#dfe8ff"/>' for dx in (-3, 3) for dy in (-3, 3)))
    return SVG.format(f'0 0 {c} {c}') + ''.join(body) + '</svg>'


SPOOL = (SVG.format('0 0 64 64') + '<rect x="2" y="2" width="60" height="60" rx="10" fill="#3a2c22" stroke="#e9c46a" stroke-width="3"/>'
         '<rect x="18" y="12" width="28" height="6" rx="2" fill="#c08a52"/><rect x="18" y="46" width="28" height="6" rx="2" fill="#c08a52"/>'
         '<rect x="22" y="18" width="20" height="28" fill="#ff6f91"/><path d="M22 24h20M22 30h20M22 36h20M22 42h20" stroke="#c94a6c" stroke-width="2"/></svg>')


def quilt_svg():
    parts = [SVG.format('0 0 414 414'), '<rect width="414" height="414" rx="8" fill="#3a2c22"/>']
    for r in range(9):
        for c in range(9):
            parts.append(f'<rect x="{c * 46 + 2}" y="{r * 46 + 2}" width="42" height="42" rx="4" fill="#4a3a2d" stroke="#5c4a3a" stroke-dasharray="3 3"/>')
    parts.append('</svg>')
    return ''.join(parts)


def arrow_svg(clockwise):
    cx = cy = 36
    r = 17
    m = 1 if clockwise else -1
    start = (cx - m * r, cy)
    theta = math.radians(45)
    end = (cx + m * r * math.cos(theta), cy + r * math.sin(theta))
    d = (-m * math.sin(theta), math.cos(theta))
    perp = (d[1], -d[0])
    tip = (end[0] + d[0] * 9, end[1] + d[1] * 9)
    a = (end[0] + perp[0] * 8, end[1] + perp[1] * 8)
    b = (end[0] - perp[0] * 8, end[1] - perp[1] * 8)
    f = lambda p: f'{p[0]:.1f} {p[1]:.1f}'
    return (SVG.format('0 0 72 72') + '<circle cx="36" cy="36" r="33" fill="#3a2c22" stroke="#e9c46a" stroke-width="3"/>'
            f'<path d="M{f(start)}A{r} {r} 0 1 {1 if clockwise else 0} {f(end)}" fill="none" stroke="#ffe9b0" stroke-width="6" stroke-linecap="round"/>'
            f'<path d="M{f(tip)}L{f(a)}L{f(b)}Z" fill="#ffe9b0"/></svg>')


MIRROR = (SVG.format('0 0 72 72') + '<circle cx="36" cy="36" r="33" fill="#3a2c22" stroke="#e9c46a" stroke-width="3"/>'
          '<path d="M36 16v40" stroke="#ffe9b0" stroke-width="3" stroke-dasharray="4 4"/>'
          '<path d="M31 24l-13 12l13 12zM41 24l13 12l-13 12z" fill="#ffe9b0"/></svg>')
PLACE_OK = (SVG.format('0 0 72 72') + '<circle cx="36" cy="36" r="33" fill="#2f6b3a" stroke="#9dff9f" stroke-width="3"/>'
            '<path d="M21 37l10 10l20-22" fill="none" stroke="#eaffea" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>')
CARD = SVG.format('0 0 190 124') + '<rect x="2" y="2" width="186" height="120" rx="12" fill="none" stroke="#e9c46a" stroke-width="3" stroke-dasharray="9 6"/></svg>'
CARD_ON = SVG.format('0 0 190 124') + '<rect x="2" y="2" width="186" height="120" rx="12" fill="#e9c46a" fill-opacity=".14" stroke="#fff1c4" stroke-width="5"/></svg>'
SPOT = SVG.format('0 0 46 46') + '<rect x="5" y="5" width="36" height="36" rx="6" fill="#e9c46a" fill-opacity=".2" stroke="#e9c46a" stroke-width="2.5" stroke-dasharray="5 4"/></svg>'
CLEAR = SVG.format('0 0 10 10') + '<rect width="10" height="10" fill="#ffffff" fill-opacity=".01"/></svg>'


def uri(svg):
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


def asset(svg):
    return {'uri': uri(svg), 'media_type': 'image/svg+xml'}


def specification():
    assets = {'quiltart': asset(quilt_svg()), 'card': asset(CARD), 'card_on': asset(CARD_ON), 'spot': asset(SPOT), 'clear': asset(CLEAR),
              'rot_cw': asset(arrow_svg(True)), 'rot_ccw': asset(arrow_svg(False)), 'mirror': asset(MIRROR), 'place_ok': asset(PLACE_OK),
              'spool': asset(SPOOL)}
    for i in range(34):
        assets[f'f{i}'] = asset(cell_svg(i, False))
        assets[f'b{i}'] = asset(cell_svg(i, True))
    types = {'quiltart': {'shape': 'image', 'width': 414, 'height': 414, 'asset': 'quiltart'},
             'sq': {'shape': 'image', 'width': CELL - 2, 'height': CELL - 2, 'asset': 'f0'},
             'handle': {'shape': 'image', 'width': 64, 'height': 64, 'asset': 'spool', 'action_outline': 'rect'}}
    server = (DEST / f'{KIND}.server.js').read_text()
    shared = server[server.index('// ---- shared rules'):server.index('// ---- end shared rules ----')]
    return {'format': 'buildplay-ui', 'version': 1, 'viewport': {'width': 600, 'height': 880},
            'motion': {'move_ms': 600, 'turn_pause_ms': 450},
            'assets': assets,
            'boards': [
                {'id': 'hud', 'kind': 'zone', 'x': 0, 'y': 0, 'width': 600, 'height': 96, 'color': '#241a14', 'line_color': '#241a14'},
                {'id': 'track', 'kind': 'zone', 'x': 0, 'y': 96, 'width': 600, 'height': 44, 'color': '#2c2119', 'line_color': '#2c2119'},
                {'id': 'market', 'kind': 'zone', 'x': 0, 'y': 140, 'width': 600, 'height': 190, 'color': '#241a14', 'line_color': '#241a14'},
                {'id': 'quilt', 'kind': 'grid', 'x': 93, 'y': 336, 'width': 414, 'height': 414, 'rows': 9, 'columns': 9,
                 'color': '#3a2c22', 'alternate_color': '#3a2c22', 'line_color': '#3a2c22'},
                {'id': 'tools', 'kind': 'zone', 'x': 0, 'y': 756, 'width': 600, 'height': 124, 'color': '#241a14', 'line_color': '#241a14'}],
            'piece_types': types,
            'strings': strings(),
            'ui_code': 'const SOURCE_STRINGS=' + json.dumps(strings(), ensure_ascii=False) + ';\n' + shared + '\n' +
                       (DEST / f'{KIND}.ui.js').read_text()}


# ---- unit test cases ----------------------------------------------------------
def illustration(view, caption):
    parts = [SVG.format('0 0 400 220'), '<rect width="400" height="220" fill="#241a14"/>']
    # One path per colour keeps the picture small.
    runs = {}
    for seat, quilt in enumerate(view['quilts']):
        ox = 14 + seat * 196
        for i, c in enumerate(quilt):
            x, y = ox + (i % 9) * 20, 14 + (i // 9) * 20
            fill = '#4a3a2d' if c < 0 else '#8a5a36' if c == 33 else fabric(c)[0]
            runs.setdefault(fill, []).append(f'M{x} {y}h19v19h-19z')
    for fill, d in runs.items():
        parts.append(f'<path d="{"".join(d)}" fill="{fill}"/>')
    parts.append('</svg>')
    return {'caption': caption, 'svg': ''.join(parts)}


def players():
    return [{'id': f'u{i + 1}', 'kind': 'human', 'display_name': n, 'picture_url': '', 'max_loss': 0, 'active': True}
            for i, n in enumerate(['Alice', 'Bob'])]


def play(logic, seed, chooser='computerMove'):
    ctx = {'players': players(), 'pot': 0, 'move_count': 0}
    result = logic.call('newMatch', ctx=ctx, seed=seed)
    steps = []
    for i in range(400):
        ctx['move_count'] = i
        state, pid, s = result['state'], result['turn'][0], seed * 1000 + i
        move = logic.call(chooser, state, pid, ctx=ctx, seed=s)
        result = logic.call('applyMove', state, pid, move, ctx=ctx, seed=s)
        steps.append((copy.deepcopy(ctx), state, pid, move, result, s))
        if result['turn'] is None:
            return steps
    raise RuntimeError('Stitch & Time did not finish')


def package():
    code = (DEST / f'{KIND}.server.js').read_text()
    game_schemas = schemas()
    logic = GameLogic(code, game_schemas=game_schemas)
    steps = play(logic, 4)
    first = lambda pred: next(s for s in steps if pred(s))
    selected = [('initial', 'The first turn', steps[0]),
                ('intermediate', 'Buying a patch: pay buttons, place it, move ahead', first(lambda s: 'buy' in s[3])),
                ('intermediate', 'Advancing past the rival earns a button per space', first(lambda s: 'advance' in s[3])),
                ('intermediate', 'A leather patch is placed at once', first(lambda s: 'leather' in s[3])),
                ('terminal', 'Final score: buttons, bonus, minus 2 per empty square', steps[-1])]
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
    final = cases[-1]['images'][2]['svg'].removeprefix(SVG.format('0 0 400 220')).removesuffix('</svg>')
    cover = (SVG.format('0 0 800 450') + '<rect width="800" height="450" fill="#241a14"/>'
             f'<g transform="translate(0 5) scale(2)">{final}</g></svg>')
    return {'name': TITLES[0], 'description': RULES[0], 'allowed_player_counts': [2], 'all_state_public': True,
            'server_code': code, 'declarative_ui': specification(),
            'alternative_names': reviewed_names(TITLES[0]),
            'game_addition_request_id_and_secret': f'example-only-declarative-{KIND}-replace-before-publishing',
            'rules': RULES[0], 'ui_instructions': UI_RULES[0],
            'tutorial': {'text': RULES[0], 'html': '<meta name="viewport" content="width=device-width,initial-scale=1"><p>' + html.escape(RULES[0]) + '</p>'},
            'images': [{'caption': 'Cover', 'svg': cover}, cases[1]['images'][0], cases[1]['images'][2], {**cases[-1]['images'][2], 'caption': 'Finished quilts'}],
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
