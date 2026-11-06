const game = {
 newMatch(ctx) {
  const state = { hands: [[1,1],[1,1]], turnIndex: 0, status: 'active', winnerIndex: null };
  return { state, turn: [ctx.players[0].id] };
 },
 _isSwap(a,b,left,right){return (left===b&&right===a&&a!==b);},
 _validateSplit(cur, left, right) {
  if (!Number.isInteger(left) || !Number.isInteger(right)) throw new InvalidMove('Split values must be whole numbers');
  const [a,b] = cur;
  if (a <= 0 || b <= 0) throw new InvalidMove('Both hands must be alive (1-4) to split');
  if (a<0||a>4||b<0||b>4) throw new InvalidMove('Invalid hand state');
  if (left < 1 || left > 4 || right < 1 || right > 4) throw new InvalidMove('Split hands must each be 1-4 (split cannot kill or revive)');
  if (left + right !== a + b) throw new InvalidMove('Split must keep the same total ('+(a+b)+')');
  if (left === a && right === b) throw new InvalidMove('Split must change distribution');
  if (this._isSwap(a,b,left,right)) throw new InvalidMove('Swapping hands is not a split');
  return true;
 },
 _legalMoves(state) {
  if (state.status !== 'active') return [];
  const me = state.turnIndex, op = me === 0 ? 1 : 0;
  const moves = [];
  const mh = state.hands[me], oh = state.hands[op];
  for (let f=0; f<2; f++) for (let t=0; t<2; t++)
   if (mh[f] > 0 && oh[t] > 0) moves.push({kind:'attack',from:f,to:t});
  const [a,b] = mh;
  if (a>0 && b>0) {
   const total=a+b;
   for (let l=1;l<=4;l++){const r=total-l;if(r<1||r>4)continue;if(l===a&&r===b)continue;if(l===b&&r===a&&a!==b)continue;moves.push({kind:'split',left:l,right:r});}
  }
  return moves;
 },
 applyMove(state, playerId, move, ctx) {
  if (state.status !== 'active') throw new InvalidMove('Game is over');
  if (!move || typeof move !== 'object') throw new InvalidMove('Malformed move');
  const curId = ctx.players[state.turnIndex] ? ctx.players[state.turnIndex].id : null;
  if (playerId !== curId) throw new InvalidMove('Not your turn');
  const me = state.turnIndex, op = me === 0 ? 1 : 0;
  const hands = [state.hands[0].slice(), state.hands[1].slice()];
  if (move.kind === 'attack') {
   const {from,to} = move;
   if (from!==0&&from!==1) throw new InvalidMove('Invalid hand (pick 0/left or 1/right)');
   if (to!==0&&to!==1) throw new InvalidMove('Invalid target (pick 0/left or 1/right)');
   if (hands[me][from]===0) throw new InvalidMove('Cannot attack with a dead hand');
   if (hands[op][to]===0) throw new InvalidMove('Cannot target a dead hand');
   let nv = hands[op][to]+hands[me][from];
   hands[op][to] = nv>=5?0:nv;
  } else if (move.kind === 'split') {
   this._validateSplit(hands[me], move.left, move.right);
   hands[me]=[move.left,move.right];
  } else throw new InvalidMove('Unknown action (use attack or split)');
  if (hands[op][0]===0 && hands[op][1]===0) {
   const ns={hands,turnIndex:me,status:'won',winnerIndex:me};
   const payouts={};
   const humans=ctx.players.filter(p=>p.kind==='human');
   const wid=ctx.players[me]?ctx.players[me].id:null;
   const wIsHuman=humans.some(h=>h.id===wid);
   if(wIsHuman){humans.forEach(h=>{payouts[h.id]=h.id===wid?ctx.pot:0;});}
   else{const n=humans.length;if(n>0){const each=Math.floor(ctx.pot/n);let rem=ctx.pot-each*n;humans.forEach(h=>{payouts[h.id]=each+(rem-->0?1:0);});}}
   return {state:ns,turn:null,payouts};
  }
  const ns={hands,turnIndex:op,status:'active',winnerIndex:null};
  return {state:ns,turn:[ctx.players[op].id]};
 },
 computerMove(state, playerId, ctx) {
  const moves=this._legalMoves(state);
  if(!moves.length)return {kind:'attack',from:0,to:0};
  const me=state.turnIndex,op=me===0?1:0;
  for(const m of moves){if(m.kind==='attack'){const t=state.hands[op][m.to]+state.hands[me][m.from];if(t>=5){const nh=state.hands[op].slice();nh[m.to]=0;if(nh[1-m.to]===0)return m;}}}
  for(const m of moves){if(m.kind==='attack'){const t=state.hands[op][m.to]+state.hands[me][m.from];if(t>=5)return m;}}
  const atk=moves.filter(m=>m.kind==='attack');
  if(atk.length&&moves.length>atk.length&&ctx.random()<0.85){return atk[Math.floor(ctx.random()*atk.length)%atk.length];}
  const i=Math.floor(ctx.random()*moves.length)%moves.length;
  return moves[i];
 },
 randomMove(state, playerId, ctx) {
  const moves=this._legalMoves(state);
  if(!moves.length) throw new InvalidMove('No moves');
  return moves[Math.floor(ctx.random()*moves.length)%moves.length];
 },
 viewFor(state, playerId, ctx) {
  return { hands: [state.hands[0].slice(),state.hands[1].slice()], turnIndex: state.turnIndex, status: state.status, winnerIndex: state.winnerIndex };
 },
 playerLeft(state, playerId, ctx) {
  if (state.status !== 'active') return { state, turn: null };
  const idx=ctx.players.findIndex(p=>p.id===playerId);
  const payout=Math.floor(ctx.pot*ctx.estimateWinChance(state,playerId));
  const other=idx===0?1:0;
  const nextTurn = state.turnIndex===idx?other:state.turnIndex;
  const ns={hands:[state.hands[0].slice(),state.hands[1].slice()],turnIndex:nextTurn,status:'active',winnerIndex:null};
  const others=ctx.players.filter(p=>p.id!==playerId);
  return { state:ns, turn:[others[ns.turnIndex]?others[ns.turnIndex].id:ctx.players[ns.turnIndex].id], payout };
 }
};