'use strict';
let current = null;
const boardElement = document.getElementById('board');
const cells = Array.from({ length: 9 }, (_, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.addEventListener('click', () => {
    if (!current || button.disabled) return;
    const player = current.my_user.player_index;
    const board = [...current.state.board];
    board[index] = player === 0 ? 'X' : 'O';
    window.webkit.messageHandlers.portal.postMessage({
      message_kind: 'make_move', turn_of_player_index: player, next_state: { board }
    });
  });
  boardElement.appendChild(button);
  return button;
});
window.receiveState = function (payload) {
  if (payload.message_kind !== 'state_change') return;
  current = payload;
  const canPlay = payload.turn_of_user !== null && payload.my_user.player_index !== null &&
    payload.turn_of_user.player_index === payload.my_user.player_index;
  cells.forEach((button, index) => {
    const mark = payload.state.board[index];
    button.textContent = mark === 'X' ? '×' : mark === 'O' ? '○' : '';
    button.className = mark === 'O' ? 'o' : '';
    button.disabled = !canPlay || mark !== null;
    button.setAttribute('aria-label', `Row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}, ${mark || 'empty'}`);
  });
  document.getElementById('hint').textContent = payload.turn_of_user === null ? 'Match complete' : 'Tap an empty square';
};
