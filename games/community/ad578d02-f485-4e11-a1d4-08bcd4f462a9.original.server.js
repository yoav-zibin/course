const game={
newMatch(ctx){return{state:{phase:"setup",pegs:null,disks:0,moves:0},turn:[ctx.players[0].id]};},
_mk(n){const a=[];for(let i=n;i>=1;i--)a.push(i);return[a,[],[]];},
_solved(s){return s.phase==="play"&&s.pegs&&s.pegs[2].length===s.disks;},
_legal(pegs){const m=[];for(let f=0;f<3;f++)for(let t=0;t<3;t++){if(f===t||!pegs[f].length)continue;const d=pegs[f][pegs[f].length-1];const td=pegs[t][pegs[t].length-1];if(td===undefined||td>d)m.push({from:f,to:t});}return m;},
_payouts(ctx){const p={};const hs=ctx.players.filter(x=>x.kind==="human");if(!hs.length)return p;let rem=ctx.pot;for(let i=0;i<hs.length;i++){p[hs[i].id]=(i===hs.length-1)?rem:0;}return p;},
applyMove(state,playerId,move,ctx){
if(!move||typeof move!=="object")throw new InvalidMove("bad move");
if(move.setup!==undefined){
const n=move.setup;if(n!==3&&n!==4&&n!==5)throw new InvalidMove("pick 3-5 disks");
const ns={phase:"play",pegs:this._mk(n),disks:n,moves:0};return{state:ns,turn:[playerId]};}
if(move.from!==undefined||move.to!==undefined){
if(state.phase!=="play"||!state.pegs)throw new InvalidMove("start first");
if(this._solved(state))throw new InvalidMove("already solved");
const f=move.from,t=move.to;
if(!Number.isInteger(f)||!Number.isInteger(t)||f<0||f>2||t<0||t>2||f===t)throw new InvalidMove("pick two different pegs");
const pegs=state.pegs.map(p=>p.slice());
if(!pegs[f].length)throw new InvalidMove("source empty");
const d=pegs[f][pegs[f].length-1];const td=pegs[t][pegs[t].length-1];
if(td!==undefined&&td<d)throw new InvalidMove("cannot place larger on smaller");
pegs[f].pop();pegs[t].push(d);
const ns={phase:"play",pegs:pegs,disks:state.disks,moves:state.moves+1};
if(ns.pegs[2].length===ns.disks)return{state:ns,turn:null,payouts:this._payouts(ctx)};
return{state:ns,turn:[playerId]};}
throw new InvalidMove("unknown move");},
computerMove(state,playerId,ctx){return this.randomMove(state,playerId,ctx);},
randomMove(state,playerId,ctx){
if(state.phase!=="play"||!state.pegs)return{setup:3+Math.floor(ctx.random()*3)};
const m=this._legal(state.pegs);if(!m.length)throw new InvalidMove("no moves");
return m[Math.floor(ctx.random()*m.length)];},
viewFor(state,playerId,ctx){
if(state.phase!=="play"||!state.pegs)return{phase:"setup",pegs:null,disks:0,moves:0,solved:false};
return{phase:"play",pegs:state.pegs.map(p=>p.slice()),disks:state.disks,moves:state.moves,solved:this._solved(state),min:(1<<state.disks)-1};}
};