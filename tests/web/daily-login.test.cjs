const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=require('./device-storage-fixture.cjs').source+'\n'+fs.readFileSync(path.join(__dirname,'../../static/auth.js'),'utf8');
function account(id,verified=true){return {id,password:id+'-synthetic-secret',display_name:id,linked:verified?[{kind:'email'}]:[],is_verified:verified,token_balance:verified?10:0,free_tokens_granted:verified?10:0,last_token_grant_day:'2026-11-01'};}
function load(accounts,onRequest,{online=true,storage=null}={}){
  const clock={now:Date.parse('2026-11-20T12:00:00Z')},events=new Map(),calls=[];
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock.now]));}static now(){return clock.now;}}
  storage??=new Map([['game-platform.accounts.v1',JSON.stringify(accounts)],['game-platform.current-account.v1',accounts[0].id]]);
  const add=(name,callback)=>events.set(name,[...(events.get(name)||[]),callback]);
  const context=vm.createContext({console,URLSearchParams,Date:ClockDate,CustomEvent:class{constructor(type){this.type=type;}},navigator:{onLine:online},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    location:{origin:'https://buildplay.fun',hash:'',search:''},window:{addEventListener:add},document:{hidden:false,addEventListener:add,dispatchEvent:event=>(events.get(event.type)||[]).forEach(callback=>callback(event))},
    el:()=>({}),apiRequest:async(method,url,options)=>{calls.push({method,url,id:options.user.id});return onRequest(method,url,options,clock);}});
  vm.runInContext(source+'\nthis.Auth=Auth;',context);return {Auth:context.Auth,calls,clock,storage};
}

test('legacy website visits reward retained verified sessions once per UTC day',async()=>{
  const f=load([account('alice')],async(_method,_url,options,clock)=>({...options.user,token_balance:options.user.token_balance+10,free_tokens_granted:options.user.free_tokens_granted+10,last_token_grant_day:new Date(clock.now).toISOString().slice(0,10)}));
  await f.Auth.claimDailyLogin();await f.Auth.claimDailyLogin();assert.equal(f.calls.length,1);assert.equal(f.Auth.current().token_balance,20);
  f.clock.now=Date.parse('2026-11-25T12:00:00Z');await f.Auth.claimDailyLogin();assert.equal(f.calls.length,2);assert.equal(f.Auth.current().token_balance,30);
  assert.deepEqual(f.calls.map(call=>call.url),['/auth/daily-login','/auth/daily-login']);
});

test('legacy guests, capped accounts and offline pages do not post daily claims',async()=>{
  for(const [saved,online]of [[account('guest',false),true],[{...account('capped'),free_tokens_granted:100},true],[account('offline'),false]]){
    const f=load([saved],()=>assert.fail('ineligible session made a request'),{online});await f.Auth.claimDailyLogin();assert.deepEqual(f.calls,[]);
  }
  const saved={...account('older'),is_verified:undefined,linked:[]};
  const f=load([saved],async(_method,url)=>url==='/auth/me'?{is_verified:false,free_tokens_granted:0}:assert.fail('guest posted daily claim'));
  await f.Auth.claimDailyLogin();assert.deepEqual(f.calls.map(call=>call.url),['/auth/me']);
});

test('legacy daily claim responses are ignored after switching accounts',async()=>{
  let release;const held=new Promise(resolve=>{release=resolve;});
  const f=load([account('alice'),account('bob')],async(_method,_url,options)=>{if(options.user.id==='alice')await held;return {id:options.user.id,is_verified:true,token_balance:options.user.id==='alice'?99:20,free_tokens_granted:20,last_token_grant_day:'2026-11-20'};});
  const old=f.Auth.claimDailyLogin();f.Auth.setCurrent('bob');await f.Auth.claimDailyLogin();release();await old;
  assert.equal(f.Auth.current().id,'bob');assert.equal(f.Auth.current().token_balance,20);assert.equal(f.Auth.accounts().find(item=>item.id==='alice').token_balance,10);
});

test('legacy daily reward failures back off and retry without forcing a reload',async()=>{
  let attempts=0;
  const f=load([account('alice')],async()=>{if(++attempts===1)throw new Error('offline');return {id:'alice',is_verified:true,token_balance:20,free_tokens_granted:20,last_token_grant_day:'2026-11-20'};});
  await f.Auth.claimDailyLogin();await f.Auth.claimDailyLogin();assert.equal(attempts,1);
  f.clock.now+=60001;await f.Auth.claimDailyLogin();assert.equal(attempts,2);assert.equal(f.Auth.current().token_balance,20);
});
