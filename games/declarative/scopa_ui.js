const gameUI = {
  reduce(message, localState) {
    const m = message.type === 'ui_event' ? message.state_changed : message;
    const s = m.view || m.state;
    const active = m.status === 'ongoing' && !m.replay &&
      m.acting_for_player_index !== null && m.acting_for_player_index !== undefined;
    const strings = Object.assign({},SOURCE_STRINGS,m.strings || {});
    const text = (key,values={}) => String(strings[key]).replace(/\{(\w+)\}/g,
      (_,name) => String(values[name] ?? ''));
    const shortName = name => {
      const chars = Array.from(name);
      return chars.length > 10 ? chars.slice(0,9).join('') + '…' : chars.join('');
    };
    const symbols = {S:'♠',H:'♥',D:'♦',C:'♣'};
    const cardText = card => {
      const n = Number(card.slice(0,-1));
      return `${({1:'A',8:'J',9:'Q',10:'K'})[n] || n}${symbols[card.slice(-1)]}`;
    };
    const type = card => /[HD]$/.test(card) ? 'red' : 'black';
    const valid = localState && localState.move_count === m.move_count &&
      localState.viewer === m.my_player_index;
    let selected = valid ? localState.selected : null;
    let taken = valid && Array.isArray(localState.taken) ? localState.taken.slice() : [];
    const legal = active ? s.legal : [];
    if (!legal.some(move => move.card === selected)) { selected = null; taken = []; }
    const event = message.type === 'ui_event' && message.event?.type === 'tap'
      ? String(message.event.id || '') : '';
    let emitted = null;
    if (active && event.startsWith('hand_')) {
      const card = event.slice(5);
      if (legal.some(move => move.card === card)) {
        selected = selected === card ? null : card;
        taken = [];
        const trail = legal.find(move => move.card === selected && !move.capture.length);
        if (trail) emitted = trail;
      }
    }
    if (active && selected && event.startsWith('take_')) {
      const card = event.slice(5);
      const candidates = legal.filter(move => move.card === selected);
      if (taken.includes(card)) taken = taken.filter(value => value !== card);
      else if (candidates.some(move => move.capture.includes(card) &&
          taken.every(value => move.capture.includes(value)))) taken.push(card);
      emitted = candidates.find(move => move.capture.length === taken.length &&
        taken.every(value => move.capture.includes(value))) || null;
    }
    const scene = {pieces:[],targets:[],controls:[],labels:[],paths:[]};
    const label = (id,value,x,y,font_size) => scene.labels.push({id,text:String(value),x,y,font_size});
    const piece = (id,card,position,scale=1) => scene.pieces.push({id,type:type(card),board:'table',
      position,text:cardText(card),scale,actions:[]});
    const target = (id,position,name) => scene.targets.push({id,board:'table',position,
      color:'#00000000',hit_area:{x:-38,y:-48,width:76,height:96},aria_label:name});
    label('title',strings.title,275,12,27);
    label('score',s.over ? text('final',{a:s.scores[0],b:s.scores[1]}) :
      text('sweeps',{a:s.sweeps[0],b:s.sweeps[1]}),195,52,19);
    scene.pieces.push({id:'stock-pile',type:'stock',board:'table',position:{x:55,y:81},count:s.deck_count,actions:[]});
    label('stock',text('stock',{n:s.deck_count}),260,85,16);
    const extraRows = Math.max(0, Math.ceil(s.table.length / 7) - 2);
    const shift = extraRows * 105;
    for (let row = 0; row < extraRows; row++)
      scene.paths.push({id:`table_extension_${row}`,points:[
        {x:0,y:642.5+row*105},{x:640,y:642.5+row*105}],color:'#316f68',width:105});
    if (s.over) label('result',s.winner < 0 ? strings.tie :
      text('winner',{name:shortName(m.players?.[s.winner]?.name || text('player',{n:s.winner+1}))}),240,105,18);
    else if (active && s.hand?.length)
      label('hint',selected ? strings.choose_capture : strings.choose_card,220,405+shift,16);
    s.table.forEach((card,i) => {
      const row = Math.floor(i/7);
      const count = Math.min(7,s.table.length-row*7);
      const position = {x:320-(count-1)*40+(i%7)*80,y:205+row*105};
      piece(`card_${card}`,card,position,taken.includes(card) ? 1.08 : 1);
      if (active && selected && legal.some(move => move.card === selected &&
          move.capture.includes(card) && taken.every(value => move.capture.includes(value))))
        target(`take_${card}`,position,text('capture',{card:cardText(card)}));
    });
    (s.hand || []).forEach((card,i) => {
      const position = {x:320-(s.hand.length-1)*60+i*120,y:500+shift};
      piece(`card_${card}`,card,position,selected === card ? 1.08 : 1);
      if (active && legal.some(move => move.card === card))
        target(`hand_${card}`,position,text('play',{card:cardText(card)}));
    });
    return {scene,local_state:{move_count:m.move_count,viewer:m.my_player_index,selected,taken},
      ...(emitted ? {make_move:emitted} : {})};
  }
};
