"""Build the declarative Twist Five package (based on Pentago).

Run from the package parent:
  python -m game_platform.tools.build_declarative_twistfive
The checked-in submission secret is only an example; replace it when publishing.
"""
from __future__ import annotations

import base64
import copy
import html
import json
from pathlib import Path

from game_platform.game_logic import GameLogic

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'games' / 'declarative'
KIND = 'twistfive'
LOCALES = ['en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar']
TITLES = ['Twist Five', 'Gira Cinco', 'Cinq Tournants', 'Dreh-Fünf', 'Gira Cinco', '旋转五子', 'घुमाओ पाँच', 'لفّ الخمسة']
RULES = [
    'Based on Pentago. The 6×6 board is made of four 3×3 plates. On your turn, place one marble in any empty hole, then turn any one plate a quarter turn, clockwise or counterclockwise. Get five of your marbles in a row (across, down or diagonally) to win. Five in a row right after placing wins at once, without a turn. If a turn gives both players five, or the board fills up with no five, the game is a draw. Turning a symmetric plate changes nothing, which matches the official optional turn early in the game.',
    'Basado en Pentago. El tablero de 6×6 tiene cuatro placas de 3×3. En tu turno, pon una canica en un hueco vacío y luego gira una placa un cuarto de vuelta, en sentido horario o antihorario. Gana quien logre cinco canicas en línea (horizontal, vertical o diagonal). Cinco en línea justo al colocar gana al instante, sin girar. Si un giro da cinco a ambos jugadores, o el tablero se llena sin cinco, es empate. Girar una placa simétrica no cambia nada, como el giro opcional del reglamento oficial al inicio.',
    'Inspiré de Pentago. Le plateau 6×6 est formé de quatre plaques 3×3. À votre tour, posez une bille dans un trou vide, puis tournez une plaque d’un quart de tour, dans le sens horaire ou antihoraire. Alignez cinq billes (ligne, colonne ou diagonale) pour gagner. Cinq alignées dès la pose gagnent aussitôt, sans tourner. Si une rotation donne cinq aux deux joueurs, ou si le plateau se remplit sans alignement, c’est un match nul. Tourner une plaque symétrique ne change rien, comme la rotation facultative de la règle officielle en début de partie.',
    'Nach Pentago. Das 6×6-Brett besteht aus vier 3×3-Platten. Lege in deinem Zug eine Kugel in ein freies Loch und drehe dann eine beliebige Platte um eine Vierteldrehung, im oder gegen den Uhrzeigersinn. Wer fünf eigene Kugeln in einer Reihe hat (waagerecht, senkrecht oder diagonal), gewinnt. Fünf in einer Reihe direkt nach dem Legen gewinnt sofort, ohne Drehung. Gibt eine Drehung beiden fünf oder ist das Brett ohne Fünferreihe voll, endet es unentschieden. Eine symmetrische Platte zu drehen ändert nichts, wie die offizielle freiwillige Drehung zu Spielbeginn.',
    'Baseado em Pentago. O tabuleiro 6×6 tem quatro placas 3×3. Na sua vez, coloque uma bolinha em um buraco vazio e depois gire uma placa um quarto de volta, no sentido horário ou anti-horário. Vence quem fizer cinco bolinhas em linha (horizontal, vertical ou diagonal). Cinco em linha logo ao colocar vence na hora, sem girar. Se um giro der cinco aos dois jogadores, ou o tabuleiro encher sem cinco, é empate. Girar uma placa simétrica não muda nada, como o giro opcional da regra oficial no início.',
    '改编自 Pentago。6×6 棋盘由四块 3×3 转盘组成。轮到你时，在任意空孔放一颗弹珠，然后把任意一块转盘顺时针或逆时针转 90 度。先让自己五颗弹珠连成一线（横、竖或斜）者获胜。放珠后立即成五则直接获胜，无需转动。若一次转动让双方同时成五，或棋盘下满仍无人成五，则为平局。转动对称的转盘不会改变局面，这与官方规则开局时可不转的规定一致。',
    'Pentago पर आधारित। 6×6 बोर्ड चार 3×3 प्लेटों से बना है। अपनी बारी में किसी खाली छेद में एक कंचा रखें, फिर किसी एक प्लेट को चौथाई घुमाएँ, घड़ी की दिशा में या उल्टा। अपने पाँच कंचे एक पंक्ति में (आड़े, खड़े या तिरछे) लाकर जीतें। रखते ही पाँच बन जाएँ तो बिना घुमाए तुरंत जीत। अगर एक घुमाव से दोनों के पाँच बन जाएँ, या बोर्ड भर जाए और किसी के पाँच न हों, तो बराबरी। सममित प्लेट घुमाने से कुछ नहीं बदलता, जो शुरुआत में आधिकारिक वैकल्पिक घुमाव जैसा है।',
    'مستوحاة من Pentago. تتكون اللوحة 6×6 من أربع صفائح 3×3. في دورك ضع كرة في أي ثقب فارغ، ثم أدر صفيحة واحدة ربع دورة باتجاه عقارب الساعة أو عكسها. اجمع خمس كرات لك في صف (أفقي أو عمودي أو قطري) لتفوز. خمس في صف فور الوضع تفوز مباشرة دون تدوير. إذا أعطى التدوير خمسًا للاعبين معًا، أو امتلأت اللوحة دون خمس، فالنتيجة تعادل. تدوير صفيحة متماثلة لا يغيّر شيئًا، كما في التدوير الاختياري بالقواعد الرسمية في بداية اللعب.',
]
UI_RULES = [
    'Tap a glowing hole to place your marble. Then tap one of the ↻ ↺ arrows around the board to turn that plate; on touch screens the first tap shows where the marbles will go and the second tap turns it. You can also select a plate and use the rotate buttons or R / Shift+R. Press Change marble to pick another hole first. Pinch or use the zoom buttons to zoom.',
    'Toca un hueco iluminado para poner tu canica. Luego toca una de las flechas ↻ ↺ alrededor del tablero para girar esa placa; en pantallas táctiles el primer toque muestra adónde irán las canicas y el segundo la gira. También puedes seleccionar una placa y usar los botones de giro o R / Mayús+R. Pulsa Cambiar canica para elegir otro hueco antes. Pellizca o usa los botones para hacer zoom.',
    'Touchez un trou lumineux pour poser votre bille. Puis touchez une des flèches ↻ ↺ autour du plateau pour tourner cette plaque ; sur écran tactile, le premier toucher montre où iront les billes et le second la tourne. Vous pouvez aussi sélectionner une plaque et utiliser les boutons de rotation ou R / Maj+R. Appuyez sur Changer de bille pour choisir un autre trou avant. Pincez ou utilisez les boutons pour zoomer.',
    'Tippe auf ein leuchtendes Loch, um deine Kugel zu legen. Tippe dann auf einen der Pfeile ↻ ↺ um das Brett, um diese Platte zu drehen; auf Touchscreens zeigt das erste Tippen, wohin die Kugeln wandern, das zweite dreht. Du kannst auch eine Platte wählen und die Drehtasten oder R / Umschalt+R nutzen. Mit Kugel ändern wählst du vorher ein anderes Loch. Zum Zoomen zwei Finger oder die Zoom-Tasten nutzen.',
    'Toque em um buraco iluminado para colocar sua bolinha. Depois toque em uma das setas ↻ ↺ ao redor do tabuleiro para girar aquela placa; em telas de toque, o primeiro toque mostra para onde as bolinhas vão e o segundo gira. Você também pode selecionar uma placa e usar os botões de giro ou R / Shift+R. Aperte Trocar bolinha para escolher outro buraco antes. Use pinça ou os botões para dar zoom.',
    '点击发光的空孔放下弹珠。然后点击棋盘四周的 ↻ ↺ 箭头转动那块转盘；在触屏上第一次点击会显示弹珠的去向，第二次点击才转动。也可以选中转盘后用旋转按钮或 R / Shift+R。想换位置先按“换个位置”。双指捏合或用缩放按钮缩放。',
    'कंचा रखने के लिए चमकते छेद को छुएँ। फिर बोर्ड के चारों ओर किसी ↻ ↺ तीर को छूकर वह प्लेट घुमाएँ; टच स्क्रीन पर पहली बार छूने से दिखता है कि कंचे कहाँ जाएँगे, दूसरी बार छूने से प्लेट घूमती है। आप प्लेट चुनकर घुमाने के बटन या R / Shift+R भी इस्तेमाल कर सकते हैं। पहले दूसरा छेद चुनना हो तो कंचा बदलें दबाएँ। ज़ूम के लिए दो उँगलियों या ज़ूम बटन का उपयोग करें।',
    'المس ثقبًا مضيئًا لوضع كرتك. ثم المس أحد السهمين ↻ ↺ حول اللوحة لتدوير تلك الصفيحة؛ في الشاشات اللمسية تُظهر اللمسة الأولى أين ستذهب الكرات وتديرها الثانية. يمكنك أيضًا اختيار صفيحة واستخدام أزرار التدوير أو R / Shift+R. اضغط تغيير الكرة لاختيار ثقب آخر أولًا. استخدم إصبعين أو أزرار التكبير للتكبير.',
]
TEXTS = {
    'gold': ['Gold', 'Oro', 'Or', 'Gold', 'Ouro', '金', 'सुनहरा', 'الذهبي'],
    'black': ['Black', 'Negro', 'Noir', 'Schwarz', 'Preto', '黑', 'काला', 'الأسود'],
    'seat_name': ['{color} · {name}'] * 8,
    'you': ['{name} (you)', '{name} (tú)', '{name} (vous)', '{name} (du)', '{name} (você)', '{name}（你）', '{name} (आप)', '{name} (أنت)'],
    'player': ['Player {n}', 'Jugador {n}', 'Joueur {n}', 'Spieler {n}', 'Jogador {n}', '玩家{n}', 'खिलाड़ी {n}', 'اللاعب {n}'],
    'place_turn': ['{name}: place a marble', '{name}: pon una canica', '{name} : posez une bille', '{name}: Kugel legen', '{name}: coloque uma bolinha', '{name}：放一颗弹珠', '{name}: कंचा रखें', '{name}: ضع كرة'],
    'twist_turn': ['{name}: turn a plate', '{name}: gira una placa', '{name} : tournez une plaque', '{name}: Platte drehen', '{name}: gire uma placa', '{name}：转动一块转盘', '{name}: प्लेट घुमाएँ', '{name}: أدر صفيحة'],
    'waiting': ['Waiting for {name}', 'Esperando a {name}', 'En attente de {name}', 'Warten auf {name}', 'Aguardando {name}', '等待{name}', '{name} की प्रतीक्षा', 'بانتظار {name}'],
    'wins': ['{name} wins!', '¡Gana {name}!', '{name} gagne !', '{name} gewinnt!', '{name} venceu!', '{name}获胜！', '{name} जीते!', 'فاز {name}!'],
    'draw': ['Draw', 'Empate', 'Match nul', 'Unentschieden', 'Empate', '平局', 'बराबरी', 'تعادل'],
    'hint_place': ['Tap a glowing hole', 'Toca un hueco iluminado', 'Touchez un trou lumineux', 'Tippe auf ein leuchtendes Loch', 'Toque em um buraco iluminado', '点击发光的空孔', 'चमकता छेद छुएँ', 'المس ثقبًا مضيئًا'],
    'hint_twist': ['Tap an arrow to turn that plate', 'Toca una flecha para girar esa placa', 'Touchez une flèche pour tourner la plaque', 'Tippe auf einen Pfeil, um die Platte zu drehen', 'Toque em uma seta para girar a placa', '点击箭头转动那块转盘', 'प्लेट घुमाने के लिए तीर छुएँ', 'المس سهمًا لتدوير تلك الصفيحة'],
    'hint_over': ['Five in a row wins', 'Cinco en línea gana', 'Cinq alignées gagnent', 'Fünf in einer Reihe gewinnt', 'Cinco em linha vence', '五子连线获胜', 'पाँच की पंक्ति जीतती है', 'خمس في صف تفوز'],
    'turn_cw': ['Turn the {plate} clockwise', 'Girar la {plate} en sentido horario', 'Tourner la {plate} dans le sens horaire', '{plate} im Uhrzeigersinn drehen', 'Girar a {plate} no sentido horário', '顺时针转动{plate}', '{plate} को घड़ी की दिशा में घुमाएँ', 'أدر {plate} باتجاه عقارب الساعة'],
    'turn_ccw': ['Turn the {plate} counterclockwise', 'Girar la {plate} en sentido antihorario', 'Tourner la {plate} dans le sens antihoraire', '{plate} gegen den Uhrzeigersinn drehen', 'Girar a {plate} no sentido anti-horário', '逆时针转动{plate}', '{plate} को घड़ी की उल्टी दिशा में घुमाएँ', 'أدر {plate} عكس اتجاه عقارب الساعة'],
    'winning_marble': ['Winning marble at {cell}', 'Canica ganadora en {cell}', 'Bille gagnante en {cell}', 'Gewinnkugel auf {cell}', 'Bolinha vencedora em {cell}', '{cell}的获胜弹珠', '{cell} पर जीतने वाला कंचा', 'كرة فائزة في {cell}'],
    'last_marble': ['Last marble placed: {cell}', 'Última canica: {cell}', 'Dernière bille posée : {cell}', 'Zuletzt gelegte Kugel: {cell}', 'Última bolinha: {cell}', '上一颗弹珠：{cell}', 'पिछला कंचा: {cell}', 'آخر كرة: {cell}'],
    'change': ['Change marble', 'Cambiar canica', 'Changer de bille', 'Kugel ändern', 'Trocar bolinha', '换个位置', 'कंचा बदलें', 'تغيير الكرة'],
    'hole': ['Hole {cell}', 'Hueco {cell}', 'Trou {cell}', 'Loch {cell}', 'Buraco {cell}', '空孔{cell}', 'छेद {cell}', 'الثقب {cell}'],
    'marble_at': ['{color} marble at {cell}', 'Canica {color} en {cell}', 'Bille {color} en {cell}', '{color}e Kugel auf {cell}', 'Bolinha {color} em {cell}', '{cell}的{color}弹珠', '{cell} पर {color} कंचा', 'كرة {color} في {cell}'],
    'pending_at': ['Your new marble at {cell}', 'Tu nueva canica en {cell}', 'Votre nouvelle bille en {cell}', 'Deine neue Kugel auf {cell}', 'Sua nova bolinha em {cell}', '你在{cell}的新弹珠', '{cell} पर आपका नया कंचा', 'كرتك الجديدة في {cell}'],
    'plate_top_left': ['top-left plate', 'placa superior izquierda', 'plaque en haut à gauche', 'Platte oben links', 'placa superior esquerda', '左上转盘', 'ऊपर बाईं प्लेट', 'الصفيحة العلوية اليسرى'],
    'plate_top_right': ['top-right plate', 'placa superior derecha', 'plaque en haut à droite', 'Platte oben rechts', 'placa superior direita', '右上转盘', 'ऊपर दाईं प्लेट', 'الصفيحة العلوية اليمنى'],
    'plate_bottom_left': ['bottom-left plate', 'placa inferior izquierda', 'plaque en bas à gauche', 'Platte unten links', 'placa inferior esquerda', '左下转盘', 'नीचे बाईं प्लेट', 'الصفيحة السفلية اليسرى'],
    'plate_bottom_right': ['bottom-right plate', 'placa inferior derecha', 'plaque en bas à droite', 'Platte unten rechts', 'placa inferior direita', '右下转盘', 'नीचे दाईं प्लेट', 'الصفيحة السفلية اليمنى'],
    'server_two_players_required': ['two players required', 'se necesitan dos jugadores', 'deux joueurs requis', 'zwei Spieler nötig', 'são necessários dois jogadores', '需要两名玩家', 'दो खिलाड़ी चाहिए', 'يلزم لاعبان'],
    'server_unknown_player': ['unknown player', 'jugador desconocido', 'joueur inconnu', 'unbekannter Spieler', 'jogador desconhecido', '未知玩家', 'अज्ञात खिलाड़ी', 'لاعب غير معروف'],
    'server_game_over': ['game over', 'partida terminada', 'partie terminée', 'Spiel beendet', 'jogo encerrado', '游戏结束', 'खेल समाप्त', 'انتهت اللعبة'],
    'server_not_your_turn': ['not your turn', 'no es tu turno', 'ce n’est pas votre tour', 'du bist nicht dran', 'não é sua vez', '未轮到你', 'आपकी बारी नहीं', 'ليس دورك'],
    'server_bad_hole': ['bad hole', 'hueco no válido', 'trou non valide', 'ungültiges Loch', 'buraco inválido', '无效的孔', 'अमान्य छेद', 'ثقب غير صالح'],
    'server_hole_taken': ['that hole is taken', 'ese hueco está ocupado', 'ce trou est occupé', 'dieses Loch ist belegt', 'esse buraco está ocupado', '该孔已被占用', 'वह छेद भरा है', 'هذا الثقب مشغول'],
    'server_bad_twist': ['bad twist', 'giro no válido', 'rotation non valide', 'ungültige Drehung', 'giro inválido', '无效的转动', 'अमान्य घुमाव', 'تدوير غير صالح'],
    'server_no_twist_after_five': ['five in a row already: no twist', 'ya hay cinco en línea: sin giro', 'déjà cinq alignées : pas de rotation', 'schon fünf in einer Reihe: keine Drehung', 'já há cinco em linha: sem giro', '已经五子连线：无需转动', 'पहले से पाँच की पंक्ति: घुमाव नहीं', 'خمس في صف بالفعل: بلا تدوير'],
    'server_choose_twist': ['choose a plate to twist', 'elige una placa para girar', 'choisissez une plaque à tourner', 'wähle eine Platte zum Drehen', 'escolha uma placa para girar', '请选择要转动的转盘', 'घुमाने के लिए प्लेट चुनें', 'اختر صفيحة لتدويرها'],
}


