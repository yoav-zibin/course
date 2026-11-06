'use strict';
// Messages used to compare each community game with its original (see community-games.test.cjs).
// Each game has a list of scenarios; a scenario is a list of steps {msg, then(page)} sent in order to
// a fresh page. `names` are player names, which are never translated.
const PLAYERS = [{ name: 'Ana', player_index: 0, id: 'p0' }, { name: 'Ben', player_index: 1, id: 'p1' }];
const UNNAMED = [{ player_index: 0, id: 'p0' }, { player_index: 1, id: 'p1' }];
function msg(over = {}) {
  return { type: 'state_changed', status: 'ongoing', move_count: 3, players: PLAYERS, my_player_index: 0, acting_for_player_index: 0, turn_of_player_indices: [0], ...over };
}
const mine = (view, over) => msg({ view, ...over });
const theirs = (view, over) => msg({ view, acting_for_player_index: null, turn_of_player_indices: [1], ...over });
const over = (view, extra) => msg({ view, status: 'over', acting_for_player_index: null, turn_of_player_indices: [], ...extra });
const spectator = (view, extra) => msg({ view, my_player_index: null, acting_for_player_index: null, turn_of_player_indices: [1], ...extra });
const click = (id) => (page) => page.$(id).click();

const S = {};
S['8b87f4a0'] = { names: ['Ana', 'Ben'], scenarios: [
  [{ msg: msg() }, { msg: mine({ total: 4, winner: null }) }, { msg: mine({ total: 4, winner: null }), then: click('add1') }],
  [{ msg: theirs({ total: 7, winner: null }) }, { msg: theirs({ total: 7, winner: null }, { turn_of_player_indices: [], players: UNNAMED }) }],
  [{ msg: mine({ total: 7, winner: null }, { players: UNNAMED, acting_for_player_index: 1 }) }, { msg: theirs({ total: 7, winner: null }, { players: UNNAMED, turn_of_player_indices: [0, 1] }) }],
  [{ msg: over({ total: 10, winner: 1 }) }, { msg: over({ total: 10, winner: null }) }, { msg: over({ total: 3, winner: 0 }, { status: 'ongoing' }) }],
] };
const gomoku = (board, extra = {}) => ({ board, winner: null, winLine: [], last: null, ...extra });
const empty225 = () => Array(225).fill(0);
const placed = (cells) => { const b = empty225(); for (const [i, v] of cells) b[i] = v; return b; };
S['b59b79d7'] = { names: ['Ana', 'Ben'], scenarios: [
  [{ msg: msg() }, { msg: mine(gomoku(placed([[112, 1], [113, 2]]), { last: 113 })) }, { msg: mine(gomoku(placed([[112, 1]]))), then: (p) => p.$('board').children[0].click() }],
  [{ msg: theirs(gomoku(placed([[0, 1]]))) }, { msg: theirs(gomoku(placed([[0, 1]])), { players: UNNAMED, turn_of_player_indices: [] }) }],
  [{ msg: over(gomoku(placed([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]), { winner: 0, winLine: [0, 1, 2, 3, 4] })) }, { msg: over(gomoku(placed([[0, 1]]), { winner: -1 })) }, { msg: over(gomoku(placed([[0, 1]]), { winner: 'x' })) }, { msg: over(gomoku(empty225()), {}) }],
  [{ msg: over(gomoku(placed([[0, 1]]), { winner: 1 }), { players: UNNAMED }) }, { msg: mine(gomoku(empty225()), { players: UNNAMED }) }],
] };
const ttt = (board, extra = {}) => ({ board, winner: null, winningLine: [], lastMove: null, ...extra });
S['4d15d9d7'] = { names: ['Ana', 'Ben'], scenarios: [
  [{ msg: msg() }, { msg: mine(ttt([0, null, 1, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null], { lastMove: 2 })) }, { msg: mine(ttt(Array(20).fill(null))), then: (p) => p.$('board').children[3].click() }],
  [{ msg: theirs(ttt(Array(20).fill(null))) }, { msg: theirs(ttt(Array(20).fill(null)), { players: UNNAMED, turn_of_player_indices: [] }) }],
  [{ msg: over(ttt([0, 0, 0, 0, ...Array(16).fill(null)], { winner: 0, winningLine: [0, 1, 2, 3] })) }, { msg: over(ttt(Array(20).fill(1), { winner: 'draw' })) }, { msg: over(ttt(Array(20).fill(null), { winner: 'other' })) }],
  [{ msg: over(ttt(Array(20).fill(null), { winner: 1 }), { players: UNNAMED }) }, { msg: mine(ttt(Array(20).fill(null)), { players: UNNAMED }) }],
] };
const stars = (n, w) => ({ stars: n, winnerId: w === undefined ? null : w });
S['788b39a9'] = { names: ['Ana', 'Ben'], scenarios: [
  [{ msg: msg() }, { msg: mine(stars(9)) }, { msg: mine(stars(1)) }, { msg: mine(stars(5)), then: click('take2') }],
  [{ msg: theirs(stars(6)) }, { msg: theirs(stars(6), { turn_of_player_indices: [], players: UNNAMED }) }],
  [{ msg: over(stars(0, 'p1')) }, { msg: over(stars(0, 'zz')) }],
  [{ msg: mine(stars(5), { players: UNNAMED }) }],
] };

