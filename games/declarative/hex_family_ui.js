// Shared presentation reducer for Chinese Checkers, Abalone and Havannah.
// Every scene is a fresh snapshot; all choices are server-provided legal moves.
const gameUI={reduce(message,localState){
  const m=message.type==='ui_event'?message.state_changed:message;
  const s=m.view||m.state,strings=Object.assign({},SOURCE_STRINGS,m.strings||{});
  const t=(key,args={})=>(strings[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(args[k]===undefined?'':args[k]));
  const active=m.status==='ongoing'&&!m.replay&&m.acting_for_player_index!==null&&m.acting_for_player_index!==undefined;
  const legal=active?(s.legal||[]):[],pieces=[],targets=[],controls=[],paths=[];
  const moveKey=move=>'move_'+Object.keys(move).map(k=>k+'_'+(Array.isArray(move[k])?move[k].join('.'):String(move[k]))).join('_');
  const previousSnapshot=localState&&localState.board_snapshot;
  const snapshot=KIND==='catan'?{
    settlements:(s.settlements||[]).slice(),cities:(s.cities||[]).slice(),roads:(s.roads||[]).slice()
  }:{board:Array.isArray(s.board)?s.board.slice():null};
  const pulseMove=Number.isSafeInteger(m.move_count)?m.move_count:Number.isSafeInteger(s.turns)?s.turns:0;
  let pulseKeys=localState&&localState.pulse&&localState.pulse.move_count===pulseMove
    ?Object.assign({},localState.pulse.keys||{}):{};
  if(!(localState&&localState.pulse&&localState.pulse.move_count===pulseMove)&&previousSnapshot){
    if(KIND==='catan'){
      for(let node=0;node<(s.settlements||[]).length;node++){
        const owner=s.settlements[node],priorOwner=previousSnapshot.settlements&&previousSnapshot.settlements[node];
        const cityChanged=Boolean(s.cities[node]&&!(previousSnapshot.cities&&previousSnapshot.cities[node]));
        if(owner>=0&&(priorOwner!==owner||cityChanged))pulseKeys['settlement_'+node]=`catan-${pulseMove}-${node}`;
      }
    }else if(Array.isArray(previousSnapshot.board)&&Array.isArray(snapshot.board)){
      snapshot.board.forEach((value,cell)=>{
        if(value>=0&&previousSnapshot.board[cell]===-1)pulseKeys['piece_'+cell]=`${KIND}-${pulseMove}-${cell}`;
      });
    }
  }
  let local=localState&&localState.move_count===m.move_count?localState:{};
  let selected=Array.isArray(local.selected)?local.selected.slice():[];
  const addTarget=(move,board,position,label,size)=>targets.push({id:moveKey(move),board,position,label:label||'',hit_area:{x:-size/2,y:-size/2,width:size,height:size}});
  const playerNames=(m.players||[]).map(p=>p.name||('Player '+(p.player_index+1)));
  const labels=[{id:'title',text:t('title'),x:24,y:22,font_size:26},
    {id:'status',text:statusText(),x:24,y:58,font_size:17}];
  function statusText(){
    if(m.status==='over'||s.over)return s.winner>=0?t('winner',{n:s.winner+1}):t('finished');
    if(KIND==='catan')return t('phase_'+s.phase,{n:s.turn+1,roll:s.lastRoll||0});
    if(KIND==='chinese_checkers')return t('turn',{n:playerNames[s.turn]||s.turn+1,done:s.scores[s.turn]||0});
    if(KIND==='abalone')return t('turn_with_score',{n:playerNames[s.turn]||s.turn+1,score:s.ejected[s.turn]||0});
    return t('turn',{n:playerNames[s.turn]||s.turn+1});
  }
  function piece(id,type,board,position,extra={}){pieces.push(Object.assign({id,type,board,position,actions:[]},extra));}

  if(KIND==='catan'){
    const tileBoard=GEOMETRY.tile_cells;
    const board=GEOMETRY.board;
    (s.roads||[]).forEach((owner,edge)=>{if(owner<0)return;const [a,b]=GEOMETRY.edges[edge],na=GEOMETRY.nodes[a],nb=GEOMETRY.nodes[b];paths.push({id:'road_'+edge,points:[{x:board.x+na.x,y:board.y+na.y},{x:board.x+nb.x,y:board.y+nb.y}],color:GEOMETRY.player_colors[owner],width:8});});
    (s.settlements||[]).forEach((owner,node)=>{if(owner<0)return;const p=GEOMETRY.nodes[node],animationKey=pulseKeys['settlement_'+node];piece('settlement_'+node,s.cities[node]?'city':'settlement','island',{x:p.x,y:p.y},{text:s.cities[node]?'C':'',aria_label:s.cities[node]?'City':'Settlement',...(animationKey?{animation:{kind:'pulse',key:animationKey}}:{})});});
    (s.tileData||[]).forEach((tile,index)=>{if(index===s.robber)piece('robber','robber','island',{cell:String(index)},{text:'R',actions:[]});});
    for(const move of legal){
      if(move.action==='settle'){
        const p=GEOMETRY.nodes[move.node];addTarget(move,'island',{x:p.x,y:p.y},'＋',32);
      }else if(move.action==='road'){
        if(s.phase==='setup_road'||Number.isInteger(move.edge)){
          const [a,b]=GEOMETRY.edges[move.edge],na=GEOMETRY.nodes[a],nb=GEOMETRY.nodes[b];addTarget(move,'island',{x:(na.x+nb.x)/2,y:(na.y+nb.y)/2},'•',24);
        }
      }else if(move.action==='robber')addTarget(move,'island',{cell:String(move.tile)},move.victim<0?'R':'↗',40);
      else controls.push({id:moveKey(move),kind:'button',label:actionLabel(move)});
    }
    const resourceText=(s.resources||[]).map((row,i)=>`${playerNames[i]||('P'+(i+1))}: ${row?row.map((n,r)=>RESOURCE_MARKS[r]+n).join(' '):t('cards_hidden',{n:s.handSizes?.[i]||0})}`).join('   ');
    labels.push({id:'resources',text:resourceText,x:24,y:494,font_size:14});
    labels.push({id:'score',text:(s.resources||[]).map((_,i)=>`${playerNames[i]||('P'+(i+1))} ${GEOMETRY.player_colors[i]} ${catanPoints(i)}`).join('   '),x:24,y:520,font_size:14});
  }else if(KIND==='chinese_checkers'||KIND==='abalone'){
    const legalFrom=move=>Array.isArray(move.from)?move.from:[move.from];
    for(let cell=0;cell<s.board.length;cell++)if(s.board[cell]>=0){
      const fromLegal=legal.some(move=>legalFrom(move).includes(cell));
      const animationKey=pulseKeys['piece_'+cell];
      piece('piece_'+cell,'p'+s.board[cell],'main',{cell:String(cell)},{selected:selected.includes(cell),actions:active&&s.board[cell]===s.turn&&fromLegal?['tap']:[],aria_label:t('marble',{n:s.board[cell]+1,cell:cell+1}),...(animationKey?{animation:{kind:'pulse',key:animationKey}}:{})});
    }
    if(selected.length){
      const matches=legal.filter(move=>{
        const from=legalFrom(move).slice().sort((a,b)=>a-b),chosen=selected.slice().sort((a,b)=>a-b);
        return from.length===chosen.length&&from.every((v,i)=>v===chosen[i]);
      });
      for(const move of matches){
        const dest=Array.isArray(move.to)?move.to[0]:move.to;
        addTarget(move,'main',{cell:String(dest)},KIND==='abalone'?['←','↖','↗','→','↘','↙'][move.dir]:'',KIND==='chinese_checkers'?25:40);
      }
    }
    if(KIND==='chinese_checkers')for(const move of legal)if(move.action==='pass')controls.push({id:moveKey(move),kind:'button',label:t('pass_turn')});
  }else if(KIND==='havannah'){
    for(let cell=0;cell<s.board.length;cell++)if(s.board[cell]>=0){const animationKey=pulseKeys['piece_'+cell];piece('piece_'+cell,'p'+s.board[cell],'main',{cell:String(cell)},{aria_label:t('stone',{n:s.board[cell]+1}),...(animationKey?{animation:{kind:'pulse',key:animationKey}}:{})});}
    for(const move of legal)addTarget(move,'main',{cell:String(move.cell)},'',42);
  }

  function actionLabel(move){
    if(move.action==='roll')return t('roll');if(move.action==='end_turn')return t('end_turn');
    if(move.action==='discard')return t('discard_resource',{r:t('resource_'+move.resource)});
    if(move.action==='trade')return t('bank_trade',{give:t('resource_'+move.give),want:t('resource_'+move.want)});
    if(move.action==='city')return t('upgrade_city',{n:move.node+1});
    if(move.action==='settle')return t('build_settlement',{n:move.node+1});
    if(move.action==='road')return t('build_road',{n:move.edge+1});
    if(move.action==='pass')return t('pass_turn');
    return move.action||t('move');
  }
  function catanPoints(seat){return (s.settlements||[]).reduce((sum,owner,node)=>sum+(owner===seat?(s.cities[node]?2:1):0),0);}
  const nextLocal={selected,move_count:m.move_count,board_snapshot:snapshot,pulse:{move_count:pulseMove,keys:pulseKeys}};
  let output={scene:{pieces,targets,controls,labels,paths},local_state:nextLocal};
  if(message.type==='ui_event'&&active){
    const event=message.event||{};
    if(event.type==='tap'){
      const id=String(event.id||'');
      if((KIND==='chinese_checkers'||KIND==='abalone')&&id.startsWith('piece_')){
        const cell=Number(id.slice(6));
        if(KIND==='chinese_checkers')selected=[cell];
        else if(selected.includes(cell))selected=selected.filter(v=>v!==cell);
        else if(selected.length<3)selected.push(cell);
        const updatedLocal={...nextLocal,selected:selected.slice()};
        output={scene:null,local_state:updatedLocal};
      }else{
        const move=legal.find(option=>moveKey(option)===id);
        if(move)output.make_move=move;
      }
    }
  }
  if(!output.scene){
    // Rebuild once with the new selection; there is no rule or state mutation here.
    const next=gameUI.reduce(m,output.local_state||nextLocal);
    output.scene=next.scene;
  }
  return output;
}};