def strings(index=0):
    return {'title': TITLES[index], **{key: values[index] for key, values in TEXTS.items()}}


def schemas():
    """State, move and view contracts (no separate file: every JSON file in
    games/declarative is treated as a package)."""
    return json.loads(SCHEMAS)


SCHEMAS = r'''{
 "state": {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": [
   "board",
   "ids",
   "plates",
   "cur",
   "winner",
   "line",
   "last",
   "next_id"
  ],
  "properties": {
   "board": {
    "type": "array",
    "minItems": 36,
    "maxItems": 36,
    "items": {
     "type": "integer",
     "minimum": -1,
     "maximum": 1
    }
   },
   "ids": {
    "type": "array",
    "minItems": 36,
    "maxItems": 36,
    "items": {
     "type": "integer",
     "minimum": -1,
     "maximum": 35
    }
   },
   "plates": {
    "type": "array",
    "minItems": 4,
    "maxItems": 4,
    "items": {
     "type": "integer",
     "minimum": -3240,
     "maximum": 3240
    }
   },
   "cur": {
    "type": "integer",
    "minimum": 0,
    "maximum": 1
   },
   "winner": {
    "oneOf": [
     {
      "type": "null"
     },
     {
      "type": "integer",
      "minimum": -1,
      "maximum": 1
     }
    ]
   },
   "line": {
    "oneOf": [
     {
      "type": "null"
     },
     {
      "type": "array",
      "minItems": 5,
      "maxItems": 5,
      "items": {
       "type": "integer",
       "minimum": 0,
       "maximum": 35
      }
     }
    ]
   },
   "last": {
    "oneOf": [
     {
      "type": "null"
     },
     {
      "type": "object",
      "additionalProperties": false,
      "required": [
       "seat",
       "cell",
       "quadrant",
       "direction"
      ],
      "properties": {
       "seat": {
        "type": "integer",
        "minimum": 0,
        "maximum": 1
       },
       "cell": {
        "type": "integer",
        "minimum": 0,
        "maximum": 35
       },
       "quadrant": {
        "oneOf": [
         {
          "type": "null"
         },
         {
          "type": "integer",
          "minimum": 0,
          "maximum": 3
         }
        ]
       },
       "direction": {
        "enum": [
         null,
         "clockwise",
         "counterclockwise"
        ]
       }
      }
     }
    ]
   },
   "next_id": {
    "type": "integer",
    "minimum": 0,
    "maximum": 36
   }
  }
 },
 "move": {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "oneOf": [
   {
    "type": "object",
    "additionalProperties": false,
    "required": [
     "cell"
    ],
    "properties": {
     "cell": {
      "type": "integer",
      "minimum": 0,
      "maximum": 35
     }
    }
   },
   {
    "type": "object",
    "additionalProperties": false,
    "required": [
     "cell",
     "quadrant",
     "direction"
    ],
    "properties": {
     "cell": {
      "type": "integer",
      "minimum": 0,
      "maximum": 35
     },
     "quadrant": {
      "type": "integer",
      "minimum": 0,
      "maximum": 3
     },
     "direction": {
      "enum": [
       "clockwise",
       "counterclockwise"
      ]
     }
    }
   }
  ]
 },
 "view": {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": [
   "board",
   "ids",
   "plates",
   "cur",
   "winner",
   "line",
   "last"
  ],
  "properties": {
   "board": {
    "type": "array",
    "minItems": 36,
    "maxItems": 36,
    "items": {
     "type": "integer",
     "minimum": -1,
     "maximum": 1
    }
   },
   "ids": {
    "type": "array",
    "minItems": 36,
    "maxItems": 36,
    "items": {
     "type": "integer",
     "minimum": -1,
     "maximum": 35
    }
   },
   "plates": {
    "type": "array",
    "minItems": 4,
    "maxItems": 4,
    "items": {
     "type": "integer",
     "minimum": -3240,
     "maximum": 3240
    }
   },
   "cur": {
    "type": "integer",
    "minimum": 0,
    "maximum": 1
   },
   "winner": {
    "oneOf": [
     {
      "type": "null"
     },
     {
      "type": "integer",
      "minimum": -1,
      "maximum": 1
     }
    ]
   },
   "line": {
    "oneOf": [
     {
      "type": "null"
     },
     {
      "type": "array",
      "minItems": 5,
      "maxItems": 5,
      "items": {
       "type": "integer",
       "minimum": 0,
       "maximum": 35
      }
     }
    ]
   },
   "last": {
    "oneOf": [
     {
      "type": "null"
     },
     {
      "type": "object",
      "additionalProperties": false,
      "required": [
       "seat",
       "cell",
       "quadrant",
       "direction"
      ],
      "properties": {
       "seat": {
        "type": "integer",
        "minimum": 0,
        "maximum": 1
       },
       "cell": {
        "type": "integer",
        "minimum": 0,
        "maximum": 35
       },
       "quadrant": {
        "oneOf": [
         {
          "type": "null"
         },
         {
          "type": "integer",
          "minimum": 0,
          "maximum": 3
         }
        ]
       },
       "direction": {
        "enum": [
         null,
         "clockwise",
         "counterclockwise"
        ]
       }
      }
     }
    ]
   }
  }
 }
}'''


