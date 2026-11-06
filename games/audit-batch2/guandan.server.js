// Guandan — server-side (v2) conversion of the client-only game.
// The combo rules are the original client's own (single / pair /
// trips / full house / straight / tube / plate / bombs / straight
// flush / joker bomb; the heart of the trump rank is wild; levels
// rise 1-3 per deal by the finish order; tribute between deals;
// passing level A wins). ONE format change: a match is capped at
// MATCH_DEAL_CAP deals — if no team has passed A by then, the team
// with the higher level wins (a tie plays one more deal, which
// always breaks it). A full level race takes 800-1200 actions,
// which cannot finish inside the platform's 1-second random-walk
// test budget; raise the cap if that budget ever grows. Two
// representation choices differ from the
// client, both forced by the platform's random-walk test budget
// (every game call re-sends the state, so it must stay small, and a
// walk must be able to finish): cards in the state are compact
// integer codes (rank * 8 + suit; ranks 2..14, 15/16 the jokers,
// suit 4 for jokers), converted back to {r, s} objects at the view
// and move boundary; and the built-in players lead with their
// longest combo instead of dribbling singles, so deals actually end.
function isWild(c, tr) {
  return c.r === tr && c.s === 1;
}
function isTrump(c, tr) {
  return c.r >= 15 || c.r === tr;
}
function pw1(c, tr) {
  if (c.r === 16) return 1000;
  if (c.r === 15) return 900;
  if (c.r === tr) return 800;
  return c.r;
}
function toObj(code) {
  return { r: code >> 3, s: code & 7 };
}
function toCode(c) {
  return (c.r << 3) | c.s;
}
function pwCode(code, tr) {
  const r = code >> 3;
  if (r === 16) return 1000;
  if (r === 15) return 900;
  if (r === tr) return 800;
  return r;
}
function sortCodes(h, tr) {
  h.sort((a, b) => pwCode(b, tr) - pwCode(a, tr) || (a >> 3) - (b >> 3) || (a & 7) - (b & 7));
}
// A is low in A2345 / AA2233 / AAA222 and high at the other end;
// level cards retain their printed rank in every sequence.
function sequencePatterns(length) {
  const patterns = [];
  for (let start = 1; start <= 15 - length; start++) {
    const ranks = [];
    for (let i = 0; i < length; i++) ranks.push(start + i === 1 ? 14 : start + i);
    patterns.push({ ranks, main: start + length - 1 });
  }
  return patterns;
}
function straightRanksOk(rs) {
  return rs.every((r) => r >= 2 && r <= 14);
}
function sequenceMatch(cards, tr, length, per) {
  if (cards.length !== length * per) return null;
  const natural = cards.filter((c) => !isWild(c, tr));
  if (!straightRanksOk(natural.map((c) => c.r))) return null;
  const counts = {};
  for (const c of natural) counts[c.r] = (counts[c.r] || 0) + 1;
  const wild = cards.length - natural.length;
  for (const pattern of sequencePatterns(length)) {
    if (!Object.keys(counts).every((r) => pattern.ranks.includes(+r) && counts[r] <= per)) continue;
    const missing = pattern.ranks.reduce((n, r) => n + per - (counts[r] || 0), 0);
    if (missing === wild) return pattern;
  }
  return null;
}
function sfOK(cards, tr) {
  const pattern = sequenceMatch(cards, tr, 5, 1);
  if (!pattern) return null;
  const natural = cards.filter((c) => !isWild(c, tr));
  if (natural.length && !natural.every((c) => c.s === natural[0].s)) return null;
  return { type: "sflush", main: pattern.main, pw: 900 + pattern.main - 4, len: 5, isBomb: true, big: 5.5 };
}
function buildSequence(hand, tr, ranks, per, suit) {
  const wild = [];
  const by = {};
  hand.forEach((c, i) => {
    if (isWild(c, tr)) wild.push(i);
    else if (suit === undefined || c.s === suit) (by[c.r] = by[c.r] || []).push(i);
  });
  const idx = [];
  for (const rank of ranks) {
    const natural = (by[rank] || []).slice(0, per);
    idx.push(...natural);
    for (let i = natural.length; i < per; i++) {
      if (!wild.length) return null;
      idx.push(wild.pop());
    }
  }
  return idx;
}
function detect(cards, tr) {
  if (!cards || !cards.length) return null;
  const n = cards.length;
  const w = cards.filter((c) => isWild(c, tr));
  const nm = cards.filter((c) => !isWild(c, tr));
  const W = w.length;
  if (n === 4 && cards.every((c) => c.r >= 15))
    return { type: "jokerbomb", main: 99, pw: 1000, len: 4, isBomb: true, big: 100 };
  if (W === n) {
    if (n <= 3) return { type: n === 1 ? "single" : n === 2 ? "pair" : "trips", main: tr, pw: 800, len: n };
    return { type: "bomb", main: tr, pw: 800 + W * 10, len: n, isBomb: true, big: n };
  }
  const hasJ = nm.some((c) => c.r >= 15);
  const rs = [...new Set(nm.map((c) => c.r))];
  if (!hasJ && rs.length <= 1) {
    const R = rs[0];
    if (n === 1) {
      const s = cards[0];
      const p = s.r >= 15 ? (s.r === 16 ? 1000 : 900) : R === tr ? 800 : R;
      return { type: "single", main: R, pw: p, len: 1 };
    }
    if (n === 2 || n === 3) {
      const p = R === tr ? 800 : R >= 15 ? (R === 16 ? 1000 : 900) : R;
      return { type: n === 2 ? "pair" : "trips", main: R, pw: p, len: n };
    }
    if (n >= 4)
      return { type: "bomb", main: R, pw: (R === tr ? 800 : 100 + R) + n * 20, len: n, isBomb: true, big: n };
  }
  if (hasJ && rs.length === 1 && rs[0] >= 15 && W === 0) {
    if (n === 1) return { type: "single", main: rs[0], pw: rs[0] === 16 ? 1000 : 900, len: 1 };
    if (n === 2) return { type: "pair", main: rs[0], pw: rs[0] === 16 ? 1000 : 900, len: 2 };
    if (n >= 4) return { type: "bomb", main: rs[0], pw: 900 + n * 20, len: n, isBomb: true, big: n };
  }
  if (n === 5) {
    const sf = sfOK(cards, tr);
    if (sf) return sf;
    for (let R = 2; R <= 14; R++) {
      if (R >= 15) continue;
      const cR = nm.filter((c) => c.r === R).length;
      const ot = nm.filter((c) => c.r !== R);
      const or = [...new Set(ot.map((c) => c.r))];
      if (hasJ) break;
      if (or.length === 1) {
        const need3 = Math.max(0, 3 - cR);
        const need2 = Math.max(0, 2 - ot.length);
        if (need3 + need2 === W && need3 >= 0)
          return { type: "fullhouse", main: R, pw: R === tr ? 800 : R, len: 5 };
      }
    }
  }
  if (!hasJ) {
    for (const spec of [{ type: "straight", length: 5, per: 1 }, { type: "tube", length: 3, per: 2 }, { type: "plate", length: 2, per: 3 }]) {
      const pattern = sequenceMatch(cards, tr, spec.length, spec.per);
      if (pattern) return { type: spec.type, main: pattern.main, pw: pattern.main, len: n };
    }
  }
  return null;
}
function beats(a, b) {
  if (!b) return !!a;
  if (!a) return false;
  if (a.type === "jokerbomb") return b.type !== "jokerbomb";
  if (a.isBomb && !b.isBomb) return true;
  if (!a.isBomb && b.isBomb) return false;
  if (a.isBomb && b.isBomb) {
    if (a.big !== b.big) return a.big > b.big;
    return a.pw > b.pw;
  }
  if (a.type !== b.type || a.len !== b.len) return false;
  return a.pw > b.pw;
}
function nxSeat(s, f) {
  let i = 0;
  while (i < 4) {
    s = (s + 1) % 4;
    if (!f.includes(s)) return s;
    i++;
  }
  return -1;
}
function tm(s) {
  return s % 2 === 0 ? 0 : 1;
}
function newDeal(tl, tr, random) {
  const d = [];
  for (let k = 0; k < 2; k++) {
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push((r << 3) | s);
    d.push((15 << 3) | 4);
    d.push((16 << 3) | 4);
  }
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = d[i];
    d[i] = d[j];
    d[j] = t;
  }
  const h = [[], [], [], []];
  for (let i = 0; i < 108; i++) h[i % 4].push(d[i]);
  h.forEach((x) => sortCodes(x, tr));
  return {
    teamLevel: tl,
    trumpRank: tr,
    hands: h,
    finishOrder: [],
    trick: { leader: 0, plays: ["", "", "", ""], combo: null, lastSeat: -1, passes: [] },
    turn: 0,
    round: 1,
  };
}
function tribute(nd, fo) {
  const wT = tm(fo[0]);
  const dbl = tm(fo[1]) === wT;
  const prs = dbl
    ? [
        [fo[2], fo[0]],
        [fo[3], fo[1]],
      ]
    : [[fo[3], fo[0]]];
  const tr = nd.trumpRank;
  prs.forEach(function (p) {
    const f = p[0],
      t = p[1],
      hf = nd.hands[f],
      ht = nd.hands[t];
    let gi = 0;
    for (let i = 0; i < hf.length; i++)
      if (pwCode(hf[i], tr) > pwCode(hf[gi], tr)) gi = i;
    const g = hf.splice(gi, 1)[0];
    let ri = ht.length - 1;
    for (let i = ht.length - 1; i >= 0; i--) {
      const r = ht[i] >> 3;
      if (!(r >= 15 || r === tr) && r <= 10) {
        ri = i;
        break;
      }
    }
    const r = ht.splice(ri, 1)[0];
    hf.push(r);
    ht.push(g);
  });
  nd.hands.forEach((h) => sortCodes(h, tr));
  nd.trick.leader = prs[0][1];
  nd.turn = prs[0][1];
  nd.tribute = "Tribute " + prs.map((p) => "S" + (p[0] + 1) + ">S" + (p[1] + 1)).join(",");
}
const MATCH_DEAL_CAP = 4;
function endDeal(ns, random) {
  const fo = ns.finishOrder;
  const w = tm(fo[0]);
  const up = tm(fo[1]) === w ? 3 : tm(fo[2]) === w ? 2 : 1;
  const nl = [ns.teamLevel[0], ns.teamLevel[1]];
  nl[w] += up;
  if (nl[w] > 14) {
    ns.teamLevel = nl;
    ns.winnerTeam = w;
    ns.gameOver = true;
    return ns;
  }
  if ((ns.round || 1) >= MATCH_DEAL_CAP && nl[0] !== nl[1]) {
    ns.teamLevel = nl;
    ns.winnerTeam = nl[0] > nl[1] ? 0 : 1;
    ns.gameOver = true;
    ns.capped = true;
    return ns;
  }
  const nd = newDeal(nl, nl[w], random);
  nd.round = (ns.round || 1) + 1;
  tribute(nd, fo);
  return nd;
}
function advance(ns, me, random) {
  if (ns.hands[me].length === 0 && !ns.finishOrder.includes(me)) ns.finishOrder.push(me);
  if (ns.finishOrder.length >= 3) {
    for (let s = 0; s < 4; s++) if (!ns.finishOrder.includes(s)) ns.finishOrder.push(s);
    return endDeal(ns, random);
  }
  const act = [0, 1, 2, 3].filter((s) => !ns.finishOrder.includes(s));
  const last = ns.trick.lastSeat;
  const oth = act.filter((s) => s !== last);
  const all = last >= 0 && oth.length > 0 && oth.every((s) => ns.trick.passes.includes(s));
  let nx;
  if (all) {
    ns.trick = { leader: last, plays: ["", "", "", ""], combo: null, lastSeat: -1, passes: [] };
    nx = act.includes(last) ? last : nxSeat(last, ns.finishOrder);
    ns.trick.leader = nx;
  } else {
    nx = nxSeat(me, ns.finishOrder);
  }
  ns.turn = nx;
  return ns;
}
// ---- move suggestion (the original client's engine, on {r, s} cards) ----
function idxByHand(hand, tr) {
  const wild = [];
  const by = {};
  hand.forEach((c, i) => {
    if (isWild(c, tr)) wild.push(i);
    else {
      (by[c.r] = by[c.r] || []).push(i);
    }
  });
  return { wild, by };
}
function takeRankM(m, R, need) {
  const nat = (m.by[R] || []).slice(0, need);
  let miss = need - nat.length;
  if (miss < 0) miss = 0;
  if (miss > m.wild.length) return null;
  return nat.concat(m.wild.slice(0, miss));
}
function effPw(R, tr) {
  if (R === 16) return 1000;
  if (R === 15) return 900;
  if (R === tr) return 800;
  return R;
}
function findSflush(hand, tr) {
  let best = null;
  for (let suit = 0; suit < 4; suit++) {
    for (const pattern of sequencePatterns(5)) {
      const idx = buildSequence(hand, tr, pattern.ranks, 1, suit);
      if (!idx) continue;
      const d = detect(idx.map((i) => hand[i]), tr);
      if (d && d.type === "sflush" && (!best || d.pw < best.d.pw)) best = { idx, d };
    }
  }
  return best;
}
function suggestIdx(hand, tr, combo) {
  const m = idxByHand(hand, tr);
  function bombCands(minBig, minPw) {
    const out = [];
    let ranks = [...new Set(hand.filter((c) => !isWild(c, tr) && c.r < 15).map((c) => c.r))];
    ranks.push(tr);
    ranks = [...new Set(ranks)];
    ranks.forEach((R) => {
      const nat = (m.by[R] || []).length;
      for (let L = 4; L <= 10; L++) {
        if (nat + m.wild.length >= L && nat > 0) {
          const pw = (R === tr ? 800 : 100 + R) + L * 20;
          if (L > minBig || (L === minBig && pw > minPw)) {
            const idx = takeRankM(m, R, L);
            if (idx) out.push({ idx, pw, big: L, L });
          }
        }
      }
    });
    const sf = findSflush(hand, tr);
    if (sf && (!combo || beats(sf.d, combo))) out.push({ idx: sf.idx, big: 5.5, pw: 999 });
    const jk = hand.map((c, i) => (c.r >= 15 ? i : -1)).filter((i) => i >= 0);
    if (jk.length >= 4) out.push({ idx: jk.slice(0, 4), big: 100, pw: 1000 });
    out.sort((a, b) => a.big - b.big || a.pw - b.pw);
    return out;
  }
  if (!combo) {
    let bi = hand.length - 1;
    for (let i = 0; i < hand.length; i++) if (pw1(hand[i], tr) < pw1(hand[bi], tr)) bi = i;
    return { idx: [bi], d: detect([hand[bi]], tr) };
  }
  const t = combo.type;
  if (t === "single") {
    const ord = hand.map((c, i) => ({ i, p: pw1(c, tr) })).sort((a, b) => a.p - b.p);
    for (const o of ord) {
      const d = detect([hand[o.i]], tr);
      if (d && beats(d, combo)) return { idx: [o.i], d };
    }
    const b = bombCands(-1, -1)[0];
    return b ? { idx: b.idx, d: detect(b.idx.map((i) => hand[i]), tr) } : null;
  }
  if (t === "pair" || t === "trips") {
    const need = t === "pair" ? 2 : 3;
    const Rs = Object.keys(m.by)
      .map(Number)
      .concat([tr])
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => effPw(a, tr) - effPw(b, tr));
    for (const R of Rs) {
      if (R >= 15) continue;
      if (!(effPw(R, tr) > combo.pw || (R === tr && 800 > combo.pw))) continue;
      const ix = takeRankM(m, R, need);
      if (!ix) continue;
      const d = detect(ix.map((i) => hand[i]), tr);
      if (d && d.type === t && beats(d, combo)) return { idx: ix, d };
    }
    const b = bombCands(-1, -1)[0];
    return b ? { idx: b.idx, d: detect(b.idx.map((i) => hand[i]), tr) } : null;
  }
  if (t === "fullhouse") {
    for (let R = 3; R <= 14; R++) {
      if (R === tr) continue;
      if (effPw(R, tr) <= combo.pw) continue;
      const cR = (m.by[R] || []).length;
      for (let P = 2; P <= 14; P++) {
        if (P === R || P === tr || P >= 15) continue;
        const cP = (m.by[P] || []).length;
        const need3 = Math.max(0, 3 - cR);
        const need2 = Math.max(0, 2 - cP);
        if (need3 + need2 <= m.wild.length && cR + need3 >= 3) {
          const w = m.wild.slice();
          let ix = (m.by[R] || []).slice(0, Math.min(3, cR));
          ix = ix.concat(w.splice(0, Math.max(0, 3 - ix.length)));
          let ix2 = (m.by[P] || []).slice(0, Math.min(2, cP));
          ix2 = ix2.concat(w.splice(0, Math.max(0, 2 - ix2.length)));
          const idx = ix.concat(ix2);
          const d = detect(idx.map((i) => hand[i]), tr);
          if (d && d.type === "fullhouse" && beats(d, combo)) return { idx, d };
        }
      }
    }
    const b = bombCands(-1, -1)[0];
    return b ? { idx: b.idx, d: detect(b.idx.map((i) => hand[i]), tr) } : null;
  }
  if (t === "straight" || t === "tube" || t === "plate") {
    const sug = sequenceBeat(hand, tr, combo);
    if (sug) return sug;
    const b = bombCands(-1, -1)[0];
    return b ? { idx: b.idx, d: detect(b.idx.map((i) => hand[i]), tr) } : null;
  }
  if (combo.isBomb) {
    const b = bombCands(combo.big, combo.pw)[0];
    if (b) return { idx: b.idx, d: detect(b.idx.map((i) => hand[i]), tr) };
    const sf = findSflush(hand, tr);
    if (sf && beats(sf.d, combo)) return { idx: sf.idx, d: sf.d };
    return null;
  }
  return null;
}
function sequenceBeat(hand, tr, combo) {
  const spec = combo.type === "straight" ? { length: 5, per: 1 } : combo.type === "tube" ? { length: 3, per: 2 } : { length: 2, per: 3 };
  for (const pattern of sequencePatterns(spec.length)) {
    if (pattern.main <= combo.main) continue;
    const idx = buildSequence(hand, tr, pattern.ranks, spec.per);
    if (!idx) continue;
    const d = detect(idx.map((i) => hand[i]), tr);
    if (d && d.type === combo.type && beats(d, combo)) return { idx, d };
  }
  return null;
}
// The longest combo in the hand, for leading: shedding cards fast
// is what ends deals (and walks) in reasonable time.
function leadCombo(hand, tr) {
  const m = idxByHand(hand, tr);
  const cands = [];
  function consider(idx) {
    if (!idx || idx.length < 2) return;
    if (new Set(idx).size !== idx.length) return;
    const d = detect(idx.map((i) => hand[i]), tr);
    if (d) cands.push({ idx, d });
  }
  // Use the same patterns as validation, including low A and natural level ranks.
  for (const spec of [{ length: 5, per: 1 }, { length: 3, per: 2 }, { length: 2, per: 3 }]) {
    for (const pattern of sequencePatterns(spec.length)) {
      consider(buildSequence(hand, tr, pattern.ranks, spec.per));
    }
  }
  const sf = findSflush(hand, tr);
  if (sf) consider(sf.idx);
  // full houses
  const ranksByCount = Object.keys(m.by)
    .map(Number)
    .filter((R) => R < 15)
    .sort((a, b) => (m.by[b] || []).length - (m.by[a] || []).length);
  for (const R of ranksByCount) {
    for (const P of ranksByCount) {
      if (P === R) continue;
      const need3 = Math.max(0, 3 - (m.by[R] || []).length);
      const need2 = Math.max(0, 2 - (m.by[P] || []).length);
      if (need3 + need2 > m.wild.length) continue;
      const w = m.wild.slice();
      let ix = (m.by[R] || []).slice(0, 3);
      ix = ix.concat(w.splice(0, Math.max(0, 3 - ix.length)));
      let ix2 = (m.by[P] || []).slice(0, 2);
      ix2 = ix2.concat(w.splice(0, Math.max(0, 2 - ix2.length)));
      consider(ix.concat(ix2));
    }
  }
  // rank groups: bombs (4+), trips, pairs
  for (const R of ranksByCount.concat([tr])) {
    const nat = (m.by[R] || []).length;
    if (nat >= 4) consider(takeRankM(m, R, nat + Math.min(m.wild.length, 2)));
    if (nat + m.wild.length >= 3) consider(takeRankM(m, R, 3));
    if (nat + m.wild.length >= 2) consider(takeRankM(m, R, 2));
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.idx.length - a.idx.length || a.d.pw - b.d.pw);
  return cands[0];
}
function teamPayouts(ctx, winnerTeam) {
  const humans = ctx.players.filter((p) => p.kind === "human");
  const out = {};
  for (const h of humans) out[h.id] = 0;
  if (!humans.length || ctx.pot <= 0) return out;
  let winners = humans.filter((p) => ctx.players.indexOf(p) % 2 === winnerTeam);
  if (!winners.length) winners = humans;
  const share = Math.floor(ctx.pot / winners.length);
  let rem = ctx.pot - share * winners.length;
  for (const h of winners) {
    out[h.id] = share + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
  }
  return out;
}
function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

