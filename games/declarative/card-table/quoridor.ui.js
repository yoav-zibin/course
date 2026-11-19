const SOURCE_STRINGS = {
  title: "Quoridor",
  rules: "Race your pawn to the far row. Each turn, move one square or place one of your 10 walls to slow your rival. A wall can never block the last path to either goal. Jump over the other pawn when possible; if a wall blocks the jump, move to either open side. Player 1 starts at the bottom and heads up; Player 2 starts at the top and heads down.",
  waiting_platform: "Waiting for the platform…",
  waiting: "Waiting for the match…",
  player_n: "Player {n}",
  move_pawn: "Move pawn",
  place_wall: "Place wall",
  wall_horizontal: "Horizontal wall",
  wall_vertical: "Vertical wall",
  walls_left: "Walls — P1: {walls0} · P2: {walls1}",
  wins: "{name} wins!",
  saving: "Saving move…",
  your_turn_move: "Tap a highlighted square to move",
  your_turn_wall: "Tap a highlighted gap to place a wall",
  waiting_for: "Waiting for {name}…",
  goal_player_0: "Player 1 goal",
  goal_player_1: "Player 2 goal",
  server_game_over: "game over",
  server_not_seated: "not seated",
  server_not_your_turn: "not your turn",
  server_bad_move: "bad move",
  server_bad_square: "bad square",
  server_illegal_pawn_move: "illegal pawn move",
  server_bad_wall: "bad wall",
  server_no_walls_left: "no walls left",
  server_illegal_wall: "illegal wall",
  server_unknown_move: "unknown move"
};

function gameUIText(message, key, values) {
  const source = SOURCE_STRINGS[key] || key;
  const text = (message.strings || {})[key] || source;
  return text.replace(/\{(\w+)\}/g, (match, name) => values && name in values ? String(values[name]) : match);
}

function quoridorBlocked(walls, r1, c1, r2, c2) {
  for (const wall of walls) {
    if (c1 === c2 && wall.o === "H" && wall.r === Math.min(r1, r2) && (wall.c === c1 || wall.c === c1 - 1)) return true;
    if (r1 === r2 && wall.o === "V" && wall.c === Math.min(c1, c2) && (wall.r === r1 || wall.r === r1 - 1)) return true;
  }
  return false;
}

function quoridorHasPath(walls, pawn, goal) {
  const queue = [[pawn.r, pawn.c]], seen = new Set([pawn.r + "," + pawn.c]);
  for (let head = 0; head < queue.length; head++) {
    const [r, c] = queue[head];
    if (r === goal) return true;
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      const nr = r + dr, nc = c + dc, key = nr + "," + nc;
      if (nr < 0 || nr > 8 || nc < 0 || nc > 8 || seen.has(key) || quoridorBlocked(walls, r, c, nr, nc)) continue;
      seen.add(key); queue.push([nr, nc]);
    }
  }
  return false;
}

function quoridorWallFits(view, r, c, orientation) {
  if(Array.isArray(view.legalWalls))return view.legalWalls.some(w=>w.r===r&&w.c===c&&w.o===orientation);
  if (!view || !Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r > 7 || c < 0 || c > 7 ||
      (orientation !== "H" && orientation !== "V") || view.wallsLeft[view.turnIdx] <= 0) return false;
  for (const wall of view.walls) {
    if (wall.r === r && wall.c === c) return false;
    if (orientation === "H" && wall.o === "H" && wall.r === r && Math.abs(wall.c - c) === 1) return false;
    if (orientation === "V" && wall.o === "V" && wall.c === c && Math.abs(wall.r - r) === 1) return false;
  }
  const walls = view.walls.concat([{r, c, o: orientation}]);
  return quoridorHasPath(walls, view.pawns[0], 0) && quoridorHasPath(walls, view.pawns[1], 8);
}

