const GAME="old-maid";
const TITLE="Old Maid";
function cardName(c){if(typeof c==='string'){const m=/^(10|[2-9]|A|J|Q|K)([CDSH])$/i.exec(c);if(!m)return c;return m[1].toUpperCase()+({C:'♣',D:'♦',S:'♠',H:'♥'}[m[2].toUpperCase()]||'');}if(c&&typeof c==='object'){const suit={C:'♣',D:'♦',S:'♠',H:'♥'}[c.s]||'♣';return ['?','A','2','3','4','5','6','7','8','9','10','J','Q','K'][c.r]+suit;}const r=c%13+1;return ['A','2','3','4','5','6','7','8','9','10','J','Q','K'][r-1]+['♣','♦','♠','♥'][Math.floor(c/13)];}
function cardType(c){let suit;if(typeof c==='string'){const m=/([CDSH])$/i.exec(c);suit=m?m[1].toUpperCase():'C';}else if(c&&typeof c==='object')suit=String(c.s||'C').toUpperCase();else suit=['C','D','S','H'][Math.floor(Number(c)/13)]||'C';return suit==='D'||suit==='H'?'red-card':'black-card';}
function centeredX(text,font,center=300){return Math.max(16,center-String(text).length*font*.27);}
function shortName(name){return String(name||'Player').length>16?String(name).slice(0,15)+'…':String(name||'Player');}
var gameUI={reduce(message,localState){
const m=message.type==='ui_event'?(message.state_changed||{}):message,v=m.view||m.state||{},e=message.type==='ui_event'?(message.event||{}):{};
const active=m.status==='ongoing'&&!m.replay&&Number.isInteger(m.acting_for_player_index),seat=Number.isInteger(m.acting_for_player_index)?m.acting_for_player_index:(m.my_player_index||0);
const pieces=[],labels=[],controls=[],suits=['♣','♦','♠','♥'],names=(m.players||[]).map(p=>shortName(p.name||p.display_name));
let make_move, next={};
const label=(id,text,y,size=20,x=300,color='#dfede5')=>labels.push({id,text:String(text),x:centeredX(text,size,x),y,font_size:size,color});
const button=(id,text)=>controls.push({id,kind:'button',label:text});
const card=(id,c,x,y,ok=false,extra={})=>pieces.push({id,type:cardType(c),board:'table',position:{x,y},text:cardName(c),face:'front',actions:ok?['tap']:[],aria_label:(ok?'Play ':'')+cardName(c),animation:{kind:'move',key:id+'-'+String(c&&typeof c==='object'?JSON.stringify(c):c).replace(/[^A-Za-z0-9_.:-]/g,'_'),duration_ms:380},...extra});
const hand=(cards,legal,y=490)=>{const cols=Math.min(6,cards.length),rows=Math.ceil(cards.length/6);cards.forEach((c,i)=>{const row=Math.floor(i/6),count=Math.min(6,cards.length-row*6);card('hand-'+c,c,300+(i%6-(count-1)/2)*88,y+row*112,active&&legal.includes(c));});return rows;};
label('title',TITLE,24,30,300,'#fff1d6');
label('turn',m.status==='over'?(GAME==='old-maid'?(names[v.loser]==='You'?'You hold the Old Maid':`${names[v.loser]||'Player'} holds the Old Maid`):Number.isInteger(v.winner)?(names[v.winner]==='You'?'You win':`${names[v.winner]||'Player'} wins`):'Round complete'):active?'Your turn':`Waiting for ${names[v.turnIdx??v.turn??v.cur??(m.turn_of_player_indices||[])[0]]||'player'}`,70);
if(GAME==='crazy-eights'){
 const cards=v.hand||[],legal=v.playable||[];let pending=localState&&localState.moveCount===m.move_count?localState.pendingEight:null;
 if(!legal.includes(pending))pending=null;
 if(active&&e.type==='tap'){
  if(e.id&&e.id.startsWith('hand-')){const c=Number(e.id.slice(5));if(legal.includes(c)){if(c%13+1===8)pending=c;else{make_move={card:c};pending=null;}}}
  if(e.id==='cancel-suit')pending=null;
  if(/^suit-[0-3]$/.test(e.id||'')&&pending!=null){make_move={card:pending,chosenSuit:Number(e.id.slice(5))};pending=null;}
  if((e.id==='draw'||e.id==='stock')&&!legal.length)make_move='draw';
 }
 names.forEach((name,i)=>label('score-'+i,`${name} · ${(v.counts||[])[i]||0}`,110+Math.floor(i/3)*26,17,300+(i%3-(Math.min(3,names.length-Math.floor(i/3)*3)-1)/2)*190));
 pieces.push({id:'stock',type:'back',board:'table',position:{x:205,y:270},face:'back',actions:active&&!legal.length&&v.deckCount>0?['tap']:[],aria_label:'Draw a card'});
 card('hand-'+v.top,v.top,395,270,false,{animation:{kind:'move',key:'discard-'+v.top,duration_ms:440}});
 label('stock-label',`Draw · ${v.deckCount||0}`,343,18,205);label('discard-label','Discard',343,18,395);
 label('suit',`Match ${suits[v.suit??v.currentSuit??Math.floor(v.top/13)]||''} or rank · 8 is wild`,385,19,300,'#ffe28a');
 label('hand-label',`Your hand · ${cards.length} cards`,415,20);
 hand(cards,legal,505);label('hint',m.status==='over'?'Round complete · the winning hand is empty.':pending!=null?'Choose a suit below to play your 8.':'Tap a highlighted card to play.',690,19,300,'#ffe28a');
 if(active&&!legal.length)button('draw','Draw a card');
 if(pending!=null){for(let s=0;s<4;s++)button('suit-'+s,suits[s]+' '+['Clubs','Diamonds','Spades','Hearts'][s]);button('cancel-suit','Cancel suit choice');}
 next={moveCount:m.move_count,pendingEight:pending};
}else if(GAME==='hearts'){
 const cards=v.hand||[],legal=v.legal||[],trick=(v.trick||[]).length?v.trick:(v.lastTrick||[]),low=Math.min(...(v.taken||[0])),leaders=(v.taken||[]).map((score,i)=>score===low?i:-1).filter(i=>i>=0);
 if(m.status==='over'&&leaders.length>1){const turn=labels.find(l=>l.id==='turn');turn.text=`Tie · ${low} points`;turn.x=centeredX(turn.text,turn.font_size);}
 names.forEach((name,i)=>label('score-'+i,`${name} · ${(v.taken||[])[i]||0} pts`,112+Math.floor(i/2)*28,18,155+(i%2)*290,m.status==='over'&&leaders.includes(i)?'#ffe28a':'#dfede5'));
 label('trick-label',`Trick ${Math.min(13,(v.trickNum||0)+1)} of 13`,185,20,300,'#ffe28a');
 const places=[[190,265],[410,265],[190,380],[410,380]];
 trick.forEach(t=>{const [x,y]=places[t.player%4];card('hand-'+t.card,t.card,x,y,false,{scale:.8});label('played-'+t.player,names[t.player]||'Player',y+48,16,x);});
 label('hand-label','Your hand · follow the suit led',460,20);hand(cards,legal,560);
 if(active&&e.type==='tap'&&legal.includes(e.id?.slice(5))&&e.id.startsWith('hand-'))make_move={card:e.id.slice(5)};
 label('hint',m.status==='over'?(leaders.length>1?`Shared lowest score · ${low} points`:`Winner · ${names[v.winner]||'—'}`):'One round · ♥ = 1 · Q♠ = 13 · lowest score wins',860,18,300,'#ffe28a');
}else if(GAME==='michigan'){
 const cards=v.hand||[],legal=v.legal||[],rows=v.rows||[],symbols=['♣','♦','♥','♠'];
 label('objective','Build each suit outward from 7',110,20,300,'#ffe28a');for(let r=1;r<=13;r++)label('rank-'+r,['A','2','3','4','5','6','7','8','9','10','J','Q','K'][r-1],137,14,82+(r-1)*38,'#9abcae');
 rows.forEach((row,s)=>{label('suit-'+s,symbols[s],163+s*72,24,35);for(let r=1;r<=13;r++){const x=82+(r-1)*38,y=180+s*72;if(row.low!==null&&r>=row.low&&r<=row.high)card('hand-'+(s*13+r-1),s*13+r-1,x,y,false,{scale:.43,text:['A','2','3','4','5','6','7','8','9','10','J','Q','K'][r-1]+symbols[s],type:s===1||s===2?'red-card':'black-card'});}});
 label('hand-label',`Your hand · ${cards.length} cards`,430,20);hand(cards,legal,520);for(const piece of pieces.filter(p=>p.id.startsWith('hand-'))){const c=Number(piece.id.slice(5)),s=Math.floor(c/13);piece.text=['A','2','3','4','5','6','7','8','9','10','J','Q','K'][c%13]+symbols[s];piece.type=s===1||s===2?'red-card':'black-card';piece.aria_label=(piece.actions.length?'Play ':'')+piece.text;}
 label('hint',m.status==='over'?'Round complete · the sequences remain on the table.':'Tap a highlighted card to extend a sequence.',1065,18,300,'#ffe28a');
 if(active&&!legal.length)button('pass','Pass · no playable cards');
 if(active&&e.type==='tap'){const c=Number((e.id||'').slice(5));if(e.id?.startsWith('hand-')&&legal.includes(c))make_move={card:c};if(e.id==='pass'&&!legal.length)make_move={pass:true};}
}else if(GAME==='casino-war'){
 label('round',`Hand ${v.round||1} of 10`,110,21);label('score',`You ${v.playerWins||0} · Dealer ${v.dealerWins||0} · Ties ${v.ties||0}`,150,20,300,'#ffe28a');
 label('you','You',220,22,170);label('dealer','Dealer',220,22,430);
 for(const [who,c,x] of [['player',v.playerCard,170],['dealer',v.dealerCard,430]]){
 if(c)card(who+'-card',c,x,330,false,{type:c.suit===1||c.suit===3?'red-card':'black-card',text:['A','2','3','4','5','6','7','8','9','10','J','Q','K'][c.rank-1]+suits[c.suit],aria_label:who+' '+['A','2','3','4','5','6','7','8','9','10','J','Q','K'][c.rank-1]+suits[c.suit],animation:{kind:'move',key:`${v.round}-${c.rank}-${c.suit}`,duration_ms:560}});
 else pieces.push({id:who+'-card',type:'back',board:'table',position:{x,y:330},face:'back',actions:[]});
 }
 const high=c=>c.rank===1?14:c.rank;
 const result=v.phase==='result'?(high(v.playerCard)>high(v.dealerCard)?'You win the hand':high(v.playerCard)<high(v.dealerCard)?'Dealer wins the hand':'Tie · no winner this hand'):v.phase==='over'?(v.winner==null?'Match tied':v.winner===0?'You win!':'Dealer wins!'):v.phase==='dealer'?'Your card is revealed. Flip the dealer.':'Higher card wins the hand.';
 label('result',result,455,23,300,'#ffe28a');
 if(active){if(v.phase==='deal')button('deal','Deal your card');if(v.phase==='dealer')button('dealer-flip','Reveal dealer');if(v.phase==='result')button('next','Next hand');
 if(e.type==='tap'){if(e.id==='deal'&&v.phase==='deal')make_move={kind:'deal'};if(e.id==='dealer-flip'&&v.phase==='dealer')make_move={kind:'flip'};if(e.id==='next'&&v.phase==='result')make_move={kind:'next'};}}
}else if(GAME==='old-maid'){
 const cards=v.hand||[],opponents=v.opponents||[],cols=opponents.length===1?1:2,rows=Math.ceil(opponents.length/cols);
 opponents.forEach((opp,k)=>{const ok=active&&(v.legalTargets||[]).includes(opp.seat),cx=300,cy=310,gap=Math.min(50,460/Math.max(1,opp.count-1));
 label('opp-name-'+opp.seat,`${names[opp.seat]||'Player'} · ${opp.count}`,110+Math.floor(k/2)*28,18,cols===1?300:155+(k%2)*290,ok?'#ffe28a':'#dfede5');
 if(ok||(!active&&k===0))for(let j=0;j<opp.count;j++)pieces.push({id:`opp-${opp.seat}-${j}`,type:'back',board:'table',position:{x:cx+(j-(opp.count-1)/2)*gap,y:cy},scale:.8,face:'back',actions:ok?['tap']:[],aria_label:`Draw card ${j+1} from ${names[opp.seat]||'opponent'}`});
 if(ok&&e.type==='tap'&&e.id?.startsWith(`opp-${opp.seat}-`)){const i=Number(e.id.split('-')[2]);if(Number.isInteger(i)&&i>=0&&i<opp.count)make_move={target:opp.seat,cardIndex:i};}
 });
 const y=450;label('hand-label',`Your hand · ${cards.length} cards`,y-30,20);hand(cards,[],y+50);
 label('hint',m.status==='over'?'Round complete · pairs have been cleared.':'Draw one hidden card · matching pairs clear automatically.',y+Math.max(1,Math.ceil(cards.length/6))*112+38,18,300,'#ffe28a');
}else if(GAME==='blackjack'){
 const hs=(v.hands||[])[seat]||[],hi=v.curP===seat&&Number.isInteger(v.curH)?Math.max(0,Math.min(v.curH,hs.length-1)):0,h=hs[hi]||hs[0]||{},cards=h.cards||[],dealer=v.dealer||[];
 const value=cs=>{let t=0,a=0;cs.forEach(c=>{t+=c.r===1?11:Math.min(c.r,10);if(c.r===1)a++;});while(t>21&&a-->0)t-=10;return t;};
 const leaders=(v.chips||[]).map((chips,i)=>chips===Math.max(...(v.chips||[0]))?i:-1).filter(i=>i>=0);
 const phase={setup:'Ready to play',betting:'Place your bet',play:active?'Hit or stand':'Waiting for the other hand',roundOver:'Round complete',gameOver:leaders.length>1?'Game over · tied chip totals':v.winners===seat?'Game over · You win':`Game over · ${names[v.winners]||'Winner'} wins`}[v.phase]||'';
 labels.splice(1,1);label('phase',phase,70,22);label('bank',`Round ${v.round||1} · Chips ${(v.chips||[])[seat]||0} · Bet ${h.bet||(v.pendingBets||{})[seat]||0}`,115,19,300,'#ffe28a');
 label('dealer-label',v.holeHidden?'Dealer · one card hidden':`Dealer · ${dealer.length?value(dealer):'—'}`,170,21);
 const dc=dealer.length+(v.holeHidden?1:0),step=Math.min(90,480/Math.max(1,dc-1));
 dealer.forEach((c,i)=>card('dealer-'+i,c,300+(i-(dc-1)/2)*step,265,false,{animation:{kind:'move',key:`${v.round}-${i}-${c.r}-${c.s}`,duration_ms:560}}));
 if(v.holeHidden)pieces.push({id:'dealer-1',type:'back',board:'table',position:{x:300+(dc-1)/2*step,y:265},face:'back',actions:[]});
 label('hand-label',`${names[seat]||'You'} · Hand ${hi+1} of ${Math.max(1,hs.length)}`,370,21);label('hand-value',cards.length?`Value ${value(cards)}${value(cards)>21?' · Bust':''}`:'Get as close to 21 as you can.',406,20,300,'#ffe28a');
 const ps=Math.min(90,480/Math.max(1,cards.length-1));cards.forEach((c,i)=>card(`player-${seat}-${hi}-${i}`,c,300+(i-(cards.length-1)/2)*ps,510));
 ((v.results||[])[seat]||'Dealer draws to 17').split(' | ').forEach((text,i)=>label('result-'+i,hs.length>1?`Hand ${i+1} · ${value((hs[i]||{}).cards||[])} · ${text}`:text,610+i*26,18,300,'#ffe28a'));
 if(v.phase==='play'&&hs.length>1)hs.forEach((other,i)=>label('split-hand-'+i,`Hand ${i+1} · ${value(other.cards||[])} · Bet ${other.bet} · ${i===hi?'Playing':other.done?'Done':'Waiting'}`,640+i*24,16));
 const available=[];if(active){if(v.phase==='setup')available.push(['start','Start game']);if(v.phase==='betting'){const chips=(v.chips||[])[seat]||0;if(chips>0)available.push(['bet',`Bet ${Math.min(10,chips)}`]);for(const amount of [25,50,100])if(chips>=amount)available.push(['bet-'+amount,`Bet ${amount}`]);}if(v.phase==='roundOver')available.push(['next','Next round']);if(v.phase==='play'){
 available.push(['hit','Hit'],['stand','Stand']);const afford=(v.chips||[])[seat]>=h.bet;
 if(cards.length===2&&afford)available.push(['double','Double']);if(cards.length===2&&afford&&cards[0].r===cards[1].r&&hs.length<4)available.push(['split','Split']);
 }}available.forEach(([id,text])=>button(id,text));if(e.type==='tap'&&available.some(([id])=>id===e.id))make_move=e.id==='bet'?{kind:'bet',amount:Math.min(10,(v.chips||[])[seat]||10)}:e.id.startsWith('bet-')?{kind:'bet',amount:Number(e.id.slice(4))}:{kind:e.id};
}
const out={scene:{pieces,labels,controls,targets:[]},local_state:next};if(make_move!==undefined)out.make_move=make_move;return out;
}};
