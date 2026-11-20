import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalStore} from '../src/core';
import type {Account} from '../src/core/types';

const today='2026-11-20',tomorrow='2026-11-21';
function account(id:string,verified=true):Account{return {id,password:`${id}-synthetic-secret`,display_name:id,linked:verified?[{kind:'email'}]:[],is_verified:verified,token_balance:10,free_tokens_granted:verified?10:0,last_token_grant_day:'2026-11-03'};}
function fixture(accounts:Account[],onClaim?:(id:string,profile:any)=>Promise<any>){
  const values:Record<string,string>={};
  Object.defineProperties(values,{getItem:{value:(key:string)=>values[key]??null},setItem:{value:(key:string,value:string)=>{values[key]=String(value);}},removeItem:{value:(key:string)=>{delete values[key];}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:values});
  values['game-platform.accounts.v1']=JSON.stringify(accounts);values['game-platform.current-account.v1']=accounts[0].id;
  const profiles=Object.fromEntries(accounts.map(item=>[item.id,{id:item.id,display_name:item.display_name,token_balance:item.token_balance??0,free_tokens_granted:item.free_tokens_granted??0,last_token_grant_day:item.last_token_grant_day,is_verified:item.is_verified}]));
  const claims:string[]=[],original=globalThis.fetch;
  globalThis.fetch=(async(input:RequestInfo|URL,init:RequestInit={})=>{
    const url=new URL(String(input)),id=(init.headers as Record<string,string>)?.['X-User-Id'];let value:any=[];
    if(url.pathname==='/auth/daily-login'){
      claims.push(id);value=onClaim?await onClaim(id,profiles[id]):{...profiles[id],token_balance:profiles[id].token_balance+10,free_tokens_granted:profiles[id].free_tokens_granted+10,last_token_grant_day:new Date().toISOString().slice(0,10)};profiles[id]=value;
    }else if(url.pathname==='/i18n/locales')value={locales:[{code:'en',direction:'ltr'}]};
    else if(url.pathname.startsWith('/i18n/bundle/'))value={catalog:{messages:{}}};
    else if(url.pathname==='/storage/capabilities')value={pagination:false};
    else if(url.pathname==='/auth/config')value={};
    else if(url.pathname==='/users/me/notifications')value={items:[],next_cursor:null,unread_count:0};
    else if(url.pathname===`/users/${id}`)value=profiles[id];
    else if(url.pathname==='/matches/m')value={id:'m',game_id:'bundled-tictactoe',game_version:1,status:'ongoing',state:{board:[]},players:[],turn_of_player_indices:[0],move_count:0};
    return new Response(JSON.stringify(value),{status:200});
  }) as typeof fetch;
  return {store:new PortalStore(),profiles,claims,restore:()=>{globalThis.fetch=original;}};
}

test('retained verified sessions claim once per visit day, including nonconsecutive days',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${today}T12:00:00Z`)});const f=fixture([account('alice')]);
  try{
    await f.store.bootstrap('https://local.test');assert.deepEqual(f.claims,['alice']);assert.equal(f.store.getSnapshot().profile.token_balance,20);
    await f.store.actions.refresh();await f.store.actions.refresh();assert.deepEqual(f.claims,['alice']);
    t.mock.timers.setTime(Date.parse('2026-11-25T12:00:00Z'));await f.store.actions.refresh();
    assert.deepEqual(f.claims,['alice','alice']);assert.equal(f.store.getSnapshot().profile.token_balance,30);assert.equal(f.store.getSnapshot().account!.last_token_grant_day,'2026-11-25');
  }finally{f.restore();}
});

test('guests, offline launches, already claimed days and lifetime cap skip daily claims',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${today}T12:00:00Z`)});
  for(const [saved,localOnly]of [[account('guest',false),false],[account('offline'),true],[{...account('claimed'),last_token_grant_day:today},false],[{...account('capped'),free_tokens_granted:100},false]] as const){
    const f=fixture([saved]);try{await f.store.bootstrap('https://local.test',localOnly);await f.store.actions.refresh();assert.deepEqual(f.claims,[],saved.id);}finally{f.restore();}
  }
});

test('older saved credentials use the own profile to establish verified eligibility',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${today}T12:00:00Z`)});
  const f=fixture([{...account('legacy'),linked:undefined,is_verified:undefined}]);f.profiles.legacy.is_verified=true;
  try{await f.store.bootstrap('https://local.test');assert.deepEqual(f.claims,['legacy']);assert.equal(f.store.getSnapshot().profile.token_balance,20);}finally{f.restore();}
});

test('failed daily claims retry later without blocking the portal or every poll',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${today}T12:00:00Z`)});let attempts=0;
  const f=fixture([account('alice')],async(_id,profile)=>{if(++attempts===1)throw new TypeError('Temporary network failure');return {...profile,token_balance:20,free_tokens_granted:20,last_token_grant_day:today};});
  try{
    await f.store.bootstrap('https://local.test');assert.equal(f.store.getSnapshot().ready,true);assert.equal(f.store.getSnapshot().error,null);
    await f.store.actions.refresh();assert.equal(attempts,1);t.mock.timers.tick(60001);await f.store.actions.refresh();assert.equal(attempts,2);assert.equal(f.store.getSnapshot().profile.token_balance,20);
  }finally{f.restore();}
});

test('simultaneous match and page polls share one daily claim across midnight',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${today}T12:00:00Z`)});let release!:()=>void,started!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),begin=new Promise<void>(resolve=>{started=resolve;});
  const f=fixture([{...account('alice'),last_token_grant_day:today}],async(_id,profile)=>{started();await held;return {...profile,token_balance:20,free_tokens_granted:20,last_token_grant_day:tomorrow};});
  try{
    await f.store.bootstrap('https://local.test');await f.store.actions.selectMatch('m');t.mock.timers.setTime(Date.parse(`${tomorrow}T00:00:01Z`));
    const page=f.store.actions.refresh(),match=f.store.actions.refreshMatch();await begin;assert.deepEqual(f.claims,['alice']);release();await Promise.all([page,match]);assert.equal(f.store.getSnapshot().profile.token_balance,20);
  }finally{release();f.restore();}
});

test('a delayed reward claim cannot overwrite the next account wallet',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse(`${today}T12:00:00Z`)});let release!:()=>void,started!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;}),begin=new Promise<void>(resolve=>{started=resolve;});
  const f=fixture(['alice','bob'].map(id=>({...account(id),last_token_grant_day:today})),async(id,profile)=>{if(id==='alice'){started();await held;}return {...profile,token_balance:id==='alice'?99:20,free_tokens_granted:20,last_token_grant_day:tomorrow};});
  try{
    await f.store.bootstrap('https://local.test');t.mock.timers.setTime(Date.parse(`${tomorrow}T00:00:01Z`));const old=assert.rejects(f.store.actions.refresh(),/Account changed/);await begin;
    await f.store.actions.switchAccount('bob');release();await old;assert.equal(f.store.getSnapshot().account!.id,'bob');assert.equal(f.store.getSnapshot().profile.token_balance,20);assert.deepEqual(f.claims,['alice','bob']);
  }finally{release();f.restore();}
});
