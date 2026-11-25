// Presentation only. legalMoves and optional combinedMoves come from authority.
// Native hosts select a movable checker, then emit drop(piece_id,target_id).
const checkerLocations = Array.from({length:24}, (_, i) => String(i)).concat(['bar', 'off']);
const checkerCount = (view, seat, at) => at === 'bar' ? view.bar[seat] : at === 'off' ? view.off[seat] :
  view.owner[Number(at)] === seat ? view.cnt[Number(at)] : 0;
const checkerPoint = (seat, at, index, count) => {
  if (at === 'off') return {board:'off', position:{x:32,y:(seat === 0 ? 404 : 36) + (seat === 0 ? -10 : 10) * index}};
  const bar = at === 'bar', n = Number(at), col = n < 12 ? 11 - n : n - 12;
  const lower = bar ? seat === 1 : n < 12;
  return {board:'main', position:{x:bar ? 336 : 36 + col * 52 + (col >= 6 ? 28 : 0),
    y:(lower ? 410 : 30) + (lower ? -1 : 1) * index * Math.min(42, (bar ? 46.3 : 126.6) / Math.max(1, count - 1))}};
};
const sameCheckerPoint = (a, b) => a.board === b.board &&
  Math.abs(a.position.x - b.position.x) < .001 && Math.abs(a.position.y - b.position.y) < .001;
