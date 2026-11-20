import fs from 'node:fs';
import vm from 'node:vm';

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const context = { InvalidMove: class InvalidMove extends Error {} };
vm.createContext(context);
vm.runInContext(`${input.server_code}\nthis.game = game;`, context, { timeout: 3000 });

let random = () => 0.5;
const players = Array.from({length: input.players}, (_, i) => ({
  id: `p${i}`, kind: 'human', display_name: `Player ${i + 1}`, picture_url: '', max_loss: 0, active: true,
}));
const ctx = { players, pot: 10, move_count: 0, random: () => random() };
const seedBase = 1807;
function reseed(seed) {
  let state = (seed >>> 0) || 1;
  random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function otherSeat(seat) { return (seat + 1) % players.length; }

reseed(seedBase);
let result = context.game.newMatch(ctx);
const samples = [];
for (let step = 0; step < 1400 && result.turn; step++) {
  const seat = players.findIndex(player => result.turn.includes(player.id));
  if (seat < 0) throw new Error(`unknown active seat at move ${step}`);
  ctx.move_count = step;
  const seed = seedBase + step;
  const state = clone(result.state);
  const playerID = players[seat].id;
  const otherID = players[otherSeat(seat)].id;
  const viewOfMover = clone(context.game.viewFor(state, playerID, ctx));
  const viewOfOther = clone(context.game.viewFor(state, otherID, ctx));
  reseed(seed);
  const move = clone(context.game.computerMove(state, playerID, ctx));
  if (!move) throw new Error(`computerMove returned no move at move ${step}`);
  reseed(seed);
  const next = context.game.applyMove(state, playerID, move, ctx);
  ctx.move_count = step + 1;
  const afterMover = clone(context.game.viewFor(next.state, playerID, ctx));
  const afterOther = clone(context.game.viewFor(next.state, otherID, ctx));
  samples.push({step, seat, seed, state, move, result: clone(next), viewOfMover, viewOfOther, afterMover, afterOther});
  result = next;
}
if (result.turn !== null) throw new Error(`${input.kind} did not finish within 1400 moves`);
const selected = [samples[0], samples[Math.min(1, samples.length - 1)], samples[samples.length - 1]];
const kinds = ['initial', 'intermediate', 'terminal'];
const cases = selected.map((row, i) => {
  const caseCtx = {players, pot: 10, move_count: row.step, seed: row.seed};
  const item = {
    name: `${kinds[i][0].toUpperCase()}${kinds[i].slice(1)} move`,
    description: `${input.kind} authoritative move example (${kinds[i]})`, kind: kinds[i], ctx: caseCtx,
    state: row.state, player_id: players[row.seat].id, other_player_id: players[otherSeat(row.seat)].id,
    move: row.move, expected_state: row.result.state, expected_turn: row.result.turn,
    view_of_mover: row.viewOfMover, view_of_other: row.viewOfOther,
    expected_view_of_mover: row.afterMover, expected_view_of_other: row.afterOther,
  };
  if (row.result.payouts) item.expected_payouts = row.result.payouts;
  return item;
});
process.stdout.write(JSON.stringify(cases));
