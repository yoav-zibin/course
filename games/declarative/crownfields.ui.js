// Crownfields presentation. Pure JSON in, JSON scene out. The shared rules
// (tiles, cfLegal, cfProperties) are prepended by the builder from the server
// file, so highlights and previews use exactly the server's rules.
//
// Layout (600 wide, one layout for every screen): the status line; a compact
// draft (Now / Next rows); your kingdom on the left with every other kingdom,
// smaller, in a column beside it (name, colour, score, last tile outlined);
// a toolbar with your tile and big ↺ ✓ ↻ buttons. Nothing overlaps.
// Pick: tap a tile in the Next row, then tap it again or press Take tile.
// Lay: tap a glowing square for the tile's first half, turn it with ↺ ↻ (or
// select your tile in the toolbar: host tools, R / Shift+R), then ✓ or Lay tile.
// Squares are drawn upright (crowns never turn); only their places change.
var PLAYER_KEYS = ['amber', 'jade', 'rose', 'sky'];
var PLAYER_HEX = ['#ffb347', '#3fd6a0', '#ff6f91', '#5cc8ff'];
var TERRAIN_KEYS = ['wheat', 'forest', 'lake', 'meadow', 'marsh', 'mine'];
var TERRAIN_HEX = ['#f3d27a', '#7fd39e', '#7cc4ff', '#b8f0a8', '#c9d29a', '#c9ccd2'];
var STAGE_Y = 64;
var ROW_X = [150, 260, 370, 480], ROW_Y = {row: 28, next: 84};
// Your kingdom's squares are 46 units (art drawn for 50, scaled by R).
var CELL = 46, R = CELL / 50, REALM = {x: 4, y: 142};
var TOOL_Y = 602, SIDE = {x: 424, y: 118, width: 172};

function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, function (match, key) { return values[key] === undefined ? match : String(values[key]); });
}
function where(cell) {
  var r = Math.floor(cell / CF_SIZE) - 4, c = cell % CF_SIZE - 4;
  return (r ? Math.abs(r) + (r < 0 ? '↑' : '↓') : '') + (c ? Math.abs(c) + (c < 0 ? '←' : '→') : '') || '•';
}

