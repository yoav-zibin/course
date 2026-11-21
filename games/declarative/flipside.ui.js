// Flipside Lords presentation. Pure JSON in, JSON scene out. The shared rules
// (tiles, flLegal, flInDanger) are prepended by the builder from the server
// file, so highlights are exactly the server's legal moves.
//
// Setup: tap a middle square of your home row for your Lord, then two squares
// beside it for your Footmen. Play: tap one of your tiles to see where it can
// go (green: move, red: strike, blue: command), tap a highlight to act; or
// press "Draw a troop" and tap a square beside your Lord. Select a tile and
// use the host's flip tool (or F) to look at its other side.
var CELL = 90, BOARD = {x: 30, y: 130};
var SEAT_KEYS = ['light', 'dark'];
var COLS = 'ABCDEF';
var TYPES = ['duke', 'footman', 'pikeman', 'knight', 'wizard', 'ranger', 'seer', 'general', 'priest', 'champion', 'marshall', 'bowman'];

function fill(text, values) {
  return String(text).replace(/\{(\w+)\}/g, function (match, key) { return values[key] === undefined ? match : String(values[key]); });
}
// Squares are named from the viewer's side: A1 is the bottom-left for seat 0.
function sqName(sq, me) {
  var c = sq % 6, r = Math.floor(sq / 6);
  if (me === 1) { c = 5 - c; r = 5 - r; }
  return COLS[c] + (6 - r);
}

