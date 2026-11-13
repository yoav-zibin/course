// Sample state_changed messages for each translatable built-in game (see translated-games.test.cjs).
const players2 = [{ name: 'Ann', player_index: 0 }, { name: 'Bob', player_index: 1 }];
const base = { status: 'ongoing', move_count: 3, my_player_index: 0, turn_of_player_indices: [0], players: players2 };

const grid = (fill) => Array.from({ length: 10 }, () => Array(10).fill(fill));
const fleet = [['Carrier', 5], ['Battleship', 4], ['Cruiser', 3], ['Submarine', 3], ['Destroyer', 2]]
  .map(([name, size], row) => ({ name, size, cells: Array.from({ length: size }, (_, x) => [x, row * 2]) }));
const attacks = [grid(0), grid(0)];
attacks[1][0][0] = 2; attacks[1][0][1] = 1; attacks[0][0][0] = 2;

const CASES = {
  'audit-batch1/crazy-eights.html': {
    messages: [
      { ...base, view: { hand: [42, 9, 7], playable: [9, 7], top: 22, suit: 0, counts: [3, 3], deckCount: 40, turnIdx: 0, done: false } },
      { ...base, turn_of_player_indices: [1], view: { hand: [1], playable: [], top: 22, suit: 0, counts: [1, 3], deckCount: 40, turnIdx: 1, done: false } },
      { ...base, status: 'over', view: { hand: [], playable: [], top: 22, suit: 0, counts: [0, 3], deckCount: 40, turnIdx: 1, done: true, winner: 0 } },
    ],
  },
  'audit-batch1/battleship.html': {
    messages: [
      { ...base, view: { phase: 'SETUP', boards: [{ ready: false, ships: [] }, { ready: false, ships: [] }], attacks: [grid(0), grid(0)] } },
      { ...base, my_player_index: 1, view: { phase: 'SETUP', boards: [{ ready: false, ships: [] }, { ready: false, ships: [] }], attacks: [grid(0), grid(0)] } },
      { ...base, my_player_index: null, view: { phase: 'SETUP', boards: [{ ready: false, ships: [] }, { ready: false, ships: [] }], attacks: [grid(0), grid(0)] } },
      { ...base, view: { phase: 'BATTLE', turnIdx: 0, boards: [{ ready: true, ships: fleet }, { ready: true, ships: [] }], attacks, last: { x: 0, y: 0, hit: true, by: 1, sunk: 'Destroyer' } } },
      { ...base, view: { phase: 'BATTLE', turnIdx: 1, boards: [{ ready: true, ships: fleet }, { ready: true, ships: [] }], attacks, last: { x: 1, y: 0, hit: false, by: 0 } } },
      { ...base, my_player_index: null, view: { phase: 'BATTLE', turnIdx: 1, boards: [{ ready: true, ships: fleet }, { ready: true, ships: fleet }], attacks } },
      { ...base, status: 'over', view: { phase: 'BATTLE', winnerIdx: 1, boards: [{ ready: true, ships: fleet }, { ready: true, ships: fleet }], attacks } },
      { ...base, status: 'over', view: { phase: 'BATTLE', winnerIdx: 0, boards: [{ ready: true, ships: fleet }, { ready: true, ships: fleet }], attacks } },
    ],
  },

  'audit-batch1/president.html': {
    messages: [
      { ...base, view: { round: 2, target: 6, scores: [1, 2], counts: [3, 4], finished: [], passed: [false, true], pile: [{ r: 5, s: 'H' }, { r: 16, s: '' }], pileCount: 2, pileRank: 14, hand: [{ r: 7, s: 'S' }, { r: 17, s: '' }], lastEvent: 'E1', tradeInfo: 'T1', matchWinner: null } },
      { ...base, view: { round: 2, target: 6, scores: [1, 2], counts: [3, 4], finished: [1, 0], passed: [true, true], pile: [], pileCount: 1, pileRank: 12, hand: [], matchWinner: null } },
      { ...base, turn_of_player_indices: [1], view: { round: 2, target: 6, scores: [1, 2], counts: [3, 4], finished: [], passed: [false, false], pile: [], pileCount: 0, hand: [], matchWinner: null } },
      { ...base, status: 'over', view: { round: 2, target: 6, scores: [6, 2], counts: [0, 4], finished: [0], passed: [false, false], pile: [], pileCount: 0, hand: [], matchWinner: 0 } },
    ],
  },
  'audit-batch1/go-fish.html': {
    messages: [
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob', kind: 'computer' }], view: { deckCount: 12, books: [['7'], ['K', 'Q']], counts: [5, 6], hand: ['A♠', '7♥', '10♦'], log: ['L1', 'L2'], last: { from: 1, to: 0, kind: 'ask', got: 2, rank: '5', newB: ['5'] } } },
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 12, books: [[], []], counts: [0, 6], hand: [], log: [], last: { from: 0, to: 1, kind: 'ask', got: 0, rank: '9', extra: true } } },
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 0, books: [[], []], counts: [0, 6], hand: [], log: [], last: { from: 1, kind: 'pass' } } },
      { ...base, my_player_index: null, players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 1, books: [['2'], []], counts: [3, 6], log: [], last: { from: 1, kind: 'draw' } } },
      { ...base, status: 'over', players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 0, books: [['2'], []], counts: [0, 0], hand: [], winners: [0], log: [] } },
      { ...base, status: 'over', players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 0, books: [['2'], ['3', '4']], counts: [0, 0], hand: [], winners: [1], log: [] } },
    ],
  },
  'audit-batch1/lost-cities.html': {
    messages: [
      { ...base, view: { phase: 'play', deckCount: 30, last: { text: 'L1' }, discards: { red: [{ c: 'red', v: 4 }] }, exps: [{ blue: [{ c: 'blue', v: 3 }] }, {}], hand: [{ c: 'red', v: 3 }, { c: 'blue', v: 8 }], handCounts: [2, 8] } },
      { ...base, view: { phase: 'draw', deckCount: 0, discards: {}, exps: [{}, { green: [{ c: 'green', v: 5 }] }], hand: [], handCounts: [0, 8] } },
      { ...base, turn_of_player_indices: [1], my_player_index: null, view: { phase: 'play', deckCount: 3, discards: {}, exps: [{}, {}], hand: [], handCounts: [8, 8], myIndex: 0 } },
      { ...base, status: 'over', view: { phase: 'over', deckCount: 0, winner: 1, scores: [10, 20], discards: {}, exps: [{ red: [{ c: 'red', v: 5 }] }, {}], hand: [], handCounts: [0, 0] } },
    ],
  },
  'audit-batch1/beat-the-landlord.html': {
    messages: [
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'bid', bidTurn: 0, highBid: 1, bids: [null, 0, 1], bot: [{ r: 3, s: 0 }], landlord: -1, handCounts: [17, 17, 17], hand: [{ r: 3, s: 1 }, { r: 14, s: 0 }] } },
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'play', curSeat: 0, highBid: 2, bids: [1, 2, 0], bot: [{ r: 3, s: 0 }], landlord: 1, handCounts: [17, 20, 17], hand: [{ r: 3, s: 1 }], last: { player: 1, combo: { label: 'x2' }, cards: [{ r: 5, s: 2 }] } } },
      { ...base, turn_of_player_indices: [1], players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'play', curSeat: 2, highBid: 2, bids: [1, 2, 0], bot: [], landlord: 1, handCounts: [17, 20, 17], hand: [{ r: 3, s: 1 }], last: null } },
      { ...base, status: 'over', players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'over', winner: 0, highBid: 2, bids: [1, 2, 0], bot: [], landlord: 1, handCounts: [0, 5, 5], hand: [] } },
      { ...base, status: 'over', players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'over', winner: 1, highBid: 2, bids: [1, 2, 0], bot: [], landlord: 1, handCounts: [3, 0, 5], hand: [] } },
    ],
  },

  'audit-batch2/4-player-chess.html': {
    messages: [
      { ...base, view: { board: { '0,3': { t: 'K', o: 0 }, '13,3': { t: 'Q', o: 2 } }, eliminated: [false, true, false, false], ply: 4, legalMoves: [{ fr: 0, fc: 3, tr: 1, tc: 3 }], checkKings: [], lastMove: { fr: 0, fc: 4, tr: 1, tc: 4 }, inCheck: true, winnerTeam: null } },
      { ...base, view: { board: {}, eliminated: [false, false, false, false], ply: 4, legalMoves: [], checkKings: ['0,3'], inCheck: false, winnerTeam: null } },
      { ...base, turn_of_player_indices: [1, 2], view: { board: {}, eliminated: [false, false, false, false], ply: 4, legalMoves: [], inCheck: false, winnerTeam: null } },
      { ...base, status: 'over', view: { board: {}, eliminated: [false, false, false, false], ply: 24, legalMoves: [], inCheck: false, winnerTeam: 1 } },
      { ...base, status: 'over', view: { board: {}, eliminated: [false, false, false, false], ply: 24, legalMoves: [], inCheck: false, winnerTeam: null } },
    ],
  },
  'audit-batch2/quoridor.html': {
    messages: [
      { ...base, view: { wallsLeft: [9, 10], pawns: [{ r: 8, c: 4 }, { r: 0, c: 4 }], walls: [{ r: 3, c: 3, o: 'H' }], legalMoves: [[7, 4]], turnIdx: 0, winner: null } },
      { ...base, turn_of_player_indices: [1], view: { wallsLeft: [9, 10], pawns: [{ r: 8, c: 4 }, { r: 0, c: 4 }], walls: [], legalMoves: [], turnIdx: 1, winner: null } },
      { ...base, status: 'over', view: { wallsLeft: [9, 10], pawns: [{ r: 0, c: 4 }, { r: 0, c: 5 }], walls: [], legalMoves: [], turnIdx: 1, winner: 0 } },
    ],
  },
  'audit-batch2/blokus.html': {
    messages: [
      { ...base, view: { board: Array.from({ length: 20 }, () => Array(20).fill(-1)), colorOwners: [0, 1, 0, 1], currentPlayer: 0, available: Array.from({ length: 4 }, () => Array(21).fill(true)), scores: [0, 0], playerCount: 2, finished: false } },
      { ...base, turn_of_player_indices: [1], view: { board: Array.from({ length: 20 }, () => Array(20).fill(-1)), colorOwners: [0, 1, 0, 1], currentPlayer: 1, available: Array.from({ length: 4 }, () => Array(21).fill(true)), scores: [5, 3], playerCount: 2, finished: false } },
      { ...base, status: 'over', view: { board: Array.from({ length: 20 }, () => Array(20).fill(-1)), colorOwners: [0, 1, 0, 1], currentPlayer: 1, available: Array.from({ length: 4 }, () => Array(21).fill(false)), scores: [5, 3], playerCount: 2, finished: true, winners: [0] } },
      { ...base, status: 'over', view: { board: Array.from({ length: 20 }, () => Array(20).fill(-1)), colorOwners: [0, 1, 0, 1], currentPlayer: 1, available: Array.from({ length: 4 }, () => Array(21).fill(false)), scores: [4, 4], playerCount: 2, finished: true, winners: [0, 1] } },
    ],
  },
  'audit-batch2/guandan.html': {
    messages: [
      { ...base, players: [{ name: 'Ann', kind: 'human' }, { name: 'Bob', kind: 'computer' }, { name: 'Dee', kind: 'computer' }, { name: 'Eve', kind: 'computer' }], view: { counts: [3, 27, 27, 27], hand: [4 * 8 + 1, 5 * 8 + 2, 16 * 8], teamLevel: [2, 3], trumpRank: 2, finishOrder: [1], trick: { leader: 0, plays: ['', 'PASS', [9 * 8 + 3], [9 * 8]], combo: { type: 'single', main: 9 }, lastSeat: 3, passes: 1 }, current: 0, round: 2, winnerTeam: null, gameOver: false } },
      { ...base, players: [{ name: 'Ann', kind: 'human' }, { name: 'Bob', kind: 'human' }, { name: 'Dee', kind: 'human' }, { name: 'Eve', kind: 'human' }], turn_of_player_indices: [1], view: { counts: [3, 27, 27, 27], hand: [4 * 8 + 1], teamLevel: [14, 3], trumpRank: 14, finishOrder: [], trick: { leader: 0, plays: ['', '', '', ''], combo: null, lastSeat: -1, passes: 0 }, current: 2, round: 1, winnerTeam: null, gameOver: false } },
      { ...base, status: 'over', players: [{ name: 'Ann', kind: 'computer' }, { name: 'Bob', kind: 'computer' }, { name: 'Dee', kind: 'computer' }, { name: 'Eve', kind: 'computer' }], view: { counts: [0, 0, 0, 0], hand: [], teamLevel: [14, 3], trumpRank: 14, finishOrder: [0, 2], trick: { leader: 0, plays: ['', '', '', ''], combo: { type: 'bomb', main: 15 }, lastSeat: 0, passes: 0 }, current: 0, round: 3, winnerTeam: 1, gameOver: true } },
    ],
  },
  'audit-batch2/mini-golf-duels.html': {
    messages: [
      { ...base, players: [{ name: 'Ann', kind: 'human' }, { name: 'Bob', kind: 'human' }], view: { hole: 1, pos: [[80, 200], [90, 200]], sunk: [false, true], cur: [1, 2], tot: [3, 4], hist: [[], []], par: 3, course: { par: 3, port: { a: {}, b: {} }, fair: [], sands: [], ices: [], walls: [], cup: [500, 200] } } },
      { ...base, turn_of_player_indices: [1], view: { hole: 0, pos: [[80, 200], [90, 200]], sunk: [false, false], cur: [0, 0], tot: [0, 0], hist: [[], []], par: 2, course: { par: 2, port: null, fair: [], sands: [], ices: [], walls: [], cup: [500, 200] } } },
      { ...base, status: 'over', view: { hole: 4, pos: [[80, 200], [90, 200]], sunk: [true, true], cur: [1, 2], tot: [9, 12], hist: [[1, 2], [3, 4]], par: 3, winner: 0, course: { par: 3, port: null, fair: [], sands: [], ices: [], walls: [], cup: [500, 200] } } },
      { ...base, status: 'over', view: { hole: 4, pos: [[80, 200], [90, 200]], sunk: [true, true], cur: [1, 2], tot: [9, 9], hist: [[], []], par: 3, winner: -1, course: { par: 3, port: null, fair: [], sands: [], ices: [], walls: [], cup: [500, 200] } } },
    ],
  },
  'audit-batch2/3-minute-chess.html': (() => {
    const row = (...cells) => cells.map((c) => c || null);
    const board = [row('bR', 'bN', 'bB', 'bQ', 'bK', 'bB', 'bN', 'bR'), row('bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP'), row(), row(), row(), row(), row('wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP'), row('wR', 'wN', 'wB', 'wQ', 'wK', 'wB', 'wN', 'wR')].map((r) => (r.length === 8 ? r : Array(8).fill(null)));
    const view = { board, castling: { K: true, Q: true, k: true, q: true }, ep: null, side: 'w', winner: null, wMs: 150000, bMs: 90000, stamp: Date.now(), history: ['e4', 'e5', 'Nf3'], lastMove: { fr: 6, fc: 4, tr: 4, tc: 4 } };
    return {
      messages: [
        { ...base, view },
        { ...base, turn_of_player_indices: [1], view: { ...view, side: 'b' } },
        { ...base, status: 'over', view: { ...view, winner: 0, reason: 'R1' } },
        { ...base, status: 'over', view: { ...view, winner: -1, reason: 'R1' } },
        { ...base, status: 'over', view: { ...view, winner: null } },
      ],
    };
  })(),

  'audit-batch3/reversi.html': {
    messages: [
      { ...base, view: { board: [...Array(27).fill(null), 1, 0, ...Array(35).fill(null)], turn: [0], done: false, winner: null, legalMoves: [19, 26], black: 2, white: 1 } },
      { ...base, turn_of_player_indices: [1], view: { board: Array(64).fill(null), turn: [1], done: false, winner: null, legalMoves: [], black: 2, white: 2 } },
      { ...base, status: 'over', view: { board: Array(64).fill(0), turn: [0], done: true, winner: 0, legalMoves: [], black: 64, white: 0 } },
      { ...base, status: 'over', view: { board: Array(64).fill(1), turn: [0], done: true, winner: null, legalMoves: [], black: 32, white: 32 } },
    ],
  },
  'audit-batch3/ers.html': {
    messages: [
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob', kind: 'computer' }], view: { pile: [{ r: 5, s: 'H' }, { r: 99, s: '' }, { r: 12, s: 'S' }, { r: 4, s: 'C' }, { r: 3, s: 'D' }, { r: 14, s: 'S' }], counts: [20, 26], flipper: 0, challenge: { by: 1, left: 2 }, winner: null, log: ['L1'] } },
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }], view: { pile: [], counts: [20, 26], flipper: 1, winner: null, log: [] } },
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }], view: { pile: [{ r: 5, s: 'H' }], counts: [20, 26], flipper: 1, slap: { reason: 'R1' }, winner: null, log: [] } },
      { ...base, status: 'over', players: [{ name: 'Ann' }, { name: 'Bob' }], view: { pile: [], counts: [52, 0], flipper: 0, winner: 0, log: [] } },
    ],
  },
  'audit-batch3/brazilian-truco.html': {
    messages: [
      { ...base, view: { hand_no: 2, scores: [3, 6], value: 3, turned: '5D', tricks: [{ side: -1, seat: 0 }, { side: 0, seat: 2 }], last_hand: { side: 0, points: 3, how: 'H1' }, raise_log: { value: 3, result: 'R1' }, hand_counts: [3, 3], trick: [{ seat: 1, card: '7H' }], hand: ['4C', '6D'], raise: null, can_raise: true, winner: null } },
      { ...base, view: { hand_no: 2, scores: [3, 6], value: 3, turned: '5D', tricks: [], last_hand: { side: null, how: 'H2' }, hand_counts: [3, 3], trick: [], hand: ['4C'], raise: { to: 6 }, can_raise: false, winner: null } },
      { ...base, turn_of_player_indices: [1, 3], view: { hand_no: 1, scores: [0, 0], value: 1, turned: 'KS', tricks: [], hand_counts: [3, 3], trick: [], hand: [], winner: null } },
      { ...base, status: 'over', view: { hand_no: 5, scores: [12, 3], value: 1, turned: 'KS', tricks: [], hand_counts: [0, 0], trick: [], hand: [], winner: 0 } },
      { ...base, status: 'over', view: { hand_no: 5, scores: [3, 12], value: 1, turned: 'KS', tricks: [], hand_counts: [0, 0], trick: [], hand: [], winner: 1 } },
    ],
  },
  'audit-batch3/six-card-golf.html': (() => {
    const hand = (up) => Array.from({ length: 6 }, (_, i) => ({ r: i + 1, s: i % 4, up: up > i }));
    const view = { phase: 'play', hands: [hand(2), hand(6)], cur: 0, flipTurnIdx: 0, stockCount: 30, discard: [{ r: 9, s: 1 }], drew: null, log: 'L1', scores: [10, 12], lastChance: false };
    return {
      messages: [
        { ...base, view: { ...view, phase: 'flip', hands: [hand(0), hand(0)] } },
        { ...base, view },
        { ...base, view: { ...view, drew: { r: 4, s: 2, from: 'stock' }, lastChance: true, knocker: 1 } },
        { ...base, my_player_index: 1, view: { ...view, drew: { hidden: true, from: 'stock' } } },
        { ...base, turn_of_player_indices: [1], view },
        { ...base, status: 'over', view: { ...view, phase: 'over', scores: [8, 8] } },
        { ...base, status: 'over', view: { ...view, phase: 'over', scores: [5, 8] } },
      ],
    };
  })(),

  'audit-batch3/backgammon.html': (() => {
    const owner = Array(24).fill(-1), cnt = Array(24).fill(0);
    owner[23] = 0; cnt[23] = 2; owner[0] = 1; cnt[0] = 2; owner[12] = 0; cnt[12] = 7;
    const view = { owner, cnt, bar: [1, 0], off: [2, 3], cur: 0, dice: [3, 4], moves: [3, 4], needRoll: false, winner: null, legalMoves: [{ from: 23, to: 20, die: 3 }] };
    return {
      messages: [
        { ...base, view },
        { ...base, view: { ...view, needRoll: true, dice: [], moves: [] } },
        { ...base, view: { ...view, legalMoves: [] } },
        { ...base, my_player_index: 1, view: { ...view, cur: 1 } },
        { ...base, turn_of_player_indices: [1], view },
        { ...base, status: 'over', view: { ...view, winner: 0, off: [15, 4] } },
      ],
    };
  })(),

  'audit-batch3/backgammon-copy.html': (() => {
    const owner = Array(24).fill(-1), cnt = Array(24).fill(0);
    owner[23] = 0; cnt[23] = 2; owner[0] = 1; cnt[0] = 2; owner[12] = 0; cnt[12] = 7;
    const view = { owner, cnt, bar: [1, 0], off: [2, 3], cur: 0, dice: [3, 4], moves: [3, 4], needRoll: false, winner: null, legalMoves: [{ from: 23, to: 20, die: 3 }] };
    return {
      messages: [
        { ...base, view },
        { ...base, view: { ...view, needRoll: true, dice: [], moves: [] } },
        { ...base, view: { ...view, legalMoves: [] } },
        { ...base, my_player_index: 1, view: { ...view, cur: 1 } },
        { ...base, turn_of_player_indices: [1], view },
        { ...base, status: 'over', view: { ...view, winner: 0, off: [15, 4] } },
      ],
    };
  })(),

  'audit-batch4/blackjack-table.html': (() => {
    const card = (r, s) => ({ r, s });
    const view = { phase: 'play', customNames: ['', ''], round: 3, deckCount: 40, chips: [900, 750], dealer: [card(1, 'S'), card(10, 'H')], holeHidden: true, hands: [[{ cards: [card(8, 'C'), card(8, 'D')], bet: 50, done: false }], []], results: ['', 'R1'], pendingBets: {}, needBet: [false, false], curP: 0, curH: 0, winners: null, freshMsg: 'F1' };
    return {
      messages: [
        { ...base, view },
        { ...base, view: { ...view, phase: 'setup', hands: [], dealer: [] } },
        { ...base, view: { ...view, phase: 'betting', pendingBets: { 0: 25 }, needBet: [true, true], hands: [[], []], dealer: [] } },
        { ...base, view: { ...view, phase: 'roundOver', holeHidden: false } },
        { ...base, turn_of_player_indices: [1], view: { ...view, phase: 'betting', hands: [[], []], dealer: [] } },
        { ...base, status: 'over', view: { ...view, phase: 'gameOver', winners: 0, holeHidden: false } },
      ],
    };
  })(),
  'audit-batch4/checkers.html': (() => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(null));
    board[5][0] = { c: 0, k: false }; board[2][1] = { c: 1, k: true };
    const view = { board, toMove: 0, moves: [{ from: { r: 5, c: 0 }, to: { r: 4, c: 1 }, cap: false }], lastMove: { from: { r: 2, c: 3 }, to: { r: 3, c: 2 } }, winner: null, draw: false };
    return {
      messages: [
        { ...base, view },
        { ...base, view: { ...view, chain: { r: 5, c: 0 }, moves: [{ from: { r: 5, c: 0 }, to: { r: 3, c: 2 }, cap: true }] } },
        { ...base, turn_of_player_indices: [1], view: { ...view, toMove: 1 } },
        { ...base, my_player_index: 1, turn_of_player_indices: [1], view: { ...view, toMove: 1 } },
        { ...base, status: 'over', view: { ...view, winner: 1 } },
        { ...base, status: 'over', view: { ...view, draw: true } },
        { ...base, status: 'over', view: { ...view } },
      ],
    };
  })(),
  'audit-batch4/mancala.html': (() => {
    const view = { pits: [4, 4, 4, 4, 4, 4, 4, 4, 11, 4, 4, 4], stores: [3, 5], lastPos: 'p3', lastPlayer: 0, extraTurn: false, captured: 0, winner: null, gameOver: false };
    return {
      messages: [
        { ...base, view },
        { ...base, view: { ...view, extraTurn: true, lastPos: 's0', captured: 0 } },
        { ...base, view: { ...view, lastPos: 'p2', captured: 6 } },
        { ...base, my_player_index: 1, turn_of_player_indices: [1], view },
        { ...base, my_player_index: null, view },
        { ...base, turn_of_player_indices: [1], view },
        { ...base, status: 'over', view: { ...view, gameOver: true, winner: 1 } },
        { ...base, status: 'over', view: { ...view, gameOver: true, winner: -1 } },
        { ...base, status: 'over', view: { ...view, gameOver: true, winner: null } },
      ],
    };
  })(),
  'audit-batch4/hearts.html': (() => {
    const players = [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Dee' }, { name: 'Eve' }];
    const view = { phase: 'play', cur: 0, taken: [0, 3, 0, 2], trickNum: 0, heartsBroken: false, trick: [{ player: 1, card: '2C' }], counts: [13, 12, 13, 13], hand: ['3C', '4H'], legal: ['3C'], shooter: -1 };
    return {
      messages: [
        { ...base, players, view },
        { ...base, players, view: { ...view, trickNum: 4, heartsBroken: true, trick: [] } },
        { ...base, players, turn_of_player_indices: [1], view: { ...view, cur: 2 } },
        { ...base, players, my_player_index: null, view },
        { ...base, players, status: 'over', view: { ...view, phase: 'over', taken: [0, 26, 0, 0], shooter: 1, trick: [], hand: [] } },
        { ...base, players, status: 'over', view: { ...view, phase: 'over', taken: [5, 0, 8, 13], shooter: -1, trick: [], hand: [] } },
      ],
    };
  })(),
  'audit-batch4/cheat-bs.html': (() => {
    const players = [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Dee' }];
    const view = { reqRank: 3, current: 0, phase: 'play', pending: null, lastResult: { text: 'L1', bluff: true, cards: [4, 9] }, pileCount: 6, counts: [5, 6, 7], myHand: [8, 1, 12], winner: null };
    return {
      messages: [
        { ...base, players, view },
        { ...base, players, view: { ...view, lastResult: null, pileCount: 0 } },
        { ...base, players, turn_of_player_indices: [1], my_player_index: 1, view: { ...view, phase: 'challenge', current: 1, pending: { player: 0, count: 2, claimed: 3 }, lastResult: null } },
        { ...base, players, my_player_index: null, view },
        { ...base, players, status: 'over', view: { ...view, winner: 1 } },
        { ...base, players, status: 'over', view: { ...view, winner: null } },
      ],
    };
  })(),
  'audit-batch4/rummy-500.html': (() => {
    const players = [{ name: 'Ann', kind: 'human' }, { name: 'Bob', kind: 'computer' }];
    const c = (id, r, s) => ({ id, r, s });
    const view = { roundNum: 2, dealer: 1, phase: 'draw', pending: null, ban: null, log: 'L1', scores: [40, 60], roundScores: [10, -5], deckCount: 20, discard: [c(1, 5, 'H'), c(2, 0, null)], melds: [{ id: 'M1', owner: 1, cards: [c(3, 7, 'S'), c(4, 7, 'H'), c(5, 7, 'D')], exts: [{ card: c(6, 7, 'C'), by: 0 }] }], counts: [7, 8], hand: [c(10, 3, 'S'), c(11, 12, 'D')], matchWinner: null, endReason: null };
    return {
      messages: [
        { ...base, players, view },
        { ...base, players, view: { ...view, phase: 'play', pending: 1, ban: 2, roundScores: null } },
        { ...base, players, view: { ...view, deckCount: 0 } },
        { ...base, players, turn_of_player_indices: [1], my_player_index: 0, view: { ...view, phase: 'play' } },
        { ...base, players, my_player_index: null, view: { ...view, melds: [] , discard: [] } },
        { ...base, players, view: { ...view, phase: 'roundOver', endReason: 'went out' } },
        { ...base, players, turn_of_player_indices: [1], view: { ...view, phase: 'roundOver', endReason: 'stock' } },
        { ...base, players, status: 'over', view: { ...view, matchWinner: 0, phase: 'roundOver' } },
      ],
    };
  })(),

  'audit-batch5/chess.html': (() => {
    const bd = [-4, -2, -3, -5, -6, -3, -2, -4, ...Array(8).fill(-1), ...Array(32).fill(0), ...Array(8).fill(1), 4, 2, 3, 5, 6, 3, 2, 4];
    const view = { bd, toMove: 'w', castling: { K: true, Q: true, k: true, q: true }, ep: null, half: 0, full: 1, winner: null, reason: null, history: ['e4', 'e5', 'Nf3'], lastMove: { fr: 6, fc: 4, tr: 4, tc: 4 } };
    return {
      messages: [
        { ...base, view },
        { ...base, my_player_index: 1, turn_of_player_indices: [1], view: { ...view, toMove: 'b' } },
        { ...base, players: [{ name: 'Ann', kind: 'human' }, { name: 'Bob', kind: 'computer' }], my_player_index: 0, turn_of_player_indices: [1], view: { ...view, toMove: 'b' } },
        { ...base, turn_of_player_indices: [1], view },
        { ...base, status: 'over', view: { ...view, winner: 1, reason: 'R1' } },
        { ...base, status: 'over', view: { ...view, winner: -1, reason: 'R1' } },
        { ...base, status: 'over', view: { ...view, winner: null } },
      ],
    };
  })(),
  'audit-batch5/spades.html': (() => {
    const players = [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Dee' }, { name: 'Eve' }];
    const view = { tricksWon: [1, 2, 0, 3], aiMode: 'smart', trick: [{ seat: 1, card: '10S' }, { seat: 2, card: '3H' }], pendingWin: null, lastWin: 3, over: false, hand: ['10S', '3H', '14D'], counts: [3, 4, 5, 6] };
    return {
      messages: [
        { ...base, players, view },
        { ...base, players, turn_of_player_indices: [2], view: { ...view, aiMode: 'random', trick: [] } },
        { ...base, players, view: { ...view, pendingWin: 1 } },
        { ...base, players, my_player_index: null, view: { ...view, lastWin: null } },
        { ...base, players, status: 'over', view: { ...view, over: true, tricksWon: [3, 9, 0, 1] } },
        { ...base, players, status: 'over', view: { ...view, over: true, tricksWon: [6, 6, 0, 1] } },
      ],
    };
  })(),
  'audit-batch5/guess-who.html': (() => {
    const view = { hist: [{ by: 0, q: 0, ans: true }, { by: 1, q: 3, ans: false }, { by: 0, guess: 3, correct: false }, { by: 1, guess: 4, correct: true }], mySecret: 2, oppSecret: 5, winner: null };
    return {
      // The 24 characters' first names are names, like the players' (not translated).
      allowed: ['Ava', 'Ben', 'Cleo', 'Dan', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivan', 'Jade', 'Kai', 'Lena', 'Max', 'Nora', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Umar', 'Vera', 'Will', 'Yuki'],
      messages: [
        { ...base, view: { ...view, hist: [] } },
        { ...base, view },
        { ...base, my_player_index: null, view },
        { ...base, turn_of_player_indices: [1], view },
        { ...base, status: 'over', view: { ...view, winner: 0, reveal: [2, 5] } },
        { ...base, status: 'over', view: { ...view, winner: 1 } },
        { ...base, status: 'over', view: { ...view, winner: null, oppSecret: undefined } },
      ],
    };
  })(),

  'playroom/dots-and-boxes.html': {
    messages: [
      { ...base, token_pot: 0, state: null },
      { ...base, state: { edges: [0, ...Array(23).fill(null)], boxes: [0, 1, ...Array(7).fill(null)], turn: 0, winner: null, done: false } },
      { ...base, turn_of_player_indices: [1], state: { edges: Array(24).fill(null), boxes: Array(9).fill(null), turn: 1, winner: null, done: false } },
      { ...base, status: 'over', state: { edges: Array(24).fill(0), boxes: Array(9).fill(0), turn: 0, winner: 0, done: true } },
      { ...base, status: 'over', state: { edges: Array(24).fill(0), boxes: Array(9).fill(0), turn: 0, winner: null, done: true } },
      { ...base, status: 'over', state: { edges: Array(24).fill(null), boxes: Array(9).fill(null), turn: 0, winner: null, done: false } },
    ],
  },
  'playroom/reversi.html': {
    messages: [
      { ...base, state: null },
      { ...base, state: { board: [...Array(27).fill(null), 1, 0, ...Array(7).fill(null), 0, 1, ...Array(27).fill(null)], turn: 0, done: false, winner: null } },
      { ...base, turn_of_player_indices: [1], state: { board: Array(64).fill(null), turn: 1, done: false, winner: null } },
      { ...base, status: 'over', state: { board: Array(64).fill(0), turn: 0, done: true, winner: 0 } },
      { ...base, status: 'over', state: { board: Array(64).fill(1), turn: 0, done: true, winner: null } },
    ],
  },
  'playroom/crazy-eights.html': {
    messages: [
      { ...base, state: null },
      { ...base, state: { hands: [[1, 2, 20], [3, 4, 5]], deck: [9, 10], discard: [7], suit: 0, turn: 0, done: false, winner: null, passes: 0 } },
      { ...base, my_player_index: null, state: { hands: [[1], [3]], deck: [9], discard: [7], suit: 1, turn: 1, done: false, winner: null, passes: 0 } },
      { ...base, status: 'over', state: { hands: [[], [3]], deck: [], discard: [7], suit: 1, turn: 0, done: true, winner: 0, passes: 0 } },
    ],
  },
};
module.exports = { CASES, players2, base, grid };
