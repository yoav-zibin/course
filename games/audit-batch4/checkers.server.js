const game = {
  newMatch(ctx) {
    const board = Array.from({length:8},()=>Array(8).fill(null));
    for(let r=0;r<3;r++) for(let c=0;c<8;c++) if((r+c)%2===1) board[r][c]={c:1,k:false};
    for(let r=5;r<8;r++) for(let c=0;c<8;c++) if((r+c)%2===1) board[r][c]={c:0,k:false};
    const state={board,toMove:0,chain:null,winner:null,draw:false,noCap:0,lastMove:null};
    return {state, turn:[ctx.players[0].id]};
  },
  inB(r,c){return r>=0&&r<8&&c>=0&&c<8;},
  dirs(p){ if(p.k) return [[-1,-1],[-1,1],[1,-1],[1,1]]; return p.c===0?[[-1,-1],[-1,1]]:[[1,-1],[1,1]]; },
  jumps(board,r,c){
    const p=board[r][c]; if(!p) return [];
    const out=[];
    const ds=game.dirs(p);
    for(let i=0;i<ds.length;i++){const dr=ds[i][0],dc=ds[i][1];
      const mr=r+dr,mc=c+dc,tr=r+2*dr,tc=c+2*dc;
      if(!game.inB(tr,tc)||!game.inB(mr,mc)) continue;
      if(board[tr][tc]!==null) continue;
      const m=board[mr][mc];
      if(m&&m.c!==p.c) out.push({from:{r:r,c:c},to:{r:tr,c:tc},cap:{r:mr,c:mc}});
    }
    return out;
  },
  steps(board,r,c){
    const p=board[r][c]; if(!p) return [];
    const out=[];
    const ds=game.dirs(p);
    for(let i=0;i<ds.length;i++){const tr=r+ds[i][0],tc=c+ds[i][1];
      if(!game.inB(tr,tc)) continue;
      if(board[tr][tc]===null) out.push({from:{r:r,c:c},to:{r:tr,c:tc},cap:null});
    }
    return out;
  },
  legal(state){
    const b=state.board, pl=state.toMove;
    if(state.chain){
      const r=state.chain.r,c=state.chain.c;
      if(b[r]&&b[r][c]&&b[r][c].c===pl) return game.jumps(b,r,c);
      return [];
    }
    let jumps=[];
    for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(b[r][c]&&b[r][c].c===pl) jumps.push.apply(jumps,game.jumps(b,r,c));
    if(jumps.length) return jumps;
    let steps=[];
    for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(b[r][c]&&b[r][c].c===pl) steps.push.apply(steps,game.steps(b,r,c));
    return steps;
  },
  count(b){ let a=[0,0]; for(let r=0;r<8;r++) for(let c=0;c<8;c++) if(b[r][c]) a[b[r][c].c]++; return a; },
  turnId(state,ctx){ return ctx.players[state.toMove].id; },
  payoutsFor(state,ctx){
    const humans=ctx.players.filter(function(p){return p.kind==='human';});
    const pot=ctx.pot;
    const pay={};
    if(humans.length===0) return pay;
    function split(){
      const each=Math.floor(pot/humans.length);
      let rem=pot-each*humans.length;
      for(let i=0;i<humans.length;i++){ pay[humans[i].id]=each; if(rem>0){pay[humans[i].id]++;rem--;} }
    }
    if(state.draw){ split(); return pay; }
    if(state.winner!==null&&state.winner!==undefined){
      const w=ctx.players[state.winner];
      const wId=w?w.id:null;
      let wIsHuman=false;
      for(let i=0;i<humans.length;i++) if(humans[i].id===wId) wIsHuman=true;
      if(wIsHuman){ for(let i=0;i<humans.length;i++) pay[humans[i].id]=0; pay[wId]=pot; return pay; }
      split(); return pay;
    }
    split(); return pay;
  },
  applyMove(state,playerId,move,ctx){
    if(state.winner!==null&&state.winner!==undefined||state.draw) throw new InvalidMove('Game is over');
    const expect=game.turnId(state,ctx);
    if(playerId!==expect) throw new InvalidMove('Not your turn');
    if(!move||!move.from||!move.to) throw new InvalidMove('Bad move');
    const fr=move.from.r,fc=move.from.c,tr=move.to.r,tc=move.to.c;
    if(!Number.isInteger(fr)||!Number.isInteger(fc)||!Number.isInteger(tr)||!Number.isInteger(tc)) throw new InvalidMove('Bad move');
    if(!game.inB(fr,fc)||!game.inB(tr,tc)) throw new InvalidMove('Off board');
    const legal=game.legal(state);
    let found=null;
    for(let i=0;i<legal.length;i++){const m=legal[i]; if(m.from.r===fr&&m.from.c===fc&&m.to.r===tr&&m.to.c===tc){found=m;break;}}
    if(!found) throw new InvalidMove(legal.length&&legal[0].cap?'You must capture':'Illegal move');
    const b=state.board.map(function(row){return row.map(function(p){return p?{c:p.c,k:p.k}:null;});});
    const p=b[fr][fc];
    b[fr][fc]=null;
    let promoted=false;
    if(!p.k){ if(p.c===0&&tr===0){p.k=true;promoted=true;} if(p.c===1&&tr===7){p.k=true;promoted=true;} }
    b[tr][tc]=p;
    // A man advancing toward promotion is progress, just like a capture.
    let noCap=(found.cap||!state.board[fr][fc].k)?0:state.noCap+1;
    let toMove=state.toMove, chain=null;
    if(found.cap){
      b[found.cap.r][found.cap.c]=null;
      if(!promoted){
        const more=game.jumps(b,tr,tc);
        if(more.length){ chain={r:tr,c:tc}; toMove=state.toMove; }
        else toMove=1-state.toMove;
      } else toMove=1-state.toMove;
    } else toMove=1-state.toMove;
    const ns={board:b,toMove:toMove,chain:chain,winner:null,draw:false,noCap:noCap,lastMove:{from:{r:fr,c:fc},to:{r:tr,c:tc}}};
    const cnt=game.count(b);
    if(cnt[0]===0){ ns.winner=1; return {state:ns,turn:null,payouts:game.payoutsFor(ns,ctx)}; }
    if(cnt[1]===0){ ns.winner=0; return {state:ns,turn:null,payouts:game.payoutsFor(ns,ctx)}; }
    const oppMoves=game.legal({board:b,toMove:toMove,chain:chain});
    if(oppMoves.length===0){ ns.winner=state.toMove; return {state:ns,turn:null,payouts:game.payoutsFor(ns,ctx)}; }
    if(noCap>=80){ ns.draw=true; return {state:ns,turn:null,payouts:game.payoutsFor(ns,ctx)}; }
    const nextId=ctx.players[ns.toMove].id;
    return {state:ns,turn:[nextId]};
  },
  computerMove(state,playerId,ctx){
    const legal=game.legal(state);
    if(!legal.length) return {from:{r:0,c:1},to:{r:0,c:1}};
    let best=legal[0],bestScore=-1e9;
    for(let i=0;i<legal.length;i++){
      const m=legal[i];
      let s=ctx.random()*2;
      const p=state.board[m.from.r][m.from.c];
      if(m.cap){
        const v=state.board[m.cap.r][m.cap.c];
        s+=10+(v&&v.k?4:0);
        if(!p.k){ if(p.c===0&&m.to.r===0)s+=5; if(p.c===1&&m.to.r===7)s+=5; }
        s+=(3-Math.abs(3.5-m.to.c))*0.3;
      } else {
        if(!p.k){ if(p.c===0&&m.to.r===0)s+=6; if(p.c===1&&m.to.r===7)s+=6; }
        s+=(p.k?0:1)+(3-Math.abs(3.5-m.to.c))*0.2+ctx.random();
      }
      if(s>bestScore){bestScore=s;best=m;}
    }
    return {from:{r:best.from.r,c:best.from.c},to:{r:best.to.r,c:best.to.c}};
  },
  randomMove(state,playerId,ctx){
    const legal=game.legal(state);
    if(!legal.length) return {from:{r:0,c:1},to:{r:0,c:1}};
    const i=Math.floor(ctx.random()*legal.length);
    const m=legal[i];
    return {from:{r:m.from.r,c:m.from.c},to:{r:m.to.r,c:m.to.c}};
  },
  viewFor(state,playerId,ctx){
    return {board:state.board.map(function(row){return row.map(function(p){return p?{c:p.c,k:p.k}:null;});}),toMove:state.toMove,chain:state.chain?{r:state.chain.r,c:state.chain.c}:null,winner:state.winner,draw:state.draw,noCap:state.noCap,lastMove:state.lastMove?{from:{r:state.lastMove.from.r,c:state.lastMove.from.c},to:{r:state.lastMove.to.r,c:state.lastMove.to.c}}:null,moves:game.legal(state)};
  }
};