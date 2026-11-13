"""Frontier Rails texts in English and their translations into the 7 other platform languages."""

NAME = "Frontier Rails"

DESCRIPTION = (
    "A quick railway race for 2 to 6 players: everyone shares the same track, but only you know "
    "which five cities you must reach. Connect them all first and make your rivals pay."
)

RULES = """Frontier Rails is for 2 to 6 players. The map is a grid of junctions joined by lines; some lines cross mountains or rivers. 35 cities lie on junctions, 7 in each of 5 colored regions (yellow, red, orange, blue, green). With 2 or 3 players, the 2 far cities of each region (dashed outline) are not used.
Everyone starts with 13 points. The game is played in rounds. At the start of a round each player is dealt one secret city of each color. Then, beginning with the round's first player and going around in seat order, each player places a start marker on any junction (it may be a city).
Then players take turns, in the same order, building track worth 2 points: a plain line costs 1, a line through mountains or across a river costs 2. Unused points are lost. Each piece of track must join the network connected to your own start marker, which includes track built by any player. You must build at least once per turn; after spending 1 point you may end your turn.
The round ends at once when one player's five cities are all connected to their start marker (by anyone's track), or when all 84 pieces of track have been built. Each player then loses the points it would still cost to connect their missing cities: the nearest missing city is joined first, then the next nearest from there, and so on, and track already built costs nothing.
If no one is at 0 points or below, a new round begins: the map is cleared, the next player in seat order goes first, and new cities are dealt. After the second round, if every player still has 4 or more points, the game instead ends when a player reaches 3 points below the current lowest score.
When the game ends, the player with the most points left wins; tied players share the win. The pot goes to the human winners; if only computers win, it is shared by all human players. Nobody can join or leave during a match."""

UI = (
    "The map shows junctions as small dots, mountains as brown triangles, rivers as blue circles and cities as "
    "colored circles numbered 1 to 7; far cities have a dashed outline and your own cities have a dark ring. "
    "Built track is drawn in each player's color (a light center stripe marks 2-point track) and start markers "
    "are colored squares. Chips at the top show every player's points; the player to move is outlined in gold. "
    "On your turn, tap a junction to place your start marker, then tap the highlighted gold lines next to your "
    "network to build. The side panel shows your cities (a check mark when connected), the points left this "
    "turn, an End turn button, and the last round's result with everyone's cities and lost points. Works on "
    "phones, tablets and laptops, in portrait and landscape."
)

TUTORIAL_TEXT = (
    "Place a start marker, then build 2 points of track per turn (1 on plains, 2 over mountains and rivers) to "
    "connect your 5 secret cities. Anyone can use anyone's track. When a round ends, you lose the points still "
    "needed to reach your cities; the player with the most points at the end wins."
)

TUTORIAL = [
    ("h1", "How to play Frontier Rails"),
    ("p", "Each round you get five secret cities, one of each color. Connect them all to your start marker."),
    ("h2", "Your start marker"),
    ("p", "Place it on any junction. Starting on one of your own cities is often a good idea."),
    ("h2", "Building track"),
    ("p", "Each turn build 2 points of track: plains cost 1, mountains and rivers cost 2."),
    ("p", "Your track must join your network, and any track in the map can be part of it, even a rival's."),
    ("h2", "End of a round"),
    ("p", "When someone connects all five cities, or the track runs out, everyone loses the points still needed."),
    ("p", "Everyone starts with 13 points. When someone reaches 0, the player with the most points wins."),
]

T = {}

T["es"] = dict(
    name="Rieles de la Frontera",
    description="Una carrera ferroviaria rápida para 2 a 6 jugadores: todos comparten las mismas vías, pero solo tú sabes qué cinco ciudades debes alcanzar. Conéctalas antes que nadie y haz pagar a tus rivales.",
    rules="""Rieles de la Frontera es para 2 a 6 jugadores. El mapa es una cuadrícula de cruces unidos por líneas; algunas líneas atraviesan montañas o ríos. Hay 35 ciudades en cruces, 7 en cada una de 5 regiones de colores (amarillo, rojo, naranja, azul, verde). Con 2 o 3 jugadores no se usan las 2 ciudades lejanas de cada región (contorno discontinuo).
Todos empiezan con 13 puntos. Se juega por rondas. Al empezar una ronda, cada jugador recibe una ciudad secreta de cada color. Luego, empezando por el primer jugador de la ronda y siguiendo el orden de los asientos, cada jugador coloca un marcador de salida en cualquier cruce (puede ser una ciudad).
Después los jugadores construyen por turnos, en el mismo orden, vías por valor de 2 puntos: una línea en llano cuesta 1 y una línea por montañas o que cruza un río cuesta 2. Los puntos sin usar se pierden. Cada tramo debe unirse a la red conectada a tu propio marcador de salida, que incluye las vías construidas por cualquier jugador. Debes construir al menos una vez por turno; tras gastar 1 punto puedes terminar el turno.
La ronda termina en el acto cuando las cinco ciudades de un jugador están conectadas a su marcador de salida (con las vías de cualquiera) o cuando se han construido los 84 tramos de vía. Cada jugador pierde entonces los puntos que aún costaría conectar sus ciudades pendientes: primero se une la ciudad pendiente más cercana, luego la siguiente más cercana desde allí, y así sucesivamente; las vías ya construidas no cuestan nada.
Si nadie está en 0 puntos o menos, empieza una nueva ronda: se vacía el mapa, empieza el siguiente jugador en orden de asientos y se reparten ciudades nuevas. Tras la segunda ronda, si todos los jugadores siguen con 4 puntos o más, la partida termina en cambio cuando un jugador llega a 3 puntos por debajo de la puntuación más baja de ese momento.
Al terminar la partida gana el jugador con más puntos restantes; los empatados comparten la victoria. El bote es para los ganadores humanos; si solo ganan computadoras, se reparte entre todos los jugadores humanos. Nadie puede unirse ni salir durante una partida.""",
    ui="El mapa muestra los cruces como puntos pequeños, las montañas como triángulos marrones, los ríos como círculos azules y las ciudades como círculos de colores numerados del 1 al 7; las ciudades lejanas tienen un contorno discontinuo y las tuyas un anillo oscuro. Las vías construidas se dibujan con el color de cada jugador (una franja central clara marca las vías de 2 puntos) y los marcadores de salida son cuadrados de colores. Las fichas de arriba muestran los puntos de cada jugador; el jugador al que le toca tiene borde dorado. En tu turno, toca un cruce para colocar tu marcador de salida y luego toca las líneas doradas resaltadas junto a tu red para construir. El panel lateral muestra tus ciudades (con una marca cuando están conectadas), los puntos que te quedan en el turno, un botón Terminar turno y el resultado de la última ronda con las ciudades y los puntos perdidos de todos. Funciona en teléfonos, tabletas y portátiles, en vertical y en horizontal.",
    tutorial=[
        "Cómo jugar a Rieles de la Frontera",
        "En cada ronda recibes cinco ciudades secretas, una de cada color. Conéctalas todas a tu marcador de salida.",
        "Tu marcador de salida",
        "Colócalo en cualquier cruce. Empezar en una de tus propias ciudades suele ser buena idea.",
        "Construir vías",
        "En cada turno construye 2 puntos de vía: el llano cuesta 1; las montañas y los ríos, 2.",
        "Tus vías deben unirse a tu red, y cualquier vía del mapa puede formar parte de ella, incluso la de un rival.",
        "Fin de una ronda",
        "Cuando alguien conecta sus cinco ciudades o se acaban las vías, todos pierden los puntos que aún necesitaban.",
        "Todos empiezan con 13 puntos. Cuando alguien llega a 0, gana el jugador con más puntos.",
    ],
    client={
        "title": "Rieles de la Frontera",
        "map_label": "Mapa de la frontera con cruces, ciudades, montañas, ríos y vías",
        "meta": "Ronda {round} · vías restantes: {left}",
        "player_chip": "{name}: {score} puntos",
        "region_Y": "Amarilla", "region_R": "Roja", "region_O": "Naranja", "region_B": "Azul", "region_G": "Verde",
        "city_name": "{region} {number}",
        "your_cities": "Tus ciudades en esta ronda:",
        "place_start": "Tu turno: toca cualquier cruce para colocar tu marcador de salida.",
        "build": "Tu turno: construye vías. Puntos restantes: {points}.",
        "build_hint": "Toca una línea resaltada junto a tu red. El llano cuesta 1; las montañas y los ríos, 2.",
        "start_hint": "Tu red crece desde este marcador. Empezar en una de tus ciudades es buena idea.",
        "waiting_start": "{name} está colocando su marcador de salida.",
        "waiting_build": "{name} está construyendo vías.",
        "end_turn": "Terminar turno",
        "watching": "Estás viendo esta partida.",
        "round_result": "Resultado de la ronda {round}",
        "col_player": "Jugador", "col_cities": "Ciudades", "col_lost": "Perdidos", "col_score": "Puntos",
        "game_over_line": "Fin de la partida: un jugador llegó a {mark} puntos o menos.",
        "you_win": "¡Ganas con más puntos restantes!",
        "you_share": "¡Compartes la victoria con más puntos restantes!",
        "player_wins": "{name} gana con más puntos restantes.",
        "players_win": "Ganadores: {names}.",
        "lowered_mark": "Ahora la partida termina en {mark} puntos.",
        "server_the_game_is_over": "la partida ha terminado",
        "server_it_is_not_your_turn": "no es tu turno",
        "server_place_your_start_marker_first": "primero coloca tu marcador de salida",
        "server_that_is_not_a_junction_on_the_map": "eso no es un cruce del mapa",
        "server_start_markers_are_already_placed": "los marcadores de salida ya están colocados",
        "server_build_at_least_one_track_before_ending_your_turn": "construye al menos un tramo antes de terminar tu turno",
        "server_that_track_is_already_built": "ese tramo ya está construido",
        "server_you_do_not_have_enough_points_left_for_that_track": "no te quedan puntos suficientes para ese tramo",
        "server_track_must_join_your_network": "la vía debe unirse a tu red",
        "server_send_a_start_junction_a_track_to_build_or_end_your_turn": "envía un cruce de salida, un tramo para construir o termina tu turno",
    },
)

