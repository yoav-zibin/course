// Chess — server-side (v2) conversion of the client-only game. Same
// rules as the original client (full legal move generation: castling
// through check, en passant, promotion, checkmate/stalemate, the
// 50-move rule, insufficient material, threefold repetition), but the
// engine runs on a flat 64-cell integer board (white pieces positive:
// P=1 N=2 B=3 R=4 Q=5 K=6; black negative) — string boards were too
// slow under the platform's per-move test budget. Seat 0 is White.
// The view renames the side to move to "toMove" (a view may not
// carry a non-list "turn").
const VAL = [0, 100, 320, 330, 500, 900, 0];
const KNIGHT_OFFS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KING_OFFS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const DIAG_DIRS = [[-1,-1],[-1,1],[1,-1],[1,1]];
const ORTHO_DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
const PROMOS = [5, 4, 3, 2];

function initBoard() {
  const bd = new Array(64).fill(0);
  const back = [4, 2, 3, 5, 6, 3, 2, 4];
  for (let c = 0; c < 8; c++) {
    bd[c] = -back[c];
    bd[8 + c] = -1;
    bd[48 + c] = 1;
    bd[56 + c] = back[c];
  }
  return bd;
}
function posKey(bd, turn, cast, ep) {
  // Repetition compares available moves: a nominal EP square only matters
  // when this side has a legal capture there (including king safety).
  ep = legalEp(bd, turn, cast, ep);
  // Two FNV-style hashes of the position, as a short map key: the
  // full string key made the state (and every call carrying it) grow
  // too fast over long games. A 64-bit combined hash makes an
  // accidental repetition collision negligible.
  let h1 = 2166136261, h2 = 4242424242;
  for (let i = 0; i < 64; i++) {
    const v = bd[i] + 6;
    h1 = Math.imul(h1 ^ v, 16777619);
    h2 = Math.imul(h2 ^ (v * 31 + i), 2654435761);
  }
  let flags =
    (turn === "w" ? 1 : 2) +
    (cast.K ? 4 : 0) +
    (cast.Q ? 8 : 0) +
    (cast.k ? 16 : 0) +
    (cast.q ? 32 : 0) +
    (ep === null ? 0 : (ep + 1) * 64);
  h1 = Math.imul(h1 ^ flags, 16777619);
  h2 = Math.imul(h2 ^ flags, 2654435761);
  return (h1 >>> 0) + "." + (h2 >>> 0);
}
function initialState() {
  const bd = initBoard();
  const cast = { K: true, Q: true, k: true, q: true };
  return {
    bd,
    turn: "w",
    castling: cast,
    ep: null,
    half: 0,
    full: 1,
    winner: null,
    reason: null,
    history: [],
    rep: { [posKey(bd, "w", cast, null)]: 1 },
    lastMove: null,
  };
}
function findKing(bd, white) {
  const t = white ? 6 : -6;
  for (let i = 0; i < 64; i++) if (bd[i] === t) return i;
  return -1;
}
function attacked(bd, sq, byWhite) {
  const r = sq >> 3, c = sq & 7;
  // Pawns: a white pawn attacks from one row below the target.
  const pr = byWhite ? r + 1 : r - 1;
  if (pr >= 0 && pr < 8) {
    for (const dc of [-1, 1]) {
      const cc = c + dc;
      if (cc >= 0 && cc < 8 && bd[pr * 8 + cc] === (byWhite ? 1 : -1)) return true;
    }
  }
  const knight = byWhite ? 2 : -2;
  for (const [dr, dc] of KNIGHT_OFFS) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && bd[rr * 8 + cc] === knight) return true;
  }
  const king = byWhite ? 6 : -6;
  for (const [dr, dc] of KING_OFFS) {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && bd[rr * 8 + cc] === king) return true;
  }
  const bishop = byWhite ? 3 : -3, rook = byWhite ? 4 : -4, queen = byWhite ? 5 : -5;
  for (const [dr, dc] of DIAG_DIRS) {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const p = bd[rr * 8 + cc];
      if (p) {
        if (p === bishop || p === queen) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  for (const [dr, dc] of ORTHO_DIRS) {
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
      const p = bd[rr * 8 + cc];
      if (p) {
        if (p === rook || p === queen) return true;
        break;
      }
      rr += dr; cc += dc;
    }
  }
  return false;
}
function inCheck(bd, white) {
  const k = findKing(bd, white);
  return k >= 0 && attacked(bd, k, !white);
}
// Moves carry row/col fields: {fr, fc, tr, tc, promo?, enPassant?, castle?}.
function pseudo(bd, r, c, cast, ep) {
  const p = bd[r * 8 + c];
  if (!p) return [];
  const white = p > 0, ty = Math.abs(p);
  const M = [];
  const add = (tr, tc, o) => {
    if (tr >= 0 && tr < 8 && tc >= 0 && tc < 8) {
      const m = { fr: r, fc: c, tr, tc };
      if (o) for (const k in o) m[k] = o[k];
      M.push(m);
    }
  };
  if (ty === 1) {
    const d = white ? -1 : 1, start = white ? 6 : 1, last = white ? 0 : 7;
    if (!bd[(r + d) * 8 + c]) {
      if (r + d === last) {
        for (const pr of PROMOS) add(r + d, c, { promo: pr });
      } else {
        add(r + d, c);
        if (r === start && !bd[(r + 2 * d) * 8 + c]) add(r + 2 * d, c, { double: true });
      }
    }
    for (const dc of [-1, 1]) {
      const tr = r + d, tc = c + dc;
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
      const t = bd[tr * 8 + tc];
      if (t && (t > 0) !== white) {
        if (tr === last) {
          for (const pr of PROMOS) add(tr, tc, { promo: pr });
        } else add(tr, tc);
      }
      if (ep !== null && ep === tr * 8 + tc) add(tr, tc, { enPassant: true });
    }
  } else if (ty === 2 || ty === 6) {
    const off = ty === 2 ? KNIGHT_OFFS : KING_OFFS;
    for (const [dr, dc] of off) {
      const tr = r + dr, tc = c + dc;
      if (tr < 0 || tr > 7 || tc < 0 || tc > 7) continue;
      const t = bd[tr * 8 + tc];
      if (!t || (t > 0) !== white) add(tr, tc);
    }
    if (ty === 6) {
      if (white && r === 7 && c === 4) {
        if (cast.K && !bd[61] && !bd[62] && bd[63] === 4 && !attacked(bd, 60, false) && !attacked(bd, 61, false) && !attacked(bd, 62, false)) add(7, 6, { castle: "K" });
        if (cast.Q && !bd[59] && !bd[58] && !bd[57] && bd[56] === 4 && !attacked(bd, 60, false) && !attacked(bd, 59, false) && !attacked(bd, 58, false)) add(7, 2, { castle: "Q" });
      }
      if (!white && r === 0 && c === 4) {
        if (cast.k && !bd[5] && !bd[6] && bd[7] === -4 && !attacked(bd, 4, true) && !attacked(bd, 5, true) && !attacked(bd, 6, true)) add(0, 6, { castle: "K" });
        if (cast.q && !bd[3] && !bd[2] && !bd[1] && bd[0] === -4 && !attacked(bd, 4, true) && !attacked(bd, 3, true) && !attacked(bd, 2, true)) add(0, 2, { castle: "Q" });
      }
    }
  } else {
    const dirs = ty === 3 ? DIAG_DIRS : ty === 4 ? ORTHO_DIRS : KING_OFFS;
    for (const [dr, dc] of dirs) {
      let tr = r + dr, tc = c + dc;
      while (tr >= 0 && tr < 8 && tc >= 0 && tc < 8) {
        const t = bd[tr * 8 + tc];
        if (!t) add(tr, tc);
        else {
          if ((t > 0) !== white) add(tr, tc);
          break;
        }
        tr += dr; tc += dc;
      }
    }
  }
  return M;
}
function applyOnBoard(bd, m) {
  const nb = bd.slice();
  const from = m.fr * 8 + m.fc, to = m.tr * 8 + m.tc;
  const p = nb[from];
  nb[from] = 0;
  if (m.enPassant) nb[m.fr * 8 + m.tc] = 0;
  nb[to] = m.promo ? (p > 0 ? m.promo : -m.promo) : p;
  if (m.castle) {
    if (m.tr === 7) {
      if (m.tc === 6) { nb[61] = nb[63]; nb[63] = 0; }
      else { nb[59] = nb[56]; nb[56] = 0; }
    } else {
      if (m.tc === 6) { nb[5] = nb[7]; nb[7] = 0; }
      else { nb[3] = nb[0]; nb[0] = 0; }
    }
  }
  return nb;
}
function legalAt(state, r, c) {
  const bd = state.bd;
  const p = bd[r * 8 + c];
  if (!p) return [];
  const white = p > 0;
  const isKing = Math.abs(p) === 6;
  const kingSq = isKing ? -1 : findKing(bd, white);
  const nb = bd.slice();
  const out = [];
  for (const m of pseudo(bd, r, c, state.castling, state.ep)) {
    // Apply on the scratch board, test, restore — no closure per move.
    const from = m.fr * 8 + m.fc, to = m.tr * 8 + m.tc;
    const captured = nb[to];
    const epSq = m.enPassant ? m.fr * 8 + m.tc : -1;
    const epVal = epSq >= 0 ? nb[epSq] : 0;
    let rookFrom = -1, rookTo = -1, rookVal = 0;
    nb[from] = 0;
    if (epSq >= 0) nb[epSq] = 0;
    nb[to] = m.promo ? (white ? m.promo : -m.promo) : p;
    if (m.castle) {
      if (m.tr === 7) {
        rookFrom = m.tc === 6 ? 63 : 56;
        rookTo = m.tc === 6 ? 61 : 59;
      } else {
        rookFrom = m.tc === 6 ? 7 : 0;
        rookTo = m.tc === 6 ? 5 : 3;
      }
      rookVal = nb[rookFrom];
      nb[rookTo] = rookVal;
      nb[rookFrom] = 0;
    }
    const ksq = isKing ? to : kingSq;
    if (!attacked(nb, ksq, !white)) out.push(m);
    nb[from] = p;
    nb[to] = captured;
    if (epSq >= 0) nb[epSq] = epVal;
    if (rookFrom >= 0) {
      nb[rookFrom] = rookVal;
      nb[rookTo] = 0;
    }
  }
  return out;
}
function allLegal(state, color) {
  const white = color === "w";
  const out = [];
  for (let i = 0; i < 64; i++) {
    const p = state.bd[i];
    if (p && (p > 0) === white) {
      for (const m of legalAt(state, i >> 3, i & 7)) out.push(m);
    }
  }
  return out;
}
function legalEp(bd, turn, castling, ep) {
  if (ep === null) return null;
  const white = turn === "w", r = (ep >> 3) + (white ? 1 : -1), c = ep & 7;
  if (r < 0 || r > 7 || bd[ep] || bd[r * 8 + c] !== (white ? -1 : 1)) return null;
  for (const dc of [-1, 1]) {
    const fc = c + dc;
    if (fc < 0 || fc > 7 || bd[r * 8 + fc] !== (white ? 1 : -1)) continue;
    if (legalAt({ bd, castling, ep }, r, fc).some((m) => m.enPassant)) return ep;
  }
  return null;
}
function anyLegal(state, color) {
  const white = color === "w";
  for (let i = 0; i < 64; i++) {
    const p = state.bd[i];
    if (p && (p > 0) === white && legalAt(state, i >> 3, i & 7).length > 0) return true;
  }
  return false;
}
function sqName(r, c) {
  return "abcdefgh"[c] + (8 - r);
}
const TYPE_LETTER = ["", "P", "N", "B", "R", "Q", "K"];
function toSAN(state, move, checks, mate) {
  if (move.castle) return (move.castle === "K" ? "O-O" : "O-O-O") + (mate ? "#" : checks ? "+" : "");
  const bd = state.bd, p = bd[move.fr * 8 + move.fc];
  const ty = Math.abs(p);
  const dest = sqName(move.tr, move.tc);
  const isCap = !!bd[move.tr * 8 + move.tc] || move.enPassant;
  let s = "";
  if (ty === 1) {
    if (isCap) s += "abcdefgh"[move.fc] + "x";
    s += dest;
    if (move.promo) s += "=" + TYPE_LETTER[move.promo];
  } else {
    s += ty === 2 ? "N" : TYPE_LETTER[ty];
    const others = [];
    for (let i = 0; i < 64; i++) {
      const r = i >> 3, c = i & 7;
      if ((r === move.fr && c === move.fc) || bd[i] !== p) continue;
      const ms = pseudo(bd, r, c, state.castling, state.ep);
      if (ms.some((m) => m.tr === move.tr && m.tc === move.tc)) others.push([r, c]);
    }
    if (others.length) {
      const sameFile = others.some(([r, c]) => c === move.fc);
      const sameRank = others.some(([r, c]) => r === move.fr);
      if (!sameFile) s += "abcdefgh"[move.fc];
      else if (!sameRank) s += 8 - move.fr;
      else s += sqName(move.fr, move.fc);
    }
    if (isCap) s += "x";
    s += dest;
  }
  if (mate) s += "#";
  else if (checks) s += "+";
  return s;
}
function insufficient(bd) {
  const minors = [];
  for (let i = 0; i < 64; i++) {
    const p = bd[i];
    if (!p) continue;
    const ty = Math.abs(p);
    if (ty === 6) continue;
    if (ty === 1 || ty === 4 || ty === 5) return false;
    minors.push({ t: ty, col: ((i >> 3) + (i & 7)) % 2 });
  }
  if (minors.length <= 1) return true;
  // Promotions can leave more than two bishops. Any number of bishops
  // confined to one square colour still cannot produce checkmate.
  if (minors.every((p) => p.t === 3 && p.col === minors[0].col)) return true;
  return false;
}
// Resignation can only award a win to a side able to mate by some legal
// continuation. This is side-specific; the resigning side may own a rook.
function canMate(bd, white) {
  const bishops = [], other = [];
  let knights = 0;
  for (let i = 0; i < 64; i++) {
    const p = bd[i], t = Math.abs(p), square = ((i >> 3) + (i & 7)) % 2;
    if (!p || t === 6) continue;
    if ((p > 0) !== white) { other.push({ t, square }); continue; }
    if (t === 1 || t === 4 || t === 5) return true;
    if (t === 2) knights++;
    else if (t === 3) bishops.push(square);
  }
  if (knights) {
    if (knights > 1 || bishops.length) return true;
    return other.some((p) => p.t !== 5);
  }
  if (!bishops.length) return false;
  if (bishops.some((square) => square !== bishops[0])) return true;
  return other.some((p) => p.t !== 3 || p.square !== bishops[0]);
}
function doMove(state, move) {
  const bd = state.bd, p = bd[move.fr * 8 + move.fc];
  const white = p > 0, col = white ? "w" : "b";
  const isCap = !!bd[move.tr * 8 + move.tc] || move.enPassant;
  const isPawn = Math.abs(p) === 1;
  const nb = applyOnBoard(bd, move);
  const cast = Object.assign({}, state.castling);
  if (p === 6) { cast.K = false; cast.Q = false; }
  if (p === -6) { cast.k = false; cast.q = false; }
  if (move.fr === 7 && move.fc === 0) cast.Q = false;
  if (move.fr === 7 && move.fc === 7) cast.K = false;
  if (move.fr === 0 && move.fc === 0) cast.q = false;
  if (move.fr === 0 && move.fc === 7) cast.k = false;
  if (move.tr === 7 && move.tc === 0) cast.Q = false;
  if (move.tr === 7 && move.tc === 7) cast.K = false;
  if (move.tr === 0 && move.tc === 0) cast.q = false;
  if (move.tr === 0 && move.tc === 7) cast.k = false;
  let ep = null;
  if (isPawn && Math.abs(move.tr - move.fr) === 2) ep = ((move.fr + move.tr) / 2) * 8 + move.fc;
  const half = isPawn || isCap ? 0 : state.half + 1;
  const full = state.full + (white ? 0 : 1);
  const next = white ? "b" : "w";
  const chk = inCheck(nb, !white);
  const oppStuck = !anyLegal({ bd: nb, castling: cast, ep }, next);
  let winner = null, reason = null, isMate = false;
  if (chk && oppStuck) { winner = white ? 0 : 1; reason = "Checkmate"; isMate = true; }
  else if (!chk && oppStuck) { winner = -1; reason = "Stalemate"; }
  else if (half >= 100) { winner = -1; reason = "50-move rule"; }
  else if (insufficient(nb)) { winner = -1; reason = "Insufficient material"; }
  else if (state.history.length + 1 >= 240) { winner = -1; reason = "Move limit"; }
  const key = posKey(nb, next, cast, ep);
  const rep = Object.assign({}, state.rep);
  rep[key] = (rep[key] || 0) + 1;
  if (winner === null && rep[key] >= 3) { winner = -1; reason = "Threefold repetition"; }
  const san = toSAN(state, move, chk, isMate);
  return {
    bd: nb,
    turn: next,
    castling: cast,
    ep,
    half,
    full,
    winner,
    reason,
    history: state.history.concat([san]),
    rep,
    lastMove: { fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc },
  };
}
function payoutsFor(ctx, winnerSeat) {
  const humans = ctx.players.filter((p) => p.kind === "human");
  const out = {};
  for (const h of humans) out[h.id] = 0;
  if (!humans.length || ctx.pot <= 0) return out;
  const winner = winnerSeat >= 0 ? ctx.players[winnerSeat] : null;
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
}
const PROMO_LETTER = { Q: 5, R: 4, B: 3, N: 2 };
function cleanMove(m) {
  const out = { fr: m.fr, fc: m.fc, tr: m.tr, tc: m.tc };
  if (m.promo) out.promo = TYPE_LETTER[m.promo];
  return out;
}

