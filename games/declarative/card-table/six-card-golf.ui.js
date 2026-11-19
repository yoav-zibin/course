const SOURCE_STRINGS={
 title:"Six-Card Golf", phase_flip:"Choose two cards to turn face up.", phase_draw:"Draw from the stock or discard pile.", phase_replace:"Hidden card: discard and reveal. Face-up card: replace.", phase_discard:"Choose one of your face-down cards to reveal.", waiting:"Waiting for {name}…", your_turn:"Your turn", draw_stock:"Draw from stock", draw_discard:"Take discard", discard_flip:"Discard drawn card and reveal a hidden card", cancel:"Cancel", flip_selected:"Turn over selected cards", selected:"{count} selected — tap one more card", score:"Known score: {score}", final_score:"Final score: {score}", stock:"Stock · {count}", discard:"Discard", drawn:"Drawn card", card_hidden:"Face-down card", card_named:"{rank} of {suit}", win:"{name} wins · {score}", tie:"Tie · {score}",
 suit_clubs:"Clubs",suit_diamonds:"Diamonds",suit_hearts:"Hearts",suit_spades:"Spades", server_not_seated:"not seated", server_game_over:"game over", server_not_your_flip:"not your flip", server_flip_2_cards:"flip 2 cards", server_pick_2_different_cards:"pick 2 different cards", server_already_face_up:"already face up", server_not_in_play:"not in play", server_not_your_turn:"not your turn", server_bad_move:"bad move", server_already_drew:"already drew", server_draw_stock_or_discard:"draw stock or discard", server_discard_empty:"discard empty", server_stock_empty:"stock empty", server_draw_first:"draw first", server_pick_a_card:"pick a card", server_only_stock_draw_can_flip:"only stock draw can flip", server_unknown_move:"unknown move"
};
function golfText(m,key,args={}){let s=(m.strings||{})[key]||SOURCE_STRINGS[key]||key;return s.replace(/\{(\w+)\}/g,(_,k)=>args[k]===undefined?"":String(args[k]));}
function golfRank(r){return r===1?"A":r===11?"J":r===12?"Q":r===13?"K":String(r);}
function golfValue(r){return r===1?1:r>=2&&r<=10?r:r===12?10:0;}
function golfKnownScore(hand){let score=0;for(let i=0;i<3;i++){const a=hand[i],b=hand[i+3];if(a&&b&&a.up&&b.up&&a.r===b.r)continue;if(a&&a.up)score+=golfValue(a.r);if(b&&b.up)score+=golfValue(b.r);}return score;}
function golfCenterX(text,font,center=380){return Math.max(12,center-String(text).length*font*.28);}
var gameUI={reduce(message,localState){
 const m=message.type==="ui_event"?(message.state_changed||{}):message,v=m.view||m.state||{},e=message.type==="ui_event"?(message.event||{}):{};
 const active=m.status==="ongoing"&&!m.replay&&Number.isInteger(m.acting_for_player_index),seat=m.acting_for_player_index;
 const n=(m.players||[]).length,me=Number.isInteger(m.my_player_index)?m.my_player_index:0;
 const old=localState&&localState.moveCount===m.move_count?localState:{};
 let selected=Array.isArray(old.selected)?old.selected.slice(0,1):[],make_move;
 const hands=v.hands||[],phase=v.phase,hand=hands[seat]||[];
 const cardId=uid=>`card-${uid}`;
 const rankName=r=>golfRank(r);
 const cardArt=(c)=>`face-${golfRank(c.r)}-${c.s}`;
 if(e.type==="tap"&&e.id==="stock-reshuffle"&&active&&phase==="play"&&!v.drew)make_move={kind:"draw",from:"stock"};
 if(e.type==="tap"&&e.id&&e.id.startsWith("card-")&&active){
   const uid=e.id.slice(5);
   const index=hand.findIndex(c=>String(c.uid)===uid);
   if(phase==="flip"&&index>=0&&!hand[index].up){
     if(selected.length===0)selected=[index];else if(selected[0]!==index){make_move={kind:"flip",idxs:[selected[0],index]};selected=[];}
   }else if(phase==="play"&&v.drew&&!v.drew.hidden&&index>=0){
     if(v.drew.from==="stock"&&!hand[index].up)make_move={kind:"discardFlip",idx:index};
     else make_move={kind:"replace",idx:index};
   }else if(phase==="play"&&!v.drew){
     if(v.stockTopUid!=null&&String(v.stockTopUid)===uid)make_move={kind:"draw",from:"stock"};
     else if(v.discard&&v.discard.length&&String(v.discard[v.discard.length-1].uid)===uid)make_move={kind:"draw",from:"discard"};
   }
 }
 const pieces=[],labels=[],controls=[];
 const opponents=n===2?[[380,245]]:n===3?[[250,210],[510,210]]:n===4?[[220,210],[540,210],[220,500]]:n===5?[[180,205],[380,205],[580,205],[200,485]]:[[150,205],[380,205],[610,205],[150,470],[610,470]];
 const cardScale=n===2?1:n===3?0.70:n===4?0.62:n===5?0.56:0.50,colGap=Math.round(88*cardScale),rowGap=Math.round(66*cardScale);
 const positions=new Array(n);positions[me]=[380,n===2?700:575];let opponent=0;for(let pi=0;pi<n;pi++)if(pi!==me)positions[pi]=opponents[opponent++];
 const faceAsset=(c)=>`face-${golfRank(c.r)}-${c.s}`;
 const faceName=(c)=>`${rankName(c.r)} ${["♣","♦","♥","♠"][c.s]}`;
 const faceSuit=(c)=>golfText(m,["suit_clubs","suit_diamonds","suit_hearts","suit_spades"][c.s]);
 const title=golfText(m,"title");labels.push({id:"title",text:title,x:golfCenterX(title,30),y:18,font_size:30,color:"#fff1d6"});
 const statusText=m.status==="over"?((v.winner==null||(v.scores||[]).filter(score=>score===Math.min(...v.scores)).length>1)?golfText(m,"tie",{score:Math.min(...(v.scores||[]))}):golfText(m,"win",{name:(m.players[v.winner]||{}).name,score:(v.scores||[])[v.winner]})):active?golfText(m,"your_turn"):golfText(m,"waiting",{name:(m.players[(m.turn_of_player_indices||[])[0]]||{}).name||"…"});labels.push({id:"round-status",text:statusText,x:golfCenterX(statusText,18),y:52,font_size:18,color:"#b8dcbd"});
 for(let pi=0;pi<n;pi++){
   const [cx,cy]=positions[pi],isMe=pi===me,canTouch=active&&seat===pi,upperSeat=cy<380;
   const person=(m.players[pi]||{}).name||`Player `+(pi+1);
   const halfCardHeight=53.5*cardScale;
   const nameY=upperSeat?(n===2?100:cy-rowGap-halfCardHeight-18):cy+rowGap+halfCardHeight+21;
   const scoreY=upperSeat?(n===2?390:cy+rowGap+halfCardHeight+15):nameY+21;
   labels.push({id:`player-`+pi,text:person,x:golfCenterX(person,20,cx),y:nameY,font_size:20,color:canTouch?"#f2c46d":"#fff1d6"});
   const scoreText=v.phase==="over"&&Array.isArray(v.scores)?golfText(m,"final_score",{score:v.scores[pi]}):golfText(m,"score",{score:golfKnownScore(hands[pi]||[])});labels.push({id:`score-`+pi,text:scoreText,x:golfCenterX(scoreText,16,cx),y:scoreY,font_size:16,color:v.phase==="over"?"#d6c8aa":"#d6c8aa"});
   for(let j=0;j<6;j++){
     const c=(hands[pi]||[])[j];if(!c||c.uid==null)continue;
     const row=j<3?0:1,col=j%3,x=cx+(col-1)*colGap,y=cy+(row?rowGap:-rowGap),id=cardId(c.uid);
     const isSelected=canTouch&&selected[0]===j;
     let enabled=false;
     if(canTouch&&phase==="flip")enabled=!c.up;
     if(canTouch&&phase==="play"&&v.drew&&!v.drew.hidden)enabled=true;
     pieces.push({id,type:"card",board:"table",position:{x,y},scale:cardScale,face:c.up?"front":"back",asset:c.up?faceAsset(c):"card_back",text:"",selected:isSelected,actions:enabled?["tap"]:[],aria_label:c.up?golfText(m,"card_named",{rank:rankName(c.r),suit:faceSuit(c)}):golfText(m,"card_hidden"),animation:{kind:"move",key:`golf:${id}:${c.up?"up":"down"}`,duration_ms:520}});
   }
 }
 const stackX=275,discardX=380,drawnX=485,pileY=n===2?470:360;
 if(v.stockTopUid!=null&&v.stockCount>0){const id=cardId(v.stockTopUid);pieces.push({id,type:"card",board:"table",position:{x:stackX,y:pileY},face:"back",asset:"card_back",actions:active&&phase==="play"&&!v.drew?["tap"]:[],aria_label:golfText(m,"stock",{count:v.stockCount}),animation:{kind:"move",key:`golf:${m.move_count}:${id}`,duration_ms:520}});}else if(v.stockCount===0){pieces.push({id:"stock-reshuffle",type:"card",board:"table",position:{x:stackX,y:pileY},face:"back",asset:"card_back",actions:active&&phase==="play"&&!v.drew?["tap"]:[],aria_label:golfText(m,"stock",{count:0})});}
 if(v.discard&&v.discard.length){const c=v.discard[v.discard.length-1],id=cardId(c.uid);pieces.push({id,type:"card",board:"table",position:{x:discardX,y:pileY},face:"front",asset:faceAsset(c),actions:active&&phase==="play"&&!v.drew?["tap"]:[],aria_label:golfText(m,"card_named",{rank:rankName(c.r),suit:faceSuit(c)}),animation:{kind:"move",key:`golf:${m.move_count}:${id}`,duration_ms:520}});}
 if(v.drew){const c=v.drew, id=cardId(c.uid);pieces.push({id,type:"card",board:"table",position:{x:drawnX,y:pileY},face:c.hidden?"back":"front",asset:c.hidden?"card_back":faceAsset(c),aria_label:c.hidden?golfText(m,"card_hidden"):golfText(m,"card_named",{rank:rankName(c.r),suit:faceSuit(c)}),actions:[],animation:{kind:"move",key:`golf:${m.move_count}:${id}`,duration_ms:520}});}
 const stockLabel=golfText(m,"stock",{count:v.stockCount||0}),discardLabel=golfText(m,"discard"),drawnLabel=golfText(m,"drawn");labels.push({id:"stock-label",text:stockLabel,x:golfCenterX(stockLabel,13,stackX),y:n===2?545:445,font_size:13,color:"#fff1d6"});labels.push({id:"discard-label",text:discardLabel,x:golfCenterX(discardLabel,13,discardX),y:n===2?545:445,font_size:13,color:"#fff1d6"});if(v.drew)labels.push({id:"drawn-label",text:drawnLabel,x:golfCenterX(drawnLabel,13,drawnX),y:n===2?545:445,font_size:13,color:"#fff1d6"});
 let hint=m.status==="over"?"All cards revealed · lowest score wins.":golfText(m,"waiting",{name:"…"});
 if(active){if(phase==="flip")hint=selected.length?golfText(m,"selected",{count:1}):golfText(m,"phase_flip");else if(v.drew)hint=v.drew.from==="stock"?"Tap a hidden card to discard and reveal.":golfText(m,"phase_replace");else hint=golfText(m,"phase_draw");}
 labels.push({id:"hint",text:hint,x:golfCenterX(hint,15),y:78,font_size:15,color:"#d7cfb7"});
 for(const piece of pieces)piece.position.x*=600/760;for(const label of labels)label.x*=600/760;
 const result={scene:{pieces,targets:[],labels,controls},local_state:{moveCount:m.move_count,selected}};
 if(make_move)result.make_move=make_move;return result;
}};
