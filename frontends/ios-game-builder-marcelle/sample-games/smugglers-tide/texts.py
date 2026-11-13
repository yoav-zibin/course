"""Smugglers' Tide texts in English and their translations into the 7 other platform languages."""

NAME = "Smugglers' Tide"

DESCRIPTION = (
    "Lead six smugglers from a sea cave through a tunnel of symbols to the waiting boat: "
    "play cards to leap forward, step back to draw more, and be the first to get everyone aboard."
)

RULES = """Smugglers' Tide is for 2 to 5 players. Each player has 6 smugglers of their color; all start in the sea cave. The tunnel between the cave and the boat has 36 squares: 6 sections, each with the same 6 symbols (anchor, compass, lantern, shell, star, wave) in its own random order.
The deck has 102 cards, 17 of each symbol. Each player gets 6 cards; the rest is a face-down draw pile. Cards in hand are secret; everyone sees how many each player holds.
Players take turns in seat order, starting with the first seat. A turn is 1, 2 or 3 moves, chosen from:
Forward: play a card and move one of your smugglers to the next square ahead with that symbol that has no smuggler on it. If there is none, the smuggler goes into the boat. The card is discarded.
Back: move one of your smugglers back to the closest square behind it that holds 1 or 2 smugglers (of any color), and draw that many cards. A smuggler can never move back into the cave or onto an empty or full (3 smugglers) square; if there is no such square, it cannot move back.
After at least one move you may end your turn early. If you cannot make any move at all (no cards and no smuggler that can move back), you pass and draw 1 card. When the draw pile runs out, the discards are shuffled into a new draw pile.
The first player to get all 6 smugglers into the boat wins at once. The pot goes to the winner; if a computer wins, it is shared by the human players. Nobody can join or leave during a match."""

UI = (
    "The tunnel is a grid of 36 sand-colored squares that winds row by row from the sea cave at the top to "
    "the boat at the bottom; each square shows its symbol and colored dots for the smugglers on it. Chips at "
    "the top show every player's color, how many smugglers are in the boat and how many cards they hold; the "
    "player to move is outlined in gold. On your turn, your rearmost smuggler that can move is already "
    "selected (gold outline); tap another of your smugglers (blue outline) to switch, then tap a card in your hand "
    "to move it forward, or the blue button to move it back and draw. "
    "Squares the smuggler can reach are outlined in gold and the last moves are marked in pink. The yellow "
    "button ends your turn after at least one move. Works on phones, tablets and laptops, in portrait and landscape."
)

TUTORIAL_TEXT = (
    "Play a card to move a smuggler to the next free square with that symbol; move back onto a square with "
    "1 or 2 smugglers to draw cards. Up to 3 moves per turn; first to get all 6 smugglers into the boat wins."
)

TUTORIAL = [
    ("h1", "How to play Smugglers' Tide"),
    ("p", "Get all six of your smugglers from the sea cave, through the tunnel, into the boat."),
    ("h2", "Moving forward"),
    ("p", "Play a card: your smuggler jumps to the next square ahead with that symbol and nobody on it."),
    ("p", "If there is no such square, the smuggler goes straight into the boat."),
    ("h2", "Moving back"),
    ("p", "Move a smuggler back to the closest square behind it with 1 or 2 smugglers, and draw 1 or 2 cards."),
    ("h2", "Your turn"),
    ("p", "Make 1 to 3 moves. If you cannot move at all, you pass and draw 1 card."),
    ("p", "The first player with all six smugglers in the boat wins."),
]

T = {}