const game = {
  newMatch(ctx) {
    return { state: initialState(), turn: [ctx.players[0].id] };
  },

  applyMove(state, playerId, move, ctx) {
    if (state.winner !== null) throw new InvalidMove("game over");
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    if (seat < 0) throw new InvalidMove("unknown player");
    const color = seat === 0 ? "w" : "b";
    if (state.turn !== color) throw new InvalidMove("not your turn");
    if (move && move.resign) {
      const winner = canMate(state.bd, color !== "w") ? 1 - seat : -1;
      const s = Object.assign({}, state, { winner, reason: winner < 0 ? "Resignation — no possible mate" : "Resignation" });
      return { state: s, turn: null, payouts: payoutsFor(ctx, winner) };
    }
    const wantPromo =
      move && move.promo ? PROMO_LETTER[move.promo] || null : null;
    const coordsOk =
      move &&
      Number.isInteger(move.fr) && Number.isInteger(move.fc) &&
      move.fr >= 0 && move.fr < 8 && move.fc >= 0 && move.fc < 8;
    // The piece on the from-square must be the mover's own — without
    // this check a player could move the opponent's pieces.
    const fromPiece = coordsOk ? state.bd[move.fr * 8 + move.fc] : 0;
    if (!fromPiece || (fromPiece > 0) !== (color === "w"))
      throw new InvalidMove("not your piece");
    const candidates = legalAt(state, move.fr, move.fc);
    const match = candidates.find(
      (m) => m.tr === move.tr && m.tc === move.tc && (m.promo || null) === wantPromo
    );
    if (!match) throw new InvalidMove("illegal move");
    const next = doMove(state, match);
    if (next.winner !== null) {
      return { state: next, turn: null, payouts: payoutsFor(ctx, next.winner) };
    }
    return { state: next, turn: [ctx.players[next.turn === "w" ? 0 : 1].id] };
  },

  computerMove(state, playerId, ctx) {
    // Greedy one-ply taste, scored in a single pass (the converted
    // 3 Minute Chess does the same): captures, promotions, castling
    // and central landings, with a seeded jitter. Testing every
    // candidate for check on a cloned board made each call several
    // times slower, which the random-walk budget cannot afford.
    const moves = allLegal(state, state.turn);
    if (!moves.length) return { resign: true };
    let best = moves[0], bestS = -Infinity;
    for (const m of moves) {
      let s = 0;
      const target = state.bd[m.tr * 8 + m.tc];
      if (target) s += VAL[Math.abs(target)];
      if (m.enPassant) s += 100;
      if (m.promo) s += VAL[m.promo] - 100;
      if (m.castle) s += 60;
      const piece = Math.abs(state.bd[m.fr * 8 + m.fc]);
      if (m.tc >= 2 && m.tc <= 5 && m.tr >= 2 && m.tr <= 5) {
        if (piece === 1) s += 4;
        if (piece === 2 || piece === 3) s += 6;
      }
      s += ctx.random() * 40;
      if (s > bestS) {
        bestS = s;
        best = m;
      }
    }
    return cleanMove(best);
  },

  randomMove(state, playerId, ctx) {
    // A random movable piece (in random order) and one of its legal
    // moves — generating every legal move here made walks crawl.
    const squares = [];
    for (let i = 0; i < 64; i++) {
      const p = state.bd[i];
      if (p && (p > 0) === (state.turn === "w")) squares.push(i);
    }
    for (let i = squares.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [squares[i], squares[j]] = [squares[j], squares[i]];
    }
    for (const sq of squares) {
      const moves = legalAt(state, sq >> 3, sq & 7);
      if (moves.length)
        return cleanMove(moves[Math.floor(ctx.random() * moves.length)]);
    }
    return { resign: true };
  },

  viewFor(state, playerId, ctx) {
    return {
      bd: state.bd,
      toMove: state.turn,
      castling: state.castling,
      ep: state.ep,
      half: state.half,
      full: state.full,
      winner: state.winner,
      reason: state.reason,
      history: state.history,
      lastMove: state.lastMove,
    };
  },
};
