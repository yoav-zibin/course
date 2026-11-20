import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalStore,type LocalMatch,type Match} from '../src/core';
import {AccountRepository} from '../src/core/repository';
import {REMOVED_SAVED_MATCH} from '../src/core/single-player';
import bundled from '../src/core/bundled-tictactoe.json';

const base='https://saved-match-removal.test',id='local-old';
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
function local(matchId=id):LocalMatch {
  return {id:matchId,game_id:'tictactoe',game_version:1,owner_user_id:'alice',match_kind:'computer',localMode:'computer',
    players:[{id:'human',player_index:0,kind:'human',user_id:'alice'},{id:'computer',player_index:1,kind:'computer',user_id:null}],
    state:{n:9},logicState:{n:9,private:'retained game state'},initialState:{n:0},initialTurn:[0],practiceSeed:3,
    turn_of_player_indices:null,status:'over',move_count:9,moves:[{move_number:9,new_state:{n:9},next_turn_player_indices:null}],
    created_at:'2026-11-19T00:00:00Z',local_revision:10,cloud_pending:true};
}
async function fixture(payload='') {
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),previousFetch=globalThis.fetch;
  const saved:Record<string,any>={'game-platform.accounts.v1':JSON.stringify(['alice','bob'].map(id=>({id,password:'synthetic',display_name:id}))),'game-platform.current-account.v1':'alice'};
  let quota=Infinity,quotaFailures=0,remote:Match|null=null,syncResponse:((body:any)=>Promise<Response>)|null=null;
  Object.defineProperties(saved,{getItem:{value:(key:string)=>saved[key]??null},setItem:{value:(key:string,value:string)=>{
    if(key.startsWith('buildplay.shared.')&&Buffer.byteLength(value)>quota){quotaFailures++;throw new DOMException('Synthetic storage is full','QuotaExceededError');}
    saved[key]=String(value);
  }},removeItem:{value:(key:string)=>{delete saved[key];}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:saved});
  const calls:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request,init:RequestInit={})=>{
    const url=new URL(String(input)),method=init.method||'GET';calls.push(method+' '+url.pathname);let value:any=[],status=200;
    if(url.pathname==='/storage/capabilities')value={pagination:false};
    else if(url.pathname==='/auth/config')value={};
    else if(url.pathname==='/i18n/locales')value={locales:[{code:'en',direction:'ltr'}]};
    else if(url.pathname.startsWith('/i18n/bundle/'))value={catalog:{messages:{},direction:'ltr'},games:{}};
    else if(/^\/users\/[^/]+$/.test(url.pathname))value={id:url.pathname.split('/').at(-1),token_balance:0};
    else if(url.pathname==='/matches')value=remote?[remote]:[];
    else if(url.pathname===`/matches/${id}`){if(remote)value=remote;else{status=404;value={detail:'match not found'};}}
    else if(url.pathname==='/matches/single-player-sync'){if(syncResponse)return syncResponse(JSON.parse(String(init.body)));status=404;value={detail:'game version not found'};}
    return new Response(JSON.stringify(value),{status});
  }) as typeof fetch;
  const repository=new AccountRepository(base),match=local();if(payload)match.logicState.payload=payload;
  const queue={requestId:'original-retry-key',body:{move:{cell:3},expected_move_count:8},baseState:{n:8},baseTurn:[0]};
  await repository.mutate('alice',data=>{
    data.local[id]=match;data.local['keep-me']=local('keep-me');data.queues[id]=[queue];
    data.conflicts[id]={message:'Cloud saving needs attention: game version not found. Your saved turns are preserved.'};
    data.conflicts['keep-me']={message:'Another pending match must stay unchanged'};
  });
  await repository.mutate('bob',data=>{data.local[id]={...local(),owner_user_id:'bob'};});
  const store=new PortalStore(async()=>({}));await store.bootstrap(base);
  const expected=()=>copy(store.getSnapshot().localMatches.find(match=>match.id===id)!);
  return {saved,repository,store,calls,queue,match,expected,setQuota:(bytes:number)=>{quota=bytes;},quotaFailures:()=>quotaFailures,
    showCloud:(match:Match)=>{remote=match;},onSync:(response:(body:any)=>Promise<Response>)=>{syncResponse=response;},restore(){globalThis.fetch=previousFetch;if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete(globalThis as any).localStorage;}};
}

