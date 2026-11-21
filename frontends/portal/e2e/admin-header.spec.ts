import {test,expect} from '@playwright/test';
import {createUser,loginAdmin,uniqueName} from './helpers';

test('admin header shows Google identity and signs out its session without clearing the Portal account',async({page,request,baseURL})=>{
  if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Requires a disposable loopback server.');
  const player={...await createUser(request,uniqueName('Remembered Portal guest')),linked:[]};
  await page.addInitScript(account=>{
    if(sessionStorage.getItem('admin-header-player-seeded'))return;
    sessionStorage.setItem('admin-header-player-seeded','1');
    localStorage.setItem('game-platform.accounts.v1',JSON.stringify([account]));
    localStorage.setItem('game-platform.current-account.v1',account.id);
    localStorage.setItem('admin-header-retained-local-save','keep this local save');
  },player);
  await loginAdmin(page);
  await page.route('**/admin/students/data',route=>route.fulfill({json:{students:[],notes:[],generated_at:'2026-11-21T10:00:00Z'}}));
  await page.goto('/admin#students');
  await expect(page.locator('#admin-identity')).toHaveText('Signed in as E2E administrator (admin@loopback.example.test).');
  await expect(page.locator('#account-menu')).not.toContainText(player.display_name);
  await expect(page.locator('.auth-menu-button')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const signedOut=page.waitForResponse(response=>response.request().method()==='DELETE'&&new URL(response.url()).pathname==='/auth/admin-session');
  await page.getByRole('button',{name:'Use another Google account',exact:true}).click();
  const signedOutResponse=await signedOut;
  expect(signedOutResponse.status()).toBe(204);
  expect(signedOutResponse.request().headers()['x-user-id']).toBeUndefined();
  expect(signedOutResponse.request().headers()['x-user-password']).toBeUndefined();
  await expect(page.getByRole('heading',{name:'Sign in to admin',exact:true})).toBeVisible();
  const destination=new URL(page.url());
  expect(destination.pathname).toBe('/admin/login');
  expect(destination.searchParams.get('next')).toBe('/admin#students');
  expect((await(await page.request.get('/auth/admin-session')).json()).signed_in).toBe(false);
  const retained=await page.evaluate(()=>({
    current:localStorage.getItem('game-platform.current-account.v1'),
    accounts:JSON.parse(localStorage.getItem('game-platform.accounts.v1')||'[]'),
    save:localStorage.getItem('admin-header-retained-local-save'),
  }));
  expect(retained.current).toBe(player.id);expect(retained.accounts.some((account:any)=>account.id===player.id)).toBe(true);
  expect(retained.save).toBe('keep this local save');
});
