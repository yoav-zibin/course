// Stitch & Time (based on Patchwork). Two players fill a 9x9 quilt with
// patches, paying buttons and time. Whoever is behind on the time track moves.
//
// The 33 patches (shape, button cost, time cost, button income) agree across
// two independent implementations; the time track (53 spaces, income spaces,
// leather patches) across two more (see STITCHTIME.md). Patch 0 is the 1x2
// starting patch, placed last in the circle so the neutral token sits after it.
// ---- shared rules (also copied into the presentation by the builder) ----
var ST_PATCHES = [
  {cost: 2, time: 1, income: 0, rows: ['##']},
  {cost: 2, time: 2, income: 0, rows: ['###']},
  {cost: 3, time: 3, income: 1, rows: ['####']},
  {cost: 7, time: 1, income: 1, rows: ['#####']},
  {cost: 6, time: 5, income: 2, rows: ['##', '##']},
  {cost: 2, time: 2, income: 0, rows: ['##.', '###']},
  {cost: 10, time: 5, income: 3, rows: ['##..', '####']},
  {cost: 7, time: 4, income: 2, rows: ['.##.', '####']},
  {cost: 4, time: 2, income: 0, rows: ['###.', '.###']},
  {cost: 8, time: 6, income: 3, rows: ['.##', '.##', '##.']},
  {cost: 1, time: 2, income: 0, rows: ['#.#', '###']},
  {cost: 1, time: 5, income: 1, rows: ['#..#', '####']},
  {cost: 3, time: 6, income: 2, rows: ['#.#', '###', '.#.']},
  {cost: 2, time: 2, income: 0, rows: ['###', '.#.']},
  {cost: 5, time: 5, income: 2, rows: ['###', '.#.', '.#.']},
  {cost: 7, time: 2, income: 2, rows: ['###', '.#.', '.#.', '.#.']},
  {cost: 0, time: 3, income: 1, rows: ['.#.', '###', '.#.', '.#.']},
  {cost: 4, time: 2, income: 1, rows: ['#.', '#.', '##']},
  {cost: 4, time: 6, income: 2, rows: ['#.', '#.', '##']},
  {cost: 10, time: 3, income: 2, rows: ['#.', '#.', '#.', '##']},
  {cost: 3, time: 4, income: 1, rows: ['#.', '#.', '##', '#.']},
  {cost: 5, time: 4, income: 2, rows: ['.#.', '###', '.#.']},
  {cost: 1, time: 4, income: 1, rows: ['.#.', '.#.', '###', '.#.', '.#.']},
  {cost: 5, time: 3, income: 1, rows: ['.##.', '####', '.##.']},
  {cost: 2, time: 3, income: 0, rows: ['#.#', '###', '#.#']},
  {cost: 3, time: 1, income: 0, rows: ['.#', '##']},
  {cost: 1, time: 3, income: 0, rows: ['.#', '##']},
  {cost: 3, time: 2, income: 1, rows: ['.#', '##', '#.']},
  {cost: 7, time: 6, income: 3, rows: ['.#', '##', '#.']},
  {cost: 2, time: 3, income: 1, rows: ['.#', '.#', '##', '#.']},
  {cost: 1, time: 2, income: 0, rows: ['...#', '####', '#...']},
  {cost: 2, time: 1, income: 0, rows: ['..#.', '####', '.#..']},
  {cost: 10, time: 4, income: 3, rows: ['..#', '.##', '##.']},
];
var ST_END = 53, ST_INCOME = [5, 11, 17, 23, 29, 35, 41, 47, 53], ST_LEATHER = [20, 26, 32, 44, 50];
// Cells of patch p in orientation o (0-3: quarter turns clockwise; 4-7: the
// same after a mirror), normalised to start at (0, 0), plus the size.
function stShape(p, o) {
  if (p === 33) return {cells: [[0, 0]], w: 1, h: 1};   // the 1x1 leather patch
  var rows = ST_PATCHES[p].rows, cells = [], w = rows[0].length, h = rows.length;
  rows.forEach(function (row, y) { for (var x = 0; x < row.length; x++) if (row[x] === '#') cells.push([x, y]); });
  if (o >= 4) cells = cells.map(function (c) { return [w - 1 - c[0], c[1]]; });
  for (var k = 0; k < o % 4; k++) { cells = cells.map(function (c) { return [h - 1 - c[1], c[0]]; }); var t = w; w = h; h = t; }
  return {cells: cells, w: w, h: h};
}
function stFits(quilt, p, o, x, y) {
  var s = stShape(p, o);
  if (x < 0 || y < 0 || x + s.w > 9 || y + s.h > 9) return false;
  return s.cells.every(function (c) { return quilt[(y + c[1]) * 9 + x + c[0]] < 0; });
}
function stPlacements(quilt, p) {
  var out = [], seen = {};
  for (var o = 0; o < 8; o++) {
    var s = stShape(p, o), key = s.cells.map(function (c) { return c.join(','); }).sort().join(';');
    if (seen[key]) continue;   // symmetric orientations are the same placement
    seen[key] = true;
    for (var y = 0; y + s.h <= 9; y++) for (var x = 0; x + s.w <= 9; x++) if (stFits(quilt, p, o, x, y)) out.push({o: o, x: x, y: y});
  }
  return out;
}
function stOptions(state) { return state.circle.slice(0, Math.min(3, state.circle.length)); }
function stEmpty(quilt) { return quilt.filter(function (c) { return c < 0; }).length; }
function stHasSeven(quilt) {
  for (var y = 0; y <= 2; y++) for (var x = 0; x <= 2; x++) {
    var full = true;
    for (var j = 0; j < 7 && full; j++) for (var i = 0; i < 7 && full; i++) if (quilt[(y + j) * 9 + x + i] < 0) full = false;
    if (full) return true;
  }
  return false;
}
// Who moves: a seat with a leather patch to place; else the one behind on the
// time track; on the same space, the token on top (the last to arrive).
function stTurn(state) {
  for (var s = 0; s < 2; s++) if (state.pending[s] > 0) return s;
  if (state.pos[0] === ST_END && state.pos[1] === ST_END) return -1;
  if (state.pos[0] !== state.pos[1]) return state.pos[0] < state.pos[1] ? 0 : 1;
  return state.top;
}
function stScore(state, seat) {
  return state.buttons[seat] + (state.bonus === seat ? 7 : 0) - 2 * stEmpty(state.quilts[seat]);
}
// How snugly a placement sits: edges touching walls or patches, minus small
// holes left behind; prefers filling from the corners.
function stSnug(quilt, cells) {
  var taken = {}, score = 0;
  cells.forEach(function (c) { taken[c[1] * 9 + c[0]] = true; });
  cells.forEach(function (c) {
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var x = c[0] + d[0], y = c[1] + d[1];
      if (x < 0 || y < 0 || x > 8 || y > 8) score += 1.2;
      else if (quilt[y * 9 + x] >= 0) score += 1;
      else if (!taken[y * 9 + x]) {
        // An empty neighbour boxed in on all other sides becomes a hole.
        var open = 0;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (e) {
          var a = x + e[0], b = y + e[1];
          if (a >= 0 && b >= 0 && a <= 8 && b <= 8 && quilt[b * 9 + a] < 0 && !taken[b * 9 + a]) open++;
        });
        if (!open) score -= 3;
      }
    });
  });
  return score;
}
function stBest(quilt, p) {
  var best = null, bestScore = -Infinity;
  stPlacements(quilt, p).forEach(function (pl) {
    var cells = stShape(p, pl.o).cells.map(function (c) { return [pl.x + c[0], pl.y + c[1]]; });
    var score = stSnug(quilt, cells);
    if (score > bestScore) { bestScore = score; best = pl; }
  });
  return best ? {o: best.o, x: best.x, y: best.y, snug: bestScore} : null;
}
// ---- end shared rules ----
function stSeat(ctx, playerId) {
  for (var i = 0; i < ctx.players.length; i++) if (ctx.players[i].id === playerId) return i;
  return -1;
}
function stCopy(s) { return JSON.parse(JSON.stringify(s)); }
function stPayouts(ctx, winner) {
  var humans = ctx.players.filter(function (p) { return p.kind === 'human' && p.active !== false; }), out = {}, pot = ctx.pot || 0;
  if (!humans.length) return out;
  var winnerId = ctx.players[winner].id, paid = humans.filter(function (p) { return p.id === winnerId; });
  if (!paid.length) paid = humans;
  var share = Math.floor(pot / paid.length), rest = pot - share * paid.length;
  humans.forEach(function (p) { out[p.id] = 0; });
  paid.forEach(function (p) { out[p.id] = share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; });
  return out;
}
// Move a time token, collecting income and leather patches passed or reached.
function stAdvance(s, seat, steps) {
  var from = s.pos[seat], to = Math.min(ST_END, from + steps);
  ST_INCOME.forEach(function (sp) { if (sp > from && sp <= to) s.buttons[seat] += s.income[seat]; });
  s.leather = s.leather.filter(function (sp) {
    if (sp > from && sp <= to) { if (stEmpty(s.quilts[seat]) - s.pending[seat] > 0) s.pending[seat]++; return false; }
    return true;
  });
  s.pos[seat] = to;
  if (to === s.pos[1 - seat]) s.top = seat;
  if (to === ST_END && s.first_end === null) s.first_end = seat;
  return to - from;
}
function stAfter(s, ctx) {
  if (s.bonus === null) for (var q = 0; q < 2; q++) if (stHasSeven(s.quilts[q])) { s.bonus = q; break; }
  var next = stTurn(s);
  if (next < 0) {
    s.phase = 'over';
    s.scores = [stScore(s, 0), stScore(s, 1)];
    s.winner = s.scores[0] !== s.scores[1] ? (s.scores[0] > s.scores[1] ? 0 : 1) : s.first_end;
    return {state: s, turn: null, payouts: stPayouts(ctx, s.winner)};
  }
  return {state: s, turn: [ctx.players[next].id]};
}

