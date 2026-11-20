// Rules for the edge-target games: Sim, Paper Soccer, Hackenbush and Cartographers.
// The generated package prefixes this file with a constant KIND. These games
// offer lines, points and shape placements as explicit targets, never freehand
// input. No rendering, network or device APIs are used.

// ---- Sim: six dots, fifteen edges ----------------------------------------
const SIM_EDGES = (() => {
  const out = [];
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) out.push([a, b]);
  return out;
})();
function simTriangle(edges, seat) {
  const owned = new Set();
  edges.forEach((owner, i) => { if (owner === seat) owned.add(SIM_EDGES[i][0] * 6 + SIM_EDGES[i][1]); });
  for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6; c++) {
    if (owned.has(a * 6 + b) && owned.has(a * 6 + c) && owned.has(b * 6 + c)) return true;
  }
  return false;
}

// ---- Paper Soccer: a 9 by 11 pitch plus one goal point at each end ---------
const SOCCER_W = 9, SOCCER_H = 11, TOP_GOAL = 99, BOTTOM_GOAL = 100, SOCCER_TURNS = 120;
function soccerXY(p) {
  if (p === TOP_GOAL) return [4, -1];
  if (p === BOTTOM_GOAL) return [4, SOCCER_H];
  return [p % SOCCER_W, Math.floor(p / SOCCER_W)];
}
function soccerPoint(x, y) {
  if (x === 4 && y === -1) return TOP_GOAL;
  if (x === 4 && y === SOCCER_H) return BOTTOM_GOAL;
  if (x < 0 || x >= SOCCER_W || y < 0 || y >= SOCCER_H) return -1;
  return y * SOCCER_W + x;
}
function soccerBoundary(p) {
  if (p === TOP_GOAL || p === BOTTOM_GOAL) return false;
  const [x, y] = soccerXY(p);
  return x === 0 || x === SOCCER_W - 1 || y === 0 || y === SOCCER_H - 1;
}
// Pitch lines are already drawn: the sidelines and the goal lines, except the goal mouth.
function soccerWall(a, b) {
  if (a === TOP_GOAL || a === BOTTOM_GOAL || b === TOP_GOAL || b === BOTTOM_GOAL) return false;
  const [ax, ay] = soccerXY(a), [bx, by] = soccerXY(b);
  if (ax === bx && (ax === 0 || ax === SOCCER_W - 1)) return true;
  if (ay === by && (ay === 0 || ay === SOCCER_H - 1)) return !(Math.min(ax, bx) >= 3 && Math.max(ax, bx) <= 5);
  return false;
}
function soccerKey(a, b) { return a < b ? a * 128 + b : b * 128 + a; }
function soccerMoves(s) {
  const [x, y] = soccerXY(s.ball), out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue;
    const to = soccerPoint(x + dx, y + dy);
    if (to < 0 || soccerWall(s.ball, to) || s.used.includes(soccerKey(s.ball, to))) continue;
    // Goal points are reached only straight or diagonally from the goal mouth.
    if (to === TOP_GOAL && y !== 0) continue;
    if (to === BOTTOM_GOAL && y !== SOCCER_H - 1) continue;
    if (s.ball === TOP_GOAL || s.ball === BOTTOM_GOAL) continue;
    out.push({to});
  }
  return out;
}
function soccerTouched(s, p) {
  return soccerBoundary(p) || s.used.some(k => Math.floor(k / 128) === p || k % 128 === p);
}

// ---- Hackenbush: cut your own colour; whatever is cut loose falls away ----
// Geometry shared with the presentation is injected by the generator as GEO.
const HACK_NODES = GEO.hack_nodes, HACK_EDGES = GEO.hack_edges;
const HACK_GROUND = HACK_NODES.flatMap((node, i) => node[1] >= GEO.ground_y ? [i] : []);
function hackPrune(alive) {
  const reach = new Set(HACK_GROUND), grow = [...HACK_GROUND];
  while (grow.length) {
    const node = grow.pop();
    HACK_EDGES.forEach(([a, b], i) => {
      if (!alive[i]) return;
      const other = a === node ? b : b === node ? a : -1;
      if (other >= 0 && !reach.has(other)) { reach.add(other); grow.push(other); }
    });
  }
  HACK_EDGES.forEach(([a, b], i) => { if (alive[i] && !reach.has(a) && !reach.has(b)) alive[i] = 0; });
}

