import {test,expect,type Page} from '@playwright/test';

const googleFixture='loopback-admin-google-fixture';
async function googleWidget(page:Page,credential=googleFixture){
  await page.route('**/auth/config',route=>route.fulfill({json:{google_client_id:'loopback-admin-google-client'}}));
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:`
    window.google={accounts:{id:{
      initialize(options){window.__adminGoogleCallback=options.callback;},
      renderButton(holder){const button=document.createElement('button');button.textContent='Synthetic Google sign-in';button.addEventListener('click',()=>window.__adminGoogleCallback({credential:${JSON.stringify(credential)}}));holder.append(button);},
      disableAutoSelect(){}
    }}};
  `}));
  await page.route('**/admin/students/data',route=>route.fulfill({json:{students:[],notes:[],generated_at:'2026-11-21T10:00:00Z'}}));
}

test.beforeEach(async({context,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Admin Google checks require a disposable loopback server.');
  // Human access uses only verified Google identity and the course roster.
  await context.setHTTPCredentials(null);
});

test('Google sign-in preserves the requested admin tab and saves the verified email',async({page,context})=>{
  await googleWidget(page);
  const adminResponses:number[]=[];
  page.on('response',response=>{if(new URL(response.url()).pathname==='/admin')adminResponses.push(response.status());});
  await page.goto('/admin#students');
  await expect(page.getByRole('heading',{name:'Sign in to admin',exact:true})).toBeVisible();
  const login=new URL(page.url());
  expect(login.pathname).toBe('/admin/login');
  expect(login.searchParams.get('next')).toBe('/admin');
  expect(login.hash).toBe('#students');
  await expect(page.getByText(/Google shares your name and email with BuildPlay/)).toBeVisible();
  await expect(page.locator('#continue')).toHaveAttribute('href','/admin#students');
  const submitted=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/auth/admin-session');
  await page.getByRole('button',{name:'Synthetic Google sign-in',exact:true}).click();
  expect((await submitted).headers()['authorization']).toBeUndefined();
  await expect(page).toHaveURL(/\/admin#students$/);
  await expect(page.getByRole('tab',{name:'Students leaderboard',exact:true})).toHaveAttribute('aria-selected','true');
  expect(adminResponses).toContain(303);
  expect(adminResponses).toContain(200);
  expect(adminResponses).not.toContain(401);
  const session=await page.request.get('/auth/admin-session');
  expect(session.ok()).toBe(true);
  const identity=await session.json();
  expect(identity.signed_in).toBe(true);
  expect(identity.user.email).toBe('admin@loopback.example.test');
  expect(JSON.stringify(identity)).not.toContain('password');
  expect(JSON.stringify(identity)).not.toContain(googleFixture);
  expect((await page.request.get('/admin/bug-reports?status=all&limit=1')).status()).toBe(200);
  const cookie=(await context.cookies()).find(item=>item.name==='__Host-buildplay-admin');
  expect(cookie?.httpOnly).toBe(true);expect(cookie?.secure).toBe(true);expect(cookie?.sameSite).toBe('Strict');
  await page.goto('/admin/login');
  await expect(page.locator('#identity')).toHaveText('Signed in as E2E administrator (admin@loopback.example.test).');
  await page.getByRole('button',{name:'Use another Google account',exact:true}).click();
  await expect(page.getByRole('button',{name:'Synthetic Google sign-in',exact:true})).toBeVisible();
  expect((await (await page.request.get('/auth/admin-session')).json()).signed_in).toBe(false);
});

test('an invalid Google token stays on sign-in with a safe error and no session',async({page,context})=>{
  const invalid='invalid-loopback-google-credential';
  await googleWidget(page,invalid);
  await page.goto('/admin/login?next=%2Fadmin%23students');
  await page.getByRole('button',{name:'Synthetic Google sign-in',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText(/Google sign-in.*not be verified/i);
  expect(new URL(page.url()).pathname).toBe('/admin/login');
  await expect(page.locator('#status')).toHaveText('Sign in with Google to continue.');
  await expect(page.locator('body')).not.toContainText(invalid);
  expect((await context.cookies()).some(item=>item.name==='__Host-buildplay-admin')).toBe(false);
});

test('admin sign-in remains usable when the translation script fails',async({page})=>{
  await page.route('**/static/i18n.js?*',route=>route.abort());
  await googleWidget(page,'invalid-loopback-google-credential');
  await page.goto('/admin/login');
  await expect(page.getByRole('button',{name:'Synthetic Google sign-in'})).toBeVisible();
  await page.getByRole('button',{name:'Synthetic Google sign-in'}).click();
  await expect(page.getByRole('alert')).toHaveText('Google sign-in could not be verified. Sign in again.');
});

test('a verified Google account outside the course roster cannot enter admin',async({page,context})=>{
  await googleWidget(page,'loopback-outsider-google-fixture');
  await page.goto('/admin#students');
  await expect(page.getByRole('heading',{name:'Sign in to admin',exact:true})).toBeVisible();
  const denied=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/auth/admin-session');
  await page.getByRole('button',{name:'Synthetic Google sign-in',exact:true}).click();
  expect((await denied).status()).toBe(403);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/course|authoriz|access|allow/i);
  await expect(page.getByRole('tab',{name:'Students leaderboard',exact:true})).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe('/admin/login');
  expect((await context.cookies()).some(item=>item.name==='__Host-buildplay-admin')).toBe(false);
  expect((await (await page.request.get('/auth/admin-session')).json()).signed_in).toBe(false);
});

test('external next URLs are discarded before completing Google sign-in',async({page})=>{
  await googleWidget(page);
  await page.goto('/admin/login?next='+encodeURIComponent('https://outside.example/admin#students'));
  await expect(page.locator('#continue')).toHaveAttribute('href','/admin');
  await page.getByRole('button',{name:'Synthetic Google sign-in',exact:true}).click();
  await expect(page).toHaveURL(/\/admin#console$/);
  await expect(page.getByRole('tab',{name:'API console',exact:true})).toHaveAttribute('aria-selected','true');
});
