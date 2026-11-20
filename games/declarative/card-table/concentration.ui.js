const KIND="memory";
const SOURCE_STRINGS={"title": "Concentration", "turn": "Player {n}", "finished": "Finished", "roll": "Roll", "hold": "Hold", "take": "Take {n}", "cell": "Cell {n}", "sow": "Sow pit {n}", "server_invalid": "Illegal move", "score": "{a} : {b}"};
// Prefix with KIND and SOURCE_STRINGS when packaging. Same script runs in
// QuickJS on native hosts and in the portal's isolated presentation worker.
const gameUI = {
  reduce(message, localState) {
    const m=message.type==='ui_event'?message.state_changed:message;
    const s=m.view||m.state;
    const strings=Object.assign({},SOURCE_STRINGS,m.strings||{});
    const t=(key,args={})=>(strings[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(args[k]===undefined?'':args[k]));
    const active=m.status==='ongoing'&&!m.replay&&m.acting_for_player_index!==null&&m.acting_for_player_index!==undefined;
    const legal=active?(s.legal||[]):[];
    const pieces=[],targets=[],controls=[];
    const centerLabel=(text,size)=>Math.max(12,300-String(text).length*size*.28);
    const turnText=m.status==='over'||s.over?(s.winner===-1?`Tie · ${s.scores[0]} pairs each`:`${m.players?.[s.winner]?.name||t('turn',{n:s.winner+1})} wins`):(m.players?.[s.turn]?.name||t('turn',{n:s.turn+1}));
    const labels=[{id:'title',text:t('title'),x:centerLabel(t('title'),26),y:24,font_size:26},
      {id:'turn',text:turnText,x:centerLabel(turnText,18),y:60,font_size:18}];
    if(KIND==='pig'||KIND==='memory'){const scoreText=t('score',{a:s.scores[0],b:s.scores[1]});labels.push({id:'score',text:scoreText,x:centerLabel(scoreText,18),y:88,font_size:18});}
    if(KIND==='memory'){const hint=m.status==='over'||s.over?'All pairs found · round complete.':`${(s.matched||[]).length/2} pairs found · choose two cards.`;labels.push({id:'hint',text:hint,x:centerLabel(hint,18),y:126,font_size:18,color:'#d8e8d9'});}
    const keyOf=move=>Object.keys(move).map(k=>k+'_'+move[k]).join('_');
    if(KIND==='nim'){
      for(let i=0;i<s.board[0];i++)pieces.push({id:'stone_'+i,type:'p0',board:'main',position:{x:35+(i%5)*95,y:50+Math.floor(i/5)*105},text:String(i+1)});
      legal.forEach(move=>controls.push({id:keyOf(move),kind:'button',label:t('take',{n:move.take})}));
    }else if(KIND==='pig'){
      pieces.push({id:'die',type:'die',board:'main',position:{x:120,y:130},text:String(s.roll||1),rotation:s.roll*15,scale:1});
      pieces.push({id:'total',type:'total',board:'main',position:{x:340,y:130},text:String(s.total)});
      legal.forEach(move=>controls.push({id:keyOf(move),kind:'button',label:t(move.action)}));
    }else if(KIND==='mancala'){
      s.board.forEach((n,cell)=>pieces.push({id:'stonepit_'+cell,type:cell===6||cell===13?'store':'p0',board:'main',position:{cell:String(cell)},text:String(n),actions:legal.some(move=>move.pit===cell)?['tap']:[]}));
      legal.forEach(move=>targets.push({id:keyOf(move),board:'main',position:{cell:String(move.pit)},label:t('sow',{n:move.pit+1})}));
    }else{
      s.board.forEach((value,cell)=>{
        if(KIND==='memory')pieces.push({id:'card_'+cell,type:value===-1?'back':value%2?'red-card':'black-card',board:'main',position:{x:120+(cell%4)*120,y:215+Math.floor(cell/4)*96},text:value===-1?'':['◆','●','▲','✦','☀','♣','♥','★'][value],face:value===-1?'back':'front',scale:s.matched.includes(cell)?0.86:1,opacity:s.matched.includes(cell)?0.6:1,actions:legal.some(move=>move.cell===cell)?['tap']:[],animation:{kind:'move',key:`memory-${cell}-${value}`,duration_ms:180}});
        else if(value!==-1)pieces.push({id:'piece_'+cell,type:'p'+value,board:'main',position:{cell:String(cell)},text:KIND==='tictactoe'?(value===0?'X':'O'):'',rotation:KIND==='domineering'&&value===1?90:0});
      });
      if(KIND!=='memory')legal.forEach(move=>targets.push({id:keyOf(move),board:'main',position:{cell:String(KIND==='connect4'?move.column:move.cell)},label:t('cell',{n:(KIND==='connect4'?move.column:move.cell)+1})}));
      if(KIND==='domineering'&&targets.length)pieces.push({id:'domino',type:'domino',board:'tray',position:{x:60,y:70},rotation:s.turn?90:0,draggable:true,move_targets:targets.map(p=>p.id),actions:['move']});
    }
    // Appearance alone is not an interaction. Placed counters, marks and dice
    // stay passive; legal destinations and enabled buttons supply their hints.
    for(const piece of pieces)if(!piece.actions)piece.actions=[];
    const scene={pieces,targets,controls,labels};
    const out={scene,local_state:{}};
    if(message.type==='ui_event'&&active&&['tap','drop'].includes(message.event.type)){
      const e=message.event;
      let id=e.type==='drop'?e.target_id:e.id;
      // Covered cards are pieces, so a piece tap is equivalent to the cell's
      // legal target. No rule or hidden state is calculated in presentation.
      if(KIND==='memory'&&id&&id.startsWith('card_'))id='cell_'+id.slice(5);
      if(KIND==='mancala'&&id&&id.startsWith('stonepit_'))id='pit_'+id.slice(9);
      const move=legal.find(option=>keyOf(option)===id);
      if(move)out.make_move=move;
    }
    return out;
  }
};
