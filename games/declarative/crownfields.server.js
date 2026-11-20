// Crownfields (based on Kingdomino). 2 to 4 players build a 5x5 realm of
// two-square tiles around their keep.
//
// Terrains: 0 wheat, 1 forest, 2 lake, 3 meadow, 4 marsh, 5 mine; 6 is the keep.
// The 48 tiles (number 1..48 = index + 1) each have two halves [terrain,
// crowns]. Lower numbers are the plainer tiles, so whoever picks a low tile
// picks earlier next round.
// ---- shared geometry (also copied into the presentation by the builder) ----
var CF_TILES = [
  [[0, 0], [0, 0]], [[0, 0], [0, 0]], [[1, 0], [1, 0]], [[1, 0], [1, 0]], [[1, 0], [1, 0]], [[1, 0], [1, 0]],
  [[2, 0], [2, 0]], [[2, 0], [2, 0]], [[2, 0], [2, 0]], [[3, 0], [3, 0]], [[3, 0], [3, 0]], [[4, 0], [4, 0]],
  [[0, 0], [1, 0]], [[0, 0], [2, 0]], [[0, 0], [3, 0]], [[0, 0], [4, 0]], [[1, 0], [2, 0]], [[1, 0], [3, 0]],
  [[0, 1], [1, 0]], [[0, 1], [2, 0]], [[0, 1], [3, 0]], [[0, 1], [4, 0]], [[0, 1], [5, 0]], [[1, 1], [0, 0]],
  [[1, 1], [0, 0]], [[1, 1], [0, 0]], [[1, 1], [0, 0]], [[1, 1], [2, 0]], [[1, 1], [3, 0]], [[2, 1], [0, 0]],
  [[2, 1], [0, 0]], [[2, 1], [1, 0]], [[2, 1], [1, 0]], [[2, 1], [1, 0]], [[2, 1], [1, 0]], [[0, 0], [3, 1]],
  [[2, 0], [3, 1]], [[0, 0], [4, 1]], [[3, 0], [4, 1]], [[5, 1], [0, 0]], [[0, 0], [3, 2]], [[2, 0], [3, 2]],
  [[0, 0], [4, 2]], [[3, 0], [4, 2]], [[5, 2], [0, 0]], [[4, 0], [5, 2]], [[4, 0], [5, 2]], [[0, 0], [5, 3]]
];
// The realm is a 9x9 work area with the keep in the middle (cell 40); the
// tiles laid must fit, with the keep, inside some 5x5 square.
var CF_SIZE = 9, CF_KEEP = 40, CF_LIMIT = 5;
var CF_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];   // second half: right, down, left, up

