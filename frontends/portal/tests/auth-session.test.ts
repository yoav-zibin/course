import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {PortalStore,type Account} from '../src/core';
import {AccountRepository} from '../src/core/repository';
import {rulesSource} from '../src/game/runtimeSource';
import {createCredentialVault} from '../src/platform/credential-vault';
import {InactiveSignInError} from '../src/core/api';
import {diagnosticSnapshot} from '../src/core/diagnostics';

const base='https://auth-session.test';
const accounts:Account[]=[
  {id:'alice',password:'synthetic-alice-password',display_name:'Alice',linked:[{kind:'google',identifier:'synthetic-alice'}]},
  {id:'bob',password:'synthetic-bob-password',display_name:'Bob',linked:[]},
];
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function fixture(extra:(url:URL,init:RequestInit)=>unknown|Promise<unknown>=()=>undefined){
  const previousStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),previousFetch=globalThis.fetch;
  const saved:Record<string,string>={
    'game-platform.accounts.v1':JSON.stringify(accounts),
    'game-platform.current-account.v1':'alice',
  };
  Object.defineProperties(saved,{
    getItem:{value:(key:string)=>Object.hasOwn(saved,key)?saved[key]:null},
    setItem:{writable:true,value:(key:string,value:string)=>{saved[key]=String(value);}},
    removeItem:{value:(key:string)=>{delete saved[key];}},
  });
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:saved});
  const calls:{path:string;method:string}[]=[];
  globalThis.fetch=(async(input:string|URL|Request,init:RequestInit={})=>{
    const url=new URL(String(input));calls.push({path:url.pathname,method:init.method||'GET'});
    let value=await extra(url,init);
    if(value instanceof Response)return value;
    if(value===undefined){
      if(url.pathname==='/i18n/locales')value={locales:[{code:'en',name:'English',direction:'ltr'}]};
      else if(url.pathname.startsWith('/i18n/bundle/'))value={catalog:{messages:{},direction:'ltr'},games:{}};
      else if(url.pathname==='/storage/capabilities')value={pagination:false};
      else if(url.pathname==='/auth/config')value={};
      else if(/^\/users\/[^/]+$/.test(url.pathname))value={id:url.pathname.split('/').at(-1),token_balance:0};
      else value=[];
    }
    return new Response(JSON.stringify(value),{status:200});
  }) as typeof fetch;
  return {saved,calls,restore(){globalThis.fetch=previousFetch;if(previousStorage)Object.defineProperty(globalThis,'localStorage',previousStorage);else delete (globalThis as any).localStorage;}};
}
const runtime=async(game:any,name:string,args:unknown[],ctx:unknown,seed:number|string,now:number)=>{
  const result=JSON.parse(vm.runInNewContext(rulesSource(game,name,args,ctx,seed,now),{},{timeout:3000}));
  if(!result.ok)throw new Error(result.message);return result.result;
};
function authCalls(calls:{path:string;method:string}[]){return calls.filter(call=>call.method==='POST'&&(call.path.startsWith('/auth/')&&call.path!=='/auth/daily-login'||call.path.endsWith('/merge')));}
const cancelled=()=>{throw new InactiveSignInError('Account dialog closed or replaced.');};

test('logging out stays signed out after restart while other credentials and both local saves remain intact',async()=>{
  const f=fixture();
  try{
    const store=new PortalStore(runtime);await store.bootstrap(base);
    await store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0});
    const aliceMatch=store.getSnapshot().selectedMatch!.id;
    await store.actions.switchAccount('bob');
    await store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0});
    const bobMatch=store.getSnapshot().selectedMatch!.id;
    await store.actions.switchAccount('alice');
    const repository=new AccountRepository(base),aliceKey=repository.key('alice'),bobKey=repository.key('bob');
    const aliceBefore=f.saved[aliceKey],bobBefore=f.saved[bobKey];
    const unrelatedBefore=JSON.parse(f.saved['game-platform.accounts.v1']).filter((item:Account)=>item.id!=='alice');
    await store.actions.logout();
    assert.equal(store.getSnapshot().account,null);
    assert.deepEqual(JSON.parse(f.saved['game-platform.accounts.v1']),unrelatedBefore);
    assert.equal(f.saved[aliceKey],aliceBefore);assert.equal(f.saved[bobKey],bobBefore);
    const restarted=new PortalStore(runtime);await restarted.bootstrap(base);
    assert.equal(restarted.getSnapshot().account,null);
    assert.deepEqual(restarted.getSnapshot().accounts,unrelatedBefore);
    assert.equal(f.saved[aliceKey],aliceBefore);assert.equal(f.saved[bobKey],bobBefore);
    assert.ok(JSON.parse(f.saved[aliceKey]).local[aliceMatch]);
    assert.ok(JSON.parse(f.saved[bobKey]).local[bobMatch]);
    // A remembered login is still usable through a later explicit selection.
    await restarted.actions.switchAccount('bob');assert.equal(restarted.getSnapshot().account?.id,'bob');
    assert.ok(restarted.getSnapshot().localMatches.some(match=>match.id===bobMatch));
  }finally{f.restore();}
});

