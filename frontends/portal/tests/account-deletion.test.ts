import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalStore} from '../src/core';
import {AccountRepository} from '../src/core/repository';
import {accountDeletion} from '../src/core/account-deletion';

const requested='2026-11-19T12:00:00Z',deadline='2026-11-20T12:00:00Z';
async function fixture(alias = false) {
  const originalFetch=globalThis.fetch,originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const values:Record<string,string>={};
  Object.defineProperties(values,{getItem:{value:(key:string)=>values[key]??null},setItem:{writable:true,value:(key:string,value:string)=>{values[key]=String(value);}},removeItem:{value:(key:string)=>{delete values[key];}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:values});
  const network={onLine:true};Object.defineProperty(globalThis,'navigator',{configurable:true,value:network});
  const alice=alias?'legacy-alice':'alice';
  values['game-platform.accounts.v1']=JSON.stringify([alice,'bob'].map(id=>({id,password:`test-${id}`,display_name:id})));
  values['game-platform.current-account.v1']=alice;
  const profiles:Record<string,any>=Object.fromEntries([alice,'bob'].map(id=>[id,{id:id===alice?'alice':id,display_name:id,deletion_requested_at:null,deletion_scheduled_at:null,deletion_started_at:null}]));
  const mutations:{method:string;id:string;body:any}[]=[];
  let delayedMutation:((id:string)=>Promise<void>)|undefined,delayedRead:((id:string,profile:any)=>Promise<void>)|undefined;
  globalThis.fetch=(async(input:any,init:RequestInit={})=>{
    const url=new URL(String(input)),method=init.method||'GET',id=(init.headers as any)?.['X-User-Id'];let value:any=[];
    if(url.pathname==='/i18n/locales')value={locales:[{code:'en',name:'English',direction:'ltr'}]};
    else if(url.pathname.startsWith('/i18n/bundle/'))value={catalog:{messages:{},direction:'ltr'},games:{}};
    else if(url.pathname==='/storage/capabilities')value={pagination:false};
    else if(url.pathname==='/auth/config')value={};
    else if(url.pathname==='/users/me/notifications')value={items:[],next_cursor:null,unread_count:0};
    else if(url.pathname==='/users/me/deletion-request'){
      assert.equal((init.headers as any)['X-User-Password'],`test-${id}`);
      mutations.push({method,id,body:init.body?JSON.parse(String(init.body)):undefined});
      if(method==='POST')Object.assign(profiles[id],{deletion_requested_at:requested,deletion_scheduled_at:deadline});
      else Object.assign(profiles[id],{deletion_requested_at:null,deletion_scheduled_at:null});
      const result={...profiles[id]};await delayedMutation?.(id);value=result;
    }else if(url.pathname===`/users/${id}`){value={...profiles[id]};await delayedRead?.(id,value);}
    else if(url.pathname==='/users'&&url.searchParams.has('ids')){value=url.searchParams.get('ids')!.split(',').map(key=>({...profiles[key]}));for(const item of value)await delayedRead?.(item.id,item);}
    return new Response(JSON.stringify(value),{status:200});
  }) as typeof fetch;
  const store=new PortalStore();await store.actions.bootstrap('https://local.test');
  return {store,values,profiles,mutations,network,delayMutation:(fn:typeof delayedMutation)=>{delayedMutation=fn;},delayRead:(fn:typeof delayedRead)=>{delayedRead=fn;},restore(){globalThis.fetch=originalFetch;if(originalNavigator)Object.defineProperty(globalThis,'navigator',originalNavigator);else delete (globalThis as any).navigator;}};
}

test('confirmed scheduling and undo update all own cached profiles and survive restart/account switches',async()=>{
  const f=await fixture();try{
    const repo=new AccountRepository('https://local.test');
    await (f.store as any).cache('/users?ids=alice%2Cbob',[{...f.profiles.alice},{...f.profiles.bob}]);
    await f.store.actions.requestAccountDeletion();
    assert.deepEqual(f.mutations,[{method:'POST',id:'alice',body:{confirmed:true}}]);
    const own=f.store.getSnapshot();assert.equal(own.profile.deletion_scheduled_at,deadline);assert.equal(own.account?.deletion_scheduled_at,deadline);assert.equal(own.profiles.alice.deletion_scheduled_at,deadline);
    assert.equal((await repo.read('alice')).responses['/users?ids=alice%2Cbob'][0].deletion_scheduled_at,deadline);
    assert.equal(JSON.parse(f.values['game-platform.accounts.v1'])[0].deletion_scheduled_at,deadline);
    const restarted=new PortalStore();await restarted.actions.bootstrap('https://local.test');assert.equal(restarted.getSnapshot().profile.deletion_scheduled_at,deadline);
    await restarted.actions.switchAccount('bob');assert.equal(accountDeletion(restarted.getSnapshot().account,restarted.getSnapshot().profile).pending,false);
    await restarted.actions.switchAccount('alice');assert.equal(restarted.getSnapshot().profile.deletion_scheduled_at,deadline);
    await restarted.actions.cancelAccountDeletion();assert.equal(f.mutations.at(-1)?.method,'DELETE');assert.equal(f.mutations.at(-1)?.body,undefined);
    const cleared=restarted.getSnapshot();assert.equal(cleared.account?.deletion_scheduled_at,null);assert.equal(cleared.profile.deletion_requested_at,null);assert.equal(cleared.profiles.alice.deletion_scheduled_at,null);
    const cached=await repo.read('alice');assert.equal(cached.responses['/users/alice'].deletion_scheduled_at,null);assert.equal(cached.responses['/users?ids=alice%2Cbob'][0].deletion_scheduled_at,null);
    assert.equal(JSON.parse(f.values['game-platform.accounts.v1']).find((a:any)=>a.id==='alice').deletion_scheduled_at,null);
  }finally{f.restore();}
});

test('account switches reject an in-flight deletion response without changing the new account',async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
  try{
    f.delayMutation(async()=>{entered();await gate;});
    const old=assert.rejects(f.store.actions.requestAccountDeletion(),/Account changed/);await started;
    await f.store.actions.switchAccount('bob');release();await old;
    const state=f.store.getSnapshot();assert.equal(state.account?.id,'bob');assert.equal(state.profile.deletion_scheduled_at,null);assert.equal(state.deletionUpdating,false);assert.equal(state.error,null);
    assert.equal((await new AccountRepository('https://local.test').read('bob')).responses['/users/bob'].deletion_scheduled_at,null);
  }finally{release();f.restore();}
});

