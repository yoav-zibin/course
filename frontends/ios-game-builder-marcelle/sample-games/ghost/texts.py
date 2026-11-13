"""Ghost texts in English and their translations into the 7 other platform languages."""

NAME = "Ghost"

DESCRIPTION = (
    "The classic spelling bluff for 2 to 6 players: add letters to a growing English word without "
    "finishing it, challenge bluffers, and avoid spelling G-H-O-S-T."
)

RULES = """Ghost is for 2 to 6 players and uses English words (a built-in list of about 38,000 common words of 4 or more letters).
Players take turns in seat order. On your turn you add one letter to the end of the shared group of letters. The letters must always be the beginning of a real word, but nobody checks this unless someone challenges.
Instead of adding a letter, you may challenge the player who added the last letter. That player must then name a word that starts with all the letters and is longer than them. If it is a real word, the challenger loses the round; if not (or if they give up), the challenged player loses it.
Whoever adds a letter that completes a word of 4 or more letters loses the round at once.
The loser of a round earns the next letter of G-H-O-S-T. A player who has all five letters is out. Each new round starts with empty letters; the player to the left of the previous round's first player starts it (skipping players who are out).
The last player left wins. The pot goes to the winner, or is shared by the human players if a computer wins. Nobody can join or leave during a match."""

UI = (
    "The top shows every player with their G-H-O-S-T letters (earned letters in red); the player to move is "
    "outlined and players who are out are crossed out. The letters so far are shown large in the middle, with "
    "the result of the last round below them. On your turn, tap a letter on the keyboard to add it, or tap "
    "Challenge. When you are challenged, type a word that starts with the letters and tap Answer, or Give up. "
    "Works on phones, tablets and laptops, in portrait and landscape."
)

TUTORIAL_TEXT = (
    "Add letters to a growing English word without completing one (4+ letters). Challenge a player you think is "
    "bluffing. Each lost round earns a letter of GHOST; five letters and you are out."
)

TUTORIAL = [
    ("h1", "How to play Ghost"),
    ("p", "Together you spell the start of an English word, one letter each turn."),
    ("h2", "Adding letters"),
    ("p", "Your letter must keep the letters the beginning of a real word. If you complete a word of 4 or more letters, you lose the round."),
    ("h2", "Challenging"),
    ("p", "Think the last player is bluffing? Challenge: they must name a word that starts with the letters, or they lose the round. If they can, you lose it."),
    ("h2", "G-H-O-S-T"),
    ("p", "Each round you lose earns a letter of GHOST. With all five you are out; the last player left wins."),
]

T = {}

