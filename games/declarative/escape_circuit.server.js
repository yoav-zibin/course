function ecResult(state, ctx) {
  if (state.winner === null) return {state, turn: [ctx.players[state.turn].id]};
  const humans = ctx.players.filter(player => player.kind === 'human' && player.active !== false);
  const winner = state.winner >= 0 ? ctx.players[state.winner] : null;
  const recipients = humans.includes(winner) ? [winner] : humans;
  const payouts = {};
  recipients.forEach((player, index) => {
    payouts[player.id] = Math.floor(ctx.pot / recipients.length) + Number(index < ctx.pot % recipients.length);
  });
  return {state, turn: null, payouts};
}

const game = {
  newMatch(ctx) {
    const start = EC_STARTS[Math.floor(ctx.random() * EC_STARTS.length)];
    return ecResult({
      boards: [start.slice(), start.slice()], turn: 0, round: 1, winner: null, last: null,
    }, ctx);
  },

  applyMove(state, playerId, move, ctx) {
    const board = state.boards[state.turn];
    if (state.winner !== null || ctx.players[state.turn].id !== playerId ||
        !move || !ecSlides(board).some(({tile, to}) => tile === move.tile && to === move.to)) {
      throw new InvalidMove('Choose a legal slide on your turn.');
    }
    const {tile, to} = move;
    const changed = board.slice();
    changed[tile] = to;
    const boards = state.boards.slice();
    boards[state.turn] = changed;
    const last = {seat: state.turn, tile, from: board[tile], to};
    let {round, winner} = state;
    // Both runners get one slide per round, including the round of an escape.
    if (state.turn === 1) {
      const first = boards[0][0] === EC_EXIT;
      const second = boards[1][0] === EC_EXIT;
      if (first && second) winner = -1;
      else if (first || second) winner = first ? 0 : 1;
      else if (round === EC_LIMIT) winner = -1;
      else round++;
    }
    return ecResult({boards, turn: 1 - state.turn, round, winner, last}, ctx);
  },

  viewFor(state) {
    return state;
  },

  computerMove(state) {
    return ecBestSlide(state.boards[state.turn]);
  },

  randomMove(state, playerId, ctx) {
    const moves = ecSlides(state.boards[state.turn]);
    return moves[Math.floor(ctx.random() * moves.length)];
  },
};

// Only positions of different shapes matter to the solver. Each canonical
// position on either solution path has a known distance to the gate.
function ecKey(board) {
  return [board[0], ...board.slice(1, 3).sort(), ...board.slice(3, 6).sort(),
    ...board.slice(6).sort()].join(',');
}

function ecBestSlide(board) {
  const key = ecKey(board);
  const known = EC_GUIDE[key];
  const moves = ecSlides(board);
  const advance = (position, move) => {
    const next = position.slice();
    next[move.tile] = move.to;
    return next;
  };
  if (known !== undefined) {
    const nextOnPath = moves.find(move => EC_GUIDE[ecKey(advance(board, move))] === known - 1);
    if (nextOnPath) return nextOnPath;
  }

  // A random move in validation can go off the guide. Look for a short
  // reconnection and keep the search bounded for the platform's JS budget.
  const queue = [{position: board, depth: 0, first: null}];
  const visited = new Set([key]);
  let best = moves[0];
  let cost = Infinity;
  for (let i = 0; i < queue.length && i < 128; i++) {
    const {position, depth, first} = queue[i];
    for (const move of (i === 0 ? moves : ecSlides(position))) {
      const next = advance(position, move);
      const nextKey = ecKey(next);
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      const firstMove = first || move;
      if (next[0] === EC_EXIT) return firstMove;
      const estimate = EC_GUIDE[nextKey];
      if (estimate !== undefined) {
        if (depth + 1 + estimate < cost) {
          best = firstMove;
          cost = depth + 1 + estimate;
        }
      } else if (queue.length < 128) {
        queue.push({position: next, depth: depth + 1, first: firstMove});
      }
    }
  }
  return best;
}
