"""Lingo texts in English and their translations into the 7 other platform languages."""

NAME = "Lingo"

DESCRIPTION = (
    "The TV word game for two teams: crack five-letter English words from red and yellow letter clues, "
    "then draw balls to complete a Lingo on your card. Most points after two rounds wins."
)

RULES = """Lingo is for two teams: 2 players (one each) or 4 players (1st and 3rd seats against 2nd and 4th; partners take turns). The words are English: mystery words come from about 1,400 common five-letter words, and any of about 3,500 five-letter words may be guessed.
Each mystery word shows its first letter. The team in control has five guesses. After each guess its letters light up: a red square is the right letter in the right place, a yellow circle is a letter that is in the word but in another place, and an unlit letter is not in the word. Red letters stay shown on the next row.
Control passes to the other team after an invalid guess (not a five-letter word from the list) or a fifth wrong guess. The other team then sees one more letter (unless that would show the whole word) and gets one guess. If it also misses, the word is discarded with no points.
A correct word scores 25 points, and the team then draws two balls from its hopper. A numbered ball covers that number on the team's Lingo card; a red stopper ball ends the drawing. Each card has 25 numbers (the first team's are odd, the second team's even), with ten covered at the start. Covering five in a row, column or diagonal is a Lingo: 50 points and a fresh card.
There are two rounds of five words; word starts alternate between the teams. In round 2 every score is doubled (50 per word, 100 per Lingo) and each hopper gets three question-mark balls, which cover the open number that best completes a line. Each hopper also holds three red stoppers.
After round 2 the team with the most points wins; a tie is shared. The pot goes to the winning team's human players, or is shared by all humans if that team has only computers. Nobody can join or leave during a match."""

UI = (
    "The top shows the round and word number and both teams' points; the team in control is outlined in gold. "
    "The board lists every guess for the current word with its red squares and yellow circles, then a row with "
    "the letters known so far (dashed). On your turn type a five-letter word and tap Guess (or press Enter). "
    "After your team finds the word, tap Draw a ball. The side panel shows both Lingo cards (covered numbers in "
    "gold), the balls drawn and the last word. Works on phones, tablets and laptops, in portrait and landscape."
)

TUTORIAL_TEXT = (
    "Guess five-letter English words: red squares are right letters in the right place, yellow circles are in "
    "the word elsewhere. Solve a word for 25 points and draw balls to make a Lingo on your card. Round 2 doubles."
)

TUTORIAL = [
    ("h1", "How to play Lingo"),
    ("p", "Two teams take turns cracking five-letter English words. You always see the first letter."),
    ("h2", "The clues"),
    ("p", "Red square: the right letter in the right place. Yellow circle: the letter is in the word, but somewhere else."),
    ("p", "You have five guesses. Miss them all, or guess a word that is not in the list, and the other team gets one guess with an extra letter."),
    ("h2", "The Lingo card"),
    ("p", "Each word you solve scores 25 points and lets your team draw two balls. Numbers cover your card; a red stopper ends the draw."),
    ("p", "Five covered in a row, column or diagonal is a Lingo: 50 more points and a new card."),
    ("h2", "Winning"),
    ("p", "After two rounds of five words, the team with the most points wins. Round 2 doubles every score."),
]

T = {}

