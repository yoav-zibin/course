// Presentation for Sim, Paper Soccer, Hackenbush and Cartographers. The generator
// prefixes KIND, SOURCE_STRINGS and GEO. Every legal line, point or shape placement
// is an explicit target; the reducer only translates a tap back to the offered move.
const gameUI = {
  reduce(message, localState) {
    const m = message.type === 'ui_event' ? message.state_changed : message;
    const s = m.view || m.state;
    const strings = Object.assign({}, SOURCE_STRINGS, m.strings || {});
    const t = (key, args = {}) => (strings[key] || key).replace(/\{(\w+)\}/g, (_, k) => String(args[k] === undefined ? '' : args[k]));
    const active = m.status === 'ongoing' && !m.replay && m.acting_for_player_index !== null && m.acting_for_player_index !== undefined;
    const legal = active ? (s.legal || []) : [];
    const keyOf = move => Object.keys(move).map(k => k + '_' + move[k]).join('_');
    const COLORS = ['#a7f070', '#ff9dca'];
    const pieces = [], targets = [], controls = [], paths = [];
    const labels = [{id: 'title', text: t('title'), x: 24, y: 14, font_size: 24},
      {id: 'turn', text: m.status === 'over' || s.over ? t('finished') : t(KIND === 'hackenbush' ? (s.turn ? 'red_turn' : 'blue_turn') : 'turn', {n: s.turn + 1}), x: 24, y: 46, font_size: 17}];
    if (s.over && s.winner >= 0) labels.push({id: 'winner', text: t('winner', {n: s.winner + 1}), x: 24, y: 70, font_size: 15});
    else if (s.over) labels.push({id: 'winner', text: t('draw'), x: 24, y: 70, font_size: 15});
    const boards = {};
    let local = {};
    // Available moves are small markers tinted with the mover's colour. Their text is only the
    // accessible name; the rules live in the portal's How to play panel, not on the board.
    const tint = (KIND === 'hackenbush' ? ['#4f8cffcc', '#ff5d5dcc'] : [COLORS[0] + 'cc', COLORS[1] + 'cc'])[s.turn] || '#ffe27acc';
    const target = (id, board, position, label, extra = {}) =>
      targets.push(Object.assign({id, board, position, aria_label: label, color: tint, hit_area: {x: -22, y: -22, width: 44, height: 44}}, extra));

    if (KIND === 'sim') {
      const ox = 20, oy = 100, R = 170, cx = 210, cy = 210;
      const pos = Array.from({length: 6}, (_, i) => [cx + R * Math.cos((-90 + 60 * i) * Math.PI / 180), cy + R * Math.sin((-90 + 60 * i) * Math.PI / 180)]);
      const pairs = [];
      for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) pairs.push([a, b]);
      pairs.forEach(([a, b], edge) => {
        const owner = s.edges[edge];
        paths.push({id: 'line_' + edge, points: [{x: ox + pos[a][0], y: oy + pos[a][1]}, {x: ox + pos[b][0], y: oy + pos[b][1]}],
          color: owner === -1 ? '#51607a' : COLORS[owner], width: owner === -1 ? 2 : 7});
      });
      pos.forEach(([x, y], i) => pieces.push({id: 'dot_' + i, type: 'dot', board: 'main', position: {x, y}}));
      // Crossing diagonals share a midpoint, so each marker sits at its own precomputed spot along its line (GEO.sim_t).
      legal.forEach(move => {
        const [a, b] = pairs[move.edge];
        const f = GEO.sim_t[move.edge];
        target(keyOf(move), 'main', {x: pos[a][0] + (pos[b][0] - pos[a][0]) * f, y: pos[a][1] + (pos[b][1] - pos[a][1]) * f},
          t('edge', {a: a + 1, b: b + 1}));
      });
    } else if (KIND === 'dots_boxes') {
      const ox = 20, oy = 100, gap = 90, start = 30;
      const dot = (r, c) => [start + c * gap, start + r * gap];
      const ends = edge => edge < 20 ? [dot(Math.floor(edge / 4), edge % 4), dot(Math.floor(edge / 4), edge % 4 + 1)]
        : [dot(Math.floor((edge - 20) / 5), (edge - 20) % 5), dot(Math.floor((edge - 20) / 5) + 1, (edge - 20) % 5)];
      s.edges.forEach((owner, edge) => {
        const [a, b] = ends(edge);
        paths.push({id: 'line_' + edge, points: [{x: ox + a[0], y: oy + a[1]}, {x: ox + b[0], y: oy + b[1]}],
          color: owner === -1 ? '#3d4d6b' : COLORS[owner], width: owner === -1 ? 3 : 8});
      });
      s.boxes.forEach((owner, box) => {
        if (owner < 0) return;
        const [x, y] = dot(Math.floor(box / 4), box % 4);
        pieces.push({id: 'box_' + box, type: 'box' + owner, board: 'main', position: {x: x + gap / 2, y: y + gap / 2}});
      });
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) { const [x, y] = dot(r, c); pieces.push({id: 'dot_' + (r * 5 + c), type: 'dot', board: 'main', position: {x, y}}); }
      labels.push({id: 'score', text: t('score', {a: s.boxes.filter(v => v === 0).length, b: s.boxes.filter(v => v === 1).length}), x: 300, y: 46, font_size: 17});
      legal.forEach(move => {
        const [a, b] = ends(move.edge);
        target(keyOf(move), 'main', {x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2}, t('side', {n: move.edge + 1}));
      });
    } else if (KIND === 'paper_soccer') {
      const ox = 20, oy = 90, W = 9, H = 11;
      const xy = p => p === 99 ? [4, -1] : p === 100 ? [4, H] : [p % W, Math.floor(p / W)];
      const px = p => ({x: 20 + xy(p)[0] * 48, y: 20 + (xy(p)[1] + 1) * 48});
      const view = p => ({x: ox + px(p).x, y: oy + px(p).y});
      const line = [[0,0],[3,0],[3,-1],[5,-1],[5,0],[8,0],[8,10],[5,10],[5,11],[3,11],[3,10],[0,10],[0,0]];
      paths.push({id: 'pitch', points: line.map(([x, y]) => ({x: ox + 20 + x * 48, y: oy + 20 + (y + 1) * 48})), color: '#e8f0ff', width: 3});
      paths.push({id: 'halfway', points: [{x: ox + 20, y: oy + 20 + 6 * 48}, {x: ox + 20 + 8 * 48, y: oy + 20 + 6 * 48}], color: '#41557a', width: 1});
      let run = [s.trail[0]], runMover = s.mover[0];
      const flush = () => { if (run.length > 1) paths.push({id: 'trail_' + paths.length, points: run.map(view), color: COLORS[runMover], width: 4}); };
      s.mover.forEach((who, i) => {
        if (who !== runMover) { flush(); run = [s.trail[i]]; runMover = who; }
        run.push(s.trail[i + 1]);
      });
      flush();
      pieces.push({id: 'ball', type: 'ball', board: 'pitch', position: {cell: String(s.ball)}, text: '⚽'});
      legal.forEach(move => target(keyOf(move), 'pitch', {cell: String(move.to)}, t('point', {n: move.to + 1})));
    } else if (KIND === 'hackenbush') {
      const oy = 90;
      paths.push({id: 'ground', points: [{x: 10, y: oy + GEO.ground_y + 8}, {x: 550, y: oy + GEO.ground_y + 8}], color: '#7d5a3a', width: 10});
      GEO.hack_edges.forEach(([a, b, colour], edge) => {
        if (!s.alive[edge]) return;
        paths.push({id: 'branch_' + edge, points: [{x: GEO.hack_nodes[a][0], y: oy + GEO.hack_nodes[a][1]}, {x: GEO.hack_nodes[b][0], y: oy + GEO.hack_nodes[b][1]}],
          color: colour ? '#ff5d5d' : '#4f8cff', width: 9});
      });
      GEO.hack_nodes.forEach(([x, y], i) => { if (y >= GEO.ground_y) pieces.push({id: 'root_' + i, type: 'knot', board: 'main', position: {x, y}}); });
      legal.forEach(move => {
        const [a, b] = GEO.hack_edges[move.edge];
        target(keyOf(move), 'main', {x: (GEO.hack_nodes[a][0] + GEO.hack_nodes[b][0]) / 2, y: (GEO.hack_nodes[a][1] + GEO.hack_nodes[b][1]) / 2 - 0},
          t('cut', {n: move.edge + 1}));
      });
    } else {
      const seat = Number.isInteger(m.my_player_index) ? m.my_player_index : 0, other = 1 - seat;
      const terrains = ['forest', 'village', 'farm', 'water'], types = ['t_forest', 't_village', 't_farm', 't_water'];
      s.maps[seat].forEach((v, i) => { if (v >= 0) pieces.push({id: 'mine_' + i, type: v === 4 ? 't_mountain' : types[v], board: 'mine', position: {cell: String(i)}}); });
      s.maps[other].forEach((v, i) => { if (v >= 0) pieces.push({id: 'theirs_' + i, type: v === 4 ? 's_mountain' : 's' + types[v].slice(1), board: 'theirs', position: {cell: String(i)}}); });
      const card = s.deck[Math.min(s.round, s.deck.length - 1)];
      const variantOf = (shape, rot) => {
        let cells = shape.map(([r, c]) => [r, c]);
        for (let i = 0; i < rot % 4; i++) cells = cells.map(([r, c]) => [c, -r]);
        if (rot >= 4) cells = cells.map(([r, c]) => [r, -c]);
        const minR = Math.min(...cells.map(c => c[0])), minC = Math.min(...cells.map(c => c[1]));
        return cells.map(([r, c]) => [r - minR, c - minC]);
      };
      const rots = [...new Set(legal.map(move => move.rot))].sort((a, b) => a - b);
      const valid = localState && localState.move_count === m.move_count && localState.viewer === seat && rots.includes(localState.rot);
      let rot = valid ? localState.rot : (rots[0] || 0);
      const event = message.type === 'ui_event' ? message.event : null;
      if (active && event && event.type === 'tap' && event.id === 'rotate' && rots.length) rot = rots[(rots.indexOf(rot) + 1) % rots.length];
      labels.push({id: 'card', text: t('card', {n: Math.min(s.round + 1, s.deck.length), total: s.deck.length, terrain: t(terrains[card[0]])}), x: 24, y: 112, font_size: 15});
      labels.push({id: 'score', text: t('score', {a: s.scores[0], b: s.scores[1]}), x: 24, y: 134, font_size: 15});
      labels.push({id: 'theirs_label', text: t('opponent_map'), x: 36, y: 466, font_size: 13});
      if (!s.over) variantOf(GEO.shapes[card[1]], rot).forEach(([r, c], i) => pieces.push({id: 'card_' + i, type: 'c' + types[card[0]].slice(1), board: 'card', position: {x: 20 + c * 24, y: 20 + r * 24}}));
      const pass = legal.find(move => move.cell === -1);
      if (pass) controls.push({id: keyOf(pass), kind: 'button', label: t('pass')});
      else if (legal.length) {
        if (rots.length > 1) controls.push({id: 'rotate', kind: 'button', label: t('rotate')});
        legal.filter(move => move.rot === rot).forEach(move => {
          const r = Math.floor(move.cell / 7), c = move.cell % 7;
          target(keyOf(move), 'mine', {cell: String(move.cell)}, t('place_at', {row: r + 1, col: c + 1}), {
            hit_area: {x: -22, y: -22, width: 44, height: 44},
            preview: variantOf(GEO.shapes[card[1]], rot).map(([dr, dc]) => ({position: {cell: String((r + dr) * 7 + c + dc)}, color: GEO.colors[card[0]]}))});
        });
      }
      local = {move_count: m.move_count, viewer: seat, rot};
    }
    // Placed pieces, dots and the ball are passive; targets and buttons carry the interaction.
    for (const piece of pieces) if (!piece.actions) piece.actions = [];
    const out = {scene: {pieces, targets, controls, labels, paths}, local_state: local};
    if (message.type === 'ui_event' && active && ['tap', 'drop'].includes(message.event.type)) {
      const e = message.event, id = e.type === 'drop' ? e.target_id : e.id;
      const move = legal.find(option => keyOf(option) === id);
      if (move) out.make_move = move;
    }
    return out;
  }
};
