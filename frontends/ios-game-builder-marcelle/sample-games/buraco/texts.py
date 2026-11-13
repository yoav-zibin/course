"""Buraco texts in English and their translations into the 7 other platform languages."""

NAME = "Buraco"

DESCRIPTION = (
    "The South American canasta-style card game for two teams of two: draw, lay sequences and groups, "
    "build clean and dirty canastas of seven, grab your pot and go out first."
)

RULES = """Buraco is for 4 players in two fixed teams; partners sit opposite each other (1st and 3rd seats against 2nd and 4th). It uses two 52-card decks plus 4 jokers (108 cards).
Each deal: every player gets 11 cards, two pots of 11 cards are set aside face down, one card starts the discard pile and the rest is the stock. The player after the dealer starts; play goes around in seat order.
A turn: first draw the top card of the stock or take the whole discard pile. Then you may lay melds and add cards to your team's melds. Finally discard one card, which ends your turn.
Melds: a sequence is 3 or more cards of one suit in order (ace low or high: A-2-3 up to Q-K-A, and a run may have an ace at both ends); a group is 3 or more jacks, queens, kings or aces. Deuces and jokers are wild, at most one wild per meld; a deuce of the sequence's own suit in its own place counts as a natural 2. Wilds can shift inside a meld as cards are added. Melds belong to the team, and either partner may add to them; cards on the table never go back to a hand.
Opening: a team's first melds of a deal must be worth at least 50 points laid at once (75 once the team has 1500 points or more). Card values: 3 to 7 are 5, 8 to king are 10, ace 15, deuce 20, joker 30.
Pots: the first time a player of a team empties their hand, they take one pot. If the hand was emptied by laying melds, they go on playing with the pot; if by the discard, they play the pot on their next turn. When the stock runs out, a remaining pot becomes the stock.
Going out: once a team has taken its pot and has a clean meld of 7 or more cards (no wild), a player of that team may empty their hand to end the deal. Until then a team may not empty its hand, so it must keep cards to discard. The deal also ends when a player must draw and the stock and pots are empty.
Scoring a deal: each team adds the values of its melded cards, 200 for each clean meld of 7+, 100 for each dirty one (7+ with a wild) and 100 for going out; it subtracts the cards left in both partners' hands, and 100 if it never took its pot.
The match ends when a team reaches 2000 points, or after 3 deals; the higher total wins and a tie is shared. The pot goes to the human players of the winning team, or is shared by all humans if that team has only computers. Nobody can join or leave during a match."""

UI = (
    "A green card table. The top shows the deal number, both teams' scores (your team is outlined in gold) and every "
    "player's card count, noting which teams have taken their pot. Below are the two teams' melds; clean and dirty "
    "canastas (7+ cards) are labeled. In the middle are the stock with the pots left, and the whole discard pile with "
    "its top card enlarged. Your hand is at the bottom. On your turn, tap the stock or the discard pile to draw. Then "
    "tap cards to select them: New meld puts the selected cards aside as a new meld, tapping one of your team's melds "
    "adds them to it, Lay down sends everything put aside, and Clear starts over. To end your turn select one card and "
    "tap Discard. Hints under the status tell you your team's opening minimum or whether it may go out. Works on "
    "phones, tablets and laptops, in portrait and landscape."
)

TUTORIAL_TEXT = (
    "Draw, lay sequences and groups of jacks to aces with at most one wild each, then discard. Empty your hand once to "
    "take your pot; with a clean canasta of seven, empty it again to go out. 2000 points or 3 deals."
)

TUTORIAL = [
    ("h1", "How to play Buraco"),
    ("p", "Two teams of two. Partners share their melds and their score."),
    ("h2", "Your turn"),
    ("p", "Draw the top stock card or take the whole discard pile. Lay melds if you can, then discard one card."),
    ("h2", "Melds"),
    ("p", "Sequences: 3+ cards of one suit in order. Groups: 3+ jacks, queens, kings or aces."),
    ("p", "Deuces and jokers are wild, at most one per meld. Seven cards make a canasta: clean without a wild, dirty with one."),
    ("h2", "The pot and going out"),
    ("p", "Empty your hand once to take your team's pot. With the pot and a clean canasta, empty it again to end the deal."),
    ("h2", "Scoring"),
    ("p", "Melded cards count for you, cards left in hand count against you. Clean canasta 200, dirty 100, going out 100."),
]

T = {}

T["es"] = dict(
    name="Buraco",
    description="El juego de cartas sudamericano de la familia de la canasta para dos parejas: roba, baja escaleras y grupos, forma canastas limpias y sucias de siete, toma tu muerto y cierra primero.",
    rules="""El Buraco se juega entre 4 jugadores en dos parejas fijas; los compañeros se sientan enfrente (asientos 1.º y 3.º contra 2.º y 4.º). Se usan dos barajas de 52 cartas y 4 comodines (108 cartas).
En cada mano: cada jugador recibe 11 cartas, se apartan boca abajo dos muertos de 11 cartas, una carta inicia el pozo de descartes y el resto es el mazo. Empieza el jugador siguiente al que reparte; se juega en orden de asientos.
Un turno: primero roba la carta de arriba del mazo o toma todo el pozo de descartes. Luego puedes bajar juegos y añadir cartas a los juegos de tu pareja. Por último descarta una carta, lo que termina tu turno.
Juegos: una escalera son 3 o más cartas del mismo palo seguidas (el as puede ir abajo o arriba: de A-2-3 hasta Q-K-A, y una escalera puede tener as en ambos extremos); un grupo son 3 o más jotas, reinas, reyes o ases. Los doses y los comodines son comodín, como máximo uno por juego; un dos del palo de la escalera en su propio lugar cuenta como 2 natural. Los comodines pueden moverse dentro del juego al añadir cartas. Los juegos son de la pareja y ambos compañeros pueden añadirles cartas; las cartas de la mesa nunca vuelven a la mano.
Apertura: los primeros juegos de una pareja en cada mano deben sumar al menos 50 puntos bajados de una vez (75 cuando la pareja tiene 1500 puntos o más). Valor de las cartas: del 3 al 7 valen 5, del 8 al rey 10, el as 15, el dos 20 y el comodín 30.
Muertos: la primera vez que un jugador de una pareja vacía su mano, toma un muerto. Si vació la mano bajando juegos, sigue jugando con el muerto; si fue con el descarte, juega el muerto en su siguiente turno. Cuando se acaba el mazo, un muerto restante pasa a ser el mazo.
Cerrar: cuando una pareja ya tomó su muerto y tiene un juego limpio de 7 o más cartas (sin comodín), un jugador de esa pareja puede vaciar su mano para terminar la mano. Hasta entonces la pareja no puede vaciar la mano, así que debe guardar cartas para descartar. La mano también termina cuando un jugador debe robar y el mazo y los muertos están vacíos.
Puntuación de la mano: cada pareja suma el valor de sus cartas bajadas, 200 por cada canasta limpia de 7+, 100 por cada sucia (7+ con comodín) y 100 por cerrar; resta las cartas que quedan en las manos de ambos compañeros, y 100 si nunca tomó su muerto.
La partida termina cuando una pareja llega a 2000 puntos o tras 3 manos; gana el total más alto y un empate se comparte. El bote es para los jugadores humanos de la pareja ganadora, o se reparte entre todos los humanos si esa pareja solo tiene computadoras. Nadie puede unirse ni salir durante una partida.""",
    ui="Una mesa de cartas verde. Arriba se ven el número de mano, la puntuación de ambas parejas (la tuya con borde dorado) y cuántas cartas tiene cada jugador, indicando qué parejas tomaron su muerto. Debajo están los juegos de las dos parejas; las canastas limpias y sucias (7+ cartas) llevan etiqueta. En el centro están el mazo con los muertos restantes y todo el pozo de descartes, con la carta de arriba ampliada. Tu mano está abajo. En tu turno, toca el mazo o el pozo para robar. Luego toca cartas para seleccionarlas: Nuevo juego aparta las cartas seleccionadas como un juego nuevo, tocar uno de los juegos de tu pareja se las añade, Bajar envía todo lo apartado y Borrar empieza de nuevo. Para terminar tu turno selecciona una carta y toca Descartar. Las pistas bajo el estado te dicen el mínimo de apertura de tu pareja o si puede cerrar. Funciona en teléfonos, tabletas y portátiles, en vertical y en horizontal.",
    tutorial=[
        "Cómo jugar al Buraco",
        "Dos parejas. Los compañeros comparten sus juegos y su puntuación.",
        "Tu turno",
        "Roba la carta de arriba del mazo o toma todo el pozo de descartes. Baja juegos si puedes y luego descarta una carta.",
        "Juegos",
        "Escaleras: 3+ cartas del mismo palo seguidas. Grupos: 3+ jotas, reinas, reyes o ases.",
        "Los doses y los comodines son comodín, como máximo uno por juego. Siete cartas forman una canasta: limpia sin comodín, sucia con uno.",
        "El muerto y cerrar",
        "Vacía tu mano una vez para tomar el muerto de tu pareja. Con el muerto y una canasta limpia, vacíala otra vez para terminar la mano.",
        "Puntuación",
        "Las cartas bajadas suman para ti y las que quedan en la mano restan. Canasta limpia 200, sucia 100, cerrar 100.",
    ],
    client={
        "title": "Buraco", "meta": "Mano {deal} de {max} · gana la primera pareja que llegue a {target} puntos",
        "team_us": "Tu pareja: {points} puntos", "team_them": "Rivales: {points} puntos", "team_a": "{a} y {b}: {points} puntos",
        "seat_line": "{name}: {cards} cartas", "seat_pot": "{name}: {cards} cartas · muerto tomado",
        "our_melds": "Juegos de tu pareja", "their_melds": "Juegos de los rivales", "melds_of": "Juegos de {a} y {b}",
        "no_melds": "Aún no hay juegos.", "clean": "limpia", "dirty": "sucia",
        "stock": "Mazo: {count}", "pots_left": "Muertos restantes: {count}", "discard_pile": "Pozo de descartes: {count}",
        "draw_stock": "Robar del mazo", "take_pile": "Tomar el pozo de descartes",
        "your_draw": "Tu turno: roba del mazo o toma todo el pozo de descartes.",
        "your_play": "Baja juegos si quieres y luego descarta una carta.",
        "opening": "Los primeros juegos de tu pareja deben sumar al menos {points} puntos de una vez.",
        "go_out_ready": "Tu pareja puede cerrar.",
        "go_out_not_yet": "Tu pareja aún no puede cerrar: necesita su muerto y un juego limpio de siete.",
        "waiting": "Esperando a {name}.", "watching": "Estás viendo esta partida.",
        "new_meld": "Nuevo juego", "lay_down": "Bajar", "clear": "Borrar", "discard": "Descartar",
        "select_hint": "Toca cartas para seleccionarlas. Toca un juego de tu pareja para añadirle las cartas seleccionadas.",
        "staged_label": "Para bajar:", "pair": "{a} y {b}",
        "deal_result": "Mano {deal}: {a} sumaron {pa}, {b} sumaron {pb}.",
        "deal_out": "La pareja de {name} cerró.", "deal_no_out": "Se acabó el mazo.",
        "you_win": "¡Tu pareja gana la partida!", "they_win": "Los rivales ganan la partida.",
        "team_wins": "{a} y {b} ganan la partida.", "tie": "La partida termina en empate.",
        "joker": "Comodín", "card_label": "{rank} de {suit}",
        "suit_c": "tréboles", "suit_d": "diamantes", "suit_h": "corazones", "suit_s": "picas",
        "server_the_game_is_over": "la partida ha terminado",
        "server_it_is_not_your_turn": "no es tu turno",
        "server_you_have_already_drawn_this_turn": "ya has robado en este turno",
        "server_the_stock_is_empty": "el mazo está vacío",
        "server_the_discard_pile_is_empty": "el pozo de descartes está vacío",
        "server_draw_a_card_first": "primero roba una carta",
        "server_you_do_not_have_that_card": "no tienes esa carta",
        "server_your_team_cannot_go_out_yet": "tu pareja aún no puede cerrar",
        "server_that_meld_does_not_exist": "ese juego no existe",
        "server_you_do_not_have_those_cards": "no tienes esas cartas",
        "server_those_cards_do_not_fit_that_meld": "esas cartas no encajan en ese juego",
        "server_that_is_not_a_valid_meld": "ese no es un juego válido",
        "server_your_opening_melds_are_worth_less_than_the_minimum": "tus juegos de apertura valen menos que el mínimo",
        "server_keep_two_cards_your_team_cannot_go_out_yet": "guarda dos cartas: tu pareja aún no puede cerrar",
        "server_send_a_draw_a_discard_or_melds_to_lay": "envía un robo, un descarte o juegos para bajar",
    },
)

