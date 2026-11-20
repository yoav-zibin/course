import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Match} from '../src/core/types';
import {isSinglePlayerMatch, matchKind, singlePlayerMatches} from '../src/ui/match-kind';

const match = (id: string, fields: Partial<Match> = {}): Match => ({id, game_id:'g', game_version:1, owner_user_id:'alice', status:'ongoing', players:[], turn_of_player_indices:[0], move_count:0, created_at:'2026-11-20T00:00:00Z', ...fields});

test('explicit match kind controls private controls even without a local runtime snapshot', () => {
  for (const match_kind of ['computer', 'pass_and_play'] as const) assert.equal(isSinglePlayerMatch(match('m', {match_kind})), true);
  assert.equal(isSinglePlayerMatch(match('m', {match_kind:'multiplayer'})), false);
  assert.equal(matchKind(match('m', {localMode:'pass'})), 'pass_and_play');
});

test('single-player list combines devices and cloud without duplicate or stale boards', () => {
  const cloud = match('same', {match_kind:'computer', move_count:1});
  const device = match('same', {match_kind:'computer', move_count:4, cloud_pending:true});
  const pass = match('pass', {match_kind:'pass_and_play'});
  const result = singlePlayerMatches([cloud, pass, match('public', {match_kind:'multiplayer'})], [device]);
  assert.equal(result.length, 2);
  assert.equal(result.find(value => value.id === 'same'), device);
  assert.equal(result.some(value => value.id === 'public'), false);
});
