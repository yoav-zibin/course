// Lantern Trails presentation. Pure JSON in, JSON scene out. The shared
// geometry (tiles, gates, ltPlace) is prepended by the builder from the
// server file, so the preview uses exactly the server's rules.
//
// Start: tap a square on the edge, then pick one of its gates in the tray.
// Play: pick a tile in the tray, turn it (↺ ↻ buttons, host tools, R /
// Shift+R), watch the glowing route preview on the board, then tap the
// glowing square (or drag the tile there, or press "Place tile").
var CELL = 90;
var PLAYER_KEYS = ['amber', 'jade', 'rose', 'sky', 'violet', 'lime', 'coral', 'pearl'];
var PLAYER_HEX = ['#ffb347', '#3fd6a0', '#ff6f91', '#5cc8ff', '#b18cff', '#c6f432', '#ff8a5c', '#efe9dc'];
var COLUMNS = 'ABCDEF';
var POINT_XY = [[30, 0], [60, 0], [90, 30], [90, 60], [60, 90], [30, 90], [0, 60], [0, 30]];
var OUTWARD = [[0, -1], [0, -1], [1, 0], [1, 0], [0, 1], [0, 1], [-1, 0], [-1, 0]];

function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, function (match, key) { return values[key] === undefined ? match : String(values[key]); });
}
function squareName(sq) { return COLUMNS[sq % 6] + (Math.floor(sq / 6) + 1); }
function squareCenter(sq) { return {x: (sq % 6) * CELL + CELL / 2, y: Math.floor(sq / 6) * CELL + CELL / 2}; }
function onPerimeter(sq, point) {
  var r = Math.floor(sq / 6) + LT_STEP[point][0], c = sq % 6 + LT_STEP[point][1];
  return r < 0 || r > 5 || c < 0 || c > 5;
}
// Board coordinates of a lantern standing at position pos; lanterns on the
// outer edge stand a little outside the board, in the frame.
function lanternXY(pos) {
  var sq = Math.floor(pos / 8), p = pos % 8, base = POINT_XY[p];
  var x = (sq % 6) * CELL + base[0], y = Math.floor(sq / 6) * CELL + base[1];
  // Edge lanterns stand just outside the board, but never beyond the game
  // area (that would widen the page on a phone).
  if (onPerimeter(sq, p)) { x += OUTWARD[p][0] * 6; y += OUTWARD[p][1] * 6; }
  return {x: x, y: y};
}
// A channel's picture: one of eight shape classes, turned k quarter turns
// (the builder draws only the classes; pieces rotate them into place).
function pairShape(a, b) {
  var best = null;
  for (var k = 0; k < 4; k++) {
    var x = ((a - 2 * k) % 8 + 8) % 8, y = ((b - 2 * k) % 8 + 8) % 8;
    if (x > y) { var t = x; x = y; y = t; }
    if (best === null || x < best.x || (x === best.x && y < best.y)) best = {x: x, y: y, k: k};
  }
  return {key: '' + best.x + best.y, rotation: best.k * 90};
}
// The segments a lantern's trail covers: from its gate along the tiles to
// where it stands now. Each segment is [square, entry point, exit point].
function trailOf(board, gatePos, at) {
  var sq = Math.floor(gatePos / 8), point = gatePos % 8, out = [];
  for (var guard = 0; guard < 160; guard++) {
    if (sq * 8 + point === at || !board[sq]) break;
    var t = board[sq], exit = LT_TURNED[t[0]][t[1]][point];
    out.push([sq, point, exit]);
    if (sq * 8 + exit === at) break;
    var r = Math.floor(sq / 6) + LT_STEP[exit][0], c = sq % 6 + LT_STEP[exit][1];
    if (r < 0 || r > 5 || c < 0 || c > 5) break;
    sq = r * 6 + c; point = LT_ACROSS[exit];
  }
  return out;
}
// The same rule as the server: walking off the edge is allowed only when
// every tile and turn in the hand does it.
function optionsFor(view, seat) {
  var square = Math.floor(view.markers[seat].at / 8), all = [], safe = 0;
  (view.hand || []).forEach(function (tile) {
    for (var k = 0; k < 4; k++) {
      var r = ltPlace(view.board, view.markers, square, tile, k);
      var ok = r.markers[seat].out !== 'edge';
      if (ok) safe++;
      all.push({tile: tile, rotation: k, result: r, ok: ok});
    }
  });
  all.forEach(function (o) { o.legal = o.ok || safe === 0; });
  return {all: all, forced: safe === 0, square: square};
}
function gatesOfSquare(sq) {
  var out = [];
  for (var g = 0; g < 48; g++) if (Math.floor(ltGatePos(g) / 8) === sq) out.push(g);
  return out;
}