T["es"] = dict(
    name="Fantasma",
    description="El clásico farol de deletreo para 2 a 6 jugadores: añade letras a una palabra inglesa sin terminarla, desafía a quien farolea y evita completar G-H-O-S-T.",
    rules="""Fantasma es para 2 a 6 jugadores y usa palabras en inglés (una lista incorporada de unas 38.000 palabras comunes de 4 o más letras).
Los jugadores juegan por turnos en orden de asientos. En tu turno añades una letra al final del grupo de letras compartido. Las letras siempre deben ser el comienzo de una palabra real, pero nadie lo comprueba salvo que alguien desafíe.
En lugar de añadir una letra, puedes desafiar al jugador que añadió la última letra. Ese jugador debe decir una palabra que empiece con todas las letras y sea más larga que ellas. Si es una palabra real, quien desafió pierde la ronda; si no (o si se rinde), la pierde el desafiado.
Quien añade una letra que completa una palabra de 4 o más letras pierde la ronda en el acto.
El perdedor de una ronda gana la siguiente letra de G-H-O-S-T. Un jugador con las cinco letras queda eliminado. Cada ronda nueva empieza sin letras; la empieza el jugador a la izquierda de quien empezó la ronda anterior (saltando a los eliminados).
Gana el último jugador que queda. El bote es para el ganador, o se reparte entre los jugadores humanos si gana una computadora. Nadie puede unirse ni salir durante una partida.""",
    ui="Arriba aparece cada jugador con sus letras de G-H-O-S-T (las ganadas en rojo); el jugador al que le toca tiene un borde y los eliminados aparecen tachados. Las letras de la ronda se ven en grande en el centro, con el resultado de la última ronda debajo. En tu turno, toca una letra del teclado para añadirla o toca Desafiar. Si te desafían, escribe una palabra que empiece con las letras y toca Responder, o Rendirse. Funciona en teléfonos, tabletas y portátiles, en vertical y en horizontal.",
    tutorial=[
        "Cómo jugar a Fantasma",
        "Entre todos deletreáis el comienzo de una palabra inglesa, una letra por turno.",
        "Añadir letras",
        "Tu letra debe mantener las letras como comienzo de una palabra real. Si completas una palabra de 4 o más letras, pierdes la ronda.",
        "Desafiar",
        "¿Crees que el último jugador farolea? Desafíalo: debe decir una palabra que empiece con las letras o pierde la ronda. Si puede, la pierdes tú.",
        "G-H-O-S-T",
        "Cada ronda perdida te da una letra de GHOST. Con las cinco quedas eliminado; gana el último jugador que queda.",
    ],
    client={
        "title": "Fantasma", "meta": "Ronda {round} · cuentan las palabras de 4+ letras",
        "fragment_label": "Letras hasta ahora: {letters}", "empty_fragment": "Aún no hay letras", "keyboard": "Letras",
        "your_turn_first": "Tu turno: empieza la ronda con cualquier letra.",
        "your_turn": "Tu turno: añade una letra que mantenga esto como comienzo de una palabra, o desafía.",
        "challenged": "{name} te desafía: escribe una palabra que empiece con estas letras.",
        "waiting": "Esperando a {name}.", "waiting_answer": "{name} debe decir una palabra que empiece con estas letras.",
        "watching": "Estás viendo esta partida.", "challenge": "Desafiar", "answer": "Responder", "give_up": "Rendirse",
        "word_placeholder": "tu palabra",
        "last_completed": "{name} completó «{word}» y gana una letra.",
        "last_challenge_failed": "{name} desafió, pero «{word}» es una palabra: {name} gana una letra.",
        "last_bad_word": "«{word}» no cuenta, así que {name} gana una letra.",
        "last_gave_up": "{name} no pudo decir una palabra y gana una letra.",
        "you_win": "Eres el último jugador que queda: ¡ganas!", "player_wins": "{name} es el último jugador que queda y gana.",
        "server_the_game_is_over": "la partida ha terminado", "server_it_is_not_your_turn": "no es tu turno",
        "server_answer_the_challenge_with_a_word_or_give_up": "responde al desafío con una palabra, o ríndete",
        "server_there_is_nothing_to_challenge_yet": "aún no hay nada que desafiar",
        "server_add_a_letter_or_challenge": "añade una letra o desafía",
        "server_send_a_letter_a_challenge_a_word_or_give_up": "envía una letra, un desafío, una palabra o ríndete",
    },
)

T["fr"] = dict(
    name="Fantôme",
    description="Le grand classique du bluff orthographique pour 2 à 6 joueurs : ajoutez des lettres à un mot anglais sans le terminer, démasquez les bluffeurs et évitez d'écrire G-H-O-S-T.",
    rules="""Fantôme se joue de 2 à 6 joueurs avec des mots anglais (une liste intégrée d'environ 38 000 mots courants de 4 lettres ou plus).
Les joueurs jouent à tour de rôle dans l'ordre des places. À votre tour, vous ajoutez une lettre à la fin du groupe de lettres commun. Les lettres doivent toujours former le début d'un vrai mot, mais personne ne le vérifie sauf en cas de défi.
Au lieu d'ajouter une lettre, vous pouvez défier le joueur qui a ajouté la dernière lettre. Il doit alors donner un mot qui commence par toutes les lettres et qui est plus long qu'elles. Si c'est un vrai mot, le joueur qui a défié perd la manche ; sinon (ou s'il abandonne), c'est le joueur défié qui la perd.
Celui qui ajoute une lettre qui complète un mot de 4 lettres ou plus perd la manche aussitôt.
Le perdant d'une manche reçoit la lettre suivante de G-H-O-S-T. Un joueur qui a les cinq lettres est éliminé. Chaque nouvelle manche commence sans lettres ; c'est le joueur à gauche de celui qui a commencé la manche précédente qui la commence (en sautant les éliminés).
Le dernier joueur restant gagne. La cagnotte revient au gagnant, ou est partagée entre les joueurs humains si un ordinateur gagne. Personne ne peut rejoindre ni quitter une partie en cours.""",
    ui="En haut figure chaque joueur avec ses lettres de G-H-O-S-T (les lettres reçues en rouge) ; le joueur dont c'est le tour est encadré et les éliminés sont barrés. Les lettres de la manche s'affichent en grand au centre, avec le résultat de la dernière manche en dessous. À votre tour, touchez une lettre du clavier pour l'ajouter, ou touchez Défier. Si l'on vous défie, tapez un mot qui commence par les lettres et touchez Répondre, ou Abandonner. Fonctionne sur téléphone, tablette et ordinateur portable, en portrait et en paysage.",
    tutorial=[
        "Comment jouer à Fantôme",
        "Ensemble, vous écrivez le début d'un mot anglais, une lettre par tour.",
        "Ajouter des lettres",
        "Votre lettre doit garder les lettres comme début d'un vrai mot. Si vous complétez un mot de 4 lettres ou plus, vous perdez la manche.",
        "Défier",
        "Vous pensez que le dernier joueur bluffe ? Défiez-le : il doit donner un mot qui commence par les lettres, sinon il perd la manche. S'il y arrive, c'est vous qui la perdez.",
        "G-H-O-S-T",
        "Chaque manche perdue vous donne une lettre de GHOST. Avec les cinq, vous êtes éliminé ; le dernier joueur restant gagne.",
    ],
    client={
        "title": "Fantôme", "meta": "Manche {round} · les mots de 4+ lettres comptent",
        "fragment_label": "Lettres pour l'instant : {letters}", "empty_fragment": "Pas encore de lettres", "keyboard": "Lettres",
        "your_turn_first": "À vous : commencez la manche avec n'importe quelle lettre.",
        "your_turn": "À vous : ajoutez une lettre qui garde ceci comme début d'un mot, ou défiez.",
        "challenged": "{name} vous défie : tapez un mot qui commence par ces lettres.",
        "waiting": "En attente de {name}.", "waiting_answer": "{name} doit donner un mot qui commence par ces lettres.",
        "watching": "Vous regardez cette partie.", "challenge": "Défier", "answer": "Répondre", "give_up": "Abandonner",
        "word_placeholder": "votre mot",
        "last_completed": "{name} a complété « {word} » et reçoit une lettre.",
        "last_challenge_failed": "{name} a défié, mais « {word} » est un mot : {name} reçoit une lettre.",
        "last_bad_word": "« {word} » ne compte pas, donc {name} reçoit une lettre.",
        "last_gave_up": "{name} n'a pas trouvé de mot et reçoit une lettre.",
        "you_win": "Vous êtes le dernier joueur restant : vous gagnez !", "player_wins": "{name} est le dernier joueur restant et gagne.",
        "server_the_game_is_over": "la partie est terminée", "server_it_is_not_your_turn": "ce n'est pas votre tour",
        "server_answer_the_challenge_with_a_word_or_give_up": "répondez au défi par un mot, ou abandonnez",
        "server_there_is_nothing_to_challenge_yet": "il n'y a encore rien à défier",
        "server_add_a_letter_or_challenge": "ajoutez une lettre ou défiez",
        "server_send_a_letter_a_challenge_a_word_or_give_up": "envoyez une lettre, un défi, un mot ou abandonnez",
    },
)

