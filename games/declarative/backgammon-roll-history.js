// Version 3 presentation metadata. The canonical authority above stays intact:
// record its two accepted roll draws without consuming any extra randomness.
(() => {
  const newMatch = game.newMatch;
  const applyMove = game.applyMove;
  const viewFor = game.viewFor;
  const copyRoll = roll => roll ? {
    seat: roll.seat, turn: roll.turn, values: roll.values.slice(), move_count: roll.move_count,
  } : null;

  game.newMatch = function (ctx) {
    const result = newMatch.call(game, ctx);
    result.state.last_roll = null;
    return result;
  };

  game.applyMove = function (state, playerId, move, ctx) {
    const draws = [];
    const tracked = move && move.action === 'roll' ? Object.assign({}, ctx, {
      random() {
        const value = ctx.random();
        draws.push(value);
        return value;
      },
    }) : ctx;
    const result = applyMove.call(game, state, playerId, move, tracked);
    result.state.last_roll = draws.length === 2 ? {
      seat: state.cur, turn: state.n || 0,
      values: draws.map(value => 1 + Math.floor(value * 6)),
      move_count: (ctx.move_count || 0) + 1,
    } : copyRoll(state.last_roll);
    return result;
  };

  game.viewFor = function (state, playerId, ctx) {
    const result = viewFor.call(game, state, playerId, ctx);
    result.last_roll = copyRoll(state.last_roll);
    return result;
  };
})();