T["fr"] = dict(
    name="Rails de la Frontière",
    description="Une course ferroviaire rapide pour 2 à 6 joueurs : tout le monde partage les mêmes voies, mais vous seul savez quelles cinq villes atteindre. Reliez-les toutes en premier et faites payer vos rivaux.",
    rules="""Rails de la Frontière se joue de 2 à 6 joueurs. La carte est une grille de jonctions reliées par des lignes ; certaines lignes traversent des montagnes ou des rivières. 35 villes se trouvent sur des jonctions, 7 dans chacune des 5 régions de couleur (jaune, rouge, orange, bleu, vert). À 2 ou 3 joueurs, les 2 villes lointaines de chaque région (contour en pointillés) ne sont pas utilisées.
Chacun commence avec 13 points. La partie se joue en manches. Au début d'une manche, chaque joueur reçoit une ville secrète de chaque couleur. Puis, en commençant par le premier joueur de la manche et dans l'ordre des places, chacun pose un marqueur de départ sur n'importe quelle jonction (ce peut être une ville).
Ensuite, à tour de rôle et dans le même ordre, chaque joueur construit 2 points de voie : une ligne en plaine coûte 1, une ligne en montagne ou qui traverse une rivière coûte 2. Les points non utilisés sont perdus. Chaque tronçon doit rejoindre le réseau relié à votre propre marqueur de départ, qui comprend les voies construites par n'importe quel joueur. Vous devez construire au moins une fois par tour ; après avoir dépensé 1 point, vous pouvez finir votre tour.
La manche s'arrête aussitôt quand les cinq villes d'un joueur sont toutes reliées à son marqueur de départ (par les voies de n'importe qui), ou quand les 84 tronçons ont été construits. Chaque joueur perd alors les points qu'il faudrait encore pour relier ses villes manquantes : on relie d'abord la ville manquante la plus proche, puis la suivante la plus proche à partir de là, et ainsi de suite ; les voies déjà construites ne coûtent rien.
Si personne n'est à 0 point ou moins, une nouvelle manche commence : la carte est vidée, le joueur suivant dans l'ordre des places commence et de nouvelles villes sont distribuées. Après la deuxième manche, si tous les joueurs ont encore 4 points ou plus, la partie s'arrête plutôt quand un joueur atteint 3 points de moins que le score le plus bas du moment.
À la fin de la partie, le joueur qui a le plus de points restants gagne ; les ex æquo partagent la victoire. La cagnotte revient aux gagnants humains ; si seuls des ordinateurs gagnent, elle est partagée entre tous les joueurs humains. Personne ne peut rejoindre ni quitter une partie en cours.""",
    ui="La carte montre les jonctions en petits points, les montagnes en triangles bruns, les rivières en cercles bleus et les villes en cercles de couleur numérotés de 1 à 7 ; les villes lointaines ont un contour en pointillés et les vôtres un anneau foncé. Les voies construites sont dessinées à la couleur de chaque joueur (une bande claire au centre marque les voies à 2 points) et les marqueurs de départ sont des carrés de couleur. Les pastilles du haut montrent les points de chaque joueur ; le joueur dont c'est le tour est entouré d'or. À votre tour, touchez une jonction pour poser votre marqueur de départ, puis touchez les lignes dorées en surbrillance à côté de votre réseau pour construire. Le panneau latéral montre vos villes (cochées une fois reliées), les points restants ce tour, un bouton Finir le tour et le résultat de la dernière manche avec les villes et les points perdus de chacun. Fonctionne sur téléphone, tablette et ordinateur portable, en portrait et en paysage.",
    tutorial=[
        "Comment jouer à Rails de la Frontière",
        "À chaque manche, vous recevez cinq villes secrètes, une de chaque couleur. Reliez-les toutes à votre marqueur de départ.",
        "Votre marqueur de départ",
        "Posez-le sur n'importe quelle jonction. Commencer sur une de vos villes est souvent une bonne idée.",
        "Construire des voies",
        "À chaque tour, construisez 2 points de voie : la plaine coûte 1, les montagnes et les rivières 2.",
        "Vos voies doivent rejoindre votre réseau, et n'importe quelle voie de la carte peut en faire partie, même celle d'un rival.",
        "Fin d'une manche",
        "Quand quelqu'un relie ses cinq villes, ou que les voies sont épuisées, chacun perd les points encore nécessaires.",
        "Chacun commence avec 13 points. Quand quelqu'un atteint 0, le joueur qui a le plus de points gagne.",
    ],
    client={
        "title": "Rails de la Frontière",
        "map_label": "Carte de la frontière avec jonctions, villes, montagnes, rivières et voies",
        "meta": "Manche {round} · voies restantes : {left}",
        "player_chip": "{name} : {score} points",
        "region_Y": "Jaune", "region_R": "Rouge", "region_O": "Orange", "region_B": "Bleue", "region_G": "Verte",
        "city_name": "{region} {number}",
        "your_cities": "Vos villes pour cette manche :",
        "place_start": "À vous : touchez une jonction pour poser votre marqueur de départ.",
        "build": "À vous : construisez des voies. Points restants : {points}.",
        "build_hint": "Touchez une ligne en surbrillance à côté de votre réseau. Plaine 1, montagnes et rivières 2.",
        "start_hint": "Votre réseau part de ce marqueur. Commencer sur une de vos villes est une bonne idée.",
        "waiting_start": "{name} pose son marqueur de départ.",
        "waiting_build": "{name} construit des voies.",
        "end_turn": "Finir le tour",
        "watching": "Vous regardez cette partie.",
        "round_result": "Résultat de la manche {round}",
        "col_player": "Joueur", "col_cities": "Villes", "col_lost": "Perdus", "col_score": "Points",
        "game_over_line": "Fin de partie : un joueur est arrivé à {mark} points ou moins.",
        "you_win": "Vous gagnez avec le plus de points restants !",
        "you_share": "Vous partagez la victoire avec le plus de points restants !",
        "player_wins": "{name} gagne avec le plus de points restants.",
        "players_win": "Gagnants : {names}.",
        "lowered_mark": "La partie s'arrête désormais à {mark} points.",
        "server_the_game_is_over": "la partie est terminée",
        "server_it_is_not_your_turn": "ce n'est pas votre tour",
        "server_place_your_start_marker_first": "posez d'abord votre marqueur de départ",
        "server_that_is_not_a_junction_on_the_map": "ce n'est pas une jonction de la carte",
        "server_start_markers_are_already_placed": "les marqueurs de départ sont déjà posés",
        "server_build_at_least_one_track_before_ending_your_turn": "construisez au moins un tronçon avant de finir votre tour",
        "server_that_track_is_already_built": "ce tronçon est déjà construit",
        "server_you_do_not_have_enough_points_left_for_that_track": "il ne vous reste pas assez de points pour ce tronçon",
        "server_track_must_join_your_network": "la voie doit rejoindre votre réseau",
        "server_send_a_start_junction_a_track_to_build_or_end_your_turn": "envoyez une jonction de départ, un tronçon à construire ou finissez votre tour",
    },
)

