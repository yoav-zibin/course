"""Sueca's texts in English and their translations into the 7 other platform languages."""

NAME = "Sueca"

DESCRIPTION = (
    "The Portuguese and Brazilian card game for four players in two teams: follow suit, "
    "use trumps and win the tricks worth the most points."
)

RULES = """Sueca is played by 4 players in two teams; partners sit opposite each other (the 1st and 3rd seats against the 2nd and 4th). It uses a 40-card deck without 8s, 9s and 10s.
Card order in each suit, highest first: A, 7, K, J, Q, 6, 5, 4, 3, 2. Card points: ace 11, seven 10, king 4, jack 3, queen 2, the rest 0; each deal has 120 points.
Every player gets 10 cards. The dealer's last card is shown to everyone and sets the trump suit; it stays in the dealer's hand.
The player after the dealer leads the first trick, and each player plays one card in turn. You must follow the suit that was led if you can; otherwise you may play any card, including a trump. The highest trump wins the trick; if no trump was played, the highest card of the led suit wins. The winner's team takes the trick's points and the winner leads the next trick.
After 10 tricks the deal is scored: 61 to 90 points gives 1 game point and 91 or more gives 2; at 60 to 60 nobody scores. A team that wins all 10 tricks wins the match at once. The next player deals.
The first team to reach 4 game points wins the match. The pot goes to the winning team's human players, or is shared by all human players if the winning team has only computers. Nobody can join or leave during a match."""

UI = (
    "A green card table with your seat at the bottom and your partner at the top. The header shows each "
    "team's game points out of 4. Below it: the trump suit and its card, the deal number, and who still "
    "holds the trump card. The current trick lies in the middle; between tricks the last trick stays there, "
    "faded, with the name of the player who took it. Your hand is at the bottom: cards you may play are "
    "outlined in gold, the others are dimmed. Above your hand you see your team's card points and tricks in "
    "this deal and, at the start of a deal, the last deal's result. Spectators see only card backs. Works on "
    "phones, tablets and laptops, in portrait and landscape."
)

TUTORIAL_TEXT = (
    "Follow suit if you can, win tricks with aces and sevens, and trump when you cannot follow. "
    "The first team to 4 game points wins."
)

# The tutorial's visible strings, in page order (each is one text node of tutorial.html).
TUTORIAL = [
    ("h1", "How to play Sueca"),
    ("p", "Four players in two teams: your partner sits across from you."),
    ("h2", "The cards"),
    ("p", "Highest to lowest in each suit: A, 7, K, J, Q, 6, 5, 4, 3, 2."),
    ("p", "Points: ace 11, seven 10, king 4, jack 3, queen 2. A deal has 120 points."),
    ("h2", "Playing a trick"),
    ("p", "The dealer's last card sets the trump suit."),
    ("p", "Follow the suit that was led if you can. If you cannot, play any card: a trump wins the trick unless a higher trump is played."),
    ("h2", "Scoring"),
    ("p", "61 to 90 points: 1 game point. 91 or more: 2 game points. Winning all 10 tricks wins the match."),
    ("p", "The first team to reach 4 game points wins the match."),
]

# Per language: name, description, rules, UI, tutorial strings (same order as TUTORIAL), client strings.
T = {}