test('a stale profile poll cannot restore a schedule after confirmed undo',async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});let held=false;
  try{
    await f.store.actions.requestAccountDeletion();
    f.delayRead(async(id,value)=>{if(id==='alice'&&value.deletion_scheduled_at&&!held){held=true;entered();await gate;}});
    const poll=(f.store as any).refreshProfile();await started;await f.store.actions.cancelAccountDeletion();release();await poll;
    assert.equal(f.store.getSnapshot().profile.deletion_scheduled_at,null);
    assert.equal((await new AccountRepository('https://local.test').read('alice')).responses['/users/alice'].deletion_scheduled_at,null);
  }finally{release();f.restore();}
});

test('offline scheduling and undo make no HTTP mutation and retain the last confirmed status',async()=>{
  const f=await fixture();try{
    f.network.onLine=false;await assert.rejects(f.store.actions.requestAccountDeletion(),/internet/);assert.equal(f.mutations.length,0);
    f.network.onLine=true;await f.store.actions.requestAccountDeletion();f.network.onLine=false;
    await assert.rejects(f.store.actions.cancelAccountDeletion(),/internet/);assert.equal(f.mutations.length,1);assert.equal(f.store.getSnapshot().profile.deletion_scheduled_at,deadline);
  }finally{f.restore();}
});

test('deadline display follows the exact undo boundary and never offers undo once purge starts',()=>{
  const account={id:'alice',password:'test-only',display_name:'alice',deletion_scheduled_at:deadline};
  assert.equal(accountDeletion(account,null,Date.parse(deadline)-1).canUndo,true);
  assert.equal(accountDeletion(account,null,Date.parse(deadline)).canUndo,false);
  assert.equal(accountDeletion(account,{...account,deletion_started_at:requested},Date.parse(deadline)-1).canUndo,false);
  assert.equal(accountDeletion(account,{id:'alice',deletion_scheduled_at:null},Date.parse(deadline)-1).pending,false);
  assert.equal(accountDeletion(account,{id:'bob',deletion_scheduled_at:null},Date.parse(deadline)-1).pending,true);
});


