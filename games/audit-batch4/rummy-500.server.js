// Rummy 500 — server-side (v2) conversion of the client-only game.
// Same rules as the original (simplified: no out-of-turn Rummy
// calls): 1 deck for up to 5 players, 2 decks beyond; 13 cards for
// two players, 7 otherwise; draw from the stock or take a suffix of
// the discard pile — taking exactly the top card bans it from being
// discarded that turn, taking deeper makes the deepest taken card
// "pending" (it must be melded or laid off before discarding).
// Melds are sets and ace-low runs, jokers wild. A round ends when a
// player goes out or the stock runs dry; round score is meld points
// minus the value of cards left in hand; first to a unique 500 wins.
// Cards are {id, r, s}: r 1..13 (ace=1) or 0 for a joker, s in
// S/H/D/C or "J". Ids are deterministic ("<deck>-<suit><rank>").
function buildDeck(deckIdx) {
  const cards = [];
  for (const s of ["S", "H", "D", "C"])
    for (let r = 1; r <= 13; r++)
      cards.push({ id: deckIdx + "-" + s + r, r, s });
  cards.push({ id: deckIdx + "-J1", r: 0, s: "J" });
  cards.push({ id: deckIdx + "-J2", r: 0, s: "J" });
  return cards;
}
function shuffledDeck(n, random) {
  let cards = [];
  const decks = n > 5 ? 2 : 1;
  for (let d = 0; d < decks; d++) cards = cards.concat(buildDeck(d));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function cardPoints(card, inHand) {
  if (card.r === 0) return 15;
  if (card.r === 1) return 15;
  if (card.r >= 10) return 10;
  return card.r;
}
function isValidMeld(cards) {
  if (!cards || cards.length < 3) return false;
  const naturals = cards.filter((c) => c.r !== 0);
  if (!naturals.length) return true; // an all-joker meld, as the original allows
  // Set: all naturals share a rank.
  if (naturals.every((c) => c.r === naturals[0].r)) return true;
  // Run: same suit, distinct ranks, ace low only, and the natural
  // span must fit the meld size (jokers fill the gaps).
  if (naturals.length < 2) return false;
  if (!naturals.every((c) => c.s === naturals[0].s)) return false;
  const ranks = naturals.map((c) => c.r);
  if (new Set(ranks).size !== ranks.length) return false;
  const span = Math.max(...ranks) - Math.min(...ranks) + 1;
  return span <= cards.length;
}
// Exact bounded search under isValidMeld: rank sets, then every ace-low
// suit interval. Keep one natural of each rank; jokers fill any holes.
// Unlike the bot's capped subset search, this also covers longer melds.
function requiredMeld(hand, requiredId) {
  const required = hand.find(c => c.id === requiredId);
  if (!required) return null;
  const wild = hand.filter(c => c.r === 0);
  if (required.r === 0 && wild.length >= 3) return wild;
  for (let rank = 1; rank <= 13; rank++) {
    if (required.r !== 0 && required.r !== rank) continue;
    const cards = hand.filter(c => c.r === rank).concat(wild);
    if (cards.length >= 3 && isValidMeld(cards)) return cards;
  }
  for (const suit of ["S", "H", "D", "C"]) {
    if (required.r !== 0 && required.s !== suit) continue;
    const byRank = new Map();
    for (const card of hand) if (card.r !== 0 && card.s === suit) byRank.set(card.r, card);
    if (required.r !== 0) byRank.set(required.r, required);
    for (let low = 1; low <= 13; low++) {
      const naturals = [];
      for (let high = low; high <= 13; high++) {
        if (byRank.has(high)) naturals.push(byRank.get(high));
        if (naturals.length < 2 || (required.r !== 0 && (required.r < low || required.r > high))) continue;
        const cards = naturals.concat(wild);
        if (cards.length >= 3 && isValidMeld(cards)) return cards;
      }
    }
  }
  return null;
}
function canUseRequiredCard(hand, melds, requiredId) {
  const card = hand.find(c => c.id === requiredId);
  if (!card) return false;
  if (melds.some(m => isValidMeld(m.cards.concat(m.exts.map(e => e.card), [card])))) return true;
  return requiredMeld(hand, requiredId) !== null;
}

function meldAceLow(meld) {
  // The original's rule: a meld whose natural cards include both an
  // ace and a 2 scores its aces as 1 instead of 15.
  const rs = meld.cards
    .concat(meld.exts.map((e) => e.card))
    .filter((c) => c.r !== 0)
    .map((c) => c.r);
  return rs.includes(1) && rs.includes(2);
}
function dealRound(n, dealer, random) {
  const deck = shuffledDeck(n, random);
  const handSize = n === 2 ? 13 : 7;
  const hands = Array.from({ length: n }, () => []);
  let cur = (dealer + 1) % n;
  for (let k = 0; k < handSize; k++)
    for (let i = 0; i < n; i++) {
      hands[cur].push(deck.pop());
      cur = (cur + 1) % n;
    }
  const discard = [deck.pop()];
  return { hands, deck, discard };
}
function freshMelds() {
  return [];
}
function scoreRound(state) {
  // The meld's owner scores the meld's own cards; each laid-off card
  // scores for the player who laid it off (as in the original).
  const n = state.hands.length;
  const roundScores = new Array(n).fill(0);
  for (const meld of state.melds) {
    const low = meldAceLow(meld);
    for (const c of meld.cards)
      roundScores[meld.owner] += c.r === 1 && low ? 1 : cardPoints(c);
    for (const ext of meld.exts)
      roundScores[ext.by] += ext.card.r === 1 && low ? 1 : cardPoints(ext.card);
  }
  for (let i = 0; i < n; i++)
    for (const c of state.hands[i]) roundScores[i] -= cardPoints(c, true);
  return roundScores;
}
function endRound(state, reason) {
  const roundScores = scoreRound(state);
  const scores = state.scores.map((s, i) => s + roundScores[i]);
  const top = Math.max(...scores);
  let winner = null;
  if (top >= 500) {
    const leaders = scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0);
    if (leaders.length === 1) winner = leaders[0];
  }
  return Object.assign({}, state, {
    phase: "roundOver",
    scores,
    roundScores,
    endReason: reason,
    matchWinner: winner,
    pending: null,
    ban: null,
    log:
      (reason === "went out" ? "A player went out!" : "Stock closed the round.") +
      " Scores: " +
      scores.join(", ") +
      ".",
  });
}
function cStr(c) {
  if (c.r === 0) return "JOKER";
  const r = c.r === 1 ? "A" : c.r === 11 ? "J" : c.r === 12 ? "Q" : c.r === 13 ? "K" : "" + c.r;
  return r + { S: "♠", H: "♥", D: "♦", C: "♣" }[c.s];
}
function handOf(state, seat) {
  return state.hands[seat];
}
function findCard(hand, id) {
  return hand.findIndex((c) => c.id === id);
}
// Subset search helpers for the computer/random players.
function subsetsOfSize(arr, k, limit) {
  const out = [];
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    out.push(idx.map((i) => arr[i]));
    if (out.length >= limit) break;
    let i = k - 1;
    while (i >= 0 && idx[i] === arr.length - k + i) i--;
    if (i < 0) break;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
  return out;
}
function findMeldIn(hand, mustIncludeId) {
  for (const k of [3, 4, 5]) {
    for (const sub of subsetsOfSize(hand, Math.min(k, hand.length), 4000)) {
      if (sub.length < 3) continue;
      if (mustIncludeId && !sub.some((c) => c.id === mustIncludeId)) continue;
      if (isValidMeld(sub)) return sub;
    }
    if (hand.length <= k) break;
  }
  return null;
}
function meldAllCards(meld) {
  return meld.cards.concat(meld.exts.map((e) => e.card));
}
function findLayoff(hand, melds, mustId) {
  for (const card of hand) {
    if (mustId && card.id !== mustId) continue;
    for (const meld of melds) {
      if (isValidMeld(meldAllCards(meld).concat([card])))
        return { card_id: card.id, meld_id: meld.id };
    }
    if (mustId) break;
  }
  return null;
}
function payoutsAll(ctx, winnerSeat) {
  const humans = ctx.players.filter((p) => p.kind === "human");
  const out = {};
  for (const h of humans) out[h.id] = 0;
  if (!humans.length || ctx.pot <= 0) return out;
  const winner = winnerSeat >= 0 ? ctx.players[winnerSeat] : null;
  if (winner && winner.kind === "human") {
    out[winner.id] = ctx.pot;
    return out;
  }
  const share = Math.floor(ctx.pot / humans.length);
  let rem = ctx.pot - share * humans.length;
  for (const h of humans) {
    out[h.id] = share + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return out;
}
function finishIfOut(state, seat) {
  if (state.hands[seat].length === 0 && state.phase === "play")
    return endRound(state, "went out");
  return state;
}
function actorOf(state) {
  return state.actor;
}
function clone(state) {
  return JSON.parse(JSON.stringify(state));
}

const game = {
  newMatch(ctx) {
    const n = ctx.players.length;
    const dealer = 0;
    const { hands, deck, discard } = dealRound(n, dealer, ctx.random);
    const state = {
      v: 2,
      roundNum: 1,
      dealer,
      actor: (dealer + 1) % n,
      scores: new Array(n).fill(0),
      hands,
      deck,
      discard,
      melds: freshMelds(),
      meldSeq: 0,
      phase: "draw",
      pending: null,
      ban: null,
      log: "Round 1 dealt. " + cStr(discard[0]) + " up.",
      roundScores: null,
      matchWinner: null,
      endReason: null,
    };
    return { state, turn: [ctx.players[state.actor].id] };
  },

  applyMove(state, playerId, move, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    if (seat < 0) throw new InvalidMove("unknown player");
    if (!move || typeof move.type !== "string") throw new InvalidMove("bad move");

    if (state.phase === "roundOver") {
      if (move.type !== "next_round") throw new InvalidMove("the round is over");
      if (state.matchWinner !== null) throw new InvalidMove("the match is over");
      const first = (state.dealer + 1) % ctx.players.length;
      // dealer rotates each round; the next round's dealer is the
      // following seat, and play starts after them.
      const dealer = (state.dealer + 1) % ctx.players.length;
      const dealt = dealRound(ctx.players.length, dealer, ctx.random);
      const next = Object.assign({}, state, {
        roundNum: state.roundNum + 1,
        dealer,
        actor: (dealer + 1) % ctx.players.length,
        hands: dealt.hands,
        deck: dealt.deck,
        discard: dealt.discard,
        melds: freshMelds(),
        meldSeq: 0,
        phase: "draw",
        pending: null,
        ban: null,
        log: "Round " + (state.roundNum + 1) + " dealt. " + cStr(dealt.discard[0]) + " up.",
        roundScores: null,
        endReason: null,
      });
      void first;
      return { state: next, turn: [ctx.players[next.actor].id] };
    }

    if (seat !== state.actor) throw new InvalidMove("not your turn");
    const s = clone(state);
    const hand = handOf(s, seat);

    const name = ctx.players[seat].display_name;
    if (s.phase === "draw") {
      if (move.type === "draw_stock") {
        if (!s.deck.length) throw new InvalidMove("the stock is empty");
        hand.push(s.deck.pop());
        s.phase = "play";
        s.log = name + " drew from stock.";
        return { state: s, turn: [playerId] };
      }
      if (move.type === "draw_discard") {
        const i = move.index;
        if (!Number.isInteger(i) || i < 0 || i >= s.discard.length)
          throw new InvalidMove("no such discard");
        const suffix = s.discard.slice(i);
        if (suffix.length > 1 && !canUseRequiredCard(hand.concat(suffix), s.melds, suffix[0].id))
          throw new InvalidMove("the deepest discard must be meldable or laid off");
        const taken = s.discard.splice(i);
        for (const c of taken) hand.push(c);
        if (taken.length === 1) {
          s.ban = taken[0].id;
          s.log = name + " took " + cStr(taken[0]) + " from discard.";
        } else {
          s.pending = { cardId: taken[0].id };
          s.log = name + " took " + taken.length + " cards deep (" + cStr(taken[0]) + " must be melded).";
        }
        s.phase = "play";
        return { state: s, turn: [playerId] };
      }
      if (move.type === "end_round") {
        if (s.deck.length) throw new InvalidMove("the stock is not empty");
        const ended = endRound(s, "stock exhausted");
        if (ended.matchWinner !== null)
          return { state: ended, turn: null, payouts: payoutsAll(ctx, ended.matchWinner) };
        const nextFirst = (ended.dealer + 2) % ctx.players.length;
        return { state: ended, turn: [ctx.players[nextFirst].id] };
      }
      throw new InvalidMove("draw first");
    }

    // phase === "play"
    if (move.type === "meld") {
      const ids = move.card_ids;
      if (!Array.isArray(ids) || ids.length < 3) throw new InvalidMove("a meld needs at least 3 cards");
      const cards = [];
      for (const id of ids) {
        const at = findCard(hand, id);
        if (at < 0) throw new InvalidMove("card not in hand");
        cards.push(hand[at]);
      }
      if (new Set(ids).size !== ids.length) throw new InvalidMove("duplicate card");
      if (!isValidMeld(cards)) throw new InvalidMove("not a valid meld");
      for (const id of ids) hand.splice(findCard(hand, id), 1);
      s.meldSeq += 1;
      s.melds.push({ id: "m" + s.meldSeq, owner: seat, cards, exts: [] });
      s.log = name + " melded " + cards.map(cStr).join(" ") + ".";
      if (s.pending && !hand.some((c) => c.id === s.pending.cardId)) s.pending = null;
      const after = finishIfOut(s, seat);
      if (after.phase === "roundOver") {
        if (after.matchWinner !== null)
          return { state: after, turn: null, payouts: payoutsAll(ctx, after.matchWinner) };
        const nextFirst = (after.dealer + 2) % ctx.players.length;
        return { state: after, turn: [ctx.players[nextFirst].id] };
      }
      return { state: after, turn: [playerId] };
    }
    if (move.type === "layoff") {
      const at = findCard(hand, move.card_id);
      if (at < 0) throw new InvalidMove("card not in hand");
      const meld = s.melds.find((m) => m.id === move.meld_id);
      if (!meld) throw new InvalidMove("no such meld");
      const card = hand[at];
      if (!isValidMeld(meldAllCards(meld).concat([card])))
        throw new InvalidMove("that card does not extend the meld");
      hand.splice(at, 1);
      meld.exts.push({ by: seat, card });
      s.log = name + " laid off " + cStr(card) + " on meld " + meld.id + ".";
      if (s.pending && s.pending.cardId === card.id) s.pending = null;
      const after = finishIfOut(s, seat);
      if (after.phase === "roundOver") {
        if (after.matchWinner !== null)
          return { state: after, turn: null, payouts: payoutsAll(ctx, after.matchWinner) };
        const nextFirst = (after.dealer + 2) % ctx.players.length;
        return { state: after, turn: [ctx.players[nextFirst].id] };
      }
      return { state: after, turn: [playerId] };
    }
    if (move.type === "discard") {
      if (s.pending) throw new InvalidMove("the pending card must be melded or laid off first");
      const at = findCard(hand, move.card_id);
      if (at < 0) throw new InvalidMove("card not in hand");
      const card = hand[at];
      if (s.ban === card.id && hand.length > 1)
        throw new InvalidMove("that card was just picked up and cannot be discarded this turn");
      hand.splice(at, 1);
      s.discard.push(card);
      s.ban = null;
      s.log = name + " discarded " + cStr(card) + ".";
      if (!hand.length) {
        const ended = endRound(s, "went out");
        if (ended.matchWinner !== null)
          return { state: ended, turn: null, payouts: payoutsAll(ctx, ended.matchWinner) };
        const nextFirst = (ended.dealer + 2) % ctx.players.length;
        return { state: ended, turn: [ctx.players[nextFirst].id] };
      }
      s.actor = (seat + 1) % ctx.players.length;
      s.phase = "draw";
      return { state: s, turn: [ctx.players[s.actor].id] };
    }
    throw new InvalidMove("unknown move");
  },

  computerMove(state, playerId, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    if (state.phase === "roundOver") return { type: "next_round" };
    const hand = state.hands[seat];
    if (state.phase === "draw") {
      if (!state.deck.length) return { type: "end_round" };
      // Take from the discard only when it clearly helps: the top
      // card completes a meld or lays off, or a deeper card (which
      // becomes pending) is immediately placeable.
      const top = state.discard[state.discard.length - 1];
      if (top) {
        if (findLayoff(hand.concat([top]), state.melds, null) || findMeldIn(hand.concat([top]), top.id))
          return { type: "draw_discard", index: state.discard.length - 1 };
        for (let i = state.discard.length - 2; i >= 0; i--) {
          const deep = state.discard[i];
          if (canUseRequiredCard(hand.concat(state.discard.slice(i)), state.melds, deep.id))
            return { type: "draw_discard", index: i };
        }
      }
      return { type: "draw_stock" };
    }
    // play phase
    if (state.pending) {
      const meld = requiredMeld(hand, state.pending.cardId);
      if (meld) return { type: "meld", card_ids: meld.map((c) => c.id) };
      const lay = findLayoff(hand, state.melds, state.pending.cardId);
      if (lay) return { type: "layoff", card_id: lay.card_id, meld_id: lay.meld_id };
      // Should not happen (the draw rule only deep-takes placeable
      // cards); fall through to a meld that frees the pending card.
    }
    const meld = findMeldIn(hand, null);
    if (meld) return { type: "meld", card_ids: meld.map((c) => c.id) };
    const lay = findLayoff(hand, state.melds, null);
    if (lay) return { type: "layoff", card_id: lay.card_id, meld_id: lay.meld_id };
    // Discard the most expensive card that may be discarded.
    let best = null;
    for (const c of hand) {
      if (state.ban === c.id && hand.length > 1) continue;
      if (!best || cardPoints(c) > cardPoints(best)) best = c;
    }
    if (!best) best = hand[0];
    return { type: "discard", card_id: best.id };
  },

  randomMove(state, playerId, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    if (state.phase === "roundOver") return { type: "next_round" };
    const hand = state.hands[seat];
    if (state.phase === "draw") {
      if (!state.deck.length) return { type: "end_round" };
      // Only ever the top discard (never a deep, pending-creating
      // take), and only sometimes.
      if (state.discard.length && ctx.random() < 0.3)
        return { type: "draw_discard", index: state.discard.length - 1 };
      return { type: "draw_stock" };
    }
    if (state.pending) {
      const meld = requiredMeld(hand, state.pending.cardId);
      if (meld) return { type: "meld", card_ids: meld.map((c) => c.id) };
      const lay = findLayoff(hand, state.melds, state.pending.cardId);
      if (lay) return { type: "layoff", card_id: lay.card_id, meld_id: lay.meld_id };
    }
    if (ctx.random() < 0.7) {
      const meld = findMeldIn(hand, null);
      if (meld) return { type: "meld", card_ids: meld.map((c) => c.id) };
      const lay = findLayoff(hand, state.melds, null);
      if (lay) return { type: "layoff", card_id: lay.card_id, meld_id: lay.meld_id };
    }
    const legal = hand.filter((c) => !(state.ban === c.id && hand.length > 1));
    const pick = (legal.length ? legal : hand)[Math.floor(ctx.random() * (legal.length ? legal.length : hand.length))];
    return { type: "discard", card_id: pick.id };
  },

  playerLeft(state, playerId, ctx) {
    // The seat's hand, melds and score stay — a computer takes over.
    // The leaver's payout follows their share of the positive scores.
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    const humans = ctx.players.filter((p) => p.kind === "human");
    let payout = 0;
    if (ctx.pot > 0 && seat >= 0) {
      const positives = state.scores.map((s) => Math.max(0, s));
      const total = positives.reduce((a, b) => a + b, 0);
      if (total > 0) payout = Math.floor((ctx.pot * positives[seat]) / total);
      else if (humans.length) payout = Math.floor(ctx.pot / humans.length);
    }
    // The seat stays in the match (a computer takes it over and the
    // platform remaps the occupant), so the turn is unchanged: the
    // current actor mid-round, or the next round's first player
    // while a round is over. The platform ends the match itself when
    // too few humans remain.
    const turn =
      state.phase === "roundOver"
        ? [ctx.players[(state.dealer + 2) % ctx.players.length].id]
        : [ctx.players[state.actor].id];
    return { state, turn, payout };
  },

  viewFor(state, playerId, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    const isActor = seat === state.actor && state.phase !== "roundOver";
    return {
      roundNum: state.roundNum,
      dealer: state.dealer,
      current: state.actor,
      phase: state.phase,
      scores: state.scores,
      hand: seat >= 0 ? state.hands[seat] : [],
      counts: state.hands.map((h) => h.length),
      deckCount: state.deck.length,
      discard: state.discard,
      melds: state.melds,
      pending: isActor && state.pending ? state.pending.cardId : null,
      ban: isActor ? state.ban : null,
      roundScores: state.roundScores,
      matchWinner: state.matchWinner,
      endReason: state.endReason,
      log: state.log,
    };
  },
};
