import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError, PortalApi} from '../src/core/api';
import {AccountRepository, emptyAccountData, equal, type StorageAdapter} from '../src/core/repository';
import {syncSinglePlayerMatches} from '../src/core/single-player-sync';
import {hydrateSinglePlayer, needsCloudSave, singlePlayerSnapshot} from '../src/core/single-player';
import type {Account, LocalMatch, Match} from '../src/core/types';
import {RetryableSyncCompatibilityError} from '../src/core/sync-compatibility';

class MemoryStorage implements StorageAdapter {
  values=new Map<string,string>();
  async getItem(key:string){return this.values.get(key) || null;}
  async setItem(key:string,value:string){this.values.set(key,value);}
  async keys(){return [...this.values.keys()];}
  async exclusive<T>(_key:string,run:()=>Promise<T>){return run();}
}
const account:Account={id:'alice',display_name:'Alice',password:'never-upload-this-credential'};
function local(over=false):LocalMatch {
  return {id:'local-offline',game_id:'g',game_version:3,owner_user_id:'alice',match_kind:'pass_and_play',localMode:'pass',
    players:[{id:'local-player-0',player_index:0,kind:'human',user_id:'alice'},{id:'local-player-1',player_index:1,kind:'human',user_id:null}],
    state:{n:4},logicState:{n:4,private:'owner-only'},initialState:{n:0},initialTurn:[0],practiceSeed:117,
    turn_of_player_indices:over?null:[0],status:over?'over':'ongoing',move_count:4,
    moves:Array.from({length:4},(_,i)=>({move_number:i+1,player_index:i%2,new_state:{n:i+1},next_turn_player_indices:i===3&&over?null:[(i+1)%2]})),
    created_at:'2026-11-20T00:00:00Z',local_revision:5,cloud_pending:true};
}
async function fixture(match=local()) {
  const storage=new MemoryStorage(),repository=new AccountRepository('https://match.test',storage);
  await repository.mutate('alice',data=>{data.local[match.id]=match;data.responses['/games/g/versions/3']={id:'g',version:3,server_code:'pinned exact rules'};});
  return {storage,repository};
}
function cloud(snapshot:LocalMatch,revision:number):Match{return {...snapshot,cloud_revision:revision,single_player_state:snapshot};}
function mockApi(run:(body:any)=>Promise<Match>|Match):PortalApi {
  return {request:async(method:string,path:string,body:any)=>{assert.equal(method,'POST');assert.equal(path,'/matches/single-player-sync');assert.doesNotMatch(JSON.stringify(body),/never-upload-this-credential|cloud_inflight|synced_local_revision/);return run(body);}} as PortalApi;
}

for(const finished of [false,true])test(`existing ${finished?'finished':'ongoing'} practice uploads complete offline history and survives a new device`,async()=>{
  const {repository}=await fixture(local(finished));let posts=0;
  const api=mockApi(body=>{posts++;assert.equal(body.expected_revision,0);assert.equal(body.match.move_count,4);assert.equal(body.match.moves.length,4);assert.equal(body.match.logicState.private,'owner-only');return cloud(body.match,1);});
  await syncSinglePlayerMatches(api,repository,account,{guard(){}});
  const saved=(await repository.read('alice')).local['local-offline'];assert.equal(needsCloudSave(saved),false);assert.equal(saved.cloud_revision,1);assert.equal(saved.practiceSeed,117);
  await syncSinglePlayerMatches(api,repository,account,{guard(){}});assert.equal(posts,1);
  const otherDevice=emptyAccountData();const hydrated=hydrateSinglePlayer(otherDevice,cloud(singlePlayerSnapshot(saved,'alice'),1))!;
  assert.equal(hydrated.localMode,'pass');assert.deepEqual(hydrated.logicState,saved.logicState);assert.deepEqual(hydrated.moves,saved.moves);assert.equal(needsCloudSave(hydrated),false);
});

test('a lost acknowledgement retries the exact saved upload before uploading additional offline turns',async()=>{
  const {storage,repository}=await fixture();let server:Match|undefined,first=true;const counts:number[]=[];
  const api=mockApi(body=>{
    counts.push(body.match.move_count);
    if(server&&equal(server.single_player_state,body.match))return server;
    assert.equal(body.expected_revision,server?.cloud_revision || 0);
    server=cloud(body.match,(server?.cloud_revision || 0)+1);
    if(first){first=false;throw new TypeError('connection lost after commit');}
    return server;
  });
  await assert.rejects(syncSinglePlayerMatches(api,repository,account,{guard(){}}),/connection lost/);
  await repository.mutate('alice',data=>{const match=data.local['local-offline'];match.logicState={n:7};match.state={n:7};match.move_count=7;match.local_revision=8;});
  const restarted=new AccountRepository('https://match.test',storage);
  await syncSinglePlayerMatches(api,restarted,account,{guard(){}});
  assert.deepEqual(counts,[4,4,7]);assert.equal((await restarted.read('alice')).local['local-offline'].cloud_revision,2);
  assert.equal(needsCloudSave((await restarted.read('alice')).local['local-offline']),false);
});

