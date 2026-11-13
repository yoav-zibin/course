// Shared rules for the ten declarative examples. The generated package prefixes
// this file with a constant KIND. No rendering, network or device APIs are used.
function fresh() {
  const sizes = {tictactoe:9, connect4:42, reversi:64, gomoku:81, hex:49, domineering:36, memory:16};
  const s = {board:Array(sizes[KIND] || 0).fill(-1), turn:0, scores:[0,0],
    selected:[], matched:[], roll:0, total:0, winner:-1, turns:0, over:false};
  if (KIND === 'reversi') {s.board[27]=1;s.board[28]=0;s.board[35]=0;s.board[36]=1;}
  if (KIND === 'nim') s.board = [15];
  if (KIND === 'mancala') s.board = [4,4,4,4,4,4,0,4,4,4,4,4,4,0];
  return s;
}
function flips(s, cell, seat) {
  if (s.board[cell] !== -1) return [];
  const out=[], r=Math.floor(cell/8), c=cell%8;
  for (let dr=-1;dr<=1;dr++) for (let dc=-1;dc<=1;dc++) {
    if (!dr && !dc) continue;
    let rr=r+dr,cc=c+dc,path=[];
    while (rr>=0&&rr<8&&cc>=0&&cc<8&&s.board[rr*8+cc]===1-seat) {
      path.push(rr*8+cc);rr+=dr;cc+=dc;
    }
    if (path.length&&rr>=0&&rr<8&&cc>=0&&cc<8&&s.board[rr*8+cc]===seat) out.push(...path);
  }
  return out;
}
function legal(s) {
  if (s.over) return [];
  if (KIND === 'pig') return [{action:'roll'},...(s.total ? [{action:'hold'}] : [])];
  if (KIND === 'nim') return [1,2,3].filter(n=>n<=s.board[0]).map(take=>({take}));
  if (KIND === 'mancala') return s.board.flatMap((n,pit)=>n&&pit>=(s.turn?7:0)&&pit<(s.turn?13:6)?[{pit}]:[]);
  if (KIND === 'connect4') return Array.from({length:7},(_,column)=>({column})).filter(m=>s.board[m.column]===-1);
  if (KIND === 'reversi') return s.board.flatMap((_,cell)=>flips(s,cell,s.turn).length?[{cell}]:[]);
  if (KIND === 'domineering') return s.board.flatMap((v,cell)=>v===-1&&
    (s.turn ? cell%6<5&&s.board[cell+1]===-1 : cell<30&&s.board[cell+6]===-1)?[{cell}]:[]);
  if (KIND === 'memory') return s.board.flatMap((_,cell)=>!s.matched.includes(cell)&&
    !(s.selected.length===1&&s.selected.includes(cell))?[{cell}]:[]);
  return s.board.flatMap((v,cell)=>v===-1?[{cell}]:[]);
}
function lineWon(s, cell, n, need) {
  const r=Math.floor(cell/n),c=cell%n,seat=s.turn;
  return [[0,1],[1,0],[1,1],[1,-1]].some(([dr,dc])=>{
    let count=1;
    for (const sign of [-1,1]) {
      let rr=r+dr*sign,cc=c+dc*sign;
      while(rr>=0&&rr<Math.ceil(s.board.length/n)&&cc>=0&&cc<n&&s.board[rr*n+cc]===seat) {
        count++;rr+=dr*sign;cc+=dc*sign;
      }
    }
    return count>=need;
  });
}
function hexWon(s) {
  const n=7,seen=new Set(),todo=[];
  for(let i=0;i<n;i++){const cell=s.turn?i*n:i;if(s.board[cell]===s.turn){seen.add(cell);todo.push(cell);}}
  while(todo.length) {
    const cell=todo.pop(),r=Math.floor(cell/n),c=cell%n;
    if(s.turn?c===n-1:r===n-1)return true;
    for(const [dr,dc] of [[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0]]) {
      const rr=r+dr,cc=c+dc,k=rr*n+cc;
      if(rr>=0&&rr<n&&cc>=0&&cc<n&&s.board[k]===s.turn&&!seen.has(k)){seen.add(k);todo.push(k);}
    }
  }
  return false;
}
function finish(s,winner){s.over=true;s.winner=winner;}
function majority(s,a,b){finish(s,a===b?-1:a>b?0:1);}
function payout(s,ctx) {
  const humans=ctx.players.filter(p=>p.kind==='human'&&p.active!==false),winner=ctx.players[s.winner];
  const recipients=winner&&winner.kind==='human'&&winner.active!==false?[winner]:humans;
  const out={};if(!recipients.length)return out;
  recipients.forEach((p,i)=>out[p.id]=Math.floor(ctx.pot/recipients.length)+(i<ctx.pot%recipients.length?1:0));
  return out;
}
function apply(s,move,ctx) {
  const seat=s.turn;s.turns++;
  if(KIND==='nim') {s.board[0]-=move.take;if(!s.board[0])finish(s,seat);}
  else if(KIND==='pig') {
    if(move.action==='roll') {s.roll=1+Math.floor(ctx.random()*6);if(s.roll===1){s.total=0;s.turn=1-seat;}else s.total+=s.roll;}
    else{s.scores[seat]+=s.total;s.total=0;s.turn=1-seat;if(s.scores[seat]>=30)finish(s,seat);}
    // A finite match even when both random opponents keep rolling.
    if(!s.over&&s.turns>=300)majority(s,s.scores[0],s.scores[1]);
    return;
  } else if(KIND==='memory') {
    if(s.selected.length===2)s.selected=[];
    s.selected.push(move.cell);
    if(s.selected.length===2) {
      if(s.board[s.selected[0]]===s.board[s.selected[1]]){s.matched.push(...s.selected);s.scores[seat]++;s.selected=[];}
      else s.turn=1-seat;
      if(s.matched.length===16)majority(s,s.scores[0],s.scores[1]);
    }
    return;
  } else if(KIND==='mancala') {
    let i=move.pit,stones=s.board[i];s.board[i]=0;
    while(stones){i=(i+1)%14;if(i===(seat?6:13))continue;s.board[i]++;stones--;}
    const store=seat?13:6,own=i>=(seat?7:0)&&i<(seat?13:6);
    if(own&&s.board[i]===1&&s.board[12-i]){s.board[store]+=1+s.board[12-i];s.board[i]=s.board[12-i]=0;}
    if(s.board.slice(0,6).every(n=>!n)||s.board.slice(7,13).every(n=>!n)||s.turns>=300) {
      for(let j=0;j<6;j++){s.board[6]+=s.board[j];s.board[j]=0;s.board[13]+=s.board[j+7];s.board[j+7]=0;}
      majority(s,s.board[6],s.board[13]);
    } else s.turn=i===store?seat:1-seat;
    return;
  } else if(KIND==='reversi') {
    for(const cell of flips(s,move.cell,seat))s.board[cell]=seat;
    s.board[move.cell]=seat;s.turn=1-seat;
    if(!legal(s).length){s.turn=seat;if(!legal(s).length)majority(s,s.board.filter(v=>v===0).length,s.board.filter(v=>v===1).length);}
    return;
  } else if(KIND==='domineering') {
    s.board[move.cell]=seat;s.board[move.cell+(seat?1:6)]=seat;
    s.turn=1-seat;if(!legal(s).length)finish(s,seat);return;
  } else {
    let cell=move.cell;
    if(KIND==='connect4'){cell=move.column;while(cell+7<42&&s.board[cell+7]===-1)cell+=7;}
    s.board[cell]=seat;
    const won=KIND==='hex'?hexWon(s):lineWon(s,cell,KIND==='tictactoe'?3:KIND==='connect4'?7:9,KIND==='tictactoe'?3:KIND==='connect4'?4:5);
    if(won)finish(s,seat);else if(s.board.every(v=>v!==-1))finish(s,-1);
  }
  s.turn=1-seat;
}
const game={
  newMatch(ctx){const s=fresh();if(KIND==='memory'){s.board=Array.from({length:16},(_,i)=>i%8);for(let i=15;i>0;i--){const j=Math.floor(ctx.random()*(i+1));[s.board[i],s.board[j]]=[s.board[j],s.board[i]];}}return {state:s,turn:[ctx.players[0].id]};},
  applyMove(state,id,move,ctx){
    if(state.over||ctx.players[state.turn].id!==id||!move||typeof move!=='object'||Array.isArray(move))throw new InvalidMove('Illegal move');
    const options=legal(state),keys=Object.keys(move);
    if(!options.some(m=>Object.keys(m).length===keys.length&&keys.every(k=>Object.prototype.hasOwnProperty.call(m,k)&&m[k]===move[k])))throw new InvalidMove('Illegal move');
    const s=JSON.parse(JSON.stringify(state));apply(s,move,ctx);
    return s.over?{state:s,turn:null,payouts:payout(s,ctx)}:{state:s,turn:[ctx.players[s.turn].id]};
  },
  viewFor(state,id,ctx){
    const s=JSON.parse(JSON.stringify(state));
    if(KIND==='memory')s.board=s.board.map((v,i)=>s.matched.includes(i)||s.selected.includes(i)?v:-1);
    // Only the active viewer receives interactive affordances. Spectators see
    // the same public board, with no legal targets or private card values.
    s.legal=id===ctx.players[state.turn].id&&!state.over?legal(state):[];return s;
  },
  randomMove(s,id,ctx){const options=legal(s);return options[Math.floor(ctx.random()*options.length)];},
  computerMove(s,id,ctx){
    const options=legal(s);
    if(KIND==='pig')return {action:s.total>=10?'hold':'roll'};
    return options[Math.floor(ctx.random()*options.length)];
  }
};
