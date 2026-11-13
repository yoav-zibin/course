const game={
newMatch(ctx){const n=ctx.players.length;if(n===0){const st={hands:[],deck:[],trash:[],alive:[],letters:[],dealer:0,pending:{},spoons:[],loser:null,winner:null,round:1,phase:'gameOver',moves:0};return{state:st,turn:null,payouts:payoutsFor(st,ctx)}}
const deck=shuffledDeck(ctx);const hands=[];const alive=[];for(let i=0;i<n;i++){hands.push([deck.pop(),deck.pop(),deck.pop(),deck.pop()]);alive.push(true)}
const st={hands,deck,trash:[],alive,letters:alive.map(function(){return ''}),dealer:0,pending:{},spoons:[],loser:null,winner:null,round:1,phase:'pass',moves:0};
return{state:st,turn:turnFor(st,ctx)};},
applyMove(state,playerId,move,ctx){
const s=state;const idx=ctx.players.findIndex(function(p){return p.id===playerId});if(idx<0)throw new InvalidMove('not seated');
if(s.phase==='gameOver')throw new InvalidMove('game over');
if(!s.alive[idx])throw new InvalidMove('eliminated');
s.moves=(s.moves||0)+1;
if(s.moves>250){s.phase='gameOver';s.winner=firstAlive(s,ctx);return{state:s,turn:null,payouts:payoutsFor(s,ctx)}}
const m=move||{};
if(s.phase==='pass'){
 if(m.kind==='grab'){assertFour(s.hands[idx]);s.phase='grab';s.spoons=[idx];s.pending={};maybeFinishGrab(s,ctx);if(s.phase==='gameOver')return{state:s,turn:null,payouts:payoutsFor(s,ctx)};return{state:s,turn:turnFor(s,ctx)}}
 if(m.kind!=='pass')throw new InvalidMove('pass a card or grab');
 if(s.pending.hasOwnProperty(idx))throw new InvalidMove('already passed');
 const card=m.card;if(typeof card!=='string'||s.hands[idx].indexOf(card)<0)throw new InvalidMove('bad card');
 s.pending[idx]=card;
 if(allPassed(s)){resolvePasses(s,ctx)}
 return{state:s,turn:turnFor(s,ctx)}}
if(s.phase==='grab'){
 if(m.kind!=='grab')throw new InvalidMove('grab now');
 if(s.spoons.indexOf(idx)>=0)throw new InvalidMove('already have spoon');
 s.spoons.push(idx);maybeFinishGrab(s,ctx);
 if(s.phase==='gameOver')return{state:s,turn:null,payouts:payoutsFor(s,ctx)};
 return{state:s,turn:turnFor(s,ctx)}}
if(s.phase==='roundEnd'){
 if(m.kind!=='next')throw new InvalidMove('wait');
 if(idx!==s.dealer)throw new InvalidMove('only dealer');
 startNextRound(s,ctx);
 if((s.round||1)>20){s.phase='gameOver';s.winner=firstAlive(s,ctx);return{state:s,turn:null,payouts:payoutsFor(s,ctx)}}
 return{state:s,turn:turnFor(s,ctx)}}
throw new InvalidMove('game over')},
computerMove(state,playerId,ctx){return this.randomMove(state,playerId,ctx)},
randomMove(state,playerId,ctx){
const idx=ctx.players.findIndex(function(p){return p.id===playerId});const s=state;
if(!s||s.phase==='gameOver')return{kind:'grab'};
if(s.phase==='roundEnd')return{kind:'next'};
if(s.phase==='grab')return{kind:'grab'};
const h=(idx>=0&&s.hands[idx])||[];
if(hasFour(h))return{kind:'grab'};
if(!h.length)return{kind:'grab'};
const j=Math.floor(ctx.random()*h.length);
return{kind:'pass',card:h[j]}},
viewFor(state,playerId,ctx){
const s=state;let me=-1;if(playerId!=null)me=ctx.players.findIndex(function(p){return p.id===playerId});
const n=ctx.players.length;
const handCounts=[];
for(let i=0;i<n;i++){const h=(s.hands&&s.hands[i])||[];handCounts.push(h.length)}
let myHand=[];if(me>=0&&s.hands&&s.hands[me])myHand=s.hands[me].slice();
const passed=[];for(let i=0;i<n;i++)passed.push(s.pending&&s.pending.hasOwnProperty(i)?true:false);
let passedCount=0;for(let i=0;i<n;i++)if(passed[i])passedCount++;
const aliveArr=[];for(let i=0;i<n;i++)aliveArr.push(s.alive?s.alive[i]:false);
let ac=0;for(let i=0;i<n;i++)if(aliveArr[i])ac++;
return{phase:s.phase,hand:myHand,handCounts:handCounts,alive:aliveArr,aliveCount:ac,letters:(s.letters||[]).slice(),dealer:s.dealer,passed:passed,passedCount:passedCount,spoons:(s.spoons||[]).slice(),spoonsLeft:Math.max(0,ac-1-(s.spoons||[]).length),loser:(s.loser==null?null:s.loser),winner:(s.winner==null?null:s.winner),round:s.round,deckCount:(s.deck||[]).length,trashCount:(s.trash||[]).length}}};
function rankOf(c){return c.slice(0,-1)}
function hasFour(h){if(!h||h.length<4)return false;const r=rankOf(h[0]);for(let i=1;i<h.length;i++)if(rankOf(h[i])!==r)return false;return true}
function assertFour(h){if(!hasFour(h))throw new InvalidMove('need four of a kind')}
function aliveIdx(s){const r=[];const n=s.alive?s.alive.length:0;for(let i=0;i<n;i++)if(s.alive[i])r.push(i);return r}
function firstAlive(s,ctx){const a=aliveIdx(s);if(a.length)return a[0];if(ctx&&ctx.players.length)return 0;return 0}
function prevAlive(s,i){const a=aliveIdx(s);const k=a.indexOf(i);return a[(k-1+a.length)%a.length]}
function allPassed(s){const a=aliveIdx(s);for(let k=0;k<a.length;k++)if(!s.pending.hasOwnProperty(a[k]))return false;return true}
function shuffledDeck(ctx){const R=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];const S=['\u2665','\u2666','\u2663','\u2660'];let d=[];for(let i=0;i<R.length;i++)for(let j=0;j<S.length;j++)d.push(R[i]+S[j]);for(let i=d.length-1;i>0;i--){const j=Math.floor(ctx.random()*(i+1));const t=d[i];d[i]=d[j];d[j]=t}return d}
function resolvePasses(s,ctx){
if(s.deck.length===0&&s.trash.length>0){s.deck=s.trash;s.trash=[];for(let i=s.deck.length-1;i>0;i--){const j=Math.floor(ctx.random()*(i+1));const t=s.deck[i];s.deck[i]=s.deck[j];s.deck[j]=t}}
let dc=s.deck.length?s.deck.pop():'A\u2665';
const a=aliveIdx(s);if(!a.length){s.pending={};return}
const di=a.indexOf(s.dealer);const last=a[(di-1+a.length)%a.length];
const nh=s.hands.map(function(h){return h.slice()});
for(let k=0;k<a.length;k++){const i=a[k];const pc=s.pending[i];let pi=nh[i].indexOf(pc);if(pi<0)pi=0;nh[i].splice(pi,1)}
for(let k=0;k<a.length;k++){const i=a[k];if(i===s.dealer)nh[i].push(dc);else nh[i].push(s.pending[prevAlive(s,i)])}
s.trash.push(s.pending[last]);s.hands=nh;s.pending={}}
function maybeFinishGrab(s,ctx){
const a=aliveIdx(s);if(a.length<=1){s.phase='gameOver';s.winner=a.length?a[0]:firstAlive(s,ctx);return}
if(s.spoons.length<a.length-1)return;
let loser=-1;for(let k=0;k<a.length;k++)if(s.spoons.indexOf(a[k])<0){loser=a[k];break}
if(loser<0)return;s.loser=loser;
const WORD='SPOONS';const cur=s.letters[loser]||'';const nl=WORD.slice(0,cur.length+1);s.letters[loser]=nl;
if(nl.length>=6)s.alive[loser]=false;
const rem=aliveIdx(s);
if(rem.length<=1){s.phase='gameOver';s.winner=rem.length?rem[0]:loser;return}
if(rem.indexOf(s.dealer)<0||!s.alive[s.dealer]){const di=a.indexOf(s.dealer);let nx=rem[0];for(let t=1;t<=a.length;t++){const c=a[(di+t)%a.length];if(s.alive[c]){nx=c;break}}s.dealer=nx}
else{const di=rem.indexOf(s.dealer);s.dealer=rem[(di+1)%rem.length]}
s.phase='roundEnd'}
function startNextRound(s,ctx){
const deck=shuffledDeck(ctx);const a=aliveIdx(s);
for(let k=0;k<a.length;k++){const i=a[k];s.hands[i]=[deck.pop(),deck.pop(),deck.pop(),deck.pop()]}
s.deck=deck;s.trash=[];s.pending={};s.spoons=[];s.loser=null;s.phase='pass';s.round=(s.round||1)+1}
function payoutsFor(s,ctx){
const humans=ctx.players.filter(function(p){return p.kind==='human'});const pot=ctx.pot||0;const out={};for(let k=0;k<humans.length;k++)out[humans[k].id]=0;
if(!humans.length)return out;
const w=ctx.players[s.winner];
if(w&&w.kind==='human'&&out.hasOwnProperty(w.id)){out[w.id]=pot;return out}
const share=Math.floor(pot/humans.length);let rem=pot-share*humans.length;
for(let k=0;k<humans.length;k++){out[humans[k].id]=share+(rem>0?1:0);if(rem>0)rem--}
return out}
function turnFor(s,ctx){
if(!s||s.phase==='gameOver')return null;
const ids=ctx.players.map(function(p){return p.id});
if(!ids.length)return null;
if(s.phase==='roundEnd'){if(s.dealer<0||s.dealer>=ids.length)return[ids[0]];return[ids[s.dealer]]}
if(s.phase==='grab'){const r=[];const a=aliveIdx(s);for(let k=0;k<a.length;k++)if(s.spoons.indexOf(a[k])<0)r.push(ids[a[k]]);return r.length?r:null}
const r=[];const a=aliveIdx(s);if(!a.length)return null;for(let k=0;k<a.length;k++)if(!s.pending.hasOwnProperty(a[k]))r.push(ids[a[k]]);return r.length?r:[ids[a[0]]]}