T["es"] = dict(
    name="Sueca",
    description="El juego de cartas portugués y brasileño para cuatro jugadores en dos equipos: sigue el palo, usa los triunfos y gana las bazas que más puntos valen.",
    rules="""La Sueca se juega entre 4 jugadores en dos equipos; los compañeros se sientan uno frente al otro (los asientos 1.º y 3.º contra el 2.º y el 4.º). Se usa una baraja de 40 cartas sin ochos, nueves ni dieces.
Orden de las cartas en cada palo, de mayor a menor: A, 7, K, J, Q, 6, 5, 4, 3, 2. Puntos de las cartas: as 11, siete 10, rey 4, jota 3, reina 2, el resto 0; cada mano tiene 120 puntos.
Cada jugador recibe 10 cartas. La última carta del repartidor se muestra a todos y fija el palo de triunfo; se queda en la mano del repartidor.
El jugador siguiente al repartidor sale en la primera baza y cada jugador juega una carta por turno. Debes seguir el palo que se jugó primero si puedes; si no, puedes jugar cualquier carta, incluido un triunfo. Gana la baza el triunfo más alto; si no se jugó ningún triunfo, gana la carta más alta del palo de salida. El equipo del ganador se lleva los puntos de la baza y el ganador sale en la siguiente.
Tras 10 bazas se puntúa la mano: de 61 a 90 puntos da 1 punto de juego y 91 o más dan 2; con 60 a 60 nadie puntúa. El equipo que gana las 10 bazas gana la partida en el acto. Reparte el jugador siguiente.
El primer equipo que llega a 4 puntos de juego gana la partida. El bote es para los jugadores humanos del equipo ganador, o se reparte entre todos los humanos si el equipo ganador solo tiene computadoras. Nadie puede unirse ni salir durante una partida.""",
    ui="Una mesa de cartas verde con tu asiento abajo y tu compañero arriba. La cabecera muestra los puntos de juego de cada equipo sobre 4. Debajo: el palo de triunfo y su carta, el número de mano y quién tiene aún la carta de triunfo. La baza actual está en el centro; entre bazas, la última baza se queda allí, atenuada, con el nombre de quien la ganó. Tu mano está abajo: las cartas que puedes jugar tienen un borde dorado y las demás están atenuadas. Encima de tu mano ves los puntos de cartas y las bazas de tu equipo en esta mano y, al empezar una mano, el resultado de la anterior. Los espectadores solo ven el dorso de las cartas. Funciona en teléfonos, tabletas y portátiles, en vertical y en horizontal.",
    tutorial=[
        "Cómo jugar a la Sueca",
        "Cuatro jugadores en dos equipos: tu compañero se sienta frente a ti.",
        "Las cartas",
        "De mayor a menor en cada palo: A, 7, K, J, Q, 6, 5, 4, 3, 2.",
        "Puntos: as 11, siete 10, rey 4, jota 3, reina 2. Una mano tiene 120 puntos.",
        "Jugar una baza",
        "La última carta del repartidor fija el palo de triunfo.",
        "Sigue el palo de salida si puedes. Si no, juega cualquier carta: un triunfo gana la baza salvo que se juegue un triunfo más alto.",
        "Puntuación",
        "De 61 a 90 puntos: 1 punto de juego. 91 o más: 2 puntos de juego. Ganar las 10 bazas gana la partida.",
        "El primer equipo que llega a 4 puntos de juego gana la partida.",
    ],
    client={
        "title": "Sueca", "suit_c": "tréboles", "suit_d": "diamantes", "suit_h": "corazones", "suit_s": "picas",
        "rank_A": "A", "rank_K": "K", "rank_J": "J", "rank_Q": "Q",
        "card_name": "{rank} de {suit}", "trump": "Triunfo: {suit}",
        "trump_card": "Carta de triunfo en manos de {name}: {card}", "trump_card_you": "Tienes la carta de triunfo: {card}", "deal_number": "Mano {number}",
        "dealer": "Reparte", "team_names": "{first} y {second}", "your_team": "Tu equipo",
        "game_points": "{team}: {points} de {target}", "card_points": "{points} puntos de cartas en esta mano",
        "tricks": "Bazas: {count}", "cards_left": "Cartas: {count}", "you": "Tú",
        "your_turn": "Tu turno: juega una carta.", "follow_suit": "Tu turno: sigue {suit} si puedes.",
        "waiting_for": "Esperando a {name}.", "last_trick": "{name} se llevó la última baza.",
        "last_deal": "Última mano: {first} puntos de cartas contra {second}, puntos de juego {awarded_first} y {awarded_second}.",
        "you_win": "¡Tu equipo gana la partida!", "you_lose": "El otro equipo gana la partida.",
        "team_wins": "{team} ganan la partida.", "watching": "Estás mirando esta partida.", "your_hand": "Tu mano",
        "server_send_a_card_to_play": "envía una carta para jugar", "server_the_match_is_over": "la partida ha terminado",
        "server_it_is_not_your_turn": "no es tu turno", "server_that_card_is_not_in_your_hand": "esa carta no está en tu mano",
        "server_you_must_follow_the_suit_that_was_led": "debes seguir el palo que se jugó primero",
    },
)

