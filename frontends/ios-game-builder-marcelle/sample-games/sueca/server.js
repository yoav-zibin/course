"use strict";

// Sueca: the Portuguese and Brazilian trick-taking card game for 4 players in
// two teams (seats 0 and 2 against seats 1 and 3). A 40-card deck (no 8, 9, 10),
// 10 cards each, follow suit, one trump suit. Card points: A 11, 7 10, K 4, J 3,
// Q 2 (120 per deal). A team with 61-90 points scores 1 game point, 91 or more scores
// 2; 60-60 scores nothing. Winning all 10 tricks ("dar uma bandeira") wins the match at
// once. First team to 4 game points wins. (Rules: en.wikipedia.org/wiki/Sueca_(card_game))

const SUITS = ["c", "d", "h", "s"]; // clubs, diamonds, hearts, spades
const RANKS = ["2", "3", "4", "5", "6", "Q", "J", "K", "7", "A"]; // weakest to strongest
const POINTS = { A: 11, "7": 10, K: 4, J: 3, Q: 2, "6": 0, "5": 0, "4": 0, "3": 0, "2": 0 };
const TARGET = 4;
const DECK = SUITS.flatMap((suit) => RANKS.map((rank) => rank + suit));

const suitOf = (card) => card[1];
const rankOf = (card) => card[0];
const strength = (card) => RANKS.indexOf(rankOf(card));
const pointsOf = (card) => POINTS[rankOf(card)];
const teamOf = (seat) => seat % 2;

