const game = {
  ROWS: 6, COLS: 7,
  emptyBoard: function(){ return Array.from({length:6},function(){return Array(7).fill(0);}); },
  lowestEmpty: function(board,col){
    for(let r=5;r>=0;r--) if(board[r][col]===0) return r;
    return -1;
  },
  boardFull: function(b){ for(let r=0;r<6;r++) for(let c=0;c<7;c++) if(b[r][c]===0) return false; return true; },
  findWin: function(board,r,c,v){
    const dirs=[[0,1],[1,0],[1,1],[-1,1]];
    for(let d=0;d<dirs.length;d++){
      const dr=dirs[d][0],dc=dirs[d][1];
      for(let off=-3;off<=0;off++){
        const cells=[];let ok=true;
        for(let k=0;k<4;k++){
          const rr=r+dr*(off+k),cc=c+dc*(off+k);
          if(rr<0||rr>=6||cc<0||cc>=7||board[rr][cc]!==v){ok=false;break;}
          cells.push([rr,cc]);
        }
        if(ok) return cells;
      }
    }
    return null;
  },
  legalCols: function(board){
    const a=[];
    for(let c=0;c<7;c++){let full=true;for(let r=0;r<6;r++) if(board[r][c]===0){full=false;break;} if(!full)a.push(c);}
    return a;
  },
  wouldWin: function(board,col,val){
    const r=game.lowestEmpty(board,col);if(r===-1)return false;
    const nb=board.map(function(x){return x.slice();});nb[r][col]=val;
    return !!game.findWin(nb,r,col,val);
  },
  cur: function(state){
    if(state.toMove===1||state.toMove===2) return state.toMove;
    if(state.turn===1||state.turn===2) return state.turn;
    return 1;
  },
  turnIdFor: function(ctx, num){
    const idx=num-1;
    if(ctx.players && ctx.players[idx]) return ctx.players[idx].id;
    return null;
  },
  payoutsForEnd: function(state, ctx){
    const pot=ctx.pot||0;
    const humans=(ctx.players||[]).filter(function(p){return p.kind==='human';});
    if(pot<=0||humans.length===0) return {};
    const out={};
    function give(id,amt){ out[id]=(out[id]||0)+amt; }
    if(state.status==='WINNER_P1'||state.status==='WINNER_P2'){
      const wIdx=state.status==='WINNER_P1'?0:1;
      const w=ctx.players[wIdx];
      if(w && w.kind==='human'){ give(w.id,pot); return out; }
      const each=Math.floor(pot/humans.length);let rem=pot-each*humans.length;
      humans.forEach(function(h){give(h.id,each);});
      for(let i=0;rem>0;i++,rem--) give(humans[i%humans.length].id,1);
      return out;
    }
    const each=Math.floor(pot/humans.length);let rem=pot-each*humans.length;
    humans.forEach(function(h){give(h.id,each);});
    for(let i=0;rem>0;i++,rem--) give(humans[i%humans.length].id,1);
    return out;
  },
  newMatch: function(ctx){
    const state={board:game.emptyBoard(),toMove:1,status:'IN_PROGRESS',winningCells:[],winner:0};
    const first=game.turnIdFor(ctx,1);
    return {state:state, turn:first?[first]:[]};
  },
  applyMove: function(state, playerId, move, ctx){
    if(!state||state.status!=='IN_PROGRESS') throw new InvalidMove('Game is over');
    const me=game.cur(state);
    const expected=game.turnIdFor(ctx,me);
    if(playerId!==expected) throw new InvalidMove('Not your turn');
    const col=move&&move.col;
    if(!Number.isInteger(col)||col<0||col>=7) throw new InvalidMove('Pick a column 0-6');
    const row=game.lowestEmpty(state.board,col);
    if(row===-1) throw new InvalidMove('Column full');
    const nb=state.board.map(function(r){return r.slice();});
    nb[row][col]=me;
    const win=game.findWin(nb,row,col,me);
    if(win){
      const ns={board:nb,toMove:me,status:me===1?'WINNER_P1':'WINNER_P2',winningCells:win,winner:me};
      return {state:ns, turn:null, payouts:game.payoutsForEnd(ns,ctx)};
    }
    if(game.boardFull(nb)){
      const ns={board:nb,toMove:me,status:'DRAW',winningCells:[],winner:0};
      return {state:ns, turn:null, payouts:game.payoutsForEnd(ns,ctx)};
    }
    const nt=me===1?2:1;
    const ns={board:nb,toMove:nt,status:'IN_PROGRESS',winningCells:[],winner:0};
    const nid=game.turnIdFor(ctx,nt);
    return {state:ns, turn:nid?[nid]:[]};
  },
  computerMove: function(state, playerId, ctx){
    const me=game.cur(state), opp=me===1?2:1;
    const legal=game.legalCols(state.board);
    for(let i=0;i<legal.length;i++) if(game.wouldWin(state.board,legal[i],me)) return {col:legal[i]};
    for(let i=0;i<legal.length;i++) if(game.wouldWin(state.board,legal[i],opp)) return {col:legal[i]};
    const pref=[3,2,4,1,5,0,6].filter(function(c){return legal.indexOf(c)!==-1;});
    if(!pref.length) return {col:legal[0]};
    if(ctx.random()<0.12) return {col:legal[Math.floor(ctx.random()*legal.length)]};
    return {col:pref[0]};
  },
  randomMove: function(state, playerId, ctx){
    const legal=game.legalCols(state.board);
    return {col:legal[Math.floor(ctx.random()*legal.length)]};
  },
  viewFor: function(state, playerId, ctx){
    return {board:state.board.map(function(r){return r.slice();}),toMove:game.cur(state),status:state.status,winningCells:(state.winningCells||[]).map(function(c){return c.slice();}),winner:state.winner||0};
  },
  playerLeft: function(state, playerId, ctx){
    const payout=Math.floor((ctx.pot||0)*ctx.estimateWinChance(state,playerId));
    if(!state||state.status!=='IN_PROGRESS') return {state:state, turn:null, payout:0};
    const nid=game.turnIdFor(ctx,game.cur(state));
    return {state:state, turn:nid?[nid]:[], payout:payout};
  }
};