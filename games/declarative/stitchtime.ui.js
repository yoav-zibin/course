// Stitch & Time presentation. Pure JSON in, JSON scene out. The shared rules
// (patches, stShape, stFits, stTurn) are prepended by the builder from the
// server file, so previews use exactly the server's rules.
//
// Tap one of the three patch cards: a ghost appears on your quilt in a good
// spot. Tap a square to move it there (its top-left corner), turn it with ↺ ↻,
// mirror it with ⇋ (or select your patch in the toolbar: host tools, R /
// Shift+R / F), then ✓. Or press "Advance" to move past your rival for buttons.
var CELL = 46, MARKET_SCALE = 0.8;
var SEAT_KEYS = ['amber', 'jade'];
var SEAT_HEX = ['#ffb347', '#3fd6a0'];
var TRACK = {x0: 24, x1: 456, y: 118};

function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, function (match, key) { return values[key] === undefined ? match : String(values[key]); });
}
function trackX(pos) { return TRACK.x0 + (TRACK.x1 - TRACK.x0) * pos / ST_END; }

var gameUI = {
  reduce: function (message, local) {
    var m = message.type === 'ui_event' ? message.state_changed : message;
    var S = Object.assign({}, SOURCE_STRINGS, m.strings || {});
    var view = m.view, event = message.type === 'ui_event' ? message.event : null;
    var players = m.players || [];
    var colorName = function (seat) { return seat === 0 ? S.amber : S.jade; };
    var name = function (seat) {
      var p = players[seat];
      var label = fill(S.seat_name, {color: colorName(seat), name: p && p.name ? p.name : fill(S.player, {n: seat + 1})});
      // Your own seat says so everywhere it is named.
      return seat === m.my_player_index ? fill(S.you, {name: label}) : label;
    };
    var over = m.status === 'over' || view.phase === 'over';
    var turn = over ? -1 : view.turn;
    var acting = !over && m.status === 'ongoing' && !m.replay && turn >= 0 && m.acting_for_player_index === turn && view.me === turn;
    var me = view.me >= 0 ? view.me : 0;
    var key = view.turn_no + ':' + turn;
    local = local && local.key === key ? local : {key: key, pick: null, o: 0, x: 0, y: 0, rival: local ? local.rival : false};
    var result = {};
    var newLocal = function (patch) { local = Object.assign({}, local, patch); };
    var options = stOptions(view);
    var leathering = acting && view.pending[turn] > 0;
    var quilt = acting ? view.quilts[turn] : null;
    // A good first spot for a picked patch: the server-side helper the
    // computer uses, so the ghost starts somewhere sensible.
    var firstSpot = function (p) { var b = stBest(quilt, p); return b || {o: 0, x: 0, y: 0}; };
    // Anyone may switch between the two quilts, at any time.
    if (event && event.type === 'tap' && event.id === 'rival') newLocal({rival: !local.rival});
    else if (event && acting) {
      var id = event.type === 'drop' ? event.target_id : event.id, match;
      if (leathering) {
        if (event.type === 'tap' && (match = /^leather-(\d+)$/.exec(id))) result.make_move = {leather: Number(match[1])};
      } else if (event.type === 'tap' && (match = /^buy-(\d)$/.exec(id))) {
        var k = Number(match[1]), p = options[k];
        if (local.pick === k) newLocal({pick: null});
        else if (p !== undefined && view.buttons[turn] >= ST_PATCHES[p].cost) newLocal(Object.assign({pick: k, rival: false}, firstSpot(p)));
      } else if (event.type === 'tap' && id === 'advance') result.make_move = {advance: true};
      else if (local.pick !== null) {
        var pp = options[local.pick];
        // After a turn or mirror, if the patch no longer fits where it is,
        // hop to the nearest spot where it does.
        var settle = function (o, x, y) {
          var s = stShape(pp, o);
          x = Math.min(x, 9 - s.w); y = Math.min(y, 9 - s.h);
          if (!stFits(quilt, pp, o, x, y)) {
            var best = null;
            for (var yy = 0; yy + s.h <= 9; yy++) for (var xx = 0; xx + s.w <= 9; xx++) {
              if (!stFits(quilt, pp, o, xx, yy)) continue;
              var d = Math.abs(xx - x) + Math.abs(yy - y);
              if (best === null || d < best.d) best = {x: xx, y: yy, d: d};
            }
            if (best) { x = best.x; y = best.y; }
          }
          newLocal({o: o, x: x, y: y});
        };
        var turnBy = function (delta) { settle((local.o >= 4 ? 4 : 0) + (((local.o % 4) + delta) % 4 + 4) % 4, local.x, local.y); };
        if ((event.type === 'tap' || event.type === 'drop') && (id === 'rot-cw' || id === 'rot-ccw')) turnBy(id === 'rot-cw' ? 1 : -1);
        else if (event.type === 'rotate' && event.id === 'mypatch') turnBy(event.delta > 0 ? 1 : -1);
        else if (((event.type === 'tap' || event.type === 'drop') && id === 'mirror') || (event.type === 'flip' && event.id === 'mypatch')) {
          settle(local.o >= 4 ? local.o - 4 : local.o + 4, local.x, local.y);
        } else if (event.type === 'tap' && (match = /^cell-(\d+)$/.exec(id))) {
          var c = Number(match[1]), s3 = stShape(pp, local.o);
          newLocal({x: Math.min(c % 9, 9 - s3.w), y: Math.min(Math.floor(c / 9), 9 - s3.h)});
        } else if ((event.type === 'tap' || event.type === 'drop') && (id === 'place' || id === 'place-button') && stFits(quilt, pp, local.o, local.x, local.y)) {
          result.make_move = {buy: local.pick, o: local.o, x: local.x, y: local.y};
        } else if (event.type === 'tap' && id === 'cancel') newLocal({pick: null});
      }
    }
    var pieces = [], targets = [], labels = [], controls = [], paths = [];
    var shownSeat = local.rival ? 1 - me : (acting ? turn : me);
    // Patches are drawn square by square, so any turn or mirror is exact.
    var patchCells = function (prefix, p, o, x, y, board, scale, extra, centre) {
      var s = stShape(p, o), out = [], income = p === 33 ? 0 : ST_PATCHES[p].income, size = CELL * scale;
      var ox = centre ? centre.x - s.w * size / 2 : x * CELL, oy = centre ? centre.y - s.h * size / 2 : y * CELL;
      s.cells.forEach(function (c, i) {
        var piece = {id: prefix + '-' + i, type: 'sq', board: board, position: {x: ox + (c[0] + 0.5) * size, y: oy + (c[1] + 0.5) * size},
                     asset: (i < income ? 'b' : 'f') + p, z: 2, actions: [], aria_label: p === 33 ? S.leather : fill(S.patch_name, {n: s.cells.length})};
        if (scale !== 1) piece.scale = scale;
        out.push(Object.assign(piece, extra || {}));
      });
      return out;
    };
    // ---- time track: a bar, income and leather marks, both tokens ----
    paths.push({id: 'track', color: '#5b4a36', width: 10, points: [{x: TRACK.x0, y: TRACK.y}, {x: TRACK.x1, y: TRACK.y}]});
    ST_INCOME.forEach(function (sp, i) {
      paths.push({id: 'inc-' + i, color: '#ffd23f', width: 4, points: [{x: trackX(sp), y: TRACK.y - 9}, {x: trackX(sp), y: TRACK.y + 9}]});
    });
    view.leather.forEach(function (sp, i) {
      paths.push({id: 'lea-' + i, color: '#a0603a', width: 8, points: [{x: trackX(sp) - 4, y: TRACK.y}, {x: trackX(sp) + 4, y: TRACK.y}]});
    });
    [0, 1].forEach(function (seat) {
      var x = trackX(view.pos[seat]), dy = seat === 0 ? -1 : 1;
      paths.push({id: 'tok-' + seat, color: SEAT_HEX[seat], width: 7, points: [{x: x, y: TRACK.y}, {x: x, y: TRACK.y + dy * 18}]});
    });
    // ---- the shown quilt ----
    pieces.push({id: 'quilt-art', type: 'quiltart', board: 'quilt', position: {x: 207, y: 207}, z: 0, actions: [], aria_label: fill(S.quilt_of, {name: name(shownSeat)})});
    view.placed[shownSeat].forEach(function (pl, i) {
      pieces = pieces.concat(patchCells('placed-' + shownSeat + '-' + i, pl.p, pl.o, pl.x, pl.y, 'quilt', 1, {z: 1}));
    });
    var hint = '', status;
    if (!over) {
      // ---- market: the next three patches ----
      options.forEach(function (p, k) {
        var def = ST_PATCHES[p], cx = 100 + k * 200, afford = view.buttons[turn >= 0 ? turn : me] >= def.cost;
        var base = stShape(p, 0);
        pieces = pieces.concat(patchCells('market-' + p, p, 0, 0, 0, 'market', MARKET_SCALE, acting && !afford ? {opacity: 0.4} : {}, {x: cx, y: 64}));
        if (acting && !leathering) targets.push({id: 'buy-' + k, board: 'market', position: {x: cx, y: 64}, asset: local.pick === k ? 'card_on' : 'card',
                                                 hit_area: {x: -95, y: -62, width: 190, height: 124}, aria_label: fill(afford ? S.buy_label : S.cannot_afford, {cost: def.cost, time: def.time, income: def.income})});
        labels.push({id: 'price-' + k, text: fill(S.price_line, {cost: def.cost, time: def.time, income: def.income}), x: cx - 80, y: 140 + 134, font_size: 16,
                     color: afford || !acting ? '#f6efe0' : '#9a8c7a'});
      });
      labels.push({id: 'circle', text: fill(S.circle_left, {count: Math.max(0, view.circle.length - 3)}), x: 412, y: 140 + 158, font_size: 13, color: '#b9a98f'});
      if (acting && leathering) {
        view.quilts[turn].forEach(function (c, i) {
          if (c < 0) targets.push({id: 'leather-' + i, board: 'quilt', position: {cell: String(i)}, asset: 'spot', aria_label: fill(S.leather_here, {square: i})});
        });
        hint = S.hint_leather;
      } else if (acting && local.pick !== null) {
        var pk = options[local.pick], fits = stFits(quilt, pk, local.o, local.x, local.y);
        // The ghost uses the same square ids the placed patch will get, so
        // placing it does not jump.
        pieces = pieces.concat(patchCells('placed-' + turn + '-' + view.placed[turn].length, pk, local.o, local.x, local.y, 'quilt', 1,
                                          {z: 4, opacity: fits ? 0.9 : 0.45, aria_label: fill(fits ? S.ghost_ok : S.ghost_bad, {n: stShape(pk, 0).cells.length})}));
        for (var cell = 0; cell < 81; cell++) {
          if (quilt[cell] >= 0) continue;
          targets.push({id: 'cell-' + cell, board: 'quilt', position: {cell: String(cell)}, asset: 'clear', aria_label: fill(S.move_here, {square: cell})});
        }
        // A spool handle: select it for the host's rotate and flip tools (R, Shift+R, F).
        pieces.push({id: 'mypatch', type: 'handle', board: 'tools', position: {x: 110, y: 62}, z: 2, actions: ['rotate', 'flip'],
                     aria_label: fill(S.your_patch, {n: stShape(pk, 0).cells.length})});
        targets.push({id: 'rot-ccw', board: 'tools', position: {x: 250, y: 62}, asset: 'rot_ccw', hit_area: {x: -36, y: -36, width: 72, height: 72}, aria_label: S.rotate_ccw});
        targets.push({id: 'mirror', board: 'tools', position: {x: 340, y: 62}, asset: 'mirror', hit_area: {x: -36, y: -36, width: 72, height: 72}, aria_label: S.mirror});
        if (fits) targets.push({id: 'place', board: 'tools', position: {x: 430, y: 62}, asset: 'place_ok', hit_area: {x: -36, y: -36, width: 72, height: 72}, aria_label: S.place_label});
        targets.push({id: 'rot-cw', board: 'tools', position: {x: 520, y: 62}, asset: 'rot_cw', hit_area: {x: -36, y: -36, width: 72, height: 72}, aria_label: S.rotate_cw});
        controls.push({id: 'place-button', kind: 'button', label: S.place_label, disabled: !fits});
        controls.push({id: 'cancel', kind: 'button', label: S.cancel});
        hint = fits ? S.hint_place : S.hint_blocked;
      } else if (acting) {
        var gain = Math.min(ST_END, view.pos[1 - turn] + 1) - view.pos[turn];
        // The words live inside the button, so the whole button takes the tap.
        targets.push({id: 'advance', board: 'tools', position: {x: 300, y: 62}, color: '#e9c46a', label: fill(S.advance_button, {count: gain}),
                      hit_area: {x: -150, y: -34, width: 300, height: 68}, aria_label: fill(S.advance_label, {count: gain})});
        hint = S.hint_pick;
      }
      targets.push({id: 'rival', board: 'track', position: {x: 530, y: 22}, color: local.rival ? '#9fd3ff' : '#4b6378',
                                label: local.rival ? S.my_quilt : S.rival_quilt, hit_area: {x: -62, y: -20, width: 124, height: 40},
                                aria_label: local.rival ? S.my_quilt : S.rival_quilt});
      status = acting ? fill(leathering ? S.leather_turn : S.your_turn, {name: name(turn)}) : fill(S.waiting, {name: name(turn)});
      if (local.rival) hint = fill(S.viewing_rival, {name: name(shownSeat)});
    } else {
      status = fill(S.wins, {name: name(view.winner), score: view.scores[view.winner]});
      [0, 1].forEach(function (seat, i) {
        labels.push({id: 'score-' + seat, text: fill(S.score_line, {name: colorName(seat), buttons: view.buttons[seat], bonus: view.bonus === seat ? 7 : 0,
                                                                      empty: 2 * stEmpty(view.quilts[seat]), total: view.scores[seat]}),
                     x: 16, y: 160 + i * 40, font_size: 18, color: SEAT_HEX[seat]});
      });
      if (view.scores[0] === view.scores[1]) labels.push({id: 'tiebreak', text: S.tie_break, x: 16, y: 240, font_size: 15, color: '#c9d4e0'});
      // No quilt toggle at the end: the portal disables every button then, and
      // the score lines already cover both players.
      hint = S.hint_over;
    }
    labels.push({id: 'status', text: status, x: 14, y: 6, font_size: 22, color: over ? SEAT_HEX[view.winner] : '#f6efe0'});
    if (hint) labels.push({id: 'hint', text: hint, x: 14, y: 37, font_size: 16, color: hint === S.hint_blocked ? '#ff9d8a' : '#ffd98a'});
    [me, 1 - me].forEach(function (seat, i) {
      labels.push({id: 'info-' + seat, text: fill(S.info_line, {name: colorName(seat), buttons: view.buttons[seat], income: view.income[seat], pos: view.pos[seat]}) +
                   (view.bonus === seat ? ' · ★7' : ''), x: 14 + i * 300, y: 68, font_size: 15, color: SEAT_HEX[seat]});
    });
    var offered = {};
    targets.forEach(function (t) { offered[t.id] = true; });
    pieces.forEach(function (p) {
      if (p.id === 'mypatch') p.move_targets = ['rot-cw', 'rot-ccw', 'mirror', 'place'].filter(function (t) { return offered[t]; });
    });
    result.scene = {pieces: pieces, targets: targets, labels: labels, controls: controls, paths: paths};
    result.local_state = local;
    return result;
  }
};