test('a never-uploaded old save can be removed without a server request, retaining its complete recovery branch',async()=>{
  const f=await fixture();
  try{
    const before=await f.repository.read('alice'),other=await f.repository.read('bob');
    await assert.rejects(f.store.actions.deleteLocal(id),/Save or resolve/);
    await assert.rejects(f.store.actions.resolveConflict(id),/match not found/);
    await f.store.actions.removeSavedMatch(id,f.expected());
    const after=await f.repository.read('alice'),archive=after.archives[0];
    assert.equal(archive.kind,REMOVED_SAVED_MATCH);assert.deepEqual(archive.match,before.local[id]);
    assert.deepEqual(archive.moves,before.queues[id]);assert.deepEqual(archive.conflict,before.conflicts[id]);
    assert.equal(after.local[id],undefined);assert.equal(after.queues[id],undefined);assert.equal(after.conflicts[id],undefined);
    assert.deepEqual(after.local['keep-me'],before.local['keep-me']);assert.deepEqual(after.conflicts['keep-me'],before.conflicts['keep-me']);
    assert.deepEqual(await f.repository.read('bob'),other);
    assert.equal(f.store.getSnapshot().pending,1);assert.equal(f.store.getSnapshot().archived.length,1);
    assert.deepEqual(f.calls.filter(call=>/^(POST|DELETE) \/matches/.test(call)),[]);
  }finally{f.restore();}
});

test('a changed local branch cannot be removed by a stale confirmation',async()=>{
  const f=await fixture();
  try{
    const expected=f.expected();await f.repository.mutate('alice',data=>{data.local[id].local_revision!++;data.local[id].logicState.n=10;});
    await assert.rejects(f.store.actions.removeSavedMatch(id,expected),/changed.*Review/);
    const data=await f.repository.read('alice');assert.equal(data.local[id].logicState.n,10);assert.deepEqual(data.queues[id],[f.queue]);assert.equal(data.archives.length,0);
  }finally{f.restore();}
});

test('removing a listed save preserves an unrelated selected board and retires only its own creation intent',async()=>{
  const f=await fixture();
  try{
    await f.repository.mutate('alice',data=>{data.local['keep-me'].game_id='bundled-tictactoe';});
    await f.store.actions.selectMatch('keep-me');const selected=copy(f.store.getSnapshot().selectedMatch);
    const creation={requestId:'retained-creation-key',body:{client_match_id:id,game_id:'tictactoe'}};
    await f.repository.mutate('alice',data=>{data.creations={[id]:creation};});
    assert.equal(await f.store.actions.removeSavedMatch(id,f.expected()),false);
    const after=await f.repository.read('alice');assert.equal(after.selectedId,'keep-me');
    assert.deepEqual(f.store.getSnapshot().selectedMatch,selected);assert.equal(after.creations?.[id],undefined);
    assert.deepEqual(after.archives[0].creation,creation);assert.equal(f.store.getSnapshot().pending,1);
  }finally{f.restore();}
});

test('a newly resolved save must use ordinary cloud deletion rather than a stale removal confirmation',async()=>{
  const f=await fixture();
  try{
    const expected=f.expected();await f.repository.mutate('alice',data=>{data.local[id].cloud_revision=1;data.local[id].synced_local_revision=10;data.local[id].cloud_pending=false;delete data.queues[id];delete data.conflicts[id];});
    await assert.rejects(f.store.actions.removeSavedMatch(id,expected),/unsynced single-player/);
    assert.equal((await f.repository.read('alice')).archives.length,0);
  }finally{f.restore();}
});

