// Reviewed modern match flow layered over the unchanged checker authority.
// Pinned states without `opening` retain the original rules and serialized shape.
(() => {
  const ordinaryNewMatch = game.newMatch;
  const ordinaryApplyMove = game.applyMove;
  const ordinaryViewFor = game.viewFor;
  const ordinaryComputerMove = game.computerMove;
  const ordinaryRandomMove = game.randomMove;
  const clone = value => JSON.parse(JSON.stringify(value));
  const modern = state => typeof state.opening === 'boolean';
  const history = state => Array.isArray(state.undo_stack) ? state.undo_stack.slice(-4) : [];
  const metadata = state => ({
    opening: state.opening,
    opening_roll: state.opening_roll ? state.opening_roll.slice() : null,
    cube: clone(state.cube), configured: state.configured,
    difficulty: state.difficulty, cube_enabled: state.cube_enabled, goal: state.goal,
    scores: state.scores.slice(), round_winner: state.round_winner,
  });
  const snapshot = state => Object.assign(bgCopy(state), metadata(state), {
    last_roll: state.last_roll ? clone(state.last_roll) : null,
  });
  // Storage may reorder object keys. Undo snapshots are opaque strings, so
  // order every nested object before encoding while preserving array order.
  const snapshotValue = value => Array.isArray(value) ? value.map(snapshotValue) :
    value !== null && typeof value === 'object' ? Object.fromEntries(
      Object.keys(value).sort().map(key => [key, snapshotValue(value[key])])) : value;
  const encodeSnapshot = state => JSON.stringify(snapshotValue(snapshot(state)));
  const canUndo = state => modern(state) && state.configured && !state.opening && !state.needRoll &&
    state.winner === null && state.round_winner === null && history(state).length > 0;
  const canDouble = state => modern(state) && state.configured && state.cube_enabled &&
    !state.opening && state.needRoll && state.winner === null && state.round_winner === null &&
    state.cube.offer === null && state.cube.value < 64 &&
    (state.cube.owner === null || state.cube.owner === state.cur);
  const defaults = () => ({action: 'configure', difficulty: 1, goal: 1, cube_enabled: true});
  function standardApply(state, playerId, move, ctx) {
    // The original casual game has arbitrary action/turn winners. Modern match
    // play finishes by bearing off or dropping a cube. Reset only its internal
    // cap counters during this call, restoring real public history afterwards.
    const result = ordinaryApplyMove.call(game, Object.assign({}, state, {n: 0}),
      playerId, move, Object.assign({}, ctx, {move_count: 0}));
    result.state.n += state.n || 0;
    if (move && move.action === 'roll' && result.state.last_roll) {
      result.state.last_roll.turn = state.n || 0;
      result.state.last_roll.move_count = (ctx.move_count || 0) + 1;
    } else result.state.last_roll = state.last_roll ? clone(state.last_roll) : null;
    return result;
  }

  game.newMatch = function (ctx) {
    const result = ordinaryNewMatch.call(game, ctx);
    Object.assign(result.state, {
      cur: 0, opening: true, opening_roll: [null, null], undo_stack: [],
      cube: {value: 1, owner: null, offer: null}, configured: false,
      difficulty: 1, cube_enabled: true, goal: 5, scores: [0, 0], round_winner: null,
      last_move: null,
    });
    result.turn = bgTurnFor(ctx, 0);
    return result;
  };

  function finishRound(result, previous, ctx, dropped = false) {
    if (result.turn !== null) return result;
    const state = result.state, winner = state.winner, loser = 1 - winner;
    let multiplier = 1;
    if (!dropped && state.off[loser] === 0) {
      const inWinnerHome = state.owner.some((owner, point) => owner === loser &&
        state.cnt[point] > 0 && (winner === 0 ? point <= 5 : point >= 18));
      multiplier = state.bar[loser] > 0 || inWinnerHome ? 3 : 2;
    }
    state.scores[winner] += previous.cube.value * multiplier;
    state.undo_stack = [];
    if (state.scores[winner] >= state.goal) return result;
    state.round_winner = winner;
    state.winner = null;
    state.cur = winner;
    state.needRoll = true;
    state.dice = []; state.moves = [];
    result.turn = bgTurnFor(ctx, winner);
    delete result.payouts;
    return result;
  }

  game.applyMove = function (state, playerId, move, ctx) {
    if (!modern(state)) return ordinaryApplyMove.call(game, state, playerId, move, ctx);
    const seat = ctx.players.findIndex(player => player.id === playerId);
    if (seat < 0) throw new InvalidMove('unknown player');
    if (state.winner !== null) throw new InvalidMove('game over');
    if (seat !== state.cur) throw new InvalidMove('not your turn');
    if (!state.configured) {
      if (!move || move.action !== 'configure' || !Number.isInteger(move.difficulty) ||
          move.difficulty < 0 || move.difficulty > 3 || ![1, 3, 5, 7, 11, 15].includes(move.goal) ||
          typeof move.cube_enabled !== 'boolean') throw new InvalidMove('unknown move');
      const next = snapshot(state);
      Object.assign(next, {configured: true, difficulty: move.difficulty, goal: move.goal,
        cube_enabled: move.cube_enabled, undo_stack: []});
      return {state: next, turn: bgTurnFor(ctx, seat)};
    }
    if (state.round_winner !== null) {
      if (!move || move.action !== 'next') throw new InvalidMove('unknown move');
      const next = snapshot(state);
      Object.assign(next, {owner: bgOwner(), cnt: bgCnt(), bar: [0, 0], off: [0, 0],
        dice: [], moves: [], needRoll: true, winner: null, n: 0,
        opening: true, opening_roll: [null, null], last_roll: null,
        cube: {value: 1, owner: null, offer: null}, round_winner: null, undo_stack: []});
      return {state: next, turn: bgTurnFor(ctx, seat)};
    }
    if (state.cube.offer !== null) {
      if (!move || !['take', 'drop'].includes(move.action)) throw new InvalidMove('unknown move');
      const next = snapshot(state), proposer = state.cube.offer;
      next.undo_stack = [];
      next.cube.offer = null;
      next.cur = proposer;
      if (move.action === 'drop') {
        next.winner = proposer;
        return finishRound({state: next, turn: null, payouts: bgPayouts(ctx, proposer)}, state, ctx, true);
      }
      next.cube.value *= 2;
      next.cube.owner = seat;
      return {state: next, turn: bgTurnFor(ctx, proposer)};
    }
    if (move && move.action === 'double') {
      if (!canDouble(state)) throw new InvalidMove('unknown move');
      const next = snapshot(state);
      next.cube.offer = seat;
      next.cur = 1 - seat;
      next.undo_stack = [];
      return {state: next, turn: bgTurnFor(ctx, next.cur)};
    }
    if (move && move.action === 'undo') {
      if (!canUndo(state)) throw new InvalidMove('no moves');
      const previous = history(state);
      let restored;
      try { restored = JSON.parse(previous.pop()); } catch (_) { throw new InvalidMove('no moves'); }
      if (restored.cur !== seat || restored.n !== state.n || restored.needRoll ||
          restored.opening || restored.winner !== null || restored.round_winner !== null)
        throw new InvalidMove('no moves');
      restored.undo_stack = previous;
      return {state: restored, turn: bgTurnFor(ctx, seat)};
    }
    if (state.opening && state.needRoll && move && move.action === 'roll') {
      const faces = state.opening_roll && state.opening_roll.some(value => value === null)
        ? state.opening_roll.slice() : [null, null];
      faces[seat] = 1 + Math.floor(ctx.random() * 6);
      const next = snapshot(state);
      next.opening_roll = faces;
      next.undo_stack = [];
      if (faces.some(value => value === null)) {
        // Each player rolls only their own opening die, including the computer.
        next.cur = 1 - seat;
        return {state: next, turn: bgTurnFor(ctx, next.cur)};
      }
      if (faces[0] !== faces[1]) {
        next.opening = false;
        next.cur = faces[0] > faces[1] ? 0 : 1;
        next.dice = faces.slice(); next.moves = faces.slice(); next.needRoll = false;
      } else next.cur = 1 - seat;
      next.last_roll = {seat: next.cur, turn: next.n || 0, values: faces.slice(),
        move_count: (ctx.move_count || 0) + 1};
      return {state: next, turn: bgTurnFor(ctx, next.cur)};
    }
    const result = standardApply(state, playerId, move, ctx);
    Object.assign(result.state, metadata(state));
    // One compound drag is one choice. Snapshots never contain another stack.
    result.state.undo_stack = move && move.action === 'move' &&
      result.state.cur === seat && !result.state.needRoll && result.state.winner === null
      ? history(state).concat([encodeSnapshot(state)]).slice(-4) : [];
    return finishRound(result, state, ctx);
  };

  const acceptedApplyMove = game.applyMove;
  game.applyMove = function (state, playerId, move, ctx) {
    const result = acceptedApplyMove.call(game, state, playerId, move, ctx);
    if (modern(state)) {
      const steps = move && move.action === 'move' && Array.isArray(bgAcceptedMoveSteps)
        ? clone(bgAcceptedMoveSteps) : [];
      // This is public board provenance, not an undo snapshot. Keep exactly the
      // accepted command so reloads never need to guess a multi-die route.
      result.state.last_move = {seat: state.cur, move_count: (ctx.move_count || 0) + 1, steps,
        ...(steps.length ? {before: {owner: state.owner.slice(), cnt: state.cnt.slice(),
          bar: state.bar.slice(), off: state.off.slice()}} : {})};
    }
    return result;
  };

  game.viewFor = function (state, playerId, ctx) {
    if (!modern(state)) return ordinaryViewFor.call(game, state, playerId, ctx);
    const actingPlayer = ctx.players[state.cur] && ctx.players[state.cur].id;
    // The public board is identical for all viewers. Only the player about to
    // move needs the expensive, source-specific compound destination search.
    const passive = playerId !== actingPlayer || !state.configured ||
      state.round_winner !== null || state.cube.offer !== null;
    const view = passive ? Object.assign(bgCopy(state), {
      last_roll: state.last_roll ? clone(state.last_roll) : null,
      legalMoves: [], combinedMoves: [],
    }) : ordinaryViewFor.call(game, Object.assign({}, state, {n: 0}),
      playerId, Object.assign({}, ctx, {move_count: 0}));
    if (modern(state)) {
      view.n = state.n || 0;
      view.last_move = state.last_move ? clone(state.last_move) : null;
      Object.assign(view, metadata(state), {can_undo: canUndo(state), can_double: canDouble(state)});
      if (!state.configured || state.round_winner !== null || state.cube.offer !== null) {
        view.legalMoves = []; view.combinedMoves = [];
      }
    }
    return view;
  };

  // Evaluation sees only the current board and already rolled dice. Hard scores
  // one legal step; Expert also scores one further step, bounded to 40x40 nodes.
  function evaluate(state, seat) {
    let score = state.off[seat] * 1200 - state.bar[seat] * 90 + state.bar[1-seat] * 65;
    for (let point = 0; point < 24; point++) {
      if (state.owner[point] !== seat || !state.cnt[point]) continue;
      const count = state.cnt[point], home = seat === 0 ? point <= 5 : point >= 18;
      const distance = seat === 0 ? point + 1 : 24 - point;
      score -= count * (distance * .6 + distance * distance * .025);
      if (count >= 2) score += home ? 24 : 14;
      if (count === 1) score -= home ? 9 : 16;
      if (count > 5) score -= (count - 5) * 3;
    }
    return score;
  }
  function mediumMove(state, seat, ctx) {
    const moves = bgAllMoves(state, seat);
    if (!moves.length) return {action: 'pass'};
    let best = moves[0], bestScore = -Infinity;
    for (const move of moves) {
      const next = bgCopy(state); bgDoBoard(next, seat, move.from, move.to);
      // Seeded variation makes the middle level less exact than Hard while
      // still bringing back checkers home instead of endlessly chasing blots.
      const score = evaluate(next, seat) + ctx.random() * 14;
      if (score > bestScore) { best = move; bestScore = score; }
    }
    return {action: 'move', from: best.from, to: best.to};
  }
  function plannedMove(state, seat, depth) {
    const moves = bgAllMoves(state, seat).slice(0, 40);
    if (!moves.length) return {action: 'pass'};
    let best = moves[0], bestScore = -Infinity;
    for (const move of moves) {
      const next = bgCopy(state);
      bgDoBoard(next, seat, move.from, move.to); next.moves.splice(move.idx, 1);
      const firstScore = evaluate(next, seat);
      let score = firstScore;
      if (depth === 2 && next.moves.length && next.off[seat] < 15) {
        const replies = bgAllMoves(next, seat).slice(0, 40);
        if (replies.length) {
          score = -Infinity;
          for (const reply of replies) {
            const after = bgCopy(next); bgDoBoard(after, seat, reply.from, reply.to);
            score = Math.max(score, evaluate(after, seat) + firstScore * .001);
          }
        }
      }
      if (score > bestScore) { best = move; bestScore = score; }
    }
    return {action: 'move', from: best.from, to: best.to};
  }
  function phaseMove(state) {
    if (!state.configured) return defaults();
    if (state.round_winner !== null) return {action: 'next'};
    if (state.cube.offer !== null) return {action: 'take'};
    return null;
  }
  game.computerMove = function (state, playerId, ctx) {
    if (!modern(state)) return ordinaryComputerMove.call(game, state, playerId, ctx);
    const phase = phaseMove(state); if (phase) return phase;
    if (state.needRoll) return {action: 'roll'};
    if (state.difficulty === 0) return ordinaryRandomMove.call(game, state, playerId, ctx);
    if (state.difficulty === 1) return mediumMove(state, state.cur, ctx);
    return plannedMove(state, state.cur, state.difficulty === 3 ? 2 : 1);
  };
  game.randomMove = function (state, playerId, ctx) {
    if (!modern(state)) return ordinaryRandomMove.call(game, state, playerId, ctx);
    return phaseMove(state) || (state.needRoll ? {action: 'roll'} : mediumMove(state, state.cur, ctx));
  };
})();
