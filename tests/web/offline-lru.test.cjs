const {test}=require('node:test');
const assert=require('node:assert/strict');
globalThis.I18n=require('./i18n-stub.cjs');
const Offline=require('../../static/portal-offline.js');

function quotaStorage() {
 const map=new Map();
 const storage={map,limit:1_000_000,
  keys:()=>[...map.keys()],
  getItem:key=>map.get(key)??null,
  removeItem:key=>map.delete(key),
  storedBytes:()=>[...map.values()].reduce((sum,value)=>sum+value.length,0),
  setItem(key,value){
   const next=new Map(map);next.set(key,String(value));
   if([...next.values()].reduce((sum,item)=>sum+item.length,0)>storage.limit)
    throw Object.assign(new Error('quota exceeded'),{name:'QuotaExceededError',code:22});
   map.set(key,String(value));
  },
 };
 return storage;
}
function offline(storage,id='alice') {
 const instance=new Offline(storage,undefined,()=>({id,password:'test credential'}),()=>false);
 instance.write(instance.read());
 return instance;
}
const match={id:'match',game_id:'game',game_version:1,state:{n:0},
 status:'ongoing',move_count:0,turn_of_player_indices:[0]};
const move={move:{add:1},expected_move_count:0};
function recency(storage,instance,entries) {
 storage.setItem(`${instance.key()}.recency`,JSON.stringify({clock:Math.max(...entries.map(entry=>entry.at)),entries}));
}

test('quota recovery physically removes response pieces missing from a stale manifest',()=>{
 const storage=quotaStorage(),o=offline(storage);
 const orphan=o.responseKey('/unindexed-game');
 storage.setItem(orphan,JSON.stringify({code:'x'.repeat(4000)}));
 assert.ok(!JSON.parse(storage.getItem(o.metaKey())).responses.includes('/unindexed-game'));
 assert.ok(o.read().responses['/unindexed-game']); // scan recovered the piece
 const before=storage.storedBytes();storage.limit=before+100;
 o.enqueue(match,move);
 assert.equal(storage.getItem(orphan),null);
 assert.equal(o.read().queues.match.length,1);
 assert.ok(storage.storedBytes()<before);
});

test('cross-account quota recovery preserves pending snapshots and practice rules and history',()=>{
 const storage=quotaStorage(),bob=offline(storage,'bob');
 const data=bob.read();
 const pending={...match,id:'bobs-match',game_id:'online-backgammon',game_version:7};
 data.responses['/matches/bobs-match']=pending;
 data.responses['/games/backgammon/versions/1']={code:'board',server_code:'authority'};
 data.responses['/games/online-backgammon/versions/7']={code:'online board',server_code:'pinned online authority'};
 data.responses['/old-recoverable']='x'.repeat(4000);
 data.queues['bobs-match']=[{body:move,baseState:pending.state,baseTurn:[0]}];
 data.local['local-bob']={id:'local-bob',game_id:'backgammon',game_version:1,
  moves:[{new_state:{turn:0},next_turn_player_indices:[0]}]};
 data.archives=[{id:'branch',moves:[move]}];
 data.archivedMatches=[{id:'historic',match:{state:{n:3}},moves:[move]}];
 bob.write(data);
 const bobBefore=bob.read();
 const alice=offline(storage);storage.limit=storage.storedBytes()+100;
 alice.enqueue(match,move);
 const saved=bob.read();
 assert.equal(alice.read().queues.match.length,1);
 assert.equal(saved.responses['/old-recoverable'],undefined);
 assert.deepEqual(saved.responses['/matches/bobs-match'],bobBefore.responses['/matches/bobs-match']);
 assert.deepEqual(saved.responses['/games/backgammon/versions/1'],bobBefore.responses['/games/backgammon/versions/1']);
 assert.deepEqual(saved.responses['/games/online-backgammon/versions/7'],bobBefore.responses['/games/online-backgammon/versions/7']);
 assert.deepEqual(saved.queues,bobBefore.queues);
 assert.deepEqual(saved.local,bobBefore.local);
 assert.deepEqual(saved.archives,bobBefore.archives);
 assert.deepEqual(saved.archivedMatches,bobBefore.archivedMatches);
});

test('shared origin LRU evicts an older foreign cache before a newer own cache',()=>{
 const storage=quotaStorage(),bob=offline(storage,'bob');
 bob.save('/old-other-account','b'.repeat(1500));
 recency(storage,bob,[{path:'/old-other-account',at:10}]);
 const alice=offline(storage);
 alice.save('/recent-own-cache','a'.repeat(1500));
 recency(storage,alice,[{path:'/recent-own-cache',at:20}]);
 storage.limit=storage.storedBytes()+100;
 alice.enqueue(match,move);
 assert.equal(bob.read().responses['/old-other-account'],undefined);
 assert.equal(alice.read().responses['/recent-own-cache'],'a'.repeat(1500));
 assert.equal(alice.read().queues.match.length,1);
});

