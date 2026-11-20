// Lantern Trails (based on Tsuro). 2 to 8 players on a 6x6 board.
// Each of the 35 tiles joins its 8 edge points (two per side) in four pairs;
// the 35 tiles are every such pairing up to rotation, one of each.
//
// Points on a square, clockwise from the top-left: 0, 1 on the top side,
// 2, 3 on the right, 4, 5 on the bottom, 6, 7 on the left. A quarter turn
// clockwise sends point p to p + 2 (mod 8). Point p of a square touches point
// LT_ACROSS[p] of its neighbour.
//
// A lantern stands on one point of the empty square in front of it:
// position = square * 8 + point. Gates (start marks) are numbered 0..47
// clockwise from the top-left corner: 12 per side.
// ---- shared geometry (also copied into the presentation by the builder) ----
var LT_ACROSS = [5, 4, 7, 6, 1, 0, 3, 2];
var LT_STEP = [[-1, 0], [-1, 0], [0, 1], [0, 1], [1, 0], [1, 0], [0, -1], [0, -1]];
var LT_TILES = (function () {
  // Every perfect matching of 8 points, keeping the rotation with the
  // smallest key; sorted, so the numbering is fixed.
  var all = [], seen = {};
  function build(conn) {
    var i = conn.indexOf(-1);
    if (i < 0) { all.push(conn.slice()); return; }
    for (var j = i + 1; j < 8; j++) if (conn[j] < 0) {
      conn[i] = j; conn[j] = i; build(conn); conn[i] = -1; conn[j] = -1;
    }
  }
  build([-1, -1, -1, -1, -1, -1, -1, -1]);
  var tiles = [];
  all.forEach(function (conn) {
    var best = null;
    for (var k = 0; k < 4; k++) {
      var key = ltRotate(conn, k).join('');
      if (best === null || key < best) best = key;
    }
    if (!seen[best]) { seen[best] = true; tiles.push(best); }
  });
  tiles.sort();
  return tiles.map(function (key) { return key.split('').map(Number); });
})();
// The pairing of a tile turned k quarter turns clockwise.
function ltRotate(conn, k) {
  var out = [0, 0, 0, 0, 0, 0, 0, 0];
  for (var p = 0; p < 8; p++) out[(p + 2 * k) % 8] = (conn[p] + 2 * k) % 8;
  return out;
}
var LT_TURNED = LT_TILES.map(function (conn) { return [0, 1, 2, 3].map(function (k) { return ltRotate(conn, k); }); });

