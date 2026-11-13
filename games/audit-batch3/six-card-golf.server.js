const game = {
  newMatch(ctx) {
    const N = ctx.players.length;
    let deck = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ r, s });
    shuffleInPlace(deck, ctx);
    const hands = [];
    for (let p = 0; p < N; p++) { const h = []; for (let i = 0; i < 6; i++) { const c = deck.pop(); h.push({ r: c.r, s: c.s, up: false }); } hands.push(h); }
    const disc = [deck.pop()];
    const state = { hands, stock: deck, discard: disc, flipTurn: 0, turn: 0, phase: 'flip', drew: null, lastChance: false, turnsLeft: 0, knocker: null, scores: null, winner: null, log: 'New game. Flip 2 cards each.' };
    return { state, turn: [ctx.players[state.flipTurn].id] };
  },
  applyMove(state, playerId, move, ctx) {
    const N = ctx.players.length;
    const pi = ctx.players.findIndex(p => p.id === playerId);
    if (pi < 0) throw new InvalidMove('not seated');
    if (state.phase === 'over') throw new InvalidMove('game over');
    const nm = displayName(ctx, pi);
    if (state.phase === 'flip') {
      if (pi !== state.flipTurn) throw new InvalidMove('not your flip');
      if (!move || move.kind !== 'flip' || !Array.isArray(move.idxs) || move.idxs.length !== 2) throw new InvalidMove('flip 2 cards');
      const a = move.idxs[0], b = move.idxs[1];
      if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 5 || b < 0 || b > 5 || a === b) throw new InvalidMove('pick 2 different cards');
      if (state.hands[pi][a].up || state.hands[pi][b].up) throw new InvalidMove('already face up');
      state.hands[pi][a].up = true;
      state.hands[pi][b].up = true;
      state.flipTurn++;
      if (state.flipTurn >= N) {
        state.phase = 'play'; state.turn = 0;
        state.log += ' | All flipped. ' + displayName(ctx, 0) + ' to play.';
        return { state, turn: [ctx.players[0].id] };
      }
      state.log = nm + ' flipped 2. ' + displayName(ctx, state.flipTurn) + ' to flip.';
      return { state, turn: [ctx.players[state.flipTurn].id] };
    }
    if (state.phase !== 'play') throw new InvalidMove('not in play');
    if (pi !== state.turn) throw new InvalidMove('not your turn');
    if (!move || typeof move.kind !== 'string') throw new InvalidMove('bad move');
    if (move.kind === 'draw') {
      if (state.drew) throw new InvalidMove('already drew');
      const from = move.from;
      if (from !== 'stock' && from !== 'discard') throw new InvalidMove('draw stock or discard');
      if (from === 'discard' && state.discard.length === 0) throw new InvalidMove('discard empty');
      if (state.stock.length === 0) reshuffle(state, ctx);
      if (state.stock.length === 0 && state.discard.length <= 1 && from === 'stock') {
        return finishMatch(state, ctx);
      }
      let card;
      if (from === 'stock') {
        if (state.stock.length === 0) throw new InvalidMove('stock empty');
        card = state.stock.pop();
      } else {
        card = state.discard.pop();
      }
      state.drew = { r: card.r, s: card.s, from };
      state.log = nm + ' drew from ' + from + '.';
      return { state, turn: [playerId] };
    }
    if (move.kind === 'replace') {
      if (!state.drew) throw new InvalidMove('draw first');
      const idx = move.idx;
      if (!Number.isInteger(idx) || idx < 0 || idx > 5) throw new InvalidMove('pick a card');
      const drew = state.drew;
      const old = state.hands[pi][idx];
      state.discard.push({ r: old.r, s: old.s });
      state.hands[pi][idx] = { r: drew.r, s: drew.s, up: true };
      state.drew = null;
      state.log = nm + ' replaced a card.';
      return afterPlay(state, pi, ctx);
    }
    if (move.kind === 'discardFlip') {
      if (!state.drew) throw new InvalidMove('draw first');
      if (state.drew.from !== 'stock') throw new InvalidMove('only stock draw can flip');
      const idx = move.idx;
      if (!Number.isInteger(idx) || idx < 0 || idx > 5) throw new InvalidMove('pick a card');
      if (state.hands[pi][idx].up) throw new InvalidMove('already face up');
      state.discard.push({ r: state.drew.r, s: state.drew.s });
      state.hands[pi][idx].up = true;
      state.drew = null;
      state.log = nm + ' discarded stock to flip.';
      return afterPlay(state, pi, ctx);
    }
    throw new InvalidMove('unknown move');
  },
  computerMove(state, playerId, ctx) {
    return pickAi(state, playerId, ctx, false);
  },
  randomMove(state, playerId, ctx) {
    return pickAi(state, playerId, ctx, true);
  },
  viewFor(state, playerId, ctx) {
    const myIdx = ctx.players.findIndex(p => p.id === playerId);
    const over = state.phase === 'over';
    const hands = state.hands.map((h) => h.map(c => {
      if (c.up) return { r: c.r, s: c.s, up: true };
      if (over) return { r: c.r, s: c.s, up: true };
      return { r: 0, s: 0, up: false };
    }));
    let drew = null;
    if (state.drew) {
      if (over) drew = null;
      else if (myIdx >= 0 && state.turn === myIdx && state.phase === 'play') drew = { r: state.drew.r, s: state.drew.s, from: state.drew.from };
      else drew = { r: 0, s: 0, from: state.drew.from, hidden: true };
    }
    const turn = over ? [] : [turnId(state, ctx)];
    return { hands, stockCount: state.stock.length, discard: state.discard.map(c => ({ r: c.r, s: c.s })), flipTurn: turn.slice(), turn: turn.slice(), flipTurnIdx: state.flipTurn, cur: state.turn, phase: state.phase, drew, lastChance: state.lastChance, turnsLeft: state.turnsLeft, knocker: state.knocker, scores: state.scores, winner: state.winner, log: state.log };
  }
};
function turnId(state, ctx) {
  const idx = state.phase === 'flip' ? state.flipTurn : state.turn;
  if (idx == null || idx < 0 || idx >= ctx.players.length) return ctx.players[0].id;
  return ctx.players[idx].id;
}
function displayName(ctx, i) { try { return ctx.players[i].display_name || ('P' + i); } catch (e) { return 'P' + i; } }
function cval(r) { if (r === 1) return 1; if (r >= 2 && r <= 10) return r; if (r === 11) return 0; if (r === 12) return 10; return 0; }
function finalScore(h) { let t = 0; for (let c = 0; c < 3; c++) { const a = h[c], b = h[c + 3]; if (a.r === b.r) continue; t += cval(a.r) + cval(b.r); } return t; }
function allUp(h) { return h.every(c => c.up); }
function shuffleInPlace(a, ctx) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(ctx.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function reshuffle(state, ctx) {
  if (state.discard.length > 1) {
    const top = state.discard.pop();
    const rest = state.discard;
    shuffleInPlace(rest, ctx);
    state.stock = rest;
    state.discard = [top];
    state.log += ' | Reshuffled.';
  }
}
function afterPlay(state, justPlayed, ctx) {
  const N = ctx.players.length;
  if (allUp(state.hands[justPlayed]) && !state.lastChance && state.phase === 'play') {
    state.lastChance = true; state.turnsLeft = N - 1; state.knocker = justPlayed;
    state.log += ' | ' + displayName(ctx, justPlayed) + ' has all up! Last turn for others.';
    if (state.turnsLeft <= 0) return finishMatch(state, ctx);
    const nt = (justPlayed + 1) % N;
    state.turn = nt;
    return { state, turn: [ctx.players[nt].id] };
  }
  if (state.lastChance) {
    if (justPlayed !== state.knocker) {
      state.turnsLeft--;
      if (state.turnsLeft <= 0) return finishMatch(state, ctx);
    } else {
      if (state.turnsLeft <= 0) return finishMatch(state, ctx);
    }
  }
  const nt = (justPlayed + 1) % N;
  state.turn = nt;
  return { state, turn: [ctx.players[nt].id] };
}
function finishMatch(state, ctx) {
  const N = ctx.players.length;
  const scores = state.hands.slice(0, N).map(h => finalScore(h));
  let w = 0; for (let i = 1; i < N; i++) if (scores[i] < scores[w]) w = i;
  state.phase = 'over'; state.scores = scores; state.winner = w; state.drew = null;
  state.hands.forEach(h => h.forEach(c => { c.up = true; }));
  state.log += ' | Game over!';
  const payouts = {};
  const humans = ctx.players.filter(p => p.kind !== 'computer');
  if (humans.length === 0) return { state, turn: null, payouts: {} };
  const pot = ctx.pot || 0;
  let best = Infinity;
  scores.forEach((s, i) => { if (ctx.players[i] && ctx.players[i].kind !== 'computer') best = Math.min(best, s); });
  const overallMin = Math.min.apply(null, scores);
  let recipients;
  if (overallMin === best) recipients = humans.filter((p) => scores[ctx.players.indexOf(p)] === overallMin).map(p => p.id);
  else recipients = humans.filter(p => scores[ctx.players.indexOf(p)] === best).map(p => p.id);
  if (!recipients.length) recipients = humans.map(p => p.id);
  const share = Math.floor(pot / recipients.length);
  let rem = pot - share * recipients.length;
  recipients.forEach(id => { payouts[id] = share + (rem > 0 ? 1 : 0); if (rem > 0) rem--; });
  humans.forEach(p => { if (!(p.id in payouts)) payouts[p.id] = 0; });
  return { state, turn: null, payouts };
}
function pickAi(state, playerId, ctx, random) {
  const pi = ctx.players.findIndex(p => p.id === playerId);
  const r = () => ctx.random();
  const pick = arr => arr[Math.floor(r() * arr.length)];
  if (state.phase === 'flip') {
    const downs = [0,1,2,3,4,5].filter(i => !state.hands[pi][i].up);
    if (downs.length <= 2) return { kind: 'flip', idxs: downs.slice(0, 2) };
    shuffleInPlace(downs, ctx);
    return { kind: 'flip', idxs: downs.slice(0, 2) };
  }
  const hand = state.hands[pi];
  if (!state.drew) {
    if (random) return r() < 0.5 && state.discard.length ? { kind: 'draw', from: 'discard' } : { kind: 'draw', from: 'stock' };
    const top = state.discard[state.discard.length - 1];
    let take = false;
    if (top) {
      const v = cval(top.r);
      if (v <= 4) take = true;
      for (let c = 0; c < 3; c++) {
        const a = hand[c], b = hand[c + 3];
        if (a.up && a.r === top.r && (!b.up || b.r !== top.r)) take = true;
        if (b.up && b.r === top.r && (!a.up || a.r !== top.r)) take = true;
      }
    }
    if (state.stock.length === 0 && state.discard.length) take = true;
    if (!state.discard.length) take = false;
    return { kind: 'draw', from: take ? 'discard' : 'stock' };
  }
  const d = state.drew;
  if (random) {
    const downs = [0,1,2,3,4,5].filter(i => !hand[i].up);
    if (d.from === 'stock' && downs.length && r() < 0.4) return { kind: 'discardFlip', idx: pick(downs) };
    return { kind: 'replace', idx: Math.floor(r() * 6) };
  }
  for (let c = 0; c < 3; c++) {
    const ai = c, bi = c + 3;
    const a = hand[ai], b = hand[bi];
    if (a.up && a.r === d.r && (!b.up || b.r !== d.r)) return { kind: 'replace', idx: bi };
    if (b.up && b.r === d.r && (!a.up || a.r !== d.r)) return { kind: 'replace', idx: ai };
  }
  let worst = -1, worstV = -99;
  for (let i = 0; i < 6; i++) {
    const mate = i < 3 ? i + 3 : i - 3;
    const c = hand[i], m = hand[mate];
    if (!c.up) continue;
    if (m.up && m.r === c.r) continue;
    const v = cval(c.r);
    if (v > worstV) { worstV = v; worst = i; }
  }
  const dv = cval(d.r);
  if (worst >= 0 && dv < worstV) return { kind: 'replace', idx: worst };
  const downs = [0,1,2,3,4,5].filter(i => !hand[i].up);
  if (downs.length) {
    if (dv <= 5) return { kind: 'replace', idx: pick(downs) };
    else {
      if (d.from === 'stock') return { kind: 'discardFlip', idx: pick(downs) };
      else { if (worst >= 0) return { kind: 'replace', idx: worst }; return { kind: 'replace', idx: downs[0] }; }
    }
  }
  if (worst >= 0) return { kind: 'replace', idx: worst };
  return { kind: 'replace', idx: 0 };
}
