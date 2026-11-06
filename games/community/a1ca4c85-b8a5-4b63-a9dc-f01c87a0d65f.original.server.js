const game = {
  N: 6,
  newMatch: function(ctx) {
    var n = this.N * this.N;
    var board = [];
    for (var i = 0; i < n; i++) board.push("");
    var scores = ctx.players.map(function(){ return 0; });
    var state = { board: board, scores: scores, lines: [], lastMove: -1, winner: null };
    return { state: state, turn: [ctx.players[0].id] };
  },
  idxOf: function(ctx, playerId) {
    for (var i = 0; i < ctx.players.length; i++) if (ctx.players[i].id === playerId) return i;
    return -1;
  },
  inB: function(r, c) { return r >= 0 && r < this.N && c >= 0 && c < this.N; },
  triplesThrough: function(idx) {
    var N = this.N;
    var r = Math.floor(idx / N), c = idx % N;
    var dirs = [[0,1],[1,0],[1,1],[1,-1]];
    var out = [];
    for (var d = 0; d < dirs.length; d++) {
      var dr = dirs[d][0], dc = dirs[d][1];
      for (var off = -2; off <= 0; off++) {
        var cells = [], ok = true;
        for (var k = 0; k < 3; k++) {
          var rr = r + (off+k)*dr, cc = c + (off+k)*dc;
          if (rr < 0 || rr >= N || cc < 0 || cc >= N) { ok = false; break; }
          cells.push(rr*N+cc);
        }
        if (ok) out.push(cells);
      }
    }
    return out;
  },
  lineKey: function(t) { return t[0] + "," + t[1] + "," + t[2]; },
  newLinesFor: function(board, existingLines, idx) {
    var set = {};
    for (var i = 0; i < existingLines.length; i++) set[this.lineKey(existingLines[i])] = 1;
    var found = [];
    var trips = this.triplesThrough(idx);
    for (var j = 0; j < trips.length; j++) {
      var t = trips[j];
      if (board[t[0]] === "S" && board[t[1]] === "O" && board[t[2]] === "S" && !set[this.lineKey(t)]) {
        found.push(t);
        set[this.lineKey(t)] = 1;
      }
    }
    return found;
  },
  countNew: function(board, lines, idx, letter) {
    if (board[idx] !== "") return 0;
    var b2 = board.slice(); b2[idx] = letter;
    return this.newLinesFor(b2, lines, idx).length;
  },
  emptyCells: function(board) {
    var e = [];
    for (var i = 0; i < board.length; i++) if (board[i] === "") e.push(i);
    return e;
  },
  payoutsFor: function(state, ctx) {
    var humans = ctx.players.filter(function(p){ return p.kind === "human"; });
    var payouts = {};
    if (humans.length === 0 || ctx.pot <= 0) return payouts;
    if (typeof state.winner === "number" && state.winner >= 0) {
      var w = ctx.players[state.winner];
      if (w && w.kind === "human") { payouts[w.id] = ctx.pot; return payouts; }
    } else if (state.winner === -1) {
      // tie: split evenly among humans
    }
    // computer won or tie: refund / split evenly among humans
    var base = Math.floor(ctx.pot / humans.length);
    var rem = ctx.pot - base * humans.length;
    for (var i = 0; i < humans.length; i++) payouts[humans[i].id] = base + (i < rem ? 1 : 0);
    return payouts;
  },
  applyMove: function(state, playerId, move, ctx) {
    var me = this.idxOf(ctx, playerId);
    if (me < 0) throw new InvalidMove("unknown player");
    if (state.winner !== null) throw new InvalidMove("game is over");
    if (!move || typeof move.idx !== "number" || (move.letter !== "S" && move.letter !== "O")) throw new InvalidMove("place S or O on an empty square");
    var idx = move.idx;
    if (idx < 0 || idx >= this.N * this.N) throw new InvalidMove("square out of bounds");
    if (state.board[idx] !== "") throw new InvalidMove("square already taken");
    var board = state.board.slice();
    board[idx] = move.letter;
    var fresh = this.newLinesFor(board, state.lines, idx);
    var scores = state.scores.slice();
    while (scores.length < ctx.players.length) scores.push(0);
    scores[me] = (scores[me] || 0) + fresh.length;
    var lines = state.lines.concat(fresh);
    var full = true;
    for (var i = 0; i < board.length; i++) if (board[i] === "") { full = false; break; }
    var nextState = { board: board, scores: scores, lines: lines, lastMove: idx, winner: null };
    if (full) {
      var mx = scores[0];
      for (var s = 1; s < scores.length; s++) if (scores[s] > mx) mx = scores[s];
      var w = [];
      for (var p = 0; p < scores.length; p++) if (scores[p] === mx) w.push(p);
      nextState.winner = (w.length === 1) ? w[0] : -1;
      return { state: nextState, turn: null, payouts: this.payoutsFor(nextState, ctx) };
    }
    var turn = (fresh.length > 0) ? [playerId] : [ctx.players[(me + 1) % ctx.players.length].id];
    return { state: nextState, turn: turn };
  },
  bestMove: function(state, rnd) {
    var empt = this.emptyCells(state.board);
    if (!empt.length) return null;
    var i, L, s;
    var best = null, bestScore = 0;
    for (var e = 0; e < empt.length; e++) {
      i = empt[e];
      for (var li = 0; li < 2; li++) {
        L = li === 0 ? "S" : "O";
        s = this.countNew(state.board, state.lines, i, L);
        if (s > bestScore) { bestScore = s; best = { idx: i, letter: L }; }
      }
    }
    if (best) return best;
    // block cells where opponent could score
    var threats = [];
    for (var e2 = 0; e2 < empt.length; e2++) {
      i = empt[e2];
      var t = 0;
      if (this.countNew(state.board, state.lines, i, "S") > 0) t++;
      if (this.countNew(state.board, state.lines, i, "O") > 0) t++;
      if (t > 0) threats.push({ idx: i, t: t });
    }
    if (threats.length) {
      threats.sort(function(a,b){ return b.t - a.t; });
      return { idx: threats[0].idx, letter: rnd() < 0.6 ? "S" : "O" };
    }
    var center = Math.floor(this.N/2) * this.N + Math.floor(this.N/2);
    if (state.board[center] === "") return { idx: center, letter: rnd() < 0.5 ? "S" : "O" };
    var pick = empt[Math.floor(rnd() * empt.length)];
    return { idx: pick, letter: rnd() < 0.5 ? "S" : "O" };
  },
  computerMove: function(state, playerId, ctx) {
    var mv = this.bestMove(state, ctx.random);
    if (mv) return mv;
    return this.randomMove(state, playerId, ctx);
  },
  randomMove: function(state, playerId, ctx) {
    var empt = this.emptyCells(state.board);
    if (!empt.length) throw new InvalidMove("board is full");
    return { idx: empt[Math.floor(ctx.random() * empt.length)], letter: ctx.random() < 0.5 ? "S" : "O" };
  },
  viewFor: function(state, playerId, ctx) {
    return { board: state.board.slice(), scores: state.scores.slice(), lines: state.lines.map(function(l){ return l.slice(); }), lastMove: state.lastMove, winner: state.winner };
  }
};