const game = {
  newMatch(ctx) {
    if (ctx.players.length !== 2) throw new InvalidMove('two players required');
    var others = [];
    for (var i = 1; i < ST_PATCHES.length; i++) others.push(i);
    for (i = others.length - 1; i > 0; i--) { var j = Math.floor(ctx.random() * (i + 1)), t = others[i]; others[i] = others[j]; others[j] = t; }
    var quilt = [];
    for (i = 0; i < 81; i++) quilt.push(-1);
    var s = {phase: 'play', circle: others.concat([0]), pos: [0, 0], top: 0, buttons: [5, 5], income: [0, 0],
             quilts: [quilt.slice(), quilt.slice()], placed: [[], []], leather: ST_LEATHER.slice(), pending: [0, 0],
             bonus: null, first_end: null, winner: null, scores: null, turn_no: 0, last: null};
    return {state: s, turn: [ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    var seat = stSeat(ctx, playerId);
    if (seat < 0) throw new InvalidMove('unknown player');
    if (state.phase === 'over') throw new InvalidMove('game over');
    if (stTurn(state) !== seat) throw new InvalidMove('not your turn');
    move = move || {};
    var s = stCopy(state);
    s.turn_no++;
    if (state.pending[seat] > 0) {
      var cell = move.leather;
      if (!Number.isInteger(cell) || cell < 0 || cell > 80) throw new InvalidMove('place your leather patch on an empty square');
      if (state.quilts[seat][cell] >= 0) throw new InvalidMove('that square is already patched');
      s.quilts[seat][cell] = 33;
      s.placed[seat].push({p: 33, o: 0, x: cell % 9, y: Math.floor(cell / 9)});
      s.pending[seat]--;
      s.last = {kind: 'leather', seat: seat, cell: cell};
      return stAfter(s, ctx);
    }
    if (move.advance === true) {
      var gain = stAdvance(s, seat, state.pos[1 - seat] + 1 - state.pos[seat]);
      s.buttons[seat] += gain;
      s.last = {kind: 'advance', seat: seat, gain: gain};
      return stAfter(s, ctx);
    }
    var k = move.buy, options = stOptions(state);
    if (!Number.isInteger(k) || k < 0 || k >= options.length) throw new InvalidMove('choose one of the next three patches');
    var p = options[k], def = ST_PATCHES[p];
    if (state.buttons[seat] < def.cost) throw new InvalidMove('not enough buttons');
    if (!Number.isInteger(move.o) || move.o < 0 || move.o > 7 || !Number.isInteger(move.x) || !Number.isInteger(move.y) ||
        !stFits(state.quilts[seat], p, move.o, move.x, move.y)) throw new InvalidMove('the patch does not fit there');
    stShape(p, move.o).cells.forEach(function (c) { s.quilts[seat][(move.y + c[1]) * 9 + move.x + c[0]] = p; });
    s.placed[seat].push({p: p, o: move.o, x: move.x, y: move.y});
    s.buttons[seat] -= def.cost;
    s.income[seat] += def.income;
    // The neutral token moves to the bought patch's place in the circle.
    s.circle = state.circle.slice(k + 1).concat(state.circle.slice(0, k));
    stAdvance(s, seat, def.time);
    s.last = {kind: 'buy', seat: seat, p: p, o: move.o, x: move.x, y: move.y};
    return stAfter(s, ctx);
  },
  randomMove(state, playerId, ctx) {
    var seat = stTurn(state);
    if (state.pending[seat] > 0) {
      var free = [];
      state.quilts[seat].forEach(function (c, i) { if (c < 0) free.push(i); });
      return {leather: free[Math.floor(ctx.random() * free.length)]};
    }
    var buys = [];
    stOptions(state).forEach(function (p, k) {
      if (state.buttons[seat] < ST_PATCHES[p].cost) return;
      var spots = stPlacements(state.quilts[seat], p);
      if (spots.length) buys.push(Object.assign({buy: k}, spots[Math.floor(ctx.random() * spots.length)]));
    });
    if (!buys.length || ctx.random() < 0.25) return {advance: true};
    return buys[Math.floor(ctx.random() * buys.length)];
  },
  computerMove(state, playerId, ctx) { return stChoose(state, stTurn(state), ctx); },
  viewFor(state, playerId, ctx) {
    // Everything is public, including the order of the patch circle.
    var v = stCopy(state);
    v.me = playerId === null || playerId === undefined ? -1 : stSeat(ctx, playerId);
    v.turn = state.phase === 'over' ? null : stTurn(state);
    return v;
  },
};

// ---- Computer player -------------------------------------------------------
function stIncomeLeft(pos) { return ST_INCOME.filter(function (sp) { return sp > pos; }).length; }
function stChoose(state, seat, ctx) {
  var quilt = state.quilts[seat];
  if (state.pending[seat] > 0) {
    var bestCell = -1, bestScore = -Infinity;
    quilt.forEach(function (c, i) {
      if (c >= 0) return;
      var score = stSnug(quilt, [[i % 9, Math.floor(i / 9)]]) + ctx.random() * 0.1;
      if (score > bestScore) { bestScore = score; bestCell = i; }
    });
    return {leather: bestCell};
  }
  var gain = Math.min(ST_END, state.pos[1 - seat] + 1) - state.pos[seat];
  var bestMove = {advance: true}, bestValue = gain * 1.0 + 0.2;
  stOptions(state).forEach(function (p, k) {
    var def = ST_PATCHES[p];
    if (state.buttons[seat] < def.cost) return;
    var spot = stBest(quilt, p);
    if (!spot) return;
    var cells = stShape(p, 0).cells.length;
    // Patch worth: squares covered (each empty square costs 2), future income,
    // minus price; spread over the time it takes, plus how well it fits.
    var worth = 2 * cells + def.income * stIncomeLeft(state.pos[seat]) - def.cost;
    var value = worth - def.time * 0.6 + spot.snug * 0.15 + ctx.random() * 0.05;
    if (value > bestValue) { bestValue = value; bestMove = {buy: k, o: spot.o, x: spot.x, y: spot.y}; }
  });
  return bestMove;
}