function ltGatePos(gate) {
  var side = Math.floor(gate / 12), k = gate % 12, n = k >> 1, half = k & 1;
  if (side === 0) return (0 * 6 + n) * 8 + half;              // top, left to right
  if (side === 1) return (n * 6 + 5) * 8 + 2 + half;          // right, top to bottom
  if (side === 2) return (5 * 6 + 5 - n) * 8 + 4 + half;      // bottom, right to left
  return ((5 - n) * 6) * 8 + 6 + half;                        // left, bottom to top
}
// Place a tile and move every lantern on that square to the end of its path.
// markers: [{at, out}] (out null while on the board). Returns new markers and
// what happened, without changing the inputs.
function ltPlace(board, markers, square, tile, rotation) {
  var b = board.slice(); b[square] = [tile, rotation];
  var next = markers.map(function (m) { return {at: m.at, out: m.out}; });
  var moved = [], waiting = {};
  next.forEach(function (m, seat) {
    if (m.out === null && Math.floor(m.at / 8) === square) waiting[m.at % 8] = seat;
  });
  // Paths never branch, so the order of moving gives the same result.
  var order = Object.keys(waiting).map(function (p) { return waiting[p]; });
  order.forEach(function (seat) {
    var m = next[seat];
    if (m.out !== null) return;
    var sq = square, point = m.at % 8, steps = [m.at];
    delete waiting[point];
    for (var guard = 0; guard < 300; guard++) {
      var t = b[sq], exit = LT_TURNED[t[0]][t[1]][point];
      // Another lantern still waiting on this square sits on that point:
      // the two paths have met and both lanterns are out.
      if (sq === square && waiting[exit] !== undefined) {
        var other = waiting[exit]; delete waiting[exit];
        m.at = sq * 8 + exit; m.out = 'collision'; steps.push(m.at);
        next[other].out = 'collision';
        moved.push({seat: seat, steps: steps}, {seat: other, steps: [next[other].at]});
        return;
      }
      var r = Math.floor(sq / 6) + LT_STEP[exit][0], c = sq % 6 + LT_STEP[exit][1];
      if (r < 0 || r > 5 || c < 0 || c > 5) {
        m.at = sq * 8 + exit; m.out = 'edge'; steps.push(m.at);
        moved.push({seat: seat, steps: steps});
        return;
      }
      var into = r * 6 + c, entry = LT_ACROSS[exit];
      if (into === square && waiting[entry] !== undefined) {
        // Looped back onto the new tile where another lantern is waiting.
        var met = waiting[entry]; delete waiting[entry];
        m.at = into * 8 + entry; m.out = 'collision'; steps.push(m.at);
        next[met].out = 'collision';
        moved.push({seat: seat, steps: steps}, {seat: met, steps: [next[met].at]});
        return;
      }
      sq = into; point = entry; steps.push(sq * 8 + point);
      if (b[sq] === null) break;
    }
    m.at = sq * 8 + point;
    moved.push({seat: seat, steps: steps});
  });
  return {board: b, markers: next, moved: moved};
}
// ---- end shared geometry ----
function ltSeat(ctx, playerId) {
  for (var i = 0; i < ctx.players.length; i++) if (ctx.players[i].id === playerId) return i;
  return -1;
}
function ltCopy(s) { return JSON.parse(JSON.stringify(s)); }
function ltShuffle(list, ctx) {
  for (var i = list.length - 1; i > 0; i--) {
    var j = Math.floor(ctx.random() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t;
  }
  return list;
}

// Every (tile, rotation) in the hand, and which of them keep the player's own
// lantern off the edge. The rule bans walking off the edge unless every
// choice does it.
function ltOptions(state, seat) {
  var square = Math.floor(state.markers[seat].at / 8), all = [], safe = [];
  state.hands[seat].forEach(function (tile) {
    for (var k = 0; k < 4; k++) {
      var r = ltPlace(state.board, state.markers, square, tile, k);
      var option = {tile: tile, rotation: k, result: r};
      all.push(option);
      if (r.markers[seat].out !== 'edge') safe.push(option);
    }
  });
  return {all: all, legal: safe.length ? safe : all, safe: safe.length > 0};
}
function ltAlive(state) {
  var out = [];
  state.markers.forEach(function (m, seat) { if (m && m.out === null) out.push(seat); });
  return out;
}
function ltPayouts(ctx, winners) {
  var humans = ctx.players.filter(function (p) { return p.kind === 'human' && p.active !== false; }), out = {}, pot = ctx.pot || 0;
  if (!humans.length) return out;
  var winnerIds = winners.map(function (seat) { return ctx.players[seat].id; });
  var paid = humans.filter(function (p) { return winnerIds.indexOf(p.id) >= 0; });
  if (!paid.length) paid = humans;
  var share = Math.floor(pot / paid.length), rest = pot - share * paid.length;
  humans.forEach(function (p) { out[p.id] = 0; });
  paid.forEach(function (p) { out[p.id] = share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; });
  return out;
}
// Draw step at the end of a turn (official rules, including the Dragon tile
// for games of three or more).
function ltDraw(s, active, ctx) {
  var n = s.hands.length, alive = ltAlive(s);
  if (n === 2) {
    if (s.markers[active].out === null && s.pile.length && s.hands[active].length < 3) s.hands[active].push(s.pile.pop());
    return;
  }
  var needs = function (seat) { return s.markers[seat].out === null && s.hands[seat].length < 3; };
  if (!alive.length) return;
  if (!s.pile.length) {
    if (s.dragon === null && needs(active)) s.dragon = active;
    return;
  }
  var start = s.dragon !== null ? s.dragon : active;
  for (var guard = 0; guard < 64 && s.pile.length; guard++) {
    var any = false;
    for (var k = 0; k < n && s.pile.length; k++) {
      var seat = (start + k) % n;
      if (!needs(seat)) continue;
      s.hands[seat].push(s.pile.pop()); any = true;
      if (s.dragon === seat) s.dragon = null;
    }
    if (!any) break;
  }
}
// The next player clockwise who is still on the board and holds a tile.
function ltNext(s, from) {
  var n = s.hands.length;
  for (var k = 1; k <= n; k++) {
    var seat = (from + k) % n;
    if (s.markers[seat].out === null && s.hands[seat].length) return seat;
  }
  return -1;
}

function ltFinish(s, ctx, winners) {
  s.phase = 'over'; s.winners = winners; s.cur = null;
  return {state: s, turn: null, payouts: ltPayouts(ctx, winners)};
}

// After the tile is down: eliminate, return hands, draw, decide what's next.
function ltAfterTurn(s, seat, before, ctx) {
  var alive = ltAlive(s);
  var outNow = before.filter(function (who) { return alive.indexOf(who) < 0; });
  outNow.forEach(function (who) {
    s.out_order[who] = s.turn_no;
    if (s.hands[who].length) { s.pile = s.pile.concat(s.hands[who]); s.hands[who] = []; ltShuffle(s.pile, ctx); }
  });
  if (s.dragon !== null && s.markers[s.dragon].out !== null) {
    // Pass it clockwise to the next player still in with fewer than 3 tiles.
    var holder = null, n = s.hands.length;
    for (var k = 1; k <= n; k++) {
      var who = (s.dragon + k) % n;
      if (s.markers[who].out === null && s.hands[who].length < 3) { holder = who; break; }
    }
    s.dragon = holder;
  }
  if (alive.length === 1) return ltFinish(s, ctx, alive);
  if (alive.length === 0) return ltFinish(s, ctx, outNow);
  ltDraw(s, seat, ctx);
  var next = ltNext(s, seat);
  // Every tile played (or nobody left holds one): the remaining lanterns tie.
  if (next < 0) return ltFinish(s, ctx, alive);
  s.cur = next;
  return {state: s, turn: [ctx.players[next].id]};
}

const game = {
  newMatch(ctx) {
    var n = ctx.players.length;
    if (n < 2 || n > 8) throw new InvalidMove('two to eight players');
    var pile = ltShuffle(LT_TILES.map(function (t, i) { return i; }), ctx), hands = [], markers = [];
    for (var i = 0; i < n; i++) { hands.push([]); markers.push(null); }
    for (var k = 0; k < 3; k++) for (i = 0; i < n; i++) hands[i].push(pile.pop());
    var board = [];
    for (i = 0; i < 36; i++) board.push(null);
    var out = [];
    for (i = 0; i < n; i++) out.push(null);
    return {state: {phase: 'start', board: board, hands: hands, pile: pile, markers: markers, gates: out.slice(),
                    dragon: null, cur: 0, turn_no: 0, out_order: out, winners: null, last: null},
            turn: [ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    var seat = ltSeat(ctx, playerId);
    if (seat < 0) throw new InvalidMove('unknown player');
    if (state.phase === 'over') throw new InvalidMove('game over');
    if (seat !== state.cur) throw new InvalidMove('not your turn');
    move = move || {};
    var s = ltCopy(state);
    if (state.phase === 'start') {
      var gate = move.gate;
      if (!Number.isInteger(gate) || gate < 0 || gate > 47) throw new InvalidMove('choose a starting gate');
      var pos = ltGatePos(gate);
      if (state.markers.some(function (m) { return m && m.at === pos; })) throw new InvalidMove('that gate is taken');
      s.markers[seat] = {at: pos, out: null}; s.gates[seat] = gate;
      s.last = {kind: 'gate', seat: seat, gate: gate};
      var n = s.hands.length;
      if (seat === n - 1) { s.phase = 'play'; s.cur = 0; } else s.cur = seat + 1;
      return {state: s, turn: [ctx.players[s.cur].id]};
    }
    var tile = move.tile, rotation = move.rotation;
    if (!Number.isInteger(tile) || tile < 0 || tile >= LT_TILES.length) throw new InvalidMove('choose a tile');
    if (state.hands[seat].indexOf(tile) < 0) throw new InvalidMove('that tile is not in your hand');
    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) throw new InvalidMove('bad rotation');
    var options = ltOptions(state, seat);
    var chosen = null;
    options.all.forEach(function (o) { if (o.tile === tile && o.rotation === rotation) chosen = o; });
    if (options.safe && chosen.result.markers[seat].out === 'edge') throw new InvalidMove('that sends your lantern off the board');
    var before = ltAlive(state), square = Math.floor(state.markers[seat].at / 8);
    s.board = chosen.result.board; s.markers = chosen.result.markers;
    s.hands[seat].splice(s.hands[seat].indexOf(tile), 1);
    s.turn_no += 1;
    s.last = {kind: 'tile', seat: seat, square: square, tile: tile, rotation: rotation, moved: chosen.result.moved};
    return ltAfterTurn(s, seat, before, ctx);
  },
  randomMove(state, playerId, ctx) {
    var seat = state.cur;
    if (state.phase === 'start') {
      var free = [];
      for (var g = 0; g < 48; g++) {
        var pos = ltGatePos(g);
        if (!state.markers.some(function (m) { return m && m.at === pos; })) free.push(g);
      }
      return {gate: free[Math.floor(ctx.random() * free.length)]};
    }
    var legal = ltOptions(state, seat).legal, o = legal[Math.floor(ctx.random() * legal.length)];
    return {tile: o.tile, rotation: o.rotation};
  },
  computerMove(state, playerId, ctx) {
    var seat = state.cur;
    if (state.phase === 'start') return ltChooseGate(state, ctx);
    return ltChooseTile(state, seat, ctx);
  },
  viewFor(state, playerId, ctx) {
    var seat = playerId === null || playerId === undefined ? -1 : ltSeat(ctx, playerId);
    return {phase: state.phase, board: state.board.map(function (t) { return t ? t.slice() : null; }),
            markers: state.markers.map(function (m) { return m ? {at: m.at, out: m.out} : null; }),
            gates: state.gates.slice(), hand: seat >= 0 ? state.hands[seat].slice() : null,
            hand_counts: state.hands.map(function (h) { return h.length; }), pile: state.pile.length,
            dragon: state.dragon, cur: state.cur, turn_no: state.turn_no, out_order: state.out_order.slice(),
            winners: state.winners ? state.winners.slice() : null,
            // The portal's result line reads one winner seat, or -1 for a shared win.
            winner: state.winners ? (state.winners.length === 1 ? state.winners[0] : -1) : null, last: state.last ? JSON.parse(JSON.stringify(state.last)) : null,
            me: seat};
  },
};

// ---- Computer player -------------------------------------------------------
// Gates: as far as possible from every other lantern, away from corners.
function ltChooseGate(state, ctx) {
  var taken = state.gates.filter(function (g) { return g !== null; }), best = 0, bestValue = -Infinity;
  for (var g = 0; g < 48; g++) {
    var pos = ltGatePos(g);
    if (state.markers.some(function (m) { return m && m.at === pos; })) continue;
    var near = 48;
    taken.forEach(function (t) { var d = Math.abs(t - g); near = Math.min(near, d, 48 - d); });
    var k = g % 12, corner = k < 2 || k > 9 ? 6 : 0;
    var value = Math.min(near, 12) * 10 - corner + ctx.random();
    if (value > bestValue) { bestValue = value; best = g; }
  }
  return {gate: best};
}
// How many of these tiles leave the lantern of seat a safe placement at its
// current square (any rotation that keeps it on the board).
function ltSafeShare(board, markers, seat, tiles) {
  if (!tiles.length) return 1;
  var square = Math.floor(markers[seat].at / 8), ok = 0;
  for (var i = 0; i < tiles.length; i++) {
    for (var k = 0; k < 4; k++) {
      if (ltPlace(board, markers, square, tiles[i], k).markers[seat].out === null) { ok++; break; }
    }
  }
  return ok / tiles.length;
}
function ltChooseTile(state, seat, ctx) {
  var options = ltOptions(state, seat), legal = options.legal;
  var alive = ltAlive(state), others = alive.filter(function (x) { return x !== seat; });
  // Tiles I cannot see: everything not on the board and not in my hand.
  var onBoard = {};
  state.board.forEach(function (t) { if (t) onBoard[t[0]] = true; });
  var unseen = [];
  for (var t = 0; t < LT_TILES.length; t++) if (!onBoard[t] && state.hands[seat].indexOf(t) < 0) unseen.push(t);
  var sample = unseen.length > 12 ? unseen.filter(function (x, i) { return i % Math.ceil(unseen.length / 12) === 0; }) : unseen;
  var best = legal[0], bestValue = -Infinity, seenKeys = {};
  legal.forEach(function (o) {
    var key = o.tile + ':' + LT_TURNED[o.tile][o.rotation].join('');
    if (seenKeys[key]) return; seenKeys[key] = true;
    var r = o.result, me = r.markers[seat], value = 0;
    var survivors = others.filter(function (x) { return r.markers[x].out === null; });
    if (me.out !== null) {
      value = -1e6 + (survivors.length === 0 ? 5e5 : 0);
    } else if (!survivors.length) {
      value = 1e7;
    } else {
      value += (others.length - survivors.length) * 2000;
      var rest = state.hands[seat].slice(); rest.splice(rest.indexOf(o.tile), 1);
      var mine = ltSafeShare(r.board, r.markers, seat, rest.length ? rest : sample);
      value += (mine > 0 ? 600 : -3000) + 600 * ltSafeShare(r.board, r.markers, seat, sample);
      var sq = Math.floor(me.at / 8), row = Math.floor(sq / 6), col = sq % 6;
      value += 25 * Math.min(row, 5 - row, col, 5 - col);
      // Sharing a square with a rival lets them choose my fate.
      survivors.forEach(function (x) { if (Math.floor(r.markers[x].at / 8) === sq) value -= 250; });
      if (survivors.length <= 3) survivors.forEach(function (x) { value -= 400 * ltSafeShare(r.board, r.markers, x, sample); });
    }
    value += ctx.random() * 5;
    if (value > bestValue) { bestValue = value; best = o; }
  });
  return {tile: best.tile, rotation: best.rotation};
}
