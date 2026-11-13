"use strict";

// Buraco, the Uruguayan-Argentine-Brazilian canasta-family game, as described at
// en.wikipedia.org/wiki/Buraco ("Game rules as played in the United States").
// 4 players in fixed partnerships (seats 0 and 2 against 1 and 3); 108 cards: two 52-card decks and
// 4 jokers. Each player gets 11 cards; two 11-card pots are set aside; one card starts the discard
// pile. A turn: draw the top stock card or the whole discard pile, lay melds (sequences of 3+ in one
// suit, ace low or high; groups of 3+ jacks, queens, kings or aces), discard one card. Deuces and
// jokers are wild, at most one wild per meld; a deuce in its own place in its own suit's sequence is
// natural. Melds of 7+ are clean (no wild, +200) or dirty (+100). Emptying your hand takes your
// team's pot; once the team has its pot and a clean meld, emptying it again ends the deal (+100).
// Choices where the page is silent or loose:
// - a match is the first team to 2000 points or, failing that, the higher total after 3 deals
//   (the page's "predefined duration" variation, so a match fits in one sitting); a tie shares it;
// - no bonus for cutting exactly 22 cards; the first discard is turned up at the deal (the page's
//   "Deal" section), so the first player simply draws as usual;
// - the opening minimum (50, or 75 at 1500+ points) must be reached by the cards laid in one move;
// - a deal ends when a player must draw and the stock and the pots are all empty;
// - a team that cannot go out must keep 2 cards after laying melds (one to discard, one to hold);
// - cards still in hand count against the team, including an unplayed pot; a team without its pot
//   loses 100 more.

const RANKS = "A23456789TJQK";
const SUITS = "cdhs";
const JOKER = "JK";
const TARGET = 2000, MAX_DEALS = 3;

const split = (s) => (s ? s.match(/../g) : []);
const join = (cards) => cards.join("");
const isJoker = (c) => c === JOKER;
const rankOf = (c) => c[0];
const suitOf = (c) => c[1];
const isDeuce = (c) => !isJoker(c) && rankOf(c) === "2";

function cardValue(c) {
  if (isJoker(c)) return 30;
  const r = rankOf(c);
  if (r === "2") return 20;
  if (r === "A") return 15;
  return "34567".includes(r) ? 5 : 10;
}
const sum = (cards) => cards.reduce((n, c) => n + cardValue(c), 0);

