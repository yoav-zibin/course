import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalStore} from '../src/core';
import type {InAppNotification, Match} from '../src/core/types';
import {handsTurnToOpponent, notificationTarget, pendingNotifications} from '../src/core/notifications';

const before: Match = {id:'m',game_id:'bundled-tictactoe',game_version:1,owner_user_id:'alice',status:'ongoing',state:{board:[]},players:[{id:'alice',user_id:'alice',player_index:0,kind:'human'},{id:'bob',user_id:'bob',player_index:1,kind:'human'}],turn_of_player_indices:[0],move_count:0,created_at:'2026-01-01T00:00:00Z'};
const after: Match = {...before,move_count:1,turn_of_player_indices:[1]};
const event = (id:string): InAppNotification => ({id,event:'invite_request',title:'Game',body:`Invite for ${id}`,url:`/i/invite-${id}`,match_id:`match-${id}`,created_at:'2026-01-01T00:00:00Z',read_at:null});

test('notification consent requires a confirmed handoff between different human players',()=>{
  assert.equal(handsTurnToOpponent(before,after,'alice'),true);
  for (const update of [{move_count:0},{localMode:'pass'},{turn_of_player_indices:[0]},{status:'over',turn_of_player_indices:null},{players:[before.players[0],{...before.players[1],kind:'computer' as const,user_id:null}]}]) assert.equal(handsTurnToOpponent(before,{...after,...update},'alice'),false,JSON.stringify(update));
  assert.equal(handsTurnToOpponent({...before,players:[before.players[0]]},after,'alice'),false);
  assert.equal(handsTurnToOpponent(before,after,'bob'),false);
  for(const match_kind of ['computer','pass_and_play'] as const) {
    assert.equal(handsTurnToOpponent({...before,match_kind},after,'alice'),false);
    assert.equal(handsTurnToOpponent(before,{...after,match_kind},'alice'),false);
  }
});

test('notification navigation accepts current server invitations/rematches and rejects foreign or non-player URLs',()=>{
  assert.deepEqual(notificationTarget('/i/secret-token','https://local.test'),{kind:'invite',id:'secret-token'});
  assert.deepEqual(notificationTarget('/static/portal.html#rematch=original','https://local.test'),{kind:'rematch',id:'original'});
  assert.deepEqual(notificationTarget('/portal#match=m','https://local.test'),{kind:'match',id:'m'});
  for(const raw of ['https://foreign.test/portal#match=m','//foreign.test/i/token','javascript:alert(1)','/admin#match=m','/i/%']) assert.equal(notificationTarget(raw,'https://local.test'),null,raw);
});

function browserStorage() {
  const values:Record<string,string>={};
  Object.defineProperties(values,{getItem:{value:(key:string)=>values[key]??null},setItem:{value:(key:string,value:string)=>{values[key]=String(value);}},removeItem:{value:(key:string)=>{delete values[key];}}});
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:values});
  values['game-platform.accounts.v1']=JSON.stringify(['alice','bob'].map(id=>({id,password:`${id}-secret`,display_name:id})));
  values['game-platform.current-account.v1']='alice';
}
async function fixture() {
  browserStorage(); const original=globalThis.fetch;
  let match={...before},failMove=false,retainTurn=false;
  let onFeed:((user:string,query:URLSearchParams)=>Promise<any>)|null=null;
  let onRead:((notificationId:string,user:string)=>Promise<any>)|null=null;
  const profiles:Record<string,any>=Object.fromEntries(['alice','bob'].map(id=>[id,{id,display_name:id,token_balance:0,notifications_enabled:true,notification_prompt_seen:false}]));
  const patches:any[]=[];
  globalThis.fetch=(async(input:RequestInfo|URL,init:RequestInit={})=>{
    const url=new URL(String(input)),method=init.method||'GET',headers=init.headers as Record<string,string>,id=headers?.['X-User-Id']||'alice';let value:any=[];
    if (url.pathname==='/i18n/locales') value={locales:[{code:'en',direction:'ltr'}]};
    else if(url.pathname.startsWith('/i18n/bundle/')) value={catalog:{messages:{}}};
    else if(url.pathname==='/storage/capabilities') value={pagination:false};
    else if(url.pathname==='/auth/config') value={};
    else if(url.pathname==='/matches/m/moves'&&method==='POST') {if(failMove)throw new TypeError('Connection lost');match={...match,move_count:match.move_count+1,turn_of_player_indices:retainTurn?[0]:[1]};value=match;}
    else if(url.pathname==='/matches/m') value=match;
    else if(url.pathname==='/matches') value=[match];
    else if(url.pathname==='/users/me/notifications') value=onFeed?await onFeed(id,url.searchParams):{items:[event(id)],next_cursor:null,unread_count:1};
    else if(url.pathname.endsWith('/read')) {const notificationId=decodeURIComponent(url.pathname.split('/').at(-2)!);value=onRead?await onRead(notificationId,id):{...event(notificationId),read_at:'2026-01-01T00:01:00Z',dismissed_notification_ids:[notificationId]};}
    else if(url.pathname===`/users/${id}`){if(method==='PATCH'){const patch=JSON.parse(String(init.body));patches.push(patch);Object.assign(profiles[id],patch);}value=profiles[id];}
    return new Response(JSON.stringify(value),{status:200});
  }) as typeof fetch;
  const store=new PortalStore();await store.bootstrap('https://local.test');await store.actions.selectMatch('m');
  return {store,profiles,patches,restore:()=>{globalThis.fetch=original;},setFailure:(value:boolean)=>{failMove=value;},setRetain:(value:boolean)=>{retainTurn=value;},setMatch:(value:Match)=>{match=value;},setFeed:(fn:(user:string,query:URLSearchParams)=>Promise<any>)=>{onFeed=fn;},setRead:(fn:(notificationId:string,user:string)=>Promise<any>)=>{onRead=fn;}};
}

