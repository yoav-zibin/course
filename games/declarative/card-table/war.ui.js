const SOURCE_STRINGS = {
  title: "War", player: "Player {n}", cards_left: "{count} cards", round: "Round {n}",
  pile: "Battle pile: {count}", flip: "Flip top card", flip_hint: "Tap your highlighted deck to flip the top card.", waiting: "Waiting for {name} to flip…", next_battle: "Next battle", showdown: "Cards are revealed.", tie_reveal: "Tie. WAR begins next.",
  war: "WAR! Each tied player places one card down and one face up.",
  battle: "High card wins the pile.", face_down: "Face down", revealed: "{rank} of {suit}",
  wins_round: "{name} wins the pile!", wins_game: "{name} wins the game!", draw: "The game is a draw.",
  suit_clubs: "Clubs", suit_diamonds: "Diamonds", suit_hearts: "Hearts", suit_spades: "Spades",
  server_game_over: "game over", server_not_seated: "not seated", server_not_your_turn: "not your turn",
  server_bad_move: "bad move", server_no_cards_to_flip: "no cards to flip", server_not_enough_cards_for_war: "not enough cards for war"
};
function warText(message,key,args){const text=(message.strings||{})[key]||SOURCE_STRINGS[key]||key;return text.replace(/\{(\w+)\}/g,(_,k)=>args&&args[k]!==undefined?String(args[k]):"");}
function warCenteredX(text,size,center=450){return Math.max(12,center-String(text).length*size*.28);}
var gameUI = {
  reduce(message, localState) {
    const m=message.type==='ui_event'?(message.state_changed||{}):message;
    const s=m.view||m.state||{};
    const t=(key,args={})=>warText(m,key,args);
    const active=m.status==='ongoing'&&!m.replay&&Number.isInteger(m.acting_for_player_index);
    const seats=m.players||[], count=(s.counts||[]).length;
    const positions=count===2?[[315,270],[585,270]]:[[220,160],[680,160],[220,470],[680,470]];
    const cardText=card=>!card?'':`${card.rank===1||card.rank===14?'A':card.rank===11?'J':card.rank===12?'Q':card.rank===13?'K':card.rank}${['♣','♦','♥','♠'][card.suit]}`;
    const pieces=[],controls=[],labels=[];
    labels.push({id:'title',text:t('title'),x:warCenteredX(t('title'),26),y:30,font_size:26,color:'#fff5dc'});
    labels.push({id:'round',text:t('round',{n:s.round||1}),x:warCenteredX(t('round',{n:s.round||1}),18),y:66,font_size:18,color:'#dbe8db'});
    labels.push({id:'pile',text:t('pile',{count:s.pileCount||0}),x:warCenteredX(t('pile',{count:s.pileCount||0}),16),y:96,font_size:16,color:'#ffe28a'});
    const centerY=count===2?370:235;
    const phaseText=(m.status==='over'||m.turn_of_player_indices===null)?(s.winner===null?t('draw'):t('wins_game',{name:(seats[s.winner]||{}).name||t('player',{n:s.winner+1})})):s.stage==='showdown'?t('showdown'):(s.stage==='war'?t('war'):t('battle'));
    labels.push({id:'phase',text:phaseText,x:warCenteredX(phaseText,s.stage==='showdown'?14:16),y:centerY,font_size:s.stage==='showdown'?14:16,color:'#fff5dc'});
    if(active&&s.stage!=='showdown')labels.push({id:'flip-hint',text:t('flip_hint'),x:warCenteredX(t('flip_hint'),14),y:centerY+34,font_size:14,color:'#dbe8db'});
    if(s.stage==='showdown'){
      const ranks=(s.participants||[]).map(i=>({i,rank:(s.faceUp||[])[i]?.rank||0}));
      const high=Math.max(0,...ranks.map(item=>item.rank)),leaders=ranks.filter(item=>item.rank===high).map(item=>item.i);
      const result=leaders.length===1?t('wins_round',{name:(seats[leaders[0]]||{}).name||t('player',{n:leaders[0]+1})}):t('tie_reveal');
      labels.push({id:'showdown-result',text:result,x:warCenteredX(result,15),y:centerY+36,font_size:15,color:'#ffe28a'});
    }
    const lastWinner=localState&&localState.lastWinner;
    for(let i=0;i<count;i++){
      const [x,y]=positions[i%positions.length],name=(seats[i]||{}).name||t('player',{n:i+1}),card=(s.faceUp||[])[i];
      labels.push({id:`player-${i}`,text:name,x:warCenteredX(name,18,x),y:y-143,font_size:18,color:i===s.turnIdx&&m.status==='ongoing'?'#a7f070':'#ffffff'});
      const countText=t('cards_left',{count:(s.counts||[])[i]||0});
      labels.push({id:`count-${i}`,text:countText,x:warCenteredX(countText,14,x),y:y-116,font_size:14,color:'#d9e7df'});
      if((s.counts||[])[i]>0)pieces.push({id:`deck-${i}`,type:'back',board:'table',position:{x:x-46,y},asset:'card_back',text:'',actions:active&&s.stage!=='showdown'&&i===m.acting_for_player_index?['tap']:[],aria_label:active&&i===m.acting_for_player_index?t('flip_hint'):t('face_down')});
      if(card)pieces.push({id:`top-card-${i}`,type:card.suit===1||card.suit===2?'red':'black',board:'table',position:{x,y},text:cardText(card),face:'front',actions:[],aria_label:t('revealed',{rank:card.rank,suit:t('suit_'+['clubs','diamonds','hearts','spades'][card.suit])}),animation:{kind:'move',key:`war-${s.round}-${s.warDepth}-${i}-${card.rank}-${card.suit}`,duration_ms:360}});
      else if((s.counts||[])[i]>0)pieces.push({id:`top-card-${i}`,type:'back',board:'table',position:{x,y},face:'back',asset:'card_back',text:'',actions:[],aria_label:t('face_down')});

    }
    if(active&&s.stage==='showdown'&&Array.isArray(s.legalMoves)&&s.legalMoves.some(mv=>mv.continue===true)&&!(seats||[]).some(player=>player.kind==='computer'))controls.push({id:'continue-battle',kind:'button',label:t('next_battle')});
    else if(active&&Array.isArray(s.legalMoves)&&s.legalMoves.some(mv=>mv.flip===true))controls.push({id:'flip-card',kind:'button',label:t('flip')});
    else if(m.status==='ongoing'&&Array.isArray(m.turn_of_player_indices)&&m.turn_of_player_indices.length){const i=m.turn_of_player_indices[0],waitingText=s.stage==='showdown'?'Next battle starts shortly.':t('waiting',{name:(seats[i]||{}).name||t('player',{n:i+1})});labels.push({id:'waiting',text:waitingText,x:warCenteredX(waitingText,15),y:centerY+70,font_size:15,color:'#dbe8db'});}
    for(const piece of pieces){piece.position.x*=2/3;piece.position.y=count===2?piece.position.y+20:piece.position.y;}
    for(const label of labels){label.x*=2/3;if(count===2&&/^(player|count)-/.test(label.id))label.y+=20;}
    const scene={pieces,targets:[],controls,labels};
    const result={scene,local_state:{lastWinner:s.winner}};
    if(message.type==='ui_event'&&active&&message.event.type==='tap'&&message.event.id==='continue-battle'&&s.stage==='showdown')result.make_move={continue:true};
    if(message.type==='ui_event'&&active&&message.event.type==='tap'&&(message.event.id==='flip-card'||message.event.id===`deck-${m.acting_for_player_index}`)&&s.stage!=='showdown')result.make_move={flip:true};
    return result;
  }
};
