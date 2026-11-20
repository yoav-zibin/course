// Public provenance for the native Connect Four authority. The accepted rules
// still choose the landing cell; presentation can replay gravity from the view.
(() => {
  const newMatch = game.newMatch;
  const applyMove = game.applyMove;
  game.newMatch = function(ctx) {
    const result = newMatch.call(game, ctx);
    result.state.last_move = null;
    return result;
  };
  game.applyMove = function(state, playerId, move, ctx) {
    const result = applyMove.call(game, state, playerId, move, ctx);
    const cell = result.state.disc_ids.indexOf(result.state.turns - 1);
    result.state.last_move = {seat:state.turn,column:move.column,cell};
    return result;
  };
})();
