const game = {
  newMatch(ctx) {
    return { state: { total: 0, winner: null }, turn: [ctx.players[0].id] };
  },
  applyMove(state, playerId, move, ctx) {
    if (state.winner !== null) throw new InvalidMove("game is over");
    const idx = ctx.players.findIndex(p => p.id === playerId);
    if (idx === -1) throw new InvalidMove("unknown player");
    const add = move && move.add;
    if (add !== 1 && add !== 2) throw new InvalidMove("add 1 or 2");
    const total = state.total + add;
    const n = ctx.players.length;
    if (total >= 10) {
      const newState = { total, winner: idx };
      const humans = ctx.players.filter(p => p.kind === "human");
      const payouts = {};
      for (const h of humans) payouts[h.id] = 0;
      if (humans.length > 0) {
        const winner = ctx.players[idx];
        if (winner.kind === "human") {
          payouts[winner.id] = ctx.pot;
        } else {
          const base = Math.floor(ctx.pot / humans.length);
          let rem = ctx.pot - base * humans.length;
          for (const h of humans) {
            payouts[h.id] = base + (rem > 0 ? 1 : 0);
            if (rem > 0) rem--;
          }
        }
      }
      return { state: newState, turn: null, payouts };
    }
    const newState = { total, winner: null };
    const nextIdx = (idx + 1) % n;
    return { state: newState, turn: [ctx.players[nextIdx].id] };
  },
  computerMove(state, playerId, ctx) {
    return this.smartMove(state, ctx);
  },
  randomMove(state, playerId, ctx) {
    return { add: ctx.random() < 0.5 ? 1 : 2 };
  },
  viewFor(state, playerId, ctx) {
    return { total: state.total, winner: state.winner };
  },
  smartMove(state, ctx) {
    if (state.total + 2 >= 10) return { add: 2 };
    if (state.total + 1 >= 10) return { add: 1 };
    return { add: ctx.random() < 0.5 ? 1 : 2 };
  }
};