T["de"] = dict(
    name="Gespenst",
    description="Der Klassiker unter den Buchstaben-Bluffspielen für 2 bis 6 Spieler: Hänge Buchstaben an ein englisches Wort, ohne es zu beenden, entlarve Bluffer und vermeide G-H-O-S-T.",
    rules="""Gespenst ist für 2 bis 6 Spieler und verwendet englische Wörter (eine eingebaute Liste mit etwa 38.000 gängigen Wörtern aus 4 oder mehr Buchstaben).
Die Spieler sind reihum in Sitzreihenfolge dran. In deinem Zug hängst du einen Buchstaben an die gemeinsame Buchstabenfolge an. Die Buchstaben müssen immer der Anfang eines echten Wortes sein, aber das prüft niemand, solange keiner herausfordert.
Statt einen Buchstaben anzuhängen, darfst du den Spieler herausfordern, der den letzten Buchstaben angehängt hat. Er muss dann ein Wort nennen, das mit allen Buchstaben beginnt und länger ist. Ist es ein echtes Wort, verliert der Herausforderer die Runde; sonst (oder wenn er aufgibt) verliert der Herausgeforderte sie.
Wer einen Buchstaben anhängt, der ein Wort aus 4 oder mehr Buchstaben vollendet, verliert die Runde sofort.
Der Verlierer einer Runde bekommt den nächsten Buchstaben von G-H-O-S-T. Wer alle fünf Buchstaben hat, scheidet aus. Jede neue Runde beginnt ohne Buchstaben; sie beginnt der Spieler links von dem, der die vorige Runde begonnen hat (ausgeschiedene werden übersprungen).
Der letzte verbliebene Spieler gewinnt. Der Pot geht an den Gewinner oder wird unter den menschlichen Spielern geteilt, wenn ein Computer gewinnt. Während einer Partie kann niemand beitreten oder aussteigen.""",
    ui="Oben steht jeder Spieler mit seinen G-H-O-S-T-Buchstaben (erhaltene Buchstaben in Rot); der Spieler am Zug ist umrandet, ausgeschiedene sind durchgestrichen. Die bisherigen Buchstaben stehen groß in der Mitte, darunter das Ergebnis der letzten Runde. Tippe in deinem Zug auf einen Buchstaben der Tastatur, um ihn anzuhängen, oder auf Herausfordern. Wirst du herausgefordert, tippe ein Wort ein, das mit den Buchstaben beginnt, und dann auf Antworten, oder auf Aufgeben. Funktioniert auf Handys, Tablets und Laptops, im Hoch- und Querformat.",
    tutorial=[
        "So spielst du Gespenst",
        "Gemeinsam buchstabiert ihr den Anfang eines englischen Wortes, ein Buchstabe pro Zug.",
        "Buchstaben anhängen",
        "Dein Buchstabe muss die Buchstaben als Anfang eines echten Wortes erhalten. Vollendest du ein Wort aus 4 oder mehr Buchstaben, verlierst du die Runde.",
        "Herausfordern",
        "Glaubst du, der letzte Spieler blufft? Fordere ihn heraus: Er muss ein Wort nennen, das mit den Buchstaben beginnt, sonst verliert er die Runde. Kann er es, verlierst du sie.",
        "G-H-O-S-T",
        "Jede verlorene Runde bringt dir einen Buchstaben von GHOST. Mit allen fünf scheidest du aus; der letzte verbliebene Spieler gewinnt.",
    ],
    client={
        "title": "Gespenst", "meta": "Runde {round} · Wörter ab 4 Buchstaben zählen",
        "fragment_label": "Bisherige Buchstaben: {letters}", "empty_fragment": "Noch keine Buchstaben", "keyboard": "Buchstaben",
        "your_turn_first": "Du bist dran: Beginne die Runde mit einem beliebigen Buchstaben.",
        "your_turn": "Du bist dran: Hänge einen Buchstaben an, der dies zum Anfang eines Wortes macht, oder fordere heraus.",
        "challenged": "{name} fordert dich heraus: Tippe ein Wort ein, das mit diesen Buchstaben beginnt.",
        "waiting": "Warte auf {name}.", "waiting_answer": "{name} muss ein Wort nennen, das mit diesen Buchstaben beginnt.",
        "watching": "Du schaust dieser Partie zu.", "challenge": "Herausfordern", "answer": "Antworten", "give_up": "Aufgeben",
        "word_placeholder": "dein Wort",
        "last_completed": "{name} hat „{word}“ vollendet und bekommt einen Buchstaben.",
        "last_challenge_failed": "{name} hat herausgefordert, aber „{word}“ ist ein Wort: {name} bekommt einen Buchstaben.",
        "last_bad_word": "„{word}“ zählt nicht, also bekommt {name} einen Buchstaben.",
        "last_gave_up": "{name} konnte kein Wort nennen und bekommt einen Buchstaben.",
        "you_win": "Du bist als Letzter übrig: Du gewinnst!", "player_wins": "{name} ist als Letzter übrig und gewinnt.",
        "server_the_game_is_over": "die Partie ist vorbei", "server_it_is_not_your_turn": "du bist nicht am Zug",
        "server_answer_the_challenge_with_a_word_or_give_up": "beantworte die Herausforderung mit einem Wort oder gib auf",
        "server_there_is_nothing_to_challenge_yet": "es gibt noch nichts herauszufordern",
        "server_add_a_letter_or_challenge": "hänge einen Buchstaben an oder fordere heraus",
        "server_send_a_letter_a_challenge_a_word_or_give_up": "sende einen Buchstaben, eine Herausforderung, ein Wort oder gib auf",
    },
)

