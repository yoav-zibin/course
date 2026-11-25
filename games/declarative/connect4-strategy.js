// The strategy only reads authoritative state. Search uses a private board copy.
(() => {
  const columns = [3, 2, 4, 1, 5, 0, 6];
  const lines = [];
  for (let row = 0; row < 6; row++) for (let col = 0; col < 7; col++) {
    for (const [dy, dx] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const endRow = row + dy * 3, endCol = col + dx * 3;
      if (endRow < 6 && endCol >= 0 && endCol < 7) {
        lines.push(Array.from({length: 4}, (_, i) => (row + dy * i) * 7 + col + dx * i));
      }
    }
  }
  const weights = [0, 1, 6, 22];
  function evaluate(board, turn) {
    let score = 0;
    for (const line of lines) {
      let own = 0, other = 0;
      for (const cell of line) {
        if (board[cell] === turn) own++;
        else if (board[cell] === 1 - turn) other++;
      }
      if (!other) score += weights[own];
      if (!own) score -= weights[other];
    }
    return score;
  }
  function landing(board, column) {
    if (board[column] !== -1) return -1;
    let cell = column;
    while (cell + 7 < board.length && board[cell + 7] === -1) cell += 7;
    return cell;
  }
  function playScore(board, cell, turn, depth, alpha, beta) {
    board[cell] = turn;
    const score = lineWon({board, turn}, cell, 7, 4)
      ? 10000 + depth
      : -search(board, 1 - turn, depth - 1, -beta, -alpha);
    board[cell] = -1;
    return score;
  }
  function search(board, turn, depth, alpha, beta) {
    if (columns.every(column => board[column] !== -1)) return 0;
    if (!depth) return evaluate(board, turn);
    let best = -Infinity;
    for (const column of columns) {
      const cell = landing(board, column);
      if (cell < 0) continue;
      best = Math.max(best, playScore(board, cell, turn, depth, alpha, beta));
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }
  game.computerMove = function(state) {
    if (state.over) return undefined;
    const board = state.board.slice();
    let best = -Infinity, choice;
    for (const column of columns) {
      const cell = landing(board, column);
      if (cell < 0) continue;
      const score = playScore(board, cell, state.turn, 4, best, Infinity);
      if (score > best) { best = score; choice = {column}; }
    }
    return choice;
  };
})();
