import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { PortalStore } from '../src/core';
import { rulesSource } from '../src/game/runtimeSource';
import { AccountRepository } from '../src/core/repository';
import { redactedArchive } from '../src/core/redaction';
import { setLocale, localizeGame, gameTexts, getDirection, t } from '../src/platform/i18n';
import { AccountScopeChangedError, visibleErrorMessage } from '../src/core/account-scope';
import { ApiError } from '../src/core/api';
import { matchOutcome } from '../src/core/results';
import { presentationSteps } from '../src/game/interactions';

function browserStorage(signedInGuest = false) {
  const values: Record<string,string> = {};
  Object.defineProperties(values, {
    getItem: { value: (key: string) => Object.hasOwn(values, key) ? values[key] : null },
    setItem: { writable: true, configurable: true, value: (key: string, value: string) => { values[key] = String(value); } },
    removeItem: { value: (key: string) => { delete values[key]; } },
  });
  if (signedInGuest) { values['game-platform.accounts.v1']=JSON.stringify([{id:'visitor',password:'synthetic-guest-credential',display_name:''}]);values['game-platform.current-account.v1']='visitor'; }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: values }); return values;
}
function mockedFetch(extra: (url: URL, init: RequestInit) => any = () => undefined) {
  const original = globalThis.fetch;
  const cloud = new Map<string, any>();
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)); let value = await extra(url, init);
    if (value === undefined) {
      if (url.pathname === '/matches/single-player-sync') { const body=JSON.parse(init.body as string), previous=cloud.get(body.match.id); value={...body.match,cloud_revision:(previous?.cloud_revision || 0)+1,single_player_state:body.match}; cloud.set(value.id,value); }
      else if (url.pathname.startsWith('/matches/local-') && cloud.has(url.pathname.slice('/matches/'.length))) value=cloud.get(url.pathname.slice('/matches/'.length));
      else if (url.pathname === '/i18n/locales') value = { locales: [{ code: 'en', name: 'English', direction: 'ltr' }] };
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

test('signed-out users must sign in before creating any match',async()=>{
  browserStorage();const restore=mockedFetch();
  try {
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    await assert.rejects(store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0}),/Log in/);
    await assert.rejects(store.actions.createMatch({game_id:'bundled-tictactoe'}),/Log in/);
    assert.equal(store.getSnapshot().localMatches.length,0);
  } finally {restore();}
});

test('a not-yet-deployed save route backs off without parking the save or marking working networking offline',async()=>{
  browserStorage(true);let deployed=false,posts=0;const restore=mockedFetch(url=>{
    if(url.pathname==='/matches/single-player-sync'){posts++;if(!deployed)throw new ApiError(404,'Not Found');}
  });
  try {
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');await store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0});
    await store.actions.refresh();await store.actions.refresh();
    const id=store.getSnapshot().selectedMatch!.id,data=await new AccountRepository('https://local.test').read('visitor');
    assert.equal(posts,1);assert.equal(data.conflicts[id],undefined);assert.ok(data.local[id].cloud_inflight);assert.equal(store.getSnapshot().network,true);
    deployed=true;(store as any).syncCompatibilityRetryAfter=0;await store.actions.refresh();
    assert.equal(posts,2);assert.equal(store.getSnapshot().selectedMatch!.cloud_pending,false);
  } finally {restore();}
});

test('an explicit local-only native test launch plays and resumes without an account or network calls',async()=>{
  browserStorage();let requests=0;const restore=mockedFetch(()=>{requests++;});
  try {
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test',true);
    assert.equal(store.getSnapshot().account,null);assert.equal(store.getSnapshot().network,false);
    const match=await store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0});
    await store.actions.practiceMove({cell:0});
    assert.equal(store.getSnapshot().selectedMatch!.move_count,1);
    assert.equal(store.getSnapshot().selectedMatch!.state.board[0],0);
    assert.deepEqual(store.getSnapshot().selectedMatch!.turn_of_player_indices,[1]);
    const restarted=new PortalStore(testRuntime());await restarted.bootstrap('https://local.test',true);
    assert.equal(restarted.getSnapshot().account,null);assert.deepEqual(restarted.getSnapshot().accounts,[]);
    assert.equal(restarted.getSnapshot().selectedMatch!.id,match.id);
    assert.equal(restarted.getSnapshot().selectedMatch!.move_count,1);
    assert.equal(restarted.getSnapshot().selectedMatch!.state.board[0],0);
    assert.equal(requests,0);
  } finally {restore();}
});

test('multiplayer creation is durable before POST and retries a lost acknowledgement using the same match id',async()=>{
  browserStorage(true);const repository=new AccountRepository('https://local.test');let remote:any,first=true;const ids:string[]=[];
  const restore=mockedFetch(async(url,init)=>{
    if(url.pathname==='/matches'&&init.method==='POST') {
      const body=JSON.parse(init.body as string);ids.push(body.client_match_id);
      const durable=await repository.read('visitor');assert.ok(durable.creations?.[body.client_match_id]);assert.equal(durable.responses[`/matches/${body.client_match_id}`].match_kind,'multiplayer');
      remote ||= {...durable.responses[`/matches/${body.client_match_id}`],cloud_pending:false,invite_code:'abcd'};
      if(first){first=false;throw new TypeError('response lost after creation');}
      return remote;
    }
    if(remote&&url.pathname===`/matches/${remote.id}`)return remote;
  });
  try {
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    const created=await store.actions.createMatch({game_id:'bundled-tictactoe',bet_per_player:0});await store.actions.refresh();
    assert.equal(created.match_kind,'multiplayer');assert.ok((await repository.read('visitor')).creations?.[created.id]);
    const restarted=new PortalStore(testRuntime());await restarted.bootstrap('https://local.test');
    assert.deepEqual(ids,[created.id,created.id]);assert.deepEqual((await repository.read('visitor')).creations,{});
    assert.equal(restarted.getSnapshot().selectedMatch!.id,created.id);assert.equal(restarted.getSnapshot().selectedMatch!.invite_code,'abcd');
  } finally {restore();}
});

test('a failed initial local save prevents a multiplayer creation request',async()=>{
  const saved=browserStorage(true);let posts=0;const restore=mockedFetch((url,init)=>{if(url.pathname==='/matches'&&init.method==='POST')posts++;});
  try {
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    const set=(saved as any).setItem;(saved as any).setItem=(key:string,value:string)=>{if(key===new AccountRepository('https://local.test').key('visitor'))throw new DOMException('Quota exceeded','QuotaExceededError');set(key,value);};
    await assert.rejects(store.actions.createMatch({game_id:'bundled-tictactoe'}),error=>(error as Error).name==='QuotaExceededError');
    assert.equal(posts,0);assert.equal(store.getSnapshot().selectedMatch,null);
  } finally {restore();}
});

test('a clean cloud mirror deleted on another device is archived and removed from the match list',async()=>{
  browserStorage(true);let deleted=false,id='';const restore=mockedFetch(url=>{
    if(deleted&&url.pathname===`/matches/${id}`)throw new ApiError(404,'Match deleted');
  });
  try {
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    await store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0});await store.actions.refresh();
    id=store.getSnapshot().selectedMatch!.id;assert.equal(store.getSnapshot().selectedMatch!.cloud_pending,false);
    deleted=true;await store.actions.refreshMatch();
    const data=await new AccountRepository('https://local.test').read('visitor');assert.equal(data.local[id],undefined);
    assert.equal(data.archivedMatches.find(item=>item.id===id)?.match.id,id);assert.equal(store.getSnapshot().selectedMatch,null);
    assert.ok(!store.getSnapshot().localMatches.some(match=>match.id===id));assert.ok(!store.getSnapshot().myMatches.some(match=>match.id===id));
  } finally {restore();}
});