T["es"] = dict(
    name="Marea de Contrabandistas",
    description="Lleva a seis contrabandistas desde una cueva marina por un túnel de símbolos hasta el bote: juega cartas para avanzar, retrocede para robar más y sé el primero en subir a todos a bordo.",
    rules="""Marea de Contrabandistas es para 2 a 5 jugadores. Cada jugador tiene 6 contrabandistas de su color; todos empiezan en la cueva marina. El túnel entre la cueva y el bote tiene 36 casillas: 6 secciones, cada una con los mismos 6 símbolos (ancla, brújula, farol, concha, estrella, ola) en su propio orden aleatorio.
El mazo tiene 102 cartas, 17 de cada símbolo. Cada jugador recibe 6 cartas; el resto forma un mazo de robo boca abajo. Las cartas en la mano son secretas; todos ven cuántas tiene cada jugador.
Los jugadores juegan por turnos en orden de asiento, empezando por el primer asiento. Un turno consta de 1, 2 o 3 movimientos, a elegir entre:
Avanzar: juega una carta y mueve uno de tus contrabandistas a la siguiente casilla hacia delante con ese símbolo que no tenga ningún contrabandista. Si no hay ninguna, el contrabandista sube al bote. La carta se descarta.
Retroceder: mueve uno de tus contrabandistas a la casilla más cercana detrás de él que tenga 1 o 2 contrabandistas (de cualquier color) y roba esa cantidad de cartas. Un contrabandista nunca puede volver a la cueva ni a una casilla vacía o llena (3 contrabandistas); si no hay tal casilla, no puede retroceder.
Tras al menos un movimiento puedes terminar tu turno antes. Si no puedes hacer ningún movimiento (sin cartas y sin contrabandistas que puedan retroceder), pasas y robas 1 carta. Cuando se acaba el mazo de robo, los descartes se barajan para formar uno nuevo.
El primer jugador que sube a sus 6 contrabandistas al bote gana en el acto. El bote de premios es para el ganador; si gana una computadora, se reparte entre los jugadores humanos. Nadie puede unirse ni salir durante una partida.""",
    ui="El túnel es una cuadrícula de 36 casillas color arena que serpentea fila a fila desde la cueva marina, arriba, hasta el bote, abajo; cada casilla muestra su símbolo y puntos de color por los contrabandistas que hay en ella. Las fichas de arriba muestran el color de cada jugador, cuántos contrabandistas tiene en el bote y cuántas cartas tiene; el jugador al que le toca está rodeado en dorado. En tu turno ya está seleccionado tu contrabandista más atrasado que puede moverse (borde dorado); toca otro de tus contrabandistas (borde azul) para cambiar y luego toca una carta de tu mano para avanzarlo, o el botón azul para retrocederlo y robar. Las casillas a las que puede llegar tienen borde dorado y los últimos movimientos se marcan en rosa. El botón amarillo termina tu turno tras al menos un movimiento. Funciona en teléfonos, tabletas y portátiles, en vertical y en horizontal.",
    tutorial=[
        "Cómo jugar a Marea de Contrabandistas",
        "Lleva a tus seis contrabandistas desde la cueva marina, por el túnel, hasta el bote.",
        "Avanzar",
        "Juega una carta: tu contrabandista salta a la siguiente casilla con ese símbolo en la que no haya nadie.",
        "Si no existe esa casilla, el contrabandista sube directamente al bote.",
        "Retroceder",
        "Mueve un contrabandista hacia atrás a la casilla más cercana con 1 o 2 contrabandistas y roba 1 o 2 cartas.",
        "Tu turno",
        "Haz de 1 a 3 movimientos. Si no puedes moverte, pasas y robas 1 carta.",
        "Gana el primer jugador con sus seis contrabandistas en el bote.",
    ],
    client={
        "title": "Marea de Contrabandistas", "cave": "Cueva marina", "boat": "Bote",
        "sym_A": "ancla", "sym_C": "brújula", "sym_L": "farol", "sym_S": "concha", "sym_T": "estrella", "sym_W": "ola",
        "player_line": "{name}: {boat} de 6 en el bote, {cards} cartas",
        "deck": "Mazo de robo: {count}",
        "your_hand": "Tus cartas",
        "pick_smuggler": "Tu turno: juega una carta para mover el contrabandista seleccionado, o toca antes otro contrabandista.",
        "pick_more": "Movimientos restantes en este turno: {left}. Haz otro movimiento o termina tu turno.",
        "no_move": "No te quedan movimientos: termina tu turno.",
        "no_move_pass": "No puedes moverte: pasa y roba 1 carta.",
        "back_1": "Retroceder y robar 1 carta",
        "back_2": "Retroceder y robar 2 cartas",
        "end_turn": "Terminar turno",
        "pass_draw": "Pasar y robar 1 carta",
        "waiting_for": "Esperando a {name}.",
        "you_win": "¡Ganas: tus seis contrabandistas llegaron al bote!",
        "player_wins": "¡{name} gana: sus seis contrabandistas llegaron al bote!",
        "watching": "Estás viendo esta partida.",
        "card_label": "Carta de {symbol}",
        "square_label": "Casilla {number}, {symbol}, contrabandistas aquí: {count}",
        "server_the_game_is_over": "la partida ha terminado",
        "server_make_at_least_one_move_before_ending_your_turn": "haz al menos un movimiento antes de terminar tu turno",
        "server_you_have_used_all_three_moves": "ya has usado los tres movimientos",
        "server_you_have_no_smuggler_there": "no tienes ningún contrabandista ahí",
        "server_you_do_not_have_that_card": "no tienes esa carta",
        "server_there_is_no_square_to_move_back_to": "no hay ninguna casilla a la que retroceder",
        "server_send_a_forward_move_a_back_move_or_end_your_turn": "envía un avance, un retroceso o termina tu turno",
        "server_it_is_not_your_turn": "no es tu turno",
    },
)

