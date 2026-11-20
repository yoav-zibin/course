const gameUI = {
  reduce(message) {
    const m = message.type === 'ui_event' ? message.state_changed : message;
    const s = m.view || m.state;
    const active = m.status === 'ongoing' && !m.replay &&
      m.acting_for_player_index !== null && m.acting_for_player_index !== undefined;
    const strings = Object.assign({}, SOURCE_STRINGS, m.strings || {});
    const text = (key, values = {}) => String(strings[key]).replace(/\{(\w+)\}/g,
      (_, name) => String(values[name] ?? ''));
    const shortName = (name, limit) => {
      const chars = Array.from(name);
      return chars.length > limit ? chars.slice(0,limit-1).join('') + '…' : chars.join('');
    };
    const symbols = {S:'♠',H:'♥',D:'♦',C:'♣'};
    const cardText = card => {
      const rank = Number(card.slice(0,-1));
      return `${({11:'J',12:'Q',13:'K',14:'A'})[rank] || rank}${symbols[card.slice(-1)]}`;
    };
    const cardType = card => /[HD]$/.test(card) ? 'red' : 'black';
    const scene = {pieces:[],targets:[],controls:[],labels:[]};
    const label = (id, value, x, y, font_size) =>
      scene.labels.push({id,text:String(value),x,y,font_size});
    label('title', strings.title, 275, 12, 27);
    label('trump', text('trump',{suit:symbols[s.trump]}), 265, 55, 18);
    label('team_one', `1 + 3: ${s.tricks[0]}`, 120, 90, 23);
    label('team_two', `2 + 4: ${s.tricks[1]}`, 410, 90, 23);
    const turnName = m.players?.[s.turn]?.name || text('player',{n:s.turn + 1});
    label('turn', s.over ? text('winner',{team:s.winner === 0 ? '1 + 3' : '2 + 4'}) :
      text('turn',{name:shortName(turnName,10)}), 240, 315, 20);
    const played = s.trick.length ? s.trick : s.last_trick;
    played.forEach((play, i) => {
      const position = {x:140 + i * 120,y:205};
      scene.pieces.push({id:`card_${play.card}`,type:cardType(play.card),board:'table',position,
        text:cardText(play.card),actions:[]});
      const name = m.players?.[play.seat]?.name || text('player',{n:play.seat + 1});
      label(`name_${i}`,shortName(name,8),position.x - 25,270,15);
    });
    const legal = new Set(active ? s.legal : []);
    (s.hand || []).forEach((card,i) => {
      const row = Math.floor(i / 7);
      const count = Math.min(7, s.hand.length - row * 7);
      const position = {x:320 - (count - 1) * 40 + (i % 7) * 80,y:395 + row * 105};
      scene.pieces.push({id:`card_${card}`,type:cardType(card),board:'table',position,
        text:cardText(card),actions:[]});
      if (legal.has(card)) scene.targets.push({id:`play_${card}`,board:'table',position,
        color:'#00000000',hit_area:{x:-37,y:-48,width:74,height:96},
        aria_label:text('play',{card:cardText(card)})});
    });
    const out = {scene,local_state:{}};
    if (active && message.type === 'ui_event' && message.event?.type === 'tap') {
      const card = String(message.event.id || '').replace(/^play_/, '');
      if (legal.has(card)) out.make_move = {card};
    }
    return out;
  }
};
