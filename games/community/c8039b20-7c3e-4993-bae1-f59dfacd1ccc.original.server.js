const game = {
  newMatch(ctx) {
    const geese = [];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++)
      if (H.isPoint(r, c) && r <= 2) geese.push([r, c]);
    const state = { fox: [3, 3], geese, captured: 0, last_move: null, jumping: false, quiet_moves: 0, draw: false, winner: null, toMove: 1 };
    return { state, turn: [ctx.players[1].id] };
  },
  applyMove(state, playerId, move, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    if (seat !== 0 && seat !== 1) throw new InvalidMove("unknown player");
    if (state.winner !== null || state.draw) throw new InvalidMove("match over");
    if (seat !== state.toMove) throw new InvalidMove("not your turn");
    if (!move || typeof move !== "object") throw new InvalidMove("illegal move");
    const turnFor = (s) => [ctx.players[s].id];
    const end = (next, winner) => ({ state: { ...next, winner, jumping: false, toMove: winner }, turn: null, payouts: H.payouts({ ...next, winner }, ctx) });
    const toGeese = (next) => {
      if (H.geeseMoves(next).length === 0) return end(next, 0);
      return { state: { ...next, toMove: 1 }, turn: turnFor(1) };
    };
    if (move.stop) {
      if (seat !== 0 || !state.jumping) throw new InvalidMove("nothing to stop");
      return toGeese({ ...state, jumping: false });
    }
    if (!Array.isArray(move.from) || !Array.isArray(move.to)) throw new InvalidMove("illegal move");
    const legal = H.legalMoves(state, seat).find((m) => H.same(m.from, move.from) && H.same(m.to, move.to));
    if (!legal) throw new InvalidMove("illegal move");
    const last_move = { seat, from: legal.from.slice(), to: legal.to.slice(), captured: legal.capture ? legal.capture.slice() : null };
    const quiet_moves = legal.capture ? 0 : (state.quiet_moves || 0) + 1;
    if (seat === 1) {
      const geese = state.geese.map((g) => (H.same(g, legal.from) ? legal.to.slice() : g.slice()));
      const next = { ...state, geese, last_move, quiet_moves, jumping: false, fox: state.fox.slice() };
      if (H.foxMoves(next, false).length === 0) return end(next, 1);
      const st = { ...next, toMove: 0 };
      if (st.quiet_moves >= 60) return end({ ...st, draw: true, winner: null }, null);
      return { state: st, turn: turnFor(0) };
    }
    if (!legal.capture) {
      const next = { ...state, fox: legal.to.slice(), geese: state.geese.map((g) => g.slice()), last_move, quiet_moves, jumping: false };
      if (quiet_moves >= 60) return end({ ...next, draw: true, winner: null }, null);
      return toGeese(next);
    }
    const geese = state.geese.filter((g) => !H.same(g, legal.capture)).map((g) => g.slice());
    const next = { ...state, fox: legal.to.slice(), geese, captured: state.captured + 1, last_move, quiet_moves, jumping: false };
    if (geese.length <= 4) return end(next, 0);
    if (H.foxMoves(next, true).length > 0) {
      return { state: { ...next, jumping: true, toMove: 0 }, turn: turnFor(0) };
    }
    if (quiet_moves >= 60) return end({ ...next, draw: true, winner: null }, null);
    return toGeese(next);
  },
  computerMove(state, playerId, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    const s = seat === 0 || seat === 1 ? seat : state.toMove;
    const rnd = () => ctx.random();
    if (s === 0) {
      const jumps = H.foxMoves(state, true);
      if (jumps.length) return H.pickBest(jumps, (m) => {
        const next = { ...state, fox: m.to.slice(), geese: state.geese.filter((g) => !H.same(g, m.capture)) };
        return [-(1 + H.longestChain(next))];
      }, rnd);
      if (state.jumping) return { stop: true };
      return H.pickBest(H.foxMoves(state, false), (m) => [-H.foxMoves({ ...state, fox: m.to.slice(), geese: state.geese }, false).length], rnd);
    }
    return H.pickBest(H.geeseMoves(state), (m) => {
      const geese = state.geese.map((g) => (H.same(g, m.from) ? m.to.slice() : g.slice()));
      const next = { fox: state.fox.slice(), geese };
      const fm = H.foxMoves(next, false);
      const threats = fm.filter((f) => f.capture).length;
      let together = 0;
      for (const [r, c] of geese) for (const [dr, dc] of H.DIRS) {
        if (geese.some((g) => g[0] === r + dr && g[1] === c + dc)) together++;
      }
      const sideways = m.to[0] === m.from[0] ? 1 : 0;
      return [threats, H.foxArea(next), fm.length, sideways, -together];
    }, rnd);
  },
  randomMove(state, playerId, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    const s = seat === 0 || seat === 1 ? seat : state.toMove;
    const opts = s === 0
      ? [...H.foxMoves(state, state.jumping), ...(state.jumping ? [{ stop: true }] : [])]
      : H.geeseMoves(state);
    if (!opts.length) throw new InvalidMove("no moves");
    return opts[Math.floor(ctx.random() * opts.length)];
  },
  viewFor(state, playerId, ctx) {
    const seat = playerId === null ? -1 : ctx.players.findIndex((p) => p.id === playerId);
    const forSeat = seat === 0 || seat === 1 ? seat : state.toMove;
    let moves = [];
    if (state.winner === null && !state.draw) {
      moves = H.legalMoves(state, state.toMove);
      if (state.toMove === 0 && state.jumping) moves = [...moves, { stop: true }];
    }
    return {
      fox: state.fox.slice(), geese: state.geese.map((g) => g.slice()),
      captured: state.captured, last_move: state.last_move ? { ...state.last_move } : null,
      jumping: !!state.jumping, quiet_moves: state.quiet_moves || 0,
      draw: !!state.draw, winner: state.winner, toMove: state.toMove, moves,
      youAre: forSeat
    };
  },
  playerJoined(state, playerId, ctx) {
    if (state.winner !== null || state.draw) return { state, turn: null };
    const p = ctx.players[state.toMove];
    return { state, turn: p ? [p.id] : null };
  },
  playerLeft(state, playerId, ctx) {
    const payout = Math.floor(ctx.pot * ctx.estimateWinChance(state, playerId));
    if (state.winner !== null || state.draw) return { state, turn: null, payout };
    const p = ctx.players[state.toMove];
    return { state, turn: p ? [p.id] : null, payout };
  }
};
const H = {
  DIRS: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  GOOSE_DIRS: [[1, 0], [0, -1], [0, 1]],
  isPoint: (r, c) => r >= 0 && r < 7 && c >= 0 && c < 7 && (r >= 2 && r <= 4 || c >= 2 && c <= 4),
  same: (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1],
  hasGoose: (st, r, c) => st.geese.some((g) => g[0] === r && g[1] === c),
  isEmpty: (st, r, c) => H.isPoint(r, c) && !H.hasGoose(st, r, c) && !(st.fox[0] === r && st.fox[1] === c),
  foxMoves(st, jumpsOnly) {
    const [r, c] = st.fox, out = [];
    for (const [dr, dc] of H.DIRS) {
      if (!jumpsOnly && H.isEmpty(st, r + dr, c + dc)) out.push({ from: [r, c], to: [r + dr, c + dc], capture: null });
      if (H.hasGoose(st, r + dr, c + dc) && H.isEmpty(st, r + 2 * dr, c + 2 * dc))
        out.push({ from: [r, c], to: [r + 2 * dr, c + 2 * dc], capture: [r + dr, c + dc] });
    }
    return out;
  },
  geeseMoves(st) {
    const out = [];
    for (const [r, c] of st.geese)
      for (const [dr, dc] of H.GOOSE_DIRS)
        if (H.isEmpty(st, r + dr, c + dc)) out.push({ from: [r, c], to: [r + dr, c + dc], capture: null });
    return out;
  },
  legalMoves(st, seat) { return seat === 0 ? H.foxMoves(st, !!st.jumping) : H.geeseMoves(st); },
  foxArea(st) {
    const seen = new Set([st.fox.join(",")]), todo = [st.fox];
    while (todo.length) {
      const [r, c] = todo.pop();
      for (const [dr, dc] of H.DIRS) {
        const k = (r + dr) + "," + (c + dc);
        if (!seen.has(k) && H.isEmpty(st, r + dr, c + dc)) { seen.add(k); todo.push([r + dr, c + dc]); }
      }
    }
    return seen.size;
  },
  longestChain(st) {
    let best = 0;
    for (const m of H.foxMoves(st, true)) {
      const next = { fox: m.to.slice(), geese: st.geese.filter((g) => !H.same(g, m.capture)) };
      best = Math.max(best, 1 + H.longestChain(next));
    }
    return best;
  },
  pickBest(moves, score, rnd) {
    const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
    let best = [], bestScore = null;
    for (const m of moves) {
      const s = score(m);
      const c = bestScore === null ? -1 : cmp(s, bestScore);
      if (c < 0) { best = [m]; bestScore = s; } else if (c === 0) best.push(m);
    }
    const c = best[Math.floor(rnd() * best.length)];
    if (c.stop) return { stop: true };
    return { from: c.from.slice(), to: c.to.slice() };
  },
  payouts(st, ctx) {
    const humans = ctx.players.filter((p) => p.kind === "human");
    const out = {};
    if (!humans.length) return out;
    if (ctx.pot <= 0) { for (const h of humans) out[h.id] = 0; return out; }
    if (st.draw || st.winner === null || st.winner === undefined) {
      const base = Math.floor(ctx.pot / humans.length);
      let rem = ctx.pot - base * humans.length;
      for (const h of humans) out[h.id] = base + (rem-- > 0 ? 1 : 0);
      return out;
    }
    const w = ctx.players[st.winner];
    if (w && w.kind === "human") { for (const h of humans) out[h.id] = h.id === w.id ? ctx.pot : 0; return out; }
    const base = Math.floor(ctx.pot / humans.length);
    let rem = ctx.pot - base * humans.length;
    for (const h of humans) out[h.id] = base + (rem-- > 0 ? 1 : 0);
    return out;
  }
};