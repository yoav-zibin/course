// Append to Connect Four's native rack presentation. The last move is public
// presentation data; old pinned rules retain equivalent provenance in disc_ids.
gameUI.getLastMoveAnimations = function(view, scene) {
  if (!Array.isArray(view.disc_ids)) return null;
  if (view.last_move === null || view.turns === 0) return [];
  const cell = view.last_move && Number.isInteger(view.last_move.cell)
    ? view.last_move.cell
    : Number.isInteger(view.turns) ? view.disc_ids.indexOf(view.turns - 1) : -1;
  if (cell < 0 || cell >= 42 || !Number.isInteger(view.disc_ids[cell]) || view.disc_ids[cell] < 0) return null;
  const piece = (scene.pieces || []).find(piece => piece.id === 'disc_' + view.disc_ids[cell]);
  if (!piece || !Number.isFinite(piece.position.x) || !Number.isFinite(piece.position.y)) return null;
  return [{piece_id:piece.id,duration_ms:600,path:[
    {board:piece.board,position:{x:piece.position.x,y:-28}},
    {board:piece.board,position:piece.position}
  ]}];
};
