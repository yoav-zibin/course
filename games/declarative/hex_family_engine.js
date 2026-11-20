// Authoritative, deterministic rules for the hex-board game family.
// The package builder prefixes this module with KIND and GEOMETRY constants.
const DIRECTIONS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const RESOURCE_NAMES = ['lumber','brick','wool','grain','ore'];
const RESOURCE_MARKS = ['W','B','S','G','O'];

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function key(q,r) { return q + ',' + r; }
function axialDistance(a,b) { return (Math.abs(a.q-b.q)+Math.abs(a.r-b.r)+Math.abs((a.q+a.r)-(b.q+b.r)))/2; }
function playerCount(ctx) { return ctx.players.length; }
function finish(s,winner) { s.over=true; s.winner=winner; }
function payout(s,ctx) {
  const humans=ctx.players.filter(p=>p.kind==='human'&&p.active!==false),winner=s.winner>=0?ctx.players[s.winner]:null;
  const recipients=winner&&winner.kind==='human'&&winner.active!==false?[winner]:humans;
  const out={}; if(!recipients.length)return out;
  recipients.forEach((p,i)=>out[p.id]=Math.floor(ctx.pot/recipients.length)+(i<ctx.pot%recipients.length?1:0));
  return out;
}
function adjacent(index, cells, indexByKey) {
  const c=cells[index];
  return DIRECTIONS.map(([dq,dr])=>indexByKey[key(c.q+dq,c.r+dr)]).filter(i=>i!==undefined);
}
function cheb(q,r) { return Math.max(Math.abs(q),Math.abs(r),Math.abs(q+r)); }
function component(s,seat,start,cells,indexByKey) {
  const seen=new Set([start]),todo=[start];
  while(todo.length){const n=todo.pop();for(const next of adjacent(n,cells,indexByKey))if(!seen.has(next)&&s.board[next]===seat){seen.add(next);todo.push(next);}}
  return seen;
}

function checkerLegal(s) {
  if(s.over)return [];
  const out=[], seen=new Set(), cells=HEX_CELLS, byKey=HEX_INDEX;
  for(let from=0;from<cells.length;from++) if(s.board[from]===s.turn) {
    for(const next of adjacent(from,cells,byKey)) if(s.board[next]===-1) {
      const move={from,to:next}; const id=from+':'+next; if(!seen.has(id)){seen.add(id);out.push(move);}
    }
    const visited=new Set([from]),queue=[from];
    while(queue.length){const at=queue.shift();
      for(const [dq,dr] of DIRECTIONS) {
        const c=cells[at],over=byKey[key(c.q+dq,c.r+dr)],to=byKey[key(c.q+2*dq,c.r+2*dr)];
        if(over===undefined||to===undefined||s.board[over]===-1||s.board[to]!==-1||visited.has(to))continue;
        const id=from+':'+to;
        if(!seen.has(id)){seen.add(id);out.push({from,to});}
        visited.add(to);queue.push(to);
      }
    }
  }
  // A blocked player passes so seats that still have legal moves can continue.
  // The finite move limit handles a position where every seat is blocked.
  return out.length ? out : [{action:'pass'}];
}
function checkerDistance(index,camp) {
  const a=HEX_CELLS[index];let best=99;
  for(const target of camp){const b=HEX_CELLS[target];best=Math.min(best,axialDistance(a,b));}
  return best;
}
function checkerScore(s,seat) {
  const camp=s.targetCamps[seat];
  let score=0;
  for(let i=0;i<s.board.length;i++)if(s.board[i]===seat)score+=checkerDistance(i,camp);
  return score;
}
function finishCheckersAtLimit(s,ctx) {
  const scores=ctx.players.map((_,i)=>checkerScore(s,i)),best=Math.min(...scores);
  const winners=scores.map((value,i)=>value===best?i:-1).filter(i=>i>=0);
  finish(s,winners.length===1?winners[0]:-1);
}

