"use strict";

// Smugglers' Tide: an original game with the mechanics of Cartagena (Leo Colovini, 2000).
// Rules: en.wikipedia.org/wiki/Cartagena_(board_game). 2-5 players, 6 smugglers each, start
// in the cave; the tunnel is 6 sections of the same 6 symbols, each section in its own order
// (shuffled at the start); 102 cards (17 of each symbol), 6 dealt to each player, the rest a
// face-down draw pile. A turn is 1 to 3 moves. Forward: play a card and move one smuggler to the
// next unoccupied square with that symbol, or into the boat if there is none. Back: move one
// smuggler back to the closest square holding 1 or 2 smugglers and draw 1 or 2 cards (never
// back into the cave). The first player with all 6 smugglers in the boat wins.
// Choices where the page is silent: an empty draw pile is refilled by shuffling the discards;
// a smuggler with no such square behind it cannot move back; the boat has no limit; a player
// who can make no move at all (no cards and no smuggler able to move back) passes and draws
// 1 card, so the game can never freeze.

const SYMBOLS = ["A", "C", "L", "S", "T", "W"]; // anchor, compass, lantern, shell, star, wave
const SQUARES = 36;
const CAVE = -1, BOAT = SQUARES;
const PIECES = 6, HAND = 6, MAX_ACTIONS = 3;

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sortHand = (hand) => [...hand].sort((x, y) => SYMBOLS.indexOf(x) - SYMBOLS.indexOf(y));

function newState(n, rng) {
  const track = [];
  for (let s = 0; s < 6; s++) track.push(...shuffle(SYMBOLS, rng));
  let deck = shuffle(SYMBOLS.flatMap((s) => Array(17).fill(s)), rng);
  const hands = [];
  for (let p = 0; p < n; p++) { hands.push(sortHand(deck.slice(0, HAND))); deck = deck.slice(HAND); }
  return {
    track, pieces: Array.from({ length: n }, () => Array(PIECES).fill(CAVE)), hands, deck, discard: [],
    to_move: 0, actions: 0, winner: null, last: [],
  };
}

const occupants = (state, square) => state.pieces.reduce((n, list) => n + list.filter((p) => p === square).length, 0);

/** Where a forward move with [card] from [from] lands: the next unoccupied square with that symbol, else the boat. */
function forwardTarget(state, from, card) {
  for (let q = from + 1; q < SQUARES; q++) if (state.track[q] === card && occupants(state, q) === 0) return q;
  return BOAT;
}

/** Where a backward move from [from] lands (closest square behind with 1 or 2 smugglers), or null. */
function backTarget(state, from) {
  if (from <= 0 || from >= BOAT) return null;
  for (let q = from - 1; q >= 0; q--) {
    const n = occupants(state, q);
    if (n === 1 || n === 2) return q;
  }
  return null;
}

/** Every legal move for the player to move (pieces on the same square are interchangeable). */
function legalMoves(state) {
  if (state.winner !== null) return [];
  const seat = state.to_move;
  const froms = [...new Set(state.pieces[seat].filter((p) => p !== BOAT))].sort((a, b) => a - b);
  const moves = [];
  if (state.actions < MAX_ACTIONS) {
    const cards = [...new Set(state.hands[seat])];
    for (const from of froms) {
      for (const card of cards) moves.push({ kind: "forward", from, card, to: forwardTarget(state, from, card) });
      const back = backTarget(state, from);
      if (back !== null) moves.push({ kind: "back", from, to: back, draw: occupants(state, back) });
    }
  }
  if (state.actions > 0 || moves.length === 0) moves.push({ kind: "end" });
  return moves;
}

function draw(state, count, rng) {
  let deck = state.deck, discard = state.discard;
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (!deck.length && discard.length) { deck = shuffle(discard, rng); discard = []; }
    if (!deck.length) break;
    drawn.push(deck[0]);
    deck = deck.slice(1);
  }
  return { drawn, deck, discard };
}

function endTurn(state) {
  return { ...state, to_move: (state.to_move + 1) % state.pieces.length, actions: 0, last: [] };
}

