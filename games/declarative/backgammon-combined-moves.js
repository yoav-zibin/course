// A compound gesture follows one checker through canonical legal single moves.
// Only destinations whose legal orders all produce the same complete outcome
// are offered. Ordinary single moves always retain their original behavior.
(() => {
  const singleApplyMove = game.applyMove;
  const ordinaryViewFor = game.viewFor;
  const endpoint = (from, to) => JSON.stringify([from, to]);
  const signature = result => JSON.stringify({
    state: Object.assign({}, result.state, {
      dice: result.state.dice.slice().sort((a, b) => a - b),
      moves: result.state.moves.slice().sort((a, b) => a - b),
    }),
    turn: result.turn,
    payouts: result.payouts || null,
  });

  function combinations(state, ctx) {
    const remaining = state.moves;
    if (state.needRoll || state.winner !== null || !Array.isArray(remaining) ||
        remaining.length < 2 || remaining.length > 4 || (ctx.move_count || 0) > 300 || (state.n || 0) > 300 ||
        !remaining.every(value => Number.isInteger(value) && value >= 1 && value <= 6) ||
        remaining.length > 2 && !remaining.every(value => value === remaining[0])) return [];
    const seat = state.cur, playerId = ctx.players[seat] && ctx.players[seat].id;
    if (!playerId) return [];
    const legality = new Map();
    const legal = current => {
      const key = JSON.stringify(current);
      if (!legality.has(key)) legality.set(key, bgAllMoves(current, seat));
      return legality.get(key);
    };
    const firstMoves = legal(state);
    const singles = new Set(firstMoves.map(move => endpoint(move.from, move.to)));
    const outcomes = new Map();

    function visit(from, to, result, steps) {
      if (steps.length >= 2 && !singles.has(endpoint(from, to))) {
        const key = endpoint(from, to);
        if (!outcomes.has(key)) outcomes.set(key, new Map());
        const variants = outcomes.get(key), outcome = signature(result);
        if (!variants.has(outcome)) variants.set(outcome, {from, to, steps});
      }
      if (steps.length >= 4 || to === 'off' || result.state.winner !== null || result.state.needRoll ||
          result.state.cur !== seat || result.turn === null || !result.turn.includes(playerId)) return;
      for (const move of legal(result.state)) {
        if (move.from !== to) continue;
        const leg = {action: 'move', from: move.from, to: move.to};
        const next = singleApplyMove.call(game, result.state, playerId, leg, ctx);
        visit(from, move.to, next, steps.concat([leg]));
      }
    }

    for (const move of firstMoves) {
      const leg = {action: 'move', from: move.from, to: move.to};
      const result = singleApplyMove.call(game, state, playerId, leg, ctx);
      visit(move.from, move.to, result, [leg]);
    }
    const safe = [];
    for (const variants of outcomes.values()) if (variants.size === 1) safe.push(variants.values().next().value);
    return safe;
  }

  game.applyMove = function (state, playerId, move, ctx) {
    try {
      return singleApplyMove.call(game, state, playerId, move, ctx);
    } catch (error) {
      // Preserve canonical turn, input and endcap validation. Only an otherwise
      // illegal single destination can be interpreted as a compound gesture.
      if (!(error instanceof InvalidMove) || error.message !== 'illegal move' || !move || move.action !== 'move') throw error;
      const combined = combinations(state, ctx).find(candidate => candidate.from === move.from && candidate.to === move.to);
      if (!combined) throw error;
      let result = {state};
      for (const leg of combined.steps) result = singleApplyMove.call(game, result.state, playerId, leg, ctx);
      return result;
    }
  };

  game.viewFor = function (state, playerId, ctx) {
    const view = ordinaryViewFor.call(game, state, playerId, ctx);
    view.combinedMoves = combinations(state, ctx).map(move => ({from: move.from, to: move.to}));
    return view;
  };
})();
