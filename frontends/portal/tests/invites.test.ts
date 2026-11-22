import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalStore} from '../src/core';
import {matchInviteUrl, playerLink} from '../src/core/links';
import {rememberUrlAttribution, newAccountAttribution} from '../src/core/attribution';
import {notificationTarget} from '../src/core/notifications';
import {notificationData} from '../src/platform/notifications-shared';

const base='https://buildplay.fun';
test('canonical invite URLs work for browser history, universal links and custom scheme events',()=>{
  for(const raw of [`${base}/invite/abcd`,`${base}/invite/abcd/`,'buildplay://invite/abcd','buildplay:///invite/abcd'])assert.deepEqual(playerLink(raw,base),{kind:'invite',id:'abcd'},raw);
  assert.equal(matchInviteUrl('abcd',base),`${base}/invite/abcd`);
  assert.deepEqual(playerLink(`${base}/portal#match=match-id`,base),{kind:'match',id:'match-id'});
  for(const raw of [`${base}/invite/ABCd`,`${base}/invite/abc`,`${base}/invite/abcde`,`${base}/invite/abcd/extra`,'https://other.test/invite/abcd','https://user:password@buildplay.fun/invite/abcd','javascript:alert(1)'])assert.equal(playerLink(raw,base),null,raw);
  assert.equal(matchInviteUrl('Abcd',base),null);
  assert.deepEqual(playerLink(`${base}/i/legacy-token`,base),{kind:'invite',id:'legacy-token'});
});

test('retired Portal fragments return to games without overriding cold resume or URL validation',()=>{
  for(const fragment of ['settings','invites','removed-screen'])assert.deepEqual(playerLink(`${base}/portal#${fragment}`,base),{kind:'screen',id:'games'},fragment);
  for(const screen of ['games','matches','local'])assert.deepEqual(playerLink(`${base}/portal#${screen}`,base),{kind:'screen',id:screen},screen);
  for(const raw of [base,`${base}/portal`,`${base}/portal#`,`${base}/portal?utm_source=saved`])assert.equal(playerLink(raw,base),null,raw);
  for(const raw of [`${base}/admin#settings`,`${base}/invite/ABCd#settings`,'https://other.test/portal#settings','https://user:password@buildplay.fun/portal#settings','javascript:alert(1)#settings'])assert.equal(playerLink(raw,base),null,raw);
  assert.deepEqual(playerLink(`${base}/portal?invite=abcd#settings`,base),{kind:'invite',id:'abcd'});
  assert.deepEqual(playerLink(`${base}/portal#match=match-id`,base),{kind:'match',id:'match-id'});
});

test('short invite attribution survives navigation and supports notification taps',async()=>{
  const values=new Map<string,string>(),storage={async getItem(key:string){return values.get(key)??null;},async setItem(key:string,value:string){values.set(key,value);},async removeItem(key:string){values.delete(key);}};
  await rememberUrlAttribution(`${base}/invite/abcd`,base,[],storage);
  await rememberUrlAttribution(`${base}/portal#games`,base,[],storage);
  assert.deepEqual(await newAccountAttribution([],storage),{invite_token:'abcd'});
  assert.deepEqual(notificationTarget('/invite/abcd',base),{kind:'invite',id:'abcd'});
  assert.equal(notificationData({url:'/invite/abcd'},base,'viewer')?.url,`${base}/invite/abcd`);
});

async function fixture(signedIn=false,savedAccount=false){
  const values:Record<string,string>={};
  const storage={getItem:(key:string)=>values[key]??null,setItem:(key:string,value:string)=>{values[key]=String(value);},removeItem:(key:string)=>{delete values[key];}};
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage});
  if(signedIn||savedAccount){values['game-platform.accounts.v1']=JSON.stringify([{id:'viewer',password:'synthetic-password',display_name:'Viewer'}]);values['game-platform.current-account.v1']=signedIn?'viewer':'visitor';}
  const original=globalThis.fetch,calls:{method:string;url:URL;headers:Record<string,string>;body:any}[]=[];
  let shareFailure=false;
  let hold:(()=>Promise<void>)|null=null;
  const match={id:'invite-match',game_id:'bundled-tictactoe',game_version:1,owner_user_id:'host',status:'waiting_for_players',private:true,invite_code:'abcd',players:[{id:'host',user_id:'host',player_index:0,kind:'human'},{id:'opponent',user_id:'opponent',player_index:1,kind:'human'}],turn_of_player_indices:null,move_count:0,created_at:'2026-01-01T00:00:00Z'};
  globalThis.fetch=(async(input:string|URL|Request,init:RequestInit={})=>{
    const url=new URL(String(input)),method=init.method||'GET';calls.push({method,url,headers:init.headers as Record<string,string>,body:init.body?JSON.parse(init.body as string):undefined});if(shareFailure&&url.pathname.endsWith('/share'))throw new TypeError('Analytics offline');let response:any=[];
    if(url.pathname==='/storage/capabilities')response={pagination:true};
    else if(url.pathname==='/auth/config')response={};
    else if(url.pathname==='/i18n/locales')response={locales:[{code:'en',direction:'ltr'}]};
    else if(url.pathname.startsWith('/i18n/bundle/'))response={catalog:{messages:{}}};
    else if(url.pathname==='/invites/abcd'){if(hold)await hold();response={match,usable:false,token:'abcd'};}
    else if(url.pathname==='/invites/abcd/accept')response=match;
    else if(url.pathname==='/matches/invite-match')response=match;
    else if(url.pathname==='/v2/matches/invite-match/history')response={items:[],initial_state:null,initial_turn_player_indices:null,total:0,next_start:null};
    else if(url.pathname==='/users/viewer')response={id:'viewer',display_name:'Viewer',token_balance:0};
    else if(url.pathname.startsWith('/v2/')||url.pathname==='/users/me/notifications')response={items:[],next_cursor:null};
    return new Response(JSON.stringify(response),{status:200});
  }) as typeof fetch;
  const store=new PortalStore();await store.bootstrap(base);
  return {store,match,calls,failShare:()=>{shareFailure=true;},hold:(fn:()=>Promise<void>)=>{hold=fn;},restore:()=>{globalThis.fetch=original;}};
}

