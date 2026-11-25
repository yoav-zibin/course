import {test,expect,type Page,type APIRequestContext} from '@playwright/test';
import {createUser,E2E_ADMIN_HEADERS,loginAdmin,uniqueName} from './helpers';

declare const Auth:any;
const currentKey='game-platform.current-account.v1',accountsKey='game-platform.accounts.v1';
async function fixture(page:Page,request:APIRequestContext){
  const alice={...await createUser(request,uniqueName('Legacy Alice')),linked:[]};
  const bob={...await createUser(request,uniqueName('Legacy Bob')),linked:[]};
  await page.setExtraHTTPHeaders(E2E_ADMIN_HEADERS);
  await loginAdmin(page);
  await page.addInitScript(({alice,bob,currentKey,accountsKey})=>{
    if(!sessionStorage.getItem('legacy-auth-fixture-seeded')){
      localStorage.setItem(accountsKey,JSON.stringify([alice,bob]));localStorage.setItem(currentKey,alice.id);
      localStorage.setItem('legacy-auth-retained-local-data','disposable local save');
      sessionStorage.setItem('legacy-auth-fixture-seeded','1');
    }
    const callbacks:any[]=[];(window as any).__legacyGoogleCallbacks=callbacks;
    (window as any).google={accounts:{id:{
      initialize(options:any){callbacks.push(options.callback);},
      renderButton(holder:HTMLElement){const button=document.createElement('button');button.textContent='Synthetic verified provider';holder.append(button);},
    }}};
  },{alice,bob,currentKey,accountsKey});
  let configs=0,verifiedRequests=0;
  await page.route('**/auth/config',route=>{configs++;return route.fulfill({json:{google_client_id:'synthetic-client',email_login_enabled:true,phone_login_enabled:true,phone_call_enabled:false}});});
  await page.route('**/auth/google',route=>{verifiedRequests++;return route.fulfill({json:{user_id:alice.id,password:alice.password,display_name:alice.display_name,linked_accounts:[{kind:'google',identifier:'synthetic-provider'}]}});});
  // Keep the player-menu checks on an exempt login-page fixture. The admin
  // hub now shows its Google session; console pages redirect signed-out players.
  await page.route('**/static/welcome.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/common.css?v=22"><link rel="stylesheet" href="/static/site-bug-report.css?v=2"><script src="/static/site-bug-report.js?v=2"></script></head><body><header class="topbar"><h1>BuildPlay</h1><span class="spacer"></span><span id="account-menu"></span></header><script src="/static/common.js?v=41"></script><script src="/static/i18n.js?v=10"></script><script src="/static/auth.js?v=30"></script><script>(()=>{const menu=document.getElementById('account-menu'),render=()=>Auth.renderMenu(menu);render();document.addEventListener('auth-changed',render);})();</script></body></html>`}));
  await page.goto('/static/welcome.html');await expect(page.locator('.auth-menu-button')).toBeVisible();
  return {alice,bob,configs:()=>configs,verifiedRequests:()=>verifiedRequests};
}

test.beforeEach(async({baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Legacy auth checks require a disposable loopback server.');
});

test('signed-in legacy menus offer linking and keep the current account when forgetting another login',async({page,request})=>{
  const {alice,bob}=await fixture(page,request);
  await page.locator('.auth-menu-button').click();
  await expect(page.locator('[data-auth-action="link"]')).toBeVisible();
  await expect(page.locator('[data-auth-action="invite"]')).toHaveCount(0);
  await expect(page.locator('[data-auth-action="logout"]')).toBeVisible();
  await expect(page.locator('[data-auth-action^="switch:"]')).toHaveCount(0);
  await expect(page.locator('[data-auth-action="login"]')).toHaveCount(0);
  await page.evaluate(id=>Auth.remove(id),bob.id);
  expect(await page.evaluate(()=>Auth.current()?.id)).toBe(alice.id);
  expect(await page.evaluate(key=>localStorage.getItem(key),currentKey)).toBe(alice.id);
  expect(await page.evaluate(()=>Auth.accounts().map((account:any)=>account.id))).toEqual([alice.id]);
});

test('legacy logout survives reload and permits saved login or guest entry only while signed out',async({page,request})=>{
  const {bob}=await fixture(page,request);
  await page.locator('.auth-menu-button').click();await page.locator('[data-auth-action="logout"]').click();
  expect(await page.evaluate(()=>Auth.current())).toBeNull();
  expect(await page.evaluate(key=>localStorage.getItem(key),currentKey)).toBe('visitor');
  expect(await page.evaluate(()=>Auth.accounts())).toEqual([bob]);
  expect(await page.evaluate(()=>localStorage.getItem('legacy-auth-retained-local-data'))).toBe('disposable local save');
  await page.reload();await expect(page.locator('.auth-menu-button')).toContainText('Log in');
  expect(await page.evaluate(()=>Auth.current())).toBeNull();
  await page.locator('.auth-menu-button').click();
  await expect(page.locator(`[data-auth-action="switch:${bob.id}"]`)).toBeVisible();
  await page.locator('[data-auth-action="login"]').click();
  await expect(page.getByRole('button',{name:'Continue as guest',exact:true})).toBeVisible();
  await expect(page.locator('#auth-verified-bonus')).toBeVisible();
  await expect(page.locator('#auth-verified-bonus')).toContainText('100 free tokens total');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('.auth-menu-button').click();await page.locator(`[data-auth-action="switch:${bob.id}"]`).click();
  expect(await page.evaluate(()=>Auth.current()?.id)).toBe(bob.id);
  await expect(page.locator('[data-auth-action^="switch:"]')).toHaveCount(0);
});

test('legacy linking requires confirmation before configuration or providers and ignores replaced Google callbacks',async({page,request})=>{
  const f=await fixture(page,request);
  page.once('dialog',dialog=>{expect(dialog.message()).toContain('same BuildPlay account');return dialog.dismiss();});
  await page.evaluate(()=>Auth.openDialog('login'));
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(f.configs()).toBe(0);
  expect(await page.evaluate(()=>(window as any).__legacyGoogleCallbacks.length)).toBe(0);
  page.once('dialog',dialog=>dialog.accept());await page.evaluate(()=>Auth.openDialog('login'));
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button',{name:'Synthetic verified provider',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Continue as guest',exact:true})).toHaveCount(0);
  await expect.poll(f.configs).toBe(1);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());await page.evaluate(()=>Auth.openDialog('link'));
  await expect.poll(()=>page.evaluate(()=>(window as any).__legacyGoogleCallbacks.length)).toBe(2);
  await page.evaluate(()=>(window as any).__legacyGoogleCallbacks[0]({credential:'stale-synthetic-token'}));
  expect(f.verifiedRequests()).toBe(0);
});