const game = {
  newMatch(ctx) {
    const state = newDeal([2, 2], 2, ctx.random);
    return { state, turn: [ctx.players[0].id] };
  },

  applyMove(state, playerId, move, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    if (seat < 0) throw new InvalidMove("unknown player");
    if (state.gameOver) throw new InvalidMove("the match is over");
    if (seat !== state.turn) throw new InvalidMove("not your turn");
    if (!move || typeof move !== "object") throw new InvalidMove("bad move");
    if (move.pass) {
      if (!state.trick.combo) throw new InvalidMove("you must lead a play");
    } else if (!Array.isArray(move.cards) || !move.cards.length) {
      throw new InvalidMove("no cards");
    }
    const s = clone(state);
    if (move.pass) {
      s.trick.plays[seat] = "PASS";
      s.trick.passes.push(seat);
    } else {
      const hand = s.hands[seat];
      const codes = [];
      for (const c of move.cards) {
        if (!c || !Number.isInteger(c.r) || !Number.isInteger(c.s))
          throw new InvalidMove("bad card");
        const code = toCode(c);
        const at = hand.indexOf(code);
        if (at < 0) throw new InvalidMove("card not in hand");
        hand.splice(at, 1);
        codes.push(code);
      }
      const d = detect(codes.map(toObj), s.trumpRank);
      if (!d) throw new InvalidMove("invalid combination");
      if (s.trick.combo && !beats(d, s.trick.combo))
        throw new InvalidMove("does not beat the current play");
      s.trick.plays[seat] = codes;
      s.trick.combo = d;
      s.trick.lastSeat = seat;
      s.trick.passes = [];
    }
    const next = advance(s, seat, ctx.random);
    if (next.gameOver)
      return { state: next, turn: null, payouts: teamPayouts(ctx, next.winnerTeam) };
    return { state: next, turn: [ctx.players[next.turn].id] };
  },

  computerMove(state, playerId, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    const hand = state.hands[seat].map(toObj);
    const tr = state.trumpRank;
    if (!state.trick.combo) {
      const lead = leadCombo(hand, tr);
      if (lead) return { cards: lead.idx.map((i) => hand[i]) };
      let bi = hand.length - 1;
      for (let i = 0; i < hand.length; i++) if (pw1(hand[i], tr) < pw1(hand[bi], tr)) bi = i;
      return { cards: [hand[bi]] };
    }
    const s = suggestIdx(hand, tr, state.trick.combo);
    if (s && s.idx && s.idx.length) return { cards: s.idx.map((i) => hand[i]) };
    return { pass: true };
  },

  randomMove(state, playerId, ctx) {
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    const hand = state.hands[seat].map(toObj);
    const tr = state.trumpRank;
    if (state.trick.combo) {
      // Never pass voluntarily: a held-back beat only lengthens the
      // deal (and the walk).
      const s = suggestIdx(hand, tr, state.trick.combo);
      if (s && s.idx && s.idx.length) return { cards: s.idx.map((i) => hand[i]) };
      return { pass: true };
    }
    if (ctx.random() < 0.85) {
      const lead = leadCombo(hand, tr);
      if (lead) return { cards: lead.idx.map((i) => hand[i]) };
    }
    const c = hand[Math.floor(ctx.random() * hand.length)];
    return { cards: [c] };
  },

  viewFor(state, playerId, ctx) {
    // Cards travel as their integer codes (the client decodes them):
    // the view is re-sent for every player after every move, and the
    // object form made each call several times larger.
    const seat = ctx.players.findIndex((p) => p.id === playerId);
    return {
      teamLevel: state.teamLevel,
      trumpRank: state.trumpRank,
      round: state.round,
      hand: seat >= 0 ? state.hands[seat] : [],
      counts: state.hands.map((h) => h.length),
      finishOrder: state.finishOrder,
      trick: state.trick,
      current: state.turn,
      tribute: state.tribute || null,
      winnerTeam: state.winnerTeam != null ? state.winnerTeam : null,
      gameOver: !!state.gameOver,
    };
  },
};
