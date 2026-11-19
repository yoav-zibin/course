// Twist Five (based on Pentago). 6x6 board made of four 3x3 plates.
// A turn: place a marble on an empty hole, then turn one plate 90 degrees
// either way. Five in a row (row, column or diagonal) wins, counted right after
// the placement (then the turn ends without a twist) or after the twist. If a
// twist gives both players five, the game is a draw; a full board without five
// is a draw. Turning a plate with rotational symmetry changes nothing, which is
// how the official "optional twist" opening is expressed here.
var TF_LINES = (function () {
  var lines = [], r, c, k, dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (r = 0; r < 6; r++) for (c = 0; c < 6; c++) for (k = 0; k < 4; k++) {
    var dr = dirs[k][0], dc = dirs[k][1], er = r + 4 * dr, ec = c + 4 * dc;
    if (er < 0 || er > 5 || ec < 0 || ec > 5) continue;
    var line = [];
    for (var i = 0; i < 5; i++) line.push((r + i * dr) * 6 + c + i * dc);
    lines.push(line);
  }
  return lines;
})();
var TF_DIRECTIONS = ['clockwise', 'counterclockwise'];

function tfSeat(ctx, playerId) {
  for (var i = 0; i < ctx.players.length; i++) if (ctx.players[i].id === playerId) return i;
  return -1;
}
function tfTurn(ctx, seat) { return [ctx.players[seat].id]; }
function tfCopy(s) {
  return {board: s.board.slice(), ids: s.ids.slice(), plates: s.plates.slice(), cur: s.cur, next_id: s.next_id,
          winner: s.winner, line: s.line ? s.line.slice() : null, last: s.last ? JSON.parse(JSON.stringify(s.last)) : null};
}
// Cells of plate q in reading order; plate 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right.
function tfPlateCells(q) {
  var r0 = (q >> 1) * 3, c0 = (q & 1) * 3, out = [];
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) out.push((r0 + r) * 6 + c0 + c);
  return out;
}
// Turn plate q a quarter turn. Clockwise sends local (r, c) to (c, 2 - r).
function tfTwist(board, q, direction) {
  var cells = tfPlateCells(q), before = cells.map(function (cell) { return board[cell]; });
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
    var to = direction === 'clockwise' ? c * 3 + (2 - r) : (2 - c) * 3 + r;
    board[cells[to]] = before[r * 3 + c];
  }
}
function tfFive(board, seat) {
  for (var i = 0; i < TF_LINES.length; i++) {
    var line = TF_LINES[i], k = 0;
    while (k < 5 && board[line[k]] === seat) k++;
    if (k === 5) return line;
  }
  return null;
}
function tfFull(board) { for (var i = 0; i < 36; i++) if (board[i] < 0) return false; return true; }
function tfPayouts(ctx, winner) {
  var humans = ctx.players.filter(function (p) { return p.kind === 'human'; }), out = {}, pot = ctx.pot || 0;
  if (!humans.length) return out;
  var winnerId = winner >= 0 ? ctx.players[winner].id : null;
  var humanWon = humans.some(function (p) { return p.id === winnerId; });
  var share = Math.floor(pot / humans.length), rest = pot - share * humans.length;
  humans.forEach(function (p) {
    if (humanWon) out[p.id] = p.id === winnerId ? pot : 0;
    else { out[p.id] = share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
  });
  return out;
}
// The outcome after the mover places at cell and (unless placement already
// wins) twists. Returns {board, ids?, winner: null | seat | -1 (draw), line}.
function tfResolve(board, seat, cell, quadrant, direction) {
  var b = board.slice();
  b[cell] = seat;
  var line = tfFive(b, seat);
  if (line) return {board: b, winner: seat, line: line, placementWin: true};
  if (quadrant === undefined) return null;
  tfTwist(b, quadrant, direction);
  var mine = tfFive(b, seat), theirs = tfFive(b, 1 - seat);
  if (mine && theirs) return {board: b, winner: -1, line: null};
  if (mine) return {board: b, winner: seat, line: mine};
  if (theirs) return {board: b, winner: 1 - seat, line: theirs};
  if (tfFull(b)) return {board: b, winner: -1, line: null};
  return {board: b, winner: null, line: null};
}
function tfLegalMoves(s) {
  var out = [];
  for (var cell = 0; cell < 36; cell++) {
    if (s.board[cell] >= 0) continue;
    var b = s.board.slice(); b[cell] = s.cur;
    if (tfFive(b, s.cur)) { out.push({cell: cell}); continue; }
    for (var q = 0; q < 4; q++) for (var d = 0; d < 2; d++) out.push({cell: cell, quadrant: q, direction: TF_DIRECTIONS[d]});
  }
  return out;
}
// Line potential: open lines with k of my marbles and none of theirs.
var TF_WEIGHT = [0, 1, 6, 40, 300, 100000];
function tfScore(board, seat) {
  var score = 0;
  for (var i = 0; i < TF_LINES.length; i++) {
    var mine = 0, theirs = 0, line = TF_LINES[i];
    for (var k = 0; k < 5; k++) { var v = board[line[k]]; if (v === seat) mine++; else if (v >= 0) theirs++; }
    if (!theirs) score += TF_WEIGHT[mine];
    else if (!mine) score -= TF_WEIGHT[theirs] * 1.4;
  }
  return score;
}
// Placing then twisting equals twisting first and placing on the matching
// empty hole. So the winning chances of the player to move are the lines with
// four of their marbles and one empty hole, on the board as it is (a win by
// placement) or after any of the eight twists.
var TF_VARIANTS = [null];
for (var tfq = 0; tfq < 4; tfq++) TF_VARIANTS.push([tfq, 'clockwise'], [tfq, 'counterclockwise']);
function tfThreats(board, seat) {
  // [fours, fours] then [threes, threes]: a three with two empty holes can
  // become an unstoppable open four next turn.
  var count = [0, 0], threes = [0, 0];
  for (var v = 0; v < TF_VARIANTS.length; v++) {
    var b = board;
    if (TF_VARIANTS[v]) { b = board.slice(); tfTwist(b, TF_VARIANTS[v][0], TF_VARIANTS[v][1]); }
    for (var i = 0; i < TF_LINES.length; i++) {
      var line = TF_LINES[i], n0 = 0, n1 = 0, empty = 0;
      for (var k = 0; k < 5; k++) { var x = b[line[k]]; if (x === 0) n0++; else if (x === 1) n1++; else empty++; }
      if (empty === 1) { if (n0 === 4) count[0]++; else if (n1 === 4) count[1]++; }
      else if (empty === 2) { if (n0 === 3) threes[0]++; else if (n1 === 3) threes[1]++; }
    }
  }
  return seat === 0 ? [count[0], count[1], threes[0], threes[1]] : [count[1], count[0], threes[1], threes[0]];
}

const game = {
  newMatch(ctx) {
    if (ctx.players.length !== 2) throw new InvalidMove('two players required');
    var board = [], ids = [];
    for (var i = 0; i < 36; i++) { board.push(-1); ids.push(-1); }
    return {state: {board: board, ids: ids, plates: [0, 0, 0, 0], cur: 0, next_id: 0, winner: null, line: null, last: null},
            turn: tfTurn(ctx, 0)};
  },
  applyMove(state, playerId, move, ctx) {
    var seat = tfSeat(ctx, playerId);
    if (seat < 0) throw new InvalidMove('unknown player');
    if (state.winner !== null) throw new InvalidMove('game over');
    if (seat !== state.cur) throw new InvalidMove('not your turn');
    var cell = move.cell;
    if (!Number.isInteger(cell) || cell < 0 || cell > 35) throw new InvalidMove('bad hole');
    if (state.board[cell] >= 0) throw new InvalidMove('that hole is taken');
    var twisting = move.quadrant !== undefined || move.direction !== undefined;
    if (twisting && (!Number.isInteger(move.quadrant) || move.quadrant < 0 || move.quadrant > 3 ||
                     TF_DIRECTIONS.indexOf(move.direction) < 0)) throw new InvalidMove('bad twist');
    var placed = state.board.slice(); placed[cell] = seat;
    var placementWin = Boolean(tfFive(placed, seat));
    if (placementWin && twisting) throw new InvalidMove('five in a row already: no twist');
    if (!placementWin && !twisting) throw new InvalidMove('choose a plate to twist');
    var s = tfCopy(state);
    s.ids[cell] = s.next_id++;
    var result = tfResolve(s.board, seat, cell, move.quadrant, move.direction);
    if (twisting) {
      // Marble identities follow their marbles around the turned plate.
      tfTwist(s.ids, move.quadrant, move.direction);
      s.plates[move.quadrant] += move.direction === 'clockwise' ? 90 : -90;
    }
    s.board = result.board;
    s.last = {seat: seat, cell: cell, quadrant: twisting ? move.quadrant : null, direction: twisting ? move.direction : null};
    if (result.winner !== null) {
      s.winner = result.winner; s.line = result.line;
      return {state: s, turn: null, payouts: tfPayouts(ctx, result.winner)};
    }
    s.cur = 1 - seat;
    return {state: s, turn: tfTurn(ctx, s.cur)};
  },
  randomMove(state, playerId, ctx) {
    var moves = tfLegalMoves(state);
    return moves[Math.floor(ctx.random() * moves.length)];
  },
  computerMove(state, playerId, ctx) {
    var seat = state.cur, moves = tfLegalMoves(state), scored = [], i;
    for (i = 0; i < moves.length; i++) {
      var m = moves[i], r = tfResolve(state.board, seat, m.cell, m.quadrant, m.direction);
      if (r.winner === seat) return m;
      var value = r.winner === 1 - seat ? -1e9 : r.winner === -1 ? -1e5 : tfScore(r.board, seat);
      scored.push({move: m, board: r.board, over: r.winner !== null, value: value + ctx.random() * 3});
    }
    scored.sort(function (a, b) { return b.value - a.value; });
    // For the most promising moves, never leave the opponent a win next turn,
    // and prefer my own threats: two or more cannot all be blocked.
    var best = scored[0], bestValue = -Infinity;
    for (i = 0; i < scored.length && i < 48; i++) {
      var c = scored[i], value2 = c.value;
      if (!c.over) {
        var t = tfThreats(c.board, seat);
        value2 += (t[1] ? -1e7 - t[1] * 1000 : 0) + Math.min(t[0], 3) * 2500 - t[3] * 220 + t[2] * 60;
      }
      if (value2 > bestValue) { bestValue = value2; best = c; }
    }
    return best.move;
  },
  viewFor(state, playerId, ctx) {
    return {board: state.board.slice(), ids: state.ids.slice(), plates: state.plates.slice(), cur: state.cur,
            winner: state.winner, line: state.line ? state.line.slice() : null, last: state.last};
  },
};