T["es"] = dict(
    name="Lingo",
    description="El juego de palabras de la tele para dos equipos: descifra palabras inglesas de cinco letras con pistas rojas y amarillas y saca bolas para hacer Lingo en tu cartón. Gana quien tenga más puntos tras dos rondas.",
    rules="""Lingo es para dos equipos: 2 jugadores (uno por equipo) o 4 jugadores (asientos 1.º y 3.º contra 2.º y 4.º; los compañeros se turnan). Las palabras son inglesas: las palabras misteriosas salen de unas 1.400 palabras comunes de cinco letras, y se puede probar cualquiera de unas 3.500 palabras de cinco letras.
Cada palabra misteriosa muestra su primera letra. El equipo con el turno tiene cinco intentos. Tras cada intento sus letras se iluminan: un cuadrado rojo es la letra correcta en el lugar correcto, un círculo amarillo es una letra que está en la palabra pero en otro lugar, y una letra sin iluminar no está en la palabra. Las letras rojas siguen visibles en la fila siguiente.
El turno pasa al otro equipo tras un intento no válido (que no sea una palabra de cinco letras de la lista) o un quinto intento fallido. El otro equipo ve entonces una letra más (salvo que así se viera la palabra entera) y tiene un intento. Si también falla, la palabra se descarta sin puntos.
Una palabra acertada vale 25 puntos y el equipo saca dos bolas de su bombo. Una bola con número cubre ese número en el cartón Lingo del equipo; una bola roja de parada termina la extracción. Cada cartón tiene 25 números (impares los del primer equipo, pares los del segundo), con diez cubiertos al principio. Cubrir cinco en fila, columna o diagonal es un Lingo: 50 puntos y un cartón nuevo.
Hay dos rondas de cinco palabras; el comienzo de cada palabra se alterna entre los equipos. En la ronda 2 toda puntuación se duplica (50 por palabra, 100 por Lingo) y cada bombo recibe tres bolas de interrogación, que cubren el número libre que mejor completa una línea. Cada bombo tiene además tres bolas rojas de parada.
Tras la ronda 2 gana el equipo con más puntos; un empate se comparte. El bote es para los jugadores humanos del equipo ganador, o se reparte entre todos los humanos si ese equipo solo tiene computadoras. Nadie puede unirse ni salir durante una partida.""",
    ui="Arriba se ven la ronda, el número de palabra y los puntos de ambos equipos; el equipo con el turno tiene borde dorado. El tablero muestra cada intento de la palabra actual con sus cuadrados rojos y círculos amarillos, y luego una fila con las letras conocidas (con borde discontinuo). En tu turno escribe una palabra de cinco letras y toca Probar (o pulsa Intro). Cuando tu equipo acierta la palabra, toca Sacar una bola. El panel lateral muestra los dos cartones Lingo (números cubiertos en dorado), las bolas sacadas y la última palabra. Funciona en teléfonos, tabletas y portátiles, en vertical y en horizontal.",
    tutorial=[
        "Cómo jugar a Lingo",
        "Dos equipos se turnan para descifrar palabras inglesas de cinco letras. Siempre ves la primera letra.",
        "Las pistas",
        "Cuadrado rojo: la letra correcta en el lugar correcto. Círculo amarillo: la letra está en la palabra, pero en otro lugar.",
        "Tienes cinco intentos. Si fallas todos, o pruebas una palabra que no está en la lista, el otro equipo tiene un intento con una letra más.",
        "El cartón Lingo",
        "Cada palabra acertada vale 25 puntos y permite a tu equipo sacar dos bolas. Los números cubren tu cartón; una bola roja de parada termina la extracción.",
        "Cinco cubiertos en fila, columna o diagonal es un Lingo: 50 puntos más y un cartón nuevo.",
        "Ganar",
        "Tras dos rondas de cinco palabras gana el equipo con más puntos. La ronda 2 duplica toda puntuación.",
    ],
    client={
        "title": "LINGO", "meta": "Ronda {round} de 2 · palabra {word} de {total}",
        "team_points": "{names}: {points} puntos", "team_pair": "{a} y {b}", "card_of": "Cartón de {names}", "row_of": "{name}",
        "invalid": "no es una palabra",
        "your_guess": "Tu turno: adivina la palabra de cinco letras ({tries} de 5 intentos usados).",
        "your_steal": "La oportunidad de tu equipo: un intento, con una letra más a la vista.",
        "your_draw": "¡Tu equipo acertó la palabra! Saca una bola para tu cartón Lingo.",
        "draws_left": "Bolas por sacar: {count}",
        "red_hint": "Cuadrado rojo: letra correcta en su lugar. Círculo amarillo: está en la palabra, en otro lugar.",
        "waiting": "Esperando a {name}.", "watching": "Estás viendo esta partida.",
        "guess": "Probar", "guess_label": "Tu palabra de cinco letras", "draw": "Sacar una bola",
        "ball_number": "{name} sacó el {ball}.", "ball_stopper": "{name} sacó una bola roja de parada.", "ball_question": "{name} sacó una interrogación.",
        "lingo_made": "¡Lingo!", "last_word": "La última palabra fue {word}.", "discarded": "Nadie acertó {word}: se descarta.",
        "you_win": "¡Tu equipo gana con más puntos!", "they_win": "{names} ganan con más puntos.", "tie": "Empate: ambos equipos comparten la victoria.",
        "server_the_game_is_over": "la partida ha terminado", "server_it_is_not_your_turn": "no es tu turno",
        "server_draw_a_ball": "saca una bola", "server_guess_the_word": "adivina la palabra",
        "server_send_a_guess_or_draw_a_ball": "envía un intento o saca una bola",
    },
)

