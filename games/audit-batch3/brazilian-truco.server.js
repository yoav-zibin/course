const game = {
  RANKS: ["4","5","6","7","Q","J","K","A","2","3"],
  SUITS: ["D","S","H","C"],
  VALUES: [1,3,6,9,12],
  TARGET: 12,
  side(seat) { return seat % 2; },
  nextValue(v) { const i = this.VALUES.indexOf(v); return this.VALUES[i+1]; },
  trumpRank(turned) {
    const r = turned.slice(0,-1);
    return this.RANKS[(this.RANKS.indexOf(r)+1)%this.RANKS.length];
  },
  isTrump(card, turned) { return card.slice(0,-1) === this.trumpRank(turned); },
  strength(card, turned) {
    if (this.isTrump(card, turned)) return 100 + this.SUITS.indexOf(card.slice(-1));
    return this.RANKS.indexOf(card.slice(0,-1));
  },
  shuffledDeck(random) {
    const deck = [];
    for (const r of this.RANKS) for (const s of this.SUITS) deck.push(r+s);
    for (let i = deck.length-1; i > 0; i--) {
      const j = Math.floor(random()*(i+1));
      const t = deck[i]; deck[i]=deck[j]; deck[j]=t;
    }
    return deck;
  },
  deal(base, dealer, random) {
    const n = base.n;
    const deck = this.shuffledDeck(random);
    const hands = [];
    for (let s=0;s<n;s++) hands.push(deck.slice(s*3, s*3+3));
    const first = (dealer+1)%n;
    return Object.assign({}, base, { dealer, hands, turned: deck[n*3], trick: [], tricks: [], turn: first, value: 1, raise: null, last_raise_by: null, raise_log: null, hand_no: (base.hand_no||0)+1 });
  },
  canRaise(state, seat) {
    return state.winner===null && !state.raise && state.turn===seat && state.value < this.TARGET && state.last_raise_by !== this.side(seat);
  },
  handResult(tricks) {
    const r = tricks.map(t=>t.side);
    if (r.length===2) {
      const a=r[0], b=r[1];
      if (a===-1 && b===-1) return undefined;
      if (a===-1) return b;
      if (b===-1 || a===b) return a;
      return undefined;
    }
    if (r.length===3) {
      const a=r[0], b=r[1], c=r[2];
      if (c!==-1) return c;
      if (a!==-1) return a;
      return b!==-1 ? b : null;
    }
    return undefined;
  },
  endHand(state, side, points, how, random) {
    const scores = [state.scores[0], state.scores[1]];
    if (side!==null) scores[side]+=points;
    const last_hand = { side, points: side===null?0:points, how };
    const done = side!==null && scores[side] >= this.TARGET;
    if (done) return { state: Object.assign({}, state, { scores, last_hand, raise: null, winner: side }), nextSeat: null };
    const next = this.deal(Object.assign({}, state, { scores, last_hand, last_trick: state.last_trick }), (state.dealer+1)%state.n, random);
    return { state: next, nextSeat: next.turn };
  },
  doApply(state, seat, action, random) {
    if (state.winner!==null) throw new InvalidMove("the game is over");
    const n = state.n;
    const pending = state.raise;
    if (pending) {
      if (seat!==pending.answerer) throw new InvalidMove("not your answer");
      if (action.type==="accept") {
        const next = Object.assign({}, state, { value: pending.to, last_raise_by: pending.by, raise: null, raise_log: { value: pending.to, result: "accepted" } });
        return { state: next, nextSeat: state.turn };
      }
      if (action.type==="run") return this.endHand(state, pending.by, state.value, "run", random);
      if (action.type==="raise" && pending.to < this.TARGET) {
        const to = this.nextValue(pending.to);
        const raise = { to, by: this.side(seat), caller: seat, answerer: (seat+1)%n };
        const next = Object.assign({}, state, { value: pending.to, last_raise_by: pending.by, raise, raise_log: { value: to, result: "called" } });
        return { state: next, nextSeat: raise.answerer };
      }
      throw new InvalidMove("illegal answer");
    }
    if (seat!==state.turn) throw new InvalidMove("not your turn");
    if (action.type==="raise") {
      if (!this.canRaise(state, seat)) throw new InvalidMove("can't raise now");
      const raise = { to: this.nextValue(state.value), by: this.side(seat), caller: seat, answerer: (seat+1)%n };
      return { state: Object.assign({}, state, { raise, raise_log: { value: raise.to, result: "called" } }), nextSeat: raise.answerer };
    }
    if (action.type!=="play" || typeof action.card!=="string" || !state.hands[seat].includes(action.card)) throw new InvalidMove("illegal move");
    const hands = state.hands.map((h,i)=> i===seat ? h.filter(c=>c!==action.card) : h.slice());
    const trick = state.trick.concat([{ seat, card: action.card }]);
    if (trick.length < n) {
      const turn = (seat+1)%n;
      return { state: Object.assign({}, state, { hands, trick, turn }), nextSeat: turn };
    }
    const strengths = trick.map(p=>this.strength(p.card, state.turned));
    const best = Math.max.apply(null, strengths);
    const top = trick.filter((p,i)=>strengths[i]===best);
    const sides = {};
    top.forEach(p=>{ sides[this.side(p.seat)]=true; });
    const tied = Object.keys(sides).length>1;
    const result = { side: tied?-1:this.side(top[0].seat), seat: top[0].seat };
    const tricks = state.tricks.concat([result]);
    const next = Object.assign({}, state, { hands, trick: [], tricks, turn: top[0].seat, last_trick: { plays: trick, side: result.side, seat: result.seat } });
    const winner = this.handResult(tricks);
    if (winner!==undefined) return this.endHand(next, winner, state.value, "tricks", random);
    return { state: next, nextSeat: next.turn };
  },
  seatOf(state, playerId, ctx) {
    for (let i=0;i<ctx.players.length;i++) if (ctx.players[i].id===playerId) return i;
    return -1;
  },
  turnFor(seat, ctx) {
    if (seat===null || seat===undefined) return null;
    if (seat<0 || seat>=ctx.players.length) return null;
    return [ctx.players[seat].id];
  },
  payoutsFor(state, ctx) {
    const payouts = {};
    const humans = ctx.players.filter(p=>p.kind==="human");
    for (const h of humans) payouts[h.id]=0;
    const pot = ctx.pot||0;
    if (pot<=0) return payouts;
    if (humans.length===0) return payouts;
    let winners = humans.filter((h,idx)=>{
      const seat = ctx.players.indexOf(h);
      return state.winner!==null && (seat%2)===state.winner;
    });
    if (winners.length===0) winners = humans;
    const each = Math.floor(pot/winners.length);
    let rem = pot - each*winners.length;
    for (const w of winners) {
      payouts[w.id]=each + (rem>0?1:0);
      if (rem>0) rem--;
    }
    return payouts;
  },
  newMatch(ctx) {
    const n = ctx.players.length>=4?4:2;
    const base = { n, scores:[0,0], last_trick:null, last_hand:null, winner:null, hand_no:0 };
    const state = this.deal(base, n-1, ctx.random);
    return { state, turn: this.turnFor(state.turn, ctx) };
  },
  applyMove(state, playerId, move, ctx) {
    const seat = this.seatOf(state, playerId, ctx);
    if (seat<0 || seat>=state.n) throw new InvalidMove("not in match");
    const r = this.doApply(state, seat, move||{}, ctx.random);
    if (r.state.winner!==null) return { state: r.state, turn: null, payouts: this.payoutsFor(r.state, ctx) };
    return { state: r.state, turn: this.turnFor(r.nextSeat, ctx) };
  },
  legalMoves(state, seat) {
    if (state.winner!==null) return [];
    if (state.raise) {
      if (seat!==state.raise.answerer) return [];
      const m = [{type:"accept"},{type:"run"}];
      if (state.raise.to < this.TARGET) m.push({type:"raise"});
      return m;
    }
    if (seat!==state.turn) return [];
    const m = state.hands[seat].map(c=>({type:"play",card:c}));
    if (this.canRaise(state, seat)) m.push({type:"raise"});
    return m;
  },
  computerMove(state, playerId, ctx) {
    const seat = this.seatOf(state, playerId, ctx);
    const hand = state.hands[seat];
    const turned = state.turned;
    const isT = (c)=>this.isTrump(c,turned);
    const rankIdx = (c)=>this.RANKS.indexOf(c.slice(0,-1));
    const trumps = hand.filter(isT).length;
    const atLeast = (rank)=>hand.filter(c=>isT(c)||rankIdx(c)>=this.RANKS.indexOf(rank)).length;
    if (state.raise) {
      if (trumps>=2 && state.raise.to<this.TARGET) return {type:"raise"};
      if (trumps>=1 || atLeast("2")>=2) return {type:"accept"};
      return {type:"run"};
    }
    if (this.canRaise(state, seat)) {
      const wants = state.value===1 ? (trumps>=1||atLeast("A")>=2) : trumps>=2;
      if (wants) return {type:"raise"};
    }
    const byS = hand.slice().sort((a,b)=>this.strength(a,turned)-this.strength(b,turned));
    if (state.trick.length>0) {
      let best=null;
      for (const p of state.trick) { const s=this.strength(p.card,turned); if(!best||s>best.strength) best={strength:s,seat:p.seat}; }
      if (best && (best.seat%2)!==(seat%2)) {
        const win = byS.find(c=>this.strength(c,turned)>best.strength);
        if (win) return {type:"play",card:win};
      }
    }
    const r = ctx.random();
    const card = byS[Math.min(byS.length-1, Math.floor(r*byS.length)) % byS.length] || byS[0];
    if (byS.length>1 && r<0.15) return {type:"play",card:byS[byS.length-1]};
    return {type:"play",card:card||byS[0]};
  },
  randomMove(state, playerId, ctx) {
    const seat = this.seatOf(state, playerId, ctx);
    const moves = this.legalMoves(state, seat);
    if (!moves.length) throw new InvalidMove("no moves");
    return moves[Math.floor(ctx.random()*moves.length)];
  },
  viewFor(state, playerId, ctx) {
    if (!state) return { turn: [], empty: true };
    let me = -1;
    if (playerId!==null && playerId!==undefined) { for (let i=0;i<ctx.players.length;i++) if(ctx.players[i].id===playerId) me=i; }
    const hands = state.hands.map((h,i)=> i===me ? h.slice() : []);
    const hand_counts = state.hands.map(h=>h.length);
    const hand = me>=0 && me<state.n ? state.hands[me].slice() : [];
    const turn = this.currentTurnIds(state, ctx);
    return { n: state.n, scores: state.scores.slice(), dealer: state.dealer, hands, hand_counts, hand, turned: state.turned, trick: state.trick.map(p=>({seat:p.seat,card:p.card})), tricks: state.tricks.map(t=>({side:t.side,seat:t.seat})), turn: turn, turn_seat: state.turn, value: state.value, raise: state.raise?{to:state.raise.to,by:state.raise.by,caller:state.raise.caller,answerer:state.raise.answerer}:null, last_raise_by: state.last_raise_by, raise_log: state.raise_log?{value:state.raise_log.value,result:state.raise_log.result}:null, hand_no: state.hand_no, last_trick: state.last_trick?{plays:state.last_trick.plays.map(p=>({seat:p.seat,card:p.card})),side:state.last_trick.side,seat:state.last_trick.seat}:null, last_hand: state.last_hand?{side:state.last_hand.side,points:state.last_hand.points,how:state.last_hand.how}:null, winner: state.winner, can_raise: me>=0 ? this.canRaise(state, me) : false };
  },
  currentTurnIds(state, ctx) {
    if (state.winner!==null) return [];
    let seat = state.raise ? state.raise.answerer : state.turn;
    if (seat<0 || seat>=ctx.players.length) return [];
    return [ctx.players[seat].id];
  },
  currentTurn(state, ctx) {
    if (state.winner!==null) return null;
    if (state.raise) return this.turnFor(state.raise.answerer, ctx);
    return this.turnFor(state.turn, ctx);
  },
  playerJoined(state, playerId, ctx) {
    return { state, turn: this.currentTurn(state, ctx) };
  },
  playerLeft(state, playerId, ctx) {
    let payout = 0;
    try { payout = Math.floor((ctx.pot||0) * ctx.estimateWinChance(state, playerId)); } catch(e) { payout = 0; }
    return { state, turn: this.currentTurn(state, ctx), payout };
  }
};