T["fr"] = dict(
    name="Buraco",
    description="Le jeu de cartes sud-américain de la famille de la canasta pour deux équipes de deux : piochez, posez des séquences et des brelans, formez des canastas propres et sales de sept, prenez votre mort et sortez le premier.",
    rules="""Le Buraco se joue à 4 joueurs en deux équipes fixes ; les partenaires sont assis face à face (1re et 3e places contre 2e et 4e). On utilise deux jeux de 52 cartes et 4 jokers (108 cartes).
À chaque donne : chaque joueur reçoit 11 cartes, deux morts de 11 cartes sont mis de côté face cachée, une carte commence la défausse et le reste forme la pioche. Le joueur qui suit le donneur commence ; on joue dans l'ordre des places.
Un tour : d'abord piochez la carte du dessus de la pioche ou prenez toute la défausse. Ensuite vous pouvez poser des combinaisons et ajouter des cartes à celles de votre équipe. Enfin défaussez une carte, ce qui termine votre tour.
Combinaisons : une séquence compte 3 cartes ou plus d'une même couleur qui se suivent (l'as en bas ou en haut : de A-2-3 jusqu'à Q-K-A, et une séquence peut avoir un as à chaque bout) ; un brelan compte 3 valets, dames, rois ou as ou plus. Les deux et les jokers sont des jokers, au plus un par combinaison ; un deux de la couleur de la séquence à sa propre place compte comme un 2 naturel. Les jokers peuvent se déplacer dans une combinaison quand on ajoute des cartes. Les combinaisons appartiennent à l'équipe et les deux partenaires peuvent les compléter ; les cartes posées ne reviennent jamais en main.
Ouverture : les premières combinaisons d'une équipe dans une donne doivent valoir au moins 50 points posés d'un coup (75 dès que l'équipe a 1500 points ou plus). Valeur des cartes : de 3 à 7 valent 5, de 8 au roi 10, l'as 15, le deux 20, le joker 30.
Morts : la première fois qu'un joueur d'une équipe vide sa main, il prend un mort. S'il a vidé sa main en posant des combinaisons, il continue avec le mort ; si c'est par la défausse, il joue le mort à son tour suivant. Quand la pioche est vide, un mort restant devient la pioche.
Sortir : quand une équipe a pris son mort et possède une combinaison propre de 7 cartes ou plus (sans joker), un joueur de cette équipe peut vider sa main pour finir la donne. Jusque-là, l'équipe ne peut pas vider sa main et doit garder des cartes à défausser. La donne se termine aussi quand un joueur doit piocher alors que la pioche et les morts sont vides.
Décompte d'une donne : chaque équipe additionne la valeur de ses cartes posées, 200 par canasta propre de 7+, 100 par canasta sale (7+ avec un joker) et 100 pour être sortie ; elle soustrait les cartes restant dans les mains des deux partenaires, et 100 si elle n'a jamais pris son mort.
La partie s'arrête quand une équipe atteint 2000 points ou après 3 donnes ; le total le plus élevé gagne et une égalité est partagée. La cagnotte revient aux joueurs humains de l'équipe gagnante, ou est partagée entre tous les humains si cette équipe n'a que des ordinateurs. Personne ne peut rejoindre ni quitter une partie en cours.""",
    ui="Une table de jeu verte. En haut : le numéro de la donne, les scores des deux équipes (la vôtre entourée d'or) et le nombre de cartes de chaque joueur, avec les équipes qui ont pris leur mort. En dessous, les combinaisons des deux équipes ; les canastas propres et sales (7+ cartes) sont signalées. Au centre, la pioche avec les morts restants et toute la défausse, sa carte du dessus agrandie. Votre main est en bas. À votre tour, touchez la pioche ou la défausse pour piocher. Touchez ensuite des cartes pour les sélectionner : Nouvelle combinaison met les cartes sélectionnées de côté comme nouvelle combinaison, toucher une combinaison de votre équipe les y ajoute, Poser envoie tout ce qui est de côté et Effacer recommence. Pour finir votre tour, sélectionnez une carte et touchez Défausser. Les indications sous le statut rappellent le minimum d'ouverture de votre équipe ou si elle peut sortir. Fonctionne sur téléphone, tablette et ordinateur portable, en portrait et en paysage.",
    tutorial=[
        "Comment jouer au Buraco",
        "Deux équipes de deux. Les partenaires partagent leurs combinaisons et leur score.",
        "Votre tour",
        "Piochez la carte du dessus de la pioche ou prenez toute la défausse. Posez des combinaisons si vous pouvez, puis défaussez une carte.",
        "Combinaisons",
        "Séquences : 3+ cartes d'une même couleur qui se suivent. Brelans : 3+ valets, dames, rois ou as.",
        "Les deux et les jokers sont des jokers, au plus un par combinaison. Sept cartes forment une canasta : propre sans joker, sale avec un.",
        "Le mort et la sortie",
        "Videz votre main une fois pour prendre le mort de votre équipe. Avec le mort et une canasta propre, videz-la encore pour finir la donne.",
        "Décompte",
        "Les cartes posées comptent pour vous, celles restées en main contre vous. Canasta propre 200, sale 100, sortie 100.",
    ],
    client={
        "title": "Buraco", "meta": "Donne {deal} sur {max} · la première équipe à {target} points gagne",
        "team_us": "Votre équipe : {points} points", "team_them": "Adversaires : {points} points", "team_a": "{a} et {b} : {points} points",
        "seat_line": "{name} : {cards} cartes", "seat_pot": "{name} : {cards} cartes · mort pris",
        "our_melds": "Combinaisons de votre équipe", "their_melds": "Combinaisons adverses", "melds_of": "Combinaisons de {a} et {b}",
        "no_melds": "Pas encore de combinaison.", "clean": "propre", "dirty": "sale",
        "stock": "Pioche : {count}", "pots_left": "Morts restants : {count}", "discard_pile": "Défausse : {count}",
        "draw_stock": "Piocher", "take_pile": "Prendre la défausse",
        "your_draw": "À vous : piochez ou prenez toute la défausse.",
        "your_play": "Posez des combinaisons si vous voulez, puis défaussez une carte.",
        "opening": "Les premières combinaisons de votre équipe doivent valoir au moins {points} points d'un coup.",
        "go_out_ready": "Votre équipe peut sortir.",
        "go_out_not_yet": "Votre équipe ne peut pas encore sortir : il lui faut son mort et une combinaison propre de sept.",
        "waiting": "En attente de {name}.", "watching": "Vous regardez cette partie.",
        "new_meld": "Nouvelle combinaison", "lay_down": "Poser", "clear": "Effacer", "discard": "Défausser",
        "select_hint": "Touchez des cartes pour les sélectionner. Touchez une combinaison de votre équipe pour y ajouter les cartes sélectionnées.",
        "staged_label": "À poser :", "pair": "{a} et {b}",
        "deal_result": "Donne {deal} : {a} ont marqué {pa}, {b} ont marqué {pb}.",
        "deal_out": "L'équipe de {name} est sortie.", "deal_no_out": "La pioche est épuisée.",
        "you_win": "Votre équipe gagne la partie !", "they_win": "Les adversaires gagnent la partie.",
        "team_wins": "{a} et {b} gagnent la partie.", "tie": "La partie se termine à égalité.",
        "joker": "Joker", "card_label": "{rank} de {suit}",
        "suit_c": "trèfle", "suit_d": "carreau", "suit_h": "cœur", "suit_s": "pique",
        "server_the_game_is_over": "la partie est terminée",
        "server_it_is_not_your_turn": "ce n'est pas votre tour",
        "server_you_have_already_drawn_this_turn": "vous avez déjà pioché ce tour-ci",
        "server_the_stock_is_empty": "la pioche est vide",
        "server_the_discard_pile_is_empty": "la défausse est vide",
        "server_draw_a_card_first": "piochez d'abord une carte",
        "server_you_do_not_have_that_card": "vous n'avez pas cette carte",
        "server_your_team_cannot_go_out_yet": "votre équipe ne peut pas encore sortir",
        "server_that_meld_does_not_exist": "cette combinaison n'existe pas",
        "server_you_do_not_have_those_cards": "vous n'avez pas ces cartes",
        "server_those_cards_do_not_fit_that_meld": "ces cartes ne vont pas dans cette combinaison",
        "server_that_is_not_a_valid_meld": "ce n'est pas une combinaison valide",
        "server_your_opening_melds_are_worth_less_than_the_minimum": "vos combinaisons d'ouverture valent moins que le minimum",
        "server_keep_two_cards_your_team_cannot_go_out_yet": "gardez deux cartes : votre équipe ne peut pas encore sortir",
        "server_send_a_draw_a_discard_or_melds_to_lay": "envoyez une pioche, une défausse ou des combinaisons à poser",
    },
)