test('a delayed older account-selection write cannot sign in again after logout',async()=>{
  const f=fixture(),writeStarted=deferred<void>(),releaseWrite=deferred<void>();
  try{
    const store=new PortalStore(runtime,undefined,async id=>{
      if(id==='bob'){writeStarted.resolve();await releaseWrite.promise;}
      f.saved['game-platform.current-account.v1']=id;
    });
    await store.bootstrap(base);
    const oldSwitch=assert.rejects(store.actions.switchAccount('bob'),/Account changed/);
    await writeStarted.promise;
    const logout=store.actions.logout();releaseWrite.resolve();await logout;await oldSwitch;
    assert.equal(store.getSnapshot().account,null);
    const restarted=new PortalStore(runtime);await restarted.bootstrap(base);
    assert.equal(restarted.getSnapshot().account,null);
    assert.ok(restarted.getSnapshot().accounts.some(account=>account.id==='bob'));
  }finally{releaseWrite.resolve();f.restore();}
});

test('a native signed-out selection persists alongside the saved secure credentials',async()=>{
  const metadata=new Map<string,string>(),secure=new Map<string,string>();
  const values=(map:Map<string,string>)=>({getItem:async(key:string)=>map.get(key)??null,setItem:async(key:string,value:string)=>{map.set(key,value);}});
  const vault=createCredentialVault('https://buildplay.fun',values(metadata),values(secure));
  await vault.saveAccounts(accounts);
  metadata.set(vault.keys.current,'visitor');
  const originalSecure=new Map(secure);
  const restarted=createCredentialVault('https://buildplay.fun',values(metadata),values(secure));
  assert.equal(await restarted.loadCurrentAccount(),'visitor');
  assert.deepEqual(await restarted.loadAccounts(),accounts);
  assert.deepEqual(secure,originalSecure);
});

test('logout wins over an earlier verified-login selection persistence without losing the other account or its local save',async()=>{
  const verified={user_id:'bob',password:accounts[1].password,display_name:'Bob',linked_accounts:[{kind:'google',identifier:'synthetic-bob'}]};
  const f=fixture(url=>url.pathname==='/auth/google'?verified:undefined),writeStarted=deferred<void>(),releaseWrite=deferred<void>();
  let delayAuthSelection=false;
  try{
    const store=new PortalStore(runtime,undefined,async id=>{
      if(id==='bob'&&delayAuthSelection){delayAuthSelection=false;writeStarted.resolve();await releaseWrite.promise;}
      f.saved['game-platform.current-account.v1']=id;
    });
    await store.bootstrap(base);await store.actions.switchAccount('bob');
    await store.actions.startPractice('bundled-tictactoe',{humans:2,computers:0});
    const bobMatch=store.getSnapshot().selectedMatch!.id;
    await store.actions.switchAccount('alice');
    const bobKey=new AccountRepository(base).key('bob'),bobData=f.saved[bobKey];
    const bobCredential=JSON.parse(f.saved['game-platform.accounts.v1']).find((item:Account)=>item.id==='bob');
    delayAuthSelection=true;
    const oldLogin=assert.rejects(store.actions.google('synthetic-token'),/Account changed/);
    await writeStarted.promise;
    // The delayed writer must be the actual credential-selection commit,
    // rather than a redundant switch after an earlier direct storage write.
    assert.equal(f.saved['game-platform.current-account.v1'],'alice');
    const logout=store.actions.logout();releaseWrite.resolve();await logout;await oldLogin;
    assert.equal(store.getSnapshot().account,null);
    const restarted=new PortalStore(runtime);await restarted.bootstrap(base);
    assert.equal(restarted.getSnapshot().account,null);
    assert.deepEqual(JSON.parse(f.saved['game-platform.accounts.v1']).find((item:Account)=>item.id==='bob'),bobCredential);
    assert.equal(f.saved[bobKey],bobData);assert.ok(JSON.parse(f.saved[bobKey]).local[bobMatch]);
  }finally{releaseWrite.resolve();f.restore();}
});

