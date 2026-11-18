import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rememberUrlAttribution,newAccountAttribution,readCampaignCode,forgetInviter,INVITER_KEY,INVITE_KEY,CAMPAIGN_KEY} from '../src/core/attribution';
import {PortalApi} from '../src/core/api';
function memory(){const values=new Map<string,string>();return {values,async getItem(key:string){return values.get(key)??null;},async setItem(key:string,value:string){values.set(key,value);},async removeItem(key:string){values.delete(key);}};}
const base='https://buildplay.fun';
test('first referral and campaign survive navigation while the opened invitation updates',async()=>{
  const store=memory();await rememberUrlAttribution(`${base}/portal?ref=12345&campaign=class-a#invite=first-token`,base,[],store);
  await rememberUrlAttribution(`${base}/portal?campaign=class-b#ref=67890&invite=second-token`,base,[],store);await rememberUrlAttribution(`${base}/portal#games`,base,[],store);
  assert.equal(store.values.get(INVITER_KEY),'12345');assert.equal(await readCampaignCode(store),'class-a');assert.deepEqual(await newAccountAttribution([],store),{invited_by_user_id:'12345',invite_token:'second-token'});
  await forgetInviter(store);assert.deepEqual(await newAccountAttribution([],store),{});assert.equal(await readCampaignCode(store),'class-a');
});
test('own account IDs/referral codes and known credentials are never remembered as attribution',async()=>{
  const store=memory(),accounts=[{id:'alice',display_name:'Alice',password:'known-password',referral_code:'12345'}];
  for(const ref of ['alice','12345','known-password'])await rememberUrlAttribution(`${base}/portal?ref=${ref}`,base,accounts,store);
  await rememberUrlAttribution(`${base}/portal?campaign=known-password#invite=known-password`,base,accounts,store);assert.equal(store.values.size,0);
  await rememberUrlAttribution(`${base}/portal?ref=another-user`,base,accounts,store);await rememberUrlAttribution(`${base}/portal#ref=alice`,base,accounts,store);assert.equal(store.values.get(INVITER_KEY),'another-user');
});
test('only bounded typed values from this server or the app scheme are accepted',async()=>{
  for(const url of [`https://evil.test/portal?campaign=evil&ref=12345`,`https://user:password@buildplay.fun/portal?campaign=evil`,`javascript:alert(1)`,`${base}/portal?campaign=BadCampaign&ref=with%0Acontrol#invite=with%20spaces`,`${base}/portal?campaign=${'x'.repeat(51)}`]){const store=memory();await rememberUrlAttribution(url,base,[],store);assert.equal(store.values.size,0,url);}
  const store=memory();await rememberUrlAttribution('buildplay://portal?campaign=class-native#ref=12345&invite=native-token',base,[],store);assert.equal(await readCampaignCode(store),'class-native');assert.deepEqual(await newAccountAttribution([],store),{invited_by_user_id:'12345',invite_token:'native-token'});
});
test('legacy login return URLs preserve only same-server invitation tokens',async()=>{
  const store=memory();await rememberUrlAttribution(`${base}/?${new URLSearchParams({next:'/static/portal.html#invite=old-token'})}`,base,[],store);assert.equal(store.values.get(INVITE_KEY),'old-token');
  const foreign=memory();await rememberUrlAttribution(`${base}/?${new URLSearchParams({next:'https://evil.test/portal#invite=foreign-token'})}`,base,[],foreign);assert.equal(foreign.values.size,0);
});
test('unavailable storage leaves attribution optional and never blocks authentication',async()=>{
  const denied={async getItem(_key:string):Promise<string|null>{throw new Error('denied');},async setItem(_key:string,_value:string){throw new Error('denied');},async removeItem(_key:string){throw new Error('denied');}};
  await rememberUrlAttribution(`${base}/portal?campaign=class-a&ref=12345`,base,[],denied);assert.deepEqual(await newAccountAttribution([],denied),{});assert.equal(await readCampaignCode(denied),null);await forgetInviter(denied);
});
test('transport sends only a validated campaign header and never copies credential URL fields',async()=>{
  const store=memory();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.values.get(key)??null,setItem:(key:string,value:string)=>store.values.set(key,value),removeItem:(key:string)=>store.values.delete(key)}});
  const headers:Record<string,string>[]=[];const api=new PortalApi(base,()=> 'en',(async(_url:string|URL|Request,init:RequestInit)=>{headers.push(init.headers as Record<string,string>);return new Response('{}',{status:200});}) as typeof fetch);
  store.values.set(CAMPAIGN_KEY,'class-a');await api.request('GET','/health');assert.equal(headers.at(-1)!['X-Campaign-Code'],'class-a');
  store.values.set(CAMPAIGN_KEY,'class-a\r\nX-User-Password: injected');await api.request('GET','/health');assert.equal(headers.at(-1)!['X-Campaign-Code'],undefined);
  store.values.set(CAMPAIGN_KEY,'known-password');await api.request('GET','/health',undefined,{id:'alice',display_name:'Alice',password:'known-password'});assert.equal(headers.at(-1)!['X-Campaign-Code'],undefined);
});