def uri(svg):
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


HOLES = [33, 103, 173]


def plate_svg():
    holes = ''.join(f'<circle cx="{x}" cy="{y}" r="24" fill="#22394f"/><circle cx="{x}" cy="{y - 2}" r="24" fill="none" stroke="#183044" stroke-width="3"/>'
                    for y in HOLES for x in HOLES)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 206 206">'
            '<rect x="3" y="3" width="200" height="200" rx="22" fill="#3d6688" stroke="#8fb6d6" stroke-width="4"/>'
            '<rect x="12" y="12" width="182" height="182" rx="16" fill="none" stroke="#557fa3" stroke-width="2"/>'
            # A corner notch makes each quarter turn easy to follow.
            '<path d="M14 40 L14 14 L40 14 Z" fill="#ffd76a" opacity=".85"/>' + holes + '</svg>')


# The host inlines SVG pictures into one page, so every gradient id must be
# unique across all pictures or the first definition wins.
def marble_svg(light, dark, shine):
    gid = f'tf{light[1:]}'
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 54 54">'
            f'<defs><radialGradient id="{gid}" cx=".35" cy=".3" r=".75">'
            f'<stop offset="0" stop-color="{shine}"/><stop offset=".45" stop-color="{light}"/><stop offset="1" stop-color="{dark}"/></radialGradient></defs>'
            f'<circle cx="27" cy="27" r="24" fill="url(#{gid})" stroke="#0b1320" stroke-width="2"/></svg>')