function apply(state, move, rng) {
  if (state.winner !== null) throw new InvalidMove("the game is over");
  const seat = state.to_move;
  if (move.kind === "end") {
    if (state.actions === 0 && legalMoves(state).length > 1) throw new InvalidMove("make at least one move before ending your turn");
    if (state.actions === 0) {
      // A pass: nothing else was possible, so the player draws 1 card.
      const got = draw(state, 1, rng);
      const hands = state.hands.map((h, s) => (s === seat ? sortHand([...h, ...got.drawn]) : h));
      return endTurn({ ...state, hands, deck: got.deck, discard: got.discard });
    }
    return endTurn(state);
  }
  if (state.actions >= MAX_ACTIONS) throw new InvalidMove("you have used all three moves");
  const pieceAt = state.pieces[seat].indexOf(move.from);
  if (move.from === BOAT || pieceAt < 0) throw new InvalidMove("you have no smuggler there");
  let next;
  if (move.kind === "forward") {
    const hand = state.hands[seat];
    const c = hand.indexOf(move.card);
    if (c < 0) throw new InvalidMove("you do not have that card");
    const to = forwardTarget(state, move.from, move.card);
    const hands = state.hands.map((h, s) => (s === seat ? h.filter((_, i) => i !== c) : h));
    const pieces = state.pieces.map((list, s) => (s === seat ? list.map((p, i) => (i === pieceAt ? to : p)).sort((a, b) => a - b) : list));
    next = { ...state, hands, pieces, discard: [...state.discard, move.card],
             last: [...state.last, { seat, kind: "forward", from: move.from, to, card: move.card }] };
  } else {
    const to = backTarget(state, move.from);
    if (to === null) throw new InvalidMove("there is no square to move back to");
    const got = draw(state, occupants(state, to), rng);
    const hands = state.hands.map((h, s) => (s === seat ? sortHand([...h, ...got.drawn]) : h));
    const pieces = state.pieces.map((list, s) => (s === seat ? list.map((p, i) => (i === pieceAt ? to : p)).sort((a, b) => a - b) : list));
    next = { ...state, hands, pieces, deck: got.deck, discard: got.discard,
             last: [...state.last, { seat, kind: "back", from: move.from, to, card: null }] };
  }
  next.actions = state.actions + 1;
  if (next.pieces[seat].every((p) => p === BOAT)) return { ...next, winner: seat };
  if (next.actions >= MAX_ACTIONS) return endTurn(next);
  return next;
}

function validateMove(move) {
  const ok = move && typeof move === "object" && !Array.isArray(move) && (
    (move.kind === "end" && Object.keys(move).length === 1) ||
    (move.kind === "back" && Object.keys(move).length === 2 && Number.isInteger(move.from)) ||
    (move.kind === "forward" && Object.keys(move).length === 3 && Number.isInteger(move.from) && SYMBOLS.includes(move.card)));
  if (!ok) throw new InvalidMove("send a forward move, a back move or end your turn");
}

function seatOf(ctx, playerId) { return ctx.players.findIndex((p) => p.id === playerId); }

function endPayouts(winner, ctx) {
  const humans = ctx.players.filter((p) => p.kind === "human");
  if (!humans.length) return {};
  const payouts = Object.fromEntries(humans.map((h) => [h.id, 0]));
  const champion = ctx.players[winner];
  if (champion && champion.kind === "human") { payouts[champion.id] = ctx.pot; return payouts; }
  const share = Math.floor(ctx.pot / humans.length);
  humans.forEach((h, i) => { payouts[h.id] = share + (i < ctx.pot - share * humans.length ? 1 : 0); });
  return payouts;
}

/** A greedy player: big jumps for the hindmost smugglers; moves back to refill a small hand. */
function chooseMove(state) {
  const moves = legalMoves(state);
  const hand = state.hands[state.to_move];
  let best = moves[moves.length - 1], bestScore = 0.5; // ending the turn scores 0.5
  for (const m of moves) {
    let score;
    if (m.kind === "forward") score = (m.to - m.from) + (m.from === CAVE ? 3 : 0) - (hand.length <= 1 ? 4 : 0);
    else if (m.kind === "back") score = hand.length <= 1 || m.draw === 2 ? m.draw * 3 - (m.from - m.to) + (hand.length <= 1 ? 6 : 0) : -1;
    else continue;
    if (score > bestScore) { best = m; bestScore = score; }
  }
  if (best.kind === "end" && state.actions === 0) best = moves[0];
  return best.kind === "forward" ? { kind: "forward", from: best.from, card: best.card }
    : best.kind === "back" ? { kind: "back", from: best.from } : { kind: "end" };
}

const toMove = (m) => (m.kind === "forward" ? { kind: "forward", from: m.from, card: m.card } : m.kind === "back" ? { kind: "back", from: m.from } : { kind: "end" });

const game = {
  newMatch(ctx) {
    const state = newState(ctx.players.length, () => ctx.random());
    return { state, turn: [ctx.players[0].id] };
  },

  applyMove(state, playerId, move, ctx) {
    validateMove(move);
    if (state.winner !== null) throw new InvalidMove("the game is over");
    if (seatOf(ctx, playerId) !== state.to_move) throw new InvalidMove("it is not your turn");
    const next = apply(state, move, () => ctx.random());
    if (next.winner !== null) return { state: next, turn: null, payouts: endPayouts(next.winner, ctx) };
    return { state: next, turn: [ctx.players[next.to_move].id] };
  },

  computerMove(state, playerId, ctx) { return chooseMove(state); },

  randomMove(state, playerId, ctx) {
    const moves = legalMoves(state);
    return toMove(moves[Math.floor(ctx.random() * moves.length)]);
  },

  viewFor(state, playerId, ctx) {
    const seat = playerId === null ? -1 : seatOf(ctx, playerId);
    const mine = seat >= 0 && seat === state.to_move && state.winner === null;
    return {
      track: state.track, pieces: state.pieces,
      hand: seat >= 0 ? state.hands[seat] : [],
      hand_counts: state.hands.map((h) => h.length),
      deck_count: state.deck.length, discard_count: state.discard.length,
      to_move: state.to_move, actions: state.actions, winner: state.winner, last: state.last,
      my_seat: seat >= 0 ? seat : null,
      moves: mine ? legalMoves(state) : [],
    };
  },
};
