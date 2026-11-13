"use strict";

function payouts(ctx, winner) {
  const humans = ctx.players.filter(player => player.kind === "human");
  const winnerIsHuman = humans.some(player => player.id === winner);
  const recipients = winnerIsHuman ? [winner] : humans.map(player => player.id);
  const share = Math.floor(ctx.pot / recipients.length);
  const remainder = ctx.pot % recipients.length;
  return Object.fromEntries(humans.map(player => {
    const index = recipients.indexOf(player.id);
    return [player.id, index < 0 ? 0 : share + (index < remainder ? 1 : 0)];
  }));
}

const game = {
  newMatch(ctx) {
    return {state:{remaining:9, winner:null}, turn:[ctx.players[0].id]};
  },
  applyMove(state, playerId, move, ctx) {
    if (!move || typeof move !== "object" || !Number.isInteger(move.take) ||
        move.take < 1 || move.take > 3 || move.take > state.remaining)
      throw new InvalidMove("Choose one, two, or three stones that remain.");
    const index = ctx.players.findIndex(player => player.id === playerId);
    if (index < 0 || state.winner !== null || state.remaining < 1)
      throw new InvalidMove("This player cannot move.");
    const remaining = state.remaining - move.take;
    if (remaining === 0)
      return {state:{remaining, winner:playerId}, turn:null, payouts:payouts(ctx, playerId)};
    return {state:{remaining, winner:null}, turn:[ctx.players[(index + 1) % ctx.players.length].id]};
  },
  randomMove(state, playerId, ctx) {
    return {take:1 + Math.floor(ctx.random() * Math.min(3, state.remaining))};
  },
  computerMove(state, playerId, ctx) {
    const winning = state.remaining % 4;
    return {take:winning || 1 + Math.floor(ctx.random() * Math.min(3, state.remaining))};
  },
  viewFor(state) {
    return state;
  },
};