T["fr"] = dict(
    name="La Marée des Contrebandiers",
    description="Menez six contrebandiers d'une grotte marine à travers un tunnel de symboles jusqu'à la barque : jouez des cartes pour avancer, reculez pour en piocher et soyez le premier à faire monter tout le monde à bord.",
    rules="""La Marée des Contrebandiers se joue de 2 à 5 joueurs. Chaque joueur a 6 contrebandiers de sa couleur ; tous commencent dans la grotte marine. Le tunnel entre la grotte et la barque compte 36 cases : 6 sections, chacune avec les mêmes 6 symboles (ancre, boussole, lanterne, coquillage, étoile, vague) dans son propre ordre aléatoire.
Le paquet compte 102 cartes, 17 de chaque symbole. Chaque joueur reçoit 6 cartes ; le reste forme une pioche face cachée. Les cartes en main sont secrètes ; tout le monde voit combien chaque joueur en a.
Les joueurs jouent à tour de rôle dans l'ordre des places, en commençant par la première place. Un tour comprend 1, 2 ou 3 actions, au choix :
Avancer : jouez une carte et déplacez un de vos contrebandiers jusqu'à la prochaine case devant lui portant ce symbole et sans aucun contrebandier. S'il n'y en a pas, le contrebandier monte dans la barque. La carte est défaussée.
Reculer : ramenez un de vos contrebandiers sur la case la plus proche derrière lui qui contient 1 ou 2 contrebandiers (de n'importe quelle couleur), et piochez autant de cartes. Un contrebandier ne peut jamais retourner dans la grotte ni sur une case vide ou pleine (3 contrebandiers) ; s'il n'existe pas de telle case, il ne peut pas reculer.
Après au moins une action, vous pouvez finir votre tour plus tôt. Si vous ne pouvez faire aucune action (pas de cartes et aucun contrebandier capable de reculer), vous passez et piochez 1 carte. Quand la pioche est vide, la défausse est mélangée pour former une nouvelle pioche.
Le premier joueur qui fait monter ses 6 contrebandiers dans la barque gagne aussitôt. La cagnotte revient au gagnant ; si un ordinateur gagne, elle est partagée entre les joueurs humains. Personne ne peut rejoindre ni quitter une partie en cours.""",
    ui="Le tunnel est une grille de 36 cases couleur sable qui serpente rangée par rangée depuis la grotte marine, en haut, jusqu'à la barque, en bas ; chaque case montre son symbole et des points de couleur pour les contrebandiers qui s'y trouvent. Les pastilles du haut montrent la couleur de chaque joueur, le nombre de ses contrebandiers dans la barque et le nombre de ses cartes ; le joueur dont c'est le tour est entouré d'or. À votre tour, votre contrebandier le plus en arrière pouvant bouger est déjà sélectionné (bord doré) ; touchez un autre de vos contrebandiers (bord bleu) pour changer, puis une carte de votre main pour le faire avancer, ou le bouton bleu pour le faire reculer et piocher. Les cases qu'il peut atteindre sont bordées d'or et les dernières actions sont marquées en rose. Le bouton jaune termine votre tour après au moins une action. Fonctionne sur téléphone, tablette et ordinateur portable, en portrait et en paysage.",
    tutorial=[
        "Comment jouer à La Marée des Contrebandiers",
        "Faites passer vos six contrebandiers de la grotte marine, par le tunnel, jusqu'à la barque.",
        "Avancer",
        "Jouez une carte : votre contrebandier saute jusqu'à la prochaine case portant ce symbole où il n'y a personne.",
        "S'il n'y a pas de telle case, le contrebandier monte directement dans la barque.",
        "Reculer",
        "Ramenez un contrebandier sur la case la plus proche derrière lui avec 1 ou 2 contrebandiers, et piochez 1 ou 2 cartes.",
        "Votre tour",
        "Faites 1 à 3 actions. Si vous ne pouvez pas bouger du tout, vous passez et piochez 1 carte.",
        "Le premier joueur avec ses six contrebandiers dans la barque gagne.",
    ],
    client={
        "title": "La Marée des Contrebandiers", "cave": "Grotte marine", "boat": "Barque",
        "sym_A": "ancre", "sym_C": "boussole", "sym_L": "lanterne", "sym_S": "coquillage", "sym_T": "étoile", "sym_W": "vague",
        "player_line": "{name} : {boat} sur 6 dans la barque, {cards} cartes",
        "deck": "Pioche : {count}",
        "your_hand": "Vos cartes",
        "pick_smuggler": "À vous : jouez une carte pour déplacer le contrebandier sélectionné, ou touchez d'abord un autre contrebandier.",
        "pick_more": "Actions restantes ce tour : {left}. Faites une autre action ou finissez votre tour.",
        "no_move": "Vous n'avez plus d'action possible : finissez votre tour.",
        "no_move_pass": "Vous ne pouvez pas bouger : passez et piochez 1 carte.",
        "back_1": "Reculer et piocher 1 carte",
        "back_2": "Reculer et piocher 2 cartes",
        "end_turn": "Finir le tour",
        "pass_draw": "Passer et piocher 1 carte",
        "waiting_for": "En attente de {name}.",
        "you_win": "Vous gagnez : vos six contrebandiers sont dans la barque !",
        "player_wins": "{name} gagne : ses six contrebandiers sont dans la barque !",
        "watching": "Vous regardez cette partie.",
        "card_label": "Carte {symbol}",
        "square_label": "Case {number}, {symbol}, contrebandiers ici : {count}",
        "server_the_game_is_over": "la partie est terminée",
        "server_make_at_least_one_move_before_ending_your_turn": "faites au moins une action avant de finir votre tour",
        "server_you_have_used_all_three_moves": "vous avez déjà utilisé vos trois actions",
        "server_you_have_no_smuggler_there": "vous n'avez pas de contrebandier ici",
        "server_you_do_not_have_that_card": "vous n'avez pas cette carte",
        "server_there_is_no_square_to_move_back_to": "il n'y a aucune case où reculer",
        "server_send_a_forward_move_a_back_move_or_end_your_turn": "envoyez une avancée, un recul ou finissez votre tour",
        "server_it_is_not_your_turn": "ce n'est pas votre tour",
    },
)

