"use strict";

// Frontier Rails: an original game with the mechanics of TransAmerica (Franz-Benno Delonge, 2001).
// Rules: en.wikipedia.org/wiki/TransAmerica_(board_game). Original map: a triangular grid of
// junctions; 35 cities in 5 colored regions of 7 (2 per region are "far" cities, left out with 2-3
// players). Each round every player gets one secret city of each color and places a start marker
// on any junction; then, in turn, each player builds 2 points of track (plains cost 1, mountains
// and rivers 2; unused points are lost) from any track connected to their own start marker,
// including other players' track. The round ends when someone's 5 cities are all connected to
// their marker, or all 84 track pieces are used. Everyone then loses the points it would cost to
// connect their missing cities. All start with 13 points; when a player reaches 0 (or the lowered
// mark below), the player with the most points left wins.
// Choices where the page is silent: the missing-city cost is the cheapest way found by joining
// the nearest missing city first, again and again (built track is free); ties for the most points
// share the win; you may end a turn after building 1 point.

const ROWS = [
  "  ....^^....   ",
  " .....^^.~.... ",
  "......^^..~....",
  "......^...~....",
  ".....^^...~....",
  ".....^^..~.....",
  "......^..~.....",
  " .....^..~.... ",
  " ....^^...~... ",
  "  ...^....~..  ",
  "   ......~.    ",
];
const REGIONS = ["Y", "R", "O", "B", "G"];
// [row, col, far] per region, in the order of REGIONS; city id = region * 7 + index.
const CITY_SPOTS = [
  [[0, 2, 1], [0, 4, 0], [1, 1, 0], [2, 0, 1], [2, 3, 0], [3, 5, 0], [4, 1, 0]],
  [[6, 0, 1], [6, 3, 0], [7, 1, 1], [8, 3, 0], [9, 2, 0], [10, 4, 0], [7, 5, 0]],
  [[1, 8, 1], [3, 8, 0], [4, 7, 0], [5, 8, 0], [7, 8, 0], [9, 7, 0], [10, 6, 1]],
  [[0, 9, 0], [0, 11, 0], [1, 13, 1], [2, 12, 0], [3, 14, 1], [4, 11, 0], [4, 13, 0]],
  [[5, 12, 0], [6, 14, 1], [7, 11, 0], [8, 13, 1], [9, 11, 0], [10, 10, 0], [6, 10, 0]],
];
const COLS = 15, START_SCORE = 13, TRACK_PIECES = 84, POINTS_PER_TURN = 2;

// The map, built the same way in client.html: nodes are r * COLS + c; edges join neighbors.
const IS_NODE = (r, c) => r >= 0 && r < ROWS.length && c >= 0 && c < COLS && ROWS[r][c] !== " ";
const ROUGH = (r, c) => ROWS[r][c] === "^" || ROWS[r][c] === "~";
const EDGES = []; // [a, b, cost]
for (let r = 0; r < ROWS.length; r++) {
  for (let c = 0; c < COLS; c++) {
    if (!IS_NODE(r, c)) continue;
    const below = r % 2 === 0 ? [[r + 1, c - 1], [r + 1, c]] : [[r + 1, c], [r + 1, c + 1]];
    for (const [r2, c2] of [[r, c + 1], ...below]) {
      if (IS_NODE(r2, c2)) EDGES.push([r * COLS + c, r2 * COLS + c2, ROUGH(r, c) || ROUGH(r2, c2) ? 2 : 1]);
    }
  }
}
const ADJ = new Map(); // node -> [[neighbor, edge id]]
EDGES.forEach(([a, b], id) => {
  if (!ADJ.has(a)) ADJ.set(a, []);
  if (!ADJ.has(b)) ADJ.set(b, []);
  ADJ.get(a).push([b, id]);
  ADJ.get(b).push([a, id]);
});
const CITY_NODE = CITY_SPOTS.flatMap((list) => list.map(([r, c]) => r * COLS + c));
const CITY_FAR = CITY_SPOTS.flatMap((list) => list.map((spot) => spot[2] === 1));

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One secret city of each color per player (no far cities with 2-3 players). */
function deal(n, rng) {
  const hands = Array.from({ length: n }, () => []);
  for (let g = 0; g < REGIONS.length; g++) {
    const ids = [0, 1, 2, 3, 4, 5, 6].map((i) => g * 7 + i).filter((id) => n > 3 || !CITY_FAR[id]);
    const order = shuffle(ids, rng);
    for (let p = 0; p < n; p++) hands[p].push(order[p]);
  }
  return hands;
}

