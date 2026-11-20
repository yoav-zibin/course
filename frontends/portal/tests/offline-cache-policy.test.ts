import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AccountRepository,emptyAccountData,utf8Size,type StorageAdapter} from '../src/core/repository';
import {matchRetentionPriority,responseRetentionPriorities} from '../src/core/cache-policy';

class DeviceStorage implements StorageAdapter {
  values = new Map<string,string>();
  limit = Infinity;
  private serial: Promise<unknown> = Promise.resolve();
  async getItem(key:string) {return this.values.get(key) ?? null;}
  async keys() {return [...this.values.keys()];}
  async setItem(key:string,value:string) {
    const size = [...this.values].filter(([saved]) => saved !== key).reduce((total,[saved,text]) => total+utf8Size(saved)+utf8Size(text),0)+utf8Size(key)+utf8Size(value);
    if (size > this.limit) throw new DOMException('Storage full','QuotaExceededError');
    this.values.set(key,value);
  }
  async exclusive<T>(_name:string,run:()=>Promise<T>) {
    const result=this.serial.then(run,run);this.serial=result.catch(()=>{});return result;
  }
  size() {return [...this.values].reduce((total,[key,value]) => total+utf8Size(key)+utf8Size(value),0);}
}
const match = (id:string,status='ongoing',turn=0,game_id=id) => ({id,game_id,game_version:1,status,players:[{user_id:'canonical',player_index:0}],turn_of_player_indices:[turn],move_count:0});

test('offline retention orders your turn, other ongoing, waiting and finished matches',()=>{
  const yours=match('yours'),other=match('other','ongoing',1),waiting=match('waiting','waiting_for_players'),finished=match('finished','over');
  assert.ok(matchRetentionPriority(yours,'canonical') > matchRetentionPriority(other,'canonical'));
  assert.ok(matchRetentionPriority(other,'canonical') > matchRetentionPriority(waiting,'canonical'));
  assert.ok(matchRetentionPriority(waiting,'canonical') > matchRetentionPriority(finished,'canonical'));
  const data=emptyAccountData();data.responses['/matches']=[yours,other,waiting,finished];
  data.responses['/portal/match-games']={'yours@1':{name:'Your game'}};
  data.responses['/v2/matches/yours/history?start=0&limit=50']={moves:[]};
  const priorities=responseRetentionPriorities(data,'canonical');
  assert.equal(priorities.get('/matches/yours'),priorities.get('/games/yours/versions/1'));
  assert.equal(priorities.get('/users/canonical'),priorities.get('/matches/yours'));
  assert.equal(priorities.get('/v2/matches/yours/history?start=0&limit=50'),priorities.get('/matches/yours'));
  assert.ok(priorities.get('/portal/match-games')! > priorities.get('/games/yours/versions/1')!);
});

test('shared exact packages retain the highest match priority and follow refreshed detail state',()=>{
  const data=emptyAccountData();data.responses['/matches']=[match('a','ongoing',1,'shared'),match('b','over',1,'shared')];
  data.responses['/matches/b']=match('b','ongoing',0,'shared');
  const priorities=responseRetentionPriorities(data,'canonical');
  assert.equal(priorities.get('/games/shared/versions/1'),matchRetentionPriority(data.responses['/matches/b'],'canonical'));
  assert.equal(priorities.has('/games/shared/versions/2'),false);
});

test('an older cached snapshot cannot downgrade the latest listed turn priority',()=>{
  const data=emptyAccountData();data.responses['/matches']=[{...match('mine'),move_count:7}];
  data.responses['/matches/mine']={...match('mine','ongoing',1),move_count:6};
  assert.equal(responseRetentionPriorities(data,'canonical').get('/games/mine/versions/1'),matchRetentionPriority(data.responses['/matches'][0],'canonical'));
});

test('a canonical self profile stays available under its retained login alias',()=>{
  const data=emptyAccountData();data.responses['/matches']=[match('mine')];
  data.responses['/users/login-alias']={id:'canonical',display_name:'Self'};
  data.responses['/users/canonical']={id:'canonical',display_name:'Self'};
  data.responses['/users/opponent']={id:'opponent',display_name:'Other'};
  const priorities=responseRetentionPriorities(data,'canonical');
  assert.equal(priorities.get('/users/login-alias'),priorities.get('/matches'));
  assert.equal(priorities.get('/users/canonical'),priorities.get('/matches'));
  assert.equal(priorities.has('/users/opponent'),false);
});

