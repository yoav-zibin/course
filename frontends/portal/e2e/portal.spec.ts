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
  // Constructed roster fixtures exercise the API's valid 200-codepoint names;
  // they are local layout evidence, not a claim of multiplayer browser play.
  const names=['مرحباالعالم世界🙂Ω'.repeat(20), 'Alice العربية 中文 👩🏽‍🚀🦊'.repeat(20)].map(name=>Array.from(name).slice(0,200).join(''));
  await page.evaluate(names=>{for(const key of Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.'))){const data=JSON.parse(localStorage.getItem(key)!);for(const match of Object.values(data.local||{}) as any[])match.players.forEach((player:any,index:number)=>{player.name=names[index%names.length];});localStorage.setItem(key,JSON.stringify(data));}},names);
  await page.reload();await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  const saves=()=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(key=>key.startsWith('buildplay.shared.v1.')).map(key=>[key,JSON.parse(localStorage.getItem(key)!).local])));
  const original=await saves();let current='en';
  const board=await page.getByTestId('game-stage').locator('svg').first().elementHandle();
  for(const locale of ['es','fr','de','pt','zh','hi','ar','en']){
    await page.getByRole('button',{name:copy('Log in',current),exact:true}).click();
    const entry=locales.find((item:any)=>item.code===locale),endonym=entry.native_name||entry.name||locale;
    const language=page.getByRole('button').filter({hasText:endonym});await language.last().click();
    await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.locator('html')).toHaveAttribute('dir',locale==='ar'?'rtl':'ltr');
    await page.getByRole('button',{name:copy('Close dialog',locale),exact:true}).click();
    await expect(page.getByRole('button',{name:copy('Play history',locale),exact:true})).toBeVisible();
    const cell=locale==='en'?'Cell {n}':fixture.translations[locale].client_strings.cell;
    await expect(page.getByRole('button',{name:cell.replace('{n}','1'),exact:true})).toBeVisible();
    expect(await board!.evaluate(node=>node===document.querySelector('[data-testid="game-stage"] svg'))).toBe(true);
    for(const size of [{width:320,height:480},{width:480,height:320},{width:820,height:1180},{width:1180,height:820}]){
      await page.setViewportSize(size);
      for(const name of names){const label=page.getByText(name,{exact:true});await expect(label).toHaveText(name);await expect.poll(async()=>{const box=(await label.boundingBox())!;return box.x>=-1&&box.x+box.width<=size.width+1;}).toBe(true);}
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);current=locale;
  }
  expect(await saves()).toEqual(original);
});

test('short screens keep the full native board width and can scroll to its last rank',async({page},info)=>{
  for(const viewport of [{width:320,height:480},{width:480,height:320},{width:844,height:390}]){
    await page.setViewportSize(viewport);await page.goto('/portal');
    await page.getByRole('button',{name:'On this device',exact:true}).click();
    await page.getByRole('button',{name:'Pass and play',exact:true}).click();
    const board=page.getByLabel('Game board. Use pieces and highlighted destinations. Zoom controls are above the board.');
    await expect(page.getByRole('button',{name:'Cell 9',exact:true})).toBeAttached();
    const geometry=await board.boundingBox();expect(geometry!.width).toBeCloseTo(viewport.width,0);
    // The bundled package declares 600x560, including its instruction margins.
    await expect(board.locator('svg').first()).toHaveAttribute('viewBox','0 0 600 560');
    expect(geometry!.height).toBeGreaterThanOrEqual(Math.min(viewport.width*560/600,viewport.height*.7)-1);
    await board.scrollIntoViewIfNeeded();
    // Wheel over the actual board must reach the bottom through the native
    // containing scroll view, without silently zooming the game instead.
    const rect=(await board.boundingBox())!;await page.mouse.move(viewport.width/2,Math.max(20,Math.min(viewport.height-20,rect.y+rect.height/2)));
    const cell=page.getByRole('button',{name:'Cell 9',exact:true});
    for(let step=0;step<15;step++){
      const box=(await cell.boundingBox())!;
      const clip=await cell.evaluate(node=>{for(let parent=node.parentElement;parent;parent=parent.parentElement){if(/auto|scroll/.test(getComputedStyle(parent).overflowY)){const r=parent.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}}return {top:0,bottom:innerHeight};});
      if(box.y>=clip.top&&box.y+box.height<=clip.bottom)break;
      await page.mouse.wheel(0,box.y<clip.top?-80:80);
      await expect.poll(async()=>Math.abs((await cell.boundingBox())!.y-box.y)).toBeGreaterThan(1);
    }
    await expect.poll(async()=>{const box=await cell.boundingBox();return !!box&&box.x>=0&&box.x+box.width<=viewport.width+1&&box.y>=0&&box.y+box.height<=viewport.height+1;}).toBe(true);
    expect(await cell.evaluate(node=>{const rect=node.getBoundingClientRect();return node.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));})).toBe(true);
    await expect(page.getByRole('button',{name:'Reset board view'})).toHaveText('100%');
    await page.screenshot({path:info.outputPath(`last-rank-${viewport.width}.png`)});
    await cell.click();await expect(page.getByRole('button',{name:'I’m ready'})).toBeVisible();
  }
});