T["pt"] = dict(
    name="Fantasma",
    description="O clássico blefe de soletração para 2 a 6 jogadores: acrescente letras a uma palavra em inglês sem terminá-la, desafie quem blefa e evite completar G-H-O-S-T.",
    rules="""Fantasma é para 2 a 6 jogadores e usa palavras em inglês (uma lista embutida de cerca de 38.000 palavras comuns de 4 ou mais letras).
Os jogadores jogam em turnos na ordem dos lugares. Na sua vez, você acrescenta uma letra ao final do grupo de letras compartilhado. As letras devem sempre ser o começo de uma palavra real, mas ninguém confere isso a menos que alguém desafie.
Em vez de acrescentar uma letra, você pode desafiar o jogador que acrescentou a última letra. Ele então deve dizer uma palavra que comece com todas as letras e seja mais longa que elas. Se for uma palavra real, quem desafiou perde a rodada; se não (ou se ele desistir), o desafiado perde.
Quem acrescenta uma letra que completa uma palavra de 4 ou mais letras perde a rodada na hora.
O perdedor de uma rodada ganha a próxima letra de G-H-O-S-T. Um jogador com as cinco letras está eliminado. Cada nova rodada começa sem letras; quem começa é o jogador à esquerda de quem começou a rodada anterior (pulando os eliminados).
O último jogador restante vence. O prêmio vai para o vencedor, ou é dividido entre os jogadores humanos se um computador vencer. Ninguém pode entrar nem sair durante uma partida.""",
    ui="No topo aparece cada jogador com suas letras de G-H-O-S-T (as letras ganhas em vermelho); o jogador da vez tem contorno e os eliminados aparecem riscados. As letras da rodada aparecem grandes no centro, com o resultado da última rodada embaixo. Na sua vez, toque em uma letra do teclado para acrescentá-la ou toque em Desafiar. Se for desafiado, digite uma palavra que comece com as letras e toque em Responder, ou em Desistir. Funciona em celulares, tablets e notebooks, na vertical e na horizontal.",
    tutorial=[
        "Como jogar Fantasma",
        "Juntos vocês soletram o começo de uma palavra em inglês, uma letra por vez.",
        "Acrescentar letras",
        "Sua letra deve manter as letras como começo de uma palavra real. Se você completar uma palavra de 4 ou mais letras, perde a rodada.",
        "Desafiar",
        "Acha que o último jogador está blefando? Desafie: ele precisa dizer uma palavra que comece com as letras, ou perde a rodada. Se conseguir, quem perde é você.",
        "G-H-O-S-T",
        "Cada rodada perdida dá a você uma letra de GHOST. Com as cinco você está eliminado; o último jogador restante vence.",
    ],
    client={
        "title": "Fantasma", "meta": "Rodada {round} · valem palavras de 4+ letras",
        "fragment_label": "Letras até agora: {letters}", "empty_fragment": "Nenhuma letra ainda", "keyboard": "Letras",
        "your_turn_first": "Sua vez: comece a rodada com qualquer letra.",
        "your_turn": "Sua vez: acrescente uma letra que mantenha isto como começo de uma palavra, ou desafie.",
        "challenged": "{name} desafiou você: digite uma palavra que comece com estas letras.",
        "waiting": "Aguardando {name}.", "waiting_answer": "{name} precisa dizer uma palavra que comece com estas letras.",
        "watching": "Você está assistindo a esta partida.", "challenge": "Desafiar", "answer": "Responder", "give_up": "Desistir",
        "word_placeholder": "sua palavra",
        "last_completed": "{name} completou “{word}” e ganha uma letra.",
        "last_challenge_failed": "{name} desafiou, mas “{word}” é uma palavra: {name} ganha uma letra.",
        "last_bad_word": "“{word}” não vale, então {name} ganha uma letra.",
        "last_gave_up": "{name} não conseguiu dizer uma palavra e ganha uma letra.",
        "you_win": "Você é o último jogador restante: você venceu!", "player_wins": "{name} é o último jogador restante e venceu.",
        "server_the_game_is_over": "o jogo terminou", "server_it_is_not_your_turn": "não é a sua vez",
        "server_answer_the_challenge_with_a_word_or_give_up": "responda ao desafio com uma palavra, ou desista",
        "server_there_is_nothing_to_challenge_yet": "ainda não há nada para desafiar",
        "server_add_a_letter_or_challenge": "acrescente uma letra ou desafie",
        "server_send_a_letter_a_challenge_a_word_or_give_up": "envie uma letra, um desafio, uma palavra ou desista",
    },
)