// --- Last Floe
const ROWL = [7, 8, 7, 8, 7, 8, 7, 8];
function floe(over2 = {}) {
  const tiles = []; let id = 0;
  ROWL.forEach((n, r) => { for (let k = 0; k < n; k += 1) { tiles.push({ id, row: r, fish: (id % 3) + 1, penguin: id === 4 ? 0 : id === 5 ? 1 : -1, removed: id === 9 }); id += 1; } });
  return { tiles, scores: [2, 3], phase: 'placement', finished: false, legal: { placements: [1, 2], moves: {} }, ...over2 };
}
const tile = (p, r, k) => p.$('board').children[r].children[k];
S['4f49cbdc'] = { names: ['Ana', 'Ben'], scenarios: [
  [{ msg: msg() }, { msg: mine(floe()) }, { msg: mine(floe()), then: (p) => tile(p, 0, 1).click() }],
  [{ msg: theirs(floe()) }, { msg: theirs(floe(), { turn_of_player_indices: [], players: UNNAMED }) }, { msg: theirs(floe({ phase: 'movement' }), { turn_of_player_indices: [0, 1] }) }],
  [{ msg: mine(floe({ phase: 'movement', legal: { placements: [], moves: { 4: [6, 7] } } })) }, { msg: mine(floe({ phase: 'movement', legal: { placements: [], moves: { 4: [6, 7] } } })), then: (p) => { tile(p, 0, 4).click(); } }],
  [{ msg: mine(floe({ phase: 'movement', legal: { placements: [], moves: {} } })) }, { msg: mine(floe({ phase: 'movement', legal: { placements: [], moves: {} } })), then: click('actions') }, { msg: mine(floe({ phase: 'movement', legal: { placements: [], moves: {} } })), then: (p) => p.$('actions').children[0].click() }],
  [{ msg: over(floe({ scores: [5, 3], finished: true })) }, { msg: over(floe({ scores: [4, 4], finished: true })) }, { msg: mine(floe({ scores: [1, 0], finished: true })) }, { msg: over(floe({ scores: [9, 3], finished: true }), { players: UNNAMED }) }],
] };

// --- SOS
const sosBoard = (cells) => { const b = Array(36).fill(''); for (const [i, v] of cells) b[i] = v; return b; };
const sos = (cells, extra = {}) => ({ board: sosBoard(cells), scores: [1, 2], lines: [], lastMove: -1, winner: null, ...extra });
const withComputer = [{ name: 'Ana', player_index: 0, id: 'p0' }, { name: 'Robo', player_index: 1, id: 'p1', kind: 'computer' }];
S['a1ca4c85'] = { names: ['Ana', 'Ben', 'Robo'], skipCoverage: ['rules'], data: ['S', 'O', 'SOS', ' horizontally, vertically or diagonally. Each new SOS = 1 point + you go again. Most points when full wins.'], scenarios: [
  [{ msg: msg() }, { msg: mine(sos([[0, 'S'], [1, 'O'], [2, 'S']], { lines: [[0, 1, 2]], lastMove: 2 })) }, { msg: mine(sos([])), then: (p) => { p.$('btnO').click(); p.$('board').children[7].click(); } }],
  [{ msg: theirs(sos([])) }, { msg: theirs(sos([]), { acting_for_player_index: 1 }) }, { msg: theirs(sos([]), { acting_for_player_index: null, turn_of_player_indices: [] }) }, { msg: spectator(sos([]), { acting_for_player_index: 1 }) }],
  [{ msg: theirs(sos([]), { players: withComputer, acting_for_player_index: 1 }) }, { msg: mine(sos([]), { players: withComputer }) }],
  [{ msg: over(sos([], { winner: 0 })) }, { msg: over(sos([], { winner: -1 })) }, { msg: over(sos([], { winner: null })) }, { msg: over(sos([], { winner: 5 })) }, { msg: mine(sos([]), { players: UNNAMED, my_player_index: 1 }) }],
] };

module.exports = { S, msg, mine, theirs, over, spectator, PLAYERS, UNNAMED, click };