test('legacy audience flags do not restrict visitor polling or history after opening an invite',async()=>{
  const f=await fixture();try{
    await f.store.actions.openInvite('abcd');assert.equal(f.store.getSnapshot().selectedMatch?.id,f.match.id);
    assert.equal(f.calls.some(call=>call.method==='POST'&&call.url.pathname.endsWith('/accept')),false);
    await f.store.actions.refreshMatch();await f.store.actions.loadHistory();
    for(const call of f.calls.filter(call=>call.url.pathname.startsWith('/matches/invite-match')||call.url.pathname.startsWith('/v2/matches/invite-match')))assert.equal(call.url.searchParams.has('invite'),false);
    assert.equal(f.calls.some(call=>call.url.pathname==='/users/me/invites'),false);
  }finally{f.restore();}
});

test('accepting a full invitation preserves its spectator result without a redundant detail reload',async()=>{
  const f=await fixture(true);try{
    await f.store.actions.openInvite('abcd');f.calls.length=0;
    const result=await f.store.actions.acceptInvite('abcd');
    assert.equal(result.id,f.match.id);assert.equal(f.store.getSnapshot().selectedMatch?.players.length,2);
    assert.equal(f.store.getSnapshot().selectedMatch?.players.some(player=>player.user_id==='viewer'),false);
    assert.equal(f.calls.some(call=>call.url.pathname==='/matches/invite-match'),false);
  }finally{f.restore();}
});

test('an invite response arriving after navigation cannot reopen that match',async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  try{
    f.hold(async()=>{entered();await gate;});const opening=f.store.actions.openInvite('abcd');await started;
    f.store.actions.clearGame();release();assert.equal(await opening,null);assert.equal(f.store.getSnapshot().selectedMatch,null);
  }finally{release();f.restore();}
});


test('opening a match or invitation marks navigation without marking its polling requests',async()=>{
  const f=await fixture();try{
    await f.store.actions.selectMatch('invite-match');
    const opened=f.calls.find(call=>call.url.pathname==='/matches/invite-match');assert.equal(opened?.headers['X-Link-Open'],'1');
    f.calls.length=0;await f.store.actions.refreshMatch();const polled=f.calls.find(call=>call.url.pathname==='/matches/invite-match');assert.equal(polled?.headers['X-Link-Open'],undefined);
    await f.store.actions.openInvite('abcd');assert.equal(f.calls.find(call=>call.url.pathname==='/invites/abcd')?.headers['X-Link-Open'],'1');
  }finally{f.restore();}
});


test('share analytics sends only the channel and stays silent if the connection fails',async()=>{
  const f=await fixture(true);try{
    await f.store.actions.recordInviteShare('invite-match','copy_code');
    const sent=f.calls.find(call=>call.url.pathname==='/matches/invite-match/share');assert.deepEqual(sent?.body,{channel:'copy_code'});assert.equal(sent?.headers['X-User-Id'],'viewer');assert.ok(sent?.headers['X-Visitor-Id']);
    f.failShare();await f.store.actions.recordInviteShare('invite-match','share_link');assert.equal(f.store.getSnapshot().error,null);
  }finally{f.restore();}
});


test('saved-account login authenticates the opened ordinary match without recording a second navigation',async()=>{
  const f=await fixture(false,true);try{
    await f.store.actions.rememberAttribution(`${base}/portal#match=invite-match`);await f.store.actions.selectMatch('invite-match');
    await f.store.actions.switchAccount('viewer');
    const reads=f.calls.filter(call=>call.method==='GET'&&call.url.pathname==='/matches/invite-match');
    assert.equal(reads.filter(call=>call.headers['X-Link-Open']==='1').length,1);
    assert.equal(reads.at(-1)?.headers['X-User-Id'],'viewer');assert.equal(reads.at(-1)?.headers['X-Link-Open'],undefined);assert.equal(f.store.getSnapshot().selectedMatch?.id,'invite-match');
  }finally{f.restore();}
});