T["de"] = dict(
    name="Buraco",
    description="Das südamerikanische Kartenspiel aus der Canasta-Familie für zwei Zweierteams: ziehen, Folgen und Gruppen auslegen, saubere und schmutzige Canastas aus sieben Karten bilden, den Stapel holen und als Erste ausmachen.",
    rules="""Buraco spielen 4 Spieler in zwei festen Teams; Partner sitzen sich gegenüber (1. und 3. Platz gegen 2. und 4.). Gespielt wird mit zwei 52er-Blättern und 4 Jokern (108 Karten).
Jede Runde: Jeder Spieler bekommt 11 Karten, zwei Reservestapel zu je 11 Karten werden verdeckt beiseitegelegt, eine Karte beginnt den Ablagestapel und der Rest ist der Nachziehstapel. Der Spieler nach dem Geber beginnt; gespielt wird in Sitzreihenfolge.
Ein Zug: Zuerst die oberste Karte des Nachziehstapels ziehen oder den ganzen Ablagestapel aufnehmen. Dann darfst du Kombinationen auslegen und Karten an die Kombinationen deines Teams anlegen. Zum Schluss legst du eine Karte ab, was deinen Zug beendet.
Kombinationen: Eine Folge sind 3 oder mehr Karten einer Farbe in Reihe (Ass unten oder oben: von A-2-3 bis Q-K-A, eine Folge darf an beiden Enden ein Ass haben); eine Gruppe sind 3 oder mehr Buben, Damen, Könige oder Asse. Zweien und Joker sind Joker, höchstens einer pro Kombination; eine Zwei der Farbe der Folge an ihrem eigenen Platz zählt als natürliche 2. Joker können innerhalb einer Kombination wandern, wenn Karten angelegt werden. Kombinationen gehören dem Team, beide Partner dürfen anlegen; ausgelegte Karten kommen nie auf die Hand zurück.
Eröffnung: Die ersten Kombinationen eines Teams in einer Runde müssen auf einmal mindestens 50 Punkte wert sein (75, sobald das Team 1500 Punkte oder mehr hat). Kartenwerte: 3 bis 7 zählen 5, 8 bis König 10, Ass 15, Zwei 20, Joker 30.
Reservestapel: Wenn ein Spieler eines Teams zum ersten Mal seine Hand leert, nimmt er einen Reservestapel. Hat er die Hand durch Auslegen geleert, spielt er mit dem Stapel weiter; durch das Ablegen, spielt er ihn in seinem nächsten Zug. Ist der Nachziehstapel leer, wird ein übriger Reservestapel zum Nachziehstapel.
Ausmachen: Hat ein Team seinen Reservestapel genommen und eine saubere Kombination aus 7 oder mehr Karten (ohne Joker), darf ein Spieler dieses Teams seine Hand leeren und so die Runde beenden. Bis dahin darf das Team seine Hand nicht leeren und muss Karten zum Ablegen behalten. Die Runde endet auch, wenn ein Spieler ziehen muss und Nachziehstapel und Reservestapel leer sind.
Wertung einer Runde: Jedes Team zählt die Werte seiner ausgelegten Karten, 200 für jede saubere Canasta (7+), 100 für jede schmutzige (7+ mit Joker) und 100 fürs Ausmachen; es zieht die Karten auf den Händen beider Partner ab, und 100, wenn es nie seinen Reservestapel genommen hat.
Die Partie endet, wenn ein Team 2000 Punkte erreicht, oder nach 3 Runden; die höhere Summe gewinnt, Gleichstand wird geteilt. Der Pot geht an die menschlichen Spieler des Siegerteams oder wird unter allen Menschen geteilt, wenn dieses Team nur aus Computern besteht. Während einer Partie kann niemand beitreten oder aussteigen.""",
    ui="Ein grüner Kartentisch. Oben stehen die Rundennummer, die Punkte beider Teams (dein Team golden umrandet) und die Kartenzahl jedes Spielers, mit Hinweis, welche Teams ihren Reservestapel genommen haben. Darunter liegen die Kombinationen beider Teams; saubere und schmutzige Canastas (7+ Karten) sind beschriftet. In der Mitte liegen der Nachziehstapel mit den übrigen Reservestapeln und der ganze Ablagestapel, die oberste Karte vergrößert. Deine Hand ist unten. Tippe in deinem Zug auf den Nachzieh- oder Ablagestapel, um zu ziehen. Tippe dann Karten an, um sie zu wählen: Neue Kombination legt die gewählten Karten als neue Kombination beiseite, ein Tipp auf eine Kombination deines Teams legt sie dort an, Auslegen schickt alles Beiseitegelegte ab und Zurücksetzen fängt neu an. Um den Zug zu beenden, wähle eine Karte und tippe auf Ablegen. Hinweise unter dem Status nennen das Eröffnungsminimum deines Teams oder ob es ausmachen darf. Funktioniert auf Handys, Tablets und Laptops, im Hoch- und Querformat.",
    tutorial=[
        "So spielst du Buraco",
        "Zwei Zweierteams. Partner teilen ihre Kombinationen und ihre Punkte.",
        "Dein Zug",
        "Ziehe die oberste Karte des Nachziehstapels oder nimm den ganzen Ablagestapel. Lege aus, wenn du kannst, und lege dann eine Karte ab.",
        "Kombinationen",
        "Folgen: 3+ Karten einer Farbe in Reihe. Gruppen: 3+ Buben, Damen, Könige oder Asse.",
        "Zweien und Joker sind Joker, höchstens einer pro Kombination. Sieben Karten sind eine Canasta: sauber ohne Joker, schmutzig mit einem.",
        "Reservestapel und Ausmachen",
        "Leere deine Hand einmal, um den Reservestapel deines Teams zu nehmen. Mit ihm und einer sauberen Canasta leerst du sie erneut und beendest die Runde.",
        "Wertung",
        "Ausgelegte Karten zählen für dich, Karten auf der Hand gegen dich. Saubere Canasta 200, schmutzige 100, Ausmachen 100.",
    ],
    client={
        "title": "Buraco", "meta": "Runde {deal} von {max} · das erste Team mit {target} Punkten gewinnt",
        "team_us": "Dein Team: {points} Punkte", "team_them": "Gegner: {points} Punkte", "team_a": "{a} und {b}: {points} Punkte",
        "seat_line": "{name}: {cards} Karten", "seat_pot": "{name}: {cards} Karten · Reservestapel genommen",
        "our_melds": "Kombinationen deines Teams", "their_melds": "Kombinationen der Gegner", "melds_of": "Kombinationen von {a} und {b}",
        "no_melds": "Noch keine Kombinationen.", "clean": "sauber", "dirty": "schmutzig",
        "stock": "Nachziehstapel: {count}", "pots_left": "Reservestapel übrig: {count}", "discard_pile": "Ablagestapel: {count}",
        "draw_stock": "Vom Nachziehstapel ziehen", "take_pile": "Ablagestapel aufnehmen",
        "your_draw": "Du bist dran: Ziehe vom Nachziehstapel oder nimm den ganzen Ablagestapel.",
        "your_play": "Lege Kombinationen aus, wenn du willst, und lege dann eine Karte ab.",
        "opening": "Die ersten Kombinationen deines Teams müssen auf einmal mindestens {points} Punkte wert sein.",
        "go_out_ready": "Dein Team darf ausmachen.",
        "go_out_not_yet": "Dein Team darf noch nicht ausmachen: Es braucht seinen Reservestapel und eine saubere Siebener-Kombination.",
        "waiting": "Warte auf {name}.", "watching": "Du schaust dieser Partie zu.",
        "new_meld": "Neue Kombination", "lay_down": "Auslegen", "clear": "Zurücksetzen", "discard": "Ablegen",
        "select_hint": "Tippe Karten an, um sie zu wählen. Tippe auf eine Kombination deines Teams, um die gewählten Karten anzulegen.",
        "staged_label": "Zum Auslegen:", "pair": "{a} und {b}",
        "deal_result": "Runde {deal}: {a} bekamen {pa}, {b} bekamen {pb}.",
        "deal_out": "Das Team von {name} hat ausgemacht.", "deal_no_out": "Der Nachziehstapel ist aufgebraucht.",
        "you_win": "Dein Team gewinnt die Partie!", "they_win": "Die Gegner gewinnen die Partie.",
        "team_wins": "{a} und {b} gewinnen die Partie.", "tie": "Die Partie endet unentschieden.",
        "joker": "Joker", "card_label": "{suit} {rank}",
        "suit_c": "Kreuz", "suit_d": "Karo", "suit_h": "Herz", "suit_s": "Pik",
        "server_the_game_is_over": "die Partie ist vorbei",
        "server_it_is_not_your_turn": "du bist nicht am Zug",
        "server_you_have_already_drawn_this_turn": "du hast in diesem Zug schon gezogen",
        "server_the_stock_is_empty": "der Nachziehstapel ist leer",
        "server_the_discard_pile_is_empty": "der Ablagestapel ist leer",
        "server_draw_a_card_first": "ziehe zuerst eine Karte",
        "server_you_do_not_have_that_card": "du hast diese Karte nicht",
        "server_your_team_cannot_go_out_yet": "dein Team darf noch nicht ausmachen",
        "server_that_meld_does_not_exist": "diese Kombination gibt es nicht",
        "server_you_do_not_have_those_cards": "du hast diese Karten nicht",
        "server_those_cards_do_not_fit_that_meld": "diese Karten passen nicht zu dieser Kombination",
        "server_that_is_not_a_valid_meld": "das ist keine gültige Kombination",
        "server_your_opening_melds_are_worth_less_than_the_minimum": "deine Eröffnungskombinationen sind weniger als das Minimum wert",
        "server_keep_two_cards_your_team_cannot_go_out_yet": "behalte zwei Karten: dein Team darf noch nicht ausmachen",
        "server_send_a_draw_a_discard_or_melds_to_lay": "sende einen Zug zum Ziehen, Ablegen oder Auslegen",
    },
)

