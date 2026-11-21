import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalStore} from '../src/core';
import {AccountRepository} from '../src/core/repository';
import {diagnosticSnapshot} from '../src/core/diagnostics';
import bundled from '../src/core/bundled-tictactoe.json';

const base='https://cache-fallback.test';
const game={...bundled,id:'session-download',version:7};
const packagePath=`/games/${game.id}/versions/${game.version}`;
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value));

async function fixture(signedIn=false){
  const oldStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),oldFetch=globalThis.fetch;
  const values:Record<string,string>={};
  if(signedIn){values['game-platform.accounts.v1']=JSON.stringify(['alice','bob'].map(id=>({id,password:'synthetic-only',display_name:id})));values['game-platform.current-account.v1']='alice';}
  const fault={write:null as Error|null,read:(_key:string)=>false,remove:null as Error|null,removed:[] as string[]};
  Object.defineProperties(values,{
    getItem:{value:(key:string)=>{if(fault.read(key))throw new Error('saved cache read unavailable');return values[key]??null;}},
    setItem:{value:(key:string,value:string)=>{if(key.startsWith('buildplay.shared.v1.')&&fault.write)throw fault.write;values[key]=String(value);}},
    removeItem:{value:(key:string)=>{fault.removed.push(key);if(fault.remove)throw fault.remove;delete values[key];}},
  });
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:values});
  const calls:string[]=[],responses={custom:null as null|((url:URL,init:RequestInit)=>unknown)};
  globalThis.fetch=(async(input:string|URL|Request,init:RequestInit={})=>{
    const url=new URL(String(input));calls.push(`${init.method||'GET'} ${url.pathname}`);let result:any=[];
    const custom=responses.custom?.(url,init);
    if(custom!==undefined)result=custom;
    else if(url.pathname==='/storage/capabilities')result={pagination:false};
    else if(url.pathname==='/auth/config')result={};
    else if(url.pathname==='/i18n/locales')result={locales:[{code:'en',name:'English',direction:'ltr'}]};
    else if(url.pathname.startsWith('/i18n/bundle/'))result={catalog:{messages:{},direction:'ltr'},games:{}};
    else if(url.pathname===`/games/${game.id}`||url.pathname===packagePath)result=game;
    else if(/^\/users\/[^/]+$/.test(url.pathname))result={id:url.pathname.split('/').at(-1),token_balance:0,is_verified:false};
    return new Response(JSON.stringify(result),{status:200});
  }) as typeof fetch;
  const repo=new AccountRepository(base);
  await repo.mutate('visitor',data=>{
    const pending={id:'pending',game_id:'old-pending',game_version:1,owner_user_id:'visitor',match_kind:'pass_and_play',localMode:'pass',
      status:'ongoing',cloud_pending:true,local_revision:1,players:[],turn_of_player_indices:[0],state:{exact:true},logicState:{private:'retained-state'},moves:[],move_count:0};
    data.local.pending=pending as any;data.responses['/matches/pending']=pending;
    data.responses['/games/old-pending/versions/1']={...bundled,id:'old-pending',version:1};
    data.queues.pending=[{requestId:'retain-exact-retry',body:{move:{cell:2},expected_move_count:0},baseState:{exact:true},baseTurn:[0]}];
    data.conflicts.pending={message:'retain-conflict'};
    data.archives=[{id:'recovery',match:{...pending,id:'recovery'},moves:[{requestId:'retain-recovery'}]}];
  });
  await repo.mutate('other',data=>{data.archives=[{private:'another account remains unchanged'}];});
  const store=new PortalStore(async()=>({}));await store.bootstrap(base);
  await (store as any).offlineDownloadPromise?.catch(()=>{});
  return {values,fault,repo,store,calls,responses,restore(){globalThis.fetch=oldFetch;if(oldStorage)Object.defineProperty(globalThis,'localStorage',oldStorage);else delete(globalThis as any).localStorage;}};
}

function assertNoStorageBanner(store:PortalStore){
  assert.equal(store.getSnapshot().error,null);assert.equal(store.getSnapshot().storageError,null);
}
function cacheLogs(){return (diagnosticSnapshot().logs as {message:string}[]).filter(entry=>entry.message.includes('Device cache could not be saved'));}

test('unavailable optional cache keeps a downloaded game usable across reloads and logs without its payload',async()=>{
  const f=await fixture();
  try{
    const original=clone(f.values),other=await f.repo.read('other');
    f.fault.write=new Error('permission denied: secret-error-never-record');
    await f.store.actions.selectGame(game.id);
    assert.equal(f.store.getSnapshot().game?.id,game.id);assert.equal(f.store.getSnapshot().network,true);assertNoStorageBanner(f.store);
    assert.ok(f.calls.includes(`GET /games/${game.id}`));
    assert.equal((f.store as any).exactPackage(game.id,game.version).server_code,game.server_code);
    await (f.store as any).cache('/optional-payload',{private:'cached-payload-never-record'});
    await (f.store as any).cache('/optional-payload-again',{private:'cached-payload-never-record'});
    await (f.store as any).reloadData();
    assert.equal((f.store as any).exactPackage(game.id,game.version).server_code,game.server_code);
    assert.deepEqual(f.values,original);assert.deepEqual(await f.repo.read('other'),other);assertNoStorageBanner(f.store);
    const logs=cacheLogs();assert.ok(logs.length>0);assert.equal(logs.filter(entry=>entry.message.includes('"operation":"download"')).length,1,'repeated background failures do not crowd out other diagnostics');
    assert.match(JSON.stringify(logs),/unavailable/);assert.doesNotMatch(JSON.stringify(logs),/secret-error-never-record|cached-payload-never-record/);
  }finally{f.restore();}
});