function cfSeat(ctx, playerId) {
  for (var i = 0; i < ctx.players.length; i++) if (ctx.players[i].id === playerId) return i;
  return -1;
}
function cfCopy(s) { return JSON.parse(JSON.stringify(s)); }
function cfShuffle(list, ctx) {
  for (var i = list.length - 1; i > 0; i--) {
    var j = Math.floor(ctx.random() * (i + 1)), t = list[i]; list[i] = list[j]; list[j] = t;
  }
  return list;
}
function cfEmptyGrid() {
  var g = [];
  for (var i = 0; i < CF_SIZE * CF_SIZE; i++) g.push(null);
  g[CF_KEEP] = [6, 0];
  return g;
}
// The two cells a tile covers with its first half at cell and the second
// half in direction dir; null if off the work area.
function cfCells(cell, dir) {
  var r = Math.floor(cell / CF_SIZE), c = cell % CF_SIZE, r2 = r + CF_DIRS[dir][0], c2 = c + CF_DIRS[dir][1];
  if (r2 < 0 || r2 >= CF_SIZE || c2 < 0 || c2 >= CF_SIZE) return null;
  return [cell, r2 * CF_SIZE + c2];
}
function cfBounds(grid, extra) {
  var b = {r0: 99, r1: -1, c0: 99, c1: -1};
  var add = function (i) {
    var r = Math.floor(i / CF_SIZE), c = i % CF_SIZE;
    if (r < b.r0) b.r0 = r; if (r > b.r1) b.r1 = r; if (c < b.c0) b.c0 = c; if (c > b.c1) b.c1 = c;
  };
  grid.forEach(function (v, i) { if (v) add(i); });
  (extra || []).forEach(add);
  return b;
}
// Can tile number n be laid with its first half at cell, second toward dir?
// Both squares free, the realm still fits a 5x5 square, and one half touches
// the keep or the same terrain (side by side, not diagonally).
function cfLegal(grid, n, cell, dir) {
  var cells = cfCells(cell, dir);
  if (!cells || grid[cells[0]] || grid[cells[1]]) return false;
  var b = cfBounds(grid, cells);
  if (b.r1 - b.r0 >= CF_LIMIT || b.c1 - b.c0 >= CF_LIMIT) return false;
  var halves = CF_TILES[n - 1];
  for (var h = 0; h < 2; h++) {
    var r = Math.floor(cells[h] / CF_SIZE), c = cells[h] % CF_SIZE;
    for (var d = 0; d < 4; d++) {
      var rr = r + CF_DIRS[d][0], cc = c + CF_DIRS[d][1];
      if (rr < 0 || rr >= CF_SIZE || cc < 0 || cc >= CF_SIZE) continue;
      var v = grid[rr * CF_SIZE + cc];
      if (v && (v[0] === 6 || v[0] === halves[h][0])) return true;
    }
  }
  return false;
}
function cfPlacements(grid, n) {
  var out = [];
  for (var cell = 0; cell < CF_SIZE * CF_SIZE; cell++) {
    for (var dir = 0; dir < 4; dir++) if (cfLegal(grid, n, cell, dir)) out.push({cell: cell, dir: dir});
  }
  return out;
}
function cfLay(grid, n, cell, dir) {
  var g = grid.slice(), cells = cfCells(cell, dir), halves = CF_TILES[n - 1];
  g[cells[0]] = halves[0].slice(); g[cells[1]] = halves[1].slice();
  return g;
}
// Properties: groups of same terrain joined side by side. Score = size x crowns.
function cfProperties(grid) {
  var seen = [], out = [];
  for (var i = 0; i < grid.length; i++) seen.push(false);
  for (var start = 0; start < grid.length; start++) {
    var v = grid[start];
    if (!v || v[0] === 6 || seen[start]) continue;
    var stack = [start], size = 0, crowns = 0, cells = [];
    seen[start] = true;
    while (stack.length) {
      var cur = stack.pop(), r = Math.floor(cur / CF_SIZE), c = cur % CF_SIZE;
      size++; crowns += grid[cur][1]; cells.push(cur);
      for (var d = 0; d < 4; d++) {
        var rr = r + CF_DIRS[d][0], cc = c + CF_DIRS[d][1];
        if (rr < 0 || rr >= CF_SIZE || cc < 0 || cc >= CF_SIZE) continue;
        var j = rr * CF_SIZE + cc, w = grid[j];
        if (!seen[j] && w && w[0] === v[0]) { seen[j] = true; stack.push(j); }
      }
    }
    out.push({terrain: v[0], size: size, crowns: crowns, cells: cells});
  }
  return out;
}
function cfScore(grid) {
  var props = cfProperties(grid), total = 0, largest = 0, crowns = 0;
  props.forEach(function (p) { total += p.size * p.crowns; largest = Math.max(largest, p.size); crowns += p.crowns; });
  return {total: total, largest: largest, crowns: crowns};
}
// ---- end shared geometry ----
function cfPayouts(ctx, winners) {
  var humans = ctx.players.filter(function (p) { return p.kind === 'human' && p.active !== false; }), out = {}, pot = ctx.pot || 0;
  if (!humans.length) return out;
  var ids = winners.map(function (seat) { return ctx.players[seat].id; });
  var paid = humans.filter(function (p) { return ids.indexOf(p.id) >= 0; });
  if (!paid.length) paid = humans;
  var share = Math.floor(pot / paid.length), rest = pot - share * paid.length;
  humans.forEach(function (p) { out[p.id] = 0; });
  paid.forEach(function (p) { out[p.id] = share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; });
  return out;
}
// Draw the next row: as many tiles as kings, shown in ascending order.
function cfDrawRow(s) {
  var row = [];
  for (var k = 0; k < s.kings.length && s.pile.length; k++) row.push({n: s.pile.pop(), king: null});
  row.sort(function (a, b) { return a.n - b.n; });
  return row;
}
function cfTurn(s, ctx) {
  if (s.phase === 'over') return null;
  return [ctx.players[s.kings[s.king]].id];
}
// Who acts next. Setup: kings pick in their random order. Play: in row order,
// each king lays its tile, then (unless it is the last round) picks.
function cfAdvance(s, ctx) {
  if (s.phase === 'setup') {
    s.setup_index++;
    if (s.setup_index < s.setup_order.length) { s.king = s.setup_order[s.setup_index]; s.stage = 'pick'; return; }
    cfNewRound(s);
    return;
  }
  if (s.stage === 'place' && s.next.length) { s.stage = 'pick'; return; }
  s.pos++;
  if (s.pos < s.row.length) { s.king = s.row[s.pos].king; s.stage = 'place'; return; }
  if (!s.next.length) { cfFinish(s, ctx); return; }
  cfNewRound(s);
}
function cfNewRound(s) {
  s.row = s.next; s.next = cfDrawRow(s); s.round++;
  s.phase = 'play'; s.pos = 0; s.king = s.row[0].king; s.stage = 'place';
}
function cfFinish(s, ctx) {
  s.phase = 'over'; s.stage = null;
  var scores = s.grids.map(cfScore), best = null;
  scores.forEach(function (sc) {
    if (best === null || sc.total > best.total || (sc.total === best.total && (sc.largest > best.largest ||
        (sc.largest === best.largest && sc.crowns > best.crowns)))) best = sc;
  });
  s.scores = scores.map(function (sc) { return sc.total; });
  s.winners = [];
  scores.forEach(function (sc, seat) {
    if (sc.total === best.total && sc.largest === best.largest && sc.crowns === best.crowns) s.winners.push(seat);
  });
}

