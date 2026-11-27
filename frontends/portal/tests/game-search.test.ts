import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalStore,type Game} from '../src/core';
import {AccountRepository} from '../src/core/repository';
import {gameSearchPrefix,gameSearchWords,gameSuggestions} from '../src/core/game-search';
import {diagnosticSnapshot} from '../src/core/diagnostics';

const game=(id:string,name:string):Game=>({id,name,version:1,description:'A shared game.',allowed_player_counts:[2]});

test('unfinished, multiword, punctuation and long typing yield valid bounded indexed prefixes',()=>{
  for(const value of ['', 'a', ' ', '?!', '🎮'])assert.equal(gameSearchPrefix(value),null);
  assert.equal(gameSearchPrefix('  Connect f  '),'connect');
  assert.equal(gameSearchPrefix('Tic-tac-toe!'),'tic');
  assert.equal(gameSearchPrefix('A'.repeat(80)),'a'.repeat(24));
  assert.equal(gameSearchPrefix('STRAẞE'),'strasse');
  assert.deepEqual(gameSearchWords('Σςσ'),['σσσ']);
  for(const value of ['échecs','中文游戏','हिन्दी','ΐτα','İstanbul','𝟚𝟛𝟜','a_b','Straße','A'.repeat(120)]){
    const prefix=gameSearchPrefix(value);
    if(prefix){assert.match(prefix,/^[\p{L}\p{N}_]+$/u);assert.ok(Array.from(prefix).length>=2&&Array.from(prefix).length<=24);}
  }
});

test('suggestions rank exact and starting names, match full typed words, deduplicate and cap results',()=>{
  const games=[game('other','Chinese Chess'),game('desc','Unrelated'),game('exact','Chess'),game('prefix','Chess Club'),game('exact','Chess'),...Array.from({length:8},(_,i)=>game(`many${i}`,`Chess Variant ${i}`))];
  games[1].description='Chess is mentioned only in this description.';
  assert.deepEqual(gameSuggestions(games,'chess').slice(0,2).map(game=>game.id),['exact','prefix']);
  assert.equal(gameSuggestions(games,'chess').length,6);
  assert.deepEqual(gameSuggestions([game('connect','Connect Four'),game('wrong','Connect Five')],'connect fo').map(game=>game.id),['connect']);
  assert.deepEqual(gameSuggestions([game('punctuation','Tic-tac-toe')],'tic tac t').map(game=>game.id),['punctuation']);
  const localized={...game('localized','Échecs'),_sourceText:{name:'Chess'}};
  assert.equal(gameSuggestions([localized],'é').length,1);assert.equal(gameSuggestions([localized],'chess').length,1);
  assert.deepEqual(gameSuggestions(games,'unmatched'),[]);assert.deepEqual(gameSuggestions(games,'?!'),[]);
});

test('suggestions match alternate titles and display the catalog name',()=>{
  const chess={...game('chess','Chess'),alternative_names:['Ajedrez','Échecs']};
  const connect={...game('connect','Connect Four'),alternative_names:['4 in a Row','Puissance 4']};
  assert.deepEqual(gameSuggestions([chess,connect],'ajed'),[chess]);
  assert.deepEqual(gameSuggestions([chess,connect],'e\u0301checs'),[chess]);
  assert.deepEqual(gameSuggestions([chess,connect],'4 in a ro'),[connect]);
  assert.deepEqual(gameSuggestions([chess,connect],'puissance row'),[]);
});

function fixture(){
  const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),previousFetch=globalThis.fetch;
  const saved:Record<string,string>={};
  Object.defineProperties(saved,{getItem:{value:(key:string)=>saved[key]??null},setItem:{value:(key:string,value:string)=>{saved[key]=String(value);}},removeItem:{value:(key:string)=>{delete saved[key];}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:saved});
  const catalog=[game('cached','Cobalt Nine')],popular=[game('popular','Chess Club')],queries:string[]=[];
  let reply:(url:URL)=>Promise<any>|any=url=>({items:[game('found','Connect Four')],next_cursor:null});
  globalThis.fetch=(async(input:string|URL|Request)=>{
    const url=new URL(String(input));let value:any=[];
    if(url.pathname==='/storage/capabilities')value={pagination:true};
    else if(url.pathname==='/i18n/locales')value={locales:[{code:'en',direction:'ltr'}]};
    else if(url.pathname.startsWith('/i18n/bundle/'))value={catalog:{messages:{},direction:'ltr'},games:{}};
    else if(url.pathname==='/auth/config')value={};
    else if(/^\/users\/[^/]+$/.test(url.pathname))value={id:url.pathname.split('/').at(-1),token_balance:0,is_verified:false};
    else if(url.pathname==='/v2/matches'||url.pathname==='/v2/users/me/saved-games')value={items:[],next_cursor:null};
    else if(url.pathname==='/games/popular')value=popular;
    else if(url.pathname==='/v2/games'){
      if(url.searchParams.has('q')){queries.push(url.searchParams.get('q')!);value=await reply(url);}
      else value={items:catalog,next_cursor:'catalog-page-two'};
    }
    return value instanceof Response?value:new Response(JSON.stringify(value),{status:200});
  }) as typeof fetch;
  return {saved,queries,reply:(fn:typeof reply)=>{reply=fn;},restore(){globalThis.fetch=previousFetch;if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else delete(globalThis as any).localStorage;}};
}

