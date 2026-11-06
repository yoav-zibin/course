const game = {
  ROWS: 4, COLS: 5, WINLEN: 4,
  checkWinner(board) {
    const ROWS = 4, COLS = 5, WINLEN = 4;
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const p = board[r*COLS+c];
      if (p === null || p === undefined) continue;
      for (const [dr,dc] of dirs) {
        let ok = true;
        const line = [];
        for (let k = 0; k < WINLEN; k++) {
          const rr = r+dr*k, cc = c+dc*k;
          if (rr<0||rr>=ROWS||cc<0||cc>=COLS||board[rr*COLS+cc]!==p) { ok=false; break; }
          line.push(rr*COLS+cc);
        }
        if (ok) return { winner: p, line };
      }
    }
    if (board.every(v => v !== null && v !== undefined)) return { winner: 'draw', line: null };
    return { winner: null, line: null };
  },
  emptyCells(board) {
    const out = [];
    for (let i=0;i<board.length;i++) if (board[i]===null||board[i]===undefined) out.push(i);
    return out;
  },
  payoutsForEnd(winner, ctx) {
    const humans = ctx.players.filter(p => p.kind === 'human');
    const payouts = {};
    if (ctx.pot <= 0 || humans.length === 0) return payouts;
    if (winner === 'draw') {
      const share = Math.floor(ctx.pot / humans.length);
      let rem = ctx.pot - share*humans.length;
      for (const h of humans) {
        let a = share;
        if (rem > 0) { a++; rem--; }
        payouts[h.id] = a;
      }
      return payouts;
    }
    const w = ctx.players[winner];
    if (w && w.kind === 'human') {
      for (const h of humans) payouts[h.id] = (h.id === w.id) ? ctx.pot : 0;
      return payouts;
    }
    const share = Math.floor(ctx.pot / humans.length);
    let rem = ctx.pot - share*humans.length;
    for (const h of humans) {
      let a = share;
      if (rem > 0) { a++; rem--; }
      payouts[h.id] = a;
    }
    return payouts;
  },
  newMatch(ctx) {
    const state = { board: Array(20).fill(null), winner: null, winningLine: null, lastMove: null, toMove: 0 };
    return { state, turn: [ctx.players[0].id] };
  },
  applyMove(state, playerId, move, ctx) {
    const idx = ctx.players.findIndex(p => p.id === playerId);
    if (idx < 0) throw new InvalidMove('unknown player');
    if (state.winner !== null) throw new InvalidMove('game is over');
    if (idx !== state.toMove) throw new InvalidMove('not your turn');
    if (!move || typeof move.cell !== 'number' || !Number.isInteger(move.cell) || move.cell < 0 || move.cell >= 20) throw new InvalidMove('pick a cell 0-19');
    if (state.board[move.cell] !== null && state.board[move.cell] !== undefined) throw new InvalidMove('cell taken');
    const board = state.board.slice();
    board[move.cell] = idx;
    const res = game.checkWinner(board);
    const nstate = { board, winner: res.winner, winningLine: res.line, lastMove: move.cell, toMove: state.toMove };
    if (res.winner !== null) {
      return { state: nstate, turn: null, payouts: game.payoutsForEnd(res.winner, ctx) };
    }
    const next = (idx + 1) % ctx.players.length;
    nstate.toMove = next;
    return { state: nstate, turn: [ctx.players[next].id] };
  },
  maxRunThrough(board, cell, player) {
    const COLS = 5, ROWS = 4, WINLEN = 4;
    const r = Math.floor(cell/COLS), c = cell%COLS;
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    let best = 1;
    for (const [dr,dc] of dirs) {
      let count = 1;
      for (let s=1;s<WINLEN;s++){ const rr=r+dr*s,cc=c+dc*s; if(rr<0||rr>=ROWS||cc<0||cc>=COLS) break; if(board[rr*COLS+cc]===player) count++; else break; }
      for (let s=1;s<WINLEN;s++){ const rr=r-dr*s,cc=c-dc*s; if(rr<0||rr>=ROWS||cc<0||cc>=COLS) break; if(board[rr*COLS+cc]===player) count++; else break; }
      if (count>best) best=count;
    }
    return best;
  },
  computerMove(state, playerId, ctx) {
    const me = ctx.players.findIndex(p => p.id === playerId);
    const opp = (me+1) % ctx.players.length;
    const empty = game.emptyCells(state.board);
    for (const i of empty) { const b = state.board.slice(); b[i]=me; if (game.checkWinner(b).winner===me) return { cell: i }; }
    const blocks = [];
    for (const i of empty) { const b = state.board.slice(); b[i]=opp; if (game.checkWinner(b).winner===opp) blocks.push(i); }
    if (blocks.length) return { cell: blocks[Math.floor(ctx.random()*blocks.length)] };
    const threes = [];
    for (const i of empty) { const b = state.board.slice(); b[i]=me; if (game.maxRunThrough(b,i,me)>=3) threes.push(i); }
    if (threes.length) return { cell: threes[Math.floor(ctx.random()*threes.length)] };
    const cr = 1.5, cc = 2;
    let best = empty[0], bestScore = 1e9;
    for (const i of empty) {
      const r = Math.floor(i/5), c = i%5;
      const d = Math.abs(r-cr)+Math.abs(c-cc)*0.8 + ctx.random()*1.2;
      if (d<bestScore){bestScore=d;best=i;}
    }
    return { cell: best };
  },
  randomMove(state, playerId, ctx) {
    const empty = game.emptyCells(state.board);
    return { cell: empty[Math.floor(ctx.random()*empty.length)] };
  },
  viewFor(state, playerId, ctx) {
    return { board: state.board.slice(), winner: state.winner, winningLine: state.winningLine ? state.winningLine.slice() : null, lastMove: state.lastMove, toMove: state.toMove };
  }
};