T["de"] = dict(
    name="Grenzland-Schienen",
    description="Ein schnelles Eisenbahnrennen für 2 bis 6 Spieler: Alle teilen dieselben Gleise, aber nur du weißt, welche fünf Städte du erreichen musst. Verbinde sie als Erster und lass deine Gegner zahlen.",
    rules="""Grenzland-Schienen ist für 2 bis 6 Spieler. Die Karte ist ein Raster aus Knotenpunkten, die durch Linien verbunden sind; manche Linien führen durch Berge oder über Flüsse. 35 Städte liegen auf Knotenpunkten, je 7 in 5 farbigen Regionen (gelb, rot, orange, blau, grün). Mit 2 oder 3 Spielern werden die 2 fernen Städte jeder Region (gestrichelter Rand) nicht benutzt.
Alle beginnen mit 13 Punkten. Gespielt wird in Runden. Zu Beginn einer Runde erhält jeder Spieler eine geheime Stadt jeder Farbe. Dann setzt jeder, beginnend mit dem ersten Spieler der Runde und in Sitzreihenfolge, einen Startmarker auf einen beliebigen Knotenpunkt (auch eine Stadt).
Danach bauen die Spieler reihum in derselben Reihenfolge Gleise im Wert von 2 Punkten: Eine Linie im Flachland kostet 1, eine Linie durch Berge oder über einen Fluss kostet 2. Ungenutzte Punkte verfallen. Jedes Gleisstück muss an das Netz anschließen, das mit deinem eigenen Startmarker verbunden ist; dazu gehören Gleise aller Spieler. Du musst in jedem Zug mindestens einmal bauen; nach 1 ausgegebenen Punkt darfst du den Zug beenden.
Die Runde endet sofort, wenn die fünf Städte eines Spielers alle mit seinem Startmarker verbunden sind (durch beliebige Gleise) oder wenn alle 84 Gleisstücke gebaut sind. Dann verliert jeder Spieler so viele Punkte, wie das Anschließen seiner fehlenden Städte noch kosten würde: Zuerst wird die nächstgelegene fehlende Stadt angeschlossen, dann von dort die nächstgelegene und so weiter; bereits gebaute Gleise kosten nichts.
Hat niemand 0 Punkte oder weniger, beginnt eine neue Runde: Die Karte wird geleert, der nächste Spieler in Sitzreihenfolge beginnt und neue Städte werden verteilt. Haben nach der zweiten Runde alle Spieler noch 4 oder mehr Punkte, endet das Spiel stattdessen, sobald ein Spieler 3 Punkte unter dem aktuell niedrigsten Stand erreicht.
Bei Spielende gewinnt, wer die meisten Punkte übrig hat; Gleichstand teilt den Sieg. Der Pot geht an die menschlichen Gewinner; gewinnen nur Computer, wird er unter allen menschlichen Spielern geteilt. Während einer Partie kann niemand beitreten oder aussteigen.""",
    ui="Die Karte zeigt Knotenpunkte als kleine Punkte, Berge als braune Dreiecke, Flüsse als blaue Kreise und Städte als farbige Kreise mit den Nummern 1 bis 7; ferne Städte haben einen gestrichelten Rand, deine eigenen einen dunklen Ring. Gebaute Gleise erscheinen in der Farbe des Spielers (ein heller Mittelstreifen kennzeichnet 2-Punkte-Gleise), Startmarker sind farbige Quadrate. Die Chips oben zeigen die Punkte aller Spieler; der Spieler am Zug ist golden umrandet. Tippe in deinem Zug auf einen Knotenpunkt, um deinen Startmarker zu setzen, und dann auf die golden hervorgehobenen Linien an deinem Netz, um zu bauen. Die Seitenleiste zeigt deine Städte (mit Haken, wenn verbunden), die verbleibenden Punkte im Zug, eine Taste Zug beenden und das Ergebnis der letzten Runde mit allen Städten und verlorenen Punkten. Funktioniert auf Handys, Tablets und Laptops, im Hoch- und Querformat.",
    tutorial=[
        "So spielst du Grenzland-Schienen",
        "In jeder Runde bekommst du fünf geheime Städte, eine jeder Farbe. Verbinde sie alle mit deinem Startmarker.",
        "Dein Startmarker",
        "Setze ihn auf einen beliebigen Knotenpunkt. Auf einer deiner eigenen Städte zu beginnen ist oft klug.",
        "Gleise bauen",
        "Baue in jedem Zug Gleise für 2 Punkte: Flachland kostet 1, Berge und Flüsse 2.",
        "Deine Gleise müssen an dein Netz anschließen, und jedes Gleis auf der Karte kann dazugehören, auch das eines Gegners.",
        "Ende einer Runde",
        "Verbindet jemand alle fünf Städte oder gehen die Gleise aus, verlieren alle die noch nötigen Punkte.",
        "Alle beginnen mit 13 Punkten. Erreicht jemand 0, gewinnt der Spieler mit den meisten Punkten.",
    ],
    client={
        "title": "Grenzland-Schienen",
        "map_label": "Karte des Grenzlands mit Knotenpunkten, Städten, Bergen, Flüssen und Gleisen",
        "meta": "Runde {round} · Gleise übrig: {left}",
        "player_chip": "{name}: {score} Punkte",
        "region_Y": "Gelb", "region_R": "Rot", "region_O": "Orange", "region_B": "Blau", "region_G": "Grün",
        "city_name": "{region} {number}",
        "your_cities": "Deine Städte in dieser Runde:",
        "place_start": "Du bist dran: Tippe auf einen Knotenpunkt, um deinen Startmarker zu setzen.",
        "build": "Du bist dran: Baue Gleise. Verbleibende Punkte: {points}.",
        "build_hint": "Tippe auf eine hervorgehobene Linie an deinem Netz. Flachland kostet 1, Berge und Flüsse 2.",
        "start_hint": "Dein Netz wächst von diesem Marker aus. Auf einer deiner Städte zu beginnen ist klug.",
        "waiting_start": "{name} setzt einen Startmarker.",
        "waiting_build": "{name} baut Gleise.",
        "end_turn": "Zug beenden",
        "watching": "Du schaust dieser Partie zu.",
        "round_result": "Ergebnis der Runde {round}",
        "col_player": "Spieler", "col_cities": "Städte", "col_lost": "Verloren", "col_score": "Punkte",
        "game_over_line": "Spielende: Ein Spieler hat {mark} Punkte oder weniger erreicht.",
        "you_win": "Du gewinnst mit den meisten übrigen Punkten!",
        "you_share": "Du teilst den Sieg mit den meisten übrigen Punkten!",
        "player_wins": "{name} gewinnt mit den meisten übrigen Punkten.",
        "players_win": "Gewinner: {names}.",
        "lowered_mark": "Das Spiel endet jetzt bei {mark} Punkten.",
        "server_the_game_is_over": "die Partie ist vorbei",
        "server_it_is_not_your_turn": "du bist nicht am Zug",
        "server_place_your_start_marker_first": "setze zuerst deinen Startmarker",
        "server_that_is_not_a_junction_on_the_map": "das ist kein Knotenpunkt auf der Karte",
        "server_start_markers_are_already_placed": "die Startmarker sind bereits gesetzt",
        "server_build_at_least_one_track_before_ending_your_turn": "baue mindestens ein Gleisstück, bevor du deinen Zug beendest",
        "server_that_track_is_already_built": "dieses Gleisstück ist bereits gebaut",
        "server_you_do_not_have_enough_points_left_for_that_track": "du hast nicht mehr genug Punkte für dieses Gleisstück",
        "server_track_must_join_your_network": "das Gleis muss an dein Netz anschließen",
        "server_send_a_start_junction_a_track_to_build_or_end_your_turn": "sende einen Startpunkt, ein Gleisstück zum Bauen oder beende deinen Zug",
    },
)

