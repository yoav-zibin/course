// Twist Five presentation. Pure JSON in, JSON scene out.
// Step 1: tap an empty hole. Step 2: tap one of the eight turn arrows around
// the board (or select a plate and use the host's rotate tools / R, Shift+R).
// A placement that already makes five in a row ends the turn at once.
//
// Marbles are drawn as transparent plate-sized pictures with the marble at its
// slot, centred on their plate and carrying the plate's angle, so a turn
// animates as one rigid plate with its marbles riding along.
var CELL = 70, PLATE = 210;
var COLUMNS = 'ABCDEF';
var DIRECTIONS = ['clockwise', 'counterclockwise'];
var ARROW_IDS = [0, 1, 2, 3].reduce(function (ids, q) { return ids.concat(DIRECTIONS.map(function (d) { return 'twist-' + q + '-' + d; })); }, []);
function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, function (match, key) { return values[key] === undefined ? match : String(values[key]); });
}
function cellName(cell) { return COLUMNS[cell % 6] + (Math.floor(cell / 6) + 1); }
function plateOf(cell) { return (Math.floor(cell / 6) >= 3 ? 2 : 0) + (cell % 6 >= 3 ? 1 : 0); }
function plateCells(q) {
  var r0 = (q >> 1) * 3, c0 = (q & 1) * 3, out = [];
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) out.push((r0 + r) * 6 + c0 + c);
  return out;
}
// Clockwise sends local (r, c) to (c, 2 - r); counterclockwise is the inverse.
function turnLocal(slot, direction) {
  var r = Math.floor(slot / 3), c = slot % 3;
  return direction === 'clockwise' ? c * 3 + (2 - r) : (2 - c) * 3 + r;
}
function localSlot(cell) { return (Math.floor(cell / 6) % 3) * 3 + (cell % 6) % 3; }
// The slot a marble had when its plate was unturned: undo the plate's turns.
function homeSlot(cell, angle) {
  var turns = ((Math.round(angle / 90) % 4) + 4) % 4, slot = localSlot(cell);
  for (var i = 0; i < turns; i++) slot = turnLocal(slot, 'counterclockwise');
  return slot;
}
function twisted(board, q, direction) {
  var cells = plateCells(q), out = board.slice();
  for (var s = 0; s < 9; s++) out[cells[turnLocal(s, direction)]] = board[cells[s]];
  return out;
}
var LINES = (function () {
  var out = [], dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (var r = 0; r < 6; r++) for (var c = 0; c < 6; c++) for (var k = 0; k < 4; k++) {
    var dr = dirs[k][0], dc = dirs[k][1];
    if (r + 4 * dr < 0 || r + 4 * dr > 5 || c + 4 * dc < 0 || c + 4 * dc > 5) continue;
    var line = [];
    for (var i = 0; i < 5; i++) line.push((r + i * dr) * 6 + c + i * dc);
    out.push(line);
  }
  return out;
})();
function placementWins(board, seat, cell) {
  var b = board.slice(); b[cell] = seat;
  return LINES.some(function (line) { return line.every(function (x) { return b[x] === seat; }); });
}
function plateCenter(q) { return {x: 105 + PLATE * (q & 1), y: 105 + PLATE * (q >> 1)}; }
function cellCenter(cell) { return {x: (cell % 6) * CELL + CELL / 2, y: Math.floor(cell / 6) * CELL + CELL / 2}; }
// Turn arrows sit outside each plate's outer corner, in the frame around the
// board: the clockwise one beyond the top/bottom edge, the other beside it.
function arrowAt(q, direction) {
  var sx = (q & 1) ? 1 : -1, sy = (q >> 1) ? 1 : -1;
  return direction === 'clockwise' ? {x: 285 + sx * 140, y: 285 + sy * 247} : {x: 285 + sx * 247, y: 285 + sy * 140};
}