test('local turns can commit while an upload waits and its acknowledgement never rolls them back',async()=>{
  const {repository}=await fixture();let began!:()=>void,release!:()=>void;
  const started=new Promise<void>(resolve=>{began=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});let posts=0;
  const api=mockApi(async body=>{posts++;if(posts===1){began();await gate;}return cloud(body.match,posts);});
  const pending=syncSinglePlayerMatches(api,repository,account,{guard(){}});await started;
  await repository.mutate('alice',data=>{data.local['local-offline'].move_count=6;data.local['local-offline'].logicState={n:6};data.local['local-offline'].local_revision=7;});
  release();await pending;
  const saved=(await repository.read('alice')).local['local-offline'];assert.equal(saved.move_count,6);assert.deepEqual(saved.logicState,{n:6});assert.equal(posts,2);assert.equal(needsCloudSave(saved),false);
});

test('a cloud conflict preserves the complete device branch and blocks an automatic overwrite',async()=>{
  const {repository}=await fixture();let calls=0;
  const api={request:async(method:string)=>{calls++;if(method==='GET')return cloud({...local(),state:{otherDevice:true}},2);throw new ApiError(409,'Revision changed');}} as unknown as PortalApi;
  await syncSinglePlayerMatches(api,repository,account,{guard(){}});
  const saved=await repository.read('alice');assert.deepEqual(saved.local['local-offline'].logicState,{n:4,private:'owner-only'});assert.match(saved.conflicts['local-offline'].message,/another device/);assert.equal(saved.conflicts['local-offline'].remote!.cloud_revision,2);
  hydrateSinglePlayer(saved,cloud({...local(),logicState:{otherDevice:true}},2));assert.equal(saved.local['local-offline'].logicState.private,'owner-only');
  await syncSinglePlayerMatches(api,repository,account,{guard(){}});assert.equal(calls,2);
});

test('an account switch after upload leaves its acknowledgement in the original account only',async()=>{
  const {repository}=await fixture();let changed=false;
  const api=mockApi(body=>{changed=true;return cloud(body.match,1);});
  await assert.rejects(syncSinglePlayerMatches(api,repository,account,{guard(){if(changed)throw new Error('Account changed');}}),/Account changed/);
  assert.equal(needsCloudSave((await repository.read('alice')).local['local-offline']),true);assert.deepEqual((await repository.read('bob')).local,{});
});

test('invalid legacy matches with several human seats and computers are removed without upload',async()=>{
  const invalid=local();invalid.match_kind='computer';invalid.players.push({id:'computer-1',player_index:2,user_id:null,kind:'computer'});
  const {repository}=await fixture(invalid);let posts=0;
  await syncSinglePlayerMatches(mockApi(body=>{posts++;return cloud(body.match,1);}),repository,account,{guard(){}});
  const saved=await repository.read('alice');assert.equal(saved.local['local-offline'],undefined);assert.equal(saved.archivedMatches[0].id,'local-offline');assert.equal(posts,0);
});

test('a merged account can retry its accepted inflight snapshot without changing game player ids',async()=>{
  const {repository}=await fixture();let remote:Match|undefined;
  await assert.rejects(syncSinglePlayerMatches(mockApi(body=>{remote=cloud(body.match,1);throw new TypeError('acknowledgement lost');}),repository,account,{guard(){}}));
  const source=JSON.stringify(await repository.read('alice'));
  await repository.preserveMergedAccounts('bob',['alice']);
  const transferred=singlePlayerSnapshot(remote!.single_player_state!,'bob');remote=cloud(transferred,2);
  await syncSinglePlayerMatches(mockApi(body=>{
    assert.equal(body.match.owner_user_id,'bob');assert.equal(body.match.players[0].user_id,'bob');
    assert.equal(body.match.players[0].id,'local-player-0');assert.deepEqual(body.match,transferred);return remote!;
  }),repository,{...account,id:'bob'},{guard(){}});
  const saved=(await repository.read('bob')).local['local-offline'];assert.equal(saved.cloud_revision,2);assert.equal(needsCloudSave(saved),false);
  assert.equal(JSON.stringify(await repository.read('alice')),source);
});

test('ownership-merge revision advances rebase only a matching cloud ancestor',async()=>{
  const base=local(),pending=local();base.cloud_revision=1;base.local_revision=5;base.synced_local_revision=5;
  pending.cloud_revision=1;pending.synced_local_revision=5;pending.local_revision=6;pending.move_count=5;pending.state={n:5};pending.logicState={n:5};pending.turn_of_player_indices=[1];
  pending.moves.push({move_number:5,player_index:0,new_state:{n:5},next_turn_player_indices:[1]});
  const {repository}=await fixture(pending);await repository.preserveMergedAccounts('bob',['alice']);
  const remote=cloud(singlePlayerSnapshot(base,'bob'),2),attempts:number[]=[];
  const api={request:async(method:string,_path:string,body:any)=>{
    if(method==='GET')return remote;attempts.push(body.expected_revision);
    if(body.expected_revision!==2)throw new ApiError(409,'Ownership merge advanced revision');return cloud(body.match,3);
  }} as unknown as PortalApi;
  await syncSinglePlayerMatches(api,repository,{...account,id:'bob'},{guard(){}});
  const saved=await repository.read('bob');assert.deepEqual(attempts,[1,2]);assert.equal(saved.conflicts['local-offline'],undefined);
  assert.equal(saved.local['local-offline'].move_count,5);assert.equal(saved.local['local-offline'].cloud_revision,3);assert.equal(needsCloudSave(saved.local['local-offline']),false);
});