T["pt"] = dict(
    name="Trilhos da Fronteira",
    description="Uma corrida ferroviária rápida para 2 a 6 jogadores: todos dividem os mesmos trilhos, mas só você sabe quais cinco cidades precisa alcançar. Ligue todas primeiro e faça seus rivais pagarem.",
    rules="""Trilhos da Fronteira é para 2 a 6 jogadores. O mapa é uma grade de entroncamentos ligados por linhas; algumas linhas atravessam montanhas ou rios. Há 35 cidades em entroncamentos, 7 em cada uma de 5 regiões coloridas (amarela, vermelha, laranja, azul, verde). Com 2 ou 3 jogadores, as 2 cidades distantes de cada região (contorno tracejado) não são usadas.
Todos começam com 13 pontos. O jogo é disputado em rodadas. No início de cada rodada, cada jogador recebe uma cidade secreta de cada cor. Depois, a partir do primeiro jogador da rodada e na ordem dos lugares, cada um coloca um marcador de partida em qualquer entroncamento (pode ser uma cidade).
Então os jogadores constroem, em turnos e na mesma ordem, trilhos no valor de 2 pontos: uma linha na planície custa 1; uma linha pelas montanhas ou atravessando um rio custa 2. Pontos não usados se perdem. Cada trecho deve se ligar à rede conectada ao seu próprio marcador de partida, que inclui trilhos construídos por qualquer jogador. Você deve construir pelo menos uma vez por turno; depois de gastar 1 ponto, pode terminar o turno.
A rodada termina na hora quando as cinco cidades de um jogador estão todas ligadas ao seu marcador de partida (pelos trilhos de qualquer um) ou quando os 84 trechos de trilho foram construídos. Cada jogador perde então os pontos que ainda custaria ligar as cidades que faltam: primeiro liga-se a cidade que falta mais próxima, depois a próxima mais próxima a partir dali, e assim por diante; trilhos já construídos não custam nada.
Se ninguém estiver com 0 pontos ou menos, começa uma nova rodada: o mapa é limpo, o próximo jogador na ordem dos lugares começa e novas cidades são distribuídas. Depois da segunda rodada, se todos ainda tiverem 4 pontos ou mais, o jogo passa a terminar quando um jogador chegar a 3 pontos abaixo da menor pontuação daquele momento.
No fim do jogo, vence quem tiver mais pontos restantes; empatados dividem a vitória. O prêmio vai para os vencedores humanos; se só computadores vencerem, ele é dividido entre todos os jogadores humanos. Ninguém pode entrar nem sair durante uma partida.""",
    ui="O mapa mostra os entroncamentos como pontinhos, as montanhas como triângulos marrons, os rios como círculos azuis e as cidades como círculos coloridos numerados de 1 a 7; cidades distantes têm contorno tracejado e as suas têm um anel escuro. Os trilhos construídos aparecem na cor de cada jogador (uma faixa clara no meio marca trilhos de 2 pontos) e os marcadores de partida são quadrados coloridos. As fichas no topo mostram os pontos de cada jogador; o jogador da vez tem contorno dourado. Na sua vez, toque em um entroncamento para colocar seu marcador de partida e depois nas linhas douradas destacadas junto à sua rede para construir. O painel lateral mostra suas cidades (com um visto quando ligadas), os pontos restantes no turno, um botão Terminar turno e o resultado da última rodada com as cidades e os pontos perdidos de todos. Funciona em celulares, tablets e notebooks, na vertical e na horizontal.",
    tutorial=[
        "Como jogar Trilhos da Fronteira",
        "A cada rodada você recebe cinco cidades secretas, uma de cada cor. Ligue todas ao seu marcador de partida.",
        "Seu marcador de partida",
        "Coloque-o em qualquer entroncamento. Começar em uma das suas cidades costuma ser uma boa ideia.",
        "Construindo trilhos",
        "A cada turno construa 2 pontos de trilho: planície custa 1; montanhas e rios custam 2.",
        "Seus trilhos devem se ligar à sua rede, e qualquer trilho do mapa pode fazer parte dela, até o de um rival.",
        "Fim de uma rodada",
        "Quando alguém liga suas cinco cidades, ou os trilhos acabam, todos perdem os pontos que ainda faltavam.",
        "Todos começam com 13 pontos. Quando alguém chega a 0, vence quem tiver mais pontos.",
    ],
    client={
        "title": "Trilhos da Fronteira",
        "map_label": "Mapa da fronteira com entroncamentos, cidades, montanhas, rios e trilhos",
        "meta": "Rodada {round} · trilhos restantes: {left}",
        "player_chip": "{name}: {score} pontos",
        "region_Y": "Amarela", "region_R": "Vermelha", "region_O": "Laranja", "region_B": "Azul", "region_G": "Verde",
        "city_name": "{region} {number}",
        "your_cities": "Suas cidades nesta rodada:",
        "place_start": "Sua vez: toque em qualquer entroncamento para colocar seu marcador de partida.",
        "build": "Sua vez: construa trilhos. Pontos restantes: {points}.",
        "build_hint": "Toque em uma linha destacada junto à sua rede. Planície custa 1; montanhas e rios, 2.",
        "start_hint": "Sua rede cresce a partir deste marcador. Começar em uma das suas cidades é uma boa ideia.",
        "waiting_start": "{name} está colocando o marcador de partida.",
        "waiting_build": "{name} está construindo trilhos.",
        "end_turn": "Terminar turno",
        "watching": "Você está assistindo a esta partida.",
        "round_result": "Resultado da rodada {round}",
        "col_player": "Jogador", "col_cities": "Cidades", "col_lost": "Perdidos", "col_score": "Pontos",
        "game_over_line": "Fim de jogo: um jogador chegou a {mark} pontos ou menos.",
        "you_win": "Você venceu com mais pontos restantes!",
        "you_share": "Você divide a vitória com mais pontos restantes!",
        "player_wins": "{name} venceu com mais pontos restantes.",
        "players_win": "Vencedores: {names}.",
        "lowered_mark": "Agora o jogo termina em {mark} pontos.",
        "server_the_game_is_over": "o jogo terminou",
        "server_it_is_not_your_turn": "não é a sua vez",
        "server_place_your_start_marker_first": "coloque primeiro seu marcador de partida",
        "server_that_is_not_a_junction_on_the_map": "isso não é um entroncamento do mapa",
        "server_start_markers_are_already_placed": "os marcadores de partida já foram colocados",
        "server_build_at_least_one_track_before_ending_your_turn": "construa pelo menos um trecho antes de terminar o turno",
        "server_that_track_is_already_built": "esse trecho já foi construído",
        "server_you_do_not_have_enough_points_left_for_that_track": "você não tem pontos suficientes para esse trecho",
        "server_track_must_join_your_network": "o trilho deve se ligar à sua rede",
        "server_send_a_start_junction_a_track_to_build_or_end_your_turn": "envie um entroncamento de partida, um trecho para construir ou termine o turno",
    },
)