T["zh"] = dict(
    name="幽灵拼词",
    description="2 至 6 人的经典拼词诈唬游戏：给一个英文单词逐个加字母却不拼完它，揭穿诈唬者，别被拼成 G-H-O-S-T。",
    rules="""幽灵拼词供 2 至 6 名玩家游玩，使用英文单词（内置约 38,000 个 4 个字母及以上的常用词）。
玩家按座位顺序轮流行动。轮到你时，在共同的字母串末尾加一个字母。字母串必须始终是某个真实单词的开头，但除非有人质疑，否则没人检查。
你也可以不加字母，而是质疑加了最后一个字母的玩家。被质疑者必须说出一个以全部字母开头、且比字母串更长的单词。如果是真实单词，质疑者输掉本轮；否则（或对方放弃），被质疑者输掉本轮。
谁加的字母拼完了一个 4 个字母及以上的单词，谁立即输掉本轮。
每轮的输家获得 G-H-O-S-T 的下一个字母。集齐五个字母的玩家出局。每个新回合从空字母串开始，由上一轮首位玩家左边的玩家先开始（跳过已出局者）。
最后留下的玩家获胜。奖池归获胜者；如果电脑获胜，则由人类玩家平分。对局中任何人都不能加入或离开。""",
    ui="顶部显示每名玩家及其 G-H-O-S-T 字母（已获得的为红色）；当前行动的玩家有边框，出局的玩家被划掉。本轮的字母以大字显示在中间，下方是上一轮的结果。轮到你时，点键盘上的字母添加，或点“质疑”。被质疑时，输入一个以这些字母开头的单词并点“回答”，或点“放弃”。适用于手机、平板和笔记本电脑，横屏竖屏皆可。",
    tutorial=[
        "幽灵拼词玩法",
        "大家一起拼一个英文单词的开头，每回合一个字母。",
        "添加字母",
        "你的字母必须让字母串仍是某个真实单词的开头。如果你拼完了一个 4 个字母及以上的单词，你就输掉本轮。",
        "质疑",
        "觉得上一位玩家在诈唬？质疑他：他必须说出一个以这些字母开头的单词，否则输掉本轮。如果他说得出，输的就是你。",
        "G-H-O-S-T",
        "每输一轮获得 GHOST 的一个字母。五个字母集齐即出局；最后留下的玩家获胜。",
    ],
    client={
        "title": "幽灵拼词", "meta": "第 {round} 轮 · 4 个字母及以上的单词才算",
        "fragment_label": "目前的字母：{letters}", "empty_fragment": "还没有字母", "keyboard": "字母",
        "your_turn_first": "轮到你：用任意字母开始本轮。",
        "your_turn": "轮到你：加一个字母，让它仍是某个单词的开头，或者质疑。",
        "challenged": "{name} 质疑你：请输入一个以这些字母开头的单词。",
        "waiting": "等待 {name}。", "waiting_answer": "{name} 必须说出一个以这些字母开头的单词。",
        "watching": "你正在观看这场对局。", "challenge": "质疑", "answer": "回答", "give_up": "放弃",
        "word_placeholder": "你的单词",
        "last_completed": "{name} 拼完了“{word}”，获得一个字母。",
        "last_challenge_failed": "{name} 发起质疑，但“{word}”是一个单词：{name} 获得一个字母。",
        "last_bad_word": "“{word}”不算数，所以 {name} 获得一个字母。",
        "last_gave_up": "{name} 说不出单词，获得一个字母。",
        "you_win": "你是最后留下的玩家：你赢了！", "player_wins": "{name} 是最后留下的玩家，获胜。",
        "server_the_game_is_over": "游戏已结束", "server_it_is_not_your_turn": "还没轮到你",
        "server_answer_the_challenge_with_a_word_or_give_up": "请用一个单词回应质疑，或者放弃",
        "server_there_is_nothing_to_challenge_yet": "还没有可以质疑的内容",
        "server_add_a_letter_or_challenge": "请加一个字母或发起质疑",
        "server_send_a_letter_a_challenge_a_word_or_give_up": "请发送字母、质疑、单词或放弃",
    },
)

