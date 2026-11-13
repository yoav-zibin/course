const game = {
  newMatch(ctx) {
    const pid = ctx.players[0].id;
    return { state: { count: 0 }, turn: [pid] };
  },
  applyMove(state, playerId, move, ctx) {
    const TARGET = 5;
    const count = state.count || 0;
    if (count >= TARGET) throw new InvalidMove("match already over");
    if (!move || typeof move !== "object" || move.add !== 1) throw new InvalidMove("move must be {add:1}");
    const soleId = ctx.players.length ? ctx.players[0].id : playerId;
    if (playerId !== soleId) throw new InvalidMove("not your turn");
    const nc = count + 1;
    const ns = { count: nc };
    if (nc >= TARGET) {
      const payouts = {};
      const humans = (ctx.players || []).filter(p => p.kind === "human");
      if (humans.length > 0) {
        const winnerIsHuman = humans.some(p => p.id === playerId);
        const winnerId = winnerIsHuman ? playerId : humans[0].id;
        payouts[winnerId] = ctx.pot;
      }
      return { state: ns, turn: null, payouts };
    }
    return { state: ns, turn: [playerId] };
  },
  computerMove(state, playerId, ctx) { return { add: 1 }; },
  randomMove(state, playerId, ctx) { return { add: 1 }; },
  viewFor(state, playerId, ctx) { return { count: state.count || 0 }; }
};