GOLD = marble_svg('#ffc93c', '#b7791f', '#fff6cf')
BLACK = marble_svg('#2a2a3a', '#08080e', '#8d93a8')


def arrow_svg(clockwise):
    """A round badge with a three-quarter arrow. The counterclockwise one is
    drawn with mirrored coordinates: some renderers ignore SVG transforms."""
    arc, head = (('M38 17 A21 21 0 1 1 17.8 32.5', 'M38 6 L52 17 L38 28 Z') if clockwise else
                 ('M38 17 A21 21 0 1 0 58.2 32.5', 'M38 6 L24 17 L38 28 Z'))
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 76 76">'
            '<circle cx="38" cy="38" r="33" fill="#24395a" stroke="#ffd76a" stroke-width="3"/>'
            f'<path d="{arc}" fill="none" stroke="#ffd76a" stroke-width="7" stroke-linecap="round"/>'
            f'<path d="{head}" fill="#ffd76a"/></svg>')


WIN_RING = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 68"><circle cx="34" cy="34" r="30" fill="none" '
            'stroke="#ff5d8f" stroke-width="7"/><circle cx="34" cy="34" r="30" fill="none" stroke="#ffffff" stroke-width="2"/></svg>')
RING = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="none" '
        'stroke="#ff5d8f" stroke-width="4" stroke-dasharray="9 5"/></svg>')