T["hi"] = dict(
    name="घोस्ट",
    description="2 से 6 खिलाड़ियों का क्लासिक वर्तनी-झाँसा खेल: किसी अंग्रेज़ी शब्द में अक्षर जोड़िए पर उसे पूरा मत कीजिए, झाँसा देने वालों को चुनौती दीजिए और G-H-O-S-T बनने से बचिए।",
    rules="""घोस्ट 2 से 6 खिलाड़ियों के लिए है और अंग्रेज़ी शब्दों से खेला जाता है (4 या ज़्यादा अक्षरों के लगभग 38,000 आम शब्दों की अंतर्निहित सूची)।
खिलाड़ी सीट के क्रम में बारी-बारी से खेलते हैं। अपनी बारी में आप साझा अक्षरों के अंत में एक अक्षर जोड़ते हैं। अक्षर हमेशा किसी असली शब्द की शुरुआत होने चाहिए, पर जब तक कोई चुनौती न दे, कोई इसकी जाँच नहीं करता।
अक्षर जोड़ने के बजाय आप उस खिलाड़ी को चुनौती दे सकते हैं जिसने आख़िरी अक्षर जोड़ा। उसे ऐसा शब्द बताना होगा जो सभी अक्षरों से शुरू हो और उनसे लंबा हो। अगर वह असली शब्द है, तो चुनौती देने वाला दौर हारता है; नहीं तो (या अगर वह हार मान ले) चुनौती पाने वाला दौर हारता है।
जो खिलाड़ी ऐसा अक्षर जोड़े जिससे 4 या ज़्यादा अक्षरों का शब्द पूरा हो जाए, वह तुरंत दौर हार जाता है।
दौर हारने वाले को G-H-O-S-T का अगला अक्षर मिलता है। पाँचों अक्षर पाने वाला खिलाड़ी बाहर हो जाता है। हर नया दौर ख़ाली अक्षरों से शुरू होता है; उसे पिछले दौर के पहले खिलाड़ी के बाईं ओर वाला खिलाड़ी शुरू करता है (बाहर हुए खिलाड़ियों को छोड़कर)।
आख़िर में बचा खिलाड़ी जीतता है। इनाम विजेता को मिलता है, या कंप्यूटर जीते तो मानव खिलाड़ियों में बँटता है। मैच के दौरान कोई जुड़ या छोड़ नहीं सकता।""",
    ui="ऊपर हर खिलाड़ी अपने G-H-O-S-T अक्षरों के साथ दिखता है (मिले अक्षर लाल रंग में); जिसकी बारी है उसके चारों ओर किनारा है और बाहर हुए खिलाड़ी कटे हुए दिखते हैं। अब तक के अक्षर बीच में बड़े दिखते हैं, नीचे पिछले दौर का नतीजा। अपनी बारी में कीबोर्ड के किसी अक्षर पर टैप करके उसे जोड़िए, या चुनौती दें पर टैप कीजिए। अगर आपको चुनौती मिले, तो इन अक्षरों से शुरू होने वाला शब्द लिखकर जवाब दें दबाइए, या हार मानें। फ़ोन, टैबलेट और लैपटॉप पर, खड़े और आड़े दोनों में चलता है।",
    tutorial=[
        "घोस्ट कैसे खेलें",
        "सब मिलकर किसी अंग्रेज़ी शब्द की शुरुआत लिखते हैं, हर बारी में एक अक्षर।",
        "अक्षर जोड़ना",
        "आपके अक्षर के बाद भी अक्षर किसी असली शब्द की शुरुआत रहने चाहिए। अगर आपने 4 या ज़्यादा अक्षरों का शब्द पूरा कर दिया, तो आप दौर हार जाते हैं।",
        "चुनौती देना",
        "लगता है पिछला खिलाड़ी झाँसा दे रहा है? चुनौती दीजिए: उसे इन अक्षरों से शुरू होने वाला शब्द बताना होगा, वरना वह दौर हारेगा। अगर बता दे, तो आप हारेंगे।",
        "G-H-O-S-T",
        "हर हारे दौर पर आपको GHOST का एक अक्षर मिलता है। पाँचों मिलने पर आप बाहर; आख़िर में बचा खिलाड़ी जीतता है।",
    ],
    client={
        "title": "घोस्ट", "meta": "दौर {round} · 4+ अक्षरों के शब्द गिने जाते हैं",
        "fragment_label": "अब तक के अक्षर: {letters}", "empty_fragment": "अभी कोई अक्षर नहीं", "keyboard": "अक्षर",
        "your_turn_first": "आपकी बारी: किसी भी अक्षर से दौर शुरू कीजिए।",
        "your_turn": "आपकी बारी: ऐसा अक्षर जोड़िए जिससे यह किसी शब्द की शुरुआत बना रहे, या चुनौती दीजिए।",
        "challenged": "{name} ने आपको चुनौती दी: इन अक्षरों से शुरू होने वाला शब्द लिखिए।",
        "waiting": "{name} का इंतज़ार।", "waiting_answer": "{name} को इन अक्षरों से शुरू होने वाला शब्द बताना है।",
        "watching": "आप यह मैच देख रहे हैं।", "challenge": "चुनौती दें", "answer": "जवाब दें", "give_up": "हार मानें",
        "word_placeholder": "आपका शब्द",
        "last_completed": "{name} ने “{word}” पूरा किया और एक अक्षर पाया।",
        "last_challenge_failed": "{name} ने चुनौती दी, पर “{word}” एक शब्द है: {name} को एक अक्षर मिला।",
        "last_bad_word": "“{word}” नहीं गिना जाता, इसलिए {name} को एक अक्षर मिला।",
        "last_gave_up": "{name} कोई शब्द नहीं बता पाए और एक अक्षर पाया।",
        "you_win": "आप आख़िरी बचे खिलाड़ी हैं: आप जीत गए!", "player_wins": "{name} आख़िरी बचे खिलाड़ी हैं और जीत गए।",
        "server_the_game_is_over": "खेल खत्म हो चुका है", "server_it_is_not_your_turn": "आपकी बारी नहीं है",
        "server_answer_the_challenge_with_a_word_or_give_up": "चुनौती का जवाब किसी शब्द से दीजिए, या हार मानिए",
        "server_there_is_nothing_to_challenge_yet": "अभी चुनौती देने के लिए कुछ नहीं है",
        "server_add_a_letter_or_challenge": "एक अक्षर जोड़िए या चुनौती दीजिए",
        "server_send_a_letter_a_challenge_a_word_or_give_up": "अक्षर, चुनौती, शब्द भेजिए या हार मानिए",
    },
)

