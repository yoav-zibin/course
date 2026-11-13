// Presentation only. legalMoves comes from the ordinary authoritative game.
// Native hosts select a movable checker, then emit drop(piece_id,target_id).
const gameUI = {
  reduce(message, localState) {
    const m = message.type === 'ui_event' ? message.state_changed : message;
    const s = m.view || m.state;
    const strings = Object.assign({}, SOURCE_STRINGS, m.strings || {});
    const t = (key, args = {}) => (strings[key] || key).replace(/\{(\w+)\}/g,
      (_, key) => String(args[key] === undefined ? '' : args[key]));
    const active = m.status === 'ongoing' && !m.replay && s.winner === null &&
      m.acting_for_player_index === s.cur;
    const legal = active && !s.needRoll ? s.legalMoves || [] : [];
    const pieces = [], targets = [], controls = [], sources = {};
    // Identity is a presentation concern. Reconcile counts against the previous
    // scene so a moved, captured or borne-off checker keeps its ID for animation.
    // This never determines a move or edits the authoritative game state.
    const locations = Array.from({length: 24}, (_, i) => String(i)).concat(['bar', 'off']);
    const stacks = [{}, {}];
    for (let seat = 0; seat < 2; seat++) {
      const previous = localState && localState.stacks && localState.stacks[seat] || {};
      const used = new Set(), displaced = [];
      const desired = at => at === 'bar' ? s.bar[seat] : at === 'off' ? s.off[seat] :
        s.owner[Number(at)] === seat ? s.cnt[Number(at)] : 0;
      for (const at of locations) {
        const ids = Array.isArray(previous[at]) ? previous[at].filter(id => {
          const valid = typeof id === 'string' && new RegExp('^checker_' + seat + '_([0-9]|1[0-4])$').test(id) && !used.has(id);
          if (valid) used.add(id);
          return valid;
        }) : [];
        stacks[seat][at] = ids.slice(0, desired(at));
        displaced.push(...ids.slice(desired(at)).reverse());
      }
      for (let i = 0; i < 15; i++) {
        const id = 'checker_' + seat + '_' + i;
        if (!used.has(id)) displaced.push(id);
      }
      for (const at of locations) while (stacks[seat][at].length < desired(at))
        stacks[seat][at].push(displaced.shift());
    }
    const pointX = n => {
      const col = n < 12 ? 11 - n : n - 12;
      return 36 + col * 52 + (col >= 6 ? 28 : 0);
    };
    const destinationId = to => 'to_' + to;
    const legalFrom = from => legal.filter(move => move.from === from);
    const uniqueTargets = options => [...new Set(options.map(move => destinationId(move.to)))];
    const addStack = (seat, from, count, x, y, direction, board = 'main') => {
      const step = Math.min(32, 146 / Math.max(4, count - 1));
      for (let i = 0; i < count; i++) {
        const id = stacks[seat][String(from)][i];
        const available = seat === s.cur && i === count - 1 ? legalFrom(from) : [];
        const destinations = uniqueTargets(available);
        pieces.push({id, type: 'p' + seat, board,
          position: {x, y: y + direction * i * step}, z: i,
          text: count > 5 && i === count - 1 ? String(count) : '',
          actions: destinations.length ? ['move'] : [],
          ...(destinations.length ? {draggable: true, move_targets: destinations} : {})});
        if (destinations.length) sources[id] = from;
      }
    };
    for (let point = 0; point < 24; point++) {
      if (s.cnt[point] > 0) addStack(s.owner[point], point, s.cnt[point],
        pointX(point), point < 12 ? 410 : 30, point < 12 ? -1 : 1);
    }
    // Every checker remains represented, including captured and borne-off ones.
    addStack(0, 'bar', s.bar[0], 336, 35, 1);
    addStack(1, 'bar', s.bar[1], 336, 405, -1);
    addStack(0, 'off', s.off[0], 24, 405, -1, 'off');
    addStack(1, 'off', s.off[1], 24, 35, 1, 'off');
    const seen = {};
    for (const move of legal) {
      const id = destinationId(move.to);
      if (seen[id]) continue;
      seen[id] = true;
      targets.push({id, board: move.to === 'off' ? 'off' : 'main',
        position: move.to === 'off' ? {x: 24, y: s.cur === 0 ? 235 : 205} :
          {x: pointX(move.to), y: move.to < 12 ? 237 : 203},
        label: move.to === 'off' ? t('bear_off') : t('point', {n: move.to + 1})});
    }
    if (active) {
      if (s.needRoll) controls.push({id: 'roll', kind: 'button', label: t('roll')});
      else if (!legal.length) controls.push({id: 'pass', kind: 'button', label: t('pass')});
    }
    for (let i = 0; i < s.dice.length; i++) pieces.push({id: 'die_' + i, type: 'die',
      board: 'main', position: {x: 248 + i * 54, y: 220},
      text: String(s.dice[i]), actions: []});
    const players = m.players || [];
    const name = seat => players[seat] && players[seat].name || t('player', {n: seat + 1});
    const labels = [
      {id: 'title', text: t('title'), x: 20, y: 14, font_size: 26},
      {id: 'turn', text: s.winner !== null ? t('winner', {name: name(s.winner)}) :
        t(s.needRoll ? 'roll_turn' : 'move_turn', {name: name(s.cur)}), x: 20, y: 50, font_size: 18},
      {id: 'off_score', text: t('off_count', {a: s.off[0], b: s.off[1]}), x: 475, y: 57, font_size: 16},
      {id: 'white_label', text: t('white'), x: 20, y: 560, font_size: 16},
      {id: 'black_label', text: t('black'), x: 410, y: 560, font_size: 16},
      {id: 'bar_label', text: t('bar'), x: 342, y: 83, font_size: 14},
      {id: 'off_label', text: t('off'), x: 742, y: 83, font_size: 14}
    ];
    const out = {scene: {pieces, targets, controls, labels}, local_state: {stacks}};
    if (message.type === 'ui_event' && active) {
      const e = message.event;
      if (e.type === 'tap' && controls.some(control => control.id === e.id))
        out.make_move = {action: e.id};
      if (e.type === 'drop' && Object.prototype.hasOwnProperty.call(sources, e.piece_id || e.id)) {
        const from = sources[e.piece_id || e.id];
        const option = legal.find(move => move.from === from && destinationId(move.to) === e.target_id);
        if (option) out.make_move = {action: 'move', from: option.from, to: option.to};
      }
    }
    return out;
  }
};