def specification():
    assets = {'plate_art': {'uri': uri(plate_svg()), 'media_type': 'image/svg+xml'},
              'arrow_cw': {'uri': uri(arrow_svg(True)), 'media_type': 'image/svg+xml'},
              'arrow_ccw': {'uri': uri(arrow_svg(False)), 'media_type': 'image/svg+xml'},
              'ring': {'uri': uri(RING), 'media_type': 'image/svg+xml'},
              'win_ring': {'uri': uri(WIN_RING), 'media_type': 'image/svg+xml'},
              'gold': {'uri': uri(GOLD), 'media_type': 'image/svg+xml'},
              'black': {'uri': uri(BLACK), 'media_type': 'image/svg+xml'}}
    return {'format': 'buildplay-ui', 'version': 1, 'viewport': {'width': 570, 'height': 630},
            'assets': assets,
            'boards': [
                {'id': 'hud', 'kind': 'zone', 'x': 0, 'y': 0, 'width': 570, 'height': 60, 'color': '#162238', 'line_color': '#162238'},
                {'id': 'frame', 'kind': 'zone', 'x': 0, 'y': 60, 'width': 570, 'height': 570, 'color': '#1d2c44', 'line_color': '#1d2c44'},
                {'id': 'board', 'kind': 'grid', 'x': 75, 'y': 135, 'width': 420, 'height': 420, 'rows': 6, 'columns': 6,
                 'color': '#1d2c44', 'alternate_color': '#1d2c44', 'line_color': '#1d2c44'}],
            'piece_types': {
                'plate': {'shape': 'image', 'width': 206, 'height': 206, 'asset': 'plate_art'},
                'marble': {'shape': 'image', 'width': 54, 'height': 54, 'asset': 'gold'},
                'ring': {'shape': 'image', 'width': 64, 'height': 64, 'asset': 'ring'},
                'win_ring': {'shape': 'image', 'width': 68, 'height': 68, 'asset': 'win_ring'}},
            'strings': strings(),
            'ui_code': 'const SOURCE_STRINGS=' + json.dumps(strings(), ensure_ascii=False) + ';\n' + (DEST / f'{KIND}.ui.js').read_text()}


