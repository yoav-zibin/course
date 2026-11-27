// Invite links: the inviter in "ref" is remembered and sent when an account is created.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const storageSource=require('./device-storage-fixture.cjs').source;
const AUTH_JS=fs.readFileSync(path.join(__dirname,'../../static/auth.js'),'utf8');

/** Loads auth.js as if the page were opened at [hash] (and [search]), with [storage] as localStorage. */
function loadAuth(hash, storage=new Map(), search='', storageImpl=null) {
  const ctx=vm.createContext({console,URL,URLSearchParams,CustomEvent:class{constructor(type){this.type=type;}},
    localStorage: storageImpl || {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    location:{hash,search,origin:'https://buildplay.fun'},
    window:{addEventListener(){}},document:{dispatchEvent(){}},
    apiRequest:async()=>{},el:()=>({})});
  vm.runInContext(storageSource+'\n'+AUTH_JS+'\nthis.Auth=Auth;',ctx);
  return {Auth:ctx.Auth,storage};
}

function deniedStorage() {
  const error = () => Object.assign(new Error('denied'), { name: 'SecurityError' });
  return { getItem: () => { throw error(); }, setItem: () => { throw error(); }, removeItem: () => { throw error(); } };
}

test('denied storage keeps login working in memory for this page load',()=>{
  const {Auth}=loadAuth('',new Map(),'',deniedStorage());
  assert.equal(Auth.current(),null);
  Auth.upsert({user_id:'bob',display_name:'Bob',password:'pw',linked_accounts:[]});
  assert.equal(Auth.current().id,'bob');
  Auth.upsert({user_id:'cy',display_name:'Cy',password:'pw',linked_accounts:[]});
  assert.equal(Auth.current().id,'cy');
  Auth.setCurrent('bob');
  assert.equal(Auth.current().id,'bob');
  Auth.setCurrent(null);
  assert.equal(Auth.current(),null);
  assert.equal(Auth.accounts().length,2);
});

test('match links are remembered through navigation and personal refs are ignored',()=>{
  const {Auth,storage}=loadAuth('#match=m1&ref=ann');
  assert.deepEqual({...Auth.newAccountBody({display_name:'Bob'})},{display_name:'Bob',invite_match_id:'m1'});
  const later=loadAuth('#games',storage);
  assert.deepEqual({...later.Auth.newAccountBody({})},{invite_match_id:'m1'});
});

test('latest match or invitation is the only attribution target',()=>{
  const {storage}=loadAuth('#invite=abcd');
  const next=loadAuth('#match=m2',storage);
  assert.deepEqual({...next.Auth.newAccountBody({})},{invite_match_id:'m2'});
  const final=loadAuth('#invite=wxyz',storage);
  assert.deepEqual({...final.Auth.newAccountBody({})},{invite_token:'wxyz'});
});

test('retired inviter state and cached account codes are purged without losing accounts',()=>{
  const storage=new Map([
    ['game-platform.invited-by.v1','ann'],
    ['game-platform.accounts.v1',JSON.stringify([{id:'ann',display_name:'Ann',password:'p',linked:[],referral_code:'48213'}])],
  ]);
  const {Auth}=loadAuth('#ref=ann',storage,'?ref=48213');
  assert.deepEqual({...Auth.newAccountBody({invited_by_user_id:'ann',display_name:'Bob'})},{display_name:'Bob'});
  assert.equal(storage.has('game-platform.invited-by.v1'),false);
  assert.equal(Auth.accounts()[0].id,'ann');
  assert.equal(Object.hasOwn(Auth.accounts()[0],'referral_code'),false);
  assert.equal(JSON.parse(storage.get('game-platform.accounts.v1'))[0].referral_code,undefined);
  assert.equal(Auth.inviteLink,undefined);
  assert.equal(Auth.setReferralCode,undefined);
});

test('logging in forgets the remembered match target',()=>{
  const {Auth,storage}=loadAuth('#match=m1');
  Auth.upsert({user_id:'bob',display_name:'Bob',password:'pw',linked_accounts:[]});
  assert.equal(storage.has('game-platform.invite-match.v1'),false);
  assert.deepEqual({...Auth.newAccountBody({})},{});
});

test('untrusted return URLs and known account credentials never become attribution',()=>{
  const storage=new Map([['game-platform.accounts.v1',JSON.stringify([{id:'ann',display_name:'Ann',password:'secret',linked:[]}])]]);
  const {Auth}=loadAuth('#match=secret',storage);
  assert.deepEqual({...Auth.newAccountBody({})},{});
  assert.deepEqual({...loadAuth('',new Map(),'?next='+encodeURIComponent('https://evil.test/portal#match=foreign')).Auth.newAccountBody({})},{});
});

for (const [where,hash,search,pathname,expected] of [
  ['on the portal','#invite=abcd','','/portal',{invite_token:'abcd'}],
  ['on the canonical invite page','','','/invite/abcd',{invite_token:'abcd'}],
  ['on an ordinary match link','#match=m1','','/portal',{invite_match_id:'m1'}],
  ['on the login return URL','','?next='+encodeURIComponent('/static/portal.html#invite=abcd'),'/',{invite_token:'abcd'}],
  ['on a match login return URL','','?next='+encodeURIComponent('/portal#match=m1'),'/',{invite_match_id:'m1'}],
])test(`signup payloads ${where} carry the match attribution`,async()=>{
  let sent;const storage=new Map();
  const ctx=vm.createContext({console,URL,URLSearchParams,CustomEvent:class{constructor(type){this.type=type;}},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    location:{hash,search,pathname,origin:'https://buildplay.fun'},
    window:{addEventListener(){}},document:{dispatchEvent(){}},el:()=>({}),I18n:{t:(key,params,fallback)=>fallback},
    apiRequest:async(method,pathname,{body})=>{sent={method,pathname,body};return {id:'u',display_name:'Bob',password:'pw'};}});
  vm.runInContext(storageSource+'\n'+AUTH_JS+'\nthis.Auth=Auth;',ctx);
  for (const body of [{id_token:'fake-google-token'}, {verification_id:'local-code',code:'123456'}])
    assert.deepEqual({...ctx.Auth.newAccountBody(body)},{...body,...expected});
  await ctx.Auth.createGuest('Bob');
  assert.equal(sent.pathname,'/users');
  assert.deepEqual({...sent.body},{display_name:'Bob',...expected});
});

test('static anonymous invite, signup and joined requests retain one visitor header across login',async()=>{
  const common=fs.readFileSync(path.join(__dirname,'../../static/common.js'),'utf8');
  const transport=common.slice(common.indexOf('const VISITOR_KEY ='),common.indexOf('const EXPERIMENT_CAMPAIGN_KEY ='));
  const calls=[],storage=new Map();
  const ctx=vm.createContext({console,URL,URLSearchParams,CustomEvent:class{constructor(type){this.type=type;}},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},
    location:{hash:'#invite=abcd',search:'',pathname:'/portal',origin:'https://buildplay.fun'},
    window:{addEventListener(){}},document:{dispatchEvent(){}},el:()=>({}),experimentCampaignCode:()=>null,
    fetch:async(path,init)=>{calls.push({path,...init});return {ok:true,status:200,text:async()=>JSON.stringify({id:'player',display_name:'Player',password:'synthetic-credential'})};}});
  vm.runInContext(storageSource+'\n'+transport+'\n'+AUTH_JS+'\nthis.Auth=Auth;',ctx);
  await ctx.apiRequest('GET','/invites/abcd');
  const response=await ctx.Auth.createGuest('Player');ctx.Auth.upsert(response);
  await ctx.apiRequest('POST','/invites/abcd/accept',{user:ctx.Auth.current()});
  const ids=calls.map(call=>call.headers['X-Visitor-Id']);assert.equal(new Set(ids).size,1);assert.match(ids[0],/^[A-Za-z0-9_-]{1,128}$/);assert.equal(storage.get('game-platform.visitor.v1'),ids[0]);assert.notEqual(ids[0],'synthetic-credential');
});