var gameUI = {
  reduce: function (message, local) {
    var m = message.type === 'ui_event' ? message.state_changed : message;
    var S = Object.assign({}, SOURCE_STRINGS, m.strings || {});
    var view = m.view, event = message.type === 'ui_event' ? message.event : null;
    var players = m.players || [], n = view.markers.length;
    var colorName = function (seat) { return S['color_' + PLAYER_KEYS[seat]]; };
    var name = function (seat) {
      var p = players[seat];
      var label = fill(S.seat_name, {color: colorName(seat), name: p && p.name ? p.name : fill(S.player, {n: seat + 1})});
      // Your own seat says so everywhere it is named.
      return seat === m.my_player_index ? fill(S.you, {name: label}) : label;
    };
    var over = m.status === 'over' || view.phase === 'over';
    var acting = !over && m.status === 'ongoing' && view.cur !== null && m.acting_for_player_index === view.cur && !m.replay && view.me === view.cur;
    var key = view.phase + ':' + view.turn_no + ':' + view.cur + ':' + (view.hand || []).join(',');
    // Keep the chosen tile and its turn for this exact position, even across
    // a refresh message where the host briefly reports no acting seat.
    local = local && local.key === key ? local : {key: key, square: null, sel: 0, turns: {}};
    var result = {}, hand = view.hand || [];
    var newLocal = function (patch) { local = Object.assign({}, local, patch); };
    var options = acting && view.phase === 'play' ? optionsFor(view, view.cur) : null;
    var selTile = hand.length ? hand[Math.min(local.sel, hand.length - 1)] : null;
    var turnsOf = function (tile) { return local.turns[tile] || 0; };
    var quarter = function (deg) { return ((Math.round(deg / 90) % 4) + 4) % 4; };
    var chosen = function () {
      if (!options || selTile === null) return null;
      var k = quarter(turnsOf(selTile));
      return options.all.filter(function (o) { return o.tile === selTile && o.rotation === k; })[0];
    };
    var turnTile = function (tile, delta) {
      var turns = Object.assign({}, local.turns); turns[tile] = (turns[tile] || 0) + delta;
      newLocal({turns: turns, sel: hand.indexOf(tile)});
    };
    var place = function () {
      var o = chosen();
      if (o && o.legal) result.make_move = {tile: o.tile, rotation: o.rotation};
    };
    if (event && acting) {
      var match, id = event.type === 'drop' ? event.target_id : event.id;
      if (view.phase === 'start') {
        if (event.type === 'tap' && (match = /^edge-(\d+)$/.exec(event.id))) newLocal({square: Number(match[1])});
        else if (event.type === 'tap' && (match = /^gate-(\d+)$/.exec(event.id))) result.make_move = {gate: Number(match[1])};
      } else if (view.phase === 'play') {
        var heldTile = event.type === 'drop' || event.type === 'rotate' ? /^hand-(\d+)$/.exec(event.id || event.piece_id || '') : null;
        if (heldTile) newLocal({sel: Math.max(0, hand.indexOf(Number(heldTile[1])))});
        selTile = hand.length ? hand[Math.min(local.sel, hand.length - 1)] : null;
        if (event.type === 'tap' && (match = /^hand-(\d+)$/.exec(event.id))) newLocal({sel: Math.max(0, hand.indexOf(Number(match[1])))});
        else if (event.type === 'rotate' && heldTile) turnTile(Number(heldTile[1]), event.delta > 0 ? 90 : -90);
        else if ((event.type === 'tap' || event.type === 'drop') && (id === 'rot-cw' || id === 'rot-ccw') && selTile !== null) turnTile(selTile, id === 'rot-cw' ? 90 : -90);
        else if ((event.type === 'tap' || event.type === 'drop') && (id === 'place' || id === 'place-button')) place();
      }
      selTile = hand.length ? hand[Math.min(local.sel, hand.length - 1)] : null;
    }
    var pieces = [], targets = [], labels = [], controls = [];
    // Frame, river slabs and gate marks are one big picture.
    pieces.push({id: 'river', type: 'river', board: 'frame', position: {x: 300, y: 300}, z: 0, actions: [], aria_label: S.board_name});
    view.board.forEach(function (t, sq) {
      if (!t) return;
      pieces.push({id: 'tile-' + sq, type: 'tile', board: 'board', position: squareCenter(sq), asset: 'tile_' + t[0],
                   rotation: t[1] * 90, z: 1, actions: [], aria_label: fill(S.tile_at, {square: squareName(sq)})});
    });
    if (view.last && view.last.kind === 'tile') {
      pieces.push({id: 'last-glow', type: 'glow', board: 'board', position: squareCenter(view.last.square), z: 1.5,
                   actions: [], aria_label: fill(S.last_tile, {name: name(view.last.seat), square: squareName(view.last.square)})});
    }
    // Trails in each lantern's colour.
    view.markers.forEach(function (mk, seat) {
      if (!mk || view.gates[seat] === null) return;
      trailOf(view.board, ltGatePos(view.gates[seat]), mk.at).forEach(function (seg, i) {
        var shape = pairShape(seg[1], seg[2]);
        pieces.push({id: 'trail-' + seat + '-' + i, type: 'trail', board: 'board', position: squareCenter(seg[0]),
                     asset: 'trail_' + PLAYER_KEYS[seat] + '_' + shape.key, rotation: shape.rotation, z: 2 + seat * 0.01,
                     opacity: mk.out ? 0.45 : 1, actions: []});
      });
    });
    var winners = view.winners || [];
    view.markers.forEach(function (mk, seat) {
      if (!mk) return;
      var steps = 1;
      if (view.last && view.last.kind === 'tile') view.last.moved.forEach(function (mv) { if (mv.seat === seat) steps = mv.steps.length; });
      var piece = {id: 'lantern-' + seat, type: 'lantern', board: 'board', position: lanternXY(mk.at), asset: 'lantern_' + PLAYER_KEYS[seat],
                   z: mk.out ? 3 : 4, actions: [], opacity: mk.out ? 0.5 : 1,
                   aria_label: fill(mk.out ? S.lantern_out : S.lantern_at, {name: name(seat), square: squareName(Math.floor(mk.at / 8))}),
                   animation: {kind: 'move', key: 'mv-' + view.turn_no + '-' + seat, duration_ms: Math.min(2600, 380 + 320 * steps)}};
      if (mk.out) piece.text = '✕';
      pieces.push(piece);
      if (winners.indexOf(seat) >= 0) {
        var ringAt = lanternXY(mk.at);
        ringAt = {x: Math.min(Math.max(ringAt.x, 8), 532), y: ringAt.y};
        pieces.push({id: 'win-' + seat, type: 'ring', board: 'board', position: ringAt, z: 5, actions: [],
                     aria_label: fill(S.winner_lantern, {name: name(seat)})});
      }
    });
    // Roster: one lantern per player with tiles in hand and the Dragon.
    for (var seat = 0; seat < n; seat++) {
      var x = 40 + seat * 70, mk = view.markers[seat], outNow = mk && mk.out;
      pieces.push({id: 'roster-' + seat, type: 'badge', board: 'hud', position: {x: x, y: 92}, asset: 'lantern_' + PLAYER_KEYS[seat],
                   z: 1, actions: [], opacity: outNow ? 0.35 : 1,
                   aria_label: fill(outNow ? S.roster_out : S.roster, {name: name(seat), count: view.hand_counts[seat]}) + (view.dragon === seat ? ' · ' + S.dragon : '')});
      labels.push({id: 'count-' + seat, text: outNow ? '✕' : String(view.hand_counts[seat]) + (view.dragon === seat ? '🐉' : ''),
                   x: x + 38, y: 82, font_size: 17, color: PLAYER_HEX[seat]});
      if (view.cur === seat && !over) pieces.push({id: 'roster-ring', type: 'ring', board: 'hud', position: {x: x, y: 92}, z: 2, actions: [], aria_label: fill(S.turn_of, {name: name(seat)})});
    }
    var hint = '';
    if (acting && view.phase === 'start') {
      for (var sq = 0; sq < 36; sq++) {
        var row = Math.floor(sq / 6), col = sq % 6;
        if (row > 0 && row < 5 && col > 0 && col < 5) continue;
        var free = gatesOfSquare(sq).filter(function (g) { var pos = ltGatePos(g); return !view.markers.some(function (mk2) { return mk2 && mk2.at === pos; }); });
        if (!free.length) continue;
        targets.push({id: 'edge-' + sq, board: 'board', position: {cell: String(sq)}, asset: local.square === sq ? 'pick_on' : 'pick',
                      aria_label: fill(S.start_square, {square: squareName(sq)})});
      }
      if (local.square !== null) {
        var gates = gatesOfSquare(local.square).filter(function (g) { var pos = ltGatePos(g); return !view.markers.some(function (mk3) { return mk3 && mk3.at === pos; }); });
        // Pickers sit on the empty middle of the board (big enough to tap on
        // a phone), each showing which side of the square its gate is on.
        var spacing = 124, x0 = 270 - (gates.length - 1) * spacing / 2;
        gates.forEach(function (g, i) {
          var p = ltGatePos(g) % 8, at = {x: x0 + i * spacing, y: 270};
          pieces.push({id: 'gatepick-' + g, type: 'gatepick', board: 'board', position: at, asset: 'gatepick_' + (p & 1),
                       rotation: (p >> 1) * 90, z: 6, actions: []});
          targets.push({id: 'gate-' + g, board: 'board', position: at, asset: 'frame',
                        hit_area: {x: -56, y: -56, width: 112, height: 112}, aria_label: fill(S.gate_label, {square: squareName(local.square), side: S['side_' + p]})});
          pieces.push({id: 'ghost-gate-' + g, type: 'lantern', board: 'board', position: lanternXY(ltGatePos(g)), asset: 'lantern_' + PLAYER_KEYS[view.cur],
                       opacity: 0.6, z: 4, actions: [], text: String(i + 1), aria_label: fill(S.gate_label, {square: squareName(local.square), side: S['side_' + p]})});
          // Above the picker, not on it (text on top would swallow the tap).
          labels.push({id: 'gate-num-' + i, text: String(i + 1), x: 30 + at.x - 6, y: 150 + at.y - 80, font_size: 18, color: '#fff1c4'});
        });
        hint = S.hint_gate;
      } else hint = S.hint_square;
    }
    // The tray: tiles in hand (only the viewer's own).
    var tileXs = [178, 300, 422];
    {
      hand.forEach(function (tile, i) {
        var mine = acting && view.phase === 'play', selected = mine && tile === selTile;
        var piece = {id: 'hand-' + tile, type: 'hand_tile', board: 'tray', position: {x: tileXs[i], y: 77}, asset: 'tile_' + tile,
                     rotation: turnsOf(tile), z: 2, selected: selected, actions: mine ? ['tap', 'rotate', 'move'] : [],
                     aria_label: fill(S.hand_tile, {n: i + 1})};
        if (mine) piece.move_targets = ['place', 'rot-cw', 'rot-ccw'];
        pieces.push(piece);
      });
    }
    if (options && selTile !== null) {
      var o = chosen(), sqr = options.square, me = view.cur;
      var ghost = {id: 'ghost', type: 'tile', board: 'board', position: squareCenter(sqr), asset: 'tile_' + o.tile,
                   rotation: turnsOf(o.tile), z: 3, opacity: o.ok ? 0.92 : 0.6, actions: [], aria_label: fill(S.ghost, {square: squareName(sqr)})};
      pieces.push(ghost);
      // Route preview: the selected tile's effect on my lantern.
      var mine2 = o.result.markers[me], route = trailOf(o.result.board, view.markers[me].at, mine2.out === 'edge' ? mine2.at : mine2.at);
      route.forEach(function (seg, i) {
        // A fresh id per shape, so a re-turned tile redraws its route instead
        // of spinning the old one.
        var shape2 = pairShape(seg[1], seg[2]);
        pieces.push({id: 'route-' + i + '-' + seg[0] + '-' + seg[1] + seg[2], type: 'trail', board: 'board', position: squareCenter(seg[0]),
                     asset: 'route_ok_' + shape2.key, rotation: shape2.rotation, z: 3.5, opacity: o.ok ? 1 : 0.4, actions: []});
      });
      // A route off the edge: faded route and a red cross on the tile.
      if (!o.ok) pieces.push({id: 'ghost-x', type: 'tile', board: 'board', position: squareCenter(sqr), asset: 'place_frame', text: '✕', z: 3.6, actions: [], aria_label: S.hint_bad});
      var knocked = [];
      o.result.markers.forEach(function (mk4, s4) { if (s4 !== me && mk4 && mk4.out && !view.markers[s4].out) knocked.push(colorName(s4)); });
      if (!o.ok) hint = options.forced ? S.hint_forced : S.hint_bad;
      else if (mine2.out === 'collision') hint = S.hint_collide;
      else if (knocked.length) hint = fill(S.hint_knock, {names: knocked.join(', ')});
      else hint = S.hint_play;
      targets.push({id: 'rot-ccw', board: 'tray', position: {x: 54, y: 77}, asset: 'rot_ccw', hit_area: {x: -46, y: -46, width: 92, height: 92}, aria_label: S.rotate_ccw});
      targets.push({id: 'rot-cw', board: 'tray', position: {x: 546, y: 77}, asset: 'rot_cw', hit_area: {x: -46, y: -46, width: 92, height: 92}, aria_label: S.rotate_cw});
      if (o.legal) targets.push({id: 'place', board: 'board', position: {cell: String(sqr)}, asset: 'place_frame', aria_label: fill(S.place_here, {square: squareName(sqr)})});
      controls.push({id: 'place-button', kind: 'button', label: S.place_button, disabled: !o.legal});
    }
    var status;
    if (over) {
      status = winners.length === 1 ? fill(S.wins, {name: name(winners[0])})
        : fill(S.tie, {names: winners.map(function (w) { return colorName(w); }).join(' & ')});
      hint = S.hint_over;
    } else if (view.phase === 'start') status = acting ? fill(S.start_turn, {name: name(view.cur)}) : fill(S.waiting_gate, {name: name(view.cur)});
    else status = acting ? fill(S.play_turn, {name: name(view.cur)}) : fill(S.waiting, {name: name(view.cur)});
    if (!acting && !over && view.phase === 'play' && hand.length) hint = S.hint_wait;
    labels.push({id: 'status', text: status, x: 16, y: 8, font_size: 21, color: over && winners.length === 1 ? PLAYER_HEX[winners[0]] : '#f6efe0'});
    if (hint) labels.push({id: 'hint', text: hint, x: 16, y: 38, font_size: 15, color: hint === S.hint_bad || hint === S.hint_forced || hint === S.hint_collide ? '#ff8a8a' : '#ffd98a'});
    labels.push({id: 'pile', text: fill(S.pile, {count: view.pile}), x: 16, y: 850, font_size: 13, color: '#9fb7c9'});
    // A destination must exist in this scene (the place square is offered
    // only for a legal turn of the tile).
    var offered = {};
    targets.forEach(function (t) { offered[t.id] = true; });
    pieces.forEach(function (p) {
      if (p.move_targets) p.move_targets = p.move_targets.filter(function (id) { return offered[id]; });
    });
    result.scene = {pieces: pieces, targets: targets, labels: labels, controls: controls, paths: []};
    // Keep the placed choice until the new position arrives (the key then
    // changes), so the board does not flash another tile while the move is sent.
    result.local_state = local;
    return result;
  }
};