test('a deleted cloud match with unsent turns keeps its complete local branch for conflict review',async()=>{
  browserStorage(true);let deleted=false,id='';const restore=mockedFetch((url,init)=>{
    if(deleted&&url.pathname==='/matches/single-player-sync')throw new ApiError(409,'Match deleted');
    if(deleted&&url.pathname===`/matches/${id}`)throw new ApiError(404,'Match deleted');
  });
  try {
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    await store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0});await store.actions.refresh();id=store.getSnapshot().selectedMatch!.id;
    deleted=true;await store.actions.submitMove({cell:0});await store.actions.refresh();await store.actions.refreshMatch();
    const data=await new AccountRepository('https://local.test').read('visitor');assert.equal(data.local[id].move_count,1);
    assert.equal(data.local[id].moves.length,1);assert.match(data.conflicts[id].message,/preserved/);
    assert.ok(!data.archivedMatches.some(item=>item.id===id));assert.equal(store.getSnapshot().selectedMatch!.id,id);
    assert.equal(store.actions.presentationMessage().acting_for_player_index,1);
  } finally {restore();}
});

test('refresh completes without requesting retired match discovery endpoints', async()=>{
  browserStorage();const paths:string[]=[];
  const restore=mockedFetch(url=>{
    paths.push(url.pathname);
    if(['/matches/open','/v2/matches/open','/matchmaking/quick-match'].includes(url.pathname)) throw new Error('Retired match discovery');
  });
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');await store.actions.refresh();
    assert.equal(store.getSnapshot().error,null);
    assert.ok(paths.includes('/games'));
    assert.ok(!paths.some(path=>path.includes('/matches/open')||path.includes('/quick-match')));
  }finally{restore();}
});

test('cold launch restores the saved locale and catalog while server configuration is pending',async()=>{
  const saved=browserStorage();
  saved['game-platform.locale.v1']='ar';
  saved['game-platform.i18n-bundle.v1:ar']=JSON.stringify({data:{direction:'rtl',messages:{welcome:'أهلاً'}}});
  await new AccountRepository('https://local.test').cache('visitor','/games',[{id:'cached',name:'Cached game'}]);
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const calls:string[]=[];
  const restore=mockedFetch(async url=>{
    calls.push(url.pathname);
    if(url.pathname.startsWith('/i18n/')||url.pathname==='/storage/capabilities')await gate;
  });
  const store=new PortalStore(testRuntime());
  let ready!:()=>void;
  const restored=new Promise<void>(resolve=>{ready=resolve;});
  const unsubscribe=store.subscribe(()=>{if(store.getSnapshot().ready)ready();});
  const boot=store.bootstrap('https://local.test');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    await Promise.race([restored,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Local restore waited for the network')),1500);})]);
    assert.equal(getDirection(),'rtl');
    assert.equal(store.getSnapshot().games[0].id,'cached');
    const refresh=store.actions.refresh();
    release();await Promise.all([boot,refresh]);
    assert.equal(calls.filter(path=>path==='/auth/config').length,1);
    assert.equal(calls.filter(path=>path==='/games').length,1);
  }finally{clearTimeout(timer);release();await boot;unsubscribe();restore();}
});

for(const signedIn of [false,true])test(`bootstrap releases its initial loading state for ${signedIn?'a saved account':'a visitor'}`,async()=>{
  const saved=browserStorage(),restore=mockedFetch();
  if(signedIn){saved['game-platform.accounts.v1']=JSON.stringify([{id:'alice',password:'synthetic-secret',display_name:'Alice'}]);saved['game-platform.current-account.v1']='alice';}
  try{
    const store=new PortalStore(testRuntime());await store.actions.bootstrap('https://local.test');
    assert.equal(store.getSnapshot().ready,true);
    assert.equal(store.getSnapshot().account?.id??null,signedIn?'alice':null);
    assert.equal(store.getSnapshot().loading,false);
  }finally{restore();}
});

test('an older account operation cannot clear the current account loading state',async()=>{
  const saved=browserStorage();
  saved['game-platform.accounts.v1']=JSON.stringify(['alice','bob'].map(id=>({id,password:id,display_name:id})));
  saved['game-platform.current-account.v1']='alice';
  let releaseOld!:()=>void,releaseNew!:()=>void,oldStarted!:()=>void,newStarted!:()=>void;
  const oldGate=new Promise<void>(resolve=>{releaseOld=resolve;}),newGate=new Promise<void>(resolve=>{releaseNew=resolve;});
  const oldBegin=new Promise<void>(resolve=>{oldStarted=resolve;}),newBegin=new Promise<void>(resolve=>{newStarted=resolve;});
  const fixture=JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8'));
  const restore=mockedFetch(async url=>{
    if(url.pathname==='/games/older'){oldStarted();await oldGate;return {...fixture,id:'older'};}
    if(url.pathname==='/games/newer'){newStarted();await newGate;return {...fixture,id:'newer'};}
  });
  try{
    const store=new PortalStore(testRuntime());await store.actions.bootstrap('https://local.test');
    const old=assert.rejects(store.actions.selectGame('older'), error=>{
      assert.ok(error instanceof AccountScopeChangedError);
      assert.equal(visibleErrorMessage(error),null);
      return true;
    });await oldBegin;
    await store.actions.switchAccount('bob');
    const current=store.actions.selectGame('newer');await newBegin;assert.equal(store.getSnapshot().loading,true);
    releaseOld();await old;assert.equal(store.getSnapshot().loading,true);assert.equal(store.getSnapshot().error,null);
    releaseNew();await current;assert.equal(store.getSnapshot().loading,false);
    assert.equal(store.getSnapshot().selectedGameId,'newer');
  }finally{releaseOld();releaseNew();restore();}
});

test('RAM-only downloads cannot regress a match and optional quota failures do not become storage banners',async()=>{
  const saved=browserStorage(),restore=mockedFetch();
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    const original=(saved as any).setItem;
    (saved as any).setItem=(key:string,value:string)=>{if(key.startsWith('buildplay.shared.v1.'))throw new DOMException('quota exceeded','QuotaExceededError');original(key,value);};
    const fresh=await (store as any).cache('/matches/observed',{id:'observed',move_count:5,state:'newest'});
    assert.equal(fresh.move_count,5);assert.equal(store.getSnapshot().storageError,null);
    await (store as any).cache('/users/unrelated',{id:'unrelated'});
    assert.equal((store as any).data.responses['/matches/observed'].move_count,5);
    const stale=await (store as any).cache('/matches/observed',{id:'observed',move_count:4,state:'stale'});
    assert.equal(stale.move_count,5);assert.equal((store as any).data.responses['/matches/observed'].state,'newest');assert.equal(store.getSnapshot().storageError,null);
    (saved as any).setItem=original;
    await new AccountRepository('https://local.test').mutate('visitor',data=>{data.responses['/matches/observed']={id:'observed',move_count:4,state:'durable queue base'};data.queues.observed=[{requestId:'another-tab-key',body:{move:{cell:2},expected_move_count:4},baseState:'durable queue base',baseTurn:[0]}];});
    const queued=await (store as any).cache('/matches/observed',{id:'observed',move_count:6,state:'must not replace queued base'});assert.equal(queued.state,'durable queue base');
    await (store as any).reloadData();assert.equal((store as any).data.responses['/matches/observed'].state,'durable queue base');
  }finally{restore();}
});