T["pt"] = dict(
    name="Buraco",
    description="O jogo de cartas sul-americano da família da canastra para duas duplas: compre, baixe sequências e trincas, forme canastras limpas e sujas de sete, pegue o seu morto e bata primeiro.",
    rules="""O Buraco é jogado por 4 jogadores em duas duplas fixas; os parceiros sentam frente a frente (1º e 3º lugares contra 2º e 4º). Usam-se dois baralhos de 52 cartas mais 4 curingas (108 cartas).
Em cada mão: cada jogador recebe 11 cartas, dois mortos de 11 cartas ficam separados virados para baixo, uma carta começa o lixo e o resto é o monte. Começa o jogador depois de quem deu; joga-se na ordem dos lugares.
Uma jogada: primeiro compre a carta de cima do monte ou pegue o lixo inteiro. Depois você pode baixar jogos e acrescentar cartas aos jogos da sua dupla. Por fim descarte uma carta, o que encerra a sua vez.
Jogos: uma sequência são 3 ou mais cartas do mesmo naipe em ordem (o ás pode ser baixo ou alto: de A-2-3 até Q-K-A, e uma sequência pode ter ás nas duas pontas); uma trinca são 3 ou mais valetes, damas, reis ou ases. Os dois e os curingas são coringas, no máximo um por jogo; um dois do naipe da sequência no seu próprio lugar conta como 2 natural. Os coringas podem mudar de lugar no jogo quando se acrescentam cartas. Os jogos são da dupla e os dois parceiros podem acrescentar cartas; cartas na mesa nunca voltam para a mão.
Abertura: os primeiros jogos de uma dupla em cada mão devem valer pelo menos 50 pontos baixados de uma vez (75 quando a dupla tem 1500 pontos ou mais). Valor das cartas: do 3 ao 7 valem 5, do 8 ao rei 10, ás 15, dois 20, curinga 30.
Mortos: na primeira vez que um jogador de uma dupla esvazia a mão, ele pega um morto. Se esvaziou baixando jogos, continua jogando com o morto; se foi pelo descarte, joga o morto na sua próxima vez. Quando o monte acaba, um morto restante vira o monte.
Bater: quando uma dupla já pegou o seu morto e tem um jogo limpo de 7 ou mais cartas (sem coringa), um jogador dessa dupla pode esvaziar a mão para encerrar a mão. Até lá a dupla não pode esvaziar a mão e deve guardar cartas para descartar. A mão também termina quando um jogador precisa comprar e o monte e os mortos estão vazios.
Contagem da mão: cada dupla soma o valor das cartas baixadas, 200 por canastra limpa de 7+, 100 por canastra suja (7+ com coringa) e 100 por bater; subtrai as cartas que restam nas mãos dos dois parceiros, e 100 se nunca pegou o seu morto.
A partida termina quando uma dupla chega a 2000 pontos ou depois de 3 mãos; vence o maior total e um empate é dividido. O prêmio vai para os jogadores humanos da dupla vencedora, ou é dividido entre todos os humanos se essa dupla só tiver computadores. Ninguém pode entrar nem sair durante uma partida.""",
    ui="Uma mesa de cartas verde. No topo aparecem o número da mão, os pontos das duas duplas (a sua com contorno dourado) e quantas cartas cada jogador tem, indicando quais duplas já pegaram o morto. Abaixo ficam os jogos das duas duplas; canastras limpas e sujas (7+ cartas) têm etiqueta. No meio ficam o monte com os mortos restantes e o lixo inteiro, com a carta de cima ampliada. A sua mão fica embaixo. Na sua vez, toque no monte ou no lixo para comprar. Depois toque em cartas para selecioná-las: Novo jogo separa as cartas selecionadas como um jogo novo, tocar em um jogo da sua dupla acrescenta as cartas a ele, Baixar envia tudo o que foi separado e Limpar recomeça. Para encerrar a vez, selecione uma carta e toque em Descartar. As dicas abaixo do status mostram o mínimo de abertura da sua dupla ou se ela pode bater. Funciona em celulares, tablets e notebooks, na vertical e na horizontal.",
    tutorial=[
        "Como jogar Buraco",
        "Duas duplas. Os parceiros dividem os jogos e a pontuação.",
        "Sua vez",
        "Compre a carta de cima do monte ou pegue o lixo inteiro. Baixe jogos se puder e depois descarte uma carta.",
        "Jogos",
        "Sequências: 3+ cartas do mesmo naipe em ordem. Trincas: 3+ valetes, damas, reis ou ases.",
        "Os dois e os curingas são coringas, no máximo um por jogo. Sete cartas formam uma canastra: limpa sem coringa, suja com um.",
        "O morto e a batida",
        "Esvazie a mão uma vez para pegar o morto da sua dupla. Com o morto e uma canastra limpa, esvazie de novo para encerrar a mão.",
        "Contagem",
        "Cartas baixadas contam a favor, cartas na mão contam contra. Canastra limpa 200, suja 100, batida 100.",
    ],
    client={
        "title": "Buraco", "meta": "Mão {deal} de {max} · vence a primeira dupla a chegar a {target} pontos",
        "team_us": "Sua dupla: {points} pontos", "team_them": "Adversários: {points} pontos", "team_a": "{a} e {b}: {points} pontos",
        "seat_line": "{name}: {cards} cartas", "seat_pot": "{name}: {cards} cartas · morto pego",
        "our_melds": "Jogos da sua dupla", "their_melds": "Jogos dos adversários", "melds_of": "Jogos de {a} e {b}",
        "no_melds": "Nenhum jogo ainda.", "clean": "limpa", "dirty": "suja",
        "stock": "Monte: {count}", "pots_left": "Mortos restantes: {count}", "discard_pile": "Lixo: {count}",
        "draw_stock": "Comprar do monte", "take_pile": "Pegar o lixo",
        "your_draw": "Sua vez: compre do monte ou pegue o lixo inteiro.",
        "your_play": "Baixe jogos se quiser e depois descarte uma carta.",
        "opening": "Os primeiros jogos da sua dupla devem valer pelo menos {points} pontos de uma vez.",
        "go_out_ready": "Sua dupla pode bater.",
        "go_out_not_yet": "Sua dupla ainda não pode bater: precisa do morto e de um jogo limpo de sete.",
        "waiting": "Aguardando {name}.", "watching": "Você está assistindo a esta partida.",
        "new_meld": "Novo jogo", "lay_down": "Baixar", "clear": "Limpar", "discard": "Descartar",
        "select_hint": "Toque em cartas para selecioná-las. Toque em um jogo da sua dupla para acrescentar as cartas selecionadas.",
        "staged_label": "Para baixar:", "pair": "{a} e {b}",
        "deal_result": "Mão {deal}: {a} fizeram {pa}, {b} fizeram {pb}.",
        "deal_out": "A dupla de {name} bateu.", "deal_no_out": "O monte acabou.",
        "you_win": "Sua dupla venceu a partida!", "they_win": "Os adversários venceram a partida.",
        "team_wins": "{a} e {b} venceram a partida.", "tie": "A partida terminou empatada.",
        "joker": "Curinga", "card_label": "{rank} de {suit}",
        "suit_c": "paus", "suit_d": "ouros", "suit_h": "copas", "suit_s": "espadas",
        "server_the_game_is_over": "o jogo terminou",
        "server_it_is_not_your_turn": "não é a sua vez",
        "server_you_have_already_drawn_this_turn": "você já comprou nesta vez",
        "server_the_stock_is_empty": "o monte está vazio",
        "server_the_discard_pile_is_empty": "o lixo está vazio",
        "server_draw_a_card_first": "compre uma carta primeiro",
        "server_you_do_not_have_that_card": "você não tem essa carta",
        "server_your_team_cannot_go_out_yet": "sua dupla ainda não pode bater",
        "server_that_meld_does_not_exist": "esse jogo não existe",
        "server_you_do_not_have_those_cards": "você não tem essas cartas",
        "server_those_cards_do_not_fit_that_meld": "essas cartas não cabem nesse jogo",
        "server_that_is_not_a_valid_meld": "isso não é um jogo válido",
        "server_your_opening_melds_are_worth_less_than_the_minimum": "seus jogos de abertura valem menos que o mínimo",
        "server_keep_two_cards_your_team_cannot_go_out_yet": "guarde duas cartas: sua dupla ainda não pode bater",
        "server_send_a_draw_a_discard_or_melds_to_lay": "envie uma compra, um descarte ou jogos para baixar",
    },
)