test('failed quota cleanup keeps navigation working without deleting pending saves or other accounts',async()=>{
  const f=await fixture();
  try{
    const original=clone(f.values);
    f.fault.write=new DOMException('full: raw-quota-error-never-record','QuotaExceededError');
    f.fault.remove=new Error('cleanup is unavailable');
    await f.store.actions.selectGame(game.id);await (f.store as any).reloadData();
    assert.equal(f.store.getSnapshot().game?.id,game.id);assertNoStorageBanner(f.store);
    assert.ok(f.fault.removed.length>0,'recovery attempted existing optional origin caches');
    assert.deepEqual(f.values,original,'failed writes and failed removals keep all existing storage bytes');
    const saved=await f.repo.read('visitor');assert.equal(saved.queues.pending[0].requestId,'retain-exact-retry');assert.ok(saved.responses['/games/old-pending/versions/1']);
    const logs=JSON.stringify(cacheLogs());assert.match(logs,/quota/);assert.doesNotMatch(logs,/raw-quota-error-never-record|retained-state|retain-exact-retry/);
  }finally{f.restore();}
});

test('a failed cache reread falls back to the fetched package and survives a later successful data reload',async()=>{
  const f=await fixture();
  try{
    const original=f.values[f.repo.key('visitor')];let sharedReads=0;
    f.fault.write=new DOMException('full','QuotaExceededError');
    f.fault.read=key=>key===f.repo.key('visitor')&&++sharedReads>=2;
    assert.deepEqual(await (f.store as any).cache(packagePath,game),game);assertNoStorageBanner(f.store);
    f.fault.read=()=>false;await (f.store as any).reloadData();
    assert.equal((f.store as any).exactPackage(game.id,game.version).server_code,game.server_code);
    assert.equal(f.values[f.repo.key('visitor')],original);assertNoStorageBanner(f.store);assert.ok(cacheLogs().length>0);
  }finally{f.restore();}
});

test('a failed cache operation from a previous account cannot install session data or errors into the new account',async()=>{
  const f=await fixture(true),repo=(f.store as any).repository as AccountRepository,original=repo.cacheData.bind(repo);
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(done=>{release=done;}),entered=new Promise<void>(done=>{started=done;});
  try{
    const before=f.values[f.repo.key('alice')];
    repo.cacheData=async(owner,path,value)=>{if(owner==='alice'&&path==='/only-alice'){started();await gate;throw new Error('previous-account-error-never-record');}return original(owner,path,value);};
    const downloading=assert.rejects((f.store as any).cache('/only-alice',{private:'previous-account-download'}),/Account changed/);await entered;
    await f.store.actions.switchAccount('bob');await (f.store as any).offlineDownloadPromise?.catch(()=>{});release();await downloading;
    assert.equal(f.store.getSnapshot().account?.id,'bob');assert.equal((f.store as any).data.responses['/only-alice'],undefined);assertNoStorageBanner(f.store);
    assert.equal(f.values[f.repo.key('alice')],before);assert.equal((await f.repo.read('bob')).responses['/only-alice'],undefined);
    assert.doesNotMatch(JSON.stringify(diagnosticSnapshot()),/previous-account-error-never-record|previous-account-download/);
  }finally{release?.();repo.cacheData=original;f.restore();}
});

test('a cloud-confirmed move continues online after outbox storage fails and records diagnostics instead of a banner',async()=>{
  const f=await fixture(true);
  try{
    const match={id:'online',game_id:game.id,game_version:game.version,match_kind:'multiplayer',owner_user_id:'alice',status:'ongoing',move_count:0,state:{exact:'before'},turn_of_player_indices:[0],
      players:[{id:'alice',user_id:'alice',kind:'human',player_index:0},{id:'bob',user_id:'bob',kind:'human',player_index:1}]};
    const after={...match,move_count:1,state:{exact:'confirmed'},status:'over',turn_of_player_indices:null};
    const posted:{body:any;requestId:string|null}[]=[];
    f.responses.custom=(url,init)=>{
      if(url.pathname==='/matches/online')return match;
      if(url.pathname==='/matches/online/moves'&&init.method==='POST'){
        posted.push({body:JSON.parse(String(init.body)),requestId:new Headers(init.headers).get('Idempotency-Key')});return after;
      }
      return undefined;
    };
    await f.store.actions.selectMatch('online');const original=f.values[f.repo.key('alice')],other=f.values[f.repo.key('other')];
    f.fault.write=new DOMException('quota exceeded','QuotaExceededError');
    await f.store.actions.submitMove({cell:2});
    assert.equal(posted.length,1);assert.deepEqual(posted[0].body,{move:{cell:2},expected_move_count:0});assert.ok(posted[0].requestId);
    assert.equal(f.store.getSnapshot().selectedMatch?.move_count,1);assert.equal(f.store.getSnapshot().selectedMatch?.state.exact,'confirmed');assertNoStorageBanner(f.store);
    assert.equal((f.store as any).data.queues.online,undefined);assert.equal((f.store as any).data.conflicts.online,undefined);
    assert.equal(f.values[f.repo.key('alice')],original);assert.equal(f.values[f.repo.key('other')],other);
    assert.ok(cacheLogs().some(entry=>entry.message.includes('"operation":"online-action"')));
  }finally{f.restore();}
});
