// Sample state_changed messages for each translatable built-in game (see translated-games.test.cjs).
const players2 = [{ name: 'Ann', player_index: 0 }, { name: 'Bob', player_index: 1 }];
const base = { status: 'ongoing', move_count: 3, my_player_index: 0, acting_for_player_index: 0, turn_of_player_indices: [0], players: players2 };

const grid = (fill) => Array.from({ length: 10 }, () => Array(10).fill(fill));
const fleet = [['Carrier', 5], ['Battleship', 4], ['Cruiser', 3], ['Submarine', 3], ['Destroyer', 2]]
  .map(([name, size], row) => ({ name, size, cells: Array.from({ length: size }, (_, x) => [x, row * 2]) }));
const attacks = [grid(0), grid(0)];
attacks[1][0][0] = 2; attacks[1][0][1] = 1; attacks[0][0][0] = 2;

const CASES = {
  'audit-batch1/crazy-eights.html': {
    messages: [
      { ...base, view: { hand: [42, 9, 7], playable: [9, 7], top: 22, suit: 0, counts: [3, 3], deckCount: 40, turnIdx: 0, done: false } },
      { ...base, acting_for_player_index: null, view: { hand: [1], playable: [], top: 22, suit: 0, counts: [1, 3], deckCount: 40, turnIdx: 1, done: false } },
      { ...base, status: 'over', view: { hand: [], playable: [], top: 22, suit: 0, counts: [0, 3], deckCount: 40, turnIdx: 1, done: true, winner: 0 } },
    ],
  },
  'audit-batch1/battleship.html': {
    messages: [
      { ...base, view: { phase: 'SETUP', boards: [{ ready: false, ships: [] }, { ready: false, ships: [] }], attacks: [grid(0), grid(0)] } },
      { ...base, my_player_index: 1, view: { phase: 'SETUP', boards: [{ ready: false, ships: [] }, { ready: false, ships: [] }], attacks: [grid(0), grid(0)] } },
      { ...base, my_player_index: null, acting_for_player_index: null, view: { phase: 'SETUP', boards: [{ ready: false, ships: [] }, { ready: false, ships: [] }], attacks: [grid(0), grid(0)] } },
      { ...base, view: { phase: 'BATTLE', turnIdx: 0, boards: [{ ready: true, ships: fleet }, { ready: true, ships: [] }], attacks, last: { x: 0, y: 0, hit: true, by: 1, sunk: 'Destroyer' } } },
      { ...base, view: { phase: 'BATTLE', turnIdx: 1, boards: [{ ready: true, ships: fleet }, { ready: true, ships: [] }], attacks, last: { x: 1, y: 0, hit: false, by: 0 } } },
      { ...base, my_player_index: null, acting_for_player_index: null, view: { phase: 'BATTLE', turnIdx: 1, boards: [{ ready: true, ships: fleet }, { ready: true, ships: fleet }], attacks } },
      { ...base, status: 'over', view: { phase: 'BATTLE', winnerIdx: 1, boards: [{ ready: true, ships: fleet }, { ready: true, ships: fleet }], attacks } },
      { ...base, status: 'over', view: { phase: 'BATTLE', winnerIdx: 0, boards: [{ ready: true, ships: fleet }, { ready: true, ships: fleet }], attacks } },
    ],
  },

  'audit-batch1/president.html': {
    messages: [
      { ...base, view: { round: 2, target: 6, scores: [1, 2], counts: [3, 4], finished: [], passed: [false, true], pile: [{ r: 5, s: 'H' }, { r: 16, s: '' }], pileCount: 2, pileRank: 14, hand: [{ r: 7, s: 'S' }, { r: 17, s: '' }], lastEvent: 'E1', tradeInfo: 'T1', matchWinner: null } },
      { ...base, view: { round: 2, target: 6, scores: [1, 2], counts: [3, 4], finished: [1, 0], passed: [true, true], pile: [], pileCount: 1, pileRank: 12, hand: [], matchWinner: null } },
      { ...base, acting_for_player_index: null, turn_of_player_indices: [1], view: { round: 2, target: 6, scores: [1, 2], counts: [3, 4], finished: [], passed: [false, false], pile: [], pileCount: 0, hand: [], matchWinner: null } },
      { ...base, status: 'over', view: { round: 2, target: 6, scores: [6, 2], counts: [0, 4], finished: [0], passed: [false, false], pile: [], pileCount: 0, hand: [], matchWinner: 0 } },
    ],
  },
  'audit-batch1/go-fish.html': {
    messages: [
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob', kind: 'computer' }], view: { deckCount: 12, books: [['7'], ['K', 'Q']], counts: [5, 6], hand: ['A♠', '7♥', '10♦'], log: ['L1', 'L2'], last: { from: 1, to: 0, kind: 'ask', got: 2, rank: '5', newB: ['5'] } } },
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 12, books: [[], []], counts: [0, 6], hand: [], log: [], last: { from: 0, to: 1, kind: 'ask', got: 0, rank: '9', extra: true } } },
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 0, books: [[], []], counts: [0, 6], hand: [], log: [], last: { from: 1, kind: 'pass' } } },
      { ...base, my_player_index: null, acting_for_player_index: null, players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 1, books: [['2'], []], counts: [3, 6], log: [], last: { from: 1, kind: 'draw' } } },
      { ...base, status: 'over', players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 0, books: [['2'], []], counts: [0, 0], hand: [], winners: [0], log: [] } },
      { ...base, status: 'over', players: [{ name: 'Ann' }, { name: 'Bob' }], view: { deckCount: 0, books: [['2'], ['3', '4']], counts: [0, 0], hand: [], winners: [1], log: [] } },
    ],
  },
  'audit-batch1/lost-cities.html': {
    messages: [
      { ...base, view: { phase: 'play', deckCount: 30, last: { text: 'L1' }, discards: { red: [{ c: 'red', v: 4 }] }, exps: [{ blue: [{ c: 'blue', v: 3 }] }, {}], hand: [{ c: 'red', v: 3 }, { c: 'blue', v: 8 }], handCounts: [2, 8] } },
      { ...base, view: { phase: 'draw', deckCount: 0, discards: {}, exps: [{}, { green: [{ c: 'green', v: 5 }] }], hand: [], handCounts: [0, 8] } },
      { ...base, acting_for_player_index: null, turn_of_player_indices: [1], my_player_index: null, view: { phase: 'play', deckCount: 3, discards: {}, exps: [{}, {}], hand: [], handCounts: [8, 8], myIndex: 0 } },
      { ...base, status: 'over', view: { phase: 'over', deckCount: 0, winner: 1, scores: [10, 20], discards: {}, exps: [{ red: [{ c: 'red', v: 5 }] }, {}], hand: [], handCounts: [0, 0] } },
    ],
  },
  'audit-batch1/beat-the-landlord.html': {
    messages: [
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'bid', bidTurn: 0, highBid: 1, bids: [null, 0, 1], bot: [{ r: 3, s: 0 }], landlord: -1, handCounts: [17, 17, 17], hand: [{ r: 3, s: 1 }, { r: 14, s: 0 }] } },
      { ...base, players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'play', curSeat: 0, highBid: 2, bids: [1, 2, 0], bot: [{ r: 3, s: 0 }], landlord: 1, handCounts: [17, 20, 17], hand: [{ r: 3, s: 1 }], last: { player: 1, combo: { label: 'x2' }, cards: [{ r: 5, s: 2 }] } } },
      { ...base, acting_for_player_index: null, players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'play', curSeat: 2, highBid: 2, bids: [1, 2, 0], bot: [], landlord: 1, handCounts: [17, 20, 17], hand: [{ r: 3, s: 1 }], last: null } },
      { ...base, status: 'over', players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'over', winner: 0, highBid: 2, bids: [1, 2, 0], bot: [], landlord: 1, handCounts: [0, 5, 5], hand: [] } },
      { ...base, status: 'over', players: [{ name: 'Ann' }, { name: 'Bob' }, { name: 'Cy' }], view: { phase: 'over', winner: 1, highBid: 2, bids: [1, 2, 0], bot: [], landlord: 1, handCounts: [3, 0, 5], hand: [] } },
    ],
  },

  'audit-batch2/4-player-chess.html': {
    messages: [
      { ...base, view: { board: { '0,3': { t: 'K', o: 0 }, '13,3': { t: 'Q', o: 2 } }, eliminated: [false, true, false, false], ply: 4, legalMoves: [{ fr: 0, fc: 3, tr: 1, tc: 3 }], checkKings: [], lastMove: { fr: 0, fc: 4, tr: 1, tc: 4 }, inCheck: true, winnerTeam: null } },
      { ...base, view: { board: {}, eliminated: [false, false, false, false], ply: 4, legalMoves: [], checkKings: ['0,3'], inCheck: false, winnerTeam: null } },
      { ...base, acting_for_player_index: null, turn_of_player_indices: [1, 2], view: { board: {}, eliminated: [false, false, false, false], ply: 4, legalMoves: [], inCheck: false, winnerTeam: null } },
      { ...base, status: 'over', view: { board: {}, eliminated: [false, false, false, false], ply: 24, legalMoves: [], inCheck: false, winnerTeam: 1 } },
      { ...base, status: 'over', view: { board: {}, eliminated: [false, false, false, false], ply: 24, legalMoves: [], inCheck: false, winnerTeam: null } },
    ],
  },
  'audit-batch2/quoridor.html': {
    messages: [
      { ...base, view: { wallsLeft: [9, 10], pawns: [{ r: 8, c: 4 }, { r: 0, c: 4 }], walls: [{ r: 3, c: 3, o: 'H' }], legalMoves: [[7, 4]], turnIdx: 0, winner: null } },
      { ...base, acting_for_player_index: null, view: { wallsLeft: [9, 10], pawns: [{ r: 8, c: 4 }, { r: 0, c: 4 }], walls: [], legalMoves: [], turnIdx: 1, winner: null } },
      { ...base, status: 'over', view: { wallsLeft: [9, 10], pawns: [{ r: 0, c: 4 }, { r: 0, c: 5 }], walls: [], legalMoves: [], turnIdx: 1, winner: 0 } },
    ],
  },
  'audit-batch2/blokus.html': {
    messages: [
      { ...base, view: { board: Array.from({ length: 20 }, () => Array(20).fill(-1)), colorOwners: [0, 1, 0, 1], currentPlayer: 0, available: Array.from({ length: 4 }, () => Array(21).fill(true)), scores: [0, 0], playerCount: 2, finished: false } },
      { ...base, acting_for_player_index: null, view: { board: Array.from({ length: 20 }, () => Array(20).fill(-1)), colorOwners: [0, 1, 0, 1], currentPlayer: 1, available: Array.from({ length: 4 }, () => Array(21).fill(true)), scores: [5, 3], playerCount: 2, finished: false } },
      { ...base, status: 'over', view: { board: Array.from({ length: 20 }, () => Array(20).fill(-1)), colorOwners: [0, 1, 0, 1], currentPlayer: 1, available: Array.from({ length: 4 }, () => Array(21).fill(false)), scores: [5, 3], playerCount: 2, finished: true, winners: [0] } },
      { ...base, status: 'over', view: { board: Array.from({ length: 20 }, () => Array(20).fill(-1)), colorOwners: [0, 1, 0, 1], currentPlayer: 1, available: Array.from({ length: 4 }, () => Array(21).fill(false)), scores: [4, 4], playerCount: 2, finished: true, winners: [0, 1] } },
    ],
  },
  'audit-batch2/guandan.html': {
    messages: [
      { ...base, players: [{ name: 'Ann', kind: 'human' }, { name: 'Bob', kind: 'computer' }, { name: 'Dee', kind: 'computer' }, { name: 'Eve', kind: 'computer' }], view: { counts: [3, 27, 27, 27], hand: [4 * 8 + 1, 5 * 8 + 2, 16 * 8], teamLevel: [2, 3], trumpRank: 2, finishOrder: [1], trick: { leader: 0, plays: ['', 'PASS', [9 * 8 + 3], [9 * 8]], combo: { type: 'single', main: 9 }, lastSeat: 3, passes: 1 }, current: 0, round: 2, winnerTeam: null, gameOver: false } },
      { ...base, players: [{ name: 'Ann', kind: 'human' }, { name: 'Bob', kind: 'human' }, { name: 'Dee', kind: 'human' }, { name: 'Eve', kind: 'human' }], acting_for_player_index: null, view: { counts: [3, 27, 27, 27], hand: [4 * 8 + 1], teamLevel: [14, 3], trumpRank: 14, finishOrder: [], trick: { leader: 0, plays: ['', '', '', ''], combo: null, lastSeat: -1, passes: 0 }, current: 2, round: 1, winnerTeam: null, gameOver: false } },
      { ...base, status: 'over', players: [{ name: 'Ann', kind: 'computer' }, { name: 'Bob', kind: 'computer' }, { name: 'Dee', kind: 'computer' }, { name: 'Eve', kind: 'computer' }], view: { counts: [0, 0, 0, 0], hand: [], teamLevel: [14, 3], trumpRank: 14, finishOrder: [0, 2], trick: { leader: 0, plays: ['', '', '', ''], combo: { type: 'bomb', main: 15 }, lastSeat: 0, passes: 0 }, current: 0, round: 3, winnerTeam: 1, gameOver: true } },
    ],
  },
  'audit-batch2/mini-golf-duels.html': {
    messages: [
      { ...base, players: [{ name: 'Ann', kind: 'human' }, { name: 'Bob', kind: 'human' }], view: { hole: 1, pos: [[80, 200], [90, 200]], sunk: [false, true], cur: [1, 2], tot: [3, 4], hist: [[], []], par: 3, course: { par: 3, port: { a: {}, b: {} }, fair: [], sands: [], ices: [], walls: [], cup: [500, 200] } } },
      { ...base, acting_for_player_index: 1, view: { hole: 0, pos: [[80, 200], [90, 200]], sunk: [false, false], cur: [0, 0], tot: [0, 0], hist: [[], []], par: 2, course: { par: 2, port: null, fair: [], sands: [], ices: [], walls: [], cup: [500, 200] } } },
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
        { ...base, acting_for_player_index: null, view: { ...view, side: 'b' } },
        { ...base, status: 'over', view: { ...view, winner: 0, reason: 'R1' } },
        { ...base, status: 'over', view: { ...view, winner: -1, reason: 'R1' } },
        { ...base, status: 'over', view: { ...view, winner: null } },
      ],
    };
  })(),
};
module.exports = { CASES, players2, base, grid };