T["de"] = dict(
    name="Schmugglerflut",
    description="Führe sechs Schmuggler aus einer Meereshöhle durch einen Tunnel voller Symbole zum wartenden Boot: Spiele Karten, um vorzuspringen, gehe zurück, um neue zu ziehen, und bring als Erster alle an Bord.",
    rules="""Schmugglerflut ist für 2 bis 5 Spieler. Jeder Spieler hat 6 Schmuggler seiner Farbe; alle beginnen in der Meereshöhle. Der Tunnel zwischen Höhle und Boot hat 36 Felder: 6 Abschnitte mit jeweils denselben 6 Symbolen (Anker, Kompass, Laterne, Muschel, Stern, Welle) in eigener zufälliger Reihenfolge.
Das Deck hat 102 Karten, 17 von jedem Symbol. Jeder Spieler erhält 6 Karten; der Rest bildet einen verdeckten Nachziehstapel. Handkarten sind geheim; alle sehen, wie viele jeder Spieler hat.
Die Spieler sind reihum in Sitzreihenfolge dran, beginnend mit dem ersten Platz. Ein Zug besteht aus 1, 2 oder 3 Aktionen, jeweils eine davon:
Vorwärts: Spiele eine Karte und ziehe einen deiner Schmuggler auf das nächste Feld vor ihm mit diesem Symbol, auf dem kein Schmuggler steht. Gibt es keins, geht der Schmuggler ins Boot. Die Karte wird abgelegt.
Zurück: Ziehe einen deiner Schmuggler zurück auf das nächste Feld hinter ihm, auf dem 1 oder 2 Schmuggler (beliebiger Farbe) stehen, und ziehe so viele Karten. Ein Schmuggler darf nie zurück in die Höhle oder auf ein leeres oder volles Feld (3 Schmuggler); gibt es kein solches Feld, kann er nicht zurück.
Nach mindestens einer Aktion darfst du deinen Zug vorzeitig beenden. Kannst du gar keine Aktion machen (keine Karten und kein Schmuggler kann zurück), passt du und ziehst 1 Karte. Ist der Nachziehstapel leer, wird der Ablagestapel zu einem neuen gemischt.
Wer zuerst alle 6 Schmuggler im Boot hat, gewinnt sofort. Der Pot geht an den Gewinner; gewinnt ein Computer, wird er unter den menschlichen Spielern geteilt. Während einer Partie kann niemand beitreten oder aussteigen.""",
    ui="Der Tunnel ist ein Raster aus 36 sandfarbenen Feldern, das sich Reihe für Reihe von der Meereshöhle oben bis zum Boot unten schlängelt; jedes Feld zeigt sein Symbol und farbige Punkte für die Schmuggler darauf. Die Chips oben zeigen die Farbe jedes Spielers, wie viele Schmuggler im Boot sind und wie viele Karten er hält; der Spieler am Zug ist golden umrandet. In deinem Zug ist dein hinterster beweglicher Schmuggler schon gewählt (goldener Rand); tippe auf einen anderen deiner Schmuggler (blauer Rand), um zu wechseln, und dann auf eine Handkarte, um ihn vorwärts zu ziehen, oder auf die blaue Taste, um ihn zurückzuziehen und Karten zu ziehen. Erreichbare Felder sind golden umrandet, die letzten Aktionen rosa markiert. Die gelbe Taste beendet deinen Zug nach mindestens einer Aktion. Funktioniert auf Handys, Tablets und Laptops, im Hoch- und Querformat.",
    tutorial=[
        "So spielst du Schmugglerflut",
        "Bring alle sechs Schmuggler aus der Meereshöhle durch den Tunnel ins Boot.",
        "Vorwärts",
        "Spiele eine Karte: Dein Schmuggler springt auf das nächste Feld mit diesem Symbol, auf dem niemand steht.",
        "Gibt es kein solches Feld, geht der Schmuggler direkt ins Boot.",
        "Zurück",
        "Ziehe einen Schmuggler zurück auf das nächste Feld hinter ihm mit 1 oder 2 Schmugglern und ziehe 1 oder 2 Karten.",
        "Dein Zug",
        "Mach 1 bis 3 Aktionen. Kannst du dich gar nicht bewegen, passt du und ziehst 1 Karte.",
        "Wer zuerst alle sechs Schmuggler im Boot hat, gewinnt.",
    ],
    client={
        "title": "Schmugglerflut", "cave": "Meereshöhle", "boat": "Boot",
        "sym_A": "Anker", "sym_C": "Kompass", "sym_L": "Laterne", "sym_S": "Muschel", "sym_T": "Stern", "sym_W": "Welle",
        "player_line": "{name}: {boat} von 6 im Boot, {cards} Karten",
        "deck": "Nachziehstapel: {count}",
        "your_hand": "Deine Karten",
        "pick_smuggler": "Du bist dran: Spiele eine Karte, um den gewählten Schmuggler zu bewegen, oder tippe zuerst auf einen anderen.",
        "pick_more": "Verbleibende Aktionen in diesem Zug: {left}. Mach eine weitere Aktion oder beende deinen Zug.",
        "no_move": "Du hast keine Aktion mehr: Beende deinen Zug.",
        "no_move_pass": "Du kannst dich nicht bewegen: Passe und ziehe 1 Karte.",
        "back_1": "Zurück und 1 Karte ziehen",
        "back_2": "Zurück und 2 Karten ziehen",
        "end_turn": "Zug beenden",
        "pass_draw": "Passen und 1 Karte ziehen",
        "waiting_for": "Warte auf {name}.",
        "you_win": "Du gewinnst: Alle sechs Schmuggler sind im Boot!",
        "player_wins": "{name} gewinnt: Alle sechs Schmuggler sind im Boot!",
        "watching": "Du schaust dieser Partie zu.",
        "card_label": "Karte {symbol}",
        "square_label": "Feld {number}, {symbol}, Schmuggler hier: {count}",
        "server_the_game_is_over": "die Partie ist vorbei",
        "server_make_at_least_one_move_before_ending_your_turn": "mach mindestens eine Aktion, bevor du deinen Zug beendest",
        "server_you_have_used_all_three_moves": "du hast alle drei Aktionen verbraucht",
        "server_you_have_no_smuggler_there": "du hast dort keinen Schmuggler",
        "server_you_do_not_have_that_card": "du hast diese Karte nicht",
        "server_there_is_no_square_to_move_back_to": "es gibt kein Feld zum Zurückziehen",
        "server_send_a_forward_move_a_back_move_or_end_your_turn": "sende einen Vorwärtszug, einen Rückzug oder beende deinen Zug",
        "server_it_is_not_your_turn": "du bist nicht am Zug",
    },
)

