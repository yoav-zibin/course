import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReporter} from '../src/core/reporting';
test('diagnostic reports redact remembered credentials and URL secrets and carry no auth headers',async()=>{
  const requests:any[]=[];const report=createReporter('https://example.test',()=>['old-password','current-password'],async(...args)=>{requests.push(args);});
  report('script_error',new Error('old-password current-password token=provider-token https://example.test/path?code=proof#password=hidden'));
  await new Promise(resolve=>setImmediate(resolve));
  const [url,request]=requests[0];assert.equal(url,'https://example.test/client-errors');assert.deepEqual(request.headers,{'Content-Type':'application/json'});
  const body=JSON.parse(request.body);for(const secret of ['old-password','current-password','provider-token','proof','hidden'])assert.ok(!body.message.includes(secret));assert.equal(body.page,'/portal');
});
test('diagnostics deduplicate and cap requests and never throw on network failure',async()=>{
  let calls=0;const report=createReporter('',()=>[],async()=>{calls++;throw new Error('offline');});
  for(let index=0;index<10;index++){report('script_error','failure '+index);report('script_error','failure '+index);}
  report('invalid-kind','failure');await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,5);
});
