import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountRepository, emptyAccountData, LEGACY_ORIGIN_KEY, type StorageAdapter } from '../src/core/repository';
import { PortalApi } from '../src/core/api';
import { syncAccount } from '../src/core/sync';
import type { Account, Match } from '../src/core/types';

class MemoryStorage implements StorageAdapter {
  values = new Map<string, string>(); failWrites = false;
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { if (this.failWrites) throw new Error('disk full'); this.values.set(key, value); }
  async keys() { return [...this.values.keys()]; }
  async exclusive<T>(_name: string, run: () => Promise<T>) { return run(); }
}
const account: Account = { id: 'alice', password: 'credential-never-in-game', display_name: 'Alice' };
const match: Match = { id: 'm', game_id: 'g', game_version: 3, owner_user_id: 'alice', status: 'ongoing', state: { board: [] }, players: [{ id: 'alice', user_id: 'alice', player_index: 0, kind: 'human' }], turn_of_player_indices: [0], move_count: 0, created_at: '2026-01-01T00:00:00Z' };
async function fixture() {
  const storage = new MemoryStorage(); const repository = new AccountRepository('https://buildplay.fun', storage); const data = emptyAccountData();
  data.responses['/matches/m'] = match;
  data.queues.m = [{ requestId: 'original-intent-key', body: { move: { cell: 4 }, expected_move_count: 0 }, baseState: match.state, baseTurn: [0] }];
  await repository.write(account.id, data); return { storage, repository };
}
function apiWith(respond: (method: string, path: string, init: RequestInit) => any) {
  return new PortalApi('https://buildplay.fun', () => 'en', (async (url: string | URL | Request, init: RequestInit = {}) => {
    const reply = await respond(init.method || 'GET', String(url).replace('https://buildplay.fun', ''), init);
    return new Response(reply === null ? null : JSON.stringify(reply), { status: reply === null ? 204 : 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
}

test('browser fetch is invoked without a PortalApi receiver', async () => {
  const fetcher = function (this: unknown) { 'use strict'; assert.equal(this, undefined); return Promise.resolve(new Response('{}', { status: 200 })); };
  const api = new PortalApi('https://buildplay.fun', () => 'en', fetcher as typeof fetch);
  assert.deepEqual(await api.request('GET', '/health'), {});
});

test('opening an empty native account reads its own file without scanning storage',async()=>{
  const storage=Object.assign(new MemoryStorage(),{supportsBrowserImports:false});
  const repo=new AccountRepository('https://buildplay.fun',storage);
  const reads:string[]=[];
  storage.getItem=async key=>{reads.push(key);return null;};
  storage.keys=async()=>{throw new Error('Unexpected storage scan');};
  assert.deepEqual(await repo.read('visitor'),emptyAccountData());
  assert.deepEqual(reads,[repo.key('visitor')]);
});

test('split browser migration retains queues, pinned packages, local matches and original bytes', async () => {
  const storage = new MemoryStorage(); const repository = new AccountRepository('', storage); const base = 'game-platform.portal.v1.alice';
  const queue = [{ requestId: 'saved', body: { move: { cell: 2 }, expected_move_count: 0 }, baseState: null, baseTurn: [0] }];
  storage.values.set(`${base}.q.m`, JSON.stringify(queue)); storage.values.set(`${base}.r.${encodeURIComponent('/games/g/versions/7')}`, JSON.stringify({ id: 'g', version: 7 }));
  storage.values.set(`${base}.l.local-one`, JSON.stringify({ id: 'local-one' })); storage.values.set(`${base}.selected`, JSON.stringify('m'));
  const before = new Map(storage.values); const data = await repository.read('alice'); await repository.write('alice', data);
  assert.deepEqual(data.queues.m, queue); assert.equal(data.responses['/games/g/versions/7'].version, 7); assert.equal(data.local['local-one'].id, 'local-one'); assert.equal(data.selectedId, 'm');
  for (const [key, value] of before) assert.equal(storage.values.get(key), value);
});
test('obsolete native-style state queues become preserved conflicts', async () => {
  const storage = new MemoryStorage(); const repository = new AccountRepository('', storage);
  storage.values.set('game-platform.portal.v1.alice', JSON.stringify({ queues: { m: [{ body: { new_state: { x: 1 } } }] } }));
  const data = await repository.read('alice'); assert.match(data.conflicts.m.message, /earlier game protocol/); assert.equal(data.queues.m.length, 1);
});
test('corrupt current saves remain untouched and never become an empty account', async () => {
  const storage = new MemoryStorage(); const repository = new AccountRepository('', storage); storage.values.set(repository.key('alice'), 'not json');
  await assert.rejects(repository.mutate('alice', data => { data.selectedId = 'replacement'; })); assert.equal(storage.values.get(repository.key('alice')), 'not json');
});
test('failed durable mutation cannot publish a provisional move or discard a queue', async () => {
  const { storage, repository } = await fixture(); storage.failWrites = true;
  await assert.rejects(repository.mutate('alice', data => { delete data.queues.m; data.responses['/matches/m'].state = { lost: true }; }), /disk full/);
  const saved = await repository.read('alice'); assert.equal(saved.queues.m.length, 1); assert.deepEqual(saved.responses['/matches/m'].state, { board: [] });
});
test('accounts and nonproduction backends have independent data namespaces', async () => {
  const { storage, repository } = await fixture(); assert.deepEqual((await repository.read('bob')).queues, {});
  const otherServer = new AccountRepository('https://example.test', storage); assert.deepEqual((await otherServer.read('alice')).queues, {});
});
test('legacy production snapshots and split queues never migrate into another API origin',async()=>{
  const storage=new MemoryStorage(),original=emptyAccountData();
  original.responses['/matches/m']={...match,state:{hand:'private production hand'}};
  original.selectedId='m';
  storage.values.set('game-platform.portal.v1.alice',JSON.stringify(original));
  storage.values.set('game-platform.portal.v1.alice.q.m',JSON.stringify([{requestId:'production-only',body:{move:{card:'private card'},expected_move_count:0},baseState:match.state,baseTurn:[0]}]));
  const before=new Map(storage.values),foreign=new AccountRepository('https://different.test',storage);
  const data=await foreign.read('alice');
  assert.deepEqual(data,emptyAccountData());
  await foreign.write('alice',data);
  assert.doesNotMatch(storage.values.get(foreign.key('alice'))!,/private production|private card|production-only/);
  for(const [key,value] of before)assert.equal(storage.values.get(key),value);
  const production=await new AccountRepository('https://buildplay.fun',storage).read('alice');
  assert.equal(production.responses['/matches/m'].state.hand,'private production hand');
  assert.equal(production.queues.m[0].requestId,'production-only');
});
test('an explicit legacy origin marker permits only the matching server migration',async()=>{
  const storage=new MemoryStorage(),data=emptyAccountData();data.responses['/matches/m']=match;
  storage.values.set('game-platform.portal.v1.alice',JSON.stringify(data));
  storage.values.set(LEGACY_ORIGIN_KEY,'https://private.test/');
  assert.deepEqual(await new AccountRepository('https://buildplay.fun',storage).read('alice'),emptyAccountData());
  assert.deepEqual(await new AccountRepository('https://different.test',storage).read('alice'),emptyAccountData());
  assert.equal((await new AccountRepository('https://private.test',storage).read('alice')).responses['/matches/m'].id,'m');
});
test('a browser upgrade keeps its own custom-origin legacy saves without importing them into another API',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'location');
  Object.defineProperty(globalThis,'location',{configurable:true,value:new URL('https://custom-browser.test/portal')});
  try{
    const storage=new MemoryStorage(),original=emptyAccountData();
    original.responses['/matches/m']={...match,state:{hand:'custom-origin-private-hand'}};
    storage.values.set('game-platform.portal.v1.alice',JSON.stringify(original));
    storage.values.set('game-platform.portal.v1.alice.q.m',JSON.stringify([{requestId:'custom-origin-queue',body:{move:{cell:3},expected_move_count:0},baseState:match.state,baseTurn:[0]}]));
    const same=await new AccountRepository('https://custom-browser.test',storage).read('alice');
    assert.equal(same.responses['/matches/m'].state.hand,'custom-origin-private-hand');assert.equal(same.queues.m[0].requestId,'custom-origin-queue');
    for(const origin of ['https://buildplay.fun','https://different.test'])assert.deepEqual(await new AccountRepository(origin,storage).read('alice'),emptyAccountData());
  }finally{if(previous)Object.defineProperty(globalThis,'location',previous);else delete(globalThis as any).location;}
});
test('fresh action posts once using the original key and captured account headers', async () => {
  const { repository } = await fixture(); const calls: string[] = [];
  const api = apiWith((method, path, init) => { calls.push(`${method} ${path}`); const headers = init.headers as Record<string,string>; assert.equal(headers['Idempotency-Key'], 'original-intent-key'); assert.equal(headers['X-User-Id'], 'alice'); assert.equal(headers['X-User-Password'], account.password); assert.deepEqual(JSON.parse(init.body as string), { move: { cell: 4 }, expected_move_count: 0 }); return { ...match, move_count: 1, state: { board: [4] } }; });
  await syncAccount(api, repository, account, { paginated: true, guard() {}, freshRequestId: 'original-intent-key' });
  assert.deepEqual(calls, ['POST /matches/m/moves']); assert.deepEqual((await repository.read('alice')).queues, {});
});
test('lost acknowledgement survives restart, history reconciles it without duplicate POST', async () => {
  const { storage, repository } = await fixture(); let posts = 0;
  const failing = apiWith(method => { assert.equal(method, 'POST'); posts++; throw new TypeError('response lost after acceptance'); });
  await assert.rejects(syncAccount(failing, repository, account, { paginated: true, guard() {}, freshRequestId: 'original-intent-key' }));
  assert.equal((await repository.read('alice')).queues.m[0].requestId, 'original-intent-key');
  const restarted = new AccountRepository('https://buildplay.fun', storage);
  const api = apiWith((method, path) => { assert.equal(method, 'GET'); return path.includes('/history?') ? { items: [{ made_by_user_id: 'alice', move: { cell: 4 } }] } : { ...match, move_count: 2 }; });
  await syncAccount(api, restarted, account, { paginated: true, guard() {} }); assert.equal(posts, 1); assert.deepEqual((await restarted.read('alice')).queues, {});
});
test('an unrelated accepted move preserves pending action and creates an explicit conflict', async () => {
  const { repository } = await fixture();
  const api = apiWith((method, path) => { assert.equal(method, 'GET'); return path.includes('/history?') ? { items: [{ made_by_user_id: 'bob', move: { cell: 4 } }] } : { ...match, move_count: 1 }; });
  const result = await syncAccount(api, repository, account, { paginated: true, guard() {} }); assert.equal(result.queues.m.length, 1); assert.match(result.conflicts.m.message, /Another move/);
});
test('unchanged count with different state or turn conflicts before sending a move', async () => {
  const { repository } = await fixture(); let calls = 0;
  const api = apiWith(method => { calls++; assert.equal(method, 'GET'); return { ...match, turn_of_player_indices: [1] }; });
  const result = await syncAccount(api, repository, account, { paginated: false, guard() {} }); assert.equal(calls, 1); assert.equal(result.queues.m.length, 1); assert.match(result.conflicts.m.message, /state or turn changed/);
});
test('retry keeps request key when the server has not accepted the action', async () => {
  const { repository } = await fixture(); const calls: string[] = [];
  const api = apiWith((method, path, init) => { calls.push(method); if (method === 'GET') return match; assert.equal((init.headers as any)['Idempotency-Key'], 'original-intent-key'); return { ...match, move_count: 1 }; });
  await syncAccount(api, repository, account, { paginated: true, guard() {} }); assert.deepEqual(calls, ['GET', 'POST']);
});
test('account change during server fetch prevents posting and leaves old queue durable', async () => {
  const { repository } = await fixture(); let changed = false;
  const api = apiWith(method => { assert.equal(method, 'GET'); changed = true; return match; });
  await assert.rejects(syncAccount(api, repository, account, { paginated: true, guard() { if (changed) throw new Error('Account changed'); } }), /Account changed/);
  assert.equal((await repository.read('alice')).queues.m.length, 1); assert.deepEqual((await repository.read('bob')).queues, {});
});
test('cache eviction keeps game version and state required by a durable queue', async () => {
  const { repository } = await fixture(); const data = await repository.read('alice');
  data.responses['/games/g/versions/3'] = { bytes: 'pinned' }; data.responses['/recoverable-large'] = 'x'.repeat(1_100_000);
  repository.trim(data); assert.equal(data.responses['/games/g/versions/3'].bytes, 'pinned'); assert.ok(data.responses['/matches/m']); assert.equal(data.responses['/recoverable-large'], undefined);
});
test('account merge copies exact local packages and archives pending intents without replaying them', async () => {
  const { storage, repository } = await fixture();
  await repository.mutate('alice', data => {
    data.local['local-one'] = { id: 'local-one', game_id: 'g', game_version: 3, owner_user_id: 'alice', logicState: { owner: 'immutable-player' }, players: [{ id: 'immutable-player', user_id: 'alice' }], moves: [{ new_state: { exact: true } }], practiceSeed: 17 } as any;
    data.responses['/games/g/versions/3'] = { id: 'g', version: 3, server_code: 'exact pinned rules', declarative_ui: { ui_code: 'exact pinned presentation' } };
    data.conflicts.m = { message: 'Review original', remote: match }; data.selectedId = 'local-one';
    (data.queues.m[0] as any).oldCredentials = { password: 'never-archive-this-password' };
  });
  const original = storage.values.get(repository.key('alice'));
  await repository.preserveMergedAccounts('bob', ['alice']); const target = await repository.read('bob');
  assert.equal(storage.values.get(repository.key('alice')), original); assert.equal(target.local['local-one'].players[0].id, 'immutable-player'); assert.equal(target.local['local-one'].owner_user_id, 'alice'); assert.equal(target.local['local-one'].logicState.owner, 'immutable-player');
  assert.equal(target.responses['/games/g/versions/3'].server_code, 'exact pinned rules'); assert.equal(target.selectedId, 'local-one'); assert.deepEqual(target.queues, {}); assert.deepEqual(target.conflicts, {});
  const archived = target.archives.find(entry => entry.kind === 'account-merge'); assert.equal(archived.queues.m[0].requestId, 'original-intent-key'); assert.deepEqual(archived.queues.m[0].baseState, match.state); assert.equal(archived.conflicts.m.message, 'Review original'); assert.doesNotMatch(JSON.stringify(archived), /never-archive-this-password/);
});
test('merge collisions retain canonical matches/packages and preserve the source branch in the archive', async () => {
  const { repository } = await fixture();
  await repository.mutate('alice', data => { data.local['local-collision'] = { id: 'local-collision', game_id: 'g', game_version: 3, logicState: { branch: 'old' } } as any; data.responses['/games/g/versions/3'] = { server_code: 'original source rules' }; });
  await repository.mutate('bob', data => { data.local['local-collision'] = { id: 'local-collision', game_id: 'g', game_version: 3, logicState: { branch: 'canonical' } } as any; data.responses['/games/g/versions/3'] = { server_code: 'canonical rules' }; });
  await repository.preserveMergedAccounts('bob', ['alice']); const target = await repository.read('bob');
  assert.equal(target.local['local-collision'].logicState.branch, 'canonical'); assert.equal(target.responses['/games/g/versions/3'].server_code, 'canonical rules');
  assert.equal(target.archives[0].localMatches['local-collision'].logicState.branch, 'old'); assert.equal(target.archives[0].packages['/games/g/versions/3'].server_code, 'original source rules');
});

test('account merge preserves an idempotent unsent lobby creation with its rules and immutable player id',async()=>{
  const {storage,repository}=await fixture();
  await repository.mutate('alice',data=>{
    data.creations={'new-lobby':{requestId:'same-stable-request',body:{game_id:'g',client_match_id:'new-lobby',match_kind:'multiplayer'}}};
    data.responses['/matches/new-lobby']={...match,id:'new-lobby',match_kind:'multiplayer',status:'waiting_for_players'};
    data.responses['/games/g/versions/3']={id:'g',version:3,server_code:'pinned rules'};data.selectedId='new-lobby';
  });
  const original=storage.values.get(repository.key('alice'));await repository.preserveMergedAccounts('bob',['alice']);
  const merged=await repository.read('bob');assert.equal(merged.creations!['new-lobby'].requestId,'same-stable-request');
  assert.equal(merged.responses['/matches/new-lobby'].owner_user_id,'bob');assert.equal(merged.responses['/matches/new-lobby'].players[0].user_id,'bob');
  assert.equal(merged.responses['/matches/new-lobby'].players[0].id,'alice');assert.equal(merged.selectedId,'new-lobby');
  assert.equal(merged.responses['/games/g/versions/3'].server_code,'pinned rules');assert.equal(storage.values.get(repository.key('alice')),original);
});