/** Cards in a stable display order: by suit, then weakest to strongest. */
function sortCards(cards) {
  return [...cards].sort(
    (a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || strength(a) - strength(b)
  );
}

/** A shuffled deal from [dealer]: 10 cards each, the dealer's last card is trump. */
function deal(dealer, rng) {
  const deck = [...DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const hands = [[], [], [], []];
  // Ten each, starting after the dealer; the dealer receives the last ten.
  for (let k = 0; k < 4; k++) {
    const seat = (dealer + 1 + k) % 4;
    hands[seat] = deck.slice(k * 10, k * 10 + 10);
  }
  const trumpCard = hands[dealer][9];
  return {
    hands: hands.map(sortCards),
    trump_card: trumpCard,
    trump_suit: suitOf(trumpCard),
    trump_shown: true,
    leader: (dealer + 1) % 4,
    trick: [],
    tricks_won: [0, 0],
    deal_points: [0, 0],
  };
}

function newState(rng) {
  const dealer = 3; // so the first player (seat 0) leads the first trick
  return {
    dealer,
    deal_number: 1,
    ...deal(dealer, rng),
    last_trick: null,
    game_points: [0, 0],
    last_deal: null,
    winner_team: null,
  };
}

function seatOf(ctx, playerId) {
  return ctx.players.findIndex((player) => player.id === playerId);
}

/** The seat whose turn it is (the next to play in the trick), or null when over. */
function seatToPlay(state) {
  if (state.winner_team !== null) return null;
  return (state.leader + state.trick.length) % 4;
}

/** The cards [seat] may play now: follow the led suit when possible. */
function legalCards(state, seat) {
  const hand = state.hands[seat];
  if (state.trick.length === 0) return hand;
  const led = suitOf(state.trick[0].card);
  const following = hand.filter((card) => suitOf(card) === led);
  return following.length ? following : hand;
}

/** The seat winning [trick] so far: the highest trump, else the highest of the led suit. */
function trickWinner(trick, trumpSuit) {
  const led = suitOf(trick[0].card);
  let best = trick[0];
  for (const play of trick.slice(1)) {
    const a = play.card, b = best.card;
    const aTrump = suitOf(a) === trumpSuit, bTrump = suitOf(b) === trumpSuit;
    if (aTrump && !bTrump) best = play;
    else if (aTrump === bTrump && suitOf(a) === suitOf(b) && strength(a) > strength(b)) best = play;
    else if (!aTrump && !bTrump && suitOf(a) === led && suitOf(b) !== led) best = play;
  }
  return best.seat;
}

/** Game points for a deal's card points: 61-90 one, 91 or more two (even all 120). */
function gamePointsFor(points) {
  if (points >= 91) return 2;
  if (points >= 61) return 1;
  return 0;
}

/** The pot to the winning team's humans (split, remainder to the earliest); to all
 * humans when the winning team has none (computers never take tokens). */
function endPayouts(winnerTeam, ctx) {
  const humans = ctx.players.filter((player) => player.kind === "human");
  if (humans.length === 0) return {};
  const winners = ctx.players.filter(
    (player, seat) => player.kind === "human" && teamOf(seat) === winnerTeam
  );
  const receivers = winners.length ? winners : humans;
  const payouts = {};
  for (const human of humans) payouts[human.id] = 0;
  const share = Math.floor(ctx.pot / receivers.length);
  let remainder = ctx.pot - share * receivers.length;
  for (const player of receivers) {
    payouts[player.id] = share + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
  }
  return payouts;
}

function validateMove(move) {
  if (!move || typeof move !== "object" || Array.isArray(move)) throw new InvalidMove("send a card to play");
  const keys = Object.keys(move);
  if (keys.length !== 1 || keys[0] !== "card" || typeof move.card !== "string" || !DECK.includes(move.card)) {
    throw new InvalidMove("send a card to play");
  }
}

/** Plays [card] for [seat]; returns the next state (a new deal draws from [rng]). */
function play(state, seat, card, rng) {
  if (state.winner_team !== null) throw new InvalidMove("the match is over");
  if (seat !== seatToPlay(state)) throw new InvalidMove("it is not your turn");
  if (!state.hands[seat].includes(card)) throw new InvalidMove("that card is not in your hand");
  if (!legalCards(state, seat).includes(card)) throw new InvalidMove("you must follow the suit that was led");
  const hands = state.hands.map((hand, s) => (s === seat ? hand.filter((c) => c !== card) : hand));
  const trick = [...state.trick, { seat, card }];
  const next = {
    ...state,
    hands,
    trick,
    trump_shown: state.trump_shown && !(seat === state.dealer && card === state.trump_card),
  };
  if (trick.length < 4) return next;
  // The trick is complete: its winner takes the points and leads next.
  const winner = trickWinner(trick, state.trump_suit);
  const team = teamOf(winner);
  const deal_points = [...state.deal_points];
  deal_points[team] += trick.reduce((sum, p) => sum + pointsOf(p.card), 0);
  const tricks_won = [...state.tricks_won];
  tricks_won[team] += 1;
  const done = { ...next, trick: [], leader: winner, deal_points, tricks_won, last_trick: { cards: trick, winner } };
  if (hands[0].length > 0) return done;
  // The deal is over: award game points, then end the match or deal again. A team that
  // took all 10 tricks (a "bandeira") wins the match at once: it goes straight to the target.
  const sweep = tricks_won.indexOf(10);
  const awarded = deal_points.map(gamePointsFor);
  if (sweep >= 0) awarded[sweep] = Math.max(awarded[sweep], TARGET - done.game_points[sweep]);
  const game_points = [done.game_points[0] + awarded[0], done.game_points[1] + awarded[1]];
  const last_deal = { points: deal_points, awarded };
  const reached = game_points.map((p) => p >= TARGET);
  if (reached[0] || reached[1]) {
    const winner_team = reached[0] && reached[1] ? (game_points[0] >= game_points[1] ? 0 : 1) : (reached[0] ? 0 : 1);
    return { ...done, game_points, last_deal, winner_team, trump_shown: false };
  }
  const dealer = (state.dealer + 1) % 4;
  return { ...done, game_points, last_deal, dealer, deal_number: state.deal_number + 1, ...deal(dealer, rng) };
}

/** A simple player: give points to a winning partner, win a trick cheaply when it
 * pays, otherwise throw the least valuable card. Leads aces of plain suits first. */
function chooseCard(state, seat) {
  const legal = legalCards(state, seat);
  const trump = state.trump_suit;
  const cheapest = (cards) =>
    [...cards].sort((a, b) => pointsOf(a) - pointsOf(b) || strength(a) - strength(b) || DECK.indexOf(a) - DECK.indexOf(b))[0];
  if (state.trick.length === 0) {
    const plainAce = legal.find((card) => rankOf(card) === "A" && suitOf(card) !== trump);
    if (plainAce) return plainAce;
    const plain = legal.filter((card) => suitOf(card) !== trump);
    return cheapest(plain.length ? plain : legal);
  }
  const winning = trickWinner(state.trick, trump);
  if (teamOf(winning) === teamOf(seat)) {
    // Partner is winning: add points, but avoid spending trumps.
    const plain = legal.filter((card) => suitOf(card) !== trump);
    const pool = plain.length ? plain : legal;
    return [...pool].sort((a, b) => pointsOf(b) - pointsOf(a) || strength(a) - strength(b))[0];
  }
  const winners = legal.filter((card) => trickWinner([...state.trick, { seat, card }], trump) === seat);
  if (winners.length) return cheapest(winners);
  return cheapest(legal);
}

const game = {
  newMatch(ctx) {
    const state = newState(() => ctx.random());
    return { state, turn: [ctx.players[seatToPlay(state)].id] };
  },

  applyMove(state, playerId, move, ctx) {
    validateMove(move);
    const seat = seatOf(ctx, playerId);
    if (seat < 0) throw new InvalidMove("it is not your turn");
    const next = play(state, seat, move.card, () => ctx.random());
    if (next.winner_team !== null) {
      return { state: next, turn: null, payouts: endPayouts(next.winner_team, ctx) };
    }
    return { state: next, turn: [ctx.players[seatToPlay(next)].id] };
  },

  computerMove(state, playerId, ctx) {
    return { card: chooseCard(state, seatOf(ctx, playerId)) };
  },

  randomMove(state, playerId, ctx) {
    const legal = legalCards(state, seatOf(ctx, playerId));
    return { card: legal[Math.floor(ctx.random() * legal.length)] };
  },

  viewFor(state, playerId, ctx) {
    const seat = playerId === null ? -1 : seatOf(ctx, playerId);
    const toPlay = seatToPlay(state);
    return {
      my_seat: seat >= 0 ? seat : null,
      hand: seat >= 0 ? state.hands[seat] : [],
      playable: seat >= 0 && seat === toPlay ? legalCards(state, seat) : [],
      hand_counts: state.hands.map((hand) => hand.length),
      dealer: state.dealer,
      deal_number: state.deal_number,
      trump_suit: state.trump_suit,
      trump_card: state.trump_card,
      trump_shown: state.trump_shown,
      trick: state.trick,
      to_play: toPlay,
      last_trick: state.last_trick,
      tricks_won: state.tricks_won,
      deal_points: state.deal_points,
      game_points: state.game_points,
      target: TARGET,
      last_deal: state.last_deal,
      winner_team: state.winner_team,
    };
  },
};