test('a quota failure updating a pinned pending download only skips optional cache metadata',async()=>{
  const saved=browserStorage(),restore=mockedFetch();
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');const repo=new AccountRepository('https://local.test');
    await repo.mutate('visitor',data=>{data.responses['/matches/pending']={id:'pending',game_id:'g',game_version:7,move_count:0,state:'exact base'};data.responses['/games/g/versions/7']={id:'g',version:7,server_code:'exact rules'};data.queues.pending=[{requestId:'exact-request',body:{move:{cell:2},expected_move_count:0},baseState:'exact base',baseTurn:[0]}];});
    await (store as any).reloadData();const original=saved[repo.key('visitor')],set=(saved as any).setItem;
    (saved as any).setItem=(key:string,value:string)=>{if(key===repo.key('visitor'))throw new DOMException('quota exceeded','QuotaExceededError');set(key,value);};
    const result=await (store as any).cache('/matches/pending',{id:'pending',move_count:2,state:'must not replace queued base'});
    assert.equal(result.state,'exact base');assert.equal(saved[repo.key('visitor')],original);assert.equal(store.getSnapshot().storageError,null);
  }finally{restore();}
});

test('full device storage still opens online matches and games while keeping saved play intact',async()=>{
  const saved=browserStorage(true);
  const game={...JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8')),id:'online-quota-game',version:7};
  const match={id:'online-quota-match',game_id:game.id,game_version:game.version,players:[],status:'ongoing',state:{exact:true},turn_of_player_indices:[0],move_count:0};
  const restore=mockedFetch(url=>url.pathname===`/matches/${match.id}`?match:url.pathname.startsWith(`/games/${game.id}`)?game:undefined);
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    await store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0});
    const localId=store.getSnapshot().selectedMatch!.id,repo=new AccountRepository('https://local.test');
    await repo.mutate('visitor',data=>{data.responses['/matches/pending']={...match,id:'pending'};data.queues.pending=[{requestId:'keep-exact-request',body:{move:{cell:2},expected_move_count:0},baseState:{exact:true},baseTurn:[0]}];});
    const original=saved[repo.key('visitor')],set=(saved as any).setItem;
    (saved as any).setItem=(key:string,value:string)=>{if(key===repo.key('visitor'))throw new DOMException('The quota has been exceeded.','QuotaExceededError');set(key,value);};
    await store.actions.selectMatch(match.id);
    assert.equal(store.getSnapshot().selectedMatch!.id,match.id);assert.equal(store.getSnapshot().game!.id,game.id);
    assert.equal(store.getSnapshot().error,null);assert.equal(store.getSnapshot().storageError,null);assert.equal(store.getSnapshot().network,true);
    await store.actions.selectGame(game.id);
    assert.equal(store.getSnapshot().selectedMatch,null);assert.equal(store.getSnapshot().game!.id,game.id);assert.equal(store.getSnapshot().error,null);
    assert.equal(saved[repo.key('visitor')],original);
    const durable=await repo.read('visitor');assert.ok(durable.local[localId]);assert.equal(durable.queues.pending[0].requestId,'keep-exact-request');
    // New local play still requires a durable save; optional navigation cannot
    // turn a failed game or move write into apparent success.
    await assert.rejects(store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0}),error=>(error as Error).name==='QuotaExceededError');
    assert.equal(saved[repo.key('visitor')],original);
  }finally{restore();}
});

test('an exact RAM-only package is committed atomically with a durable pending action',async()=>{
  const saved=browserStorage();saved['game-platform.accounts.v1']=JSON.stringify([{id:'alice',password:'alice-secret',display_name:'Alice'}]);saved['game-platform.current-account.v1']='alice';
  const game={...JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8')),id:'quota-package',version:7};
  const match={id:'m',game_id:game.id,game_version:7,owner_user_id:'alice',players:[{id:'alice',user_id:'alice',kind:'human',player_index:0}],status:'ongoing',state:{exact:true},turn_of_player_indices:[0],move_count:0,created_at:'2026-01-01T00:00:00Z'};
  const path=`/games/${game.id}/versions/7`,repo=new AccountRepository('https://local.test'),set=(saved as any).setItem;
  (saved as any).setItem=(key:string,value:string)=>{if(key===repo.key('alice')){const data=JSON.parse(value);if(data.responses[path]&&!data.queues.m?.length)throw new DOMException('quota exceeded','QuotaExceededError');}set(key,value);};
  const restore=mockedFetch((url,init)=>{if(url.pathname==='/matches/m/moves'&&init.method==='POST')throw new TypeError('offline');if(url.pathname==='/matches/m')return match;if(url.pathname===path)return game;});
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');await store.actions.selectMatch('m');assert.equal((await repo.read('alice')).responses[path],undefined);assert.equal(store.getSnapshot().storageError,null);
    await store.actions.submitMove({cell:2});const durable=await repo.read('alice');assert.deepEqual(durable.responses[path],game);assert.equal(durable.queues.m.length,1);assert.deepEqual(durable.queues.m[0].baseState,{exact:true});assert.ok(durable.queues.m[0].requestId);
  }finally{restore();}
});

test('a cold match requests both resources concurrently and only saves the matching immutable package',async()=>{
  for (const matching of [true,false]) {
    browserStorage();
    const game={...JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8')),id:'opening-game',version:4};
    const match={id:'opening',game_id:game.id,game_version:4,players:[],status:'ongoing',state:{},turn_of_player_indices:[0],move_count:0};
    let resume!:()=>void, canonicalReads=0, matchReads=0;
    const matchGate=new Promise<void>(resolve=>{resume=resolve;});
    const restore=mockedFetch(async url=>{
      if(url.pathname==='/matches/opening'){matchReads++;await matchGate;return match;}
      if(url.pathname==='/matches/opening/game'){resume();return matching?game:{...game,version:5};}
      if(url.pathname==='/games/opening-game/versions/4'){canonicalReads++;return game;}
    });
    try {
      const store=new PortalStore(testRuntime());
      await store.bootstrap('https://local.test',false,Promise.resolve('buildplay:///#match=opening'),true);
      assert.equal(store.getSnapshot().selectedMatch?.id,match.id);
      assert.equal(store.getSnapshot().game?.version,game.version);
      assert.equal(matchReads,1);
      assert.equal(canonicalReads,matching?0:1);
      const saved=await new AccountRepository('https://local.test').read('visitor');
      assert.equal(saved.responses['/games/opening-game/versions/5'],undefined);
    } finally {resume();restore();}
  }
});

test('offline cached reads update recency and a recovered cache write publishes its trimmed response set',async()=>{
  const saved=browserStorage();let offline=false;const restore=mockedFetch(()=>{if(offline)throw new TypeError('offline');});
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    await (store as any).cache('/read-again','a'.repeat(100000));await (store as any).cache('/cold','b'.repeat(100000));
    const repo=new AccountRepository('https://local.test'),before=(await repo.read('visitor')).responseRecency!['/read-again'];
    offline=true;assert.equal((await (store as any).read('/read-again')).length,100000);assert.ok((await repo.read('visitor')).responseRecency!['/read-again']>before);
    const original=(saved as any).setItem,limit=Object.values(saved).reduce((n,value)=>n+value.length,0)+100;
    (saved as any).setItem=(key:string,value:string)=>{if(key.startsWith('buildplay.shared.v1.')&&Object.entries(saved).filter(([item])=>item!==key).reduce((n,[,text])=>n+text.length,0)+value.length>limit)throw new DOMException('quota exceeded','QuotaExceededError');original(key,value);};
    await (store as any).cache('/new','c'.repeat(80000));
    assert.equal((store as any).data.responses['/cold'],undefined);assert.ok((store as any).data.responses['/read-again']);assert.equal(store.getSnapshot().storageError,null);
  }finally{restore();}
});

