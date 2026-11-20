// Two-player Scopa, scored as a single deal.
const game = {
  newMatch(ctx) {
    const deck = [];
    for (const suit of ['S','H','D','C'])
      for (let rank = 1; rank <= 10; rank++) deck.push(`${rank}${suit}`);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [deck[i],deck[j]] = [deck[j],deck[i]];
    }
    const table = deck.splice(0,4);
    const hands = [deck.splice(0,3),deck.splice(0,3)];
    return {state:{deck,table,hands,captured:[[],[]],sweeps:[0,0],turn:0,
      last_capture:-1,over:false,winner:-1,scores:[0,0]},turn:[ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    const seat = ctx.players.findIndex(player => player.id === playerId);
    if (state.over) throw new InvalidMove('game over');
    if (seat < 0 || seat !== state.turn) throw new InvalidMove('not your turn');
    if (!move || typeof move !== 'object' || Array.isArray(move) ||
        Object.keys(move).sort().join(',') !== 'capture,card' ||
        typeof move.card !== 'string' || !Array.isArray(move.capture))
      throw new InvalidMove('choose a card and capture');
    const possible = legalMoves(state,seat);
    const selected = possible.find(option => option.card === move.card &&
      option.capture.length === move.capture.length &&
      option.capture.every(card => move.capture.includes(card)));
    if (!selected || new Set(move.capture).size !== move.capture.length)
      throw new InvalidMove('invalid capture');
    const next = JSON.parse(JSON.stringify(state));
    next.hands[seat].splice(next.hands[seat].indexOf(move.card),1);
    if (selected.capture.length) {
      next.table = next.table.filter(card => !selected.capture.includes(card));
      next.captured[seat].push(move.card,...selected.capture);
      next.last_capture = seat;
      const finalPlay = !next.deck.length && next.hands.every(hand => !hand.length);
      if (!next.table.length && !finalPlay) next.sweeps[seat]++;
    } else next.table.push(move.card);
    if (next.hands.every(hand => !hand.length)) {
      if (next.deck.length) {
        next.hands[0] = next.deck.splice(0,3);
        next.hands[1] = next.deck.splice(0,3);
      } else {
        if (next.last_capture < 0) throw new Error('No player captured a card');
        next.captured[next.last_capture].push(...next.table);
        next.table = [];
        next.scores = score(next);
        next.over = true;
        next.winner = next.scores[0] === next.scores[1] ? -1 :
          next.scores[0] > next.scores[1] ? 0 : 1;
        return {state:next,turn:null,payouts:payouts(next.winner,ctx)};
      }
    }
    next.turn = 1 - seat;
    return {state:next,turn:[ctx.players[next.turn].id]};
  },
  viewFor(state, playerId, ctx) {
    const seat = playerId == null ? -1 : ctx.players.findIndex(p => p.id === playerId);
    return {hand:seat < 0 ? [] : state.hands[seat].slice(),table:state.table.slice(),
      counts:state.hands.map(hand => hand.length),deck_count:state.deck.length,
      captured_counts:state.captured.map(cards => cards.length),sweeps:state.sweeps,
      turn:state.turn,over:state.over,winner:state.winner,scores:state.scores,
      legal:seat === state.turn && !state.over ? legalMoves(state,seat) : []};
  },
  computerMove(state, playerId, ctx) {
    const seat = ctx.players.findIndex(player => player.id === playerId);
    const choices = legalMoves(state,seat);
    return choices[Math.floor(ctx.random()*choices.length)];
  },
  randomMove(state, playerId, ctx) { return this.computerMove(state,playerId,ctx); }
};

function rank(card) { return Number(card.slice(0,-1)); }

function captures(table, value) {
  const equal = table.filter(card => rank(card) === value);
  if (equal.length) return equal.map(card => [card]);
  const found = [];
  function search(index, remaining, chosen) {
    if (remaining === 0) { found.push(chosen); return; }
    for (let i = index; i < table.length; i++) {
      const n = rank(table[i]);
      if (n <= remaining) search(i+1,remaining-n,[...chosen,table[i]]);
    }
  }
  search(0,value,[]);
  return found.length ? found : [[]];
}

function legalMoves(state, seat) {
  return state.hands[seat].flatMap(card =>
    captures(state.table,rank(card)).map(capture => ({card,capture})));
}

function score(state) {
  const scores = state.sweeps.slice(), piles = state.captured;
  const award = (a,b) => { if (a !== b) scores[a > b ? 0 : 1]++; };
  award(piles[0].length,piles[1].length);
  award(piles[0].filter(c => c.endsWith('D')).length,piles[1].filter(c => c.endsWith('D')).length);
  const seven = piles.findIndex(cards => cards.includes('7D'));
  if (seven >= 0) scores[seven]++;
  const weights = {1:16,2:12,3:13,4:14,5:15,6:18,7:21,8:10,9:10,10:10};
  const primiera = cards => {
    const best = ['S','H','D','C'].map(suit =>
      Math.max(0,...cards.filter(card => card.endsWith(suit)).map(card => weights[rank(card)])));
    return best.includes(0) ? 0 : best.reduce((a,b) => a+b,0);
  };
  award(primiera(piles[0]),primiera(piles[1]));
  return scores;
}

function payouts(winner,ctx) {
  const humans = ctx.players.filter(player => player.kind === 'human' && player.active !== false);
  if (!humans.length) return {};
  const winningPlayer = winner < 0 ? null : ctx.players[winner];
  const recipients = winningPlayer && humans.includes(winningPlayer) ? [winningPlayer] : humans;
  const pot = ctx.pot || 0, share = Math.floor(pot/recipients.length), rem = pot%recipients.length;
  const result = Object.fromEntries(humans.map(player => [player.id,0]));
  recipients.forEach((player,i) => { result[player.id] = share + (i < rem ? 1 : 0); });
  return result;
}