T["zh"] = dict(
    name="边疆铁路",
    description="一场 2 至 6 人的快速铁路竞赛：大家共用同一套铁轨，但只有你知道自己要抵达哪五座城市。率先把它们全部连通，让对手付出代价。",
    rules="""边疆铁路供 2 至 6 名玩家游玩。地图是由线路相连的交汇点网格；部分线路穿越山脉或跨越河流。35 座城市位于交汇点上，分属 5 个彩色区域（黄、红、橙、蓝、绿），每区 7 座。2 或 3 人游戏时，每个区域的 2 座偏远城市（虚线轮廓）不使用。
每人开局 13 分。游戏分多轮进行。每轮开始时，每名玩家获得每种颜色各一座秘密城市。然后从本轮的首位玩家开始，按座位顺序，每人在任意交汇点（可以是城市）放置一个起点标记。
随后玩家按同样顺序轮流建造价值 2 分的铁轨：平原线路花费 1，穿越山脉或跨越河流的线路花费 2。未用完的分数作废。每段铁轨都必须接入与你自己的起点标记相连的路网，路网包括任何玩家建造的铁轨。每回合至少要建造一次；花费 1 分后可以结束回合。
当某名玩家的五座城市全部（通过任何人的铁轨）与其起点标记相连，或 84 段铁轨全部建完时，本轮立即结束。每名玩家随后扣除连通其尚未连通城市仍需的分数：先连最近的未连通城市，再从那里连下一个最近的，依此类推；已建成的铁轨不计费用。
如果没有人降到 0 分或以下，就开始新一轮：清空地图，由座位顺序中的下一位玩家先行，并发放新的城市。第二轮结束后，如果所有玩家仍有 4 分或以上，则改为当某名玩家降到比当前最低分低 3 分时游戏结束。
游戏结束时，剩余分数最多的玩家获胜；平分者共享胜利。奖池归人类获胜者；如果只有电脑获胜，则由所有人类玩家平分。对局中任何人都不能加入或离开。""",
    ui="地图上，小点是交汇点，棕色三角形是山脉，蓝色圆圈是河流，编号 1 到 7 的彩色圆圈是城市；偏远城市有虚线轮廓，你自己的城市有深色外环。已建铁轨以各玩家的颜色显示（中间的浅色条纹表示 2 分铁轨），起点标记是彩色方块。顶部标签显示每名玩家的分数；当前行动的玩家有金色边框。轮到你时，点一个交汇点放置起点标记，然后点你路网旁高亮的金色线路进行建造。侧边面板显示你的城市（连通后打勾）、本回合剩余分数、结束回合按钮，以及上一轮结果，包括每个人的城市和扣分。适用于手机、平板和笔记本电脑，横屏竖屏皆可。",
    tutorial=[
        "边疆铁路玩法",
        "每轮你会获得五座秘密城市，每种颜色一座。把它们全部连到你的起点标记。",
        "你的起点标记",
        "把它放在任意交汇点上。从你自己的某座城市出发通常是个好主意。",
        "建造铁轨",
        "每回合建造 2 分的铁轨：平原花费 1，山脉和河流花费 2。",
        "你的铁轨必须接入你的路网，地图上任何铁轨都可以成为路网的一部分，包括对手的。",
        "一轮结束",
        "当有人连通全部五座城市，或铁轨用完时，每个人都要扣除仍需的分数。",
        "每人开局 13 分。当有人降到 0 分时，分数最多的玩家获胜。",
    ],
    client={
        "title": "边疆铁路",
        "map_label": "边疆地图，包含交汇点、城市、山脉、河流和铁轨",
        "meta": "第 {round} 轮 · 剩余铁轨：{left}",
        "player_chip": "{name}：{score} 分",
        "region_Y": "黄", "region_R": "红", "region_O": "橙", "region_B": "蓝", "region_G": "绿",
        "city_name": "{region}{number}",
        "your_cities": "你本轮的城市：",
        "place_start": "轮到你：点任意交汇点放置起点标记。",
        "build": "轮到你：建造铁轨。剩余分数：{points}。",
        "build_hint": "点你路网旁高亮的线路。平原花费 1，山脉和河流花费 2。",
        "start_hint": "你的路网从这个标记开始延伸。从你自己的城市出发是个好主意。",
        "waiting_start": "{name} 正在放置起点标记。",
        "waiting_build": "{name} 正在建造铁轨。",
        "end_turn": "结束回合",
        "watching": "你正在观看这场对局。",
        "round_result": "第 {round} 轮结果",
        "col_player": "玩家", "col_cities": "城市", "col_lost": "扣分", "col_score": "分数",
        "game_over_line": "游戏结束：有玩家降到 {mark} 分或以下。",
        "you_win": "你以最多的剩余分数获胜！",
        "you_share": "你以最多的剩余分数与他人共享胜利！",
        "player_wins": "{name} 以最多的剩余分数获胜。",
        "players_win": "获胜者：{names}。",
        "lowered_mark": "现在游戏在 {mark} 分时结束。",
        "server_the_game_is_over": "游戏已结束",
        "server_it_is_not_your_turn": "还没轮到你",
        "server_place_your_start_marker_first": "请先放置起点标记",
        "server_that_is_not_a_junction_on_the_map": "那不是地图上的交汇点",
        "server_start_markers_are_already_placed": "起点标记已经放好了",
        "server_build_at_least_one_track_before_ending_your_turn": "结束回合前至少要建造一段铁轨",
        "server_that_track_is_already_built": "那段铁轨已经建好了",
        "server_you_do_not_have_enough_points_left_for_that_track": "你剩余的分数不足以建造那段铁轨",
        "server_track_must_join_your_network": "铁轨必须接入你的路网",
        "server_send_a_start_junction_a_track_to_build_or_end_your_turn": "请发送起点交汇点、要建造的铁轨，或结束回合",
    },
)