test('public bundled rules support continuous pass-and-play, win, restart and replay', async () => {
  browserStorage(true); const restore = mockedFetch();
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test');
    await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0, names: ['Alex', 'Sam'] });
    const id = store.getSnapshot().selectedMatch!.id;
    await store.actions.submitMove({ cell: 0 }); assert.equal(store.getSnapshot().selectedMatch!.awaitingHandoff, false);
    assert.deepEqual(store.actions.presentationMessage().presentation_history, []);
    assert.equal(store.actions.presentationMessage().acting_for_player_index, 1);
    const restarted = new PortalStore(testRuntime()); await restarted.bootstrap('https://local.test');
    assert.equal(restarted.getSnapshot().selectedMatch!.id, id); assert.equal(restarted.getSnapshot().selectedMatch!.awaitingHandoff, false); assert.equal(restarted.getSnapshot().selectedMatch!.players[1].name, 'Sam');
    assert.equal(restarted.actions.presentationMessage().acting_for_player_index, 1);
    await restarted.actions.replay(1); assert.equal(restarted.getSnapshot().replayIndex, 1); await restarted.actions.replay(null);
    for (const cell of [3,1,4,2]) await restarted.actions.submitMove({ cell });
    const match = restarted.getSnapshot().selectedMatch!; assert.equal(match.status, 'over'); assert.equal(match.state.winner, 0); assert.equal(match.move_count, 5);
    await restarted.actions.replay(0);
    for (let frame = 1; frame <= match.move_count; frame++) {
      assert.equal(await restarted.actions.replay(frame), frame);
      assert.equal(restarted.actions.presentationMessage().acting_for_player_index, null);
    }
    assert.deepEqual(restarted.actions.presentationMessage().view, match.state);
    await restarted.actions.loadHistory(); await restarted.actions.replay(2); const message = restarted.actions.presentationMessage(); assert.equal(message.replay.index, 2); assert.equal(message.acting_for_player_index, null); assert.equal(message.last_move_player_index,1); assert.equal(message.state.board[1], -1);
    await assert.rejects(restarted.actions.submitMove({ cell: 8 }), /live board/);
  } finally { restore(); }
});
test('real bundled computer turns advance using the same shared offline engine', async () => {
  browserStorage(true); const restore = mockedFetch();
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.startPractice('bundled-tictactoe', { humans: 1, computers: 1 });
    await store.actions.submitMove({ cell: 4 }); const match = store.getSnapshot().selectedMatch!;
    assert.equal(match.move_count, 2); assert.deepEqual(match.turn_of_player_indices, [0]); assert.equal(match.state.board.filter((v: number) => v !== -1).length, 2);
    assert.equal(match.awaitingHandoff, false); assert.equal(store.actions.presentationMessage().acting_for_player_index, 0);
  } finally { restore(); }
});
test('local computer batches deliver every accepted intermediate view before publishing the final board', async () => {
  for (const [players, actions] of [[2, 4], [4, 4], [2, 200]]) {
    browserStorage(true);
    const fixture = {id:'local-batch',version:1,name:'Local batch',description:'',allowed_player_counts:[players],renderer_type:'declarative',
      declarative_ui:{format:'buildplay-ui',version:1,viewport:{width:400,height:300},boards:[],piece_types:{},ui_code:'const gameUI={reduce(){return {scene:{}};}};'},
      server_code:`const game={
        newMatch(ctx){return {state:{n:0,seat:0,left:0},turn:[ctx.players[0].id]};},
        applyMove(s,id,m,ctx){
          if(id!==ctx.players[s.seat].id||m.go!==true)throw new InvalidMove('Wrong player');
          s.n++;s.left--;
          if(s.seat===0||s.left===0){s.seat=(s.seat+1)%ctx.players.length;s.left=${actions};}
          return {state:s,turn:[ctx.players[s.seat].id]};
        },
        viewFor(s,id){return {...s,private_for:id};},computerMove(){return {go:true};}
      };`};
    const restore=mockedFetch(url=>url.pathname.startsWith('/games/local-batch')?fixture:undefined);
    try {
      const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
      await store.actions.startPractice(fixture.id,{humans:1,computers:players-1});
      const previous=store.actions.presentationMessage(),published:any[]=[];
      const unsubscribe=store.subscribe(()=>{const message=store.actions.presentationMessage();if(message?.move_count>0)published.push(message);});
      await store.actions.submitMove({go:true});unsubscribe();
      const next=store.actions.presentationMessage(),total=1+(players-1)*actions;
      assert.equal(next.move_count,total);assert.equal(next.view.private_for,'local-player-0');
      assert.ok(published.length);
      for(const message of published){
        assert.ok(message.presentation_history.length<=12);
        const steps=presentationSteps(previous,{...message,presentation_history:store.actions.presentationHistory()});
        assert.deepEqual(steps.map(step=>step.move_count),Array.from({length:total-1},(_,i)=>i+1));
        assert.ok(steps.every(step=>step.acting_for_player_index===null&&(step.view as any).private_for==='local-player-0'));
        assert.ok(steps.every(step=>(step.presentation_history as unknown[]).length<=12));
        assert.deepEqual(steps.map(step=>step.last_move_player_index),Array.from({length:total-1},(_,i)=>i===0?0:1+Math.floor((i-1)/actions)));
      }
      const saved=await new AccountRepository('https://local.test').read('visitor');
      assert.equal(saved.local[store.getSnapshot().selectedMatch!.id].moves!.length,total);
    } finally {restore();}
  }
});
test('computer practice keeps the chosen human view, identity and turn through restart and history', async () => {
  const fixture = { id: 'practice-seats', version: 1, name: 'Practice seats', description: '', allowed_player_counts: [2,3,4], renderer_type: 'declarative',
    declarative_ui: {format:'buildplay-ui',version:1,viewport:{width:400,height:300},boards:[{id:'board',kind:'zone',x:0,y:0,width:400,height:300}],piece_types:{},ui_code:'const gameUI={reduce(){return {scene:{}};}};'}, server_code: `
    const game={
      newMatch(ctx){return {state:{turn:0,moves:[],winner:-1},turn:[ctx.players[0].id]};},
      applyMove(s,id,m,ctx){if(id!==ctx.players[s.turn].id||m.go!==true)throw new InvalidMove('Wrong player');s.moves.push(s.turn);s.turn=(s.turn+1)%ctx.players.length;const done=s.moves.length===ctx.players.length;if(done)s.winner=ctx.players.length-1;return {state:s,turn:done?null:[ctx.players[s.turn].id]};},
      viewFor(s,id,ctx){return {...s,private_for:id};},computerMove(){return {go:true};}
    };` };
  for (const count of [2,3,4]) for (const humanSeat of [0,count-1]) for (const signedIn of [false,true]) {
    const saved=browserStorage(true);
    if(signedIn){saved['game-platform.accounts.v1']=JSON.stringify([{id:'alice',password:'credential-never-in-game',display_name:'Alice'}]);saved['game-platform.current-account.v1']='alice';}
    const restore=mockedFetch(url=>url.pathname.startsWith('/games/practice-seats')?fixture:undefined);
    try {
      const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
      await store.actions.startPractice(fixture.id,{humans:1,computers:count-1,humanSeat});
      const match=store.getSnapshot().selectedMatch!,id=match.id;
      assert.equal(match.players[humanSeat].kind,'human');assert.equal(match.players[humanSeat].user_id,signedIn?'alice':'visitor');
      assert.equal(match.players[humanSeat].name,signedIn?'Alice':`Player ${humanSeat+1}`);
      assert.equal(match.players.filter(player=>player.kind==='computer').length,count-1);
      assert.equal(match.move_count,humanSeat);assert.equal(match.state.private_for,`local-player-${humanSeat}`);
      assert.equal(store.actions.presentationMessage().my_player_index,humanSeat);assert.equal(store.actions.presentationMessage().acting_for_player_index,humanSeat);
      const restarted=new PortalStore(testRuntime());await restarted.bootstrap('https://local.test');
      assert.equal(restarted.getSnapshot().selectedMatch!.id,id);assert.equal(restarted.actions.presentationMessage().acting_for_player_index,humanSeat);
      await restarted.actions.submitMove({go:true});const ended=restarted.getSnapshot().selectedMatch!;
      assert.equal(ended.status,'over');assert.equal(ended.move_count,count);assert.equal(ended.state.private_for,`local-player-${humanSeat}`);
      assert.equal(matchOutcome(ended,signedIn?'alice':'visitor')?.kind,humanSeat===count-1?'win':'loss');
      await restarted.actions.replay(0);assert.equal(restarted.actions.presentationMessage().acting_for_player_index,null);
      assert.equal(restarted.actions.presentationMessage().view.private_for,`local-player-${humanSeat}`);
      for(const frame of (ended as any).moves)assert.equal(frame.new_state.private_for,`local-player-${humanSeat}`);
    } finally {restore();}
  }
});
test('pass-and-play replay attributes each saved private view to its historical human seat after restart',async()=>{
  const fixture={id:'private-replay',version:1,name:'Private replay fixture',description:'',allowed_player_counts:[2,3,4],renderer_type:'declarative',
    declarative_ui:{format:'buildplay-ui',version:1,viewport:{width:400,height:300},boards:[{id:'board',kind:'zone',x:0,y:0,width:400,height:300}],piece_types:{},ui_code:'const gameUI={reduce(){return {scene:{}};}};'},server_code:`const game={
    newMatch(ctx){return {state:{step:0},turn:[ctx.players[0].id]};},
    applyMove(s,id,m,ctx){if(id!==ctx.players[s.step].id||m.go!==true)throw new InvalidMove('Wrong player');s.step++;return {state:s,turn:s.step===ctx.players.length?null:[ctx.players[s.step].id]};},
    viewFor(s,id,ctx){const seat=ctx.players.findIndex(p=>p.id===id);return {...s,private_for:id,hand_counts:ctx.players.map((p,i)=>i+1),your_hand:Array.from({length:seat+1},()=>seat)};}
  };`};
  for(const count of [2,3,4]){
    browserStorage(true);const restore=mockedFetch(url=>url.pathname.startsWith('/games/private-replay')?fixture:undefined);
    try{
      const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');await store.actions.startPractice(fixture.id,{humans:count,computers:0});
      const id=store.getSnapshot().selectedMatch!.id;
      for(let seat=0;seat<count;seat++){if(seat)await store.actions.revealLocal();await store.actions.submitMove({go:true});}
      const restarted=new PortalStore(testRuntime());await restarted.bootstrap('https://local.test');assert.equal(restarted.getSnapshot().selectedMatch!.id,id);
      for(let frame=0;frame<=count;frame++){
        await restarted.actions.replay(frame);const m=restarted.actions.presentationMessage(),expected=frame<count?frame:0;
        assert.equal(m.my_player_index,expected,`frame ${frame} of ${count}`);assert.equal(m.view.private_for,`local-player-${expected}`);
        assert.equal(m.view.your_hand.length,m.view.hand_counts[m.my_player_index]);assert.equal(m.acting_for_player_index,null);
      }
      await restarted.actions.replay(null);assert.equal(restarted.actions.presentationMessage().my_player_index,0);assert.equal(restarted.getSnapshot().selectedMatch!.move_count,count);
    }finally{restore();}
  }
});
test('invalid local counts and human positions cannot create a saved match',async()=>{
  browserStorage(true);const restore=mockedFetch();
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    for(const options of [{humans:0,computers:2},{humans:1.5,computers:.5},{humans:1,computers:-1},{humans:1,computers:1,humanSeat:-1},{humans:1,computers:1,humanSeat:2},{humans:1,computers:1,humanSeat:.5}]){
      await assert.rejects(store.actions.startPractice('bundled-tictactoe',options),/valid local player counts and a human seat/);
      assert.equal(store.getSnapshot().localMatches.length,0);
    }
  }finally{restore();}
});
for (const publicState of [false, undefined, 'true']) test(`private or unknown state (${publicState}) preserves handoff and history protection after restart`, async () => {
  browserStorage(true);
  const fixture = { ...JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json', import.meta.url), 'utf8')), id: 'private-handoff', all_state_public: publicState };
  const restore = mockedFetch(url => url.pathname.startsWith('/games/private-handoff') ? fixture : undefined);
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test');
    await store.actions.startPractice(fixture.id, { humans: 2, computers: 0 });
    await store.actions.submitMove({ cell: 0 }); assert.equal(store.getSnapshot().selectedMatch!.awaitingHandoff, true);
    assert.equal(store.actions.presentationMessage().acting_for_player_index, null);
    await assert.rejects(store.actions.submitMove({ cell: 1 }), /next player is ready/);
    const restarted = new PortalStore(testRuntime()); await restarted.bootstrap('https://local.test');
    assert.equal(restarted.getSnapshot().selectedMatch!.awaitingHandoff, true);
    await assert.rejects(restarted.actions.replay(1), /next player.*ready/i);
    assert.equal(restarted.getSnapshot().replayIndex, null);
    await restarted.actions.revealLocal(); await restarted.actions.replay(1); assert.equal(restarted.getSnapshot().replayIndex, 1);
    await restarted.actions.replay(null); await restarted.actions.submitMove({ cell: 1 });
    assert.equal(restarted.getSnapshot().selectedMatch!.awaitingHandoff, true);
  } finally { restore(); }
});
for (const gameId of ['bundled-tictactoe', 'downloaded-public']) test(`${gameId} matches with a saved pending handoff immediately allow play and history after restart`, async () => {
  browserStorage(true);
  const fixture = { ...JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json', import.meta.url), 'utf8')), id: gameId, all_state_public: true };
  const restore = mockedFetch(url => url.pathname.startsWith('/games/downloaded-public') ? fixture : undefined);
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test');
    await store.actions.startPractice(gameId, { humans: 2, computers: 0 });
    await store.actions.submitMove({ cell: 0 }); const id = store.getSnapshot().selectedMatch!.id;
    const repository = new AccountRepository('https://local.test');
    await repository.mutate('visitor', data => { data.local[id].awaitingHandoff = true; });
    const restarted = new PortalStore(testRuntime()); await restarted.bootstrap('https://local.test');
    assert.equal(restarted.getSnapshot().selectedMatch!.awaitingHandoff, false);
    assert.equal(restarted.actions.presentationMessage().acting_for_player_index, 1);
    await restarted.actions.replay(1); await restarted.actions.replay(null);
    await restarted.actions.submitMove({ cell: 1 });
    assert.equal(restarted.getSnapshot().selectedMatch!.move_count, 2);
    assert.equal(restarted.getSnapshot().selectedMatch!.awaitingHandoff, false);
  } finally { restore(); }
});
test('local-only launch loads accounts and resumes local play while making zero network calls', async () => {
  const saved=browserStorage(true); saved['game-platform.accounts.v1']=JSON.stringify([{id:'alice',password:'saved-credential',display_name:'Alice'}]); saved['game-platform.current-account.v1']='alice';
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
    assert.equal(signup.headers['X-Campaign-Code'],'class-a');assert.equal(signup.body.invited_by_user_id,undefined);assert.equal(signup.body.invite_token,'invitation-token');assert.equal(signup.body.campaign,undefined);
    assert.equal(saved['game-platform.invited-by.v1'],undefined);assert.equal(saved['game-platform.invite-token.v1'],undefined);assert.equal(saved['game-platform.experiment-campaign.v1'],'class-a');
  }finally{restore();}
});
test('ordinary match attribution reaches every signup method and reopens the match with authenticated headers',async()=>{
  for(const method of ['guest','google','email','phone'] as const){
    const saved=browserStorage();saved['game-platform.invited-by.v1']='retired-inviter';let signup:any=null;const matchReads:{account:string;linkOpen:string|undefined}[]=[];
    const match={id:'shared-match',game_id:'bundled-tictactoe',game_version:1,match_kind:'multiplayer',owner_user_id:'host',players:[{id:'host',user_id:'host',kind:'human',player_index:0}],status:'waiting_for_players',state:null,turn_of_player_indices:null,move_count:0,created_at:'2026-01-01T00:00:00Z'};
    const restore=mockedFetch((url,init)=>{
      if(init.method==='POST'&&(url.pathname==='/users'||url.pathname==='/auth/google'||url.pathname.endsWith('/verify'))){signup=JSON.parse(init.body as string);return {id:'new-account',password:'new-credential',display_name:'Player'};}
      if(url.pathname==='/matches/shared-match'){matchReads.push({account:(init.headers as Record<string,string>)['X-User-Id']||'anonymous',linkOpen:(init.headers as Record<string,string>)['X-Link-Open']});return match;}
    });
    try{
      const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test',false,'https://local.test/portal?ref=12345#match=shared-match');await store.actions.selectMatch('shared-match');
      if(method==='guest')await store.actions.guest('Player');else if(method==='google')await store.actions.google('synthetic-token');else await store.actions.verifyCode(method,'verification','123456');
      assert.equal(signup.invite_match_id,'shared-match');assert.equal(signup.invite_token,undefined);assert.equal(signup.invited_by_user_id,undefined);assert.equal(saved['game-platform.invited-by.v1'],undefined);assert.equal(saved['game-platform.invite-match.v1'],undefined);
      assert.equal(store.getSnapshot().selectedMatch?.id,'shared-match');assert.equal(matchReads.at(-1)?.account,'new-account');assert.equal(matchReads.at(-1)?.linkOpen,'0');assert.equal(matchReads.filter(read=>read.linkOpen==='1').length,1);
    }finally{restore();}
  }
});

