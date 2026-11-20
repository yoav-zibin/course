import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError, type PortalApi} from '../src/core/api';
import {AccountRepository, type StorageAdapter} from '../src/core/repository';
import {syncMatchCreations} from '../src/core/match-creation-sync';
import {RetryableSyncCompatibilityError} from '../src/core/sync-compatibility';

class MemoryStorage implements StorageAdapter {
  values=new Map<string,string>();
  async getItem(key:string){return this.values.get(key) || null;}
  async setItem(key:string,value:string){this.values.set(key,value);}
  async keys(){return [...this.values.keys()];}
  async exclusive<T>(_key:string,run:()=>Promise<T>){return run();}
}
const account={id:'alice',display_name:'Alice',password:'synthetic'};
async function fixture(){
  const repository=new AccountRepository('https://lobby.test',new MemoryStorage());
  await repository.mutate('alice',data=>{data.creations={lobby:{requestId:'stable-request',body:{game_id:'g',match_kind:'multiplayer',client_match_id:'lobby'}}};data.responses['/matches/lobby']={id:'lobby',match_kind:'multiplayer',game_id:'g',game_version:1};});
  return repository;
}
function api(run:(body:any)=>any):PortalApi{return {request:async(method:string,path:string,body:any,_account:any,key:string)=>{
  assert.equal(method,'POST');assert.equal(path,'/matches');assert.equal(key,'stable-request');return run(body);
}} as unknown as PortalApi;}
const extraFields=[{type:'extra_forbidden',loc:['body','match_kind']},{type:'extra_forbidden',loc:['body','client_match_id']}];

test('an old backend rejecting only new creation fields keeps the outbox retryable after deployment',async()=>{
  const repository=await fixture();let deployed=false,posts=0;
  const server=api(body=>{posts++;if(!deployed)throw new ApiError(422,'Unprocessable Entity',extraFields);return {id:body.client_match_id,match_kind:'multiplayer'};});
  await assert.rejects(syncMatchCreations(server,repository,account,{guard(){}}),RetryableSyncCompatibilityError);
  assert.ok((await repository.read('alice')).creations!.lobby);assert.equal((await repository.read('alice')).conflicts.lobby,undefined);
  deployed=true;await syncMatchCreations(server,repository,account,{guard(){}});
  assert.equal(posts,2);assert.equal((await repository.read('alice')).creations!.lobby,undefined);
});

test('a historical generic creation 422 conflict gets one safe retry for its stable intent',async()=>{
  const repository=await fixture();await repository.mutate('alice',data=>{data.conflicts.lobby={message:'This lobby could not be saved: Unprocessable Entity. Its creation is preserved on this device.'};});
  let posts=0;await syncMatchCreations(api(body=>{posts++;return {id:body.client_match_id,match_kind:'multiplayer'};}),repository,account,{guard(){}});
  const saved=await repository.read('alice');assert.equal(posts,1);assert.equal(saved.conflicts.lobby,undefined);assert.equal(saved.creations!.lobby,undefined);
});

test('a real validation failure after the historical generic retry remains parked',async()=>{
  const repository=await fixture();await repository.mutate('alice',data=>{data.conflicts.lobby={message:'This lobby could not be saved: Unprocessable Entity. Its creation is preserved on this device.'};});
  let posts=0;const server=api(()=>{posts++;throw new ApiError(422,'Unprocessable Entity',[{type:'greater_than_equal',loc:['body','bet_per_player']}]);});
  await syncMatchCreations(server,repository,account,{guard(){}});await syncMatchCreations(server,repository,account,{guard(){}});
  const saved=await repository.read('alice');assert.equal(posts,1);assert.ok(saved.creations!.lobby);assert.ok(saved.conflicts.lobby);assert.equal(saved.creations!.lobby.compatibility_retried,true);
});

test('ordinary forbidden fields, malformed payloads and game conflicts stay preserved',async()=>{
  for(const error of [new ApiError(422,'Unprocessable Entity',[{type:'extra_forbidden',loc:['body','unknown_field']}]),
    new ApiError(422,'Unprocessable Entity',[...extraFields,{type:'missing',loc:['body','game_id']}]),new ApiError(400,'Invalid stake'),new ApiError(409,'Match changed')]) {
    const repository=await fixture();await syncMatchCreations(api(()=>{throw error;}),repository,account,{guard(){}});
    const saved=await repository.read('alice');assert.ok(saved.creations!.lobby);assert.ok(saved.conflicts.lobby);
  }
});