T["zh"] = dict(
    name="布拉科",
    description="南美的卡纳斯塔类纸牌游戏，两人一队共两队：摸牌，摆出顺子和同点组，凑成七张的干净或混合卡纳斯塔，拿到你的底牌并率先出完。",
    rules="""布拉科由 4 名玩家分成两支固定队伍进行；搭档相对而坐（第 1、3 座对第 2、4 座）。使用两副 52 张的牌加 4 张王牌（共 108 张）。
每一局：每人发 11 张牌，另留两叠各 11 张的底牌背面朝下，一张牌作为弃牌堆的开头，其余为牌堆。发牌者的下一位先行；按座位顺序进行。
每回合：先从牌堆顶摸一张，或拿走整个弃牌堆。然后可以摆出牌组，并把牌加到本队的牌组上。最后弃一张牌，回合结束。
牌组：顺子是同花色、连续的 3 张或以上（A 可小可大：从 A-2-3 到 Q-K-A，一组顺子两端都可以是 A）；同点组是 3 张或以上的 J、Q、K 或 A。2 和王牌是百搭牌，每组最多一张；与顺子同花色且在自己位置上的 2 算作普通的 2。加牌时百搭牌可以在牌组内移动。牌组属于整队，两名搭档都可以加牌；摆到桌上的牌不再回到手中。
开局：一队在每局的第一批牌组必须一次摆出至少 50 分（本队达到 1500 分或以上后为 75 分）。牌值：3 到 7 为 5 分，8 到 K 为 10 分，A 为 15 分，2 为 20 分，王牌为 30 分。
底牌：一队的玩家第一次出完手牌时，拿走一叠底牌。如果是靠摆牌组出完的，就接着用底牌继续出牌；如果是靠弃牌出完的，就在下一回合使用底牌。牌堆用完时，剩下的底牌成为新的牌堆。
出完：当一队已拿到底牌，并有一组 7 张或以上的干净牌组（不含百搭），该队玩家可以出完手牌结束本局。在此之前该队不能出完手牌，必须留牌用来弃。当玩家需要摸牌而牌堆和底牌都已用完时，本局也结束。
一局计分：每队加上已摆出牌的牌值，每个 7 张以上的干净卡纳斯塔加 200，每个混合卡纳斯塔（7 张以上含百搭）加 100，出完加 100；减去两名搭档手中剩余的牌，若从未拿到底牌再减 100。
当一队达到 2000 分，或打满 3 局后，比赛结束；总分高者获胜，平分则共享胜利。奖池归获胜队的人类玩家；如果该队只有电脑，则由所有人类玩家平分。对局中任何人都不能加入或离开。""",
    ui="绿色牌桌。顶部显示局数、两队得分（你的队伍有金色边框）以及每名玩家的手牌数，并注明哪些队伍已拿到底牌。下方是两队的牌组；7 张以上的干净和混合卡纳斯塔会标出。中间是牌堆和剩余底牌数，以及整个弃牌堆，最上面一张放大显示。你的手牌在底部。轮到你时，点牌堆或弃牌堆摸牌。然后点选手牌：“新牌组”把选中的牌放到一边作为新牌组，点本队的某个牌组可把选中的牌加上去，“摆出”发送所有放到一边的牌，“清除”重新开始。要结束回合，选中一张牌并点“弃牌”。状态下方的提示会告诉你本队的开局最低分，或是否可以出完。适用于手机、平板和笔记本电脑，横屏竖屏皆可。",
    tutorial=[
        "布拉科玩法",
        "两人一队共两队。搭档共享牌组和分数。",
        "你的回合",
        "从牌堆顶摸一张，或拿走整个弃牌堆。能摆牌组就摆，然后弃一张牌。",
        "牌组",
        "顺子：同花色连续 3 张以上。同点组：3 张以上的 J、Q、K 或 A。",
        "2 和王牌是百搭，每组最多一张。七张牌组成卡纳斯塔：无百搭为干净，有一张为混合。",
        "底牌与出完",
        "第一次出完手牌时拿走本队的底牌。有了底牌和一个干净卡纳斯塔后，再次出完即可结束本局。",
        "计分",
        "摆出的牌为你加分，留在手中的牌扣分。干净卡纳斯塔 200，混合 100，出完 100。",
    ],
    client={
        "title": "布拉科", "meta": "第 {deal} 局，共 {max} 局 · 先到 {target} 分的队伍获胜",
        "team_us": "你的队伍：{points} 分", "team_them": "对手：{points} 分", "team_a": "{a} 和 {b}：{points} 分",
        "seat_line": "{name}：{cards} 张牌", "seat_pot": "{name}：{cards} 张牌 · 已拿底牌",
        "our_melds": "本队牌组", "their_melds": "对手牌组", "melds_of": "{a} 和 {b} 的牌组",
        "no_melds": "还没有牌组。", "clean": "干净", "dirty": "混合",
        "stock": "牌堆：{count}", "pots_left": "剩余底牌：{count}", "discard_pile": "弃牌堆：{count}",
        "draw_stock": "从牌堆摸牌", "take_pile": "拿走弃牌堆",
        "your_draw": "轮到你：从牌堆摸牌或拿走整个弃牌堆。",
        "your_play": "可以摆出牌组，然后弃一张牌。",
        "opening": "本队的第一批牌组必须一次摆出至少 {points} 分。",
        "go_out_ready": "本队可以出完。",
        "go_out_not_yet": "本队还不能出完：需要底牌和一个七张的干净牌组。",
        "waiting": "等待 {name}。", "watching": "你正在观看这场对局。",
        "new_meld": "新牌组", "lay_down": "摆出", "clear": "清除", "discard": "弃牌",
        "select_hint": "点牌即可选中。点本队的牌组可把选中的牌加上去。",
        "staged_label": "待摆出：", "pair": "{a} 和 {b}",
        "deal_result": "第 {deal} 局：{a} 得 {pa} 分，{b} 得 {pb} 分。",
        "deal_out": "{name} 的队伍出完了。", "deal_no_out": "牌堆用完了。",
        "you_win": "你的队伍赢得了比赛！", "they_win": "对手赢得了比赛。",
        "team_wins": "{a} 和 {b} 赢得了比赛。", "tie": "比赛打成平局。",
        "joker": "王牌", "card_label": "{suit}{rank}",
        "suit_c": "梅花", "suit_d": "方块", "suit_h": "红心", "suit_s": "黑桃",
        "server_the_game_is_over": "游戏已结束",
        "server_it_is_not_your_turn": "还没轮到你",
        "server_you_have_already_drawn_this_turn": "你本回合已经摸过牌了",
        "server_the_stock_is_empty": "牌堆已空",
        "server_the_discard_pile_is_empty": "弃牌堆是空的",
        "server_draw_a_card_first": "请先摸牌",
        "server_you_do_not_have_that_card": "你没有那张牌",
        "server_your_team_cannot_go_out_yet": "本队还不能出完",
        "server_that_meld_does_not_exist": "那个牌组不存在",
        "server_you_do_not_have_those_cards": "你没有那些牌",
        "server_those_cards_do_not_fit_that_meld": "那些牌加不到那个牌组里",
        "server_that_is_not_a_valid_meld": "那不是有效的牌组",
        "server_your_opening_melds_are_worth_less_than_the_minimum": "你的开局牌组低于最低分",
        "server_keep_two_cards_your_team_cannot_go_out_yet": "请留两张牌：本队还不能出完",
        "server_send_a_draw_a_discard_or_melds_to_lay": "请发送摸牌、弃牌或要摆出的牌组",
    },
)