T["hi"] = dict(
    name="सरहदी रेल",
    description="2 से 6 खिलाड़ियों की तेज़ रेल दौड़: सब एक ही पटरियाँ बाँटते हैं, पर सिर्फ़ आप जानते हैं कि आपको कौन-से पाँच शहर जोड़ने हैं। सबसे पहले सब जोड़िए और विरोधियों से कीमत वसूलिए।",
    rules="""सरहदी रेल 2 से 6 खिलाड़ियों के लिए है। नक्शा जंक्शनों की ग्रिड है जो लाइनों से जुड़े हैं; कुछ लाइनें पहाड़ों से या नदियों के पार जाती हैं। 35 शहर जंक्शनों पर हैं, 5 रंगीन इलाकों (पीला, लाल, नारंगी, नीला, हरा) में हर एक में 7। 2 या 3 खिलाड़ियों में हर इलाके के 2 दूर के शहर (टूटी रेखा वाली किनारी) इस्तेमाल नहीं होते।
सब 13 अंकों से शुरू करते हैं। खेल कई दौरों में होता है। हर दौर की शुरुआत में हर खिलाड़ी को हर रंग का एक गुप्त शहर मिलता है। फिर दौर के पहले खिलाड़ी से शुरू करके सीट के क्रम में हर खिलाड़ी किसी भी जंक्शन (शहर भी हो सकता है) पर अपना शुरुआती निशान रखता है।
इसके बाद खिलाड़ी उसी क्रम में बारी-बारी से 2 अंकों की पटरी बनाते हैं: मैदान की लाइन 1 की, और पहाड़ों से या नदी के पार की लाइन 2 की। बचे अंक खत्म हो जाते हैं। हर टुकड़ा उस नेटवर्क से जुड़ना चाहिए जो आपके अपने शुरुआती निशान से जुड़ा है, और उसमें किसी भी खिलाड़ी की बनाई पटरी शामिल है। हर बारी में कम से कम एक बार बनाना ज़रूरी है; 1 अंक खर्च करने के बाद आप बारी खत्म कर सकते हैं।
जब किसी खिलाड़ी के पाँचों शहर (किसी की भी पटरी से) उसके शुरुआती निशान से जुड़ जाएँ, या सभी 84 टुकड़े बन जाएँ, तो दौर तुरंत खत्म होता है। तब हर खिलाड़ी उतने अंक खोता है जितने उसके बाकी शहरों को जोड़ने में अब भी लगते: पहले सबसे नज़दीकी बाकी शहर जोड़ा जाता है, फिर वहाँ से अगला सबसे नज़दीकी, और इसी तरह; पहले से बनी पटरी मुफ़्त है।
अगर कोई 0 या उससे कम अंक पर नहीं है, तो नया दौर शुरू होता है: नक्शा साफ़ होता है, सीट के क्रम में अगला खिलाड़ी पहले खेलता है और नए शहर बाँटे जाते हैं। दूसरे दौर के बाद अगर सभी खिलाड़ियों के पास अब भी 4 या ज़्यादा अंक हों, तो खेल तब खत्म होगा जब कोई खिलाड़ी उस समय के सबसे कम स्कोर से 3 अंक नीचे पहुँचे।
खेल खत्म होने पर सबसे ज़्यादा बचे अंकों वाला खिलाड़ी जीतता है; बराबरी वाले जीत बाँटते हैं। इनाम मानव विजेताओं को मिलता है; अगर सिर्फ़ कंप्यूटर जीतें, तो सभी मानव खिलाड़ियों में बँटता है। मैच के दौरान कोई जुड़ या छोड़ नहीं सकता।""",
    ui="नक्शे पर छोटे बिंदु जंक्शन हैं, भूरे त्रिकोण पहाड़, नीले गोले नदियाँ, और 1 से 7 नंबर वाले रंगीन गोले शहर; दूर के शहरों की किनारी टूटी रेखा वाली है और आपके अपने शहरों पर गहरा घेरा है। बनी पटरी हर खिलाड़ी के रंग में दिखती है (बीच की हल्की पट्टी 2 अंक की पटरी बताती है) और शुरुआती निशान रंगीन वर्ग हैं। ऊपर के चिप हर खिलाड़ी के अंक दिखाते हैं; जिसकी बारी है उसके चारों ओर सुनहरा घेरा है। अपनी बारी में शुरुआती निशान रखने के लिए किसी जंक्शन पर टैप कीजिए, फिर बनाने के लिए अपने नेटवर्क के पास चमकती सुनहरी लाइनों पर टैप कीजिए। बगल का पैनल आपके शहर (जुड़ने पर सही का निशान), इस बारी के बचे अंक, बारी खत्म करें बटन, और पिछले दौर का नतीजा सबके शहरों और खोए अंकों के साथ दिखाता है। फ़ोन, टैबलेट और लैपटॉप पर, खड़े और आड़े दोनों में चलता है।",
    tutorial=[
        "सरहदी रेल कैसे खेलें",
        "हर दौर में आपको पाँच गुप्त शहर मिलते हैं, हर रंग का एक। सबको अपने शुरुआती निशान से जोड़िए।",
        "आपका शुरुआती निशान",
        "इसे किसी भी जंक्शन पर रखिए। अपने किसी शहर से शुरू करना अक्सर अच्छा रहता है।",
        "पटरी बनाना",
        "हर बारी में 2 अंक की पटरी बनाइए: मैदान 1 का, पहाड़ और नदियाँ 2 की।",
        "आपकी पटरी आपके नेटवर्क से जुड़नी चाहिए, और नक्शे की कोई भी पटरी उसका हिस्सा हो सकती है, विरोधी की भी।",
        "दौर का अंत",
        "जब कोई अपने पाँचों शहर जोड़ ले या पटरी खत्म हो जाए, तो सब बाकी ज़रूरी अंक खोते हैं।",
        "सब 13 अंकों से शुरू करते हैं। जब कोई 0 पर पहुँचे, तो सबसे ज़्यादा अंकों वाला जीतता है।",
    ],
    client={
        "title": "सरहदी रेल",
        "map_label": "सरहद का नक्शा: जंक्शन, शहर, पहाड़, नदियाँ और पटरियाँ",
        "meta": "दौर {round} · बची पटरी: {left}",
        "player_chip": "{name}: {score} अंक",
        "region_Y": "पीला", "region_R": "लाल", "region_O": "नारंगी", "region_B": "नीला", "region_G": "हरा",
        "city_name": "{region} {number}",
        "your_cities": "इस दौर में आपके शहर:",
        "place_start": "आपकी बारी: शुरुआती निशान रखने के लिए किसी जंक्शन पर टैप कीजिए।",
        "build": "आपकी बारी: पटरी बनाइए। बचे अंक: {points}।",
        "build_hint": "अपने नेटवर्क के पास चमकती लाइन पर टैप कीजिए। मैदान 1 का, पहाड़ और नदियाँ 2 की।",
        "start_hint": "आपका नेटवर्क इसी निशान से बढ़ता है। अपने किसी शहर से शुरू करना अच्छा है।",
        "waiting_start": "{name} शुरुआती निशान रख रहे हैं।",
        "waiting_build": "{name} पटरी बना रहे हैं।",
        "end_turn": "बारी खत्म करें",
        "watching": "आप यह मैच देख रहे हैं।",
        "round_result": "दौर {round} का नतीजा",
        "col_player": "खिलाड़ी", "col_cities": "शहर", "col_lost": "खोए", "col_score": "अंक",
        "game_over_line": "खेल खत्म: कोई खिलाड़ी {mark} या कम अंक पर पहुँचा।",
        "you_win": "आप सबसे ज़्यादा बचे अंकों से जीते!",
        "you_share": "आप सबसे ज़्यादा बचे अंकों के साथ जीत बाँटते हैं!",
        "player_wins": "{name} सबसे ज़्यादा बचे अंकों से जीते।",
        "players_win": "विजेता: {names}।",
        "lowered_mark": "अब खेल {mark} अंक पर खत्म होगा।",
        "server_the_game_is_over": "खेल खत्म हो चुका है",
        "server_it_is_not_your_turn": "आपकी बारी नहीं है",
        "server_place_your_start_marker_first": "पहले अपना शुरुआती निशान रखिए",
        "server_that_is_not_a_junction_on_the_map": "वह नक्शे पर कोई जंक्शन नहीं है",
        "server_start_markers_are_already_placed": "शुरुआती निशान पहले ही रखे जा चुके हैं",
        "server_build_at_least_one_track_before_ending_your_turn": "बारी खत्म करने से पहले कम से कम एक टुकड़ा बनाइए",
        "server_that_track_is_already_built": "वह टुकड़ा पहले ही बन चुका है",
        "server_you_do_not_have_enough_points_left_for_that_track": "उस टुकड़े के लिए आपके पास काफ़ी अंक नहीं बचे",
        "server_track_must_join_your_network": "पटरी आपके नेटवर्क से जुड़नी चाहिए",
        "server_send_a_start_junction_a_track_to_build_or_end_your_turn": "शुरुआती जंक्शन, बनाने के लिए टुकड़ा भेजिए, या बारी खत्म कीजिए",
    },
)