function abaloneLegal(s) {
  if(s.over)return [];
  const out=[], seen=new Set(), cells=HEX_CELLS, byKey=HEX_INDEX;
  // Three undirected axes enumerate each contiguous marble group once.
  const axes=[[1,0],[1,-1],[0,-1]];
  for(const [aq,ar] of axes)for(let start=0;start<cells.length;start++)if(s.board[start]===s.turn){
    const c0=cells[start];
    const group=[];
    for(let n=0;n<3;n++){
      const idx=byKey[key(c0.q+aq*n,c0.r+ar*n)];
      if(idx===undefined||s.board[idx]!==s.turn)break;
      group.push(idx);
      for(let dir=0;dir<6;dir++){
        const [dq,dr]=DIRECTIONS[dir], parallel=group.length===1||((cells[group[1]].q-c0.q)*dr-(cells[group[1]].r-c0.r)*dq===0);
        const destinations=group.map(i=>{const p=cells[i];return byKey[key(p.q+dq,p.r+dr)];});
        if(destinations.some(i=>i===undefined))continue;
        if(!parallel){ if(destinations.every(i=>s.board[i]===-1)) add(group,destinations,dir); continue; }
        let front=group[0];
        for(const candidate of group)if(cells[candidate].q*dq+cells[candidate].r*dr>cells[front].q*dq+cells[front].r*dr)front=candidate;
        const fp=cells[front];let opponentCount=0, cursor=byKey[key(fp.q+dq,fp.r+dr)];
        while(cursor!==undefined&&s.board[cursor]===1-s.turn){opponentCount++;const p=cells[cursor];cursor=byKey[key(p.q+dq,p.r+dr)];}
        if(opponentCount===0){if(cursor===undefined||s.board[cursor]===-1)add(group,destinations,dir);}
        else if(group.length>opponentCount&&(cursor===undefined||s.board[cursor]===-1))add(group,destinations,dir);
      }
    }
  }
  function add(from,to,dir){const orderedFrom=from.slice().sort((a,b)=>a-b),orderedTo=to.slice().sort((a,b)=>a-b),id=orderedFrom.join('.')+'>'+orderedTo.join('.')+':'+dir;if(!seen.has(id)){seen.add(id);out.push({from:orderedFrom,to:orderedTo,dir});}}
  return out;
}
function havannahWon(s,seat) {
  // Check each connected component, since cell 0 may belong to the opponent.
  const seen=new Set();
  for(let start=0;start<s.board.length;start++)if(s.board[start]===seat&&!seen.has(start)){
    const group=component(s,seat,start,HEX_CELLS,HEX_INDEX); for(const n of group)seen.add(n);
    const corners=new Set(), sides=new Set();
    for(const i of group){const {q,r}=HEX_CELLS[i],sCoord=-q-r;
      if(Math.max(Math.abs(q),Math.abs(r),Math.abs(sCoord))===4){
        if(q===4)sides.add(0);if(r===-4)sides.add(1);if(sCoord===4)sides.add(2);
        if(q===-4)sides.add(3);if(r===4)sides.add(4);if(sCoord===-4)sides.add(5);
      }
      if([[4,0],[4,-4],[0,-4],[-4,0],[-4,4],[0,4]].some(([cq,cr])=>q===cq&&r===cr))corners.add(q+','+r);
    }
    if(corners.size>=2||sides.size>=3)return true;
  }
  // A ring surrounds a cell that cannot flood to the board edge without
  // crossing this player's stones. Opponent pieces do not close a ring.
  const outside=new Set(),todo=[];
  for(let i=0;i<HEX_CELLS.length;i++)if(cheb(HEX_CELLS[i].q,HEX_CELLS[i].r)===4&&s.board[i]!==seat){outside.add(i);todo.push(i);}
  while(todo.length){const n=todo.pop();for(const next of adjacent(n,HEX_CELLS,HEX_INDEX))if(!outside.has(next)&&s.board[next]!==seat){outside.add(next);todo.push(next);}}
  return HEX_CELLS.some((_,i)=>s.board[i]!==seat&&!outside.has(i));
}