T["hi"] = dict(
    name="बुराको",
    description="दो-दो खिलाड़ियों की दो टीमों के लिए कनास्टा परिवार का दक्षिण अमेरिकी ताश खेल: पत्ते उठाइए, क्रम और समूह रखिए, सात पत्तों के साफ़ और मिलावटी कनास्टा बनाइए, अपना पॉट लीजिए और सबसे पहले खत्म कीजिए।",
    rules="""बुराको 4 खिलाड़ी दो स्थायी टीमों में खेलते हैं; साथी आमने-सामने बैठते हैं (पहली और तीसरी सीट बनाम दूसरी और चौथी)। दो 52 पत्तों की गड्डियाँ और 4 जोकर इस्तेमाल होते हैं (108 पत्ते)।
हर बाज़ी: हर खिलाड़ी को 11 पत्ते मिलते हैं, 11-11 पत्तों के दो पॉट उल्टे अलग रखे जाते हैं, एक पत्ता फेंके गए पत्तों का ढेर शुरू करता है और बाकी उठाने की गड्डी होती है। बाँटने वाले के बाद वाला खिलाड़ी शुरू करता है; खेल सीट के क्रम में चलता है।
एक बारी: पहले उठाने की गड्डी का ऊपर का पत्ता लीजिए या फेंके गए पत्तों का पूरा ढेर उठाइए। फिर आप मेल रख सकते हैं और अपनी टीम के मेलों में पत्ते जोड़ सकते हैं। आख़िर में एक पत्ता फेंकिए, इससे आपकी बारी खत्म होती है।
मेल: क्रम एक ही रंग के 3 या ज़्यादा लगातार पत्ते हैं (इक्का नीचे या ऊपर: A-2-3 से Q-K-A तक, और एक क्रम के दोनों सिरों पर इक्का हो सकता है); समूह 3 या ज़्यादा गुलाम, बेगम, बादशाह या इक्के हैं। दुक्की और जोकर वाइल्ड हैं, हर मेल में ज़्यादा से ज़्यादा एक; क्रम के अपने रंग की दुक्की अपनी जगह पर असली 2 गिनी जाती है। पत्ते जोड़ने पर वाइल्ड मेल के अंदर खिसक सकता है। मेल टीम के होते हैं और दोनों साथी उनमें जोड़ सकते हैं; मेज़ पर रखे पत्ते कभी हाथ में वापस नहीं आते।
शुरुआत: हर बाज़ी में किसी टीम के पहले मेल एक बार में कम से कम 50 अंक के होने चाहिए (टीम के 1500 या ज़्यादा अंक होने पर 75)। पत्तों के अंक: 3 से 7 के 5, 8 से बादशाह के 10, इक्का 15, दुक्की 20, जोकर 30।
पॉट: किसी टीम का खिलाड़ी जब पहली बार अपना हाथ खाली करता है, तो एक पॉट लेता है। अगर हाथ मेल रखकर खाली हुआ, तो वह पॉट से खेलना जारी रखता है; अगर पत्ता फेंककर, तो अपनी अगली बारी में पॉट खेलता है। उठाने की गड्डी खत्म होने पर बचा हुआ पॉट नई गड्डी बन जाता है।
खत्म करना: जब किसी टीम ने अपना पॉट ले लिया हो और उसके पास 7 या ज़्यादा पत्तों का साफ़ मेल (बिना वाइल्ड) हो, तो उस टीम का खिलाड़ी हाथ खाली करके बाज़ी खत्म कर सकता है। तब तक टीम हाथ खाली नहीं कर सकती, इसलिए उसे फेंकने के लिए पत्ते रखने होंगे। जब किसी खिलाड़ी को पत्ता उठाना हो और गड्डी व पॉट दोनों खाली हों, तब भी बाज़ी खत्म होती है।
बाज़ी के अंक: हर टीम अपने रखे पत्तों के अंक जोड़ती है, हर 7+ साफ़ कनास्टा के 200, हर मिलावटी (7+ वाइल्ड के साथ) के 100 और खत्म करने के 100; दोनों साथियों के हाथ में बचे पत्तों के अंक घटाती है, और अगर पॉट कभी नहीं लिया तो 100 और।
मैच तब खत्म होता है जब कोई टीम 2000 अंक तक पहुँचे, या 3 बाज़ियों के बाद; ज़्यादा कुल वाली टीम जीतती है और बराबरी में जीत बँटती है। इनाम जीतने वाली टीम के मानव खिलाड़ियों को मिलता है, या अगर उस टीम में सिर्फ़ कंप्यूटर हों तो सभी मानवों में बँटता है। मैच के दौरान कोई जुड़ या छोड़ नहीं सकता।""",
    ui="हरी ताश की मेज़। ऊपर बाज़ी का नंबर, दोनों टीमों के अंक (आपकी टीम सुनहरे घेरे में) और हर खिलाड़ी के पत्तों की संख्या दिखती है, यह भी कि किन टीमों ने पॉट ले लिया है। उसके नीचे दोनों टीमों के मेल हैं; 7+ पत्तों के साफ़ और मिलावटी कनास्टा पर लेबल है। बीच में उठाने की गड्डी बचे पॉट के साथ और फेंके गए पत्तों का पूरा ढेर है, ऊपर का पत्ता बड़ा दिखता है। आपका हाथ नीचे है। अपनी बारी में पत्ता लेने के लिए गड्डी या ढेर पर टैप कीजिए। फिर पत्ते चुनने के लिए उन पर टैप कीजिए: नया मेल चुने पत्तों को नए मेल के रूप में अलग रखता है, अपनी टीम के किसी मेल पर टैप करने से पत्ते उसमें जुड़ते हैं, रखें सब अलग रखे पत्ते भेजता है और साफ़ करें फिर से शुरू करता है। बारी खत्म करने के लिए एक पत्ता चुनकर फेंकें दबाइए। स्थिति के नीचे के संकेत आपकी टीम की शुरुआती न्यूनतम सीमा या खत्म कर सकने की बात बताते हैं। फ़ोन, टैबलेट और लैपटॉप पर, खड़े और आड़े दोनों में चलता है।",
    tutorial=[
        "बुराको कैसे खेलें",
        "दो-दो की दो टीमें। साथी अपने मेल और अंक साझा करते हैं।",
        "आपकी बारी",
        "गड्डी का ऊपर का पत्ता लीजिए या फेंके गए पत्तों का पूरा ढेर उठाइए। हो सके तो मेल रखिए, फिर एक पत्ता फेंकिए।",
        "मेल",
        "क्रम: एक ही रंग के 3+ लगातार पत्ते। समूह: 3+ गुलाम, बेगम, बादशाह या इक्के।",
        "दुक्की और जोकर वाइल्ड हैं, हर मेल में ज़्यादा से ज़्यादा एक। सात पत्ते कनास्टा बनाते हैं: बिना वाइल्ड साफ़, एक के साथ मिलावटी।",
        "पॉट और खत्म करना",
        "एक बार हाथ खाली करके अपनी टीम का पॉट लीजिए। पॉट और एक साफ़ कनास्टा के साथ फिर हाथ खाली करके बाज़ी खत्म कीजिए।",
        "अंक",
        "रखे गए पत्ते आपके पक्ष में, हाथ में बचे पत्ते आपके ख़िलाफ़ गिने जाते हैं। साफ़ कनास्टा 200, मिलावटी 100, खत्म करना 100।",
    ],
    client={
        "title": "बुराको", "meta": "बाज़ी {deal} / {max} · {target} अंक तक पहले पहुँचने वाली टीम जीतती है",
        "team_us": "आपकी टीम: {points} अंक", "team_them": "विरोधी: {points} अंक", "team_a": "{a} और {b}: {points} अंक",
        "seat_line": "{name}: {cards} पत्ते", "seat_pot": "{name}: {cards} पत्ते · पॉट लिया",
        "our_melds": "आपकी टीम के मेल", "their_melds": "विरोधियों के मेल", "melds_of": "{a} और {b} के मेल",
        "no_melds": "अभी कोई मेल नहीं।", "clean": "साफ़", "dirty": "मिलावटी",
        "stock": "गड्डी: {count}", "pots_left": "बचे पॉट: {count}", "discard_pile": "फेंके गए पत्ते: {count}",
        "draw_stock": "गड्डी से पत्ता लें", "take_pile": "फेंके गए पत्तों का ढेर उठाएँ",
        "your_draw": "आपकी बारी: गड्डी से पत्ता लीजिए या फेंके गए पत्तों का पूरा ढेर उठाइए।",
        "your_play": "चाहें तो मेल रखिए, फिर एक पत्ता फेंकिए।",
        "opening": "आपकी टीम के पहले मेल एक बार में कम से कम {points} अंक के होने चाहिए।",
        "go_out_ready": "आपकी टीम खत्म कर सकती है।",
        "go_out_not_yet": "आपकी टीम अभी खत्म नहीं कर सकती: उसे पॉट और सात पत्तों का एक साफ़ मेल चाहिए।",
        "waiting": "{name} का इंतज़ार।", "watching": "आप यह मैच देख रहे हैं।",
        "new_meld": "नया मेल", "lay_down": "रखें", "clear": "साफ़ करें", "discard": "फेंकें",
        "select_hint": "पत्ते चुनने के लिए उन पर टैप कीजिए। चुने पत्ते जोड़ने के लिए अपनी टीम के किसी मेल पर टैप कीजिए।",
        "staged_label": "रखने के लिए:", "pair": "{a} और {b}",
        "deal_result": "बाज़ी {deal}: {a} को {pa}, {b} को {pb} अंक।",
        "deal_out": "{name} की टीम ने खत्म किया।", "deal_no_out": "गड्डी खत्म हो गई।",
        "you_win": "आपकी टीम मैच जीत गई!", "they_win": "विरोधी मैच जीत गए।",
        "team_wins": "{a} और {b} मैच जीत गए।", "tie": "मैच बराबरी पर खत्म हुआ।",
        "joker": "जोकर", "card_label": "{suit} का {rank}",
        "suit_c": "चिड़ी", "suit_d": "ईंट", "suit_h": "पान", "suit_s": "हुकुम",
        "server_the_game_is_over": "खेल खत्म हो चुका है",
        "server_it_is_not_your_turn": "आपकी बारी नहीं है",
        "server_you_have_already_drawn_this_turn": "आप इस बारी में पत्ता ले चुके हैं",
        "server_the_stock_is_empty": "गड्डी खाली है",
        "server_the_discard_pile_is_empty": "फेंके गए पत्तों का ढेर खाली है",
        "server_draw_a_card_first": "पहले एक पत्ता लीजिए",
        "server_you_do_not_have_that_card": "आपके पास वह पत्ता नहीं है",
        "server_your_team_cannot_go_out_yet": "आपकी टीम अभी खत्म नहीं कर सकती",
        "server_that_meld_does_not_exist": "वह मेल मौजूद नहीं है",
        "server_you_do_not_have_those_cards": "आपके पास वे पत्ते नहीं हैं",
        "server_those_cards_do_not_fit_that_meld": "वे पत्ते उस मेल में नहीं जुड़ते",
        "server_that_is_not_a_valid_meld": "यह सही मेल नहीं है",
        "server_your_opening_melds_are_worth_less_than_the_minimum": "आपके शुरुआती मेल न्यूनतम से कम अंक के हैं",
        "server_keep_two_cards_your_team_cannot_go_out_yet": "दो पत्ते रखिए: आपकी टीम अभी खत्म नहीं कर सकती",
        "server_send_a_draw_a_discard_or_melds_to_lay": "पत्ता लेना, फेंकना या रखने के मेल भेजिए",
    },
)

