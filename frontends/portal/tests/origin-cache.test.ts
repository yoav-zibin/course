import {test} from 'node:test';
import assert from 'node:assert/strict';
import {originEvictions} from '../src/platform/origin-cache';
import {AccountRepository,emptyAccountData} from '../src/core/repository';
import {utf8Size} from '../src/platform/recoverable-cache';

const base='game-platform.portal.v1.old-account';
const response=(path:string)=>`${base}.r.${encodeURIComponent(path)}`;
const snapshot=(id:string,version=1)=>({id,game_id:'game',game_version:version,state:{board:['exact']}});
const queue=[{requestId:'original-intent',body:{move:{cell:2},expected_move_count:3},baseState:{exact:true},baseTurn:[1]}];
const legacy=()=>({responses:{} as Record<string,any>,queues:{} as Record<string,any>,conflicts:{} as Record<string,any>,local:{} as Record<string,any>,archives:[] as any[],archivedMatches:[] as any[],selectedId:null as string|null,cacheAccess:{} as Record<string,number>});
function fixture() {
  const values=new Map<string,string>(); const removed:string[]=[];
  const storage={async getItem(key:string){return values.get(key)??null;},async setItem(key:string,value:string){values.set(key,value);},async removeItem(key:string){removed.push(key);values.delete(key);},async keys(){return [...values.keys()];}};
  return {values,removed,storage,put:(key:string,value:any)=>values.set(key,JSON.stringify(value))};
}

test('origin LRU prunes only optional legacy/translation responses and preserves all durable fields',async()=>{
  const f=fixture(),data=legacy();
  data.queues.pending=queue;data.responses['/matches/pending']=snapshot('pending');data.responses['/games/game/versions/1']={rules:'pinned'};
  data.responses['/matches/pending/history']={moves:['exact']};data.responses['/v2/matches/pending/history?start=0&limit=100']={items:['exact']};
  data.local.local={...snapshot('local',2),logicState:{secret:'exact'},practiceSeed:7,moves:['all']};data.responses['/games/game/versions/2']={rules:'local'};
  data.archivedMatches.push({match:snapshot('archived',3),moves:['recover']});data.responses['/games/game/versions/3']={rules:'archived'};
  data.responses['/games']=Array(5).fill('downloaded');data.cacheAccess['/games']=30;
  (data as any).unknownRecoveryField={retained:'byte-for-byte'};
  f.put(base,data);f.put(response('/games/open'),['stale']);f.put(`${base}.recency`,{entries:[{path:'/games/open',at:20}]});
  const translation='game-platform.i18n-bundle.v1:es';f.put(translation,{data:'ñ😀'});f.put('game-platform.i18n-recency.v1',{entries:[{key:translation,at:10}]});
  for(const key of ['game-platform.accounts.v1','game-platform.current-account.v1','game-platform.locale.v1','console-passwords','another-app.private-record','buildplay.shared.v1.foreign'])f.put(key,{original:'never evict'});
  const protectedBefore=new Map([...f.values].filter(([key])=>key!==base&&key!==response('/games/open')&&key!==translation));
  const candidates=await originEvictions(f.storage,'buildplay.shared.v1.current');
  assert.deepEqual(candidates.map(c=>c.at),[10,20,30]);assert.equal(candidates[0].bytes,new TextEncoder().encode(f.values.get(translation)!).length);
  for(const candidate of candidates)await candidate.evict();
  const expected=structuredClone(data);delete expected.responses['/games'];delete expected.cacheAccess['/games'];
  assert.deepEqual(JSON.parse(f.values.get(base)!),expected);assert.deepEqual([...f.removed].sort(),[translation,response('/games/open')].sort());
  for(const [key,value] of protectedBefore)assert.equal(f.values.get(key),value,key);
});

test('partial migration keeps both backup and split versions required by pending work',async()=>{
  const f=fixture(),data=legacy();data.responses['/matches/m']=snapshot('m',1);data.responses['/games/game/versions/1']={rules:'old'};data.queues.m=queue;
  data.responses['/optional']={old:true};f.put(base,data);f.put(response('/matches/m'),snapshot('m',2));f.put(response('/games/game/versions/2'),{rules:'new'});f.put(`${base}.q.m`,queue);
  f.put(`${base}.meta`,{migrated:true,responses:['/matches/m','/games/game/versions/2','/optional-split'],queues:['m']});f.put(response('/optional-split'),{cache:true});
  const before=new Map(f.values);const candidates=await originEvictions(f.storage,'buildplay.shared.v1.current');
  assert.equal(candidates.length,2);for(const candidate of candidates)await candidate.evict();
  assert.equal(f.values.get(response('/games/game/versions/2')),before.get(response('/games/game/versions/2')));assert.equal(f.values.get(`${base}.q.m`),before.get(`${base}.q.m`));
  const after=JSON.parse(f.values.get(base)!);assert.deepEqual(after.queues,data.queues);assert.deepEqual(after.responses['/games/game/versions/1'],data.responses['/games/game/versions/1']);
  // The old reader treats absent .r records as missing even if listed by the
  // unchanged manifest; caches never require a durable manifest rewrite.
  assert.equal(f.values.get(`${base}.meta`),before.get(`${base}.meta`));assert.equal(f.values.has(response('/optional-split')),false);
});

