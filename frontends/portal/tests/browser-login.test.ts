import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginSession, callbackCode } from '../src/platform/browser-login-protocol';
const session='s'.repeat(43), code='c'.repeat(43);
test('native login opens only the exact configured server portal session',()=>{
  const loginUrl=`https://buildplay.fun/portal#app-login=${session}`;
  assert.deepEqual(loginSession('https://buildplay.fun',{session_id:session,login_url:loginUrl}),{sessionId:session,loginUrl});
  for(const target of [`https://evil.test/portal#app-login=${session}`,`https://buildplay.fun.evil.test/portal#app-login=${session}`,`https://buildplay.fun/elsewhere#app-login=${session}`,`https://buildplay.fun/portal#app-login=${'x'.repeat(43)}`,`https://buildplay.fun/portal?redirect=evil#app-login=${session}`,`https://attacker@buildplay.fun/portal#app-login=${session}`])assert.throws(()=>loginSession('https://buildplay.fun',{session_id:session,login_url:target}));
});
test('callback must deliver a fresh authorization code for the exact initiating session',()=>{
  assert.equal(callbackCode(session,`buildplay://auth?session=${session}&code=${code}`),code);
  for(const callback of [`buildplay://auth?session=${session}`,`buildplay://auth?session=${session}&code=short`,`buildplay://auth?session=${'x'.repeat(43)}&code=${code}`,`https://buildplay.fun/auth?session=${session}&code=${code}`,`buildplay://attacker@auth?session=${session}&code=${code}`,`buildplay://auth?session=${session}&code=${code}&code=${code}`,`buildplay://auth?session=${session}&code=${code}&verifier=never-in-url`])assert.throws(()=>callbackCode(session,callback));
});
test('invalid URL diagnostics never echo callback secrets',()=>{
  try{callbackCode(session,`invalid callback ${code}`);assert.fail('must reject');}catch(error){assert.doesNotMatch(String(error),new RegExp(code));}
});
