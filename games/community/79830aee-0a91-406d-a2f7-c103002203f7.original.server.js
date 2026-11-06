const game = {
  LINES: [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]],
  scoresOf(cells) {
    const s=[0,0], lc=[0,0];
    cells.forEach(c=>{ if(c.o!==null&&c.o!==undefined) s[c.o]+=c.v; });
    this.LINES.forEach(L=>{
      for(let p=0;p<2;p++) if(cells[L[0]].o===p&&cells[L[1]].o===p&&cells[L[2]].o===p){ lc[p]++; s[p]+=2; }
    });
    return {s,lc};
  },
  idxOf(state, playerId, ctx) {
    return ctx.players.findIndex(p=>p.id===playerId);
  },
  isFull(cells){ return cells.every(c=>c.o!==null&&c.o!==undefined); },
  winnerOf(cells) {
    const {s}=this.scoresOf(cells);
    if(s[0]===s[1]) return -1;
    return s[0]>s[1]?0:1;
  },
  payoutsFor(winner, ctx) {
    const pot=ctx.pot;
    const humans=ctx.players.filter(p=>p.kind!=="computer");
    const payouts={};
    if(humans.length===0) return payouts;
    if(pot===0) { humans.forEach(h=>payouts[h.id]=0); return payouts; }
    const humanIdx=humans.map(h=>ctx.players.findIndex(p=>p.id===h.id));
    if(winner===-1) {
      const base=Math.floor(pot/humans.length);
      humans.forEach(h=>payouts[h.id]=base);
      payouts[humans[0].id]+=pot-base*humans.length;
      return payouts;
    }
    const wId=ctx.players[winner]?ctx.players[winner].id:null;
    const wIsHuman=wId&&humans.some(h=>h.id===wId);
    if(wIsHuman) {
      humans.forEach(h=>payouts[h.id]=0);
      payouts[wId]=pot;
      return payouts;
    }
    // winner is computer: refund split among humans
    const base=Math.floor(pot/humans.length);
    humans.forEach(h=>payouts[h.id]=base);
    payouts[humans[0].id]+=pot-base*humans.length;
    return payouts;
  },
  newMatch(ctx) {
    const vals=[1,1,1,2,2,2,3,3,3];
    for(let i=vals.length-1;i>0;i--){ const j=Math.floor(ctx.random()*(i+1)); const t=vals[i]; vals[i]=vals[j]; vals[j]=t; }
    const cells=vals.map(v=>({v,o:null}));
    const state={cells};
    return {state, turn:[ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    const idx=this.idxOf(state,playerId,ctx);
    if(idx<0) throw new InvalidMove("unknown player");
    const cells=state.cells.map(c=>({v:c.v,o:c.o}));
    if(this.isFull(cells)) throw new InvalidMove("game over");
    if(!move||typeof move.cell!=="number"||Math.floor(move.cell)!==move.cell||move.cell<0||move.cell>8)
      throw new InvalidMove("pick a star 0-8");
    // enforce turn order: whose cells count parity tells expected player
    const claimed=cells.filter(c=>c.o!==null&&c.o!==undefined).length;
    const expected=claimed%ctx.players.length;
    if(idx!==expected) throw new InvalidMove("not your turn");
    if(cells[move.cell].o!==null&&cells[move.cell].o!==undefined) throw new InvalidMove("star taken");
    cells[move.cell].o=idx;
    const ns={cells};
    if(this.isFull(cells)) {
      const w=this.winnerOf(cells);
      return {state:ns, turn:null, payouts:this.payoutsFor(w,ctx)};
    }
    const next=(idx+1)%ctx.players.length;
    return {state:ns, turn:[ctx.players[next].id]};
  },
  legalCells(state) {
    const out=[];
    state.cells.forEach((c,i)=>{ if(c.o===null||c.o===undefined) out.push(i); });
    return out;
  },
  scoreMove(cells, i, me) {
    const opp=(me+1)%2;
    let sc=cells[i].v;
    this.LINES.forEach(L=>{
      if(!L.includes(i)) return;
      const others=L.filter(x=>x!==i);
      const mine=others.filter(x=>cells[x].o===me).length;
      const op=others.filter(x=>cells[x].o===opp).length;
      const empty=others.filter(x=>cells[x].o===null||cells[x].o===undefined).length;
      if(mine===2) sc+=2.5;
      else if(mine===1&&empty===1) sc+=0.6;
      if(op===2) sc+=2.2;
      else if(op===1&&empty===1) sc+=0.25;
    });
    if(i===4) sc+=0.3;
    return sc;
  },
  computerMove(state, playerId, ctx) {
    const idx=this.idxOf(state,playerId,ctx);
    const me=idx<0?0:idx;
    const cells=state.cells;
    let best=-1,bestScore=-9999;
    // deterministic order, slight random tie-break via ctx.random
    const order=cells.map((_,i)=>i);
    // evaluate with small noise
    order.forEach(i=>{
      if(cells[i].o!==null&&cells[i].o!==undefined) return;
      const sc=this.scoreMove(cells,i,me)+ctx.random()*0.01;
      if(sc>bestScore){bestScore=sc;best=i;}
    });
    if(best<0) return this.randomMove(state,playerId,ctx);
    return {cell:best};
  },
  randomMove(state, playerId, ctx) {
    const legal=this.legalCells(state);
    if(legal.length===0) throw new InvalidMove("no moves");
    return {cell: legal[Math.floor(ctx.random()*legal.length)]};
  },
  viewFor(state, playerId, ctx) {
    const cells=state.cells.map(c=>({v:c.v,o:c.o}));
    const {s,lc}=this.scoresOf(cells);
    const full=this.isFull(cells);
    return {cells, scores:s, lines:lc, winner: full?this.winnerOf(cells):null};
  }
};