function gameUIBoardAsset() {
  const cells = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const x = 27 + c * 48, y = 132 + r * 48;
    const fill = r === 0 ? "#4b3445" : r === 8 ? "#33445d" : "#25344e";
    cells.push(`<rect x="${x}" y="${y}" width="42" height="42" rx="5" fill="${fill}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 700"><rect width="480" height="700" fill="#111d30"/><rect x="27" y="132" width="426" height="426" rx="12" fill="#1d2942"/>${cells.join("")}</svg>`;
}

var gameUI = {
  reduce: function (message, localState) {
    const prior = localState && typeof localState === "object" ? localState : {};
    let mode = prior.mode === "wall" ? "wall" : "move";
    let orientation = prior.orientation === "V" ? "V" : "H";
    const latest = message.type === "ui_event" ? (message.state_changed || {}) : message;
    const view = latest.view || latest.state || {};
    const event = message.type === "ui_event" ? (message.event || {}) : {};
    const canAct = latest.status === "ongoing" && Number.isInteger(latest.acting_for_player_index) && view.winner == null;
    let make_move;

    if (event.type === "tap" && event.id === "mode-move") mode = "move";
    if (event.type === "tap" && event.id === "mode-wall") mode = "wall";
    if (event.type === "tap" && event.id === "wall-orientation") orientation = orientation === "H" ? "V" : "H";
    if (canAct && event.type === "drop" && typeof event.target_id === "string") {
      const match = /^pawn-(\d+)-(\d+)$/.exec(event.target_id);
      if (match && mode === "move") {
        const r = Number(match[1]), c = Number(match[2]);
        if ((view.legalMoves || []).some(move => move[0] === r && move[1] === c)) make_move = {type: "pawn", r, c};
      }
    }
    if (canAct && event.type === "tap" && typeof event.id === "string") {
      const pawnTarget = /^pawn-(\d+)-(\d+)$/.exec(event.id);
      if (pawnTarget && mode === "move") {
        const r = Number(pawnTarget[1]), c = Number(pawnTarget[2]);
        if ((view.legalMoves || []).some(move => move[0] === r && move[1] === c)) make_move = {type: "pawn", r, c};
      }
      const wallTarget = /^wall-([HV])-(\d+)-(\d+)$/.exec(event.id);
      if (wallTarget && mode === "wall") {
        const r = Number(wallTarget[2]), c = Number(wallTarget[3]), o = wallTarget[1];
        if (quoridorWallFits(view, r, c, o)) make_move = {type: "wall", r, c, o};
      }
    }

    const playerName = i => latest.players && latest.players[i] && latest.players[i].name || gameUIText(latest, "player_n", {n: i + 1});
    const wallTypes = {pawn0: "pawn0", pawn1: "pawn1", wallH: "wallH", wallV: "wallV"};
    const pieces = [];
    const targets = [];
    const walls = view.walls || [];
    const pawns = view.pawns || [{r:8,c:4},{r:0,c:4}];
    const legal = canAct && mode === "move" ? (view.legalMoves || []) : [];
    const legalIDs = legal.map(move => `pawn-${move[0]}-${move[1]}`);
    const tile = 42, gap = 6, step = 48;
    const xy = (r, c) => ({x: 27 + tile / 2 + c * step, y: 132 + tile / 2 + r * step});

    for (let i = 0; i < 2; i++) {
      const p = pawns[i], point = xy(p.r, p.c), active = canAct && view.turnIdx === i;
      const piece = {id: `pawn-${i}`, type: wallTypes[`pawn${i}`], board: "table",
        position: point, text: String(i + 1), z: 5, actions: [],
        aria_label: gameUIText(latest, "player_n", {n: i + 1}) + " pawn"};
      if (active && mode === "move" && legalIDs.length) {
        piece.actions = ["move"]; piece.draggable = true; piece.move_targets = legalIDs;
      }
      pieces.push(piece);
    }
    walls.forEach((wall, index) => {
      const point = {x: 27 + tile + wall.c * step + gap / 2, y: 132 + tile + wall.r * step + gap / 2};
      pieces.push({id: `wall-${wall.o}-${wall.r}-${wall.c}`, type: wall.o === "H" ? "wallH" : "wallV",
        board: "table", position: point, z: 4, actions: [], aria_label: `Wall ${index + 1}, ${wall.o === "H" ? "horizontal" : "vertical"}`});
    });

    if (canAct && mode === "move") {
      for (const move of legal) {
        const [r, c] = move, point = xy(r, c), id = `pawn-${r}-${c}`;
        targets.push({id, board: "table", position: point, aria_label: `Move pawn to row ${r + 1}, column ${c + 1}`,
          color: "#42df9b", hit_area: {x:-22,y:-22,width:44,height:44}});
      }
    } else if (canAct && mode === "wall" && (view.wallsLeft || [0,0])[view.turnIdx] > 0) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        if (!quoridorWallFits(view, r, c, orientation)) continue;
        const point = {x: 27 + tile + c * step + gap / 2, y: 132 + tile + r * step + gap / 2};
        targets.push({id: `wall-${orientation}-${r}-${c}`, board: "table", position: point,
          aria_label: `Place ${orientation === "H" ? "horizontal" : "vertical"} wall, row ${r + 1}, column ${c + 1}`,
          asset: orientation === "H" ? "wall-target-h" : "wall-target-v",
          hit_area: {x:-22,y:-22,width:44,height:44}});
      }
    }

    const winner = view.winner;
    let statusText = gameUIText(latest, "waiting", {});
    if (latest.status === "waiting_for_players") statusText = gameUIText(latest, "waiting_platform", {});
    else if (latest.status === "over" || winner != null) statusText = winner == null ? gameUIText(latest, "waiting", {}) : gameUIText(latest, "wins", {name: playerName(winner)});
    else if (canAct && mode === "wall") statusText = gameUIText(latest, "your_turn_wall", {name: playerName(latest.acting_for_player_index)});
    else if (canAct) statusText = gameUIText(latest, "your_turn_move", {name: playerName(latest.acting_for_player_index)});
    else if (latest.turn_of_player_indices && latest.turn_of_player_indices.length) statusText = gameUIText(latest, "waiting_for", {name: playerName(latest.turn_of_player_indices[0])});

    const controls = [];
    if (canAct) {
      controls.push({id:"mode-move",kind:"button",label:(mode === "move" ? "✓ " : "") + gameUIText(latest,"move_pawn")});
      controls.push({id:"mode-wall",kind:"button",label:(mode === "wall" ? "✓ " : "") + gameUIText(latest,"place_wall")});
      if (mode === "wall") controls.push({id:"wall-orientation",kind:"button",label:gameUIText(latest, orientation === "H" ? "wall_horizontal" : "wall_vertical")});
    }
    const lines = [];
    for (let i = 1; i < 9; i++) {
      const offset = i * step - gap / 2;
      lines.push({id:`board-v-${i}`,points:[{x:27+offset,y:132},{x:27+offset,y:558}],color:"#71809a",width:1.5});
      lines.push({id:`board-h-${i}`,points:[{x:27,y:132+offset},{x:453,y:132+offset}],color:"#71809a",width:1.5});
    }
    const labels = [
      {id:"title",text:gameUIText(latest,"title"),x:32,y:22,font_size:24,color:"#ffffff"},
      {id:"status",text:statusText,x:32,y:58,font_size:15,color:canAct?"#8ee7cd":"#c5d0e0"},
      {id:"walls",text:gameUIText(latest,"walls_left",{name0:playerName(0),walls0:(view.wallsLeft||[0,0])[0],name1:playerName(1),walls1:(view.wallsLeft||[0,0])[1]}),x:32,y:86,font_size:14,color:"#d0d9e8"},
      {id:"goal-top",text:gameUIText(latest,"goal_player_0"),x:32,y:114,font_size:12,color:"#ff9dca"},
      {id:"goal-bottom",text:gameUIText(latest,"goal_player_1"),x:32,y:566,font_size:12,color:"#a7c8ff"}
    ];
    const scene = {paths:lines,pieces,targets,labels,controls};
    const nextLocal = {mode,orientation};
    const result = {scene,local_state:nextLocal};
    if (make_move) result.make_move = make_move;
    return result;
  }
};