const game = {
  newMatch(ctx) {
    var n = ctx.players.length;
    if (n < 2 || n > 4) throw new InvalidMove('two to four players');
    var all = [];
    for (var i = 1; i <= 48; i++) all.push(i);
    cfShuffle(all, ctx);
    // 2 players: 24 tiles and two kings each; 3: 36 tiles; 4: all 48.
    var pile = all.slice(0, n === 2 ? 24 : n === 3 ? 36 : 48);
    var kings = n === 2 ? [0, 0, 1, 1] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3];
    var grids = [], discards = [], laid = [];
    for (i = 0; i < n; i++) { grids.push(cfEmptyGrid()); discards.push(0); laid.push([]); }
    var order = cfShuffle(kings.map(function (k, idx) { return idx; }), ctx);
    var s = {phase: 'setup', pile: pile, kings: kings, grids: grids, laid: laid, discards: discards, row: [], next: [],
             setup_order: order, setup_index: 0, pos: 0, king: order[0], stage: 'pick', round: 0,
             scores: null, winners: null, last: null};
    s.next = cfDrawRow(s);
    return {state: s, turn: cfTurn(s, ctx)};
  },
  applyMove(state, playerId, move, ctx) {
    var seat = cfSeat(ctx, playerId);
    if (seat < 0) throw new InvalidMove('unknown player');
    if (state.phase === 'over') throw new InvalidMove('game over');
    if (state.kings[state.king] !== seat) throw new InvalidMove('not your turn');
    move = move || {};
    var s = cfCopy(state);
    if (state.stage === 'pick') {
      var pick = move.pick;
      if (!Number.isInteger(pick) || pick < 0 || pick >= s.next.length) throw new InvalidMove('choose a tile from the new row');
      if (s.next[pick].king !== null) throw new InvalidMove('that tile is already chosen');
      s.next[pick].king = s.king;
      s.last = {kind: 'pick', seat: seat, king: s.king, n: s.next[pick].n};
    } else {
      var n = s.row[s.pos].n, grid = s.grids[seat], options = cfPlacements(grid, n);
      if (move.discard === true) {
        if (options.length) throw new InvalidMove('this tile fits: you must lay it');
        s.discards[seat]++;
        s.last = {kind: 'discard', seat: seat, king: s.king, n: n};
      } else {
        if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell >= CF_SIZE * CF_SIZE ||
            !Number.isInteger(move.dir) || move.dir < 0 || move.dir > 3) throw new InvalidMove('choose where to lay the tile');
        if (!cfLegal(grid, n, move.cell, move.dir)) throw new InvalidMove('the tile cannot go there');
        s.grids[seat] = cfLay(grid, n, move.cell, move.dir);
        s.laid[seat].push({n: n, cell: move.cell, dir: move.dir});
        s.last = {kind: 'lay', seat: seat, king: s.king, n: n, cell: move.cell, dir: move.dir};
      }
    }
    cfAdvance(s, ctx);
    if (s.phase === 'over') return {state: s, turn: null, payouts: cfPayouts(ctx, s.winners)};
    return {state: s, turn: cfTurn(s, ctx)};
  },
  randomMove(state, playerId, ctx) {
    if (state.stage === 'pick') {
      var free = [];
      state.next.forEach(function (t, i) { if (t.king === null) free.push(i); });
      return {pick: free[Math.floor(ctx.random() * free.length)]};
    }
    var seat = state.kings[state.king], options = cfPlacements(state.grids[seat], state.row[state.pos].n);
    if (!options.length) return {discard: true};
    return options[Math.floor(ctx.random() * options.length)];
  },
  computerMove(state, playerId, ctx) {
    var seat = state.kings[state.king];
    if (state.stage === 'pick') return cfChoosePick(state, seat, ctx);
    var n = state.row[state.pos].n, best = cfBestLay(state.grids[seat], n, ctx);
    return best ? {cell: best.cell, dir: best.dir} : {discard: true};
  },
  viewFor(state, playerId, ctx) {
    // Everything is public except the order of the face-down pile.
    var v = cfCopy(state);
    delete v.pile; delete v.setup_order;
    v.pile = state.pile.length;
    v.me = playerId === null || playerId === undefined ? -1 : cfSeat(ctx, playerId);
    v.live_scores = state.grids.map(function (g) { return cfScore(g).total; });
    // The portal's result line reads one winner seat, or -1 for a shared win.
    v.winner = state.winners ? (state.winners.length === 1 ? state.winners[0] : -1) : null;
    return v;
  },
};

