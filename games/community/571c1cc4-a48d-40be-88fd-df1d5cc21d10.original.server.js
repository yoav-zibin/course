const game = {
  newMatch(ctx) {
    const state = { piles: [3, 5, 7], winnerIndex: null };
    const first = ctx.players.length > 0 ? ctx.players[0].id : null;
    return { state, turn: first !== null ? [first] : [] };
  },
  _idx(state, playerId, ctx) {
    return ctx.players.findIndex(p => p.id === playerId);
  },
  _idForIndex(idx, ctx) {
    if (idx === null || idx === undefined) return null;
    if (idx < 0 || idx >= ctx.players.length) return null;
    return ctx.players[idx].id;
  },
  applyMove(state, playerId, move, ctx) {
    const idx = this._idx(state, playerId, ctx);
    if (idx < 0) throw new InvalidMove("Unknown player.");
    if (state.winnerIndex !== null && state.winnerIndex !== undefined) throw new InvalidMove("Game is over.");
    const pile = (move && (move.pile !== undefined ? move.pile : move.pileIndex));
    const count = move && move.count;
    if (!Number.isInteger(pile) || pile < 0 || pile >= state.piles.length) throw new InvalidMove("Pick one of the piles.");
    if (!Number.isInteger(count) || count < 1) throw new InvalidMove("Take at least 1 stone.");
    if (count > state.piles[pile]) throw new InvalidMove("That pile only has " + state.piles[pile] + " stones.");
    const piles = state.piles.slice();
    piles[pile] -= count;
    const finished = piles.every(n => n === 0);
    if (finished) {
      const newState = { piles, winnerIndex: idx };
      return { state: newState, turn: null, payouts: this._payouts(idx, ctx) };
    }
    const nextIdx = (idx + 1) % ctx.players.length;
    return { state: { piles, winnerIndex: null }, turn: [this._idForIndex(nextIdx, ctx)] };
  },
  _payouts(winnerIdx, ctx) {
    const payouts = {};
    const humans = ctx.players.filter(p => p.kind === "human");
    if (humans.length === 0) return payouts;
    const pot = ctx.pot || 0;
    const winnerId = (winnerIdx !== null && winnerIdx !== undefined && ctx.players[winnerIdx]) ? ctx.players[winnerIdx].id : null;
    const winnerIsHuman = winnerId && humans.some(h => h.id === winnerId);
    if (winnerIsHuman) {
      for (const h of humans) payouts[h.id] = (h.id === winnerId ? pot : 0);
    } else {
      const share = Math.floor(pot / humans.length);
      let rem = pot;
      for (let i = 0; i < humans.length; i++) {
        const v = (i === humans.length - 1) ? rem : share;
        payouts[humans[i].id] = v;
        rem -= v;
      }
    }
    return payouts;
  },
  _bestMove(piles, random) {
    let nimSum = 0;
    for (const n of piles) nimSum ^= n;
    if (nimSum !== 0) {
      for (let i = 0; i < piles.length; i++) {
        const target = piles[i] ^ nimSum;
        if (target < piles[i]) return { pile: i, count: piles[i] - target };
      }
    }
    const nonEmpty = [];
    for (let i = 0; i < piles.length; i++) if (piles[i] > 0) nonEmpty.push(i);
    if (nonEmpty.length === 0) return null;
    const pi = nonEmpty[Math.floor(random() * nonEmpty.length) % nonEmpty.length];
    return { pile: pi, count: 1 };
  },
  computerMove(state, playerId, ctx) {
    const m = this._bestMove(state.piles, ctx.random);
    if (m) return m;
    return this.randomMove(state, playerId, ctx);
  },
  randomMove(state, playerId, ctx) {
    const nonEmpty = [];
    for (let i = 0; i < state.piles.length; i++) if (state.piles[i] > 0) nonEmpty.push(i);
    if (nonEmpty.length === 0) throw new InvalidMove("No moves left.");
    const pile = nonEmpty[Math.floor(ctx.random() * nonEmpty.length) % nonEmpty.length];
    const count = 1 + Math.floor(ctx.random() * state.piles[pile]);
    return { pile, count };
  },
  viewFor(state, playerId, ctx) {
    let myIndex = null;
    if (playerId !== null && playerId !== undefined) {
      const i = ctx.players.findIndex(p => p.id === playerId);
      myIndex = i >= 0 ? i : null;
    }
    return { piles: state.piles.slice(), winnerIndex: state.winnerIndex, myIndex };
  }
};