// ---- Cartographers: a small two-player, four-season adaptation -----------
const MAP_N = 7;
const MOUNTAINS = GEO.mountains, SHAPES = GEO.shapes, DECK = GEO.deck;
// Terrain: 0 forest, 1 village, 2 farm, 3 water. A card is [terrain, shape].
const SEASON_RULES = [[0,1],[1,2],[2,3],[3,0]];
function variant(shape, rot) {
  let cells = shape.map(([r, c]) => [r, c]);
  for (let i = 0; i < rot % 4; i++) cells = cells.map(([r, c]) => [c, -r]);
  if (rot >= 4) cells = cells.map(([r, c]) => [r, -c]);
  const minR = Math.min(...cells.map(c => c[0])), minC = Math.min(...cells.map(c => c[1]));
  return cells.map(([r, c]) => [r - minR, c - minC]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
function mapMoves(s) {
  if (s.over) return [];
  const card = s.deck[s.round], shape = SHAPES[card[1]], map = s.maps[s.turn];
  const seen = new Set(), out = [];
  for (let rot = 0; rot < 8; rot++) {
    const cells = variant(shape, rot), key = JSON.stringify(cells);
    if (seen.has(key)) continue;
    seen.add(key);
    for (let r = 0; r < MAP_N; r++) for (let c = 0; c < MAP_N; c++) {
      if (cells.every(([dr, dc]) => r + dr < MAP_N && c + dc < MAP_N && map[(r + dr) * MAP_N + c + dc] === -1)) out.push({cell: r * MAP_N + c, rot});
    }
  }
  return out.length ? out : [{cell: -1, rot: 0}];
}
function seasonScore(map, rule) {
  const at = (r, c) => r >= 0 && c >= 0 && r < MAP_N && c < MAP_N ? map[r * MAP_N + c] : -2;
  let total = 0;
  if (rule === 0) {
    for (let i = 0; i < MAP_N; i++) {
      if (Array.from({length: MAP_N}, (_, j) => at(i, j)).includes(0)) total++;
      if (Array.from({length: MAP_N}, (_, j) => at(j, i)).includes(0)) total++;
    }
  } else if (rule === 1) {
    for (let r = 0; r < MAP_N; r++) for (let c = 0; c < MAP_N; c++) {
      if (at(r, c) === 2 && [[1,0],[-1,0],[0,1],[0,-1]].some(([dr, dc]) => at(r + dr, c + dc) === 3)) total++;
    }
  } else if (rule === 2) {
    const seen = new Set();
    for (let r = 0; r < MAP_N; r++) for (let c = 0; c < MAP_N; c++) {
      if (at(r, c) !== 1 || seen.has(r * MAP_N + c)) continue;
      let size = 0; const todo = [[r, c]]; seen.add(r * MAP_N + c);
      while (todo.length) {
        const [cr, cc] = todo.pop(); size++;
        for (const [dr, dc] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nr = cr + dr, nc = cc + dc;
          if (at(nr, nc) === 1 && !seen.has(nr * MAP_N + nc)) { seen.add(nr * MAP_N + nc); todo.push([nr, nc]); }
        }
      }
      if (size >= 3) total += 3;
    }
  } else {
    for (let i = 0; i < MAP_N; i++) {
      if (Array.from({length: MAP_N}, (_, j) => at(i, j)).every(v => v !== -1)) total += 2;
      if (Array.from({length: MAP_N}, (_, j) => at(j, i)).every(v => v !== -1)) total += 2;
    }
  }
  return total;
}

function fresh(ctx) {
  if (KIND === 'sim') return {edges: Array(15).fill(-1), turn: 0, winner: -1, over: false, turns: 0};
  if (KIND === 'paper_soccer') return {ball: 5 * SOCCER_W + 4, used: [], trail: [5 * SOCCER_W + 4], mover: [], turn: 0, winner: -1, over: false, turns: 0};
  if (KIND === 'hackenbush') return {alive: HACK_EDGES.map(() => 1), turn: 0, winner: -1, over: false, turns: 0};
  const deck = DECK.map(card => card.slice());
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const map = () => Array.from({length: MAP_N * MAP_N}, (_, i) => MOUNTAINS.includes(i) ? 4 : -1);
  return {maps: [map(), map()], deck, round: 0, turn: 0, seasons: [[], []], scores: [0, 0], winner: -1, over: false, turns: 0};
}
function legal(s) {
  if (s.over) return [];
  if (KIND === 'sim') return s.edges.flatMap((owner, edge) => owner === -1 ? [{edge}] : []);
  if (KIND === 'paper_soccer') return soccerMoves(s);
  if (KIND === 'hackenbush') return HACK_EDGES.flatMap(([, , colour], edge) => s.alive[edge] && colour === s.turn ? [{edge}] : []);
  return mapMoves(s);
}
function finish(s, winner) { s.over = true; s.winner = winner; }
function payout(s, ctx) {
  const humans = ctx.players.filter(p => p.kind === 'human' && p.active !== false), winner = ctx.players[s.winner];
  const recipients = winner && winner.kind === 'human' && winner.active !== false ? [winner] : humans;
  const out = {}; if (!recipients.length) return out;
  recipients.forEach((p, i) => out[p.id] = Math.floor(ctx.pot / recipients.length) + (i < ctx.pot % recipients.length ? 1 : 0));
  return out;
}
function apply(s, move) {
  const seat = s.turn; s.turns++;
  if (KIND === 'sim') {
    s.edges[move.edge] = seat;
    if (simTriangle(s.edges, seat)) finish(s, 1 - seat);
    else if (s.edges.every(owner => owner !== -1)) finish(s, -1);
    else s.turn = 1 - seat;
    return;
  }
  if (KIND === 'paper_soccer') {
    const touched = soccerTouched(s, move.to);
    s.used.push(soccerKey(s.ball, move.to));
    s.ball = move.to; s.trail.push(move.to); s.mover.push(seat);
    if (move.to === TOP_GOAL) { finish(s, 0); return; }
    if (move.to === BOTTOM_GOAL) { finish(s, 1); return; }
    if (!touched) s.turn = 1 - seat;
    if (s.turns >= SOCCER_TURNS) { finish(s, -1); return; }
    if (!soccerMoves(s).length) finish(s, 1 - s.turn);
    return;
  }
  if (KIND === 'hackenbush') {
    s.alive[move.edge] = 0; hackPrune(s.alive);
    s.turn = 1 - seat;
    if (!legal(s).length) finish(s, seat);
    return;
  }
  // Cartographers: place the shared card on your own map, then your opponent does.
  const card = s.deck[s.round];
  if (move.cell >= 0) {
    const r = Math.floor(move.cell / MAP_N), c = move.cell % MAP_N;
    variant(SHAPES[card[1]], move.rot).forEach(([dr, dc]) => { s.maps[seat][(r + dr) * MAP_N + c + dc] = card[0]; });
  }
  if (seat === 0) { s.turn = 1; return; }
  s.turn = 0;
  if (s.round % 3 === 2) {
    const season = Math.floor(s.round / 3);
    for (const who of [0, 1]) {
      const points = SEASON_RULES[season].reduce((sum, rule) => sum + seasonScore(s.maps[who], rule), 0);
      s.seasons[who].push(points); s.scores[who] += points;
    }
  }
  s.round++;
  if (s.round >= s.deck.length) finish(s, s.scores[0] === s.scores[1] ? -1 : s.scores[0] > s.scores[1] ? 0 : 1);
}
const game = {
  newMatch(ctx) { return {state: fresh(ctx), turn: [ctx.players[0].id]}; },
  applyMove(state, id, move, ctx) {
    if (state.over || ctx.players[state.turn].id !== id || !move || typeof move !== 'object' || Array.isArray(move)) throw new InvalidMove('Illegal move');
    const options = legal(state), keys = Object.keys(move);
    if (!options.some(m => Object.keys(m).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(m, k) && m[k] === move[k]))) throw new InvalidMove('Illegal move');
    const s = JSON.parse(JSON.stringify(state)); apply(s, move);
    return s.over ? {state: s, turn: null, payouts: payout(s, ctx)} : {state: s, turn: [ctx.players[s.turn].id]};
  },
  viewFor(state, id, ctx) {
    const s = JSON.parse(JSON.stringify(state));
    // Only the active viewer receives interactive affordances; the public board is identical for everyone.
    s.legal = id === ctx.players[state.turn].id && !state.over ? legal(state) : [];
    return s;
  },
  randomMove(s, id, ctx) { const options = legal(s); return options[Math.floor(ctx.random() * options.length)]; },
  computerMove(s, id, ctx) {
    const options = legal(s);
    if (KIND === 'paper_soccer') {
      // Head for the opponent's goal with a little randomness so games finish.
      const goalY = s.turn === 0 ? -1 : SOCCER_H, scored = options.find(m => m.to === (s.turn === 0 ? TOP_GOAL : BOTTOM_GOAL));
      if (scored) return scored;
      const best = Math.min(...options.map(m => Math.abs(soccerXY(m.to)[1] - goalY)));
      const near = options.filter(m => Math.abs(soccerXY(m.to)[1] - goalY) === best && m.to !== (s.turn === 0 ? BOTTOM_GOAL : TOP_GOAL));
      const pool = near.length && ctx.random() < 0.75 ? near : options.filter(m => m.to !== (s.turn === 0 ? BOTTOM_GOAL : TOP_GOAL));
      return (pool.length ? pool : options)[Math.floor(ctx.random() * (pool.length ? pool : options).length)];
    }
    return options[Math.floor(ctx.random() * options.length)];
  }
};
