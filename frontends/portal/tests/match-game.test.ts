import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Game} from '../src/core/types';
import {matchGameName} from '../src/ui/match-game';

const game = (id: string, name: string, version = 1): Game => ({id, name, version, description: '', allowed_player_counts: [2]});
const match = {game_id: '5f5293c3-2a3a-4eec-b631-9debf59be0ca', game_version: 1};
const empty = () => ({matchGames: {}, selectedGame: null, games: [], savedGames: [], recentGames: [], popularGames: []});

test('downloaded match name survives a catalog search or a missing catalog page', () => {
  const sources = {...empty(), matchGames: {[`${match.game_id}@1`]: game(match.game_id, 'Backgammon')}, games: [game('different', 'Chess')]};
  assert.equal(matchGameName(match, sources), 'Backgammon');
  sources.games = [];
  assert.equal(matchGameName(match, sources), 'Backgammon');
});

test('pinned package name wins over a selected or catalog version', () => {
  const sources = {...empty(), matchGames: {[`${match.game_id}@1`]: game(match.game_id, 'Pinned Backgammon')},
    selectedGame: game(match.game_id, 'New Backgammon', 2), savedGames: [game(match.game_id, 'Saved Backgammon', 3)]};
  assert.equal(matchGameName(match, sources), 'Pinned Backgammon');
  assert.equal(matchGameName(match, {...sources, matchGames: {}, savedGames: [game(match.game_id, 'Pinned Saved Backgammon')]}), 'Pinned Saved Backgammon');
});

test('selected, saved, recent and popular game metadata can provide missing names', () => {
  const record = game(match.game_id, 'Backgammon', 2);
  assert.equal(matchGameName(match, {...empty(), selectedGame: record}), 'Backgammon');
  for (const source of ['games', 'savedGames', 'recentGames', 'popularGames']) {
    assert.equal(matchGameName(match, {...empty(), [source]: [record]}), 'Backgammon');
  }
});

test('missing or invalid metadata never turns an internal ID into a game name', () => {
  assert.equal(matchGameName(match, empty()), undefined);
  assert.equal(matchGameName(match, {...empty(), matchGames: {[`${match.game_id}@1`]: game('unrelated', 'Wrong game')}}), undefined);
  assert.equal(matchGameName(match, {...empty(), games: [game(match.game_id, '  ')]}), undefined);
});

test('bundled local matches have a readable translated title before any download', () => {
  assert.equal(matchGameName({game_id: 'bundled-tictactoe', game_version: 1}, empty()), 'Tic-tac-toe');
  assert.equal(matchGameName({game_id: 'bundled-tictactoe', game_version: 1}, empty(), 'Morpion'), 'Morpion');
});