test('cancelled confirmation cannot start a guest, verified or native browser login',async()=>{
  let browserStarts=0;const f=fixture();
  try{
    const store=new PortalStore(runtime,async()=>{browserStarts++;throw new Error('Provider must not open');});await store.bootstrap(base);
    const before=f.saved['game-platform.accounts.v1'];
    await assert.rejects(store.actions.guest('Guest',cancelled),/dialog closed/);
    await assert.rejects(store.actions.google('synthetic-token',true,cancelled),/dialog closed/);
    await assert.rejects(store.actions.verifyCode('email','verification','123456','Alice',true,cancelled),/dialog closed/);
    await assert.rejects(store.actions.browserLogin(true,cancelled),/dialog closed/);
    assert.equal(browserStarts,0);assert.deepEqual(authCalls(f.calls),[]);
    assert.equal(f.calls.some(call=>call.path==='/users'&&call.method==='POST'),false);
    assert.equal(store.getSnapshot().account?.id,'alice');assert.equal(f.saved['game-platform.accounts.v1'],before);
    assert.equal(store.getSnapshot().error,null);
  }finally{f.restore();}
});

test('closing the account dialog before native browser completion cannot merge or save the returned account',async()=>{
  const f=fixture(),provider=deferred<any>();let open=true;
  try{
    const store=new PortalStore(runtime,()=>provider.promise);await store.bootstrap(base);
    const before=f.saved['game-platform.accounts.v1'];
    const pending=store.actions.browserLogin(true,()=>{if(!open)cancelled();});
    const rejected=assert.rejects(pending,/dialog closed/);
    open=false;provider.resolve({user_id:'returned-user',password:'synthetic-returned-password',display_name:'Returned',linked_accounts:[{kind:'google',identifier:'synthetic-returned'}]});
    await rejected;
    assert.deepEqual(authCalls(f.calls),[]);assert.equal(store.getSnapshot().account?.id,'alice');
    assert.equal(f.saved['game-platform.accounts.v1'],before);assert.equal(f.saved['game-platform.current-account.v1'],'alice');
    assert.equal(store.getSnapshot().error,null);
  }finally{f.restore();}
});

test('a late guest creation response cannot sign in after its form closes and does not show a cancellation error',async()=>{
  const response=deferred<any>(),requestStarted=deferred<void>();let open=true;
  const f=fixture(async(url,init)=>{if(url.pathname==='/users'&&init.method==='POST'){
    assert.equal((init.headers as Record<string,string>)['X-User-Id'],undefined);
    requestStarted.resolve();return response.promise;
  }});
  let pending:Promise<void>|undefined;
  try{
    f.saved['game-platform.current-account.v1']='visitor';
    const store=new PortalStore(runtime);await store.bootstrap(base);assert.equal(store.getSnapshot().account,null);
    const before=f.saved['game-platform.accounts.v1'];
    pending=assert.rejects(store.actions.guest('Guest',()=>{if(!open)cancelled();}),/dialog closed/);
    await requestStarted.promise;open=false;
    response.resolve({id:'new-guest',password:'synthetic-guest-password',display_name:'Guest',linked_accounts:[],token_balance:0});
    await pending;
    assert.equal(store.getSnapshot().account,null);assert.equal(store.getSnapshot().error,null);
    assert.equal(f.saved['game-platform.accounts.v1'],before);assert.equal(f.saved['game-platform.current-account.v1'],'visitor');
    assert.equal((diagnosticSnapshot().logs as any[]).some(entry=>String(entry.message).includes('Account dialog closed')),false);
  }finally{response.resolve({});await pending?.catch(()=>{});f.restore();}
});

test('a cancelled native provider leaves the current account and credentials unchanged',async()=>{
  const f=fixture();
  try{
    const store=new PortalStore(runtime,async()=>{throw new Error('Browser sign-in was cancelled.');});await store.bootstrap(base);
    const before=f.saved['game-platform.accounts.v1'];
    await assert.rejects(store.actions.browserLogin(true,()=>{}),/cancelled/);
    assert.deepEqual(authCalls(f.calls),[]);assert.equal(store.getSnapshot().account?.id,'alice');
    assert.equal(f.saved['game-platform.accounts.v1'],before);assert.equal(f.saved['game-platform.current-account.v1'],'alice');
  }finally{f.restore();}
});

test('a real browser-provider failure still reaches the visible application error state',async()=>{
  const f=fixture();
  try{
    const store=new PortalStore(runtime,async()=>{throw new Error('Verified provider is unavailable.');});await store.bootstrap(base);
    await assert.rejects(store.actions.browserLogin(true,()=>{}),/provider is unavailable/);
    assert.equal(store.getSnapshot().error,'Verified provider is unavailable.');
    assert.equal(store.getSnapshot().account?.id,'alice');
  }finally{f.restore();}
});