test('merged alias credentials schedule and undo the canonical profile without changing login identity',async()=>{
  const f=await fixture(true);try{
    const store=f.store,repo=new AccountRepository('https://local.test');
    assert.equal(store.getSnapshot().account?.id,'legacy-alice');assert.equal(store.getSnapshot().account?.canonical_user_id,'alice');
    await (store as any).cache('/users/alice',{id:'alice',deletion_scheduled_at:null});
    await (store as any).cache('/users?ids=legacy-alice%2Cbob',[{id:'alice',deletion_scheduled_at:null},{...f.profiles.bob}]);
    await store.actions.requestAccountDeletion();
    assert.equal(f.mutations[0].id,'legacy-alice');assert.equal(store.getSnapshot().account?.id,'legacy-alice');assert.equal(store.getSnapshot().account?.password,'test-legacy-alice');
    assert.equal(accountDeletion(store.getSnapshot().account,store.getSnapshot().profile,Date.parse(requested)).canUndo,true);
    assert.equal(store.getSnapshot().profiles.alice.deletion_scheduled_at,deadline);assert.equal(store.getSnapshot().profiles['legacy-alice'].deletion_scheduled_at,deadline);
    let data=await repo.read('legacy-alice');assert.equal(data.responses['/users/alice'].deletion_scheduled_at,deadline);assert.equal(data.responses['/users/legacy-alice'].deletion_scheduled_at,deadline);
    await store.actions.updateProfile({locale:'en'});assert.equal(store.getSnapshot().account?.id,'legacy-alice');assert.equal(store.getSnapshot().account?.password,'test-legacy-alice');
    await store.actions.cancelAccountDeletion();assert.equal(f.mutations[1].id,'legacy-alice');
    data=await repo.read('legacy-alice');assert.equal(data.responses['/users/alice'].deletion_scheduled_at,null);assert.equal(data.responses['/users/legacy-alice'].deletion_scheduled_at,null);assert.equal(data.responses['/users?ids=legacy-alice%2Cbob'][1].deletion_scheduled_at,null);
    assert.equal(store.getSnapshot().accounts.find(item=>item.id==='bob')?.canonical_user_id,undefined);
    const saved=JSON.parse(f.values['game-platform.accounts.v1']);assert.equal(saved[0].id,'legacy-alice');assert.equal(saved[0].password,'test-legacy-alice');assert.equal(saved[0].deletion_scheduled_at,null);
  }finally{f.restore();}
});

test('an old batched profile result cannot resurrect a confirmed deletion schedule after undo',async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
  try{
    await f.store.actions.requestAccountDeletion();
    f.delayRead(async(id)=>{if(id==='alice'){entered();await gate;}});
    const poll=(f.store as any).read('/users?ids=alice%2Cbob');await started;
    await f.store.actions.cancelAccountDeletion();release();const result=await poll;
    assert.equal(result[0].deletion_scheduled_at,null);assert.equal(result[1].deletion_scheduled_at,null);
    assert.equal((await new AccountRepository('https://local.test').read('alice')).responses['/users?ids=alice%2Cbob'][0].deletion_scheduled_at,null);
  }finally{release();f.restore();}
});

test('saved deletion status restores offline for its account, while undo remains online-only',async()=>{
  const f=await fixture();try{
    await f.store.actions.requestAccountDeletion();f.network.onLine=false;
    const restored=new PortalStore();await restored.actions.bootstrap('https://local.test',true);
    assert.equal(restored.getSnapshot().profile.deletion_scheduled_at,deadline);
    await restored.actions.switchAccount('bob');assert.equal(accountDeletion(restored.getSnapshot().account,restored.getSnapshot().profile).pending,false);
    await restored.actions.switchAccount('alice');assert.equal(restored.getSnapshot().profile.deletion_scheduled_at,deadline);
    await assert.rejects(restored.actions.cancelAccountDeletion(),/internet/);assert.equal(f.mutations.length,1);
  }finally{f.restore();}
});