T["ar"] = dict(
    name="الشبح",
    description="لعبة التهجئة والخداع الكلاسيكية من 2 إلى 6 لاعبين: أضف حروفًا إلى كلمة إنجليزية دون إكمالها، وتحدَّ المخادعين، وتجنّب تهجئة G-H-O-S-T.",
    rules="""لعبة الشبح من 2 إلى 6 لاعبين وتستخدم كلمات إنجليزية (قائمة مدمجة من نحو 38,000 كلمة شائعة من 4 أحرف أو أكثر).
يلعب اللاعبون بالدور حسب ترتيب المقاعد. في دورك تضيف حرفًا واحدًا إلى نهاية الحروف المشتركة. يجب أن تكون الحروف دائمًا بداية كلمة حقيقية، لكن لا أحد يتحقق من ذلك ما لم يتحدَّ أحدهم.
بدلًا من إضافة حرف، يمكنك تحدي اللاعب الذي أضاف الحرف الأخير. عليه عندها أن يذكر كلمة تبدأ بكل الحروف وتكون أطول منها. إن كانت كلمة حقيقية خسر المتحدي الجولة؛ وإلا (أو إن استسلم) خسرها من تم تحديه.
من يضيف حرفًا يُكمل كلمة من 4 أحرف أو أكثر يخسر الجولة فورًا.
خاسر الجولة يحصل على الحرف التالي من G-H-O-S-T. اللاعب الذي يجمع الأحرف الخمسة يخرج من اللعبة. تبدأ كل جولة جديدة دون حروف، ويبدؤها اللاعب الذي على يسار من بدأ الجولة السابقة (مع تخطي الخارجين).
يفوز آخر لاعب يبقى. الجائزة للفائز، أو تُقسم بين اللاعبين البشر إن فاز حاسوب. لا يمكن لأحد الانضمام أو المغادرة أثناء المباراة.""",
    ui="في الأعلى يظهر كل لاعب مع أحرفه من G-H-O-S-T (الأحرف المكتسبة بالأحمر)؛ ويُحاط صاحب الدور بإطار، ويُشطب الخارجون. تظهر حروف الجولة كبيرة في الوسط، وتحتها نتيجة الجولة الأخيرة. في دورك، المس حرفًا من لوحة المفاتيح لإضافته، أو المس تحدٍّ. إن تم تحديك، اكتب كلمة تبدأ بالحروف والمس أجب، أو استسلم. تعمل على الهواتف والأجهزة اللوحية والحواسيب المحمولة، بالوضعين العمودي والأفقي.",
    tutorial=[
        "طريقة لعب الشبح",
        "تتهجّون معًا بداية كلمة إنجليزية، حرفًا واحدًا في كل دور.",
        "إضافة الحروف",
        "يجب أن يُبقي حرفك الحروفَ بدايةً لكلمة حقيقية. إن أكملت كلمة من 4 أحرف أو أكثر خسرت الجولة.",
        "التحدي",
        "تظن أن اللاعب الأخير يخدع؟ تحدَّه: عليه أن يذكر كلمة تبدأ بالحروف وإلا خسر الجولة. وإن استطاع خسرتها أنت.",
        "G-H-O-S-T",
        "كل جولة تخسرها تمنحك حرفًا من GHOST. بالأحرف الخمسة تخرج؛ ويفوز آخر لاعب يبقى.",
    ],
    client={
        "title": "الشبح", "meta": "الجولة {round} · تُحتسب الكلمات من 4 أحرف فأكثر",
        "fragment_label": "الحروف حتى الآن: {letters}", "empty_fragment": "لا حروف بعد", "keyboard": "الحروف",
        "your_turn_first": "دورك: ابدأ الجولة بأي حرف.",
        "your_turn": "دورك: أضف حرفًا يُبقي هذا بداية كلمة، أو تحدَّ.",
        "challenged": "{name} يتحداك: اكتب كلمة تبدأ بهذه الحروف.",
        "waiting": "بانتظار {name}.", "waiting_answer": "على {name} أن يذكر كلمة تبدأ بهذه الحروف.",
        "watching": "أنت تشاهد هذه المباراة.", "challenge": "تحدٍّ", "answer": "أجب", "give_up": "استسلم",
        "word_placeholder": "كلمتك",
        "last_completed": "أكمل {name} الكلمة «{word}» وحصل على حرف.",
        "last_challenge_failed": "تحدّى {name}، لكن «{word}» كلمة: حصل {name} على حرف.",
        "last_bad_word": "«{word}» لا تُحتسب، لذا حصل {name} على حرف.",
        "last_gave_up": "لم يستطع {name} ذكر كلمة وحصل على حرف.",
        "you_win": "أنت آخر لاعب باقٍ: لقد فزت!", "player_wins": "{name} آخر لاعب باقٍ وقد فاز.",
        "server_the_game_is_over": "انتهت اللعبة", "server_it_is_not_your_turn": "ليس دورك",
        "server_answer_the_challenge_with_a_word_or_give_up": "أجب عن التحدي بكلمة، أو استسلم",
        "server_there_is_nothing_to_challenge_yet": "لا يوجد ما يمكن تحديه بعد",
        "server_add_a_letter_or_challenge": "أضف حرفًا أو تحدَّ",
        "server_send_a_letter_a_challenge_a_word_or_give_up": "أرسل حرفًا أو تحديًا أو كلمة أو استسلم",
    },
)
