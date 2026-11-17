// Presentation only. legalMoves and optional combinedMoves come from authority.
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
    // The authority separately declares safe multi-die destinations. Older
    // pinned rules omit them and continue to offer their ordinary single moves.
    const legal = active && !s.needRoll ?
      (s.legalMoves || []).concat(s.combinedMoves || []) : [];
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
    const addStack = (seat, from, count, x, y, direction, board = 'main', depth = 146) => {
      const step = Math.min(32, depth / Math.max(4, count - 1));
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
    addStack(0, 'bar', s.bar[0], 336, 30, 1, 'main', 100);
    addStack(1, 'bar', s.bar[1], 336, 410, -1, 'main', 100);
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
        hit_area: move.to === 'off'
          ? {x: -24, y: s.cur === 0 ? -15 : -205, width: 48, height: 220}
          : {x: -24, y: move.to < 12 ? -20 : -200, width: 48, height: 220},
        label: move.to === 'off' ? t('bear_off') : t('point', {n: move.to + 1})});
    }
    if (active && !s.needRoll && !legal.length)
      controls.push({id: 'pass', kind: 'button', label: t('pass')});
    // The ordinary authority removes each used value from both dice and moves.
    // Keep the original physical pair only as presentation memory for this turn.
    const remaining = s.moves || s.dice || [];
    const previousRoll = localState && localState.roll;
    const turn = s.n || 0;
    const isFace = value => Number.isInteger(value) && value >= 1 && value <= 6;
    const validMemory = previousRoll && Array.isArray(previousRoll.values) && previousRoll.values.length === 2 &&
      previousRoll.values.every(value => value === null || isFace(value)) &&
      typeof previousRoll.double === 'boolean' && typeof previousRoll.known === 'boolean' &&
      Number.isInteger(previousRoll.cur) && Number.isInteger(previousRoll.turn);
    const wantedTurn = s.needRoll ? turn - 1 : turn;
    const finished = m.status === 'over' || s.winner !== null;
    const belongsToRoll = candidate => candidate && (finished ? candidate.turn <= turn :
      candidate.turn === wantedTurn && (s.needRoll || candidate.cur === s.cur));
    const observedRoll = (view, moveCount) => {
      const values = view && (view.moves || view.dice);
      if (!view || view.needRoll || !Array.isArray(values) || values.length < 2 || values.length > 4 ||
          !values.every(isFace) || values.length > 2 && !values.every(value => value === values[0])) return null;
      return {cur: view.cur, turn: view.n || 0, values: values.slice(0, 2),
        double: values[0] === values[1], known: true, move_count: moveCount};
    };
    // New matches retain the accepted roll in their public server view. Older
    // pinned rules instead recover original faces from bounded filtered history.
    const last = s.last_roll;
    let recordedRoll = last && Number.isInteger(last.seat) && Number.isInteger(last.turn) &&
      Array.isArray(last.values) && last.values.length === 2 && last.values.every(isFace) &&
      Number.isInteger(last.move_count) && (!Number.isInteger(m.move_count) || last.move_count <= m.move_count)
      ? {cur: last.seat, turn: last.turn, values: last.values.slice(),
        double: last.values[0] === last.values[1], known: true, move_count: last.move_count} : null;
    if (!belongsToRoll(recordedRoll)) recordedRoll = null;
    let historicalRoll = null;
    const history = Array.isArray(m.presentation_history) ? m.presentation_history.slice(-12) : [];
    for (const item of history) {
      if (!item || !Number.isInteger(item.move_count) || item.move_count < 0 ||
          Number.isInteger(m.move_count) && item.move_count > m.move_count) continue;
      const candidate = observedRoll(item.view, item.move_count);
      if (belongsToRoll(candidate) && (!historicalRoll || candidate.turn > historicalRoll.turn ||
          candidate.turn === historicalRoll.turn && candidate.move_count < historicalRoll.move_count))
        historicalRoll = candidate;
    }
    let roll = null;
    if (s.needRoll || finished) {
      // Keep the last known pair until a new accepted roll replaces it. A past
      // turn guard prevents replay from borrowing faces from its own future.
      roll = recordedRoll || historicalRoll ||
        (validMemory && previousRoll.known && (previousRoll.turn < turn || finished && previousRoll.turn === turn) ? previousRoll : null);
    } else {
      roll = recordedRoll || historicalRoll ||
        (validMemory && previousRoll.cur === s.cur && previousRoll.turn === turn ? previousRoll : null) ||
        observedRoll(s, m.move_count);
      if (!roll) {
        // An arbitrary mid-turn replay/remount may have no original roll. Show
        // the known remaining value and a neutral face instead of inventing one.
        roll = {cur: s.cur, turn, values: [remaining[0] || null, null], double: false, known: false};
      }
    }
    const unused = remaining.slice();
    const dice = [];
    for (let i = 0; i < 2; i++) {
      const value = roll && roll.values[i];
      let used = 0;
      if (roll && roll.known) {
        if (roll.double) used = Math.max(0, Math.min(2, 4 - remaining.length - i * 2));
        else {
          const index = unused.indexOf(value);
          if (index < 0) used = 2;
          else unused.splice(index, 1);
        }
      }
      const canRoll = active && s.needRoll;
      const label = s.needRoll ? t(canRoll ? 'die_roll' : 'die_ready', {n: i + 1}) :
        value === null || value === undefined ? t('die_unknown', {n: i + 1}) :
          t(used === 2 ? 'die_used' : used === 1 ? 'die_half_used' : 'die_value', {n: i + 1, value});
      dice.push({id: 'die_' + i, type: 'die', board: 'main',
        position: {x: 336, y: 180 + i * 80}, z: 100,
        asset: 'die_' + (value || 0) + '_used_' + used,
        aria_label: label,
        ...(roll && roll.known ? {animation: {kind: 'roll', key: 'roll:' + roll.cur + ':' + roll.turn}} : {}),
        actions: canRoll ? ['tap'] : []});
    }
    pieces.push(...dice);
    const players = m.players || [];
    const name = seat => players[seat] && players[seat].name || t('player', {n: seat + 1});
    const labels = [
      {id: 'title', text: t('title'), x: 20, y: 14, font_size: 26},
      {id: 'turn', text: s.winner !== null ? t('winner', {name: name(s.winner)}) :
        t(s.needRoll ? 'roll_turn' : 'move_turn', {name: name(s.cur)}), x: 20, y: 50, font_size: 18},
      ...(!s.needRoll ? [{id: 'moves_remaining', text: t('moves_remaining', {count: remaining.length}),
        x: 20, y: 77, font_size: 15}] : []),
      {id: 'off_score', text: t('off_count', {a: s.off[0], b: s.off[1]}), x: 475, y: 57, font_size: 16},
      {id: 'white_label', text: t('white'), x: 20, y: 560, font_size: 16},
      {id: 'black_label', text: t('black'), x: 410, y: 560, font_size: 16},
      {id: 'bar_label', text: t('bar'), x: 342, y: 83, font_size: 14},
      {id: 'off_label', text: t('off'), x: 742, y: 83, font_size: 14}
    ];
    const out = {scene: {pieces, targets, controls, labels}, local_state: {stacks, roll}};
    if (message.type === 'ui_event' && active) {
      const e = message.event;
      if (e.type === 'tap' && s.needRoll && dice.some(die => die.id === e.id))
        out.make_move = {action: 'roll'};
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