function newRound(state, leader, rng) {
  const n = state.scores.length;
  return { ...state, phase: "start", leader, to_move: leader, cities: deal(n, rng), starts: Array(n).fill(null),
           track: [], points_left: POINTS_PER_TURN, built: 0 };
}

/** The nodes joined to [seat]'s start marker by built track (anyone's). */
function network(state, seat) {
  const start = state.starts[seat];
  if (start === null) return new Set();
  const built = new Set(state.track.map((t) => t[0]));
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const v = stack.pop();
    for (const [w, id] of ADJ.get(v) || []) if (built.has(id) && !seen.has(w)) { seen.add(w); stack.push(w); }
  }
  return seen;
}

const complete = (state, seat) => {
  const net = network(state, seat);
  return net.size > 0 && state.cities[seat].every((id) => net.has(CITY_NODE[id]));
};

/** Cheapest cost from any node of [sources] to every node (built track costs 0). */
function costsFrom(state, sources) {
  const built = new Set(state.track.map((t) => t[0]));
  const dist = new Map();
  for (const s of sources) dist.set(s, 0);
  // Costs are only 0, 1 or 2, so a small bucket queue is enough.
  const buckets = [[...sources]];
  for (let d = 0; d < buckets.length; d++) {
    const list = buckets[d] || [];
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (dist.get(v) !== d) continue;
      for (const [w, id] of ADJ.get(v) || []) {
        const nd = d + (built.has(id) ? 0 : EDGES[id][2]);
        if (!dist.has(w) || nd < dist.get(w)) {
          dist.set(w, nd);
          while (buckets.length <= nd) buckets.push([]);
          buckets[nd].push(w); // when nd === d this is [list] itself, so it is still visited
        }
      }
    }
  }
  return dist;
}

/** Points needed to connect [seat]'s missing cities: join the nearest one, then repeat. */
function missingCost(state, seat) {
  const start = state.starts[seat];
  if (start === null) return 0;
  const net = network(state, seat);
  const built = new Set(state.track.map((t) => t[0]));
  let missing = state.cities[seat].map((id) => CITY_NODE[id]).filter((v) => !net.has(v));
  let total = 0;
  const reached = new Set(net);
  while (missing.length) {
    const dist = costsFrom(state, reached);
    let best = missing[0];
    for (const v of missing) if (dist.get(v) < dist.get(best)) best = v;
    total += dist.get(best);
    // Add the path to [best] (walk back along cheapest steps) so later cities can use it.
    let v = best;
    while (!reached.has(v)) {
      reached.add(v);
      let step = null;
      for (const [w, id] of ADJ.get(v)) {
        const cost = built.has(id) ? 0 : EDGES[id][2];
        if (dist.has(w) && dist.get(w) + cost === dist.get(v) && (step === null || reached.has(w))) step = w;
      }
      if (step === null) break;
      v = step;
    }
    missing = missing.filter((m) => m !== best);
  }
  return total;
}

/** The edges [seat] may build now. */
function legalEdges(state, seat) {
  if (state.phase !== "build" || seat !== state.to_move || state.track.length >= TRACK_PIECES) return [];
  const net = network(state, seat);
  const built = new Set(state.track.map((t) => t[0]));
  const out = [];
  for (const v of net) {
    for (const [, id] of ADJ.get(v) || []) {
      if (!built.has(id) && EDGES[id][2] <= state.points_left && !out.includes(id)) out.push(id);
    }
  }
  return out.sort((a, b) => a - b);
}