function tileNodeData() { return CATAN_GEOMETRY; }
function catanLegal(s) {
  if(s.over)return [];
  const out=[], seat=s.turn, G=tileNodeData();
  if(s.phase==='setup_settlement'){
    for(let n=0;n<G.nodes.length;n++)if(s.settlements[n]===-1&&G.nodeEdges[n].every(edge=>G.edges[edge].find(v=>v!==n)===undefined||s.settlements[G.edges[edge].find(v=>v!==n)]===-1))out.push({action:'settle',node:n});
    return out;
  }
  if(s.phase==='setup_road')return G.nodeEdges[s.setupNode].filter(e=>s.roads[e]===-1).map(edge=>({action:'road',edge}));
  if(s.phase==='roll')return [{action:'roll'}];
  if(s.phase==='discard')return RESOURCE_NAMES.flatMap((_,resource)=>s.resources[seat][resource]>0?[{action:'discard',resource}]:[]);
  if(s.phase==='robber'){
    for(let tile=0;tile<G.tiles.length;tile++)if(tile!==s.robber){
      const owners=new Set(); for(const node of G.tileNodes[tile])if(s.settlements[node]>=0&&s.settlements[node]!==seat)owners.add(s.settlements[node]);
      const victims=owners.size?[...owners]:[-1];for(const victim of victims)out.push({action:'robber',tile,victim});
    }
    return out;
  }
  const res=s.resources[seat],has=(cost)=>cost.every((n,i)=>res[i]>=n),costs={road:[1,1,0,0,0],settlement:[1,1,1,1,0],city:[0,0,0,2,3]};
  if(has(costs.road))for(let e=0;e<G.edges.length;e++)if(s.roads[e]===-1){const [a,b]=G.edges[e];if([a,b].some(n=>s.settlements[n]===seat||(s.settlements[n]===-1&&G.nodeEdges[n].some(other=>s.roads[other]===seat))))out.push({action:'road',edge:e});}
  if(has(costs.settlement))for(let n=0;n<G.nodes.length;n++)if(s.settlements[n]===-1&&G.nodeEdges[n].some(e=>s.roads[e]===seat)&&G.nodeEdges[n].every(e=>G.edges[e].every(other=>other===n||s.settlements[other]===-1)))out.push({action:'settle',node:n});
  if(has(costs.city))for(let n=0;n<G.nodes.length;n++)if(s.settlements[n]===seat&&!s.cities[n])out.push({action:'city',node:n});
  for(let give=0;give<5;give++)if(res[give]>=4)for(let want=0;want<5;want++)if(want!==give&&s.bank[want]>0)out.push({action:'trade',give,want});
  out.push({action:'end_turn'});return out;
}
function catanScore(s,seat) { let score=0;for(let n=0;n<s.settlements.length;n++)if(s.settlements[n]===seat)score+=s.cities[n]?2:1;return score; }
function catanSpend(s,seat,cost) {
  for(let resource=0;resource<cost.length;resource++)if(cost[resource]){
    s.resources[seat][resource]-=cost[resource];
    s.bank[resource]+=cost[resource];
  }
}
function catanCheckWinner(s,ctx) {
  for(let i=0;i<ctx.players.length;i++)if(catanScore(s,i)>=10){finish(s,i);return true;}
  if(s.actions>=600){const scores=ctx.players.map((_,i)=>catanScore(s,i));const best=Math.max(...scores);const winners=scores.map((v,i)=>v===best?i:-1).filter(i=>i>=0);finish(s,winners.length===1?winners[0]:-1);return true;}
  return false;
}
function passCatanTurn(s,ctx) { s.turn=(s.turn+1)%ctx.players.length;s.phase='roll'; }
function generateCatanBoard(ctx) {
  return CATAN_TILES.map(tile=>({resource:tile.resource,number:tile.number}));
}
function catanApply(s,move,ctx) {
  const G=tileNodeData(),seat=s.turn;s.actions++;
  if(s.phase==='setup_settlement'){
    s.settlements[move.node]=seat;s.scores[seat]++;s.setupNode=move.node;
    if(s.setupIndex>=ctx.players.length)for(const tile of G.nodeTiles[move.node]||[]){const resource=RESOURCE_NAMES.indexOf(s.tileData[tile].resource);if(resource>=0&&s.bank[resource]>0){s.resources[seat][resource]++;s.bank[resource]--;}}
    s.phase='setup_road';return;
  }
  if(s.phase==='setup_road'){
    s.roads[move.edge]=seat;
    if(s.setupIndex+1>=s.setupOrder.length){s.phase='roll';s.setupNode=-1;return;}
    s.setupIndex++;s.turn=s.setupOrder[s.setupIndex];s.phase='setup_settlement';s.setupNode=-1;return;
  }
  if(s.phase==='roll'){
    s.roller=seat;
    const dieA=1+Math.floor(ctx.random()*6),dieB=1+Math.floor(ctx.random()*6);s.lastRoll=dieA+dieB;
    if(s.lastRoll===7){s.discardQueue=[];
      for(let i=0;i<ctx.players.length;i++){const hand=s.resources[i].reduce((a,b)=>a+b,0);if(hand>7)s.discardQueue.push({seat:i,remaining:Math.floor(hand/2)});}
      if(s.discardQueue.length){s.phase='discard';s.turn=s.discardQueue[0].seat;}else s.phase='robber';return;
    }
    const gains=ctx.players.map(()=>Array(5).fill(0));
    for(let tile=0;tile<G.tiles.length;tile++)if(tile!==s.robber&&s.tileData[tile].number===s.lastRoll){const r=RESOURCE_NAMES.indexOf(s.tileData[tile].resource);if(r<0)continue;
      for(const node of G.tileNodes[tile])if(s.settlements[node]>=0)gains[s.settlements[node]][r]+=s.cities[node]?2:1;}
    for(let r=0;r<5;r++){const needed=gains.reduce((sum,row)=>sum+row[r],0);if(s.bank[r]>=needed){for(let p=0;p<ctx.players.length;p++)s.resources[p][r]+=gains[p][r];s.bank[r]-=needed;}}
    s.phase='action';return;
  }
  if(s.phase==='discard'){
    s.resources[seat][move.resource]--;s.bank[move.resource]++;const item=s.discardQueue[0];item.remaining--;
    if(item.remaining===0){s.discardQueue.shift();if(s.discardQueue.length)s.turn=s.discardQueue[0].seat;else{s.turn=s.roller;s.phase='robber';}}
    return;
  }
  if(s.phase==='robber'){
    s.robber=move.tile;if(move.victim>=0){const available=[];for(let r=0;r<5;r++)for(let n=0;n<s.resources[move.victim][r];n++)available.push(r);if(available.length){const r=available[Math.floor(ctx.random()*available.length)];s.resources[move.victim][r]--;s.resources[seat][r]++;}}
    s.phase='action';return;
  }
  if(move.action==='road'){
    if(s.phase==='action')catanSpend(s,seat,[1,1,0,0,0]);
    s.roads[move.edge]=seat;
  }else if(move.action==='settle'){
    if(s.phase==='action')catanSpend(s,seat,[1,1,1,1,0]);
    s.settlements[move.node]=seat;s.cities[move.node]=false;s.scores[seat]++;
    if(s.phase==='setup_settlement'&&s.setupIndex>=ctx.players.length){for(const tile of G.nodeTiles[move.node]||[]){const resource=RESOURCE_NAMES.indexOf(s.tileData[tile].resource);if(resource>=0&&s.bank[resource]>0){s.resources[seat][resource]++;s.bank[resource]--;}}}
  }else if(move.action==='city'){
    catanSpend(s,seat,[0,0,0,2,3]);s.cities[move.node]=true;s.scores[seat]++;
  }else if(move.action==='trade'){
    s.resources[seat][move.give]-=4;s.resources[seat][move.want]++;s.bank[move.give]+=4;s.bank[move.want]--;
  }else if(move.action==='end_turn')passCatanTurn(s,ctx);
  if(catanCheckWinner(s,ctx))return;
}

