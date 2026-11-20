const game = {
  newMatch(ctx) {
    return {state:{piles:[3,5,7],seat:0,winner:null},turn:[ctx.players[0].id]};
  },
  applyMove(s,id,m,ctx) {
    if (s.winner!==null || ctx.players[s.seat].id!==id || !m ||
        typeof m!=='object' || Array.isArray(m) || Object.keys(m).length!==2 ||
        !Number.isInteger(m.pile) || m.pile<0 || m.pile>=3 ||
        !Number.isInteger(m.take) || m.take<1 || m.take>s.piles[m.pile])
      throw new InvalidMove('Choose a legal move on your turn.');
    const piles=s.piles.slice();piles[m.pile]-=m.take;
    if(piles.some(n=>n>0)) {
      const seat=1-s.seat;
      return {state:{piles,seat,winner:null},turn:[ctx.players[seat].id]};
    }
    const winner=s.seat;
    const recipient=ctx.players.find(p=>p.id===id&&p.kind==='human'&&p.active!==false)
      ||ctx.players.find(p=>p.kind==='human'&&p.active!==false);
    return {state:{piles,seat:winner,winner},turn:null,
      payouts:recipient?{[recipient.id]:ctx.pot}:{}};
  },
  viewFor(s){return s;},
  computerMove(s){
    const nimSum=s.piles.reduce((sum,n)=>sum^n,0);
    for(let pile=0;pile<3;pile++){
      const target=s.piles[pile]^nimSum;
      if(target<s.piles[pile])return {pile,take:s.piles[pile]-target};
    }
    const pile=s.piles.findIndex(n=>n>0);
    return {pile,take:1};
  },
  randomMove(s,id,ctx){
    const choices=s.piles.flatMap((n,i)=>n>0?[i]:[]);
    const pile=choices[Math.floor(ctx.random()*choices.length)];
    return {pile,take:1+Math.floor(ctx.random()*s.piles[pile])};
  }
};