T["fr"] = dict(
    name="Sueca",
    description="Le jeu de cartes portugais et brésilien pour quatre joueurs en deux équipes : fournissez à la couleur, utilisez les atouts et remportez les plis qui valent le plus de points.",
    rules="""La Sueca se joue à 4 joueurs en deux équipes ; les partenaires sont assis face à face (les 1re et 3e places contre les 2e et 4e). On utilise un jeu de 40 cartes sans les 8, 9 et 10.
Ordre des cartes dans chaque couleur, de la plus forte à la plus faible : A, 7, R, V, D, 6, 5, 4, 3, 2. Points des cartes : as 11, sept 10, roi 4, valet 3, dame 2, les autres 0 ; chaque donne vaut 120 points.
Chaque joueur reçoit 10 cartes. La dernière carte du donneur est montrée à tous et fixe la couleur d'atout ; elle reste dans la main du donneur.
Le joueur qui suit le donneur entame le premier pli, et chacun joue une carte à son tour. Vous devez fournir la couleur demandée si vous le pouvez ; sinon, vous pouvez jouer n'importe quelle carte, y compris un atout. Le plus fort atout remporte le pli ; si aucun atout n'a été joué, la plus forte carte de la couleur demandée l'emporte. L'équipe du gagnant prend les points du pli et le gagnant entame le pli suivant.
Après 10 plis, la donne est comptée : de 61 à 90 points rapporte 1 point de partie et 91 ou plus en rapportent 2 ; à 60 contre 60, personne ne marque. Une équipe qui remporte les 10 plis gagne aussitôt la partie. Le joueur suivant donne.
La première équipe à atteindre 4 points de partie gagne. La cagnotte va aux joueurs humains de l'équipe gagnante, ou est partagée entre tous les humains si l'équipe gagnante ne compte que des ordinateurs. Personne ne peut rejoindre ni quitter une partie en cours.""",
    ui="Une table de jeu verte avec votre place en bas et votre partenaire en haut. L'en-tête montre les points de partie de chaque équipe sur 4. En dessous : la couleur d'atout et sa carte, le numéro de la donne et qui détient encore la carte d'atout. Le pli en cours est au centre ; entre les plis, le dernier pli y reste, estompé, avec le nom du joueur qui l'a remporté. Votre main est en bas : les cartes jouables sont bordées d'or, les autres sont estompées. Au-dessus de votre main, vous voyez les points de cartes et les plis de votre équipe dans cette donne et, au début d'une donne, le résultat de la précédente. Les spectateurs ne voient que le dos des cartes. Fonctionne sur téléphone, tablette et ordinateur portable, en portrait comme en paysage.",
    tutorial=[
        "Comment jouer à la Sueca",
        "Quatre joueurs en deux équipes : votre partenaire est assis en face de vous.",
        "Les cartes",
        "De la plus forte à la plus faible dans chaque couleur : A, 7, R, V, D, 6, 5, 4, 3, 2.",
        "Points : as 11, sept 10, roi 4, valet 3, dame 2. Une donne vaut 120 points.",
        "Jouer un pli",
        "La dernière carte du donneur fixe la couleur d'atout.",
        "Fournissez la couleur demandée si vous le pouvez. Sinon, jouez n'importe quelle carte : un atout remporte le pli, sauf si un atout plus fort est joué.",
        "Le décompte",
        "De 61 à 90 points : 1 point de partie. 91 ou plus : 2 points de partie. Remporter les 10 plis gagne la partie.",
        "La première équipe à atteindre 4 points de partie gagne la partie.",
    ],
    client={
        "title": "Sueca", "suit_c": "trèfle", "suit_d": "carreau", "suit_h": "cœur", "suit_s": "pique",
        "rank_A": "A", "rank_K": "R", "rank_J": "V", "rank_Q": "D",
        "card_name": "{rank} de {suit}", "trump": "Atout : {suit}",
        "trump_card": "Carte d'atout chez {name} : {card}", "trump_card_you": "Vous avez la carte d'atout : {card}", "deal_number": "Donne {number}",
        "dealer": "Donneur", "team_names": "{first} et {second}", "your_team": "Votre équipe",
        "game_points": "{team} : {points} sur {target}", "card_points": "{points} points de cartes dans cette donne",
        "tricks": "Plis : {count}", "cards_left": "Cartes : {count}", "you": "Vous",
        "your_turn": "À vous : jouez une carte.", "follow_suit": "À vous : fournissez à {suit} si possible.",
        "waiting_for": "En attente de {name}.", "last_trick": "{name} a remporté le dernier pli.",
        "last_deal": "Dernière donne : {first} points de cartes contre {second}, points de partie {awarded_first} et {awarded_second}.",
        "you_win": "Votre équipe gagne la partie !", "you_lose": "L'autre équipe gagne la partie.",
        "team_wins": "{team} gagnent la partie.", "watching": "Vous regardez cette partie.", "your_hand": "Votre main",
        "server_send_a_card_to_play": "envoyez une carte à jouer", "server_the_match_is_over": "la partie est terminée",
        "server_it_is_not_your_turn": "ce n'est pas votre tour", "server_that_card_is_not_in_your_hand": "cette carte n'est pas dans votre main",
        "server_you_must_follow_the_suit_that_was_led": "vous devez fournir la couleur demandée",
    },
)

