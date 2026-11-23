// Prefix with KIND and SOURCE_STRINGS when packaging. Same script runs in
// QuickJS on native hosts and in the portal's isolated presentation worker.
const gameUI = {
  getLastMoveAnimations(view, scene) {
    // Old pinned rules did not retain a move. Let their host keep its fallback.
    if(KIND!=='connect4'||!Object.prototype.hasOwnProperty.call(view,'last_move'))return null;
    const move=view.last_move;
    if(!move)return [];
    const piece=scene.pieces.find(piece=>piece.id==='piece_'+move.cell);
    if(!piece)return [];
    // The board has six rows in 400 logical pixels. Start directly above the
    // chosen column, even when the preceding disc landed in another column.
    const unit=400/6;
    return [{piece_id:piece.id,duration_ms:600,path:[
      {board:'main',position:{x:(move.column+.5)*unit,y:-unit/2}},
      {board:piece.board,position:piece.position}
    ]}];
  },
  reduce(message, localState) {
    const m=message.type==='ui_event'?message.state_changed:message;
    const s=m.view||m.state;
    const strings=Object.assign({},SOURCE_STRINGS,m.strings||{});
    const t=(key,args={})=>(strings[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(args[k]===undefined?'':args[k]));
    const active=m.status==='ongoing'&&!m.replay&&m.acting_for_player_index!==null&&m.acting_for_player_index!==undefined;
    const legal=active?(s.legal||[]):[];
    const pieces=[],targets=[],controls=[],paths=[];
    const previousHexBoard=KIND==='hex'&&Array.isArray(localState?.hex_board)?localState.hex_board:null;
    const hexBoardSnapshot=KIND==='hex'&&Array.isArray(s.board)?s.board.slice():null;
    const addedHexCells=previousHexBoard&&hexBoardSnapshot
      ?hexBoardSnapshot.flatMap((value,cell)=>value!==-1&&previousHexBoard[cell]===-1?[cell]:[]):[];
    const moveKey=Number.isSafeInteger(m.move_count)?m.move_count:Number.isSafeInteger(s.turns)?s.turns:0;
    let hexPulse=KIND==='hex'&&localState?.hex_pulse?.move_count===moveKey&&
      previousHexBoard&&hexBoardSnapshot&&JSON.stringify(previousHexBoard)===JSON.stringify(hexBoardSnapshot)
      ?localState.hex_pulse:null;
    if(!m.replay&&addedHexCells.length===1)
      hexPulse={cell:addedHexCells[0],move_count:moveKey,key:`hex-${moveKey}-${addedHexCells[0]}`};
    let ataxxMotion={};
    const playerName=seat=>m.players?.[seat]?.name||t('turn',{n:seat+1});
    const shortName=seat=>{const chars=Array.from(playerName(seat));return chars.length>14?chars.slice(0,13).join('')+'…':chars.join('');};
    const result=(KIND==='connect6'||KIND==='ataxx')&&(m.status==='over'||s.over)
      ? s.winner===-1?t('draw'):Number.isInteger(s.winner)&&s.winner>=0
        ?t('winner',{name:shortName(s.winner)}):t('finished') : null;
    const labels=[{id:'title',text:t('title'),x:24,y:18,font_size:26},
      {id:'turn',text:result||((m.status==='over'||s.over)?t('finished'):t('turn',{n:s.turn+1})),x:24,y:54,font_size:(KIND==='connect6'||KIND==='ataxx')?22:18}];
    if(KIND==='connect6'&&s.pending)labels.push({id:'turn-progress',text:t('place_second'),x:24,y:82,font_size:14});
    if(KIND==='connect6')for(let i=0;i<19;i++){
      const offset=20+i*40;
      paths.push({id:'row_'+i,points:[{x:44,y:100+offset},{x:764,y:100+offset}],color:'#624825',width:1.5});
      paths.push({id:'column_'+i,points:[{x:24+offset,y:120},{x:24+offset,y:840}],color:'#624825',width:1.5});
    }
    if(KIND==='pig'||KIND==='memory')labels.push({id:'score',text:t('score',{a:s.scores[0],b:s.scores[1]}),x:350,y:54,font_size:20});
    const keyOf=move=>Object.keys(move).map(k=>k+'_'+move[k]).join('_');
    let selectedFrom=KIND==='ataxx'&&localState&&localState.move_count===m.move_count&&localState.viewer===m.my_player_index
      &&Number.isInteger(localState.selectedFrom)?localState.selectedFrom:null;
    const event=message.type==='ui_event'?message.event:null;
    if(KIND==='ataxx'&&active&&event&&event.type==='tap'&&event.id) {
      const source=/^select_(\d+)$/.exec(event.id);
      if(source) {
        const cell=Number(source[1]);
        if(legal.some(move=>move.from===cell))selectedFrom=selectedFrom===cell?null:cell;
      }
    }
    if(KIND==='nim'){
      for(let i=0;i<s.board[0];i++)pieces.push({id:'stone_'+i,type:'p0',board:'main',position:{x:35+(i%5)*95,y:50+Math.floor(i/5)*105},text:String(i+1)});
      legal.forEach(move=>controls.push({id:keyOf(move),kind:'button',label:t('take',{n:move.take})}));
    }else if(KIND==='pig'){
      pieces.push({id:'die',type:'die',board:'main',position:{x:120,y:130},die_value:s.roll||1,text:String(s.roll||1),rotation:s.roll*15,scale:1});
      pieces.push({id:'total',type:'total',board:'main',position:{x:340,y:130},text:String(s.total)});
      legal.forEach(move=>controls.push({id:keyOf(move),kind:'button',label:t(move.action)}));
    }else if(KIND==='mancala'){
      s.board.forEach((n,cell)=>pieces.push({id:'stonepit_'+cell,type:cell===6||cell===13?'store':'p0',board:'main',position:{cell:String(cell)},text:String(n),actions:legal.some(move=>move.pit===cell)?['tap']:[]}));
      legal.forEach(move=>targets.push({id:keyOf(move),board:'main',position:{cell:String(move.pit)},label:t('sow',{n:move.pit+1})}));
    }else if(KIND==='ataxx'){
      const adjacent=localState&&localState.viewer===m.my_player_index&&Array.isArray(localState.motionBoard)
        &&Number.isInteger(localState.move_count)&&Number.isInteger(m.move_count)
        &&Math.abs(m.move_count-localState.move_count)<=1;
      const previous=adjacent?localState.motionBoard:[];
      const oldIds=adjacent?localState.motionIds:{};
      let serial=adjacent?localState.motionSerial:0;
      const ids={};
      s.board.forEach((value,cell)=>{
        if(value!==-1&&previous[cell]!==undefined&&previous[cell]!==-1)ids[cell]=oldIds[cell];
      });
      const removed=previous.flatMap((value,cell)=>value!==-1&&s.board[cell]===-1?[cell]:[]);
      const added=s.board.flatMap((value,cell)=>value!==-1&&previous[cell]===-1?[cell]:[]);
      if(removed.length===1&&added.length===1&&previous[removed[0]]===s.board[added[0]])
        ids[added[0]]=oldIds[removed[0]];
      s.board.forEach((value,cell)=>{
        if(value!==-1&&!ids[cell])ids[cell]=adjacent?'piece_motion_'+serial++:'piece_'+cell;
      });
      ataxxMotion={motionBoard:s.board.slice(),motionIds:ids,motionSerial:serial};
      s.board.forEach((value,cell)=>{
        if(value!==-1)pieces.push({id:ids[cell],type:'p'+value,board:'main',position:{cell:String(cell)},
          text:value===0?'○':'◆',aria_label:t('piece_at',{name:playerName(value),r:Math.floor(cell/7)+1,c:cell%7+1}),
          scale:selectedFrom===cell?1.12:1,actions:[]});
        if(active&&legal.some(move=>move.from===cell))
          targets.push({id:'select_'+cell,board:'main',position:{cell:String(cell)},
            color:'#00000000',aria_label:t('select_piece',{r:Math.floor(cell/7)+1,c:cell%7+1})});
      });
      if(selectedFrom!==null)legal.filter(move=>move.from===selectedFrom).forEach(move=>
        targets.push({id:keyOf(move),board:'main',position:{cell:String(move.to)},label:'•',
          aria_label:t('move_to',{r:Math.floor(move.to/7)+1,c:move.to%7+1})}));
      const counts=[0,1].map(player=>s.board.filter(value=>value===player).length);
      labels.push({id:'score',text:t('score',{a:counts[0],b:counts[1]}),x:275,y:520,font_size:20});
    }else{
      s.board.forEach((value,cell)=>{
        if(KIND==='memory')pieces.push({id:'card_'+cell,type:value===-1?'back':'card',board:'main',position:{cell:String(cell)},text:value===-1?'':String(value+1),face:value===-1?'back':'front',scale:s.matched.includes(cell)?0.86:1,opacity:s.matched.includes(cell)?0.6:1,actions:legal.some(move=>move.cell===cell)?['tap']:[]});
        else if(value!==-1)pieces.push({id:'piece_'+cell,type:'p'+value,board:'main',position:{cell:String(cell)},text:KIND==='tictactoe'?(value===0?'X':'O'):'',rotation:KIND==='domineering'&&value===1?90:0,...(hexPulse?.cell===cell?{animation:{kind:'pulse',key:hexPulse.key,duration_ms:560}}:{})});
      });
      legal.forEach(move=>targets.push(KIND==='connect6'
        ?{id:keyOf(move),board:'main',position:{cell:String(move.cell)},asset:'connect6_cell',
          aria_label:t('position',{r:Math.floor(move.cell/19)+1,c:move.cell%19+1})}
        :{id:keyOf(move),board:'main',position:{cell:String(KIND==='connect4'?move.column:move.cell)},label:t('cell',{n:(KIND==='connect4'?move.column:move.cell)+1})}));
      if(KIND==='domineering'&&targets.length)pieces.push({id:'domino',type:'domino',board:'tray',position:{x:60,y:70},rotation:s.turn?90:0,move_targets:targets.map(p=>p.id),actions:['move']});
    }
    // Appearance alone is not an interaction. Placed counters, marks and dice
    // stay passive; legal destinations and enabled buttons supply their hints.
    for(const piece of pieces)if(!piece.actions)piece.actions=[];
    const scene={pieces,targets,controls,labels,paths};
    const localPresentationState=KIND==='ataxx'?{move_count:m.move_count,viewer:m.my_player_index,selectedFrom,...ataxxMotion}:{};
    if(KIND==='hex')Object.assign(localPresentationState,{hex_board:hexBoardSnapshot,hex_pulse:hexPulse});
    const out={scene,local_state:localPresentationState};
    if(message.type==='ui_event'&&active&&['tap','drop'].includes(message.event.type)){
      const e=message.event;
      let id=e.type==='drop'?e.target_id:e.id;
      if(KIND==='ataxx'&&id) {
        const move=legal.find(option=>keyOf(option)===id&&option.from===selectedFrom);
        if(move)out.make_move=move;
        return out;
      }
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