const copyCheckerStacks = stacks => stacks.map(seat => Object.fromEntries(checkerLocations.map(at => [at, seat[at].slice()])));
const checkerHits = last => {
  const board = JSON.parse(JSON.stringify(last.before));
  return last.steps.map(step => {
    const hit = step.to !== 'off' && board.owner[step.to] === 1 - last.seat && board.cnt[step.to] === 1;
    if (step.from === 'bar') board.bar[last.seat]--;
    else if (--board.cnt[step.from] === 0) board.owner[step.from] = -1;
    if (step.to === 'off') board.off[last.seat]++;
    else {
      if (hit) {board.bar[1-last.seat]++; board.cnt[step.to] = 0;}
      board.owner[step.to] = last.seat; board.cnt[step.to]++;
    }
    return hit;
  });
};
const gameUI = {
  reduce(message, localState) {
    const m = message.type === 'ui_event' ? message.state_changed : message;
    const s = m.view || m.state;
    // A narrowly reviewed repair can also be used by an immutable saved game.
    // Its old locale table does not contain these new opening instructions.
    const strings = Object.assign({}, SOURCE_STRINGS, OPENING_STRINGS[m.locale] || {}, m.strings || {});
    const t = (key, args = {}) => (strings[key] || key).replace(/\{(\w+)\}/g,
      (_, key) => String(args[key] === undefined ? '' : args[key]));
    const active = m.status === 'ongoing' && !m.replay && s.winner === null &&
      m.acting_for_player_index === s.cur;
    // The authority separately declares safe multi-die destinations. Older
    // pinned rules omit them and continue to offer their ordinary single moves.
    const awaitingNext = s.round_winner !== null && s.round_winner !== undefined;
    const setup = s.configured === false;
    const doubling = s.cube && s.cube.offer !== null;
    const legal = active && !s.needRoll && !doubling && !awaitingNext && !setup ?
      (s.legalMoves || []).concat(s.combinedMoves || []) : [];
    const pieces = [], targets = [], controls = [], sources = {};
    const notices = localState && localState.notice_count === m.move_count ?
      (localState.notices || []).slice() : [];
    if (localState && localState.notice_count !== m.move_count) {
      if (localState.opening === true && s.opening === false && Array.isArray(s.opening_roll) &&
          s.opening_roll.every(value => Number.isInteger(value)))
        notices.push({id:'opening_notice',text:'opening_winner',seat:s.cur,duration:2000,delay:1000});
      if (s.opening && Array.isArray(s.opening_roll) && s.opening_roll.every(value => Number.isInteger(value)) &&
          s.opening_roll[0] === s.opening_roll[1] && Array.isArray(localState.opening_faces) &&
          localState.opening_faces.some(value => value === null))
        notices.push({id:'tie_notice',text:'opening_tie',seat:s.cur,duration:500,delay:1000});
      if (!s.opening && s.needRoll && s.last_roll && s.last_roll.move_count === m.move_count && s.last_roll.seat !== s.cur)
        notices.push({id:'no_moves_notice',text:'no_moves',seat:s.last_roll.seat,duration:2000,delay:1000});
    }
    const motionEvents = localState && localState.motion_move_count === m.move_count ?
      Object.assign({}, localState.motion_events || {}) : {};
    const event = message.type === 'ui_event' ? message.event : null;
    let help = !!(localState && localState.help);
    const options = Object.assign({swapped: false, difficulty: s.difficulty === undefined ? 1 : s.difficulty,
      goal: s.goal || 5, cube_enabled: s.cube_enabled !== false}, localState && localState.options || {});
    let hint = localState && localState.hint && localState.hint.move_count === m.move_count ? localState.hint : null;
    if (event && event.type === 'tap' && active) {
      if (event.id === 'swap_colors') options.swapped = !options.swapped;
      if (setup && /^goal_(1|3|5|7|11|15)$/.test(event.id)) options.goal = Number(event.id.slice(5));
      if (setup && /^difficulty_[0-3]$/.test(event.id)) options.difficulty = Number(event.id.slice(11));
      if (setup && (event.id === 'cube_on' || event.id === 'cube_off')) options.cube_enabled = event.id === 'cube_on';
      if (event.id === 'help' || event.id === 'close_help') help = !help;
      if (event.id === 'hint' && legal.length) {
        const index = hint ? (hint.index + 1) % legal.length : 0;
        hint = {index, from: legal[index].from, to: legal[index].to, move_count: m.move_count};
      }
    }
    // Identity is a presentation concern. Reconcile counts against the previous
    // scene so a moved, captured or borne-off checker keeps its ID for animation.
    // This never determines a move or edits the authoritative game state.
    const locations = Array.from({length: 24}, (_, i) => String(i)).concat(['bar', 'off']);
    let stacks = [{}, {}];
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
    // An adjacent accepted command names its exact route. Move those IDs in
    // that order, including captured blots, instead of pairing count changes.
    const lastMove = s.last_move;
    if (lastMove && lastMove.before && lastMove.steps.length && localState && localState.stacks &&
        localState.move_count === lastMove.move_count - 1 && checkerLocations.every(at => [0,1].every(seat =>
          (localState.stacks[seat][at] || []).length === checkerCount(lastMove.before, seat, at)))) {
      stacks = copyCheckerStacks(localState.stacks);
      const hits = checkerHits(lastMove), seat = lastMove.seat;
      lastMove.steps.forEach((step, i) => {
        const id = stacks[seat][step.from].pop();
        if (hits[i]) stacks[1-seat].bar.push(stacks[1-seat][step.to].pop());
        stacks[seat][step.to].push(id);
      });
    }
    const pointX = n => {
      const col = n < 12 ? 11 - n : n - 12;
      return 36 + col * 52 + (col >= 6 ? 28 : 0);
    };
    const destinationId = to => 'to_' + to;
    const legalFrom = from => legal.filter(move => move.from === from);
    const uniqueTargets = options => [...new Set(options.map(move => destinationId(move.to)))];
    const addStack = (seat, from, count, x, y, direction, board = 'main', depth = 126.6) => {
      const step = board === 'off' ? 10 : Math.min(42, depth / Math.max(1, count - 1));
      for (let i = 0; i < count; i++) {
        const id = stacks[seat][String(from)][i];
        const available = seat === s.cur && i === count - 1 ? legalFrom(from) : [];
        const destinations = uniqueTargets(available);
        const previous = localState && localState.stacks && localState.stacks[seat];
        const isNew = previous && !(previous[String(from)] || []).includes(id);
        const priorCount = previous && (previous[String(from)] || []).length;
        const priorStep = board === 'off' ? 10 : Math.min(42, depth / Math.max(1, priorCount - 1));
        if (!isNew && priorCount !== count && Math.abs(i * (step - priorStep)) > .001)
          motionEvents[id] = {kind: 'move', key: 'stack:' + id + ':' + m.move_count,
            duration_ms: 400, delay_ms: 400};
        const specialMove = isNew && (from === 'bar' || from === 'off');
        if (specialMove) motionEvents[id] = {kind: 'move', key: 'move:' + id + ':' + m.move_count,
          duration_ms: 400, delay_ms: from === 'bar' ? 400 : 0};
        pieces.push({id, type: 'p' + seat + (board === 'off' ? '_off' : ''), board,
          position: {x, y: y + direction * i * step}, z: i,
          asset: (board === 'off' ? 'off_' : 'checker_') + ((seat === 0) !== options.swapped ? 'red' : 'ivory'),
          text: board !== 'off' && count > 5 && i === count - 1 ? String(count) : '',
          aria_label: t('player', {n: seat + 1}) + ': ' + (from === 'bar' ? t('bar') : from === 'off' ? t('off') : t('point', {n: Number(from) + 1})),
          ...(hint && hint.from === from && seat === s.cur && i === count - 1 ? {selected: true} : {}),
          ...(motionEvents[id] ? {animation: motionEvents[id]} : {}),
          actions: destinations.length ? ['move'] : [],
          ...(destinations.length ? {move_targets: destinations} : {})});
        if (destinations.length) sources[id] = from;
      }
    };
    for (let point = 0; point < 24; point++) {
      if (s.cnt[point] > 0) addStack(s.owner[point], point, s.cnt[point],
        pointX(point), point < 12 ? 410 : 30, point < 12 ? -1 : 1);
    }
    // Every checker remains represented, including captured and borne-off ones.
    addStack(0, 'bar', s.bar[0], 336, 30, 1, 'main', 46.3);
    addStack(1, 'bar', s.bar[1], 336, 410, -1, 'main', 46.3);
    addStack(0, 'off', s.off[0], 32, 404, -1, 'off');
    addStack(1, 'off', s.off[1], 32, 36, 1, 'off');
    const seen = {};
    for (const move of legal) {
      const id = destinationId(move.to);
      if (seen[id]) continue;
      seen[id] = true;
      targets.push({id, board: move.to === 'off' ? 'off' : 'main',
        ...(move.to === 'off' ? {} : {asset: move.to < 12 ? 'target_lower' : 'target_upper'}),
        position: move.to === 'off' ? {x: 32, y: s.cur === 0 ? 265 : 175} :
          {x: pointX(move.to), y: move.to < 12 ? 237 : 203},
        hit_area: move.to === 'off'
          ? {x: -32, y: s.cur === 0 ? -15 : -175, width: 64, height: 190}
          : {x: -24, y: move.to < 12 ? -20 : -200, width: 48, height: 220},
        label: move.to === 'off' ? t('bear_off') : t('point', {n: move.to + 1})});
    }
    if (active && !s.needRoll && !legal.length && !doubling && !awaitingNext && !setup)
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
    const finished = m.status === 'over' || s.winner !== null || awaitingNext;
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
    // Opening dice belong to different players. Their faces remain neutral
    // until authority accepts a roll; presentation never supplies random values.
    const opening = !!s.opening;
    const openingFaces = Array.isArray(s.opening_roll) ? s.opening_roll : null;
    const openingEvents = Object.assign({}, localState && localState.opening_events || {});
    const previousOpening = localState && localState.opening_faces;
    const openingPair = opening || openingFaces && roll && roll.turn === 0 &&
      openingFaces.every(isFace) && roll.values.every((value, index) => value === openingFaces[index]);
    if (openingPair && openingFaces) for (let i = 0; i < 2; i++) {
      if (isFace(openingFaces[i]) && (!previousOpening || previousOpening[i] !== openingFaces[i] ||
          previousOpening.every(isFace) && !isFace(openingFaces[1 - i])))
        openingEvents[i] = 'opening:' + i + ':' + m.move_count;
    }
    const unused = remaining.slice();
    const dice = [];
    const isDouble = !opening && roll && roll.known && roll.double;
    const dieCount = isDouble ? 4 : 2;
    for (let i = 0; i < dieCount; i++) {
      const value = opening ? openingFaces && openingFaces[i] : roll && roll.values[isDouble ? 0 : i];
      let used = 0;
      if (!opening && roll && roll.known) {
        if (isDouble) used = i < 4 - remaining.length ? 2 : 0;
        else {
          const index = unused.indexOf(value);
          if (index < 0) used = 2;
          else unused.splice(index, 1);
        }
      }
      const canRoll = active && s.needRoll && !doubling && !awaitingNext && !setup &&
        (!opening || i === s.cur && (!openingFaces || !isFace(openingFaces[i]) || openingFaces.every(isFace)));
      const label = opening && isFace(value) && !canRoll ? t('die_value', {n: i + 1, value}) :
        s.needRoll ? t(canRoll ? opening ? 'opening_die_roll' : 'die_roll' : 'die_ready', {n: i + 1}) :
        value === null || value === undefined ? t('die_unknown', {n: i + 1}) :
          t(used === 2 ? 'die_used' : 'die_value', {n: i + 1, value});
      const rollKey = openingPair ? (value ? openingEvents[i] || 'opening:' + i + ':' + m.move_count : null) :
        roll && roll.known ? 'roll:' + roll.cur + ':' + roll.turn : null;
      dice.push({id: 'die_' + i, type: 'die', board: 'main',
        position: {x: isDouble ? 420 + i * 62 : 452 + i * 78, y: 220}, z: 100,
        die_value: value || 0, opacity: used === 2 ? 0.5 : 1,
        aria_label: label,
        ...(rollKey ? {animation: {kind: 'roll', key: rollKey}} : {}),
        actions: canRoll ? ['tap'] : []});
    }
    pieces.push(...dice);
    const ordinaryDiceRoll = !opening && dice.some(die => die.actions.includes('tap'));
    const button = (id, label, x, y, wide = false) => pieces.push({
      id, type: wide ? 'roll_button' : 'tool_button', board: 'main',
      position: {x, y}, text: label, aria_label: label, z: 200, actions: ['tap']});
    if (active) {
      button('help', t('help'), 622, -80);
      if (legal.length) button('hint', t('hint'), 536, -80);
      if (s.can_undo && !setup) button('undo', t('undo'), 450, -80);
      if (awaitingNext) button('next', t('next_game'), 165, 220, true);
      if (s.needRoll && !doubling && !awaitingNext && !setup && !ordinaryDiceRoll) button('roll', t(opening ? 'opening_roll' : 'roll'), 165, 220, true);
      if (s.can_double && !setup) button('double', t('double'), 165, 278);
      if (doubling) {
        button('take', t('take'), 160, 220, true);
        button('drop', t('drop'), 160, 282);
      }
    }
    const players = m.players || [];
    const name = seat => String(players[seat] && players[seat].name || t('player', {n: seat + 1}));
    const pip = seat => s.bar[seat] * 25 + s.cnt.reduce((sum, count, point) =>
      sum + (s.owner[point] === seat ? count * (seat === 0 ? point + 1 : 24 - point) : 0), 0);
    const tiedOpening = opening && openingFaces && openingFaces.every(isFace) && openingFaces[0] === openingFaces[1];
    const previousTie = opening && s.last_roll && Array.isArray(s.last_roll.values) &&
      s.last_roll.values.length === 2 && s.last_roll.values.every(isFace) &&
      s.last_roll.values[0] === s.last_roll.values[1];
    const labels = [
      {id: 'title', text: t('title').replace(' (Declarative)', ''), x: 20, y: 26, font_size: 25, color: '#fff3cf'},
      ...(!ordinaryDiceRoll ? [{id: 'turn', text: s.winner !== null ? t('winner', {name: name(s.winner)}) :
        opening && !setup ? t('opening_rule') :
        t(awaitingNext ? 'winner' : doubling ? 'double_offer' : tiedOpening ? 'opening_tie' : opening ? 'opening_turn' : s.needRoll ? 'roll_turn' : 'move_turn', {name: name(awaitingNext ? s.round_winner : s.cur)}),
        x: 20, y: 58, font_size: 15, color: '#fff3cf'}] : []),
      ...(!s.needRoll && !awaitingNext ? [{id: 'moves_remaining', text: t('moves_remaining', {count: remaining.length}),
        x: 20, y: 577, font_size: 14, color: '#fff3cf'}] : []),
      {id: 'bar_label', text: t('bar'), x: 344, y: 92, font_size: 11, color: '#ecd09e'},
      {id: 'off_label', text: t('off'), x: 738, y: 94, font_size: 12, color: '#ecd09e'}
    ];
    if (opening && !setup && !help) labels.push({id:'opening_status',
      text:previousTie ? t('opening_tied_roll', {
        a:s.last_roll.values[0],b:s.last_roll.values[1]}) : t('opening_goal'),
      x:20,y:80,font_size:16,color:'#fff3cf'});
    for (let seat = 0; seat < 2; seat++) {
      const y = seat === 0 ? 465 : -27;
      pieces.push({id: 'status_' + seat, type: 'status', board: 'main', position: {x: 456, y},
        asset: s.cur === seat && s.winner === null ? 'status_active' : 'status', actions: [], z: 110});
      pieces.push({id: 'swatch_' + seat, type: (seat === 0) !== options.swapped ? 'swatch_red' : 'swatch_ivory',
        board: 'main', position: {x: 350, y: y - 2}, actions: [], z: 111});
      labels.push({id: 'name_' + seat, text: name(seat).slice(0, 23), x: 391, y: 105 + y - 4,
        font_size: 17, color: '#ffffff'});
      labels.push({id: 'pip_' + seat, text: t('pip', {count: pip(seat)}), x: 391, y: 105 + y + 15,
        font_size: 13, color: '#e5dfd0'});
      labels.push({id: 'off_' + seat, text: t('borne_off', {count: s.off[seat]}), x: 475, y: 105 + y + 15,
        font_size: 12, color: '#e5dfd0'});
      if (Array.isArray(s.scores)) labels.push({id: 'score_' + seat, text: t('score', {score: s.scores[seat], goal: s.goal}),
        x: 555, y: 105 + y + 15, font_size: 12, color: '#ffe082'});
    }
    if (s.cube && s.cube_enabled !== false) pieces.push({id: 'cube', type: 'cube', board: 'off', position: {x: 32, y: 220},
      text: String(s.cube.value === 1 ? 64 : s.cube.value), aria_label: t('double') + ': ' + s.cube.value,
      actions: active && s.can_double ? ['tap'] : [], z: 120});
    if (hint) labels.push({id: 'hint_move', text: t('hint_move', {
      from: hint.from === 'bar' ? t('bar') : String(hint.from + 1),
      to: hint.to === 'off' ? t('off') : String(hint.to + 1)}), x: 20, y: 598, font_size: 13, color: '#9fff73'});
    if (active && !s.needRoll && !legal.length && !doubling && !awaitingNext && !setup)
      labels.push({id: 'no_moves', text: t('no_moves'), x: 65, y: 337, font_size: 20, color: '#fff3cf'});
    if (help) {
      // A visible dialog must own interaction, including keyboard interaction.
      targets.length = 0;
      controls.length = 0;
      labels.length = 0;
      for (const piece of pieces) { piece.actions = []; delete piece.move_targets; }
      pieces.push({id: 'help_panel', type: 'help_panel', board: 'main', position: {x: 360, y: 220}, actions: [], z: 1000});
      labels.push({id: 'help_title', text: t('help_title'), x: 102, y: 204, font_size: 24, color: '#fff3cf'});
      ['help_select', 'help_dice', 'help_hit', 'help_bar', 'help_home'].forEach((key, i) =>
        labels.push({id: key, text: t(key), x: 102, y: 246 + i * 28, font_size: 14, color: '#ffffff'}));
      labels.push({id: 'help_red', text: t('home_lower', {color: t(options.swapped ? 'ivory_piece' : 'red_piece')}), x: 102, y: 409, font_size: 13, color: '#ff8c78'});
      labels.push({id: 'help_ivory', text: t('home_upper', {color: t(options.swapped ? 'red_piece' : 'ivory_piece')}), x: 102, y: 431, font_size: 13, color: '#ffffff'});
      pieces.push({id: 'close_help', type: 'tool_button', board: 'main', position: {x: 590, y: 85},
        text: t('close'), aria_label: t('close'), actions: active ? ['tap'] : [], z: 1001});
    }
    if (setup) {
      targets.length = 0; controls.length = 0; labels.length = 0;
      for (const piece of pieces) { piece.actions = []; delete piece.move_targets; }
      pieces.push({id: 'options_panel', type: 'options_panel', board: 'main', position: {x: 380, y: 220}, actions: [], z: 1200});
      labels.push({id: 'options_title', text: t('options'), x: 100, y: 125, font_size: 27, color: '#fff3cf'});
      labels.push({id: 'pieces_label', text: t('pieces'), x: 100, y: 158, font_size: 17, color: '#ffffff'});
      for (let seat = 0; seat < 2; seat++) pieces.push({id: 'option_checker_' + seat,
        type: (seat === 0) !== options.swapped ? 'swatch_red' : 'swatch_ivory', board: 'main',
        position: {x: 120 + seat * 200, y: 103}, scale: 1.6, actions: [], z: 1201});
      if (active) {
        button('swap_colors', '⇄', 220, 103);
        pieces[pieces.length - 1].aria_label = t('swap_colors');
      }
      labels.push({id: 'option_player_0', text: name(0).slice(0,18), x: 112, y: 247, font_size: 14, color: '#ffffff'});
      labels.push({id: 'option_player_1', text: name(1).slice(0,18), x: 312, y: 247, font_size: 14, color: '#ffffff'});
      labels.push({id: 'goal_label', text: t('play_to'), x: 100, y: 285, font_size: 17, color: '#ffffff'});
      [1,3,5,7,11,15].forEach((goal,i) => pieces.push({id:'goal_' + goal,type:'option_button',board:'main',
        position:{x:120+i*85,y:233},text:String(goal),aria_label:t('play_to') + ': ' + goal,
        selected: options.goal === goal, actions:active ? ['tap'] : [],z:1201}));
      labels.push({id:'cube_label',text:t('doubling_cube'),x:100,y:360,font_size:17,color:'#ffffff'});
      ['off','on'].forEach((state,i) => pieces.push({id:'cube_' + state,type:'option_toggle',board:'main',
        position:{x:120+i*100,y:303},text:t(state === 'on' ? 'on' : 'disabled'),
        selected:options.cube_enabled === (state === 'on'),actions:active ? ['tap'] : [],z:1201}));
      const hasComputer = players.some(player => player.kind === 'computer');
      if (hasComputer) {
        labels.push({id:'difficulty_label',text:t('difficulty'),x:100,y:435,font_size:17,color:'#ffffff'});
        ['easy','medium','hard','expert'].forEach((level,i) => pieces.push({id:'difficulty_' + i,type:'option_level',board:'main',
          position:{x:120+i*100,y:383},text:t(level),selected:options.difficulty===i,actions:active ? ['tap'] : [],z:1201}));
      }
      if (active) {
        button('start_game', t('start_game'), 380, hasComputer ? 445 : 405, true);
        for (const piece of pieces) if (['swap_colors','start_game'].includes(piece.id)) piece.z = 1201;
      }
    }
    if (!setup && !help) for (const notice of notices) pieces.push({id:notice.id,type:'notice',board:'main',
      position:{x:336,y:220},text:t(notice.text,{name:name(notice.seat)}),actions:[],z:1300,
      animation:{kind:'notice',key:notice.id+':'+m.move_count,duration_ms:notice.duration,delay_ms:notice.delay}});
    const out = {scene: {pieces, targets, controls, labels}, local_state: {stacks, move_count:m.move_count, roll, help, hint, options, motion_events: motionEvents, motion_move_count: m.move_count,
      opening_events: openingEvents, opening_faces: openingFaces, opening: !!s.opening, notices, notice_count:m.move_count}};
    if (!setup && !help) {
      // Keep moving and captured checkers above board artwork using the
      // existing piece-order contract, which older installed hosts accept.
      // Local dialogs rebuild ordinary stacks so checkers never cover their
      // panels while help or setup owns the interaction.
      const moving = new Set((gameUI.getLastMoveAnimations(s, out.scene) || []).map(entry => entry.piece_id));
      for (const piece of pieces) if (moving.has(piece.id)) piece.z = 100000;
    }
    if (message.type === 'ui_event' && active && setup && message.event.type === 'tap' && message.event.id === 'start_game')
      out.make_move = {action:'configure',difficulty:options.difficulty,goal:options.goal,cube_enabled:options.cube_enabled};
    if (message.type === 'ui_event' && active && !setup && !help) {
      const e = message.event;
      if (e.type === 'tap' && s.needRoll && !doubling && !awaitingNext &&
          (e.id === 'roll' || dice.some(die => die.id === e.id && die.actions.includes('tap'))))
        out.make_move = {action: 'roll'};
      if (e.type === 'tap' && ((e.id === 'next' && awaitingNext) || (e.id === 'undo' && s.can_undo) ||
          ((e.id === 'double' || e.id === 'cube') && s.can_double) ||
          ((e.id === 'take' || e.id === 'drop') && doubling)))
        out.make_move = {action: e.id === 'cube' ? 'double' : e.id};
      if (e.type === 'tap' && controls.some(control => control.id === e.id))
        out.make_move = {action: e.id};
      if (e.type === 'drop' && Object.prototype.hasOwnProperty.call(sources, e.piece_id || e.id)) {
        const from = sources[e.piece_id || e.id];
        const option = legal.find(move => move.from === from && destinationId(move.to) === e.target_id);
        if (option) out.make_move = {action: 'move', from: option.from, to: option.to};
      }
    }
    return out;
  },
  getLastMoveAnimations(view, scene) {
    const last = view.last_move;
    if (!last || !Array.isArray(last.steps)) return null; // Older pinned rules.
    if (!last.steps.length) return [];
    if (!last.before) return null;
    // Recover IDs from the complete final scene, so a reload or spectator can
    // describe the same route without earlier local presentation memory.
    const stacks = [{}, {}], pieces = (scene.pieces || []).filter(piece => /^checker_[01]_/.test(piece.id));
    for (let seat = 0; seat < 2; seat++) for (const at of checkerLocations) {
      const count = checkerCount(view, seat, at);
      stacks[seat][at] = [];
      for (let i = 0; i < count; i++) {
        const point = checkerPoint(seat, at, i, count);
        const piece = pieces.find(piece => piece.id.startsWith('checker_' + seat + '_') && sameCheckerPoint(piece, point));
        if (!piece) return null;
        stacks[seat][at].push(piece.id);
      }
    }
    const hits = checkerHits(last), seat = last.seat;
    for (let i = last.steps.length - 1; i >= 0; i--) {
      const step = last.steps[i], id = stacks[seat][step.to].pop();
      if (!id) return null;
      stacks[seat][step.from].push(id);
      if (hits[i]) {
        const captured = stacks[1-seat].bar.pop();
        if (!captured) return null;
        stacks[1-seat][step.to].push(captured);
      }
    }
    const current = {};
    for (let player = 0; player < 2; player++) for (const at of checkerLocations)
      stacks[player][at].forEach((id, i, ids) => { current[id] = checkerPoint(player, at, i, ids.length); });
    const animations = [];
    const movePiece = (id, to, duration) => {
      const from = current[id];
      if (!sameCheckerPoint(from, to)) animations.push({piece_id:id,path:[from,to],duration_ms:duration});
      current[id] = to;
    };
    last.steps.forEach((step, i) => {
      const id = stacks[seat][step.from].pop();
      const captured = hits[i] ? stacks[1-seat][step.to].pop() : null;
      stacks[seat][step.to].push(id);
      movePiece(id, checkerPoint(seat, String(step.to), stacks[seat][step.to].length - 1, stacks[seat][step.to].length), step.to === 'off' ? 400 : 800);
      if (captured) {
        stacks[1-seat].bar.push(captured);
        movePiece(captured, checkerPoint(1-seat, 'bar', stacks[1-seat].bar.length - 1, stacks[1-seat].bar.length), 400);
      }
    });
    // Compressed stacks settle explicitly after the moving and hit checkers.
    for (const piece of pieces) movePiece(piece.id, {board:piece.board,position:piece.position}, 120);
    return animations;
  }
};