test('a failed durable archive write preserves the original pending save and retry key',async()=>{
  const f=await fixture();
  try{
    f.setQuota(1);await assert.rejects(f.store.actions.removeSavedMatch(id,f.expected()),/full|storage|quota/i);
    const data=await f.repository.read('alice');assert.deepEqual(data.local[id],f.match);assert.deepEqual(data.queues[id],[f.queue]);assert.ok(data.conflicts[id]);assert.equal(data.archives.length,0);
  }finally{f.restore();}
});

test('a removal archive survives archive trimming and quota pressure while legacy credentials are redacted',async()=>{
  const f=await fixture('durable-pending-history'.repeat(60000));
  try{
    await f.repository.mutate('alice',data=>{(data.local[id] as any).oldCredentials={password:'legacy-credential-never-export'};});
    await f.store.actions.refresh();await f.store.actions.removeSavedMatch(id,f.expected());
    const original=await f.repository.read('alice');assert.ok(JSON.stringify(original.archives[0]).length>1_000_000);
    assert.doesNotMatch(JSON.stringify(original.archives),/legacy-credential-never-export/);
    const originalBytes=Buffer.byteLength(JSON.stringify(original));f.setQuota(originalBytes+100000);
    await f.repository.mutate('alice',data=>{data.responses['/recoverable-download']={payload:'x'.repeat(400000)};});
    assert.ok(f.quotaFailures()>0);const after=await f.repository.read('alice');
    assert.deepEqual(after.archives,original.archives);assert.equal(after.local[id],undefined);assert.equal(after.responses['/recoverable-download'],undefined);
  }finally{f.restore();}
});

test('a delayed acknowledgement and later cloud downloads cannot resurrect a removed device copy',async()=>{
  const f=await fixture();let release!:()=>void;
  try{
    await f.repository.mutate('alice',data=>{delete data.conflicts[id];delete data.queues[id];});
    let started!:()=>void;const entered=new Promise<void>(done=>{started=done;}),gate=new Promise<void>(done=>{release=done;});let remote:Match|undefined,posts=0;
    f.onSync(async body=>{
      posts++;started();await gate;
      const response:Match={...body.match,cloud_revision:1,single_player_state:body.match};remote=response;f.showCloud(response);
      return new Response(JSON.stringify(response),{status:200});
    });
    const syncing=f.store.actions.refresh();await entered;
    // This is the actual rendered snapshot: refresh published it before sync
    // persisted transport metadata and then paused waiting for HTTP.
    const expected=f.expected();assert.equal(expected.cloud_inflight,undefined);
    assert.equal((await f.repository.read('alice')).local[id].cloud_inflight!.snapshot.id,id);
    await f.store.actions.removeSavedMatch(id,expected);
    release();await syncing;assert.equal(posts,1);
    await f.repository.cache('alice',`/matches/${id}`,remote);await f.store.actions.refresh();
    const after=await f.repository.read('alice');assert.equal(after.local[id],undefined);assert.equal(after.conflicts[id],undefined);
    assert.equal(after.archives[0].match.cloud_inflight.snapshot.id,id);assert.equal(after.archives[0].kind,REMOVED_SAVED_MATCH);
    assert.equal(f.store.getSnapshot().myMatches.some(match=>match.id===id),false);
    const restarted=new PortalStore(async()=>({}));await restarted.bootstrap(base);
    assert.equal(restarted.getSnapshot().localMatches.some(match=>match.id===id),false);assert.equal(restarted.getSnapshot().myMatches.some(match=>match.id===id),false);
  }finally{release?.();f.restore();}
});

