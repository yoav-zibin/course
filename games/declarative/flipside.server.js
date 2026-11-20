// Flipside Lords (based on The Duke). Two players, 6x6 board. Every troop
// tile has two sides with different movement grids and flips after it acts.
// Capture the enemy Lord (the Duke) to win.
//
// Tile data: the 12 base-set troop types, each side a list of icons
// [kind, dc, dr] in the tile's own frame (dc right, dr forward, toward the
// opponent); slides give a direction. Checked against two independent
// sources (see FLIPSIDE.md).
// ---- shared rules (also copied into the presentation by the builder) ----
var FL_TILES = {
  duke: {count: 1, sides: [[['slide', -1, 0], ['slide', 1, 0]], [['slide', 0, 1], ['slide', 0, -1]]]},
  footman: {count: 3, sides: [[['move', 0, 1], ['move', -1, 0], ['move', 1, 0], ['move', 0, -1]], [['move', 0, 2], ['move', -1, 1], ['move', 1, 1], ['move', -1, -1], ['move', 1, -1]]]},
  pikeman: {count: 3, sides: [[['move', -1, 1], ['move', -2, 2], ['move', 1, 1], ['move', 2, 2]], [['strike', -1, 2], ['strike', 1, 2], ['move', 0, 1], ['move', 0, -1], ['move', 0, -2]]]},
  knight: {count: 1, sides: [[['jump', -1, 2], ['jump', 1, 2], ['move', -1, 0], ['move', 1, 0], ['move', 0, -1], ['move', 0, -2]], [['slide', 0, 1], ['move', -1, -1], ['move', 1, -1], ['move', -2, -2], ['move', 2, -2]]]},
  wizard: {count: 1, sides: [[['move', -1, 1], ['move', 0, 1], ['move', 1, 1], ['move', -1, 0], ['move', 1, 0], ['move', -1, -1], ['move', 0, -1], ['move', 1, -1]], [['jump', -2, 2], ['jump', -2, 0], ['jump', -2, -2], ['jump', 0, 2], ['jump', 0, -2], ['jump', 2, 2], ['jump', 2, 0], ['jump', 2, -2]]]},
  ranger: {count: 1, sides: [[['slide', 0, 1], ['slide', 0, -1], ['jump', -2, 1], ['jump', -1, 2], ['jump', 1, 2], ['jump', 2, 1]], [['slide', -1, 1], ['slide', 1, 1], ['jump', -1, -2], ['jump', 1, -2]]]},
  seer: {count: 1, sides: [[['move', -1, 1], ['move', -1, -1], ['move', 1, 1], ['move', 1, -1], ['jump', 0, 2], ['jump', 0, -2], ['jump', 2, 0], ['jump', -2, 0]], [['move', 0, 1], ['move', -1, 0], ['move', 1, 0], ['move', 0, -1], ['jump', -2, 2], ['jump', -2, -2], ['jump', 2, 2], ['jump', 2, -2]]]},
  general: {count: 1, sides: [[['jump', -1, 2], ['jump', 1, 2], ['move', 0, 1], ['move', -2, 0], ['move', 2, 0], ['move', 0, -1]], [['jump', -1, 2], ['jump', 1, 2], ['move', 0, 1], ['move', -2, 0], ['move', -1, 0], ['move', 1, 0], ['move', 2, 0], ['command', -1, 0], ['command', 1, 0], ['command', -1, -1], ['command', 0, -1], ['command', 1, -1]]]},
  priest: {count: 1, sides: [[['slide', -1, 1], ['slide', 1, 1], ['slide', -1, -1], ['slide', 1, -1]], [['jump', -2, 2], ['jump', 2, 2], ['jump', -2, -2], ['jump', 2, -2], ['move', -1, 1], ['move', -1, -1], ['move', 1, 1], ['move', 1, -1]]]},
  champion: {count: 1, sides: [[['jump', 0, 2], ['move', 0, 1], ['move', -1, 0], ['move', 1, 0], ['move', 0, -1], ['jump', 2, 0], ['jump', -2, 0], ['jump', 0, -2]], [['jump', 0, 2], ['jump', -2, 0], ['jump', 2, 0], ['jump', 0, -2], ['strike', 0, 1], ['strike', -1, 0], ['strike', 1, 0], ['strike', 0, -1]]]},
  marshall: {count: 1, sides: [[['jump', 2, 2], ['jump', -2, 2], ['slide', -1, 0], ['slide', 1, 0], ['jump', 0, -2]], [['move', -2, 0], ['move', -1, 1], ['move', -1, 0], ['move', -1, -1], ['move', 0, 1], ['move', 1, 1], ['move', 1, 0], ['move', 1, -1], ['move', 2, 0], ['command', -1, 1], ['command', 0, 1], ['command', 1, 1]]]},
  bowman: {count: 1, sides: [[['move', 0, 1], ['move', -1, 0], ['move', 1, 0], ['jump', -2, 0], ['jump', 2, 0], ['jump', 0, -2]], [['strike', 0, 2], ['strike', -1, 1], ['strike', 1, 1], ['move', 0, 1], ['move', -1, -1], ['move', 1, -1]]]},
};
var FL_BAG = ['footman', 'pikeman', 'pikeman', 'pikeman', 'knight', 'wizard', 'ranger', 'seer', 'general', 'priest', 'champion', 'marshall', 'bowman'];
// Seat 0 plays from the bottom (row 5), seat 1 from the top (row 0); tiles
// face their owner, so a tile's forward is up for seat 0 and down for seat 1.
function flDelta(owner, dc, dr) { return owner === 0 ? [dc, -dr] : [-dc, dr]; }
function flAt(c, r) { return c < 0 || c > 5 || r < 0 || r > 5 ? -1 : r * 6 + c; }
function flPseudo(board, owner) {
  // Every action the owner's tiles allow, ignoring the danger rule.
  var out = [];
  board.forEach(function (t, sq) {
    if (!t || t.o !== owner) return;
    var c = sq % 6, r = Math.floor(sq / 6), icons = FL_TILES[t.t].sides[t.s], command = [];
    icons.forEach(function (ic) {
      var d = flDelta(owner, ic[1], ic[2]), kind = ic[0];
      if (kind === 'slide') {
        for (var k = 1; k < 6; k++) {
          var s = flAt(c + d[0] * k, r + d[1] * k);
          if (s < 0) break;
          if (board[s] && board[s].o === owner) break;
          out.push({action: 'move', from: sq, to: s});
          if (board[s]) break;
        }
        return;
      }
      var to = flAt(c + d[0], r + d[1]);
      if (to < 0) return;
      if (kind === 'command') { command.push(to); return; }
      if (kind === 'strike') { if (board[to] && board[to].o !== owner) out.push({action: 'strike', from: sq, to: to}); return; }
      if (board[to] && board[to].o === owner) return;
      if (kind === 'move') {
        // A clear straight path: every square between must be empty.
        var steps = Math.max(Math.abs(d[0]), Math.abs(d[1])), straight = d[0] === 0 || d[1] === 0 || Math.abs(d[0]) === Math.abs(d[1]);
        if (straight) for (var j = 1; j < steps; j++) {
          if (board[flAt(c + Math.sign(d[0]) * j, r + Math.sign(d[1]) * j)]) return;
        }
      }
      out.push({action: 'move', from: sq, to: to});
    });
    // Command: move one of your tiles from a command square to another.
    command.forEach(function (a) {
      if (!board[a] || board[a].o !== owner) return;
      command.forEach(function (b) {
        if (a !== b && !(board[b] && board[b].o === owner)) out.push({action: 'command', from: sq, via: a, to: b});
      });
    });
  });
  return out;
}
function flDuke(board, owner) {
  for (var i = 0; i < 36; i++) if (board[i] && board[i].o === owner && board[i].t === 'duke') return i;
  return -1;
}
// Apply an action to a board copy (placements need the drawn type).
function flApply(board, owner, a, drawn) {
  var b = board.slice(), captured = null;
  if (a.action === 'place') { b[a.to] = {o: owner, t: drawn || 'footman', s: 0, id: -1}; return {board: b, captured: null}; }
  var actor = b[a.from];
  if (a.action === 'strike') { captured = b[a.to]; b[a.to] = null; }
  else if (a.action === 'command') { captured = b[a.to]; b[a.to] = b[a.via]; b[a.via] = null; }
  else { captured = b[a.to]; b[a.to] = actor; b[a.from] = null; }
  // The tile that used an icon flips (a commanded tile does not).
  var flipped = a.action === 'move' ? a.to : a.from;
  b[flipped] = Object.assign({}, b[flipped], {s: 1 - b[flipped].s});
  return {board: b, captured: captured};
}
function flInDanger(board, owner) {
  var duke = flDuke(board, owner);
  if (duke < 0) return true;
  return flPseudo(board, 1 - owner).some(function (a) { return a.to === duke; });
}
function flPlacements(board, owner, bagSize) {
  var duke = flDuke(board, owner), out = [];
  if (duke < 0 || !bagSize) return out;
  var c = duke % 6, r = Math.floor(duke / 6);
  [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(function (d) {
    var s = flAt(c + d[0], r + d[1]);
    if (s >= 0 && !board[s]) out.push({action: 'place', to: s});
  });
  return out;
}
// Legal actions: never leave your own Lord where it can be taken next turn.
function flLegal(board, owner, bagSize) {
  return flPseudo(board, owner).concat(flPlacements(board, owner, bagSize)).filter(function (a) {
    return !flInDanger(flApply(board, owner, a).board, owner);
  });
}
// Setup squares for a seat: the two middle squares of its home row.
function flHome(seat) { return seat === 0 ? [32, 33] : [2, 3]; }
function flFootmanSquares(duke) {
  var c = duke % 6, r = Math.floor(duke / 6), out = [];
  [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) { var s = flAt(c + d[0], r + d[1]); if (s >= 0) out.push(s); });
  return out;
}
// ---- end shared rules ----
function flSeat(ctx, playerId) {
  for (var i = 0; i < ctx.players.length; i++) if (ctx.players[i].id === playerId) return i;
  return -1;
}
function flCopy(s) { return JSON.parse(JSON.stringify(s)); }
function flSame(a, b) {
  return a.action === b.action && a.to === b.to && (a.from === undefined || a.from === b.from) && (a.via === undefined || a.via === b.via);
}
function flPayouts(ctx, winner) {
  var humans = ctx.players.filter(function (p) { return p.kind === 'human' && p.active !== false; }), out = {}, pot = ctx.pot || 0;
  if (!humans.length) return out;
  var winnerId = winner >= 0 ? ctx.players[winner].id : null;
  var paid = humans.filter(function (p) { return p.id === winnerId; });
  if (!paid.length) paid = humans;
  var share = Math.floor(pot / paid.length), rest = pot - share * paid.length;
  humans.forEach(function (p) { out[p.id] = 0; });
  paid.forEach(function (p) { out[p.id] = share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; });
  return out;
}
var FL_QUIET_LIMIT = 50;