T["de"] = dict(
    name="Sueca",
    description="Das portugiesische und brasilianische Kartenspiel für vier Spieler in zwei Teams: Farbe bedienen, Trümpfe einsetzen und die punktreichsten Stiche gewinnen.",
    rules="""Sueca wird von 4 Spielern in zwei Teams gespielt; Partner sitzen sich gegenüber (der 1. und 3. Platz gegen den 2. und 4.). Gespielt wird mit 40 Karten ohne Achter, Neuner und Zehner.
Rangfolge in jeder Farbe, von hoch nach niedrig: A, 7, K, B, D, 6, 5, 4, 3, 2. Kartenpunkte: Ass 11, Sieben 10, König 4, Bube 3, Dame 2, der Rest 0; jede Runde hat 120 Punkte.
Jeder Spieler erhält 10 Karten. Die letzte Karte des Gebers wird allen gezeigt und bestimmt die Trumpffarbe; sie bleibt in der Hand des Gebers.
Der Spieler nach dem Geber spielt den ersten Stich aus, und jeder spielt reihum eine Karte. Du musst die ausgespielte Farbe bedienen, wenn du kannst; sonst darfst du jede Karte spielen, auch einen Trumpf. Der höchste Trumpf gewinnt den Stich; wurde kein Trumpf gespielt, gewinnt die höchste Karte der ausgespielten Farbe. Das Team des Gewinners erhält die Punkte des Stichs, und der Gewinner spielt den nächsten Stich aus.
Nach 10 Stichen wird die Runde gewertet: 61 bis 90 Punkte bringen 1 Spielpunkt, 91 oder mehr bringen 2; bei 60 zu 60 punktet niemand. Ein Team, das alle 10 Stiche macht, gewinnt sofort die Partie. Der nächste Spieler gibt.
Das erste Team mit 4 Spielpunkten gewinnt die Partie. Der Pot geht an die menschlichen Spieler des Siegerteams oder wird unter allen menschlichen Spielern geteilt, wenn das Siegerteam nur aus Computern besteht. Während einer Partie kann niemand beitreten oder sie verlassen.""",
    ui="Ein grüner Kartentisch mit deinem Platz unten und deinem Partner oben. Die Kopfzeile zeigt die Spielpunkte jedes Teams von 4. Darunter: die Trumpffarbe und ihre Karte, die Rundennummer und wer die Trumpfkarte noch hält. Der laufende Stich liegt in der Mitte; zwischen den Stichen bleibt dort der letzte Stich, blass, mit dem Namen dessen, der ihn genommen hat. Deine Hand ist unten: spielbare Karten haben einen goldenen Rand, die anderen sind abgeblendet. Über deiner Hand siehst du die Kartenpunkte und Stiche deines Teams in dieser Runde und zu Beginn einer Runde das Ergebnis der letzten. Zuschauer sehen nur Kartenrücken. Funktioniert auf Handys, Tablets und Laptops, im Hoch- und Querformat.",
    tutorial=[
        "So spielt man Sueca",
        "Vier Spieler in zwei Teams: dein Partner sitzt dir gegenüber.",
        "Die Karten",
        "Von hoch nach niedrig in jeder Farbe: A, 7, K, B, D, 6, 5, 4, 3, 2.",
        "Punkte: Ass 11, Sieben 10, König 4, Bube 3, Dame 2. Eine Runde hat 120 Punkte.",
        "Einen Stich spielen",
        "Die letzte Karte des Gebers bestimmt die Trumpffarbe.",
        "Bediene die ausgespielte Farbe, wenn du kannst. Sonst spiel eine beliebige Karte: Ein Trumpf gewinnt den Stich, außer es wird ein höherer Trumpf gespielt.",
        "Wertung",
        "61 bis 90 Punkte: 1 Spielpunkt. 91 oder mehr: 2 Spielpunkte. Alle 10 Stiche gewinnen die Partie.",
        "Das erste Team mit 4 Spielpunkten gewinnt die Partie.",
    ],
    client={
        "title": "Sueca", "suit_c": "Kreuz", "suit_d": "Karo", "suit_h": "Herz", "suit_s": "Pik",
        "rank_A": "A", "rank_K": "K", "rank_J": "B", "rank_Q": "D",
        "card_name": "{suit} {rank}", "trump": "Trumpf: {suit}",
        "trump_card": "Trumpfkarte bei {name}: {card}", "trump_card_you": "Du hast die Trumpfkarte: {card}", "deal_number": "Runde {number}",
        "dealer": "Geber", "team_names": "{first} und {second}", "your_team": "Dein Team",
        "game_points": "{team}: {points} von {target}", "card_points": "{points} Kartenpunkte in dieser Runde",
        "tricks": "Stiche: {count}", "cards_left": "Karten: {count}", "you": "Du",
        "your_turn": "Du bist dran: spiele eine Karte.", "follow_suit": "Du bist dran: bediene {suit}, wenn du kannst.",
        "waiting_for": "Warten auf {name}.", "last_trick": "{name} hat den letzten Stich genommen.",
        "last_deal": "Letzte Runde: {first} zu {second} Kartenpunkte, Spielpunkte {awarded_first} und {awarded_second}.",
        "you_win": "Dein Team gewinnt die Partie!", "you_lose": "Das andere Team gewinnt die Partie.",
        "team_wins": "{team} gewinnen die Partie.", "watching": "Du schaust dieser Partie zu.", "your_hand": "Deine Hand",
        "server_send_a_card_to_play": "sende eine Karte zum Ausspielen", "server_the_match_is_over": "die Partie ist vorbei",
        "server_it_is_not_your_turn": "du bist nicht an der Reihe", "server_that_card_is_not_in_your_hand": "diese Karte ist nicht in deiner Hand",
        "server_you_must_follow_the_suit_that_was_led": "du musst die ausgespielte Farbe bedienen",
    },
)

