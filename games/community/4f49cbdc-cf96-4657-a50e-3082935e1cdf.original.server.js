const game = {
  ROW_LENGTHS: [7,8,7,8,7,8,7,8],
  DIRS: [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]],
  penguinsFor: function(n){ if(n===2) return 4; if(n===3) return 3; return 2; },
  buildPositions: function(){
    var pos=[]; var lens=this.ROW_LENGTHS;
    for(var r=0;r<8;r++) for(var c=0;c<lens[r];c++) pos.push({id:pos.length,row:r,col:c,q:c-Math.floor(r/2),r:r});
    return pos;
  },
  tileById: function(state,id){ return state.tiles[id]||null; },
  at: function(state,q,r){
    var id=state.coordToId[q+','+r];
    if(id===undefined||id===null) return null;
    return state.tiles[id];
  },
  isOpen: function(t){ return !!t && !t.removed && t.penguin===-1; },
  clone: function(s){ return JSON.parse(JSON.stringify(s)); },
  legalPlacements: function(state,idx){
    if(state.phase!=='placement'||state.finished||state.currentPlayer!==idx) return [];
    if(state.penguinsPlaced[idx]>=state.penguinsPerPlayer) return [];
    var out=[];
    for(var i=0;i<state.tiles.length;i++){var t=state.tiles[i]; if(!t.removed&&t.penguin===-1&&t.fish===1) out.push(t.id);}
    return out;
  },
  destinations: function(state,id,idx){
    if(state.phase!=='movement'||state.finished) return [];
    var start=state.tiles[id];
    if(!start||start.removed||start.penguin!==idx) return [];
    var res=[];
    for(var d=0;d<this.DIRS.length;d++){
      var q=start.q+this.DIRS[d][0], r=start.r+this.DIRS[d][1];
      while(true){var t=this.at(state,q,r); if(!this.isOpen(t)) break; res.push(t.id); q+=this.DIRS[d][0]; r+=this.DIRS[d][1];}
    }
    return res;
  },
  movesByFrom: function(state,idx){
    var m={};
    if(state.phase!=='movement'||state.finished) return m;
    for(var i=0;i<state.tiles.length;i++){var t=state.tiles[i]; if(!t.removed&&t.penguin===idx){var d=this.destinations(state,t.id,idx); if(d.length) m[t.id]=d;}}
    return m;
  },
  allMoves: function(state,idx){
    var by=this.movesByFrom(state,idx); var out=[];
    for(var f in by){var arr=by[f]; for(var i=0;i<arr.length;i++) out.push({from:Number(f),to:arr[i]});}
    return out;
  },
  canMove: function(state,idx){
    if(state.phase!=='movement'||state.finished) return false;
    for(var i=0;i<state.tiles.length;i++){var t=state.tiles[i]; if(!t.removed&&t.penguin===idx&&this.destinations(state,t.id,idx).length) return true;}
    return false;
  },
  payoutsFor: function(state,ctx){
    var humans=ctx.players.filter(function(p){return p.kind==='human';});
    var pay={}; var pot=ctx.pot||0;
    humans.forEach(function(p){pay[p.id]=0;});
    if(!humans.length) return pay;
    var best=Math.max.apply(null,state.scores);
    var overallWinners=[];
    for(var i=0;i<state.scores.length;i++) if(state.scores[i]===best) overallWinners.push(i);
    var humanWinners=overallWinners.filter(function(idx){return ctx.players[idx]&&ctx.players[idx].kind==='human';});
    var recipients=humanWinners.length?humanWinners.slice():null;
    if(!recipients){
      var hb=-Infinity;
      for(var j=0;j<humans.length;j++){var idx2=ctx.players.findIndex(function(p){return p.id===humans[j].id;}); var s=state.scores[idx2]; if(s>hb) hb=s;}
      recipients=[];
      for(var k=0;k<humans.length;k++){var ix=ctx.players.findIndex(function(p){return p.id===humans[k].id;}); if(state.scores[ix]===hb) recipients.push(ix);}
    }
    var recIds=recipients.map(function(idx){return ctx.players[idx].id;});
    recIds.sort();
    var share=Math.floor(pot/recIds.length); var rem=pot-share*recIds.length;
    for(var a=0;a<recIds.length;a++) pay[recIds[a]]=share+(a<rem?1:0);
    return pay;
  },
  finishState: function(state){
    var n=this.clone(state);
    if(n.finished) return n;
    for(var i=0;i<n.tiles.length;i++){var t=n.tiles[i]; if(!t.removed&&t.penguin>=0) n.scores[t.penguin]+=t.fish;}
    n.finished=true; n.phase='finished';
    var best=Math.max.apply(null,n.scores);
    n.winners=[];
    for(var j=0;j<n.scores.length;j++) if(n.scores[j]===best) n.winners.push(j);
    n.winner=n.winners.length===1?n.winners[0]:null;
    return n;
  },
  advanceMovement: function(state){
    var n=this.clone(state);
    for(var i=0;i<n.playerCount;i++){ if(this.canMove(n,n.currentPlayer)) return n; n.currentPlayer=(n.currentPlayer+1)%n.playerCount; }
    return this.finishState(n);
  },
  newMatch: function(ctx){
    var n=ctx.players.length;
    var pos=this.buildPositions();
    var bag=[];
    for(var i=0;i<30;i++) bag.push(1);
    for(var j=0;j<20;j++) bag.push(2);
    for(var k=0;k<10;k++) bag.push(3);
    for(var s=bag.length-1;s>0;s--){var r=Math.floor(ctx.random()*(s+1)); var tmp=bag[s]; bag[s]=bag[r]; bag[r]=tmp;}
    var tiles=pos.map(function(p,i){return {id:p.id,row:p.row,col:p.col,q:p.q,r:p.r,fish:bag[i],removed:false,penguin:-1};});
    var coordToId={};
    tiles.forEach(function(t){coordToId[t.q+','+t.r]=t.id;});
    var ppp=this.penguinsFor(n);
    var state={playerCount:n,phase:'placement',currentPlayer:0,tiles:tiles,coordToId:coordToId,scores:[],penguinsPlaced:[],penguinsPerPlayer:ppp,finished:false,winner:null,winners:[]};
    for(var a=0;a<n;a++){state.scores.push(0); state.penguinsPlaced.push(0);}
    return {state:state, turn:[ctx.players[0].id]};
  },
  applyMove: function(state,playerId,move,ctx){
    var idx=ctx.players.findIndex(function(p){return p.id===playerId;});
    if(idx<0) throw new InvalidMove('unknown player');
    if(state.finished) throw new InvalidMove('game over');
    if(state.currentPlayer!==idx) throw new InvalidMove('not your turn');
    if(!move||typeof move!=='object') throw new InvalidMove('bad move');
    var n;
    if(move.kind==='place'){
      if(state.phase!=='placement') throw new InvalidMove('not placement');
      var id=move.id;
      if(!Number.isInteger(id)||id<0||id>=state.tiles.length) throw new InvalidMove('bad tile');
      var ok=this.legalPlacements(state,idx).indexOf(id)>=0;
      if(!ok) throw new InvalidMove('choose an empty 1-fish tile');
      n=this.clone(state);
      n.tiles[id].penguin=idx;
      n.penguinsPlaced[idx]++;
      if(n.penguinsPlaced.every(function(x){return x===n.penguinsPerPlayer;})){n.phase='movement'; n.currentPlayer=0; n=this.advanceMovement(n);}
      else n.currentPlayer=(idx+1)%n.playerCount;
    } else if(move.kind==='move'||(move.from!==undefined&&move.to!==undefined)){
      if(state.phase!=='movement') throw new InvalidMove('not movement');
      var from=move.from, to=move.to;
      if(!Number.isInteger(from)||!Number.isInteger(to)) throw new InvalidMove('bad move');
      var dests=this.destinations(state,from,idx);
      if(dests.indexOf(to)<0) throw new InvalidMove('illegal slide');
      n=this.clone(state);
      n.scores[idx]+=n.tiles[from].fish;
      n.tiles[from].penguin=-1; n.tiles[from].removed=true;
      n.tiles[to].penguin=idx;
      n.currentPlayer=(idx+1)%n.playerCount;
      n=this.advanceMovement(n);
    } else if(move.kind==='pass'){
      if(state.phase!=='movement') throw new InvalidMove('cannot pass');
      if(this.canMove(state,idx)) throw new InvalidMove('you have a move');
      n=this.clone(state);
      n.currentPlayer=(idx+1)%n.playerCount;
      n=this.advanceMovement(n);
    } else throw new InvalidMove('unknown move');
    if(n.finished) return {state:n, turn:null, payouts:this.payoutsFor(n,ctx)};
    return {state:n, turn:[ctx.players[n.currentPlayer].id]};
  },
  computerMove: function(state,playerId,ctx){
    var idx=ctx.players.findIndex(function(p){return p.id===playerId;});
    if(state.phase==='placement'){
      var ids=this.legalPlacements(state,idx);
      var best=null,bs=-Infinity;
      for(var i=0;i<ids.length;i++){var t=state.tiles[ids[i]]; var nb=0; for(var d=0;d<this.DIRS.length;d++){var u=this.at(state,t.q+this.DIRS[d][0],t.r+this.DIRS[d][1]); if(this.isOpen(u)) nb++;} var sc=nb*10+ctx.random()*3; if(sc>bs){bs=sc; best=ids[i];}}
      return {kind:'place',id:best};
    }
    var all=this.allMoves(state,idx);
    if(!all.length) return {kind:'pass'};
    var bm=null,bms=-Infinity;
    for(var k=0;k<all.length;k++){var m=all[k]; var from=state.tiles[m.from], to=state.tiles[m.to]; var esc=0; for(var e=0;e<this.DIRS.length;e++){var v=this.at(state,to.q+this.DIRS[e][0],to.r+this.DIRS[e][1]); if(this.isOpen(v)&&v.id!==m.from) esc++;} var s2=from.fish*100+to.fish*8+esc*15+ctx.random()*4; if(s2>bms){bms=s2; bm=m;}}
    return {kind:'move',from:bm.from,to:bm.to};
  },
  randomMove: function(state,playerId,ctx){
    var idx=ctx.players.findIndex(function(p){return p.id===playerId;});
    if(state.phase==='placement'){var ids=this.legalPlacements(state,idx); return {kind:'place',id:ids[Math.floor(ctx.random()*ids.length)]};}
    var all=this.allMoves(state,idx);
    if(!all.length) return {kind:'pass'};
    var m=all[Math.floor(ctx.random()*all.length)];
    return {kind:'move',from:m.from,to:m.to};
  },
  viewFor: function(state,playerId,ctx){
    var idx=playerId?ctx.players.findIndex(function(p){return p.id===playerId;}):-1;
    var v=this.clone(state);
    delete v.coordToId;
    var legal={placements:[],moves:{}};
    if(idx>=0&&!state.finished&&state.currentPlayer===idx){
      if(state.phase==='placement') legal.placements=this.legalPlacements(state,idx);
      else legal.moves=this.movesByFrom(state,idx);
    }
    v.legal=legal;
    return v;
  }
};