const game = {
  newMatch(ctx) {
    if (ctx.players.length !== 2) throw new InvalidMove('two players required');
    var board = [];
    for (var i = 0; i < 36; i++) board.push(null);
    return {state: {phase: 'setup', board: board, bags: [FL_BAG.slice(), FL_BAG.slice()], cur: 0, next_id: 0,
                    winner: null, reason: null, quiet: 0, turn_no: 0, captured: [[], []], last: null},
            turn: [ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    var seat = flSeat(ctx, playerId);
    if (seat < 0) throw new InvalidMove('unknown player');
    if (state.winner !== null) throw new InvalidMove('game over');
    if (seat !== state.cur) throw new InvalidMove('not your turn');
    move = move || {};
    var s = flCopy(state);
    if (state.phase === 'setup') {
      var duke = move.duke, feet = move.footmen;
      if (flHome(seat).indexOf(duke) < 0) throw new InvalidMove('place your Lord on a middle square of your home row');
      var around = flFootmanSquares(duke).filter(function (q) { return !state.board[q]; });
      if (!Array.isArray(feet) || feet.length !== 2 || feet[0] === feet[1] ||
          feet.some(function (q) { return around.indexOf(q) < 0; })) throw new InvalidMove('place two footmen beside your Lord');
      s.board[duke] = {o: seat, t: 'duke', s: 0, id: s.next_id++};
      feet.forEach(function (q) { s.board[q] = {o: seat, t: 'footman', s: 0, id: s.next_id++}; });
      s.last = {kind: 'setup', seat: seat};
      if (seat === 0) { s.cur = 1; } else { s.phase = 'play'; s.cur = 0; }
      return {state: s, turn: [ctx.players[s.cur].id]};
    }
    var legal = flLegal(state.board, seat, state.bags[seat].length);
    var chosen = legal.filter(function (a) { return flSame(move, a); })[0];
    if (!chosen) throw new InvalidMove('that move is not allowed');
    var drawn = null;
    if (chosen.action === 'place') {
      var k = Math.floor(ctx.random() * s.bags[seat].length);
      drawn = s.bags[seat].splice(k, 1)[0];
    }
    var res = flApply(state.board, seat, chosen, drawn);
    s.board = res.board;
    if (chosen.action === 'place') s.board[chosen.to] = {o: seat, t: drawn, s: 0, id: s.next_id++};
    if (res.captured) s.captured[seat].push(res.captured.t);
    s.turn_no++;
    s.quiet = res.captured || chosen.action === 'place' ? 0 : s.quiet + 1;
    s.last = {kind: chosen.action, seat: seat, from: chosen.from === undefined ? null : chosen.from, via: chosen.via === undefined ? null : chosen.via,
              to: chosen.to, captured: res.captured ? res.captured.t : null, drawn: drawn};
    var other = 1 - seat;
    if (flDuke(s.board, other) < 0) { s.winner = seat; s.reason = 'captured'; }
    else if (!flLegal(s.board, other, s.bags[other].length).length) { s.winner = seat; s.reason = flInDanger(s.board, other) ? 'trapped' : 'stuck'; }
    else if (s.quiet >= FL_QUIET_LIMIT) { s.winner = -1; s.reason = 'quiet'; }
    if (s.winner !== null) { s.phase = 'over'; s.cur = null; return {state: s, turn: null, payouts: flPayouts(ctx, s.winner)}; }
    s.cur = other;
    return {state: s, turn: [ctx.players[other].id]};
  },
  randomMove(state, playerId, ctx) {
    var seat = state.cur;
    if (state.phase === 'setup') {
      var duke = flHome(seat)[Math.floor(ctx.random() * 2)];
      var around = flFootmanSquares(duke).filter(function (q) { return !state.board[q]; });
      var i = Math.floor(ctx.random() * around.length), j = (i + 1 + Math.floor(ctx.random() * (around.length - 1))) % around.length;
      return {duke: duke, footmen: [around[i], around[j]]};
    }
    var legal = flLegal(state.board, seat, state.bags[seat].length);
    return flStrip(legal[Math.floor(ctx.random() * legal.length)]);
  },
  computerMove(state, playerId, ctx) {
    var seat = state.cur;
    if (state.phase === 'setup') {
      var duke = flHome(seat)[ctx.random() < 0.5 ? 0 : 1], ahead = duke + (seat === 0 ? -6 : 6);
      var sides = flFootmanSquares(duke).filter(function (q) { return q !== ahead && Math.floor(q / 6) === Math.floor(duke / 6); });
      return {duke: duke, footmen: [ahead, sides[Math.floor(ctx.random() * sides.length)]]};
    }
    return flStrip(flChoose(state, seat, ctx));
  },
  viewFor(state, playerId, ctx) {
    // Everything is public: tiles on the board, both bags' contents (drawn at random), captures.
    var v = flCopy(state);
    v.me = playerId === null || playerId === undefined ? -1 : flSeat(ctx, playerId);
    return v;
  },
};
function flStrip(a) {
  var m = {action: a.action, to: a.to};
  if (a.from !== undefined) m.from = a.from;
  if (a.via !== undefined) m.via = a.via;
  return m;
}

// ---- Computer player -------------------------------------------------------
var FL_VALUE = {duke: 0, footman: 2, pikeman: 2, bowman: 3, knight: 3.5, seer: 3.5, priest: 4, wizard: 4, ranger: 4, champion: 4.5, general: 4.5, marshall: 4.5};
// One-ply search with the opponent's best capture as the reply: take the
// Lord when possible, never hang pieces needlessly, prefer safe captures,
// draw troops early, and press toward the enemy Lord.
function flChoose(state, seat, ctx) {
  var legal = flLegal(state.board, seat, state.bags[seat].length), best = legal[0], bestValue = -Infinity;
  var other = 1 - seat, bagOther = state.bags[other].length;
  legal.forEach(function (a) {
    var res = flApply(state.board, seat, a, 'footman'), b = res.board, value = 0;
    if (res.captured && res.captured.t === 'duke') value = 1e6;
    else {
      if (res.captured) value += 10 * FL_VALUE[res.captured.t];
      var replies = flLegal(b, other, bagOther);
      if (!replies.length) value += flInDanger(b, other) ? 1e5 : 2e4;
      var worst = 0;
      replies.forEach(function (r) {
        if (r.action === 'place') return;
        var hit = b[r.to];
        if (hit && hit.o === seat) worst = Math.max(worst, hit.t === 'duke' ? 1e5 : 10 * FL_VALUE[hit.t]);
      });
      value -= worst * 0.9;
      if (a.action === 'place') value += state.bags[seat].length > 6 ? 6 : 3;
      // Edge toward the enemy Lord.
      var mine = flDuke(b, other);
      if (mine >= 0 && a.action !== 'place' && a.action !== 'strike') {
        var t = a.to, dist = Math.abs(t % 6 - mine % 6) + Math.abs(Math.floor(t / 6) - Math.floor(mine / 6));
        value += (10 - dist) * 0.15;
      }
      // Keep options open: tiles with more legal actions next turn.
      value += Math.min(flPseudo(b, seat).length, 40) * 0.05;
    }
    value += ctx.random() * 0.3;
    if (value > bestValue) { bestValue = value; best = a; }
  });
  return best;
}
