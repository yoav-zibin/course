// Egyptian Rat Screw — server-side (v2) conversion of the client-only
// game, same rules as the original client: 54 cards (52 + 2 jokers)
// dealt round-robin; flip onto the pile; face cards start a challenge
// (J=1, Q=2, K=3, A=4 chances to answer with a face card); slap combos
// (double, sandwich, top-bottom, tens, marriage, 4-in-a-row, joker)
// open a slap round for everyone and cancel any challenge; a false
// slap costs 1 card to the bottom of the pile; winning the pile means
// flipping next. Hands are face-down stacks: viewFor exposes only
// counts, never the cards, so nobody can peek at upcoming flips.
// A flip cap ends runaway games (most cards wins) so random walks
// always terminate.
const game = {
  newMatch(ctx) {
    const deck = [];
    for (const s of ["S", "H", "D", "C"]) {
      for (let r = 2; r <= 14; r++) deck.push({ r, s });
    }
    deck.push({ r: 99, s: "J" }, { r: 99, s: "J" });
    // Fisher-Yates with the seeded source only (deterministic).
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const n = ctx.players.length;
    const hands = ctx.players.map(() => []);
    deck.forEach((card, i) => hands[i % n].push(card));
    let turn = 0;
    while (turn < n && hands[turn].length === 0) turn++;
    const state = {
      hands,
      pile: [],
      turn,
      challenge: null,
      slap: null,
      log: ["Cards dealt! " + ctx.players[turn].display_name + " starts."],
      winner: null,
      flips: 0,
    };
    return { state, turn: [ctx.players[turn].id] };
  },

  applyMove(state, playerId, move, ctx) {
    if (state.winner !== null) throw new InvalidMove("game over");
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    if (seat < 0) throw new InvalidMove("unknown player");
    const s = JSON.parse(JSON.stringify(state));
    const type = move && move.type;
    if (s.slap) {
      if (type !== "slap") throw new InvalidMove("slap round: slap!");
      return game._slap(s, seat, true, ctx);
    }
    if (type === "slap") return game._slap(s, seat, false, ctx);
    if (type !== "flip") throw new InvalidMove("unknown move");
    if (seat !== s.turn) throw new InvalidMove("not your turn to flip");
    return game._flip(s, seat, ctx);
  },

  _flip(s, f, ctx) {
    const n = ctx.players.length;
    if (s.hands[f].length === 0) throw new InvalidMove("no cards to flip");
    const card = s.hands[f].shift();
    s.pile.push(card);
    s.flips++;
    let msg =
      ctx.players[f].display_name + " played " + game._label(card);
    const slap = game._slappable(s.pile);
    if (slap) {
      s.slap = { reason: slap };
      s.challenge = null;
      s.log = game._log(s.log, msg + " → " + slap + " SLAP IT!");
      return { state: s, turn: ctx.players.map((p) => p.id) };
    }
    if (game._chances(card) > 0) {
      s.challenge = { by: f, left: game._chances(card) };
      const nx = game._nextWithCards(s.hands, f, n);
      if (nx < 0) {
        // Nobody can answer: the challenger takes the pile at once.
        return game._winPile(s, f, ctx, msg);
      }
      s.turn = nx;
      s.log = game._log(s.log, msg);
      return { state: s, turn: [ctx.players[nx].id] };
    }
    if (s.challenge) {
      const left = s.challenge.left - 1;
      if (left <= 0) {
        return game._winPile(s, s.challenge.by, ctx, msg);
      }
      s.challenge = { by: s.challenge.by, left };
      // The same player pays all remaining chances. Only skip them
      // when their face-down stack runs out.
      const nx = s.hands[f].length > 0 ? f : game._nextWithCards(s.hands, f, n);
      if (nx < 0) return game._winPile(s, s.challenge.by, ctx, msg);
      s.turn = nx;
      s.log = game._log(s.log, msg);
      return { state: s, turn: [ctx.players[nx].id] };
    }
    let nx = game._nextWithCards(s.hands, f, n);
    if (nx < 0) nx = f;
    s.turn = nx;
    s.log = game._log(s.log, msg);
    return game._maybeEnd(s, ctx) || { state: s, turn: [ctx.players[nx].id] };
  },

  _slap(s, seat, valid, ctx) {
    const n = ctx.players.length;
    if (valid) {
      const taken = s.pile.length;
      s.hands[seat] = s.hands[seat].concat(s.pile);
      s.pile = [];
      s.slap = null;
      s.challenge = null;
      s.turn = seat;
      s.log = game._log(
        s.log,
        ctx.players[seat].display_name +
          " SLAPPED and takes " +
          taken +
          " cards!"
      );
      const end = game._maybeEnd(s, ctx);
      if (end) return end;
      // The slap winner flips next — unless they somehow hold no cards.
      if (s.hands[seat].length === 0) {
        const nx = game._nextWithCards(s.hands, seat, n);
        if (nx < 0) return game._capEnd(s, ctx);
        s.turn = nx;
      }
      return { state: s, turn: [ctx.players[s.turn].id] };
    }
    // False slap: 1 card from the slapper's hand to the pile's bottom.
    if (s.hands[seat].length > 0 && s.pile.length > 0) {
      s.pile.unshift(s.hands[seat].shift());
      s.log = game._log(
        s.log,
        ctx.players[seat].display_name + " FALSE SLAP! Penalty 1 card."
      );
    } else {
      s.log = game._log(
        s.log,
        ctx.players[seat].display_name + " slapped at nothing."
      );
    }
    const end = game._maybeEnd(s, ctx);
    if (end) return end;
    // Burning the flipper's final card must not leave an empty stack
    // on turn: they cannot produce the next flip.
    if (s.hands[s.turn].length === 0) {
      const nx = game._nextWithCards(s.hands, s.turn, n);
      if (nx < 0) return game._winPile(s, s.challenge ? s.challenge.by : seat, ctx, "No cards left to flip");
      s.turn = nx;
    }
    return { state: s, turn: [ctx.players[s.turn].id] };
  },

  _winPile(s, w, ctx, msg) {
    s.hands[w] = s.hands[w].concat(s.pile);
    s.pile = [];
    s.challenge = null;
    s.turn = w;
    s.log = game._log(
      s.log,
      msg + " → " + ctx.players[w].display_name + " wins the pile!"
    );
    const end = game._maybeEnd(s, ctx);
    if (end) return end;
    if (s.hands[w].length === 0) {
      const nx = game._nextWithCards(s.hands, w, ctx.players.length);
      if (nx < 0) return game._capEnd(s, ctx);
      s.turn = nx;
    }
    return { state: s, turn: [ctx.players[s.turn].id] };
  },

  _maybeEnd(s, ctx) {
    const total = s.hands.reduce((a, h) => a + h.length, 0) + s.pile.length;
    if (s.pile.length === 0) {
      const holder = s.hands.findIndex((h) => h.length === total && total > 0);
      if (holder >= 0) {
        s.winner = holder;
        return {
          state: s,
          turn: null,
          payouts: game._payouts(ctx, holder),
        };
      }
    }
    if (s.flips >= 600) return game._capEnd(s, ctx);
    return null;
  },

  _capEnd(s, ctx) {
    // Runaway game: the player holding the most cards wins.
    let best = 0;
    for (let i = 1; i < s.hands.length; i++) {
      if (s.hands[i].length > s.hands[best].length) best = i;
    }
    s.winner = best;
    s.log = game._log(s.log, "Move cap reached — most cards wins!");
    return { state: s, turn: null, payouts: game._payouts(ctx, best) };
  },

  _payouts(ctx, winnerSeat) {
    const humans = ctx.players.filter((p) => p.kind === "human");
    const out = {};
    for (const h of humans) out[h.id] = 0;
    if (!humans.length || ctx.pot <= 0) return out;
    const winner = ctx.players[winnerSeat];
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
  },

  _chances(card) {
    return card.r === 11 ? 1 : card.r === 12 ? 2 : card.r === 13 ? 3 : card.r === 14 ? 4 : 0;
  },

  _nextWithCards(hands, from, n) {
    for (let i = 1; i <= n; i++) {
      const k = (from + i) % n;
      if (hands[k].length > 0) return k;
    }
    return -1;
  },

  _numVal(c) {
    if (c.r >= 2 && c.r <= 10) return c.r;
    if (c.r === 14) return 1;
    return null;
  },

  _slappable(p) {
    if (p.length < 1) return null;
    const t = p[p.length - 1];
    if (t.r === 99) return "JOKER!";
    if (p.length >= 2) {
      const a = p[p.length - 1];
      const b = p[p.length - 2];
      if (a.r === b.r) return "DOUBLE!";
      if ((a.r === 13 && b.r === 12) || (a.r === 12 && b.r === 13))
        return "MARRIAGE!";
      const na = game._numVal(a);
      const nb = game._numVal(b);
      if (na !== null && nb !== null && na + nb === 10) return "TENS!";
      if (p[0].r === t.r) return "TOP-BOTTOM!";
    }
    if (p.length >= 3) {
      const a = p[p.length - 1];
      const c = p[p.length - 3];
      if (a.r === c.r) return "SANDWICH!";
      const mid = p[p.length - 2];
      const na = game._numVal(a);
      const nc = game._numVal(c);
      if (na !== null && nc !== null && na + nc === 10 && mid.r > 10 && mid.r < 15)
        return "TENS (sandwich)!";
    }
    if (p.length >= 4) {
      const q = p.slice(-4).map((c) => c.r);
      if (q.every((x) => x !== 99)) {
        const asc = q.every((x, i) => i === 0 || q[i] === q[i - 1] + 1);
        const desc = q.every((x, i) => i === 0 || q[i] === q[i - 1] - 1);
        if (asc || desc) return "4-IN-A-ROW!";
        const j = q.join(",");
        if (j === "12,13,14,2" || j === "2,14,13,12") return "4-IN-A-ROW!";
      }
    }
    return null;
  },

  _label(c) {
    if (c.r === 99) return "🃏";
    const rank =
      c.r === 14 ? "A" : c.r === 11 ? "J" : c.r === 12 ? "Q" : c.r === 13 ? "K" : "" + c.r;
    return rank + { S: "♠", H: "♥", D: "♦", C: "♣" }[c.s];
  },

  _log(log, msg) {
    const next = (log || []).slice(-8);
    next.push(msg);
    return next;
  },

  playerJoined(state, playerId, ctx) {
    // The joiner either takes over a computer's seat (its stack comes
    // with the seat) or is appended with an empty hand — in ERS an
    // empty-handed player is never out for long: they can slap back in.
    const s = JSON.parse(JSON.stringify(state));
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    if (seat >= 0 && s.hands.length < ctx.players.length) {
      s.hands.splice(seat, 0, []);
    }
    return { state: s, turn: game._turnIds(s, ctx) };
  },

  playerLeft(state, playerId, ctx) {
    // The seat (and its stack) stays in the game under a computer; the
    // leaver cashes out their share of the cards: payout in proportion
    // to the cards they hold out of all 54.
    const s = JSON.parse(JSON.stringify(state));
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    const total =
      s.hands.reduce((a, h) => a + h.length, 0) + s.pile.length;
    const mine = seat >= 0 ? s.hands[seat].length : 0;
    const payout =
      total > 0 && ctx.pot > 0 ? Math.floor((ctx.pot * mine) / total) : 0;
    return { state: s, turn: game._turnIds(s, ctx), payout };
  },

  _turnIds(s, ctx) {
    if (s.winner !== null) return null;
    if (s.slap) return ctx.players.map((p) => p.id);
    return [ctx.players[s.turn].id];
  },

  computerMove(state, playerId, ctx) {
    if (state.slap) return { type: "slap" };
    return { type: "flip" };
  },

  randomMove(state, playerId, ctx) {
    if (state.slap) return { type: "slap" };
    // Occasionally slap at nothing, like the original's stray clicks —
    // exercises the false-slap path in walks.
    if (state.pile.length > 0 && ctx.random() < 0.05) return { type: "slap" };
    return { type: "flip" };
  },

  viewFor(state, playerId, ctx) {
    return {
      counts: state.hands.map((h) => h.length),
      pile: state.pile,
      flipper: state.turn,
      challenge: state.challenge,
      slap: state.slap,
      log: state.log,
      winner: state.winner,
      flips: state.flips,
    };
  },
};
