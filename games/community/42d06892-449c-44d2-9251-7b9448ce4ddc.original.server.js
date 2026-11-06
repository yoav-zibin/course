const game = {
  buildDeck() { return null; },
  shuffledDeck(ctx) {
    const suits = ['\u2660','\u2665','\u2666','\u2663'];
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s: suits[s] });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      const t = d[i]; d[i] = d[j]; d[j] = t;
    }
    return d;
  },
  payoutsFor(ctx, winnerIdx, pids) {
    const pot = ctx.pot;
    const humans = ctx.players.filter(p => p.kind === 'human');
    const out = {};
    if (pot <= 0) return out;
    if (humans.length === 0) return out;
    if (winnerIdx === -1) {
      const base = Math.floor(pot / humans.length);
      let rem = pot - base * humans.length;
      for (const h of humans) {
        out[h.id] = base + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
      }
      return out;
    }
    const wid = pids[winnerIdx];
    const wh = humans.find(h => h.id === wid);
    if (wh) {
      for (const h of humans) out[h.id] = 0;
      out[wid] = pot;
      return out;
    }
    const base = Math.floor(pot / humans.length);
    let rem = pot - base * humans.length;
    for (const h of humans) {
      out[h.id] = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
    }
    return out;
  },
  newMatch(ctx) {
    const pids = ctx.players.map(p => p.id);
    const deck = this.shuffledDeck(ctx);
    const state = {
      pids: pids.slice(),
      decks: [deck.slice(0, 26), deck.slice(26)],
      pot: [],
      faceUp: [null, null],
      revealed: [false, false],
      warDepth: 0,
      round: 1,
      log: 'War begins! Both players flip.',
      winner: null
    };
    return { state, turn: pids.slice() };
  },
  applyMove(state, playerId, move, ctx) {
    const idx = state.pids.indexOf(playerId);
    if (idx < 0) throw new InvalidMove('not seated');
    if (state.winner !== null) throw new InvalidMove('game over');
    if (!move || move.flip !== true) throw new InvalidMove('flip to play');
    if (state.revealed[idx]) throw new InvalidMove('already flipped');
    const other = 1 - idx;
    const decks = [state.decks[0].slice(), state.decks[1].slice()];
    const pot = state.pot.map(c => ({ r: c.r, s: c.s }));
    let faceUp = [state.faceUp[0] ? { ...state.faceUp[0] } : null, state.faceUp[1] ? { ...state.faceUp[1] } : null];
    let revealed = [state.revealed[0], state.revealed[1]];
    let warDepth = state.warDepth;
    let round = state.round;
    let winner = null;
    const name = (i) => (ctx.players[i] ? ctx.players[i].display_name || ('Player ' + (i + 1)) : ('Player ' + (i + 1)));
    const isNewRound = !revealed[0] && !revealed[1];
    if (isNewRound) faceUp = [null, null];
    if (warDepth === 0) {
      if (decks[idx].length === 0) {
        state.decks = decks; state.pot = pot; state.faceUp = faceUp; state.revealed = revealed;
        state.log = name(idx) + ' has no cards to flip!';
        state.winner = other;
        return { state, turn: null, payouts: this.payoutsFor(ctx, other, state.pids) };
      }
      const up = decks[idx].shift();
      pot.push({ r: up.r, s: up.s });
      faceUp[idx] = { r: up.r, s: up.s };
    } else {
      if (decks[idx].length === 0) {
        state.decks = decks; state.pot = pot; state.faceUp = faceUp; state.revealed = revealed;
        state.log = name(idx) + ' ran out during War!';
        state.winner = other;
        return { state, turn: null, payouts: this.payoutsFor(ctx, other, state.pids) };
      } else if (decks[idx].length >= 2) {
        const down = decks[idx].shift(); pot.push({ r: down.r, s: down.s });
        const up = decks[idx].shift(); pot.push({ r: up.r, s: up.s });
        faceUp[idx] = { r: up.r, s: up.s };
      } else {
        const up = decks[idx].shift(); pot.push({ r: up.r, s: up.s });
        faceUp[idx] = { r: up.r, s: up.s };
      }
    }
    revealed[idx] = true;
    const rankLabel = (r) => r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r);
    if (!revealed[other]) {
      state.decks = decks; state.pot = pot; state.faceUp = faceUp; state.revealed = revealed;
      state.warDepth = warDepth; state.round = round;
      state.log = warDepth > 0 ? ('War card placed. Waiting for ' + name(other) + '...') : ('Waiting for ' + name(other) + ' to flip...');
      return { state, turn: [state.pids[other]] };
    }
    const c0 = faceUp[0], c1 = faceUp[1];
    const potSize = pot.length;
    if (c0 && c1 && c0.r === c1.r) {
      if (decks[0].length === 0 && decks[1].length === 0) {
        state.decks = decks; state.pot = pot; state.faceUp = faceUp;
        state.revealed = [false, false]; state.warDepth = warDepth; state.round = round;
        state.log = 'Double knockout on War ' + rankLabel(c0.r) + "! It's a draw!";
        state.winner = -1;
        return { state, turn: null, payouts: this.payoutsFor(ctx, -1, state.pids) };
      } else if (decks[0].length === 0) {
        state.decks = decks; state.pot = pot; state.faceUp = faceUp; state.revealed = revealed;
        state.log = 'War on ' + rankLabel(c0.r) + 's! ' + name(0) + ' is out of cards! ' + name(1) + ' wins!';
        state.winner = 1;
        return { state, turn: null, payouts: this.payoutsFor(ctx, 1, state.pids) };
      } else if (decks[1].length === 0) {
        state.decks = decks; state.pot = pot; state.faceUp = faceUp; state.revealed = revealed;
        state.log = 'War on ' + rankLabel(c0.r) + 's! ' + name(1) + ' is out of cards! ' + name(0) + ' wins!';
        state.winner = 0;
        return { state, turn: null, payouts: this.payoutsFor(ctx, 0, state.pids) };
      } else {
        warDepth += 1;
        state.decks = decks; state.pot = pot;
        state.faceUp = [null, null]; state.revealed = [false, false];
        state.warDepth = warDepth; state.round = round;
        state.log = 'WAR! Both ' + rankLabel(c0.r) + 's! Each places 1 down + 1 up. (Pot ' + potSize + ')';
        return { state, turn: state.pids.slice() };
      }
    } else {
      const bw = (c0.r > c1.r) ? 0 : 1;
      const lw = 1 - bw;
      for (let i = pot.length - 1; i > 0; i--) {
        const j = Math.floor(ctx.random() * (i + 1));
        const t = pot[i]; pot[i] = pot[j]; pot[j] = t;
      }
      decks[bw] = decks[bw].concat(pot.map(c => ({ r: c.r, s: c.s })));
      if (decks[lw].length === 0) {
        state.decks = decks; state.pot = [];
        state.faceUp = [c0, c1]; state.revealed = [false, false];
        state.warDepth = 0; state.round = round + 1;
        state.log = name(bw) + ' wins ' + rankLabel(c0.r) + ' vs ' + rankLabel(c1.r) + ' and takes all ' + potSize + ' cards \u2014 GAME OVER!';
        state.winner = bw;
        return { state, turn: null, payouts: this.payoutsFor(ctx, bw, state.pids) };
      } else {
        state.decks = decks; state.pot = [];
        state.faceUp = [c0, c1]; state.revealed = [false, false];
        state.warDepth = 0; state.round = round + 1;
        state.log = name(bw) + ' wins ' + rankLabel(c0.r) + c0.s + ' vs ' + rankLabel(c1.r) + c1.s + ' (+' + potSize + ')';
        return { state, turn: state.pids.slice() };
      }
    }
  },
  computerMove(state, playerId, ctx) { return { flip: true }; },
  randomMove(state, playerId, ctx) { return { flip: true }; },
  viewFor(state, playerId, ctx) {
    return {
      counts: [state.decks[0].length, state.decks[1].length],
      potCount: state.pot.length,
      faceUp: state.faceUp,
      revealed: state.revealed,
      warDepth: state.warDepth,
      round: state.round,
      log: state.log,
      winner: state.winner
    };
  }
};