function fullDeck() {
  const cards = [];
  for (let d = 0; d < 2; d++) for (const s of SUITS) for (const r of RANKS) cards.push(r + s);
  for (let j = 0; j < 4; j++) cards.push(JOKER);
  return cards;
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortCards(cards) {
  const key = (c) => (isJoker(c) ? 999 : SUITS.indexOf(suitOf(c)) * 20 + (rankOf(c) === "A" ? 14 : RANKS.indexOf(rankOf(c)) + 1));
  return [...cards].sort((a, b) => key(a) - key(b));
}

/** Removes [taken] (a multiset) from [cards]; null if a card is missing. */
function removeCards(cards, taken) {
  const rest = [...cards];
  for (const c of taken) {
    const i = rest.indexOf(c);
    if (i < 0) return null;
    rest.splice(i, 1);
  }
  return rest;
}

/** Checks a meld: returns {kind, clean} or null. Wild placement is worked out automatically. */
function analyze(cards) {
  if (cards.length < 3) return null;
  // Group: jacks, queens, kings or aces; any deuce or joker in it is a wild.
  const naturals = cards.filter((c) => !isJoker(c) && !isDeuce(c));
  const wild = cards.length - naturals.length;
  if (naturals.length && naturals.every((c) => rankOf(c) === rankOf(naturals[0])) && "JQKA".includes(rankOf(naturals[0])) && wild <= 1) {
    return { kind: "group", clean: wild === 0 };
  }
  return analyzeRun(cards);
}

function analyzeRun(cards) {
  if (cards.length > 14) return null;
  const suited = cards.filter((c) => !isJoker(c) && !isDeuce(c));
  if (!suited.length) return null;
  const suit = suitOf(suited[0]);
  if (!suited.every((c) => suitOf(c) === suit)) return null;
  const jokers = cards.filter(isJoker).length;
  const deuces = cards.filter(isDeuce);
  const ownDeuces = deuces.filter((c) => suitOf(c) === suit).length;
  let best = null;
  // Try the run's own deuce as natural (at most one) or every deuce as wild.
  for (let naturalTwo = Math.min(1, ownDeuces); naturalTwo >= 0; naturalTwo--) {
    const wilds = jokers + deuces.length - naturalTwo;
    if (wilds > 1) continue;
    const ranks = suited.map((c) => rankOf(c));
    const aces = ranks.filter((r) => r === "A").length;
    if (aces > 2) continue;
    const others = ranks.filter((r) => r !== "A").map((r) => RANKS.indexOf(r) + 1);
    if (naturalTwo) others.push(2);
    if (new Set(others).size !== others.length) continue;
    const aceOptions = aces === 2 ? [[1, 14]] : aces === 1 ? [[1], [14]] : [[]];
    for (const acePos of aceOptions) {
      const pos = [...others, ...acePos].sort((a, b) => a - b);
      const lo = pos[0], hi = pos[pos.length - 1];
      const gaps = hi - lo + 1 - pos.length;
      if (gaps > wilds) continue;
      if (gaps === 0 && wilds === 1 && lo === 1 && hi === 14) continue; // no room for the wild
      const result = { kind: "run", clean: wilds === 0 };
      if (!best || (result.clean && !best.clean)) best = result;
    }
  }
  return best;
}

const teamOf = (seat) => seat % 2;
const partnerOf = (seat) => (seat + 2) % 4;
const minimumFor = (score) => (score >= 1500 ? 75 : 50);
const hasClean = (melds) => melds.some((m) => split(m.cards).length >= 7 && analyze(split(m.cards)).clean);

function deal(state, dealer, rng) {
  const deck = shuffle(fullDeck(), rng);
  const hands = [0, 1, 2, 3].map((p) => join(sortCards(deck.slice(p * 11, p * 11 + 11))));
  const pots = [join(deck.slice(44, 55)), join(deck.slice(55, 66))];
  const discard = deck[66];
  return {
    ...state, dealer, to_move: (dealer + 1) % 4, phase: "draw", hands, pots, stock: join(deck.slice(67)),
    discard, melds: [[], []], took_pot: [false, false], opened: [false, false], drew: null,
  };
}

/** Points a team scores for the deal that just ended. */
function dealPoints(state, team, wentOut) {
  let points = 0;
  for (const m of state.melds[team]) {
    const cards = split(m.cards);
    points += sum(cards);
    if (cards.length >= 7) points += analyze(cards).clean ? 200 : 100;
  }
  for (const seat of [team, team + 2]) points -= sum(split(state.hands[seat]));
  if (!state.took_pot[team]) points -= 100;
  if (wentOut) points += 100;
  return points;
}

function endDeal(state, outTeam, rng) {
  const points = [0, 1].map((t) => dealPoints(state, t, t === outTeam));
  const scores = state.scores.map((s, t) => s + points[t]);
  const last_deal = { deal: state.deal_no, points, went_out: outTeam };
  const next = { ...state, scores, last_deal };
  const best = Math.max(...scores);
  if (best >= TARGET || state.deal_no >= MAX_DEALS) {
    return { ...next, phase: "over", winners: [0, 1].filter((t) => scores[t] === best) };
  }
  return deal({ ...next, deal_no: state.deal_no + 1 }, (state.dealer + 1) % 4, rng);
}

/** True if the team of [seat] may empty its hand now (taking the pot or going out). */
function mayEmpty(state, seat) {
  const team = teamOf(seat);
  if (!state.took_pot[team]) return state.pots.length > 0;
  return hasClean(state.melds[team]);
}

/** After [seat]'s hand became empty: take the pot, or end the deal. */
function handEmptied(state, seat, byDiscard, rng) {
  const team = teamOf(seat);
  if (!state.took_pot[team]) {
    const hands = state.hands.map((h, s) => (s === seat ? join(sortCards(split(state.pots[0]))) : h));
    const next = { ...state, hands, pots: state.pots.slice(1), took_pot: state.took_pot.map((v, t) => v || t === team) };
    return byDiscard ? passTurn(next) : next;
  }
  return endDeal(state, team, rng);
}

function passTurn(state) {
  return { ...state, to_move: (state.to_move + 1) % 4, phase: "draw", drew: null };
}

function startTurnChecks(state, rng) {
  // A player who must draw from an empty stock: refill it from a pot, or end the deal.
  if (state.phase === "draw" && !state.stock.length) {
    if (state.pots.length) return { ...state, stock: state.pots[0], pots: state.pots.slice(1) };
    return endDeal(state, null, rng);
  }
  return state;
}

function apply(state, seat, move, rng) {
  if (state.phase === "over") throw new InvalidMove("the game is over");
  if (seat !== state.to_move) throw new InvalidMove("it is not your turn");
  const hand = split(state.hands[seat]);
  const team = teamOf(seat);
  if ("draw" in move) {
    if (state.phase !== "draw") throw new InvalidMove("you have already drawn this turn");
    if (move.draw === "stock") {
      if (!state.stock.length) throw new InvalidMove("the stock is empty");
      const stock = split(state.stock);
      const hands = state.hands.map((h, s) => (s === seat ? join(sortCards([...hand, stock[0]])) : h));
      return { ...state, hands, stock: join(stock.slice(1)), phase: "play", drew: "stock" };
    }
    if (!state.discard.length) throw new InvalidMove("the discard pile is empty");
    const hands = state.hands.map((h, s) => (s === seat ? join(sortCards([...hand, ...split(state.discard)])) : h));
    return { ...state, hands, discard: "", phase: "play", drew: "discard" };
  }
  if (state.phase !== "play") throw new InvalidMove("draw a card first");
  if ("discard" in move) {
    const rest = removeCards(hand, [move.discard]);
    if (!rest) throw new InvalidMove("you do not have that card");
    if (!rest.length && !mayEmpty(state, seat)) throw new InvalidMove("your team cannot go out yet");
    const next = { ...state, hands: state.hands.map((h, s) => (s === seat ? join(rest) : h)), discard: state.discard + move.discard };
    if (!rest.length) return handEmptied(next, seat, true, rng);
    return passTurn(next);
  }
  // Laying melds: new melds and cards added to the team's melds, all in one move.
  const newMelds = move.lay.new || [];
  const adds = move.lay.add || [];
  let rest = hand;
  let laidValue = 0;
  const melds = state.melds[team].map((m) => ({ ...m }));
  for (const [index, cards] of adds) {
    if (!melds[index]) throw new InvalidMove("that meld does not exist");
    const after = removeCards(rest, cards);
    if (!after) throw new InvalidMove("you do not have those cards");
    const combined = [...split(melds[index].cards), ...cards];
    const info = analyze(combined);
    if (!info) throw new InvalidMove("those cards do not fit that meld");
    melds[index] = { cards: join(sortCards(combined)), kind: info.kind };
    rest = after;
    laidValue += sum(cards);
  }
  for (const cards of newMelds) {
    const after = removeCards(rest, cards);
    if (!after) throw new InvalidMove("you do not have those cards");
    const info = analyze(cards);
    if (!info) throw new InvalidMove("that is not a valid meld");
    melds.push({ cards: join(sortCards(cards)), kind: info.kind });
    rest = after;
    laidValue += sum(cards);
  }
  if (!state.opened[team] && laidValue < minimumFor(state.scores[team])) {
    throw new InvalidMove("your opening melds are worth less than the minimum");
  }
  const allMelds = state.melds.map((m, t) => (t === team ? melds : m));
  const trial = { ...state, melds: allMelds };
  if (rest.length === 0 && !mayEmpty(trial, seat)) throw new InvalidMove("your team cannot go out yet");
  if (rest.length === 1 && !mayEmpty(trial, seat)) {
    // With only one card left you would have to discard it, which is going out: not allowed yet.
    throw new InvalidMove("keep two cards: your team cannot go out yet");
  }
  const next = { ...trial, hands: state.hands.map((h, s) => (s === seat ? join(rest) : h)), opened: state.opened.map((v, t) => v || t === team) };
  if (!rest.length) return handEmptied(next, seat, false, rng);
  return next;
}

function validateMove(move) {
  const keys = move && typeof move === "object" && !Array.isArray(move) ? Object.keys(move) : [];
  const card = (c) => typeof c === "string" && (c === JOKER || (c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1])));
  const cardList = (l) => Array.isArray(l) && l.length > 0 && l.length <= 40 && l.every(card);
  let ok = keys.length === 1;
  if (ok && keys[0] === "draw") ok = move.draw === "stock" || move.draw === "discard";
  else if (ok && keys[0] === "discard") ok = card(move.discard);
  else if (ok && keys[0] === "lay") {
    const lay = move.lay;
    ok = lay && typeof lay === "object" && !Array.isArray(lay) && Object.keys(lay).every((k) => k === "new" || k === "add") &&
      (lay.new === undefined || (Array.isArray(lay.new) && lay.new.every(cardList))) &&
      (lay.add === undefined || (Array.isArray(lay.add) && lay.add.every((a) => Array.isArray(a) && a.length === 2 && Number.isInteger(a[0]) && a[0] >= 0 && cardList(a[1])))) &&
      ((lay.new || []).length + (lay.add || []).length) > 0;
  } else ok = false;
  if (!ok) throw new InvalidMove("send a draw, a discard or melds to lay");
}