var gameUI = {
  reduce: function (message, local) {
    var m = message.type === 'ui_event' ? message.state_changed : message;
    var S = Object.assign({}, SOURCE_STRINGS, m.strings || {});
    var view = m.view, event = message.type === 'ui_event' ? message.event : null;
    var players = m.players || [];
    var colorName = function (seat) { return seat === 0 ? S.light : S.dark; };
    var name = function (seat) {
      var p = players[seat];
      var label = fill(S.seat_name, {color: colorName(seat), name: p && p.name ? p.name : fill(S.player, {n: seat + 1})});
      // Your own seat says so everywhere it is named.
      return seat === m.my_player_index ? fill(S.you, {name: label}) : label;
    };
    var unit = function (t) { return S['unit_' + t]; };
    var over = m.status === 'over' || view.phase === 'over';
    var acting = !over && m.status === 'ongoing' && !m.replay && view.cur !== null && m.acting_for_player_index === view.cur && view.me === view.cur;
    var me = view.me >= 0 ? view.me : 0;
    // The board is drawn from the viewer's side: seat 1 sees it turned around.
    var flipView = me === 1;
    var pos = function (sq) {
      var c = sq % 6, r = Math.floor(sq / 6);
      if (flipView) { c = 5 - c; r = 5 - r; }
      return {x: c * CELL + CELL / 2, y: r * CELL + CELL / 2};
    };
    var key = view.phase + ':' + view.turn_no + ':' + view.cur;
    local = local && local.key === key ? local : {key: key, sel: null, via: null, drawing: false, peek: null, duke: null, feet: []};
    var result = {};
    var newLocal = function (patch) { local = Object.assign({}, local, patch); };
    var legal = acting && view.phase === 'play' ? flLegal(view.board, view.cur, view.bags[view.cur].length) : [];
    var strip = function (a) { var o = {action: a.action, to: a.to}; if (a.from !== undefined) o.from = a.from; if (a.via !== undefined) o.via = a.via; return o; };
    if (event && acting) {
      var id = event.type === 'drop' ? event.target_id : event.id, match;
      // A drag selects its tile even without a tap first.
      if (event.type === 'drop' && (match = /^tile-(\d+)$/.exec(event.piece_id || ''))) {
        var dragged = Number(match[1]);
        view.board.forEach(function (t, i) { if (t && t.id === dragged) local = Object.assign({}, local, {sel: i}); });
      }
      if (view.phase === 'setup') {
        if (event.type === 'tap' && (match = /^lord-(\d+)$/.exec(id))) newLocal({duke: Number(match[1]), feet: []});
        else if (event.type === 'tap' && (match = /^foot-(\d+)$/.exec(id))) {
          var q = Number(match[1]), feet = local.feet.indexOf(q) >= 0 ? local.feet.filter(function (x) { return x !== q; }) : local.feet.concat([q]);
          if (feet.length === 2) result.make_move = {duke: local.duke, footmen: feet};
          else newLocal({feet: feet});
        } else if (event.type === 'tap' && id === 'restart') newLocal({duke: null, feet: []});
      } else {
        if ((match = /^tile-(\d+)$/.exec(event.id || '')) && event.type === 'flip') {
          var fq = Number(/^tile-(\d+)$/.exec(event.id)[1]), sqFlip = -1;
          view.board.forEach(function (t, i) { if (t && t.id === fq) sqFlip = i; });
          newLocal({peek: local.peek === sqFlip ? null : sqFlip, sel: sqFlip, via: null, drawing: false});
        } else if (event.type === 'tap' && (match = /^tile-(\d+)$/.exec(id))) {
          var tid = Number(match[1]), at = -1;
          view.board.forEach(function (t, i) { if (t && t.id === tid) at = i; });
          if (at >= 0 && view.board[at].o === view.cur) newLocal({sel: local.sel === at && local.via === null ? null : at, via: null, drawing: false, peek: null});
        } else if ((event.type === 'tap' || event.type === 'drop') && id === 'draw') newLocal({drawing: !local.drawing, sel: null, via: null, peek: null});
        else if (event.type === 'tap' && id === 'cancel') newLocal({sel: null, via: null, drawing: false, peek: null});
        else if ((event.type === 'tap' || event.type === 'drop') && (match = /^(go|strike|cmdto|place)-(\d+)$/.exec(id))) {
          var to = Number(match[2]), kind = match[1];
          var pick = legal.filter(function (a) {
            if (kind === 'place') return a.action === 'place' && a.to === to;
            if (a.from !== local.sel || a.to !== to) return false;
            if (kind === 'go') return a.action === 'move';
            if (kind === 'strike') return a.action === 'strike';
            return a.action === 'command' && a.via === local.via;
          })[0];
          if (pick) result.make_move = strip(pick);
        } else if (event.type === 'tap' && (match = /^cmdfrom-(\d+)$/.exec(id))) newLocal({via: Number(match[1])});
      }
    }
    var pieces = [], targets = [], labels = [], controls = [], paths = [];
    pieces.push({id: 'field', type: 'field', board: 'board', position: {x: 270, y: 270}, z: 0, actions: [], aria_label: S.board_name});
    // Last move: from and to squares.
    if (view.last && view.last.to !== undefined && view.last.kind !== 'setup') {
      [view.last.from, view.last.to].forEach(function (sq, i) {
        if (sq === null || sq === undefined) return;
        pieces.push({id: 'last-' + i, type: 'mark', board: 'board', position: pos(sq), asset: 'last_' + SEAT_KEYS[view.last.seat], z: 3, actions: [],
                     aria_label: fill(i ? S.last_to : S.last_from, {square: sqName(sq, me)})});
      });
    }
    var myTurnPlay = acting && view.phase === 'play';
    view.board.forEach(function (t, sq) {
      if (!t) return;
      var side = local.peek === sq ? 1 - t.s : t.s, mine = myTurnPlay && t.o === view.cur;
      var hasMoves = mine && legal.some(function (a) { return a.from === sq; });
      var piece = {id: 'tile-' + t.id, type: 'troop', board: 'board', position: pos(sq),
                   asset: t.t + '_' + side + '_' + SEAT_KEYS[t.o], rotation: (t.o === me ? 0 : 180), z: 2, actions: [],
                   aria_label: fill(S.tile_at, {name: name(t.o), unit: unit(t.t), side: side ? S.side_back : S.side_front, square: sqName(sq, me)})};
      if (mine) { piece.actions = hasMoves ? ['tap', 'flip'] : ['flip']; if (local.sel === sq) piece.selected = true; }
      if (local.peek === sq) piece.opacity = 0.85;
      pieces.push(piece);
    });
    var hint = '', status;
    if (acting && view.phase === 'setup') {
      var home = view.cur === 0 ? [32, 33] : [2, 3];
      if (local.duke === null) {
        home.forEach(function (sq) { targets.push({id: 'lord-' + sq, board: 'board', position: pos(sq), asset: 'pick', hit_area: {x: -45, y: -45, width: 90, height: 90}, aria_label: fill(S.lord_here, {square: sqName(sq, me)})}); });
        hint = S.hint_lord;
      } else {
        pieces.push({id: 'ghost-lord', type: 'troop', board: 'board', position: pos(local.duke), asset: 'duke_0_' + SEAT_KEYS[view.cur], z: 3, opacity: 0.75, actions: [], aria_label: S.your_lord});
        flFootmanSquares(local.duke).filter(function (q) { return !view.board[q]; }).forEach(function (sq) {
          if (local.feet.indexOf(sq) >= 0) pieces.push({id: 'ghost-foot-' + sq, type: 'troop', board: 'board', position: pos(sq), asset: 'footman_0_' + SEAT_KEYS[view.cur], z: 3, opacity: 0.75, actions: [], aria_label: S.your_footman});
          targets.push({id: 'foot-' + sq, board: 'board', position: pos(sq), asset: 'pick', hit_area: {x: -45, y: -45, width: 90, height: 90}, aria_label: fill(S.footman_here, {square: sqName(sq, me)})});
        });
        controls.push({id: 'restart', kind: 'button', label: S.move_lord});
        hint = S.hint_footmen;
      }
    } else if (myTurnPlay) {
      if (local.drawing) {
        legal.filter(function (a) { return a.action === 'place'; }).forEach(function (a) {
          targets.push({id: 'place-' + a.to, board: 'board', position: pos(a.to), asset: 'place', hit_area: {x: -45, y: -45, width: 90, height: 90}, aria_label: fill(S.place_here, {square: sqName(a.to, me)})});
        });
        hint = S.hint_place;
      } else if (local.sel !== null && local.peek === null) {
        var mineActs = legal.filter(function (a) { return a.from === local.sel; });
        if (local.via === null) {
          mineActs.forEach(function (a) {
            if (a.action === 'move') targets.push({id: 'go-' + a.to, board: 'board', position: pos(a.to), asset: view.board[a.to] ? 'take' : 'go',
                                                   hit_area: {x: -45, y: -45, width: 90, height: 90}, aria_label: fill(view.board[a.to] ? S.take_on : S.move_to, {square: sqName(a.to, me)})});
            if (a.action === 'strike') targets.push({id: 'strike-' + a.to, board: 'board', position: pos(a.to), asset: 'strike',
                                                     hit_area: {x: -45, y: -45, width: 90, height: 90}, aria_label: fill(S.strike_at, {square: sqName(a.to, me)})});
          });
          var vias = {};
          mineActs.forEach(function (a) { if (a.action === 'command') vias[a.via] = true; });
          Object.keys(vias).forEach(function (v) {
            var vq = Number(v);
            targets.push({id: 'cmdfrom-' + vq, board: 'board', position: pos(vq), asset: 'cmd', hit_area: {x: -45, y: -45, width: 90, height: 90},
                          aria_label: fill(S.command_from, {unit: unit(view.board[vq].t), square: sqName(vq, me)})});
          });
          hint = mineActs.length ? S.hint_targets : S.hint_none;
        } else {
          mineActs.filter(function (a) { return a.action === 'command' && a.via === local.via; }).forEach(function (a) {
            targets.push({id: 'cmdto-' + a.to, board: 'board', position: pos(a.to), asset: 'cmd', hit_area: {x: -45, y: -45, width: 90, height: 90},
                          aria_label: fill(S.command_to, {square: sqName(a.to, me)})});
          });
          hint = S.hint_command;
        }
        controls.push({id: 'cancel', kind: 'button', label: S.cancel});
      } else if (local.peek !== null) hint = S.hint_peek;
      else hint = S.hint_pick;
      var canDraw = legal.some(function (a) { return a.action === 'place'; });
      // The words are part of the button (a separate label would sit on top
      // of it and swallow the tap).
      if (canDraw) targets.push({id: 'draw', board: 'tray', position: {x: 300, y: 50}, color: local.drawing ? '#fff1c4' : '#e9c46a',
                                 label: fill(S.draw_button, {count: view.bags[view.cur].length}),
                                 hit_area: {x: -110, y: -34, width: 220, height: 68}, aria_label: fill(S.draw_label, {count: view.bags[view.cur].length})});
    }
    // Status.
    if (over) {
      status = view.winner === -1 ? S.draw_result : fill(S.wins, {name: name(view.winner)});
      if (view.winner >= 0) {
        var lost = flDuke(view.board, 1 - view.winner);
        if (lost >= 0) pieces.push({id: 'danger', type: 'mark', board: 'board', position: pos(lost), asset: 'danger', z: 4, actions: [], aria_label: S.reason_trapped});
      }
      hint = view.reason === 'quiet' ? S.reason_quiet : view.reason === 'stuck' ? S.reason_stuck : S.reason_trapped;
    } else if (view.phase === 'setup') status = acting ? fill(S.setup_turn, {name: name(view.cur)}) : fill(S.waiting_setup, {name: name(view.cur)});
    else {
      status = acting ? fill(S.your_turn, {name: name(view.cur)}) : fill(S.waiting, {name: name(view.cur)});
      if (flInDanger(view.board, view.cur)) {
        hint = acting ? S.lord_danger + ' ' + hint : fill(S.lord_danger_other, {name: name(view.cur)});
        var dq = flDuke(view.board, view.cur);
        if (dq >= 0) pieces.push({id: 'danger', type: 'mark', board: 'board', position: pos(dq), asset: 'danger', z: 4, actions: [], aria_label: S.lord_danger});
      }
    }
    labels.push({id: 'status', text: status, x: 14, y: 6, font_size: 22, color: over && view.winner >= 0 ? (view.winner === 0 ? '#f6e3b4' : '#d8b48a') : '#f6efe0'});
    if (hint) labels.push({id: 'hint', text: hint, x: 14, y: 38, font_size: 16, color: /danger|!|⚠/.test(hint) ? '#ff9d8a' : '#ffd98a'});
    // Bags and captures, from the viewer's side.
    [me, 1 - me].forEach(function (seat, i) {
      labels.push({id: 'bag-' + seat, text: fill(S.bag_line, {name: colorName(seat), count: view.bags[seat].length, captured: view.captured[seat].length}),
                   x: 14 + i * 300, y: 72, font_size: 15, color: seat === 0 ? '#f6e3b4' : '#d8b48a'});
    });
    // The selected tile's name and side, so its grid can be read in words.
    var focus = local.peek !== null ? local.peek : local.sel;
    if (focus !== null && view.board[focus]) {
      var ft = view.board[focus], fside = local.peek !== null ? 1 - ft.s : ft.s;
      labels.push({id: 'focus', text: fill(S.focus_line, {unit: unit(ft.t), side: fside ? S.side_back : S.side_front}) + (local.peek !== null ? ' · ' + S.peeking : ''),
                   x: 14, y: 788, font_size: 15, color: '#c9d4e0'});
    }
    var offered = {};
    targets.forEach(function (t) { offered[t.id] = true; });
    pieces.forEach(function (p) {
      if (p.selected && p.actions.length) {
        // "Draw a troop" stays available while a tile is selected.
        var dests = targets.filter(function (t) { return /^(go|strike|cmdfrom|draw)$|^(go|strike|cmdfrom)-/.test(t.id); }).map(function (t) { return t.id; });
        if (dests.some(function (d) { return d !== 'draw'; }) && p.actions.indexOf('move') < 0) { p.actions = p.actions.concat(['move']); p.move_targets = dests; }
      }
    });
    result.scene = {pieces: pieces, targets: targets, labels: labels, controls: controls, paths: paths};
    result.local_state = local;
    return result;
  }
};
