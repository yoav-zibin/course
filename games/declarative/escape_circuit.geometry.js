// Shared by the rules and the presentation so both use the same collision checks.
const EC_SHAPES = [[2, 2], [2, 1], [2, 1], [1, 2], [1, 2], [1, 2], [1, 1], [1, 1], [1, 1], [1, 1]];
const EC_EXIT = 13;
const EC_LIMIT = 60;
const EC_MASKS = EC_SHAPES.map(([w, h]) => Array.from({length: 20}, (_, at) => {
  if (at % 4 + w > 4 || Math.floor(at / 4) + h > 5) return 0;
  let mask = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) mask |= 1 << (at + y * 4 + x);
  }
  return mask;
}));
const EC_STEPS = Array.from({length: 20}, (_, at) => [
  at - 4, at + 4, at % 4 ? at - 1 : -1, at % 4 < 3 ? at + 1 : -1,
]);
function ecOccupied(board) {
  return board.reduce((mask, at, tile) => mask | EC_MASKS[tile][at], 0);
}
function ecSlides(board) {
  const occupied = ecOccupied(board);
  const moves = [];
  for (let tile = 0; tile < board.length; tile++) {
    const from = board[tile];
    const others = occupied ^ EC_MASKS[tile][from];
    for (const to of EC_STEPS[from]) {
      const destination = EC_MASKS[tile][to];
      if (destination && !(others & destination)) moves.push({tile, to});
    }
  }
  return moves;
}