test('candidate rechecks preserve a newly queued snapshot/package/history and a new monolith selection',async()=>{
  const f=fixture(),data=legacy();data.responses['/matches/m']=snapshot('m');data.responses['/games/game/versions/1']={rules:'exact'};data.responses['/matches/m/history']={moves:['all']};f.put(base,data);
  for(const [path,value] of Object.entries(data.responses))f.put(response(path),value);
  const candidates=await originEvictions(f.storage,'buildplay.shared.v1.current');assert.equal(candidates.length,6);
  data.selectedId='m';f.put(base,data);f.put(`${base}.q.m`,queue);
  const before=new Map(f.values);for(const candidate of candidates)await candidate.evict();assert.deepEqual(f.values,before);assert.deepEqual(f.removed,[]);
});

test('corrupt/missing durable dependencies are preserved while bad recency does not block optional cleanup',async()=>{
  const f=fixture();f.put(response('/games'),['cache']);f.values.set(`${base}.q.m`,'not JSON');
  assert.deepEqual(await originEvictions(f.storage,'buildplay.shared.v1.current'),[]);assert.equal(f.values.get(`${base}.q.m`),'not JSON');
  f.put(`${base}.q.m`,queue);assert.deepEqual(await originEvictions(f.storage,'buildplay.shared.v1.current'),[]); // no identifiable snapshot
  f.put(response('/matches/m'),snapshot('m'));f.values.set(`${base}.recency`,'not JSON');
  const candidates=await originEvictions(f.storage,'buildplay.shared.v1.current');assert.equal(candidates.length,1);await candidates[0].evict();assert.equal(f.values.has(response('/games')),false);assert.equal(f.values.get(`${base}.recency`),'not JSON');
});

test('failed optional deletion/replacement preserves originals and does not pretend to have freed space',async()=>{
  const f=fixture(),data=legacy();data.responses['/games']=['large'];f.put(base,data);f.put(response('/games'),['split']);
  const before=new Map(f.values);f.storage.removeItem=async()=>{throw new Error('denied');};f.storage.setItem=async()=>{throw new Error('still full');};
  const candidates=await originEvictions(f.storage,'buildplay.shared.v1.current');assert.equal(candidates.length,2);for(const candidate of candidates)await candidate.evict();assert.deepEqual(f.values,before);
});

test('legacy tombstones and a source whose only pending snapshot is in the backup remain safe',async()=>{
  const f=fixture(),data=legacy();data.responses['/matches/m']=snapshot('m');data.responses['/games/game/versions/1']={rules:'only recovery copy'};data.responses['/optional']='cache';f.put(base,data);
  f.put(`${base}.q.m`,queue);f.values.set(response('/matches/m'),'__portal_offline_deleted__');f.values.set(`${base}.selected`,'__portal_offline_deleted__');
  const candidates=await originEvictions(f.storage,'buildplay.shared.v1.current');assert.equal(candidates.length,1);await candidates[0].evict();
  const after=JSON.parse(f.values.get(base)!);assert.deepEqual(after.responses['/games/game/versions/1'],data.responses['/games/game/versions/1']);assert.deepEqual(JSON.parse(f.values.get(`${base}.q.m`)!)[0].requestId,'original-intent');
});

test('manifest-only durable references keep incomplete migrations available for recovery',async()=>{
  const f=fixture();f.put(response('/games'),['recoverable but not safe to classify yet']);f.put(`${base}.meta`,{migrated:true,queues:['missing-intent'],conflicts:[],local:[]});
  assert.deepEqual(await originEvictions(f.storage,'buildplay.shared.v1.current'),[]);assert.equal(f.values.has(response('/games')),true);
});

test('a critical account write recovers quota from old caches without nested locks or changing saved work',async()=>{
  const f=fixture(),data=legacy();data.responses['/old-download']='x'.repeat(100000);data.local.saved={...snapshot('saved'),practiceSeed:77,moves:[{exact:true}]};data.responses['/games/game/versions/1']={rules:'exact immutable rules'};f.put(base,data);
  f.put('buildplay.shared.v1.foreign',{...emptyAccountData(),responses:{'/optional':'must remain untouched'}});
  const size=()=>[...f.values].reduce((sum,[key,value])=>sum+utf8Size(key)+utf8Size(value),0),limit=size()+100;
  const originalSet=f.storage.setItem;f.storage.setItem=async(key,value)=>{
    const total=size()-utf8Size(f.values.get(key)||'')-(f.values.has(key)?utf8Size(key):0)+utf8Size(key)+utf8Size(value);
    if(total>limit)throw new DOMException('Storage quota exceeded','QuotaExceededError');await originalSet(key,value);
  };
  let locked=false;const repo=new AccountRepository('',{...f.storage,async exclusive<T>(_name:string,run:()=>Promise<T>){assert.equal(locked,false);locked=true;try{return await run();}finally{locked=false;}}});
  const foreignBefore=f.values.get('buildplay.shared.v1.foreign');
  await repo.mutate('new-account',saved=>{saved.queues.pending=queue;saved.responses['/matches/pending']=snapshot('pending');saved.responses['/games/game/versions/1']={rules:'new account pinned rules'};});
  assert.deepEqual((await repo.read('new-account')).queues.pending,queue);assert.equal(f.values.get('buildplay.shared.v1.foreign'),foreignBefore);
  const legacyAfter=JSON.parse(f.values.get(base)!);assert.deepEqual(legacyAfter.local,data.local);assert.deepEqual(legacyAfter.responses['/games/game/versions/1'],data.responses['/games/game/versions/1']);assert.equal(legacyAfter.responses['/old-download'],undefined);
});
