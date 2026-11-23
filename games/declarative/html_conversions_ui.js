// Shared presentation for HTML games converted to the portable declarative UI.
// Rules and private information remain in each game's existing server module.
const gameUI = {
  reduce(message, localState) {
    const m = message.type === 'ui_event' ? message.state_changed : message;
    const s = m.view || m.state || {};
    const active = m.status === 'ongoing' && !m.replay &&
      m.acting_for_player_index !== null && m.acting_for_player_index !== undefined;
    const legal = active;
    const scene = {pieces: [], targets: [], controls: [], labels: [], paths: []};
    const offers = [];
    const presentationState = {};
    let selectedMode = 'pawn';
    let selectedFrom = null;
    const text = (source, values = {}) => String(m.strings?.[SOURCE_KEYS[source]] ?? source).replace(/\{(\w+)\}/g, (match, key) => values[key] == null ? match : String(values[key]));
    const playerNames = (m.players || []).map((p, i) => p.name || text('Player {n}', {n:i + 1}));
    const mySeat = Number.isInteger(m.my_player_index) ? m.my_player_index : 0;
    const title = m.strings?.title || SOURCE_STRINGS.title || KIND;
    const setupSeat = s.phase === 'SETUP' && Array.isArray(s.boards)
      ? s.boards.findIndex(board => !board.ready) : -1;
    const turnSeat = setupSeat >= 0 ? setupSeat : Number.isInteger(s.turnIdx) ? s.turnIdx :
      Number.isInteger(s.current) ? s.current : Number.isInteger(s.toMove) ? s.toMove : null;
    scene.labels.push({id: 'title', text: title, x: 22, y: 16, font_size: 26});
    if (turnSeat !== null) {
      scene.labels.push({id: 'status', text: active ? text('Your turn · {name}', {name:playerNames[turnSeat] || text('Player {n}', {n:turnSeat + 1})}) :
        (m.status === 'over' ? text('Game over') : text('{name} to play', {name:playerNames[turnSeat] || text('Player {n}', {n:turnSeat + 1})})),
        x: 22, y: 52, font_size: 17});
    }
    if (m.status === 'over' && Number.isInteger(s.winner)) {
      scene.labels.push({id: 'winner', text: text('Winner: {name}', {name:playerNames[s.winner] || text('Player {n}', {n:s.winner + 1})}),
        x: 22, y: 78, font_size: 16});
    }
    const intent = (move, label, surface, position, presentation, aria_label) => {
      if (!active) return null;
      const id = `intent_${offers.length}`;
      offers.push(move);
      if (presentation === 'piece' || presentation?.startsWith('person_')) {
        scene.pieces.push({id, type: presentation === 'piece' ? 'card' : presentation, board: surface, position, text: label,
          actions: ['tap'], ...(aria_label ? {aria_label} : {})});
      } else if (presentation === 'target') {
        const destination = move.to || (Number.isInteger(move.tr) ? {r:move.tr,c:move.tc} : null);
        scene.targets.push({id, board: surface, position, label: label || '•', ...(destination ? {aria_label:text('Move to row {r}, column {c}', {r:destination.r+1,c:destination.c+1})} : {})});
      } else {
        scene.controls.push({id, kind: 'button', label});
      }
      return id;
    };
    const staticPiece = (id, type, board, position, extra = {}) =>
      scene.pieces.push(Object.assign({id, type, board, position, actions: []}, extra));
    const label = (id, text, x, y, size = 14) =>
      scene.labels.push({id, text: String(text), x, y, font_size: size});
    const cardText = card => String(card || '').replace(/S$/, '♠').replace(/H$/, '♥')
      .replace(/D$/, '♦').replace(/C$/, '♣');
    const cardPos = index => ({x: 34 + (index % 8) * 66, y: 120 + Math.floor(index / 8) * 92});
    const eventId = message.type === 'ui_event' && message.event?.type === 'tap' ? String(message.event.id || '') : '';
    const intentMatch = /^intent_(\d+)$/.exec(eventId);
    const battleshipFleet = [
      {key:'carrier',name:'Carrier',size:5}, {key:'battleship',name:'Battleship',size:4},
      {key:'cruiser',name:'Cruiser',size:3}, {key:'submarine',name:'Submarine',size:3},
      {key:'destroyer',name:'Destroyer',size:2}
    ];
    const fleetSetup = KIND === 'battleship' && s.phase === 'SETUP';
    const retainedFleet = fleetSetup && localState?.move_count === m.move_count &&
      localState?.viewer === mySeat && localState?.phase === 'SETUP' && Array.isArray(localState.fleetDraft)
      ? localState.fleetDraft : [];
    let fleetDraft = [];
    for (const placement of retainedFleet) {
      const ship = battleshipFleet.find(item => item.key === placement?.key);
      if (!ship || fleetDraft.some(item => item.key === ship.key) ||
          !Array.isArray(placement.cells) || placement.cells.length !== ship.size ||
          !placement.cells.every(cell => Array.isArray(cell) && cell.length === 2 &&
            Number.isInteger(cell[0]) && Number.isInteger(cell[1]) &&
            cell[0] >= 0 && cell[0] < 10 && cell[1] >= 0 && cell[1] < 10)) continue;
      fleetDraft.push({key:ship.key,cells:placement.cells.map(cell => [cell[0],cell[1]])});
    }
    let placedFleetKeys = new Set(fleetDraft.map(placement => placement.key));
    let availableFleet = battleshipFleet.filter(ship => !placedFleetKeys.has(ship.key));
    let selectedShip = availableFleet.some(ship => ship.key === localState?.selectedShip)
      ? localState.selectedShip : availableFleet[0]?.key || null;
    let fleetOrientation = localState?.move_count === m.move_count && localState?.viewer === mySeat &&
      localState?.phase === 'SETUP' && localState?.orientation === 'vertical' ? 'vertical' : 'horizontal';
    let placementMove = null;
    const setupTap = message.type === 'ui_event' && active && fleetSetup && message.event?.type === 'tap';
    if (setupTap) {
      const selected = /^fleet_ship_(carrier|battleship|cruiser|submarine|destroyer)$/.exec(eventId);
      if (selected && availableFleet.some(ship => ship.key === selected[1])) selectedShip = selected[1];
      if (eventId === 'fleet_direction_horizontal') fleetOrientation = 'horizontal';
      if (eventId === 'fleet_direction_vertical') fleetOrientation = 'vertical';
      if (eventId === 'fleet_undo' && fleetDraft.length) {
        const removed = fleetDraft.pop();
        selectedShip = removed.key;
      }
      const cellTarget = /^fleet_place_(\d+)_(\d+)$/.exec(eventId);
      const ship = battleshipFleet.find(item => item.key === selectedShip);
      if (cellTarget && ship && !placedFleetKeys.has(ship.key)) {
        const row = Number(cellTarget[1]), column = Number(cellTarget[2]);
        const cells = Array.from({length:ship.size}, (_,index) => fleetOrientation === 'horizontal'
          ? [column + index,row] : [column,row + index]);
        const occupied = new Set(fleetDraft.flatMap(item => item.cells.map(cell => `${cell[0]},${cell[1]}`)));
        const fits = cells.every(([x,y]) => x >= 0 && x < 10 && y >= 0 && y < 10 && !occupied.has(`${x},${y}`) &&
          !Array.from({length:3}, (_,dy) => dy - 1).some(dy =>
            Array.from({length:3}, (_,dx) => dx - 1).some(dx => occupied.has(`${x+dx},${y+dy}`))));
        if (fits) {
          fleetDraft.push({key:ship.key,cells});
          const nextShip = battleshipFleet.find(item => !fleetDraft.some(placement => placement.key === item.key));
          selectedShip = nextShip?.key || null;
          if (fleetDraft.length === battleshipFleet.length) {
            placementMove = {type:'place',ships:battleshipFleet.map(item => ({
              name:item.name,cells:fleetDraft.find(placement => placement.key === item.key).cells
            }))};
          }
        }
      }
      placedFleetKeys = new Set(fleetDraft.map(placement => placement.key));
      availableFleet = battleshipFleet.filter(item => !placedFleetKeys.has(item.key));
      if (!availableFleet.some(item => item.key === selectedShip)) selectedShip = availableFleet[0]?.key || null;
    }
    const selectFrom = (moves, from, position) => {
      const origins = new Map(moves.map(move => {const cell=from(move);return [`${cell.r}_${cell.c}`,cell];}));
      const requested = /^select_(\d+_\d+)$/.exec(eventId)?.[1];
      const retained = localState?.move_count === m.move_count && localState?.viewer === mySeat ? localState.selectedFrom : null;
      selectedFrom = origins.has(requested) ? requested : origins.has(retained) ? retained : null;
      for (const [key, cell] of origins) scene.targets.push({id:`select_${key}`,board:'main',position:position(cell),label:key===selectedFrom?'◉':'◇',aria_label:text('Select piece at row {r}, column {c}', {r:cell.r+1,c:cell.c+1})});
      return moves.filter(move => {const cell=from(move);return `${cell.r}_${cell.c}`===selectedFrom;});
    };

    if (KIND === 'battleship') {
      const left = {x: 20, y: 120}, right = {x: 435, y: 120};
      scene.labels.push({id: 'own-title', text: text('Your fleet'), x: left.x, y: 84, font_size: 18});
      scene.labels.push({id: 'target-title', text: text('Target waters'), x: right.x, y: 84, font_size: 18});
      const me = mySeat, opponent = 1 - me;
      const ownShips = (s.boards && s.boards[me] && s.boards[me].ships) || [];
      const ownCells = new Set();
      for (const ship of ownShips) for (const c of ship.cells || []) ownCells.add(`${c[0]},${c[1]}`);
      for (const ship of fleetDraft) for (const c of ship.cells) ownCells.add(`${c[0]},${c[1]}`);
      const revealedShips = (s.boards && s.boards[opponent] && s.boards[opponent].ships) || [];
      const revealedCells = new Set();
      for (const ship of revealedShips) for (const c of ship.cells || []) revealedCells.add(`${c[0]},${c[1]}`);
      for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
        const pos = {cell: String(r * 10 + c)};
        const ownAttack = s.attacks && s.attacks[me] ? s.attacks[me][r][c] : 0;
        const enemyAttack = s.attacks && s.attacks[opponent] ? s.attacks[opponent][r][c] : 0;
        const ownMark = ownAttack === 2 ? '✹' : ownAttack === 1 ? '·' : ownCells.has(`${c},${r}`) ? '■' : '';
        const ownType = ownAttack === 2 ? 'mark_hit' : ownAttack === 1 ? 'mark_miss' :
          ownCells.has(`${c},${r}`) ? 'mark_ship' : 'mark_water';
        staticPiece(`own_${r}_${c}`, ownType, 'own', pos, {text: ownMark});
        const revealedShip = revealedCells.has(`${c},${r}`);
        const targetMark = enemyAttack === 2 ? '✹' : enemyAttack === 1 ? '·' : revealedShip ? '■' : '';
        if (active && s.phase === 'BATTLE' && enemyAttack === 0) {
          intent({type: 'fire', x: c, y: r}, '•', 'target', pos, 'target');
        } else {
          const targetType = revealedShip ? 'mark_revealed_ship' :
            enemyAttack === 2 ? 'mark_hit' : enemyAttack === 1 ? 'mark_miss' : 'mark_water';
          staticPiece(`target_${r}_${c}`, targetType,
            'target', pos, {text: targetMark});
        }
      }
      if (active && fleetSetup) {
        for (const ship of availableFleet) {
          const selectedMark = ship.key === selectedShip ? '▶ ' : '';
          scene.controls.push({id:`fleet_ship_${ship.key}`,kind:'button',
            label:selectedMark + text('{ship} ({length})',{ship:text(ship.name),length:ship.size})});
        }
        scene.controls.push({id:'fleet_direction_horizontal',kind:'button',
          label:(fleetOrientation === 'horizontal' ? '✓ ' : '') + text('Horizontal')});
        scene.controls.push({id:'fleet_direction_vertical',kind:'button',
          label:(fleetOrientation === 'vertical' ? '✓ ' : '') + text('Vertical')});
        if (fleetDraft.length) scene.controls.push({id:'fleet_undo',kind:'button',label:text('Undo last ship')});
        const ship = battleshipFleet.find(item => item.key === selectedShip);
        if (ship) {
          for (let row = 0; row < 10; row++) for (let column = 0; column < 10; column++) {
            const cells = Array.from({length:ship.size}, (_,index) => fleetOrientation === 'horizontal'
              ? [column + index,row] : [column,row + index]);
            const occupied = new Set(fleetDraft.flatMap(item => item.cells.map(cell => `${cell[0]},${cell[1]}`)));
            const fits = cells.every(([x,y]) => x >= 0 && x < 10 && y >= 0 && y < 10 && !occupied.has(`${x},${y}`) &&
              !Array.from({length:3}, (_,dy) => dy - 1).some(dy =>
                Array.from({length:3}, (_,dx) => dx - 1).some(dx => occupied.has(`${x+dx},${y+dy}`))));
            if (!fits) continue;
            const preview = cells.map(([x,y]) => ({position:{cell:String(y * 10 + x)},color:'#a9b5c4aa'}));
            scene.targets.push({id:`fleet_place_${row}_${column}`,board:'own',position:{cell:String(row * 10 + column)},
              label:'•',aria_label:text('Place {ship} at row {row}, column {column}',
                {ship:text(ship.name),row:row+1,column:column+1}),preview});
          }
        }
        label('setup-progress', text('Ships placed: {placed} of 5',{placed:fleetDraft.length}), 22, 534, 15);
        label('setup-help', text('Choose a ship and direction, then tap a highlighted square to place it. Ships cannot touch.'), 22, 558, 14);
        intent({type:'auto_place'}, text('Random fleet'), null, null, 'control');
      }
    } else if (KIND === 'checkers') {
      const board = s.board || [];
      const moves = legal ? (s.moves || []) : [];
      const snapshot = board.map(row => row.map(piece => piece ? `${piece.c}:${piece.k ? 1 : 0}` : null));
      const previousBoard = localState && localState.checkers_board;
      const previousIds = localState && localState.checkers_ids;
      let pieceIds = {};
      if (Array.isArray(previousBoard) && previousIds && typeof previousIds === 'object' && !Array.isArray(previousIds) &&
          JSON.stringify(previousBoard) === JSON.stringify(snapshot)) {
        pieceIds = Object.assign({}, previousIds);
      } else {
        const last = s.lastMove;
        const from = last && last.from, to = last && last.to;
        const inBounds = p => p && Number.isInteger(p.r) && Number.isInteger(p.c) &&
          p.r >= 0 && p.r < 8 && p.c >= 0 && p.c < 8;
        const fromKey = inBounds(from) ? `${from.r},${from.c}` : '';
        const toKey = inBounds(to) ? `${to.r},${to.c}` : '';
        const adjacentState = Number.isInteger(localState?.move_count) &&
          Number.isInteger(m.move_count) && localState.move_count + 1 === m.move_count;
        const canCarry = Array.isArray(previousBoard) && previousIds && typeof previousIds === 'object' && !Array.isArray(previousIds) &&
          adjacentState && inBounds(from) && inBounds(to) && previousBoard[from.r]?.[from.c] != null &&
          snapshot[from.r]?.[from.c] === null && snapshot[to.r]?.[to.c] != null && previousIds[fromKey];
        if (canCarry) {
          pieceIds = Object.assign({}, previousIds);
          const movedId = pieceIds[fromKey];
          delete pieceIds[fromKey];
          delete pieceIds[toKey];
          pieceIds[toKey] = movedId;
        }
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
          const key = `${r},${c}`;
          if (snapshot[r]?.[c] == null) delete pieceIds[key];
          else if (!pieceIds[key]) pieceIds[key] = key.replace(',', '_');
        }
      }
      presentationState.checkers_board = snapshot;
      presentationState.checkers_ids = pieceIds;
      board.forEach((row, r) => row.forEach((piece, c) => {
        if (!piece) return;
        const owner = piece.c === 0 ? 'p0' : 'p1';
        staticPiece(`checker_${pieceIds[`${r},${c}`]}`, piece.k ? 'king_' + owner : owner, 'main',
          {cell: String(r * 8 + c)}, {text: piece.k ? '♛' : ''});
      }));
      selectFrom(moves,move=>move.from,cell=>({cell:String(cell.r*8+cell.c)})).forEach(move => intent({from: move.from, to: move.to}, move.cap ? '×' : '•', 'main',
        {cell: String(move.to.r * 8 + move.to.c)}, 'target'));
      label('chain', s.chain ? text('Continue the capture with the highlighted checker.') :
        (moves.some(mv => mv.cap) ? text('A capture is required.') : text('Move diagonally; kings move either direction.')), 22, 670);
    } else if (KIND === 'chess' || KIND === 'four_player_chess') {
      const size = KIND === 'chess' ? 8 : 14;
      const boardId = 'main';
      const board = KIND === 'chess' ? (s.bd || []) : s.board || {};
      const symbols = {wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'};
      const fourSymbols = {K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙'};
      if (KIND === 'chess') {
        const pieceNames = {1:'P', 2:'N', 3:'B', 4:'R', 5:'Q', 6:'K'};
        const snapshot = board.map(piece => Number(piece) || 0);
        const previousBoard = localState && localState.chess_board;
        const previousIds = localState && localState.chess_ids;
        let pieceIds = {};
        if (Array.isArray(previousBoard) && previousIds && typeof previousIds === 'object' && !Array.isArray(previousIds) &&
            JSON.stringify(previousBoard) === JSON.stringify(snapshot)) {
          pieceIds = Object.assign({}, previousIds);
        } else {
          const last = s.lastMove;
          const inBounds = value => Number.isInteger(value) && value >= 0 && value < 8;
          const valid = last && inBounds(last.fr) && inBounds(last.fc) && inBounds(last.tr) && inBounds(last.tc);
          const fromIndex = valid ? last.fr * 8 + last.fc : -1;
          const toIndex = valid ? last.tr * 8 + last.tc : -1;
          const oldPiece = valid && Array.isArray(previousBoard) ? previousBoard[fromIndex] : 0;
          const newPiece = valid ? snapshot[toIndex] : 0;
          const adjacentState = Number.isInteger(localState?.move_count) &&
            Number.isInteger(m.move_count) && localState.move_count + 1 === m.move_count;
          const canCarry = adjacentState && valid && Array.isArray(previousBoard) && previousIds && typeof previousIds === 'object' && !Array.isArray(previousIds) && oldPiece &&
            snapshot[fromIndex] === 0 && newPiece && Math.sign(oldPiece) === Math.sign(newPiece) &&
            previousIds[String(fromIndex)];
          if (canCarry) {
            pieceIds = Object.assign({}, previousIds);
            const movedId = pieceIds[String(fromIndex)];
            delete pieceIds[String(fromIndex)];
            delete pieceIds[String(toIndex)];
            pieceIds[String(toIndex)] = movedId;
            if (Math.abs(oldPiece) === 6 && Math.abs(last.fc - last.tc) === 2) {
              const rookFrom = last.fr * 8 + (last.tc > last.fc ? 7 : 0);
              const rookTo = last.fr * 8 + (last.tc > last.fc ? 5 : 3);
              if (previousBoard[rookFrom] === Math.sign(oldPiece) * 4 && snapshot[rookFrom] === 0 &&
                  snapshot[rookTo] === Math.sign(oldPiece) * 4 && pieceIds[String(rookFrom)]) {
                pieceIds[String(rookTo)] = pieceIds[String(rookFrom)];
                delete pieceIds[String(rookFrom)];
              }
            }
          }
          for (let index = 0; index < 64; index++) {
            if (!snapshot[index]) delete pieceIds[String(index)];
            else if (!pieceIds[String(index)]) pieceIds[String(index)] = String(index);
          }
        }
        presentationState.chess_board = snapshot;
        presentationState.chess_ids = pieceIds;
        board.forEach((piece, index) => {
          if (!piece) return;
          const r = Math.floor(index / 8), c = index % 8;
          const name = pieceNames[Math.abs(piece)] || 'P';
          const code = `${piece > 0 ? 'w' : 'b'}${name}`;
          staticPiece(`chess_${pieceIds[String(index)]}`, piece > 0 ? 'white_piece' : 'black_piece', boardId,
            {cell: String(index)}, {text: symbols[code] || name});
        });
      } else {
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
          if (KIND === 'four_player_chess' && !((r >= 3 && r <= 10) || (c >= 3 && c <= 10))) continue;
          const pos = KIND === 'chess' ? {cell: String(r * size + c)} : {x: 21 + c * 42, y: 21 + r * 42};
          const squareType = (r + c) % 2 ? 'square_dark' : 'square_light';
          if (KIND === 'four_player_chess') staticPiece(`square_${r}_${c}`, squareType, boardId, pos);
        }
        for (const [square, piece] of Object.entries(board)) {
          const [r, c] = square.split(',').map(Number);
          if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
          const type = Number(piece.o) || 0;
          staticPiece(`piece_${r}_${c}`, `seat_${type}`, boardId, {x: 21 + c * 42, y: 21 + r * 42},
            {text: fourSymbols[piece.t] || piece.t});
        }
      }
      const legalMoves = legal ? (s.legalMoves || []) : [];
      const selectedMoves = selectFrom(legalMoves,move=>({r:move.fr,c:move.fc}),cell=>KIND==='chess'?{cell:String(cell.r*size+cell.c)}:{x:21+cell.c*42,y:21+cell.r*42});
      for (const mv of selectedMoves) {
        const move = KIND === 'chess'
          ? {fr: mv.fr, fc: mv.fc, tr: mv.tr, tc: mv.tc, ...(mv.promo ? {promo: mv.promo} : {})}
          : {kind: 'move', fr: mv.fr, fc: mv.fc, tr: mv.tr, tc: mv.tc};
        const position = KIND === 'chess' ? {cell: String(mv.tr * size + mv.tc)} :
          {x: 21 + mv.tc * 42, y: 21 + mv.tr * 42};
        if (KIND === 'chess' && mv.promo) {
          const files = 'abcdefgh';
          const promotionNames = {Q: text('queen'), R: text('rook'), B: text('bishop'), N: text('knight')};
          intent(move, text('Promote at {square} to {piece}', {square:files[mv.tc]+(size-mv.tr),piece:promotionNames[mv.promo]||mv.promo}),
            null, null, 'control');
        } else intent(move, '•', boardId, position, 'target');
      }
      if (KIND === 'four_player_chess' && active && !(s.legalMoves || []).length && s.winnerTeam === null) {
        intent({kind: s.inCheck ? 'elim' : 'pass'}, s.inCheck ? text('Eliminate this army') : text('Pass (no legal move)'),
          null, null, 'control');
      }
      if (KIND === 'chess' && s.winner === null && active) {
        intent({resign: true}, text('Resign'), null, null, 'control');
      }
    } else if (KIND === 'quoridor') {
      const cells = [];
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        const x = 44 + c * 54, y = 112 + r * 54;
        cells.push({r, c, x, y});
        staticPiece(`square_${r}_${c}`, 'square', 'main', {x, y}, {text: ''});
      }
      (s.walls || []).forEach((w, i) => {
        if (w.o === 'H') scene.paths.push({id: `wall_${i}`, points: [
          {x: 44 + w.c * 54, y: 112 + (w.r + 0.5) * 54},
          {x: 44 + (w.c + 2) * 54, y: 112 + (w.r + 0.5) * 54}], color: '#fbbf24', width: 10});
        else scene.paths.push({id: `wall_${i}`, points: [
          {x: 44 + (w.c + 0.5) * 54, y: 112 + w.r * 54},
          {x: 44 + (w.c + 0.5) * 54, y: 112 + (w.r + 2) * 54}], color: '#fbbf24', width: 10});
      });
      for (let seat = 0; seat < (s.pawns || []).length; seat++) {
        const p = s.pawns[seat];
        staticPiece(`pawn_${seat}`, seat === 0 ? 'p0' : 'p1', 'main',
          {x: 44 + p.c * 54, y: 112 + p.r * 54}, {text: seat === 0 ? '1' : '2'});
      }
      const mode = eventId === 'mode_wall' ? 'wall' : eventId === 'mode_pawn' ? 'pawn' :
        localState && localState.move_count === m.move_count && localState.mode === 'wall' ? 'wall' : 'pawn';
      selectedMode = mode;
      if (active) {
        scene.controls.push({id: 'mode_pawn', kind: 'button', label: (mode === 'pawn' ? '✓ ' : '') + text('Move pawn')});
        scene.controls.push({id: 'mode_wall', kind: 'button', label: (mode === 'wall' ? '✓ ' : '') + text('Place wall')});
        if (mode === 'pawn') (s.legalMoves || []).forEach(([r, c]) =>
          intent({type: 'pawn', r, c}, '•', 'main', {x: 44 + c * 54, y: 112 + r * 54}, 'target'));
        else (s.legalWalls || []).forEach(w => intent({type: 'wall', r: w.r, c: w.c, o: w.o},
          w.o === 'H' ? '—' : '│', 'main', w.o === 'H'
            ? {x: 44 + (w.c + 1) * 54, y: 112 + (w.r + 0.5) * 54}
            : {x: 44 + (w.c + 0.5) * 54, y: 112 + (w.r + 1) * 54}, 'target'));
      }
      label('walls-left', text('Walls remaining · {counts}', {counts:s.wallsLeft ? s.wallsLeft.join(' / ') : ''}), 22, 614);
      if (message.type === 'ui_event' && active && (eventId === 'mode_pawn' || eventId === 'mode_wall')) {
        selectedMode = eventId === 'mode_wall' ? 'wall' : 'pawn';
        return {scene, local_state: {mode:selectedMode,move_count:m.move_count,
          intent_ids:offers.map((move,i)=>({id:`intent_${i}`,move}))}};
      }
    } else if (KIND === 'crazy_eights') {
      staticPiece('stock_pile','stock','table',{x:565,y:57},{count:s.deckCount||0});
      label('table', text('Top card {card} · suit {suit} · {n} cards to draw', {card:cardText(cardFromNumber(s.top)),suit:SUITS[s.suit]||'',n:s.deckCount||0}), 22, 94, 16);
      const hand = Array.isArray(s.hand) ? s.hand : [];
      const playable = new Set(s.playable || []);
      hand.forEach((card, i) => {
        const r = card % 13 + 1, labelText = cardText(cardFromNumber(card));
        if (playable.has(card)) {
          if (r === 8) {
            staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text: labelText});
            for (let chosenSuit = 0; chosenSuit < 4; chosenSuit++)
              intent({card, chosenSuit}, text('Play {card} as {suit}', {card:labelText,suit:SUITS[chosenSuit]}), null, null, 'control');
          } else intent({card}, text('Play {card}', {card:labelText}), 'table', cardPos(i), 'piece');
        } else staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text: labelText});
      });
      if (active) intent('draw', text('Draw a card ({n} left)', {n:s.deckCount||0}), null, null, 'control');
    } else if (KIND === 'go_fish') {
      staticPiece('stock_pile','stock','table',{x:565,y:57},{count:s.deckCount||0});
      const hand = Array.isArray(s.hand) ? s.hand : [];
      hand.forEach((card, i) => staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text: cardText(card)}));
      const rankSet = [...new Set(hand.map(card => String(card).replace(/[♠♥♦♣]$/, '')))].sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b));
      for (let seat = 0; seat < playerNames.length; seat++) if (active && seat !== mySeat) {
        for (const rank of rankSet) intent({target: seat, rank}, text('Ask {name} for {rank}', {name:playerNames[seat],rank}), null, null, 'control');
      }
      if (active && hand.length === 0) {
        if (s.deckCount > 0) intent({draw: true}, text('Draw cards'), null, null, 'control');
        else intent({pass: true}, text('Pass'), null, null, 'control');
      }
      (s.books || []).forEach((books, seat) => label(`books_${seat}`, text('{name} · books {ranks}', {name:playerNames[seat]||text('Player {n}', {n:seat+1}),ranks:(books||[]).join(', ')||'—'}),
        24, 460 + seat * 25, 14));
    } else if (KIND === 'hearts' || KIND === 'spades') {
      const isHearts = KIND === 'hearts';
      const hand = Array.isArray(s.hand) ? s.hand : [];
      const current = isHearts ? s.cur : s.current;
      const trick = s.trick || [];
      const legalCards = isHearts ? new Set(s.legal || []) :
        (s.pendingWin !== null && s.pendingWin !== undefined ? new Set() : new Set(hand));
      hand.forEach((card, i) => {
        const moves = legalCards.has(card) ? [{card}] : [];
        if (moves.length) intent(moves[0], cardText(card), 'table', cardPos(i), 'piece');
        else staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text: cardText(card)});
      });
      trick.forEach((play, i) => staticPiece(`trick_${i}`, 'played', 'table',
        {x: 300 + (play.player ?? play.seat) * 72, y: 400}, {text: cardText(play.card)}));
      if (KIND === 'spades' && s.pendingWin !== null && s.pendingWin !== undefined && active)
        intent({collect: true}, text('Collect trick'), null, null, 'control');
      const scores = isHearts ? s.taken : s.tricksWon;
      if (Array.isArray(scores)) scores.forEach((score, seat) =>
        label(`score_${seat}`, `${playerNames[seat] || text('Player {n}', {n:seat + 1})} · ${score}`, 22 + seat * 170, 92, 14));
    } else if (KIND === 'guess_who') {
      const names = CHARACTER_NAMES;
      const secret = Number.isInteger(s.mySecret) ? text('Your character: {name}', {name:names[s.mySecret]}) : text('Your character is private');
      label('your-secret', secret, 22, 88, 18);
      for (let i = 0; i < names.length; i++) {
        const description = names[i]+': '+QUESTIONS.map((question,q)=>text(question)+' '+text(SOURCE_CHARACTER_ANSWERS[i][q]?'Yes':'No')).join('; ');
        if (active) intent({kind:'guess',idx:i}, names[i], 'main', {cell:String(i)}, `person_${i}`, description);
        else staticPiece(`person_${i}`, `person_${i}`, 'main', {cell:String(i)}, {text:names[i],aria_label:description});
      }
      const asked = new Set((s.hist || []).filter(item => item.by === mySeat && Number.isInteger(item.q)).map(item => item.q));
      if (active) QUESTIONS.forEach((question, q) => {
        if (!asked.has(q)) intent({kind: 'ask', q}, text('Ask: {question}', {question:text(question)}), null, null, 'control');
      });
      (s.hist || []).slice(-8).forEach((item, i) => {
        const who = playerNames[item.by] || text('Player {n}', {n:item.by + 1});
        const historyText = Number.isInteger(item.q) ? `${who}: ${text(QUESTIONS[item.q])} · ${item.ans ? text('Yes') : text('No')}` :
          text('{name}: guessed {character} · {result}', {name:who,character:names[item.guess]||'—',result:item.correct?text('correct'):text('incorrect')});
        label(`history_${i}`, historyText, 22, 520 + i * 18, 13);
      });
    }

    const emitted = intentMatch && legal ? offers[Number(intentMatch[1])] : undefined;
    const nextLocal = Object.assign({intent_ids:offers.map((move,i)=>({id:`intent_${i}`,move})),selectedFrom,move_count:m.move_count,viewer:mySeat},presentationState);
    if (KIND === 'battleship' && fleetSetup) Object.assign(nextLocal,{
      phase:'SETUP',fleetDraft,selectedShip,orientation:fleetOrientation
    });
    if (message.type === 'ui_event' && active && placementMove)
      return {scene,local_state:nextLocal,make_move:placementMove};
    if (message.type === 'ui_event' && active && emitted !== undefined) {
      if (KIND === 'quoridor') Object.assign(nextLocal,{mode:selectedMode,move_count:m.move_count});
      return {scene, local_state: nextLocal, make_move: emitted};
    }
    if (KIND === 'quoridor') Object.assign(nextLocal,{mode:selectedMode,move_count:m.move_count});
    return {scene, local_state: nextLocal};
  }
};

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
function cardFromNumber(value) {
  const suit = Math.floor(Number(value) / 13), rank = Number(value) % 13 + 1;
  return `${RANKS[(rank + 12) % 13]}${SUITS[suit] || ''}`;
}
const QUESTIONS = ['Are they wearing glasses?', 'Are they wearing a hat?', 'Do they have facial hair?',
  'Are their ears showing?', 'Do they have blonde hair?', 'Do they have brown hair?',
  'Do they have black hair?', 'Do they have red hair?', 'Do they have gray hair?',
  'Do they have long hair?', 'Do they have short hair?', 'Do they have blue eyes?',
  'Do they have brown eyes?', 'Do they have green eyes?'];
const CHARACTER_NAMES = ['Ava', 'Ben', 'Cleo', 'Dan', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivan', 'Jade', 'Kai', 'Lena',
  'Max', 'Nora', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Umar', 'Vera', 'Will', 'Yuki'];