const seatOf = (ctx, playerId) => ctx.players.findIndex((p) => p.id === playerId);

function payouts(winners, ctx) {
  const humans = ctx.players.filter((p) => p.kind === "human");
  if (!humans.length) return {};
  const out = Object.fromEntries(humans.map((h) => [h.id, 0]));
  let takers = ctx.players.filter((p, s) => winners.includes(teamOf(s)) && p.kind === "human");
  if (!takers.length) takers = humans;
  const share = Math.floor(ctx.pot / takers.length);
  takers.forEach((p, i) => { out[p.id] = share + (i < ctx.pot - share * takers.length ? 1 : 0); });
  return out;
}

// ---------------------------------------------------------------- the computer player

/** Melds that can be made from [cards] alone, greedily (groups first, then runs). */
function findMelds(cards) {
  let rest = [...cards];
  const melds = [];
  for (const r of "AKQJ") {
    const same = rest.filter((c) => rankOf(c) === r && !isJoker(c));
    if (same.length >= 3) { melds.push(same); rest = removeCards(rest, same); }
  }
  for (const s of SUITS) {
    const ranks = [...new Set(rest.filter((c) => !isJoker(c) && suitOf(c) === s && rankOf(c) !== "2").map((c) => RANKS.indexOf(rankOf(c)) + 1))];
    if (ranks.includes(1)) ranks.push(14);
    ranks.sort((a, b) => a - b);
    let streak = [];
    const flush = () => {
      if (streak.length >= 3) {
        const cards2 = streak.map((p) => RANKS[p === 14 ? 0 : p - 1] + s);
        const after = removeCards(rest, cards2);
        if (after && analyze(cards2)) { melds.push(cards2); rest = after; }
      }
      streak = [];
    };
    for (const p of ranks) {
      if (streak.length && p !== streak[streak.length - 1] + 1) flush();
      streak.push(p);
    }
    flush();
  }
  return { melds, rest };
}