T["ar"] = dict(
    name="سكك الحدود",
    description="سباق سكك حديدية سريع من 2 إلى 6 لاعبين: يتشارك الجميع السكك نفسها، لكنك وحدك تعرف المدن الخمس التي عليك بلوغها. اربطها كلها أولًا واجعل منافسيك يدفعون الثمن.",
    rules="""سكك الحدود لعبة من 2 إلى 6 لاعبين. الخريطة شبكة من التقاطعات تصلها خطوط؛ بعض الخطوط تعبر جبالًا أو أنهارًا. توجد 35 مدينة على التقاطعات، 7 في كل منطقة من 5 مناطق ملونة (أصفر، أحمر، برتقالي، أزرق، أخضر). مع لاعبَين أو 3 لاعبين لا تُستخدم المدينتان البعيدتان في كل منطقة (بإطار متقطع).
يبدأ الجميع بـ 13 نقطة. تُلعب اللعبة على جولات. في بداية كل جولة يحصل كل لاعب على مدينة سرية من كل لون. ثم، بدءًا بأول لاعب في الجولة وبترتيب المقاعد، يضع كل لاعب علامة انطلاق على أي تقاطع (قد يكون مدينة).
بعد ذلك يبني اللاعبون بالدور وبالترتيب نفسه سككًا بقيمة نقطتين: الخط في السهل يكلّف 1، والخط عبر الجبال أو فوق نهر يكلّف 2. النقاط غير المستخدمة تضيع. يجب أن تتصل كل قطعة بالشبكة الموصولة بعلامة انطلاقك، وهي تشمل السكك التي بناها أي لاعب. يجب أن تبني مرة واحدة على الأقل في كل دور؛ وبعد إنفاق نقطة واحدة يمكنك إنهاء دورك.
تنتهي الجولة فورًا عندما تتصل مدن أحد اللاعبين الخمس كلها بعلامة انطلاقه (بسكك أي لاعب)، أو عند بناء كل قطع السكك الـ 84. عندها يخسر كل لاعب النقاط التي ما زال يكلّفها ربط مدنه الناقصة: تُربط أولًا أقرب مدينة ناقصة، ثم الأقرب التالية من هناك، وهكذا؛ والسكك المبنية لا تكلّف شيئًا.
إن لم يكن أحد عند 0 نقطة أو أقل، تبدأ جولة جديدة: تُفرغ الخريطة، ويبدأ اللاعب التالي بترتيب المقاعد، وتُوزّع مدن جديدة. بعد الجولة الثانية، إن كان لدى كل اللاعبين 4 نقاط أو أكثر، تنتهي اللعبة بدلًا من ذلك عندما يصل لاعب إلى 3 نقاط أقل من أدنى نتيجة حالية.
عند انتهاء اللعبة يفوز صاحب أكثر النقاط المتبقية؛ ويتقاسم المتعادلون الفوز. الجائزة للفائزين البشر؛ وإن فازت الحواسيب وحدها تُقسم بين كل اللاعبين البشر. لا يمكن لأحد الانضمام أو المغادرة أثناء المباراة.""",
    ui="تُظهر الخريطة التقاطعات نقاطًا صغيرة، والجبال مثلثات بنية، والأنهار دوائر زرقاء، والمدن دوائر ملونة مرقّمة من 1 إلى 7؛ للمدن البعيدة إطار متقطع ولمدنك حلقة داكنة. تُرسم السكك المبنية بلون كل لاعب (شريط فاتح في المنتصف يميّز سكك النقطتين)، وعلامات الانطلاق مربعات ملونة. تُظهر الشارات في الأعلى نقاط كل لاعب، ويُحاط صاحب الدور بإطار ذهبي. في دورك، المس تقاطعًا لتضع علامة انطلاقك، ثم المس الخطوط الذهبية المميّزة بجوار شبكتك لتبني. تُظهر اللوحة الجانبية مدنك (بعلامة صح عند ربطها)، والنقاط المتبقية في الدور، وزر إنهاء الدور، ونتيجة الجولة الأخيرة بمدن الجميع ونقاطهم المفقودة. تعمل على الهواتف والأجهزة اللوحية والحواسيب المحمولة، بالوضعين العمودي والأفقي.",
    tutorial=[
        "طريقة لعب سكك الحدود",
        "في كل جولة تحصل على خمس مدن سرية، واحدة من كل لون. اربطها كلها بعلامة انطلاقك.",
        "علامة انطلاقك",
        "ضعها على أي تقاطع. البدء من إحدى مدنك فكرة جيدة غالبًا.",
        "بناء السكك",
        "ابنِ في كل دور سككًا بقيمة نقطتين: السهل يكلّف 1، والجبال والأنهار 2.",
        "يجب أن تتصل سككك بشبكتك، وأي سكة على الخريطة يمكن أن تكون جزءًا منها، حتى سكة المنافس.",
        "نهاية الجولة",
        "عندما يربط أحدهم مدنه الخمس، أو تنفد السكك، يخسر الجميع النقاط التي ما زالوا يحتاجونها.",
        "يبدأ الجميع بـ 13 نقطة. عندما يصل أحدهم إلى 0، يفوز صاحب أكثر النقاط.",
    ],
    client={
        "title": "سكك الحدود",
        "map_label": "خريطة الحدود بالتقاطعات والمدن والجبال والأنهار والسكك",
        "meta": "الجولة {round} · السكك المتبقية: {left}",
        "player_chip": "{name}: {score} نقطة",
        "region_Y": "الصفراء", "region_R": "الحمراء", "region_O": "البرتقالية", "region_B": "الزرقاء", "region_G": "الخضراء",
        "city_name": "{region} {number}",
        "your_cities": "مدنك في هذه الجولة:",
        "place_start": "دورك: المس أي تقاطع لتضع علامة انطلاقك.",
        "build": "دورك: ابنِ السكك. النقاط المتبقية: {points}.",
        "build_hint": "المس خطًا مميّزًا بجوار شبكتك. السهل يكلّف 1، والجبال والأنهار 2.",
        "start_hint": "تنمو شبكتك من هذه العلامة. البدء من إحدى مدنك فكرة جيدة.",
        "waiting_start": "{name} يضع علامة الانطلاق.",
        "waiting_build": "{name} يبني السكك.",
        "end_turn": "إنهاء الدور",
        "watching": "أنت تشاهد هذه المباراة.",
        "round_result": "نتيجة الجولة {round}",
        "col_player": "اللاعب", "col_cities": "المدن", "col_lost": "المفقود", "col_score": "النقاط",
        "game_over_line": "نهاية اللعبة: وصل لاعب إلى {mark} نقطة أو أقل.",
        "you_win": "فزت بأكثر النقاط المتبقية!",
        "you_share": "تتقاسم الفوز بأكثر النقاط المتبقية!",
        "player_wins": "فاز {name} بأكثر النقاط المتبقية.",
        "players_win": "الفائزون: {names}.",
        "lowered_mark": "تنتهي اللعبة الآن عند {mark} نقطة.",
        "server_the_game_is_over": "انتهت اللعبة",
        "server_it_is_not_your_turn": "ليس دورك",
        "server_place_your_start_marker_first": "ضع علامة انطلاقك أولًا",
        "server_that_is_not_a_junction_on_the_map": "هذا ليس تقاطعًا على الخريطة",
        "server_start_markers_are_already_placed": "علامات الانطلاق موضوعة بالفعل",
        "server_build_at_least_one_track_before_ending_your_turn": "ابنِ قطعة سكة واحدة على الأقل قبل إنهاء دورك",
        "server_that_track_is_already_built": "هذه القطعة مبنية بالفعل",
        "server_you_do_not_have_enough_points_left_for_that_track": "لا تكفي نقاطك المتبقية لهذه القطعة",
        "server_track_must_join_your_network": "يجب أن تتصل السكة بشبكتك",
        "server_send_a_start_junction_a_track_to_build_or_end_your_turn": "أرسل تقاطع انطلاق أو قطعة سكة لبنائها أو أنهِ دورك",
    },
)