T["pt"] = dict(
    name="Sueca",
    description="O jogo de cartas português e brasileiro para quatro jogadores em duas equipes: siga o naipe, use os trunfos e ganhe as vazas que valem mais pontos.",
    rules="""A Sueca é jogada por 4 jogadores em duas equipes; os parceiros sentam-se frente a frente (os 1.º e 3.º lugares contra os 2.º e 4.º). Usa-se um baralho de 40 cartas sem os 8, 9 e 10.
Ordem das cartas em cada naipe, da mais alta para a mais baixa: A, 7, R, V, D, 6, 5, 4, 3, 2. Pontos das cartas: ás 11, sete (bisca) 10, rei 4, valete 3, dama 2, as restantes 0; cada mão vale 120 pontos.
Cada jogador recebe 10 cartas. A última carta de quem dá as cartas é mostrada a todos e define o naipe de trunfo; ela fica na mão de quem deu.
O jogador seguinte a quem deu abre a primeira vaza, e cada jogador joga uma carta na sua vez. Você precisa seguir o naipe que foi jogado primeiro, se puder; se não puder, pode jogar qualquer carta, inclusive um trunfo. O trunfo mais alto ganha a vaza; se nenhum trunfo foi jogado, ganha a carta mais alta do naipe de saída. A equipe do vencedor fica com os pontos da vaza e o vencedor abre a vaza seguinte.
Depois de 10 vazas a mão é contada: de 61 a 90 pontos vale 1 ponto de jogo e 91 ou mais valem 2; com 60 a 60 ninguém pontua. A equipe que fizer as 10 vazas (uma bandeira) vence a partida na hora. O próximo jogador dá as cartas.
A primeira equipe a chegar a 4 pontos de jogo vence a partida. O pote vai para os jogadores humanos da equipe vencedora, ou é dividido entre todos os humanos se a equipe vencedora só tiver computadores. Ninguém pode entrar nem sair durante uma partida.""",
    ui="Uma mesa de cartas verde com o seu lugar embaixo e o seu parceiro em cima. O cabeçalho mostra os pontos de jogo de cada equipe, de 4. Abaixo: o naipe de trunfo e a sua carta, o número da mão e quem ainda tem a carta de trunfo. A vaza atual fica no centro; entre vazas, a última vaza fica ali, esmaecida, com o nome de quem a levou. A sua mão fica embaixo: as cartas que você pode jogar têm contorno dourado e as outras ficam esmaecidas. Acima da sua mão você vê os pontos de cartas e as vazas da sua equipe nesta mão e, no início de uma mão, o resultado da anterior. Os espectadores só veem o verso das cartas. Funciona em celulares, tablets e notebooks, na vertical e na horizontal.",
    tutorial=[
        "Como jogar Sueca",
        "Quatro jogadores em duas equipes: o seu parceiro senta-se à sua frente.",
        "As cartas",
        "Da mais alta para a mais baixa em cada naipe: A, 7, R, V, D, 6, 5, 4, 3, 2.",
        "Pontos: ás 11, sete 10, rei 4, valete 3, dama 2. Uma mão vale 120 pontos.",
        "Jogar uma vaza",
        "A última carta de quem dá as cartas define o naipe de trunfo.",
        "Siga o naipe de saída, se puder. Se não puder, jogue qualquer carta: um trunfo ganha a vaza, a não ser que se jogue um trunfo mais alto.",
        "Pontuação",
        "De 61 a 90 pontos: 1 ponto de jogo. 91 ou mais: 2 pontos de jogo. Fazer as 10 vazas vence a partida.",
        "A primeira equipe a chegar a 4 pontos de jogo vence a partida.",
    ],
    client={
        "title": "Sueca", "suit_c": "paus", "suit_d": "ouros", "suit_h": "copas", "suit_s": "espadas",
        "rank_A": "A", "rank_K": "R", "rank_J": "V", "rank_Q": "D",
        "card_name": "{rank} de {suit}", "trump": "Trunfo: {suit}",
        "trump_card": "Carta de trunfo com {name}: {card}", "trump_card_you": "Você tem a carta de trunfo: {card}", "deal_number": "Mão {number}",
        "dealer": "Dá as cartas", "team_names": "{first} e {second}", "your_team": "Sua equipe",
        "game_points": "{team}: {points} de {target}", "card_points": "{points} pontos de cartas nesta mão",
        "tricks": "Vazas: {count}", "cards_left": "Cartas: {count}", "you": "Você",
        "your_turn": "Sua vez: jogue uma carta.", "follow_suit": "Sua vez: siga {suit} se puder.",
        "waiting_for": "Aguardando {name}.", "last_trick": "{name} levou a última vaza.",
        "last_deal": "Última mão: {first} pontos de cartas contra {second}, pontos de jogo {awarded_first} e {awarded_second}.",
        "you_win": "Sua equipe vence a partida!", "you_lose": "A outra equipe vence a partida.",
        "team_wins": "{team} vencem a partida.", "watching": "Você está assistindo a esta partida.", "your_hand": "Sua mão",
        "server_send_a_card_to_play": "envie uma carta para jogar", "server_the_match_is_over": "a partida terminou",
        "server_it_is_not_your_turn": "não é a sua vez", "server_that_card_is_not_in_your_hand": "essa carta não está na sua mão",
        "server_you_must_follow_the_suit_that_was_led": "você precisa seguir o naipe que foi jogado",
    },
)