T["pt"] = dict(
    name="Maré dos Contrabandistas",
    description="Leve seis contrabandistas de uma gruta marinha por um túnel de símbolos até o barco: jogue cartas para avançar, recue para comprar mais e seja o primeiro a pôr todos a bordo.",
    rules="""Maré dos Contrabandistas é para 2 a 5 jogadores. Cada jogador tem 6 contrabandistas da sua cor; todos começam na gruta marinha. O túnel entre a gruta e o barco tem 36 casas: 6 seções, cada uma com os mesmos 6 símbolos (âncora, bússola, lanterna, concha, estrela, onda) na sua própria ordem aleatória.
O baralho tem 102 cartas, 17 de cada símbolo. Cada jogador recebe 6 cartas; o resto forma um monte de compra virado para baixo. As cartas na mão são secretas; todos veem quantas cada jogador tem.
Os jogadores jogam por turnos na ordem dos lugares, começando pelo primeiro lugar. Um turno tem 1, 2 ou 3 jogadas, à escolha entre:
Avançar: jogue uma carta e mova um dos seus contrabandistas para a próxima casa à frente com esse símbolo que não tenha nenhum contrabandista. Se não houver nenhuma, o contrabandista entra no barco. A carta é descartada.
Recuar: mova um dos seus contrabandistas para a casa mais próxima atrás dele que tenha 1 ou 2 contrabandistas (de qualquer cor) e compre esse número de cartas. Um contrabandista nunca pode voltar à gruta nem ir para uma casa vazia ou cheia (3 contrabandistas); se não houver tal casa, ele não pode recuar.
Depois de pelo menos uma jogada, você pode terminar o turno antes. Se não puder fazer nenhuma jogada (sem cartas e sem contrabandista que possa recuar), você passa e compra 1 carta. Quando o monte de compra acaba, os descartes são embaralhados para formar um novo.
O primeiro jogador a pôr os 6 contrabandistas no barco vence na hora. O prêmio vai para o vencedor; se um computador vencer, ele é dividido entre os jogadores humanos. Ninguém pode entrar nem sair durante uma partida.""",
    ui="O túnel é uma grade de 36 casas cor de areia que serpenteia fileira por fileira desde a gruta marinha, em cima, até o barco, embaixo; cada casa mostra seu símbolo e pontos coloridos para os contrabandistas nela. As fichas no topo mostram a cor de cada jogador, quantos contrabandistas estão no barco e quantas cartas ele tem; o jogador da vez tem contorno dourado. Na sua vez, seu contrabandista mais atrasado que pode se mover já vem selecionado (contorno dourado); toque em outro dos seus contrabandistas (contorno azul) para trocar e depois em uma carta da sua mão para avançá-lo, ou no botão azul para recuá-lo e comprar. As casas que ele pode alcançar têm contorno dourado e as últimas jogadas ficam marcadas em rosa. O botão amarelo termina o turno depois de pelo menos uma jogada. Funciona em celulares, tablets e notebooks, na vertical e na horizontal.",
    tutorial=[
        "Como jogar Maré dos Contrabandistas",
        "Leve seus seis contrabandistas da gruta marinha, pelo túnel, até o barco.",
        "Avançar",
        "Jogue uma carta: seu contrabandista salta para a próxima casa com esse símbolo onde não há ninguém.",
        "Se não existir essa casa, o contrabandista entra direto no barco.",
        "Recuar",
        "Mova um contrabandista para trás até a casa mais próxima com 1 ou 2 contrabandistas e compre 1 ou 2 cartas.",
        "Sua vez",
        "Faça de 1 a 3 jogadas. Se não puder se mover, você passa e compra 1 carta.",
        "Vence o primeiro jogador com os seis contrabandistas no barco.",
    ],
    client={
        "title": "Maré dos Contrabandistas", "cave": "Gruta marinha", "boat": "Barco",
        "sym_A": "âncora", "sym_C": "bússola", "sym_L": "lanterna", "sym_S": "concha", "sym_T": "estrela", "sym_W": "onda",
        "player_line": "{name}: {boat} de 6 no barco, {cards} cartas",
        "deck": "Monte de compra: {count}",
        "your_hand": "Suas cartas",
        "pick_smuggler": "Sua vez: jogue uma carta para mover o contrabandista selecionado, ou toque antes em outro contrabandista.",
        "pick_more": "Jogadas restantes neste turno: {left}. Faça outra jogada ou termine o turno.",
        "no_move": "Você não tem mais jogadas: termine o turno.",
        "no_move_pass": "Você não pode se mover: passe e compre 1 carta.",
        "back_1": "Recuar e comprar 1 carta",
        "back_2": "Recuar e comprar 2 cartas",
        "end_turn": "Terminar turno",
        "pass_draw": "Passar e comprar 1 carta",
        "waiting_for": "Aguardando {name}.",
        "you_win": "Você venceu: seus seis contrabandistas chegaram ao barco!",
        "player_wins": "{name} venceu: os seis contrabandistas chegaram ao barco!",
        "watching": "Você está assistindo a esta partida.",
        "card_label": "Carta de {symbol}",
        "square_label": "Casa {number}, {symbol}, contrabandistas aqui: {count}",
        "server_the_game_is_over": "a partida terminou",
        "server_make_at_least_one_move_before_ending_your_turn": "faça pelo menos uma jogada antes de terminar o turno",
        "server_you_have_used_all_three_moves": "você já usou as três jogadas",
        "server_you_have_no_smuggler_there": "você não tem contrabandista aí",
        "server_you_do_not_have_that_card": "você não tem essa carta",
        "server_there_is_no_square_to_move_back_to": "não há casa para onde recuar",
        "server_send_a_forward_move_a_back_move_or_end_your_turn": "envie um avanço, um recuo ou termine o turno",
        "server_it_is_not_your_turn": "não é a sua vez",
    },
)

