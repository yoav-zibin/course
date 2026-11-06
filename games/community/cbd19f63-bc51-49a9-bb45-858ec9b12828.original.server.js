const game = {
  LADDERS: {1:38,4:14,9:31,21:42,28:84,36:44,51:67,71:91,80:100},
  CHUTES: {16:6,47:26,49:11,56:53,62:19,64:60,87:24,93:73,95:75,98:78},
  LAD_MSG: {1:"shared toys!",4:"shared your snack!",9:"said please & thank you!",21:"helped a friend up!",28:"brushed teeth!",36:"read a book!",51:"set the table!",71:"told the truth!",80:"helped everyone!"},
  CHU_MSG: {16:"ran inside!",47:"didn't look both ways!",49:"grabbed a toy!",56:"forgot to wash hands!",62:"left a mess!",64:"stayed up too late!",87:"didn't hold railing!",93:"teased a friend!",95:"forgot umbrella!",98:"rushed too fast!"},
  PIECES: ["\uD83D\uDC51","\uD83C\uDFA9","\uD83D\uDEA2","\uD83D\uDC36","\uD83C\uDF92","\uD83D\uDE97"],
  idxOf: function(ctx, playerId) { return ctx.players.findIndex(function(p){ return p.id === playerId; }); },
  nameOf: function(ctx, i) { return (ctx.players[i] && ctx.players[i].display_name) || ("P" + (i+1)); },
  fullOrder: function(state, n) {
    var order = (state.turnOrder || []).filter(function(x){ return x>=0 && x<n; });
    for (var i=0;i<n;i++) if (order.indexOf(i)<0) order.push(i);
    return order;
  },
  payoutsFor: function(ctx, winnerIdx) {
    var pot = ctx.pot || 0;
    var out = {};
    var humans = ctx.players.filter(function(p){ return p.kind !== "computer"; });
    if (pot <= 0 || humans.length === 0) return out;
    var w = ctx.players[winnerIdx];
    if (w && w.kind !== "computer") { out[w.id] = pot; return out; }
    var base = Math.floor(pot / humans.length);
    var rem = pot;
    humans.forEach(function(h, k) {
      var v = (k === humans.length - 1) ? rem : base;
      out[h.id] = v; rem -= v;
    });
    return out;
  },
  newMatch: function(ctx) {
    var n = ctx.players.length;
    var positions = []; for (var i=0;i<n;i++) positions.push(0);
    var state = { positions: positions, phase: "rolloff", pieces: {}, selectTurn: null, selectOrder: null, selectIdx: 0, rolloffSpins: {}, rolloffTurn: 0, turnOrder: null, turnPos: 0, lastSpin: null, lastAngle: null, lastEvent: null, lastFrom: null, lastTo: null, winner: null, log: ["Roll-off to see who goes first! Highest spin wins!"] };
    return { state: state, turn: [ctx.players[0].id] };
  },
  applyMove: function(state, playerId, move, ctx) {
    var n = ctx.players.length;
    var me = this.idxOf(ctx, playerId);
    if (me < 0) throw new InvalidMove("not seated");
    if (state.winner != null) throw new InvalidMove("game over");
    move = move || {};
    var i, k;
    if (state.phase === "rolloff") {
      if (move.kind !== "spin") throw new InvalidMove("spin to roll off");
      if (Number(state.rolloffTurn) !== me) throw new InvalidMove("not your roll-off turn");
      if (state.rolloffSpins && (state.rolloffSpins[me] != null || state.rolloffSpins[String(me)] != null)) throw new InvalidMove("already rolled");
      var spin = 1 + Math.floor(ctx.random() * 6);
      var jit = ctx.random() * 44 - 22;
      var ang = ((spin - 1) * 60 + jit + 360) % 360;
      var rolls = Object.assign({}, state.rolloffSpins || {});
      rolls[me] = spin;
      var log = (state.log || []).slice(-20);
      log.push(this.nameOf(ctx, me) + " rolled " + spin + " for first turn");
      var unrolled = [];
      for (i=0;i<n;i++) if (rolls[i] == null && rolls[String(i)] == null) unrolled.push(i);
      if (unrolled.length > 0) {
        var ns1 = { positions: state.positions.slice(), phase: "rolloff", pieces: {}, selectTurn: null, selectOrder: null, selectIdx: 0, rolloffSpins: rolls, rolloffTurn: unrolled[0], turnOrder: null, turnPos: 0, lastSpin: spin, lastAngle: ang, lastEvent: "rolloff", lastFrom: null, lastTo: null, winner: null, log: log };
        return { state: ns1, turn: [ctx.players[unrolled[0]].id] };
      }
      var order = []; for (i=0;i<n;i++) order.push(i);
      order.sort(function(a,b){ var va = (rolls[a]!=null?rolls[a]:rolls[String(a)])|0; var vb = (rolls[b]!=null?rolls[b]:rolls[String(b)])|0; return (vb-va)||(a-b); });
      var selOrder = order.slice().reverse();
      var firstPicker = selOrder[0];
      var ns2 = { positions: state.positions.slice(), phase: "select", pieces: {}, selectTurn: firstPicker, selectOrder: selOrder, selectIdx: 0, rolloffSpins: rolls, rolloffTurn: null, turnOrder: order, turnPos: 0, lastSpin: spin, lastAngle: ang, lastEvent: "rolloff-done", lastFrom: null, lastTo: null, winner: null, log: log.concat([this.nameOf(ctx, order[0]) + " goes first! Order: " + order.map(function(x){ return this.nameOf(ctx,x); }, this).join(", "), "Last place picks piece first: " + this.nameOf(ctx, firstPicker) + " choose!"]) };
      return { state: ns2, turn: [ctx.players[firstPicker].id] };
    }
    if (state.phase === "select") {
      if (move.kind !== "select") throw new InvalidMove("pick a piece");
      var base = state.turnOrder || state.selectOrder || null;
      var rev = [];
      if (state.selectOrder) rev = state.selectOrder;
      else if (base) rev = base.slice().reverse();
      else { for (i=0;i<n;i++) rev.unshift(i); }
      var idx = (state.selectIdx != null ? state.selectIdx : Object.keys(state.pieces||{}).length);
      var expect = (state.selectTurn != null ? state.selectTurn : rev[idx]);
      if (expect == null) throw new InvalidMove("selection order error");
      if (Number(expect) !== me) throw new InvalidMove("not your pick");
      var emoji = move.emoji;
      if (this.PIECES.indexOf(emoji) < 0) throw new InvalidMove("bad piece");
      var taken = {};
      Object.keys(state.pieces||{}).forEach(function(key){ taken[state.pieces[key]] = true; });
      if (taken[emoji]) throw new InvalidMove("piece taken");
      var pieces = Object.assign({}, state.pieces || {});
      pieces[me] = emoji;
      var log2 = (state.log || []).slice(-20);
      log2.push(this.nameOf(ctx, me) + " chose " + emoji);
      var nextIdx = idx + 1;
      if (nextIdx >= rev.length) {
        var used = {};
        Object.keys(pieces).forEach(function(key){ used[pieces[key]] = true; });
        for (i=0;i<n;i++) if (pieces[i]==null && pieces[String(i)]==null) { for (k=0;k<this.PIECES.length;k++) if (!used[this.PIECES[k]]) { pieces[i]=this.PIECES[k]; used[this.PIECES[k]]=true; break; } }
        var ord = state.turnOrder || rev.slice().reverse();
        var first = ord[0];
        var ns3 = { positions: state.positions.slice(), phase: "play", pieces: pieces, selectTurn: null, selectOrder: rev, selectIdx: nextIdx, rolloffSpins: state.rolloffSpins, rolloffTurn: null, turnOrder: ord, turnPos: 0, lastSpin: state.lastSpin, lastAngle: state.lastAngle, lastEvent: "select-done", lastFrom: null, lastTo: null, winner: null, log: log2.concat(["All pieces picked! " + this.nameOf(ctx, first) + " spins first!"]) };
        return { state: ns3, turn: [ctx.players[first].id] };
      }
      var nxt = rev[nextIdx];
      var ns4 = { positions: state.positions.slice(), phase: "select", pieces: pieces, selectTurn: nxt, selectOrder: rev, selectIdx: nextIdx, rolloffSpins: state.rolloffSpins, rolloffTurn: null, turnOrder: state.turnOrder, turnPos: 0, lastSpin: state.lastSpin, lastAngle: state.lastAngle, lastEvent: null, lastFrom: null, lastTo: null, winner: null, log: log2 };
      return { state: ns4, turn: [ctx.players[nxt].id] };
    }
    if (state.phase === "play") {
      if (move.kind !== "spin") throw new InvalidMove("spin on your turn");
      var full = this.fullOrder(state, n);
      var tp = state.turnPos || 0;
      var curSeat = full[tp % full.length];
      if (curSeat !== me) throw new InvalidMove("not your turn");
      var sp = 1 + Math.floor(ctx.random() * 6);
      var jt = ctx.random() * 44 - 22;
      var an = ((sp - 1) * 60 + jt + 360) % 360;
      var positions = state.positions.slice();
      var pcs = Object.assign({}, state.pieces || {});
      var us = {};
      Object.keys(pcs).forEach(function(key){ us[pcs[key]] = true; });
      for (i=0;i<n;i++) if (pcs[i]==null && pcs[String(i)]==null) { for (k=0;k<this.PIECES.length;k++) if (!us[this.PIECES[k]]) { pcs[i]=this.PIECES[k]; us[this.PIECES[k]]=true; break; } }
      var cur = positions[me] | 0;
      var np = (cur === 0) ? sp : cur + sp;
      var ev = null, msg = "";
      var log3 = (state.log || []).slice(-20);
      var myEmoji = pcs[me] || pcs[String(me)] || "?";
      if (np > 100) { np = cur; ev = "stuck"; msg = this.nameOf(ctx, me) + " " + myEmoji + " spun " + sp + " but needs exact to reach 100 - stays on " + cur; }
      else {
        var from = np;
        if (this.LADDERS[np] != null) { np = this.LADDERS[np]; ev = "ladder"; msg = this.nameOf(ctx, me) + " " + myEmoji + " spun " + sp + ": " + from + " climbs to " + np + " (" + (this.LAD_MSG[from]||"") + ")"; }
        else if (this.CHUTES[np] != null) { np = this.CHUTES[np]; ev = "chute"; msg = this.nameOf(ctx, me) + " " + myEmoji + " spun " + sp + ": " + from + " slides to " + np + " (" + (this.CHU_MSG[from]||"") + ")"; }
        else msg = this.nameOf(ctx, me) + " " + myEmoji + " spun " + sp + ": " + cur + " -> " + np;
      }
      log3.push(msg);
      positions[me] = np;
      if (np === 100) {
        var ns5 = { positions: positions, phase: "play", pieces: pcs, selectTurn: null, selectOrder: state.selectOrder, selectIdx: state.selectIdx, rolloffSpins: state.rolloffSpins, rolloffTurn: null, turnOrder: full, turnPos: tp, lastSpin: sp, lastAngle: an, lastEvent: ev, lastFrom: cur, lastTo: np, winner: me, log: log3.concat([this.nameOf(ctx, me) + " WINS!"]) };
        return { state: ns5, turn: null, payouts: this.payoutsFor(ctx, me) };
      }
      var ntp = (tp + 1) % full.length;
      var nx = full[ntp];
      var ns6 = { positions: positions, phase: "play", pieces: pcs, selectTurn: null, selectOrder: state.selectOrder, selectIdx: state.selectIdx, rolloffSpins: state.rolloffSpins, rolloffTurn: null, turnOrder: full, turnPos: ntp, lastSpin: sp, lastAngle: an, lastEvent: ev, lastFrom: cur, lastTo: np, winner: null, log: log3 };
      return { state: ns6, turn: [ctx.players[nx].id] };
    }
    throw new InvalidMove("unknown phase");
  },
  computerMove: function(state, playerId, ctx) {
    if (state.phase === "select") {
      var taken = {};
      Object.keys(state.pieces||{}).forEach(function(k){ taken[state.pieces[k]] = true; });
      for (var k=0;k<this.PIECES.length;k++) if (!taken[this.PIECES[k]]) return { kind: "select", emoji: this.PIECES[k] };
      return { kind: "select", emoji: this.PIECES[0] };
    }
    return { kind: "spin" };
  },
  randomMove: function(state, playerId, ctx) {
    if (state.phase === "select") {
      var taken = {};
      Object.keys(state.pieces||{}).forEach(function(k){ taken[state.pieces[k]] = true; });
      var free = this.PIECES.filter(function(e){ return !taken[e]; });
      var pick = free.length ? free[Math.floor(ctx.random()*free.length)] : this.PIECES[0];
      return { kind: "select", emoji: pick };
    }
    return { kind: "spin" };
  },
  viewFor: function(state, playerId, ctx) { return JSON.parse(JSON.stringify(state)); }
};