T["fr"] = dict(
    name="Lingo",
    description="Le jeu de mots télévisé pour deux équipes : trouvez des mots anglais de cinq lettres grâce aux indices rouges et jaunes, puis tirez des boules pour faire Lingo sur votre carte. La meilleure équipe après deux manches gagne.",
    rules="""Lingo se joue en deux équipes : 2 joueurs (un par équipe) ou 4 joueurs (1re et 3e places contre 2e et 4e ; les partenaires jouent à tour de rôle). Les mots sont anglais : les mots mystères viennent d'environ 1 400 mots courants de cinq lettres, et l'on peut proposer n'importe lequel d'environ 3 500 mots de cinq lettres.
Chaque mot mystère montre sa première lettre. L'équipe qui a la main dispose de cinq essais. Après chaque essai, ses lettres s'allument : un carré rouge est la bonne lettre à la bonne place, un rond jaune une lettre présente dans le mot mais ailleurs, et une lettre éteinte n'est pas dans le mot. Les lettres rouges restent affichées sur la ligne suivante.
La main passe à l'autre équipe après un essai non valable (pas un mot de cinq lettres de la liste) ou un cinquième essai raté. L'autre équipe voit alors une lettre de plus (sauf si cela montrait tout le mot) et dispose d'un essai. Si elle échoue aussi, le mot est écarté sans points.
Un mot trouvé rapporte 25 points, puis l'équipe tire deux boules de sa sphère. Une boule numérotée couvre ce numéro sur la carte Lingo de l'équipe ; une boule rouge d'arrêt met fin au tirage. Chaque carte compte 25 numéros (impairs pour la première équipe, pairs pour la seconde), dont dix couverts au départ. Couvrir cinq numéros en ligne, en colonne ou en diagonale fait un Lingo : 50 points et une nouvelle carte.
Il y a deux manches de cinq mots ; les mots commencent alternativement par chaque équipe. En manche 2, tous les points sont doublés (50 par mot, 100 par Lingo) et chaque sphère reçoit trois boules point d'interrogation, qui couvrent le numéro libre qui complète le mieux une ligne. Chaque sphère contient aussi trois boules rouges d'arrêt.
Après la manche 2, l'équipe qui a le plus de points gagne ; une égalité est partagée. La cagnotte revient aux joueurs humains de l'équipe gagnante, ou est partagée entre tous les humains si cette équipe n'a que des ordinateurs. Personne ne peut rejoindre ni quitter une partie en cours.""",
    ui="En haut : la manche, le numéro du mot et les points des deux équipes ; l'équipe qui a la main est entourée d'or. Le plateau montre chaque essai du mot en cours avec ses carrés rouges et ronds jaunes, puis une ligne avec les lettres connues (en pointillés). À votre tour, tapez un mot de cinq lettres et touchez Proposer (ou appuyez sur Entrée). Quand votre équipe trouve le mot, touchez Tirer une boule. Le panneau latéral montre les deux cartes Lingo (numéros couverts en or), les boules tirées et le dernier mot. Fonctionne sur téléphone, tablette et ordinateur portable, en portrait et en paysage.",
    tutorial=[
        "Comment jouer à Lingo",
        "Deux équipes trouvent tour à tour des mots anglais de cinq lettres. Vous voyez toujours la première lettre.",
        "Les indices",
        "Carré rouge : la bonne lettre à la bonne place. Rond jaune : la lettre est dans le mot, mais ailleurs.",
        "Vous avez cinq essais. Si vous les ratez tous, ou proposez un mot absent de la liste, l'autre équipe a un essai avec une lettre de plus.",
        "La carte Lingo",
        "Chaque mot trouvé rapporte 25 points et permet à votre équipe de tirer deux boules. Les numéros couvrent votre carte ; une boule rouge d'arrêt met fin au tirage.",
        "Cinq numéros couverts en ligne, en colonne ou en diagonale font un Lingo : 50 points de plus et une nouvelle carte.",
        "Gagner",
        "Après deux manches de cinq mots, l'équipe qui a le plus de points gagne. La manche 2 double tous les points.",
    ],
    client={
        "title": "LINGO", "meta": "Manche {round} sur 2 · mot {word} sur {total}",
        "team_points": "{names} : {points} points", "team_pair": "{a} et {b}", "card_of": "Carte de {names}", "row_of": "{name}",
        "invalid": "pas un mot",
        "your_guess": "À vous : trouvez le mot de cinq lettres ({tries} essais sur 5 utilisés).",
        "your_steal": "La chance de votre équipe : un essai, avec une lettre de plus.",
        "your_draw": "Votre équipe a trouvé le mot ! Tirez une boule pour votre carte Lingo.",
        "draws_left": "Boules à tirer : {count}",
        "red_hint": "Carré rouge : bonne lettre, bonne place. Rond jaune : dans le mot, ailleurs.",
        "waiting": "En attente de {name}.", "watching": "Vous regardez cette partie.",
        "guess": "Proposer", "guess_label": "Votre mot de cinq lettres", "draw": "Tirer une boule",
        "ball_number": "{name} a tiré le {ball}.", "ball_stopper": "{name} a tiré une boule rouge d'arrêt.", "ball_question": "{name} a tiré un point d'interrogation.",
        "lingo_made": "Lingo !", "last_word": "Le dernier mot était {word}.", "discarded": "Personne n'a trouvé {word} : il est écarté.",
        "you_win": "Votre équipe gagne avec le plus de points !", "they_win": "{names} gagnent avec le plus de points.", "tie": "Égalité : les deux équipes partagent la victoire.",
        "server_the_game_is_over": "la partie est terminée", "server_it_is_not_your_turn": "ce n'est pas votre tour",
        "server_draw_a_ball": "tirez une boule", "server_guess_the_word": "trouvez le mot",
        "server_send_a_guess_or_draw_a_ball": "envoyez un essai ou tirez une boule",
    },
)

