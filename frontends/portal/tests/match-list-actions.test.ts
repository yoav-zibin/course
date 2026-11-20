import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalStore,type Match} from '../src/core';
import {AccountRepository} from '../src/core/repository';

const base='https://match-list.test';
function fixture(status='over',owner='alice'){
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),previousFetch=globalThis.fetch;
  const saved:Record<string,string>={'game-platform.accounts.v1':JSON.stringify(['alice','bob'].map(id=>({id,password:id+'-synthetic',display_name:id}))),'game-platform.current-account.v1':'alice'};
  Object.defineProperties(saved,{getItem:{value:(key:string)=>saved[key]??null},setItem:{value:(key:string,value:string)=>{saved[key]=String(value);}},removeItem:{value:(key:string)=>{delete saved[key];}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:saved});
  const match=(id:string,state=status):Match=>({id,game_id:'bundled-tictactoe',game_version:1,owner_user_id:owner,status:state,players:[{id:'alice',user_id:'alice',kind:'human',player_index:0},{id:'bob',user_id:'bob',kind:'human',player_index:1}],state:{},turn_of_player_indices:state==='over'?null:[0],move_count:0,created_at:'2026-01-01T00:00:00Z'});
  let target=match('listed-target'),removed=false,hold:(()=>Promise<void>)|null=null;
  const other=match('unrelated-selected','ongoing'),mutations:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request,init:RequestInit={})=>{
    const url=new URL(String(input)),method=init.method||'GET';let value:any=[];
    if(url.pathname==='/matches/listed-target'&&method==='GET'){if(hold)await hold();value=target;}
    else if(url.pathname.startsWith('/matches/listed-target')&&method!=='GET'){
      mutations.push(method+' '+url.pathname);
      if(method==='DELETE'){removed=true;value=null;}
      else{target={...target,status:'over',turn_of_player_indices:null,players:target.players.map(player=>player.user_id==='alice'?{...player,active:false}:player)};value=target;}
    }
    else if(url.pathname==='/matches/unrelated-selected')value=other;
    else if(url.pathname==='/matches')value=removed?[other]:[target,other];
    else if(url.pathname==='/storage/capabilities')value={pagination:false};
    else if(url.pathname==='/auth/config')value={};
    else if(url.pathname==='/i18n/locales')value={locales:[{code:'en',direction:'ltr'}]};
    else if(url.pathname.startsWith('/i18n/bundle/'))value={catalog:{messages:{},direction:'ltr'},games:{}};
    else if(/^\/users\/[^/]+$/.test(url.pathname))value={id:url.pathname.split('/').at(-1),token_balance:0};
    return new Response(JSON.stringify(value),{status:200});
  }) as typeof fetch;
  return {saved,mutations,hold:(fn:()=>Promise<void>)=>{hold=fn;},restore(){globalThis.fetch=previousFetch;if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete(globalThis as any).localStorage;}};
}

for(const scenario of [
  {name:'finished match',status:'over',owner:'alice',method:'DELETE',suffix:''},
  {name:'waiting host lobby',status:'waiting_for_players',owner:'alice',method:'DELETE',suffix:''},
  {name:'waiting guest seat',status:'waiting_for_players',owner:'bob',method:'POST',suffix:'/leave'},
  {name:'previewed ongoing seat',status:'ongoing',owner:'bob',method:'POST',suffix:'/playerLeft'},
])test(`list action for a ${scenario.name} preserves an unrelated selected board`,async()=>{
  const f=fixture(scenario.status,scenario.owner);
  try{
    const store=new PortalStore(async()=>({}));await store.bootstrap(base);await store.actions.selectMatch('unrelated-selected');
    await store.actions.leaveMatch('listed-target');
    assert.deepEqual(f.mutations,[`${scenario.method} /matches/listed-target${scenario.suffix}`]);
    assert.equal(store.getSnapshot().selectedMatch?.id,'unrelated-selected');
    const durable=await new AccountRepository(base).read('alice');
    assert.equal(durable.selectedId,'unrelated-selected');assert.equal(durable.responses['/matches/unrelated-selected'].id,'unrelated-selected');
    if(scenario.status!=='ongoing')assert.equal(store.getSnapshot().myMatches.some(match=>match.id==='listed-target'),false);
    else assert.equal(store.getSnapshot().myMatches.find(match=>match.id==='listed-target')?.status,'over');
  }finally{f.restore();}
});

test('a list action refuses preserved pending conflicts before making a server mutation',async()=>{
  const f=fixture();
  try{
    const store=new PortalStore(async()=>({}));await store.bootstrap(base);await store.actions.selectMatch('unrelated-selected');
    const repository=new AccountRepository(base);await repository.mutate('alice',data=>{data.conflicts['listed-target']={message:'Preserved conflicting branch'};});
    await store.actions.refresh();
    await assert.rejects(store.actions.leaveMatch('listed-target'),/pending actions/);
    assert.deepEqual(f.mutations,[]);assert.equal(store.getSnapshot().selectedMatch?.id,'unrelated-selected');
    assert.equal((await repository.read('alice')).conflicts['listed-target'].message,'Preserved conflicting branch');
  }finally{f.restore();}
});

test('a late list-action lookup cannot mutate or archive after the account changes',async()=>{
  const f=fixture();let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(done=>{release=done;}),started=new Promise<void>(done=>{entered=done;});
  try{
    const store=new PortalStore(async()=>({}));await store.bootstrap(base);await store.actions.selectMatch('unrelated-selected');
    f.hold(async()=>{entered();await gate;});
    const leaving=assert.rejects(store.actions.leaveMatch('listed-target'),/Account changed/);await started;
    await store.actions.switchAccount('bob');release();await leaving;
    assert.deepEqual(f.mutations,[]);assert.equal(store.getSnapshot().account?.id,'bob');
    assert.equal((await new AccountRepository(base).read('bob')).archivedMatches.length,0);
  }finally{release();f.restore();}
});