function chooseLay(state, seat) {
  const team = teamOf(seat);
  const hand = split(state.hands[seat]);
  const { melds, rest } = findMelds(hand);
  const adds = [];
  let left = [...rest];
  if (state.opened[team] || melds.length) {
    state.melds[team].forEach((m, index) => {
      for (const c of [...left]) {
        if (isJoker(c) || isDeuce(c)) continue;
        const prior = adds.filter((a) => a[0] === index).flatMap((a) => a[1]);
        if (analyze([...split(m.cards), ...prior, c])) {
          const existing = adds.find((a) => a[0] === index);
          if (existing) existing[1].push(c); else adds.push([index, [c]]);
          left = removeCards(left, [c]);
        }
      }
    });
  }
  if (!melds.length && !adds.length) return null;
  const lay = {};
  if (melds.length) lay.new = melds;
  if (adds.length) lay.add = adds;
  // Keep at least two cards unless going out is allowed.
  const team2 = { ...state };
  try {
    apply(team2, seat, { lay }, () => 0.5);
    return { lay };
  } catch (e) {
    return null;
  }
}

function chooseDiscard(state, seat) {
  const hand = split(state.hands[seat]);
  const { rest } = findMelds(hand);
  const pool = (rest.length ? rest : hand).filter((c) => !isJoker(c) && !isDeuce(c));
  const options = pool.length ? pool : hand;
  // Throw the card with the fewest neighbors in hand (least likely to be melded), highest value first.
  const score = (c) => {
    if (isJoker(c) || isDeuce(c)) return 1000;
    const near = hand.filter((d) => d !== c && !isJoker(d) && ((suitOf(d) === suitOf(c) && Math.abs(RANKS.indexOf(rankOf(d)) - RANKS.indexOf(rankOf(c))) <= 2) || rankOf(d) === rankOf(c))).length;
    return near * 50 - cardValue(c);
  };
  const sorted = [...options].sort((a, b) => score(a) - score(b));
  for (const c of sorted) {
    try { apply(state, seat, { discard: c }, () => 0.5); return { discard: c }; } catch (e) { /* try the next card */ }
  }
  return { discard: hand[0] };
}