T["de"] = dict(
    name="Lingo",
    description="Das TV-Wortspiel für zwei Teams: Knacke englische Wörter aus fünf Buchstaben mit roten und gelben Hinweisen und ziehe Kugeln für ein Lingo auf deiner Karte. Wer nach zwei Runden die meisten Punkte hat, gewinnt.",
    rules="""Lingo ist für zwei Teams: 2 Spieler (je einer) oder 4 Spieler (1. und 3. Platz gegen 2. und 4.; Partner wechseln sich ab). Die Wörter sind englisch: Lösungswörter stammen aus etwa 1.400 gängigen Wörtern mit fünf Buchstaben, geraten werden darf jedes von etwa 3.500 Wörtern mit fünf Buchstaben.
Jedes Lösungswort zeigt seinen ersten Buchstaben. Das Team am Zug hat fünf Versuche. Nach jedem Versuch leuchten die Buchstaben auf: Ein rotes Quadrat ist der richtige Buchstabe an der richtigen Stelle, ein gelber Kreis ein Buchstabe, der im Wort vorkommt, aber an anderer Stelle, und ein unbeleuchteter Buchstabe kommt nicht vor. Rote Buchstaben bleiben in der nächsten Zeile sichtbar.
Nach einem ungültigen Versuch (kein Wort mit fünf Buchstaben aus der Liste) oder einem fünften Fehlversuch geht das Spiel an das andere Team. Es sieht dann einen Buchstaben mehr (außer das würde das ganze Wort zeigen) und hat einen Versuch. Scheitert es auch, wird das Wort ohne Punkte verworfen.
Ein gelöstes Wort bringt 25 Punkte, danach zieht das Team zwei Kugeln aus seiner Trommel. Eine Zahlenkugel deckt diese Zahl auf der Lingo-Karte des Teams ab; eine rote Stoppkugel beendet das Ziehen. Jede Karte hat 25 Zahlen (ungerade beim ersten Team, gerade beim zweiten), zehn davon sind zu Beginn abgedeckt. Fünf abgedeckte in einer Reihe, Spalte oder Diagonale sind ein Lingo: 50 Punkte und eine neue Karte.
Es gibt zwei Runden mit je fünf Wörtern; die Wörter beginnen abwechselnd bei den Teams. In Runde 2 zählt alles doppelt (50 pro Wort, 100 pro Lingo) und jede Trommel bekommt drei Fragezeichen-Kugeln, die die freie Zahl abdecken, die eine Linie am besten vervollständigt. Jede Trommel enthält außerdem drei rote Stoppkugeln.
Nach Runde 2 gewinnt das Team mit den meisten Punkten; Gleichstand wird geteilt. Der Pot geht an die menschlichen Spieler des Siegerteams oder wird unter allen Menschen geteilt, wenn dieses Team nur aus Computern besteht. Während einer Partie kann niemand beitreten oder aussteigen.""",
    ui="Oben stehen Runde, Wortnummer und die Punkte beider Teams; das Team am Zug ist golden umrandet. Das Brett zeigt jeden Versuch zum aktuellen Wort mit roten Quadraten und gelben Kreisen, darunter eine Zeile mit den bekannten Buchstaben (gestrichelt). Tippe in deinem Zug ein Wort mit fünf Buchstaben ein und dann auf Raten (oder drücke Enter). Hat dein Team das Wort gelöst, tippe auf Kugel ziehen. Die Seitenleiste zeigt beide Lingo-Karten (abgedeckte Zahlen in Gold), die gezogenen Kugeln und das letzte Wort. Funktioniert auf Handys, Tablets und Laptops, im Hoch- und Querformat.",
    tutorial=[
        "So spielst du Lingo",
        "Zwei Teams knacken abwechselnd englische Wörter aus fünf Buchstaben. Den ersten Buchstaben siehst du immer.",
        "Die Hinweise",
        "Rotes Quadrat: richtiger Buchstabe an der richtigen Stelle. Gelber Kreis: Der Buchstabe kommt vor, aber an anderer Stelle.",
        "Du hast fünf Versuche. Verfehlst du alle oder rätst ein Wort, das nicht in der Liste steht, bekommt das andere Team einen Versuch mit einem Buchstaben mehr.",
        "Die Lingo-Karte",
        "Jedes gelöste Wort bringt 25 Punkte, und dein Team zieht zwei Kugeln. Zahlen decken deine Karte ab; eine rote Stoppkugel beendet das Ziehen.",
        "Fünf abgedeckte in einer Reihe, Spalte oder Diagonale sind ein Lingo: 50 Punkte mehr und eine neue Karte.",
        "Gewinnen",
        "Nach zwei Runden mit je fünf Wörtern gewinnt das Team mit den meisten Punkten. Runde 2 zählt doppelt.",
    ],
    client={
        "title": "LINGO", "meta": "Runde {round} von 2 · Wort {word} von {total}",
        "team_points": "{names}: {points} Punkte", "team_pair": "{a} und {b}", "card_of": "Karte von {names}", "row_of": "{name}",
        "invalid": "kein Wort",
        "your_guess": "Du bist dran: Rate das Wort aus fünf Buchstaben ({tries} von 5 Versuchen verbraucht).",
        "your_steal": "Die Chance deines Teams: ein Versuch, mit einem Buchstaben mehr.",
        "your_draw": "Dein Team hat das Wort gelöst! Ziehe eine Kugel für eure Lingo-Karte.",
        "draws_left": "Noch zu ziehende Kugeln: {count}",
        "red_hint": "Rotes Quadrat: richtiger Buchstabe, richtige Stelle. Gelber Kreis: im Wort, an anderer Stelle.",
        "waiting": "Warte auf {name}.", "watching": "Du schaust dieser Partie zu.",
        "guess": "Raten", "guess_label": "Dein Wort aus fünf Buchstaben", "draw": "Kugel ziehen",
        "ball_number": "{name} hat die {ball} gezogen.", "ball_stopper": "{name} hat eine rote Stoppkugel gezogen.", "ball_question": "{name} hat ein Fragezeichen gezogen.",
        "lingo_made": "Lingo!", "last_word": "Das letzte Wort war {word}.", "discarded": "Niemand hat {word} gelöst: Es wird verworfen.",
        "you_win": "Dein Team gewinnt mit den meisten Punkten!", "they_win": "{names} gewinnen mit den meisten Punkten.", "tie": "Unentschieden: Beide Teams teilen sich den Sieg.",
        "server_the_game_is_over": "die Partie ist vorbei", "server_it_is_not_your_turn": "du bist nicht am Zug",
        "server_draw_a_ball": "ziehe eine Kugel", "server_guess_the_word": "rate das Wort",
        "server_send_a_guess_or_draw_a_ball": "sende einen Versuch oder ziehe eine Kugel",
    },
)

