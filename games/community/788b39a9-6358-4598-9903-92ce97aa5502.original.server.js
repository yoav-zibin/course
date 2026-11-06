const game = {
  newMatch(ctx) {
    return { state: { stars: 9, winnerId: null }, turn: [ctx.players[0].id] };
  },
  applyMove(state, playerId, move, ctx) {
    if (state.winnerId != null) throw new InvalidMove("game is over");
    const take = move && move.take;
    if (take !== 1 && take !== 2) throw new InvalidMove("take 1 or 2 stars");
    if (take > state.stars) throw new InvalidMove("not enough stars");
    const stars = state.stars - take;
    if (stars === 0) {
      const newState = { stars: 0, winnerId: playerId };
      return { state: newState, turn: null, payouts: payoutsFor(playerId, ctx) };
    }
    const ids = ctx.players.map(p => p.id);
    const i = ids.indexOf(playerId);
    const next = ids[(i + 1 + ids.length) % ids.length];
    return { state: { stars, winnerId: null }, turn: [next] };
  },
  computerMove(state, playerId, ctx) {
    if (state.stars <= 0) return { take: 1 };
    if (state.stars <= 2) return { take: state.stars };
    const r = state.stars % 3;
    if (r === 0) return { take: ctx.random() < 0.5 ? 1 : 2 };
    return { take: r };
  },
  randomMove(state, playerId, ctx) {
    const legal = [1, 2].filter(n => n <= state.stars);
    return { take: legal[Math.floor(ctx.random() * legal.length)] };
  },
  viewFor(state, playerId, ctx) {
    return { stars: state.stars, winnerId: state.winnerId };
  }
};
function payoutsFor(winnerId, ctx) {
  const humans = ctx.players.filter(p => p.kind === "human");
  const pot = ctx.pot;
  const p = {};
  if (pot === 0) return p;
  if (humans.length === 0) return p;
  if (humans.some(h => h.id === winnerId)) {
    humans.forEach(h => { p[h.id] = 0; });
    p[winnerId] = pot;
    return p;
  }
  const share = Math.floor(pot / humans.length);
  let rem = pot - share * humans.length;
  humans.forEach(h => {
    p[h.id] = share + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  });
  return p;
}