T["zh"] = dict(
    name="走私者之潮",
    description="带领六名走私者从海蚀洞穿过布满符号的隧道，登上等候的小船：出牌向前跃进，后退以抽更多牌，率先让所有人登船。",
    rules="""走私者之潮供 2 至 5 名玩家游玩。每名玩家有 6 名自己颜色的走私者，全部从海蚀洞出发。洞穴与小船之间的隧道有 36 格：分为 6 段，每段都有同样的 6 种符号（锚、罗盘、灯笼、贝壳、星星、海浪），各段顺序随机。
牌堆共 102 张牌，每种符号 17 张。每名玩家拿 6 张牌，其余背面朝上作为抽牌堆。手牌保密；所有人都能看到每名玩家的手牌数量。
玩家按座位顺序轮流行动，从第一个座位开始。每回合进行 1、2 或 3 次行动，每次从以下两种中选择：
前进：打出一张牌，把你的一名走私者移到前方下一个有该符号且没有任何走私者的格子。如果没有这样的格子，走私者就登上小船。打出的牌进入弃牌堆。
后退：把你的一名走私者移回身后最近的、有 1 或 2 名走私者（任何颜色）的格子，并抽取相同数量的牌。走私者不能退回洞穴，也不能退到空格或满格（3 名走私者）；如果没有这样的格子，就不能后退。
至少行动一次后，你可以提前结束回合。如果你完全无法行动（没有手牌，也没有能后退的走私者），你就跳过并抽 1 张牌。抽牌堆用完时，把弃牌堆洗混成新的抽牌堆。
最先让 6 名走私者全部登船的玩家立即获胜。奖池归获胜者；如果电脑获胜，奖池由人类玩家平分。对局中任何人都不能加入或离开。""",
    ui="隧道是由 36 个沙色格子组成的网格，从上方的海蚀洞逐行蜿蜒到下方的小船；每格显示其符号，并以彩色圆点表示格上的走私者。顶部的标签显示每名玩家的颜色、已登船的走私者数和手牌数；当前行动的玩家有金色边框。轮到你时，你最靠后且能移动的走私者已被选中（金色边框）；点你的另一名走私者（蓝色边框）可切换，再点一张手牌让它前进，或点蓝色按钮让它后退并抽牌。它能到达的格子有金色边框，最近的行动以粉色标出。至少行动一次后，黄色按钮可结束回合。适用于手机、平板和笔记本电脑，横屏竖屏皆可。",
    tutorial=[
        "走私者之潮玩法",
        "把你的六名走私者从海蚀洞经隧道全部送上小船。",
        "前进",
        "打出一张牌：你的走私者跳到下一个有该符号且无人的格子。",
        "如果没有这样的格子，走私者直接登上小船。",
        "后退",
        "把一名走私者移回身后最近的有 1 或 2 名走私者的格子，并抽 1 或 2 张牌。",
        "你的回合",
        "进行 1 到 3 次行动。如果完全无法移动，你就跳过并抽 1 张牌。",
        "最先让六名走私者全部登船的玩家获胜。",
    ],
    client={
        "title": "走私者之潮", "cave": "海蚀洞", "boat": "小船",
        "sym_A": "锚", "sym_C": "罗盘", "sym_L": "灯笼", "sym_S": "贝壳", "sym_T": "星星", "sym_W": "海浪",
        "player_line": "{name}：{boat}/6 已登船，{cards} 张牌",
        "deck": "抽牌堆：{count}",
        "your_hand": "你的手牌",
        "pick_smuggler": "轮到你：打出一张牌移动选中的走私者，或先点另一名走私者。",
        "pick_more": "本回合剩余行动：{left}。再行动一次或结束回合。",
        "no_move": "你已无法行动：请结束回合。",
        "no_move_pass": "你无法移动：跳过并抽 1 张牌。",
        "back_1": "后退并抽 1 张牌",
        "back_2": "后退并抽 2 张牌",
        "end_turn": "结束回合",
        "pass_draw": "跳过并抽 1 张牌",
        "waiting_for": "等待 {name}。",
        "you_win": "你赢了：六名走私者全部登船！",
        "player_wins": "{name} 获胜：六名走私者全部登船！",
        "watching": "你正在观看这场对局。",
        "card_label": "{symbol}牌",
        "square_label": "第 {number} 格，{symbol}，此处走私者：{count}",
        "server_the_game_is_over": "对局已结束",
        "server_make_at_least_one_move_before_ending_your_turn": "结束回合前至少要行动一次",
        "server_you_have_used_all_three_moves": "你已用完三次行动",
        "server_you_have_no_smuggler_there": "你在那里没有走私者",
        "server_you_do_not_have_that_card": "你没有那张牌",
        "server_there_is_no_square_to_move_back_to": "没有可以后退到的格子",
        "server_send_a_forward_move_a_back_move_or_end_your_turn": "请发送前进、后退或结束回合",
        "server_it_is_not_your_turn": "还没轮到你",
    },
)