T["pt"] = dict(
    name="Lingo",
    description="O jogo de palavras da TV para duas equipes: descubra palavras em inglês de cinco letras com pistas vermelhas e amarelas e sorteie bolas para fazer Lingo na sua cartela. Vence quem tiver mais pontos após duas rodadas.",
    rules="""Lingo é para duas equipes: 2 jogadores (um por equipe) ou 4 jogadores (1º e 3º lugares contra 2º e 4º; os parceiros se revezam). As palavras são em inglês: as palavras secretas vêm de cerca de 1.400 palavras comuns de cinco letras, e qualquer uma de cerca de 3.500 palavras de cinco letras pode ser chutada.
Cada palavra secreta mostra a primeira letra. A equipe na vez tem cinco tentativas. Depois de cada tentativa, as letras acendem: um quadrado vermelho é a letra certa no lugar certo, um círculo amarelo é uma letra que está na palavra mas em outro lugar, e uma letra apagada não está na palavra. As letras vermelhas continuam visíveis na linha seguinte.
A vez passa para a outra equipe depois de uma tentativa inválida (que não seja uma palavra de cinco letras da lista) ou de uma quinta tentativa errada. A outra equipe vê então mais uma letra (a não ser que isso mostre a palavra inteira) e tem uma tentativa. Se também errar, a palavra é descartada sem pontos.
Uma palavra acertada vale 25 pontos, e a equipe então sorteia duas bolas do seu globo. Uma bola numerada cobre esse número na cartela Lingo da equipe; uma bola vermelha de parada encerra o sorteio. Cada cartela tem 25 números (ímpares na primeira equipe, pares na segunda), com dez cobertos no início. Cobrir cinco em linha, coluna ou diagonal é um Lingo: 50 pontos e uma cartela nova.
São duas rodadas de cinco palavras; as palavras começam alternadamente por cada equipe. Na rodada 2 toda pontuação dobra (50 por palavra, 100 por Lingo) e cada globo ganha três bolas de interrogação, que cobrem o número livre que melhor completa uma linha. Cada globo também tem três bolas vermelhas de parada.
Depois da rodada 2 vence a equipe com mais pontos; um empate é dividido. O prêmio vai para os jogadores humanos da equipe vencedora, ou é dividido entre todos os humanos se essa equipe só tiver computadores. Ninguém pode entrar nem sair durante uma partida.""",
    ui="No topo aparecem a rodada, o número da palavra e os pontos das duas equipes; a equipe na vez tem contorno dourado. O tabuleiro mostra cada tentativa da palavra atual com seus quadrados vermelhos e círculos amarelos, e depois uma linha com as letras conhecidas (tracejada). Na sua vez, digite uma palavra de cinco letras e toque em Chutar (ou aperte Enter). Quando sua equipe acerta a palavra, toque em Sortear bola. O painel lateral mostra as duas cartelas Lingo (números cobertos em dourado), as bolas sorteadas e a última palavra. Funciona em celulares, tablets e notebooks, na vertical e na horizontal.",
    tutorial=[
        "Como jogar Lingo",
        "Duas equipes se revezam para descobrir palavras em inglês de cinco letras. Você sempre vê a primeira letra.",
        "As pistas",
        "Quadrado vermelho: a letra certa no lugar certo. Círculo amarelo: a letra está na palavra, mas em outro lugar.",
        "Você tem cinco tentativas. Se errar todas, ou chutar uma palavra que não está na lista, a outra equipe tem uma tentativa com uma letra a mais.",
        "A cartela Lingo",
        "Cada palavra acertada vale 25 pontos e deixa sua equipe sortear duas bolas. Os números cobrem sua cartela; uma bola vermelha de parada encerra o sorteio.",
        "Cinco cobertos em linha, coluna ou diagonal é um Lingo: mais 50 pontos e uma cartela nova.",
        "Vencer",
        "Depois de duas rodadas de cinco palavras, vence a equipe com mais pontos. A rodada 2 dobra toda pontuação.",
    ],
    client={
        "title": "LINGO", "meta": "Rodada {round} de 2 · palavra {word} de {total}",
        "team_points": "{names}: {points} pontos", "team_pair": "{a} e {b}", "card_of": "Cartela de {names}", "row_of": "{name}",
        "invalid": "não é uma palavra",
        "your_guess": "Sua vez: descubra a palavra de cinco letras ({tries} de 5 tentativas usadas).",
        "your_steal": "A chance da sua equipe: uma tentativa, com mais uma letra à mostra.",
        "your_draw": "Sua equipe acertou a palavra! Sorteie uma bola para a sua cartela Lingo.",
        "draws_left": "Bolas para sortear: {count}",
        "red_hint": "Quadrado vermelho: letra certa no lugar certo. Círculo amarelo: está na palavra, em outro lugar.",
        "waiting": "Aguardando {name}.", "watching": "Você está assistindo a esta partida.",
        "guess": "Chutar", "guess_label": "Sua palavra de cinco letras", "draw": "Sortear bola",
        "ball_number": "{name} sorteou o {ball}.", "ball_stopper": "{name} sorteou uma bola vermelha de parada.", "ball_question": "{name} sorteou uma interrogação.",
        "lingo_made": "Lingo!", "last_word": "A última palavra foi {word}.", "discarded": "Ninguém acertou {word}: ela foi descartada.",
        "you_win": "Sua equipe venceu com mais pontos!", "they_win": "{names} venceram com mais pontos.", "tie": "Empate: as duas equipes dividem a vitória.",
        "server_the_game_is_over": "o jogo terminou", "server_it_is_not_your_turn": "não é a sua vez",
        "server_draw_a_ball": "sorteie uma bola", "server_guess_the_word": "descubra a palavra",
        "server_send_a_guess_or_draw_a_ball": "envie uma tentativa ou sorteie uma bola",
    },
)