T["ar"] = dict(
    name="بوراكو",
    description="لعبة ورق من أمريكا الجنوبية من عائلة الكناستا لفريقين من لاعبَين: اسحب، وضع المتتاليات والمجموعات، وكوّن كناستات نظيفة ومختلطة من سبع أوراق، وخذ رزمتك وأنهِ أولًا.",
    rules="""يلعب البوراكو 4 لاعبين في فريقين ثابتين؛ يجلس الشريكان متقابلين (المقعدان الأول والثالث ضد الثاني والرابع). تُستخدم مجموعتا ورق من 52 ورقة و4 جوكر (108 أوراق).
في كل توزيعة: يحصل كل لاعب على 11 ورقة، وتُترك رزمتان من 11 ورقة مقلوبتين جانبًا، وتبدأ ورقة واحدة كومة الرمي، والباقي كومة السحب. يبدأ اللاعب الذي يلي الموزّع، ويسير اللعب بترتيب المقاعد.
الدور: اسحب أولًا الورقة العليا من كومة السحب أو خذ كومة الرمي كلها. ثم يمكنك وضع تشكيلات وإضافة أوراق إلى تشكيلات فريقك. وأخيرًا ارمِ ورقة واحدة، فينتهي دورك.
التشكيلات: المتتالية 3 أوراق أو أكثر من النوع نفسه بالترتيب (الآس صغير أو كبير: من A-2-3 حتى Q-K-A، ويمكن أن يكون للمتتالية آس في الطرفين)؛ والمجموعة 3 أو أكثر من الشباب أو البنات أو الملوك أو الآسات. الاثنان والجوكر أوراق بديلة، بحد أقصى واحدة لكل تشكيلة؛ والاثنان من نوع المتتالية في مكانه الصحيح يُحسب 2 طبيعيًا. يمكن للورقة البديلة أن تنتقل داخل التشكيلة عند إضافة أوراق. التشكيلات ملك للفريق ويمكن لكلا الشريكين الإضافة إليها؛ ولا تعود الأوراق الموضوعة إلى اليد أبدًا.
الافتتاح: يجب أن تبلغ أول تشكيلات الفريق في كل توزيعة 50 نقطة على الأقل توضع دفعة واحدة (75 عندما يصل الفريق إلى 1500 نقطة أو أكثر). قيم الأوراق: من 3 إلى 7 بـ 5، ومن 8 إلى الملك بـ 10، والآس 15، والاثنان 20، والجوكر 30.
الرزم: في أول مرة يفرغ فيها لاعب من فريق يده، يأخذ رزمة. إن أفرغها بوضع التشكيلات تابع اللعب بالرزمة؛ وإن أفرغها بالرمي، لعب الرزمة في دوره التالي. عندما تنفد كومة السحب تصبح الرزمة المتبقية كومة السحب.
الإنهاء: عندما يكون الفريق قد أخذ رزمته ولديه تشكيلة نظيفة من 7 أوراق أو أكثر (دون بديل)، يمكن للاعب من ذلك الفريق إفراغ يده لإنهاء التوزيعة. قبل ذلك لا يجوز للفريق إفراغ يده، فعليه الاحتفاظ بأوراق للرمي. وتنتهي التوزيعة أيضًا عندما يجب على لاعب السحب وتكون كومة السحب والرزم فارغة.
حساب التوزيعة: يجمع كل فريق قيم أوراقه الموضوعة، و200 لكل كناستا نظيفة من 7+، و100 لكل كناستا مختلطة (7+ مع بديل)، و100 للإنهاء؛ ويطرح الأوراق الباقية في يدي الشريكين، و100 إن لم يأخذ رزمته قط.
تنتهي المباراة عندما يصل فريق إلى 2000 نقطة أو بعد 3 توزيعات؛ يفوز المجموع الأعلى ويُتقاسم التعادل. الجائزة للاعبين البشر في الفريق الفائز، أو تُقسم بين كل البشر إن لم يكن في ذلك الفريق إلا حواسيب. لا يمكن لأحد الانضمام أو المغادرة أثناء المباراة.""",
    ui="طاولة ورق خضراء. في الأعلى رقم التوزيعة ونقاط الفريقين (فريقك بإطار ذهبي) وعدد أوراق كل لاعب، مع بيان الفرق التي أخذت رزمتها. تحتها تشكيلات الفريقين، وتُوسم الكناستات النظيفة والمختلطة (7+ أوراق). في الوسط كومة السحب مع الرزم المتبقية وكومة الرمي كاملة مع تكبير ورقتها العليا. يدك في الأسفل. في دورك المس كومة السحب أو كومة الرمي لتسحب. ثم المس أوراقًا لتحديدها: تشكيلة جديدة تضع الأوراق المحددة جانبًا كتشكيلة جديدة، ولمس إحدى تشكيلات فريقك يضيفها إليها، وضع يرسل كل ما وُضع جانبًا، ومسح يبدأ من جديد. لإنهاء دورك حدّد ورقة واحدة والمس ارمِ. تخبرك التلميحات تحت الحالة بالحد الأدنى لافتتاح فريقك أو إن كان يستطيع الإنهاء. تعمل على الهواتف والأجهزة اللوحية والحواسيب المحمولة، بالوضعين العمودي والأفقي.",
    tutorial=[
        "طريقة لعب البوراكو",
        "فريقان من لاعبَين. يتشارك الشريكان التشكيلات والنقاط.",
        "دورك",
        "اسحب الورقة العليا من كومة السحب أو خذ كومة الرمي كلها. ضع تشكيلات إن استطعت، ثم ارمِ ورقة واحدة.",
        "التشكيلات",
        "المتتاليات: 3+ أوراق من النوع نفسه بالترتيب. المجموعات: 3+ شباب أو بنات أو ملوك أو آسات.",
        "الاثنان والجوكر بدائل، بحد أقصى واحد لكل تشكيلة. سبع أوراق تصنع كناستا: نظيفة دون بديل، ومختلطة مع بديل واحد.",
        "الرزمة والإنهاء",
        "أفرغ يدك مرة لتأخذ رزمة فريقك. مع الرزمة وكناستا نظيفة، أفرغها مرة أخرى لإنهاء التوزيعة.",
        "الحساب",
        "الأوراق الموضوعة تُحسب لك، والباقية في اليد تُحسب عليك. كناستا نظيفة 200، مختلطة 100، الإنهاء 100.",
    ],
    client={
        "title": "بوراكو", "meta": "التوزيعة {deal} من {max} · يفوز أول فريق يبلغ {target} نقطة",
        "team_us": "فريقك: {points} نقطة", "team_them": "الخصوم: {points} نقطة", "team_a": "{a} و{b}: {points} نقطة",
        "seat_line": "{name}: {cards} أوراق", "seat_pot": "{name}: {cards} أوراق · أُخذت الرزمة",
        "our_melds": "تشكيلات فريقك", "their_melds": "تشكيلات الخصوم", "melds_of": "تشكيلات {a} و{b}",
        "no_melds": "لا توجد تشكيلات بعد.", "clean": "نظيفة", "dirty": "مختلطة",
        "stock": "كومة السحب: {count}", "pots_left": "الرزم المتبقية: {count}", "discard_pile": "كومة الرمي: {count}",
        "draw_stock": "اسحب من الكومة", "take_pile": "خذ كومة الرمي",
        "your_draw": "دورك: اسحب من الكومة أو خذ كومة الرمي كلها.",
        "your_play": "ضع تشكيلات إن شئت، ثم ارمِ ورقة واحدة.",
        "opening": "يجب أن تبلغ أول تشكيلات فريقك {points} نقطة على الأقل دفعة واحدة.",
        "go_out_ready": "يستطيع فريقك الإنهاء.",
        "go_out_not_yet": "لا يستطيع فريقك الإنهاء بعد: يحتاج إلى رزمته وتشكيلة نظيفة من سبع أوراق.",
        "waiting": "بانتظار {name}.", "watching": "أنت تشاهد هذه المباراة.",
        "new_meld": "تشكيلة جديدة", "lay_down": "ضع", "clear": "مسح", "discard": "ارمِ",
        "select_hint": "المس الأوراق لتحديدها. المس تشكيلة لفريقك لتضيف إليها الأوراق المحددة.",
        "staged_label": "للوضع:", "pair": "{a} و{b}",
        "deal_result": "التوزيعة {deal}: سجّل {a} {pa}، وسجّل {b} {pb}.",
        "deal_out": "أنهى فريق {name}.", "deal_no_out": "نفدت كومة السحب.",
        "you_win": "فاز فريقك بالمباراة!", "they_win": "فاز الخصوم بالمباراة.",
        "team_wins": "فاز {a} و{b} بالمباراة.", "tie": "انتهت المباراة بالتعادل.",
        "joker": "جوكر", "card_label": "{rank} {suit}",
        "suit_c": "سباتي", "suit_d": "ديناري", "suit_h": "كبة", "suit_s": "بستوني",
        "server_the_game_is_over": "انتهت اللعبة",
        "server_it_is_not_your_turn": "ليس دورك",
        "server_you_have_already_drawn_this_turn": "لقد سحبت بالفعل في هذا الدور",
        "server_the_stock_is_empty": "كومة السحب فارغة",
        "server_the_discard_pile_is_empty": "كومة الرمي فارغة",
        "server_draw_a_card_first": "اسحب ورقة أولًا",
        "server_you_do_not_have_that_card": "ليست لديك تلك الورقة",
        "server_your_team_cannot_go_out_yet": "لا يستطيع فريقك الإنهاء بعد",
        "server_that_meld_does_not_exist": "هذه التشكيلة غير موجودة",
        "server_you_do_not_have_those_cards": "ليست لديك تلك الأوراق",
        "server_those_cards_do_not_fit_that_meld": "هذه الأوراق لا تناسب تلك التشكيلة",
        "server_that_is_not_a_valid_meld": "هذه ليست تشكيلة صحيحة",
        "server_your_opening_melds_are_worth_less_than_the_minimum": "تشكيلات افتتاحك أقل من الحد الأدنى",
        "server_keep_two_cards_your_team_cannot_go_out_yet": "احتفظ بورقتين: لا يستطيع فريقك الإنهاء بعد",
        "server_send_a_draw_a_discard_or_melds_to_lay": "أرسل سحبًا أو رميًا أو تشكيلات لوضعها",
    },
)