test('translation caches share origin LRU while choices and secrets remain untouched',()=>{
 const storage=quotaStorage(),o=offline(storage);
 o.save('/recent-game','r'.repeat(1500));
 recency(storage,o,[{path:'/recent-game',at:20}]);
 const bundle='game-platform.i18n-bundle.v1:es';
 const auth='game-platform.auth.v1',choice='game-platform.locale.v1',privateKey='application-private-data';
 storage.setItem(bundle,JSON.stringify({data:'b'.repeat(1500)}));
 storage.setItem(auth,JSON.stringify({id:'alice',password:'private credential'}));
 storage.setItem(choice,JSON.stringify('es'));
 storage.setItem(privateKey,'private state');
 storage.setItem('game-platform.i18n-recency.v1',JSON.stringify({clock:10,entries:[
  {key:bundle,at:10},{key:auth,at:0},{key:choice,at:0},{key:privateKey,at:0},
 ]}));
 const untouched=new Map([auth,choice,privateKey].map(key=>[key,storage.getItem(key)]));
 storage.limit=storage.storedBytes()+100;
 o.enqueue(match,move);
 assert.equal(storage.getItem(bundle),null);
 assert.equal(o.read().responses['/recent-game'],'r'.repeat(1500));
 assert.equal(o.read().queues.match.length,1);
 for(const [key,value] of untouched)assert.equal(storage.getItem(key),value);
});

test('a quota-exceeded startup probe keeps existing durable device storage accessible',()=>{
 const storage=quotaStorage(),original=offline(storage);
 original.enqueue(match,move);
 const d=original.read();
 d.local['local-a']={id:'local-a',game_id:'game',game_version:1,moves:[{new_state:{n:1}}]};
 d.responses['/games/game/versions/1']={server_code:'authority',code:'board'};
 d.archivedMatches=[{id:'historic',moves:[move]}];original.write(d);
 storage.limit=storage.storedBytes();
 const restored=new Offline(storage,undefined,()=>({id:'alice'}),()=>false);
 assert.equal(restored.storage.__portalMemoryFallback,undefined);
 assert.equal(restored.read().queues.match.length,1);
 assert.deepEqual(restored.read().local,original.read().local);
 assert.deepEqual(restored.read().archivedMatches,original.read().archivedMatches);
 assert.deepEqual(restored.read().responses['/games/game/versions/1'],d.responses['/games/game/versions/1']);
});

for(const account of ['alice','bob']) {
 test(`quota recovery trims ${account==='alice'?'own':'foreign'} legacy backup caches while preserving every durable field`,()=>{
  const storage=quotaStorage(),legacyKey=`game-platform.portal.v1.${account}`;
  const legacy={responses:{'/recoverable-old':'x'.repeat(4000),
   '/matches/held':{...match,id:'held'},
   '/games/game/versions/1':{code:'board',server_code:'authority'},
  },queues:{held:[{body:move,baseState:match.state,baseTurn:[0]}]},
  conflicts:{held:{message:'preserve this conflict',remote:match}},
  local:{'local-held':{id:'local-held',game_id:'game',game_version:1,moves:[{new_state:{n:1}}]}},
  archives:[{id:'branch',moves:[move]}],archivedMatches:[{id:'history',moves:[move]}],
  selectedId:'local-held',cacheAccess:{'/recoverable-old':1},cacheClock:1,
  futureDurableField:{keep:'all unknown fields too'},
  };
  storage.setItem(legacyKey,JSON.stringify(legacy));
  const owner=offline(storage,account); // commits the split migration, retaining the old backup
  assert.equal(JSON.parse(storage.getItem(owner.metaKey())).migrated,true);
  const alice=account==='alice'?owner:offline(storage);
  storage.limit=storage.storedBytes()+100;
  alice.enqueue({...match,id:'new-match'},move);
  const backup=JSON.parse(storage.getItem(legacyKey));
  const expected=JSON.parse(JSON.stringify(legacy));
  delete expected.responses['/recoverable-old'];delete expected.cacheAccess['/recoverable-old'];
  assert.deepEqual(backup,expected);
  assert.deepEqual(owner.read().local,legacy.local);
  assert.deepEqual(owner.read().queues.held,legacy.queues.held);
  assert.deepEqual(owner.read().archives,legacy.archives);
  assert.deepEqual(owner.read().archivedMatches,legacy.archivedMatches);
  assert.equal(alice.read().queues['new-match'].length,1);
 });
}

test('insufficient reclaimable space never deletes durable records or authentication to report a saved move',()=>{
 const storage=quotaStorage(),o=offline(storage);
 const d=o.read();
 d.local['local-held']={id:'local-held',game_id:'game',game_version:1,moves:[{new_state:{n:1}}]};
 d.responses['/games/game/versions/1']={server_code:'authority',code:'x'.repeat(2000)};
 d.archives=[{id:'branch',moves:[move]}];d.archivedMatches=[{id:'historic',moves:[move]}];o.write(d);
 storage.setItem('game-platform.auth.v1',JSON.stringify({password:'private credential'}));
 const protectedKeys=[o.localKey('local-held'),o.responseKey('/games/game/versions/1'),
  o.archivesKey(),o.archivedKey(),'game-platform.auth.v1'];
 const before=new Map(protectedKeys.map(key=>[key,storage.getItem(key)]));
 storage.limit=storage.storedBytes();
 assert.throws(()=>o.enqueue(match,move),/not saved/);
 for(const [key,value] of before)assert.equal(storage.getItem(key),value);
 assert.equal(o.read().queues.match,undefined);
});