var gameUI = {
  reduce: function (message, local) {
    var m = message.type === 'ui_event' ? message.state_changed : message;
    var S = Object.assign({}, SOURCE_STRINGS, m.strings || {});
    var view = m.view, event = message.type === 'ui_event' ? message.event : null;
    var players = m.players || [], n = view.grids.length;
    var colorName = function (seat) { return S['color_' + PLAYER_KEYS[seat]]; };
    var name = function (seat) {
      var p = players[seat];
      var label = fill(S.seat_name, {color: colorName(seat), name: p && p.name ? p.name : fill(S.player, {n: seat + 1})});
      // Your own seat says so everywhere it is named.
      return seat === m.my_player_index ? fill(S.you, {name: label}) : label;
    };
    var terrainName = function (t) { return S['terrain_' + TERRAIN_KEYS[t]]; };
    var over = m.status === 'over' || view.phase === 'over';
    var actingSeat = over ? -1 : view.kings[view.king];
    var acting = !over && m.status === 'ongoing' && !m.replay && m.acting_for_player_index === actingSeat && view.me === actingSeat;
    var key = view.phase + ':' + view.round + ':' + view.pos + ':' + view.stage + ':' + view.king + ':' + (view.setup_index || 0);
    var me = view.me >= 0 ? view.me : 0;
    local = local && local.key === key ? local : {key: key, pick: null, cell: null, dir: 0};
    var result = {};
    var newLocal = function (patch) { local = Object.assign({}, local, patch); };
    var placing = acting && view.stage === 'place';
    var picking = acting && view.stage === 'pick';
    var myTile = placing ? view.row[view.pos].n : null;
    var legal = placing ? cfPlacements(view.grids[actingSeat], myTile) : [];
    var fits = function (cell, dir) { return legal.some(function (o) { return o.cell === cell && o.dir === dir; }); };
    var anchors = {};
    legal.forEach(function (o) { anchors[o.cell] = true; });
    // The big kingdom is always yours (seat 0 for spectators); every other
    // kingdom is always visible beside it.
    var shown = me;
    if (event) {
      var id = event.type === 'drop' ? event.target_id : event.id, match;
      if (picking) {
        if (event.type === 'tap' && (match = /^next-(\d)$/.exec(id))) {
          var idx = Number(match[1]);
          if (view.next[idx] && view.next[idx].king === null) {
            if (local.pick === idx) result.make_move = {pick: idx};
            else newLocal({pick: idx});
          }
        } else if (event.type === 'tap' && id === 'take' && local.pick !== null) result.make_move = {pick: local.pick};
      } else if (placing) {
        if (event.type === 'tap' && (match = /^square-(\d+)$/.exec(id))) {
          var cell = Number(match[1]), dir = local.dir;
          if (!fits(cell, dir)) for (var d = 0; d < 4; d++) if (fits(cell, (local.dir + d) % 4)) { dir = (local.dir + d) % 4; break; }
          newLocal({cell: cell, dir: dir});
        } else if ((event.type === 'tap' || event.type === 'drop') && (id === 'rot-cw' || id === 'rot-ccw')) {
          newLocal({dir: (local.dir + (id === 'rot-cw' ? 1 : 3)) % 4});
        } else if (event.type === 'rotate' && event.id === 'mytile') {
          newLocal({dir: (local.dir + (event.delta > 0 ? 1 : 3)) % 4});
        } else if ((event.type === 'tap' || event.type === 'drop') && (id === 'lay' || id === 'lay-button') && local.cell !== null && fits(local.cell, local.dir)) {
          result.make_move = {cell: local.cell, dir: local.dir};
        } else if (event.type === 'tap' && id === 'discard' && !legal.length) {
          result.make_move = {discard: true};
        }
      }
    }
    var pieces = [], targets = [], labels = [], controls = [], paths = [];
    var shownSeat = shown;
    var square = function (id, at, sq, scale) {
      var piece = {id: id, type: 'square', board: 'stage', position: at, z: 2, actions: [],
                   asset: sq[0] === 6 ? 'keep_' + PLAYER_KEYS[shownSeat] : 'sq_' + sq[0] + '_' + sq[1],
                   aria_label: sq[0] === 6 ? fill(S.keep_of, {name: name(shownSeat)}) : fill(S.square_of, {terrain: terrainName(sq[0]), crowns: sq[1]})};
      if (scale !== 1) piece.scale = scale;
      return piece;
    };
    var tileLabel = function (num) {
      var t = CF_TILES[num - 1];
      return fill(S.tile_label, {n: num, a: terrainName(t[0][0]), b: terrainName(t[1][0])});
    };
    // A white outline around a player's most recently laid tile.
    var lastMark = function (id, seat, at, scale) {
      var laid = view.laid[seat] || [];
      if (!laid.length) return;
      var t = laid[laid.length - 1], cells = cfCells(t.cell, t.dir), a = at(cells[0]), b = at(cells[1]);
      var piece = {id: id, type: 'frame', board: 'stage', position: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, rotation: a.x === b.x ? 90 : 0,
                   asset: 'last_mark', z: 5, actions: [], aria_label: fill(S.last_tile_of, {name: name(seat), n: t.n})};
      if (scale !== 1) piece.scale = scale;
      pieces.push(piece);
    };
    var short = function (text, most) { return text.length > most ? text.slice(0, most - 1) + '…' : text; };
    var status, hint = '';
    if (!over) {
      // ---- draft: Now and Next rows ----
      labels.push({id: 'row-label', text: S.row_now, x: 12, y: STAGE_Y + ROW_Y.row - 9, font_size: 16, color: '#c9d4e0'});
      labels.push({id: 'next-label', text: S.row_next, x: 12, y: STAGE_Y + ROW_Y.next - 9, font_size: 16, color: '#c9d4e0'});
      var king = function (k, x, y, z, opacity) {
        var owner = view.kings[k], piece = {id: 'king-' + k, type: 'king', board: 'stage', position: {x: x - 30, y: y}, asset: 'king_' + PLAYER_KEYS[owner],
                                            z: z, actions: [], aria_label: fill(S.king_of, {name: name(owner)})};
        if (opacity) piece.opacity = opacity;
        return piece;
      };
      view.row.forEach(function (t, i) {
        var done = i < view.pos || (i === view.pos && view.stage === 'pick');
        if (done) return;
        var mine = placing && i === view.pos;
        // The tile being laid is shown faded here: it lives on the realm.
        pieces.push({id: 'tile-' + t.n, type: 'tile', board: 'stage', position: {x: ROW_X[i], y: ROW_Y.row}, asset: 'tile_' + t.n,
                     z: 1, opacity: mine ? 0.3 : 1, actions: [], aria_label: tileLabel(t.n)});
        if (t.king !== null) pieces.push(king(t.king, ROW_X[i], ROW_Y.row, 3));
      });
      view.next.forEach(function (t, i) {
        pieces.push({id: 'tile-' + t.n, type: 'tile', board: 'stage', position: {x: ROW_X[i], y: ROW_Y.next}, asset: 'tile_' + t.n,
                     z: 1, actions: [], aria_label: tileLabel(t.n)});
        if (t.king !== null) pieces.push(king(t.king, ROW_X[i], ROW_Y.next, 3));
        else if (picking) targets.push({id: 'next-' + i, board: 'stage', position: {x: ROW_X[i], y: ROW_Y.next}, asset: local.pick === i ? 'pick_on' : 'pick',
                                         hit_area: {x: -52, y: -27, width: 104, height: 54}, aria_label: fill(S.take_label, {n: t.n})});
      });
      if (picking && local.pick !== null) {
        pieces.push({id: 'king-ghost', type: 'king', board: 'stage', position: {x: ROW_X[local.pick] - 30, y: ROW_Y.next}, asset: 'king_' + PLAYER_KEYS[actingSeat],
                     z: 4, opacity: 0.6, actions: [], aria_label: S.your_choice});
        controls.push({id: 'take', kind: 'button', label: fill(S.take_button, {n: view.next[local.pick].n})});
      }
      // ---- the realm ----
      pieces.push({id: 'realm-grid', type: 'grid', board: 'stage', position: {x: REALM.x + 4.5 * CELL, y: REALM.y + 4.5 * CELL}, scale: R, z: 0, actions: [],
                   aria_label: fill(S.realm_of, {name: name(shown)})});
      var grid = view.grids[shown], b = cfBounds(grid);
      var r0 = b.r1 - 4, r1 = b.r0 + 4, c0 = b.c1 - 4, c1 = b.c0 + 4;
      var X = function (c) { return REALM.x + c * CELL; }, Y = function (r) { return REALM.y + r * CELL; };
      paths.push({id: 'limit', color: '#ffd98a', width: 3, points: [
        {x: X(c0), y: STAGE_Y + Y(r0)}, {x: X(c1 + 1), y: STAGE_Y + Y(r0)}, {x: X(c1 + 1), y: STAGE_Y + Y(r1 + 1)},
        {x: X(c0), y: STAGE_Y + Y(r1 + 1)}, {x: X(c0), y: STAGE_Y + Y(r0)}]});
      var cellAt = function (c) { return {x: X(c % CF_SIZE) + CELL / 2, y: Y(Math.floor(c / CF_SIZE)) + CELL / 2}; };
      pieces.push(square('keep-' + shown, cellAt(CF_KEEP), [6, 0], R));
      (view.laid[shown] || []).forEach(function (t) {
        cfCells(t.cell, t.dir).forEach(function (c, h) { pieces.push(square('sq-' + t.n + '-' + h, cellAt(c), CF_TILES[t.n - 1][h], R)); });
      });
      labels.push({id: 'my-title', text: short(fill(view.live_scores[shown] === 1 ? S.realm_title_one : S.realm_title, {name: name(shown), score: view.live_scores[shown]}), 46), x: REALM.x + 2,
                   y: STAGE_Y + REALM.y - 24, font_size: 16, color: PLAYER_HEX[shown]});
      // ---- every other kingdom, smaller, in a column beside yours ----
      var others = [];
      for (var o = 0; o < n; o++) if (o !== shown) others.push(o);
      // Small boards as large as the column allows (34, or 21 for three, which
      // must end above the ↻ button).
      var mini = others.length <= 2 ? 34 : 21, slotH = 5 * mini + 40;
      others.forEach(function (o, i) {
        shownSeat = o;
        var top = SIDE.y + i * slotH, ox = SIDE.x + (SIDE.width - 5 * mini) / 2, oy = top + 36;
        var g = view.grids[o], bb = cfBounds(g), sc = mini / 50;
        labels.push({id: 'mini-name-' + o, text: short(name(o), 24), x: SIDE.x, y: STAGE_Y + top, font_size: 13, color: PLAYER_HEX[o]});
        labels.push({id: 'mini-score-' + o, text: view.live_scores[o] === 1 ? S.point_one : fill(S.points, {score: view.live_scores[o]}), x: SIDE.x, y: STAGE_Y + top + 17, font_size: 13, color: '#e6eef6'});
        pieces.push({id: 'mini-frame-' + o, type: 'endframe', board: 'stage', position: {x: ox + 2.5 * mini, y: oy + 2.5 * mini}, scale: sc, z: 0, actions: [],
                     aria_label: fill(S.realm_of, {name: name(o)})});
        var at = function (c) { return {x: ox + (c % CF_SIZE - bb.c0) * mini + mini / 2, y: oy + (Math.floor(c / CF_SIZE) - bb.r0) * mini + mini / 2}; };
        g.forEach(function (sq, c) {
          if (!sq) return;
          var piece = square(sq[0] === 6 ? 'mini-keep-' + o : 'mini-' + o + '-' + c, at(c), sq, sc);
          // Small boards use flat squares with large crowns, readable on a phone.
          if (sq[0] !== 6) piece.asset = 'mq_' + sq[0] + '_' + sq[1];
          pieces.push(piece);
        });
        lastMark('last-mini-' + o, o, at, sc);
      });
      shownSeat = shown;
      if (placing && shown === actingSeat) {
        if (!legal.length) controls.push({id: 'discard', kind: 'button', label: S.discard_button});
        else {
          for (var cellId = 0; cellId < CF_SIZE * CF_SIZE; cellId++) {
            if (!anchors[cellId] || cellId === local.cell) continue;
            targets.push({id: 'square-' + cellId, board: 'stage', position: cellAt(cellId), asset: 'spot',
                          hit_area: {x: -CELL / 2, y: -CELL / 2, width: CELL, height: CELL}, aria_label: fill(S.square_label, {where: where(cellId)})});
          }
          var okNow = local.cell !== null && fits(local.cell, local.dir);
          if (local.cell !== null) {
            var cellsNow = cfCells(local.cell, local.dir);
            if (cellsNow) {
              cellsNow.forEach(function (c, h) {
                var piece = square('sq-' + myTile + '-' + h, cellAt(c), CF_TILES[myTile - 1][h], R);
                piece.z = 4; piece.opacity = okNow ? 0.95 : 0.55; piece.aria_label = fill(S.laid_label, {n: myTile});
                pieces.push(piece);
              });
              var a = cellAt(cellsNow[0]), b2 = cellAt(cellsNow[1]);
              pieces.push({id: 'ghost', type: 'frame', board: 'stage', position: {x: (a.x + b2.x) / 2, y: (a.y + b2.y) / 2}, scale: R, rotation: local.dir % 2 ? 90 : 0,
                           asset: okNow ? 'fit_ok' : 'fit_bad', z: 5, actions: [], aria_label: fill(okNow ? S.ghost_ok : S.ghost_bad, {n: myTile})});
            }
          }
          // ---- toolbar: your tile (select it for the host's tools / R), ↺,
          // lay ✓, ↻: big buttons that cover nothing ----
          pieces.push({id: 'mytile', type: 'tile', board: 'stage', position: {x: 80, y: TOOL_Y}, asset: 'tile_' + myTile, z: 2,
                       actions: ['rotate'], aria_label: fill(S.ghost_label, {n: myTile})});
          targets.push({id: 'rot-ccw', board: 'stage', position: {x: 250, y: TOOL_Y}, asset: 'rot_ccw', hit_area: {x: -36, y: -36, width: 72, height: 72}, aria_label: S.rotate_ccw});
          targets.push({id: 'rot-cw', board: 'stage', position: {x: 450, y: TOOL_Y}, asset: 'rot_cw', hit_area: {x: -36, y: -36, width: 72, height: 72}, aria_label: S.rotate_cw});
          if (okNow) targets.push({id: 'lay', board: 'stage', position: {x: 350, y: TOOL_Y}, asset: 'lay_ok', hit_area: {x: -36, y: -36, width: 72, height: 72},
                                   aria_label: fill(S.lay_here, {n: myTile})});
          if (local.cell !== null) controls.push({id: 'lay-button', kind: 'button', label: S.lay_button, disabled: !okNow});
        }
      }
      if (acting) {
        status = fill(picking ? S.pick_turn : S.lay_turn, {name: name(actingSeat)});
        hint = picking ? (local.pick === null ? S.hint_pick : S.hint_take)
          : !legal.length ? S.hint_discard : local.cell === null ? S.hint_square : fits(local.cell, local.dir) ? S.hint_lay : S.hint_turn;
      } else status = fill(view.stage === 'pick' ? S.waiting_pick : S.waiting_lay, {name: name(actingSeat)});
      labels.push({id: 'pile', text: fill(S.pile, {count: view.pile, round: view.round}), x: 14, y: STAGE_Y + 646, font_size: 14, color: '#9fb7c9'});
    } else {
      // ---- end: every kingdom cropped to its used area, with its full score
      // breakdown; the whole block is centred in the stage ----
      var cols = n === 1 ? 1 : 2, size = n <= 2 ? 56 : 34, scale = size / 50, line = n <= 2 ? 21 : 16, font = n <= 2 ? 15 : 13;
      var groups = [], most = 0;
      for (var s1 = 0; s1 < n; s1++) {
        groups.push(cfProperties(view.grids[s1]).filter(function (p) { return p.crowns; })
          .sort(function (p, q) { return q.size * q.crowns - p.size * p.crowns; }));
        most = Math.max(most, groups[s1].length);
      }
      var blockH = 28 + 5 * size + 10 + (most + 1) * line + 6, rows = Math.ceil(n / cols);
      var top0 = Math.max(8, (656 - rows * blockH) / 2);
      for (var s2 = 0; s2 < n; s2++) {
        shownSeat = s2;
        var g = view.grids[s2], bb = cfBounds(g);
        var colW = 600 / cols, ox = (s2 % cols) * colW + (colW - 5 * size) / 2, ny = top0 + Math.floor(s2 / cols) * blockH, oy = ny + 28;
        labels.push({id: 'end-name-' + s2, text: short(name(s2), n <= 2 ? 30 : 22), x: ox, y: STAGE_Y + ny, font_size: 16, color: PLAYER_HEX[s2]});
        pieces.push({id: 'end-frame-' + s2, type: 'endframe', board: 'stage', position: {x: ox + 2.5 * size, y: oy + 2.5 * size}, scale: scale, z: 0, actions: [],
                     aria_label: fill(S.realm_of, {name: name(s2)})});
        g.forEach(function (sq, c) {
          if (!sq) return;
          var rr = Math.floor(c / CF_SIZE) - bb.r0, cc = c % CF_SIZE - bb.c0;
          var pid = sq[0] === 6 ? 'keep-' + s2 : 'end-' + s2 + '-' + c;
          pieces.push(square(pid, {x: ox + cc * size + size / 2, y: oy + rr * size + size / 2}, sq, scale));
        });
        var ly = STAGE_Y + oy + 5 * size + 10;
        groups[s2].forEach(function (p, i) {
          labels.push({id: 'legend-' + s2 + '-' + i, text: terrainName(p.terrain) + '  ' + p.size + '×' + p.crowns + ' = ' + p.size * p.crowns,
                       x: ox, y: ly + i * line, font_size: font, color: TERRAIN_HEX[p.terrain]});
        });
        labels.push({id: 'legend-total-' + s2, text: fill(S.total, {score: view.scores[s2]}) + (view.discards[s2] ? ' · ' + fill(S.discarded, {count: view.discards[s2]}) : ''),
                     x: ox, y: ly + groups[s2].length * line + 4, font_size: font + 1, color: '#fff6d8'});
      }
      status = view.winners.length === 1 ? fill(S.wins, {name: name(view.winners[0]), score: view.scores[view.winners[0]]})
        : fill(S.tie, {names: view.winners.map(colorName).join(' & ')});
      hint = S.hint_over;
    }
    labels.push({id: 'status', text: status, x: 14, y: 6, font_size: 22,
                 color: over ? (view.winners.length === 1 ? PLAYER_HEX[view.winners[0]] : '#f6efe0') : PLAYER_HEX[actingSeat]});
    if (hint) labels.push({id: 'hint', text: hint, x: 14, y: 37, font_size: 16, color: hint === S.hint_turn || hint === S.hint_discard ? '#ff9d8a' : '#ffd98a'});
    var offered = {};
    targets.forEach(function (t) { offered[t.id] = true; });
    pieces.forEach(function (p) {
      if (p.actions && p.actions.indexOf('rotate') >= 0) p.move_targets = ['rot-cw', 'rot-ccw', 'lay'].filter(function (t) { return offered[t]; });
    });
    result.scene = {pieces: pieces, targets: targets, labels: labels, controls: controls, paths: paths};
    result.local_state = local;
    return result;
  }
};