// ---- Computer player -------------------------------------------------------
// How good a realm is: its score now, plus room to grow (open squares next to
// crowned or large properties), minus squares that can never be filled.
function cfValue(grid) {
  var props = cfProperties(grid), value = 0;
  props.forEach(function (p) { value += p.size * p.crowns + (p.crowns ? p.size * 0.35 + p.crowns * 1.2 : p.size * 0.15); });
  var b = cfBounds(grid);
  var spanR = b.r1 - b.r0 + 1, spanC = b.c1 - b.c0 + 1;
  // Single empty squares boxed in on all sides inside the realm are lost.
  for (var r = b.r0; r <= b.r1; r++) for (var c = b.c0; c <= b.c1; c++) {
    var i = r * CF_SIZE + c;
    if (grid[i]) continue;
    var open = 0;
    for (var d = 0; d < 4; d++) {
      var rr = r + CF_DIRS[d][0], cc = c + CF_DIRS[d][1];
      if (rr < 0 || rr >= CF_SIZE || cc < 0 || cc >= CF_SIZE) continue;
      if (!grid[rr * CF_SIZE + cc] && (Math.max(b.r1, rr) - Math.min(b.r0, rr) < CF_LIMIT) && (Math.max(b.c1, cc) - Math.min(b.c0, cc) < CF_LIMIT)) open++;
    }
    if (!open) value -= 2.5;
  }
  return value - (spanR > 5 || spanC > 5 ? 100 : 0);
}
function cfBestLay(grid, n, ctx) {
  var options = cfPlacements(grid, n), best = null, bestValue = -Infinity;
  options.forEach(function (o) {
    var value = cfValue(cfLay(grid, n, o.cell, o.dir)) + ctx.random() * 0.01;
    if (value > bestValue) { bestValue = value; best = o; }
  });
  return best ? {cell: best.cell, dir: best.dir, value: bestValue} : null;
}
function cfChoosePick(state, seat, ctx) {
  var base = cfValue(state.grids[seat]), best = 0, bestValue = -Infinity;
  state.next.forEach(function (t, i) {
    if (t.king !== null) return;
    var lay = cfBestLay(state.grids[seat], t.n, ctx);
    var gain = lay ? lay.value - base : -3;
    // A low number means picking earlier next round.
    var value = gain + (48 - t.n) * 0.02 + ctx.random() * 0.01;
    if (value > bestValue) { bestValue = value; best = i; }
  });
  return {pick: best};
}
