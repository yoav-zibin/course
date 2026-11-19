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
    let selectedMode = 'pawn';
    const playerNames = (m.players || []).map((p, i) => p.name || `Player ${i + 1}`);
    const mySeat = Number.isInteger(m.my_player_index) ? m.my_player_index : 0;
    const title = SOURCE_STRINGS.title || KIND;
    const turnSeat = Number.isInteger(s.turnIdx) ? s.turnIdx :
      Number.isInteger(s.current) ? s.current : Number.isInteger(s.toMove) ? s.toMove : null;
    scene.labels.push({id: 'title', text: title, x: 22, y: 16, font_size: 26});
    if (turnSeat !== null) {
      scene.labels.push({id: 'status', text: active ? `Your turn · ${playerNames[turnSeat] || `Player ${turnSeat + 1}`}` :
        (m.status === 'over' ? 'Game over' : `${playerNames[turnSeat] || `Player ${turnSeat + 1}`} to play`),
        x: 22, y: 52, font_size: 17});
    }
    if (m.status === 'over' && Number.isInteger(s.winner)) {
      scene.labels.push({id: 'winner', text: `Winner: ${playerNames[s.winner] || `Player ${s.winner + 1}`}`,
        x: 22, y: 78, font_size: 16});
    }
    const intent = (move, label, surface, position, presentation) => {
      if (!active) return null;
      const id = `intent_${offers.length}`;
      offers.push(move);
      if (presentation === 'piece') {
        scene.pieces.push({id, type: 'card', board: surface, position, text: label,
          actions: ['tap']});
      } else if (presentation === 'target') {
        scene.targets.push({id, board: surface, position, label: label || '•'});
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
    const eventId = message.type === 'ui_event' ? String((message.event || {}).id || '') : '';
    const intentMatch = /^intent_(\d+)$/.exec(eventId);

    if (KIND === 'battleship') {
      const left = {x: 20, y: 120}, right = {x: 435, y: 120};
      scene.labels.push({id: 'own-title', text: 'Your fleet', x: left.x, y: 84, font_size: 18});
      scene.labels.push({id: 'target-title', text: 'Target waters', x: right.x, y: 84, font_size: 18});
      const me = mySeat, opponent = 1 - me;
      const ownShips = (s.boards && s.boards[me] && s.boards[me].ships) || [];
      const ownCells = new Set();
      for (const ship of ownShips) for (const c of ship.cells || []) ownCells.add(`${c[0]},${c[1]}`);
      for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) {
        const pos = {cell: String(r * 10 + c)};
        const ownAttack = s.attacks && s.attacks[me] ? s.attacks[me][r][c] : 0;
        const enemyAttack = s.attacks && s.attacks[opponent] ? s.attacks[opponent][r][c] : 0;
        const ownMark = ownAttack === 2 ? '✹' : ownAttack === 1 ? '·' : ownCells.has(`${c},${r}`) ? '■' : '';
        const ownType = ownAttack === 2 ? 'mark_hit' : ownAttack === 1 ? 'mark_miss' :
          ownCells.has(`${c},${r}`) ? 'mark_ship' : 'mark_water';
        staticPiece(`own_${r}_${c}`, ownType, 'own', pos, {text: ownMark});
        const targetMark = enemyAttack === 2 ? '✹' : enemyAttack === 1 ? '·' : '';
        if (active && s.phase === 'BATTLE' && enemyAttack === 0) {
          intent({type: 'fire', x: c, y: r}, '•', 'target', pos, 'target');
        } else {
          staticPiece(`target_${r}_${c}`, enemyAttack === 2 ? 'mark_hit' : enemyAttack === 1 ? 'mark_miss' : 'mark_water',
            'target', pos, {text: targetMark});
        }
      }
      if (active && s.phase === 'SETUP') {
        const ships = [
          {name: 'Carrier', cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]},
          {name: 'Battleship', cells: [[0, 2], [1, 2], [2, 2], [3, 2]]},
          {name: 'Cruiser', cells: [[0, 4], [1, 4], [2, 4]]},
          {name: 'Submarine', cells: [[0, 6], [1, 6], [2, 6]]},
          {name: 'Destroyer', cells: [[0, 8], [1, 8]]}
        ];
        intent({type: 'place', ships}, 'Place fleet and start battle', null, null, 'control');
        label('setup-help', 'Places a valid fleet with clear water between ships.', 22, 594, 14);
      }
    } else if (KIND === 'checkers') {
      const board = s.board || [];
      const moves = legal ? (s.moves || []) : [];
      const moveTargets = new Set(moves.map(mv => `${mv.to.r},${mv.to.c}`));
      board.forEach((row, r) => row.forEach((piece, c) => {
        if (!piece) return;
        const owner = piece.c === 0 ? 'p0' : 'p1';
        staticPiece(`piece_${r}_${c}`, piece.k ? 'king_' + owner : owner, 'main',
          {cell: String(r * 8 + c)}, {text: piece.k ? '♛' : ''});
      }));
      moves.forEach(move => intent({from: move.from, to: move.to}, move.cap ? '×' : '•', 'main',
        {cell: String(move.to.r * 8 + move.to.c)}, 'target'));
      label('chain', s.chain ? 'Continue the capture with the highlighted checker.' :
        (moves.some(mv => mv.cap) ? 'A capture is required.' : 'Move diagonally; kings move either direction.'), 22, 670);
    } else if (KIND === 'chess' || KIND === 'four_player_chess') {
      const size = KIND === 'chess' ? 8 : 14;
      const boardId = 'main';
      const board = KIND === 'chess' ? (s.bd || []) : s.board || {};
      const symbols = {wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟'};
      const fourSymbols = {K:'♔',Q:'♕',R:'♖',B:'♗',N:'♘',P:'♙'};
      if (KIND === 'chess') {
        const pieceNames = {1:'P', 2:'N', 3:'B', 4:'R', 5:'Q', 6:'K'};
        board.forEach((piece, index) => {
          if (!piece) return;
          const r = Math.floor(index / 8), c = index % 8;
          const name = pieceNames[Math.abs(piece)] || 'P';
          const code = `${piece > 0 ? 'w' : 'b'}${name}`;
          staticPiece(`piece_${r}_${c}`, piece > 0 ? 'white_piece' : 'black_piece', boardId,
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
      for (const mv of legalMoves) {
        const move = KIND === 'chess'
          ? {fr: mv.fr, fc: mv.fc, tr: mv.tr, tc: mv.tc, ...(mv.promo ? {promo: mv.promo} : {})}
          : {kind: 'move', fr: mv.fr, fc: mv.fc, tr: mv.tr, tc: mv.tc};
        const position = KIND === 'chess' ? {cell: String(mv.tr * size + mv.tc)} :
          {x: 21 + mv.tc * 42, y: 21 + mv.tr * 42};
        if (KIND === 'chess' && mv.promo) {
          const files = 'abcdefgh';
          const promotionNames = {Q: 'queen', R: 'rook', B: 'bishop', N: 'knight'};
          intent(move, `Promote at ${files[mv.tc]}${size - mv.tr} to ${promotionNames[mv.promo] || mv.promo}`,
            null, null, 'control');
        } else intent(move, '•', boardId, position, 'target');
      }
      if (KIND === 'four_player_chess' && active && !(s.legalMoves || []).length && s.winnerTeam === null) {
        intent({kind: s.inCheck ? 'elim' : 'pass'}, s.inCheck ? 'Eliminate this army' : 'Pass (no legal move)',
          null, null, 'control');
      }
      if (KIND === 'chess' && s.winner === null && active) {
        intent({resign: true}, 'Resign', null, null, 'control');
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
        scene.controls.push({id: 'mode_pawn', kind: 'button', label: mode === 'pawn' ? '✓ Move pawn' : 'Move pawn'});
        scene.controls.push({id: 'mode_wall', kind: 'button', label: mode === 'wall' ? '✓ Place wall' : 'Place wall'});
        if (mode === 'pawn') (s.legalMoves || []).forEach(([r, c]) =>
          intent({type: 'pawn', r, c}, '•', 'main', {x: 44 + c * 54, y: 112 + r * 54}, 'target'));
        else (s.legalWalls || []).forEach(w => intent({type: 'wall', r: w.r, c: w.c, o: w.o},
          w.o === 'H' ? '—' : '│', 'main', w.o === 'H'
            ? {x: 44 + (w.c + 1) * 54, y: 112 + (w.r + 0.5) * 54}
            : {x: 44 + (w.c + 0.5) * 54, y: 112 + (w.r + 1) * 54}, 'target'));
      }
      label('walls-left', `Walls remaining · ${s.wallsLeft ? s.wallsLeft.join(' / ') : ''}`, 22, 614);
      if (message.type === 'ui_event' && active && (eventId === 'mode_pawn' || eventId === 'mode_wall')) {
        selectedMode = eventId === 'mode_wall' ? 'wall' : 'pawn';
        return {scene, local_state: {mode:selectedMode,move_count:m.move_count,
          intent_ids:offers.map((move,i)=>({id:`intent_${i}`,move}))}};
      }
    } else if (KIND === 'crazy_eights') {
      label('table', `Top card ${cardText(cardFromNumber(s.top))} · suit ${SUITS[s.suit] || ''} · ${s.deckCount || 0} cards to draw`, 22, 94, 16);
      const hand = Array.isArray(s.hand) ? s.hand : [];
      const playable = new Set(s.playable || []);
      hand.forEach((card, i) => {
        const r = card % 13 + 1, labelText = cardText(cardFromNumber(card));
        if (playable.has(card)) {
          if (r === 8) {
            staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text: labelText});
            for (let chosenSuit = 0; chosenSuit < 4; chosenSuit++)
              intent({card, chosenSuit}, `Play ${labelText} as ${SUITS[chosenSuit]}`, null, null, 'control');
          } else intent({card}, `Play ${labelText}`, 'table', cardPos(i), 'piece');
        } else staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text: labelText});
      });
      if (active) intent('draw', `Draw a card (${s.deckCount || 0} left)`, null, null, 'control');
    } else if (KIND === 'go_fish') {
      const hand = Array.isArray(s.hand) ? s.hand : [];
      hand.forEach((card, i) => staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text: cardText(card)}));
      const rankSet = [...new Set(hand.map(card => String(card).replace(/[♠♥♦♣]$/, '')))].sort((a, b) => RANKS.indexOf(a) - RANKS.indexOf(b));
      for (let seat = 0; seat < playerNames.length; seat++) if (active && seat !== mySeat) {
        for (const rank of rankSet) intent({target: seat, rank}, `Ask ${playerNames[seat]} for ${rank}`, null, null, 'control');
      }
      if (active && hand.length === 0) {
        if (s.deckCount > 0) intent({draw: true}, 'Draw cards', null, null, 'control');
        else intent({pass: true}, 'Pass', null, null, 'control');
      }
      (s.books || []).forEach((books, seat) => label(`books_${seat}`, `${playerNames[seat] || `Player ${seat + 1}`} · books ${(books || []).join(', ') || '—'}`,
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
        intent({collect: true}, 'Collect trick', null, null, 'control');
      const scores = isHearts ? s.taken : s.tricksWon;
      if (Array.isArray(scores)) scores.forEach((score, seat) =>
        label(`score_${seat}`, `${playerNames[seat] || `Player ${seat + 1}`} · ${score}`, 22 + seat * 170, 92, 14));
    } else if (KIND === 'guess_who') {
      const names = CHARACTER_NAMES;
      const secret = Number.isInteger(s.mySecret) ? `Your character: ${names[s.mySecret]}` : 'Your character is private';
      label('your-secret', secret, 22, 88, 18);
      for (let i = 0; i < names.length; i++) {
        const row = Math.floor(i / 6), col = i % 6;
        const x = 30 + col * 94, y = 156 + row * 92;
        staticPiece(`person_${i}`, `person_${i % CHARACTER_COLORS.length}`, 'main',
          {cell: String(i)}, {text: names[i]});
        if (active) intent({kind: 'guess', idx: i}, names[i], 'main', {cell: String(i)}, 'target');
      }
      const asked = new Set((s.hist || []).filter(item => item.by === mySeat && Number.isInteger(item.q)).map(item => item.q));
      if (active) QUESTIONS.forEach((question, q) => {
        if (!asked.has(q)) intent({kind: 'ask', q}, `Ask: ${question}`, null, null, 'control');
      });
      (s.hist || []).slice(-8).forEach((item, i) => {
        const who = playerNames[item.by] || `Player ${item.by + 1}`;
        const text = Number.isInteger(item.q) ? `${who}: ${QUESTIONS[item.q]} · ${item.ans ? 'Yes' : 'No'}` :
          `${who}: guessed ${names[item.guess] || '—'} · ${item.correct ? 'correct' : 'incorrect'}`;
        label(`history_${i}`, text, 22, 520 + i * 18, 13);
      });
    }

    const emitted = intentMatch && legal ? offers[Number(intentMatch[1])] : undefined;
    if (message.type === 'ui_event' && active && emitted !== undefined) {
      const nextLocal = {intent_ids:offers.map((move,i)=>({id:`intent_${i}`,move}))};
      if (KIND === 'quoridor') Object.assign(nextLocal,{mode:selectedMode,move_count:m.move_count});
      return {scene, local_state: nextLocal, make_move: emitted};
    }
    const nextLocal = {intent_ids:offers.map((move,i)=>({id:`intent_${i}`,move}))};
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
const CHARACTER_COLORS = ['#60a5fa', '#f472b6', '#a78bfa', '#4ade80', '#fb923c', '#2dd4bf'];