T["zh"] = dict(
    name="苏埃卡",
    description="葡萄牙和巴西的四人两队纸牌游戏：跟出花色、使用王牌，赢下分数最多的墩。",
    rules="""苏埃卡由4名玩家分成两队进行；搭档相对而坐（第1和第3个座位对第2和第4个座位）。使用去掉8、9、10的40张牌。
每种花色中牌的大小，从大到小：A、7、K、J、Q、6、5、4、3、2。牌分：A 11分，7 10分，K 4分，J 3分，Q 2分，其余0分；每局共120分。
每名玩家拿10张牌。发牌人的最后一张牌向所有人亮出并决定王牌花色；这张牌留在发牌人手中。
发牌人的下家首先出第一墩，每名玩家轮流出一张牌。如果可以，必须跟出首家出的花色；否则可以出任何牌，包括王牌。最大的王牌赢得这一墩；如果没有人出王牌，首家花色中最大的牌获胜。赢家的队伍获得这一墩的分数，赢家首先出下一墩。
10墩之后计算这一局：61到90分得1个局分，91分及以上得2个局分；60比60时双方都不得分。赢下全部10墩的队伍立即赢得比赛。由下一位玩家发牌。
最先得到4个局分的队伍赢得比赛。奖池归获胜队伍中的真人玩家；如果获胜队伍全是电脑，奖池由所有真人玩家平分。比赛中途不能加入或离开。""",
    ui="绿色牌桌，你的座位在下方，搭档在上方。顶部显示每队的局分（满分4）。下面是王牌花色及其牌、局数，以及谁还持有王牌。当前的墩放在中间；两墩之间，上一墩会淡淡地留在那里，并显示赢下它的玩家。你的手牌在下方：可以出的牌带金色边框，其他牌变暗。手牌上方显示你的队伍在本局的牌分和墩数，以及在新一局开始时上一局的结果。观众只能看到牌背。适用于手机、平板和笔记本电脑，横屏竖屏均可。",
    tutorial=[
        "苏埃卡玩法",
        "四名玩家分成两队：你的搭档坐在你对面。",
        "纸牌",
        "每种花色从大到小：A、7、K、J、Q、6、5、4、3、2。",
        "分数：A 11分，7 10分，K 4分，J 3分，Q 2分。每局共120分。",
        "出一墩",
        "发牌人的最后一张牌决定王牌花色。",
        "如果可以，跟出首家出的花色。如果不能，可以出任何牌：王牌会赢下这一墩，除非有人出了更大的王牌。",
        "计分",
        "61到90分：1个局分。91分及以上：2个局分。赢下全部10墩即赢得比赛。",
        "最先得到4个局分的队伍赢得比赛。",
    ],
    client={
        "title": "苏埃卡", "suit_c": "梅花", "suit_d": "方块", "suit_h": "红桃", "suit_s": "黑桃",
        "rank_A": "A", "rank_K": "K", "rank_J": "J", "rank_Q": "Q",
        "card_name": "{suit}{rank}", "trump": "王牌：{suit}",
        "trump_card": "王牌在{name}手中：{card}", "trump_card_you": "王牌在你手中：{card}", "deal_number": "第{number}局",
        "dealer": "发牌人", "team_names": "{first}和{second}", "your_team": "你的队伍",
        "game_points": "{team}：{points}/{target}", "card_points": "本局牌分 {points}",
        "tricks": "墩数：{count}", "cards_left": "手牌：{count}", "you": "你",
        "your_turn": "轮到你：出一张牌。", "follow_suit": "轮到你：如果可以，请跟出{suit}。",
        "waiting_for": "等待{name}。", "last_trick": "{name}赢得了上一墩。",
        "last_deal": "上一局：牌分 {first} 比 {second}，局分 {awarded_first} 和 {awarded_second}。",
        "you_win": "你的队伍赢得了比赛！", "you_lose": "对方队伍赢得了比赛。",
        "team_wins": "{team}赢得了比赛。", "watching": "你正在观看这场比赛。", "your_hand": "你的手牌",
        "server_send_a_card_to_play": "请出一张牌", "server_the_match_is_over": "比赛已经结束",
        "server_it_is_not_your_turn": "还没轮到你", "server_that_card_is_not_in_your_hand": "你手里没有这张牌",
        "server_you_must_follow_the_suit_that_was_led": "你必须跟出首家出的花色",
    },
)

