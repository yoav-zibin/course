// Four-player partnership Whist, played as a single thirteen-trick hand.
const game = {
  newMatch(ctx) {
    const deck = [];
    for (const suit of ['S','H','D','C'])
      for (let rank = 2; rank <= 14; rank++) deck.push(`${rank}${suit}`);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const hands = [[],[],[],[]];
    deck.forEach((card, i) => hands[i % 4].push(card));
    const trump = deck[51].slice(-1);
    return {state:{hands,trump,trick:[],last_trick:[],tricks:[0,0],turn:0,over:false,winner:-1},
      turn:[ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    const seat = ctx.players.findIndex(player => player.id === playerId);
    if (state.over) throw new InvalidMove('game over');
    if (seat !== state.turn || seat < 0) throw new InvalidMove('not your turn');
    if (!move || typeof move !== 'object' || Array.isArray(move) ||
        Object.keys(move).length !== 1 || typeof move.card !== 'string')
      throw new InvalidMove('choose a card');
    const legal = legalCards(state, seat);
    if (!legal.includes(move.card)) throw new InvalidMove('follow suit when possible');
    const next = JSON.parse(JSON.stringify(state));
    next.hands[seat].splice(next.hands[seat].indexOf(move.card), 1);
    next.trick.push({seat,card:move.card});
    if (next.trick.length === 4) {
      const led = next.trick[0].card.slice(-1);
      const value = card => {
        const suit = card.slice(-1), rank = Number(card.slice(0,-1));
        return (suit === next.trump ? 200 : suit === led ? 100 : 0) + rank;
      };
      const winner = next.trick.reduce((best, play) =>
        value(play.card) > value(best.card) ? play : best).seat;
      next.tricks[winner % 2]++;
      next.last_trick = next.trick;
      next.trick = [];
      next.turn = winner;
      if (next.tricks[0] + next.tricks[1] === 13) {
        next.over = true;
        next.winner = next.tricks[0] > next.tricks[1] ? 0 : 1;
        return {state:next,turn:null,payouts:teamPayouts(next.winner,ctx)};
      }
    } else next.turn = (seat + 1) % 4;
    return {state:next,turn:[ctx.players[next.turn].id]};
  },
  viewFor(state, playerId, ctx) {
    const seat = playerId == null ? -1 : ctx.players.findIndex(player => player.id === playerId);
    return {hand:seat < 0 ? [] : state.hands[seat].slice(),
      counts:state.hands.map(hand => hand.length),trump:state.trump,
      trick:state.trick,last_trick:state.last_trick,tricks:state.tricks,turn:state.turn,
      over:state.over,winner:state.winner,
      legal:seat === state.turn && !state.over ? legalCards(state,seat) : []};
  },
  computerMove(state, playerId, ctx) {
    const seat = ctx.players.findIndex(player => player.id === playerId);
    const legal = legalCards(state, seat);
    return {card:legal[Math.floor(ctx.random() * legal.length)]};
  },
  randomMove(state, playerId, ctx) {
    return this.computerMove(state, playerId, ctx);
  }
};

function legalCards(state, seat) {
  const hand = state.hands[seat];
  if (!state.trick.length) return hand.slice();
  const led = state.trick[0].card.slice(-1);
  const following = hand.filter(card => card.slice(-1) === led);
  return following.length ? following : hand.slice();
}

function teamPayouts(winner, ctx) {
  const humans = ctx.players.filter(player => player.kind === 'human' && player.active !== false);
  if (!humans.length) return {};
  const winners = ctx.players.filter((player, seat) =>
    player.kind === 'human' && player.active !== false && seat % 2 === winner);
  const recipients = winners.length ? winners : humans;
  const pot = ctx.pot || 0, share = Math.floor(pot / recipients.length), remainder = pot % recipients.length;
  const payouts = Object.fromEntries(humans.map(player => [player.id,0]));
  recipients.forEach((player, i) => { payouts[player.id] = share + (i < remainder ? 1 : 0); });
  return payouts;
}