function fresh(ctx) {
  if(KIND==='chinese_checkers'){
    const count=playerCount(ctx),active= count===2?[0,3]:count===3?[0,2,4]:count===4?[0,1,3,4]:count===5?[0,1,2,3,4]:[0,1,2,3,4,5];
    const camps=HEX_CAMP_IDS.map((ids,i)=>active.includes(i)?ids:[]),board=Array(HEX_CELLS.length).fill(-1);
    active.forEach((dir,seat)=>camps[dir].forEach(i=>board[i]=seat));
    return {board,turn:0,scores:Array(count).fill(0),camps,targetCamps:active.map(dir=>HEX_CAMP_IDS[(dir+3)%6]),turns:0,over:false,winner:-1,players:active};
  }
  if(KIND==='abalone'){
    const board=Array(HEX_CELLS.length).fill(-1),home=[[],[]];
    const start=[...Array.from({length:5},(_,i)=>[-4,i]),
      ...Array.from({length:6},(_,i)=>[-3,i-1]),[-2,-2],[-2,-1],[-2,0]];
    for(const [q,r]of start){home[0].push(HEX_INDEX[key(q,r)]);home[1].push(HEX_INDEX[key(-q,-r)]);}
    for(let seat=0;seat<2;seat++)home[seat].forEach(i=>board[i]=seat);
    return {board,turn:0,scores:[0,0],ejected:[0,0],turns:0,over:false,winner:-1};
  }
  if(KIND==='havannah')return {board:Array(HEX_CELLS.length).fill(-1),turn:0,scores:[0,0],turns:0,over:false,winner:-1};
  if(KIND==='catan'){
    const order=ctx.players.length===2?[0,1,1,0]:ctx.players.length===3?[0,1,2,2,1,0]:[0,1,2,3,3,2,1,0];
    const tileData=generateCatanBoard(ctx),robber=tileData.findIndex(t=>t.resource==='desert');
    return {turn:order[0],over:false,winner:-1,phase:'setup_settlement',setupOrder:order,setupIndex:0,setupNode:-1,
      settlements:Array(CATAN_GEOMETRY.nodes.length).fill(-1),cities:Array(CATAN_GEOMETRY.nodes.length).fill(false),roads:Array(CATAN_GEOMETRY.edges.length).fill(-1),
      tileData,robber,resources:ctx.players.map(()=>Array(5).fill(0)),bank:Array(5).fill(19),scores:Array(ctx.players.length).fill(0),turns:0,actions:0,lastRoll:0,roller:0,discardQueue:[]};
  }
  return {};
}