function nextSeat(state, seat) { return (seat + 1) % state.scores.length; }

function endTurn(state) {
  return { ...state, to_move: nextSeat(state, state.to_move), points_left: POINTS_PER_TURN, built: 0 };
}

/** Scores the round; starts the next one or ends the game. */
function endRound(state, rng) {
  const n = state.scores.length;
  const lost = Array.from({ length: n }, (_, s) => missingCost(state, s));
  const scores = state.scores.map((v, s) => v - lost[s]);
  let threshold = state.threshold;
  // After the second round, if the lowest score is still 4 or more, the game ends 3 points below it.
  if (state.round === 2 && Math.min(...scores) >= 4) threshold = Math.min(...scores) - 3;
  const last_round = { round: state.round, cities: state.cities, starts: state.starts, lost, scores };
  const next = { ...state, scores, threshold, last_round };
  if (Math.min(...scores) <= threshold) {
    const best = Math.max(...scores);
    return { ...next, phase: "over", winners: scores.map((v, s) => (v === best ? s : -1)).filter((s) => s >= 0) };
  }
  return newRound({ ...next, round: state.round + 1 }, nextSeat(state, state.leader), rng);
}

function apply(state, seat, move, rng) {
  if (state.phase === "over") throw new InvalidMove("the game is over");
  if (seat !== state.to_move) throw new InvalidMove("it is not your turn");
  if (state.phase === "start") {
    if (!("start" in move)) throw new InvalidMove("place your start marker first");
    if (!ADJ.has(move.start)) throw new InvalidMove("that is not a junction on the map");
    const starts = state.starts.map((v, s) => (s === seat ? move.start : v));
    const next = { ...state, starts, to_move: nextSeat(state, seat) };
    if (starts.every((v) => v !== null)) return { ...next, phase: "build", to_move: state.leader, points_left: POINTS_PER_TURN, built: 0 };
    return next;
  }
  if ("start" in move) throw new InvalidMove("start markers are already placed");
  if ("end" in move) {
    if (state.built === 0 && legalEdges(state, seat).length > 0) throw new InvalidMove("build at least one track before ending your turn");
    return endTurn(state);
  }
  if (!legalEdges(state, seat).includes(move.edge)) {
    const taken = state.track.some((t) => t[0] === move.edge);
    if (taken) throw new InvalidMove("that track is already built");
    if (EDGES[move.edge] && EDGES[move.edge][2] > state.points_left) throw new InvalidMove("you do not have enough points left for that track");
    throw new InvalidMove("track must join your network");
  }
  let next = { ...state, track: [...state.track, [move.edge, seat]], points_left: state.points_left - EDGES[move.edge][2],
               built: state.built + 1 };
  const done = next.scores.some((_, s) => complete(next, s));
  if (done || next.track.length >= TRACK_PIECES) return endRound(next, rng);
  if (legalEdges(next, seat).length === 0) next = endTurn(next);
  return next;
}

function validateMove(move) {
  const keys = move && typeof move === "object" && !Array.isArray(move) ? Object.keys(move) : [];
  const ok = keys.length === 1 && (
    (keys[0] === "start" && Number.isInteger(move.start)) ||
    (keys[0] === "edge" && Number.isInteger(move.edge) && move.edge >= 0 && move.edge < EDGES.length) ||
    (keys[0] === "end" && move.end === true));
  if (!ok) throw new InvalidMove("send a start junction, a track to build or end your turn");
}

const seatOf = (ctx, playerId) => ctx.players.findIndex((p) => p.id === playerId);