function chooseMove(state, seat) {
  if (state.phase === "draw") {
    if (!state.stock.length) return { draw: "discard" };
    const top = split(state.discard).slice(-1)[0];
    const team = teamOf(seat);
    const useful = top && (state.melds[team].some((m) => analyze([...split(m.cards), top])) ||
      findMelds([...split(state.hands[seat]), top]).melds.some((m) => m.includes(top)));
    // Only a pile of 3+ cards is worth taking; this also keeps the stock shrinking, so deals end.
    return { draw: useful && state.opened[team] && state.discard.length >= 6 ? "discard" : "stock" };
  }
  return chooseLay(state, seat) || chooseDiscard(state, seat);
}

const game = {
  newMatch(ctx) {
    const base = { deal_no: 1, scores: [0, 0], last_deal: null, winners: null };
    const state = deal(base, 3, () => ctx.random());
    return { state, turn: [ctx.players[state.to_move].id] };
  },

  applyMove(state, playerId, move, ctx) {
    validateMove(move);
    const rng = () => ctx.random();
    let next = apply(state, seatOf(ctx, playerId), move, rng);
    next = startTurnChecks(next, rng);
    if (next.phase === "over") return { state: next, turn: null, payouts: payouts(next.winners, ctx) };
    return { state: next, turn: [ctx.players[next.to_move].id] };
  },

  computerMove(state, playerId, ctx) { return chooseMove(state, seatOf(ctx, playerId)); },

  randomMove(state, playerId, ctx) {
    const seat = seatOf(ctx, playerId);
    if (state.phase === "draw") {
      // Mostly the stock: taking the pile does not use up the stock, so deals would drag on.
      if (!state.stock.length || (state.discard.length && ctx.random() < 0.05)) return { draw: "discard" };
      return { draw: "stock" };
    }
    if (ctx.random() < 0.3) {
      const lay = chooseLay(state, seat);
      if (lay) return lay;
    }
    const hand = split(state.hands[seat]);
    const legal = hand.filter((c) => { try { apply(state, seat, { discard: c }, () => 0.5); return true; } catch (e) { return false; } });
    return { discard: (legal.length ? legal : hand)[Math.floor(ctx.random() * (legal.length || hand.length))] };
  },

  viewFor(state, playerId, ctx) {
    const seat = playerId === null ? -1 : seatOf(ctx, playerId);
    const mine = seat >= 0 && seat === state.to_move && state.phase !== "over";
    const hand = seat >= 0 ? split(state.hands[seat]) : [];
    return {
      deal_no: state.deal_no, max_deals: MAX_DEALS, target: TARGET, dealer: state.dealer, to_move: state.to_move, phase: state.phase,
      hand: seat >= 0 ? state.hands[seat] : "",
      hand_counts: state.hands.map((h) => h.length / 2),
      melds: state.melds.map((list) => list.map((m) => {
        const cards = split(m.cards);
        const info = analyze(cards);
        return { cards: m.cards, kind: m.kind, size: cards.length, clean: info.clean, canasta: cards.length >= 7 };
      })),
      discard: state.discard, stock_count: state.stock.length / 2, pots_left: state.pots.length,
      took_pot: state.took_pot, opened: state.opened, scores: state.scores,
      minimum: state.scores.map(minimumFor),
      may_go_out: seat >= 0 ? mayEmpty(state, seat) : false,
      drew: state.drew, last_deal: state.last_deal, winners: state.winners,
      my_seat: seat >= 0 ? seat : null,
      my_turn: mine,
      hand_value: sum(hand),
    };
  },
};