test('autocomplete uses valid requests without replacing catalog aliases, saved data or list cursors',async()=>{
  const f=fixture(),base='https://catalog-search.test';
  try{
    const store=new PortalStore();await store.bootstrap(base);
    const repository=new AccountRepository(base);
    await repository.mutate('visitor',data=>{data.responses['/users/me/saved-games']=[game('saved','Old saved game')];data.selectedId='local-kept';data.queues['local-kept']=[];});
    const before=await repository.read('visitor'),snapshot=store.getSnapshot();
    assert.equal((await store.actions.suggestGames('c'))[0].id,'popular');
    await store.actions.suggestGames('?!');assert.deepEqual(f.queries,[]);
    assert.equal((await store.actions.suggestGames('connect fo'))[0].id,'found');
    await store.actions.suggestGames('A'.repeat(80));
    assert.deepEqual(f.queries,['connect','a'.repeat(24)]);
    assert.deepEqual(store.getSnapshot().games,snapshot.games);assert.deepEqual(store.getSnapshot().cursors,snapshot.cursors);assert.equal(store.getSnapshot().query,'');
    const after=await repository.read('visitor');
    for(const key of ['/games','/users/me/saved-games'])assert.deepEqual(after.responses[key],before.responses[key]);
    assert.deepEqual(after.queues,before.queues);assert.equal(after.selectedId,before.selectedId);assert.equal(store.getSnapshot().error,null);
  }finally{f.restore();}
});

test('suggestions examine bounded subsequent pages for title matches and retain downloaded options offline',async()=>{
  const f=fixture();
  try{
    const store=new PortalStore();await store.bootstrap('https://catalog-pages.test');
    let pages=0;
    f.reply(url=>{pages++;return url.searchParams.has('cursor')?{items:[game('later','Connect Four')],next_cursor:null}:{items:[game('description','Unrelated title')],next_cursor:'next'};});
    assert.equal((await store.actions.suggestGames('connect f'))[0].id,'later');assert.equal(pages,2);
    f.reply(()=>{throw new TypeError('Offline');});
    assert.equal((await store.actions.suggestGames('chess'))[0].id,'popular');assert.equal(store.getSnapshot().network,false);assert.equal(store.getSnapshot().error,null);
  }finally{f.restore();}
});

test('broad or repeating search cursors cannot trigger an unbounded catalog scan',async()=>{
  const f=fixture();
  try{
    const store=new PortalStore();await store.bootstrap('https://bounded-search.test');let pages=0;
    f.reply(()=>({items:[],next_cursor:`next-${++pages}`}));await store.actions.suggestGames('unmatched');assert.equal(pages,3);
    pages=0;f.reply(()=>{pages++;return{items:[],next_cursor:'repeated'};});await store.actions.suggestGames('another');assert.equal(pages,2);
  }finally{f.restore();}
});

test('an old-account suggestion response cannot enter the new account cache or UI',async()=>{
  const f=fixture(),base='https://search-account.test';let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(done=>{release=done;}),started=new Promise<void>(done=>{entered=done;});
  f.saved['game-platform.accounts.v1']=JSON.stringify(['alice','bob'].map(id=>({id,password:`${id}-synthetic`,display_name:id})));
  f.saved['game-platform.current-account.v1']='alice';
  try{
    const store=new PortalStore();await store.bootstrap(base);
    f.reply(async()=>{entered();await gate;return{items:[game('old-private-query','Connect Four')],next_cursor:null};});
    const old=assert.rejects(store.actions.suggestGames('connect'),/Account changed/);await started;
    await store.actions.switchAccount('bob');release();await old;
    const current=await new AccountRepository(base).read('bob');
    assert.equal(store.getSnapshot().account?.id,'bob');assert.equal(store.getSnapshot().error,null);
    assert.ok(!Object.values(current.responses).some(value=>JSON.stringify(value).includes('old-private-query')));
  }finally{release();f.restore();}
});

test('only the exact unsupported-prefix validation falls back and diagnostics omit the typed query',async()=>{
  const f=fixture();
  try{
    const store=new PortalStore();await store.bootstrap('https://unicode-search.test');
    f.reply(()=>new Response(JSON.stringify({detail:'search requires one word prefix of 2 to 24 characters'}),{status:400}));
    // Unicode16 letters are recognized by newer browsers but not Python's
    // Unicode15 word index. This models the real HTTP contract difference.
    const query=String.fromCodePoint(0x11380).repeat(2);
    assert.deepEqual(await store.actions.suggestGames(query),[]);assert.equal(store.getSnapshot().error,null);
    const diagnostic=diagnosticSnapshot();
    const events=diagnostic.events as {name?:string;metadata?:unknown}[];
    assert.deepEqual(events.filter(event=>event.name==='game_search_prefix_fallback').map(event=>event.metadata),[{reason:'unsupported_index_prefix'}]);
    assert.ok(!JSON.stringify(diagnostic).includes(query));
    for(const status of [400,403]){
      f.reply(()=>new Response(JSON.stringify({detail:'A different actionable API failure'}),{status}));
      await assert.rejects(store.actions.suggestGames('connect'),/different actionable API failure/);
    }
  }finally{f.restore();}
});
