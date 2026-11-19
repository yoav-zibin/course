import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AccountRepository,emptyAccountData,utf8Size,type StorageAdapter} from '../src/core/repository';
import {I18N_RECENCY_KEY,isQuotaError,touchTranslationCache} from '../src/platform/recoverable-cache';

class QuotaStorage implements StorageAdapter {
  values=new Map<string,string>(); limit=Infinity; writes=0; removals:string[]=[]; failure:Error|null=null; failAfter=Infinity;
  async getItem(key:string){return this.values.get(key)??null;}
  async keys(){return [...this.values.keys()];}
  async removeItem(key:string){this.removals.push(key);this.values.delete(key);}
  async setItem(key:string,value:string){
    this.writes++;
    if(this.failure&&this.writes>=this.failAfter)throw this.failure;
    const size=[...this.values].filter(([item])=>item!==key).reduce((n,[item,text])=>n+utf8Size(item)+utf8Size(text),0)+utf8Size(key)+utf8Size(value);
    if(size>this.limit)throw new DOMException('The quota has been exceeded.','QuotaExceededError');
    this.values.set(key,value);
  }
  private active=false;
  async exclusive<T>(_name:string,run:()=>Promise<T>){assert.equal(this.active,false,'quota cleanup must never nest native/global locks');this.active=true;try{return await run();}finally{this.active=false;}}
  size(){return [...this.values].reduce((n,[key,value])=>n+utf8Size(key)+utf8Size(value),0);}
}
test('cached reads and writes advance monotonic recency and trim the least recently used response',async()=>{
  const storage=new QuotaStorage(),repo=new AccountRepository('',storage),now=Date.now;Date.now=()=>100;
  try{
    await repo.cache('alice','/first','a'.repeat(300000));await repo.cache('alice','/second','b'.repeat(300000));
    const before=(await repo.read('alice')).responseRecency!['/first'];await repo.touch('alice','/first');
    assert.ok((await repo.read('alice')).responseRecency!['/first']>before);
    await repo.cache('alice','/newest','c'.repeat(500000));const saved=await repo.read('alice');
    assert.ok(saved.responses['/first']);assert.ok(saved.responses['/newest']);assert.equal(saved.responses['/second'],undefined);
    assert.ok(saved.responseRecency!['/newest']>saved.responseRecency!['/first']);
  }finally{Date.now=now;}
});
test('quota eviction retries with the oldest response and keeps a recently read download',async()=>{
  const storage=new QuotaStorage(),repo=new AccountRepository('',storage);
  await repo.cache('alice','/read-recently','a'.repeat(100000));await repo.cache('alice','/oldest','b'.repeat(100000));
  await repo.touch('alice','/read-recently');storage.limit=storage.size()+200;
  const writes=storage.writes;await repo.cache('alice','/new','c'.repeat(80000));const saved=await repo.read('alice');
  assert.ok(storage.writes>=writes+2);assert.ok(saved.responses['/new']);assert.ok(saved.responses['/read-recently']);assert.equal(saved.responses['/oldest'],undefined);
});
test('cache budget counts UTF-8 bytes rather than UTF-16 string length',async()=>{
  const storage=new QuotaStorage(),repo=new AccountRepository('',storage);
  await repo.cache('alice','/old','漢'.repeat(180000));await repo.cache('alice','/new','漢'.repeat(180000));
  const saved=await repo.read('alice');assert.equal(saved.responses['/old'],undefined);assert.ok(saved.responses['/new']);assert.equal(utf8Size('A漢🙂'),8);
});
test('quota cleanup preserves local/archived packages, queue bases, selection and pinned history',async()=>{
  const storage=new QuotaStorage(),repo=new AccountRepository('',storage),data=emptyAccountData();
  const match=(id:string,version:number)=>({id,game_id:'game',game_version:version,state:{id},move_count:4});
  data.local.local={...match('local',1),practiceSeed:123,moves:[{new_state:{exact:true}}],initialState:{seeded:true}} as any;
  data.queues.pending=[{requestId:'exact-key',body:{move:{cell:2},expected_move_count:4},baseState:{exact:true},baseTurn:[1]}];
  data.responses['/matches/pending']=match('pending',2);data.responses['/matches/conflicted']=match('conflicted',3);
  data.conflicts.conflicted={message:'preserve',remote:match('remote',3) as any};data.selectedId='selected';data.responses['/matches/selected']=match('selected',4);
  data.archivedMatches=[{id:'archived',match:match('archived',5),moves:[{requestId:'archived-key'}]}];data.archives=[{id:'recovery',moves:[{requestId:'archived-recovery'}],conflict:{message:'original'}}];data.responses['/matches/recovery']=match('recovery',6);
  for(const version of [1,2,3,4,5,6])data.responses[`/games/game/versions/${version}`]={server_code:`exact-${version}`};
  for(const id of ['pending','conflicted','selected','archived','recovery'])for(const path of [`/matches/${id}/history`,`/matches/${id}/moves`,`/v2/matches/${id}/history?start=3&limit=1`])data.responses[path]={moves:[{new_state:{id}}]};
  data.responses['/old-download']='x'.repeat(150000);await repo.write('alice',data);
  const original=JSON.parse(JSON.stringify(data));storage.limit=storage.size()+100;
  await repo.cache('alice','/new-download','y'.repeat(80000));const saved=await repo.read('alice');
  assert.equal(saved.responses['/old-download'],undefined);
  for(const key of ['queues','conflicts','local','archives','archivedMatches','selectedId'] as const)assert.deepEqual(saved[key],original[key]);
  for(const [path,value]of Object.entries(original.responses))if(path!=='/old-download')assert.deepEqual(saved.responses[path],value,path);
});
test('an active game detail package is protected while old optional responses are freed',async()=>{
  const storage=new QuotaStorage(),repo=new AccountRepository('',storage);
  await repo.cache('alice','/games/current/versions/8',{bytes:'x'.repeat(100000)});await repo.cache('alice','/old','a'.repeat(100000));
  repo.protectGame('alice','current',8);storage.limit=storage.size()+100;
  await repo.cache('alice','/new','b'.repeat(80000));const saved=await repo.read('alice');assert.ok(saved.responses['/games/current/versions/8']);assert.equal(saved.responses['/old'],undefined);
});
test('optional oversized downloads remain usable without pretending a durable write succeeded',async()=>{
  const storage=new QuotaStorage(),repo=new AccountRepository('',storage);await repo.write('alice',emptyAccountData());storage.limit=storage.size()+100;
  const value='x'.repeat(2000000);assert.equal(await repo.cache('alice','/oversized',value),value);assert.equal((await repo.read('alice')).responses['/oversized'],undefined);
  const original=storage.values.get(repo.key('alice'));storage.limit=1;
  await assert.rejects(repo.mutate('alice',data=>{data.local.local={practiceSeed:42,moves:[{exact:true}]} as any;data.queues.pending=[{requestId:'keep-request-id'} as any];}),isQuotaError);
  assert.equal(storage.values.get(repo.key('alice')),original);
});
test('retries stop on a different write error and never prune for a non-quota failure',async()=>{
  const storage=new QuotaStorage(),repo=new AccountRepository('',storage);await repo.cache('alice','/old-one','a'.repeat(100));await repo.cache('alice','/old-two','b'.repeat(100));
  const original=storage.values.get(repo.key('alice'));storage.failure=new Error('storage permission denied');storage.failAfter=storage.writes+1;
  await assert.rejects(repo.cache('alice','/new','x'),/permission denied/);assert.equal(storage.values.get(repo.key('alice')),original);assert.deepEqual(storage.removals,[]);
  storage.limit=storage.size()+1;storage.failAfter=storage.writes+2;const attempts=storage.writes;
  await assert.rejects(repo.cache('alice','/new','x'.repeat(200)),/permission denied/);assert.equal(storage.writes-attempts,2);assert.equal(storage.values.get(repo.key('alice')),original);
});
test('translation recency is monotonic on reads/writes and metadata failures are optional',async()=>{
  const storage=new QuotaStorage(),key='game-platform.i18n-bundle.v1:en',now=Date.now;Date.now=()=>20;
  try{await touchTranslationCache(storage,key);const first=JSON.parse(storage.values.get(I18N_RECENCY_KEY)!).clock;await touchTranslationCache(storage,key);assert.ok(JSON.parse(storage.values.get(I18N_RECENCY_KEY)!).clock>first);storage.failure=new Error('denied');storage.failAfter=0;await touchTranslationCache(storage,key);}
  finally{Date.now=now;}
});
test('unresolved durable dependencies conservatively retain packages and history',async()=>{
  for(const dependency of ['queue','conflict','selected','local','archive']){
    const storage=new QuotaStorage(),repo=new AccountRepository('',storage),data=emptyAccountData();
    data.responses['/games/unknown/versions/9']={server_code:'only exact copy',padding:'x'.repeat(1100000)};data.responses['/matches/unresolved/history']={moves:[{exact:true}]};
    if(dependency==='queue')data.queues.unresolved=[{requestId:'keep'} as any];
    if(dependency==='conflict')data.conflicts.unresolved={message:'review'};
    if(dependency==='selected')data.selectedId='unresolved';
    if(dependency==='local')data.local.unresolved={id:'unresolved',game_id:'unknown',game_version:null,moves:[{exact:true}]} as any;
    if(dependency==='archive')data.archives=[{id:'unresolved',moves:[{requestId:'archive-key'}]}];
    await repo.write('alice',data);const saved=await repo.read('alice');assert.equal(saved.responses['/games/unknown/versions/9'].server_code,'only exact copy',dependency);assert.ok(saved.responses['/matches/unresolved/history']);
  }
});