T["hi"] = dict(
    name="सुएका",
    description="दो टीमों में चार खिलाड़ियों का पुर्तगाली और ब्राज़ीली ताश का खेल: रंग मिलाएँ, तुरुप चलें और सबसे ज़्यादा अंक वाले हाथ जीतें।",
    rules="""सुएका 4 खिलाड़ी दो टीमों में खेलते हैं; साथी एक-दूसरे के आमने-सामने बैठते हैं (पहली और तीसरी जगह बनाम दूसरी और चौथी)। इसमें 8, 9 और 10 हटाकर 40 पत्तों की गड्डी इस्तेमाल होती है।
हर रंग में पत्तों का क्रम, सबसे बड़ा पहले: A, 7, K, J, Q, 6, 5, 4, 3, 2। पत्तों के अंक: इक्का 11, सत्ता 10, बादशाह 4, गुलाम 3, बेगम 2, बाक़ी 0; हर बाज़ी में 120 अंक होते हैं।
हर खिलाड़ी को 10 पत्ते मिलते हैं। बाँटने वाले का आख़िरी पत्ता सबको दिखाया जाता है और तुरुप का रंग तय करता है; वह पत्ता बाँटने वाले के हाथ में ही रहता है।
बाँटने वाले के बाद वाला खिलाड़ी पहला हाथ शुरू करता है, और हर खिलाड़ी अपनी बारी पर एक पत्ता चलता है। हो सके तो आपको पहले चले गए रंग का ही पत्ता चलना होगा; नहीं तो आप कोई भी पत्ता चल सकते हैं, तुरुप भी। सबसे बड़ा तुरुप हाथ जीतता है; अगर कोई तुरुप नहीं चला गया, तो शुरुआती रंग का सबसे बड़ा पत्ता जीतता है। जीतने वाले की टीम को हाथ के अंक मिलते हैं और जीतने वाला अगला हाथ शुरू करता है।
10 हाथों के बाद बाज़ी गिनी जाती है: 61 से 90 अंक पर 1 खेल-अंक, और 91 या उससे ज़्यादा पर 2; 60-60 पर किसी को अंक नहीं मिलता। जो टीम सभी 10 हाथ जीत ले, वह तुरंत मैच जीत जाती है। अगला खिलाड़ी पत्ते बाँटता है।
जो टीम पहले 4 खेल-अंक तक पहुँचती है वह मैच जीतती है। पॉट जीतने वाली टीम के मानव खिलाड़ियों को मिलता है, या अगर जीतने वाली टीम में सिर्फ़ कंप्यूटर हों तो सभी मानव खिलाड़ियों में बँटता है। मैच के बीच में कोई जुड़ या छोड़ नहीं सकता।""",
    ui="एक हरी ताश की मेज़, आपकी जगह नीचे और आपका साथी ऊपर। ऊपर की पट्टी हर टीम के 4 में से खेल-अंक दिखाती है। उसके नीचे: तुरुप का रंग और उसका पत्ता, बाज़ी की संख्या, और तुरुप का पत्ता अभी किसके पास है। चालू हाथ बीच में रहता है; दो हाथों के बीच पिछला हाथ वहीं हल्का होकर दिखता है, जीतने वाले के नाम के साथ। आपके पत्ते नीचे हैं: जो पत्ते आप चल सकते हैं उनके चारों ओर सुनहरी रेखा होती है, बाक़ी धुंधले होते हैं। आपके पत्तों के ऊपर इस बाज़ी में आपकी टीम के पत्ता-अंक और हाथ दिखते हैं, और नई बाज़ी की शुरुआत में पिछली बाज़ी का नतीजा। दर्शक सिर्फ़ पत्तों की पीठ देखते हैं। फ़ोन, टैबलेट और लैपटॉप पर, खड़े और आड़े दोनों तरह चलता है।",
    tutorial=[
        "सुएका कैसे खेलें",
        "दो टीमों में चार खिलाड़ी: आपका साथी आपके सामने बैठता है।",
        "पत्ते",
        "हर रंग में सबसे बड़े से छोटे तक: A, 7, K, J, Q, 6, 5, 4, 3, 2।",
        "अंक: इक्का 11, सत्ता 10, बादशाह 4, गुलाम 3, बेगम 2। एक बाज़ी में 120 अंक होते हैं।",
        "एक हाथ खेलना",
        "बाँटने वाले का आख़िरी पत्ता तुरुप का रंग तय करता है।",
        "हो सके तो शुरुआती रंग का पत्ता चलें। नहीं तो कोई भी पत्ता चलें: तुरुप हाथ जीत लेता है, जब तक कोई उससे बड़ा तुरुप न चले।",
        "अंक गिनना",
        "61 से 90 अंक: 1 खेल-अंक। 91 या ज़्यादा: 2 खेल-अंक। सभी 10 हाथ जीतने पर मैच जीत।",
        "जो टीम पहले 4 खेल-अंक तक पहुँचती है वह मैच जीतती है।",
    ],
    client={
        "title": "सुएका", "suit_c": "चिड़ी", "suit_d": "ईंट", "suit_h": "पान", "suit_s": "हुकुम",
        "rank_A": "A", "rank_K": "K", "rank_J": "J", "rank_Q": "Q",
        "card_name": "{suit} का {rank}", "trump": "तुरुप: {suit}",
        "trump_card": "तुरुप का पत्ता {name} के पास: {card}", "trump_card_you": "तुरुप का पत्ता आपके पास है: {card}", "deal_number": "बाज़ी {number}",
        "dealer": "बाँटने वाला", "team_names": "{first} और {second}", "your_team": "आपकी टीम",
        "game_points": "{team}: {target} में से {points}", "card_points": "इस बाज़ी में {points} पत्ता-अंक",
        "tricks": "हाथ: {count}", "cards_left": "पत्ते: {count}", "you": "आप",
        "your_turn": "आपकी बारी: एक पत्ता चलें।", "follow_suit": "आपकी बारी: हो सके तो {suit} ही चलें।",
        "waiting_for": "{name} की प्रतीक्षा है।", "last_trick": "{name} ने पिछला हाथ जीता।",
        "last_deal": "पिछली बाज़ी: पत्ता-अंक {first} बनाम {second}, खेल-अंक {awarded_first} और {awarded_second}।",
        "you_win": "आपकी टीम मैच जीत गई!", "you_lose": "दूसरी टीम मैच जीत गई।",
        "team_wins": "{team} मैच जीत गए।", "watching": "आप यह मैच देख रहे हैं।", "your_hand": "आपके पत्ते",
        "server_send_a_card_to_play": "चलने के लिए एक पत्ता भेजें", "server_the_match_is_over": "मैच समाप्त हो गया है",
        "server_it_is_not_your_turn": "अभी आपकी बारी नहीं है", "server_that_card_is_not_in_your_hand": "यह पत्ता आपके हाथ में नहीं है",
        "server_you_must_follow_the_suit_that_was_led": "आपको पहले चले गए रंग का ही पत्ता चलना होगा",
    },
)