T["zh"] = dict(
    name="Lingo 猜词",
    description="两队对战的电视猜词游戏：根据红色和黄色提示破解五个字母的英文单词，再抽球在你的 Lingo 卡上连线。两轮后得分最高者获胜。",
    rules="""Lingo 猜词由两队进行：2 名玩家（每队一人）或 4 名玩家（第 1、3 座对第 2、4 座；搭档轮流猜）。单词为英文：谜底来自约 1,400 个常用的五字母单词，猜测时可以使用约 3,500 个五字母单词中的任意一个。
每个谜底都会显示首字母。掌握控制权的队伍有五次猜测机会。每次猜测后字母会亮起：红色方块表示字母正确且位置正确，黄色圆圈表示该字母在单词中但位置不同，不亮表示单词中没有这个字母。红色字母会保留在下一行。
猜测无效（不是列表中的五字母单词）或第五次猜错后，控制权交给另一队。另一队会多看到一个字母（除非这样会显示整个单词），并有一次猜测机会。如果也猜错，该单词作废，不计分。
猜中一个单词得 25 分，随后该队从自己的摇球器中抽两个球。数字球会盖住本队 Lingo 卡上的对应数字；红色停止球会结束抽球。每张卡有 25 个数字（第一队为奇数，第二队为偶数），开始时已盖住十个。在一行、一列或一条对角线上盖满五个即为 Lingo：得 50 分并换一张新卡。
共两轮，每轮五个单词；每个单词轮流由两队先开始。第 2 轮所有得分翻倍（每个单词 50 分，每个 Lingo 100 分），每个摇球器加入三个问号球，问号球会盖住最有助于连成一线的空位。每个摇球器另有三个红色停止球。
第 2 轮结束后得分最高的队伍获胜；平分则共享胜利。奖池归获胜队的人类玩家；如果该队只有电脑，则由所有人类玩家平分。对局中任何人都不能加入或离开。""",
    ui="顶部显示轮次、单词序号和两队得分；当前掌握控制权的队伍有金色边框。棋盘列出当前单词的每次猜测及其红色方块和黄色圆圈，下面一行显示目前已知的字母（虚线框）。轮到你时，输入一个五字母单词并点“猜”（或按回车）。你的队伍猜中后，点“抽球”。侧边面板显示两张 Lingo 卡（已盖住的数字为金色）、抽到的球和上一个单词。适用于手机、平板和笔记本电脑，横屏竖屏皆可。",
    tutorial=[
        "Lingo 猜词玩法",
        "两队轮流破解五个字母的英文单词。你总能看到首字母。",
        "提示",
        "红色方块：字母正确，位置正确。黄色圆圈：字母在单词中，但在别的位置。",
        "你有五次机会。如果全部猜错，或猜了不在列表中的单词，另一队就能多看一个字母并猜一次。",
        "Lingo 卡",
        "每猜中一个单词得 25 分，你的队伍可以抽两个球。数字会盖在你的卡上；红色停止球会结束抽球。",
        "在一行、一列或对角线上盖满五个就是 Lingo：再得 50 分并换新卡。",
        "获胜",
        "两轮各五个单词之后，得分最高的队伍获胜。第 2 轮所有得分翻倍。",
    ],
    client={
        "title": "LINGO", "meta": "第 {round} 轮（共 2 轮）· 第 {word} 个单词（共 {total} 个）",
        "team_points": "{names}：{points} 分", "team_pair": "{a} 和 {b}", "card_of": "{names} 的卡", "row_of": "{name}",
        "invalid": "不是单词",
        "your_guess": "轮到你：猜这个五字母单词（已用 {tries}/5 次）。",
        "your_steal": "你们队的机会：猜一次，多显示一个字母。",
        "your_draw": "你们队猜中了！为你们的 Lingo 卡抽一个球。",
        "draws_left": "剩余可抽球数：{count}",
        "red_hint": "红色方块：字母和位置都对。黄色圆圈：在单词中，但位置不同。",
        "waiting": "等待 {name}。", "watching": "你正在观看这场对局。",
        "guess": "猜", "guess_label": "你猜的五字母单词", "draw": "抽球",
        "ball_number": "{name} 抽到了 {ball}。", "ball_stopper": "{name} 抽到了红色停止球。", "ball_question": "{name} 抽到了问号球。",
        "lingo_made": "Lingo！", "last_word": "上一个单词是 {word}。", "discarded": "没人猜中 {word}：该单词作废。",
        "you_win": "你们队以最高分获胜！", "they_win": "{names} 以最高分获胜。", "tie": "平局：两队共享胜利。",
        "server_the_game_is_over": "游戏已结束", "server_it_is_not_your_turn": "还没轮到你",
        "server_draw_a_ball": "请抽一个球", "server_guess_the_word": "请猜单词",
        "server_send_a_guess_or_draw_a_ball": "请发送猜测或抽一个球",
    },
)

