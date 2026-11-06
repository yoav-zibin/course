const game={
newMatch(ctx){let n=ctx.players.length;let d=[];for(let i=0;i<52;i++)d.push(i);
for(let i=d.length-1;i>0;i--){let j=Math.floor(ctx.random()*(i+1));let t=d[i];d[i]=d[j];d[j]=t;}
let hands=Array.from({length:n},()=>[]);d.forEach((c,i)=>hands[i%n].push(c));
hands=hands.map(h=>h.slice().sort((a,b)=>a-b));
let state={hands,pile:[],rankIdx:0,current:0,phase:'play',pending:null,declined:[],lastResult:null,winner:null};
return{state,turn:[ctx.players[0].id]};},
_idx(state,pid,ctx){return ctx.players.findIndex(p=>p.id===pid);},
_turnIdsFor(state,ctx){if(state.winner!==null)return null;
if(state.phase==='play')return[ctx.players[state.current].id];
if(state.phase==='challenge'){let rem=[];for(let i=0;i<ctx.players.length;i++){if(i===state.pending.player)continue;if(state.declined.includes(i))continue;rem.push(ctx.players[i].id);}
if(rem.length===0)rem=[ctx.players[(state.pending.player+1)%ctx.players.length].id];
return rem;}
return null;},
_payouts(state,ctx){let pot=ctx.pot;let humans=ctx.players.filter(p=>p.kind==='human');let out={};
if(humans.length===0)return out;
let wIdx=state.winner;let wId=wIdx!=null?ctx.players[wIdx].id:null;
let wIsHuman=wId&&humans.some(h=>h.id===wId);
if(wIsHuman){humans.forEach(h=>out[h.id]=0);out[wId]=pot;}
else{let share=Math.floor(pot/humans.length);let rem=pot-share*humans.length;humans.forEach((h,i)=>out[h.id]=share+(i===0?rem:0));}
return out;},
_endIfWin(state,ctx){if(state.winner!==null)return{state,turn:null,payouts:this._payouts(state,ctx)};
return null;},
_resolvePass(state){let p=state.pending;let pileAll=state.pile.concat(p.cards);
let win=(state.hands[p.player].length===0)?p.player:null;
let n=state.hands.length;let next=(p.player+1)%n;
if(win!==null){state.pile=[];state.pending=null;state.phase='play';state.current=win;state.winner=win;state.declined=[];state.rankIdx++;}
else{state.pile=pileAll;state.pending=null;state.phase='play';state.current=next;state.rankIdx++;state.declined=[];}
return win;},
_resolveBS(state,challIdx,names){let p=state.pending;let bluff=p.cards.some(c=>Math.floor(c/4)!==p.claimed);
let loser=bluff?p.player:challIdx;
let pileAll=state.pile.concat(p.cards);
state.hands[loser]=state.hands[loser].concat(pileAll).sort((a,b)=>a-b);
let R=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];let S=['\u2660','\u2665','\u2666','\u2663'];
let cs=p.cards.map(c=>R[Math.floor(c/4)]+S[c%4]).join(' ');
let msg=(bluff?'Caught Bluffing! ':'False Accusation! ')+(names?names[p.player]:('P'+p.player))+' played '+cs+' (claimed '+R[p.claimed]+')';
state.lastResult={text:msg,cards:p.cards.slice(),bluff,loser,challenger:challIdx};
state.pile=[];state.pending=null;state.phase='play';state.declined=[];state.rankIdx++;
let win=(state.hands[p.player].length===0)?p.player:null;
state.current=win!==null?win:(p.player+1)%state.hands.length;
if(win!==null)state.winner=win;
return win;},
applyMove(state,pid,move,ctx){if(state.winner!==null)throw new InvalidMove('game over');
let me=this._idx(state,pid,ctx);if(me<0)throw new InvalidMove('unknown player');
let names=ctx.players.map(p=>p.display_name||p.id);
move=move||{};
if(state.phase==='play'){if(move.kind!=='play')throw new InvalidMove('must play');
if(me!==state.current)throw new InvalidMove('not your turn');
let cards=move.cards;if(!Array.isArray(cards)||cards.length<1||cards.length>4)throw new InvalidMove('pick 1-4 cards');
let h=state.hands[me];for(let c of cards){if(!Number.isInteger(c)||c<0||c>51)throw new InvalidMove('bad card');if(!h.includes(c))throw new InvalidMove('not in hand');}
if(new Set(cards).size!==cards.length)throw new InvalidMove('duplicate');
state.hands[me]=h.filter(c=>!cards.includes(c));
state.pending={player:me,cards:cards.slice(),claimed:((state.rankIdx%13)+13)%13};
state.phase='challenge';state.declined=[];
return{state,turn:this._turnIdsFor(state,ctx)};}
if(state.phase==='challenge'){let p=state.pending;if(!p)throw new InvalidMove('no claim');
if(me===p.player)throw new InvalidMove('wait for challenges');
if(state.declined.includes(me))throw new InvalidMove('already passed');
if(move.kind==='bs'){this._resolveBS(state,me,names);
let end=this._endIfWin(state,ctx);if(end)return end;
return{state,turn:this._turnIdsFor(state,ctx)};}
if(move.kind==='pass'){let n=state.hands.length;let next=(p.player+1)%n;
if(me===next){this._resolvePass(state);
let end=this._endIfWin(state,ctx);if(end)return end;
return{state,turn:this._turnIdsFor(state,ctx)};}
else{state.declined.push(me);
let allGone=true;for(let i=0;i<n;i++){if(i===p.player)continue;if(!state.declined.includes(i)){allGone=false;break;}}
if(allGone){this._resolvePass(state);
let end=this._endIfWin(state,ctx);if(end)return end;}
return{state,turn:this._turnIdsFor(state,ctx)};}}
throw new InvalidMove('unknown move');}
throw new InvalidMove('unknown move');},
computerMove(state,pid,ctx){let me=this._idx(state,pid,ctx);
if(state.phase==='play'){let h=state.hands[me];let req=((state.rankIdx%13)+13)%13;
let have=h.filter(c=>Math.floor(c/4)===req);
let pick;if(have.length>0)pick=have.slice(0,Math.min(4,have.length));
else{let n=Math.min(h.length,1+Math.floor(ctx.random()*Math.min(3,h.length)));
let idx=h.length-1-Math.floor(ctx.random()*h.length);pick=[h[idx]];
for(let k=1;k<n;k++){let c=h[Math.floor(ctx.random()*h.length)];if(!pick.includes(c))pick.push(c);else k--;}}
return{kind:'play',cards:pick};}
if(state.phase==='challenge'){let p=state.pending;let n=state.hands.length;let next=(p.player+1)%n;
let rate=p.cards.length>2?0.3:0.12;
if(ctx.random()<rate)return{kind:'bs'};
return{kind:'pass'};}
return{kind:'pass'};},
randomMove(state,pid,ctx){let me=this._idx(state,pid,ctx);
if(state.phase==='play'){let h=state.hands[me];let k=1+Math.floor(ctx.random()*Math.min(4,h.length));
let pool=h.slice();let pick=[];for(let i=0;i<k;i++){let j=Math.floor(ctx.random()*pool.length);pick.push(pool.splice(j,1)[0]);}
return{kind:'play',cards:pick};}
if(state.phase==='challenge'){return ctx.random()<0.15?{kind:'bs'}:{kind:'pass'};}
return{kind:'pass'};},
viewFor(state,pid,ctx){let n=ctx.players.length;let my=-1;
if(pid!==null&&pid!==undefined)my=ctx.players.findIndex(p=>p.id===pid);
let counts=state.hands.map(h=>h.length);
let pend=null;if(state.pending)pend={player:state.pending.player,count:state.pending.cards.length,claimed:state.pending.claimed};
return{hands:undefined,myHand:my>=0?state.hands[my].slice():[],counts,pileCount:state.pile.length+(state.pending?state.pending.cards.length:0),rankIdx:state.rankIdx,reqRank:pend?pend.claimed:((state.rankIdx%13)+13)%13,current:state.current,phase:state.phase,pending:pend,lastResult:state.lastResult?{text:state.lastResult.text,cards:state.lastResult.cards.slice(),bluff:state.lastResult.bluff,loser:state.lastResult.loser,challenger:state.lastResult.challenger}:null,winner:state.winner};}
};