def illustration(view, caption):
    """A static picture of a position: plates at their current turn, marbles, win line."""
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 440"><rect width="440" height="440" fill="#1d2c44"/>']
    plate = plate_svg().removeprefix('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 206 206">').removesuffix('</svg>')
    for q in range(4):
        x, y = 10 + 210 * (q & 1), 10 + 210 * (q >> 1)
        parts.append(f'<g transform="translate({x + 103} {y + 103}) rotate({view["plates"][q]}) translate(-103 -103)">{plate}</g>')
    for cell, owner in enumerate(view['board']):
        if owner < 0:
            continue
        cx, cy = 10 + (cell % 6) * 70 + 35, 10 + (cell // 6) * 70 + 35
        fill, edge = ('#ffc93c', '#b7791f') if owner == 0 else ('#23232f', '#000000')
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="24" fill="{fill}" stroke="{edge}" stroke-width="3"/>')
    if view['line']:
        a, b = view['line'][0], view['line'][4]
        parts.append(f'<line x1="{10 + (a % 6) * 70 + 35}" y1="{10 + (a // 6) * 70 + 35}" x2="{10 + (b % 6) * 70 + 35}" '
                     f'y2="{10 + (b // 6) * 70 + 35}" stroke="#ff5d8f" stroke-width="8" stroke-linecap="round"/>')
    parts.append('</svg>')
    return {'caption': caption, 'svg': ''.join(parts)}


def board_state(logic, ctx, cells, cur, plates=(0, 0, 0, 0)):
    """A legal-looking position: gold on cells[0], black on cells[1]."""
    state = logic.call('newMatch', ctx=ctx, seed=1)['state']
    next_id = 0
    for seat in (0, 1):
        for cell in cells[seat]:
            state['board'][cell] = seat
            state['ids'][cell] = next_id
            next_id += 1
    state.update(cur=cur, next_id=next_id, plates=list(plates))
    return state


def package():
    code = (DEST / f'{KIND}.server.js').read_text()
    game_schemas = schemas()
    logic = GameLogic(code, game_schemas=game_schemas)
    ctx = {'players': [{'id': 'u1', 'kind': 'human', 'display_name': 'Alice', 'picture_url': '', 'max_loss': 0, 'active': True},
                       {'id': 'u2', 'kind': 'human', 'display_name': 'Bob', 'picture_url': '', 'max_loss': 0, 'active': True}],
           'pot': 0, 'move_count': 0}
    result = logic.call('newMatch', ctx=ctx, seed=7)
    steps = []
    for i in range(40):
        ctx['move_count'] = i
        state, pid, seed = result['state'], result['turn'][0], i + 11
        move = logic.call('computerMove', state, pid, ctx=ctx, seed=seed)
        result = logic.call('applyMove', state, pid, move, ctx=ctx, seed=seed)
        steps.append((copy.deepcopy(ctx), state, pid, move, result, seed))
        if result['turn'] is None:
            break
    else:
        raise RuntimeError('Twist Five did not finish')
    selected = [(kind, kind.title() + ' move', steps[index]) for kind, index in
                [('initial', 0), ('intermediate', len(steps) // 2), ('terminal', len(steps) - 1)]]
    case_ctx = {**ctx, 'move_count': 12}
    # Five by placement alone: gold A1-D1 plus E1, no turn.
    s = board_state(logic, case_ctx, [[0, 1, 2, 3, 20, 26], [14, 15, 21, 27, 33, 35]], 0)
    selected.append(('intermediate', 'Five in a row by placing, without a turn', (case_ctx, s, 'u1', {'cell': 4}, None, 7)))
    # Five after the turn: turning the top-right plate completes row 1.
    # Clockwise sends local (r, c) to (c, 2 - r): hole 9 goes to 4, hole 15 to 3.
    s = board_state(logic, case_ctx, [[0, 1, 2, 9, 30], [6, 7, 13, 25, 31]], 0)
    selected.append(('intermediate', 'Turning a plate completes five', (case_ctx, s, 'u1', {'cell': 15, 'quadrant': 1, 'direction': 'clockwise'}, None, 7)))
    # The turn gives both players five: a draw.
    # The same turn also sends black's 11 and 17 to 16 and 15, finishing row 3.
    s = board_state(logic, case_ctx, [[0, 1, 2, 9, 30], [12, 13, 14, 11, 17]], 0)
    selected.append(('intermediate', 'A turn that gives both players five is a draw', (case_ctx, s, 'u1', {'cell': 15, 'quadrant': 1, 'direction': 'clockwise'}, None, 7)))
    cases = []
    for kind, label, (cctx, state, pid, move, after, seed) in selected:
        if after is None:
            after = logic.call('applyMove', state, pid, move, ctx=cctx, seed=seed)
        before_views = [logic.call('viewFor', state, who, ctx=cctx, seed=seed) for who in (pid, None)]
        next_ctx = {**cctx, 'move_count': cctx['move_count'] + 1}
        after_views = [logic.call('viewFor', after['state'], who, ctx=next_ctx, seed=seed) for who in (pid, None)]
        case = {'name': label, 'description': RULES[0], 'kind': kind,
                'ctx': {**cctx, 'seed': seed}, 'state': state, 'view_of_mover': before_views[0], 'view_of_other': before_views[1],
                'player_id': pid, 'other_player_id': None, 'move': move,
                'expected_state': after['state'], 'expected_turn': after['turn'],
                'expected_view_of_mover': after_views[0], 'expected_view_of_other': after_views[1],
                'images': [illustration(view, caption) for view, caption in zip(
                    before_views + after_views, ['Before: mover', 'Before: spectator', 'After: mover', 'After: spectator'])]}
        if 'payouts' in after:
            case['expected_payouts'] = after['payouts']
        cases.append(case)
    expected = {'Five in a row by placing, without a turn': 0, 'Turning a plate completes five': 0,
                'A turn that gives both players five is a draw': -1}
    for case in cases:
        if case['name'] in expected and case['expected_state']['winner'] != expected[case['name']]:
            raise RuntimeError(f"rules case {case['name']!r} ended with winner {case['expected_state']['winner']}")
    middle = cases[1]['images'][2]['svg'].removeprefix('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 440">').removesuffix('</svg>')
    cover = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><rect width="800" height="450" fill="#162238"/>'
             f'<g transform="translate(195 0) scale(1.0227)">{middle}</g></svg>')
    return {'name': TITLES[0], 'description': RULES[0], 'allowed_player_counts': [2], 'all_state_public': True,
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