test('an account change while removal waits prevents archiving either account',async()=>{
  const f=await fixture(),original=AccountRepository.prototype.mutate;let release!:()=>void,entered!:()=>void,hold=true;
  const gate=new Promise<void>(done=>{release=done;}),started=new Promise<void>(done=>{entered=done;});
  try{
    AccountRepository.prototype.mutate=async function<T>(owner:string,update:any):Promise<T>{if(owner==='alice'&&hold){hold=false;entered();await gate;}return original.call(this,owner,update) as Promise<T>;};
    const removing=assert.rejects(f.store.actions.removeSavedMatch(id,f.expected()),/Account changed/);await started;
    await f.store.actions.switchAccount('bob');release();await removing;
    assert.ok((await f.repository.read('alice')).local[id]);assert.ok((await f.repository.read('bob')).local[id]);
    assert.equal((await f.repository.read('alice')).archives.length,0);assert.equal((await f.repository.read('bob')).archives.length,0);
  }finally{release();AccountRepository.prototype.mutate=original;f.restore();}
});

test('old links and a stale saved selection cannot reopen a removed cloud copy as an actionable board',async()=>{
  const f=await fixture();
  try{
    await f.repository.mutate('alice',data=>{data.local['keep-me'].game_id='bundled-tictactoe';});
    await f.store.actions.selectMatch('keep-me');
    await f.store.actions.removeSavedMatch(id,f.expected());
    const archive=copy((await f.repository.read('alice')).archives),snapshot=archive[0].match;
    // MatchOut keeps portable localMode inside single_player_state, never as
    // an outer field. Without the guard this can look like an online board.
    const remote:Match={...Object.fromEntries(['id','game_id','game_version','owner_user_id','match_kind','players','status','state','turn_of_player_indices','move_count','created_at'].map(key=>[key,snapshot[key]])),
      cloud_revision:1,single_player_state:snapshot} as Match;
    f.showCloud(remote);const before=f.calls.length;
    await assert.rejects(f.store.actions.selectMatch(id),/saved copy was removed.*recovery data/);
    assert.equal(f.store.getSnapshot().selectedMatch?.id,'keep-me');
    assert.equal(f.calls.slice(before).some(call=>call===`GET /matches/${id}`),false);
    await f.repository.mutate('alice',data=>{data.selectedId=id;data.responses[`/matches/${id}`]=remote;data.responses['/matches']=[remote];});
    const restarted=new PortalStore(async()=>({})),seen:{retiredRow:boolean;retiredBoard:boolean}[]=[];
    restarted.subscribe(()=>{const state=restarted.getSnapshot();seen.push({retiredRow:state.myMatches.some(match=>match.id===id),retiredBoard:state.selectedMatch?.id===id});});
    await restarted.bootstrap(base);
    assert.ok(seen.length>0);assert.ok(seen.every(state=>!state.retiredRow&&!state.retiredBoard),'no stale retired row or board flashes during any bootstrap state');
    assert.equal(restarted.getSnapshot().selectedMatch,null);
    await assert.rejects(restarted.actions.selectMatch(id),/saved copy was removed.*recovery data/);
    const after=await f.repository.read('alice');assert.equal(after.local[id],undefined);assert.deepEqual(after.archives,archive);
  }finally{f.restore();}
});

test('another tab refresh retires its selected board and cached row without requesting a removed match',async()=>{
  const f=await fixture();
  try{
    await f.repository.mutate('alice',data=>{data.local[id].game_id='bundled-tictactoe';});
    await f.store.actions.refresh();
    const remote:Match={...f.match,cloud_revision:1,single_player_state:f.match};f.showCloud(remote);
    const other=new PortalStore(async()=>({}));await other.bootstrap(base);await other.actions.selectMatch(id);
    assert.ok(other.getSnapshot().myMatches.some(match=>match.id===id));
    const bob=await f.repository.read('bob');await f.store.actions.removeSavedMatch(id,f.expected());
    const archive=copy((await f.repository.read('alice')).archives),before=f.calls.length;
    await other.actions.refresh();
    assert.equal(other.getSnapshot().selectedMatch,null);assert.equal(other.getSnapshot().history,null);assert.equal(other.getSnapshot().replayIndex,null);
    assert.equal(other.getSnapshot().myMatches.some(match=>match.id===id),false);assert.equal(other.getSnapshot().localMatches.some(match=>match.id===id),false);
    assert.equal(f.calls.slice(before).includes(`GET /matches/${id}`),false);
    assert.deepEqual((await f.repository.read('alice')).archives,archive);assert.deepEqual(await f.repository.read('bob'),bob);
    assert.deepEqual(f.calls.filter(call=>call.startsWith('DELETE /matches')),[]);
  }finally{f.restore();}
});