test('a completed legacy provider request cannot select an account after its dialog closes and the user logs out',async({page,request})=>{
  const f=await fixture(page,request);let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),begin=new Promise<void>(resolve=>{started=resolve;});
  await page.route('**/auth/google',async route=>{started();await gate;await route.fulfill({json:{user_id:f.bob.id,password:f.bob.password,display_name:f.bob.display_name,linked_accounts:[{kind:'google',identifier:'synthetic-provider'}],merged_from_user_id:f.alice.id}});});
  let pending:Promise<unknown>|undefined;
  try{
    page.once('dialog',dialog=>dialog.accept());await page.evaluate(()=>Auth.openDialog('link'));
    await expect.poll(()=>page.evaluate(()=>(window as any).__legacyGoogleCallbacks.length)).toBe(1);
    pending=page.evaluate(()=>(window as any).__legacyGoogleCallbacks[0]({credential:'synthetic-token'}));
    await begin;await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('.auth-menu-button').click();await page.locator('[data-auth-action="logout"]').click();
    release();await pending;
    expect(await page.evaluate(()=>Auth.current())).toBeNull();
    expect(await page.evaluate(key=>localStorage.getItem(key),currentKey)).toBe('visitor');
    expect(await page.evaluate(()=>Auth.accounts())).toEqual([f.bob]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }finally{release();await pending?.catch(()=>{});}
});

test('a selection change in another tab invalidates the legacy provider callback before it can start a request',async({page,context,request})=>{
  const f=await fixture(page,request);
  page.once('dialog',dialog=>dialog.accept());await page.evaluate(()=>Auth.openDialog('link'));
  await expect.poll(()=>page.evaluate(()=>(window as any).__legacyGoogleCallbacks.length)).toBe(1);
  const other=await context.newPage();
  try{
    await other.goto('/health');await other.evaluate(({key,id})=>localStorage.setItem(key,id),{key:currentKey,id:f.bob.id});
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.evaluate(()=>(window as any).__legacyGoogleCallbacks[0]({credential:'stale-synthetic-token'}));
    expect(f.verifiedRequests()).toBe(0);expect(await page.evaluate(()=>Auth.current()?.id)).toBe(f.bob.id);
  }finally{await other.close();}
});