test('a real verified-login API failure remains visible and recorded in request diagnostics',async()=>{
  const f=fixture(url=>url.pathname==='/auth/google'?new Response(JSON.stringify({detail:'Verified provider is unavailable.'}),{status:503}):undefined);
  try{
    const store=new PortalStore(runtime);await store.bootstrap(base);
    await assert.rejects(store.actions.google('synthetic-token',true,()=>{}),/provider is unavailable/);
    assert.equal(store.getSnapshot().error,'Verified provider is unavailable.');
    const call=(diagnosticSnapshot().apiCalls as any[]).find(entry=>entry.path==='/auth/google');
    assert.equal(call?.status,503);assert.equal(call?.state,'complete');assert.equal(typeof call?.durationMs,'number');
    assert.equal(store.getSnapshot().account?.id,'alice');
  }finally{f.restore();}
});

test('the native verified-login handoff rejects a guest identity before merging or saving it',async()=>{
  const f=fixture();
  try{
    const store=new PortalStore(runtime,async()=>({user_id:'browser-guest',password:'synthetic-browser-password',display_name:'Browser guest',linked_accounts:[]}));await store.bootstrap(base);
    const before=f.saved['game-platform.accounts.v1'];
    await assert.rejects(store.actions.browserLogin(true,()=>{},true),/verified login/);
    assert.deepEqual(authCalls(f.calls),[]);assert.equal(store.getSnapshot().account?.id,'alice');
    assert.equal(f.saved['game-platform.accounts.v1'],before);assert.equal(f.saved['game-platform.current-account.v1'],'alice');
  }finally{f.restore();}
});

test('closing a form during native selection persistence restores the previous selection before restart',async()=>{
  const f=fixture(url=>url.pathname==='/auth/google'?{user_id:'bob',password:accounts[1].password,display_name:'Bob',linked_accounts:[{kind:'google',identifier:'synthetic-bob'}]}:undefined);
  const writeStarted=deferred<void>(),releaseWrite=deferred<void>();let open=true,pending:Promise<void>|undefined;
  try{
    const store=new PortalStore(runtime,undefined,async id=>{
      if(id==='bob'){writeStarted.resolve();await releaseWrite.promise;}
      f.saved['game-platform.current-account.v1']=id;
    });
    await store.bootstrap(base);
    pending=assert.rejects(store.actions.google('synthetic-token',false,()=>{if(!open)cancelled();}),/dialog closed/);
    await writeStarted.promise;open=false;releaseWrite.resolve();await pending;
    assert.equal(store.getSnapshot().account?.id,'alice');assert.equal(f.saved['game-platform.current-account.v1'],'alice');
    assert.equal(store.getSnapshot().error,null);
    const restarted=new PortalStore(runtime);await restarted.bootstrap(base);assert.equal(restarted.getSnapshot().account?.id,'alice');
  }finally{releaseWrite.resolve();await pending?.catch(()=>{});f.restore();}
});

for(const method of ['google','email','phone'] as const)test(`a late ${method} verification cannot replace credentials after its dialog is superseded`,async()=>{
  const response=deferred<any>(),requestStarted=deferred<void>();let currentDialog=1;
  const path=method==='google'?'/auth/google':`/auth/${method}/verify`;
  const f=fixture(async(url,init)=>{if(url.pathname===path&&init.method==='POST'){requestStarted.resolve();return response.promise;}});
  try{
    const store=new PortalStore(runtime);await store.bootstrap(base);
    const before=f.saved['game-platform.accounts.v1'],guard=()=>{if(currentDialog!==1)cancelled();};
    const pending=method==='google'?store.actions.google('synthetic-token',true,guard):store.actions.verifyCode(method,'verification','123456','Alice',true,guard);
    const rejected=assert.rejects(pending,/dialog closed/);await requestStarted.promise;
    currentDialog=2;response.resolve({user_id:'returned-user',password:'synthetic-returned-password',display_name:'Returned',linked_accounts:[{kind:method,identifier:'synthetic-returned'}]});
    await rejected;
    assert.equal(authCalls(f.calls).filter(call=>call.path===path).length,1);
    assert.equal(store.getSnapshot().account?.id,'alice');assert.equal(f.saved['game-platform.accounts.v1'],before);
    assert.equal(f.saved['game-platform.current-account.v1'],'alice');
    assert.equal(store.getSnapshot().error,null);
  }finally{response.resolve({});f.restore();}
});