test('independent concurrent metadata writers merge against the latest durable dictionary',async()=>{
  const storage=new DeviceStorage(),tabA=new AccountRepository('',storage),tabB=new AccountRepository('',storage);
  const common={'old@1':{id:'old',version:1,name:'Old game'}};
  await tabA.cache('canonical','/portal/match-games',common);
  await Promise.all([
    tabA.cache('canonical','/portal/match-games',{...common,'a@1':{id:'a',version:1,name:'First downloaded game'}}),
    tabB.cache('canonical','/portal/match-games',{...common,'b@1':{id:'b',version:1,name:'Second downloaded game'}}),
  ]);
  const saved=(await tabA.read('canonical')).responses['/portal/match-games'];
  assert.deepEqual(Object.keys(saved).sort(),['a@1','b@1','old@1']);
  assert.equal(saved['a@1'].name,'First downloaded game');assert.equal(saved['b@1'].name,'Second downloaded game');
});

test('match packages use their own budget instead of the small catalog cache budget',async()=>{
  const storage=new DeviceStorage(),repo=new AccountRepository('',storage),data=emptyAccountData();
  data.responses['/matches']=[match('mine')];
  data.responses['/games/mine/versions/1']={name:'Downloaded game',server_code:'x'.repeat(1_200_000)};
  data.responses['/catalog-search']={padding:'x'.repeat(1_200_000)};
  await repo.write('canonical',data);const saved=await repo.read('canonical');
  assert.equal(saved.responses['/games/mine/versions/1'].name,'Downloaded game');
  assert.equal(saved.responses['/catalog-search'],undefined);
});

test('the match budget evicts finished packages before a game where it is your turn',async()=>{
  const storage=new DeviceStorage(),repo=new AccountRepository('',storage),data=emptyAccountData();
  repo.prioritizeMatches('login-alias','canonical');
  data.responses['/matches']=[match('yours'),match('finished','over')];
  data.responses['/portal/match-games']={'yours@1':{name:'Your game'},'finished@1':{name:'Finished game'}};
  data.responses['/games/yours/versions/1']={server_code:'x'.repeat(10_100_000)};
  data.responses['/games/finished/versions/1']={server_code:'x'.repeat(10_100_000)};
  data.responseRecency={'/games/yours/versions/1':1,'/games/finished/versions/1':100};
  await repo.write('login-alias',data);const saved=await repo.read('login-alias');
  assert.ok(saved.responses['/games/yours/versions/1']);
  assert.equal(saved.responses['/games/finished/versions/1'],undefined);
  assert.ok(saved.responses['/matches']);assert.ok(saved.responses['/portal/match-games']);
});

test('real quota pressure frees newer catalog data before older match packages',async()=>{
  const storage=new DeviceStorage(),repo=new AccountRepository('',storage),data=emptyAccountData();
  data.responses['/matches']=[match('mine')];
  data.responses['/matches/mine']={...match('mine'),state:{board:[0,1,2]}};
  data.responses['/games/mine/versions/1']={name:'Keep',server_code:'x'.repeat(100_000)};
  data.responses['/catalog-search']='x'.repeat(100_000);
  data.responseRecency={'/games/mine/versions/1':1,'/catalog-search':100};
  await repo.write('canonical',data);storage.limit=storage.size()+200;
  await repo.cache('canonical','/new-download','x'.repeat(80_000));const saved=await repo.read('canonical');
  assert.equal(saved.responses['/catalog-search'],undefined);
  assert.ok(saved.responses['/games/mine/versions/1']);assert.ok(saved.responses['/matches/mine']);
});

test('real quota pressure preserves your-turn packages ahead of other ongoing packages',async()=>{
  const storage=new DeviceStorage(),repo=new AccountRepository('',storage),data=emptyAccountData();
  repo.prioritizeMatches('login-alias','canonical');
  data.responses['/matches']=[match('yours'),match('other','ongoing',1)];
  data.responses['/portal/match-games']={'yours@1':{name:'Yours'},'other@1':{name:'Other'}};
  data.responses['/games/yours/versions/1']={name:'Yours',server_code:'x'.repeat(100_000)};
  data.responses['/games/other/versions/1']={name:'Other',server_code:'x'.repeat(100_000)};
  data.responseRecency={'/games/yours/versions/1':1,'/games/other/versions/1':100};
  await repo.write('login-alias',data);storage.limit=storage.size()-80_000;
  await repo.mutate('login-alias',data => {data.cacheClock=123;});const saved=await repo.read('login-alias');
  assert.ok(saved.responses['/games/yours/versions/1']);assert.equal(saved.responses['/games/other/versions/1'],undefined);
  assert.ok(saved.responses['/portal/match-games']);assert.ok(saved.responses['/matches']);
});
