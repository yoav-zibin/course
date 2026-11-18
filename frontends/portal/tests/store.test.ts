import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PortalStore } from '../src/core';
import { rulesSource } from '../src/game/runtimeSource';
import { AccountRepository } from '../src/core/repository';
import { redactedNativeArchive } from '../src/core/native-migration';
import { setLocale, localizeGame, gameTexts, getDirection, t } from '../src/platform/i18n';
import { ApiError } from '../src/core/api';

function browserStorage() {
  const values: Record<string,string> = {};
  Object.defineProperties(values, {
    getItem: { value: (key: string) => Object.hasOwn(values, key) ? values[key] : null },
    setItem: { writable: true, configurable: true, value: (key: string, value: string) => { values[key] = String(value); } },
    removeItem: { value: (key: string) => { delete values[key]; } },
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: values }); return values;
}
function mockedFetch(extra: (url: URL, init: RequestInit) => any = () => undefined) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)); let value = await extra(url, init);
    if (value === undefined) {
      if (url.pathname === '/i18n/locales') value = { locales: [{ code: 'en', name: 'English', direction: 'ltr' }] };
      else if (url.pathname.startsWith('/i18n/bundle/')) value = { catalog: { messages: {}, direction: 'ltr' }, games: {} };
      else if (url.pathname === '/storage/capabilities') value = { pagination: false };
      else if (url.pathname === '/auth/config') value = {};
      else if (/^\/users\/[^/]+$/.test(url.pathname)) value = { id: 'alice', token_balance: 100 };
      else value = [];
    }
    return new Response(JSON.stringify(value), { status: 200 });
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}
function testRuntime() {
  return async (game: any, name: string, args: unknown[], ctx: unknown, seed: number|string, now: number) => {
    assert.doesNotMatch(JSON.stringify({ game, args, ctx }), /credential-never-in-game/);
    const result = JSON.parse(vm.runInNewContext(rulesSource(game, name, args, ctx, seed, now), {}, { timeout: 3000 }));
    if (!result.ok) throw new Error(result.message); return result.result;
  };
}

