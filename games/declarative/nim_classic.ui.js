const gameUI={
 reduce(message,previous){
  const m=message.type==='ui_event'?message.state_changed:message,v=m.view||m.state;
  const strings={...SOURCE_STRINGS,...m.strings};
  const t=(key,values={})=>String(strings[key]||key).replace(/\{(\w+)\}/g,(_,k)=>String(values[k]??''));
  const active=m.status==='ongoing'&&!m.replay&&v.winner===null&&
    m.acting_for_player_index===v.seat&&m.turn_of_player_indices?.includes(v.seat);
  const name=i=>m.players?.[i]?.name||m.players?.[i]?.display_name||String(i+1);
  let selected=previous?.moveCount===m.move_count&&previous?.seat===v.seat?previous.selected:null;
  if(!Number.isInteger(selected)||!v.piles[selected])selected=null;
  const click=message.type==='ui_event'&&message.event?.type==='tap'?message.event.id:'';
  if(active&&/^pile_[0-2]$/.test(click)&&v.piles[Number(click.slice(5))]>0)selected=Number(click.slice(5));
  const scene={pieces:[],labels:[],controls:[]};
  const piece=(id,type,x,y,extra={})=>scene.pieces.push({id,type,board:'surface',position:{x,y},actions:[],...extra});
  const label=(id,text,x,y,size=17,color='#f5eddb')=>scene.labels.push({id,text:String(text),x,y,font_size:size,color});
  piece('polish_background','table_art',240,350,{z:-100});
  label('title',t('title'),26,22,28);
  for(let i=0;i<2;i++){
   const x=26+i*222;
   piece('player_'+i,m.status==='ongoing'&&v.seat===i?'seat_active':'seat_idle',x+67,108);
   label('player_name_'+i,name(i).slice(0,16),x+11,92,15,i===v.seat?'#f7dfa1':'#d0dfd7');
  }
  label('status',v.winner!==null?t('winner',{name:name(v.winner)}):t('turn',{name:name(v.seat)}),28,153,22,'#ead9a3');
  label('hint',t('hint'),28,185,14,'#abcbbc');
  for(let i=0;i<3;i++){
   const y=246+i*78,n=v.piles[i];
   piece('pile_'+i,selected===i?'heap_selected':'heap',240,y,{actions:active&&n>0?['tap']:[],aria_label:t('pile_count',{pile:i+1,n}),opacity:n>0?1:.4});
   label('pile_label_'+i,t('pile',{pile:i+1}),52,y-20,16,selected===i?'#173d39':'#f4edda');
   label('pile_count_'+i,String(n),52,y+2,19,selected===i?'#173d39':'#c8decf');
   for(let j=0;j<n;j++)piece('stone_'+i+'_'+j,'nim_gem',184+j*34,y,{opacity:selected===i?1:.8});
  }
  label('quantity',selected===null?t('choose_pile'):t('choose_amount',{pile:selected+1}),35,453,17,'#bddbca');
  if(active&&selected!==null){
   for(let take=1;take<=v.piles[selected];take++){
    const i=take-1;piece('take_'+take,'take_button',98+(i%3)*142,515+Math.floor(i/3)*65,
      {actions:['tap'],text:t('take',{n:take}),aria_label:t('take_from',{n:take,pile:selected+1})});
   }
  }
  const result={scene,local_state:{moveCount:m.move_count,seat:v.seat,selected}};
  if(active&&selected!==null&&/^take_[1-7]$/.test(click)){
   const take=Number(click.slice(5));if(take<=v.piles[selected])result.make_move={pile:selected,take};
  }
  return result;
 }
};
