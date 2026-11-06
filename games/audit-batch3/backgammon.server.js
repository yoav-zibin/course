function bgOwner(){var o=new Array(24).fill(-1);o[23]=0;o[12]=0;o[7]=0;o[5]=0;o[0]=1;o[11]=1;o[16]=1;o[18]=1;return o;}
function bgCnt(){var c=new Array(24).fill(0);c[23]=2;c[12]=5;c[7]=3;c[5]=5;c[0]=2;c[11]=5;c[16]=3;c[18]=5;return c;}
function bgAllHome(s,p){if(s.bar[p]>0)return false;for(var i=0;i<24;i++){if(s.owner[i]===p&&s.cnt[i]>0){if(p===0){if(i>5)return false;}else{if(i<18)return false;}}}return true;}
function bgCanBear(s,p,from,die){var d=p===0?from+1:24-from;if(die===d)return true;if(die>d){if(p===0){for(var j=from+1;j<=5;j++)if(s.owner[j]===p&&s.cnt[j]>0)return false;return true;}else{for(var k=18;k<from;k++)if(s.owner[k]===p&&s.cnt[k]>0)return false;return true;}}return false;}
function bgLegalForDie(s,p,die){var res=[];var opp=1-p;var i,to,dir;
if(s.bar[p]>0){to=p===0?24-die:die-1;if(!(s.owner[to]===opp&&s.cnt[to]>=2))res.push({from:'bar',to:to});return res;}
dir=p===0?-1:1;
for(i=0;i<24;i++){if(s.owner[i]!==p||s.cnt[i]<=0)continue;to=i+dir*die;
if(to<0||to>=24){if(bgAllHome(s,p)&&bgCanBear(s,p,i,die))res.push({from:i,to:'off'});}
else{if(s.owner[to]===opp&&s.cnt[to]>=2)continue;res.push({from:i,to:to});}}
return res;}
// Search the remaining dice, keeping only first moves that use the maximum count.
// Stop a branch as soon as every remaining die can be used; doubles are deduplicated.
function bgChoices(s,p,memo){
var key=s.owner.join(',')+'|'+s.cnt.join(',')+'|'+s.bar.join(',')+'|'+s.off.join(',')+'|'+s.moves.join(',');
if(memo[key])return memo[key];
var out=[],best=0,seen={};
for(var k=0;k<s.moves.length;k++){
var die=s.moves[k];if(seen[die])continue;seen[die]=true;
var lm=bgLegalForDie(s,p,die);
for(var j=0;j<lm.length;j++){
var next=bgCopy(s);bgDoBoard(next,p,lm[j].from,lm[j].to);next.moves.splice(k,1);
var count=1+bgMaxCount(next,p,memo);
if(count>best){best=count;out=[];}
if(count===best)out.push({from:lm[j].from,to:lm[j].to,die:die,idx:k});
}}
if(best===1&&s.moves.length===2&&s.moves[0]!==s.moves[1]){
var high=Math.max(s.moves[0],s.moves[1]);var higher=out.filter(function(m){return m.die===high;});if(higher.length)out=higher;
}
return memo[key]={count:best,moves:out};
}
function bgMaxCount(s,p,memo){
if(!s.moves.length)return 0;
// A short-circuit depth search avoids enumerating all full double sequences.
var seen={};for(var k=0;k<s.moves.length;k++){
var die=s.moves[k];if(seen[die])continue;seen[die]=true;
var lm=bgLegalForDie(s,p,die);for(var j=0;j<lm.length;j++){
var next=bgCopy(s);bgDoBoard(next,p,lm[j].from,lm[j].to);next.moves.splice(k,1);
if(1+bgMaxCount(next,p,memo)===s.moves.length)return s.moves.length;
}}
return bgChoices(s,p,memo).count;
}
function bgAllMoves(s,p){return bgChoices(s,p,{}).moves;}
function bgHasAny(s,p){return bgAllMoves(s,p).length>0;}
function bgDoBoard(s,p,from,to){var opp=1-p;
if(from==='bar')s.bar[p]--;
else{s.cnt[from]--;if(s.cnt[from]===0)s.owner[from]=-1;}
if(to==='off')s.off[p]++;
else{if(s.owner[to]===opp&&s.cnt[to]===1){s.owner[to]=p;s.cnt[to]=1;s.bar[opp]++;}
else if(s.owner[to]===-1||s.cnt[to]===0){s.owner[to]=p;s.cnt[to]=1;}
else s.cnt[to]++;}}
function bgPayouts(ctx,w){var humans=[];for(var i=0;i<ctx.players.length;i++)if(ctx.players[i].kind==='human')humans.push(ctx.players[i]);
var out={};var pot=ctx.pot||0;var h;
if(humans.length===0)return out;
if(pot<=0){for(h=0;h<humans.length;h++)out[humans[h].id]=0;return out;}
var wId=(ctx.players[w]&&ctx.players[w].id)||null;var wHuman=false;
for(h=0;h<humans.length;h++)if(humans[h].id===wId)wHuman=true;
if(wHuman){for(h=0;h<humans.length;h++)out[humans[h].id]=humans[h].id===wId?pot:0;}
else{var share=Math.floor(pot/humans.length);var rem=pot-share*humans.length;
for(h=0;h<humans.length;h++){out[humans[h].id]=share+(rem>0?1:0);if(rem>0)rem--;}}
return out;}
function bgCopy(s){return{owner:s.owner.slice(),cnt:s.cnt.slice(),bar:s.bar.slice(),off:s.off.slice(),cur:s.cur,dice:s.dice.slice(),moves:s.moves.slice(),needRoll:s.needRoll,winner:s.winner,n:s.n||0};}
function bgTurnFor(ctx,seat){if(!ctx.players||ctx.players.length===0)return null;var i=seat%ctx.players.length;if(i<0)i+=ctx.players.length;return[ctx.players[i].id];}
const game={
newMatch(ctx){var cur=0;try{if(ctx.random()<0.5)cur=1;}catch(e){cur=0;}
if(ctx.players&&ctx.players.length>0)cur=cur%ctx.players.length;
else cur=0;
var state={owner:bgOwner(),cnt:bgCnt(),bar:[0,0],off:[0,0],cur:cur,dice:[],moves:[],needRoll:true,winner:null,n:0};
var t=bgTurnFor(ctx,cur);if(!t)return{state:state,turn:[]};return{state:state,turn:t};},
applyMove(state,playerId,move,ctx){
var idx=-1;for(var i=0;i<ctx.players.length;i++)if(ctx.players[i].id===playerId)idx=i;
if(idx<0)throw new InvalidMove('unknown player');
if(state.winner!==null)throw new InvalidMove('game over');
var mc=ctx.move_count||0;
if(mc>300||(state.n||0)>300){var wend=state.off[0]>=state.off[1]?0:1;state=bgCopy(state);state.winner=wend;return{state:state,turn:null,payouts:bgPayouts(ctx,wend)};}
if(idx!==state.cur)throw new InvalidMove('not your turn');
var p=state.cur;var s=bgCopy(state);var m=move||{};
if(m.action==='roll'){
if(!s.needRoll)throw new InvalidMove('already rolled');
var d1=1+Math.floor(ctx.random()*6),d2=1+Math.floor(ctx.random()*6);
s.dice=d1===d2?[d1,d1,d1,d1]:[d1,d2];s.moves=s.dice.slice();s.needRoll=false;
if(!bgHasAny(s,p)){s.n=(s.n||0)+1;if(s.n>120||mc>300){var w0=s.off[0]>=s.off[1]?0:1;s.winner=w0;return{state:s,turn:null,payouts:bgPayouts(ctx,w0)};}
s.cur=1-p;if(ctx.players.length>0)s.cur=s.cur%ctx.players.length;
s.needRoll=true;s.dice=[];s.moves=[];return{state:s,turn:bgTurnFor(ctx,s.cur)};}
return{state:s,turn:bgTurnFor(ctx,p)};}
if(m.action==='pass'){
if(s.needRoll)throw new InvalidMove('roll first');
if(bgHasAny(s,p))throw new InvalidMove('moves available');
s.n=(s.n||0)+1;
if(s.n>120||mc>300){var w1=s.off[0]>=s.off[1]?0:1;s.winner=w1;return{state:s,turn:null,payouts:bgPayouts(ctx,w1)};}
s.cur=1-p;if(ctx.players.length>0)s.cur=s.cur%ctx.players.length;
s.needRoll=true;s.dice=[];s.moves=[];return{state:s,turn:bgTurnFor(ctx,s.cur)};}
if(m.action==='move'){
if(s.needRoll)throw new InvalidMove('roll first');
if(s.moves.length===0)throw new InvalidMove('no moves');
var from=m.from,to=m.to;
if(from!=='bar'){if(typeof from!=='number'||!Number.isInteger(from))throw new InvalidMove('bad from');if(!(from>=0&&from<24))throw new InvalidMove('bad from');}
if(to!=='off'){if(typeof to!=='number'||!Number.isInteger(to))throw new InvalidMove('bad to');if(!(to>=0&&to<24))throw new InvalidMove('bad to');}
var use=-1;var allowed=bgAllMoves(s,p);
for(var k=0;k<allowed.length;k++){if(allowed[k].from===from&&allowed[k].to===to){use=allowed[k].idx;break;}}
if(use<0)throw new InvalidMove('illegal move');
bgDoBoard(s,p,from,to);s.moves.splice(use,1);s.dice=s.moves.slice();
if(s.off[p]===15){s.winner=p;return{state:s,turn:null,payouts:bgPayouts(ctx,p)};}
if(s.moves.length===0||!bgHasAny(s,p)){s.n=(s.n||0)+1;
if(s.n>120||mc>300){var w2=s.off[0]>=s.off[1]?0:1;s.winner=w2;return{state:s,turn:null,payouts:bgPayouts(ctx,w2)};}
s.cur=1-p;if(ctx.players.length>0)s.cur=s.cur%ctx.players.length;
s.needRoll=true;s.dice=[];s.moves=[];return{state:s,turn:bgTurnFor(ctx,s.cur)};}
return{state:s,turn:bgTurnFor(ctx,p)};}
throw new InvalidMove('unknown move');},
randomMove(state,playerId,ctx){
var idx=-1;for(var i=0;i<ctx.players.length;i++)if(ctx.players[i].id===playerId)idx=i;
var p=idx>=0?idx:state.cur;
if(state.needRoll)return{action:'roll'};
var ms=bgAllMoves(state,p);
if(ms.length===0)return{action:'pass'};
var k=Math.floor(ctx.random()*ms.length);
return{action:'move',from:ms[k].from,to:ms[k].to};},
computerMove(state,playerId,ctx){
var idx=-1;for(var i=0;i<ctx.players.length;i++)if(ctx.players[i].id===playerId)idx=i;
var p=idx>=0?idx:state.cur;
if(state.needRoll)return{action:'roll'};
var ms=bgAllMoves(state,p);
if(ms.length===0)return{action:'pass'};
var opp=1-p;var best=ms[0];var bs=-1e9;
for(var i2=0;i2<ms.length;i2++){var m=ms[i2];var sc=0;
if(m.to==='off')sc+=100;
else{if(state.owner[m.to]===opp&&state.cnt[m.to]===1)sc+=60;
else if(state.owner[m.to]===p&&state.cnt[m.to]===1)sc+=22;
else if(state.owner[m.to]===-1)sc+=6;
if(p===0&&m.to<=5)sc+=10;if(p===1&&m.to>=18)sc+=10;}
if(m.from==='bar')sc+=25;
sc+=ctx.random()*3;
if(sc>bs){bs=sc;best=m;}}
return{action:'move',from:best.from,to:best.to};},
viewFor(state,playerId,ctx){
return{owner:state.owner.slice(),cnt:state.cnt.slice(),bar:state.bar.slice(),off:state.off.slice(),cur:state.cur,dice:state.dice.slice(),moves:state.moves.slice(),needRoll:state.needRoll,winner:state.winner,n:state.n||0,legalMoves:state.needRoll||state.winner!==null?[]:bgAllMoves(state,state.cur)};}
};