function payouts(winners, ctx) {
  const humans = ctx.players.filter((p) => p.kind === "human");
  if (!humans.length) return {};
  const out = Object.fromEntries(humans.map((h) => [h.id, 0]));
  let takers = winners.map((s) => ctx.players[s]).filter((p) => p.kind === "human");
  if (!takers.length) takers = humans;
  const share = Math.floor(ctx.pot / takers.length);
  takers.forEach((p, i) => { out[p.id] = share + (i < ctx.pot - share * takers.length ? 1 : 0); });
  return out;
}

/** A sensible player: start on its own most central city; build along the cheapest path to the nearest missing city. */
function chooseMove(state, seat) {
  if (state.phase === "start") {
    let best = null, bestCost = Infinity;
    for (const id of state.cities[seat]) {
      const trial = { ...state, starts: state.starts.map((v, s) => (s === seat ? CITY_NODE[id] : v)) };
      const cost = missingCost(trial, seat);
      if (cost < bestCost) { best = CITY_NODE[id]; bestCost = cost; }
    }
    return { start: best };
  }
  const legal = legalEdges(state, seat);
  if (!legal.length) return { end: true };
  const net = network(state, seat);
  const missing = state.cities[seat].map((id) => CITY_NODE[id]).filter((v) => !net.has(v));
  if (missing.length) {
    // Distances back from the missing cities: build the legal edge that gets closest.
    const dist = costsFrom(state, missing);
    let pick = null, pickScore = Infinity;
    for (const id of legal) {
      const [a, b, cost] = EDGES[id];
      const outer = net.has(a) ? b : a;
      const score = (dist.get(outer) ?? 99) + cost;
      if (score < pickScore) { pick = id; pickScore = score; }
    }
    const inner = net.has(EDGES[pick][0]) ? EDGES[pick][0] : EDGES[pick][1];
    if (pickScore <= (dist.get(inner) ?? 99) || state.built === 0) return { edge: pick };
  }
  return state.built === 0 ? { edge: legal[0] } : { end: true };
}

const game = {
  newMatch(ctx) {
    const n = ctx.players.length;
    const base = { round: 1, scores: Array(n).fill(START_SCORE), threshold: 0, last_round: null, winners: null };
    const state = newRound(base, 0, () => ctx.random());
    return { state, turn: [ctx.players[0].id] };
  },

  applyMove(state, playerId, move, ctx) {
    validateMove(move);
    const next = apply(state, seatOf(ctx, playerId), move, () => ctx.random());
    if (next.phase === "over") return { state: next, turn: null, payouts: payouts(next.winners, ctx) };
    return { state: next, turn: [ctx.players[next.to_move].id] };
  },

  computerMove(state, playerId, ctx) { return chooseMove(state, seatOf(ctx, playerId)); },

  randomMove(state, playerId, ctx) {
    const seat = seatOf(ctx, playerId);
    if (state.phase === "start") {
      const nodes = [...ADJ.keys()];
      return { start: nodes[Math.floor(ctx.random() * nodes.length)] };
    }
    const options = legalEdges(state, seat).map((edge) => ({ edge }));
    if (state.built > 0 || !options.length) options.push({ end: true });
    return options[Math.floor(ctx.random() * options.length)];
  },

  viewFor(state, playerId, ctx) {
    const seat = playerId === null ? -1 : seatOf(ctx, playerId);
    const mine = seat >= 0 && seat === state.to_move && state.phase !== "over";
    const net = seat >= 0 ? network(state, seat) : new Set();
    return {
      phase: state.phase, round: state.round, scores: state.scores, threshold: state.threshold,
      leader: state.leader, to_move: state.to_move, points_left: state.points_left, built: state.built,
      // Start markers are placed openly; cities stay secret until the round is scored.
      starts: state.starts, track: state.track, track_left: TRACK_PIECES - state.track.length,
      my_cities: seat >= 0 ? state.cities[seat] : [],
      connected: seat >= 0 ? state.cities[seat].filter((id) => net.has(CITY_NODE[id])) : [],
      legal: mine ? legalEdges(state, seat) : [],
      last_round: state.last_round, winners: state.winners, my_seat: seat >= 0 ? seat : null,
    };
  },
};
