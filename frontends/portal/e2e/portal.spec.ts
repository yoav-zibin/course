import {test,expect,Page,APIRequestContext} from '@playwright/test';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {E2E_ADMIN_HEADERS,uniqueName} from './helpers';
import sharedCopy from '../src/platform/ui-copy.json';

const fixture=JSON.parse(readFileSync(path.resolve(__dirname,'../../../games/declarative/tictactoe.json'),'utf8'));
test.beforeEach(async({baseURL})=>{if(!baseURL||!['127.0.0.1','localhost'].includes(new URL(baseURL).hostname))throw new Error('Portal acceptance tests require a disposable loopback server.');});
async function account(request:APIRequestContext,name:string){const response=await request.post('/users',{data:{display_name:name}});expect(response.ok()).toBeTruthy();return response.json();}
async function restore(page:Page,user:any){await page.addInitScript(user=>{localStorage.setItem('game-platform.accounts.v1',JSON.stringify([user]));localStorage.setItem('game-platform.current-account.v1',user.id);},user);}
async function game(request:APIRequestContext,name:string){const payload=structuredClone(fixture);payload.name=name;payload.game_addition_request_id_and_secret=`shared-${Date.now()}-${Math.random()}-secret`;const response=await request.post('/games/declarative',{data:payload});expect(response.ok(),await response.text()).toBeTruthy();return response.json();}

