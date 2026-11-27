import fs from 'node:fs';
import path from 'node:path';
import {expect,type APIRequestContext,type Page} from '@playwright/test';
// Public credentials for the disposable loopback server in e2e/start-server.py.
// Only administrator requests receive them; player contexts stay unprivileged.
export const E2E_ADMIN_CREDENTIALS={username:'e2e-admin',password:'e2e-test-master'};
export const E2E_ADMIN_HEADERS={Authorization:`Basic ${Buffer.from(`${E2E_ADMIN_CREDENTIALS.username}:${E2E_ADMIN_CREDENTIALS.password}`).toString('base64')}`};
export async function loginAdmin(page:Page){
  const health=await page.context().request.get('/health');
  const origin=new URL(health.url()).origin;
  if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw new Error('Admin provider fixture requires the disposable loopback server.');
  const response=await page.context().request.post(`${origin}/auth/admin-session`,{data:{id_token:'loopback-admin-google-fixture'}});
  expect(response.ok(),await response.text()).toBeTruthy();
  const cookie=(await page.context().cookies(origin)).find(item=>item.name==='__Host-buildplay-admin');
  expect(cookie,'The browser must receive the Secure Google admin session cookie.').toBeTruthy();
}
export const uniqueName=(prefix:string)=>`${prefix} ${Date.now()}-${Math.random().toString(16).slice(2)}`;
export async function createUser(request:APIRequestContext,name:string){const response=await request.post('/users',{data:{display_name:name}});expect(response.ok()).toBeTruthy();return response.json();}
export async function createGame(request:APIRequestContext,name:string,fixture='tictactoe'){
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,`../../../games/declarative/${fixture}.json`),'utf8'));
  payload.name=name;payload.game_addition_request_id_and_secret=uniqueName('shared-game-secret');
  return submitGameFixture(request,payload);
}

export async function submitGameFixture(request:APIRequestContext,payload:object):Promise<string>{
  let response=await request.post('/games/declarative',{data:payload});
  for(let attempt=0;response.status()===429&&attempt<10;attempt++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    response=await request.post('/games/declarative',{data:payload});
  }
  expect(response.status(),await response.text()).toBe(201);
  return (await response.json()).id;
}
export async function loginAs(page:Page,user:any){await page.addInitScript(account=>{localStorage.setItem('game-platform.accounts.v1',JSON.stringify([account]));localStorage.setItem('game-platform.current-account.v1',account.id);},user);}

export async function ensureMatchMenuOpen(page:Page){
  const menu=page.getByTestId('match-menu-button');
  await expect(menu).toBeVisible();
  if(await menu.getAttribute('aria-expanded')!=='true')await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded','true');
}

export async function ensureMatchMenuClosed(page:Page){
  const menu=page.getByTestId('match-menu-button');
  await expect(menu).toBeVisible();
  if(await menu.getAttribute('aria-expanded')==='true')await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded','false');
}