T["ar"] = dict(
    name="سويكا",
    description="لعبة الورق البرتغالية والبرازيلية لأربعة لاعبين في فريقين: اتبع اللون، واستخدم أوراق الحكم، واربح الأكلات الأعلى نقاطًا.",
    rules="""يلعب سويكا 4 لاعبين في فريقين؛ يجلس الشريكان متقابلين (المقعدان الأول والثالث ضد الثاني والرابع). تُستخدم مجموعة من 40 ورقة بدون الثمانيات والتسعات والعشرات.
ترتيب الأوراق في كل لون من الأعلى إلى الأدنى: A، 7، K، J، Q، 6، 5، 4، 3، 2. نقاط الأوراق: الآص 11، السبعة 10، الشايب 4، الولد 3، البنت 2، والباقي 0؛ في كل توزيعة 120 نقطة.
يحصل كل لاعب على 10 أوراق. تُعرض الورقة الأخيرة للموزّع على الجميع وتحدد لون الحكم؛ وتبقى في يد الموزّع.
يبدأ اللاعب الذي يلي الموزّع الأكلة الأولى، ويلعب كل لاعب ورقة واحدة في دوره. يجب أن تلعب من اللون الذي بدأ به اللعب إن استطعت؛ وإلا يمكنك لعب أي ورقة، بما فيها ورقة حكم. أعلى ورقة حكم تربح الأكلة؛ وإن لم تُلعب أي ورقة حكم، تربح أعلى ورقة من لون البداية. يأخذ فريق الفائز نقاط الأكلة ويبدأ الفائز الأكلة التالية.
بعد 10 أكلات تُحسب التوزيعة: من 61 إلى 90 نقطة تعطي نقطة لعب واحدة، و91 نقطة أو أكثر تعطي نقطتين؛ وعند 60 مقابل 60 لا يسجل أحد. الفريق الذي يربح الأكلات العشر كلها يفوز بالمباراة فورًا. يوزّع اللاعب التالي.
أول فريق يصل إلى 4 نقاط لعب يفوز بالمباراة. يذهب الرهان إلى اللاعبين البشر في الفريق الفائز، أو يُقسم بين جميع اللاعبين البشر إذا كان الفريق الفائز من الحواسيب فقط. لا يمكن لأحد الانضمام أو المغادرة أثناء المباراة.""",
    ui="طاولة ورق خضراء، مقعدك في الأسفل وشريكك في الأعلى. يعرض الشريط العلوي نقاط اللعب لكل فريق من 4. تحته: لون الحكم وورقته، ورقم التوزيعة، ومن لا يزال يحمل ورقة الحكم. الأكلة الحالية في الوسط؛ وبين الأكلات تبقى الأكلة الأخيرة هناك باهتة مع اسم من أخذها. أوراقك في الأسفل: الأوراق التي يمكنك لعبها محاطة بإطار ذهبي والباقي باهتة. فوق أوراقك ترى نقاط أوراق فريقك وأكلاته في هذه التوزيعة، وعند بداية التوزيعة نتيجة التوزيعة السابقة. يرى المشاهدون ظهور الأوراق فقط. تعمل على الهواتف والأجهزة اللوحية والحواسيب المحمولة، عموديًا وأفقيًا.",
    tutorial=[
        "كيف تلعب سويكا",
        "أربعة لاعبين في فريقين: يجلس شريكك مقابلك.",
        "الأوراق",
        "من الأعلى إلى الأدنى في كل لون: A، 7، K، J، Q، 6، 5، 4، 3، 2.",
        "النقاط: الآص 11، السبعة 10، الشايب 4، الولد 3، البنت 2. في التوزيعة 120 نقطة.",
        "لعب أكلة",
        "الورقة الأخيرة للموزّع تحدد لون الحكم.",
        "العب من لون البداية إن استطعت. وإن لم تستطع، العب أي ورقة: ورقة الحكم تربح الأكلة ما لم تُلعب ورقة حكم أعلى.",
        "التسجيل",
        "من 61 إلى 90 نقطة: نقطة لعب واحدة. 91 أو أكثر: نقطتا لعب. الفوز بالأكلات العشر كلها يربح المباراة.",
        "أول فريق يصل إلى 4 نقاط لعب يفوز بالمباراة.",
    ],
    client={
        "title": "سويكا", "suit_c": "سباتي", "suit_d": "ديناري", "suit_h": "كبة", "suit_s": "بستوني",
        "rank_A": "A", "rank_K": "K", "rank_J": "J", "rank_Q": "Q",
        "card_name": "{rank} {suit}", "trump": "الحكم: {suit}",
        "trump_card": "ورقة الحكم مع {name}: {card}", "trump_card_you": "ورقة الحكم معك: {card}", "deal_number": "التوزيعة {number}",
        "dealer": "الموزّع", "team_names": "{first} و{second}", "your_team": "فريقك",
        "game_points": "{team}: {points} من {target}", "card_points": "{points} نقطة أوراق في هذه التوزيعة",
        "tricks": "الأكلات: {count}", "cards_left": "الأوراق: {count}", "you": "أنت",
        "your_turn": "دورك: العب ورقة.", "follow_suit": "دورك: العب من {suit} إن استطعت.",
        "waiting_for": "بانتظار {name}.", "last_trick": "أخذ {name} الأكلة الأخيرة.",
        "last_deal": "التوزيعة الأخيرة: نقاط الأوراق {first} مقابل {second}، ونقاط اللعب {awarded_first} و{awarded_second}.",
        "you_win": "فريقك يفوز بالمباراة!", "you_lose": "الفريق الآخر يفوز بالمباراة.",
        "team_wins": "{team} يفوزون بالمباراة.", "watching": "أنت تشاهد هذه المباراة.", "your_hand": "أوراقك",
        "server_send_a_card_to_play": "أرسل ورقة لتلعبها", "server_the_match_is_over": "انتهت المباراة",
        "server_it_is_not_your_turn": "ليس دورك", "server_that_card_is_not_in_your_hand": "هذه الورقة ليست في يدك",
        "server_you_must_follow_the_suit_that_was_led": "يجب أن تلعب من اللون الذي بدأ به اللعب",
    },
)
