const ORDER=["p0","p1","p2","p3","p4","p5","s0","p11","p10","p9","p8","p7","p6","s1"];
function idxOfPlayer(ctx,playerId){ for(let i=0;i<ctx.players.length;i++) if(ctx.players[i].id===playerId) return i; return -1; }
function doSow(pits,stores,player,pit){
  pits=pits.slice(); stores=stores.slice();
  let stones=pits[pit];
  pits[pit]=0;
  let start=-1;
  for(let i=0;i<ORDER.length;i++) if(ORDER[i]==="p"+pit){start=i;break;}
  let cur=start,last=null;
  for(let k=0;k<stones;k++){
    cur=(cur+1)%ORDER.length;
    if(player===0&&ORDER[cur]==="s1")cur=(cur+1)%ORDER.length;
    if(player===1&&ORDER[cur]==="s0")cur=(cur+1)%ORDER.length;
    let pos=ORDER[cur];
    if(pos[0]==="s"){stores[player]++;}
    else{pits[parseInt(pos.slice(1),10)]++;}
    last=pos;
  }
  let extra=(player===0&&last==="s0")||(player===1&&last==="s1");
  let captured=0;
  if(last&&last[0]==="p"){
    let li=parseInt(last.slice(1),10);
    let mine=(player===0)?li<6:li>=6;
    if(mine&&pits[li]===1){
      let opp=li<6?li+6:li-6;
      if(pits[opp]>0){captured=1+pits[opp];pits[li]=0;pits[opp]=0;stores[player]+=captured;}
    }
  }
  let s0empty=true,s1empty=true;
  for(let i=0;i<6;i++) if(pits[i]!==0)s0empty=false;
  for(let i=6;i<12;i++) if(pits[i]!==0)s1empty=false;
  let gameOver=false,winner=null;
  if(s0empty||s1empty){
    gameOver=true;extra=false;
    let r0=0,r1=0;
    for(let i=0;i<6;i++)r0+=pits[i];
    for(let i=6;i<12;i++)r1+=pits[i];
    stores[0]+=r0;stores[1]+=r1;
    pits=[0,0,0,0,0,0,0,0,0,0,0,0];
    if(stores[0]>stores[1])winner=0;else if(stores[1]>stores[0])winner=1;else winner=-1;
  }
  return {pits:pits,stores:stores,lastPos:last,extra:extra,captured:captured,gameOver:gameOver,winner:winner};
}
function legalPits(state,player){ let r=[]; let lo=player===0?0:6,hi=player===0?6:12; for(let i=lo;i<hi;i++) if(state.pits[i]>0)r.push(i); return r; }
function payoutsFor(state,ctx){
  let p={};
  for(let pl of ctx.players){ if(pl.kind==="human") p[pl.id]=0; }
  let pot=ctx.pot;
  let humans=ctx.players.filter(function(pl){return pl.kind==="human";});
  if(humans.length===0) return p;
  if(state.winner===-1){
    let half=Math.floor(pot/humans.length);
    // only 2 seats; split evenly, remainder to first human
    if(humans.length===2){ p[humans[0].id]=Math.floor(pot/2); p[humans[1].id]=pot-Math.floor(pot/2); }
    else { for(let h of humans)p[h.id]=half; p[humans[0].id]+=pot-half*humans.length; }
  } else {
    let wIdx=state.winner;
    let wId=(wIdx>=0&&wIdx<ctx.players.length)?ctx.players[wIdx].id:null;
    if(wId&&p.hasOwnProperty(wId)){ p[wId]=pot; }
    else if(wId){
      // winner is computer: split pot among humans
      let half=Math.floor(pot/humans.length);
      for(let h of humans)p[h.id]=half;
      if(humans.length)p[humans[0].id]+=pot-half*humans.length;
    } else {
      for(let h of humans)p[h.id]=0;
    }
  }
  return p;
}
const game={
  newMatch:function(ctx){
    let state={pits:[4,4,4,4,4,4,4,4,4,4,4,4],stores:[0,0],gameOver:false,winner:null,lastPos:null,lastPlayer:-1,extraTurn:false,captured:0};
    return {state:state,turn:[ctx.players[0].id]};
  },
  applyMove:function(state,playerId,move,ctx){
    let me=idxOfPlayer(ctx,playerId);
    if(me<0||me>1) throw new InvalidMove("not seated");
    if(state.gameOver) throw new InvalidMove("game over");
    if(!move||typeof move.pit!=="number"||Math.floor(move.pit)!==move.pit) throw new InvalidMove("pick a pit");
    let pit=move.pit;
    let mine=(me===0)?(pit>=0&&pit<6):(pit>=6&&pit<12);
    if(!mine) throw new InvalidMove("that is not your pit");
    if(state.pits[pit]===0) throw new InvalidMove("pit is empty");
    let r=doSow(state.pits,state.stores,me,pit);
    let ns={pits:r.pits,stores:r.stores,gameOver:r.gameOver,winner:r.winner,lastPos:r.lastPos,lastPlayer:me,extraTurn:r.extra,captured:r.captured};
    if(r.gameOver){
      return {state:ns,turn:null,payouts:payoutsFor(ns,ctx)};
    }
    if(r.extra) return {state:ns,turn:[playerId]};
    let other=ctx.players[1-me].id;
    return {state:ns,turn:[other]};
  },
  computerMove:function(state,playerId,ctx){
    let me=idxOfPlayer(ctx,playerId);
    let legal=legalPits(state,me);
    if(!legal.length) return {pit:(me===0?0:6)};
    let best=legal[0],bestScore=-1e12;
    for(let p of legal){
      let r=doSow(state.pits,state.stores,me,p);
      let gain=r.stores[me]-state.stores[me];
      let bonus=0;
      if(r.gameOver){
        if(r.winner===me)bonus+=100;
        else if(r.winner===-1)bonus+=40;
        else bonus-=100;
      }
      if(r.extra)bonus+=12;
      bonus+=r.captured;
      let score=gain*2+bonus+r.stores[me]*0.05+ctx.random()*0.01;
      if(score>bestScore){bestScore=score;best=p;}
    }
    return {pit:best};
  },
  randomMove:function(state,playerId,ctx){
    let me=idxOfPlayer(ctx,playerId);
    let legal=legalPits(state,me);
    if(!legal.length) return {pit:(me===0?0:6)};
    return {pit:legal[Math.floor(ctx.random()*legal.length)]};
  },
  viewFor:function(state,playerId,ctx){
    return {pits:state.pits.slice(),stores:state.stores.slice(),gameOver:state.gameOver,winner:state.winner,lastPos:state.lastPos,lastPlayer:state.lastPlayer,extraTurn:state.extraTurn,captured:state.captured};
  }
};