function legal(s) {
  if(KIND==='chinese_checkers')return checkerLegal(s);
  if(KIND==='abalone')return abaloneLegal(s);
  if(KIND==='havannah')return s.over?[]:s.board.flatMap((v,cell)=>v===-1?[{cell}]:[]);
  if(KIND==='catan')return catanLegal(s);
  return [];
}
function apply(s,move,ctx) {
  const seat=s.turn;
  if(KIND==='chinese_checkers'){
    if(move.action==='pass'){
      s.turns++;
      if(s.turns>=400)finishCheckersAtLimit(s,ctx);
      else s.turn=(seat+1)%ctx.players.length;
      return;
    }
    s.board[move.from]=-1;s.board[move.to]=seat;s.turns++;
    if(s.targetCamps[seat].every(i=>s.board[i]===seat))finish(s,seat);
    else if(s.turns>=400)finishCheckersAtLimit(s,ctx);
    else s.turn=(seat+1)%ctx.players.length;
    return;
  }
  if(KIND==='abalone'){
    const [dq,dr]=DIRECTIONS[move.dir],cells=HEX_CELLS,byKey=HEX_INDEX;
    const fromSet=new Set(move.from);
    const first=cells[move.from[0]],second=cells[move.from[1]??move.from[0]];
    const parallel=move.from.length===1||((second.q-first.q)*dr-(second.r-first.r)*dq===0);
    if(parallel){
      const front=move.from.reduce((best,i)=>cells[i].q*dq+cells[i].r*dr>cells[best].q*dq+cells[best].r*dr?i:best,move.from[0]),p=cells[front];
      let cursor=byKey[key(p.q+dq,p.r+dr)],enemy=[];
      while(cursor!==undefined&&s.board[cursor]===1-seat){enemy.push(cursor);const c=cells[cursor];cursor=byKey[key(c.q+dq,c.r+dr)];}
      for(let j=enemy.length-1;j>=0;j--){const old=enemy[j],c=cells[old],next=byKey[key(c.q+dq,c.r+dr)];if(next===undefined){s.board[old]=-1;s.ejected[seat]++;}else{s.board[next]=1-seat;s.board[old]=-1;}}
    }
    fromSet.forEach(i=>s.board[i]=-1);move.to.forEach(i=>s.board[i]=seat);s.turns++;
    if(s.ejected[seat]>=6)finish(s,seat);
    else if(s.turns>=500){const a=s.board.filter(x=>x===0).length,b=s.board.filter(x=>x===1).length;finish(s,a===b?-1:a>b?0:1);}
    else {s.turn=1-seat;if(!abaloneLegal(s).length)finish(s,seat);}
    return;
  }
  if(KIND==='havannah'){
    s.board[move.cell]=seat;s.turns++;
    if(havannahWon(s,seat))finish(s,seat);else if(s.board.every(v=>v!==-1))finish(s,-1);else s.turn=1-seat;
    return;
  }
  if(KIND==='catan'){catanApply(s,move,ctx);return;}
}

