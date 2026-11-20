import {test,expect} from '@playwright/test';
import {createUser} from './helpers';
import {seedAccounts,verifiedSignInFixtures} from './auth-fixtures';

test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Authentication acceptance uses only a disposable loopback server.');});

test('signed-out players see the verified bonus and can still create a zero-token Guest',async({page,request})=>{
  await verifiedSignInFixtures(page,[]);await page.goto('/portal');await page.getByRole('button',{name:'Log in',exact:true}).first().click();
  await expect(page.getByTestId('verified-login-bonus')).toContainText('100 free tokens total');
  await expect(page.getByRole('button',{name:'Test Google sign-in',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Continue with: Guest',exact:true}).click();
  await page.getByRole('textbox',{name:/Your name|Display name/}).fill('Auth Guest fixture');
  const created=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/users');
  await page.getByRole('button',{name:'Continue as guest',exact:true}).click();const user=await(await created).json();
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription('Auth Guest fixture');
  const profile=await request.get(`/users/${user.id}`,{headers:{'X-User-Id':user.id,'X-User-Password':user.password}});expect((await profile.json()).token_balance).toBe(0);
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue with: Guest',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Account to use: Use another account',exact:true})).toHaveCount(0);
});

for(const method of ['email','phone'] as const)test(`linking ${method} confirms first, stays on the same account, and shows the verified balance`,async({page,request},info)=>{
  const user=await createUser(request,`Auth ${method} fixture`);await seedAccounts(page,[user]);await verifiedSignInFixtures(page,[user]);
  let balance=0;const authCalls:{path:string;caller:string|undefined}[]=[];
  page.on('request',request=>{if(/^\/auth\/(email|phone)\/(start|verify)$/.test(new URL(request.url()).pathname))authCalls.push({path:new URL(request.url()).pathname,caller:request.headers()['x-user-id']});});
  await page.route(`**/users/${user.id}`,async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),token_balance:balance,is_verified:balance>0,free_tokens_granted:balance>0?10:0,last_token_grant_day:balance>0?new Date().toISOString().slice(0,10):null}});});
  await page.route(`**/auth/${method}/start`,route=>route.fulfill({json:{verification_id:'fixture-verification'}}));
  await page.route(`**/auth/${method}/verify`,route=>{balance=10;return route.fulfill({json:{...user,user_id:user.id,token_balance:balance,is_verified:true,free_tokens_granted:10,last_token_grant_day:new Date().toISOString().slice(0,10),linked_accounts:[{kind:method}]}});});
  await page.goto('/portal');await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue with: Guest',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Link a verified login',exact:true}).click();
  await expect(page.getByTestId('confirm-login-link')).toContainText('same BuildPlay account');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(authCalls).toEqual([]);
  expect(await page.evaluate(()=>(window as any).__testGoogle.callbacks.length)).toBe(0);
  for(let attempt=0;attempt<2;attempt++){
    await page.getByRole('button',{name:'Link a verified login',exact:true}).click();await page.getByRole('button',{name:'Confirm link',exact:true}).click();
    await expect(page.getByRole('button',{name:'Continue with: Guest',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Continue as guest',exact:true})).toHaveCount(0);
    const label=method==='email'?'Email':'Phone number';
    await page.getByRole('button',{name:`Continue with: ${label}`,exact:true}).click();
    await page.getByRole('textbox',{name:label,exact:true}).fill(method==='email'?'player@example.test':'+15555550123');
    await page.getByRole('button',{name:'Send code',exact:true}).click();
    await page.getByLabel('Verification code',{exact:true}).fill('123456');
    await page.getByRole('button',{name:'Verify',exact:true}).click();
    await expect(page.getByRole('button',{name:'Confirm link',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(user.display_name);
    await expect(page.getByTestId('header-token-balance')).toHaveAttribute('aria-label','10 tokens');
    expect(authCalls.filter(call=>call.path.endsWith('/verify')).at(-1)?.caller).toBe(user.id);
    await page.getByRole('button',{name:'Account menu',exact:true}).click();
    await expect(page.getByRole('heading',{name:user.display_name,exact:true})).toBeVisible();
  }
  await page.screenshot({path:info.outputPath(`linked-${method}-same-account.png`)});
});

test('verified-account Google linking requires confirmation, ignores closed callbacks, and links the current account',async({page,request})=>{
  const user=await createUser(request,'Verified auth fixture');user.linked=[{kind:'email'}];await seedAccounts(page,[user]);await verifiedSignInFixtures(page,[user]);
  const requests:{caller:string|undefined;body:any}[]=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/auth/google')requests.push({caller:request.headers()['x-user-id'],body:request.postDataJSON()});});
  await page.goto('/portal');await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await page.getByRole('button',{name:'Link a verified login',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(requests).toHaveLength(0);
  expect(await page.evaluate(()=>(window as any).__testGoogle.callbacks.length)).toBe(0);
  await page.getByRole('button',{name:'Link a verified login',exact:true}).click();await page.getByRole('button',{name:'Confirm link',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue with: Guest',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Continue as guest',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Test Google sign-in',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.evaluate(id=>(window as any).__testGoogle.callbacks[0]({credential:id}),user.id);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(requests).toHaveLength(0);
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(user.display_name);
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await expect(page.getByRole('button',{name:'Test Google sign-in',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Link a verified login',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Link a verified login',exact:true}).click();await page.getByRole('button',{name:'Confirm link',exact:true}).click();
  await page.evaluate(id=>{(window as any).__testGoogle.token=id;},user.id);
  await page.getByRole('button',{name:'Test Google sign-in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Test Google sign-in',exact:true})).toHaveCount(0);
  expect(requests).toEqual([{caller:user.id,body:{id_token:user.id}}]);
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(user.display_name);
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await expect(page.getByRole('heading',{name:user.display_name,exact:true})).toBeVisible();
});

test('switching saved accounts requires logout and explicit signed-out state survives reload',async({page,request})=>{
  const alice=await createUser(request,'Logout Alice fixture'),bob=await createUser(request,'Saved Bob fixture');
  await seedAccounts(page,[alice,bob]);await verifiedSignInFixtures(page,[alice,bob]);await page.goto('/portal');
  await page.getByRole('button',{name:'Account menu',exact:true}).click();
  await expect(page.getByRole('button',{name:`Sign in as ${bob.display_name}`,exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Log out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Log in',exact:true}).first()).toBeVisible();
  await page.reload();await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Log in',exact:true}).first().click();
  await expect(page.getByRole('button',{name:`Sign in as ${bob.display_name}`,exact:true})).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('game-platform.accounts.v1')!).map((item:any)=>item.id))).toEqual([bob.id]);
  expect(await page.evaluate(()=>localStorage.getItem('game-platform.current-account.v1'))).toBe('visitor');
  await page.getByRole('button',{name:`Sign in as ${bob.display_name}`,exact:true}).click();
  await expect(page.getByRole('button',{name:'Account menu',exact:true})).toHaveAccessibleDescription(bob.display_name);
  await page.getByRole('button',{name:'Account menu',exact:true}).click();await expect(page.getByRole('heading',{name:bob.display_name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:`Sign in as ${alice.display_name}`,exact:true})).toHaveCount(0);
});