T["hi"] = dict(
    name="लिंगो",
    description="दो टीमों का टीवी शब्द खेल: लाल और पीले संकेतों से पाँच अक्षरों के अंग्रेज़ी शब्द बूझिए, फिर अपने कार्ड पर लिंगो बनाने के लिए गेंदें निकालिए। दो दौर के बाद सबसे ज़्यादा अंकों वाली टीम जीतती है।",
    rules="""लिंगो दो टीमों के लिए है: 2 खिलाड़ी (हर टीम में एक) या 4 खिलाड़ी (पहली और तीसरी सीट बनाम दूसरी और चौथी; साथी बारी-बारी से अनुमान लगाते हैं)। शब्द अंग्रेज़ी हैं: रहस्य शब्द लगभग 1,400 आम पाँच-अक्षर शब्दों से आते हैं, और अनुमान में लगभग 3,500 पाँच-अक्षर शब्दों में से कोई भी चलेगा।
हर रहस्य शब्द का पहला अक्षर दिखता है। जिस टीम की बारी है उसके पास पाँच अनुमान हैं। हर अनुमान के बाद अक्षर चमकते हैं: लाल वर्ग का मतलब सही अक्षर सही जगह, पीले गोले का मतलब अक्षर शब्द में है पर दूसरी जगह, और न चमकने वाला अक्षर शब्द में नहीं है। लाल अक्षर अगली पंक्ति में भी दिखते रहते हैं।
अमान्य अनुमान (सूची का पाँच-अक्षर शब्द नहीं) या पाँचवें ग़लत अनुमान के बाद बारी दूसरी टीम को जाती है। तब दूसरी टीम को एक अक्षर और दिखता है (अगर उससे पूरा शब्द न दिख जाए) और उसे एक अनुमान मिलता है। अगर वह भी चूके, तो शब्द बिना अंकों के छोड़ दिया जाता है।
सही शब्द के 25 अंक मिलते हैं, फिर टीम अपनी गेंद-मशीन से दो गेंदें निकालती है। नंबर वाली गेंद टीम के लिंगो कार्ड पर वह नंबर ढक देती है; लाल रोक-गेंद निकालना बंद कर देती है। हर कार्ड पर 25 नंबर होते हैं (पहली टीम के विषम, दूसरी के सम), शुरुआत में दस ढके होते हैं। पंक्ति, स्तंभ या विकर्ण में पाँच ढकना लिंगो है: 50 अंक और नया कार्ड।
पाँच-पाँच शब्दों के दो दौर होते हैं; शब्द बारी-बारी से दोनों टीमों से शुरू होते हैं। दूसरे दौर में सब अंक दोगुने होते हैं (हर शब्द 50, हर लिंगो 100) और हर मशीन में तीन प्रश्नचिह्न गेंदें जुड़ती हैं, जो वह खाली नंबर ढकती हैं जो किसी रेखा को सबसे अच्छा पूरा करे। हर मशीन में तीन लाल रोक-गेंदें भी होती हैं।
दूसरे दौर के बाद सबसे ज़्यादा अंकों वाली टीम जीतती है; बराबरी में जीत बँटती है। इनाम जीतने वाली टीम के मानव खिलाड़ियों को मिलता है, या उस टीम में सिर्फ़ कंप्यूटर हों तो सभी मानवों में बँटता है। मैच के दौरान कोई जुड़ या छोड़ नहीं सकता।""",
    ui="ऊपर दौर, शब्द संख्या और दोनों टीमों के अंक दिखते हैं; जिस टीम की बारी है उसके चारों ओर सुनहरा घेरा है। बोर्ड पर मौजूदा शब्द के हर अनुमान के लाल वर्ग और पीले गोले दिखते हैं, फिर अब तक ज्ञात अक्षरों वाली पंक्ति (टूटी रेखा)। अपनी बारी में पाँच अक्षरों का शब्द लिखकर अनुमान पर टैप कीजिए (या Enter दबाइए)। आपकी टीम के शब्द बूझने पर गेंद निकालें पर टैप कीजिए। बगल का पैनल दोनों लिंगो कार्ड (ढके नंबर सुनहरे), निकली गेंदें और पिछला शब्द दिखाता है। फ़ोन, टैबलेट और लैपटॉप पर, खड़े और आड़े दोनों में चलता है।",
    tutorial=[
        "लिंगो कैसे खेलें",
        "दो टीमें बारी-बारी से पाँच अक्षरों के अंग्रेज़ी शब्द बूझती हैं। पहला अक्षर हमेशा दिखता है।",
        "संकेत",
        "लाल वर्ग: सही अक्षर, सही जगह। पीला गोला: अक्षर शब्द में है, पर दूसरी जगह।",
        "आपके पास पाँच अनुमान हैं। सब चूक जाएँ, या सूची से बाहर का शब्द लिखें, तो दूसरी टीम को एक और अक्षर के साथ एक अनुमान मिलता है।",
        "लिंगो कार्ड",
        "हर बूझे शब्द के 25 अंक मिलते हैं और आपकी टीम दो गेंदें निकालती है। नंबर आपका कार्ड ढकते हैं; लाल रोक-गेंद निकालना बंद कर देती है।",
        "पंक्ति, स्तंभ या विकर्ण में पाँच ढके तो लिंगो: 50 अंक और नया कार्ड।",
        "जीतना",
        "पाँच-पाँच शब्दों के दो दौर के बाद सबसे ज़्यादा अंकों वाली टीम जीतती है। दूसरे दौर में सब अंक दोगुने।",
    ],
    client={
        "title": "LINGO", "meta": "दौर {round} / 2 · शब्द {word} / {total}",
        "team_points": "{names}: {points} अंक", "team_pair": "{a} और {b}", "card_of": "{names} का कार्ड", "row_of": "{name}",
        "invalid": "शब्द नहीं",
        "your_guess": "आपकी बारी: पाँच अक्षरों का शब्द बूझिए (5 में से {tries} अनुमान हो चुके)।",
        "your_steal": "आपकी टीम का मौक़ा: एक अनुमान, एक और अक्षर के साथ।",
        "your_draw": "आपकी टीम ने शब्द बूझ लिया! अपने लिंगो कार्ड के लिए गेंद निकालिए।",
        "draws_left": "बची गेंदें: {count}",
        "red_hint": "लाल वर्ग: सही अक्षर, सही जगह। पीला गोला: शब्द में है, दूसरी जगह।",
        "waiting": "{name} का इंतज़ार।", "watching": "आप यह मैच देख रहे हैं।",
        "guess": "अनुमान", "guess_label": "आपका पाँच-अक्षर अनुमान", "draw": "गेंद निकालें",
        "ball_number": "{name} ने {ball} निकाला।", "ball_stopper": "{name} ने लाल रोक-गेंद निकाली।", "ball_question": "{name} ने प्रश्नचिह्न गेंद निकाली।",
        "lingo_made": "लिंगो!", "last_word": "पिछला शब्द {word} था।", "discarded": "कोई {word} नहीं बूझ पाया: इसे छोड़ दिया गया।",
        "you_win": "आपकी टीम सबसे ज़्यादा अंकों से जीती!", "they_win": "{names} सबसे ज़्यादा अंकों से जीते।", "tie": "बराबरी: दोनों टीमें जीत बाँटती हैं।",
        "server_the_game_is_over": "खेल खत्म हो चुका है", "server_it_is_not_your_turn": "आपकी बारी नहीं है",
        "server_draw_a_ball": "गेंद निकालिए", "server_guess_the_word": "शब्द बूझिए",
        "server_send_a_guess_or_draw_a_ball": "अनुमान भेजिए या गेंद निकालिए",
    },
)