const game={
  newMatch(ctx){const state=fresh(ctx);return {state,turn:[ctx.players[state.turn].id]};},
  applyMove(state,id,move,ctx){
    if(state.over||ctx.players[state.turn].id!==id||!move||typeof move!=='object'||Array.isArray(move))throw new InvalidMove('Illegal move');
    const options=legal(state),canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
    if(!options.some(m=>canonical(m)===canonical(move)))throw new InvalidMove('Illegal move');
    const s=clone(state);apply(s,move,ctx);
    return s.over?{state:s,turn:null,payouts:payout(s,ctx)}:{state:s,turn:[ctx.players[s.turn].id]};
  },
  viewFor(state,id,ctx){const s=clone(state);
    if(KIND==='catan'){
      s.handSizes=state.resources.map(row=>row.reduce((a,b)=>a+b,0));
      s.resources=state.resources.map((row,index)=>ctx.players[index].id===id?row:null);
    }
    s.legal=id===ctx.players[state.turn].id&&!state.over?legal(state):[];return s;},
  randomMove(state,id,ctx){const options=legal(state);return options[Math.floor(ctx.random()*options.length)];},
  computerMove(state,id,ctx){
    const options=legal(state);if(!options.length)return null;
    if(KIND==='chinese_checkers'){
      if(options[0].action==='pass')return options[0];
      let best=Infinity,choices=[];for(const move of options){const score=checkerDistance(move.to,state.targetCamps[state.turn].length?state.targetCamps[state.turn]:HEX_CAMP_IDS[(state.players[state.turn]+3)%6]);if(score<best){best=score;choices=[move];}else if(score===best)choices.push(move);}return choices[Math.floor(ctx.random()*choices.length)];
    }
    if(KIND==='catan'){
      if(state.phase==='action'){const preferred=options.find(m=>m.action==='city')||options.find(m=>m.action==='settle')||options.find(m=>m.action==='road')||options.find(m=>m.action==='trade');return preferred||options.find(m=>m.action==='end_turn')||options[0];}
      if(state.phase==='discard')return options.reduce((a,b)=>state.resources[state.turn][a.resource]>=state.resources[state.turn][b.resource]?a:b);
      if(state.phase==='robber')return options[0];
      if(state.phase==='roll')return options[0];
    }
    return options[Math.floor(ctx.random()*options.length)];
  }
};