test('empty fitted board space permits native touch scrolling and retains real piece taps',async({page,isMobile})=>{
  test.skip(!isMobile,'Uses the mobile project’s native touch input');
  await page.setViewportSize({width:480,height:320});await page.goto('/portal');
  await page.getByRole('button',{name:'On this device',exact:true}).click();await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  const board=page.getByLabel('Game board. Use pieces and highlighted destinations. Zoom controls are above the board.');
  await expect(page.getByRole('button',{name:'Cell 9',exact:true})).toBeAttached();await board.scrollIntoViewIfNeeded();
  const port=await board.evaluateHandle(node=>{for(let parent=node.parentElement;parent;parent=parent.parentElement)if(/auto|scroll/.test(getComputedStyle(parent).overflowY))return parent;throw new Error('Missing native containing scroll view');});
  const before=await port.evaluate(node=>node.scrollTop),bounds=await port.evaluate(node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom};});
  const cdp=await page.context().newCDPSession(page),start=bounds.bottom-20,end=bounds.top+20;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:5,y:start,id:1}]});
  for(let step=1;step<=8;step++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:5,y:start+(end-start)*step/8,id:1}]});await page.waitForTimeout(16);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>port.evaluate(node=>node.scrollTop)).toBeGreaterThan(before+20);
  const cell=page.getByRole('button',{name:'Cell 9',exact:true});await cell.tap();await expect(page.getByRole('button',{name:'I’m ready'})).toBeVisible();
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

test('browser Back from a local match restores its game detail screen and play controls',async({page,request})=>{
  const created=await game(request,uniqueName('History game'));await page.goto(`/portal#game=${created.id}`);
  await page.getByRole('button',{name:'Pass and play',exact:true}).click();await expect(page.getByRole('button',{name:'Cell 1',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/#match=local-/);await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#game=${created.id}$`));await expect(page.getByRole('heading',{name:created.name,exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Pass and play',exact:true})).toBeVisible();
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
  await expect(page.getByTestId('match-outcome')).toHaveText('Player 1 won');
  await page.getByRole('button',{name:'← Previous',exact:true}).click();await expect(page.getByText('Replay · move 4 of 5')).toBeVisible();
  await page.getByRole('button',{name:'Play history',exact:true}).click();await expect(page.getByText('Replay · move 5 of 5')).toBeVisible();await expect(page.getByRole('button',{name:'Play history',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Live board',exact:true}).click();await expect(page.getByText('Live board',{exact:true}).first()).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button',{name:'On this device',exact:true}).click();
  await expect(page.getByTestId('match-outcome')).toHaveText('Player 1 won');
});

test('a genuinely finished local draw is shown in both native detail and match list',async({page})=>{
  await page.goto('/portal');await page.getByRole('button',{name:'On this device',exact:true}).click();await page.getByRole('button',{name:'Pass and play',exact:true}).click();
  for(const [index,cell] of [1,2,3,5,4,6,8,7,9].entries()){
    if(index)await page.getByRole('button',{name:'I’m ready'}).click();
    await page.getByRole('button',{name:`Cell ${cell}`,exact:true}).click();
  }
  await expect(page.getByTestId('match-outcome')).toHaveText('Draw');
  await page.getByRole('button',{name:'On this device',exact:true}).click();await expect(page.getByTestId('match-outcome')).toHaveText('Draw');
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
