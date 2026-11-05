const game = {
  newMatch(ctx) {
    const board = Array(64).fill(null);
    board[27] = 1; board[36] = 1;
    board[28] = 0; board[35] = 0;
    const state = { board, turn: 0, done: false, winner: null };
    return { state, turn: [ctx.players[0].id] };
  },
  flips(board, seat, cell) {
    if (cell < 0 || cell >= 64 || board[cell] !== null) return [];
    const out = [];
    const r0 = Math.floor(cell / 8), c0 = cell % 8;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      let r = r0 + dr, c = c0 + dc;
      const line = [];
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === 1 - seat) { line.push(r * 8 + c); r += dr; c += dc; }
      if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === seat) out.push(...line);
    }
    return out;
  },
  legalMoves(board, seat) {
    const moves = [];
    for (let i = 0; i < 64; i++) if (this.flips(board, seat, i).length) moves.push(i);
    return moves;
  },
  counts(board) {
    let black = 0, white = 0;
    for (const x of board) { if (x === 0) black++; else if (x === 1) white++; }
    return { black, white };
  },
  payoutsFor(state, ctx) {
    const humans = ctx.players.filter(p => p.kind === 'human');
    const payouts = {};
    if (!humans.length || ctx.pot <= 0) { for (const h of humans) payouts[h.id] = 0; return payouts; }
    const split = (ids) => { const base = Math.floor(ctx.pot / ids.length); let rem = ctx.pot - base * ids.length; for (const id of ids) { payouts[id] = base + (rem > 0 ? 1 : 0); if (rem > 0) rem--; } };
    const winnerId = state.winner !== null && state.winner !== undefined ? ctx.players[state.winner].id : null;
    const winnerIsHuman = winnerId && humans.some(h => h.id === winnerId);
    if (state.winner === null || state.winner === undefined || !winnerIsHuman) {
      split(humans.map(h => h.id));
    } else {
      for (const h of humans) payouts[h.id] = h.id === winnerId ? ctx.pot : 0;
    }
    return payouts;
  },
  applyMove(state, playerId, move, ctx) {
    const seat = ctx.players.findIndex(p => p.id === playerId);
    if (seat < 0) throw new InvalidMove('Unknown player');
    if (state.done) throw new InvalidMove('Match is over');
    if (seat !== state.turn) throw new InvalidMove('Not your turn');
    const cell = move && move.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell >= 64) throw new InvalidMove('Pick a square');
    const captured = this.flips(state.board, seat, cell);
    if (!captured.length) throw new InvalidMove('Illegal square: must flip at least one disc');
    const board = state.board.slice();
    board[cell] = seat;
    for (const i of captured) board[i] = seat;
    let turn = this.legalMoves(board, 1 - seat).length ? 1 - seat : seat;
    let done = !this.legalMoves(board, turn).length;
    let winner = null;
    if (done) {
      const { black, white } = this.counts(board);
      winner = black === white ? null : black > white ? 0 : 1;
    }
    const next = { board, turn, done, winner };
    if (done) return { state: next, turn: null, payouts: this.payoutsFor(next, ctx) };
    return { state: next, turn: [ctx.players[turn].id] };
  },
  computerMove(state, playerId, ctx) {
    const moves = this.legalMoves(state.board, state.turn);
    let best = moves[0], bestScore = -1e9;
    for (const m of moves) {
      const corners = [0, 7, 56, 63];
      let s = this.flips(state.board, state.turn, m).length;
      if (corners.includes(m)) s += 100;
      else if ([1,6,8,9,14,15,48,49,55,57,62].includes(m)) s -= 20;
      s += ctx.random() * 2;
      if (s > bestScore) { bestScore = s; best = m; }
    }
    return { cell: best };
  },
  randomMove(state, playerId, ctx) {
    const moves = this.legalMoves(state.board, state.turn);
    return { cell: moves[Math.floor(ctx.random() * moves.length)] };
  },
  viewFor(state, playerId, ctx) {
    const { black, white } = this.counts(state.board);
    const legalMoves = state.done ? [] : this.legalMoves(state.board, state.turn);
    const turn = state.done ? [] : [ctx.players[state.turn].id];
    return { board: state.board.slice(), turn, done: state.done, winner: state.winner, legalMoves, black, white };
  }
};