const game = {
 newMatch: function(ctx) {
  const R=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const S=['C','D','S','H'];
  let deck=[]; for (const s of S) for (const r of R) deck.push(r+s);
  for (let i=deck.length-1;i>0;i--){ const j=Math.floor(ctx.random()*(i+1)); const t=deck[i]; deck[i]=deck[j]; deck[j]=t; }
  const hands=[[],[],[],[]];
  for (let i=0;i<52;i++) hands[i%4].push(deck[i]);
  const ord={C:0,D:1,S:2,H:3};
  function rv(c){ const r=c.slice(0,-1); if(r==='J')return 11; if(r==='Q')return 12; if(r==='K')return 13; if(r==='A')return 14; return parseInt(r,10); }
  for (let i=0;i<4;i++) hands[i].sort((a,b)=> ord[a.slice(-1)]-ord[b.slice(-1)] || rv(a)-rv(b));
  let leader=0; for (let i=0;i<4;i++) if (hands[i].indexOf('2C')>=0) leader=i;
  const ids=ctx.players.map(p=>p.id);
  const state={hands:hands,trick:[],trickNum:0,leader:leader,heartsBroken:false,taken:[0,0,0,0],phase:'play',winner:null,shooter:-1};
  return {state:state, turn:[ids[leader]]};
 },
 applyMove: function(state, playerId, move, ctx) {
  if (state.phase==='over') throw new InvalidMove('game over');
  const n=4;
  const idx=ctx.players.findIndex(p=>p.id===playerId);
  if (idx<0) throw new InvalidMove('unknown player');
  const cur=(state.leader+state.trick.length)%n;
  if (idx!==cur) throw new InvalidMove('not your turn');
  const card=move&&move.card;
  if (typeof card!=='string') throw new InvalidMove('pick a card');
  const hi=state.hands[idx].indexOf(card);
  if (hi<0) throw new InvalidMove('card not in hand');
  const legal=legalFor(state.hands[idx], state);
  if (legal.indexOf(card)<0) throw new InvalidMove('illegal play');
  state.hands[idx].splice(hi,1);
  state.trick.push({player:idx,card:card});
  if (card.slice(-1)==='H') state.heartsBroken=true;
  const ids=ctx.players.map(p=>p.id);
  if (state.trick.length<4) return {state:state, turn:[ids[(cur+1)%n]]};
  const led=state.trick[0].card.slice(-1);
  let best=state.trick[0], br=-1;
  for (const t of state.trick){ if (t.card.slice(-1)===led){ const v=rv(t.card); if(v>br){br=v;best=t;} } }
  const w=best.player;
  let pts=0;
  for (const t of state.trick){ if (t.card.slice(-1)==='H') pts+=1; if (t.card==='QS') pts+=13; }
  state.taken[w]+=pts;
  if (state.trickNum>=12){
   let shooter=-1;
   for (let i=0;i<4;i++) if (state.taken[i]===26) shooter=i;
   let fin=state.taken.slice();
   if (shooter>=0){ fin=[26,26,26,26]; fin[shooter]=0; }
   let win=0; for (let i=1;i<4;i++) if (fin[i]<fin[win]) win=i;
   state.taken=fin; state.trick=[]; state.phase='over'; state.winner=win; state.shooter=shooter;
   return {state:state, turn:null, payouts:payOut(ctx, fin)};
  }
  state.trick=[]; state.trickNum+=1; state.leader=w;
  return {state:state, turn:[ids[w]]};
 },
 computerMove: function(state, playerId, ctx) {
  const idx=ctx.players.findIndex(p=>p.id===playerId);
  const hand=state.hands[idx];
  const legal=legalFor(hand, state);
  return {card: aiPick(legal, state)};
 },
 randomMove: function(state, playerId, ctx) {
  const idx=ctx.players.findIndex(p=>p.id===playerId);
  const legal=legalFor(state.hands[idx], state);
  return {card: legal[Math.floor(ctx.random()*legal.length)]};
 },
 viewFor: function(state, playerId, ctx) {
  const idx=playerId===null?-1:ctx.players.findIndex(p=>p.id===playerId);
  const counts=state.hands.map(h=>h.length);
  const cur=state.phase==='over'?-1:(state.leader+state.trick.length)%4;
  const base={phase:state.phase,trick:state.trick.map(t=>({player:t.player,card:t.card})),trickNum:state.trickNum,leader:state.leader,heartsBroken:state.heartsBroken,taken:state.taken.slice(),counts:counts,cur:cur,winner:state.winner,shooter:state.shooter};
  if (idx<0){ base.hand=[]; base.legal=[]; return base; }
  base.hand=state.hands[idx].slice();
  base.legal=legalFor(state.hands[idx], state);
  return base;
 }
};
function rv(c){ const r=c.slice(0,-1); if(r==='J')return 11; if(r==='Q')return 12; if(r==='K')return 13; if(r==='A')return 14; return parseInt(r,10); }
function legalFor(hand, st){
 if (st.trick.length===0){
  if (st.trickNum===0) return hand.filter(c=>c==='2C');
  const nonH=hand.filter(c=>c.slice(-1)!=='H');
  if (!st.heartsBroken && nonH.length>0) return nonH;
  return hand.slice();
 }
 const led=st.trick[0].card.slice(-1);
 const fol=hand.filter(c=>c.slice(-1)===led);
 if (fol.length>0) return fol;
 if (st.trickNum===0){ const safe=hand.filter(c=>!(c.slice(-1)==='H'||c==='QS')); if (safe.length>0) return safe; }
 return hand.slice();
}
function aiPick(legal, st){
 const asc=legal.slice().sort((a,b)=>rv(a)-rv(b));
 const desc=asc.slice().reverse();
 if (st.trick.length===0) return asc[0];
 const led=st.trick[0].card.slice(-1);
 const isFol=legal.every(c=>c.slice(-1)===led);
 if (isFol){
  let win=0; for (const t of st.trick) if (t.card.slice(-1)===led) win=Math.max(win, rv(t.card));
  const lose=asc.filter(c=>rv(c)<win);
  if (lose.length>0) return lose[lose.length-1];
  return desc[0];
 }
 if (legal.indexOf('QS')>=0) return 'QS';
 const hs=legal.filter(c=>c.slice(-1)==='H').sort((a,b)=>rv(b)-rv(a));
 if (hs.length>0) return hs[0];
 if (legal.indexOf('AS')>=0) return 'AS';
 if (legal.indexOf('KS')>=0) return 'KS';
 return desc[0];
}
function payOut(ctx, fin){
 const pot=ctx.pot||0;
 const humans=ctx.players.filter(p=>p.kind!=='computer');
 const out={};
 if (humans.length===0) return out;
 if (pot<=0){ for (const h of humans) out[h.id]=0; return out; }
 let best=Infinity; for (const h of humans){ const i=ctx.players.findIndex(p=>p.id===h.id); if (fin[i]<best) best=fin[i]; }
 let gBest=Infinity; for (let i=0;i<4;i++) if (fin[i]<gBest) gBest=fin[i];
 let winners=humans.filter(h=>fin[ctx.players.findIndex(p=>p.id===h.id)]===best && best===gBest);
 if (winners.length===0) winners=humans.slice();
 const share=Math.floor(pot/winners.length);
 let rem=pot;
 for (const h of humans) out[h.id]=0;
 for (let k=0;k<winners.length;k++){ const amt=(k===winners.length-1)?rem:share; out[winners[k].id]=amt; rem-=amt; }
 return out;
}
