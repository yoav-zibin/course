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

test('unexpected errors silently create bounded automatic reports with current identity and redacted evidence',async()=>{
  const requests:any[]=[];
  let account:{id:string;password:string}|null={id:'first-user',password:'fixture-current-password'};
  const jwt='eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlLXN1YmplY3QifQ.signature';
  const report=createReporter('https://example.test',()=>['fixture-current-password'],async(...args)=>{requests.push(args);},
    {account:()=>account,context:()=>({screen:'match'})});
  const error=new Error(`Unexpected fixture-current-password Authorization: Basic fixture-basic ${jwt}`);
  report('script_error',error);report('script_error',error);
  account={id:'second-user',password:'fixture-next-password'};
  report('render_error','another render failure');
  report('storage_error','a recoverable cache problem');
  await new Promise(resolve=>setImmediate(resolve));
  const automatic=requests.filter(([url])=>url.endsWith('/bug-reports'));
  assert.equal(automatic.length,2,'duplicates and handled cache errors do not create reports');
  assert.equal(automatic[0][1].headers['X-User-Id'],'first-user');
  assert.equal(automatic[1][1].headers['X-User-Id'],'second-user');
  for(const [,request] of automatic){
    const body=JSON.parse(request.body);
    assert.equal(body.automatic,true);assert.equal(body.screenshot,null);
    assert.equal(body.diagnostics.context.screen,'match');
    assert.ok(body.diagnostics.automatic_error.kind);
    for(const secret of ['fixture-current-password','fixture-basic',jwt])assert.ok(!request.body.includes(secret));
  }
});

test('automatic report failures are swallowed without retrying or opening a user flow',async()=>{
  let calls=0;
  const report=createReporter('',()=>[],async()=>{calls++;throw new Error('offline');},{account:()=>null});
  for(let index=0;index<10;index++)report('unhandled_rejection',`failure ${index}`);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,10,'at most five telemetry events and five automatic uploads');
});