test('host controls and the offline starter game retain all eight languages without changing saves',async({page,request})=>{
  test.setTimeout(120000);
  const copy=(source:string,locale:string)=>locale==='en'?source:(sharedCopy as Record<string,Record<string,string>>)[source][locale];
  const locales=(await (await request.get('/i18n/locales')).json()).locales;
  await page.goto('/portal');await page.getByRole('button',{name:'On this device',exact:true}).click();
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  const saves=()=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.')).map(key=>[key,JSON.parse(localStorage.getItem(key)!).local])));
  const original=await saves();let current='en';
  for(const locale of ['es','fr','de','pt','zh','hi','ar','en']){
    await page.getByRole('button',{name:copy('Log in',current),exact:true}).click();
    const entry=locales.find((item:any)=>item.code===locale),endonym=entry.native_name||entry.name||locale;
    const language=page.getByRole('button').filter({hasText:endonym});await language.last().click();
    await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.locator('html')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');
    await page.getByRole('button',{name:copy('Close dialog',locale),exact:true}).click();
    await expect(page.getByRole('button',{name:copy('Play history',locale),exact:true})).toBeVisible();
    const cell=locale==='en'?'Cell {n}':fixture.translations[locale].client_strings.cell;
    await expect(page.getByRole('button',{name:cell.replace('{n}','1'),exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);current=locale;
  }
  expect(await saves()).toEqual(original);
});

test('a newly created match stays selected after reloading a game detail link',async({page,request})=>{
  const user=await account(request,'Reload player'),created=await game(request,uniqueName('Reload game'));
  await restore(page,user);await page.goto(`/portal#game=${created.id}`);
  await page.getByRole('button',{name:/^Create match/}).click();
  await expect(page.getByRole('button',{name:'Share match',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/#match=/);
  const current=new URL(page.url()),selected=new URLSearchParams(current.hash.slice(1)).get('match');
  const resumed=page.waitForResponse(response=>new URL(response.url()).pathname===(selected?`/matches/${selected}`:`/games/${created.id}`));
  await page.reload();
  await resumed;
  await expect(page.getByRole('button',{name:'Share match',exact:true})).toBeVisible();
});

test('campaign arrival persists before login and attributes the guest signup',async({page,request})=>{
  const name=uniqueName('Arrival campaign');
  const key=uniqueName('arrival-campaign').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,50);
  const created=await request.post('/admin/experiments/campaign-links',{headers:E2E_ADMIN_HEADERS,data:{name,key}});
  expect(created.status()).toBe(201);
  const campaign=await created.json();
  try{
    await page.goto(`/c/${key}`);
    await expect(page).toHaveURL(new RegExp(`/portal\\?campaign=${key}$`));
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('game-platform.experiment-campaign.v1'))).toBe(key);
    // Drop the query before logging in: attribution must survive navigation.
    await page.goto('/portal');
    await page.getByRole('button',{name:'Log in',exact:true}).first().click();
    const guestName=uniqueName('Campaign guest');
    await page.getByRole('textbox',{name:/Your name|Display name/}).fill(guestName);
    const signupRequest=page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/users');
    await page.getByRole('button',{name:'Continue as guest',exact:true}).click();
    const signup=await signupRequest;
    expect(signup.headers()['x-campaign-code']).toBe(key);
    expect(signup.headers()['authorization']).toBeUndefined();
    await expect(page.getByRole('button',{name:'Account menu'})).toContainText(guestName);
    await page.reload();
    await expect(page.getByRole('button',{name:'Account menu'})).toContainText(guestName);
    expect(await page.evaluate(()=>localStorage.getItem('game-platform.experiment-campaign.v1'))).toBe(key);
    const stats=await request.get('/admin/experiments',{headers:E2E_ADMIN_HEADERS});
    expect(stats.ok()).toBeTruthy();
    const variant=(await stats.json()).campaign_experiment.variants.find((item:{key:string})=>item.key===key);
    expect(variant).toMatchObject({clicks:1,signups:1});
  }finally{
    await request.delete(`/admin/experiments/ad-campaigns/variants/${campaign.variant_id}`,{headers:E2E_ADMIN_HEADERS});
  }
});

test('guest identity survives reload, shared navigation stays responsive, and feedback works',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/portal');await page.getByRole('button',{name:'Log in',exact:true}).first().click();
  await page.getByRole('textbox',{name:/Your name|Display name/}).fill('Shared guest');
  await page.getByRole('button',{name:/Continue as guest/}).click();
  await expect(page.getByRole('button',{name:'Account menu'})).toContainText('Shared guest');
  await page.reload();await expect(page.getByRole('button',{name:'Account menu'})).toContainText('Shared guest');
  await page.getByRole('button',{name:'Feedback',exact:true}).click();
  await page.getByRole('textbox',{name:/What happened/}).fill('The shared portal feedback acceptance check.');
  await page.getByRole('button',{name:/^(Send|Send feedback)$/}).click();await expect(page.getByText('Thanks for the feedback!')).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Preferences',exact:true}).click();
  await page.getByRole('button',{name:'Navigation layout: Left navigation'}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
  expect(errors).toEqual([]);
});

test('bundled local game is playable offline, hides handoffs, persists, and replays',async({page,context})=>{
  await page.goto('/portal');await page.getByRole('button',{name:'On this device',exact:true}).click();
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  // Account preferences stay reachable without leaving the current native game.
  await page.getByRole('button',{name:'Log in',exact:true}).click();await expect(page.getByRole('button',{name:/Language:.*English/})).toBeVisible();await page.getByRole('button',{name:'Close dialog'}).click();await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  // Install/cache the universal shell before taking the device offline.
  await page.evaluate(async()=>{if('serviceWorker'in navigator)await navigator.serviceWorker.ready;});
  await context.setOffline(true);
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();await expect(page.getByRole('button',{name:'I’m ready'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Play history',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'← Previous',exact:true})).toBeDisabled();
  await page.reload();await expect(page.getByRole('button',{name:'I’m ready'})).toBeVisible();
  for(const cell of [4,2,5,3]){await page.getByRole('button',{name:'I’m ready'}).click();await page.getByRole('button',{name:`Cell ${cell}`,exact:true}).click();}
  await expect(page.getByText('Finished',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'← Previous',exact:true}).click();await expect(page.getByText('Replay · move 4 of 5')).toBeVisible();
  await page.getByRole('button',{name:'Play history',exact:true}).click();await expect(page.getByText('Replay · move 5 of 5')).toBeVisible();await expect(page.getByRole('button',{name:'Play history',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Live board',exact:true}).click();await expect(page.getByText('Live board',{exact:true}).first()).toBeVisible();
  await context.setOffline(false);
});

test('private invitation survives guest sign-in and creates a usable shared link and QR code',async({page,request})=>{
  test.setTimeout(120000);
  const owner=await account(request,'Invite host'),created=await game(request,`Shared invite ${Date.now()}`),headers={'X-User-Id':owner.id,'X-User-Password':owner.password};
  const response=await request.post('/matches',{headers,data:{game_id:created.id,num_computer_opponents:0,private:true}});expect(response.ok()).toBeTruthy();const match=await response.json();
  const inviteResponse=await request.post(`/matches/${match.id}/invites`,{headers,data:{}});expect(inviteResponse.ok()).toBeTruthy();const invite=await inviteResponse.json();
  await page.goto(`/portal#invite=${invite.token}`);await page.getByRole('button',{name:'Log in to join',exact:true}).click();
  await page.getByRole('textbox',{name:/Your name|Display name/}).fill('Invited guest');await page.getByRole('button',{name:'Continue as guest',exact:true}).click();
  await expect(page.getByRole('button',{name:'Close dialog'})).toHaveCount(0);
  await page.getByRole('button',{name:'Join match',exact:true}).click();await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
  // Acceptance finishes loading the pinned game before removing the invite banner.
  // Wait for that navigation so its layout change cannot move Share during the press.
  await expect(page).toHaveURL(new RegExp(`#match=${match.id}$`));
  await expect(page.getByRole('button',{name:'Join match',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/^(Share match|Share)$/}).click();await expect(page.getByRole('textbox',{name:'Invite link'})).toHaveValue(/invite=/,{timeout:20000});
  const qr=page.getByLabel('Match invite QR code');await expect(qr).toBeVisible();
  await page.getByRole('button',{name:'Close dialog'}).click();await page.reload();await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
});

test('two browser players share turns, a lost reply cannot duplicate a move, and offline actions sync',async({page,browser,request,baseURL})=>{
  test.setTimeout(120000);
  const a=await account(request,'Shared Alice'),b=await account(request,'Shared Bob');
  const created=await game(request,`Shared cross-device ${Date.now()}`),headers={'X-User-Id':a.id,'X-User-Password':a.password};
  const response=await request.post('/matches',{headers,data:{game_id:created.id,num_computer_opponents:0}});expect(response.ok()).toBeTruthy();const match=await response.json();
  await restore(page,a);await page.goto(`/portal#match=${match.id}`);
  const partner=await browser.newContext({baseURL});const bob=await partner.newPage();await restore(bob,b);await bob.goto(`/portal#match=${match.id}`);
  await bob.getByRole('button',{name:'Join match',exact:true}).click();
  await expect(page.getByRole('button',{name:'Start game',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Start game',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  let lost=false;
  await page.route(`**/matches/${match.id}/moves`,async route=>{if(route.request().method()==='POST'&&!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await page.getByRole('button',{name:'Cell 1',exact:true}).click();
  await expect(bob.getByRole('button',{name:'Cell 4',exact:true})).toBeVisible();await bob.getByRole('button',{name:'Cell 4',exact:true}).click();
  await expect(page.getByRole('button',{name:'Cell 2',exact:true})).toBeVisible({timeout:20000});
  const state=await request.get(`/matches/${match.id}`,{headers});expect((await state.json()).move_count).toBe(2);
  await page.context().setOffline(true);await page.getByRole('button',{name:'Cell 2',exact:true}).click();
  await expect(page.getByText(/Your move is saved and waiting/)).toBeVisible();
  await page.context().setOffline(false);await expect(bob.getByRole('button',{name:'Cell 5',exact:true})).toBeVisible({timeout:20000});
  await bob.getByRole('button',{name:'Cell 5',exact:true}).click();await expect(page.getByRole('button',{name:'Cell 3',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cell 3',exact:true}).click();
  await expect(page.getByText('Finished',{exact:true}).first()).toBeVisible();await expect(bob.getByText('Finished',{exact:true}).first()).toBeVisible();
  expect((await(await request.get(`/matches/${match.id}`,{headers})).json()).move_count).toBe(5);
  await partner.close();
});
