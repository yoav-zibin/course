"use strict";
function warRank(card) { return card % 13 + 2; }
function warSuit(card) { return Math.floor(card / 13); }
function warEligible(state) {
  return state.decks.map((deck, seat) => deck.length ? seat : -1).filter(seat => seat >= 0);
}
function warPayouts(winner, ctx) {
  const humans = (ctx.players || []).filter(p => p.kind === "human" && p.active !== false);
  if (!humans.length) return {};
  const pot = ctx.pot || 0;
  const winnerPlayer = winner === null ? null : ctx.players[winner];
  const recipients = winnerPlayer && winnerPlayer.kind === "human" && winnerPlayer.active !== false ? [winnerPlayer] : humans;
  const result = {};
  recipients.forEach((player, i) => { result[player.id] = Math.floor(pot / recipients.length) + (i < pot % recipients.length ? 1 : 0); });
  return result;
}
function warEnd(state, winner, ctx) {
  state.winner = winner;
  state.turnIdx = 0;
  state.participants = [];
  state.acted = [];
  return {state, turn: null, payouts: warPayouts(winner, ctx)};
}
function warGivePile(state, seat) {
  state.decks[seat].push(...state.pile);
  state.pile = [];
}
function warStartRound(state, ctx) {
  const eligible = warEligible(state);
  if (eligible.length === 1) return warEnd(state, eligible[0], ctx);
  if (!eligible.length) {
    const maximum = Math.max(...state.decks.map(d => d.length));
    const leaders = state.decks.map((d, i) => d.length === maximum ? i : -1).filter(i => i >= 0);
    return warEnd(state, leaders.length === 1 ? leaders[0] : null, ctx);
  }
  state.round++;
  state.stage = "battle";
  state.participants = eligible;
  state.acted = [];
  state.faceUp = state.decks.map(() => null);
  state.turnIdx = eligible[0];
  return {state, turn: [ctx.players[state.turnIdx].id]};
}
function warResolve(state, ctx) {
  const ranks = state.participants.map(seat => ({seat, rank: warRank(state.faceUp[seat])}));
  const high = Math.max(...ranks.map(x => x.rank));
  const leaders = ranks.filter(x => x.rank === high).map(x => x.seat);
  if (leaders.length === 1) {
    warGivePile(state, leaders[0]);
    return warStartRound(state, ctx);
  }
  state.warDepth++;
  state.stage = "war";
  state.participants = leaders;
  state.acted = [];
  state.faceUp = state.decks.map(() => null);
  const able = [];
  for (const seat of leaders) {
    if (state.decks[seat].length >= 2) able.push(seat);
    else state.pile.push(...state.decks[seat].splice(0));
  }
  if (able.length === 1) {
    warGivePile(state, able[0]);
    return warStartRound(state, ctx);
  }
  if (!able.length) return warEnd(state, null, ctx);
  state.participants = able;
  state.turnIdx = able[0];
  return {state, turn: [ctx.players[state.turnIdx].id]};
}
function warFinishPending(state, ctx) {
  if (state.acted.length < state.participants.length) {
    const next = state.participants.find(seat => !state.acted.includes(seat));
    state.turnIdx = next;
    return {state, turn: [ctx.players[next].id]};
  }
  const human = ctx.players.findIndex(player => player.kind === "human" && player.active !== false);
  if (human < 0) return warResolve(state, ctx);
  state.showdownStage = state.stage;
  state.stage = "showdown";
  // In a solo game, give the computer the harmless continue action. The
  // platform's normal computer-turn delay leaves the revealed cards and
  // winner visible before the next battle starts. Pass-and-play stays manual.
  const computer = ctx.players.findIndex(player => player.kind === "computer" && player.active !== false);
  const next = computer >= 0 ? computer : human;
  state.turnIdx = next;
  return {state, turn: [ctx.players[next].id]};
}
const game = {
  newMatch(ctx) {
    const deck = Array.from({length: 52}, (_, card) => card);
    const random = ctx.random;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const decks = (ctx.players || []).map(() => []);
    deck.forEach((card, i) => decks[i % decks.length].push(card));
    const state = {decks, pile: [], faceUp: decks.map(() => null), participants: decks.map((_, i) => i), acted: [], stage: "battle", round: 1, warDepth: 0, turnIdx: 0, winner: null, showdownStage: null};
    return {state, turn: [ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    if (state.winner !== null) throw new InvalidMove("game over");
    const seat = ctx.players.findIndex(p => p.id === playerId);
    if (seat < 0) throw new InvalidMove("not seated");
    if (seat !== state.turnIdx) throw new InvalidMove("not your turn");
    if (state.stage === "showdown") {
      if (!move || typeof move !== "object" || move.continue !== true || Object.keys(move).length !== 1) throw new InvalidMove("bad move");
      const resolved = {decks: state.decks.map(d => d.slice()), pile: state.pile.slice(), faceUp: state.faceUp.slice(), participants: state.participants.slice(), acted: state.acted.slice(), stage: state.showdownStage, round: state.round, warDepth: state.warDepth, turnIdx: state.turnIdx, winner: state.winner, showdownStage: null};
      return warResolve(resolved, ctx);
    }
    if (!move || typeof move !== "object" || move.flip !== true || Object.keys(move).length !== 1) throw new InvalidMove("bad move");
    if (!state.participants.includes(seat) || state.acted.includes(seat)) throw new InvalidMove("not your turn");
    const next = {decks: state.decks.map(d => d.slice()), pile: state.pile.slice(), faceUp: state.faceUp.slice(), participants: state.participants.slice(), acted: state.acted.slice(), stage: state.stage, round: state.round, warDepth: state.warDepth, turnIdx: state.turnIdx, winner: state.winner, showdownStage: state.showdownStage || null};
    const deck = next.decks[seat];
    if (next.stage === "battle") {
      if (!deck.length) throw new InvalidMove("no cards to flip");
      const card = deck.shift(); next.pile.push(card); next.faceUp[seat] = card;
    } else {
      if (deck.length < 2) throw new InvalidMove("not enough cards for war");
      next.pile.push(deck.shift());
      const card = deck.shift(); next.pile.push(card); next.faceUp[seat] = card;
    }
    next.acted.push(seat);
    if ((ctx.move_count || 0) >= 1000) {
      const maximum = Math.max(...next.decks.map(d => d.length));
      const leaders = next.decks.map((d, i) => d.length === maximum ? i : -1).filter(i => i >= 0);
      return warEnd(next, leaders.length === 1 ? leaders[0] : null, ctx);
    }
    return warFinishPending(next, ctx);
  },
  computerMove(state) { return state.stage === "showdown" ? {continue: true} : {flip: true}; },
  randomMove(state) { return state.stage === "showdown" ? {continue: true} : {flip: true}; },
  viewFor(state, playerId, ctx) {
    const seat = ctx.players.findIndex(p => p.id === playerId);
    const legalMoves = state.winner !== null || seat !== state.turnIdx ? [] :
      state.stage === "showdown" ? [{continue: true}] :
      state.participants.includes(seat) && !state.acted.includes(seat) ? [{flip: true}] : [];
    return {counts: state.decks.map(d => d.length), faceUp: state.faceUp.map(card => card === null ? null : {rank: warRank(card), suit: warSuit(card)}), pileCount: state.pile.length, participants: state.participants.slice(), acted: state.acted.slice(), stage: state.stage, showdownStage: state.showdownStage || null, round: state.round, warDepth: state.warDepth, turnIdx: state.turnIdx, winner: state.winner, legalMoves};
  }
};
