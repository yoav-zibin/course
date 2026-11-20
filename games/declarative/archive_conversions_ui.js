// Presentation for ten archived HTML games converted to the portable scene UI.
const gameUI = {
  reduce(message, localState) {
    const m = message.type === 'ui_event' ? message.state_changed : message;
    const s = m.view || m.state || {};
    const active = m.status === 'ongoing' && !m.replay &&
      m.acting_for_player_index !== null && m.acting_for_player_index !== undefined;
    const scene = {pieces: [], targets: [], controls: [], labels: [], paths: []};
    const offers = [];
    const seat = Number.isInteger(m.my_player_index) ? m.my_player_index : 0;
    const click = message.type === 'ui_event' && message.event?.type === 'tap'
      ? String(message.event.id || '') : '';
    const localValid = localState && localState.move_count === m.move_count &&
      localState.viewer === seat;
    const text = (source, values = {}) =>
      String(m.strings?.[SOURCE_KEYS[source]] ?? source).replace(/\{(\w+)\}/g,
        (match, key) => values[key] == null ? match : String(values[key]));
    const names = (m.players || []).map((p, i) => p.name || text('Player {n}', {n:i + 1}));
    const title = m.strings?.title || SOURCE_STRINGS.title || KIND;
    const playerName = i => names[i] || text('Player {n}', {n:i + 1});
    const label = (id, value, x, y, font_size = 14) =>
      scene.labels.push({id, text:String(value), x, y, font_size});
    const staticPiece = (id, type, board, position, extra = {}) =>
      scene.pieces.push(Object.assign({id, type, board, position, actions:[]}, extra));
    const offer = (move, value, board, position, mode = 'control', aria_label) => {
      if (!active) return null;
      const id = `intent_${offers.length}`;
      offers.push(move);
      if (mode === 'target') {
        scene.targets.push({id, board, position, label:String(value || '•'),
          ...(aria_label ? {aria_label} : {})});
      } else if (mode === 'piece') {
        scene.pieces.push({id, type:'card', board, position, text:String(value),
          actions:['tap'], ...(aria_label ? {aria_label} : {})});
      } else {
        scene.controls.push({id, kind:'button', label:String(value)});
      }
      return id;
    };
    const cardText = card => {
      if (typeof card === 'string') return card.replace(/S$/, '♠').replace(/H$/, '♥')
        .replace(/D$/, '♦').replace(/C$/, '♣');
      if (card && typeof card === 'object') {
        const ranks = {11:'J',12:'Q',13:'K',14:'A'};
        const suits = ['♠','♥','♦','♣'];
        return `${ranks[card.rank] || card.rank}${suits[card.suit] || ''}`;
      }
      return String(card ?? '');
    };
    const cardPos = i => ({x:36 + (i % 8) * 67,y:125 + Math.floor(i / 8) * 94});
    const boardCell = (i, columns) => ({cell:String(i)});
    const handLabel = hand => Array.isArray(hand) ? hand.map(cardText).join(' ') : '';
    label('title', title, 22, 16, 25);
    if (Number.isInteger(s.to_move) || Number.isInteger(s.toMove) ||
        Number.isInteger(s.turn) || Number.isInteger(s.turnSeat)) {
      const turn = Number.isInteger(s.to_move) ? s.to_move :
        Number.isInteger(s.toMove) ? s.toMove :
          Number.isInteger(s.turn) ? s.turn : s.turnSeat;
      label('status', m.status === 'over' ? text('Game over') :
        (active ? text('Your turn · {name}', {name:playerName(turn)}) :
          text('{name} to play', {name:playerName(turn)})), 22, 52, 16);
    }

    let selectedSize = localValid ? localState.selectedSize : null;
    let selectedFrom = localValid ? localState.selectedFrom : null;
    let draft = localValid && Array.isArray(localState.draft) ? localState.draft.slice() : null;
    let dosPlacements = localValid && Array.isArray(localState.dosPlacements)
      ? localState.dosPlacements.slice() : [];
    let dosBonus = localValid && Array.isArray(localState.dosBonus) ? localState.dosBonus.slice() : [];
    if (KIND === 'gobblet') {
      const reserve = /^reserve_(\d+)$/.exec(click);
      const source = /^source_(\d+)$/.exec(click);
      if (reserve) { selectedSize = Number(reserve[1]); selectedFrom = null; }
      if (source) { selectedFrom = Number(source[1]); selectedSize = null; }
    }
    if (KIND === 'six_mens_morris') {
      if (click === 'reserve_place') selectedFrom = -1;
      const source = /^source_(\d+)$/.exec(click);
      if (source) selectedFrom = Number(source[1]);
    }
    if (KIND === 'mastermind') {
      const peg = /^peg_(\d+)_(\d+)$/.exec(click);
      if (peg) {
        draft = Array.isArray(draft) ? draft : [-1,-1,-1,-1];
        const slot = Number(peg[1]);
        if (slot === draft.indexOf(-1)) draft[slot] = Number(peg[2]);
      }
      if (click === 'reset_draft') draft = [-1,-1,-1,-1];
    }
    if (KIND === 'dos') {
      const selected = /^dos_pick_(\d+)_/.exec(click);
      if (selected) {
        const placement = s.legal_placements?.[Number(selected[1])];
        const usedPiles = new Set(dosPlacements.map(item => item.pile));
        const usedCards = new Set(dosPlacements.flatMap(item => (item.cards || []).map(card => card.i)));
        if (placement && !usedPiles.has(placement.pile) &&
            !(placement.cards || []).some(card => usedCards.has(card.i))) {
          dosPlacements.push(placement);
          const nowUsed = new Set(dosPlacements.flatMap(item => (item.cards || []).map(card => card.i)));
          dosBonus = dosBonus.filter(index => !nowUsed.has(index));
        }
      }
      const bonus = /^dos_bonus_(\d+)$/.exec(click);
      if (bonus) {
        const index = Number(bonus[1]);
        dosBonus = dosBonus.includes(index) ? dosBonus.filter(item => item !== index) : [...dosBonus,index];
      }
    }

    if (KIND === 'mau_mau') {
      const hand = Array.isArray(s.hand) ? s.hand : [];
      const playable = new Set(s.legal_plays || []);
      label('discard', text('Top card {card} · suit {suit} · {n} cards to draw',
        {card:cardText(s.discard_top), suit:s.top_suit || '', n:s.stock_count || 0}), 22, 92, 15);
      hand.forEach((card, i) => {
        const value = cardText(card);
        if (playable.has(card)) {
          if (/^J/.test(card)) {
            staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text:value});
            for (const suit of ['S','H','D','C'])
              offer({type:'play',card,suit}, text('Play {card} as {suit}',
                {card:value,suit:{S:'♠',H:'♥',D:'♦',C:'♣'}[suit]}));
          } else offer({type:'play',card}, text('Play {card}', {card:value}),
            'table', cardPos(i), 'piece');
        } else staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text:value});
      });
      if (active && s.drew == null && s.stock_count > 0)
        offer({type:'draw'}, text('Draw a card ({n} left)', {n:s.stock_count}));
      if (active && s.drew != null) offer({type:'pass'}, text('Pass'));
      label('hand-counts', (s.hand_counts || []).map((n,i) => `${playerName(i)} · ${n}`).join('   '),
        22, 470, 14);
    } else if (KIND === 'dos') {
      const hand = Array.isArray(s.hand) ? s.hand : [];
      (s.center || []).forEach((card, i) =>
        staticPiece(`center_${i}`, 'played', 'table', {x:250 + i * 70,y:100},
          {text:cardText(card.id || card)}));
      hand.forEach((card, i) => staticPiece(`hand_${i}`, 'card', 'table', cardPos(i),
        {text:cardText(card)}));
      const placements = s.legal_placements || [];
      const usedPiles = new Set(dosPlacements.map(item => item.pile));
      const usedCards = new Set(dosPlacements.flatMap(item => (item.cards || []).map(card => card.i)));
      const selectable = placements.map((placement,index) => ({placement,index})).filter(({placement}) =>
        !usedPiles.has(placement.pile) &&
        !(placement.cards || []).some(card => usedCards.has(card.i)));
      const colorMatches = dosPlacements.filter(placement => placement.colorMatch).length;
      const bonusChoices = hand.map((card,index) => ({card,index})).filter(item =>
        !usedCards.has(item.index));
      if (active) selectable.forEach(({placement,index}) => {
        const selected = (placement.cards || []).map(ref => cardText(hand[ref.i])).join(' + ');
        const value = `${selected} → ${placement.pile + 1}`;
        scene.controls.push({id:`dos_pick_${index}_${placement.pile}_${(placement.cards || []).map(card => card.i).join('_')}`,
          kind:'button',label:text('Play {card}',{card:value})});
      });
      if (active && dosPlacements.length) {
        const bonusRefs = dosBonus.map(index => {
          const card = String(hand[index] || '');
          return card.endsWith('#') ? {i:index,num:1} : card === 'WD' ? {i:index,color:'R'} : {i:index};
        });
        const movePlacements = dosPlacements.map(placement => ({pile:placement.pile,cards:placement.cards,
          ...(placement.centerNum !== undefined ? {centerNum:placement.centerNum} : {}),
          ...(placement.centerColor !== undefined ? {centerColor:placement.centerColor} : {})}));
        offer({type:'match',placements:movePlacements,bonus:bonusRefs},text('Continue'));
        if (colorMatches) bonusChoices.forEach(({card,index}) => {
          if (dosBonus.includes(index) || dosBonus.length < colorMatches)
            scene.controls.push({id:`dos_bonus_${index}`,kind:'button',
              label:text('Play {card}',{card:`${dosBonus.includes(index) ? '✓ ' : ''}${cardText(card)}`})});
        });
        label('match-selection',`Matches · ${dosPlacements.length}   Bonus discards · ${dosBonus.length}/${Math.min(colorMatches,bonusChoices.length)}`,
          22,500,14);
      }
      if (active && s.phase === 'play')
        offer({type:'draw'}, text('Draw a card ({n} left)', {n:s.deck_count || 0}));
      if (active && s.phase === 'after_draw') offer({type:'pass'}, text('Pass'));
      if (active && s.phase === 'add_center') hand.forEach((card, i) =>
        offer({type:'add_center',card:{i}}, text('Play {card}', {card:cardText(card)})));
      label('counts', (s.hand_counts || []).map((n,i) => `${playerName(i)} · ${n}`).join('   '),
        22, 470, 14);
    } else if (KIND === 'kisolo') {
      const rows = s.rows || [];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
        const i = r * 7 + c, value = rows[r]?.[c] ?? 0;
        staticPiece(`pit_${i}`, 'pit', 'main', boardCell(i,7), {text:String(value)});
      }
      for (const pit of s.legal_pits || []) {
        const r = Math.floor(pit / 7), c = pit % 7;
        offer({pit}, text('Move to row {r}, column {c}', {r:r + 1,c:c + 1}),
          'main', boardCell(pit,7), 'target');
      }
      label('pit-guide', `P1: ${handLabel(rows[0] || [])}  ·  P2: ${handLabel(rows[3] || [])}`,
        22, 420, 13);
    } else if (KIND === 'thirty_one') {
      const hand = Array.isArray(s.hand) ? s.hand : [];
      hand.forEach((card, i) => {
        if (active && (s.phase === 'discard' || s.phase === 'final_discard'))
          offer({action:'discard',card}, text('Play {card}', {card:cardText(card)}),
            'table', cardPos(i), 'piece');
        else staticPiece(`hand_${i}`, 'card', 'table', cardPos(i), {text:cardText(card)});
      });
      if (active && (s.phase === 'draw' || s.phase === 'final_draw')) {
        if (s.stock_count > 0) offer({action:'draw',source:'stock'},
          text('Draw a card ({n} left)', {n:s.stock_count}));
        if (s.discard_top) offer({action:'draw',source:'discard'},
          text('Play {card}', {card:cardText(s.discard_top)}));
        if (s.phase === 'draw') offer({action:'knock'}, text('Pass'));
        if (s.phase === 'final_draw') offer({action:'stand'}, text('Pass'));
      }
      label('scores', (s.scores || []).map((score,i) => score == null ? '' :
        `${playerName(i)} · ${score}`).filter(Boolean).join('   '), 22, 465, 14);
    } else if (KIND === 'gobblet') {
      const moves = s.legal_moves || [];
      const board = s.board || [];
      board.forEach((stack, cell) => {
        (stack || []).forEach((goblet, level) => staticPiece(`stack_${cell}_${level}`,
          `goblet_${goblet[0]}_${goblet[1]}`, 'main', boardCell(cell,4),
          {text:String(goblet[0]),z:level}));
      });
      if (active) {
        for (let size = 1; size <= 4; size++) if ((s.reserves?.[seat]?.[size - 1] || 0) > 0)
          scene.controls.push({id:`reserve_${size}`,kind:'button',
            label:text('Play {card}',{card:`${size} · ${s.reserves[seat][size - 1]}`})});
        for (let cell = 0; cell < 16; cell++) {
          const top = (board[cell] || []).slice(-1)[0];
          if (top && top[1] === seat && moves.some(move => move.move?.from === cell))
            scene.targets.push({id:`source_${cell}`,board:'main',position:boardCell(cell,4),
              label:'◇',aria_label:text('Select piece at row {r}, column {c}',
                {r:Math.floor(cell / 4) + 1,c:cell % 4 + 1})});
        }
        moves.forEach(move => {
          if (move.place && selectedSize === move.place.size)
            offer(move, String(move.place.size), 'main', boardCell(move.place.cell,4), 'target');
          if (move.move && selectedFrom === move.move.from)
            offer(move, '•', 'main', boardCell(move.move.to,4), 'target');
        });
      }
      label('reserves', (s.reserves || []).map((counts,i) =>
        `${playerName(i)} · ${counts.join('/')}`).join('   '), 22, 505, 14);
    } else if (KIND === 'chutes_ladders') {
      const position = value => {
        const row = Math.floor((value - 1) / 10), offset = (value - 1) % 10;
        return {r:9 - row,c:row % 2 === 0 ? offset : 9 - offset};
      };
      for (let value = 1; value <= 100; value++) {
        const p = position(value), cell = p.r * 10 + p.c;
        staticPiece(`square_${value}`, 'square', 'main', boardCell(cell,10),
          {text:String(value)});
      }
      const links = [[1,38],[4,14],[9,31],[21,42],[28,84],[36,44],[51,67],[71,91],[80,100],
        [16,6],[47,26],[49,11],[56,53],[62,19],[64,60],[87,24],[93,73],[95,75],[98,78]];
      for (const [from,to] of links) {
        const a = position(from), b = position(to);
        const center = p => ({x:48 + p.c * 56,y:126 + p.r * 56});
        const start = center(a), end = center(b);
        scene.paths.push({id:`link_${from}`,points:[start,end],
          color:to > from ? '#22c55e' : '#f97316',width:5});
      }
      (s.positions || []).forEach((value,i) => {
        if (value > 0) {
          const p = position(value);
          staticPiece(`token_${i}`, `token_${i % 4}`, 'main',
            {cell:String(p.r * 10 + p.c)}, {text:String((s.pieces || {})[i] || i + 1),z:5+i});
        }
      });
      if (active && s.phase === 'select') {
        const used = new Set(Object.values(s.pieces || {}));
        ['👑','🎩','🚢','🐶','🎒','🚗'].filter(piece => !used.has(piece)).forEach(piece =>
          offer({kind:'select',emoji:piece}, piece));
      } else if (active) offer({kind:'spin'}, `↻ ${text('Spin')}`);
      const last = (s.log || []).slice(-3);
      last.forEach((entry,i) => label(`log_${i}`,entry,22,710 + i * 18,12));
    } else if (KIND === 'dots_boxes') {
      const xy = (r,c) => ({x:100 + c * 120,y:135 + r * 120});
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const box = r * 3 + c, owner = s.boxes?.[box];
        if (owner !== null && owner !== undefined)
          staticPiece(`box_${box}`, `box_${owner}`, 'main',
            {x:160 + c * 120,y:195 + r * 120},{text:playerName(owner).slice(0,1)});
      }
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
        staticPiece(`dot_${r}_${c}`, 'dot', 'main', xy(r,c));
      (s.edges || []).forEach((owner,edge) => {
        if (owner === null || owner === undefined) return;
        const horizontal = edge < 12;
        const r = horizontal ? Math.floor(edge / 3) : Math.floor((edge - 12) / 4);
        const c = horizontal ? edge % 3 : (edge - 12) % 4;
        const a = horizontal ? xy(r,c) : xy(r,c);
        const b = horizontal ? xy(r,c + 1) : xy(r + 1,c);
        scene.paths.push({id:`edge_${edge}`,points:[a,b],
          color:owner === 0 ? '#4aa3ff' : '#fb7185',width:7});
      });
      (s.legal_edges || []).forEach(edge => {
        const horizontal = edge < 12;
        const r = horizontal ? Math.floor(edge / 3) : Math.floor((edge - 12) / 4);
        const c = horizontal ? edge % 3 : (edge - 12) % 4;
        const a = xy(r,c), b = horizontal ? xy(r,c + 1) : xy(r + 1,c);
        offer({edge}, '•', 'main', {x:(a.x + b.x) / 2,y:(a.y + b.y) / 2}, 'target');
      });
      const counts = [0,1].map(i => (s.boxes || []).filter(owner => owner === i).length);
      label('scores', `${playerName(0)} · ${counts[0]}    ${playerName(1)} · ${counts[1]}`,
        100, 635, 15);
    } else if (KIND === 'mastermind') {
      const colors = s.hexes || ['#e53935','#1e88e5','#43a047','#fdd835','#fb8c00','#8e24aa'];
      draft = Array.isArray(draft) ? draft : [-1,-1,-1,-1];
      draft.forEach((color,slot) => {
        if (color >= 0)
          staticPiece(`draft_${slot}`, `peg_${color}`, 'main',
            {x:110 + slot * 90,y:150},{text:String(slot + 1),z:2});
      });
      const nextSlot = draft.indexOf(-1);
      if (active && nextSlot >= 0) {
        for (let option = 0; option < Math.min(6,colors.length); option++)
          scene.pieces.push({id:`peg_${nextSlot}_${option}`,type:`peg_${option}`,board:'main',
            position:{x:110 + nextSlot * 90,y:230 + option * 47},text:String(option + 1),
            actions:['tap'],aria_label:`${nextSlot + 1}: ${colors[option]}`});
      }
      if (active) {
        if (nextSlot < 0) {
          const move = s.phase === 'set' ? {secret:draft} : {guess:draft};
          offer(move, text('Play {card}', {card:draft.map(x => x + 1).join(' · ')}));
        }
        if (draft.some(color => color >= 0))
          scene.controls.push({id:'reset_draft',kind:'button',label:text('Reset guess')});
      }
      (s.guesses || []).forEach((guess,i) => {
        const y = 535 + i * 25;
        (guess.code || []).forEach((color,slot) => staticPiece(`guess_${i}_${slot}`,
          `peg_${color}`, 'main', {x:110 + slot * 52,y}));
        label(`feedback_${i}`, `${guess.black} ●  ${guess.white} ○`, 355, y + 5, 13);
      });
      label('remaining', `Guesses · ${s.guesses_left ?? 0}`, 22, 105, 15);
    } else if (KIND === 'old_maid') {
      const hand = Array.isArray(s.hand) ? s.hand : [];
      hand.forEach((card,i) => staticPiece(`hand_${i}`, 'card', 'table', cardPos(i),
        {text:cardText(card)}));
      const opponent = 1 - seat, count = s.counts?.[opponent] || 0;
      if (active) for (let i = 0; i < count; i++)
        offer({draw:i}, text('Draw a card ({n} left)', {n:count}));
      label('pairs', `Pairs · ${s.pairs ?? 0}`, 22, 470, 15);
      label('opponent-count', `${playerName(opponent)} · ${count}`, 22, 495, 14);
    } else if (KIND === 'six_mens_morris') {
      const points = [
        [70,70],[300,70],[530,70],[530,300],[530,530],[300,530],[70,530],[70,300],
        [170,170],[300,170],[430,170],[430,300],[430,430],[300,430],[170,430],[170,300]
      ];
      const edges = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0],
        [8,9],[9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,8],
        [1,9],[3,11],[5,13],[7,15]];
      edges.forEach(([a,b],i) => scene.paths.push({id:`line_${i}`,
        points:[{x:points[a][0],y:points[a][1]},{x:points[b][0],y:points[b][1]}],
        color:'#64748b',width:5}));
      const moves = s.moves || [];
      (s.board || []).forEach((owner,point) => {
        if (owner < 0) return;
        staticPiece(`stone_${point}`, `stone_${owner}`, 'main',
          {x:points[point][0],y:points[point][1]}, {text:String(point + 1)});
        if (active && moves.some(move => move.from === point))
          scene.targets.push({id:`source_${point}`,board:'main',
            position:{x:points[point][0],y:points[point][1]},label:'◇',
            aria_label:text('Select piece at row {r}, column {c}',
              {r:point + 1,c:1})});
      });
      if (active && moves.some(move => move.from === -1))
        scene.controls.push({id:'reserve_place',kind:'button',label:text('Place stone')});
      const selectedMoves = moves.filter(move => move.from === selectedFrom);
      const groups = new Map();
      selectedMoves.filter(move => move.type === 'place' || move.type === 'slide').forEach(move => {
        const key = String(move.to);
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(move);
      });
      for (const [destination, group] of groups) {
        if (group.length === 1) {
          const move = group[0], p = points[move.to];
          offer(move, move.take >= 0 ? '×' : '•', 'main', {x:p[0],y:p[1]}, 'target');
        } else {
          group.forEach(move => offer(move, text('Take {n}',{n:move.take + 1})));
        }
      }
      moves.filter(move => move.type === 'claim_draw' || move.type === 'continue')
        .forEach(move => offer(move, text(move.type === 'claim_draw' ? 'Claim draw' : 'Continue')));
      label('counts', (s.counts || []).map((n,i) => `${playerName(i)} · ${n}`).join('   '),
        22, 590, 14);
    }

    const match = /^intent_(\d+)$/.exec(click);
    const move = match && active ? offers[Number(match[1])] : undefined;
    const nextLocal = {move_count:m.move_count,viewer:seat,selectedSize,selectedFrom,draft,
      dosPlacements,dosBonus};
    if (message.type === 'ui_event' && move !== undefined)
      return {scene,local_state:nextLocal,make_move:move};
    return {scene,local_state:nextLocal};
  }
};
