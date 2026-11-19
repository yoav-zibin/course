import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PortalApi} from '../src/core/api';
import {diagnosticSnapshot,recordDiagnosticLog,recordDiagnosticEvent,recordDiagnosticPage,rememberDiagnosticSecrets,startDiagnosticRequest,diagnosticPath,setDiagnosticScope} from '../src/core/diagnostics';

test('flight recorder scrubs credentials including secrets learned after logging, URLs, and sensitive keys',()=>{
  recordDiagnosticLog('error','later-learned-password password=hidden Authorization: Bearer auth-hidden https://example.test/path?token=leaked#proof=secret');
  recordDiagnosticEvent('press',{authorization:'Bearer private',password:'also-private',label:'Saved'});
  rememberDiagnosticSecrets(['later-learned-password']);
  const report=JSON.stringify(diagnosticSnapshot({password:'context-secret',user:{id:'user-123'}}));
  for(const value of ['later-learned-password','auth-hidden','hidden','leaked','proof=secret','Bearer private','also-private','context-secret'])assert.ok(!report.includes(value),value);
  assert.ok(report.includes('user-123'));assert.equal(diagnosticPath('/invites/one-time-proof?x=secret'),'/invites/[redacted]');
});

test('recorder bounds memory and submission size, retaining recent errors and timing metadata',()=>{
  for(let i=0;i<240;i++){
    recordDiagnosticLog('error',`${i}: ${'界'.repeat(1400)}`);
    recordDiagnosticEvent('step',{i});recordDiagnosticPage({i});
    const complete=startDiagnosticRequest('GET',`/games/game-${i}?cursor=private`,{requestBytes:0});complete(200,{responseBytes:42});
  }
  const report=diagnosticSnapshot() as any;
  assert.ok(Buffer.byteLength(JSON.stringify(report))<160000);
  assert.ok(report.logs.length<=100);assert.ok(report.apiCalls.length<=70);assert.ok(report.events.length<=70);assert.ok(report.pages.length<=30);
  assert.ok(report.logs.at(-1).message.startsWith('239:'));
  assert.equal(report.apiCalls.at(-1).path,'/games/game-239');assert.equal(report.apiCalls.at(-1).status,200);assert.ok(report.apiCalls.at(-1).durationMs>=0);
});

test('oversized nested context terminates and remains inside the server byte limit',()=>{
  const leaf=Object.fromEntries(Array.from({length:35},(_,i)=>[`field${i}`,'界'.repeat(3000)]));
  const context=Object.fromEntries(Array.from({length:35},(_,i)=>[`group${i}`,leaf]));
  const result=diagnosticSnapshot(context);
  assert.ok(Buffer.byteLength(JSON.stringify(result))<160000);
});

test('API metadata includes failed calls and response sizes without bodies or passwords',async()=>{
  const api=new PortalApi('https://example.test',()=> 'en',async()=>new Response(JSON.stringify({detail:'Unavailable'}),{status:503,headers:{'x-request-id':'trace-123'}}));
  await assert.rejects(api.request('POST','/test',{privateBody:'never-copy-this'},{id:'user',password:'request-password',display_name:'Guest'}));
  const report=diagnosticSnapshot() as any;const call=report.apiCalls.at(-1);
  assert.equal(call.status,503);assert.equal(call.requestId,'trace-123');assert.ok(call.responseBytes>0);assert.ok(!JSON.stringify(report).includes('never-copy-this'));assert.ok(!JSON.stringify(report).includes('request-password'));
  const unavailable=new PortalApi('',()=> 'en',async()=>{throw new TypeError('Network request failed');});
  await assert.rejects(unavailable.request('GET','/test'));
  assert.equal((diagnosticSnapshot() as any).apiCalls.at(-1).state,'failed');
});

test('switching accounts or API origins removes earlier diagnostics and pending calls while retaining redaction',()=>{
  setDiagnosticScope('origin-one:alice');
  rememberDiagnosticSecrets(['old-account-credential']);
  recordDiagnosticLog('error','private Alice activity');
  recordDiagnosticPage({matchId:'alice-private-match'});
  recordDiagnosticEvent('private_alice_event');
  const finish=startDiagnosticRequest('GET','/matches/alice-private-match');
  const first=diagnosticSnapshot();
  setDiagnosticScope('origin-one:bob');
  finish(200);
  let next=diagnosticSnapshot() as any;
  assert.notEqual(next.sessionId,first.sessionId);
  assert.deepEqual([next.logs,next.pages,next.events,next.apiCalls],[[],[],[],[]]);
  recordDiagnosticLog('error','old-account-credential');
  setDiagnosticScope('origin-one:bob');
  assert.equal((diagnosticSnapshot() as any).logs.length,1);
  assert.ok(!JSON.stringify(diagnosticSnapshot()).includes('old-account-credential'));
  setDiagnosticScope('origin-two:bob');
  next=diagnosticSnapshot() as any;
  assert.deepEqual([next.logs,next.pages,next.events,next.apiCalls],[[],[],[],[]]);
});
