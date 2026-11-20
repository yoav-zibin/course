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
  piece('polish_background','table_art',240,275,{z:-100});
  label('title',t('title'),26,22,28);
  label('status',v.winner!==null?t('winner',{name:name(v.winner)}):t('turn',{name:name(v.seat)}),28,62,20,'#ead9a3');
  label('hint',t('hint'),28,95,14,'#abcbbc');
  for(let i=0;i<3;i++){
   const y=174+i*80,n=v.piles[i];
   piece('pile_'+i,selected===i?'heap_selected':'heap',240,y,{actions:active&&n>0?['tap']:[],aria_label:t('pile_count',{pile:i+1,n}),opacity:n>0?1:.4});
   label('pile_label_'+i,t('pile',{pile:i+1}),42,y-20,17,'#f4edda');
   label('pile_count_'+i,String(n),42,y+4,16,'#b4d2c4');
   for(let j=0;j<n;j++)piece('stone_'+i+'_'+j,'nim_gem',174+j*38,y,{opacity:selected===i?1:.8});
  }
  label('quantity',selected===null?t('choose_pile'):t('choose_amount',{pile:selected+1}),28,380,16,'#bddbca');
  if(active&&selected!==null){
   for(let take=1;take<=v.piles[selected];take++){
    const i=take-1,row=Math.floor(i/4),cols=Math.min(4,v.piles[selected]-row*4),x=240-(cols-1)*54+(i%4)*108;piece('take_'+take,'take_button',x,450+row*60,
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