var gameUI = {
  reduce: function (message, local) {
    var m = message.type === 'ui_event' ? message.state_changed : message;
    var S = Object.assign({}, SOURCE_STRINGS, m.strings || {});
    var view = m.view, event = message.type === 'ui_event' ? message.event : null;
    var players = m.players || [];
    var color = function (seat) { return seat === 0 ? S.gold : S.black; };
    var name = function (seat) {
      var p = players[seat];
      return fill(S.seat_name, {color: color(seat), name: p && p.name ? p.name : fill(S.player, {n: seat + 1})});
    };
    var acting = m.status === 'ongoing' && view.winner === null && m.acting_for_player_index === view.cur && !m.replay;
    // Local state is only the pending hole for this exact position.
    var key = view.ids.join(',');
    local = local && local.key === key && acting ? local : {key: key, pending: null};
    var result = {};
    var twist = function (q, direction) { result.make_move = {cell: local.pending, quadrant: q, direction: direction}; };
    if (event && acting) {
      var match;
      if (event.type === 'tap' && (match = /^hole-(\d+)$/.exec(event.id)) && local.pending === null) {
        var cell = Number(match[1]);
        if (view.board[cell] < 0) {
          if (placementWins(view.board, view.cur, cell)) result.make_move = {cell: cell};
          else local = {key: key, pending: cell};
        }
      } else if (event.type === 'tap' && event.id === 'change' && local.pending !== null) {
        local = {key: key, pending: null};
      } else if ((event.type === 'tap' || event.type === 'drop') && local.pending !== null &&
                 (match = /^twist-([0-3])-(clockwise|counterclockwise)$/.exec(event.type === 'drop' ? event.target_id : event.id))) {
        // The arrow alone decides the plate and direction, even if another
        // plate is selected or was dragged onto it.
        twist(Number(match[1]), match[2]);
      } else if (event.type === 'rotate' && (match = /^plate-([0-3])$/.exec(event.id)) && local.pending !== null) {
        twist(Number(match[1]), event.delta > 0 ? 'clockwise' : 'counterclockwise');
      }
    }
    var twisting = acting && local.pending !== null && !result.make_move;
    var pieces = [], targets = [], labels = [], controls = [], paths = [];
    var plateNames = [S.plate_top_left, S.plate_top_right, S.plate_bottom_left, S.plate_bottom_right];
    for (var q = 0; q < 4; q++) {
      pieces.push({id: 'plate-art-' + q, type: 'plate', board: 'board', position: plateCenter(q),
                   rotation: view.plates[q], z: 0, aria_label: plateNames[q], actions: []});
      // Marbles are drawn above their plate, so a tap on one would miss the
      // plate. While turning, a clear handle above everything selects it.
      // Every arrow stays a legal destination while a plate is selected.
      if (twisting) pieces.push({id: 'plate-' + q, type: 'handle', board: 'board', position: plateCenter(q),
                                 z: 5, aria_label: plateNames[q], actions: ['rotate'], move_targets: ARROW_IDS});
    }
    var marble = function (id, seat, cell, extra) {
      var q = plateOf(cell);
      return Object.assign({id: id, type: 'marble', board: 'board', position: plateCenter(q),
                            asset: (seat === 0 ? 'gold_' : 'black_') + homeSlot(cell, view.plates[q]),
                            rotation: view.plates[q], z: 2, actions: [],
                            aria_label: fill(S.marble_at, {color: color(seat), cell: cellName(cell)})}, extra || {});
    };
    var newest = -1, newestCell = -1;
    for (var c = 0; c < 36; c++) {
      if (view.board[c] < 0) continue;
      pieces.push(marble('marble-' + view.ids[c], view.board[c], c));
      if (view.ids[c] > newest) { newest = view.ids[c]; newestCell = c; }
    }
    if (newestCell >= 0 && view.last) {
      pieces.push({id: 'last-ring', type: 'ring', board: 'board', position: {cell: String(newestCell)}, z: 3, actions: [],
                   aria_label: fill(S.last_marble, {cell: cellName(newestCell)})});
    }
    if (twisting) {
      pieces.push(marble('pending', view.cur, local.pending, {z: 3, opacity: 0.7, aria_label: fill(S.pending_at, {cell: cellName(local.pending)})}));
      controls.push({id: 'change', kind: 'button', label: S.change});
      var placed = view.board.slice(); placed[local.pending] = view.cur;
      for (var p = 0; p < 4; p++) for (var d = 0; d < 2; d++) {
        var direction = DIRECTIONS[d], after = twisted(placed, p, direction), preview = [];
        plateCells(p).forEach(function (cellAfter) {
          if (after[cellAfter] < 0) return;
          var at = cellCenter(cellAfter);
          preview.push({position: {x: at.x + 75, y: at.y + 75}, color: after[cellAfter] === 0 ? '#ffc93c' : '#2a2a3a'});
        });
        var target = {id: 'twist-' + p + '-' + direction, board: 'frame', position: arrowAt(p, direction),
                      asset: direction === 'clockwise' ? 'arrow_cw' : 'arrow_ccw',
                      hit_area: {x: -38, y: -38, width: 76, height: 76}, color: '#ffd76a',
                      aria_label: fill(direction === 'clockwise' ? S.turn_cw : S.turn_ccw, {plate: plateNames[p]})};
        if (preview.length) target.preview = preview;
        targets.push(target);
      }
    } else if (acting && !result.make_move) {
      for (var h = 0; h < 36; h++) {
        if (view.board[h] >= 0) continue;
        targets.push({id: 'hole-' + h, board: 'board', position: {cell: String(h)},
                      aria_label: fill(S.hole, {cell: cellName(h)}), color: view.cur === 0 ? '#ffcc4d' : '#c9d6ea'});
      }
    }
    var status;
    if (m.status === 'over' || view.winner !== null) status = view.winner === -1 ? S.draw : fill(S.wins, {name: name(view.winner)});
    else if (twisting) status = fill(S.twist_turn, {name: name(view.cur)});
    else if (acting) status = fill(S.place_turn, {name: name(view.cur)});
    else status = fill(S.waiting, {name: name(view.cur)});
    var hint = twisting ? S.hint_twist : acting ? S.hint_place : view.winner !== null || m.status === 'over' ? S.hint_over : '';
    labels.push({id: 'status', text: status, x: 16, y: 6, font_size: 20, color: view.winner !== null && view.winner >= 0 ? '#ffd76a' : '#f4f1e8'});
    if (hint) labels.push({id: 'hint', text: hint, x: 16, y: 33, font_size: 15, color: '#ffd76a'});
    // No small decorations: the host sizes the canvas so its smallest object
    // stays at least 32px, so a tiny icon would force scrolling.
    if (view.line) {
      // Paths draw below pieces, so the five winning marbles also get rings
      // drawn above everything.
      view.line.forEach(function (cell, k) {
        pieces.push({id: 'win-' + k, type: 'win_ring', board: 'board', position: {cell: String(cell)}, z: 6, actions: [],
                     aria_label: fill(S.winning_marble, {cell: cellName(cell)})});
      });
      var a = cellCenter(view.line[0]), b = cellCenter(view.line[4]);
      paths.push({id: 'win-line', points: [{x: a.x + 75, y: a.y + 135}, {x: b.x + 75, y: b.y + 135}], color: '#ff5d8f', width: 10});
    }
    result.scene = {pieces: pieces, targets: targets, labels: labels, controls: controls, paths: paths};
    if (!event) {
      // The final scene contains the accepted position. Explicit, parallel
      // transforms let this plate and its marbles turn together even when the
      // viewer made the move. The public last move supplies the starting angle
      // without borrowing earlier local state or changing authoritative rules.
      result.animations = [];
      var last = view.last;
      if (last && Number.isInteger(last.quadrant) && last.quadrant >= 0 && last.quadrant < 4 &&
          DIRECTIONS.indexOf(last.direction) >= 0) {
        var turned = last.quadrant, center = plateCenter(turned);
        var before = view.plates[turned] - (last.direction === 'clockwise' ? 90 : -90);
        var animationKey = 'twist:' + newest + ':' + turned + ':' + view.plates[turned];
        pieces.forEach(function (piece) {
          if (piece.id === 'plate-art-' + turned || piece.id.indexOf('marble-') === 0 &&
              piece.position.x === center.x && piece.position.y === center.y) {
            result.animations.push({piece_id: piece.id, key: animationKey,
              from: {rotation: before}, duration_ms: 600});
          } else if (piece.id === 'last-ring' && plateOf(newestCell) === turned || piece.type === 'win_ring') {
            // A final-hole highlight appears once its marble reaches that hole.
            result.animations.push({piece_id: piece.id, key: animationKey,
              from: {opacity: 0}, duration_ms: 0, delay_ms: 600});
          }
        });
      }
    }
    result.local_state = result.make_move ? {key: key, pending: null} : local;
    return result;
  }
};
