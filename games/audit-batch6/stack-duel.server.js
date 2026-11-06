const game = {
  ROWS: 10, COLS: 8,
  PIECES: { I:[[0,0],[0,1],[0,2],[0,3]], O:[[0,0],[0,1],[1,0],[1,1]], T:[[0,0],[0,1],[0,2],[1,1]], S:[[0,1],[0,2],[1,0],[1,1]], Z:[[0,0],[0,1],[1,1],[1,2]], J:[[0,0],[1,0],[1,1],[1,2]], L:[[0,2],[1,0],[1,1],[1,2]] },
  NAMES: ['I','O','T','S','Z','J','L'],
  rotations(piece) {
    const norm=(cells)=>{const r0=Math.min(...cells.map(c=>c[0])),c0=Math.min(...cells.map(c=>c[1]));return cells.map(([r,c])=>[r-r0,c-c0]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);};
    const out=[norm(this.PIECES[piece])];
    for(let i=1;i<4;i++) out.push(norm(out[i-1].map(([r,c])=>[c,-r])));
    return out;
  },
  width(cells){return Math.max(...cells.map(c=>c[1]))+1;},
  spawnCol(cells){return Math.floor((this.COLS-this.width(cells))/2);},
  randomPiece(rand){return this.NAMES[Math.floor(rand()*this.NAMES.length)];},
  fits(board,cells,row,col){
    for(const [r,c] of cells){const y=r+row,x=c+col;if(y<0||y>=this.ROWS||x<0||x>=this.COLS||board[y][x]!==-1) return false;}
    return true;
  },
  landingRow(board,cells,col){
    if(!this.fits(board,cells,0,col)) return -1;
    let row=0; while(this.fits(board,cells,row+1,col)) row++; return row;
  },
  place(board,cells,row,col,seat){
    const next=board.map(r=>[...r]);
    for(const [r,c] of cells) next[r+row][c+col]=seat;
    const kept=next.filter(r=>r.some(v=>v===-1));
    const cleared=this.ROWS-kept.length;
    const empty=Array.from({length:cleared},()=>Array(this.COLS).fill(-1));
    return {board:[...empty,...kept],cleared};
  },
  holes(board){
    let h=0;
    for(let c=0;c<this.COLS;c++){let roof=false;for(let r=0;r<this.ROWS;r++){if(board[r][c]!==-1)roof=true;else if(roof)h++;}}
    return h;
  },
  legalMoves(state){
    const moves=[];const seen=new Set();
    const rots=this.rotations(state.current);
    for(let rot=0;rot<4;rot++){
      const cells=rots[rot];const key=JSON.stringify(cells);
      if(seen.has(key)) continue; seen.add(key);
      for(let col=0;col+this.width(cells)<=this.COLS;col++){
        if(this.landingRow(state.board,cells,col)>=0) moves.push({rot,col});
      }
    }
    return moves;
  },
  bestMove(state){
    const seen=new Set();let best=null;
    const rots=this.rotations(state.current);
    for(let rot=0;rot<4;rot++){
      const cells=rots[rot];const key=JSON.stringify(cells);
      if(seen.has(key)) continue; seen.add(key);
      for(let col=0;col+this.width(cells)<=this.COLS;col++){
        const row=this.landingRow(state.board,cells,col);
        if(row<0) continue;
        const {board,cleared}=this.place(state.board,cells,row,col,0);
        const score=[cleared,-(this.ROWS-row),-this.holes(board)];
        const better=!best||score[0]>best.score[0]||(score[0]===best.score[0]&&(score[1]>best.score[1]||(score[1]===best.score[1]&&score[2]>best.score[2])));
        if(better) best={rot,col,score};
      }
    }
    return best?{rot:best.rot,col:best.col}:null;
  },
  seatOf(ctx,playerId){return ctx.players.findIndex(p=>p.id===playerId);},
  payoutsFor(state,ctx){
    const pot=ctx.pot;
    const humans=ctx.players.filter(p=>p.kind==='human').map(p=>p.id).sort();
    const out={};
    if(humans.length===0) return out;
    if(pot<=0){for(const h of humans) out[h]=0;return out;}
    const best=Math.max(...state.scores);
    const winSeats=state.scores.map((s,i)=>i).filter(i=>state.scores[i]===best);
    const winIds=new Set(winSeats.map(i=>ctx.players[i]?ctx.players[i].id:null));
    let recipients=humans.filter(id=>winIds.has(id));
    if(recipients.length===0) recipients=[...humans];
    recipients.sort();
    const base=Math.floor(pot/recipients.length);let rem=pot-base*recipients.length;
    for(const h of humans) out[h]=0;
    for(const r of recipients){out[r]=base+(rem>0?1:0);if(rem>0)rem--;}
    return out;
  },
  newMatch(ctx){
    const n=ctx.players.length;
    const state={board:Array.from({length:this.ROWS},()=>Array(this.COLS).fill(-1)),current:'T',next:'L',scores:Array(n).fill(0),lines:0,last_move:null,winners:null,turnSeat:0,over:false};
    return {state,turn:[ctx.players[0].id]};
  },
  applyMove(state,playerId,move,ctx){
    if(state.over) throw new InvalidMove('match is over');
    const seat=this.seatOf(ctx,playerId);
    if(seat<0) throw new InvalidMove('unknown player');
    if(seat!==state.turnSeat) throw new InvalidMove('not your turn');
    if(!move||typeof move!=='object') throw new InvalidMove('missing move');
    const rot=move.rot,col=move.col;
    if(!Number.isInteger(rot)||rot<0||rot>3) throw new InvalidMove('bad rotation');
    if(!Number.isInteger(col)||col<0||col>=this.COLS) throw new InvalidMove('bad column');
    const cells=this.rotations(state.current)[rot];
    if(col+this.width(cells)>this.COLS) throw new InvalidMove('does not fit');
    const row=this.landingRow(state.board,cells,col);
    if(row<0) throw new InvalidMove('no room there');
    const n=ctx.players.length;
    while(state.scores.length<n) state.scores.push(0);
    const {board,cleared}=this.place(state.board,cells,row,col,seat);
    const scores=state.scores.slice();scores[seat]+=cleared;
    const current=state.next;
    const next=this.randomPiece(ctx.random.bind(ctx));
    // Players choose any rotation and column before the piece drops. End
    // only when none of those placements fits, not just the center spawn.
    const over=this.legalMoves({board,current}).length===0;
    let winners=null;
    if(over){const best=Math.max(...scores);winners=scores.map((s,i)=>i).filter(i=>scores[i]===best);}
    const ns={board,current,next,scores,lines:state.lines+cleared,last_move:{seat,piece:state.current,cleared},winners,turnSeat:over?state.turnSeat:(seat+1)%n,over};
    if(over) return {state:ns,turn:null,payouts:this.payoutsFor(ns,ctx)};
    return {state:ns,turn:[ctx.players[ns.turnSeat].id]};
  },
  computerMove(state,playerId,ctx){
    const m=this.bestMove(state);
    if(m) return m;
    return this.randomMove(state,playerId,ctx);
  },
  randomMove(state,playerId,ctx){
    const moves=this.legalMoves(state);
    if(moves.length===0) throw new InvalidMove('no moves');
    return moves[Math.floor(ctx.random()*moves.length)];
  },
  viewFor(state,playerId,ctx){
    return {board:state.board.map(r=>[...r]),current:state.current,next:state.next,scores:[...state.scores],lines:state.lines,last_move:state.last_move?{...state.last_move}:null,winners:state.winners?[...state.winners]:null};
  },
  playerLeft(state,playerId,ctx){
    const payout=Math.floor(ctx.pot*ctx.estimateWinChance(state,playerId));
    if(state.over) return {state,turn:null,payout};
    return {state,turn:[ctx.players[state.turnSeat].id],payout};
  }
};