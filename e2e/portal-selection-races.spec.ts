import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {test, expect} from '@playwright/test';
import {createUser, loginAs, uniqueName} from './helpers';

// Disposable local-server regressions. Production audit accounts/matches are
// never used. The runner's private file permits filtering browser exceptions.
async function account(request:any) {
  const user=await createUser(request,uniqueName('Selection race'));
  const file=process.env.SELECTION_RACE_PRIVATE_ACCOUNT||path.join(fs.mkdtempSync(path.join(os.tmpdir(),'portal-race-account-')),'account.json');
  fs.writeFileSync(file,JSON.stringify(user),{mode:0o600});fs.chmodSync(file,0o600);
  return user;
}

test('Create resolves a selected declarative game after catalog cache eviction',async({page,request},info)=>{
  test.setTimeout(240000);
  const user=await account(request);
  const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../games/declarative/tictactoe.json'),'utf8'));
  payload.game_addition_request_id_and_secret=uniqueName('Selection fixture');
  let imported=await request.post('/games/declarative',{data:payload,timeout:210000});
  for(let attempt=0;imported.status()===429&&attempt<50;attempt++){
    await new Promise(resolve=>setTimeout(resolve,1000));
    imported=await request.post('/games/declarative',{data:payload,timeout:210000});
  }
  expect(imported.status(),await imported.text()).toBe(201);
  const game=await imported.json();
  await loginAs(page,user);await page.goto(`/static/portal.html#game=${game.id}`);
  await expect(page.locator('#selected-game-name')).toHaveText(game.name);
  await expect(page.locator('#create')).toBeEnabled();
  let release!:()=>void,seen!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const captured=new Promise<void>(resolve=>{seen=resolve;});
  let armed=true;const posts:string[]=[];
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/matches')posts.push(r.postData()||'');});
  await page.route('**/batch?*',async route=>{
    const items=JSON.parse(new URL(route.request().url()).searchParams.get('requests')||'[]');
    if(armed&&items.some((item:any)=>item.path===`/games/${game.id}`)){
      armed=false;const response=await route.fetch();seen();await held;await route.fulfill({response});
    }else await route.continue();
  });
  // Explicit cache-eviction fixture; all interaction and writes use real UI/API.
  await page.evaluate('state.games=[]');
  await page.locator('#create').click();
  try {
    await captured;await expect(page.locator('#create')).toBeDisabled();expect(posts).toHaveLength(0);
  }finally {release();}
  await expect(page.getByRole('button',{name:'Start game',exact:true})).toBeVisible();
  expect(posts).toHaveLength(1);expect(JSON.parse(posts[0]).game_id).toBe(game.id);
  const list=await (await request.get('/matches',{headers:{'X-User-Id':user.id,'X-User-Password':user.password}})).json();
  expect((Array.isArray(list)?list:list.items).filter((m:any)=>m.game_id===game.id)).toHaveLength(1);
  await info.attach('created-lobby',{body:await page.screenshot(),contentType:'image/png'});
});

test('a real picker choice survives an older pending account-language response',async({page,request},info)=>{
  test.setTimeout(60000);
  const user=await account(request);
  const initial=await request.patch(`/users/${user.id}`,{headers:{'X-User-Id':user.id,'X-User-Password':user.password},data:{locale:'en'}});
  expect(initial.ok()).toBeTruthy();
  let release!:()=>void,seen!:()=>void,armed=true,capturedUrl='';
  const held=new Promise<void>(resolve=>{release=resolve;});
  const captured=new Promise<void>(resolve=>{seen=resolve;});
  const intercept=async(route:any)=>{
    if(!armed)return route.continue();
    const url=new URL(route.request().url());
    const items=url.pathname==='/batch'?JSON.parse(url.searchParams.get('requests')||'[]'):[];
    const ownLookup=route.request().method()==='GET'&&(url.pathname===`/users/${user.id}`||items.some((item:any)=>item.path===`/users/${user.id}`));
    if(!ownLookup)return route.continue();
    armed=false;const response=await route.fetch();
    const data=await response.json();
    const old=items.length?data[items.findIndex((item:any)=>item.path===`/users/${user.id}`)].body:data;
    expect(old.locale).toBe('en');capturedUrl=route.request().url();seen();await held;await route.fulfill({response});
  };
  await page.route(`**/users/${user.id}`,intercept);await page.route('**/batch?*',intercept);
  await loginAs(page,user);await page.goto('/static/portal.html',{waitUntil:'domcontentloaded'});
  await captured;
  await page.locator('#account-menu .auth-menu-button').click();
  const picker=page.locator('.language-picker select');await expect(picker).toBeVisible();
  const saved=page.waitForResponse(r=>r.request().method()==='PATCH'&&new URL(r.url()).pathname===`/users/${user.id}`);
  const staleDelivered=page.waitForResponse(r=>r.request().method()==='GET'&&r.url()===capturedUrl);
  try {await picker.selectOption('es');const response=await saved;expect(response.ok()).toBeTruthy();expect(response.request().postDataJSON().locale).toBe('es');}
  finally {release();}
  await staleDelivered;
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});
  await expect(page.locator('html')).toHaveAttribute('lang','es');await expect(picker).toHaveValue('es');
  await expect.poll(async()=>page.evaluate('I18n.locale()')).toBe('es');
  const profile=await (await request.get(`/users/${user.id}`,{headers:{'X-User-Id':user.id,'X-User-Password':user.password}})).json();
  expect(profile.locale).toBe('es');
  await info.attach('spanish-after-stale-profile',{body:await page.screenshot(),contentType:'image/png'});
});
