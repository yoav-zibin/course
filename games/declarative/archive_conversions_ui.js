// Presentation for archived HTML games converted to the portable scene UI.
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
      scene.labels.push({id, text:String(value), x, y, font_size,
        ...(KIND === 'six_mens_morris' ? {color:'#30251b'} : {})});
    const staticPiece = (id, type, board, position, extra = {}) =>
      scene.pieces.push(Object.assign({id, type, board, position, actions:[]}, extra));
    const offer = (move, value, board, position, mode = 'control', aria_label) => {
      if (!active) return null;
      const id = `intent_${offers.length}`;
      offers.push(move);
      if (mode === 'hit' || mode === 'mau_hit' || mode === 'dos_hit' || mode === 'suit_hit' || mode === 'knock_hit') {
        const dimensions = mode === 'hit' ? [92,126] : mode === 'dos_hit' ? [76,96] : mode === 'mau_hit' ? [70,96] : mode === 'knock_hit' ? [150,52] : [60,60];
        scene.targets.push({id, board, position, color:'#00000000',
          hit_area:{x:-dimensions[0]/2,y:-dimensions[1]/2,width:dimensions[0],height:dimensions[1]},
          ...(aria_label ? {aria_label} : {})});
      } else if (mode === 'clear') {
        scene.targets.push({id, board, position, color:'#00000000',
          ...(aria_label ? {aria_label} : {})});
      } else if (mode === 'target') {
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
    const boardCell = (i, columns) => ({cell:String(i)});
    if (KIND !== 'six_mens_morris' && KIND !== 'thirty_one' && KIND !== 'kisolo' && KIND !== 'mau_mau' && KIND !== 'dos')
      label('title', title, KIND === 'gobblet' ? Math.max(22, 300 - title.length * 6.4) : 22, 16, 25);
    if (Number.isInteger(s.to_move) || Number.isInteger(s.toMove) ||
        Number.isInteger(s.turn) || Number.isInteger(s.turnSeat) ||
        (KIND === 'six_mens_morris' && Number.isInteger(m.turn_of_player_indices?.[0]))) {
      const turn = Number.isInteger(s.to_move) ? s.to_move :
        Number.isInteger(s.toMove) ? s.toMove :
          Number.isInteger(s.turn) ? s.turn :
            Number.isInteger(s.turnSeat) ? s.turnSeat : m.turn_of_player_indices[0];
      label('status', m.status === 'over' ? text('Game over') :
        (active ? text('Your turn · {name}', {name:playerName(turn)}) :
          text('{name} to play', {name:playerName(turn)})),
        KIND === 'thirty_one' || KIND === 'kisolo' || KIND === 'mau_mau' || KIND === 'dos' ? 220 : KIND === 'gobblet' ? 190 : 22,
        KIND === 'six_mens_morris' ? 22 : KIND === 'thirty_one' || KIND === 'mau_mau' || KIND === 'dos' ? 55 : 52, 16);
    }

    let selectedSize = localValid ? localState.selectedSize : null;
    let selectedFrom = localValid ? localState.selectedFrom : null;
    let selectedTo = localValid && Number.isInteger(localState.selectedTo) ? localState.selectedTo : null;
    let selectedJack = localValid && typeof localState.selectedJack === 'string' ? localState.selectedJack : null;
    let handPage = localValid && Number.isInteger(localState.handPage) ? localState.handPage : 0;
    let dosPlacements = localValid && Array.isArray(localState.dosPlacements)
      ? localState.dosPlacements.slice() : [];
    let dosBonus = localValid && Array.isArray(localState.dosBonus) ? localState.dosBonus.slice() : [];
    let dosSelected = localValid && Array.isArray(localState.dosSelected) ? localState.dosSelected.slice() : [];
    let dosEdit = localValid && localState.dosEdit ? JSON.parse(JSON.stringify(localState.dosEdit)) : null;
    let dosBonusMode = localValid && localState.dosBonusMode === true;
    let centerPage = localValid && Number.isInteger(localState.centerPage) ? localState.centerPage : 0;
    if (KIND === 'gobblet') {
      const reserve = /^reserve_(\d+)$/.exec(click);
      const source = /^source_(\d+)$/.exec(click);
      if (reserve) { selectedSize = Number(reserve[1]); selectedFrom = null; }
      if (source) { selectedFrom = Number(source[1]); selectedSize = null; }
    }
    if (KIND === 'six_mens_morris' && active) {
      if (click === 'reserve_place') { selectedFrom = -1; selectedTo = null; }
      const source = /^source_(\d+)$/.exec(click);
      if (source) { selectedFrom = Number(source[1]); selectedTo = null; }
      const destination = /^destination_(\d+)$/.exec(click);
      if (destination) {
        const to = Number(destination[1]);
        const matching = (s.moves || []).filter(move => move.from === selectedFrom &&
          move.to === to && (move.type === 'place' || move.type === 'slide'));
        if (matching.length > 1) selectedTo = selectedTo === to ? null : to;
      }
    }
    if (KIND === 'mau_mau') {
      const hand = Array.isArray(s.hand) ? s.hand : [];
      const playable = new Set((s.legal_plays || []).filter(card =>
        s.pending_draw > 0 ? /^7/.test(card) : s.drew != null ? card === s.drew : true));
      const pages = Math.max(1, Math.ceil(hand.length / 14));
      handPage = Math.max(0, Math.min(handPage, pages - 1));
      if (active && click === 'hand_previous') { handPage = Math.max(0, handPage - 1); selectedJack = null; }
      if (active && click === 'hand_next') { handPage = Math.min(pages - 1, handPage + 1); selectedJack = null; }
      const jack = /^jack_(\d+)$/.exec(click);
      if (active && jack) {
        const card = hand[Number(jack[1])];
        if (card && /^J/.test(card) && playable.has(card))
          selectedJack = selectedJack === card ? null : card;
      }
      if (!playable.has(selectedJack)) selectedJack = null;
      const cardType = card => /[HD]$/.test(card) ? 'red_card' : 'black_card';
      const suits = {S:'♠',H:'♥',D:'♦',C:'♣'};
      label('title', 'Mau-Mau', 260, 12, 27);
      staticPiece('stock', 'deck', 'table', {x:245,y:180}, {text:'◆'});
      if (s.discard_top)
        staticPiece('discard', cardType(s.discard_top), 'table', {x:395,y:180},
          {text:cardText(s.discard_top)});
      label('stock-count', String(s.stock_count ?? 0), 237, 245, 15);
      label('suit', suits[s.top_suit] || '', 385, 245, 22);
      if (s.pending_draw > 0) label('penalty', `+${s.pending_draw}`, 220, 100, 19);
      if (active && s.drew == null)
        offer({type:'draw'}, '', 'table', {x:245,y:180}, 'mau_hit',
          text('Draw a card ({n} left)', {n:s.stock_count ?? 0}));
      if (active && s.drew != null) offer({type:'pass'}, text('Pass'));
      hand.slice(handPage * 14, handPage * 14 + 14).forEach((card, slot) => {
        const i = handPage * 14 + slot, value = cardText(card);
        const position = {x:80 + (slot % 7) * 80,y:390 + Math.floor(slot / 7) * 105};
        staticPiece(`hand_${i}`, cardType(card), 'table', position,
          {text:value,scale:selectedJack === card ? 1.08 : 1});
        if (active && playable.has(card)) {
          if (/^J/.test(card))
            scene.targets.push({id:`jack_${i}`,board:'table',position,color:'#00000000',
              hit_area:{x:-35,y:-48,width:70,height:96},
              aria_label:text('Play {card}', {card:value})});
          else offer({type:'play',card}, '', 'table', position, 'mau_hit',
            text('Play {card}', {card:value}));
        }
      });
      if (active && selectedJack) Object.entries(suits).forEach(([suit, symbol], i) => {
        const position = {x:200 + i * 80,y:300};
        staticPiece(`suit_${suit}`, suit === 'H' || suit === 'D' ? 'suit_red' : 'suit_black',
          'table', position, {text:symbol});
        offer({type:'play',card:selectedJack,suit}, '', 'table', position, 'suit_hit',
          text('Play {card} as {suit}', {card:cardText(selectedJack),suit:symbol}));
      });
      if (active && handPage > 0)
        scene.controls.push({id:'hand_previous',kind:'button',label:text('Previous cards')});
      if (active && handPage + 1 < pages)
        scene.controls.push({id:'hand_next',kind:'button',label:text('Next cards')});
      label('hand-counts', (s.hand_counts || []).map((n,i) => `${playerName(i)} · ${n}`).join('   '),
        230, 565, 14);
    } else if (KIND === 'dos') {
      const hand = Array.isArray(s.hand) ? s.hand : [];
      const center = s.center || [];
      const colors = ['R','B','G','Y'];
      const centerRef = i => hand[i]?.endsWith('#') ? {i,num:1} :
        hand[i] === 'WD' ? {i,color:'R'} : {i};
      const value = card => card === 'WD' ? 'DOS' : String(card).slice(1);
      const cardType = card => `dos_${card === 'WD' ? 'W' : card[0]}`;
      const usedPiles = () => new Set(dosPlacements.map(item => item.pile));
      const usedCards = () => new Set(dosPlacements.flatMap(item => item.cards.map(card => card.i)));
      const matches = placement => {
        const top = center[placement.pile], refs = placement.cards;
        if (!top || !refs?.length) return false;
        const num = top.id.endsWith('#') ? placement.centerNum : top.id === 'WD' ? 2 : top.num;
        const nums = refs.map(ref => hand[ref.i] === 'WD' ? 2 :
          hand[ref.i]?.endsWith('#') ? ref.num : Number(hand[ref.i]?.slice(1)));
        return Number.isInteger(num) && num >= 1 && num <= 10 &&
          nums.every(n => Number.isInteger(n) && n >= 1 && n <= 10) &&
          nums.reduce((a,b) => a+b,0) === num;
      };
      const colorMatch = placement => {
        const top = center[placement.pile];
        const color = top.id === 'WD' ? placement.centerColor : top.color;
        return placement.cards.every(ref => (hand[ref.i] === 'WD' ? ref.color : hand[ref.i][0]) === color);
      };
      const cycle = (obj,key,values) => { obj[key] = values[(values.indexOf(obj[key]) + 1) % values.length]; };
      const numbers = [1,2,3,4,5,6,7,8,9,10];
      const placements = s.legal_placements || [];
      if (active && click === 'dos_hand_previous') handPage--;
      if (active && click === 'dos_hand_next') handPage++;
      if (active && click === 'dos_center_previous') centerPage--;
      if (active && click === 'dos_center_next') centerPage++;
      handPage = Math.max(0,Math.min(handPage,Math.max(0,Math.ceil(hand.length/14)-1)));
      centerPage = Math.max(0,Math.min(centerPage,Math.max(0,Math.ceil(center.length/14)-1)));
      if (active && click === 'dos_bonus_mode') { dosBonusMode = !dosBonusMode; dosSelected = []; dosEdit = null; }
      if (active && click === 'dos_undo' && dosPlacements.length) {
        dosPlacements.pop(); dosBonus = []; dosSelected = []; dosEdit = null; dosBonusMode = false;
      }
      const handClick = /^dos_hand_(\d+)$/.exec(click);
      if (active && handClick && !dosEdit) {
        const i = Number(handClick[1]);
        if (i < hand.length && !usedCards().has(i)) {
          if (s.phase === 'add_center') {
            dosEdit = {kind:'add',card:centerRef(i)};
          } else if (dosBonusMode) {
            const existing = dosBonus.findIndex(ref => ref.i === i);
            if (existing >= 0) dosBonus.splice(existing,1);
            else if (dosBonus.length < dosPlacements.filter(colorMatch).length) dosBonus.push(centerRef(i));
          } else {
            dosSelected = dosSelected.includes(i) ? dosSelected.filter(n => n !== i) :
              dosSelected.length < 2 ? [...dosSelected,i].sort((a,b) => a-b) : [i];
          }
        }
      }
      const pileClick = /^dos_pile_(\d+)$/.exec(click);
      if (active && pileClick && !dosEdit && !dosBonusMode && dosSelected.length) {
        const pile = Number(pileClick[1]);
        const found = placements.find(item => item.pile === pile && !usedPiles().has(pile) &&
          item.cards.length === dosSelected.length &&
          item.cards.every(ref => dosSelected.includes(ref.i)));
        if (found) {
          const placement = {pile,cards:found.cards.map(ref => ({...ref})),
            ...(found.centerNum !== undefined ? {centerNum:found.centerNum} : {}),
            ...(found.centerColor !== undefined ? {centerColor:found.centerColor} : {})};
          dosBonus = dosBonus.filter(ref => !dosSelected.includes(ref.i));
          if (placement.cards.some(ref => hand[ref.i] === 'WD' || hand[ref.i].endsWith('#')) ||
              center[pile].id === 'WD' || center[pile].id.endsWith('#'))
            dosEdit = {kind:'match',placement};
          else { dosPlacements.push(placement); dosSelected = []; }
        }
      }
      if (active && dosEdit && click === 'dos_cancel') { dosEdit = null; dosSelected = []; }
      if (active && dosEdit?.kind === 'match' && click === 'dos_add_match' && matches(dosEdit.placement)) {
        dosPlacements.push(dosEdit.placement); dosEdit = null; dosSelected = [];
      }
      const cycleRef = /^dos_cycle_(num|color)_(\d+)$/.exec(click);
      if (active && cycleRef && dosEdit) {
        const refs = dosEdit.kind === 'match' ? dosEdit.placement.cards : [dosEdit.card];
        const ref = refs[Number(cycleRef[2])];
        if (ref && cycleRef[1] in ref) cycle(ref,cycleRef[1],cycleRef[1] === 'num' ? numbers : colors);
      }
      if (active && dosEdit?.kind === 'match' && click === 'dos_cycle_center_num')
        cycle(dosEdit.placement,'centerNum',numbers);
      if (active && dosEdit?.kind === 'match' && click === 'dos_cycle_center_color')
        cycle(dosEdit.placement,'centerColor',colors);
      const cycleBonus = /^dos_cycle_bonus_(\d+)$/.exec(click);
      if (active && cycleBonus) {
        const ref = dosBonus[Number(cycleBonus[1])];
        if (ref?.num !== undefined) cycle(ref,'num',numbers);
        if (ref?.color !== undefined) cycle(ref,'color',colors);
      }

      const colorMatches = dosPlacements.filter(colorMatch).length;
      label('title','Dos',295,12,27);
      staticPiece('stock','deck','table',{x:90,y:110},{text:'DOS'});
      if (active && s.phase === 'play' && !dosPlacements.length && !dosEdit)
        offer({type:'draw'}, '', 'table', {x:90,y:110}, 'dos_hit',
          text('Draw a card ({n} left)', {n:s.deck_count ?? 0}));
      label('stock-count',String(s.deck_count ?? 0),82,170,15);
      center.slice(centerPage*14,centerPage*14+14).forEach((card,slot) => {
        const i = centerPage*14+slot, row = Math.floor(slot/7);
        const count = Math.min(7,center.length-centerPage*14-row*7);
        const position = {x:320-(count-1)*40+(slot%7)*80,y:230+row*105};
        staticPiece(`center_${i}`,cardType(card.id),'table',position,
          {text:value(card.id),scale:usedPiles().has(i) ? 0.9 : 1});
        if (active && !dosEdit && !dosBonusMode && !usedPiles().has(i) &&
            placements.some(item => item.pile === i && item.cards.length === dosSelected.length &&
              item.cards.every(ref => dosSelected.includes(ref.i)))) {
          scene.targets.push({id:`dos_pile_${i}`,board:'table',position,color:'#00000000',
            hit_area:{x:-38,y:-48,width:76,height:96},
            aria_label:text('Center card {n}: {card}',{n:i+1,card:card.id})});
        }
      });
      hand.slice(handPage*14,handPage*14+14).forEach((card,slot) => {
        const i = handPage*14+slot, row = Math.floor(slot/7);
        const count = Math.min(7,hand.length-handPage*14-row*7);
        const position = {x:320-(count-1)*40+(slot%7)*80,y:515+row*105};
        const selected = dosSelected.includes(i) || dosBonus.some(ref => ref.i === i) ||
          dosEdit?.card?.i === i;
        staticPiece(`hand_${i}`,cardType(card),'table',position,
          {text:value(card),scale:selected ? 1.08 : usedCards().has(i) ? 0.9 : 1});
        if (active && !dosEdit && !usedCards().has(i))
          scene.targets.push({id:`dos_hand_${i}`,board:'table',position,color:'#00000000',
            hit_area:{x:-38,y:-48,width:76,height:96},
            aria_label:text('Play {card}',{card})});
      });
      label('hint',s.phase === 'over' && Number.isInteger(s.winner) ?
        text('Winner: {name}',{name:playerName(s.winner)}) :
        dosEdit ? text(dosEdit.kind === 'add' && dosEdit.card.num === undefined &&
          dosEdit.card.color === undefined ? 'Continue' : 'Choose number or color') : s.phase === 'add_center' ?
          text('Choose a card for the center') : dosBonusMode ?
            text('Bonus cards') : text('Select cards, then a center card'),180,415,16);
      label('counts',(s.hand_counts || []).map((n,i) => `${playerName(i)} · ${n}`).join('   '),230,690,14);
      if (active && handPage > 0) scene.controls.push({id:'dos_hand_previous',kind:'button',label:text('Previous cards')});
      if (active && (handPage+1)*14 < hand.length) scene.controls.push({id:'dos_hand_next',kind:'button',label:text('Next cards')});
      if (active && centerPage > 0) scene.controls.push({id:'dos_center_previous',kind:'button',label:text('Previous center cards')});
      if (active && (centerPage+1)*14 < center.length) scene.controls.push({id:'dos_center_next',kind:'button',label:text('Next center cards')});
      if (active && dosEdit) {
        const refs = dosEdit.kind === 'match' ? dosEdit.placement.cards : [dosEdit.card];
        refs.forEach((ref,i) => {
          for (const key of ['num','color']) if (ref[key] !== undefined)
            scene.controls.push({id:`dos_cycle_${key}_${i}`,kind:'button',
              label:`${hand[ref.i]} · ${ref[key]} ↻`});
        });
        if (dosEdit.kind === 'match') {
          for (const [key,suffix] of [['centerNum','num'],['centerColor','color']])
            if (dosEdit.placement[key] !== undefined)
              scene.controls.push({id:`dos_cycle_center_${suffix}`,kind:'button',
                label:`${center[dosEdit.placement.pile].id} · ${dosEdit.placement[key]} ↻`});
          if (matches(dosEdit.placement))
            scene.controls.push({id:'dos_add_match',kind:'button',label:text('Add match')});
        } else offer({type:'add_center',card:dosEdit.card},text('Continue'));
        scene.controls.push({id:'dos_cancel',kind:'button',label:text('Cancel')});
      }
      if (active && !dosEdit && dosPlacements.length) {
        offer({type:'match',placements:dosPlacements,bonus:dosBonus},text('Continue'));
        scene.controls.push({id:'dos_undo',kind:'button',label:text('Undo match')});
        if (colorMatches) scene.controls.push({id:'dos_bonus_mode',kind:'button',
          label:`${dosBonusMode ? '✓ ' : ''}${text('Bonus cards')} ${dosBonus.length}/${colorMatches}`});
        dosBonus.forEach((ref,i) => {
          if (ref.num !== undefined || ref.color !== undefined)
            scene.controls.push({id:`dos_cycle_bonus_${i}`,kind:'button',
              label:`${hand[ref.i]} · ${ref.num ?? ref.color} ↻`});
        });
      }
      if (active && s.phase === 'after_draw') offer({type:'pass'}, text('Pass'));
    } else if (KIND === 'kisolo') {
      const rows = s.rows || [];
      label('title', 'Kisolo', 270, 16, 25);
      scene.paths.push({id:'center-line',points:[{x:30,y:250},{x:590,y:250}],
        color:'#654229',width:4});
      for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
        const i = r * 7 + c, value = rows[r]?.[c] ?? 0;
        staticPiece(`pit_${i}`, 'pit', 'main', boardCell(i,7), {text:String(value),
          aria_label:text('Pit row {r}, column {c} · {n} seeds', {r:r + 1,c:c + 1,n:value})});
      }
      for (const pit of s.legal_pits || []) {
        const r = Math.floor(pit / 7), c = pit % 7;
        offer({pit}, '', 'main', boardCell(pit,7), 'clear',
          text('Pit row {r}, column {c} · {n} seeds', {r:r + 1,c:c + 1,n:rows[r]?.[c] ?? 0}));
      }
      if (s.over && Number.isInteger(s.winner) && s.winner >= 0)
        label('winner', text('Winner: {name}', {name:playerName(s.winner)}), 230, 420, 18);
    } else if (KIND === 'thirty_one') {
      const hand = Array.isArray(s.hand) ? s.hand : [];
      const cardType = card => /[HD]$/.test(card) ? 'red_card' : 'black_card';
      const drawPhase = s.phase === 'draw' || s.phase === 'final_draw';
      const discardPhase = s.phase === 'discard' || s.phase === 'final_discard';
      label('title', '31', 300, 12, 30);
      if (s.phase !== 'over') {
        staticPiece('stock', 'deck', 'table', {x:245,y:230}, {text:'◆'});
        if (s.discard_top)
          staticPiece('discard', cardType(s.discard_top), 'table', {x:395,y:230},
            {text:cardText(s.discard_top)});
        label('stock-count', String(s.stock_count ?? 0), 237, 310, 16);
      }
      if (active && drawPhase) {
        if (s.stock_count > 0)
          offer({action:'draw',source:'stock'}, '', 'table', {x:245,y:230}, 'hit',
            text('Draw a card ({n} left)', {n:s.stock_count}));
        if (s.discard_top)
          offer({action:'draw',source:'discard'}, '', 'table', {x:395,y:230}, 'hit',
            text('Take {card}', {card:cardText(s.discard_top)}));
        const action = s.phase === 'draw' ? 'knock' : 'stand';
        const caption = text(action === 'knock' ? 'Knock' : 'Stand');
        staticPiece('knock_button', 'knock_button', 'table', {x:320,y:350}, {text:caption});
        offer({action}, '', 'table', {x:320,y:350}, 'knock_hit', caption);
      }
      const hands = s.phase === 'over' && Array.isArray(s.hands) ? s.hands : [hand];
      hands.forEach((cards, row) => {
        if (s.phase === 'over') {
          const scoreIndex = Number.isInteger(m.my_player_index) ? (row === seat ? 0 : 1) : row;
          const score = s.scores?.[scoreIndex];
          label(`hand-owner_${row}`, `${playerName(row)}${score == null ? '' : ` · ${score}`}`,
            260, 165 + row * 180, 17);
        }
        cards.forEach((card, i) => {
          const position = {x:320 + (i - (cards.length - 1) / 2) * 112,
            y:s.phase === 'over' ? 250 + row * 180 : 460};
          staticPiece(`hand_${row}_${i}`, cardType(card), 'table', position, {text:cardText(card)});
          if (active && discardPhase)
            offer({action:'discard',card}, '', 'table', position, 'hit',
              text('Play {card}', {card:cardText(card)}));
        });
      });
      if (s.phase === 'over' && Number.isInteger(s.winner))
        label('winner', text('Winner: {name}', {name:playerName(s.winner)}), 240, 100, 19);
      else if (s.scores?.[0] != null)
        label('scores', `${playerName(seat)} · ${s.scores[0]}`, 260, 100, 19);
    } else if (KIND === 'gobblet') {
      const moves = s.legal_moves || [];
      const board = s.board || [];
      board.forEach((stack, cell) => {
        (stack || []).forEach((goblet, level) => staticPiece(`stack_${cell}_${level}`,
          `goblet_${goblet[0]}_${goblet[1]}`, 'main', boardCell(cell,4),
          {z:level}));
      });
      if (Number.isInteger(m.my_player_index)) {
        for (let size = 1; size <= 4; size++) {
          const count = s.reserves?.[seat]?.[size - 1] || 0;
          if (!count) continue;
          const position = {x:65 + (size - 1) * 130,y:55};
          staticPiece(`reserve_art_${size}`, `goblet_${size}_${seat}`, 'tray', position,
            {scale:selectedSize === size ? 1.1 : 1});
          label(`reserve_count_${size}`, `×${count}`, 130 + (size - 1) * 130, 657, 15);
          if (active && moves.some(move => move.place?.size === size))
            scene.targets.push({id:`reserve_${size}`,board:'tray',position,color:'#00000000',
              hit_area:{x:-45,y:-45,width:90,height:90},
              aria_label:text('Select size {n} · {count} remaining', {n:size,count})});
        }
      }
      if (active) {
        for (let cell = 0; cell < 16; cell++) {
          const top = (board[cell] || []).slice(-1)[0];
          const isDestination = moves.some(move =>
            (move.place && move.place.size === selectedSize && move.place.cell === cell) ||
            (move.move && move.move.from === selectedFrom && move.move.to === cell));
          if (!isDestination && top && top[1] === seat && moves.some(move => move.move?.from === cell))
            scene.targets.push({id:`source_${cell}`,board:'main',position:boardCell(cell,4),
              color:'#00000000',aria_label:text('Select piece at row {r}, column {c}',
                {r:Math.floor(cell / 4) + 1,c:cell % 4 + 1})});
        }
        moves.forEach(move => {
          if (move.place && selectedSize === move.place.size)
            offer(move, '•', 'main', boardCell(move.place.cell,4), 'target',
              text('Move to row {r}, column {c}',
                {r:Math.floor(move.place.cell / 4) + 1,c:move.place.cell % 4 + 1}));
          if (move.move && selectedFrom === move.move.from)
            offer(move, '•', 'main', boardCell(move.move.to,4), 'target',
              text('Move to row {r}, column {c}',
                {r:Math.floor(move.move.to / 4) + 1,c:move.move.to % 4 + 1}));
        });
      }
    } else if (KIND === 'chutes_ladders') {
      const position = value => {
        const row = Math.floor((value - 1) / 10), offset = (value - 1) % 10;
        return {r:9 - row,c:row % 2 === 0 ? offset : 9 - offset};
      };
      for (let value = 1; value <= 100; value++) {
        const p = position(value);
        scene.labels.push({id:`square_${value}`,text:String(value),
          x:34 + p.c * 56,y:116 + p.r * 56,font_size:14,color:'#23334b'});
      }
      const links = [[1,38],[4,14],[9,31],[21,42],[28,84],[36,44],[51,67],[71,91],[80,100],
        [16,6],[47,26],[49,11],[56,53],[62,19],[64,60],[87,24],[93,73],[95,75],[98,78]];
      for (const [from,to] of links) {
        const a = position(from), b = position(to);
        const center = p => ({x:58 + p.c * 56,y:140 + p.r * 56});
        const start = center(a), end = center(b);
        const dx = end.x - start.x, dy = end.y - start.y;
        const length = Math.hypot(dx,dy), nx = -dy / length, ny = dx / length;
        if (to > from) {
          for (const side of [-1,1])
            scene.paths.push({id:`ladder_${from}_${side}`,points:[
              {x:start.x+nx*side*7,y:start.y+ny*side*7},
              {x:end.x+nx*side*7,y:end.y+ny*side*7}],color:'#2d8063',width:3});
          for (let rung = 1; rung <= 5; rung++) {
            const x = start.x + dx*rung/6, y = start.y + dy*rung/6;
            scene.paths.push({id:`rung_${from}_${rung}`,points:[
              {x:x+nx*7,y:y+ny*7},{x:x-nx*7,y:y-ny*7}],color:'#2d8063',width:3});
          }
        } else {
          scene.paths.push({id:`chute_${from}`,points:[start,end],color:'#bd5941',width:12});
          scene.paths.push({id:`chute_center_${from}`,points:[start,end],color:'#f4ab83',width:6});
        }
      }
      (s.positions || []).forEach((value,i) => {
        if (value > 0) {
          const p = position(value);
          staticPiece(`token_${i}`, `token_${i % 4}`, 'main',
            {x:28 + p.c*56 + (i % 2 ? 10 : -10),y:26 + p.r*56 + (i >= 2 ? 20 : 0)},
            {text:String((s.pieces || {})[i] || i + 1),z:5+i});
        }
      });
      if (active && s.phase === 'select') {
        const used = new Set(Object.values(s.pieces || {}));
        ['👑','🎩','🚢','🐶','🎒','🚗'].filter(piece => !used.has(piece)).forEach(piece =>
          offer({kind:'select',emoji:piece}, piece));
      } else if (active) offer({kind:'spin'}, `↻ ${text('Spin')}`);
      const last = (s.log || []).slice(-1);
      last.forEach(entry => label('log',entry,22,690,14));
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
    } else if (KIND === 'six_mens_morris') {
      const points = [
        [80,70],[310,70],[540,70],[540,300],[540,530],[310,530],[80,530],[80,300],
        [180,170],[310,170],[440,170],[440,300],[440,430],[310,430],[180,430],[180,300]
      ];
      const edges = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,0],
        [8,9],[9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,8],
        [1,9],[3,11],[5,13],[7,15]];
      edges.forEach(([a,b],i) => scene.paths.push({id:`line_${i}`,
        points:[{x:points[a][0],y:points[a][1]},{x:points[b][0],y:points[b][1]}],
        color:'#60452e',width:5}));
      const moves = s.moves || [];
      points.forEach(([x,y],i) => staticPiece(`point_${i}`, 'point', 'main', {x,y}));
      (s.board || []).forEach((owner,point) => {
        if (owner < 0) return;
        staticPiece(`stone_${point}`, `stone_${owner}`, 'main',
          {x:points[point][0],y:points[point][1]});
        if (active && moves.some(move => move.from === point))
          scene.targets.push({id:`source_${point}`,board:'main',
            position:{x:points[point][0],y:points[point][1]},label:'◇',
            aria_label:text('Select stone at point {n}',{n:point + 1})});
      });
      if (active && moves.some(move => move.from === -1)) {
        staticPiece('reserve',`stone_${seat}`,'main',{x:310,y:630},
          {text:String((s.reserve || [])[seat] ?? '')});
        scene.targets.push({id:'reserve_place',board:'main',position:{x:310,y:630},
          color:'#00000000',aria_label:text('Place stone')});
      }
      const selectedMoves = moves.filter(move => move.from === selectedFrom);
      const groups = new Map();
      selectedMoves.filter(move => move.type === 'place' || move.type === 'slide').forEach(move => {
        const key = String(move.to);
        if (!groups.has(key)) groups.set(key,[]);
        groups.get(key).push(move);
      });
      for (const [destination, group] of active ? groups : []) {
        if (selectedTo !== null && selectedTo !== Number(destination)) continue;
        if (group.length === 1 && selectedTo === null) {
          const move = group[0], p = points[move.to];
          offer(move, move.take >= 0 ? '×' : '•', 'main', {x:p[0],y:p[1]}, 'target',
            text('Move to point {n}',{n:move.to + 1}));
        } else {
          const p = points[Number(destination)];
          scene.targets.push({id:`destination_${destination}`,board:'main',
            position:{x:p[0],y:p[1]},label:selectedTo === null ? '•' : '↶',
            aria_label:text('Move to point {n}',{n:Number(destination) + 1})});
          if (selectedTo !== null) group.forEach(move => {
            if (move.take < 0 || !points[move.take]) return;
            const captured = points[move.take];
            offer(move, '×', 'main', {x:captured[0],y:captured[1]}, 'target',
              text('Take {n}',{n:move.take + 1}));
          });
        }
      }
      moves.filter(move => move.type === 'claim_draw' || move.type === 'continue')
        .forEach(move => offer(move, text(move.type === 'claim_draw' ? 'Claim draw' : 'Continue')));
      const countText = (s.counts || []).map((n,i) => `${playerName(i)} · ${n}`).join('   ');
      label('counts', countText, Math.max(22,310-countText.length*3.5), 575, 14);
    }

    const match = /^intent_(\d+)$/.exec(click);
    const move = match && active ? offers[Number(match[1])] : undefined;
    const nextLocal = {move_count:m.move_count,viewer:seat,selectedSize,selectedFrom,selectedTo,selectedJack,handPage,
      dosPlacements,dosBonus,dosSelected,dosEdit,dosBonusMode,centerPage};
    if (message.type === 'ui_event' && move !== undefined)
      return {scene,local_state:nextLocal,make_move:move};
    return {scene,local_state:nextLocal};
  }
};
