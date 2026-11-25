const EC_CELL = 80;

function ecFill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));
}

function ecPosition(tile, at) {
  const [width, height] = EC_SHAPES[tile];
  return {x: (at % 4 + width / 2) * EC_CELL, y: (Math.floor(at / 4) + height / 2) * EC_CELL};
}

function ecSquare(at) {
  return 'ABCD'[at % 4] + (Math.floor(at / 4) + 1);
}

const gameUI = {
  reduce(message) {
    const m = message.type === 'ui_event' ? message.state_changed : message;
    const event = message.type === 'ui_event' ? message.event : null;
    const view = m.view;
    const strings = {...SOURCE_STRINGS, ...m.strings};
    const {turn, winner, boards, last} = view;
    const acting = m.status === 'ongoing' && !m.replay && winner === null &&
      m.acting_for_player_index === turn;
    const legal = acting ? ecSlides(boards[turn]) : [];
    const tileId = (seat, tile) => `block-${seat}-${tile}`;
    const targetId = ({tile, to}) => `slide-${tile}-to-${to}`;
    const tileName = tile => strings[tile === 0 ? 'core' : tile < 6 ? 'bar' : 'chip'];
    const player = seat => {
      const fallback = ecFill(strings.runner, {number: seat + 1});
      return (m.players?.[seat]?.name || fallback).slice(0, 16);
    };
    const make_move = event?.type === 'drop'
      ? legal.find(move => tileId(turn, move.tile) === event.piece_id && targetId(move) === event.target_id)
      : undefined;

    const pieces = [];
    const targets = [];
    const labels = [];
    const status = winner === -1 ? strings.draw : winner !== null ? ecFill(strings.wins, {player: player(winner)}) :
      m.replay ? strings.replay : m.status !== 'ongoing' ? strings.waiting :
      acting ? strings.your_turn : ecFill(strings.turn, {player: player(turn)});
    const instruction = winner === null && boards[0][0] === EC_EXIT
      ? strings.final_slide : acting ? strings.choose : strings.goal;
    labels.push({id: 'status', text: status, x: 20, y: 19, color: '#ffeacd', font_size: 32});
    labels.push({id: 'instruction', text: instruction, x: 20, y: 53, color: '#d9ccd8', font_size: 23});

    for (let seat = 0; seat < boards.length; seat++) {
      const board = `tray-${seat}`;
      const x = seat * 344 + 18;
      const color = seat === 0 ? '#76ead6' : '#e9a7ff';
      const escaped = boards[seat][0] === EC_EXIT;
      const name = m.my_player_index === seat ? ecFill(strings.you, {player: player(seat)}) : player(seat);
      labels.push({id: `runner-${seat}`, text: name, x, y: 83, color, font_size: 25});
      labels.push({id: `exit-${seat}`, text: escaped ? strings.escaped : strings.exit,
        x: x + 120, y: 539, color: escaped ? '#ffca82' : color, font_size: 23});
      pieces.push({id: `gate-${seat}`, board, type: 'gate', position: {x: 160, y: 406},
        asset: escaped ? 'gate_open' : 'gate', z: 0, actions: []});

      boards[seat].forEach((at, tile) => {
        const moves = seat === turn ? legal.filter(move => move.tile === tile) : [];
        const position = ecPosition(tile, at);
        const id = tileId(seat, tile);
        const piece = {id, board, position, type: tile === 0 ? 'core' : tile < 3 ? 'wide' : tile < 6 ? 'tall' : 'chip',
          aria_label: ecFill(strings.tile_at, {tile: tileName(tile), square: ecSquare(at)}),
          z: 1, actions: moves.length ? ['move'] : [],
        };
        if (moves.length) {
          piece.move_targets = moves.map(targetId);
          for (const move of moves) {
            const area = {x: -34, y: -34, width: 68, height: 68};
            targets.push({id: targetId(move), board, position: ecPosition(tile, move.to), hit_area: area,
              asset: 'target', aria_label: ecFill(strings.slide_to, {tile: tileName(tile), square: ecSquare(move.to)})});
          }
        }
        if (last?.seat === seat && last.tile === tile) piece.z = 2;
        pieces.push(piece);
      });
    }
    return {scene: {pieces, targets, labels}, ...(make_move && {make_move})};
  },

  getLastMoveAnimations(view) {
    const last = view.last;
    if (!last) return [];
    return [{piece_id: `block-${last.seat}-${last.tile}`, duration_ms: 1440,
      path: [last.from, last.to].map(at => ({board: `tray-${last.seat}`, position: ecPosition(last.tile, at)}))}];
  },
};
