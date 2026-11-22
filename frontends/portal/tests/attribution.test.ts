import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rememberUrlAttribution,newAccountAttribution,readCampaignCode,forgetMatchAttribution,INVITE_KEY,MATCH_KEY,CAMPAIGN_KEY} from '../src/core/attribution';
import {PortalApi} from '../src/core/api';
function memory(){const values=new Map<string,string>();return {values,async getItem(key:string){return values.get(key)??null;},async setItem(key:string,value:string){values.set(key,value);},async removeItem(key:string){values.delete(key);}};}
const base='https://buildplay.fun';
test('latest match or invitation replaces the previous target while the first campaign survives navigation',async()=>{
  const store=memory();await rememberUrlAttribution(`${base}/portal?campaign=class-a#invite=first-token`,base,[],store);
  await rememberUrlAttribution(`${base}/portal?campaign=class-b#match=second-match`,base,[],store);await rememberUrlAttribution(`${base}/portal#games`,base,[],store);
  assert.equal(store.values.get(INVITE_KEY),undefined);assert.equal(store.values.get(MATCH_KEY),'second-match');assert.equal(await readCampaignCode(store),'class-a');assert.deepEqual(await newAccountAttribution([],store),{invite_match_id:'second-match'});
  await rememberUrlAttribution(`${base}/invite/abcd`,base,[],store);assert.equal(store.values.get(MATCH_KEY),undefined);assert.deepEqual(await newAccountAttribution([],store),{invite_token:'abcd'});
  await forgetMatchAttribution(store);assert.deepEqual(await newAccountAttribution([],store),{});assert.equal(await readCampaignCode(store),'class-a');
});
test('retired personal referrals are ignored and old attribution is purged',async()=>{
  const store=memory();store.values.set('game-platform.invited-by.v1','alice');
  await rememberUrlAttribution(`${base}/portal?ref=12345#ref=another-user`,base,[],store);
  assert.equal(store.values.has('game-platform.invited-by.v1'),false);assert.deepEqual(await newAccountAttribution([],store),{});
});
test('known credentials are never remembered or sent as attribution',async()=>{
  const store=memory(),accounts=[{id:'alice',display_name:'Alice',password:'known-password'}];
  await rememberUrlAttribution(`${base}/portal?campaign=known-password#invite=known-password`,base,accounts,store);assert.equal(store.values.size,0);
  await rememberUrlAttribution(`${base}/portal#match=known-password`,base,accounts,store);assert.deepEqual(await newAccountAttribution(accounts,store),{});
});
test('only bounded typed values from this server or the app scheme are accepted',async()=>{
  for(const url of [`https://evil.test/portal?campaign=evil#match=outside`,`https://user:password@buildplay.fun/portal?campaign=evil`,`javascript:alert(1)`,`${base}/portal?campaign=BadCampaign#invite=with%20spaces`,`${base}/portal?campaign=${'x'.repeat(51)}`]){const store=memory();await rememberUrlAttribution(url,base,[],store);assert.equal(store.values.size,0,url);}
  const store=memory();await rememberUrlAttribution('buildplay://portal?campaign=class-native#match=native-match',base,[],store);assert.equal(await readCampaignCode(store),'class-native');assert.deepEqual(await newAccountAttribution([],store),{invite_match_id:'native-match'});
});
test('login return URLs preserve only same-server match and invitation targets',async()=>{
  for(const [next,expected] of [['/static/portal.html#invite=old-token',{invite_token:'old-token'}],['/portal#match=shared-match',{invite_match_id:'shared-match'}]] as const){const store=memory();await rememberUrlAttribution(`${base}/?${new URLSearchParams({next})}`,base,[],store);assert.deepEqual(await newAccountAttribution([],store),expected);}
  const foreign=memory();await rememberUrlAttribution(`${base}/?${new URLSearchParams({next:'https://evil.test/portal#invite=foreign-token'})}`,base,[],foreign);assert.equal(foreign.values.size,0);
});
test('unavailable storage leaves attribution optional and never blocks authentication',async()=>{
  const denied={async getItem(_key:string):Promise<string|null>{throw new Error('denied');},async setItem(_key:string,_value:string){throw new Error('denied');},async removeItem(_key:string){throw new Error('denied');}};
  await rememberUrlAttribution(`${base}/portal?campaign=class-a#match=shared-match`,base,[],denied);assert.deepEqual(await newAccountAttribution([],denied),{});assert.equal(await readCampaignCode(denied),null);await forgetMatchAttribution(denied);
});
test('transport sends only a validated campaign header and never copies credential URL fields',async()=>{
  const store=memory();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.values.get(key)??null,setItem:(key:string,value:string)=>store.values.set(key,value),removeItem:(key:string)=>store.values.delete(key)}});
  const headers:Record<string,string>[]=[];const api=new PortalApi(base,()=> 'en',(async(_url:string|URL|Request,init:RequestInit)=>{headers.push(init.headers as Record<string,string>);return new Response('{}',{status:200});}) as typeof fetch);
  store.values.set(CAMPAIGN_KEY,'class-a');await api.request('GET','/health');assert.equal(headers.at(-1)!['X-Campaign-Code'],'class-a');
  store.values.set(CAMPAIGN_KEY,'class-a\r\nX-User-Password: injected');await api.request('GET','/health');assert.equal(headers.at(-1)!['X-Campaign-Code'],undefined);
  store.values.set(CAMPAIGN_KEY,'known-password');await api.request('GET','/health',undefined,{id:'alice',display_name:'Alice',password:'known-password'});assert.equal(headers.at(-1)!['X-Campaign-Code'],undefined);
});
