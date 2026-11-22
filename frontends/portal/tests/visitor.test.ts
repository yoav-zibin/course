import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalApi} from '../src/core/api';
import {VISITOR_KEY} from '../src/core/visitor';
function storage(initial:Record<string,string>={}){const values=new Map(Object.entries(initial));Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});return values;}
test('anonymous views, signup and authenticated join share one credential-independent visitor ID',async()=>{
  const values=storage(),calls:Record<string,string>[]=[];
  const api=new PortalApi('https://local.test',()=> 'en',(async(_input,init)=>{calls.push(init!.headers as Record<string,string>);return new Response('{}',{status:200});}) as typeof fetch);
  await api.request('GET','/invites/abcd');await api.request('POST','/users',{display_name:'Player',invite_token:'abcd'});await api.request('POST','/invites/abcd/accept',undefined,{id:'player',password:'account-credential',display_name:'Player'});
  const ids=calls.map(headers=>headers['X-Visitor-Id']);assert.equal(new Set(ids).size,1);assert.match(ids[0],/^[A-Za-z0-9_-]{1,128}$/);assert.equal(ids[0],values.get(VISITOR_KEY));assert.notEqual(ids[0],'account-credential');
  const restarted=new PortalApi('https://local.test',()=> 'en',api.fetcher);await restarted.request('GET','/matches/shared');assert.equal(calls.at(-1)!['X-Visitor-Id'],ids[0]);
});
test('concurrent requests allocate one visitor ID and invalid cached IDs are replaced',async()=>{
  const values=storage({[VISITOR_KEY]:'invalid\r\nheader'}),ids:string[]=[];const api=new PortalApi('https://local.test',()=> 'en',(async(_input,init)=>{ids.push((init!.headers as Record<string,string>)['X-Visitor-Id']);return new Response('{}',{status:200});}) as typeof fetch);
  await Promise.all([api.request('GET','/health'),api.request('GET','/games')]);assert.equal(new Set(ids).size,1);assert.match(values.get(VISITOR_KEY)!,/^[A-Za-z0-9_-]{1,128}$/);
});
test('denied storage preserves a visitor ID for the current session without blocking requests',async()=>{
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}}});const ids:string[]=[];const api=new PortalApi('https://local.test',()=> 'en',(async(_input,init)=>{ids.push((init!.headers as Record<string,string>)['X-Visitor-Id']);return new Response('{}',{status:200});}) as typeof fetch);
  await api.request('GET','/health');await api.request('GET','/games');assert.equal(ids[0],ids[1]);assert.match(ids[0],/^[A-Za-z0-9_-]{1,128}$/);
});


test('explicit link navigation carries an open marker while subsequent polling does not',async()=>{
  storage();const calls:Record<string,string>[]=[];const api=new PortalApi('https://local.test',()=> 'en',(async(_input,init)=>{calls.push(init!.headers as Record<string,string>);return new Response('{}',{status:200});}) as typeof fetch);
  await api.request('GET','/matches/shared',undefined,null,undefined,true);await api.request('GET','/matches/shared');
  assert.equal(calls[0]['X-Link-Open'],'1');assert.equal(calls[1]['X-Link-Open'],undefined);assert.equal(calls[0]['X-Visitor-Id'],calls[1]['X-Visitor-Id']);
});