test('refreshing a fully loaded inbox includes shifted entries and removes server-evicted history',async()=>{
  const f=await fixture(),feed=Array.from({length:100},(_,i)=>event(`notice-${i}`));
  try{
    f.setFeed(async(_id,query)=>{
      const cursor=query.get('cursor'),start=cursor?feed.findIndex(item=>item.id===cursor)+1:0;
      const items=feed.slice(start,start+Number(query.get('limit')));
      return {items,next_cursor:start+items.length<feed.length?items.at(-1)!.id:null,unread_count:feed.length};
    });
    await f.store.actions.refreshNotifications();await f.store.actions.refreshNotifications(true);
    assert.equal(f.store.getSnapshot().notifications.length,100);
    feed.unshift(event('newest'));feed.length=100;
    await f.store.actions.refreshNotifications();
    assert.deepEqual(f.store.getSnapshot().notifications.map(item=>item.id),feed.map(item=>item.id));
    assert.equal(f.store.getSnapshot().notificationCursor,null);
    assert.equal(f.store.getSnapshot().unreadNotifications,100);
  }finally{f.restore();}
});

test('the first confirmed multiplayer handoff prompts once and persists the account decision',async()=>{
  const f=await fixture();try{
    await f.store.actions.submitMove({cell:0});
    assert.equal(f.store.getSnapshot().notificationPrompt,true);
    assert.equal(f.profiles.alice.notification_prompt_seen,false);
    await f.store.actions.claimNotificationPrompt();
    assert.equal(f.store.getSnapshot().notificationPromptReady,true);
    assert.equal(f.profiles.alice.notification_prompt_seen,true);
    f.store.actions.dismissNotificationPrompt();
    f.setMatch({...before,move_count:2});await f.store.actions.refreshMatch();await f.store.actions.submitMove({cell:1});
    assert.equal(f.store.getSnapshot().notificationPrompt,false);
    assert.equal(f.patches.filter(patch=>patch.notification_prompt_seen).length,1);
  }finally{f.restore();}
});

test('an unconfirmed offline move does not prompt until the saved action is accepted',async()=>{
  const f=await fixture();try{
    f.setFailure(true);await f.store.actions.submitMove({cell:0});
    assert.equal(f.store.getSnapshot().notificationPrompt,false);assert.equal(f.store.getSnapshot().pending,1);
    f.setFailure(false);(f.store as any).retryAfter=0;await f.store.actions.refreshMatch();
    assert.equal(f.store.getSnapshot().notificationPrompt,true);assert.equal(f.store.getSnapshot().pending,0);
  }finally{f.restore();}
});

test('retaining the turn and an existing refusal do not offer consent again',async()=>{
  const f=await fixture();try{
    f.setRetain(true);await f.store.actions.submitMove({cell:0});assert.equal(f.store.getSnapshot().notificationPrompt,false);
    f.profiles.alice.notification_prompt_seen=true;f.setRetain(false);await f.store.actions.submitMove({cell:1});assert.equal(f.store.getSnapshot().notificationPrompt,false);
  }finally{f.restore();}
});

test('an old account inbox response cannot replace the selected account notifications',async()=>{
  const f=await fixture();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  try{
    f.setFeed(async id=>{if(id==='alice'){entered();await gate;}return {items:[event(id)],next_cursor:null,unread_count:1};});
    const old=assert.rejects(f.store.actions.refreshNotifications(),/Account changed/);await started;
    await f.store.actions.switchAccount('bob');release();await old;
    assert.equal(f.store.getSnapshot().account?.id,'bob');assert.deepEqual(f.store.getSnapshot().notifications.map(item=>item.id),['bob']);
    await f.store.actions.readNotification('bob');assert.equal(f.store.getSnapshot().unreadNotifications,0);assert.deepEqual(f.store.getSnapshot().notifications,[]);
  }finally{release();f.restore();}
});


test('an unavailable device can discard a prompt candidate without consuming the account prompt',async()=>{
  const f=await fixture();try{
    await f.store.actions.submitMove({cell:0});
    assert.equal(f.store.getSnapshot().notificationPromptReady,false);
    f.store.actions.dismissNotificationPrompt();
    assert.equal(f.profiles.alice.notification_prompt_seen,false);
    assert.equal(f.patches.length,0);
  }finally{f.restore();}
});

