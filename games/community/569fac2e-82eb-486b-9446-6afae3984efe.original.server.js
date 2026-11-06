const game = {
  newMatch(ctx) {
    return { state: { stars: 3, winner: null }, turn: [ctx.players[0].id] };
  },
  applyMove(state, playerId, move, ctx) {
    if (state.winner !== null) throw new InvalidMove("match over");
    if (state.stars <= 0) throw new InvalidMove("no stars left");
    if (!move || move.take !== 1) throw new InvalidMove("move must be {take:1}");
    const stars = state.stars - 1;
    if (stars <= 0) {
      const s = { stars: 0, winner: playerId };
      const payouts = {};
      if (ctx.pot > 0) {
        const humans = ctx.players.filter(function(p){ return p.kind === "human"; });
        if (humans.length > 0) {
          let w = null;
          for (let i = 0; i < humans.length; i++) { if (humans[i].id === playerId) w = playerId; }
          payouts[w !== null ? w : humans[0].id] = ctx.pot;
        }
      }
      return { state: s, turn: null, payouts };
    }
    return { state: { stars, winner: null }, turn: [playerId] };
  },
  computerMove(state, playerId, ctx) {
    return { take: 1 };
  },
  randomMove(state, playerId, ctx) {
    return { take: 1 };
  },
  viewFor(state, playerId, ctx) {
    return { stars: state.stars, winner: state.winner };
  }
};