T["ar"] = dict(
    name="لينغو",
    description="لعبة الكلمات التلفزيونية لفريقين: اكشف كلمات إنجليزية من خمسة أحرف بتلميحات حمراء وصفراء، ثم اسحب كرات لتصنع «لينغو» على بطاقتك. يفوز صاحب أكثر النقاط بعد جولتين.",
    rules="""لينغو لفريقين: لاعبان (واحد لكل فريق) أو 4 لاعبين (المقعدان الأول والثالث ضد الثاني والرابع؛ يتناوب الشريكان). الكلمات إنجليزية: الكلمات السرية من نحو 1,400 كلمة شائعة من خمسة أحرف، ويمكن تخمين أي كلمة من نحو 3,500 كلمة من خمسة أحرف.
تُظهر كل كلمة سرية حرفها الأول. للفريق صاحب الدور خمس محاولات. بعد كل محاولة تضيء أحرفها: المربع الأحمر حرف صحيح في مكانه الصحيح، والدائرة الصفراء حرف موجود في الكلمة لكن في مكان آخر، والحرف غير المضاء ليس في الكلمة. تبقى الأحرف الحمراء ظاهرة في السطر التالي.
ينتقل الدور إلى الفريق الآخر بعد محاولة غير صالحة (ليست كلمة من خمسة أحرف من القائمة) أو بعد خامس محاولة خاطئة. يرى الفريق الآخر حينها حرفًا إضافيًا (إلا إذا كشف ذلك الكلمة كلها) ويحصل على محاولة واحدة. إن أخطأ أيضًا تُستبعد الكلمة دون نقاط.
الكلمة الصحيحة تمنح 25 نقطة، ثم يسحب الفريق كرتين من آلته. الكرة المرقّمة تغطي ذلك الرقم على بطاقة لينغو الخاصة بالفريق؛ والكرة الحمراء الموقِفة تُنهي السحب. لكل بطاقة 25 رقمًا (فردية للفريق الأول وزوجية للثاني)، مغطى منها عشرة في البداية. تغطية خمسة في صف أو عمود أو قطر هي «لينغو»: 50 نقطة وبطاقة جديدة.
هناك جولتان من خمس كلمات؛ تبدأ الكلمات بالتناوب بين الفريقين. في الجولة الثانية تتضاعف كل النقاط (50 لكل كلمة و100 لكل لينغو) وتُضاف إلى كل آلة ثلاث كرات استفهام تغطي الرقم الفارغ الذي يُكمل خطًا على أفضل وجه. في كل آلة أيضًا ثلاث كرات حمراء موقِفة.
بعد الجولة الثانية يفوز الفريق صاحب أكثر النقاط؛ ويُتقاسم التعادل. الجائزة للاعبين البشر في الفريق الفائز، أو تُقسم بين كل البشر إن لم يكن في ذلك الفريق إلا حواسيب. لا يمكن لأحد الانضمام أو المغادرة أثناء المباراة.""",
    ui="في الأعلى الجولة ورقم الكلمة ونقاط الفريقين؛ ويُحاط الفريق صاحب الدور بإطار ذهبي. تعرض اللوحة كل محاولة للكلمة الحالية بمربعاتها الحمراء ودوائرها الصفراء، ثم سطرًا بالأحرف المعروفة حتى الآن (بإطار متقطع). في دورك اكتب كلمة من خمسة أحرف والمس خمّن (أو اضغط Enter). عندما يجد فريقك الكلمة، المس اسحب كرة. تعرض اللوحة الجانبية بطاقتي لينغو (الأرقام المغطاة بالذهبي) والكرات المسحوبة والكلمة الأخيرة. تعمل على الهواتف والأجهزة اللوحية والحواسيب المحمولة، بالوضعين العمودي والأفقي.",
    tutorial=[
        "طريقة لعب لينغو",
        "يتناوب فريقان على كشف كلمات إنجليزية من خمسة أحرف. ترى دائمًا الحرف الأول.",
        "التلميحات",
        "مربع أحمر: الحرف الصحيح في المكان الصحيح. دائرة صفراء: الحرف في الكلمة لكن في مكان آخر.",
        "لديك خمس محاولات. إن أخطأتها كلها، أو خمّنت كلمة ليست في القائمة، يحصل الفريق الآخر على محاولة مع حرف إضافي.",
        "بطاقة لينغو",
        "كل كلمة تكشفها تمنح 25 نقطة ويسحب فريقك كرتين. الأرقام تغطي بطاقتك؛ والكرة الحمراء الموقِفة تُنهي السحب.",
        "خمسة مغطاة في صف أو عمود أو قطر هي لينغو: 50 نقطة إضافية وبطاقة جديدة.",
        "الفوز",
        "بعد جولتين من خمس كلمات يفوز الفريق صاحب أكثر النقاط. الجولة الثانية تضاعف كل النقاط.",
    ],
    client={
        "title": "LINGO", "meta": "الجولة {round} من 2 · الكلمة {word} من {total}",
        "team_points": "{names}: {points} نقطة", "team_pair": "{a} و{b}", "card_of": "بطاقة {names}", "row_of": "{name}",
        "invalid": "ليست كلمة",
        "your_guess": "دورك: خمّن الكلمة المكوّنة من خمسة أحرف (استُخدمت {tries} من 5 محاولات).",
        "your_steal": "فرصة فريقك: محاولة واحدة مع حرف إضافي.",
        "your_draw": "وجد فريقك الكلمة! اسحب كرة لبطاقة لينغو.",
        "draws_left": "الكرات المتبقية للسحب: {count}",
        "red_hint": "مربع أحمر: حرف صحيح في مكانه. دائرة صفراء: في الكلمة، في مكان آخر.",
        "waiting": "بانتظار {name}.", "watching": "أنت تشاهد هذه المباراة.",
        "guess": "خمّن", "guess_label": "تخمينك من خمسة أحرف", "draw": "اسحب كرة",
        "ball_number": "سحب {name} الرقم {ball}.", "ball_stopper": "سحب {name} كرة حمراء موقِفة.", "ball_question": "سحب {name} كرة استفهام.",
        "lingo_made": "لينغو!", "last_word": "كانت الكلمة الأخيرة {word}.", "discarded": "لم يكشف أحد {word}: استُبعدت.",
        "you_win": "فاز فريقك بأكثر النقاط!", "they_win": "فاز {names} بأكثر النقاط.", "tie": "تعادل: يتقاسم الفريقان الفوز.",
        "server_the_game_is_over": "انتهت اللعبة", "server_it_is_not_your_turn": "ليس دورك",
        "server_draw_a_ball": "اسحب كرة", "server_guess_the_word": "خمّن الكلمة",
        "server_send_a_guess_or_draw_a_ball": "أرسل تخمينًا أو اسحب كرة",
    },
)
