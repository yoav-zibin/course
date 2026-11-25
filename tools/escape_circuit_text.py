"""Localized player-facing text for the Escape Circuit package."""

LOCALES = ('en', 'es', 'fr', 'de', 'pt', 'zh', 'hi', 'ar')
TITLES = ('Escape Circuit', 'Circuito de escape', 'Circuit d’évasion', 'Fluchtparcours',
          'Circuito de fuga', '滑块逃脱赛', 'एस्केप सर्किट', 'حلبة الهروب')
RULES = (
    'Two players start with identical trays. Take turns sliding one block exactly one square into available space. Blocks cannot rotate, jump, or leave the tray. Get your orange core into the two marked squares at the bottom to escape. Both players get a slide in every round. If both escape in the same round, or neither escapes within 60 rounds, it is a draw.',
    'Dos jugadores empiezan con tableros idénticos. Por turnos, desliza un bloque exactamente una casilla hacia un espacio libre. Los bloques no pueden girar, saltar ni salir del tablero. Lleva tu núcleo naranja a las dos casillas marcadas abajo para escapar. Ambos jugadores mueven en cada ronda. Si ambos escapan en la misma ronda, o ninguno lo logra en 60 rondas, hay empate.',
    'Deux joueurs commencent avec des plateaux identiques. À tour de rôle, faites glisser un bloc d’une case vers un espace libre. Les blocs ne peuvent ni pivoter, ni sauter, ni sortir du plateau. Amenez votre noyau orange sur les deux cases marquées en bas pour vous échapper. Chaque joueur joue une fois par manche. Si les deux s’échappent dans la même manche, ou si personne ne s’échappe en 60 manches, la partie est nulle.',
    'Zwei Spieler beginnen mit identischen Brettern. Schiebe abwechselnd einen Block genau ein Feld auf freien Platz. Blöcke dürfen sich nicht drehen, springen oder das Brett verlassen. Bringe deinen orangefarbenen Kern auf die beiden markierten Felder unten, um zu entkommen. Beide Spieler ziehen in jeder Runde. Entkommen beide in derselben Runde oder niemand in 60 Runden, endet die Partie unentschieden.',
    'Dois jogadores começam com tabuleiros idênticos. Em turnos, deslize um bloco exatamente uma casa para um espaço livre. Os blocos não podem girar, saltar ou sair do tabuleiro. Leve seu núcleo laranja às duas casas marcadas embaixo para escapar. Cada jogador faz um movimento por rodada. Se ambos escaparem na mesma rodada ou ninguém escapar em 60 rodadas, há empate.',
    '两名玩家从相同的棋盘开始。轮流将一个滑块向有空位的方向滑动一格。滑块不能旋转、跳跃或离开棋盘。将橙色核心移到棋盘底部标出的两个格子即可逃脱。每轮两人各走一步。同一轮都逃脱，或60轮内都未逃脱，即为平局。',
    'दोनों खिलाड़ी एक जैसे बोर्ड से शुरू करते हैं। बारी-बारी से एक ब्लॉक को खाली जगह की ओर ठीक एक खाना खिसकाएँ। ब्लॉक घूम, कूद या बोर्ड से बाहर नहीं जा सकते। निकलने के लिए अपना नारंगी कोर नीचे के दो चिह्नित खानों पर लाएँ। हर राउंड में दोनों को एक चाल मिलती है। अगर दोनों एक ही राउंड में निकलें, या 60 राउंड तक कोई न निकले, तो खेल बराबर है।',
    'يبدأ لاعبان بلوحتين متطابقتين. بالتناوب، حرّك كتلة خانة واحدة نحو مساحة خالية. لا يمكن تدوير الكتل أو القفز بها أو إخراجها من اللوحة. أوصل قلبك البرتقالي إلى الخانتين المحددتين في الأسفل للخروج. لكل لاعب حركة واحدة في الجولة. إذا خرج كلاهما في الجولة نفسها، أو لم يخرج أحد خلال 60 جولة، تنتهي المباراة بالتعادل.',
)
INSTRUCTIONS = (
    'Drag a highlighted block, or tap it and choose a highlighted destination. The gate is at the bottom of each tray. Use the zoom controls for more room.',
    'Arrastra un bloque resaltado o tócalo y elige un destino resaltado. La salida está abajo. Usa el zoom para ampliar el tablero.',
    'Faites glisser un bloc en surbrillance, ou touchez-le puis choisissez une destination en surbrillance. La sortie est en bas. Utilisez le zoom pour agrandir.',
    'Ziehe einen hervorgehobenen Block oder tippe ihn und danach ein markiertes Ziel an. Der Ausgang liegt unten. Mit dem Zoom kannst du das Brett vergrößern.',
    'Arraste um bloco destacado ou toque nele e escolha um destino destacado. A saída fica embaixo. Use o zoom para ampliar.',
    '拖动高亮滑块，或点选滑块后选择高亮的目标位置。出口在棋盘底部。用缩放控件放大棋盘。',
    'चमकते ब्लॉक को खींचें, या उसे छूकर चमकती जगह चुनें। निकास बोर्ड के नीचे है। बोर्ड बड़ा करने के लिए ज़ूम का इस्तेमाल करें।',
    'اسحب كتلة مضاءة، أو المسها ثم اختر وجهة مضاءة. المخرج في أسفل اللوحة. استخدم التكبير لرؤية اللوحة بحجم أكبر.',
)
STRINGS = {
    'core': ('Core', 'Núcleo', 'Noyau', 'Kern', 'Núcleo', '核心', 'कोर', 'القلب'),
    'bar': ('Bar', 'Barra', 'Barre', 'Riegel', 'Barra', '长块', 'पट्टी', 'قضيب'),
    'chip': ('Chip', 'Ficha', 'Jeton', 'Stein', 'Peça', '小块', 'छोटा ब्लॉक', 'قطعة'),
    'runner': ('Player {number}', 'Jugador {number}', 'Joueur {number}', 'Spieler {number}', 'Jogador {number}', '玩家 {number}', 'खिलाड़ी {number}', 'اللاعب {number}'),
    'you': ('{player} (you)', '{player} (tú)', '{player} (vous)', '{player} (du)', '{player} (você)', '{player}（你）', '{player} (आप)', '{player} (أنت)'),
    'wins': ('{player} wins!', '¡Gana {player}!', '{player} gagne !', '{player} gewinnt!', '{player} venceu!', '{player} 获胜！', '{player} जीते!', 'فاز {player}!'),
    'turn': ('{player} to slide', 'Desliza {player}', 'À {player} de jouer', '{player} ist dran', 'Vez de {player}', '轮到 {player}', '{player} की बारी', 'دور {player}'),
    'draw': ('Draw', 'Empate', 'Match nul', 'Unentschieden', 'Empate', '平局', 'बराबरी', 'تعادل'),
    'replay': ('Match history', 'Historial', 'Historique', 'Verlauf', 'Histórico', '对局回放', 'खेल का इतिहास', 'سجل المباراة'),
    'waiting': ('Waiting to start', 'Esperando el inicio', 'En attente du départ', 'Warten auf den Start', 'Aguardando o início', '等待开始', 'शुरू होने का इंतज़ार', 'بانتظار البدء'),
    'your_turn': ('Your turn', 'Tu turno', 'À vous de jouer', 'Du bist dran', 'Sua vez', '轮到你了', 'आपकी बारी', 'دورك'),
    'choose': ('Drag or tap a highlighted block.', 'Arrastra o toca un bloque resaltado.', 'Glissez ou touchez un bloc en surbrillance.', 'Ziehe oder tippe einen markierten Block.', 'Arraste ou toque em um bloco destacado.', '拖动或点选高亮滑块。', 'चमकते ब्लॉक को खींचें या छुएँ।', 'اسحب كتلة مضاءة أو المسها.'),
    'final_slide': ('One slide left to tie.', 'Queda un movimiento para empatar.', 'Un coup pour égaliser.', 'Ein Zug bleibt zum Ausgleich.', 'Falta um movimento para empatar.', '还有一步可追平。', 'बराबरी के लिए एक चाल बाकी।', 'حركة واحدة متبقية للتعادل.'),
    'goal': ('Guide the orange core to the gate.', 'Lleva el núcleo naranja a la salida.', 'Amenez le noyau orange à la sortie.', 'Bring den orangen Kern zum Ausgang.', 'Leve o núcleo laranja até a saída.', '将橙色核心移到出口。', 'नारंगी कोर को निकास तक ले जाएँ।', 'أوصل القلب البرتقالي إلى المخرج.'),
    'escaped': ('Escaped', 'Escapó', 'Échappé', 'Entkommen', 'Escapou', '已逃脱', 'निकल गए', 'خرج'),
    'exit': ('Exit', 'Salida', 'Sortie', 'Ausgang', 'Saída', '出口', 'निकास', 'المخرج'),
    'tile_at': ('{tile} at {square}', '{tile} en {square}', '{tile} en {square}', '{tile} auf {square}', '{tile} em {square}', '{tile}位于{square}', '{tile}, {square} पर', '{tile} في {square}'),
    'slide_to': ('Slide {tile} to {square}', 'Desliza {tile} a {square}', 'Glisser {tile} en {square}', '{tile} nach {square} schieben', 'Deslize {tile} para {square}', '将{tile}移到{square}', '{tile} को {square} तक खिसकाएँ', 'حرّك {tile} إلى {square}'),
    'server_invalid_slide': ('Choose a legal slide on your turn.', 'Elige un movimiento válido en tu turno.', 'Choisissez un déplacement autorisé à votre tour.', 'Wähle einen erlaubten Zug, wenn du an der Reihe bist.', 'Escolha um movimento válido na sua vez.', '请在你的回合选择合法滑动。', 'अपनी बारी पर वैध चाल चुनें।', 'اختر حركة قانونية في دورك.'),
}