T["hi"] = dict(
    name="तस्करों का ज्वार",
    description="छह तस्करों को समुद्री गुफा से प्रतीकों वाली सुरंग से होकर इंतज़ार करती नाव तक ले जाइए: आगे कूदने के लिए पत्ते चलिए, और पत्ते लेने के लिए पीछे हटिए, और सबसे पहले सबको नाव पर चढ़ाइए।",
    rules="""तस्करों का ज्वार 2 से 5 खिलाड़ियों के लिए है। हर खिलाड़ी के पास अपने रंग के 6 तस्कर होते हैं; सभी समुद्री गुफा से शुरू करते हैं। गुफा और नाव के बीच सुरंग में 36 खाने हैं: 6 हिस्से, हर हिस्से में वही 6 प्रतीक (लंगर, कंपास, लालटेन, सीप, तारा, लहर) अपने अलग बेतरतीब क्रम में।
गड्डी में 102 पत्ते हैं, हर प्रतीक के 17। हर खिलाड़ी को 6 पत्ते मिलते हैं; बाकी उल्टी रखी उठाने की गड्डी बनती है। हाथ के पत्ते गुप्त रहते हैं; सब देख सकते हैं कि किसके पास कितने पत्ते हैं।
खिलाड़ी सीट के क्रम में बारी-बारी से खेलते हैं, पहली सीट से शुरू करके। एक बारी में 1, 2 या 3 चालें होती हैं, इनमें से चुनकर:
आगे: एक पत्ता चलिए और अपने एक तस्कर को आगे उस प्रतीक वाले अगले ऐसे खाने पर ले जाइए जिस पर कोई तस्कर न हो। अगर ऐसा कोई खाना न हो, तो तस्कर नाव पर चढ़ जाता है। पत्ता फेंक दिया जाता है।
पीछे: अपने एक तस्कर को पीछे उस सबसे नज़दीकी खाने पर ले जाइए जिस पर 1 या 2 तस्कर (किसी भी रंग के) हों, और उतने पत्ते उठाइए। तस्कर कभी गुफा में या खाली या भरे (3 तस्कर) खाने पर वापस नहीं जा सकता; ऐसा खाना न हो तो वह पीछे नहीं जा सकता।
कम से कम एक चाल के बाद आप अपनी बारी जल्दी खत्म कर सकते हैं। अगर आप कोई भी चाल नहीं चल सकते (पत्ते नहीं और कोई तस्कर पीछे नहीं जा सकता), तो आप पास करते हैं और 1 पत्ता उठाते हैं। उठाने की गड्डी खत्म होने पर फेंके गए पत्ते फेंटकर नई गड्डी बनाई जाती है।
जो खिलाड़ी सबसे पहले अपने सभी 6 तस्कर नाव पर पहुँचा दे, वह तुरंत जीतता है। इनाम विजेता को मिलता है; अगर कंप्यूटर जीते, तो इनाम मानव खिलाड़ियों में बँटता है। मैच के दौरान कोई जुड़ या छोड़ नहीं सकता।""",
    ui="सुरंग 36 रेतीले रंग के खानों की ग्रिड है जो ऊपर समुद्री गुफा से नीचे नाव तक पंक्ति-दर-पंक्ति घूमती है; हर खाने पर उसका प्रतीक और उस पर मौजूद तस्करों के लिए रंगीन बिंदु दिखते हैं। ऊपर के चिप हर खिलाड़ी का रंग, नाव में कितने तस्कर हैं और कितने पत्ते हैं, दिखाते हैं; जिसकी बारी है उसके चारों ओर सुनहरा घेरा होता है। अपनी बारी में आपका सबसे पीछे वाला चल सकने वाला तस्कर पहले से चुना होता है (सुनहरा किनारा); बदलने के लिए अपने किसी दूसरे तस्कर (नीला किनारा) पर टैप कीजिए, फिर उसे आगे ले जाने के लिए हाथ के किसी पत्ते पर, या पीछे जाकर पत्ते उठाने के लिए नीले बटन पर टैप कीजिए। जहाँ वह पहुँच सकता है उन खानों का किनारा सुनहरा होता है और पिछली चालें गुलाबी रंग में दिखती हैं। पीला बटन कम से कम एक चाल के बाद बारी खत्म करता है। फ़ोन, टैबलेट और लैपटॉप पर, खड़े और आड़े दोनों में चलता है।",
    tutorial=[
        "तस्करों का ज्वार कैसे खेलें",
        "अपने छहों तस्करों को समुद्री गुफा से सुरंग होते हुए नाव तक पहुँचाइए।",
        "आगे बढ़ना",
        "एक पत्ता चलिए: आपका तस्कर उस प्रतीक वाले अगले खाली खाने पर कूद जाता है।",
        "अगर ऐसा कोई खाना न हो, तो तस्कर सीधे नाव पर चढ़ जाता है।",
        "पीछे हटना",
        "किसी तस्कर को पीछे 1 या 2 तस्करों वाले सबसे नज़दीकी खाने पर ले जाइए, और 1 या 2 पत्ते उठाइए।",
        "आपकी बारी",
        "1 से 3 चालें चलिए। अगर आप बिल्कुल नहीं चल सकते, तो पास करके 1 पत्ता उठाइए।",
        "जिसके छहों तस्कर सबसे पहले नाव में हों, वह जीतता है।",
    ],
    client={
        "title": "तस्करों का ज्वार", "cave": "समुद्री गुफा", "boat": "नाव",
        "sym_A": "लंगर", "sym_C": "कंपास", "sym_L": "लालटेन", "sym_S": "सीप", "sym_T": "तारा", "sym_W": "लहर",
        "player_line": "{name}: नाव में 6 में से {boat}, {cards} पत्ते",
        "deck": "उठाने की गड्डी: {count}",
        "your_hand": "आपके पत्ते",
        "pick_smuggler": "आपकी बारी: चुने गए तस्कर को चलाने के लिए पत्ता चलिए, या पहले किसी दूसरे तस्कर पर टैप कीजिए।",
        "pick_more": "इस बारी में बची चालें: {left}। एक और चाल चलिए या बारी खत्म कीजिए।",
        "no_move": "आपके पास कोई चाल नहीं बची: बारी खत्म कीजिए।",
        "no_move_pass": "आप चल नहीं सकते: पास करके 1 पत्ता उठाइए।",
        "back_1": "पीछे जाएँ और 1 पत्ता उठाएँ",
        "back_2": "पीछे जाएँ और 2 पत्ते उठाएँ",
        "end_turn": "बारी खत्म करें",
        "pass_draw": "पास करें और 1 पत्ता उठाएँ",
        "waiting_for": "{name} का इंतज़ार।",
        "you_win": "आप जीत गए: छहों तस्कर नाव पर पहुँच गए!",
        "player_wins": "{name} जीत गए: छहों तस्कर नाव पर पहुँच गए!",
        "watching": "आप यह मैच देख रहे हैं।",
        "card_label": "{symbol} पत्ता",
        "square_label": "खाना {number}, {symbol}, यहाँ तस्कर: {count}",
        "server_the_game_is_over": "खेल खत्म हो चुका है",
        "server_make_at_least_one_move_before_ending_your_turn": "बारी खत्म करने से पहले कम से कम एक चाल चलिए",
        "server_you_have_used_all_three_moves": "आप तीनों चालें चल चुके हैं",
        "server_you_have_no_smuggler_there": "वहाँ आपका कोई तस्कर नहीं है",
        "server_you_do_not_have_that_card": "आपके पास वह पत्ता नहीं है",
        "server_there_is_no_square_to_move_back_to": "पीछे जाने के लिए कोई खाना नहीं है",
        "server_send_a_forward_move_a_back_move_or_end_your_turn": "आगे या पीछे की चाल भेजिए, या बारी खत्म कीजिए",
        "server_it_is_not_your_turn": "आपकी बारी नहीं है",
    },
)

