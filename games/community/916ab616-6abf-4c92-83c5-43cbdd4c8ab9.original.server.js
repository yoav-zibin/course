const game = {
valid(s){return typeof s==='string'&&/^[1-9][0-9]{3}$/.test(s)&&new Set(s.split('')).size===4;},
score(secret,guess){let b=0;for(let i=0;i<4;i++)if(secret[i]===guess[i])b++;let common=new Set(secret.split('').filter(c=>guess.includes(c))).size;return{b:b,c:common-b};},
allNums(){const r=[];for(let a=1;a<=9;a++)for(let b=0;b<=9;b++)if(b!==a)for(let c=0;c<=9;c++)if(c!==a&&c!==b)for(let d=0;d<=9;d++)if(d!==a&&d!==b&&d!==c)r.push(''+a+b+c+d);return r;},
idxOf(state,playerId,ctx){const i=ctx.players.findIndex(p=>p.id===playerId);if(i<0)throw new InvalidMove('unknown player');return i;},
setupTurn(state,ctx){const t=[];for(let i=0;i<ctx.players.length;i++)if(!state.secrets[i])t.push(ctx.players[i].id);return t;},
newMatch(ctx){const state={phase:'setup',secrets:[null,null],guesses:[[],[]],feedback:[[],[]],winner:null};const turn=ctx.players.map(p=>p.id);return{state:state,turn:turn};},
applyMove(state,playerId,move,ctx){
const i=this.idxOf(state,playerId,ctx);
if(state.phase==='setup'){
if(!move||move.kind!=='set_secret')throw new InvalidMove('set your secret number first');
if(state.secrets[i])throw new InvalidMove('secret already set');
if(!this.valid(move.secret))throw new InvalidMove('secret must be 4 distinct digits, first != 0');
state.secrets[i]=move.secret;
if(state.secrets[0]&&state.secrets[1]){state.phase='play';const first=ctx.players[0].id;return{state:state,turn:[first]};}
return{state:state,turn:this.setupTurn(state,ctx)};}
if(state.phase==='play'){
if(state.winner!==null)throw new InvalidMove('game over');
if(!move||move.kind!=='guess')throw new InvalidMove('send a guess');
if(!this.valid(move.guess))throw new InvalidMove('guess must be 4 distinct digits, first != 0');
const opp=1-i;
if(!state.secrets[opp])throw new InvalidMove('opponent secret not set');
const s=this.score(state.secrets[opp],move.guess);
state.guesses[i].push(move.guess);
state.feedback[i].push(s);
if(s.b===4){state.phase='over';state.winner=i;const payouts={};const humans=ctx.players.filter(p=>p.kind==='human');for(const h of humans)payouts[h.id]=0;
if(ctx.pot>0&&humans.length>0){
const wIsHuman=ctx.players[i].kind==='human';
if(wIsHuman){payouts[ctx.players[i].id]=ctx.pot;}
else{const share=Math.floor(ctx.pot/humans.length);let rem=ctx.pot;for(let k=0;k<humans.length;k++){const v=(k===humans.length-1)?rem:share;rem-=v;payouts[humans[k].id]=v;}}}
return{state:state,turn:null,payouts:payouts};}
const next=ctx.players[opp].id;return{state:state,turn:[next]};}
throw new InvalidMove('game over');},
computerMove(state,playerId,ctx){
const i=this.idxOf(state,playerId,ctx);
if(state.phase==='setup'&&!state.secrets[i]){
const pool=this.allNums();return{kind:'set_secret',secret:pool[Math.floor(ctx.random()*pool.length)]};}
if(state.phase==='play'){
const gs=state.guesses[i],fb=state.feedback[i];
const cands=this.allNums().filter(n=>{for(let k=0;k<gs.length;k++){const s=this.score(n,gs[k]);if(s.b!==fb[k].b||s.c!==fb[k].c)return false;}return true;});
if(!cands.length){const pool=this.allNums();return{kind:'guess',guess:pool[Math.floor(ctx.random()*pool.length)]};}
return{kind:'guess',guess:cands[Math.floor(ctx.random()*cands.length)]};}
return this.randomMove(state,playerId,ctx);},
randomMove(state,playerId,ctx){
const i=this.idxOf(state,playerId,ctx);
if(state.phase==='setup'&&!state.secrets[i]){const pool=this.allNums();return{kind:'set_secret',secret:pool[Math.floor(ctx.random()*pool.length)]};}
if(state.phase==='play'){const pool=this.allNums();return{kind:'guess',guess:pool[Math.floor(ctx.random()*pool.length)]};}
const pool2=this.allNums();return{kind:'guess',guess:pool2[Math.floor(ctx.random()*pool2.length)]};},
viewFor(state,playerId,ctx){
let me=-1;if(playerId!==null&&playerId!==undefined)me=ctx.players.findIndex(p=>p.id===playerId);
const over=state.phase==='over';
if(me<0){
return{phase:state.phase,secretsSet:[!!state.secrets[0],!!state.secrets[1]],mySecret:null,oppSecret:null,myGuesses:[],myFeedback:[],oppGuesses:[],oppFeedback:[],guesses:state.guesses,feedback:state.feedback,winner:state.winner,secrets:over?state.secrets.slice():[null,null]};}
const opp=1-me;
return{phase:state.phase,secretsSet:[!!state.secrets[0],!!state.secrets[1]],mySecret:state.secrets[me]||null,oppSecret:over?(state.secrets[opp]||null):null,myGuesses:state.guesses[me].slice(),myFeedback:state.feedback[me].map(f=>({b:f.b,c:f.c})),oppGuesses:state.guesses[opp].slice(),oppFeedback:state.feedback[opp].map(f=>({b:f.b,c:f.c})),winner:state.winner};}
};