test('an older inbox poll cannot restore a consumed notification',async()=>{
  const f=await fixture();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  try{
    f.setFeed(async id=>{entered();await gate;return {items:[event(id)],next_cursor:null,unread_count:1};});
    const poll=f.store.actions.refreshNotifications();await started;
    await f.store.actions.readNotification('alice');release();await poll;
    assert.deepEqual(f.store.getSnapshot().notifications,[]);assert.equal(f.store.getSnapshot().unreadNotifications,0);
  }finally{release();f.restore();}
});

test('the inbox keeps only the latest unread update for a match across event types and legacy URLs',()=>{
  const old={...event('old'),match_id:'shared',created_at:'2026-01-01T00:00:00Z'};
  const latest={...event('latest'),event:'turn',match_id:'shared',created_at:'2026-01-01T00:01:00Z'};
  const read={...event('read'),read_at:'2026-01-01T00:02:00Z'};
  const legacyOld={...event('legacy-old'),match_id:undefined,url:'/portal#match=legacy'};
  const legacyNew={...event('legacy-new'),match_id:undefined,url:'/portal#rematch=legacy',created_at:'2026-01-01T00:02:00Z'};
  assert.deepEqual(pendingNotifications([old,read,legacyOld,latest,legacyNew],'https://local.test').map(item=>item.id),['legacy-new','latest']);
});

test('loading older pages does not duplicate a match or replace its latest update',async()=>{
  const f=await fixture(),latest={...event('latest'),match_id:'shared',created_at:'2026-01-01T00:02:00Z'},older={...event('older'),match_id:'shared'};
  try{
    f.setFeed(async(_id,query)=>query.get('cursor')?{items:[older,event('third')],next_cursor:null,unread_count:3}:{items:[latest,event('second')],next_cursor:'second',unread_count:3});
    await f.store.actions.refreshNotifications();await f.store.actions.refreshNotifications(true);
    assert.deepEqual(f.store.getSnapshot().notifications.map(item=>item.id),['latest','second','third']);
    assert.equal(f.store.getSnapshot().unreadNotifications,3);
  }finally{f.restore();}
});

test('acknowledging a match consumes its older snapshots but preserves a newer move with the same timestamp',async()=>{
  const f=await fixture(),old={...event('old'),match_id:'shared'},newer={...event('newer'),match_id:'shared'};
  let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),begin=new Promise<void>(resolve=>{started=resolve;});
  try{
    f.setFeed(async()=>({items:[old],next_cursor:null,unread_count:1}));await f.store.actions.refreshNotifications();
    f.setRead(async id=>{started();await gate;return {...old,id,read_at:'2026-01-01T00:01:00Z',dismissed_notification_ids:['old','older']};});
    const read=f.store.actions.readNotification('old');await begin;
    f.setFeed(async()=>({items:[newer,old],next_cursor:null,unread_count:1}));await f.store.actions.refreshNotifications();
    release();await read;
    assert.deepEqual(f.store.getSnapshot().notifications.map(item=>item.id),['newer']);assert.equal(f.store.getSnapshot().unreadNotifications,1);
    f.setFeed(async()=>({items:[{...old,id:'older'}],next_cursor:null,unread_count:1}));await f.store.actions.refreshNotifications();
    assert.deepEqual(f.store.getSnapshot().notifications,[]);assert.equal(f.store.getSnapshot().unreadNotifications,0);
  }finally{release();f.restore();}
});

test('a refused acknowledgement keeps the notification available to open again',async()=>{
  const f=await fixture();
  try{
    f.setRead(async()=>{throw new Error('Read failed');});
    await assert.rejects(f.store.actions.readNotification('alice'),/Read failed/);
    assert.deepEqual(f.store.getSnapshot().notifications.map(item=>item.id),['alice']);assert.equal(f.store.getSnapshot().unreadNotifications,1);
  }finally{f.restore();}
});

test('push taps can acknowledge a notification not loaded in the inbox',async()=>{
  const f=await fixture(),reads:string[]=[];
  try{
    f.setRead(async id=>{reads.push(id);return {...event(id),read_at:'2026-01-01T00:01:00Z',dismissed_notification_ids:[id]};});
    await f.store.actions.readNotification('from-push');
    assert.deepEqual(reads,['from-push']);assert.deepEqual(f.store.getSnapshot().notifications.map(item=>item.id),['alice']);
  }finally{f.restore();}
});

test('an acknowledgement from a previous account cannot dismiss the new account notification',async()=>{
  const f=await fixture();let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),begin=new Promise<void>(resolve=>{started=resolve;});
  try{
    f.setRead(async id=>{started();await gate;return {...event(id),read_at:'2026-01-01T00:01:00Z',dismissed_notification_ids:[id,'bob']};});
    const read=assert.rejects(f.store.actions.readNotification('alice'),/Account changed/);await begin;
    await f.store.actions.switchAccount('bob');release();await read;
    assert.deepEqual(f.store.getSnapshot().notifications.map(item=>item.id),['bob']);assert.equal(f.store.getSnapshot().unreadNotifications,1);
  }finally{release();f.restore();}
});