T["ar"] = dict(
    name="مدّ المهرّبين",
    description="قُد ستة مهرّبين من كهف بحري عبر نفق من الرموز إلى القارب المنتظر: العب الأوراق لتقفز إلى الأمام، وتراجع لتسحب المزيد، وكن أول من يُصعد الجميع إلى القارب.",
    rules="""مدّ المهرّبين لعبة من 2 إلى 5 لاعبين. لكل لاعب 6 مهرّبين بلونه، ويبدؤون جميعًا في الكهف البحري. في النفق بين الكهف والقارب 36 خانة: 6 أقسام، في كل منها الرموز الستة نفسها (مرساة، بوصلة، فانوس، صدفة، نجمة، موجة) بترتيب عشوائي خاص به.
في المجموعة 102 ورقة، 17 من كل رمز. يحصل كل لاعب على 6 أوراق، والباقي كومة سحب مقلوبة. الأوراق في اليد سرية، والجميع يرى عدد أوراق كل لاعب.
يلعب اللاعبون بالدور حسب ترتيب المقاعد، بدءًا من المقعد الأول. يتكون الدور من حركة أو اثنتين أو ثلاث، يُختار كل منها من:
التقدّم: العب ورقة وحرّك أحد مهرّبيك إلى الخانة التالية أمامه التي تحمل ذلك الرمز ولا يقف عليها أي مهرّب. إن لم توجد، يصعد المهرّب إلى القارب. تُرمى الورقة.
التراجع: أعِد أحد مهرّبيك إلى أقرب خانة خلفه عليها مهرّب أو اثنان (من أي لون)، واسحب العدد نفسه من الأوراق. لا يمكن للمهرّب أبدًا العودة إلى الكهف ولا إلى خانة فارغة أو ممتلئة (3 مهرّبين)؛ وإن لم توجد مثل هذه الخانة فلا يمكنه التراجع.
بعد حركة واحدة على الأقل يمكنك إنهاء دورك مبكرًا. إن لم تستطع القيام بأي حركة (لا أوراق ولا مهرّب يستطيع التراجع)، تتخطّى دورك وتسحب ورقة واحدة. عندما تنفد كومة السحب، تُخلط الأوراق المرمية لتكوين كومة جديدة.
أول لاعب يُصعد مهرّبيه الستة إلى القارب يفوز فورًا. الجائزة للفائز؛ وإن فاز حاسوب تُقسم بين اللاعبين البشر. لا يمكن لأحد الانضمام أو المغادرة أثناء المباراة.""",
    ui="النفق شبكة من 36 خانة بلون الرمل تتعرّج صفًا بعد صف من الكهف البحري في الأعلى إلى القارب في الأسفل؛ تُظهر كل خانة رمزها ونقاطًا ملونة للمهرّبين الذين عليها. تُظهر الشارات في الأعلى لون كل لاعب وعدد مهرّبيه في القارب وعدد أوراقه، ويُحاط اللاعب صاحب الدور بإطار ذهبي. في دورك يكون أكثر مهرّبيك تأخرًا ممن يستطيعون الحركة محددًا مسبقًا (إطار ذهبي)؛ المس مهرّبًا آخر من مهرّبيك (إطار أزرق) للتبديل، ثم المس ورقة من يدك لتقدّمه، أو الزر الأزرق لتعيده وتسحب. الخانات التي يمكنه بلوغها لها إطار ذهبي، وتُعلَّم آخر الحركات باللون الوردي. الزر الأصفر ينهي دورك بعد حركة واحدة على الأقل. تعمل على الهواتف والأجهزة اللوحية والحواسيب المحمولة، بالوضعين العمودي والأفقي.",
    tutorial=[
        "طريقة لعب مدّ المهرّبين",
        "أوصل مهرّبيك الستة من الكهف البحري عبر النفق إلى القارب.",
        "التقدّم",
        "العب ورقة: يقفز مهرّبك إلى الخانة التالية التي تحمل ذلك الرمز ولا أحد عليها.",
        "إن لم توجد مثل هذه الخانة، يصعد المهرّب مباشرة إلى القارب.",
        "التراجع",
        "أعِد مهرّبًا إلى أقرب خانة خلفه عليها مهرّب أو اثنان، واسحب ورقة أو ورقتين.",
        "دورك",
        "قم بحركة إلى ثلاث حركات. إن لم تستطع الحركة إطلاقًا، تتخطّى وتسحب ورقة واحدة.",
        "يفوز أول لاعب يصل مهرّبوه الستة إلى القارب.",
    ],
    client={
        "title": "مدّ المهرّبين", "cave": "الكهف البحري", "boat": "القارب",
        "sym_A": "مرساة", "sym_C": "بوصلة", "sym_L": "فانوس", "sym_S": "صدفة", "sym_T": "نجمة", "sym_W": "موجة",
        "player_line": "{name}: {boat} من 6 في القارب، {cards} أوراق",
        "deck": "كومة السحب: {count}",
        "your_hand": "أوراقك",
        "pick_smuggler": "دورك: العب ورقة لتحريك المهرّب المحدد، أو المس مهرّبًا آخر أولًا.",
        "pick_more": "الحركات المتبقية في هذا الدور: {left}. قم بحركة أخرى أو أنهِ دورك.",
        "no_move": "لم تعد لديك أي حركة: أنهِ دورك.",
        "no_move_pass": "لا يمكنك الحركة: تخطَّ واسحب ورقة واحدة.",
        "back_1": "تراجع واسحب ورقة واحدة",
        "back_2": "تراجع واسحب ورقتين",
        "end_turn": "إنهاء الدور",
        "pass_draw": "تخطَّ واسحب ورقة واحدة",
        "waiting_for": "بانتظار {name}.",
        "you_win": "فزت: وصل مهرّبوك الستة إلى القارب!",
        "player_wins": "فاز {name}: وصل مهرّبوه الستة إلى القارب!",
        "watching": "أنت تشاهد هذه المباراة.",
        "card_label": "ورقة {symbol}",
        "square_label": "الخانة {number}، {symbol}، المهرّبون هنا: {count}",
        "server_the_game_is_over": "انتهت اللعبة",
        "server_make_at_least_one_move_before_ending_your_turn": "قم بحركة واحدة على الأقل قبل إنهاء دورك",
        "server_you_have_used_all_three_moves": "لقد استخدمت الحركات الثلاث",
        "server_you_have_no_smuggler_there": "ليس لديك مهرّب هناك",
        "server_you_do_not_have_that_card": "ليست لديك تلك الورقة",
        "server_there_is_no_square_to_move_back_to": "لا توجد خانة للتراجع إليها",
        "server_send_a_forward_move_a_back_move_or_end_your_turn": "أرسل حركة تقدّم أو تراجع أو أنهِ دورك",
        "server_it_is_not_your_turn": "ليس دورك",
    },
)
