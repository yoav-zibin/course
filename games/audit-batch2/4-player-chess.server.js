const game = {
  newMatch(ctx) {
    const n = ctx.players.length;
    const elim = [false,false,false,false];
    for (let i=0;i<4;i++) if(i>=n) elim[i]=true;
    const state = { board: initialBoard(), eliminated: elim, winnerTeam: null, lastMove: null, ply: 0 };
    if (!n) return { state, turn: null, payouts: {} };
    const s = nextAlive(-1, elim, n);
    if (s==null) return { state, turn: null, payouts: payoutsFor(null, ctx) };
    return { state, turn: [ctx.players[s].id] };
  },
  applyMove(state, playerId, move, ctx) {
    const n = ctx.players.length;
    const idx = ctx.players.findIndex(p => p.id === playerId);
    if (idx<0) throw new InvalidMove('unknown player');
    if (state.winnerTeam!=null) throw new InvalidMove('game over');
    if (state.eliminated[idx]) {
      const nx = nextAlive(idx, state.eliminated, n);
      if (nx==null) return { state, turn: null, payouts: payoutsFor(null, ctx) };
      return { state, turn: [ctx.players[nx].id] };
    }
    const m = move||{};
    let ns;
    if (m.kind==='move') {
      const legal = legalFor(state.board, idx, state.eliminated);
      let found=null;
      for (let i=0;i<legal.length;i++){const x=legal[i];if(x.fr===m.fr&&x.fc===m.fc&&x.tr===m.tr&&x.tc===m.tc){found=x;break;}}
      if(!found) throw new InvalidMove('illegal move');
      const nb = shallow(state.board);
      const fk=found.fr*14+found.fc, tk=found.tr*14+found.tc;
      const moving = nb[fk];
      delete nb[fk];
      let t=moving.t;
      if(moving.t===80&&(found.promo||isPromo(idx,found.tr,found.tc))) t=81;
      nb[tk]={t,o:idx};
      ns={board:nb,eliminated:state.eliminated.slice(),winnerTeam:null,lastMove:{fr:found.fr,fc:found.fc,tr:found.tr,tc:found.tc},ply:(state.ply||0)+1};
    } else if (m.kind==='pass'||m.kind==='elim') {
      if(m.kind==='pass'&&hasAnyLegal(state.board,idx,state.eliminated))throw new InvalidMove('moves available');
      const nb=shallow(state.board);removeArmy(nb,idx);
      const eliminated=state.eliminated.slice();eliminated[idx]=true;
      ns={board:nb,eliminated,winnerTeam:null,lastMove:null,ply:(state.ply||0)+1};
    } else throw new InvalidMove('unknown move');
    return settleNext(ns,idx,ctx);

  },
  computerMove(state, playerId, ctx) { return pickMove(state, ctx.players.findIndex(p=>p.id===playerId), ctx, true); },
  randomMove(state, playerId, ctx) { return pickMove(state, ctx.players.findIndex(p=>p.id===playerId), ctx, false); },
  viewFor(state, playerId, ctx) {
    const idx = playerId==null?-1:ctx.players.findIndex(p=>p.id===playerId);
    let legal=[];
    let chk=false;
    if(idx>=0&&!state.eliminated[idx]&&state.winnerTeam==null){
      legal=legalFor(state.board,idx,state.eliminated);
      chk=inCheck(state.board,idx);
    }
    const cks=[];
    for(let p=0;p<4;p++){if(!state.eliminated[p]){const kp=kingPos(state.board,p);if(kp&&isAttacked(state.board,kp[0],kp[1],p))cks.push(kp[0]+','+kp[1]);}}
    const out={};
    for(const key in state.board){const r=Math.floor(key/14),c=key%14;out[r+','+c]={t:String.fromCharCode(state.board[key].t),o:state.board[key].o};}
    return {board:out,eliminated:state.eliminated.slice(),winnerTeam:state.winnerTeam,lastMove:state.lastMove?{fr:state.lastMove.fr,fc:state.lastMove.fc,tr:state.lastMove.tr,tc:state.lastMove.tc}:null,legalMoves:legal.map(m=>({fr:m.fr,fc:m.fc,tr:m.tr,tc:m.tc,cap:m.cap?true:false,promo:m.promo?true:false})),inCheck:chk,checkKings:cks,ply:state.ply||0};
  }
};
function removeArmy(board,idx){for(const key in board)if(board[key].o===idx)delete board[key];}
function eliminatedWinner(elim){if(elim[0]&&elim[2])return 1;if(elim[1]&&elim[3])return 0;return null;}
function settleNext(state,after,ctx){
 let next=nextAlive(after,state.eliminated,ctx.players.length);
 for(let tries=0;tries<4;tries++){
  const winner=eliminatedWinner(state.eliminated);
  if(winner!==null){state.winnerTeam=winner;return {state,turn:null,payouts:payoutsFor(winner,ctx)};}
  if(state.ply>=24||next===null){const w=materialWinner(state.board);state.winnerTeam=w;return {state,turn:null,payouts:payoutsFor(w,ctx)};}
  if(hasAnyLegal(state.board,next,state.eliminated))return {state,turn:[ctx.players[next].id]};
  removeArmy(state.board,next);state.eliminated[next]=true;
  next=nextAlive(next,state.eliminated,ctx.players.length);
 }
 const w=eliminatedWinner(state.eliminated);state.winnerTeam=w;return {state,turn:null,payouts:payoutsFor(w,ctx)};
}
function shallow(b){const o={};for(const key in b)o[key]=b[key];return o;}
function teamOf(p){return (p===0||p===2)?0:1;}
function valid(r,c){if(r<0||r>13||c<0||c>13)return false;if(r<3||r>10){if(c<3||c>10)return false;}return true;}
function isPromo(o,r,c){return o===0?r===0:o===2?r===13:o===1?c===13:c===0;}
function initialBoard(){
  const b={};
  const S=[82,78,66,81,75,66,78,82], N=[82,78,66,75,81,66,78,82];
  for(let i=0;i<8;i++){const c=3+i;
    b[13*14+c]={t:S[i],o:0};b[12*14+c]={t:80,o:0};
    b[0*14+c]={t:N[i],o:2};b[1*14+c]={t:80,o:2};
  }
  for(let i=0;i<8;i++){const r=3+i;
    b[r*14+0]={t:S[i],o:1};b[r*14+1]={t:80,o:1};
    b[r*14+13]={t:N[i],o:3};b[r*14+12]={t:80,o:3};
  }
  return b;
}
function kingPos(board,o){
  for(const key in board){const p=board[key];if(p.o===o&&p.t===75)return[Math.floor(key/14),key%14];}
  return null;
}
function isAttacked(b,tr,tc,def){return attackedClean(b,tr,tc,teamOf(def));}
function attackedClean(b,tr,tc,dt){
  let p;
  // south o=0 pawns move -r, attack (r-1,c±1): attacker at (tr+1,c±1)
  if(dt!==teamOf(0)){
    if((p=b[(tr+1)*14+(tc-1)])&&p.o===0&&p.t===80)return true;
    if((p=b[(tr+1)*14+(tc+1)])&&p.o===0&&p.t===80)return true;
  }
  if(dt!==teamOf(2)){
    if((p=b[(tr-1)*14+(tc-1)])&&p.o===2&&p.t===80)return true;
    if((p=b[(tr-1)*14+(tc+1)])&&p.o===2&&p.t===80)return true;
  }
  if(dt!==teamOf(1)){
    if((p=b[(tr-1)*14+(tc-1)])&&p.o===1&&p.t===80)return true;
    if((p=b[(tr+1)*14+(tc-1)])&&p.o===1&&p.t===80)return true;
  }
  if(dt!==teamOf(3)){
    if((p=b[(tr-1)*14+(tc+1)])&&p.o===3&&p.t===80)return true;
    if((p=b[(tr+1)*14+(tc+1)])&&p.o===3&&p.t===80)return true;
  }
  if((p=b[(tr-2)*14+tc-1])&&p.t===78&&teamOf(p.o)!==dt)return true;
  if((p=b[(tr-2)*14+tc+1])&&p.t===78&&teamOf(p.o)!==dt)return true;
  if((p=b[(tr-1)*14+tc-2])&&p.t===78&&teamOf(p.o)!==dt)return true;
  if((p=b[(tr-1)*14+tc+2])&&p.t===78&&teamOf(p.o)!==dt)return true;
  if((p=b[(tr+1)*14+tc-2])&&p.t===78&&teamOf(p.o)!==dt)return true;
  if((p=b[(tr+1)*14+tc+2])&&p.t===78&&teamOf(p.o)!==dt)return true;
  if((p=b[(tr+2)*14+tc-1])&&p.t===78&&teamOf(p.o)!==dt)return true;
  if((p=b[(tr+2)*14+tc+2-1])&&p.t===78&&teamOf(p.o)!==dt)return true;
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const q=b[(tr+dr)*14+tc+dc];if(q&&q.t===75&&teamOf(q.o)!==dt)return true;}
  let r,c,q;
  r=tr-1;c=tc;while(valid(r,c)){q=b[r*14+c];if(q){if(teamOf(q.o)!==dt&&(q.t===82||q.t===81))return true;break;}r--;}
  r=tr+1;while(valid(r,tc)){q=b[r*14+tc];if(q){if(teamOf(q.o)!==dt&&(q.t===82||q.t===81))return true;break;}r++;}
  c=tc-1;while(valid(tr,c)){q=b[tr*14+c];if(q){if(teamOf(q.o)!==dt&&(q.t===82||q.t===81))return true;break;}c--;}
  c=tc+1;while(valid(tr,c)){q=b[tr*14+c];if(q){if(teamOf(q.o)!==dt&&(q.t===82||q.t===81))return true;break;}c++;}
  r=tr-1;c=tc-1;while(valid(r,c)){q=b[r*14+c];if(q){if(teamOf(q.o)!==dt&&(q.t===66||q.t===81))return true;break;}r--;c--;}
  r=tr-1;c=tc+1;while(valid(r,c)){q=b[r*14+c];if(q){if(teamOf(q.o)!==dt&&(q.t===66||q.t===81))return true;break;}r--;c++;}
  r=tr+1;c=tc-1;while(valid(r,c)){q=b[r*14+c];if(q){if(teamOf(q.o)!==dt&&(q.t===66||q.t===81))return true;break;}r++;c--;}
  r=tr+1;c=tc+1;while(valid(r,c)){q=b[r*14+c];if(q){if(teamOf(q.o)!==dt&&(q.t===66||q.t===81))return true;break;}r++;c++;}
  return false;
}
function inCheck(board,o){const kp=kingPos(board,o);if(!kp)return false;return attackedClean(board,kp[0],kp[1],teamOf(o));}
function pseudoFor(board,o){
  const moves=[];
  const mt=teamOf(o);
  for(const key in board){
    const p=board[key];if(p.o!==o)continue;
    const k=+key,r=Math.floor(k/14),c=k%14;
    if(p.t===78){
      for(let d=0;d<8;d++){const tr=r+ND[d][0],tc=c+ND[d][1];if(!valid(tr,tc))continue;const q=board[tr*14+tc];if(q&&teamOf(q.o)===mt)continue;if(q&&q.t===75)continue;moves.push({fr:r,fc:c,tr,tc,cap:q?1:0});}
    } else if(p.t===75){
      for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){if(!dr&&!dc)continue;const tr=r+dr,tc=c+dc;if(!valid(tr,tc))continue;const q=board[tr*14+tc];if(q&&teamOf(q.o)===mt)continue;if(q&&q.t===75)continue;moves.push({fr:r,fc:c,tr,tc,cap:q?1:0});}
    } else if(p.t===80){
      const f=PF[o];const r1=r+f[0],c1=c+f[1];
      if(valid(r1,c1)&&!board[r1*14+c1]){
        moves.push({fr:r,fc:c,tr:r1,tc:c1,cap:0,promo:isPromo(o,r1,c1)?1:0});
        const st=o===0?r===12:o===2?r===1:o===1?c===1:c===12;
        const r2=r+f[0]*2,c2=c+f[1]*2;
        if(st&&valid(r2,c2)&&!board[r2*14+c2])moves.push({fr:r,fc:c,tr:r2,tc:c2,cap:0});
      }
      const cs=PC[o];
      for(let i=0;i<2;i++){const tr=r+cs[i][0],tc=c+cs[i][1];if(!valid(tr,tc))continue;const q=board[tr*14+tc];if(q&&teamOf(q.o)!==mt&&q.t!==75)moves.push({fr:r,fc:c,tr,tc,cap:1,promo:isPromo(o,tr,tc)?1:0});}
    } else {
      const orth=p.t===82||p.t===81, diag=p.t===66||p.t===81;
      if(orth){
        let tr=r-1,tc=c;while(valid(tr,tc)){const q=board[tr*14+tc];if(q){if(teamOf(q.o)!==mt&&q.t!==75)moves.push({fr:r,fc:c,tr,tc,cap:1});break;}moves.push({fr:r,fc:c,tr,tc,cap:0});tr--;}
        tr=r+1;tc=c;while(valid(tr,tc)){const q=board[tr*14+tc];if(q){if(teamOf(q.o)!==mt&&q.t!==75)moves.push({fr:r,fc:c,tr,tc,cap:1});break;}moves.push({fr:r,fc:c,tr,tc,cap:0});tr++;}
        tr=r;tc=c-1;while(valid(tr,tc)){const q=board[tr*14+tc];if(q){if(teamOf(q.o)!==mt&&q.t!==75)moves.push({fr:r,fc:c,tr,tc,cap:1});break;}moves.push({fr:r,fc:c,tr,tc,cap:0});tc--;}
        tr=r;tc=c+1;while(valid(tr,tc)){const q=board[tr*14+tc];if(q){if(teamOf(q.o)!==mt&&q.t!==75)moves.push({fr:r,fc:c,tr,tc,cap:1});break;}moves.push({fr:r,fc:c,tr,tc,cap:0});tc++;}
      }
      if(diag){
        let tr=r-1,tc=c-1;while(valid(tr,tc)){const q=board[tr*14+tc];if(q){if(teamOf(q.o)!==mt&&q.t!==75)moves.push({fr:r,fc:c,tr,tc,cap:1});break;}moves.push({fr:r,fc:c,tr,tc,cap:0});tr--;tc--;}
        tr=r-1;tc=c+1;while(valid(tr,tc)){const q=board[tr*14+tc];if(q){if(teamOf(q.o)!==mt&&q.t!==75)moves.push({fr:r,fc:c,tr,tc,cap:1});break;}moves.push({fr:r,fc:c,tr,tc,cap:0});tr--;tc++;}
        tr=r+1;tc=c-1;while(valid(tr,tc)){const q=board[tr*14+tc];if(q){if(teamOf(q.o)!==mt&&q.t!==75)moves.push({fr:r,fc:c,tr,tc,cap:1});break;}moves.push({fr:r,fc:c,tr,tc,cap:0});tr++;tc--;}
        tr=r+1;tc=c+1;while(valid(tr,tc)){const q=board[tr*14+tc];if(q){if(teamOf(q.o)!==mt&&q.t!==75)moves.push({fr:r,fc:c,tr,tc,cap:1});break;}moves.push({fr:r,fc:c,tr,tc,cap:0});tr++;tc++;}
      }
    }
  }
  return moves;
}
const ND=[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const PF=[[-1,0],[0,1],[1,0],[0,-1]];
const PC=[[[-1,-1],[-1,1]],[[-1,1],[1,1]],[[1,-1],[1,1]],[[-1,-1],[1,-1]]];
function tryMove(board,o,m,mateAlive,mate){
  const fk=m.fr*14+m.fc, tk=m.tr*14+m.tc;
  const moving=board[fk];if(!moving)return false;
  let t=moving.t;if(moving.t===80&&(m.promo||isPromo(o,m.tr,m.tc)))t=81;
  const cap=board[tk];
  delete board[fk];board[tk]={t,o};
  const kp=kingPos(board,o);
  let ok=false;
  if(kp&&!attackedClean(board,kp[0],kp[1],teamOf(o))){
    ok=true;
    if(mateAlive){const mkp=kingPos(board,mate);if(mkp&&attackedClean(board,mkp[0],mkp[1],teamOf(mate)))ok=false;}
  }
  if(cap)board[tk]=cap;else delete board[tk];
  board[fk]=moving;
  if(ok){m.cap=cap?1:0;m.promo=(t===81&&moving.t===80)?1:0;}
  return ok;
}
function legalFor(board,o,elim){
  if(elim[o])return[];
  if(!kingPos(board,o))return[];
  const mate=o===0?2:o===2?0:o===1?3:1;
  const mateAlive=!elim[mate]&&!!kingPos(board,mate);
  const res=[];
  const ps=pseudoFor(board,o);
  for(let i=0;i<ps.length;i++) if(tryMove(board,o,ps[i],mateAlive,mate)) res.push(ps[i]);
  return res;
}
function hasAnyLegal(board,o,elim){
  if(elim[o])return false;
  if(!kingPos(board,o))return false;
  const mate=o===0?2:o===2?0:o===1?3:1;
  const mateAlive=!elim[mate]&&!!kingPos(board,mate);
  const ps=pseudoFor(board,o);
  for(let i=0;i<ps.length;i++) if(tryMove(board,o,ps[i],mateAlive,mate)) return true;
  return false;
}
function nextAlive(after,elim,n){const lim=n==null?4:Math.min(4,n);for(let i=1;i<=4;i++){const s=(after+i+8)%4;if(s<lim&&!elim[s])return s;}return null;}
function matVal(t){return t===80?1:t===78||t===66?3:t===82?5:t===81?9:0;}
function materialWinner(board){
  let a=0,b=0;
  for(const key in board){const p=board[key];const v=matVal(p.t);if(teamOf(p.o)===0)a+=v;else b+=v;}
  if(a===b)return null;
  return a>b?0:1;
}
function payoutsFor(w,ctx){
  const pot=ctx.pot||0;const out={};
  if(pot<=0)return out;
  const humans=[];
  for(let i=0;i<ctx.players.length;i++)if(ctx.players[i].kind==='human')humans.push(ctx.players[i]);
  if(!humans.length)return out;
  let win=[];
  if(w!=null){const idxs=w===0?[0,2]:[1,3];for(let i=0;i<idxs.length;i++){const pl=ctx.players[idxs[i]];if(pl&&pl.kind==='human')win.push(pl.id);}}
  if(!win.length)for(let i=0;i<humans.length;i++)win.push(humans[i].id);
  const sh=Math.floor(pot/win.length);
  let rem=pot-sh*win.length;
  for(let i=0;i<win.length;i++){out[win[i]]=sh+(rem>0?1:0);if(rem>0)rem--;}
  return out;
}
function pickMove(state,idx,ctx,biased){
  if(idx<0||state.winnerTeam!=null||state.eliminated[idx]) return {kind:'pass'};
  const ps=pseudoFor(state.board,idx);
  if(!ps.length){if(inCheck(state.board,idx))return{kind:'elim'};return{kind:'pass'};}
  const mate=idx===0?2:idx===2?0:idx===1?3:1;
  const mateAlive=!state.eliminated[mate]&&!!kingPos(state.board,mate);
  const r0=ctx.random();
  const start=Math.floor(r0*ps.length);
  const wantCap=biased&&r0<0.7;
  let fallback=-1;
  const tries=ps.length>24?24:ps.length;
  for(let k=0;k<tries;k++){
    const m=ps[(start+k)%ps.length];
    if(wantCap&&!m.cap&&k<tries-1)continue;
    if(tryMove(state.board,idx,m,mateAlive,mate)){
      if(!wantCap||m.cap)return{kind:'move',fr:m.fr,fc:m.fc,tr:m.tr,tc:m.tc};
      if(fallback<0)fallback=(start+k)%ps.length;
    }
  }
  if(fallback>=0){const m=ps[fallback];return{kind:'move',fr:m.fr,fc:m.fc,tr:m.tr,tc:m.tc};}
  const full=legalFor(state.board,idx,state.eliminated);
  if(!full.length){if(inCheck(state.board,idx))return{kind:'elim'};return{kind:'pass'};}
  const m2=full[Math.floor(ctx.random()*full.length)];
  return{kind:'move',fr:m2.fr,fc:m2.fc,tr:m2.tr,tc:m2.tc};
}
