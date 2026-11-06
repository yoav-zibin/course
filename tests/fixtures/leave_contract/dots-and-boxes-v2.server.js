const game = {
  boxEdges(i){ const r=Math.floor(i/3), c=i%3; return [r*3+c,(r+1)*3+c,12+r*4+c,12+r*4+c+1]; },
  legal(s){ const out=[]; for(let i=0;i<24;i++) if(s.edges[i]===null) out.push(i); return out; },
  seatOf(state,playerId,ctx){ return ctx.players.findIndex(p=>p.id===playerId); },
  newMatch(ctx){
    const state={edges:Array(24).fill(null),boxes:Array(9).fill(null)};
    return {state, turn:[ctx.players[0].id]};
  },
  applyMove(state,playerId,move,ctx){
    const seat=this.seatOf(state,playerId,ctx);
    if(seat<0) throw new InvalidMove("unknown player");
    const edge=move&&move.edge;
    if(!Number.isInteger(edge)||edge<0||edge>=24) throw new InvalidMove("pick an edge 0-23");
    if(state.edges[edge]!==null) throw new InvalidMove("edge taken");
    const s={edges:state.edges.slice(),boxes:state.boxes.slice()};
    s.edges[edge]=seat;
    let gained=false;
    for(let i=0;i<9;i++){
      if(s.boxes[i]===null&&this.boxEdges(i).every(e=>s.edges[e]!==null)){s.boxes[i]=seat;gained=true;}
    }
    if(s.boxes.every(x=>x!==null)){
      const counts=ctx.players.map((_,i)=>s.boxes.filter(x=>x===i).length);
      let best=0;for(let i=1;i<counts.length;i++)if(counts[i]>counts[best])best=i;
      const tied=counts.filter(c=>c===counts[best]).length>1;
      const humans=ctx.players.filter(p=>p.kind==="human");
      const payouts={};
      if(humans.length){
        if(!tied&&humans.some(h=>h.id===ctx.players[best].id)){humans.forEach(h=>payouts[h.id]=0);payouts[ctx.players[best].id]=ctx.pot;}
        else{const each=Math.floor(ctx.pot/humans.length);let rem=ctx.pot-each*humans.length;humans.forEach(h=>{payouts[h.id]=each+(rem>0?1:0);if(rem>0)rem--;});}
      }
      return {state:s,turn:null,payouts};
    }
    let nextSeat=gained?seat:1-seat;
    if(nextSeat<0||nextSeat>=ctx.players.length) nextSeat=seat;
    return {state:s,turn:[ctx.players[nextSeat].id]};
  },
  scoreEdge(s,seat,e){
    let v=0;
    for(let i=0;i<9;i++){
      if(s.boxes[i]!==null||this.boxEdges(i).indexOf(e)<0)continue;
      const filled=this.boxEdges(i).filter(x=>s.edges[x]!==null).length;
      if(filled===3)v+=20;else if(filled===2)v-=5;
    }
    return v;
  },
  computerMove(state,playerId,ctx){
    const seat=this.seatOf(state,playerId,ctx);
    const legal=this.legal(state);
    let best=legal[0],bs=-1e9;
    const order=legal.slice();
    for(let i=order.length-1;i>0;i--){const j=Math.floor(ctx.random()*(i+1));const t=order[i];order[i]=order[j];order[j]=t;}
    for(const e of order){const v=this.scoreEdge(state,seat,e);if(v>bs){bs=v;best=e;}}
    return {edge:best};
  },
  randomMove(state,playerId,ctx){
    const legal=this.legal(state);
    return {edge:legal[Math.floor(ctx.random()*legal.length)]};
  },
  viewFor(state,playerId,ctx){ return {edges:state.edges.slice(),boxes:state.boxes.slice()}; }
};