test('real bundled rules support durable pass-and-play, handoff, win, restart and replay', async () => {
  browserStorage(); const restore = mockedFetch();
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test');
    await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0, names: ['Alex', 'Sam'] });
    const id = store.getSnapshot().selectedMatch!.id;
    await store.actions.submitMove({ cell: 0 }); assert.equal(store.getSnapshot().selectedMatch!.awaitingHandoff, true);
    assert.equal(store.actions.presentationMessage().acting_for_player_index, null);
    await assert.rejects(store.actions.submitMove({ cell: 1 }), /next player is ready/);
    const restarted = new PortalStore(testRuntime()); await restarted.bootstrap('https://local.test');
    assert.equal(restarted.getSnapshot().selectedMatch!.id, id); assert.equal(restarted.getSnapshot().selectedMatch!.awaitingHandoff, true); assert.equal(restarted.getSnapshot().selectedMatch!.players[1].name, 'Sam');
    for (const cell of [3,1,4,2]) { await restarted.actions.revealLocal(); await restarted.actions.submitMove({ cell }); }
    const match = restarted.getSnapshot().selectedMatch!; assert.equal(match.status, 'over'); assert.equal(match.state.winner, 0); assert.equal(match.move_count, 5);
    await restarted.actions.loadHistory(); await restarted.actions.replay(2); const message = restarted.actions.presentationMessage(); assert.equal(message.replay.index, 2); assert.equal(message.acting_for_player_index, null); assert.equal(message.last_move_player_index,1); assert.equal(message.state.board[1], -1);
    await assert.rejects(restarted.actions.submitMove({ cell: 8 }), /live board/);
  } finally { restore(); }
});
test('real bundled computer turns advance using the same shared offline engine', async () => {
  browserStorage(); const restore = mockedFetch();
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.startPractice('bundled-tictactoe', { humans: 1, computers: 1 });
    await store.actions.submitMove({ cell: 4 }); const match = store.getSnapshot().selectedMatch!;
    assert.equal(match.move_count, 2); assert.deepEqual(match.turn_of_player_indices, [0]); assert.equal(match.state.board.filter((v: number) => v !== -1).length, 2);
    assert.equal(match.awaitingHandoff, undefined); assert.equal(store.actions.presentationMessage().acting_for_player_index, 0);
  } finally { restore(); }
});
test('history cannot reveal the next player board before the device handoff is confirmed', async () => {
  browserStorage(); const restore = mockedFetch();
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test');
    await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0 });
    await store.actions.submitMove({ cell: 0 }); assert.equal(store.getSnapshot().selectedMatch!.awaitingHandoff, true);
    await assert.rejects(store.actions.replay(1), /next player.*ready/i);
    assert.equal(store.getSnapshot().replayIndex, null);
    await store.actions.revealLocal(); await store.actions.replay(1); assert.equal(store.getSnapshot().replayIndex, 1);
  } finally { restore(); }
});
test('local-only launch loads accounts and resumes local play while making zero network calls', async () => {
  const saved=browserStorage(); saved['game-platform.accounts.v1']=JSON.stringify([{id:'alice',password:'saved-credential',display_name:'Alice'}]); saved['game-platform.current-account.v1']='alice';
  const original=globalThis.fetch; let requests=0; globalThis.fetch=(async()=>{requests++;throw new Error('Unexpected network request');}) as typeof fetch;
  try {
    const store=new PortalStore(testRuntime()); await store.actions.bootstrap('https://must-not-contact.test',true); assert.equal(store.getSnapshot().ready,true); assert.equal(store.getSnapshot().network,false); assert.equal(store.getSnapshot().account!.id,'alice');
    await store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0}); await store.actions.submitMove({cell:4}); const id=store.getSnapshot().selectedMatch!.id; await store.actions.refresh(); await store.actions.refreshMatch();
    const restarted=new PortalStore(testRuntime()); await restarted.actions.bootstrap('https://must-not-contact.test',true); assert.equal(restarted.getSnapshot().selectedMatch!.id,id); assert.equal(restarted.getSnapshot().selectedMatch!.move_count,1); assert.equal(restarted.getSnapshot().network,false);
    await assert.rejects(restarted.actions.request('GET','/health'),/entirely on this device/); await assert.rejects(restarted.actions.guest('Unexpected guest'),/entirely on this device/); await assert.rejects(restarted.actions.browserLogin(),/entirely on this device/); assert.equal(requests,0);
  } finally {globalThis.fetch=original;}
});
test('initial URL attribution reaches signup before the route changes and is forgotten after login',async()=>{
  const saved=browserStorage();let signup:any=null;const restore=mockedFetch((url,init)=>{
    if(url.pathname==='/users'&&init.method==='POST'){signup={body:JSON.parse(init.body as string),headers:init.headers};return {id:'new-guest',password:'new-guest-credential',display_name:'Guest'};}
  });
  try{
    const store=new PortalStore(testRuntime());await store.actions.bootstrap('https://local.test',false,'https://local.test/portal?ref=12345&campaign=class-a#invite=invitation-token');
    await store.actions.rememberAttribution('https://local.test/portal#games');await store.actions.guest('Guest');
    assert.equal(signup.headers['X-Campaign-Code'],'class-a');assert.equal(signup.body.invited_by_user_id,'12345');assert.equal(signup.body.invite_token,'invitation-token');assert.equal(signup.body.campaign,undefined);
    assert.equal(saved['game-platform.invited-by.v1'],undefined);assert.equal(saved['game-platform.invite-token.v1'],undefined);assert.equal(saved['game-platform.experiment-campaign.v1'],'class-a');
  }finally{restore();}
});
test('rapid remote replay choices discard late responses and preserve the historical actor', async () => {
  browserStorage(); const bundled=JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8'));
  const match={id:'remote',game_id:bundled.id,game_version:1,owner_user_id:'alice',players:[{id:'alice',user_id:'alice',kind:'human',player_index:0},{id:'bob',user_id:'bob',kind:'human',player_index:1}],status:'ongoing',state:{step:2},turn_of_player_indices:[0],move_count:2,created_at:'2026-01-01T00:00:00Z'};
  const moves=[{move_number:1,player_index:0,new_state:{step:1},next_turn_player_indices:[1]},{move_number:2,player_index:1,new_state:{step:2},next_turn_player_indices:[0]}];
  const gates=new Map<string,{promise:Promise<unknown>;resolve:(value:any)=>void}>(); const addGate=(key:string)=>{let resolve!:(value:any)=>void;const promise=new Promise(value=>{resolve=value;});gates.set(key,{promise,resolve});}; addGate('0');addGate('1');
  const restore=mockedFetch(url=>{
    if(url.pathname==='/storage/capabilities')return {pagination:true};
    if(url.pathname==='/matches/remote')return match;
    if(url.pathname==='/v2/matches/remote/history')return url.searchParams.get('limit')==='1'?gates.get(url.searchParams.get('start')!)!.promise:{items:moves,total:2,initial_state:{step:0},initial_turn_player_indices:[0]};
    if(url.pathname.startsWith('/v2/'))return {items:[],next_cursor:null};
  });
  const response=(index:number)=>({items:[moves[index]],total:2,initial_state:{step:0},initial_turn_player_indices:[0]});
  try {
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');await store.actions.selectMatch('remote');
    const old=store.actions.replay(1),latest=store.actions.replay(2);gates.get('1')!.resolve(response(1));await latest;gates.get('0')!.resolve(response(0));await old;
    assert.equal(store.getSnapshot().replayIndex,2);assert.equal(store.actions.presentationMessage().state.step,2);assert.equal(store.actions.presentationMessage().last_move_player_index,1);
    addGate('0');const pending=store.actions.replay(1);await store.actions.replay(null);gates.get('0')!.resolve(response(0));await pending;assert.equal(store.getSnapshot().replayIndex,null);
  } finally {restore();}
});
test('history begun during a delayed account-storage transition never enters the new account cache', async () => {
  const saved=browserStorage();saved['game-platform.accounts.v1']=JSON.stringify([{id:'alice',password:'alice-secret',display_name:'Alice'},{id:'bob',password:'bob-secret',display_name:'Bob'}]);saved['game-platform.current-account.v1']='alice';
  const bundled=JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8'));
  const match={id:'private',game_id:bundled.id,game_version:1,owner_user_id:'alice',players:[{id:'alice',user_id:'alice',kind:'human',player_index:0},{id:'bob',user_id:'bob',kind:'human',player_index:1}],status:'ongoing',state:{secret:'alice-private-current'},turn_of_player_indices:[0],move_count:2,created_at:'2026-01-01T00:00:00Z'};
  const moves=[{move_number:1,player_index:0,new_state:{secret:'alice-private-history'},next_turn_player_indices:[1]},{move_number:2,player_index:1,new_state:match.state,next_turn_player_indices:[0]}];
  let finishWrite!:()=>void,finishHistory!:(value:any)=>void;const writeGate=new Promise<void>(resolve=>{finishWrite=resolve;}),historyGate=new Promise(resolve=>{finishHistory=resolve;});let initiatingAccount='';
  const restore=mockedFetch((url,init)=>{
    if(url.pathname==='/storage/capabilities')return {pagination:true};
    if(url.pathname==='/matches/private')return match;
    if(url.pathname==='/v2/matches/private/history'){
      if(url.searchParams.get('limit')==='1'){initiatingAccount=(init.headers as any)['X-User-Id'];return historyGate;}
      return {items:moves,total:2,initial_state:null,initial_turn_player_indices:[0]};
    }
    if(url.pathname.startsWith('/v2/'))return {items:[],next_cursor:null};
  });
  try{
    const store=new PortalStore(testRuntime(),undefined,async id=>{if(id==='bob')await writeGate;saved['game-platform.current-account.v1']=id;});
    await store.bootstrap('https://local.test');await store.actions.selectMatch('private');
    const switching=store.actions.switchAccount('bob');assert.equal(store.getSnapshot().account!.id,'alice');
    const late=assert.rejects(store.actions.replay(1),/Account changed/);finishWrite();await switching;assert.equal(store.getSnapshot().account!.id,'bob');
    finishHistory({items:[moves[0]],total:2,initial_state:null,initial_turn_player_indices:[0]});await late;
    assert.equal(initiatingAccount,'alice');assert.equal(store.getSnapshot().history,null);assert.equal(store.getSnapshot().selectedMatch,null);
    const bob=await new AccountRepository('https://local.test').read('bob');assert.equal(Object.keys(bob.responses).some(path=>path.includes('/private/history')),false);assert.doesNotMatch(JSON.stringify(bob),/alice-private-history/);
  }finally{restore();}
});
test('an earlier delayed account switch cannot replace a newer selection or persisted choice', async()=>{
  const saved=browserStorage();saved['game-platform.accounts.v1']=JSON.stringify(['alice','bob','charlie'].map(id=>({id,password:id,display_name:id})));saved['game-platform.current-account.v1']='alice';
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const store=new PortalStore(testRuntime(),undefined,async id=>{if(id==='bob')await gate;saved['game-platform.current-account.v1']=id;});await store.bootstrap('https://local.test',true);
  const older=assert.rejects(store.actions.switchAccount('bob'),/Account changed/);await Promise.resolve();await Promise.resolve();const latest=store.actions.switchAccount('charlie');release();await latest;await older;
  assert.equal(store.getSnapshot().account!.id,'charlie');assert.equal(saved['game-platform.current-account.v1'],'charlie');
});
test('actual Backgammon package runs through shared practice and persists a legal move', async () => {
  browserStorage();
  const source = JSON.parse(readFileSync(new URL('../../../games/declarative/backgammon.json', import.meta.url), 'utf8'));
  const game = { ...source, id: 'backgammon-test', version: 4, renderer_type: 'declarative', game_schemas: Object.fromEntries(['state','move','view'].map(key => [key, source.unit_tests[`${key}_schema`]])) };
  const restore = mockedFetch(url => url.pathname === '/games/backgammon-test' ? game : undefined);
  try {
    const runtime = testRuntime(); const store = new PortalStore(runtime); await store.bootstrap('https://local.test');
    await store.actions.startPractice(game.id, { humans: 2, computers: 0 });
    const before = store.getSnapshot().selectedMatch!; const actor = before.turn_of_player_indices![0];
    const ctx = { players: before.players.map(p => ({ id: p.id, kind: p.kind, display_name: p.name, max_loss: 0, active: true })), pot: 0, move_count: before.move_count };
    const move = await runtime(game, 'randomMove', [before.logicState, before.players[actor].id], ctx, (before.practiceSeed + before.move_count) >>> 0, Date.parse(before.created_at));
    await store.actions.submitMove(move); const after = store.getSnapshot().selectedMatch!;
    assert.equal(after.move_count, 1); assert.equal(after.game_version, 4); assert.notDeepEqual(after.logicState, before.logicState);
    const restarted = new PortalStore(runtime); await restarted.bootstrap('https://local.test');
    assert.deepEqual(restarted.getSnapshot().selectedMatch!.state, after.state); assert.equal(restarted.getSnapshot().game!.version, 4);
  } finally { restore(); }
});
test('poll refresh preserves already loaded pages and their next cursor', async () => {
  browserStorage();
  const game = (id: number) => ({ id: String(id), name: `Game ${id}`, description: '', version: 1, allowed_player_counts: [2] });
  const restore = mockedFetch(url => {
    if (url.pathname === '/storage/capabilities') return { pagination: true };
    if (url.pathname === '/v2/games') return url.searchParams.get('cursor') === 'next' ? { items: Array.from({ length: 25 }, (_, i) => game(i + 50)), next_cursor: 'last' } : { items: Array.from({ length: 50 }, (_, i) => game(i)), next_cursor: 'next' };
    if (url.pathname.startsWith('/v2/')) return { items: [], next_cursor: null };
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); assert.equal(store.getSnapshot().games.length, 50);
    await store.actions.loadMore('games'); assert.equal(store.getSnapshot().games.length, 75); assert.equal(store.getSnapshot().cursors.games, 'last');
    await store.actions.refresh(); assert.equal(store.getSnapshot().games.length, 75); assert.equal(store.getSnapshot().cursors.games, 'last');
    await store.actions.searchGames('new'); assert.equal(store.getSnapshot().games.length, 50); assert.equal(store.getSnapshot().cursors.games, 'next');
  } finally { restore(); }
});
test('slow poll cache cannot roll back a confirmed newer state or replace queued base', async () => {
  browserStorage(); const repository = new AccountRepository('https://local.test');
  await repository.cache('alice', '/matches/m', { id: 'm', move_count: 3, state: 'confirmed' });
  const result = await repository.cache('alice', '/matches/m', { id: 'm', move_count: 2, state: 'stale' }); assert.equal(result.state, 'confirmed');
  await repository.mutate('alice', data => { data.queues.m = [{ requestId: 'stable', body: { move: {}, expected_move_count: 3 }, baseState: 'confirmed', baseTurn: [0] }]; });
  await repository.cache('alice', '/matches/m', { id: 'm', move_count: 4, state: 'remote while queued' }); assert.equal((await repository.read('alice')).responses['/matches/m'].state, 'confirmed');
});
test('opening a game URL synchronously detaches the restored match before its package download', async () => {
  browserStorage(); let finish!: (value: any) => void; const download = new Promise(resolve => { finish = resolve; });
  const restore = mockedFetch(url => url.pathname === '/games/new-game' ? download : undefined);
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0 });
    const pinned = store.getSnapshot().game!; await store.actions.loadHistory(); await store.actions.replay(0);
    const opening = store.actions.selectGame('new-game');
    assert.equal(store.getSnapshot().selectedMatch, null); assert.equal(store.getSnapshot().game, null); assert.equal(store.getSnapshot().history, null); assert.equal(store.getSnapshot().replayIndex, null);
    finish({ ...pinned, id: 'new-game', version: 6 }); await opening;
    assert.equal(store.getSnapshot().game!.id, 'new-game'); assert.equal(store.getSnapshot().selectedMatch, null); assert.equal((await new AccountRepository('https://local.test').read('visitor')).selectedId, null);
    const restarted = new PortalStore(testRuntime()); await restarted.bootstrap('https://local.test'); assert.equal(restarted.getSnapshot().selectedMatch, null);
  } finally { restore(); }
});
test('failed game-package fetch cannot pair an old match with a newly selected game', async () => {
  browserStorage(); const restore = mockedFetch(url => { if (url.pathname === '/games/missing') throw new ApiError(404, 'Game not found'); });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0 });
    await assert.rejects(store.actions.selectGame('missing'), /Game not found/);
    assert.equal(store.getSnapshot().selectedMatch, null); assert.equal(store.getSnapshot().game, null); assert.equal(store.getSnapshot().selectedGameId, 'missing'); assert.equal(store.getSnapshot().history, null); assert.equal((await new AccountRepository('https://local.test').read('visitor')).selectedId, null);
  } finally { restore(); }
});
test('opening another match never pairs its private view with the previous game package', async () => {
  browserStorage();
  let release!: (value: any) => void, started!: () => void;
  const download = new Promise(resolve => { release = resolve; });
  const downloading = new Promise<void>(resolve => { started = resolve; });
  const restore = mockedFetch(url => {
    if (url.pathname === '/matches/other') return { id: 'other', game_id: 'other-game', game_version: 3, players: [], status: 'ongoing', state: { private: 'other game view' }, turn_of_player_indices: [0], move_count: 1 };
    if (url.pathname === '/games/other-game/versions/3') { started(); return download; }
  });
  let opening: Promise<unknown> | undefined;
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test');
    await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0 });
    const previous = store.getSnapshot().game!;
    opening = store.actions.selectMatch('other'); await downloading;
    try {
      assert.equal(store.getSnapshot().selectedMatch!.id, 'other');
      assert.equal(store.getSnapshot().game, null, 'a pending package must not expose another game reducer to this view');
    } finally { release({ ...previous, id: 'other-game', version: 3 }); await opening; }
    assert.equal(store.getSnapshot().game!.id, 'other-game');
  } finally { restore(); }
});
for (const operation of ['addBots', 'removePlayer'] as const) test(`a delayed ${operation} response cannot reopen a match after navigation`, async () => {
  browserStorage(); let release!: (value: any) => void;
  const response = new Promise(resolve => { release = resolve; });
  const match = (id: string) => ({ id, game_id: 'bundled-tictactoe', game_version: 1, players: [], status: 'waiting_for_players', state: null, turn_of_player_indices: [], move_count: 0 });
  const restore = mockedFetch((url, init) => {
    if (init.method === 'PATCH' || init.method === 'DELETE') return response;
    if (url.pathname === '/matches/first') return match('first');
    if (url.pathname === '/matches/second') return match('second');
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.selectMatch('first');
    const pending = operation === 'addBots' ? store.actions.addBots(1) : store.actions.removePlayer('someone');
    await store.actions.selectMatch('second'); release(match('first')); await pending;
    assert.equal(store.getSnapshot().selectedMatch!.id, 'second');
  } finally { restore(); }
});
test('a missing archived history frame cannot be presented as the live board', async () => {
  browserStorage();
  const restore = mockedFetch(url => {
    if (url.pathname === '/storage/capabilities') return { pagination: true };
    if (url.pathname.startsWith('/v2/') && !url.pathname.endsWith('/history')) return { items: [], next_cursor: null };
    if (url.pathname === '/matches/archived') return { id: 'archived', game_id: 'bundled-tictactoe', game_version: 1, players: [], status: 'ongoing', state: { private: 'live view' }, turn_of_player_indices: [0], move_count: 4 };
    if (url.pathname === '/v2/matches/archived/history') return { items: [], total: 4, initial_state: {}, initial_turn_player_indices: [0] };
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.selectMatch('archived');
    await assert.rejects(store.actions.replay(2), /history.*(?:unavailable|not available)/i);
    assert.equal(store.getSnapshot().replayIndex, null);
  } finally { restore(); }
});
test('hiding an online match cannot silently discard its durable pending move', async () => {
  browserStorage(); const restore = mockedFetch();
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test', true);
    const repository = new AccountRepository('https://local.test');
    const pending = { requestId: 'original-retry-key', body: { move: { cell: 4 }, expected_move_count: 0 }, baseState: {}, baseTurn: [0] };
    await repository.mutate('visitor', data => { data.responses['/matches/pending'] = { id: 'pending', game_id: 'game', game_version: 1 }; data.queues.pending = [pending]; });
    await store.actions.refresh();
    await assert.rejects(store.actions.archiveMatch('pending'), /pending action|sync/i);
    const saved = await repository.read('visitor'); assert.deepEqual(saved.queues.pending, [pending]); assert.equal(saved.archivedMatches.length, 0);
  } finally { restore(); }
});
test('a delayed language download cannot replace a newer language selection', async () => {
  browserStorage(); let release!: (value: any) => void, started!: () => void;
  const delayed = new Promise(resolve => { release = resolve; }); const downloading = new Promise<void>(resolve => { started = resolve; });
  const restore = mockedFetch(url => {
    if (url.pathname === '/i18n/bundle/ar') { started(); return delayed; }
    if (url.pathname === '/i18n/bundle/es') return { direction: 'ltr', catalog: { messages: { 'audit.language': 'Español' } }, games: {} };
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test');
    const older = store.actions.setLocale('ar'); await downloading;
    await store.actions.setLocale('es'); release({ direction: 'rtl', catalog: { messages: { 'audit.language': 'Arabic' } }, games: {} }); await older;
    assert.equal(store.getSnapshot().locale, 'es'); assert.equal(getDirection(), 'ltr'); assert.equal(t('audit.language'), 'Español');
  } finally { restore(); }
});
test('replay starts at the first retained move when the initial frame is unavailable', async () => {
  browserStorage();
  const restore = mockedFetch(url => {
    if (url.pathname === '/storage/capabilities') return { pagination: true };
    if (url.pathname.endsWith('/history')) return { items: [{ new_state: { frame: 'first move' }, next_turn_player_indices: [1] }], total: 3, initial_state: null, initial_turn_player_indices: null };
    if (url.pathname.startsWith('/v2/')) return { items: [], next_cursor: null };
    if (url.pathname === '/matches/older') return { id: 'older', game_id: 'bundled-tictactoe', game_version: 1, players: [], status: 'ongoing', state: { frame: 'live' }, turn_of_player_indices: [0], move_count: 3 };
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.selectMatch('older');
    assert.equal(await store.actions.replay(0), 1); assert.equal(store.getSnapshot().replayIndex, 1);
    assert.deepEqual(store.actions.presentationMessage().state, { frame: 'first move' });
  } finally { restore(); }
});
test('language selection guards a delayed response body from an older download', async () => {
  browserStorage(); const original = globalThis.fetch;
  let release!: (data: any) => void, started!: () => void;
  const decoding = new Promise<void>(resolve => { started = resolve; });
  const data = new Promise(resolve => { release = resolve; });
  globalThis.fetch = (async input => String(input).endsWith('/ar')
    ? { ok: true, json: () => { started(); return data; } }
    : new Response(JSON.stringify({ direction: 'ltr', catalog: { messages: { 'audit.language': 'Español' } }, games: {} }))) as typeof fetch;
  try {
    const first = setLocale('ar'); await decoding; await setLocale('es');
    release({ direction: 'rtl', catalog: { messages: { 'audit.language': 'Arabic' } }, games: {} });
    assert.equal(await first, false); assert.equal(getDirection(), 'ltr'); assert.equal(t('audit.language'), 'Español');
  } finally { globalThis.fetch = original; }
});
test('native migration archive never downgrades decrypted account passwords into ordinary storage', () => {
  const archive = redactedNativeArchive({ android: { user: { id: 'a', password: 'android-secret' }, raw: { password: 'android-secret', serialized: '{"password":"android-secret"}' } }, ios: { identity: { id: 'i', password: 'ios-secret' }, portal: { matches: [{ board: [null], name: 'Saved game' }] } } });
  assert.doesNotMatch(archive, /android-secret|ios-secret/); assert.match(archive, /Saved game/);
});
test('native browser account linking proves both accounts and stores the canonical survivor', async () => {
  const saved = browserStorage();
  saved['game-platform.accounts.v1'] = JSON.stringify([{ id: 'alice', password: 'guest-secret', display_name: 'Guest' }]); saved['game-platform.current-account.v1'] = 'alice';
  const calls: string[] = [];
  const verified = { user_id: 'bob', password: 'verified-secret', display_name: 'Verified', linked_accounts: [{ kind: 'google' }] };
  const restore = mockedFetch((url, init) => {
    assert.doesNotMatch(url.href, /guest-secret|verified-secret/);
    if (url.pathname === '/users/alice/merge') { calls.push('merge'); assert.equal(init.method, 'POST'); assert.equal((init.headers as any)['X-User-Id'], 'alice'); assert.equal((init.headers as any)['X-User-Password'], 'guest-secret'); assert.deepEqual(JSON.parse(init.body as string), { into_user_id: 'bob', into_password: 'verified-secret' }); return { id: 'bob' }; }
    if (url.pathname === '/auth/me') { calls.push('canonical'); assert.equal((init.headers as any)['X-User-Id'], 'bob'); assert.equal((init.headers as any)['X-User-Password'], 'verified-secret'); return verified; }
  });
  try {
    const store = new PortalStore(testRuntime(), async base => { assert.equal(base, 'https://local.test'); return verified; }); await store.bootstrap('https://local.test'); await store.actions.browserLogin(true);
    assert.deepEqual(calls, ['merge', 'canonical']); assert.equal(store.getSnapshot().account!.id, 'bob'); assert.deepEqual(store.getSnapshot().accounts.map(a => a.id), ['bob']);
    assert.equal(JSON.parse(saved['game-platform.accounts.v1'])[0].linked[0].kind, 'google');
  } finally { restore(); }
});
test('account switch while browser login is open cannot merge or replace the new account', async () => {
  const saved = browserStorage(); saved['game-platform.accounts.v1'] = JSON.stringify([{ id: 'alice', password: 'a', display_name: 'A' }, { id: 'charlie', password: 'c', display_name: 'C' }]); saved['game-platform.current-account.v1'] = 'alice';
  let complete!: (value: any) => void; const browser = new Promise(resolve => { complete = resolve; });
  let merges = 0; const restore = mockedFetch(url => { if (url.pathname.endsWith('/merge')) merges++; });
  try {
    const store = new PortalStore(testRuntime(), () => browser); await store.bootstrap('https://local.test'); const pending = store.actions.browserLogin(true);
    await store.actions.switchAccount('charlie'); complete({ user_id: 'bob', password: 'b', display_name: 'B' }); await assert.rejects(pending, /Account changed/);
    assert.equal(merges, 0); assert.equal(store.getSnapshot().account!.id, 'charlie');
  } finally { restore(); }
});
test('backend merge refusal retains the original account and both sides remain recoverable', async () => {
  const saved = browserStorage(); saved['game-platform.accounts.v1'] = JSON.stringify([{ id: 'alice', password: 'guest-secret', display_name: 'Guest' }]); saved['game-platform.current-account.v1'] = 'alice';
  const restore = mockedFetch(url => { if (url.pathname === '/users/alice/merge') throw new ApiError(409, 'Wait until shared matches end before merging'); });
  try {
    const store = new PortalStore(testRuntime(), async () => ({ user_id: 'bob', password: 'verified-secret', display_name: 'Verified' })); await store.bootstrap('https://local.test');
    await assert.rejects(store.actions.browserLogin(true), /shared matches end/); assert.equal(store.getSnapshot().account!.id, 'alice'); assert.equal(saved['game-platform.current-account.v1'], 'alice');
  } finally { restore(); }
});
test('linked local practice remains visible and resumes after a canonical-account restart', async () => {
  const saved = browserStorage(); saved['game-platform.accounts.v1'] = JSON.stringify([{ id: 'alice', password: 'guest-secret', display_name: 'Guest' }]); saved['game-platform.current-account.v1'] = 'alice';
  const verified = { user_id: 'bob', password: 'verified-secret', display_name: 'Verified' };
  const restore = mockedFetch(url => url.pathname === '/users/alice/merge' ? { id: 'bob' } : url.pathname === '/auth/me' ? verified : undefined);
  try {
    const store = new PortalStore(testRuntime(), async () => verified); await store.bootstrap('https://local.test'); await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0 });
    const id = store.getSnapshot().selectedMatch!.id; const originalPlayers = store.getSnapshot().selectedMatch!.players;
    const sourceKey = new AccountRepository('https://local.test').key('alice'); const sourceBytes = saved[sourceKey];
    await store.actions.browserLogin(true); assert.equal(store.getSnapshot().account!.id, 'bob'); assert.ok(store.getSnapshot().localMatches.some(m => m.id === id)); assert.equal(saved[sourceKey], sourceBytes);
    const restarted = new PortalStore(testRuntime()); await restarted.bootstrap('https://local.test'); assert.equal(restarted.getSnapshot().account!.id, 'bob'); assert.equal(restarted.getSnapshot().selectedMatch!.id, id); assert.deepEqual(restarted.getSnapshot().selectedMatch!.players, originalPlayers);
    await restarted.actions.submitMove({ cell: 4 }); assert.equal(restarted.getSnapshot().selectedMatch!.move_count, 1); assert.equal(saved[sourceKey], sourceBytes);
  } finally { restore(); }
});
test('failed canonical data commit keeps the original account selectable and all original saves untouched', async () => {
  const saved = browserStorage(); saved['game-platform.accounts.v1'] = JSON.stringify([{ id: 'alice', password: 'guest-secret', display_name: 'Guest' }]); saved['game-platform.current-account.v1'] = 'alice';
  const verified = { user_id: 'bob', password: 'verified-secret', display_name: 'Verified' }; const repository = new AccountRepository('https://local.test');
  const restore = mockedFetch(url => url.pathname === '/users/alice/merge' ? { id: 'bob' } : url.pathname === '/auth/me' ? verified : undefined);
  try {
    const store = new PortalStore(testRuntime(), async () => verified); await store.bootstrap('https://local.test'); await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0 });
    const originalSource = saved[repository.key('alice')], originalAccounts = saved['game-platform.accounts.v1'];
    (saved as any).setItem = (key: string, value: string) => { if (key === repository.key('bob')) throw new Error('disk full'); saved[key] = String(value); };
    await assert.rejects(store.actions.browserLogin(true), /disk full/); assert.equal(store.getSnapshot().account!.id, 'alice'); assert.ok(store.getSnapshot().accounts.some(a => a.id === 'alice')); assert.equal(saved['game-platform.accounts.v1'], originalAccounts); assert.equal(saved[repository.key('alice')], originalSource); assert.match(store.getSnapshot().storageError!, /remains selectable/);
  } finally { restore(); }
});
test('localization uses a matching catalog version and pinned-package strings for old matches', async () => {
  browserStorage(); const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ locale: 'ar', direction: 'rtl', catalog: { messages: {} }, games: { g: { version: 7, name: 'Latest Arabic', description: 'Latest', strings: { roll: 'latest roll' } } } }))) as typeof fetch;
  try {
    await setLocale('ar'); assert.equal(getDirection(), 'rtl');
    const latest = { id: 'g', version: 7, name: 'Source latest', description: 'Source' }; assert.equal(localizeGame(latest).name, 'Latest Arabic');
    const pinned = { id: 'g', version: 3, name: 'Original', description: 'Original description', translations: { ar: { name: 'Pinned Arabic', description: 'Pinned description', client_strings: { roll: 'pinned roll' } } } };
    assert.equal(localizeGame(pinned).name, 'Pinned Arabic'); assert.equal(gameTexts(pinned).strings.roll, 'pinned roll');
  } finally { globalThis.fetch = original; }
});