test('retiring the previous board in another tab does not cancel navigation to an unrelated save',async()=>{
  const f=await fixture();
  try{
    await f.repository.mutate('alice',data=>{data.local[id].game_id=data.local['keep-me'].game_id='bundled-tictactoe';});
    await f.store.actions.refresh();const other=new PortalStore(async()=>({}));await other.bootstrap(base);await other.actions.selectMatch(id);
    await f.store.actions.removeSavedMatch(id,f.expected());await other.actions.selectMatch('keep-me');
    assert.equal(other.getSnapshot().selectedMatch?.id,'keep-me');assert.equal(other.getSnapshot().game?.id,'bundled-tictactoe');
    assert.equal((await f.repository.read('alice')).selectedId,'keep-me');assert.equal(other.getSnapshot().myMatches.some(match=>match.id===id),false);
  }finally{f.restore();}
});

test('selection waiting for the repository lock cannot reactivate a copy another tab removed',async()=>{
  const f=await fixture(),original=AccountRepository.prototype.mutate;let release!:()=>void,entered!:()=>void,hold=false;
  const gate=new Promise<void>(done=>{release=done;}),started=new Promise<void>(done=>{entered=done;});
  try{
    await f.repository.mutate('alice',data=>{data.local[id].game_id=data.local['keep-me'].game_id='bundled-tictactoe';});
    await f.store.actions.refresh();const other=new PortalStore(async()=>({}));await other.bootstrap(base);await other.actions.selectMatch('keep-me');
    AccountRepository.prototype.mutate=async function<T>(owner:string,update:any):Promise<T>{if(owner==='alice'&&hold){hold=false;entered();await gate;}return original.call(this,owner,update) as Promise<T>;};
    hold=true;const selecting=assert.rejects(other.actions.selectMatch(id),/saved copy was removed.*recovery data/);await started;
    await f.store.actions.removeSavedMatch(id,f.expected());const archive=copy((await f.repository.read('alice')).archives);release();await selecting;
    assert.equal(other.getSnapshot().selectedMatch?.id,'keep-me');assert.equal((await f.repository.read('alice')).local[id],undefined);
    assert.deepEqual((await f.repository.read('alice')).archives,archive);
  }finally{release?.();AccountRepository.prototype.mutate=original;f.restore();}
});

test('a delayed game download cannot finish reopening a copy removed by another tab',async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(done=>{release=done;}),started=new Promise<void>(done=>{entered=done;});
  try{
    await f.repository.mutate('alice',data=>{data.local[id].game_id='slow-game';});await f.store.actions.refresh();
    const fetch=globalThis.fetch;
    globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
      if(new URL(String(input)).pathname==='/games/slow-game/versions/1'){entered();await gate;return new Response(JSON.stringify({...bundled,id:'slow-game',version:1}),{status:200});}
      return fetch(input,init);
    }) as typeof fetch;
    const other=new PortalStore(async()=>({}));await other.bootstrap(base);
    const selecting=other.actions.selectMatch(id);await started;await f.store.actions.removeSavedMatch(id,f.expected());
    const archive=copy((await f.repository.read('alice')).archives);release();await selecting;
    assert.equal(other.getSnapshot().selectedMatch,null);assert.equal(other.getSnapshot().localMatches.some(match=>match.id===id),false);
    assert.deepEqual((await f.repository.read('alice')).archives,archive);assert.equal((await f.repository.read('alice')).local[id],undefined);
  }finally{release?.();f.restore();}
});