test('bootstrap removes retired personal codes from cached accounts while retaining the saved login',async()=>{
  const saved=browserStorage();saved['game-platform.accounts.v1']=JSON.stringify([{id:'saved-account',password:'saved-password',display_name:'Saved',referral_code:'12345'}]);saved['game-platform.current-account.v1']='saved-account';saved['game-platform.invited-by.v1']='retired-inviter';const restore=mockedFetch();
  try{const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');assert.equal(store.getSnapshot().account?.id,'saved-account');assert.equal(Object.hasOwn(store.getSnapshot().account!,'referral_code'),false);assert.equal(JSON.parse(saved['game-platform.accounts.v1'])[0].referral_code,undefined);assert.equal(saved['game-platform.invited-by.v1'],undefined);}finally{restore();}
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

test('a late API failure cannot publish the previous account private error to the next account',async()=>{
  const saved=browserStorage();
  saved['game-platform.accounts.v1']=JSON.stringify(['alice','bob'].map(id=>({id,password:`${id}-secret`,display_name:id})));
  saved['game-platform.current-account.v1']='alice';
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),begin=new Promise<void>(resolve=>{started=resolve;});
  const restore=mockedFetch(async(url,init)=>{
    if(url.pathname==='/private-action'){
      assert.equal((init.headers as any)['X-User-Id'],'alice');started();await gate;
      throw new ApiError(400,'alice-private-error-and-hand');
    }
  });
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');
    const pending=store.actions.request('POST','/private-action');
    await begin;await store.actions.switchAccount('bob');release();
    await assert.rejects(pending,/Account changed/);
    assert.equal(store.getSnapshot().account!.id,'bob');
    assert.doesNotMatch(store.getSnapshot().error||'',/alice-private/);
  }finally{restore();}
});
test('actual Backgammon package runs through shared practice and persists a legal move', async () => {
  browserStorage(true);
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
  await repository.mutate('alice',data=>{delete data.queues.m;data.conflicts.m={message:'Archived intent needs review'};});
  await repository.cache('alice','/matches/m',{id:'m',move_count:5,state:'remote while conflicted'});assert.equal((await repository.read('alice')).responses['/matches/m'].state,'confirmed');
});
test('opening a game URL synchronously detaches the restored match before its package download', async () => {
  browserStorage(true); let finish!: (value: any) => void; const download = new Promise(resolve => { finish = resolve; });
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
  browserStorage(true); const restore = mockedFetch(url => { if (url.pathname === '/games/missing') throw new ApiError(404, 'Game not found'); });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0 });
    await assert.rejects(store.actions.selectGame('missing'), /Game not found/);
    assert.equal(store.getSnapshot().selectedMatch, null); assert.equal(store.getSnapshot().game, null); assert.equal(store.getSnapshot().selectedGameId, 'missing'); assert.equal(store.getSnapshot().history, null); assert.equal((await new AccountRepository('https://local.test').read('visitor')).selectedId, null);
  } finally { restore(); }
});
test('match polling reuses prepared artwork until the pinned game version changes',async()=>{
  browserStorage();
  const source=JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8'));
  let version=1;
  const downloads:string[]=[];
  const restore=mockedFetch(url=>{
    if(url.pathname==='/matches/opening')return {id:'opening',game_id:'paired-game',game_version:version,
      players:[],status:'ongoing',turn_of_player_indices:[0],move_count:0};
    if(url.pathname.startsWith('/games/paired-game/versions/')){
      downloads.push(url.pathname);
      return {...source,id:'paired-game',version};
    }
  });
  try {
    const store=new PortalStore();
    await store.bootstrap('https://local.test');
    await store.actions.selectMatch('opening');
    const artwork=store.getSnapshot().game!.declarative_ui;
    await store.refreshMatch();
    assert.strictEqual(store.getSnapshot().game!.declarative_ui,artwork);
    version=2;
    await store.refreshMatch();
    assert.equal(store.getSnapshot().game!.version,2);
    assert.notStrictEqual(store.getSnapshot().game!.declarative_ui,artwork);
    assert.deepEqual(downloads,['/games/paired-game/versions/1','/games/paired-game/versions/2']);
  } finally {restore();}
});
test('visitors load an unpublished match’s pinned package and keep it for offline reopening',async()=>{
  browserStorage();
  const game={...JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8')),id:'withdrawn-game',version:7};
  const match={id:'public-archive',game_id:game.id,game_version:game.version,owner_user_id:'host',players:[],status:'ongoing',state:{board:[]},turn_of_player_indices:[0],move_count:0};
  const paths:string[]=[];
  const restore=mockedFetch((url,init)=>{
    paths.push(url.pathname);
    if(url.pathname===`/matches/${match.id}`)return match;
    if(url.pathname===`/games/${game.id}/versions/7`||url.pathname===`/games/${game.id}`)throw new ApiError(404,'Game version not found');
    if(url.pathname===`/matches/${match.id}/game`){assert.equal((init.headers as any)['X-User-Id'],undefined);assert.equal(url.search,'');return game;}
  });
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');await store.actions.selectMatch(match.id);
    assert.equal(store.getSnapshot().account,null);assert.equal(store.getSnapshot().game!.id,game.id);assert.equal(store.getSnapshot().game!.version,7);
    assert.ok(paths.includes(`/matches/${match.id}/game`));
    const saved=await new AccountRepository('https://local.test').read('visitor');assert.equal(saved.responses[`/games/${game.id}/versions/7`].id,game.id);
    const before=paths.length,offline=new PortalStore(testRuntime());await offline.bootstrap('https://local.test',true);await offline.actions.selectMatch(match.id);
    assert.equal(offline.getSnapshot().game!.version,7);assert.equal(paths.length,before);
    const packageCalls=paths.filter(path=>path===`/matches/${match.id}/game`).length;await assert.rejects(store.actions.selectGame(game.id),/Game version not found/);
    assert.equal(paths.filter(path=>path===`/matches/${match.id}/game`).length,packageCalls);
  }finally{restore();}
});
for(const mismatch of [{id:'another-game',version:7},{id:'withdrawn-game',version:8}])test(`a match package with the wrong ${mismatch.id==='another-game'?'identity':'version'} cannot replace its pinned game`,async()=>{
  browserStorage();const game={...JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8')),...mismatch};
  const restore=mockedFetch(url=>{
    if(url.pathname==='/matches/public-archive')return {id:'public-archive',game_id:'withdrawn-game',game_version:7,players:[],status:'ongoing',turn_of_player_indices:[0],move_count:0};
    if(url.pathname==='/games/withdrawn-game/versions/7')throw new ApiError(404,'Game version not found');
    if(url.pathname==='/matches/public-archive/game')return game;
  });
  try{
    const store=new PortalStore(testRuntime());await store.bootstrap('https://local.test');await assert.rejects(store.actions.selectMatch('public-archive'),/wrong version/);
    assert.equal(store.getSnapshot().game,null);assert.equal((await new AccountRepository('https://local.test').read('visitor')).responses['/games/withdrawn-game/versions/7'],undefined);
  }finally{restore();}
});
test('opening another match never pairs its private view with the previous game package', async () => {
  browserStorage(true);
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
test('a delayed removePlayer response cannot reopen a match after navigation', async () => {
  browserStorage(); let release!: (value: any) => void;
  const response = new Promise(resolve => { release = resolve; });
  const match = (id: string) => ({ id, game_id: 'bundled-tictactoe', game_version: 1, players: [], status: 'waiting_for_players', state: null, turn_of_player_indices: [], move_count: 0 });
  const restore = mockedFetch((url, init) => {
    if (init.method === 'DELETE') return response;
    if (url.pathname === '/matches/first') return match('first');
    if (url.pathname === '/matches/second') return match('second');
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.selectMatch('first');
    const pending = store.actions.removePlayer('someone');
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

for (const scenario of [
  { name: 'finished host', status: 'over', account: 'alice', active: true, method: 'DELETE', suffix: '', removes: true },
  { name: 'finished guest', status: 'over', account: 'bob', active: true, method: 'DELETE', suffix: '', removes: true },
  { name: 'finished departed guest', status: 'over', account: 'bob', active: false, method: 'DELETE', suffix: '', removes: true },
  { name: 'waiting host', status: 'waiting_for_players', account: 'alice', active: true, method: 'DELETE', suffix: '', removes: true },
  { name: 'waiting guest', status: 'waiting_for_players', account: 'bob', active: true, method: 'POST', suffix: '/leave', removes: true },
  { name: 'ongoing guest', status: 'ongoing', account: 'bob', active: true, method: 'POST', suffix: '/playerLeft', removes: false },
]) test(`Leave match handles a ${scenario.name}`, async () => {
  const saved = browserStorage();
  saved['game-platform.accounts.v1'] = JSON.stringify([{ id: scenario.account, password: 'synthetic-secret', display_name: scenario.account }]);
  saved['game-platform.current-account.v1'] = scenario.account;
  const match = {
    id: 'leave-me', game_id: 'bundled-tictactoe', game_version: 1, owner_user_id: 'alice', status: scenario.status,
    players: [{ id: 'alice', user_id: 'alice', kind: 'human', player_index: 0 }, { id: 'bob', user_id: 'bob', kind: 'human', player_index: 1, active: scenario.active }],
    state: {}, turn_of_player_indices: scenario.status === 'over' ? null : [0], move_count: 0, created_at: '2026-01-01T00:00:00Z',
  };
  const other = { ...match, id: 'keep-me' };
  const result = { ...match, status: 'over', turn_of_player_indices: null, players: match.players.map(player => player.user_id === scenario.account ? { ...player, active: false } : player), move_count: 1 };
  const mutations: string[] = [];
  const restore = mockedFetch((url, init) => {
    if (url.pathname.startsWith('/matches/leave-me') && init.method !== 'GET') { mutations.push(`${init.method} ${url.pathname}`); return result; }
    if (url.pathname === '/matches/leave-me') return match;
    if (url.pathname === '/matches') return [match, other];
    if (url.pathname === `/users/${scenario.account}`) return { id: scenario.account, token_balance: 100 };
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.selectMatch(match.id);
    await store.actions.leaveMatch();
    assert.deepEqual(mutations, [`${scenario.method} /matches/leave-me${scenario.suffix}`]);
    const durable = await new AccountRepository('https://local.test').read(scenario.account);
    if (scenario.removes) {
      assert.equal(store.getSnapshot().selectedMatch, null);
      assert.deepEqual(store.getSnapshot().myMatches.map(item => item.id), ['keep-me']);
      assert.equal(durable.responses['/matches/leave-me'], undefined);
      assert.deepEqual(durable.responses['/matches'].map((item: any) => item.id), ['keep-me']);
      assert.equal(durable.selectedId, null);
      assert.equal(durable.archivedMatches.length, scenario.name === 'waiting guest' ? 0 : 1);
      assert.equal(durable.archives.length, scenario.name === 'waiting guest' ? 1 : 0);
    } else {
      assert.equal(store.getSnapshot().selectedMatch!.status, 'over');
      assert.equal(store.getSnapshot().selectedMatch!.players[1].active, false);
      assert.equal(durable.responses['/matches/leave-me'].move_count, 1);
      assert.equal(durable.archivedMatches.length, 0);
    }
  } finally { restore(); }
});

test('a guest who leaves a waiting lobby can rejoin and see it in their matches again', async () => {
  const saved = browserStorage(); saved['game-platform.accounts.v1'] = JSON.stringify([{ id: 'bob', password: 'synthetic-secret', display_name: 'Bob' }]); saved['game-platform.current-account.v1'] = 'bob';
  let joined = true;
  const alice = { id: 'alice', user_id: 'alice', kind: 'human', player_index: 0 }, bob = { id: 'bob', user_id: 'bob', kind: 'human', player_index: 1 };
  const match = () => ({ id: 'rejoin-lobby', game_id: 'bundled-tictactoe', game_version: 1, owner_user_id: 'alice', status: 'waiting_for_players', players: joined ? [alice, bob] : [alice], state: null, turn_of_player_indices: null, move_count: 0, created_at: '2026-01-01T00:00:00Z' });
  const restore = mockedFetch((url, init) => {
    if (url.pathname === '/matches/rejoin-lobby/leave' && init.method === 'POST') { joined = false; return match(); }
    if (url.pathname === '/matches/rejoin-lobby/join' && init.method === 'POST') { joined = true; return match(); }
    if (url.pathname === '/matches/rejoin-lobby') return match();
    if (url.pathname === '/matches') return joined ? [match()] : [];
    if (url.pathname === '/users/bob') return { id: 'bob', token_balance: 100 };
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.selectMatch('rejoin-lobby');
    await store.actions.leaveMatch(); await store.actions.refresh();
    assert.deepEqual(store.getSnapshot().myMatches, []);
    await store.actions.selectMatch('rejoin-lobby'); await store.actions.matchAction('join'); store.actions.clearMatch(); await store.actions.refresh();
    assert.deepEqual(store.getSnapshot().myMatches.map(item => item.id), ['rejoin-lobby']);
    const durable = await new AccountRepository('https://local.test').read('bob');
    assert.deepEqual(durable.responses['/matches'].map((item: any) => item.id), ['rejoin-lobby']);
    assert.equal(durable.archivedMatches.length, 0);
  } finally { restore(); }
});

test('a refused Leave match keeps the match selected and saved', async () => {
  const saved = browserStorage(); saved['game-platform.accounts.v1'] = JSON.stringify([{ id: 'alice', password: 'synthetic-secret', display_name: 'Alice' }]); saved['game-platform.current-account.v1'] = 'alice';
  const match = { id: 'refused-leave', game_id: 'bundled-tictactoe', game_version: 1, owner_user_id: 'alice', status: 'over', players: [{ id: 'alice', user_id: 'alice', kind: 'human', player_index: 0 }], state: {}, turn_of_player_indices: null, move_count: 0, created_at: '2026-01-01T00:00:00Z' };
  const restore = mockedFetch((url, init) => {
    if (url.pathname === '/matches/refused-leave' && init.method === 'DELETE') throw new ApiError(403, 'Leaving was refused');
    if (url.pathname === '/matches/refused-leave') return match;
    if (url.pathname === '/matches') return [match];
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.selectMatch(match.id);
    await assert.rejects(store.actions.leaveMatch(), /Leaving was refused/);
    assert.equal(store.getSnapshot().selectedMatch!.id, match.id);
    assert.deepEqual(store.getSnapshot().myMatches.map(item => item.id), [match.id]);
    const durable = await new AccountRepository('https://local.test').read('alice');
    assert.equal(durable.responses['/matches/refused-leave'].id, match.id);
    assert.equal(durable.archivedMatches.length, 0);
  } finally { restore(); }
});

test('a late Leave match response cannot remove another account saved match', async () => {
  const saved = browserStorage(); saved['game-platform.accounts.v1'] = JSON.stringify(['alice', 'bob'].map(id => ({ id, password: `${id}-secret`, display_name: id }))); saved['game-platform.current-account.v1'] = 'alice';
  const match = { id: 'shared-finished', game_id: 'bundled-tictactoe', game_version: 1, owner_user_id: 'alice', status: 'over', players: [{ id: 'alice', user_id: 'alice', kind: 'human', player_index: 0 }, { id: 'bob', user_id: 'bob', kind: 'human', player_index: 1 }], state: {}, turn_of_player_indices: null, move_count: 0, created_at: '2026-01-01T00:00:00Z' };
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), begin = new Promise<void>(resolve => { started = resolve; });
  const restore = mockedFetch(async (url, init) => {
    if (url.pathname === '/matches/shared-finished' && init.method === 'DELETE') { assert.equal((init.headers as any)['X-User-Id'], 'alice'); started(); await gate; return null; }
    if (url.pathname === '/matches/shared-finished') return match;
    if (url.pathname === '/matches') return [match];
  });
  try {
    const store = new PortalStore(testRuntime()); await store.bootstrap('https://local.test'); await store.actions.selectMatch(match.id);
    const pending = assert.rejects(store.actions.leaveMatch(), /Account changed/);
    await begin; await store.actions.switchAccount('bob'); await store.actions.selectMatch(match.id); release(); await pending;
    assert.equal(store.getSnapshot().account!.id, 'bob');
    assert.equal(store.getSnapshot().selectedMatch!.id, match.id);
    assert.deepEqual(store.getSnapshot().myMatches.map(item => item.id), [match.id]);
    const durable = await new AccountRepository('https://local.test').read('bob');
    assert.equal(durable.responses['/matches/shared-finished'].id, match.id);
    assert.equal(durable.archivedMatches.length, 0);
  } finally { release(); restore(); }
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
test('an account archive redacts credentials including copies in serialized values', () => {
  const archive=redactedArchive({id:'a',password:'test-password',notes:'saved with test-password',match:'Saved game'});
  assert.doesNotMatch(archive,/test-password/);
  assert.match(archive,/Saved game/);
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
  const saved = browserStorage(true); saved['game-platform.accounts.v1'] = JSON.stringify([{ id: 'alice', password: 'guest-secret', display_name: 'Guest' }]); saved['game-platform.current-account.v1'] = 'alice';
  const verified = { user_id: 'bob', password: 'verified-secret', display_name: 'Verified' };
  const restore = mockedFetch(url => url.pathname === '/users/alice/merge' ? { id: 'bob' } : url.pathname === '/auth/me' ? verified : undefined);
  try {
    const store = new PortalStore(testRuntime(), async () => verified); await store.bootstrap('https://local.test'); await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0 });
    await store.actions.refresh(); const id = store.getSnapshot().selectedMatch!.id; const originalPlayers = store.getSnapshot().selectedMatch!.players;
    const sourceKey = new AccountRepository('https://local.test').key('alice'); const sourceBytes = saved[sourceKey];
    await store.actions.browserLogin(true); assert.equal(store.getSnapshot().account!.id, 'bob'); assert.ok(store.getSnapshot().localMatches.some(m => m.id === id)); assert.equal(saved[sourceKey], sourceBytes);
    const restarted = new PortalStore(testRuntime()); await restarted.bootstrap('https://local.test'); assert.equal(restarted.getSnapshot().account!.id, 'bob'); assert.equal(restarted.getSnapshot().selectedMatch!.id, id); assert.deepEqual(restarted.getSnapshot().selectedMatch!.players, originalPlayers);
    await restarted.actions.submitMove({ cell: 4 }); assert.equal(restarted.getSnapshot().selectedMatch!.move_count, 1); assert.equal(saved[sourceKey], sourceBytes);
  } finally { restore(); }
});
test('failed canonical data commit keeps the original account selectable and all original saves untouched', async () => {
  const saved = browserStorage(true); saved['game-platform.accounts.v1'] = JSON.stringify([{ id: 'alice', password: 'guest-secret', display_name: 'Guest' }]); saved['game-platform.current-account.v1'] = 'alice';
  const verified = { user_id: 'bob', password: 'verified-secret', display_name: 'Verified' }; const repository = new AccountRepository('https://local.test');
  const restore = mockedFetch(url => url.pathname === '/users/alice/merge' ? { id: 'bob' } : url.pathname === '/auth/me' ? verified : undefined);
  try {
    const store = new PortalStore(testRuntime(), async () => verified); await store.bootstrap('https://local.test'); await store.actions.startPractice('bundled-tictactoe', { humans: 2, computers: 0 });
    await store.actions.refresh(); const originalSource = saved[repository.key('alice')], originalAccounts = saved['game-platform.accounts.v1'];
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

test('starting practice from game details reuses the exact loaded package', async () => {
  browserStorage(true);
  const fixture = {...JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8')),
    id:'loaded-practice-game',version:7};
  let downloads=0;
  const restore=mockedFetch(url=>{
    if(url.pathname===`/games/${fixture.id}`){downloads++;return fixture;}
  });
  try {
    const store=new PortalStore(testRuntime());
    await store.actions.bootstrap('https://local.test');
    await store.actions.selectGame(fixture.id);
    const match=await store.actions.startPractice(fixture.id,{humans:2,computers:0});
    assert.equal(downloads,1);
    assert.equal(match.game_version,fixture.version);
    assert.equal(store.getSnapshot().selectedMatch?.id,match.id);
  } finally {restore();}
});

test('choosing pass and play while the details download creates one match from the shared package',async()=>{
  browserStorage(true);
  const fixture={...JSON.parse(readFileSync(new URL('../src/core/bundled-tictactoe.json',import.meta.url),'utf8')),id:'still-downloading',version:7};
  let release!:(game:typeof fixture)=>void,requested!:()=>void,downloads=0;
  const download=new Promise<typeof fixture>(resolve=>{release=resolve;});
  const firstRequest=new Promise<void>(resolve=>{requested=resolve;});
  const restore=mockedFetch(url=>{
    if(url.pathname==='/games/'+fixture.id){downloads++;requested();return download;}
  });
  try {
    const store=new PortalStore(testRuntime());
    await store.actions.bootstrap('https://local.test');
    const details=store.actions.selectGame(fixture.id);
    await firstRequest;
    const starting=store.actions.startPractice(fixture.id,{humans:2,computers:0});
    release(fixture);
    const [,match]=await Promise.all([details,starting]);
    assert.equal(downloads,1);
    assert.equal(match.game_version,fixture.version);
    assert.deepEqual(store.getSnapshot().localMatches.filter(saved=>saved.game_id===fixture.id).map(saved=>saved.id),[match.id]);
  } finally {release(fixture);restore();}
});