for(const changed of ['state','seed','history'])test(`an ownership merge cannot rebase a cloud branch with changed ${changed}`,async()=>{
  const original=local();original.cloud_revision=1;original.synced_local_revision=4;
  const {repository}=await fixture(original);await repository.preserveMergedAccounts('bob',['alice']);
  const snapshot=singlePlayerSnapshot(original,'bob');
  if(changed==='state')snapshot.state={different:true};
  if(changed==='seed')snapshot.practiceSeed++;
  if(changed==='history')snapshot.moves[1].new_state={different:true};
  const remote=cloud(snapshot,2);let posts=0;
  const api={request:async(method:string)=>{if(method==='GET')return remote;posts++;throw new ApiError(409,'Different branch');}} as unknown as PortalApi;
  await syncSinglePlayerMatches(api,repository,{...account,id:'bob'},{guard(){}});
  const saved=await repository.read('bob');assert.equal(posts,1);assert.match(saved.conflicts['local-offline'].message,/another device/);assert.deepEqual(saved.local['local-offline'].logicState,original.logicState);
});

test('anonymous saved matches are adopted by one login without copying them to later accounts',async()=>{
  const {repository}=await fixture();await repository.mutate('visitor',data=>{data.local['local-anonymous']={...local(),id:'local-anonymous',owner_user_id:'visitor'};});
  await repository.preserveMergedAccounts('alice',['visitor']);assert.ok((await repository.read('alice')).local['local-anonymous']);
  await repository.preserveMergedAccounts('bob',['visitor']);assert.equal((await repository.read('bob')).local['local-anonymous'],undefined);
  assert.ok((await repository.read('visitor')).local['local-anonymous']);
});

for(const [status,reason] of [[404,'Not Found'],[405,'Method Not Allowed'],[404,'Não encontrado'],[404,'未找到'],[404,'नहीं मिला']] as const)test(`an older backend's ${status} ${reason} save route retries automatically after deployment`,async()=>{
  const {repository}=await fixture();let deployed=false,posts=0;
  const api=mockApi(body=>{posts++;if(!deployed)throw new ApiError(status,reason);return cloud(body.match,1);});
  await assert.rejects(syncSinglePlayerMatches(api,repository,account,{guard(){}}),RetryableSyncCompatibilityError);
  const pending=await repository.read('alice');assert.equal(pending.conflicts['local-offline'],undefined);assert.ok(pending.local['local-offline'].cloud_inflight);
  assert.deepEqual(pending.local['local-offline'].logicState,local().logicState);
  deployed=true;await syncSinglePlayerMatches(api,repository,account,{guard(){}});
  const saved=await repository.read('alice');assert.equal(posts,2);assert.equal(needsCloudSave(saved.local['local-offline']),false);assert.equal(saved.conflicts['local-offline'],undefined);
});

for(const reason of ['Not Found','Method Not Allowed','לא נמצא','Não encontrado','Método não permitido','未找到','不允许的请求方法','नहीं मिला','विधि की अनुमति नहीं है'])test(`a legacy initial-save conflict for ${reason} resumes after backend deployment`,async()=>{
  const {repository}=await fixture();await repository.mutate('alice',data=>{data.conflicts['local-offline']={message:`Cloud saving needs attention: ${reason}. Your saved turns are preserved.`};});
  let posts=0;await syncSinglePlayerMatches(mockApi(body=>{posts++;return cloud(body.match,1);}),repository,account,{guard(){}});
  const saved=await repository.read('alice');assert.equal(posts,1);assert.equal(saved.conflicts['local-offline'],undefined);assert.equal(needsCloudSave(saved.local['local-offline']),false);
});

test('compatibility recovery preserves genuine validation and previously synced missing-match conflicts',async()=>{
  for(const scenario of [{revision:0,message:'Cloud saving needs attention: game version not found. Your saved turns are preserved.'},
    {revision:1,message:'Cloud saving needs attention: Not Found. Your saved turns are preserved.'},
    {revision:0,message:'This match changed on another device. Your saved turns are preserved; review them before using the cloud version.'}]) {
    const snapshot=local();snapshot.cloud_revision=scenario.revision;const {repository}=await fixture(snapshot);
    await repository.mutate('alice',data=>{data.conflicts['local-offline']={message:scenario.message};});let posts=0;
    await syncSinglePlayerMatches(mockApi(body=>{posts++;return cloud(body.match,2);}),repository,account,{guard(){}});
    assert.equal(posts,0);assert.equal((await repository.read('alice')).conflicts['local-offline'].message,scenario.message);
  }
});
