const game = {
  chars: [
    {hair:"black",len:"long",gl:0,hat:0,be:0,eye:"brown",ear:1},
    {hair:"brown",len:"short",gl:0,hat:0,be:0,eye:"blue",ear:0},
    {hair:"black",len:"medium",gl:1,hat:0,be:0,eye:"brown",ear:1},
    {hair:"blonde",len:"short",gl:0,hat:1,be:0,eye:"blue",ear:0},
    {hair:"red",len:"short",gl:0,hat:0,be:1,eye:"green",ear:0},
    {hair:"red",len:"long",gl:0,hat:0,be:0,eye:"green",ear:1},
    {hair:"gray",len:"short",gl:1,hat:0,be:1,eye:"brown",ear:0},
    {hair:"black",len:"medium",gl:0,hat:1,be:0,eye:"brown",ear:0},
    {hair:"brown",len:"medium",gl:0,hat:0,be:1,eye:"brown",ear:0},
    {hair:"black",len:"long",gl:0,hat:0,be:0,eye:"brown",ear:0},
    {hair:"blonde",len:"medium",gl:1,hat:0,be:0,eye:"blue",ear:0},
    {hair:"blonde",len:"long",gl:0,hat:0,be:0,eye:"blue",ear:1},
    {hair:"brown",len:"short",gl:1,hat:0,be:0,eye:"green",ear:0},
    {hair:"gray",len:"medium",gl:0,hat:0,be:0,eye:"blue",ear:1},
    {hair:"black",len:"short",gl:0,hat:1,be:1,eye:"brown",ear:0},
    {hair:"brown",len:"long",gl:1,hat:0,be:0,eye:"brown",ear:1},
    {hair:"red",len:"medium",gl:0,hat:1,be:0,eye:"green",ear:0},
    {hair:"brown",len:"long",gl:0,hat:0,be:0,eye:"brown",ear:1},
    {hair:"gray",len:"short",gl:0,hat:1,be:0,eye:"blue",ear:0},
    {hair:"brown",len:"medium",gl:0,hat:0,be:0,eye:"green",ear:1},
    {hair:"black",len:"short",gl:0,hat:0,be:1,eye:"brown",ear:0},
    {hair:"gray",len:"long",gl:1,hat:0,be:0,eye:"green",ear:1},
    {hair:"blonde",len:"short",gl:0,hat:0,be:1,eye:"blue",ear:0},
    {hair:"black",len:"long",gl:1,hat:1,be:0,eye:"brown",ear:0}
  ],
  qAttr: function(ci, qi) {
    var c = this.chars[ci];
    if (qi===0) return !!c.gl;
    if (qi===1) return !!c.hat;
    if (qi===2) return !!c.be;
    if (qi===3) return !!c.ear;
    if (qi===4) return c.hair==="blonde";
    if (qi===5) return c.hair==="brown";
    if (qi===6) return c.hair==="black";
    if (qi===7) return c.hair==="red";
    if (qi===8) return c.hair==="gray";
    if (qi===9) return c.len==="long";
    if (qi===10) return c.len==="short";
    if (qi===11) return c.eye==="blue";
    if (qi===12) return c.eye==="brown";
    if (qi===13) return c.eye==="green";
    return false;
  },
  idxOf: function(ctx, playerId) {
    for (var i=0;i<ctx.players.length;i++) if (ctx.players[i].id===playerId) return i;
    return -1;
  },
  payoutsFor: function(winnerIdx, ctx) {
    var humans = ctx.players.filter(function(p){return p.kind==="human";});
    var pot = ctx.pot;
    var out = {};
    if (humans.length===0 || pot===0) return out;
    var winnerId = (winnerIdx!==null&&winnerIdx!==undefined&&ctx.players[winnerIdx]) ? ctx.players[winnerIdx].id : null;
    var winnerIsHuman = winnerId!==null && humans.some(function(p){return p.id===winnerId;});
    if (winnerIsHuman) {
      humans.forEach(function(p){ out[p.id] = (p.id===winnerId)?pot:0; });
    } else {
      var each = Math.floor(pot/humans.length), rem = pot-each*humans.length;
      humans.forEach(function(p,i){ out[p.id]=each+(i<rem?1:0); });
    }
    return out;
  },
  newMatch: function(ctx) {
    var a = Math.floor(ctx.random()*24), b;
    do { b = Math.floor(ctx.random()*24); } while (b===a);
    return { state: { s:[a,b], hist:[], winner:null }, turn: [ctx.players[0].id] };
  },
  applyMove: function(state, playerId, move, ctx) {
    var me = this.idxOf(ctx, playerId);
    if (me<0) throw new InvalidMove("unknown player");
    if (state.winner!==null&&state.winner!==undefined) throw new InvalidMove("game over");
    var opp = me===0?1:0;
    if (!move||typeof move!=="object") throw new InvalidMove("bad move");
    if (move.kind==="ask") {
      var q = move.q;
      if (!Number.isInteger(q)||q<0||q>13) throw new InvalidMove("bad question");
      for (var i=0;i<state.hist.length;i++){ var h=state.hist[i]; if(h.by===me&&h.q===q) throw new InvalidMove("already asked"); }
      var ans = this.qAttr(state.s[opp], q);
      var hist = state.hist.concat([{by:me,q:q,ans:ans}]);
      var ns = { s:state.s.slice(), hist:hist, winner:null };
      return { state:ns, turn:[ctx.players[opp].id] };
    } else if (move.kind==="guess") {
      var g = move.idx;
      if (!Number.isInteger(g)||g<0||g>23) throw new InvalidMove("bad guess");
      var correct = (g===state.s[opp]);
      var win = correct?me:opp;
      var h2 = state.hist.concat([{by:me,guess:g,correct:correct}]);
      var ns2 = { s:state.s.slice(), hist:h2, winner:win };
      return { state:ns2, turn:null, payouts:this.payoutsFor(win,ctx) };
    }
    throw new InvalidMove("unknown move");
  },
  candsFor: function(state, me) {
    var out=[];
    for (var ci=0;ci<24;ci++){
      var ok=true;
      for (var i=0;i<state.hist.length;i++){ var h=state.hist[i]; if(h.by===me&&h.q!==undefined&&h.q!==null){ if(this.qAttr(ci,h.q)!==h.ans){ok=false;break;} } }
      if(ok) out.push(ci);
    }
    return out;
  },
  computerMove: function(state, playerId, ctx) {
    var me = this.idxOf(ctx, playerId);
    if (me<0) me=0;
    var cands = this.candsFor(state, me);
    if (cands.length<=2 && cands.length>0) return {kind:"guess", idx:cands[Math.floor(ctx.random()*cands.length)]};
    var asked={};
    state.hist.forEach(function(h){ if(h.by===me&&h.q!==undefined&&h.q!==null) asked[h.q]=1; });
    var opts=[];
    for(var q=0;q<14;q++) if(!asked[q]) opts.push(q);
    if(!opts.length) return {kind:"guess", idx:cands.length?cands[Math.floor(ctx.random()*cands.length)]:Math.floor(ctx.random()*24)};
    var best=opts[0], bestScore=-1;
    for(var k=0;k<opts.length;k++){
      var qq=opts[k], yes=0;
      for(var j=0;j<cands.length;j++) if(this.qAttr(cands[j],qq)) yes++;
      var score=Math.min(yes,cands.length-yes);
      if(score>bestScore){bestScore=score;best=qq;}
    }
    return {kind:"ask", q:best};
  },
  randomMove: function(state, playerId, ctx) {
    var me = this.idxOf(ctx, playerId);
    if (me<0) me=0;
    var asked={};
    state.hist.forEach(function(h){ if(h.by===me&&h.q!==undefined&&h.q!==null) asked[h.q]=1; });
    var opts=[];
    for(var q=0;q<14;q++) if(!asked[q]) opts.push(q);
    if (opts.length && ctx.random()<0.7) return {kind:"ask", q:opts[Math.floor(ctx.random()*opts.length)]};
    var cands = this.candsFor(state, me);
    var pool = cands.length?cands:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
    return {kind:"guess", idx:pool[Math.floor(ctx.random()*pool.length)]};
  },
  viewFor: function(state, playerId, ctx) {
    var me = (playerId===null||playerId===undefined)?null:this.idxOf(ctx, playerId);
    var over = (state.winner!==null&&state.winner!==undefined);
    if (me===null||me<0) {
      return { mySecret:null, oppSecret:null, reveal: over?state.s.slice():null, hist:state.hist, winner:state.winner };
    }
    var opp = me===0?1:0;
    return { mySecret:state.s[me], oppSecret: over?state.s[opp]:null, reveal: over?state.s.slice():null, hist:state.hist, winner:state.winner };
  }
};