// Prefix with KIND and SOURCE_STRINGS when packaging. Same script runs in
// QuickJS on native hosts and in the portal's isolated presentation worker.
const gameUI = {
  reduce(message, localState) {
    const m=message.type==='ui_event'?message.state_changed:message;
    const s=m.view||m.state;
    const strings=Object.assign({},SOURCE_STRINGS,m.strings||{});
    const t=(key,args={})=>(strings[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(args[k]===undefined?'':args[k]));
    const active=m.status!=='over'&&m.acting_for_player_index!==null&&m.acting_for_player_index!==undefined;
    const legal=active?(s.legal||[]):[];
    const pieces=[],targets=[],controls=[];
    const labels=[{id:'title',text:t('title'),x:24,y:18,font_size:26},
      {id:'turn',text:s.over?t('finished'):t('turn',{n:s.turn+1}),x:24,y:54,font_size:18}];
    if(KIND==='pig'||KIND==='memory')labels.push({id:'score',text:t('score',{a:s.scores[0],b:s.scores[1]}),x:350,y:54,font_size:20});
    const keyOf=move=>Object.keys(move).map(k=>k+'_'+move[k]).join('_');
    if(KIND==='nim'){
      for(let i=0;i<s.board[0];i++)pieces.push({id:'stone_'+i,type:'p0',board:'main',position:{x:35+(i%5)*95,y:50+Math.floor(i/5)*105},text:String(i+1)});
      legal.forEach(move=>controls.push({id:keyOf(move),kind:'button',label:t('take',{n:move.take})}));
    }else if(KIND==='pig'){
      pieces.push({id:'die',type:'die',board:'main',position:{x:120,y:130},text:String(s.roll||1),rotation:s.roll*15,scale:1});
      pieces.push({id:'total',type:'total',board:'main',position:{x:340,y:130},text:String(s.total)});
      legal.forEach(move=>controls.push({id:keyOf(move),kind:'button',label:t(move.action)}));
    }else if(KIND==='mancala'){
      s.board.forEach((n,cell)=>pieces.push({id:'stonepit_'+cell,type:cell===6||cell===13?'store':'p0',board:'main',position:{cell:String(cell)},text:String(n)}));
      legal.forEach(move=>targets.push({id:keyOf(move),board:'main',position:{cell:String(move.pit)},label:t('sow',{n:move.pit+1})}));
    }else{
      s.board.forEach((value,cell)=>{
        if(KIND==='memory')pieces.push({id:'card_'+cell,type:value===-1?'back':'card',board:'main',position:{cell:String(cell)},text:value===-1?'':String(value+1),face:value===-1?'back':'front',scale:s.matched.includes(cell)?0.86:1,opacity:s.matched.includes(cell)?0.6:1});
        else if(value!==-1)pieces.push({id:'piece_'+cell,type:'p'+value,board:'main',position:{cell:String(cell)},text:KIND==='tictactoe'?(value===0?'X':'O'):'',rotation:KIND==='domineering'&&value===1?90:0});
      });
      legal.forEach(move=>targets.push({id:keyOf(move),board:'main',position:{cell:String(KIND==='connect4'?move.column:move.cell)},label:t('cell',{n:(KIND==='connect4'?move.column:move.cell)+1})}));
      if(KIND==='domineering'&&active)pieces.push({id:'domino',type:'domino',board:'tray',position:{x:60,y:70},rotation:s.turn?90:0,draggable:true,move_targets:targets.map(p=>p.id)});
    }
    const scene={pieces,targets,controls,labels};
    const out={scene,local_state:{}};
    if(message.type==='ui_event'&&active){
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
